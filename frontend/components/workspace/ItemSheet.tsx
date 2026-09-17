"use client";
import { useEffect, useRef, useState, useId } from "react";
import { Icon } from "@/components/ui/Icon";
import type { BrainItem, ItemKind } from "@/lib/workspace/model";

/**
 * The dialog primitives Today and Your space share, extracted when Today became
 * a brief (2026-09-17) so the record browser that moved to `/control?panel=notes`
 * edits the very same sheet Today opens from “recently saved” — one editor, two
 * doors, no second copy of the form to keep in sync.
 */

/** Item kinds a person can capture. Kept in one place because Today’s composer,
 *  the review sheet and the Space notes filter all list them in the same order. */
export const CAPTURE_KINDS: ItemKind[] = [
  "note",
  "task",
  "idea",
  "person",
  "project",
  "decision",
  "expense",
  "payment",
  "shopping",
  "habit",
];

export function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Overlay({
  title,
  children,
  close,
  notice,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
  notice?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    el?.showModal();
    return () => {
      el?.close();
      queueMicrotask(() => {
        if (trigger?.isConnected && !document.querySelector("dialog[open]"))
          trigger.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="brain-dialog"
      aria-labelledby={titleId}
      onCancel={close}
      onClick={(e) => {
        const rect = ref.current?.getBoundingClientRect();
        if (
          e.target === ref.current &&
          rect &&
          (e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom)
        )
          close();
      }}
    >
      <div className="sheet-heading">
        <div>
          <span className="eyebrow">ONEBRAIN</span>
          <h2 id={titleId}>{title}</h2>
        </div>
        <button
          aria-label="Close dialog"
          onClick={close}
          className="icon-button"
        >
          ×
        </button>
      </div>
      {notice && (
        <p role="status" className="workspace-notice">
          {notice}
        </p>
      )}
      {children}
    </dialog>
  );
}


export function ItemDetail({
  item,
  items,
  close,
  save,
  remove,
  busy,
  notice,
}: {
  notice: string;
  item: BrainItem;
  items: BrainItem[];
  close: () => void;
  save: (patch: Partial<BrainItem>) => void;
  remove: () => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState(item.title),
    [body, setBody] = useState(item.body),
    [links, setLinks] = useState(item.links);
  const localDate =
    item.due && Number.isFinite(Date.parse(item.due))
      ? new Date(
          Date.parse(item.due) - new Date(item.due).getTimezoneOffset() * 60000,
        )
          .toISOString()
          .slice(0, 16)
      : "";
  const [due, setDue] = useState(localDate),
    [amount, setAmount] = useState(String(item.amount ?? "")),
    [currency, setCurrency] = useState(item.currency || "INR");
  return (
    <Overlay notice={notice} title="The full context" close={close}>
      <div className="item-detail">
        <span className="receipt-status">
          {item.kind} · {item.status}
        </span>
        <label>
          Title
          <input
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Source / notes
          <textarea
            rows={4}
            value={body}
            maxLength={6000}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <label>
          Due date
          <input
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </label>
        {["expense", "payment"].includes(item.kind) && (
          <div className="settings-grid">
            <label>
              Amount
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              Currency
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {["INR", "USD", "EUR"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        <fieldset>
          <legend>Explicitly related items</legend>
          {items
            .filter((i) => i.id !== item.id)
            .map((other) => (
              <label className="link-choice" key={other.id}>
                <input
                  type="checkbox"
                  checked={links.includes(other.id)}
                  onChange={(e) =>
                    setLinks(
                      e.target.checked
                        ? [...links, other.id]
                        : links.filter((l) => l !== other.id),
                    )
                  }
                />
                {other.title}
              </label>
            ))}
          {items.length < 2 && (
            <p>Capture another item to create a relationship.</p>
          )}
        </fieldset>
        <small>
          Captured {new Date(item.createdAt).toLocaleString()} via {item.source}
          . Last edited {new Date(item.updatedAt).toLocaleString()}.
        </small>
        <div className="sheet-actions">
          <button
            disabled={busy}
            onClick={() =>
              save({ status: item.status === "done" ? "active" : "done" })
            }
          >
            {item.status === "done" ? "Reopen" : "Mark complete"}
          </button>
          <button
            className="primary-button"
            disabled={busy || !title.trim()}
            onClick={() =>
              save({
                title,
                body,
                links,
                due:
                  due && Number.isFinite(Date.parse(due))
                    ? new Date(due).toISOString()
                    : due || undefined,
                ...(["expense", "payment"].includes(item.kind)
                  ? {
                      amount: amount === "" ? undefined : Number(amount),
                      currency,
                    }
                  : {}),
              })
            }
          >
            Save changes
          </button>
        </div>
        <button className="text-button danger" disabled={busy} onClick={remove}>
          Delete item
        </button>
      </div>
    </Overlay>
  );
}
