import { contextBridge, ipcRenderer } from "electron";

const electronCompat = require("electron") as typeof import("electron") & {
  webUtils?: {
    getPathForFile?: (file: File) => string;
  };
};

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

type AppSettings = {
  transcriptDirectory: string;
  apiProvider?: "zhipu" | "openai" | "deepseek" | "qwen" | "moonshot" | "custom";
  apiBaseUrl?: string;
  apiModel?: string;
  apiKey?: string;
  todoFilePath?: string;
  memoryFilePath?: string;
};

type TodoItem = {
  id: string;
  title: string;
  dueAt?: string;
  remindMinutesBefore?: number;
  note?: string;
  done: boolean;
};

type ParsedAttachment = {
  path: string;
  name: string;
  ext: string;
  kind: "image" | "pdf" | "doc" | "docx" | "spreadsheet" | "presentation" | "text" | "richtext" | "unknown";
  text: string;
};

type ChatIntent = "chat" | "local_file_search" | "todo_create" | "todo_rewrite";

contextBridge.exposeInMainWorld("desktopPet", {
  toggleChat: () => ipcRenderer.invoke("pet:toggle-chat"),
  openPetMenu: (screenX: number, screenY: number) =>
    ipcRenderer.invoke("pet:open-menu", { screenX, screenY }),
  startDrag: (pointerX: number, pointerY: number) =>
    ipcRenderer.invoke("pet:drag-start", { pointerX, pointerY }),
  moveDrag: (pointerX: number, pointerY: number) =>
    ipcRenderer.invoke("pet:drag-move", { pointerX, pointerY }),
  endDrag: () => ipcRenderer.invoke("pet:drag-end"),
  setPointerPassthrough: (enabled: boolean) =>
    ipcRenderer.invoke("pet:set-pointer-passthrough", { enabled }),
  getCursorScreenPoint: () => ipcRenderer.invoke("pet:get-cursor-screen-point"),
  getNotificationSoundPath: () => ipcRenderer.invoke("pet:get-notification-sound-path"),
  getNotificationSoundAsset: () => ipcRenderer.invoke("pet:get-notification-sound-asset"),
  getKeepVisibleOnBlur: () => ipcRenderer.invoke("chat:get-keep-visible-on-blur"),
  setKeepVisibleOnBlur: (enabled: boolean) =>
    ipcRenderer.invoke("chat:set-keep-visible-on-blur", { enabled }),
  sendChatMessage: (messages: ChatMessagePayload[]) =>
    ipcRenderer.invoke("chat:send-message", { messages }),
  classifyChatIntent: (content: string) => ipcRenderer.invoke("chat:classify-intent", { content }),
  resolveDroppedFilePaths: (files: File[]) =>
    files
      .map((file) => {
        try {
          if (typeof electronCompat.webUtils?.getPathForFile === "function") {
            return electronCompat.webUtils.getPathForFile(file);
          }
          return (file as File & { path?: string }).path || "";
        } catch {
          return (file as File & { path?: string }).path || "";
        }
      })
      .filter(Boolean),
  ocrScreenText: () => ipcRenderer.invoke("screen:ocr-text"),
  pickChatAttachments: () => ipcRenderer.invoke("chat:pick-attachments"),
  parseChatAttachments: (filePaths: string[]) =>
    ipcRenderer.invoke("chat:parse-attachments", { filePaths }),
  enqueueChatAttachments: (filePaths: string[]) =>
    ipcRenderer.invoke("chat:enqueue-attachments", { filePaths }),
  consumeQueuedChatAttachments: () => ipcRenderer.invoke("chat:consume-queued-attachments"),
  addTodoFromMessage: (content: string) => ipcRenderer.invoke("chat:add-todo-from-message", { content }),
  rewriteTodosFromMessage: (content: string) =>
    ipcRenderer.invoke("chat:rewrite-todos-from-message", { content }),
  saveConversation: (messages: TranscriptMessage[]) =>
    ipcRenderer.invoke("chat:save-conversation", { messages }),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke("settings:update", settings),
  pickTranscriptDirectory: () => ipcRenderer.invoke("settings:pick-transcript-directory"),
  openSettings: () => ipcRenderer.invoke("settings:open"),
  closeSettings: () => ipcRenderer.invoke("settings:close"),
  openDeveloperTools: () => ipcRenderer.invoke("developer:open"),
  closeDeveloperTools: () => ipcRenderer.invoke("developer:close"),
  toggleDeveloperPetPreview: () => ipcRenderer.invoke("developer:toggle-pet-preview"),
  getDeveloperPetPreviewState: () => ipcRenderer.invoke("developer:get-pet-preview-state"),
  openWindowDevTools: () => ipcRenderer.invoke("developer:open-devtools"),
  isDeveloperToolsEnabled: () => ipcRenderer.invoke("app:is-devtools-enabled"),
  getTodos: () => ipcRenderer.invoke("todo:get"),
  saveTodos: (items: TodoItem[]) => ipcRenderer.invoke("todo:save", { items }),
  openTodos: () => ipcRenderer.invoke("todo:open"),
  closeTodos: () => ipcRenderer.invoke("todo:close"),
  closeMenu: () => ipcRenderer.invoke("menu:close"),
  setPetMood: (mood: PetMood) => ipcRenderer.invoke("pet:set-mood", { mood }),
  onPetMoodChange: (callback: (mood: PetMood) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, mood: PetMood) => callback(mood);
    ipcRenderer.on("pet:mood-changed", listener);

    return () => {
      ipcRenderer.removeListener("pet:mood-changed", listener);
    };
  },
  onPetGlance: (callback: (direction: PetGlanceDirection) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, direction: PetGlanceDirection) =>
      callback(direction);
    ipcRenderer.on("pet:glance", listener);

    return () => {
      ipcRenderer.removeListener("pet:glance", listener);
    };
  },
  onUnreadReminderChange: (callback: (hasUnread: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, hasUnread: boolean) => callback(hasUnread);
    ipcRenderer.on("pet:unread-reminder", listener);

    return () => {
      ipcRenderer.removeListener("pet:unread-reminder", listener);
    };
  },
  onPetNotificationCue: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("pet:play-notification-cue", listener);

    return () => {
      ipcRenderer.removeListener("pet:play-notification-cue", listener);
    };
  },
  onPetMessagePreview: (callback: (payload: { content: string; persistent?: boolean; visible?: boolean; placement?: string }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { content: string; persistent?: boolean; visible?: boolean; placement?: string }
    ) => callback(payload);
    ipcRenderer.on("pet:message-preview", listener);

    return () => {
      ipcRenderer.removeListener("pet:message-preview", listener);
    };
  },
  onTodoReminder: (callback: (payload: { content: string }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: {
        content: string;
      }
    ) => callback(payload);
    ipcRenderer.on("chat:todo-reminder", listener);

    return () => {
      ipcRenderer.removeListener("chat:todo-reminder", listener);
    };
  },
  onChatOpened: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("chat:opened", listener);

    return () => {
      ipcRenderer.removeListener("chat:opened", listener);
    };
  },
  onChatAttachmentsQueued: (callback: (payload: { filePaths: string[] }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { filePaths: string[] }) => callback(payload);
    ipcRenderer.on("chat:attachments-queued", listener);

    return () => {
      ipcRenderer.removeListener("chat:attachments-queued", listener);
    };
  }
});

