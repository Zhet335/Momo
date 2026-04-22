"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const electronCompat = require("electron");
electron_1.contextBridge.exposeInMainWorld("desktopPet", {
    toggleChat: () => electron_1.ipcRenderer.invoke("pet:toggle-chat"),
    openPetMenu: (screenX, screenY) => electron_1.ipcRenderer.invoke("pet:open-menu", { screenX, screenY }),
    startDrag: (pointerX, pointerY) => electron_1.ipcRenderer.invoke("pet:drag-start", { pointerX, pointerY }),
    moveDrag: (pointerX, pointerY) => electron_1.ipcRenderer.invoke("pet:drag-move", { pointerX, pointerY }),
    endDrag: () => electron_1.ipcRenderer.invoke("pet:drag-end"),
    setPointerPassthrough: (enabled) => electron_1.ipcRenderer.invoke("pet:set-pointer-passthrough", { enabled }),
    getCursorScreenPoint: () => electron_1.ipcRenderer.invoke("pet:get-cursor-screen-point"),
    getNotificationSoundPath: () => electron_1.ipcRenderer.invoke("pet:get-notification-sound-path"),
    getNotificationSoundAsset: () => electron_1.ipcRenderer.invoke("pet:get-notification-sound-asset"),
    getKeepVisibleOnBlur: () => electron_1.ipcRenderer.invoke("chat:get-keep-visible-on-blur"),
    setKeepVisibleOnBlur: (enabled) => electron_1.ipcRenderer.invoke("chat:set-keep-visible-on-blur", { enabled }),
    sendChatMessage: (messages) => electron_1.ipcRenderer.invoke("chat:send-message", { messages }),
    classifyChatIntent: (content) => electron_1.ipcRenderer.invoke("chat:classify-intent", { content }),
    resolveDroppedFilePaths: (files) => files
        .map((file) => {
        try {
            if (typeof electronCompat.webUtils?.getPathForFile === "function") {
                return electronCompat.webUtils.getPathForFile(file);
            }
            return file.path || "";
        }
        catch {
            return file.path || "";
        }
    })
        .filter(Boolean),
    ocrScreenText: () => electron_1.ipcRenderer.invoke("screen:ocr-text"),
    pickChatAttachments: () => electron_1.ipcRenderer.invoke("chat:pick-attachments"),
    parseChatAttachments: (filePaths) => electron_1.ipcRenderer.invoke("chat:parse-attachments", { filePaths }),
    enqueueChatAttachments: (filePaths) => electron_1.ipcRenderer.invoke("chat:enqueue-attachments", { filePaths }),
    consumeQueuedChatAttachments: () => electron_1.ipcRenderer.invoke("chat:consume-queued-attachments"),
    addTodoFromMessage: (content) => electron_1.ipcRenderer.invoke("chat:add-todo-from-message", { content }),
    rewriteTodosFromMessage: (content) => electron_1.ipcRenderer.invoke("chat:rewrite-todos-from-message", { content }),
    saveConversation: (messages) => electron_1.ipcRenderer.invoke("chat:save-conversation", { messages }),
    getSettings: () => electron_1.ipcRenderer.invoke("settings:get"),
    updateSettings: (settings) => electron_1.ipcRenderer.invoke("settings:update", settings),
    pickTranscriptDirectory: () => electron_1.ipcRenderer.invoke("settings:pick-transcript-directory"),
    openSettings: () => electron_1.ipcRenderer.invoke("settings:open"),
    closeSettings: () => electron_1.ipcRenderer.invoke("settings:close"),
    openDeveloperTools: () => electron_1.ipcRenderer.invoke("developer:open"),
    closeDeveloperTools: () => electron_1.ipcRenderer.invoke("developer:close"),
    toggleDeveloperPetPreview: () => electron_1.ipcRenderer.invoke("developer:toggle-pet-preview"),
    getDeveloperPetPreviewState: () => electron_1.ipcRenderer.invoke("developer:get-pet-preview-state"),
    openWindowDevTools: () => electron_1.ipcRenderer.invoke("developer:open-devtools"),
    isDeveloperToolsEnabled: () => electron_1.ipcRenderer.invoke("app:is-devtools-enabled"),
    getTodos: () => electron_1.ipcRenderer.invoke("todo:get"),
    saveTodos: (items) => electron_1.ipcRenderer.invoke("todo:save", { items }),
    openTodos: () => electron_1.ipcRenderer.invoke("todo:open"),
    closeTodos: () => electron_1.ipcRenderer.invoke("todo:close"),
    closeMenu: () => electron_1.ipcRenderer.invoke("menu:close"),
    setPetMood: (mood) => electron_1.ipcRenderer.invoke("pet:set-mood", { mood }),
    onPetMoodChange: (callback) => {
        const listener = (_event, mood) => callback(mood);
        electron_1.ipcRenderer.on("pet:mood-changed", listener);
        return () => {
            electron_1.ipcRenderer.removeListener("pet:mood-changed", listener);
        };
    },
    onPetGlance: (callback) => {
        const listener = (_event, direction) => callback(direction);
        electron_1.ipcRenderer.on("pet:glance", listener);
        return () => {
            electron_1.ipcRenderer.removeListener("pet:glance", listener);
        };
    },
    onUnreadReminderChange: (callback) => {
        const listener = (_event, hasUnread) => callback(hasUnread);
        electron_1.ipcRenderer.on("pet:unread-reminder", listener);
        return () => {
            electron_1.ipcRenderer.removeListener("pet:unread-reminder", listener);
        };
    },
    onPetNotificationCue: (callback) => {
        const listener = () => callback();
        electron_1.ipcRenderer.on("pet:play-notification-cue", listener);
        return () => {
            electron_1.ipcRenderer.removeListener("pet:play-notification-cue", listener);
        };
    },
    onPetMessagePreview: (callback) => {
        const listener = (_event, payload) => callback(payload);
        electron_1.ipcRenderer.on("pet:message-preview", listener);
        return () => {
            electron_1.ipcRenderer.removeListener("pet:message-preview", listener);
        };
    },
    onTodoReminder: (callback) => {
        const listener = (_event, payload) => callback(payload);
        electron_1.ipcRenderer.on("chat:todo-reminder", listener);
        return () => {
            electron_1.ipcRenderer.removeListener("chat:todo-reminder", listener);
        };
    },
    onChatOpened: (callback) => {
        const listener = () => callback();
        electron_1.ipcRenderer.on("chat:opened", listener);
        return () => {
            electron_1.ipcRenderer.removeListener("chat:opened", listener);
        };
    },
    onChatAttachmentsQueued: (callback) => {
        const listener = (_event, payload) => callback(payload);
        electron_1.ipcRenderer.on("chat:attachments-queued", listener);
        return () => {
            electron_1.ipcRenderer.removeListener("chat:attachments-queued", listener);
        };
    }
});
