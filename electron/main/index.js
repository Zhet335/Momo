"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const dotenv_1 = require("dotenv");
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
electron_1.app.disableHardwareAcceleration();
(0, dotenv_1.config)({ path: node_path_1.default.join(process.cwd(), ".env") });
let petWindow = null;
let chatWindow = null;
let settingsWindow = null;
let todoWindow = null;
let contextMenuWindow = null;
let tray = null;
let keepChatVisibleOnBlur = false;
let hasUnreadReminder = false;
let petPointerPassthroughEnabled = false;
let reminderTimer = null;
const remindedTodoIds = new Set();
let petDragSession = null;
const isDev = !electron_1.app.isPackaged;
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
const DEFAULT_ZHIPU_OCR_MODEL = process.env.ZHIPU_OCR_MODEL?.trim() || "glm-4v-flash";
const ENABLE_WEB_SEARCH_BY_DEFAULT = process.env.MOMO_ENABLE_WEB_SEARCH?.trim() !== "0";
let webSearchEnabled = ENABLE_WEB_SEARCH_BY_DEFAULT;
const MAX_ATTACHMENT_TEXT_LENGTH = 7000;
const MAX_ATTACHMENT_FILE_BYTES = 20 * 1024 * 1024;
const MAX_OCR_IMAGE_EDGE = 2200;
const MAX_OCR_IMAGE_BYTES = 6 * 1024 * 1024;
const SETTINGS_FILE_NAME = "settings.json";
const TODO_FILE_NAME = "Momo TODO.md";
function resolveRendererUrl(route) {
    if (isDev) {
        return `http://localhost:5173${route}`;
    }
    const indexPath = node_path_1.default.join(electron_1.app.getAppPath(), "dist", "index.html");
    return `file://${indexPath}${route}`;
}
function getDefaultTranscriptDirectory() {
    return node_path_1.default.join(electron_1.app.getPath("documents"), "Momo Dialogues");
}
function getSettingsFilePath() {
    return node_path_1.default.join(electron_1.app.getPath("userData"), SETTINGS_FILE_NAME);
}
function ensureDirectory(directoryPath) {
    node_fs_1.default.mkdirSync(directoryPath, { recursive: true });
}
function readSettings() {
    const settingsPath = getSettingsFilePath();
    const fallback = { transcriptDirectory: getDefaultTranscriptDirectory() };
    if (!node_fs_1.default.existsSync(settingsPath)) {
        ensureDirectory(fallback.transcriptDirectory);
        node_fs_1.default.writeFileSync(settingsPath, JSON.stringify(fallback, null, 2), "utf8");
        return fallback;
    }
    try {
        const parsed = JSON.parse(node_fs_1.default.readFileSync(settingsPath, "utf8"));
        const transcriptDirectory = parsed.transcriptDirectory?.trim() || fallback.transcriptDirectory;
        ensureDirectory(transcriptDirectory);
        return { transcriptDirectory };
    }
    catch {
        ensureDirectory(fallback.transcriptDirectory);
        return fallback;
    }
}
function writeSettings(nextSettings) {
    ensureDirectory(node_path_1.default.dirname(getSettingsFilePath()));
    ensureDirectory(nextSettings.transcriptDirectory);
    node_fs_1.default.writeFileSync(getSettingsFilePath(), JSON.stringify(nextSettings, null, 2), "utf8");
    return nextSettings;
}
function getTodoFilePath() {
    const settings = readSettings();
    ensureDirectory(settings.transcriptDirectory);
    return node_path_1.default.join(settings.transcriptDirectory, TODO_FILE_NAME);
}
function sanitizeFileName(input) {
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
function buildTranscriptMarkdown(messages) {
    const lines = ["# Momo 瀵硅瘽璁板綍", "", `淇濆瓨鏃堕棿锛?{new Date().toLocaleString("zh-CN")}`, ""];
    for (const message of messages) {
        const heading = message.role === "user" ? "鐢ㄦ埛" : "Momo";
        lines.push(`## ${heading}`);
        lines.push("");
        lines.push(message.content.trim() || "锛堢┖娑堟伅锛?);, lines.push(", ")););
    }
    return `${lines.join("\n").trim()}\n`;
}
function saveConversationToMarkdown(messages) {
    const settings = readSettings();
    const firstUserLine = messages.find((message) => message.role === "user")?.content.split(/\r?\n/)[0] || "瀵硅瘽璁板綍";
    const fileName = `${timestampForFileName()}-${sanitizeFileName(firstUserLine).slice(0, 24) || "Momo"}.md`;
    const outputPath = node_path_1.default.join(settings.transcriptDirectory, fileName);
    node_fs_1.default.writeFileSync(outputPath, buildTranscriptMarkdown(messages), "utf8");
    return { path: outputPath };
}
function parseTodoLine(line) {
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
function serializeTodoItem(item) {
    const duePart = item.dueAt ? ` | due: ${item.dueAt}` : "";
    const remindPart = item.remindMinutesBefore ? ` | remind: ${item.remindMinutesBefore}` : "";
    return `- [${item.done ? "x" : " "}] ${item.title}${duePart}${remindPart}`;
}
function ensureTodoFile() {
    const todoFilePath = getTodoFilePath();
    if (!node_fs_1.default.existsSync(todoFilePath)) {
        node_fs_1.default.writeFileSync(todoFilePath, "# Momo 寰呭姙娓呭崟\n\n> 鏍煎紡锛? [ ] 鏍囬 | due: YYYY-MM-DD HH:mm | remind: 鎻愬墠鍒嗛挓\n\n", "utf8");
    }
    return todoFilePath;
}
function readTodos() {
    const todoFilePath = ensureTodoFile();
    const content = node_fs_1.default.readFileSync(todoFilePath, "utf8");
    return content
        .split(/\r?\n/)
        .map((line) => parseTodoLine(line))
        .filter((item) => item !== null);
}
function writeTodos(items) {
    const todoFilePath = ensureTodoFile();
    const lines = [
        "# Momo 寰呭姙娓呭崟",
        "",
        "> 鏍煎紡锛? [ ] 鏍囬 | due: YYYY-MM-DD HH:mm | remind: 鎻愬墠鍒嗛挓",
        ""
    ];
    if (!items.length) {
        lines.push("- [ ] 鏂板緟鍔炵ず渚?| due: 2026-01-01 09:00 | remind: 30");
    }
    else {
        lines.push(...items.map((item) => serializeTodoItem(item)));
    }
    node_fs_1.default.writeFileSync(todoFilePath, `${lines.join("\n")}\n`, "utf8");
    return { path: todoFilePath, items };
}
function appendTodoItem(draft) {
    const nextItem = {
        id: sanitizeFileName(`${draft.title}-${draft.dueAt || "no-due"}-${draft.remindMinutesBefore || 0}-${Date.now()}`).toLowerCase(),
        title: draft.title.trim(),
        dueAt: draft.dueAt?.trim(),
        remindMinutesBefore: draft.remindMinutesBefore,
        done: false
    };
    const result = writeTodos([...readTodos(), nextItem]);
    return { ...result, item: nextItem };
}
function getTodoDueTime(item) {
    if (!item.dueAt) {
        return null;
    }
    const timestamp = new Date(item.dueAt.replace(" ", "T")).getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
}
function isTodoExpired(item) {
    const dueTime = getTodoDueTime(item);
    return dueTime !== null && dueTime < Date.now();
}
function collectRecentTranscriptContext() {
    const settings = readSettings();
    if (!node_fs_1.default.existsSync(settings.transcriptDirectory)) {
        return "";
    }
    const files = node_fs_1.default
        .readdirSync(settings.transcriptDirectory)
        .filter((fileName) => fileName.toLowerCase().endsWith(".md") && fileName !== TODO_FILE_NAME)
        .map((fileName) => {
        const fullPath = node_path_1.default.join(settings.transcriptDirectory, fileName);
        return { fileName, fullPath, modifiedAt: node_fs_1.default.statSync(fullPath).mtimeMs };
    })
        .sort((left, right) => right.modifiedAt - left.modifiedAt)
        .slice(0, 3);
    const snippets = files
        .map((file) => {
        const content = node_fs_1.default.readFileSync(file.fullPath, "utf8").replace(/\s+/g, " ").trim();
        return content ? `鏂囦欢锛?{file.fileName}\n${content.slice(0, 900)}` : "";
    })
        .filter(Boolean);
    if (!snippets.length) {
        return "";
    }
    return ["浠ヤ笅鏄渶杩戝璇濇憳瑕侊紝鑻ョ浉鍏宠鍙傝€冦€?, ", ", ...snippets].join(", n, ");];];
}
function collectTodoContext() {
    const todoItems = readTodos().filter((item) => !item.done && !isTodoExpired(item));
    if (!todoItems.length) {
        return "";
    }
    const lines = todoItems.map((item) => {
        const duePart = item.dueAt ? `锛屾埅姝㈡椂闂?${item.dueAt}` : "";
        const remindPart = item.remindMinutesBefore ? `锛屾彁鍓?${item.remindMinutesBefore} 鍒嗛挓鎻愰啋` : "";
        return `- ${item.title}${duePart}${remindPart}`;
    });
    return ["浠ヤ笅鏄綋鍓嶅緟鍔烇紝璇峰湪鐩稿叧闂涓弬鑰冦€?, ", ", ...lines].join(", n, ");];];
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
        .map((item) => `- ${item.title}${item.dueAt ? `锛?{item.dueAt}锛塦 : ""}` : )
        .join("\n");
}
function updatePetMood(mood) {
    petWindow?.webContents.send("pet:mood-changed", mood);
}
function updatePetGlance(direction) {
    petWindow?.webContents.send("pet:glance", direction);
}
function updateUnreadReminderState(hasUnread) {
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
        if (electron_1.Notification.isSupported()) {
            new electron_1.Notification({
                title: "Momo 鎻愰啋浣犱竴涓緟鍔?,,,
                body: item.dueAt ? `${item.title}\n鏃堕棿锛?{item.dueAt}` : item.title,
                silent: true
            }).show();
        }
        chatWindow?.webContents.send("chat:todo-reminder", {
            content: `鎻愰啋涓€涓嬶紝${item.title}${item.dueAt ? `锛?{item.dueAt}锛塦 : ""}銆俙
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
    /^(鍑犵偣|鍑犵偣浜唡鐜板湪鍑犵偣|鐜板湪鏃堕棿|褰撳墠鏃堕棿|浠婂ぉ鍑犲彿|浠婂ぉ鏄熸湡鍑爘浠婂ぉ鍛ㄥ嚑|鍑犲彿|鏄熸湡鍑爘鍛ㄥ嚑|鏃ユ湡)$/.test(
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
  return ` : , 鐜板湪鏄, $}, { year } - $, { month } - $, { day }, $, { hours }, $, { minutes }, $, { seconds }, 锛 ? { weekday } : , 锛堟湰鏈烘椂鍖猴細$, { timezone }, 锛夈, 俙);
    }
    function extractFirstUrl(input) {
        const match = input.match(/((https?:\/\/|www\.)[^\s<>"'`
        } + ) / i;
        ;
        if (!match?.[1]) {
            return null;
        }
        return match[1].replace(/[),.;!?]+$/, "");
    }
    function normalizeHttpUrl(input) {
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
        }
        catch {
            return null;
        }
    }
    function shouldOpenUrlInBrowser(input) {
        return /(https?:\/\/|www\.)/i.test(input) && /(鎵撳紑|璁块棶|鍓嶅線|娴忚鍣▅open|visit|browse)/i.test(input);
    }
    function shouldReadWebPageContent(input) {
        return (/(https?:\/\/|www\.)/i.test(input) &&
            /(璇诲彇|鎶撳彇|鎻愬彇|鎬荤粨|姒傛嫭|鍒嗘瀽|缃戦〉鍐呭|read|summarize|analy[sz]e|extract)/i.test(input));
    }
    function shouldRunScreenOcr(input) {
        const normalized = input.toLowerCase();
        const isAttachmentContext = normalized.includes("[闄勪欢]") ||
            normalized.includes("浠ヤ笅鏄垜鐨勯檮浠跺唴瀹?) ||, normalized.includes("[attachment], ") ||, normalized.includes("attachment content"));
        if (isAttachmentContext) {
            return false;
        }
        return /(璇嗗埆.*灞忓箷|璇诲彇.*灞忓箷|灞忓箷.*鏂囧瓧|灞忓箷涓?*浠€涔坾screen.*ocr|read.*screen|screenshot.*ocr)/i.test(input);
    }
    function runPowerShell(command) {
        const encodedCommand = Buffer.from(command, "utf16le").toString("base64");
        return (0, node_child_process_1.execFileSync)("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCommand], {
            encoding: "utf8",
            maxBuffer: 30 * 1024 * 1024
        }).trim();
    }
    function capturePrimaryScreenAsBase64Png() {
        const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$bytes = $ms.ToArray()
$base64 = [Convert]::ToBase64String($bytes)
$gfx.Dispose()
$bmp.Dispose()
$ms.Dispose()
Write-Output $base64
`;
        return runPowerShell(script);
    }
    async function runScreenOcr() {
        const apiKey = process.env.ZHIPU_API_KEY?.trim();
        if (!apiKey) {
            throw new Error("Missing ZHIPU_API_KEY. Please set it in your .env file.");
        }
        const screenshotBase64 = capturePrimaryScreenAsBase64Png();
        if (!screenshotBase64) {
            throw new Error("Screen capture failed. No image data was produced.");
        }
        const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: DEFAULT_ZHIPU_OCR_MODEL,
                temperature: 0.1,
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "Perform OCR on this screenshot and extract readable text. Preserve structure and line breaks when possible."
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:image/png;base64,${screenshotBase64}`
                                }
                            }
                        ]
                    }
                ]
            })
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `OCR request failed with status ${response.status}.`);
        }
        const data = (await response.json());
        const content = normalizeOcrText(data.choices?.[0]?.message?.content?.trim() || "");
        if (!content) {
            throw new Error("OCR returned empty or invalid text.");
        }
        return content;
    }
    function normalizeOcrText(rawText) {
        const text = rawText.replace(/\u0000/g, "").trim();
        if (!text) {
            return "";
        }
        const compact = text.replace(/\s+/g, "");
        if (compact.length > 120 && /(.{8,40})\1{5,}/u.test(compact)) {
            return "";
        }
        return text;
    }
    function getAttachmentExtension(filePath) {
        return node_path_1.default.extname(filePath).toLowerCase();
    }
    function detectAttachmentKind(filePath) {
        const ext = getAttachmentExtension(filePath);
        if ([".png", ".jpg", ".jpeg", ".bmp", ".webp", ".gif", ".tif", ".tiff"].includes(ext)) {
            return "image";
        }
        if (ext === ".pdf") {
            return "pdf";
        }
        if (ext === ".docx") {
            return "docx";
        }
        if ([".txt", ".md", ".markdown", ".json", ".csv", ".log"].includes(ext)) {
            return "text";
        }
        return "unknown";
    }
    async function runImageOcrFromFile(filePath) {
        const apiKey = process.env.ZHIPU_API_KEY?.trim();
        if (!apiKey) {
            throw new Error("Missing ZHIPU_API_KEY. Please set it in your .env file.");
        }
        const image = electron_1.nativeImage.createFromPath(filePath);
        if (image.isEmpty()) {
            throw new Error("Cannot read image file. Please check that the file is valid.");
        }
        const originalSize = image.getSize();
        let processedImage = image;
        const maxEdge = Math.max(originalSize.width, originalSize.height);
        if (maxEdge > MAX_OCR_IMAGE_EDGE) {
            const scale = MAX_OCR_IMAGE_EDGE / maxEdge;
            processedImage = image.resize({
                width: Math.max(1, Math.round(originalSize.width * scale)),
                height: Math.max(1, Math.round(originalSize.height * scale)),
                quality: "good"
            });
        }
        let pngBuffer = processedImage.toPNG();
        if (!pngBuffer.length) {
            throw new Error("Image preprocessing failed.");
        }
        if (pngBuffer.byteLength > MAX_OCR_IMAGE_BYTES) {
            const resized = processedImage.resize({
                width: Math.max(1, Math.round(processedImage.getSize().width * 0.75)),
                height: Math.max(1, Math.round(processedImage.getSize().height * 0.75)),
                quality: "good"
            });
            pngBuffer = resized.toPNG();
        }
        const base64 = pngBuffer.toString("base64");
        const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: DEFAULT_ZHIPU_OCR_MODEL,
                temperature: 0.1,
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "Perform OCR on this image and extract readable text only. Keep the original order and line breaks when possible."
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:image/png;base64,${base64}`
                                }
                            }
                        ]
                    }
                ]
            })
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `Image OCR request failed with status ${response.status}.`);
        }
        const data = (await response.json());
        return normalizeOcrText(data.choices?.[0]?.message?.content?.trim() || "");
    }
    function trimAttachmentText(text) {
        const normalized = text.replace(/\r\n/g, "\n").trim();
        if (!normalized) {
            return "";
        }
        if (normalized.length <= MAX_ATTACHMENT_TEXT_LENGTH) {
            return normalized;
        }
        return `${normalized.slice(0, MAX_ATTACHMENT_TEXT_LENGTH)}\n\n[...content truncated due to length...]`;
    }
    async function parseAttachment(filePath) {
        const stat = node_fs_1.default.statSync(filePath);
        if (!stat.isFile()) {
            throw new Error("Invalid file path.");
        }
        if (stat.size > MAX_ATTACHMENT_FILE_BYTES) {
            throw new Error("File is too large. Max supported size per file is 20MB.");
        }
        const kind = detectAttachmentKind(filePath);
        const ext = getAttachmentExtension(filePath);
        const name = node_path_1.default.basename(filePath);
        if (kind === "image") {
            const ocrText = await runImageOcrFromFile(filePath);
            return {
                path: filePath,
                name,
                ext,
                kind,
                text: trimAttachmentText(ocrText || "[No readable text detected in image]")
            };
        }
        if (kind === "pdf") {
            const pdfBuffer = node_fs_1.default.readFileSync(filePath);
            const parsed = await pdfParse(pdfBuffer);
            return {
                path: filePath,
                name,
                ext,
                kind,
                text: trimAttachmentText(parsed.text || "[No readable text extracted from PDF]")
            };
        }
        if (kind === "docx") {
            const docxBuffer = node_fs_1.default.readFileSync(filePath);
            const parsed = await mammoth.extractRawText({ buffer: docxBuffer });
            return {
                path: filePath,
                name,
                ext,
                kind,
                text: trimAttachmentText(parsed.value || "[No readable text extracted from DOCX]")
            };
        }
        if (kind === "text") {
            return {
                path: filePath,
                name,
                ext,
                kind,
                text: trimAttachmentText(node_fs_1.default.readFileSync(filePath, "utf8"))
            };
        }
        throw new Error("Unsupported file type.");
    }
    async function parseAttachments(filePaths) {
        const normalized = Array.from(new Set(filePaths.map((filePath) => node_path_1.default.resolve(filePath))));
        const parsedList = [];
        const failedList = [];
        for (const filePath of normalized) {
            try {
                parsedList.push(await parseAttachment(filePath));
            }
            catch (error) {
                failedList.push({
                    path: filePath,
                    name: node_path_1.default.basename(filePath),
                    reason: error instanceof Error ? error.message : "鐟欙絾鐎芥径杈Е"
                });
            }
        }
        return {
            parsed: parsedList,
            failed: failedList
        };
    }
    async function fetchWebPagePlainText(url) {
        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
        };
        let response = null;
        let lastError = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                response = await fetch(url, {
                    method: "GET",
                    redirect: "follow",
                    headers,
                    signal: AbortSignal.timeout(12000)
                });
                break;
            }
            catch (error) {
                lastError = error;
                if (attempt === 0) {
                    await new Promise((resolve) => setTimeout(resolve, 350));
                }
            }
        }
        if (!response) {
            const error = lastError;
            const code = error?.cause?.code;
            const reason = code === "ENOTFOUND"
                ? "鍩熷悕鏃犳硶瑙ｆ瀽锛圖NS锛?
                : code === "ECONNRESET"
                    ? "杩炴帴琚噸缃?
                    : code === "ETIMEDOUT" || error?.name === "TimeoutError"
                        ? "杩炴帴瓒呮椂"
                        : code === "CERT_HAS_EXPIRED" || code === "SELF_SIGNED_CERT_IN_CHAIN"
                            ? "璇佷功鏍￠獙澶辫触"
                            : error?.message || "缃戠粶涓嶅彲鐢?;;;
            throw new Error(`缃戠粶璇锋眰澶辫触锛?{reason}`);
        }
        if (!response.ok) {
            throw new Error(`缃戦〉璇锋眰澶辫触锛岀姸鎬佺爜 ${response.status}`);
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
    async function requestZhipuChatCompletion(messages) {
        const latestUserInput = getLatestUserMessage(messages);
        if (shouldAnswerWithLocalDateTime(latestUserInput)) {
            return buildLocalDateTimeReply();
        }
        if (shouldRunScreenOcr(latestUserInput)) {
            const ocrText = await runScreenOcr();
            return `鎴戝垰璇嗗埆浜嗗綋鍓嶅睆骞曟枃瀛楋細\n\n${ocrText}`;
        }
        const urlCandidate = extractFirstUrl(latestUserInput);
        const normalizedUrl = urlCandidate ? normalizeHttpUrl(urlCandidate) : null;
        let webPageContext = "";
        if (normalizedUrl && shouldOpenUrlInBrowser(latestUserInput)) {
            await electron_1.shell.openExternal(normalizedUrl);
            return `鎴戝凡缁忓湪榛樿娴忚鍣ㄥ府浣犳墦寮€缃戦〉锛?{normalizedUrl}`;
        }
        if (normalizedUrl && shouldReadWebPageContent(latestUserInput)) {
            const pageText = await fetchWebPagePlainText(normalizedUrl);
            if (!pageText) {
                return `鎴戣闂簡 ${normalizedUrl}锛屼絾娌℃湁鎻愬彇鍒板彲璇绘鏂囥€俙;
    }
    webPageContext = `;
                浠ヤ笅鏄;
                綉椤靛唴瀹癸紙鏉ユ簮锛 ? { normalizedUrl } : ;
                锛夛細;
                n$;
                {
                    pageText;
                }
                n;
                n璇峰熀浜庤;
                鍐呭;
                鍥炵瓟鐢ㄦ埛銆俙;
            }
            const apiKey = process.env.ZHIPU_API_KEY?.trim();
            if (!apiKey) {
                throw new Error("缂哄皯 ZHIPU_API_KEY锛岃鍏堝湪 .env 鏂囦欢閲岄厤缃€?);););
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
                throw new Error(errorText || `鏅鸿氨鎺ュ彛璇锋眰澶辫触锛岀姸鎬佺爜 ${response.status}銆俙);
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
    throw new Error("鏅鸿氨鎺ュ彛杩斿洖浜嗙┖鍐呭銆?);
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
      Authorization: `, Bearer, $, { apiKey } `
    },
    body: JSON.stringify({
      model: DEFAULT_ZHIPU_MODEL,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "浣犳槸寰呭姙鎻愬彇鍣ㄣ€傝浠庣敤鎴锋秷鎭腑鎻愬彇寰呭姙骞惰緭鍑轰弗鏍?JSON锛屼笉瑕?markdown銆侸SON: " +
            '{"shouldCreate":boolean,"title":string,"dueAt":"YYYY-MM-DD HH:mm"|"","remindMinutesBefore":number|null}銆? +
            " 鑻ョ敤鎴峰苟闈炲湪娣诲姞寰呭姙锛屽垯 shouldCreate=false銆備粖澶╂椂闂达細" +
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
  ipcMain.handle("screen:ocr-text", async () => {
    return runScreenOcr();
  });
  ipcMain.handle("chat:pick-attachments", async () => {
    const pickerTarget = chatWindow && !chatWindow.isDestroyed() ? chatWindow : petWindow;
    const dialogOptions: Electron.OpenDialogOptions = {
      title: "闁瀚ㄩ梽鍕",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "閺€顖涘瘮閻ㄥ嫰妾禒?", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "pdf", "docx", "txt", "md"] },
        { name: "閸ュ墽澧?, extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] },
        { name: "PDF", extensions: ["pdf"] },
        { name: "Word DOCX", extensions: ["docx"] },
        { name: "閺傚洦婀?, extensions: ["txt", "md"] },
        { name: "閹碘偓閺堝鏋冩禒?", extensions: ["*"] }
      ]
    };
    const result = pickerTarget
      ? await dialog.showOpenDialog(pickerTarget, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled) {
      return [];
    }
    return result.filePaths;
  });
  ipcMain.handle("chat:parse-attachments", async (_event, payload: { filePaths: string[] }) => {
    const files = Array.isArray(payload.filePaths) ? payload.filePaths : [];
    if (!files.length) {
      return { parsed: [], failed: [] };
    }
    return parseAttachments(files);
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
      confirmation: `, 宸茬粡甯, 綘璁颁笅杩欐潯寰呭姙锛 ? { result, : .item.title } : , $, { result, : .item.dueAt ? `锛屾椂闂存槸 ${result.item.dueAt}` : "" }, $, { result, : .item.remindMinutesBefore ? `锛屼細鎻愬墠 ${result.item.remindMinutesBefore} 鍒嗛挓鎻愰啋浣犮€俙 : "銆?}`
                        :
                });
            }
            ;
            electron_1.ipcMain.handle("chat:save-conversation", (_event, payload) => {
                return saveConversationToMarkdown(payload.messages);
            });
            electron_1.ipcMain.handle("todo:get", () => {
                return { items: readTodos(), path: getTodoFilePath() };
            });
            electron_1.ipcMain.handle("todo:save", (_event, payload) => {
                remindedTodoIds.clear();
                return writeTodos(payload.items);
            });
            electron_1.ipcMain.handle("todo:open", () => {
                contextMenuWindow?.hide();
                openTodoWindow();
            });
            electron_1.ipcMain.handle("todo:close", () => {
                todoWindow?.hide();
            });
            electron_1.ipcMain.handle("settings:get", () => {
                return { ...readSettings(), todoFilePath: getTodoFilePath() };
            });
            electron_1.ipcMain.handle("settings:update", (_event, payload) => {
                const current = readSettings();
                const transcriptDirectory = payload.transcriptDirectory?.trim() || current.transcriptDirectory;
                remindedTodoIds.clear();
                return { ...writeSettings({ transcriptDirectory }), todoFilePath: getTodoFilePath() };
            });
            electron_1.ipcMain.handle("settings:pick-transcript-directory", async () => {
                const pickerTarget = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : petWindow;
                const dialogOptions = {
                    title: "閫夋嫨瀵硅瘽璁板綍鐩綍",
                    properties: ["openDirectory", "createDirectory", "promptToCreate"]
                };
                const result = pickerTarget
                    ? await electron_1.dialog.showOpenDialog(pickerTarget, dialogOptions)
                    : await electron_1.dialog.showOpenDialog(dialogOptions);
                if (result.canceled || !result.filePaths[0]) {
                    return null;
                }
                return result.filePaths[0];
            });
            electron_1.ipcMain.handle("settings:open", () => {
                contextMenuWindow?.hide();
                openSettingsWindow();
            });
            electron_1.ipcMain.handle("settings:close", () => {
                settingsWindow?.hide();
            });
            electron_1.ipcMain.handle("menu:close", () => {
                contextMenuWindow?.hide();
            });
            electron_1.ipcMain.handle("pet:set-mood", (_event, payload) => {
                updatePetMood(payload.mood);
            });
        }
        ;
        electron_1.app.on("before-quit", () => {
            if (reminderTimer) {
                clearInterval(reminderTimer);
                reminderTimer = null;
            }
        });
        electron_1.app.on("browser-window-focus", (_event, window) => {
            if (contextMenuWindow && window !== contextMenuWindow && contextMenuWindow.isVisible()) {
                contextMenuWindow.hide();
            }
        });
        electron_1.app.on("browser-window-blur", (_event, window) => {
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
        electron_1.app.on("window-all-closed", () => {
            if (process.platform !== "darwin") {
                electron_1.app.quit();
            }
        });
        electron_1.app.on("activate", () => {
            if (!petWindow || petWindow.isDestroyed()) {
                createPetWindow();
            }
            if (!chatWindow || chatWindow.isDestroyed()) {
                createChatWindow();
            }
        });
    }
}
