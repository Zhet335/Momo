"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const dotenv_1 = require("dotenv");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
electron_1.app.disableHardwareAcceleration();
electron_1.app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
electron_1.app.setName("Momo");
electron_1.app.setAppUserModelId("Momo");
(0, dotenv_1.config)({ path: node_path_1.default.join(process.cwd(), ".env") });
let petWindow = null;
let petBubbleWindow = null;
let chatWindow = null;
let settingsWindow = null;
let todoWindow = null;
let contextMenuWindow = null;
let developerWindow = null;
let tray = null;
let keepChatVisibleOnBlur = false;
let hasUnreadReminder = false;
let petPointerPassthroughEnabled = false;
let stickyPetPreviewVisible = false;
let activePetBubblePlacement = "top-left";
let petBubbleHideTimer = null;
let petBubbleWindowHideAfterExitTimer = null;
let latestPetBubblePayload = null;
let reminderTimer = null;
let autoUpdateTimer = null;
let autoUpdaterClient = null;
let pendingLaunchAction = null;
let pendingChatAttachmentPaths = [];
const remindedTodoIds = new Set();
let petDragSession = null;
const isDev = !electron_1.app.isPackaged;
const PET_WINDOW_SIZE = 110;
const PET_BUBBLE_WINDOW_WIDTH = 290;
const PET_BUBBLE_WINDOW_HEIGHT = 170;
const CHAT_WINDOW_WIDTH = 340;
const CHAT_WINDOW_HEIGHT = 520;
const SETTINGS_WINDOW_WIDTH = 440;
const SETTINGS_WINDOW_HEIGHT = 560;
const TODO_WINDOW_WIDTH = 420;
const TODO_WINDOW_HEIGHT = 560;
const MENU_WINDOW_WIDTH = 248;
const MENU_WINDOW_HEIGHT = 214;
const DEVELOPER_WINDOW_WIDTH = 420;
const DEVELOPER_WINDOW_HEIGHT = 360;
const CHAT_WINDOW_GAP = 10;
const WINDOW_MARGIN = 16;
const PANEL_WINDOW_RADIUS = 28;
const TODO_REMINDER_GRACE_MS = 2 * 60 * 1000;
const MAX_ATTACHMENT_TEXT_LENGTH = 7000;
const MAX_ATTACHMENT_FILE_BYTES = 20 * 1024 * 1024;
const MAX_OCR_IMAGE_EDGE = 2200;
const MAX_OCR_IMAGE_BYTES = 6 * 1024 * 1024;
const LOCAL_FILE_MAX_SCAN_COUNT = 1800;
const LOCAL_FILE_MAX_DEPTH = 4;
const LOCAL_FILE_MAX_RESULTS = 6;
const LOCAL_FILE_TEXT_PREVIEW_BYTES = 256 * 1024;
const LOCAL_FILE_TEXT_SNIPPET_LENGTH = 180;
const LOCAL_FILE_SEARCHABLE_EXTENSIONS = new Set([
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".csv",
    ".tsv",
    ".log",
    ".xml",
    ".html",
    ".htm",
    ".rtf",
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp"
]);
const LOCAL_FILE_CONTENT_EXTENSIONS = new Set([
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".csv",
    ".tsv",
    ".log",
    ".xml",
    ".html",
    ".htm",
    ".rtf"
]);
const LOCAL_FILE_IGNORED_DIR_NAMES = new Set([
    ".git",
    "node_modules",
    "dist",
    "dist-electron",
    "build",
    "out",
    ".next",
    ".cache",
    "coverage"
]);
const DEFAULT_ZHIPU_MODEL = process.env.ZHIPU_MODEL?.trim() || "glm-4-flash";
const DEFAULT_ZHIPU_OCR_MODEL = process.env.ZHIPU_OCR_MODEL?.trim() || "glm-4v-flash";
const ENABLE_WEB_SEARCH_BY_DEFAULT = process.env.MOMO_ENABLE_WEB_SEARCH?.trim() !== "0";
let webSearchEnabled = ENABLE_WEB_SEARCH_BY_DEFAULT;
const SETTINGS_FILE_NAME = "settings.json";
const TODO_FILE_NAME = "Momo TODO.md";
const MEMORY_FILE_NAME = "Momo Memory.md";
const MOMO_ICON_FILE_NAME = "momo-icon.png";
const MOMO_ACTION_FLAG = "--momo-action=";
const AUTO_UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;
const singleInstanceLock = electron_1.app.requestSingleInstanceLock();
if (!singleInstanceLock) {
    electron_1.app.quit();
}
function resolveRendererUrl(route) {
    if (isDev) {
        return `http://localhost:5173${route}`;
    }
    const indexPath = node_path_1.default.join(electron_1.app.getAppPath(), "dist", "index.html");
    return `file://${indexPath}${route}`;
}
function getLaunchActionFromArgv(argv) {
    const actionArg = argv.find((value) => value.startsWith(MOMO_ACTION_FLAG));
    const action = actionArg?.slice(MOMO_ACTION_FLAG.length);
    if (action === "open-chat" || action === "open-todos" || action === "open-settings") {
        return action;
    }
    return null;
}
function getTaskArguments(action) {
    if (electron_1.app.isPackaged) {
        return `${MOMO_ACTION_FLAG}${action}`;
    }
    return `"${electron_1.app.getAppPath()}" ${MOMO_ACTION_FLAG}${action}`;
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
        const todoFilePath = parsed.todoFilePath?.trim() || undefined;
        const memoryFilePath = parsed.memoryFilePath?.trim() || undefined;
        const apiProvider = parsed.apiProvider?.trim();
        const apiBaseUrl = parsed.apiBaseUrl?.trim() || undefined;
        const apiModel = parsed.apiModel?.trim() || undefined;
        const apiKey = parsed.apiKey?.trim() || undefined;
        if (todoFilePath) {
            ensureDirectory(node_path_1.default.dirname(todoFilePath));
        }
        if (memoryFilePath) {
            ensureDirectory(node_path_1.default.dirname(memoryFilePath));
        }
        return { transcriptDirectory, todoFilePath, memoryFilePath, apiProvider, apiBaseUrl, apiModel, apiKey };
    }
    catch {
        ensureDirectory(fallback.transcriptDirectory);
        return fallback;
    }
}
function writeSettings(nextSettings) {
    ensureDirectory(node_path_1.default.dirname(getSettingsFilePath()));
    ensureDirectory(nextSettings.transcriptDirectory);
    if (nextSettings.todoFilePath?.trim()) {
        ensureDirectory(node_path_1.default.dirname(nextSettings.todoFilePath));
    }
    if (nextSettings.memoryFilePath?.trim()) {
        ensureDirectory(node_path_1.default.dirname(nextSettings.memoryFilePath));
    }
    node_fs_1.default.writeFileSync(getSettingsFilePath(), JSON.stringify(nextSettings, null, 2), "utf8");
    return nextSettings;
}
function getTodoFilePath() {
    const settings = readSettings();
    ensureDirectory(settings.transcriptDirectory);
    if (settings.todoFilePath?.trim()) {
        ensureDirectory(node_path_1.default.dirname(settings.todoFilePath));
        return settings.todoFilePath;
    }
    return node_path_1.default.join(settings.transcriptDirectory, TODO_FILE_NAME);
}
function getMemoryFilePath() {
    const settings = readSettings();
    ensureDirectory(settings.transcriptDirectory);
    if (settings.memoryFilePath?.trim()) {
        ensureDirectory(node_path_1.default.dirname(settings.memoryFilePath));
        return settings.memoryFilePath;
    }
    return node_path_1.default.join(settings.transcriptDirectory, MEMORY_FILE_NAME);
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
    const match = /^- \[( |x)\] (.+?)(?: \| due: ([^|]+))?(?: \| remind: (\d+))?(?: \| note: (.+))?$/.exec(trimmed);
    if (!match) {
        return null;
    }
    const [, doneFlag, title, dueAt, remindMinutesBefore, note] = match;
    const id = sanitizeFileName(`${title}-${dueAt || "no-due"}-${remindMinutesBefore || 0}`).toLowerCase();
    let parsedNote;
    if (note?.trim()) {
        try {
            parsedNote = decodeURIComponent(note.trim());
        }
        catch {
            parsedNote = note.trim();
        }
    }
    return {
        id,
        title: title.trim(),
        dueAt: dueAt?.trim(),
        remindMinutesBefore: remindMinutesBefore ? Number(remindMinutesBefore) : undefined,
        note: parsedNote,
        done: doneFlag === "x"
    };
}
function serializeTodoItem(item) {
    const duePart = item.dueAt ? ` | due: ${item.dueAt}` : "";
    const remindPart = item.remindMinutesBefore ? ` | remind: ${item.remindMinutesBefore}` : "";
    const notePart = item.note?.trim() ? ` | note: ${encodeURIComponent(item.note.trim())}` : "";
    return `- [${item.done ? "x" : " "}] ${item.title}${duePart}${remindPart}${notePart}`;
}
function ensureTodoFile() {
    const todoFilePath = getTodoFilePath();
    if (!node_fs_1.default.existsSync(todoFilePath)) {
        node_fs_1.default.writeFileSync(todoFilePath, "# Momo 寰呭姙娓呭崟\n\n> 鏍煎紡锛? [ ] 鏍囬 | due: YYYY-MM-DD HH:mm | remind: 鎻愬墠鍒嗛挓\n\n", "utf8");
    }
    return todoFilePath;
}
function ensureMemoryFile() {
    const memoryFilePath = getMemoryFilePath();
    if (!node_fs_1.default.existsSync(memoryFilePath)) {
        node_fs_1.default.writeFileSync(memoryFilePath, [
            "# Momo Memory",
            "",
            "Store durable user preferences and long-term constraints.",
            "Only keep stable facts; avoid temporary task chatter.",
            "",
            "## Preferences",
            "- (empty)",
            "",
            "## Constraints",
            "- (empty)",
            "",
            "## Profile",
            "- (empty)",
            ""
        ].join("\n"), "utf8");
    }
    return memoryFilePath;
}
function readMemory() {
    const memoryFilePath = ensureMemoryFile();
    return node_fs_1.default.readFileSync(memoryFilePath, "utf8");
}
function writeMemory(content) {
    const memoryFilePath = ensureMemoryFile();
    node_fs_1.default.writeFileSync(memoryFilePath, content.trimEnd() + "\n", "utf8");
    return { path: memoryFilePath };
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
        note: draft.note?.trim(),
        done: false
    };
    const result = writeTodos([...readTodos(), nextItem]);
    return { ...result, item: nextItem };
}
function formatDateTimeForTodo(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}
function normalizeTodoFilePath(input, transcriptDirectory) {
    const trimmed = input.trim();
    if (!trimmed) {
        return node_path_1.default.join(transcriptDirectory, TODO_FILE_NAME);
    }
    const normalized = trimmed.replace(/[\\/]+$/, "");
    if (/\.md$/i.test(normalized)) {
        return normalized;
    }
    return node_path_1.default.join(normalized, TODO_FILE_NAME);
}
function normalizeChatCompletionUrl(baseUrl) {
    const trimmed = baseUrl.trim().replace(/\/+$/, "");
    return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}
