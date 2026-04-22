import { useEffect, useRef, useState } from "react";

type BubblePlacement = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export function PetBubblePanel() {
  const [bubbleText, setBubbleText] = useState("");
  const [bubblePlacement, setBubblePlacement] = useState<BubblePlacement>("top-left");
  const [isExiting, setIsExiting] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const unsubscribe = window.desktopPet.onPetMessagePreview(({ content, visible, placement }) => {
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      if (visible === false || !content.trim()) {
        setIsExiting(true);
        hideTimerRef.current = window.setTimeout(() => {
          setBubbleText("");
          setIsExiting(false);
          hideTimerRef.current = null;
        }, 320);
        return;
      }

      setIsExiting(false);
      setBubbleText(content);
      setBubblePlacement((placement as BubblePlacement | undefined) || "top-left");
    });

    return () => {
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
      }
      unsubscribe();
    };
  }, []);

  return (
    <div className="pet-preview-stage">
      {bubbleText ? (
        <div
          className={`pet-bubble-cluster pet-bubble-cluster--${bubblePlacement}${isExiting ? " is-exiting" : ""}`}
          aria-live="polite"
        >
          <span className="pet-bubble-tail pet-bubble-tail--large" />
          <span className="pet-bubble-tail pet-bubble-tail--small" />
          <aside className="pet-message-bubble">
            <p>{bubbleText}</p>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
