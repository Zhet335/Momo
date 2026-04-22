import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  screen,
  shell,
  Tray
} from "electron";
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";

app.disableHardwareAcceleration();
loadEnv({ path: path.join(process.cwd(), ".env") });

type ChatRole = "system" | "assistant" | "user";
type PetMood = "idle" | "engaged" | "thinking" | "happy";
type PetGlanceDirection = "left" | "right";

type ChatMessagePayload = {
  role: ChatRole;
  content: string;
};

type TranscriptMessage = {
  role: "assistant" | "user";
  content: string;
};

type TodoItem = {
  id: string;
  title: string;
  dueAt?: string;
  remindMinutesBefore?: number;
  done: boolean;
};

type TodoDraft = {
  title: string;
  dueAt?: string;
  remindMinutesBefore?: number;
};

type AppSettings = {
  transcriptDirectory: string;
};

let petWindow: BrowserWindow | null = null;
let chatWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let todoWindow: BrowserWindow | null = null;
let contextMenuWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

let keepChatVisibleOnBlur = false;
let hasUnreadReminder = false;
let petPointerPassthroughEnabled = false;
let reminderTimer: NodeJS.Timeout | null = null;
const remindedTodoIds = new Set<string>();
let petDragSession:
  | {
      pointerStartX: number;
      pointerStartY: number;
      windowStartX: number;
      windowStartY: number;
    }
  | null = null;

const isDev = !app.isPackaged;
const PET_WINDOW_SIZE = 110;
const CHAT_WINDOW_WIDTH = 340;
const CHAT_WINDOW_HEIGHT = 520;
const SETTINGS_WINDOW_WIDTH = 440;
const SETTINGS_WINDOW_HEIGHT = 320;
const TODO_WINDOW_WIDTH = 420;
const TODO_WINDOW_HEIGHT = 520;
const MENU_WINDOW_WIDTH = 248;
const MENU_WINDOW_HEIGHT = 144;
const CHAT_WINDOW_GAP = 10;
const WINDOW_MARGIN = 16;
const PANEL_WINDOW_RADIUS = 28;

const DEFAULT_ZHIPU_MODEL = process.env.ZHIPU_MODEL?.trim() || "glm-4-flash";
const ENABLE_WEB_SEARCH_BY_DEFAULT = process.env.MOMO_ENABLE_WEB_SEARCH?.trim() !== "0";
let webSearchEnabled = ENABLE_WEB_SEARCH_BY_DEFAULT;

const SETTINGS_FILE_NAME = "settings.json";
const TODO_FILE_NAME = "Momo TODO.md";

function resolveRendererUrl(route: string) {
  if (isDev) {
    return `http://localhost:5173${route}`;
  }
  const indexPath = path.join(app.getAppPath(), "dist", "index.html");
  return `file://${indexPath}${route}`;
}

function getDefaultTranscriptDirectory() {
  return path.join(app.getPath("documents"), "Momo Dialogues");
}

function getSettingsFilePath() {
  return path.join(app.getPath("userData"), SETTINGS_FILE_NAME);
}

