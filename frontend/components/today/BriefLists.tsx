"use client";
import { Icon } from "@/components/ui/Icon";
import { SYMBOLS } from "@/components/workspace/ContextMap";
import type { BriefFact } from "@/lib/today-brief";
import type { ActionReceipt, BrainItem } from "@/lib/workspace/model";
import type { TodoCounts } from "@/lib/todo";

/**
 * The three lists Today is allowed to have: what is due, what you just saved,
 * and the numbers that are actually logged. The search box, the canvas, the type
 * filter and the receipt log moved to Your space → Notes & activity, where they
 * belong to looking things up rather than to this morning.
 */

export function BriefFacts({ facts }: { facts: BriefFact[] }) {
  if (!facts.length) return null;
  return (
    <ul className="brief-facts" aria-label="Today so far">
      {facts.map((fact) => (
        <li key={fact.id}>
          <a href={fact.href}>
            <span>{fact.label}</span>
            <strong>{fact.value}</strong>
            {fact.note && <small>{fact.note}</small>}
            <Icon name="arrow" />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Open device tasks, plus a count of everything else the unified list holds. */
export function NextUp({
  tasks,
  counts,
  busy,
  onComplete,
  onOpen,
}: {
  tasks: BrainItem[];
  counts: TodoCounts;
  busy: boolean;
  onComplete: (item: BrainItem) => void;
  onOpen: (id: string) => void;
}) {
  const extra = counts.open - tasks.length;
  return (
    <div className="next-up">
      <div className="next-up-heading">
        <h2>Next up</h2>
        <span>{counts.open} open</span>
      </div>
      {tasks.length ? (
        tasks.map((item) => (
          <div className="task-row" key={item.id}>
            <button
              aria-label={`Complete ${item.title}`}
              disabled={busy}
              onClick={() => onComplete(item)}
            >
              ○
            </button>
            <button onClick={() => onOpen(item.id)}>{item.title}</button>
            <small>
              {item.due
                ? new Date(item.due).toLocaleDateString()
                : "No deadline"}
            </small>
          </div>
        ))
      ) : counts.open ? (
        <p>{counts.open} open in reminders or connected work.</p>
      ) : (
        <>
          <p>No open tasks. Start with just one thing you’d like to do.</p>
          <a className="text-button" href="/control?panel=tasks">
            Add a task
            <Icon name="arrow" />
          </a>
        </>
      )}
      {extra > 0 && tasks.length > 0 && (
        <p className="next-up-more">
          +{extra} more in your To-Do
          {counts.overdue ? ` · ${counts.overdue} overdue` : ""}
        </p>
      )}
      <a href="/control?panel=tasks">
        Manage reminders &amp; To-Do
        <Icon name="arrow" />
      </a>
    </div>
  );
}

/**
 * The last local action, with undo next to it.
 *
 * The full receipt log lives in Your space → Notes & activity, but that is a
 * separate document, and a session with Memory off is kept in this document only.
 * So Today shows the one receipt a person could still act on — and the “Session
 * only” wording is the point: it says out loud that nothing reached the disk.
 */
export function SaveReceipt({
  receipt,
  busy,
  onUndo,
}: {
  receipt?: ActionReceipt;
  busy: boolean;
  onUndo: () => void;
}) {
  if (!receipt) return null;
  const state =
    receipt.status === "verified-local"
      ? "Verified locally"
      : receipt.status === "session-only"
        ? "Session only"
        : "Undone";
  return (
    // Deliberately not role="status": the browser suite (and screen readers) get
    // one status region for local saves already, and a second element with that
    // role turns every `getByRole('status')` assertion into a strict-mode clash.
    <p className="save-receipt">
      <span className="receipt-status">{state}</span>
      <span className="save-receipt-text">{receipt.summary}</span>
      {receipt.status !== "undone" && receipt.operation !== "undo" ? (
        <button className="text-button" disabled={busy} onClick={onUndo}>
          Undo
        </button>
      ) : null}
      <a href="/control?panel=notes">All actions</a>
    </p>
  );
}

/** The four most recent records — the proof a capture actually landed. */
export function RecentlySaved({
  items,
  total,
  onOpen,
}: {
  items: BrainItem[];
  total: number;
  onOpen: (id: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="recent-saved">
      <div className="next-up-heading">
        <h2>Recently saved</h2>
        <span>{total === items.length ? `${total} total` : `${total} saved`}</span>
      </div>
      <div className="record-list">
        {items.map((item) => (
          <button
            key={item.id}
            className="record-row"
            onClick={() => onOpen(item.id)}
          >
            <span className="record-symbol">{SYMBOLS[item.kind]}</span>
            <span>
              <strong>{item.title}</strong>
              <small>
                {item.kind} · {item.status} ·{" "}
                {new Date(item.createdAt).toLocaleDateString()}
              </small>
            </span>
            <span>↗</span>
          </button>
        ))}
      </div>
      <a href="/control?panel=notes">
        Search everything in Space
        <Icon name="arrow" />
      </a>
    </div>
  );
}
