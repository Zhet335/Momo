import { useEffect, useState } from "react";

export function MenuPanel() {
  const [showDeveloperItem, setShowDeveloperItem] = useState(false);

  useEffect(() => {
    void window.desktopPet.isDeveloperToolsEnabled().then((enabled) => {
      setShowDeveloperItem(Boolean(enabled));
    });
  }, []);

  return (
    <main className="menu-shell">
      <button
        type="button"
        className="menu-item"
        onClick={() => {
          void window.desktopPet.openTodos();
        }}
      >
        <span className="menu-item-title">待办列表</span>
      </button>

      <button
        type="button"
        className="menu-item"
        onClick={() => {
          void window.desktopPet.openSettings();
        }}
      >
        <span className="menu-item-title">设置面板</span>
      </button>

      {showDeveloperItem ? (
        <button
          type="button"
          className="menu-item"
          onClick={() => {
            void window.desktopPet.openDeveloperTools();
          }}
        >
          <span className="menu-item-title">开发者工具</span>
        </button>
      ) : null}
    </main>
  );
}