function ensureDirectory(directoryPath: string) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function readSettings(): AppSettings {
  const settingsPath = getSettingsFilePath();
  const fallback: AppSettings = { transcriptDirectory: getDefaultTranscriptDirectory() };

  if (!fs.existsSync(settingsPath)) {
    ensureDirectory(fallback.transcriptDirectory);
    fs.writeFileSync(settingsPath, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Partial<AppSettings>;
    const transcriptDirectory = parsed.transcriptDirectory?.trim() || fallback.transcriptDirectory;
    ensureDirectory(transcriptDirectory);
    return { transcriptDirectory };
  } catch {
    ensureDirectory(fallback.transcriptDirectory);
    return fallback;
  }
}

function writeSettings(nextSettings: AppSettings) {
  ensureDirectory(path.dirname(getSettingsFilePath()));
  ensureDirectory(nextSettings.transcriptDirectory);
  fs.writeFileSync(getSettingsFilePath(), JSON.stringify(nextSettings, null, 2), "utf8");
  return nextSettings;
}

function getTodoFilePath() {
  const settings = readSettings();
  ensureDirectory(settings.transcriptDirectory);
  return path.join(settings.transcriptDirectory, TODO_FILE_NAME);
}

function sanitizeFileName(input: string) {
  return input.replace(/[\\/:*?"<>|]/g, "").trim();
}

function timestampForFileName(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function buildTranscriptMarkdown(messages: TranscriptMessage[]) {
  const lines = ["# Momo 对话记录", "", `保存时间：${new Date().toLocaleString("zh-CN")}`, ""];
  for (const message of messages) {
    const heading = message.role === "user" ? "用户" : "Momo";
    lines.push(`## ${heading}`);
    lines.push("");
    lines.push(message.content.trim() || "（空消息）");
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

function saveConversationToMarkdown(messages: TranscriptMessage[]) {
  const settings = readSettings();
  const firstUserLine =
    messages.find((message) => message.role === "user")?.content.split(/\r?\n/)[0] || "对话记录";
  const fileName = `${timestampForFileName()}-${sanitizeFileName(firstUserLine).slice(0, 24) || "Momo"}.md`;
  const outputPath = path.join(settings.transcriptDirectory, fileName);
  fs.writeFileSync(outputPath, buildTranscriptMarkdown(messages), "utf8");
  return { path: outputPath };
}

function parseTodoLine(line: string): TodoItem | null {
  const trimmed = line.trim();
  const match = /^- \[( |x)\] (.+?)(?: \| due: ([^|]+))?(?: \| remind: (\d+))?$/.exec(trimmed);
  if (!match) {
    return null;
  }

  const [, doneFlag, title, dueAt, remindMinutesBefore] = match;
  const id = sanitizeFileName(`${title}-${dueAt || "no-due"}-${remindMinutesBefore || 0}`).toLowerCase();
  return {
    id,
    title: title.trim(),
    dueAt: dueAt?.trim(),
    remindMinutesBefore: remindMinutesBefore ? Number(remindMinutesBefore) : undefined,
    done: doneFlag === "x"
  };
}

function serializeTodoItem(item: TodoItem) {
  const duePart = item.dueAt ? ` | due: ${item.dueAt}` : "";
  const remindPart = item.remindMinutesBefore ? ` | remind: ${item.remindMinutesBefore}` : "";
  return `- [${item.done ? "x" : " "}] ${item.title}${duePart}${remindPart}`;
}

function ensureTodoFile() {
  const todoFilePath = getTodoFilePath();
  if (!fs.existsSync(todoFilePath)) {
    fs.writeFileSync(
      todoFilePath,
      "# Momo 待办清单\n\n> 格式：- [ ] 标题 | due: YYYY-MM-DD HH:mm | remind: 提前分钟\n\n",
      "utf8"
    );
  }
  return todoFilePath;
}

function readTodos() {
  const todoFilePath = ensureTodoFile();
  const content = fs.readFileSync(todoFilePath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => parseTodoLine(line))
    .filter((item): item is TodoItem => item !== null);
}

function writeTodos(items: TodoItem[]) {
  const todoFilePath = ensureTodoFile();
  const lines = [
    "# Momo 待办清单",
    "",
    "> 格式：- [ ] 标题 | due: YYYY-MM-DD HH:mm | remind: 提前分钟",
    ""
  ];

  if (!items.length) {
    lines.push("- [ ] 新待办示例 | due: 2026-01-01 09:00 | remind: 30");
  } else {
    lines.push(...items.map((item) => serializeTodoItem(item)));
  }

  fs.writeFileSync(todoFilePath, `${lines.join("\n")}\n`, "utf8");
  return { path: todoFilePath, items };
}

function appendTodoItem(draft: TodoDraft) {
  const nextItem: TodoItem = {
    id: sanitizeFileName(
      `${draft.title}-${draft.dueAt || "no-due"}-${draft.remindMinutesBefore || 0}-${Date.now()}`
    ).toLowerCase(),
    title: draft.title.trim(),
    dueAt: draft.dueAt?.trim(),
    remindMinutesBefore: draft.remindMinutesBefore,
    done: false
  };
  const result = writeTodos([...readTodos(), nextItem]);
  return { ...result, item: nextItem };
}

function getTodoDueTime(item: TodoItem) {
  if (!item.dueAt) {
    return null;
  }
  const timestamp = new Date(item.dueAt.replace(" ", "T")).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function isTodoExpired(item: TodoItem) {
  const dueTime = getTodoDueTime(item);
  return dueTime !== null && dueTime < Date.now();
}

function collectRecentTranscriptContext() {
  const settings = readSettings();
  if (!fs.existsSync(settings.transcriptDirectory)) {
    return "";
  }

  const files = fs
    .readdirSync(settings.transcriptDirectory)
    .filter((fileName) => fileName.toLowerCase().endsWith(".md") && fileName !== TODO_FILE_NAME)
    .map((fileName) => {
      const fullPath = path.join(settings.transcriptDirectory, fileName);
      return { fileName, fullPath, modifiedAt: fs.statSync(fullPath).mtimeMs };
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(0, 3);

  const snippets = files
    .map((file) => {
      const content = fs.readFileSync(file.fullPath, "utf8").replace(/\s+/g, " ").trim();
      return content ? `文件：${file.fileName}\n${content.slice(0, 900)}` : "";
    })
    .filter(Boolean);

  if (!snippets.length) {
    return "";
  }

  return ["以下是最近对话摘要，若相关请参考。", "", ...snippets].join("\n");
}

function collectTodoContext() {
  const todoItems = readTodos().filter((item) => !item.done && !isTodoExpired(item));
  if (!todoItems.length) {
    return "";
  }
  const lines = todoItems.map((item) => {
    const duePart = item.dueAt ? `，截止时间 ${item.dueAt}` : "";
    const remindPart = item.remindMinutesBefore ? `，提前 ${item.remindMinutesBefore} 分钟提醒` : "";
    return `- ${item.title}${duePart}${remindPart}`;
  });
  return ["以下是当前待办，请在相关问题中参考。", "", ...lines].join("\n");
}

function getTodoReminderSummary() {
  const now = Date.now();
  const items = readTodos().filter((item) => !item.done && item.dueAt && !isTodoExpired(item));
  const ready = items.filter((item) => {
    const dueTime = getTodoDueTime(item);
    if (dueTime === null) {
      return false;
    }
    const remindBeforeMs = (item.remindMinutesBefore ?? 0) * 60 * 1000;
    return now >= dueTime - remindBeforeMs;
  });

  if (!ready.length) {
    return "";
  }

  return ready
    .slice(0, 4)
    .map((item) => `- ${item.title}${item.dueAt ? `（${item.dueAt}）` : ""}`)
    .join("\n");
}

function updatePetMood(mood: PetMood) {
  petWindow?.webContents.send("pet:mood-changed", mood);
}

function updatePetGlance(direction: PetGlanceDirection) {
  petWindow?.webContents.send("pet:glance", direction);
}

function updateUnreadReminderState(hasUnread: boolean) {
  hasUnreadReminder = hasUnread;
  petWindow?.webContents.send("pet:unread-reminder", hasUnread);
}

function notifyChatOpened() {
  if (!chatWindow || chatWindow.isDestroyed()) {
    return;
  }
  chatWindow.webContents.send("chat:opened");
}

function maybePushTodoReminder() {
  const now = Date.now();
  const dueItems = readTodos().filter((item) => {
    if (item.done || !item.dueAt || isTodoExpired(item)) {
      return false;
    }
    const dueTime = getTodoDueTime(item);
    if (dueTime === null) {
      return false;
    }
    const remindBeforeMs = (item.remindMinutesBefore ?? 0) * 60 * 1000;
    return now >= dueTime - remindBeforeMs;
  });

  for (const item of dueItems) {
    if (remindedTodoIds.has(item.id)) {
      continue;
    }
    remindedTodoIds.add(item.id);
    updatePetMood("engaged");
    if (!chatWindow?.isVisible()) {
      updateUnreadReminderState(true);
    }
    if (Notification.isSupported()) {
      new Notification({
        title: "Momo 提醒你一个待办",
        body: item.dueAt ? `${item.title}\n时间：${item.dueAt}` : item.title,
        silent: true
      }).show();
    }
    chatWindow?.webContents.send("chat:todo-reminder", {
      content: `提醒一下，${item.title}${item.dueAt ? `（${item.dueAt}）` : ""}。`
    });
  }
}

function createBaseWindow(options: Electron.BrowserWindowConstructorOptions) {
  const window = new BrowserWindow({
    title: "",
    frame: false,
    autoHideMenuBar: true,
    roundedCorners: false,
    hasShadow: false,
    show: false,
    paintWhenInitiallyHidden: true,
    ...options,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      ...(options.webPreferences || {})
    }
  });
  window.setMenuBarVisibility(false);
  if ("setBackgroundMaterial" in window) {
    window.setBackgroundMaterial("none");
  }
  return window;
}

function buildRoundedRectShape(width: number, height: number, radius: number) {
  const clippedRadius = Math.max(0, Math.min(radius, Math.floor(Math.min(width, height) / 2)));
  const rects: Electron.Rectangle[] = [];
  for (let y = 0; y < height; y += 1) {
    const rowCenterY = y + 0.5;
    let left = 0;
    let right = width;
    if (rowCenterY < clippedRadius) {
      const dy = clippedRadius - rowCenterY;
      const dx = Math.sqrt(Math.max(0, clippedRadius * clippedRadius - dy * dy));
      left = Math.max(0, Math.floor(clippedRadius - dx));
      right = Math.min(width, Math.ceil(width - clippedRadius + dx));
    } else if (rowCenterY > height - clippedRadius) {
      const dy = rowCenterY - (height - clippedRadius);
      const dx = Math.sqrt(Math.max(0, clippedRadius * clippedRadius - dy * dy));
      left = Math.max(0, Math.floor(clippedRadius - dx));
      right = Math.min(width, Math.ceil(width - clippedRadius + dx));
    }
    rects.push({ x: left, y, width: Math.max(0, right - left), height: 1 });
  }
  return rects.filter((rect) => rect.width > 0);
}

function applyRoundedWindowShape(window: BrowserWindow | null, width: number, height: number) {
  if (!window || typeof window.setShape !== "function") {
    return;
  }
  window.setShape(buildRoundedRectShape(width, height, PANEL_WINDOW_RADIUS));
}

function createPetWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  petWindow = createBaseWindow({
    width: PET_WINDOW_SIZE,
    height: PET_WINDOW_SIZE,
    x: screenWidth - PET_WINDOW_SIZE - WINDOW_MARGIN,
    y: screenHeight - PET_WINDOW_SIZE - WINDOW_MARGIN,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    focusable: false,
    resizable: false,
    skipTaskbar: true
  });
  petWindow.loadURL(resolveRendererUrl("/"));
  petWindow.setAlwaysOnTop(true, "screen-saver");
  petWindow.setFocusable(false);
  petWindow.show();
}

function createChatWindow() {
  chatWindow = createBaseWindow({
    width: CHAT_WINDOW_WIDTH,
    height: CHAT_WINDOW_HEIGHT,
    transparent: false,
    backgroundColor: "#f7eee4",
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true
  });
  chatWindow.loadURL(resolveRendererUrl("/?view=chat"));
  chatWindow.setAlwaysOnTop(true, "screen-saver");
  applyRoundedWindowShape(chatWindow, CHAT_WINDOW_WIDTH, CHAT_WINDOW_HEIGHT);
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    return settingsWindow;
  }
  settingsWindow = createBaseWindow({
    width: SETTINGS_WINDOW_WIDTH,
    height: SETTINGS_WINDOW_HEIGHT,
    transparent: false,
    backgroundColor: "#f4eadf",
    resizable: false
  });
  settingsWindow.loadURL(resolveRendererUrl("/?view=settings"));
  applyRoundedWindowShape(settingsWindow, SETTINGS_WINDOW_WIDTH, SETTINGS_WINDOW_HEIGHT);
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
  return settingsWindow;
}

function createTodoWindow() {
  if (todoWindow && !todoWindow.isDestroyed()) {
    return todoWindow;
  }
  todoWindow = createBaseWindow({
    width: TODO_WINDOW_WIDTH,
    height: TODO_WINDOW_HEIGHT,
    transparent: false,
    backgroundColor: "#f4eadf",
    resizable: false
  });
  todoWindow.loadURL(resolveRendererUrl("/?view=todos"));
  applyRoundedWindowShape(todoWindow, TODO_WINDOW_WIDTH, TODO_WINDOW_HEIGHT);
  todoWindow.on("closed", () => {
    todoWindow = null;
  });
  return todoWindow;
}

function createContextMenuWindow() {
  if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
    return contextMenuWindow;
  }
  contextMenuWindow = createBaseWindow({
    width: MENU_WINDOW_WIDTH,
    height: MENU_WINDOW_HEIGHT,
    transparent: false,
    backgroundColor: "#f4eadf",
    alwaysOnTop: true,
    focusable: true,
    resizable: false
  });
  contextMenuWindow.loadURL(resolveRendererUrl("/?view=menu"));
  contextMenuWindow.setAlwaysOnTop(true, "pop-up-menu");
  applyRoundedWindowShape(contextMenuWindow, MENU_WINDOW_WIDTH, MENU_WINDOW_HEIGHT);
  contextMenuWindow.on("blur", () => {
    contextMenuWindow?.hide();
  });
  contextMenuWindow.on("closed", () => {
    contextMenuWindow = null;
  });
  return contextMenuWindow;
}

function positionWindowNearPet(targetWindow: BrowserWindow, width: number, height: number) {
  if (!petWindow) {
    return "left" as PetGlanceDirection;
  }
  const petBounds = petWindow.getBounds();
  const display = screen.getDisplayNearestPoint({ x: petBounds.x, y: petBounds.y });
  const area = display.workArea;

  let x = petBounds.x - width - CHAT_WINDOW_GAP;
  let direction: PetGlanceDirection = "left";
  if (x < area.x + WINDOW_MARGIN) {
    x = petBounds.x + petBounds.width + CHAT_WINDOW_GAP;
    direction = "right";
  }
  x = Math.min(Math.max(x, area.x + WINDOW_MARGIN), area.x + area.width - width - WINDOW_MARGIN);
  const y = Math.min(
    Math.max(petBounds.y + petBounds.height - height, area.y + WINDOW_MARGIN),
    area.y + area.height - height - WINDOW_MARGIN
  );
  targetWindow.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
  targetWindow.moveTop();
  return direction;
}

function positionChatWindowNearPet() {
  if (!chatWindow) {
    return "left" as PetGlanceDirection;
  }
  return positionWindowNearPet(chatWindow, CHAT_WINDOW_WIDTH, CHAT_WINDOW_HEIGHT);
}

function openSettingsWindow() {
  const window = createSettingsWindow();
  positionWindowNearPet(window, SETTINGS_WINDOW_WIDTH, SETTINGS_WINDOW_HEIGHT);
  window.show();
  window.focus();
}

function openTodoWindow() {
  const window = createTodoWindow();
  positionWindowNearPet(window, TODO_WINDOW_WIDTH, TODO_WINDOW_HEIGHT);
  window.show();
  window.focus();
}

function openContextMenuAt(screenX: number, screenY: number) {
  const menuWindow = createContextMenuWindow();
  const display = screen.getDisplayNearestPoint({ x: screenX, y: screenY });
  const area = display.workArea;
  const x = Math.min(Math.max(screenX, area.x + WINDOW_MARGIN), area.x + area.width - MENU_WINDOW_WIDTH - WINDOW_MARGIN);
  const y = Math.min(Math.max(screenY, area.y + WINDOW_MARGIN), area.y + area.height - MENU_WINDOW_HEIGHT - WINDOW_MARGIN);
  menuWindow.setBounds({ x, y, width: MENU_WINDOW_WIDTH, height: MENU_WINDOW_HEIGHT });
  menuWindow.moveTop();
  menuWindow.show();
  menuWindow.focus();
}

function movePetWindow(pointerX: number, pointerY: number) {
  if (!petWindow || !petDragSession) {
    return;
  }
  const deltaX = pointerX - petDragSession.pointerStartX;
  const deltaY = pointerY - petDragSession.pointerStartY;
  const display = screen.getDisplayNearestPoint({ x: pointerX, y: pointerY });
  const area = display.workArea;
  const nextX = Math.min(
    Math.max(petDragSession.windowStartX + deltaX, area.x),
    area.x + area.width - PET_WINDOW_SIZE
  );
  const nextY = Math.min(
    Math.max(petDragSession.windowStartY + deltaY, area.y),
    area.y + area.height - PET_WINDOW_SIZE
  );
  petWindow.setBounds({
    x: Math.round(nextX),
    y: Math.round(nextY),
    width: PET_WINDOW_SIZE,
    height: PET_WINDOW_SIZE
  });
}

function setPetPointerPassthrough(enabled: boolean) {
  if (!petWindow || petWindow.isDestroyed() || petPointerPassthroughEnabled === enabled) {
    return;
  }
  if (enabled) {
    petWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    petWindow.setIgnoreMouseEvents(false);
  }
  petPointerPassthroughEnabled = enabled;
}

function createTray() {
  const iconPath = path.join(app.getAppPath(), "assets", "trayTemplate.png");
  if (!fs.existsSync(iconPath)) {
    return;
  }
  tray = new Tray(iconPath);
  tray.setToolTip("AI Desktop Pet");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open Chat",
        click: () => {
          const direction = positionChatWindowNearPet();
          chatWindow?.show();
          chatWindow?.focus();
          notifyChatOpened();
          updatePetGlance(direction);
        }
      },
      { label: "Todo List", click: () => openTodoWindow() },
      { label: "Settings", click: () => openSettingsWindow() },
      { label: "Zhipu Homepage", click: () => void shell.openExternal("https://open.bigmodel.cn/") },
      { label: "Quit", click: () => app.quit() }
    ])
  );
}

function getLatestUserMessage(messages: ChatMessagePayload[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return messages[index].content.trim();
    }
  }
  return "";
}

