import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MessageRole = "assistant" | "user";
type RequestRole = "system" | "assistant" | "user";
type PetMood = "idle" | "engaged" | "thinking" | "happy";
type ChatIntent = "chat" | "local_file_search" | "todo_create" | "todo_rewrite";

type ChatMessage = {
  id: string;
  role: MessageRole;
  content: string;
  entering?: boolean;
  thinking?: boolean;
  reminder?: boolean;
};

type AttachmentItem = {
  path: string;
  name: string;
};

const initialMessages: ChatMessage[] = [
  {
    id: "welcome-1",
    role: "assistant",
    content: "你好，我是 Momo。\n\n我可以陪你聊天、整理思路、记录待办，也可以结合附件内容帮你分析。"
  }
];

const systemPrompt = `你是桌面助理 Momo，请用简洁、温和、可执行的方式回答。
如果用户给出任务，优先给出明确下一步。
如果用户有情绪压力，先共情再给建议。
如果用户提供附件内容，请优先基于附件内容回答。`;

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [inputValue, setInputValue] = useState("");
  const [shiftingIds, setShiftingIds] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveHint, setSaveHint] = useState("");
  const [keepVisibleOnBlur, setKeepVisibleOnBlur] = useState(false);
  const [isOpening, setIsOpening] = useState(true);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isParsingAttachments, setIsParsingAttachments] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const listRef = useRef<HTMLElement | null>(null);
  const timeoutRefs = useRef<number[]>([]);

  useEffect(() => {
    if (!listRef.current) {
      return;
    }
    listRef.current.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [messages]);

  useEffect(() => {
    const unsubscribeReminder = window.desktopPet.onTodoReminder(({ content }) => {
      const reminderId = `todo-reminder-${Date.now()}`;
      const reminderMarkdown = `## Momo 提醒\n\n**请留意这条待办：**\n\n${content}`;

      setMessages((current) => [
        ...current,
        {
          id: reminderId,
          role: "assistant",
          content: reminderMarkdown,
          entering: true,
          reminder: true
        }
      ]);

      const timeoutId = window.setTimeout(() => {
        setMessages((current) =>
          current.map((message) =>
            message.id === reminderId ? { ...message, entering: false } : message
          )
        );
      }, 320);

      timeoutRefs.current.push(timeoutId);
    });

    return () => {
      unsubscribeReminder();
    };
  }, []);

  useEffect(() => {
    void window.desktopPet.getKeepVisibleOnBlur().then((enabled) => {
      setKeepVisibleOnBlur(enabled);
    });

    const clearOpeningSoon = () => {
      setIsOpening(true);
      const timeoutId = window.setTimeout(() => {
        setIsOpening(false);
      }, 300);
      timeoutRefs.current.push(timeoutId);
    };

    clearOpeningSoon();
    const unsubscribeChatOpened = window.desktopPet.onChatOpened(() => {
      clearOpeningSoon();
    });

    return () => {
      unsubscribeChatOpened();
    };
  }, []);

  useEffect(() => {
    return () => {
      timeoutRefs.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      void window.desktopPet.setPetMood("idle");
    };
  }, []);

  useEffect(() => {
    const unsubscribeQueued = window.desktopPet.onChatAttachmentsQueued(({ filePaths }) => {
      appendAttachmentPaths(filePaths);
    });

    void window.desktopPet.consumeQueuedChatAttachments().then(({ filePaths }) => {
      if (filePaths?.length) {
        appendAttachmentPaths(filePaths);
      }
    });

    const handleWindowDragOver = (event: DragEvent) => {
      if (isSending || isParsingAttachments) {
        return;
      }
      if (Array.from(event.dataTransfer?.types || []).includes("Files")) {
        event.preventDefault();
        setIsDragOver(true);
      }
    };

    const handleWindowDrop = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types || []).includes("Files")) {
        return;
      }
      event.preventDefault();
      setIsDragOver(false);
      if (isSending || isParsingAttachments) {
        return;
      }
      const droppedPaths = window.desktopPet.resolveDroppedFilePaths(Array.from(event.dataTransfer?.files || []));
      appendAttachmentPaths(droppedPaths);
    };

    const handleWindowDragLeave = (event: DragEvent) => {
      if (event.relatedTarget) {
        return;
      }
      setIsDragOver(false);
    };

    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("drop", handleWindowDrop);
    window.addEventListener("dragleave", handleWindowDragLeave);

    return () => {
      unsubscribeQueued();
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("drop", handleWindowDrop);
      window.removeEventListener("dragleave", handleWindowDragLeave);
    };
  }, [isSending, isParsingAttachments]);

  const handleToggleKeepVisible = async () => {
    const next = await window.desktopPet.setKeepVisibleOnBlur(!keepVisibleOnBlur);
    setKeepVisibleOnBlur(next);
  };

  const appendAttachmentPaths = (filePaths: string[]) => {
    if (!filePaths.length) {
      return;
    }
    setAttachments((current) => {
      const next = new Map(current.map((item) => [item.path, item]));
      filePaths.forEach((filePath) => {
        next.set(filePath, { path: filePath, name: filePath.split(/[\\/]/).pop() || filePath });
      });
      return Array.from(next.values());
    });
    setSaveState("idle");
    setSaveHint("");
  };

  const handlePickAttachments = async () => {
    if (isSending || isParsingAttachments) {
      return;
    }

    try {
      const picked = await window.desktopPet.pickChatAttachments();
      if (!picked?.length) {
        return;
      }
      appendAttachmentPaths(picked);
    } catch (error) {
      setSaveState("error");
      setSaveHint(error instanceof Error ? error.message : "选择附件失败");
    }
  };

  const handleRemoveAttachment = (filePath: string) => {
    setAttachments((current) => current.filter((item) => item.path !== filePath));
  };

  const messageClassNames = useMemo(() => {
    return new Map(
      messages.map((message) => [
        message.id,
        [
          "message-bubble",
          `message-${message.role}`,
          message.entering ? "message-bubble--enter" : "",
          shiftingIds.includes(message.id) ? "message-bubble--shift" : "",
          message.thinking ? "message-bubble--thinking" : "",
          message.reminder ? "message-bubble--reminder" : ""
        ]
          .filter(Boolean)
          .join(" ")
      ])
    );
  }, [messages, shiftingIds]);

  const pushTimeout = (callback: () => void, delay: number) => {
    const timeoutId = window.setTimeout(callback, delay);
    timeoutRefs.current.push(timeoutId);
  };

  const pulseMood = (mood: PetMood, duration = mood === "happy" ? 5000 : 900) => {
    void window.desktopPet.setPetMood(mood);
    pushTimeout(() => {
      void window.desktopPet.setPetMood("engaged");
    }, duration);
  };

  const clearEnteringFlag = (messageId: string, delay = 320) => {
    pushTimeout(() => {
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId ? { ...message, entering: false } : message
        )
      );
      setShiftingIds([]);
    }, delay);
  };

  const buildRequestMessages = (currentMessages: ChatMessage[], latestUserInput: string) => {
    const history = currentMessages
      .filter((message) => !message.thinking)
      .map((message) => ({
        role: message.role as RequestRole,
        content: message.content
      }));

    return [
      { role: "system" as const, content: systemPrompt },
      ...history,
      { role: "user" as const, content: latestUserInput }
    ];
  };

  const handleSaveConversation = async () => {
    const transcript = messages
      .filter((message) => !message.thinking)
      .map((message) => ({ role: message.role, content: message.content }));

    if (!transcript.length) {
      return;
    }

    setSaveState("saving");
    setSaveHint("");

    try {
      const result = await window.desktopPet.saveConversation(transcript);
      setSaveState("saved");
      const memoryHint = result.memory
        ? result.memory.updated
          ? `，并已更新记忆文件`
          : `，并已检查记忆文件`
        : "";
      setSaveHint(`已保存到 ${result.path}${memoryHint}`);
      pushTimeout(() => {
        setSaveState("idle");
        setSaveHint("");
      }, 2200);
    } catch (error) {
      setSaveState("error");
      setSaveHint(error instanceof Error ? error.message : "保存失败，请稍后再试");
    }
  };

  const sendMessage = async (content: string) => {
    const trimmed = content.trim();
    const pendingAttachments = [...attachments];
    const pendingAttachmentPaths = new Set(pendingAttachments.map((item) => item.path));

    if ((!trimmed && !pendingAttachments.length) || isSending || isParsingAttachments) {
      return;
    }

    const existingIds = messages.map((message) => message.id);
    const userMessageId = `user-${Date.now()}`;
    const thinkingMessageId = `thinking-${Date.now() + 1}`;
    const currentMessages = messages;
    const userVisibleText =
      trimmed || (pendingAttachments.length ? "帮我读取这些附件，并总结重点。" : "");
    const attachmentInlineNote = pendingAttachments.length
      ? `\n\n[附件] ${pendingAttachments.map((item) => item.name).join("、")}`
      : "";
    let requestUserInput = userVisibleText;

    setIsSending(true);
    setSaveState("idle");
    setSaveHint("");
    void window.desktopPet.setPetMood("engaged");
    setShiftingIds(existingIds);
    setMessages((current) => [
      ...current,
      {
        id: userMessageId,
        role: "user",
        content: `${userVisibleText}${attachmentInlineNote}`,
        entering: true
      }
    ]);
    setInputValue("");
    setAttachments([]);
    clearEnteringFlag(userMessageId);

    if (pendingAttachments.length) {
      setIsParsingAttachments(true);
      setSaveHint("正在解析附件...");

      try {
        const parsedResult = await window.desktopPet.parseChatAttachments(
          pendingAttachments.map((item) => item.path)
        );

        const parsedSections = parsedResult.parsed.map((item, index) => {
          const title = `[${index + 1}] ${item.name} (${item.kind})`;
          return `${title}\n${item.text || "[未解析到内容]"}`;
        });

        if (parsedSections.length) {
          requestUserInput = `${requestUserInput}

请基于附件做分析并直接给结论。
除非我明确要求“原文 / 全文 / 逐字内容 / OCR结果”，否则不要整段输出识别文本，只引用必要短句。

以下是附件内容：

${parsedSections.join("\n\n----\n\n")}`;
        }

        if (parsedResult.failed.length) {
          setSaveState("error");
          setSaveHint(`有 ${parsedResult.failed.length} 个附件解析失败，已跳过。`);
        } else {
          setSaveHint("");
        }
      } catch (error) {
        setSaveState("error");
        setSaveHint(error instanceof Error ? error.message : "附件解析失败");
      } finally {
        setIsParsingAttachments(false);
      }
    }

    if (!requestUserInput.trim()) {
      setIsSending(false);
      return;
    }

    let intent: ChatIntent = "chat";
    try {
      if (trimmed) {
        const intentResult = await window.desktopPet.classifyChatIntent(trimmed);
        intent = intentResult.intent;
      }

      if (intent === "todo_rewrite") {
        const rewriteResult = await window.desktopPet.rewriteTodosFromMessage(trimmed);
        if (rewriteResult) {
          const replyMessageId = `assistant-todo-rewrite-${Date.now() + 2}`;
          setShiftingIds((current) => [...current, userMessageId]);
          setMessages((current) => [
            ...current,
            {
              id: replyMessageId,
              role: "assistant",
              content: rewriteResult.confirmation,
              entering: true
            }
          ]);
          pulseMood("happy");
          clearEnteringFlag(replyMessageId);
          setIsSending(false);
          return;
        }
      }

      if (intent === "todo_create") {
        const todoResult = await window.desktopPet.addTodoFromMessage(trimmed);
        if (todoResult) {
          const replyMessageId = `assistant-todo-${Date.now() + 2}`;
          setShiftingIds((current) => [...current, userMessageId]);
          setMessages((current) => [
            ...current,
            {
              id: replyMessageId,
              role: "assistant",
              content: todoResult.confirmation,
              entering: true
            }
          ]);
          pulseMood("happy");
          clearEnteringFlag(replyMessageId);
          setIsSending(false);
          return;
        }
      }
    } catch {
      // ignore and continue with chat
    }

    pushTimeout(() => {
      void window.desktopPet.setPetMood("thinking");
      setShiftingIds((current) => [...current, ...existingIds, userMessageId]);
      setMessages((current) => [
        ...current,
        {
          id: thinkingMessageId,
          role: "assistant",
          content: "我在想一下哦...",
          entering: true,
          thinking: true
        }
      ]);
      clearEnteringFlag(thinkingMessageId, 240);
    }, 180);

    try {
      const reply = await window.desktopPet.sendChatMessage(
        buildRequestMessages(currentMessages, requestUserInput)
      );

      setShiftingIds((current) => [...current, userMessageId, thinkingMessageId]);
      const replyMessageId = `assistant-${Date.now() + 2}`;

      setMessages((current) => {
        const withoutThinking = current.filter((message) => message.id !== thinkingMessageId);
        return [
          ...withoutThinking,
          {
            id: replyMessageId,
            role: "assistant",
            content: reply,
            entering: true
          }
        ];
      });
      pulseMood("happy");
      clearEnteringFlag(replyMessageId);
    } catch (error) {
      const replyMessageId = `assistant-error-${Date.now() + 3}`;
      const errorMessage =
        error instanceof Error ? error.message : "调用接口失败，请稍后再试。";

      setShiftingIds((current) => [...current, userMessageId, thinkingMessageId]);
      setMessages((current) => {
        const withoutThinking = current.filter((message) => message.id !== thinkingMessageId);
        return [
          ...withoutThinking,
          {
            id: replyMessageId,
            role: "assistant",
            content: `出了点小问题：${errorMessage}`,
            entering: true
          }
        ];
      });
      pulseMood("engaged", 700);
      clearEnteringFlag(replyMessageId);
    } finally {
      if (pendingAttachmentPaths.size) {
        setAttachments((current) =>
          current.filter((item) => !pendingAttachmentPaths.has(item.path))
        );
      }
      setIsSending(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage(inputValue);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(inputValue);
    }
  };

  const handleDragOver: React.DragEventHandler<HTMLElement> = (event) => {
    if (isSending || isParsingAttachments) {
      return;
    }
    if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault();
      setIsDragOver(true);
    }
  };

  const handleDragLeave: React.DragEventHandler<HTMLElement> = (event) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsDragOver(false);
  };

  const handleDrop: React.DragEventHandler<HTMLElement> = (event) => {
    event.preventDefault();
    setIsDragOver(false);
    if (isSending || isParsingAttachments) {
      return;
    }
    const droppedPaths = window.desktopPet.resolveDroppedFilePaths(Array.from(event.dataTransfer.files || []));
    appendAttachmentPaths(droppedPaths);
  };

  return (
    <main
      className={`chat-shell${isOpening ? " chat-shell--opening" : ""}${isDragOver ? " chat-shell--dragover" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <button
        type="button"
        className={`chat-pin-toggle${keepVisibleOnBlur ? " is-active" : ""}`}
        onClick={() => void handleToggleKeepVisible()}
        title={keepVisibleOnBlur ? "失焦不消失：已开启" : "失焦不消失：已关闭"}
      >
        📌
      </button>

      <header className="chat-toolbar window-drag-handle">
        <div className="chat-toolbar-copy">
          <p className="chat-kicker">Momo Chat</p>
          <span>会结合最近对话和待办事项来帮你推进事情</span>
        </div>
        <button
          type="button"
          className={`toolbar-button toolbar-button--${saveState}`}
          onClick={() => void handleSaveConversation()}
          disabled={saveState === "saving"}
        >
          {saveState === "saving" ? "保存中" : "保存对话"}
        </button>
      </header>

      {saveHint ? <p className="chat-hint">{saveHint}</p> : null}

      <section className="chat-attachments">
        <button
          type="button"
          className="chat-attachment-trigger"
          onClick={() => void handlePickAttachments()}
          disabled={isSending || isParsingAttachments}
        >
          {isParsingAttachments ? "解析中..." : "附件"}
        </button>
        <div className="chat-attachment-list">
          {attachments.map((item) => (
            <button
              key={item.path}
              type="button"
              className="chat-attachment-chip"
              title={item.path}
              onClick={() => handleRemoveAttachment(item.path)}
              disabled={isSending || isParsingAttachments}
            >
              {item.name} ×
            </button>
          ))}
        </div>
        {isDragOver ? <span className="chat-drop-hint">松手即可交给 Momo 处理</span> : null}
      </section>

      <section ref={listRef} className="message-list">
        {messages.map((message) => (
          <article key={message.id} className={messageClassNames.get(message.id)}>
            <div className="message-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          </article>
        ))}
      </section>

      <form className="chat-input-row" onSubmit={handleSubmit}>
        <input
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onFocus={() => void window.desktopPet.setPetMood("engaged")}
          onBlur={() => {
            if (!isSending) {
              void window.desktopPet.setPetMood("idle");
            }
          }}
          onKeyDown={handleInputKeyDown}
          placeholder="输入你想说的话..."
          disabled={isSending || isParsingAttachments}
        />
        <button
          type="submit"
          disabled={isSending || isParsingAttachments || (!inputValue.trim() && !attachments.length)}
        >
          {isSending ? "稍等" : "发送"}
        </button>
      </form>
    </main>
  );
}
