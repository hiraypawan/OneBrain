"use client";
import { Icon } from "@/components/ui/Icon";
import { CAPTURE_KINDS } from "@/components/workspace/ItemSheet";
import type { ItemKind } from "@/lib/workspace/model";

export type ComposerKind = ItemKind | "dump" | "ask";

/**
 * The one input Today offers. Same contract as the workspace composer it came
 * from — “Save a thought” versus “Ask OneBrain”, an explicit type for the
 * review sheet, ⌘/Ctrl+Enter, and nothing saved without the review dialog.
 */
export function CaptureComposer({
  kind,
  onKind,
  input,
  onInput,
  onCompose,
  ready,
  busy,
  firstTime,
}: {
  kind: ComposerKind;
  onKind: (kind: ComposerKind) => void;
  input: string;
  onInput: (value: string) => void;
  onCompose: () => void;
  ready: boolean;
  busy: boolean;
  /** No saved records yet — the two example chips are for that moment only. */
  firstTime: boolean;
}) {
  const focusInput = () => document.getElementById("capture-input")?.focus();
  return (
    <section className="capture-composer">
      <div className="composer-top">
        <div
          className="composer-intents"
          role="group"
          aria-label="What would you like to do?"
        >
          <button
            type="button"
            aria-pressed={kind !== "ask"}
            onClick={() => onKind("note")}
          >
            <Icon name="note" />
            Save a thought
          </button>
          <button
            type="button"
            aria-label="Choose question mode"
            aria-pressed={kind === "ask"}
            onClick={() => onKind("ask")}
          >
            <Icon name="help" />
            Ask OneBrain
          </button>
        </div>
        <label className="capture-type-label">
          <span>Type</span>
          <select
            aria-label="Capture type"
            value={kind}
            onChange={(e) => onKind(e.target.value as ComposerKind)}
          >
            {CAPTURE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k[0].toUpperCase() + k.slice(1)}
              </option>
            ))}
            <option value="dump">Brain dump</option>
            <option value="ask">Question</option>
          </select>
        </label>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onCompose();
        }}
      >
        <textarea
          id="capture-input"
          aria-label="Capture a thought"
          placeholder={
            kind === "dump"
              ? "One thought per line. Try “task: Send the proposal” or “idea: A referral offer”."
              : kind === "ask"
                ? "Ask a question, search memory, or try “15% of 60000”…"
                : "What would you like to remember?"
          }
          value={input}
          maxLength={6000}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={(e) => {
            if (
              (e.metaKey || e.ctrlKey) &&
              e.key === "Enter" &&
              !e.nativeEvent.isComposing &&
              ready &&
              !busy
            ) {
              e.preventDefault();
              onCompose();
            }
          }}
          rows={2}
        />
        <button
          className="send-button"
          aria-label={kind === "ask" ? "Ask OneBrain" : "Review capture"}
          disabled={!input.trim() || !ready || busy}
          type="submit"
        >
          <span>{kind === "ask" ? "Ask" : "Review"}</span>
          <Icon name="arrow" />
        </button>
      </form>
      <div className="composer-bottom">
        <span>
          {kind === "ask"
            ? "General questions may use an external AI provider."
            : "Review before saving · no external AI needed"}
        </span>
        <span className="composer-keyboard-hint">Ctrl / ⌘ + Enter</span>
      </div>
      {firstTime && (
        <div className="first-thought">
          <span>Not sure where to start?</span>
          <button
            onClick={() => {
              onKind("note");
              onInput("An idea I want to come back to: ");
              focusInput();
            }}
          >
            Try a note
            <Icon name="arrow" />
          </button>
          <button
            onClick={() => {
              onKind("task");
              onInput("Send the project proposal");
              focusInput();
            }}
          >
            Try a task
            <Icon name="arrow" />
          </button>
        </div>
      )}
      <ol className="capture-steps" aria-label="How OneBrain works">
        <li aria-current={!input.trim() && firstTime ? "step" : undefined}>
          <span>1</span>Write or speak
        </li>
        <li aria-current={input.trim() ? "step" : undefined}>
          <span>2</span>Review &amp; save
        </li>
        <li aria-current={!input.trim() && !firstTime ? "step" : undefined}>
          <span>3</span>Find it in Space
        </li>
      </ol>
    </section>
  );
}