function getChatApiConfig() {
    const settings = readSettings();
    const provider = settings.apiProvider || "zhipu";
    const defaultBaseUrl = provider === "zhipu"
        ? "https://open.bigmodel.cn/api/paas/v4"
        : provider === "deepseek"
            ? "https://api.deepseek.com/v1"
            : provider === "qwen"
                ? "https://dashscope.aliyuncs.com/compatible-mode/v1"
                : provider === "moonshot"
                    ? "https://api.moonshot.cn/v1"
                    : "https://api.openai.com/v1";
    const defaultModel = provider === "zhipu"
        ? DEFAULT_ZHIPU_MODEL
        : provider === "deepseek"
            ? "deepseek-chat"
            : provider === "qwen"
                ? "qwen-plus"
                : provider === "moonshot"
                    ? "moonshot-v1-8k"
                    : "gpt-4o-mini";
    const apiBaseUrl = settings.apiBaseUrl?.trim() || defaultBaseUrl;
    const apiModel = settings.apiModel?.trim() || defaultModel;
    const apiKey = settings.apiKey?.trim() || (provider === "zhipu" ? process.env.ZHIPU_API_KEY?.trim() : "");
    return {
        provider,
        apiBaseUrl,
        apiModel,
        apiKey: apiKey || ""
    };
}
function getApiConfigSource() {
    const settings = readSettings();
    if (settings.apiKey?.trim()) {
        return "settings";
    }
    if (process.env.ZHIPU_API_KEY?.trim()) {
        return "env";
    }
    return "missing";
}
function formatChatApiErrorMessage(apiConfig, status, rawErrorText) {
    const source = getApiConfigSource();
    const trimmedError = rawErrorText.trim();
    const normalizedError = trimmedError || `Request failed with status ${status}.`;
    if (status === 401) {
        const sourceText = source === "settings"
            ? "当前在使用设置面板里保存的 API Key。"
            : source === "env"
                ? "当前没有读到设置面板里的 API Key，正在回退使用 .env 里的配置。"
                : "当前没有找到可用的 API Key。";
        return [
            `接口鉴权失败（401）。当前 provider: ${apiConfig.provider}。`,
            sourceText,
            "这通常表示 API Key 已过期、填错，或者 provider 和 key 不匹配。",
            `原始错误：${normalizedError}`
        ].join(" ");
    }
    return normalizedError;
}
function getTodoDueTime(item) {
    if (!item.dueAt) {
        return null;
    }
    const raw = item.dueAt.trim();
    if (!raw) {
        return null;
    }
    const normalized = raw
        .replace(/[./]/g, "-")
        .replace(/[Tt]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?$/);
    if (match) {
        const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
        const parsed = new Date(Number(yearText), Number(monthText) - 1, Number(dayText), Number(hourText ?? "0"), Number(minuteText ?? "0"), Number(secondText ?? "0"), 0).getTime();
        return Number.isNaN(parsed) ? null : parsed;
    }
    const fallback = new Date(normalized).getTime();
    return Number.isNaN(fallback) ? null : fallback;
}
function normalizeTodoDraft(draft) {
    const title = draft.title.trim();
    if (!title) {
        return null;
    }
    const normalized = {
        title,
        remindMinutesBefore: typeof draft.remindMinutesBefore === "number" && Number.isFinite(draft.remindMinutesBefore)
            ? Math.max(0, Math.round(draft.remindMinutesBefore))
            : undefined
    };
    if (draft.dueAt?.trim()) {
        const parsedTime = getTodoDueTime({
            id: "draft",
            title,
            dueAt: draft.dueAt.trim(),
            remindMinutesBefore: normalized.remindMinutesBefore,
            note: draft.note?.trim(),
            done: false
        });
        normalized.dueAt = parsedTime === null ? draft.dueAt.trim() : formatDateTimeForTodo(parsedTime);
    }
    if (draft.note?.trim()) {
        normalized.note = draft.note.trim();
    }
    return normalized;
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
    if (ext === ".doc") {
        return "doc";
    }
    if (ext === ".docx") {
        return "docx";
    }
    if ([".xls", ".xlsx"].includes(ext)) {
        return "spreadsheet";
    }
    if ([".ppt", ".pptx"].includes(ext)) {
        return "presentation";
    }
    if ([".txt", ".md", ".markdown", ".json", ".csv", ".tsv", ".log", ".xml"].includes(ext)) {
        return "text";
    }
    if ([".html", ".htm", ".rtf"].includes(ext)) {
        return "richtext";
    }
    return "unknown";
}
function stripHtmlTags(input) {
    return input
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim();
}
function stripRtfMarkup(input) {
    return input
        .replace(/\\par[d]?/g, "\n")
        .replace(/\\'[0-9a-fA-F]{2}/g, " ")
        .replace(/\\[a-z]+-?\d* ?/g, " ")
        .replace(/[{}]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function getBundledPythonPath() {
    return node_path_1.default.join(electron_1.app.getPath("home"), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
}
function runPythonExtraction(script, filePath) {
    const pythonPath = getBundledPythonPath();
    if (!node_fs_1.default.existsSync(pythonPath)) {
        throw new Error("Bundled Python runtime is unavailable.");
    }
    return (0, node_child_process_1.execFileSync)(pythonPath, ["-", filePath], {
        input: script,
        encoding: "utf8",
        maxBuffer: 12 * 1024 * 1024
    }).trim();
}
function extractSpreadsheetText(filePath) {
    const script = `
import sys
from openpyxl import load_workbook

path = sys.argv[1]
wb = load_workbook(path, data_only=True, read_only=True)
parts = []
for ws in wb.worksheets:
    parts.append(f"# Sheet: {ws.title}")
    row_count = 0
    for row in ws.iter_rows(values_only=True):
        values = [str(cell).strip() for cell in row if cell is not None and str(cell).strip()]
        if values:
            parts.append(" | ".join(values))
            row_count += 1
        if row_count >= 80:
            break
print("\\n".join(parts).strip())
`;
    return runPythonExtraction(script, filePath);
}
function extractDocxTextWithPython(filePath) {
    const script = `
import sys
from docx import Document

path = sys.argv[1]
doc = Document(path)
parts = []
for p in doc.paragraphs:
    text = p.text.strip()
    if text:
        parts.append(text)

for table in doc.tables:
    parts.append("# Table")
    for row in table.rows:
        values = [cell.text.strip() for cell in row.cells if cell.text.strip()]
        if values:
            parts.append(" | ".join(values))

print("\\n".join(parts).strip())
`;
    return runPythonExtraction(script, filePath);
}
function extractPresentationText(filePath) {
    const extension = node_path_1.default.extname(filePath).toLowerCase();
    if (extension === ".ppt") {
        throw new Error("Legacy .ppt extraction is not available yet. Please convert it to .pptx or drag it into Office and resave once.");
    }
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$path = $args[0]
$zip = [System.IO.Compression.ZipFile]::OpenRead($path)
try {
  $slides = $zip.Entries |
    Where-Object { $_.FullName -like 'ppt/slides/slide*.xml' } |
    Sort-Object FullName
  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($slide in $slides) {
    $stream = $slide.Open()
    try {
      $reader = New-Object System.IO.StreamReader($stream)
      $xmlText = $reader.ReadToEnd()
      $reader.Close()
      $matches = [regex]::Matches($xmlText, '<a:t>(.*?)</a:t>')
      $texts = @()
      foreach ($match in $matches) {
        if ($match.Groups[1].Value.Trim()) {
          $texts += $match.Groups[1].Value.Trim()
        }
      }
      if ($texts.Count -gt 0) {
        $parts.Add('# Slide')
        $parts.Add(($texts -join ' '))
      }
    } finally {
      $stream.Dispose()
    }
  }
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output ($parts -join [Environment]::NewLine)
} finally {
  $zip.Dispose()
}
`;
    return (0, node_child_process_1.execFileSync)("powershell", ["-NoProfile", "-Command", script, filePath], {
        encoding: "utf8",
        maxBuffer: 12 * 1024 * 1024
    }).trim();
}
function extractLegacyDocText(filePath) {
    const script = `
$ErrorActionPreference = 'Stop'
$path = $args[0]
$word = $null
$doc = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $doc = $word.Documents.Open($path, $false, $true)
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $doc.Content.Text
} finally {
  if ($doc -ne $null) { $doc.Close($false) }
  if ($word -ne $null) { $word.Quit() }
}
`;
    try {
        return (0, node_child_process_1.execFileSync)("powershell", ["-NoProfile", "-Command", script, filePath], {
            encoding: "utf8",
            maxBuffer: 12 * 1024 * 1024
        }).trim();
    }
    catch {
        throw new Error("Legacy .doc extraction requires Microsoft Word on this machine.");
    }
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
async function runImageOcrFromFile(filePath) {
    const { apiKey } = getChatApiConfig();
    if (!apiKey) {
        throw new Error("Missing ZHIPU_API_KEY. Please set it in your .env file.");
    }
    const image = electron_1.nativeImage.createFromPath(filePath);
    if (image.isEmpty()) {
        throw new Error("Cannot read image file.");
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
    return data.choices?.[0]?.message?.content?.trim() || "";
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
        return { path: filePath, name, ext, kind, text: trimAttachmentText(ocrText || "[No readable text detected in image]") };
    }
    if (kind === "pdf") {
        const parsed = await pdfParse(node_fs_1.default.readFileSync(filePath));
        return { path: filePath, name, ext, kind, text: trimAttachmentText(parsed.text || "[No readable text extracted from PDF]") };
    }
    if (kind === "doc") {
        return {
            path: filePath,
            name,
            ext,
            kind,
            text: trimAttachmentText(extractLegacyDocText(filePath) || "[No readable text extracted from DOC]")
        };
    }
    if (kind === "docx") {
        let text = "";
        try {
            text = extractDocxTextWithPython(filePath);
        }
        catch {
            const parsed = await mammoth.extractRawText({ buffer: node_fs_1.default.readFileSync(filePath) });
            text = parsed.value || "";
        }
        return { path: filePath, name, ext, kind, text: trimAttachmentText(text || "[No readable text extracted from DOCX]") };
    }
    if (kind === "spreadsheet") {
        return {
            path: filePath,
            name,
            ext,
            kind,
            text: trimAttachmentText(extractSpreadsheetText(filePath) || "[No readable text extracted from spreadsheet]")
        };
    }
    if (kind === "presentation") {
        return {
            path: filePath,
            name,
            ext,
            kind,
            text: trimAttachmentText(extractPresentationText(filePath) || "[No readable text extracted from presentation]")
        };
    }
    if (kind === "text") {
        const rawText = node_fs_1.default.readFileSync(filePath, "utf8");
        return { path: filePath, name, ext, kind, text: trimAttachmentText(ext === ".xml" ? stripHtmlTags(rawText) : rawText) };
    }
    if (kind === "richtext") {
        const rawText = node_fs_1.default.readFileSync(filePath, "utf8");
        const normalized = ext === ".rtf" ? stripRtfMarkup(rawText) : stripHtmlTags(rawText);
        return {
            path: filePath,
            name,
            ext,
            kind,
            text: trimAttachmentText(normalized || "[No readable text extracted from rich text file]")
        };
    }
    throw new Error("Unsupported file type.");
}
async function parseAttachments(filePaths) {
    const normalized = Array.from(new Set(filePaths.map((filePath) => node_path_1.default.resolve(filePath))));
    const parsed = [];
    const failed = [];
    for (const filePath of normalized) {
        try {
            parsed.push(await parseAttachment(filePath));
        }
        catch (error) {
            failed.push({
                path: filePath,
                name: node_path_1.default.basename(filePath),
                reason: error instanceof Error ? error.message : "Parse failed"
            });
        }
    }
    return { parsed, failed };
}
function getLocalFileSearchRoots() {
    const settings = readSettings();
    const homePath = electron_1.app.getPath("home");
    const candidates = [
        settings.transcriptDirectory,
        getTodoFilePath() ? node_path_1.default.dirname(getTodoFilePath()) : "",
        electron_1.app.getPath("documents"),
        node_path_1.default.join(homePath, "Desktop"),
        node_path_1.default.join(homePath, "Downloads")
    ];
    return Array.from(new Set(candidates
        .map((candidate) => candidate?.trim())
        .filter((candidate) => Boolean(candidate && node_fs_1.default.existsSync(candidate)))
        .map((candidate) => node_path_1.default.resolve(candidate))));
}
function extractLocalFileSearchTerms(input) {
    const normalized = input
        .replace(/[“”"'`]/g, " ")
        .replace(/[()（）【】\[\]{}<>]/g, " ")
        .replace(/[，。！？、,:;|/\\]+/g, " ")
        .trim();
    const rawTokens = normalized.match(/[\u4e00-\u9fff]{2,}|[A-Za-z0-9._-]{2,}/g) || [];
    const stopWords = new Set([
        "帮我",
        "给我",
        "一下",
        "一个",
        "这个",
        "那个",
        "今天",
        "明天",
        "后天",
        "文件",
        "文档",
        "本地",
        "里面",
        "有关",
        "相关",
        "需要",
        "用到",
        "查找",
        "搜索",
        "检索",
        "找到",
        "安排",
        "待办",
        "提醒",
        "日程",
        "momo",
        "todo",
        "file",
        "files",
        "document",
        "documents",
        "search",
        "find"
    ]);
    const seen = new Set();
    return rawTokens
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
        .filter((token) => !stopWords.has(token.toLowerCase()))
        .filter((token) => {
        const key = token.toLowerCase();
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    })
        .slice(0, 6);
}
function extractExplicitFileQuery(input) {
    const normalized = input.trim();
    const exactMatch = normalized.match(/([^\s\\/]+?\.(?:txt|md|markdown|json|csv|log|pdf|doc|docx|xls|xlsx|ppt|pptx|png|jpg|jpeg|webp))/i) ||
        normalized.match(/[:：]\s*([^\r\n]+)/);
    const rawCandidate = exactMatch?.[1]?.trim();
    if (!rawCandidate) {
        return null;
    }
    const cleaned = rawCandidate
        .replace(/^["“”'`]+|["“”'`]+$/g, "")
        .replace(/[，。！？；,;]+$/g, "")
        .trim();
    if (!cleaned || cleaned.length < 3) {
        return null;
    }
    const ext = node_path_1.default.extname(cleaned).toLowerCase();
    if (!ext || !LOCAL_FILE_SEARCHABLE_EXTENSIONS.has(ext)) {
        return null;
    }
    return cleaned;
}
function shouldSearchLocalFiles(input) {
    if (!input.trim()) {
        return false;
    }
    if (/(本地文件|本地文档|本地资料|文件库|资料库|附件|pdf|docx?|xlsx?|pptx?|markdown|md|txt)/i.test(input)) {
        return true;
    }
    return /(找|查|搜|检索|搜索|定位|打开).*(文件|文档|资料|表格|图片|合同|简历|预算|方案|记录|附件)/.test(input);
}
function shouldAnswerWithLocalFileSearch(input) {
    return shouldSearchLocalFiles(input) && /(找|查|搜|检索|搜索|定位|在哪|有没有|列出)/.test(input);
}
function classifyChatIntentHeuristically(input) {
    const trimmed = input.trim();
    if (!trimmed) {
        return "chat";
    }
    if (shouldAnswerWithLocalFileSearch(trimmed)) {
        return "local_file_search";
    }
    if (/(修改|更新|重排|重写|改一下|完成|删除|清空).*(待办|日程|提醒)/.test(trimmed)) {
        return "todo_rewrite";
    }
    if (/(提醒我|记得|帮我记|加个待办|创建待办|新建待办|加个提醒|安排一下|设个日程|定个日程|到时候提醒我)/.test(trimmed)) {
        return "todo_create";
    }
    return "chat";
}
async function classifyChatIntent(input) {
    const heuristic = classifyChatIntentHeuristically(input);
    const apiConfig = getChatApiConfig();
    if (!apiConfig.apiKey || !input.trim()) {
        return heuristic;
    }
    try {
        const response = await fetch(normalizeChatCompletionUrl(apiConfig.apiBaseUrl), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiConfig.apiKey}`
            },
            body: JSON.stringify({
                model: apiConfig.apiModel,
                temperature: 0,
                messages: [
                    {
                        role: "system",
                        content: "你是消息意图分类器。请只输出严格 JSON，不要 markdown。JSON: " +
                            '{"intent":"chat|local_file_search|todo_create|todo_rewrite","reason":"string"}。' +
                            "分类规则：" +
                            "1. 用户要查找、检索、搜索、定位本地文件/文档/资料时，必须输出 local_file_search。" +
                            "2. 用户要新增提醒、待办、日程时，输出 todo_create。" +
                            "3. 用户要修改、删除、完成、重排现有待办时，输出 todo_rewrite。" +
                            "4. 其他都输出 chat。" +
                            "5. 如果一句话里同时提到文件和待办，但主要诉求是先找文件，也输出 local_file_search。"
                    },
                    {
                        role: "user",
                        content: input
                    }
                ]
            })
        });
        if (!response.ok) {
            return heuristic;
        }
        const data = (await response.json());
        const raw = data.choices?.[0]?.message?.content?.trim();
        if (!raw) {
            return heuristic;
        }
        const parsed = parseJsonObjectFromText(raw);
        if (parsed.intent === "chat" ||
            parsed.intent === "local_file_search" ||
            parsed.intent === "todo_create" ||
            parsed.intent === "todo_rewrite") {
            return parsed.intent;
        }
    }
    catch {
        return heuristic;
    }
    return heuristic;
}
function buildLocalFileSnippet(content, keywords) {
    const normalized = content.replace(/\s+/g, " ").trim();
    if (!normalized) {
        return "";
    }
    const lower = normalized.toLowerCase();
    let matchIndex = -1;
    for (const keyword of keywords) {
        const index = lower.indexOf(keyword.toLowerCase());
        if (index !== -1 && (matchIndex === -1 || index < matchIndex)) {
            matchIndex = index;
        }
    }
    if (matchIndex === -1) {
        return normalized.slice(0, LOCAL_FILE_TEXT_SNIPPET_LENGTH);
    }
    const start = Math.max(0, matchIndex - 36);
    const end = Math.min(normalized.length, matchIndex + LOCAL_FILE_TEXT_SNIPPET_LENGTH);
    return normalized.slice(start, end);
}
function shouldIgnoreLocalSearchResult(fullPath) {
    const baseName = node_path_1.default.basename(fullPath);
    if (baseName === TODO_FILE_NAME || baseName === MEMORY_FILE_NAME) {
        return true;
    }
    return /^\d{8}-\d{6}-/.test(baseName);
}
function collectLocalFileMatches(rootPath, keywords, matches, scanState, depth = 0) {
    if (scanState.count >= LOCAL_FILE_MAX_SCAN_COUNT || depth > LOCAL_FILE_MAX_DEPTH) {
        return;
    }
    let entries = [];
    try {
        entries = node_fs_1.default.readdirSync(rootPath, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (scanState.count >= LOCAL_FILE_MAX_SCAN_COUNT) {
            return;
        }
        const fullPath = node_path_1.default.join(rootPath, entry.name);
        if (entry.isDirectory()) {
            if (LOCAL_FILE_IGNORED_DIR_NAMES.has(entry.name)) {
                continue;
            }
            collectLocalFileMatches(fullPath, keywords, matches, scanState, depth + 1);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        scanState.count += 1;
        if (shouldIgnoreLocalSearchResult(fullPath)) {
            continue;
        }
        const ext = node_path_1.default.extname(entry.name).toLowerCase();
        if (!LOCAL_FILE_SEARCHABLE_EXTENSIONS.has(ext)) {
            continue;
        }
        const nameLower = entry.name.toLowerCase();
        const pathLower = fullPath.toLowerCase();
        let score = 0;
        let reason = null;
        for (const keyword of keywords) {
            const lowerKeyword = keyword.toLowerCase();
            if (nameLower.includes(lowerKeyword)) {
                score += 8;
                reason = "filename";
            }
            else if (pathLower.includes(lowerKeyword)) {
                score += 4;
                reason = reason || "filename";
            }
        }
        let snippet = "";
        if (!score && LOCAL_FILE_CONTENT_EXTENSIONS.has(ext)) {
            try {
                const stat = node_fs_1.default.statSync(fullPath);
                if (stat.size <= LOCAL_FILE_TEXT_PREVIEW_BYTES) {
                    const content = node_fs_1.default.readFileSync(fullPath, "utf8");
                    const lowerContent = content.toLowerCase();
                    const contentMatched = keywords.some((keyword) => lowerContent.includes(keyword.toLowerCase()));
                    if (contentMatched) {
                        score += 3;
                        reason = "content";
                        snippet = buildLocalFileSnippet(content, keywords);
                    }
                }
            }
            catch {
                // ignore unreadable file
            }
        }
        if (!score || !reason) {
            continue;
        }
        const existing = matches.get(fullPath);
        if (!existing || score > existing.score) {
            matches.set(fullPath, {
                path: fullPath,
                name: entry.name,
                ext,
                reason,
                snippet,
                score
            });
        }
    }
}
function searchLocalFilesByExplicitName(input) {
    const explicitName = extractExplicitFileQuery(input);
    if (!explicitName) {
        return [];
    }
    const targetName = explicitName.toLowerCase();
    const targetStem = node_path_1.default.basename(explicitName, node_path_1.default.extname(explicitName)).toLowerCase();
    const matches = new Map();
    const scanState = { count: 0 };
    const roots = getLocalFileSearchRoots();
    const visit = (rootPath, depth = 0) => {
        if (scanState.count >= LOCAL_FILE_MAX_SCAN_COUNT || depth > LOCAL_FILE_MAX_DEPTH) {
            return;
        }
        let entries = [];
        try {
            entries = node_fs_1.default.readdirSync(rootPath, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (scanState.count >= LOCAL_FILE_MAX_SCAN_COUNT) {
                return;
            }
            const fullPath = node_path_1.default.join(rootPath, entry.name);
            if (entry.isDirectory()) {
                if (LOCAL_FILE_IGNORED_DIR_NAMES.has(entry.name)) {
                    continue;
                }
                visit(fullPath, depth + 1);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            scanState.count += 1;
            if (shouldIgnoreLocalSearchResult(fullPath)) {
                continue;
            }
            const fileNameLower = entry.name.toLowerCase();
            const stemLower = node_path_1.default.basename(entry.name, node_path_1.default.extname(entry.name)).toLowerCase();
            let score = 0;
            if (fileNameLower === targetName) {
                score = 100;
            }
            else if (stemLower === targetStem) {
                score = 80;
            }
            else if (fileNameLower.includes(targetName)) {
                score = 60;
            }
            else if (stemLower.includes(targetStem)) {
                score = 40;
            }
            if (!score) {
                continue;
            }
            matches.set(fullPath, {
                path: fullPath,
                name: entry.name,
                ext: node_path_1.default.extname(entry.name).toLowerCase(),
                reason: "filename",
                score
            });
        }
    };
    for (const rootPath of roots) {
        if (scanState.count >= LOCAL_FILE_MAX_SCAN_COUNT) {
            break;
        }
        visit(rootPath);
    }
    return Array.from(matches.values())
        .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
        .slice(0, LOCAL_FILE_MAX_RESULTS);
}
function searchLocalFiles(input) {
    const explicitMatches = searchLocalFilesByExplicitName(input);
    if (explicitMatches.length) {
        return explicitMatches;
    }
    const keywords = extractLocalFileSearchTerms(input);
    if (!keywords.length) {
        return [];
    }
    const matches = new Map();
    const scanState = { count: 0 };
    const roots = getLocalFileSearchRoots();
    for (const rootPath of roots) {
        if (scanState.count >= LOCAL_FILE_MAX_SCAN_COUNT) {
            break;
        }
        collectLocalFileMatches(rootPath, keywords, matches, scanState);
    }
    return Array.from(matches.values())
        .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
        .slice(0, LOCAL_FILE_MAX_RESULTS);
}
function buildLocalFileContext(matches, title = "以下是可能相关的本地文件，请按需参考。") {
    if (!matches.length) {
        return "";
    }
    return [
        title,
        "",
        ...matches.map((match, index) => [
            `[${index + 1}] ${match.name}`,
            `路径：${match.path}`,
            `命中方式：${match.reason === "filename" ? "文件名" : "文件内容"}`,
            match.snippet ? `片段：${match.snippet}` : ""
        ]
            .filter(Boolean)
            .join("\n"))
    ].join("\n\n");
}
function buildLocalFileSearchReply(input, matches) {
    const explicitName = extractExplicitFileQuery(input);
    const keywords = extractLocalFileSearchTerms(input);
    if (!matches.length) {
        return explicitName
            ? `我按文件名“${explicitName}”在本地检索了一轮，暂时没有找到这个文件。`
            : `我在本地文件里按“${keywords.join(" / ")}”检索了一轮，暂时没有找到明显匹配的文件。`;
    }
    return [
        explicitName ? `我帮你找到了这些匹配“${explicitName}”的本地文件：` : `我先帮你在本地文件里找到了这些可能相关的内容：`,
        "",
        ...matches.map((match, index) => `${index + 1}. ${match.name}\n路径：${match.path}${!explicitName && match.snippet ? `\n片段：${match.snippet}` : ""}`)
    ].join("\n\n");
}
function buildTodoNoteWithLocalFiles(baseNote, matches) {
    const parts = [baseNote?.trim()].filter(Boolean);
    if (matches.length) {
        parts.push(["关联文件：", ...matches.slice(0, 3).map((match) => `- ${match.path}`)].join("\n"));
    }
    return parts.join("\n\n").trim() || undefined;
}
function shouldAnalyzeMatchedLocalFiles(input) {
    return /(总结|总结一下|概括|分析|看看|阅读|读一下|处理|提炼|梳理|说明|解释|extract|summarize|analy[sz]e|read)/i.test(input);
}
async function buildMatchedLocalFileReadContext(input, matches) {
    if (!matches.length || !shouldAnalyzeMatchedLocalFiles(input)) {
        return "";
    }
    const parsed = await parseAttachments(matches.slice(0, 2).map((match) => match.path));
    if (!parsed.parsed.length) {
        return "";
    }
    return [
        "以下是根据用户提到的本地文件读取到的内容，请优先基于这些文件进行总结、分析或回答：",
        "",
        ...parsed.parsed.map((item, index) => `[${index + 1}] ${item.name}\n路径：${item.path}\n内容：\n${item.text}`)
    ].join("\n\n");
}
function isTodoExpired(item) {
    const dueTime = getTodoDueTime(item);
    return dueTime !== null && dueTime + TODO_REMINDER_GRACE_MS < Date.now();
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
        return content ? `文件：${file.fileName}\n${content.slice(0, 900)}` : "";
    })
        .filter(Boolean);
    if (!snippets.length) {
        return "";
    }
    return ["以下是最近对话摘要，如相关请参考。", "", ...snippets].join("\n");
}
function collectTodoContext() {
    const todoItems = readTodos().filter((item) => !item.done && !isTodoExpired(item));
    if (!todoItems.length) {
        return "";
    }
    const lines = todoItems.map((item) => {
        const duePart = item.dueAt ? `，截止时间 ${item.dueAt}` : "";
        const remindPart = item.remindMinutesBefore ? `，提前 ${item.remindMinutesBefore} 分钟提醒` : "";
        const notePart = item.note?.trim() ? `，备注：${item.note.trim().replace(/\s+/g, " ").slice(0, 180)}` : "";
        return `- ${item.title}${duePart}${remindPart}${notePart}`;
    });
    return ["以下是当前待办，请在相关问题中参考。", "", ...lines].join("\n");
}
function collectMemoryContext() {
    const memory = readMemory().trim();
    if (!memory) {
        return "";
    }
    return `User memory (durable preferences and constraints):\n${memory.slice(0, 6000)}`;
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
function updatePetMood(mood) {
    petWindow?.webContents.send("pet:mood-changed", mood);
}
function updatePetGlance(direction) {
    petWindow?.webContents.send("pet:glance", direction);
}
function summarizeForPetBubble(content) {
    const normalized = content
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/[#>*_`\-\[\]\(\)]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!normalized) {
        return "";
    }
    return normalized.length > 72 ? `${normalized.slice(0, 72)}...` : normalized;
}
function showPetMessagePreview(content, options) {
    const summary = summarizeForPetBubble(content);
    if (!summary) {
        return;
    }
    if (petBubbleHideTimer) {
        clearTimeout(petBubbleHideTimer);
        petBubbleHideTimer = null;
    }
    if (petBubbleWindowHideAfterExitTimer) {
        clearTimeout(petBubbleWindowHideAfterExitTimer);
        petBubbleWindowHideAfterExitTimer = null;
    }
    const bubbleWindow = createPetBubbleWindow();
    const petBounds = petWindow?.getBounds();
    if (petBounds) {
        const display = electron_1.screen.getDisplayNearestPoint({ x: petBounds.x, y: petBounds.y });
        activePetBubblePlacement = resolvePetBubblePlacement(petBounds, display.workArea);
        positionPetBubbleWindow(activePetBubblePlacement);
    }
    bubbleWindow.webContents.send("pet:message-preview", {
        content: summary,
        persistent: options?.persistent === true,
        visible: true,
        placement: activePetBubblePlacement
    });
    latestPetBubblePayload = {
        content: summary,
        persistent: options?.persistent === true,
        visible: true,
        placement: activePetBubblePlacement
    };
    bubbleWindow.show();
    bubbleWindow.moveTop();
    refreshPetWindowPriority();
    if (options?.persistent === true) {
        return;
    }
    petBubbleHideTimer = setTimeout(() => {
        hidePetMessagePreview();
    }, 5000);
}
function hidePetMessagePreview() {
    if (petBubbleHideTimer) {
        clearTimeout(petBubbleHideTimer);
        petBubbleHideTimer = null;
    }
    if (petBubbleWindowHideAfterExitTimer) {
        clearTimeout(petBubbleWindowHideAfterExitTimer);
        petBubbleWindowHideAfterExitTimer = null;
    }
    petBubbleWindow?.webContents.send("pet:message-preview", {
        content: "",
        visible: false,
        persistent: false,
        placement: activePetBubblePlacement
    });
    latestPetBubblePayload = {
        content: "",
        visible: false,
        persistent: false,
        placement: activePetBubblePlacement
    };
    // Let renderer exit animation play before hiding the transparent bubble window.
    petBubbleWindowHideAfterExitTimer = setTimeout(() => {
        petBubbleWindow?.hide();
        petBubbleWindowHideAfterExitTimer = null;
    }, 360);
}
function toggleStickyPetMessagePreview() {
    stickyPetPreviewVisible = !stickyPetPreviewVisible;
    if (stickyPetPreviewVisible) {
        showPetMessagePreview("这是开发调试气泡，会一直显示；再次点击按钮后就会收起。", { persistent: true });
    }
    else {
        hidePetMessagePreview();
    }
    return stickyPetPreviewVisible;
}
function updateUnreadReminderState(hasUnread) {
    hasUnreadReminder = hasUnread;
    petWindow?.webContents.send("pet:unread-reminder", hasUnread);
}
function playPetNotificationCue() {
    petWindow?.webContents.send("pet:play-notification-cue");
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
        playPetNotificationCue();
        if (!chatWindow?.isVisible()) {
            updateUnreadReminderState(true);
        }
        if (electron_1.Notification.isSupported()) {
            new electron_1.Notification({
                title: "Momo",
                body: item.dueAt ? item.title + "\n" + item.dueAt : item.title,
                icon: getMomoNotificationIcon(),
                silent: true
            }).show();
        }
        chatWindow?.webContents.send("chat:todo-reminder", {
            content: "提醒一下，" + item.title + (item.dueAt ? "（" + item.dueAt + "）" : "") + "。"
        });
        showPetMessagePreview("提醒一下，" + item.title + (item.dueAt ? "（" + item.dueAt + "）" : ""));
    }
}
function createBaseWindow(options) {
    const window = new electron_1.BrowserWindow({
        title: "Momo",
        frame: false,
        autoHideMenuBar: true,
        roundedCorners: false,
        hasShadow: false,
        maximizable: false,
        fullscreenable: false,
        show: false,
        paintWhenInitiallyHidden: true,
        icon: getMomoWindowIcon(),
        ...options,
        webPreferences: {
            preload: node_path_1.default.join(__dirname, "../preload/index.js"),
            backgroundThrottling: false,
            ...(options.webPreferences || {})
        }
    });
    window.setMenuBarVisibility(false);
    if (!isDev) {
        window.webContents.on("before-input-event", (event, input) => {
            const key = input.key.toLowerCase();
            const blocksDevToolsShortcut = key === "f12" || ((input.control || input.meta) && input.shift && (key === "i" || key === "j" || key === "c"));
            if (blocksDevToolsShortcut) {
                event.preventDefault();
            }
        });
        window.webContents.on("devtools-opened", () => {
            window.webContents.closeDevTools();
        });
    }
    if ("setBackgroundMaterial" in window) {
        window.setBackgroundMaterial("none");
    }
    return window;
}
function buildRoundedRectShape(width, height, radius) {
    const clippedRadius = Math.max(0, Math.min(radius, Math.floor(Math.min(width, height) / 2)));
    const rects = [];
    for (let y = 0; y < height; y += 1) {
        const rowCenterY = y + 0.5;
        let left = 0;
        let right = width;
        if (rowCenterY < clippedRadius) {
            const dy = clippedRadius - rowCenterY;
            const dx = Math.sqrt(Math.max(0, clippedRadius * clippedRadius - dy * dy));
            left = Math.max(0, Math.floor(clippedRadius - dx));
            right = Math.min(width, Math.ceil(width - clippedRadius + dx));
        }
        else if (rowCenterY > height - clippedRadius) {
            const dy = rowCenterY - (height - clippedRadius);
            const dx = Math.sqrt(Math.max(0, clippedRadius * clippedRadius - dy * dy));
            left = Math.max(0, Math.floor(clippedRadius - dx));
            right = Math.min(width, Math.ceil(width - clippedRadius + dx));
        }
        rects.push({ x: left, y, width: Math.max(0, right - left), height: 1 });
    }
    return rects.filter((rect) => rect.width > 0);
}
function applyRoundedWindowShape(window, width, height) {
    if (!window || typeof window.setShape !== "function") {
        return;
    }
    window.setShape(buildRoundedRectShape(width, height, PANEL_WINDOW_RADIUS));
}
function createPetWindow() {
    const { width: screenWidth, height: screenHeight } = electron_1.screen.getPrimaryDisplay().workAreaSize;
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
    refreshPetWindowPriority();
    petWindow.show();
}
function createPetBubbleWindow() {
    if (petBubbleWindow && !petBubbleWindow.isDestroyed()) {
        return petBubbleWindow;
    }
    petBubbleWindow = createBaseWindow({
        width: PET_BUBBLE_WINDOW_WIDTH,
        height: PET_BUBBLE_WINDOW_HEIGHT,
        x: WINDOW_MARGIN,
        y: WINDOW_MARGIN,
        transparent: true,
        backgroundColor: "#00000000",
        alwaysOnTop: true,
        focusable: false,
        resizable: false,
        skipTaskbar: true
    });
    petBubbleWindow.loadURL(resolveRendererUrl("/?view=pet-bubble"));
    petBubbleWindow.setIgnoreMouseEvents(true, { forward: true });
    petBubbleWindow.webContents.on("did-finish-load", () => {
        if (latestPetBubblePayload) {
            petBubbleWindow?.webContents.send("pet:message-preview", latestPetBubblePayload);
        }
    });
    petBubbleWindow.on("closed", () => {
        petBubbleWindow = null;
    });
    return petBubbleWindow;
}
function getPetBubbleBoundsForPlacement(petBounds, placement) {
    const anchorOffsetX = 40;
    const anchorOffsetY = 44;
    switch (placement) {
        case "top-left":
            return {
                x: petBounds.x - PET_BUBBLE_WINDOW_WIDTH + anchorOffsetX,
                y: petBounds.y - PET_BUBBLE_WINDOW_HEIGHT + anchorOffsetY,
                width: PET_BUBBLE_WINDOW_WIDTH,
                height: PET_BUBBLE_WINDOW_HEIGHT
            };
        case "top-right":
            return {
                x: petBounds.x + petBounds.width - anchorOffsetX,
                y: petBounds.y - PET_BUBBLE_WINDOW_HEIGHT + anchorOffsetY,
                width: PET_BUBBLE_WINDOW_WIDTH,
                height: PET_BUBBLE_WINDOW_HEIGHT
            };
        case "bottom-left":
            return {
                x: petBounds.x - PET_BUBBLE_WINDOW_WIDTH + anchorOffsetX,
                y: petBounds.y + petBounds.height - anchorOffsetY,
                width: PET_BUBBLE_WINDOW_WIDTH,
                height: PET_BUBBLE_WINDOW_HEIGHT
            };
        case "bottom-right":
            return {
                x: petBounds.x + petBounds.width - anchorOffsetX,
                y: petBounds.y + petBounds.height - anchorOffsetY,
                width: PET_BUBBLE_WINDOW_WIDTH,
                height: PET_BUBBLE_WINDOW_HEIGHT
            };
    }
}
function resolvePetBubblePlacement(petBounds, area) {
    const preferredPlacements = ["top-left", "top-right", "bottom-left", "bottom-right"];
    for (const placement of preferredPlacements) {
        const bounds = getPetBubbleBoundsForPlacement(petBounds, placement);
        const fitsHorizontally = bounds.x >= area.x + WINDOW_MARGIN && bounds.x + bounds.width <= area.x + area.width - WINDOW_MARGIN;
        const fitsVertically = bounds.y >= area.y + WINDOW_MARGIN && bounds.y + bounds.height <= area.y + area.height - WINDOW_MARGIN;
        if (fitsHorizontally && fitsVertically) {
            return placement;
        }
    }
    return "top-left";
}
function positionPetBubbleWindow(placement) {
    if (!petWindow || !petBubbleWindow || petWindow.isDestroyed() || petBubbleWindow.isDestroyed()) {
        return;
    }
    const petBounds = petWindow.getBounds();
    const display = electron_1.screen.getDisplayNearestPoint({ x: petBounds.x, y: petBounds.y });
    const area = display.workArea;
    const rawBounds = getPetBubbleBoundsForPlacement(petBounds, placement);
    const x = Math.min(Math.max(rawBounds.x, area.x + WINDOW_MARGIN), area.x + area.width - rawBounds.width - WINDOW_MARGIN);
    const y = Math.min(Math.max(rawBounds.y, area.y + WINDOW_MARGIN), area.y + area.height - rawBounds.height - WINDOW_MARGIN);
    petBubbleWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: rawBounds.width, height: rawBounds.height });
    petBubbleWindow.moveTop();
}
function refreshPetWindowPriority() {
    if (!petWindow || petWindow.isDestroyed()) {
        return;
    }
    petWindow.setAlwaysOnTop(true, "screen-saver");
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    petWindow.setFocusable(false);
    petWindow.moveTop();
    if (petBubbleWindow && !petBubbleWindow.isDestroyed()) {
        petBubbleWindow.setAlwaysOnTop(true, "screen-saver");
        petBubbleWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        petBubbleWindow.setFocusable(false);
        petBubbleWindow.setIgnoreMouseEvents(true, { forward: true });
        petBubbleWindow.moveTop();
    }
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
function createDeveloperWindow() {
    if (!isDev) {
        return null;
    }
    if (developerWindow && !developerWindow.isDestroyed()) {
        return developerWindow;
    }
    developerWindow = createBaseWindow({
        width: DEVELOPER_WINDOW_WIDTH,
        height: DEVELOPER_WINDOW_HEIGHT,
        transparent: false,
        backgroundColor: "#f4eadf",
        resizable: false
    });
    developerWindow.loadURL(resolveRendererUrl("/?view=developer"));
    applyRoundedWindowShape(developerWindow, DEVELOPER_WINDOW_WIDTH, DEVELOPER_WINDOW_HEIGHT);
    developerWindow.on("closed", () => {
        developerWindow = null;
    });
    return developerWindow;
}
function positionWindowNearPet(targetWindow, width, height) {
    if (!petWindow) {
        return "left";
    }
    const petBounds = petWindow.getBounds();
    const display = electron_1.screen.getDisplayNearestPoint({ x: petBounds.x, y: petBounds.y });
    const area = display.workArea;
    let x = petBounds.x - width - CHAT_WINDOW_GAP;
    let direction = "left";
    if (x < area.x + WINDOW_MARGIN) {
        x = petBounds.x + petBounds.width + CHAT_WINDOW_GAP;
        direction = "right";
    }
    x = Math.min(Math.max(x, area.x + WINDOW_MARGIN), area.x + area.width - width - WINDOW_MARGIN);
    const y = Math.min(Math.max(petBounds.y + petBounds.height - height, area.y + WINDOW_MARGIN), area.y + area.height - height - WINDOW_MARGIN);
    targetWindow.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
    targetWindow.moveTop();
    return direction;
}
function positionChatWindowNearPet() {
    if (!chatWindow) {
        return "left";
    }
    return positionWindowNearPet(chatWindow, CHAT_WINDOW_WIDTH, CHAT_WINDOW_HEIGHT);
}
function openSettingsWindow() {
    const window = createSettingsWindow();
    positionWindowNearPet(window, SETTINGS_WINDOW_WIDTH, SETTINGS_WINDOW_HEIGHT);
    window.show();
    window.focus();
    refreshPetWindowPriority();
}
function openTodoWindow() {
    const window = createTodoWindow();
    positionWindowNearPet(window, TODO_WINDOW_WIDTH, TODO_WINDOW_HEIGHT);
    window.show();
    window.focus();
    refreshPetWindowPriority();
}
function openContextMenuAt(screenX, screenY) {
    const menuWindow = createContextMenuWindow();
    const display = electron_1.screen.getDisplayNearestPoint({ x: screenX, y: screenY });
    const area = display.workArea;
    const x = Math.min(Math.max(screenX, area.x + WINDOW_MARGIN), area.x + area.width - MENU_WINDOW_WIDTH - WINDOW_MARGIN);
    const y = Math.min(Math.max(screenY, area.y + WINDOW_MARGIN), area.y + area.height - MENU_WINDOW_HEIGHT - WINDOW_MARGIN);
    menuWindow.setBounds({ x, y, width: MENU_WINDOW_WIDTH, height: MENU_WINDOW_HEIGHT });
    menuWindow.show();
    menuWindow.focus();
    menuWindow.moveTop();
}
function openDeveloperWindow() {
    const window = createDeveloperWindow();
    if (!window) {
        return;
    }
    positionWindowNearPet(window, DEVELOPER_WINDOW_WIDTH, DEVELOPER_WINDOW_HEIGHT);
    window.show();
    window.focus();
    refreshPetWindowPriority();
}
function hidePanelsForPetDrag() {
    // Keep drag interaction predictable: when dragging the pet, collapse all companion panels.
    contextMenuWindow?.hide();
    chatWindow?.hide();
    settingsWindow?.hide();
    todoWindow?.hide();
    developerWindow?.hide();
}
function handleLaunchAction(action) {
    pendingLaunchAction = null;
    if (action === "open-chat") {
        toggleChatWindowFromIcon();
        return;
    }
    if (action === "open-todos") {
        openTodoWindow();
        return;
    }
    openSettingsWindow();
}
function movePetWindow(pointerX, pointerY) {
    if (!petWindow || !petDragSession) {
        return;
    }
    const deltaX = pointerX - petDragSession.pointerStartX;
    const deltaY = pointerY - petDragSession.pointerStartY;
    const display = electron_1.screen.getDisplayNearestPoint({ x: pointerX, y: pointerY });
    const area = display.workArea;
    const nextX = Math.min(Math.max(petDragSession.windowStartX + deltaX, area.x), area.x + area.width - PET_WINDOW_SIZE);
    const nextY = Math.min(Math.max(petDragSession.windowStartY + deltaY, area.y), area.y + area.height - PET_WINDOW_SIZE);
    petWindow.setBounds({
        x: Math.round(nextX),
        y: Math.round(nextY),
        width: PET_WINDOW_SIZE,
        height: PET_WINDOW_SIZE
    });
    if (petBubbleWindow && !petBubbleWindow.isDestroyed() && petBubbleWindow.isVisible()) {
        positionPetBubbleWindow(activePetBubblePlacement);
    }
}
function getNotificationSoundPath() {
    const soundDirectory = node_path_1.default.join(process.cwd(), "Voice");
    if (!node_fs_1.default.existsSync(soundDirectory)) {
        return null;
    }
    const preferredPath = node_path_1.default.join(soundDirectory, "Voice.mp3");
    if (node_fs_1.default.existsSync(preferredPath)) {
        return preferredPath;
    }
    const legacyPath = node_path_1.default.join(soundDirectory, "通知.mp3");
    if (node_fs_1.default.existsSync(legacyPath)) {
        return legacyPath;
    }
    const fallbackFile = node_fs_1.default
        .readdirSync(soundDirectory)
        .find((fileName) => fileName.toLowerCase().endsWith(".mp3"));
    return fallbackFile ? node_path_1.default.join(soundDirectory, fallbackFile) : null;
}
function getNotificationSoundAsset() {
    const soundPath = getNotificationSoundPath();
    if (!soundPath || !node_fs_1.default.existsSync(soundPath)) {
        return null;
    }
    const extension = node_path_1.default.extname(soundPath).toLowerCase();
    const mimeType = extension === ".wav"
        ? "audio/wav"
        : extension === ".ogg"
            ? "audio/ogg"
            : extension === ".m4a"
                ? "audio/mp4"
                : "audio/mpeg";
    const base64 = node_fs_1.default.readFileSync(soundPath).toString("base64");
    return {
        path: soundPath,
        mimeType,
        dataUrl: `data:${mimeType};base64,${base64}`
    };
}
function getMomoIconPath() {
    const candidatePaths = [
        node_path_1.default.join(process.cwd(), "assets", MOMO_ICON_FILE_NAME),
        node_path_1.default.join(electron_1.app.getAppPath(), "assets", MOMO_ICON_FILE_NAME)
    ];
    return candidatePaths.find((candidatePath) => node_fs_1.default.existsSync(candidatePath)) || null;
}
function getMomoNotificationIcon() {
    const iconPath = getMomoIconPath();
    if (iconPath) {
        return electron_1.nativeImage.createFromPath(iconPath).resize({ width: 128, height: 128 });
    }
    return electron_1.nativeImage.createEmpty();
}
function getMomoWindowIcon() {
    return getMomoNotificationIcon();
}
function scheduleAutoUpdateChecks() {
    if (!autoUpdaterClient) {
        return;
    }
    if (autoUpdateTimer) {
        clearInterval(autoUpdateTimer);
        autoUpdateTimer = null;
    }
    autoUpdateTimer = setInterval(() => {
        void autoUpdaterClient?.checkForUpdatesAndNotify().catch(() => {
            // Keep updater silent on background polling failures.
        });
    }, AUTO_UPDATE_INTERVAL_MS);
}
function initAutoUpdater() {
    if (isDev) {
        return;
    }
    try {
        const updaterModule = require("electron-updater");
        const autoUpdater = updaterModule.autoUpdater;
        if (!autoUpdater) {
            return;
        }
        autoUpdaterClient = autoUpdater;
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.on("update-available", () => {
            showPetMessagePreview("检测到新版本，正在后台下载。");
        });
        autoUpdater.on("update-downloaded", () => {
            showPetMessagePreview("新版本已下载完成，退出 Momo 后会自动安装。");
        });
        autoUpdater.on("error", () => {
            // Updater errors are intentionally quiet to avoid interrupting normal use.
        });
        void autoUpdater.checkForUpdatesAndNotify().catch(() => {
            // Keep first-run check quiet if network / release metadata is not ready.
        });
        scheduleAutoUpdateChecks();
    }
    catch {
        // electron-updater not installed or unavailable in current runtime.
    }
}
function toggleChatWindowFromIcon() {
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
    chatWindow.moveTop();
    notifyChatOpened();
    updatePetGlance(direction);
    if (hasUnreadReminder) {
        updateUnreadReminderState(false);
    }
    const summary = getTodoReminderSummary(); //待办提醒
    if (summary) {
        chatWindow.webContents.send("chat:todo-reminder", { content: summary });
    }
}
function openChatWindow() {
    if (!chatWindow) {
        return;
    }
    contextMenuWindow?.hide();
    const direction = positionChatWindowNearPet();
    chatWindow.show();
    chatWindow.focus();
    chatWindow.moveTop();
    notifyChatOpened();
    updatePetGlance(direction);
    if (hasUnreadReminder) {
        updateUnreadReminderState(false);
    }
    const summary = getTodoReminderSummary();
    if (summary) {
        chatWindow.webContents.send("chat:todo-reminder", { content: summary });
    }
}
function queueAttachmentsToChat(filePaths) {
    const normalized = Array.from(new Set(filePaths
        .map((filePath) => node_path_1.default.resolve(filePath))
        .filter((filePath) => {
        try {
            return node_fs_1.default.existsSync(filePath) && node_fs_1.default.statSync(filePath).isFile();
        }
        catch {
            return false;
        }
    })));
    if (!normalized.length) {
        return;
    }
    pendingChatAttachmentPaths = Array.from(new Set([...pendingChatAttachmentPaths, ...normalized]));
    openChatWindow();
    chatWindow?.webContents.send("chat:attachments-queued", { filePaths: normalized });
}
function consumeQueuedChatAttachments() {
    const queued = [...pendingChatAttachmentPaths];
    pendingChatAttachmentPaths = [];
    return queued;
}
function setPetPointerPassthrough(enabled) {
    if (!petWindow || petWindow.isDestroyed() || petPointerPassthroughEnabled === enabled) {
        return;
    }
    if (enabled) {
        petWindow.setIgnoreMouseEvents(true, { forward: true });
    }
    else {
        petWindow.setIgnoreMouseEvents(false);
    }
    petPointerPassthroughEnabled = enabled;
}
function createTray() {
    const trayIcon = getMomoWindowIcon().resize({ width: 20, height: 20 });
    tray = new electron_1.Tray(trayIcon);
    tray.setToolTip("Momo");
    const trayMenuTemplate = [
        { label: "打开聊天", click: () => toggleChatWindowFromIcon() },
        { label: "打开待办", click: () => openTodoWindow() },
        { label: "打开设置", click: () => openSettingsWindow() }
    ];
    if (isDev) {
        trayMenuTemplate.push({ label: "开发者工具", click: () => openDeveloperWindow() });
    }
    trayMenuTemplate.push({ label: "退出", click: () => electron_1.app.quit() });
    const trayMenu = electron_1.Menu.buildFromTemplate(trayMenuTemplate);
    tray.setContextMenu(trayMenu);
    tray.on("right-click", () => {
        tray?.popUpContextMenu(trayMenu);
    });
    tray.on("click", () => {
        toggleChatWindowFromIcon();
    });
}
function registerTaskbarTasks() {
    if (process.platform !== "win32") {
        return;
    }
    electron_1.app.setUserTasks([
        {
            program: process.execPath,
            arguments: getTaskArguments("open-chat"),
            iconPath: getMomoIconPath() || process.execPath,
            iconIndex: 0,
            title: "打开聊天",
            description: "打开 Momo 聊天面板。"
        },
        {
            program: process.execPath,
            arguments: getTaskArguments("open-todos"),
            iconPath: getMomoIconPath() || process.execPath,
            iconIndex: 0,
            title: "打开待办",
            description: "打开 Momo 待办面板。"
        },
        {
            program: process.execPath,
            arguments: getTaskArguments("open-settings"),
            iconPath: getMomoIconPath() || process.execPath,
            iconIndex: 0,
            title: "打开设置",
            description: "打开 Momo 设置面板。"
        }
    ]);
}
function getLatestUserMessage(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === "user") {
            return messages[index].content.trim();
        }
    }
    return "";
}
function shouldAnswerWithLocalDateTime(input) {
    if (!input) {
        return false;
    }
    const normalized = input.toLowerCase().replace(/\s+/g, "");
    if (/^(鍑犵偣|鍑犵偣浜唡鐜板湪鍑犵偣|鐜板湪鏃堕棿|褰撳墠鏃堕棿|浠婂ぉ鍑犲彿|浠婂ぉ鏄熸湡鍑爘浠婂ぉ鍛ㄥ嚑|鍑犲彿|鏄熸湡鍑爘鍛ㄥ嚑|鏃ユ湡)$/.test(normalized)) {
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
function extractFirstUrl(input) {
    const match = input.match(/((https?:\/\/|www\.)[^\s<>"'`]+)/i);
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
async function requestZhipuChatCompletion(messages) {
    const latestUserInput = getLatestUserMessage(messages);
    if (shouldAnswerWithLocalDateTime(latestUserInput)) {
        return buildLocalDateTimeReply();
    }
    const localFileMatches = shouldSearchLocalFiles(latestUserInput) ? searchLocalFiles(latestUserInput) : [];
    if (shouldAnswerWithLocalFileSearch(latestUserInput)) {
        if (!shouldAnalyzeMatchedLocalFiles(latestUserInput)) {
            return buildLocalFileSearchReply(latestUserInput, localFileMatches);
        }
    }
    const urlCandidate = extractFirstUrl(latestUserInput);
    const normalizedUrl = urlCandidate ? normalizeHttpUrl(urlCandidate) : null;
    let webPageContext = "";
    if (normalizedUrl && shouldOpenUrlInBrowser(latestUserInput)) {
        await electron_1.shell.openExternal(normalizedUrl);
        return `我已经在默认浏览器帮你打开网页：${normalizedUrl}`;
    }
    if (normalizedUrl && shouldReadWebPageContent(latestUserInput)) {
        const pageText = await fetchWebPagePlainText(normalizedUrl);
        if (!pageText) {
            return `我访问了 ${normalizedUrl}，但没有提取到可读正文。`;
        }
        webPageContext = `以下是网页内容（来源：${normalizedUrl}）：\n${pageText}\n\n请基于该内容回答用户。`;
    }
    const apiConfig = getChatApiConfig();
    if (!apiConfig.apiKey) {
        throw new Error("缺少 API Key，请先在设置面板或 .env 中配置。");
    }
    const requestMessages = [...messages];
    const todoContext = collectTodoContext();
    const transcriptContext = collectRecentTranscriptContext();
    const memoryContext = collectMemoryContext();
    const localFileContext = buildLocalFileContext(localFileMatches);
    const localFileReadContext = await buildMatchedLocalFileReadContext(latestUserInput, localFileMatches);
    if (todoContext) {
        requestMessages.splice(1, 0, { role: "system", content: todoContext });
    }
    if (transcriptContext) {
        requestMessages.splice(1, 0, { role: "system", content: transcriptContext });
    }
    if (memoryContext) {
        requestMessages.splice(1, 0, { role: "system", content: memoryContext });
    }
    if (localFileContext) {
        requestMessages.splice(1, 0, {
            role: "system",
            content: `${localFileContext}\n\n如果用户的问题涉及这些文件，请优先引用文件名和路径来回答。`
        });
    }
    if (localFileReadContext) {
        requestMessages.splice(1, 0, {
            role: "system",
            content: `${localFileReadContext}\n\n请直接基于这些本地文件内容回答，不要要求用户重新上传文件。`
        });
    }
    if (webPageContext) {
        requestMessages.splice(1, 0, { role: "system", content: webPageContext });
    }
    const requestUrl = normalizeChatCompletionUrl(apiConfig.apiBaseUrl);
    const requestHeaders = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiConfig.apiKey}`
    };
    const basePayload = {
        model: apiConfig.apiModel,
        messages: requestMessages,
        temperature: 0.7
    };
    const payloadWithWebSearch = {
        ...basePayload,
        tools: [{ type: "web_search" }],
        tool_choice: "auto"
    };
    const shouldUseWebSearch = webSearchEnabled && apiConfig.provider === "zhipu";
    let response = await fetch(requestUrl, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(shouldUseWebSearch ? payloadWithWebSearch : basePayload)
    });
    if (!response.ok && shouldUseWebSearch && [400, 404, 422].includes(response.status)) {
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
        throw new Error(formatChatApiErrorMessage(apiConfig, response.status, errorText));
    }
    const data = (await response.json());
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
        throw new Error("智谱接口返回了空内容。");
    }
    showPetMessagePreview(content);
    return content;
}
async function extractTodoDraftFromMessage(input) {
    const apiConfig = getChatApiConfig();
    if (!apiConfig.apiKey) {
        return null;
    }
    const now = new Date();
    const today = `${formatDateTimeForTodo(now.getTime())} (${Intl.DateTimeFormat().resolvedOptions().timeZone || "local"})`;
    const localFileMatches = shouldSearchLocalFiles(input) ? searchLocalFiles(input) : [];
    const localFileContext = buildLocalFileContext(localFileMatches, "以下是和这条任务可能相关的本地文件。");
    const response = await fetch(normalizeChatCompletionUrl(apiConfig.apiBaseUrl), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiConfig.apiKey}`
        },
        body: JSON.stringify({
            model: apiConfig.apiModel,
            temperature: 0.1,
            messages: [
                {
                    role: "system",
                    content: "你是待办提取器。请从用户消息中提取待办并输出严格 JSON，不要 markdown。JSON: " +
                        '{"shouldCreate":boolean,"title":string,"dueAt":"YYYY-MM-DD HH:mm"|"","remindMinutesBefore":number|null,"note":"string"}。' +
                        "如果用户并非在添加待办，则 shouldCreate=false。今天时间：" +
                        today +
                        " 如果本地文件检索结果里有明显相关文件，请把它们整理进 note。"
                },
                {
                    role: "user",
                    content: [localFileContext, localFileContext ? "" : "", "用户消息：", input].filter(Boolean).join("\n")
                }
            ]
        })
    });
    if (!response.ok) {
        return null;
    }
    const data = (await response.json());
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) {
        return null;
    }
    try {
        const parsed = parseJsonObjectFromText(raw);
        if (!parsed.shouldCreate || !parsed.title?.trim()) {
            return null;
        }
        return normalizeTodoDraft({
            title: parsed.title.trim(),
            dueAt: parsed.dueAt?.trim() || undefined,
            remindMinutesBefore: typeof parsed.remindMinutesBefore === "number" ? parsed.remindMinutesBefore : undefined,
            note: buildTodoNoteWithLocalFiles(parsed.note?.trim(), localFileMatches)
        });
    }
    catch {
        return null;
    }
}
function parseJsonObjectFromText(input) {
    const trimmed = input.trim();
    const blockStart = trimmed.indexOf("```");
    const blockEnd = trimmed.lastIndexOf("```");
    const candidate = blockStart !== -1 && blockEnd !== -1 && blockEnd > blockStart
        ? trimmed.slice(blockStart + 3, blockEnd).replace(/^json\s*/i, "").trim()
        : trimmed;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) {
        throw new Error("No JSON object found.");
    }
    return JSON.parse(candidate.slice(start, end + 1));
}
async function updateMemoryFromConversation(messages) {
    const apiConfig = getChatApiConfig();
    if (!apiConfig.apiKey) {
        return {
            updated: false,
            path: getMemoryFilePath(),
            reason: "API key is missing."
        };
    }
    const transcript = messages
        .filter((message) => message.content.trim())
        .slice(-20)
        .map((message) => `${message.role === "user" ? "User" : "Momo"}: ${message.content.trim()}`)
        .join("\n\n");
    if (!transcript.trim()) {
        return {
            updated: false,
            path: getMemoryFilePath(),
            reason: "Empty transcript."
        };
    }
    const response = await fetch(normalizeChatCompletionUrl(apiConfig.apiBaseUrl), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiConfig.apiKey}`
        },
        body: JSON.stringify({
            model: apiConfig.apiModel,
            temperature: 0.1,
            messages: [
                {
                    role: "system",
                    content: "You are a memory editor. Decide whether this saved conversation introduces durable user memory. " +
                        "Only keep stable preferences, long-term constraints, profile facts, recurring habits, or explicit standing instructions. " +
                        "Do not save temporary tasks, one-off requests, or transient emotions. " +
                        "Return strict JSON only: " +
                        '{"shouldUpdate":boolean,"memoryMarkdown":"string","reason":"string"}' +
                        ". If shouldUpdate=false, keep memoryMarkdown empty."
                },
                {
                    role: "user",
                    content: [
                        "Current memory markdown:",
                        readMemory(),
                        "",
                        "Saved conversation transcript:",
                        transcript,
                        "",
                        "If the conversation adds durable memory, output the full updated markdown."
                    ].join("\n")
                }
            ]
        })
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Memory update request failed with status ${response.status}.`);
    }
    const data = (await response.json());
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) {
        return {
            updated: false,
            path: getMemoryFilePath(),
            reason: "Empty memory update response."
        };
    }
    const parsed = parseJsonObjectFromText(raw);
    if (!parsed.shouldUpdate) {
        return {
            updated: false,
            path: getMemoryFilePath(),
            reason: parsed.reason?.trim() || "No durable memory found."
        };
    }
    const markdown = parsed.memoryMarkdown?.trim();
    if (!markdown) {
        return {
            updated: false,
            path: getMemoryFilePath(),
            reason: "Model did not provide updated memory markdown."
        };
    }
    const written = writeMemory(markdown);
    return {
        updated: true,
        path: written.path,
        reason: parsed.reason?.trim() || "Memory updated."
    };
}
async function rewriteTodosFromMessage(input) {
    const apiConfig = getChatApiConfig();
    if (!apiConfig.apiKey) {
        return null;
    }
    const currentItems = readTodos();
    const response = await fetch(normalizeChatCompletionUrl(apiConfig.apiBaseUrl), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiConfig.apiKey}`
        },
        body: JSON.stringify({
            model: apiConfig.apiModel,
            temperature: 0.1,
            messages: [
                {
                    role: "system",
                    content: "You are a todo list editor. Decide whether user asks to modify todo list. " +
                        "Return strict JSON only: " +
                        '{"shouldRewrite":boolean,"items":[{"title":"string","dueAt":"YYYY-MM-DD HH:mm|","remindMinutesBefore":number|null,"done":boolean}],"confirmation":"string"}' +
                        ". If no todo editing intent, set shouldRewrite=false."
                },
                {
                    role: "user",
                    content: [
                        "Current todo items:",
                        JSON.stringify(currentItems, null, 2),
                        "",
                        "User message:",
                        input
                    ].join("\n")
                }
            ]
        })
    });
    if (!response.ok) {
        return null;
    }
    const data = (await response.json());
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) {
        return null;
    }
    try {
        const parsed = parseJsonObjectFromText(raw);
        if (!parsed.shouldRewrite || !Array.isArray(parsed.items)) {
            return null;
        }
        const normalizedItems = parsed.items.reduce((items, item, index) => {
            const draft = normalizeTodoDraft({
                title: (item.title || "").trim(),
                dueAt: item.dueAt?.trim() || undefined,
                remindMinutesBefore: typeof item.remindMinutesBefore === "number" ? item.remindMinutesBefore : undefined
            });
            if (!draft) {
                return items;
            }
            items.push({
                id: sanitizeFileName(String(draft.title || "todo") + "-" + String(Date.now()) + "-" + String(index)).toLowerCase(),
                title: draft.title,
                dueAt: draft.dueAt,
                remindMinutesBefore: draft.remindMinutesBefore,
                done: Boolean(item.done)
            });
            return items;
        }, []);
        remindedTodoIds.clear();
        const result = writeTodos(normalizedItems);
        maybePushTodoReminder();
        showPetMessagePreview(parsed.confirmation?.trim() || "已按你的要求更新待办清单并写入 TODO 文件。");
        return {
            ...result,
            confirmation: parsed.confirmation?.trim() || "已按你的要求更新待办清单并写入 TODO 文件。"
        };
    }
    catch {
        return null;
    }
}
electron_1.app.on("second-instance", (_event, argv) => {
    const action = getLaunchActionFromArgv(argv);
    if (action) {
        pendingLaunchAction = action;
    }
    if (!petWindow || petWindow.isDestroyed()) {
        return;
    }
    if (petWindow.isMinimized()) {
        petWindow.restore();
    }
    petWindow.show();
    petWindow.focus();
    if (pendingLaunchAction) {
        handleLaunchAction(pendingLaunchAction);
    }
});
electron_1.app.whenReady().then(() => {
    writeSettings(readSettings());
    ensureTodoFile();
    ensureMemoryFile();
    createPetWindow();
    createPetBubbleWindow();
    petBubbleWindow?.hide();
    createChatWindow();
    initAutoUpdater();
    createTray();
    registerTaskbarTasks();
    pendingLaunchAction = getLaunchActionFromArgv(process.argv);
    if (pendingLaunchAction) {
        handleLaunchAction(pendingLaunchAction);
    }
    maybePushTodoReminder();
    reminderTimer = setInterval(maybePushTodoReminder, 30 * 1000);
    electron_1.ipcMain.handle("pet:drag-start", (_event, payload) => {
        if (!petWindow) {
            return;
        }
        setPetPointerPassthrough(false);
        hidePanelsForPetDrag();
        const bounds = petWindow.getBounds();
        petDragSession = {
            pointerStartX: payload.pointerX,
            pointerStartY: payload.pointerY,
            windowStartX: bounds.x,
            windowStartY: bounds.y
        };
    });
    electron_1.ipcMain.handle("pet:drag-move", (_event, payload) => {
        movePetWindow(payload.pointerX, payload.pointerY);
    });
    electron_1.ipcMain.handle("pet:drag-end", () => {
        petDragSession = null;
    });
    electron_1.ipcMain.handle("pet:toggle-chat", () => {
        toggleChatWindowFromIcon();
    });
    electron_1.ipcMain.handle("pet:open-menu", (_event, payload) => {
        openContextMenuAt(payload.screenX, payload.screenY);
    });
    electron_1.ipcMain.handle("pet:set-pointer-passthrough", (_event, payload) => {
        setPetPointerPassthrough(Boolean(payload.enabled));
    });
    electron_1.ipcMain.handle("pet:get-cursor-screen-point", () => {
        return electron_1.screen.getCursorScreenPoint();
    });
    electron_1.ipcMain.handle("pet:get-notification-sound-path", () => {
        return getNotificationSoundPath();
    });
    electron_1.ipcMain.handle("pet:get-notification-sound-asset", () => {
        return getNotificationSoundAsset();
    });
    electron_1.ipcMain.handle("chat:get-keep-visible-on-blur", () => keepChatVisibleOnBlur);
    electron_1.ipcMain.handle("chat:set-keep-visible-on-blur", (_event, payload) => {
        keepChatVisibleOnBlur = Boolean(payload.enabled);
        return keepChatVisibleOnBlur;
    });
    electron_1.ipcMain.handle("chat:send-message", async (_event, payload) => {
        return requestZhipuChatCompletion(payload.messages);
    });
    electron_1.ipcMain.handle("chat:classify-intent", async (_event, payload) => {
        return { intent: await classifyChatIntent(payload.content) };
    });
    electron_1.ipcMain.handle("chat:pick-attachments", async () => {
        const pickerTarget = chatWindow && !chatWindow.isDestroyed() ? chatWindow : petWindow;
        const dialogOptions = {
            title: "选择附件",
            properties: ["openFile", "multiSelections"],
            filters: [
                {
                    name: "Supported",
                    extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "markdown", "json", "csv", "tsv", "xml", "html", "htm", "rtf", "log"]
                },
                { name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] },
                { name: "PDF", extensions: ["pdf"] },
                { name: "Word", extensions: ["doc", "docx"] },
                { name: "Spreadsheet", extensions: ["xls", "xlsx"] },
                { name: "Presentation", extensions: ["ppt", "pptx"] },
                { name: "Text", extensions: ["txt", "md", "markdown", "json", "csv", "tsv", "xml", "html", "htm", "rtf", "log"] },
                { name: "All files", extensions: ["*"] }
            ]
        };
        const result = pickerTarget
            ? await electron_1.dialog.showOpenDialog(pickerTarget, dialogOptions)
            : await electron_1.dialog.showOpenDialog(dialogOptions);
        if (result.canceled) {
            return [];
        }
        return result.filePaths;
    });
    electron_1.ipcMain.handle("chat:parse-attachments", async (_event, payload) => {
        const files = Array.isArray(payload.filePaths) ? payload.filePaths : [];
        if (!files.length) {
            return { parsed: [], failed: [] };
        }
        return parseAttachments(files);
    });
    electron_1.ipcMain.handle("chat:enqueue-attachments", async (_event, payload) => {
        const files = Array.isArray(payload.filePaths) ? payload.filePaths : [];
        queueAttachmentsToChat(files);
    });
    electron_1.ipcMain.handle("chat:consume-queued-attachments", () => {
        return { filePaths: consumeQueuedChatAttachments() };
    });
    electron_1.ipcMain.handle("chat:add-todo-from-message", async (_event, payload) => {
        const draft = await extractTodoDraftFromMessage(payload.content);
        if (!draft) {
            return null;
        }
        remindedTodoIds.clear();
        const result = appendTodoItem(draft);
        maybePushTodoReminder();
        updatePetMood("happy");
        showPetMessagePreview("已经帮你记下这条待办：" +
            result.item.title +
            (result.item.dueAt ? `，时间是 ${result.item.dueAt}` : "") +
            (result.item.remindMinutesBefore ? `，会提前 ${result.item.remindMinutesBefore} 分钟提醒你` : "，会在到时间时提醒你") +
            (result.item.note?.includes("关联文件：") ? "，并附上了相关本地文件。" : "。"));
        return {
            item: result.item,
            confirmation: "已经帮你记下这条待办：" +
                result.item.title +
                (result.item.dueAt ? `，时间是 ${result.item.dueAt}` : "") +
                (result.item.remindMinutesBefore ? `，会提前 ${result.item.remindMinutesBefore} 分钟提醒你` : "，会在到时间时提醒你") +
                (result.item.note?.includes("关联文件：") ? "，并附上了相关本地文件。" : "。")
        };
    });
    electron_1.ipcMain.handle("chat:rewrite-todos-from-message", async (_event, payload) => {
        return rewriteTodosFromMessage(payload.content);
    });
    electron_1.ipcMain.handle("chat:save-conversation", async (_event, payload) => {
        const saved = saveConversationToMarkdown(payload.messages);
        try {
            const memory = await updateMemoryFromConversation(payload.messages);
            return { ...saved, memory };
        }
        catch (error) {
            return {
                ...saved,
                memory: {
                    updated: false,
                    path: getMemoryFilePath(),
                    reason: error instanceof Error ? error.message : "Memory update failed."
                }
            };
        }
    });
    electron_1.ipcMain.handle("todo:get", () => {
        return { items: readTodos(), path: getTodoFilePath() };
    });
    electron_1.ipcMain.handle("todo:save", (_event, payload) => {
        remindedTodoIds.clear();
        const result = writeTodos(payload.items);
        maybePushTodoReminder();
        return result;
    });
    electron_1.ipcMain.handle("todo:open", () => {
        contextMenuWindow?.hide();
        openTodoWindow();
    });
    electron_1.ipcMain.handle("todo:close", () => {
        todoWindow?.hide();
    });
    electron_1.ipcMain.handle("settings:get", () => {
        return { ...readSettings(), todoFilePath: getTodoFilePath(), memoryFilePath: getMemoryFilePath() };
    });
    electron_1.ipcMain.handle("settings:update", (_event, payload) => {
        const current = readSettings();
        const transcriptDirectory = payload.transcriptDirectory?.trim() || current.transcriptDirectory;
        const todoFilePath = normalizeTodoFilePath(payload.todoFilePath?.trim() || current.todoFilePath || node_path_1.default.join(transcriptDirectory, TODO_FILE_NAME), transcriptDirectory);
        const memoryFilePath = payload.memoryFilePath?.trim() || current.memoryFilePath || node_path_1.default.join(transcriptDirectory, MEMORY_FILE_NAME);
        const apiProvider = payload.apiProvider || current.apiProvider;
        const apiBaseUrl = payload.apiBaseUrl?.trim() || current.apiBaseUrl;
        const apiModel = payload.apiModel?.trim() || current.apiModel;
        const apiKey = payload.apiKey?.trim() || current.apiKey;
        remindedTodoIds.clear();
        return {
            ...writeSettings({ transcriptDirectory, todoFilePath, memoryFilePath, apiProvider, apiBaseUrl, apiModel, apiKey }),
            todoFilePath: getTodoFilePath(),
            memoryFilePath: getMemoryFilePath()
        };
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
    electron_1.ipcMain.handle("developer:open", () => {
        if (!isDev) {
            return false;
        }
        contextMenuWindow?.hide();
        openDeveloperWindow();
        return true;
    });
    electron_1.ipcMain.handle("developer:close", () => {
        developerWindow?.hide();
    });
    electron_1.ipcMain.handle("developer:toggle-pet-preview", () => {
        return { visible: toggleStickyPetMessagePreview() };
    });
    electron_1.ipcMain.handle("developer:get-pet-preview-state", () => {
        return { visible: stickyPetPreviewVisible };
    });
    electron_1.ipcMain.handle("developer:open-devtools", () => {
        if (!isDev) {
            return false;
        }
        const targetWindow = developerWindow && !developerWindow.isDestroyed() ? developerWindow : createDeveloperWindow();
        if (!targetWindow) {
            return false;
        }
        targetWindow.webContents.openDevTools({ mode: "detach" });
        return true;
    });
    electron_1.ipcMain.handle("app:is-devtools-enabled", () => isDev);
    electron_1.ipcMain.handle("menu:close", () => {
        contextMenuWindow?.hide();
    });
    electron_1.ipcMain.handle("pet:set-mood", (_event, payload) => {
        updatePetMood(payload.mood);
    });
});
electron_1.app.on("before-quit", () => {
    if (reminderTimer) {
        clearInterval(reminderTimer);
        reminderTimer = null;
    }
    if (autoUpdateTimer) {
        clearInterval(autoUpdateTimer);
        autoUpdateTimer = null;
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
    if (!petBubbleWindow || petBubbleWindow.isDestroyed()) {
        createPetBubbleWindow();
        petBubbleWindow?.hide();
    }
    if (!chatWindow || chatWindow.isDestroyed()) {
        createChatWindow();
    }
});
