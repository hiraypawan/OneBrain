"use client";
import { Icon } from "@/components/ui/Icon";
import { useAssistantStore } from "@/store/assistant";
import type { useAssistant } from "@/hooks/useAssistant";
import { unlockAudioOutput } from "@/lib/audio";

type Assistant = ReturnType<typeof useAssistant>;

/**
 * Talking is Today’s other front door, so the microphone control stays on this
 * screen — but as one card, not a rail beside a workspace. `data-testid`s are the
 * contract the browser suite drives (and the reason the compat matrix can assert
 * no microphone is opened without a tap).
 */
export function VoiceCard({
  assistant,
  starting,
  onStart,
  onCancelStart,
  onPocket,
}: {
  assistant: Assistant;
  starting: boolean;
  onStart: () => void;
  onCancelStart: () => void;
  onPocket: () => void;
}) {
  const settings = useAssistantStore((s) => s.settings);
  const updateSettings = useAssistantStore((s) => s.updateSettings);

  return (
    <div className="session-card">
      <div
        className={`voice-mark ${assistant.isActive ? "voice-on" : ""}`}
        aria-hidden="true"
      >
        {[9, 20, 32, 44, 32, 20, 9].map((h, i) => (
          <i key={i} style={{ height: h, animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
      <h2>Prefer to talk?</h2>
      <p className="voice-explainer">
        Speak naturally. OneBrain can answer questions or help you capture a
        thought.
      </p>
      <div className="session-state">
        <span
          className={assistant.isActive ? "status-dot active" : "status-dot"}
        />
        {starting
          ? "Requesting microphone"
          : assistant.isActive
            ? assistant.currentStatus
            : assistant.currentStatus === "paused"
              ? "Paused — microphone released"
              : "Ready when you are"}
      </div>
      <button
        data-testid={assistant.isActive ? "stop-button" : "active-button"}
        className="primary-button"
        onClick={assistant.isActive ? assistant.stopActive : onStart}
        disabled={starting}
      >
        {assistant.isActive
          ? "■  Stop listening"
          : assistant.currentStatus === "paused"
            ? "Resume talking"
            : "Start talking"}
        <Icon name="mic" />
      </button>
      {starting && (
        <button
          className="text-button cancel-start"
          onClick={onCancelStart}
        >
          Cancel microphone start
        </button>
      )}
      <div className="session-options">
        {assistant.isActive && (
          <button className="text-button" onClick={assistant.pauseActive}>
            Pause session
          </button>
        )}
        <button
          className={
            settings.silentMode ? "text-button silent-mode-on" : "text-button"
          }
          aria-pressed={!!settings.silentMode}
          title={
            settings.silentMode
              ? "Silent Mode is ON — answers are text only. Tap to hear them."
              : "Spoken replies are on. Tap to mute them."
          }
          onClick={() => {
            if (settings.silentMode) window.speechSynthesis?.cancel();
            updateSettings({ silentMode: !settings.silentMode });
          }}
        >
          {settings.silentMode
            ? "◌ Silent mode is on — tap to unmute"
            : "◌ Voice replies active — tap to mute"}
        </button>
        {assistant.isActive && (
          <button
            className="text-button"
            onClick={onPocket}
            title="Keep listening with the screen dark to save battery"
          >
            Screen off
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Screen-off listening. The label stays “SCREEN-OFF MODE” rather than a feature
 * name, and the copy refuses to promise the phone will keep listening for us.
 */
export function PocketScreen({
  assistant,
  onExit,
}: {
  assistant: Assistant;
  onExit: () => void;
}) {
  const liveTranscript = useAssistantStore((s) => s.liveTranscript);
  const latest = useAssistantStore((s) =>
    s.messages.filter((m) => m.role === "assistant").slice(-1)[0],
  );
  return (
    <section className="pocket-screen">
      <div className={`listening-line ${assistant.isActive ? "on" : ""}`} />
      <span className="eyebrow">SCREEN-OFF MODE</span>
      <h1>{assistant.isActive ? assistant.currentStatus : "Paused"}</h1>
      <p>
        Background listening depends on your phone and browser. This screen does
        not lock your device.
      </p>
      <div className="pocket-caption" aria-live="polite">
        {liveTranscript ? `Hearing: ${liveTranscript}…` : latest?.content}
      </div>
      <button
        className="primary-button"
        onClick={() => {
          void unlockAudioOutput();
          assistant.stopActive();
          onExit();
        }}
      >
        Stop &amp; return
      </button>
      <button className="text-button" onClick={onExit}>
        Show Today
      </button>
    </section>
  );
}
