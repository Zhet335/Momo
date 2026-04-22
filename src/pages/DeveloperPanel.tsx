import { useEffect, useState } from "react";

function formatAudioError(audio: HTMLAudioElement) {
  if (!audio.error) {
    return "unknown audio error";
  }

  const codeMap: Record<number, string> = {
    1: "MEDIA_ERR_ABORTED",
    2: "MEDIA_ERR_NETWORK",
    3: "MEDIA_ERR_DECODE",
    4: "MEDIA_ERR_SRC_NOT_SUPPORTED"
  };

  return `${codeMap[audio.error.code] || "MEDIA_ERR_UNKNOWN"} (${audio.error.code})`;
}

async function resolveNotificationSoundAsset() {
  const desktopPetCompat = window.desktopPet as typeof window.desktopPet & {
    getNotificationSoundAsset?: () => Promise<null | { path: string; mimeType: string; dataUrl: string }>;
  };

  if (typeof desktopPetCompat.getNotificationSoundAsset === "function") {
    const asset = await desktopPetCompat.getNotificationSoundAsset();
    if (asset) {
      return asset;
    }
  }

  const soundPath = await window.desktopPet.getNotificationSoundPath();
  if (!soundPath) {
    return null;
  }

  return {
    path: soundPath,
    mimeType: "audio/mpeg",
    dataUrl: encodeURI(`file:///${soundPath.replace(/\\/g, "/")}`)
  };
}

export function DeveloperPanel() {
  const [status, setStatus] = useState("Waiting for test.");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBubblePinned, setIsBubblePinned] = useState(false);

  useEffect(() => {
    void window.desktopPet.getDeveloperPetPreviewState().then(({ visible }) => {
      setIsBubblePinned(visible);
    });
  }, []);

  const handlePlaySound = async () => {
    setIsPlaying(true);
    try {
      const soundAsset = await resolveNotificationSoundAsset();
      if (!soundAsset) {
        setStatus("Sound asset not found.");
        return;
      }

      const audio = new Audio(soundAsset.dataUrl);
      audio.preload = "auto";
      audio.volume = 0.8;

      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          audio.removeEventListener("canplaythrough", handleCanPlay);
          audio.removeEventListener("error", handleError);
        };

        const handleCanPlay = () => {
          cleanup();
          resolve();
        };

        const handleError = () => {
          cleanup();
          reject(new Error(formatAudioError(audio)));
        };

        audio.addEventListener("canplaythrough", handleCanPlay);
        audio.addEventListener("error", handleError);
        audio.load();
      });

      await audio.play();
      setStatus(
        `Play request sent.\nPath: ${soundAsset.path}\nMIME: ${soundAsset.mimeType}\nData URL length: ${soundAsset.dataUrl.length}`
      );
    } catch (error) {
      setStatus(error instanceof Error ? `Play failed: ${error.message}` : "Play failed.");
    } finally {
      setIsPlaying(false);
    }
  };

  const handleToggleBubblePreview = async () => {
    try {
      const { visible } = await window.desktopPet.toggleDeveloperPetPreview();
      setIsBubblePinned(visible);
      setStatus(visible ? "Sticky pet preview is now visible." : "Sticky pet preview has been hidden.");
    } catch (error) {
      setStatus(error instanceof Error ? `Toggle failed: ${error.message}` : "Toggle failed.");
    }
  };

  return (
    <main className="settings-shell">
      <section className="settings-card developer-card">
        <div className="settings-heading">
          <div className="settings-heading-row window-drag-handle">
            <div>
              <p className="settings-kicker">Developer Tools</p>
              <h1>开发工具</h1>
            </div>
            <button
              type="button"
              className="settings-close"
              onClick={() => {
                void window.desktopPet.closeDeveloperTools();
              }}
              aria-label="关闭开发工具"
            >
              ×
            </button>
          </div>
          <p className="settings-copy">这里用于单独验证通知音效和 Momo 消息气泡的调试能力。</p>
        </div>

        <div className="settings-form developer-form">
          <div className="developer-actions">
            <button type="button" className="primary-button" disabled={isPlaying} onClick={() => void handlePlaySound()}>
              {isPlaying ? "播放中..." : "直接播放通知音效"}
            </button>
            <button type="button" className="secondary-button" onClick={() => void handleToggleBubblePreview()}>
              {isBubblePinned ? "关闭常驻消息气泡" : "显示常驻消息气泡"}
            </button>
            <button type="button" className="secondary-button" onClick={() => void window.desktopPet.openWindowDevTools()}>
              打开 Chromium DevTools
            </button>
          </div>

          <div className="developer-log">
            <p>测试结果</p>
            <code>{status}</code>
          </div>
        </div>
      </section>
    </main>
  );
}
