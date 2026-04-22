import { useEffect, useMemo, useRef, useState } from "react";

type TodoItem = {
  id: string;
  title: string;
  dueAt?: string;
  remindMinutesBefore?: number;
  note?: string;
  done: boolean;
};

function createEmptyTodo(): TodoItem {
  return {
    id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: "",
    dueAt: "",
    remindMinutesBefore: undefined,
    note: "",
    done: false
  };
}

function formatForDateTimeInput(value?: string) {
  if (!value) {
    return "";
  }
  return value.includes("T") ? value.slice(0, 16) : value.replace(" ", "T").slice(0, 16);
}

function normalizeDateTimeValue(value: string) {
  return value ? value.replace("T", " ") : "";
}

function normalizePath(input: string) {
  return input.trim().replace(/[\\/]+$/, "");
}

function extractDirectoryFromPath(input: string) {
  const normalized = normalizePath(input);
  if (!normalized) {
    return "";
  }
  if (/\.md$/i.test(normalized)) {
    const lastSlash = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
    return lastSlash > 0 ? normalized.slice(0, lastSlash) : "";
  }
  return normalized;
}

function normalizeTodoFilePathInput(input: string) {
  const normalized = normalizePath(input);
  if (!normalized) {
    return "";
  }
  return /\.md$/i.test(normalized) ? normalized : `${normalized}\\Momo TODO.md`;
}

function normalizeItemsForSave(source: TodoItem[]) {
  return source
    .map((item) => ({
      ...item,
      title: item.title.trim(),
      dueAt: item.dueAt?.trim() || undefined,
      note: item.note?.trim() || undefined,
      remindMinutesBefore: item.remindMinutesBefore ? Number(item.remindMinutesBefore) : undefined
    }))
    .filter((item) => item.title);
}

