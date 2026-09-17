"use client";
import { useAssistantStore } from "@/store/assistant";
import type { useAssistant } from "@/hooks/useAssistant";

type Assistant = ReturnType<typeof useAssistant>;

const PROVIDER_LABELS: Record<string, string> = {
  gemini: "Gemini",
  pollinations: "Community AI",
  puter: "Puter AI",
  wikipedia: "Wikipedia",
  offline: "Offline mode",
  "key-error": "Key issue",
  server: "Server",
};

/**
 * Everything the assistant says out loud on Today, in one file: the answer, the
 * live caption, notices, and the three review cards (proactive ask, shared
 * upload, spoken capture). They are separate components because Today is a brief
 * now — the page should read as a list of small blocks, not one giant render tree.
 */
export function AnswerBlock({ latest }: { latest?: { content: string } }) {
  const lastProvider = useAssistantStore((s) => s.lastProvider);
  if (!latest) return null;
  return (
    <section
      className="answer-inline"
      aria-label="OneBrain response"
      aria-live="polite"
    >
      <div>
        <span className="answer-mark">ob.</span>
        <h2>OneBrain</h2>
      </div>
      <p>{latest.content}</p>
      {lastProvider && (
        <p
          className={`provider-badge${lastProvider === "offline" ? " is-offline" : ""}`}
          data-testid="provider-badge"
        >
          {lastProvider === "offline"
            ? "Offline answer \u2014 add a free Gemini key in Settings \u2192 Advanced for smarter replies."
            : `Answered by ${PROVIDER_LABELS[lastProvider] || lastProvider}`}
        </p>
      )}
      <small>AI answers can be wrong. Check important information.</small>
    </section>
  );
}

export function LiveCaption({ assistant }: { assistant: Assistant }) {
  const liveTranscript = useAssistantStore((s) => s.liveTranscript);
  if (!liveTranscript || !assistant.isActive) return null;
  return (
    <p
      className="live-caption"
      role="status"
      aria-live="polite"
      data-testid="live-caption"
    >
      <span className="live-dot" aria-hidden="true" />
      Hearing: {liveTranscript}…
    </p>
  );
}

export function PendingAnswer() {
  const currentStatus = useAssistantStore((s) => s.currentStatus);
  if (currentStatus !== "processing") return null;
  return (
    <p className="answer-pending" role="status">
      Working on your question…
    </p>
  );
}

export function VoiceNoticeBar({ assistant }: { assistant: Assistant }) {
  if (!assistant.voiceNotice) return null;
  return (
    <div className="workspace-notice voice-notice" role="status">
      <span>{assistant.voiceNotice}</span>
      {assistant.hasReplay && (
        <button
          className="text-button"
          onClick={() => void assistant.replayLastReply()}
        >
          Hear it
        </button>
      )}
      <button
        className="text-button"
        onClick={() => assistant.clearVoiceNotice()}
      >
        Dismiss
      </button>
    </div>
  );
}

/** One status line for local saves, storage trouble and the microphone. */
export function NoticeStrip({
  notice,
  workspaceError,
  busy,
  onReload,
  onDismiss,
}: {
  notice: string;
  workspaceError: string | null;
  busy: boolean;
  onReload: () => void;
  onDismiss: () => void;
}) {
  const storageNotice = useAssistantStore((s) => s.storageNotice);
  const micNotice = useAssistantStore((s) => s.micNotice);
  const memoryEnabled = useAssistantStore((s) => s.settings.memoryEnabled);
  const text = notice || workspaceError || storageNotice || micNotice;
  if (!text) return null;
  return (
    <>
      <div className="workspace-notice" role="status">
        {text}
        {workspaceError || /another tab|Reload the workspace/.test(notice) ? (
          <button className="text-button" disabled={busy} onClick={onReload}>
            Reload workspace
          </button>
        ) : null}
        <button onClick={onDismiss} aria-label="Dismiss notice">
          ×
        </button>
      </div>
      {!memoryEnabled && (
        <p className="privacy-strip">
          Memory is off. New workspace changes stay in this session and are lost
          on reload.
        </p>
      )}
    </>
  );
}

/** The three “confirm before it happens” cards. Each is a decision, not a toast. */
export function ReviewCards({ assistant }: { assistant: Assistant }) {
  const { proactiveInvitation, sharedPreview, capturePreview } = assistant;
  const ask = (text: string) => void assistant.handleTranscript(text);
  return (
    <>
      {proactiveInvitation && (
        <section className="proactive-card" aria-live="polite">
          <span className="eyebrow">ONE QUESTION — ONLY IF YOU WANT IT</span>
          <p>{proactiveInvitation.permission}</p>
          <small>{proactiveInvitation.reason}</small>
          <div>
            <button onClick={() => ask("yes")}>Go ahead</button>
            <button onClick={() => ask("not now")}>Not now · pause 30 min</button>
            <button onClick={() => ask("stop asking")}>Turn off</button>
          </div>
        </section>
      )}
      {sharedPreview && (
        <section className="proactive-card" aria-label="Review shared upload">
          <span className="eyebrow">REVIEW SHARED UPLOAD · NOT DEVICE-LOCAL</span>
          <p>
            {sharedPreview.kind}: {sharedPreview.title}
          </p>
          <small>
            Destination: {sharedPreview.spaceName}. Members will be able to read
            this. A reminder is saved only as an action draft, not an approved
            schedule.
          </small>
          <div>
            <button onClick={() => ask("save shared")}>Save shared</button>
            <button onClick={() => ask("cancel")}>Discard upload</button>
            <a href="/control?panel=shared">Open Operations ↗</a>
          </div>
        </section>
      )}
      {capturePreview && (
        <section className="proactive-card">
          <span className="eyebrow">REVIEW WHAT YOU SAID</span>
          {capturePreview.map((d, i) => (
            <p key={i}>
              {d.kind}: {d.title}
            </p>
          ))}
          <small>
            Dates and relationships are not inferred. Open the saved item to set
            them.
          </small>
          <div>
            <button onClick={() => ask("save")}>Save on this device</button>
            <button onClick={() => ask("cancel")}>Discard</button>
          </div>
        </section>
      )}
    </>
  );
}