function shouldAnswerWithLocalDateTime(input: string) {
  if (!input) {
    return false;
  }
  const normalized = input.toLowerCase().replace(/\s+/g, "");
  if (
    /^(几点|几点了|现在几点|现在时间|当前时间|今天几号|今天星期几|今天周几|几号|星期几|周几|日期)$/.test(
      normalized
    )
  ) {
    return true;
  }
  if (/^(whattimeisit|currenttime|whatdayisit|todaysdate|date|time)\??$/.test(normalized)) {
    return true;
  }
  return false;
}

function buildLocalDateTimeReply() {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(now);
  return `现在是 ${year}-${month}-${day} ${hours}:${minutes}:${seconds}，${weekday}（本机时区：${timezone}）。`;
}

function extractFirstUrl(input: string) {
  const match = input.match(/((https?:\/\/|www\.)[^\s<>"'`]+)/i);
  if (!match?.[1]) {
    return null;
  }
  return match[1].replace(/[),.;!?]+$/, "");
}

function normalizeHttpUrl(input: string) {
  const raw = input.trim();
  if (!raw) {
    return null;
  }
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function shouldOpenUrlInBrowser(input: string) {
  return /(https?:\/\/|www\.)/i.test(input) && /(打开|访问|前往|浏览器|open|visit|browse)/i.test(input);
}

function shouldReadWebPageContent(input: string) {
  return (
    /(https?:\/\/|www\.)/i.test(input) &&
    /(读取|抓取|提取|总结|概括|分析|网页内容|read|summarize|analy[sz]e|extract)/i.test(input)
  );
}

async function fetchWebPagePlainText(url: string) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
  };
  let response: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers,
        signal: AbortSignal.timeout(12000)
      });
      break;
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
  }

  if (!response) {
    const error = lastError as (Error & { cause?: { code?: string } }) | null;
    const code = error?.cause?.code;
    const reason =
      code === "ENOTFOUND"
        ? "域名无法解析（DNS）"
        : code === "ECONNRESET"
          ? "连接被重置"
          : code === "ETIMEDOUT" || error?.name === "TimeoutError"
            ? "连接超时"
            : code === "CERT_HAS_EXPIRED" || code === "SELF_SIGNED_CERT_IN_CHAIN"
              ? "证书校验失败"
              : error?.message || "网络不可用";
    throw new Error(`网络请求失败：${reason}`);
  }

  if (!response.ok) {
    throw new Error(`网页请求失败，状态码 ${response.status}`);
  }

  const html = await response.text();
  const text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gis, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gis, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 12000);
}