declare global {
  interface Window {
    desktopPet: {
      toggleChat: () => Promise<void>;
      openPetMenu: (screenX: number, screenY: number) => Promise<void>;
      startDrag: (pointerX: number, pointerY: number) => Promise<void>;
      moveDrag: (pointerX: number, pointerY: number) => Promise<void>;
      endDrag: () => Promise<void>;
      setPointerPassthrough: (enabled: boolean) => Promise<void>;
      getCursorScreenPoint: () => Promise<{ x: number; y: number }>;
      getNotificationSoundPath: () => Promise<string | null>;
      getNotificationSoundAsset: () => Promise<null | { path: string; mimeType: string; dataUrl: string }>;
      getKeepVisibleOnBlur: () => Promise<boolean>;
      setKeepVisibleOnBlur: (enabled: boolean) => Promise<boolean>;
      sendChatMessage: (messages: ChatMessagePayload[]) => Promise<string>;
      classifyChatIntent: (content: string) => Promise<{ intent: ChatIntent }>;
      resolveDroppedFilePaths: (files: File[]) => string[];
      ocrScreenText: () => Promise<string>;
      pickChatAttachments: () => Promise<string[]>;
      parseChatAttachments: (filePaths: string[]) => Promise<{
        parsed: ParsedAttachment[];
        failed: Array<{ path: string; name: string; reason: string }>;
      }>;
      enqueueChatAttachments: (filePaths: string[]) => Promise<void>;
      consumeQueuedChatAttachments: () => Promise<{ filePaths: string[] }>;
      addTodoFromMessage: (content: string) => Promise<
        | null
        | {
            item: TodoItem;
            confirmation: string;
          }
      >;
      rewriteTodosFromMessage: (content: string) => Promise<
        | null
        | {
            path: string;
            items: TodoItem[];
            confirmation: string;
          }
      >;
      saveConversation: (messages: TranscriptMessage[]) => Promise<{
        path: string;
        memory?: {
          updated: boolean;
          path: string;
          reason?: string;
        };
      }>;
      getSettings: () => Promise<AppSettings>;
      updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
      pickTranscriptDirectory: () => Promise<string | null>;
      openSettings: () => Promise<void>;
      closeSettings: () => Promise<void>;
      openDeveloperTools: () => Promise<void>;
      closeDeveloperTools: () => Promise<void>;
      toggleDeveloperPetPreview: () => Promise<{ visible: boolean }>;
      getDeveloperPetPreviewState: () => Promise<{ visible: boolean }>;
      openWindowDevTools: () => Promise<void>;
      isDeveloperToolsEnabled: () => Promise<boolean>;
      getTodos: () => Promise<{ items: TodoItem[]; path: string }>;
      saveTodos: (items: TodoItem[]) => Promise<{ path: string; items: TodoItem[] }>;
      openTodos: () => Promise<void>;
      closeTodos: () => Promise<void>;
      closeMenu: () => Promise<void>;
      setPetMood: (mood: PetMood) => Promise<void>;
      onPetMoodChange: (callback: (mood: PetMood) => void) => () => void;
      onPetGlance: (callback: (direction: PetGlanceDirection) => void) => () => void;
      onUnreadReminderChange: (callback: (hasUnread: boolean) => void) => () => void;
      onPetNotificationCue: (callback: () => void) => () => void;
      onPetMessagePreview: (callback: (payload: { content: string; persistent?: boolean; visible?: boolean; placement?: string }) => void) => () => void;
      onTodoReminder: (callback: (payload: { content: string }) => void) => () => void;
      onChatOpened: (callback: () => void) => () => void;
      onChatAttachmentsQueued: (callback: (payload: { filePaths: string[] }) => void) => () => void;
    };
  }
}