export function TodoPanel() {
  const [items, setItems] = useState<TodoItem[]>([]);
  const [filePath, setFilePath] = useState("");
  const [pathDraft, setPathDraft] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showCompleted, setShowCompleted] = useState(true);

  const hasHydratedRef = useRef(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const lastSavedSignatureRef = useRef("");

  useEffect(() => {
    let mounted = true;

    void window.desktopPet.getTodos().then((result) => {
      if (!mounted) {
        return;
      }
      const hydratedItems = result.items.length ? result.items : [createEmptyTodo()];
      setItems(hydratedItems);
      setFilePath(result.path);
      setPathDraft(result.path);
      lastSavedSignatureRef.current = JSON.stringify(normalizeItemsForSave(hydratedItems));
      hasHydratedRef.current = true;
    });

    return () => {
      mounted = false;
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!hasHydratedRef.current) {
      return;
    }

    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    const normalizedItems = normalizeItemsForSave(items);
    const nextSignature = JSON.stringify(normalizedItems);
    if (nextSignature === lastSavedSignatureRef.current) {
      return;
    }

    autoSaveTimerRef.current = window.setTimeout(() => {
      void (async () => {
        setIsSaving(true);
        setStatus("");
        try {
          const result = await window.desktopPet.saveTodos(normalizedItems);
          const nextItems = result.items.length ? result.items : [createEmptyTodo()];
          setItems(nextItems);
          setFilePath(result.path);
          setPathDraft(result.path);
          lastSavedSignatureRef.current = JSON.stringify(normalizeItemsForSave(nextItems));
          setStatus("待办已自动保存。");
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "自动保存失败，请稍后再试。");
        } finally {
          setIsSaving(false);
        }
      })();
    }, 420);

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [items]);

  const orderedItems = useMemo(() => {
    return [...items].sort((left, right) => {
      if (left.done !== right.done) {
        return Number(left.done) - Number(right.done);
      }

      if (left.dueAt && right.dueAt) {
        return left.dueAt.localeCompare(right.dueAt);
      }

      if (left.dueAt) {
        return -1;
      }

      if (right.dueAt) {
        return 1;
      }

      return 0;
    });
  }, [items]);

  const visibleItems = useMemo(() => {
    return showCompleted ? orderedItems : orderedItems.filter((item) => !item.done);
  }, [orderedItems, showCompleted]);

  const updateItem = (id: string, patch: Partial<TodoItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const removeItem = (id: string) => {
    setItems((current) => {
      const next = current.filter((item) => item.id !== id);
      return next.length ? next : [createEmptyTodo()];
    });
  };

  const getDueState = (item: TodoItem) => {
    if (item.done) {
      return "已完成";
    }
    if (!item.dueAt) {
      return "未设时间";
    }

    const dueTime = new Date(item.dueAt.replace(" ", "T")).getTime();
    if (Number.isNaN(dueTime)) {
      return "时间待确认";
    }

    const diff = dueTime - Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    if (diff < 0) {
      return "已到时间";
    }
    if (diff <= oneDay) {
      return "今天";
    }
    if (diff <= oneDay * 2) {
      return "明天";
    }
    return "后续安排";
  };

  const handlePathBlur = async () => {
    const targetDirectory = extractDirectoryFromPath(pathDraft);
    const normalizedTodoFilePath = normalizeTodoFilePathInput(pathDraft);
    if (!targetDirectory && !normalizedTodoFilePath) {
      return;
    }

    setIsSaving(true);
    setStatus("");
    try {
      await window.desktopPet.updateSettings({
        transcriptDirectory: targetDirectory || undefined,
        todoFilePath: normalizedTodoFilePath || undefined
      });
      if (normalizedTodoFilePath) {
        setFilePath(normalizedTodoFilePath);
        setPathDraft(normalizedTodoFilePath);
      }
      setStatus("待办文件路径已更新。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "路径更新失败，请稍后再试。");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="settings-shell">
      <section className="settings-card todo-card">
        <div className="settings-heading">
          <div className="settings-heading-row window-drag-handle">
            <div>
              <p className="settings-kicker">Momo Todo</p>
              <h1>待办列表</h1>
            </div>
            <button
              type="button"
              className="settings-close"
              onClick={() => {
                void window.desktopPet.closeTodos();
              }}
              aria-label="关闭待办面板"
            >
              ×
            </button>
          </div>
          <div className="todo-create-bar">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setItems((current) => [...current, createEmptyTodo()]);
              }}
            >
              新建待办
            </button>
            <span className="todo-create-hint">{isSaving ? "自动保存中..." : "修改后自动保存"}</span>
          </div>
          <p className="settings-copy todo-copy">按优先级管理待办。未完成项在前，支持时间与提醒。</p>
        </div>

        <div className="todo-form">
          <div className="todo-main">
            <div className="todo-summary">
              <div className="todo-summary-count">
                <span>当前未完成</span>
                <strong>{items.filter((item) => !item.done && item.title.trim()).length}</strong>
              </div>
              <button
                type="button"
                className="todo-summary-toggle"
                onClick={() => {
                  setShowCompleted((current) => !current);
                }}
              >
                {showCompleted ? "隐藏已完成" : "显示已完成"}
              </button>
            </div>

            <div className="todo-list">
              {visibleItems.map((item) => (
                <article key={item.id} className={`todo-item-card${item.done ? " todo-item-card--done" : ""}`}>
                  <div className="todo-item-head">
                    <label className="todo-check todo-check--card">
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={(event) => updateItem(item.id, { done: event.target.checked })}
                      />
                      <span>{item.done ? "已完成" : "待完成"}</span>
                    </label>

                    <button
                      type="button"
                      className="todo-remove"
                      onClick={() => {
                        removeItem(item.id);
                      }}
                      aria-label="删除这条待办"
                    >
                      删除
                    </button>
                  </div>

                  <div className="todo-item-body">
                    <div className="todo-main-column">
                      <div className="todo-status-row">
                        <span className={`todo-status${item.done ? " todo-status--done" : ""}`}>{getDueState(item)}</span>
                        {item.dueAt ? <span className="todo-due-copy">{item.dueAt}</span> : null}
                      </div>

                      <input
                        className="todo-title-input"
                        value={item.title}
                        onChange={(event) => updateItem(item.id, { title: event.target.value })}
                        placeholder="事项内容"
                      />

                      <div className="todo-meta-row">
                        <label className="todo-field todo-field--calendar">
                          <span>时间</span>
                          <span className="todo-calendar-button" aria-hidden="true">
                            <svg viewBox="0 0 24 24" className="todo-calendar-icon">
                              <path
                                d="M7 3.75a.75.75 0 0 1 .75.75V6h8.5V4.5a.75.75 0 0 1 1.5 0V6h.75A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-9A2.5 2.5 0 0 1 5.5 6h.75V4.5A.75.75 0 0 1 7 3.75Zm11.5 6.75h-13v7a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-7Zm-11-3a1 1 0 0 0-1 1V9h13v-.5a1 1 0 0 0-1-1h-11Z"
                                fill="currentColor"
                              />
                            </svg>
                            <input
                              type="datetime-local"
                              className="todo-calendar-input"
                              value={formatForDateTimeInput(item.dueAt)}
                              onChange={(event) =>
                                updateItem(item.id, { dueAt: normalizeDateTimeValue(event.target.value) })
                              }
                              aria-label="选择待办时间"
                            />
                          </span>
                        </label>

                        <label className="todo-field todo-field--small">
                          <span>提前提醒</span>
                          <input
                            type="number"
                            min="0"
                            value={item.remindMinutesBefore ?? ""}
                            onChange={(event) =>
                              updateItem(item.id, {
                                remindMinutesBefore: event.target.value ? Number(event.target.value) : undefined
                              })
                            }
                            placeholder="到点提醒"
                          />
                        </label>
                      </div>

                      <div className="todo-preset-row">
                        <span>提醒预设</span>
                        {[5, 30].map((minutes) => (
                          <button
                            key={minutes}
                            type="button"
                            className={`todo-preset${item.remindMinutesBefore === minutes ? " todo-preset--active" : ""}`}
                            onClick={() => {
                              updateItem(item.id, { remindMinutesBefore: minutes });
                            }}
                          >
                            {minutes} 分钟
                          </button>
                        ))}
                      </div>
                    </div>

                    <label className="todo-note-column">
                      <span>备注</span>
                      <textarea
                        className="todo-note-input"
                        value={item.note ?? ""}
                        onChange={(event) => updateItem(item.id, { note: event.target.value })}
                        placeholder="留一点补充说明"
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="todo-bottom">
            <label className="todo-path-block">
              <span>待办文件路径（可修改）</span>
              <input
                className="todo-path-input"
                value={pathDraft}
                onChange={(event) => setPathDraft(event.target.value)}
                onBlur={() => void handlePathBlur()}
                placeholder={filePath || "输入目录或完整 md 路径"}
              />
            </label>

            {status ? <p className="settings-status">{status}</p> : null}
          </div>
        </div>
      </section>
    </main>
  );
}
