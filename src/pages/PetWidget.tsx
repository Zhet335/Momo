import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";

const DRAG_CLICK_THRESHOLD = 3;
const CLICK_THRESHOLD_MS = 100;
type PetMood = "idle" | "engaged" | "thinking" | "happy";
type PetGlanceDirection = "left" | "right" | null;

export function PetWidget() {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const bodyRef = useRef<HTMLSpanElement | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const pointerDownAtRef = useRef(0);
  const draggedRef = useRef(false);
  const previousMoodRef = useRef<PetMood>("idle");
  const moodResetRef = useRef<number | null>(null);
  const glanceResetRef = useRef<number | null>(null);
  const recoverResetRef = useRef<number | null>(null);
  const notificationSoundUrlRef = useRef<string | null>(null);
  const activeNotificationAudioRef = useRef<HTMLAudioElement | null>(null);
  const [dragState, setDragState] = useState({
    active: false
  });
  const [mood, setMood] = useState<PetMood>("idle");
  const [glanceDirection, setGlanceDirection] = useState<PetGlanceDirection>(null);
  const [hasUnreadReminder, setHasUnreadReminder] = useState(false);
  const [isRecoveringFromThinking, setIsRecoveringFromThinking] = useState(false);
  const [hoverActive, setHoverActive] = useState(false);
  const [isDropTargetActive, setIsDropTargetActive] = useState(false);

  const resolveNotificationSoundUrl = async () => {
    const desktopPetCompat = window.desktopPet as typeof window.desktopPet & {
      getNotificationSoundAsset?: () => Promise<null | { path: string; mimeType: string; dataUrl: string }>;
    };

    if (typeof desktopPetCompat.getNotificationSoundAsset === "function") {
      const soundAsset = await desktopPetCompat.getNotificationSoundAsset();
      if (soundAsset?.dataUrl) {
        return soundAsset.dataUrl;
      }
    }

    const soundPath = await window.desktopPet.getNotificationSoundPath();
    return soundPath ? encodeURI(`file:///${soundPath.replace(/\\/g, "/")}`) : null;
  };

  const playNotificationSound = async () => {
    try {
      if (!notificationSoundUrlRef.current) {
        notificationSoundUrlRef.current = await resolveNotificationSoundUrl();
        if (!notificationSoundUrlRef.current) {
          return;
        }
      }

      const audio = new Audio(notificationSoundUrlRef.current);
      audio.preload = "auto";
      audio.volume = 0.8;
      activeNotificationAudioRef.current = audio;
      audio.addEventListener(
        "ended",
        () => {
          if (activeNotificationAudioRef.current === audio) {
            activeNotificationAudioRef.current = null;
          }
        },
        { once: true }
      );
      audio.addEventListener(
        "error",
        () => {
          if (activeNotificationAudioRef.current === audio) {
            activeNotificationAudioRef.current = null;
          }
        },
        { once: true }
      );
      await audio.play();
    } catch {
      // ignore play errors (e.g. device busy / policy)
    }
  };

  useEffect(() => {
    const unsubscribeMood = window.desktopPet.onPetMoodChange((nextMood) => {
      const previousMood = previousMoodRef.current;
      previousMoodRef.current = nextMood;

      if (recoverResetRef.current) {
        window.clearTimeout(recoverResetRef.current);
        recoverResetRef.current = null;
      }

      if (previousMood === "thinking" && nextMood !== "thinking") {
        setIsRecoveringFromThinking(true);
        recoverResetRef.current = window.setTimeout(() => {
          setIsRecoveringFromThinking(false);
          recoverResetRef.current = null;
        }, 420);
      } else if (nextMood === "thinking") {
        setIsRecoveringFromThinking(false);
      }

      if (moodResetRef.current) {
        window.clearTimeout(moodResetRef.current);
        moodResetRef.current = null;
      }

      setMood(nextMood);

      if (nextMood === "happy") {
        moodResetRef.current = window.setTimeout(() => {
          setMood("engaged");
          moodResetRef.current = null;
        }, 5000);
      }
    });

    const unsubscribeGlance = window.desktopPet.onPetGlance((direction) => {
      if (glanceResetRef.current) {
        window.clearTimeout(glanceResetRef.current);
      }

      setGlanceDirection(direction);
      glanceResetRef.current = window.setTimeout(() => {
        setGlanceDirection(null);
        glanceResetRef.current = null;
      }, 1200);
    });

    const unsubscribeUnreadReminder = window.desktopPet.onUnreadReminderChange((hasUnread) => {
      setHasUnreadReminder(hasUnread);
    });
    const unsubscribeNotificationCue = window.desktopPet.onPetNotificationCue(() => {
      void playNotificationSound();
    });
    return () => {
      void window.desktopPet.setPointerPassthrough(false);
      if (moodResetRef.current) {
        window.clearTimeout(moodResetRef.current);
      }
      if (glanceResetRef.current) {
        window.clearTimeout(glanceResetRef.current);
      }
      if (recoverResetRef.current) {
        window.clearTimeout(recoverResetRef.current);
      }
      if (activeNotificationAudioRef.current) {
        activeNotificationAudioRef.current.pause();
        activeNotificationAudioRef.current = null;
      }
      unsubscribeMood();
      unsubscribeGlance();
      unsubscribeUnreadReminder();
      unsubscribeNotificationCue();
    };
  }, []);

  const setPointerPassthrough = (enabled: boolean) => {
    void window.desktopPet.setPointerPassthrough(enabled);
  };

  const isPointInsidePetBody = (clientX: number, clientY: number) => {
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return true;
    }

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radiusX = rect.width / 2;
    const radiusY = rect.height / 2;
    const normalizedX = (clientX - centerX) / radiusX;
    const normalizedY = (clientY - centerY) / radiusY;
    return normalizedX * normalizedX + normalizedY * normalizedY <= 0.985;
  };

  const clearHoverWhenNotDragging = () => {
    if (!dragState.active) {
      setHoverActive(false);
      setPointerPassthrough(false);
    }
  };

  const style = useMemo(() => {
    return {
      "--drag-scale": dragState.active ? 0.96 : 1
    } as CSSProperties;
  }, [dragState]);

  const resetDrag = async (clientX?: number, clientY?: number) => {
    pointerDownRef.current = null;
    setDragState({
      active: false
    });
    const shouldRestoreHover = typeof clientX === "number" && typeof clientY === "number";

    if (shouldRestoreHover) {
      const isInside = isPointInsidePetBody(clientX, clientY);
      setHoverActive(isInside);
      setPointerPassthrough(false);
    } else {
      setHoverActive(false);
      setPointerPassthrough(false);
    }
    buttonRef.current?.blur();

    await window.desktopPet.endDrag();
  };

  return (
    <div className="pet-stage">
      <button
        ref={buttonRef}
        className={`pet-shell pet-shell--anchor-top-left${dragState.active ? " is-dragging" : ""}${hoverActive && !dragState.active ? " is-hovered" : ""}${isRecoveringFromThinking ? " pet-recovering" : ""} pet-mood-${mood}${glanceDirection ? ` pet-glance-${glanceDirection}` : ""}${hasUnreadReminder ? " pet-has-unread" : ""}`}
        style={style}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer.types || []).includes("Files")) {
            event.preventDefault();
            setPointerPassthrough(false);
            setIsDropTargetActive(true);
          }
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
            return;
          }
          setIsDropTargetActive(false);
          clearHoverWhenNotDragging();
        }}
        onDrop={(event) => {
          event.preventDefault();
          setPointerPassthrough(false);
          setIsDropTargetActive(false);
          const droppedPaths = window.desktopPet.resolveDroppedFilePaths(Array.from(event.dataTransfer.files || []));
          if (droppedPaths.length) {
            void window.desktopPet.enqueueChatAttachments(droppedPaths);
          }
        }}
        onClick={() => {
          setPointerPassthrough(false);
          if (!draggedRef.current) {
            void window.desktopPet.toggleChat();
          }
          draggedRef.current = false;
          buttonRef.current?.blur();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setPointerPassthrough(false);
          draggedRef.current = false;
          buttonRef.current?.blur();
          void window.desktopPet.openPetMenu(event.screenX, event.screenY);
        }}
        onPointerDown={(event) => {
          setHoverActive(true);
          setPointerPassthrough(false);
          event.currentTarget.setPointerCapture(event.pointerId);
          pointerDownRef.current = { x: event.screenX, y: event.screenY };
          pointerDownAtRef.current = Date.now();
          draggedRef.current = false;
        }}
        onPointerMove={(event) => {
          if (!pointerDownRef.current) {
            return;
          }

          const movedX = event.screenX - pointerDownRef.current.x;
          const movedY = event.screenY - pointerDownRef.current.y;
          const hasMovement =
            Math.abs(movedX) > DRAG_CLICK_THRESHOLD || Math.abs(movedY) > DRAG_CLICK_THRESHOLD;

          if (hasMovement) {
            if (!dragState.active) {
              setDragState({ active: true });
              void window.desktopPet.startDrag(event.screenX, event.screenY);
            }
            draggedRef.current = true;
          }

          if (dragState.active) {
            void window.desktopPet.moveDrag(event.screenX, event.screenY);
          }
        }}
        onMouseMove={(event) => {
          if (dragState.active) {
            return;
          }

          const isInside = isPointInsidePetBody(event.clientX, event.clientY);
          setHoverActive(isInside);
          setPointerPassthrough(false);
        }}
        onMouseLeave={() => {
          clearHoverWhenNotDragging();
        }}
        onPointerLeave={() => {
          clearHoverWhenNotDragging();
        }}
        onPointerOut={(event) => {
          if (!event.relatedTarget) {
            clearHoverWhenNotDragging();
          }
        }}
        onMouseOut={(event) => {
          if (!event.relatedTarget) {
            clearHoverWhenNotDragging();
          }
        }}
        onBlur={() => {
          clearHoverWhenNotDragging();
        }}
        onPointerUp={(event) => {
          void resetDrag(event.clientX, event.clientY);
        }}
        onPointerCancel={() => {
          void resetDrag();
        }}
      >
        <span ref={bodyRef} className={`pet-body${isDropTargetActive ? " pet-body--drop-target" : ""}`}>
          <span className="pet-glow" aria-hidden="true" />
          <span className="pet-content">
            <span className="pet-face" aria-hidden="true">
              <span className="pet-eyes">
                <span className="pet-eye pet-eye-left">
                  {dragState.active
                    ? ">"
                    : hasUnreadReminder
                      ? "!"
                      : mood === "thinking"
                        ? "-"
                        : mood === "happy"
                          ? "^"
                          : "o"}
                </span>
                <span className="pet-eye pet-eye-right">
                  {dragState.active
                    ? "<"
                    : hasUnreadReminder
                      ? "!"
                      : mood === "thinking"
                        ? "-"
                        : mood === "happy"
                          ? "^"
                          : "o"}
                </span>
              </span>
              <span className="pet-mouth">
                {dragState.active
                  ? "~"
                  : hasUnreadReminder
                    ? "o"
                    : mood === "thinking"
                      ? "o"
                      : mood === "happy"
                        ? "w"
                        : "-"}
              </span>
            </span>
          </span>
        </span>
      </button>
    </div>
  );
}
