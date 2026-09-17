"use client";
import { Overlay, CAPTURE_KINDS } from "@/components/workspace/ItemSheet";
import type { CaptureDraft, ItemKind } from "@/lib/workspace/model";

/**
 * The review sheet between “I typed/said this” and “it is saved”. Nothing is
 * written before this dialog is confirmed, which is the whole reason the composer
 * has a Review button instead of a Save button.
 */
export function DraftReview({
  drafts,
  setDrafts,
  notice,
  busy,
  memoryEnabled,
  close,
  onSave,
}: {
  drafts: CaptureDraft[];
  setDrafts: (drafts: CaptureDraft[]) => void;
  notice: string;
  busy: boolean;
  memoryEnabled: boolean;
  close: () => void;
  onSave: () => void;
}) {
  return (
    <Overlay notice={notice} title="Review your capture" close={close}>
      <p className="sheet-description">
        Nothing is saved yet. Check the type, words, and date. Each line in a
        brain dump is a separate proposed item; no hidden AI extraction.
      </p>
      {drafts.map((d, index) => (
        <div className="draft-editor" key={index}>
          <label>
            Type
            <select
              value={d.kind}
              onChange={(e) =>
                setDrafts(
                  drafts.map((x, i) =>
                    i === index ? { ...x, kind: e.target.value as ItemKind } : x,
                  ),
                )
              }
            >
              {CAPTURE_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Title
            <input
              value={d.title}
              maxLength={120}
              onChange={(e) =>
                setDrafts(
                  drafts.map((x, i) =>
                    i === index ? { ...x, title: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <label>
            Original capture
            <textarea
              value={d.body}
              maxLength={6000}
              onChange={(e) =>
                setDrafts(
                  drafts.map((x, i) =>
                    i === index ? { ...x, body: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <label>
            Due date (optional)
            <input
              type="datetime-local"
              onChange={(e) =>
                setDrafts(
                  drafts.map((x, i) =>
                    i === index
                      ? {
                          ...x,
                          due:
                            e.target.value &&
                            Number.isFinite(Date.parse(e.target.value))
                              ? new Date(e.target.value).toISOString()
                              : e.target.value || undefined,
                        }
                      : x,
                  ),
                )
              }
            />
          </label>
          {["expense", "payment"].includes(d.kind) && (
            <div className="settings-grid">
              <label>
                Amount (review before saving)
                <input
                  type="number"
                  min="0"
                  max="1000000000000"
                  step="0.01"
                  value={d.amount ?? ""}
                  onChange={(e) =>
                    setDrafts(
                      drafts.map((x, i) =>
                        i === index
                          ? {
                              ...x,
                              amount:
                                e.target.value === ""
                                  ? undefined
                                  : Number(e.target.value),
                              currency: x.currency || "INR",
                            }
                          : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Currency
                <select
                  value={d.currency || "INR"}
                  onChange={(e) =>
                    setDrafts(
                      drafts.map((x, i) =>
                        i === index ? { ...x, currency: e.target.value } : x,
                      ),
                    )
                  }
                >
                  {["INR", "USD", "EUR"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <button
            className="text-button"
            onClick={() => setDrafts(drafts.filter((_, i) => i !== index))}
          >
            Remove this item
          </button>
        </div>
      ))}
      <div className="sheet-actions">
        <button onClick={close}>Discard</button>
        <button
          className="primary-button"
          disabled={busy || !drafts.length || drafts.some((d) => !d.title.trim())}
          onClick={onSave}
        >
          {busy
            ? "Saving…"
            : `Save ${drafts.length} item${drafts.length === 1 ? "" : "s"}`}
        </button>
      </div>
      <p className="sheet-footnote">
        {memoryEnabled
          ? "Saved on this device only — no external app is written to."
          : "Memory is off: this stays in the session and disappears on reload."}
      </p>
    </Overlay>
  );
}