async function requestZhipuChatCompletion(messages: ChatMessagePayload[]) {
  const latestUserInput = getLatestUserMessage(messages);
  if (shouldAnswerWithLocalDateTime(latestUserInput)) {
    return buildLocalDateTimeReply();
  }

  const urlCandidate = extractFirstUrl(latestUserInput);
  const normalizedUrl = urlCandidate ? normalizeHttpUrl(urlCandidate) : null;
  let webPageContext = "";

  if (normalizedUrl && shouldOpenUrlInBrowser(latestUserInput)) {
    await shell.openExternal(normalizedUrl);
    return `我已经在默认浏览器帮你打开网页：${normalizedUrl}`;
  }

  if (normalizedUrl && shouldReadWebPageContent(latestUserInput)) {
    const pageText = await fetchWebPagePlainText(normalizedUrl);
    if (!pageText) {
      return `我访问了 ${normalizedUrl}，但没有提取到可读正文。`;
    }
    webPageContext = `以下是网页内容（来源：${normalizedUrl}）：\n${pageText}\n\n请基于该内容回答用户。`;
  }

  const apiKey = process.env.ZHIPU_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("缺少 ZHIPU_API_KEY，请先在 .env 文件里配置。");
  }

  const requestMessages = [...messages];
  const todoContext = collectTodoContext();
  const transcriptContext = collectRecentTranscriptContext();
  if (todoContext) {
    requestMessages.splice(1, 0, { role: "system", content: todoContext });
  }
  if (transcriptContext) {
    requestMessages.splice(1, 0, { role: "system", content: transcriptContext });
  }
  if (webPageContext) {
    requestMessages.splice(1, 0, { role: "system", content: webPageContext });
  }

  const requestUrl = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
  const requestHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`
  };
  const basePayload = {
    model: DEFAULT_ZHIPU_MODEL,
    messages: requestMessages,
    temperature: 0.7
  };
  const payloadWithWebSearch = {
    ...basePayload,
    tools: [{ type: "web_search" }],
    tool_choice: "auto"
  };

  let response = await fetch(requestUrl, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(webSearchEnabled ? payloadWithWebSearch : basePayload)
  });

  if (!response.ok && webSearchEnabled && [400, 404, 422].includes(response.status)) {
    const fallbackResponse = await fetch(requestUrl, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(basePayload)
    });
    if (fallbackResponse.ok) {
      response = fallbackResponse;
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `智谱接口请求失败，状态码 ${response.status}。`);
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        role?: ChatRole;
        content?: string;
      };
    }>;
  };

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("智谱接口返回了空内容。");
  }
  return content;
}

async function extractTodoDraftFromMessage(input: string) {
  const apiKey = process.env.ZHIPU_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const today = new Date().toLocaleString("zh-CN");
  const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: DEFAULT_ZHIPU_MODEL,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "你是待办提取器。请从用户消息中提取待办并输出严格 JSON，不要 markdown。JSON: " +
            '{"shouldCreate":boolean,"title":string,"dueAt":"YYYY-MM-DD HH:mm"|"","remindMinutesBefore":number|null}。' +
            " 若用户并非在添加待办，则 shouldCreate=false。今天时间：" +
            today
        },
        { role: "user", content: input }
      ]
    })
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as {
      shouldCreate?: boolean;
      title?: string;
      dueAt?: string;
      remindMinutesBefore?: number | null;
    };
    if (!parsed.shouldCreate || !parsed.title?.trim()) {
      return null;
    }
    return {
      title: parsed.title.trim(),
      dueAt: parsed.dueAt?.trim() || undefined,
      remindMinutesBefore:
        typeof parsed.remindMinutesBefore === "number" ? parsed.remindMinutesBefore : undefined
    } satisfies TodoDraft;
  } catch {
    return null;
  }
}

app.whenReady().then(() => {
  writeSettings(readSettings());
  ensureTodoFile();
  createPetWindow();
  createChatWindow();
  createTray();
  maybePushTodoReminder();
  reminderTimer = setInterval(maybePushTodoReminder, 30 * 1000);

  ipcMain.handle("pet:drag-start", (_event, payload: { pointerX: number; pointerY: number }) => {
    if (!petWindow) {
      return;
    }
    setPetPointerPassthrough(false);
    contextMenuWindow?.hide();
    if (chatWindow?.isVisible()) {
      chatWindow.hide();
    }
    const bounds = petWindow.getBounds();
    petDragSession = {
      pointerStartX: payload.pointerX,
      pointerStartY: payload.pointerY,
      windowStartX: bounds.x,
      windowStartY: bounds.y
    };
  });

  ipcMain.handle("pet:drag-move", (_event, payload: { pointerX: number; pointerY: number }) => {
    movePetWindow(payload.pointerX, payload.pointerY);
  });

  ipcMain.handle("pet:drag-end", () => {
    petDragSession = null;
  });

  ipcMain.handle("pet:toggle-chat", () => {
    if (!chatWindow) {
      return;
    }
    contextMenuWindow?.hide();
    if (chatWindow.isVisible()) {
      chatWindow.hide();
      return;
    }
    const direction = positionChatWindowNearPet();
    chatWindow.show();
    chatWindow.focus();
    notifyChatOpened();
    updatePetGlance(direction);
    if (hasUnreadReminder) {
      updateUnreadReminderState(false);
    }
    const summary = getTodoReminderSummary();
    if (summary) {
      chatWindow.webContents.send("chat:todo-reminder", { content: summary });
    }
  });

  ipcMain.handle("pet:open-menu", (_event, payload: { screenX: number; screenY: number }) => {
    openContextMenuAt(payload.screenX, payload.screenY);
  });

  ipcMain.handle("pet:set-pointer-passthrough", (_event, payload: { enabled: boolean }) => {
    setPetPointerPassthrough(Boolean(payload.enabled));
  });

  ipcMain.handle("pet:get-cursor-screen-point", () => {
    return screen.getCursorScreenPoint();
  });

  ipcMain.handle("chat:get-keep-visible-on-blur", () => keepChatVisibleOnBlur);
  ipcMain.handle("chat:set-keep-visible-on-blur", (_event, payload: { enabled: boolean }) => {
    keepChatVisibleOnBlur = Boolean(payload.enabled);
    return keepChatVisibleOnBlur;
  });

  ipcMain.handle("chat:send-message", async (_event, payload: { messages: ChatMessagePayload[] }) => {
    return requestZhipuChatCompletion(payload.messages);
  });

  ipcMain.handle("chat:add-todo-from-message", async (_event, payload: { content: string }) => {
    const draft = await extractTodoDraftFromMessage(payload.content);
    if (!draft) {
      return null;
    }
    remindedTodoIds.clear();
    const result = appendTodoItem(draft);
    updatePetMood("happy");
    return {
      item: result.item,
      confirmation: `已经帮你记下这条待办：${result.item.title}${result.item.dueAt ? `，时间是 ${result.item.dueAt}` : ""}${result.item.remindMinutesBefore ? `，会提前 ${result.item.remindMinutesBefore} 分钟提醒你。` : "。"}`
    };
  });

  ipcMain.handle("chat:save-conversation", (_event, payload: { messages: TranscriptMessage[] }) => {
    return saveConversationToMarkdown(payload.messages);
  });

  ipcMain.handle("todo:get", () => {
    return { items: readTodos(), path: getTodoFilePath() };
  });
  ipcMain.handle("todo:save", (_event, payload: { items: TodoItem[] }) => {
    remindedTodoIds.clear();
    return writeTodos(payload.items);
  });
  ipcMain.handle("todo:open", () => {
    contextMenuWindow?.hide();
    openTodoWindow();
  });
  ipcMain.handle("todo:close", () => {
    todoWindow?.hide();
  });

  ipcMain.handle("settings:get", () => {
    return { ...readSettings(), todoFilePath: getTodoFilePath() };
  });
  ipcMain.handle("settings:update", (_event, payload: Partial<AppSettings>) => {
    const current = readSettings();
    const transcriptDirectory = payload.transcriptDirectory?.trim() || current.transcriptDirectory;
    remindedTodoIds.clear();
    return { ...writeSettings({ transcriptDirectory }), todoFilePath: getTodoFilePath() };
  });
  ipcMain.handle("settings:pick-transcript-directory", async () => {
    const pickerTarget = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : petWindow;
    const dialogOptions = {
      title: "选择对话记录目录",
      properties: ["openDirectory", "createDirectory", "promptToCreate"] as Electron.OpenDialogOptions["properties"]
    };
    const result = pickerTarget
      ? await dialog.showOpenDialog(pickerTarget, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return result.filePaths[0];
  });
  ipcMain.handle("settings:open", () => {
    contextMenuWindow?.hide();
    openSettingsWindow();
  });
  ipcMain.handle("settings:close", () => {
    settingsWindow?.hide();
  });
  ipcMain.handle("menu:close", () => {
    contextMenuWindow?.hide();
  });
  ipcMain.handle("pet:set-mood", (_event, payload: { mood: PetMood }) => {
    updatePetMood(payload.mood);
  });
});

app.on("before-quit", () => {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
});

app.on("browser-window-focus", (_event, window) => {
  if (contextMenuWindow && window !== contextMenuWindow && contextMenuWindow.isVisible()) {
    contextMenuWindow.hide();
  }
});

app.on("browser-window-blur", (_event, window) => {
  if (contextMenuWindow && window === contextMenuWindow) {
    return;
  }
  if (chatWindow && window === chatWindow && chatWindow.isVisible() && !keepChatVisibleOnBlur) {
    chatWindow.hide();
  }
  if (contextMenuWindow?.isVisible()) {
    contextMenuWindow.hide();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (!petWindow || petWindow.isDestroyed()) {
    createPetWindow();
  }
  if (!chatWindow || chatWindow.isDestroyed()) {
    createChatWindow();
  }
});
