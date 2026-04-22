import { useEffect } from "react";
import { ChatPanel } from "./pages/ChatPanel";
import { DeveloperPanel } from "./pages/DeveloperPanel";
import { MenuPanel } from "./pages/MenuPanel";
import { PetBubblePanel } from "./pages/PetBubblePanel";
import { PetWidget } from "./pages/PetWidget";
import { SettingsPanel } from "./pages/SettingsPanel";
import { TodoPanel } from "./pages/TodoPanel";

export function App() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  const pageView =
    view === "chat" || view === "settings" || view === "menu" || view === "todos" || view === "developer" || view === "pet-bubble"
      ? view
      : "pet";

  useEffect(() => {
    document.title = "";
    document.documentElement.dataset.view = pageView;
    document.body.dataset.view = pageView;

    return () => {
      delete document.documentElement.dataset.view;
      delete document.body.dataset.view;
    };
  }, [pageView]);

  if (view === "chat") {
    return <ChatPanel />;
  }

  if (view === "settings") {
    return <SettingsPanel />;
  }

  if (view === "todos") {
    return <TodoPanel />;
  }

  if (view === "menu") {
    return <MenuPanel />;
  }

  if (view === "developer") {
    return <DeveloperPanel />;
  }

  if (view === "pet-bubble") {
    return <PetBubblePanel />;
  }

  return <PetWidget />;
}
