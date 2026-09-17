"use client";
// Notes & activity — the record browser Today used to carry.
// Search, type filter, the canvas map and the receipt log with undo, all in one
// panel. Today now shows only the four most recent records; everything you look
// *up* lives here, behind the same search the whole of Space uses.
import { useCallback, useEffect, useDeferredValue, useMemo, useRef, useState } from "react";
import { useAssistantStore } from "@/store/assistant";
import { useWorkspaceStore } from "@/store/workspace";
import { searchItems, summarizeDay, type BrainItem } from "@/lib/workspace/model";
import { ContextMap, SYMBOLS } from "@/components/workspace/ContextMap";
import { Icon } from "@/components/ui/Icon";
import { CAPTURE_KINDS, ItemDetail } from "@/components/workspace/ItemSheet";

type NoteView = "list" | "map" | "activity";
const VIEWS: { id: NoteView; label: string }[] = [
  { id: "map", label: "Context map" },
  { id: "list", label: "List" },
  { id: "activity", label: "Activity" },
];

export function Notes() {
  const workspace = useWorkspaceStore();
  const memoryEnabled = useAssistantStore((s) => s.settings.memoryEnabled);
  const userId = useAssistantStore((s) => s.user?.id);
  const messages = useAssistantStore((s) => s.messages);
  const [view, setView] = useState<NoteView>("list");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(50);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const tabsRef = useRef<HTMLDivElement>(null);

  // This panel is its own document, so nothing has loaded the canvas store yet.
  useEffect(() => {
    void useWorkspaceStore.getState().load(userId || "device");
  }, [userId]);
  useEffect(() => {
    setLimit(50);
  }, [query, filter, view]);

  const visible = useMemo(
    () =>
      searchItems(workspace.items, deferredQuery)
        .filter((i) => filter === "all" || i.kind === filter)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    [workspace.items, deferredQuery, filter],
  );
  const selected = workspace.items.find((i) => i.id === selectedId);
  const openTasks = workspace.items.filter(
    (i) => i.kind === "task" && i.status === "active",
  );

  const attempt = useCallback(
    async (fn: () => Promise<unknown>, success?: string) => {
      if (busy) return;
      setBusy(true);
      setNotice("");
      try {
        await fn();
        if (success) setNotice(success);
      } catch (e) {
        setNotice(
          e instanceof Error ? e.message : "Not completed. Please try again.",
        );
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );
  const onTabKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(
      tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    );
    const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    if (next >= 0) {
      event.preventDefault();
      tabs[next].focus();
      tabs[next].click();
    }
  };

  return (
    <div className="notes-panel">
      {notice && (
        <p role="status" className="workspace-notice">
          {notice}
          <button className="text-button" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </p>
      )}
      <p className="notes-summary">
        {summarizeDay(workspace.items)}{" "}
        <span>
          {workspace.receipts.length} recorded{" "}
          {workspace.receipts.length === 1 ? "action" : "actions"}
        </span>
      </p>
      <div
        className="view-tabs"
        role="tablist"
        aria-label="Workspace view"
        onKeyDown={onTabKeys}
        ref={tabsRef}
      >
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            id={`notes-tab-${v.id}`}
            aria-controls="notes-panel-body"
            tabIndex={view === v.id ? 0 : -1}
            aria-selected={view === v.id}
            className={view === v.id ? "selected" : ""}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
      {(view === "list" || view === "map") && (
        <div className="search-row">
          <label>
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="Search your memory"
              placeholder="Find a person, project, or thought…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="Filter by type"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All types</option>
            {CAPTURE_KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </div>
      )}
      {!memoryEnabled && (
        <p className="privacy-strip">
          Memory is off. New changes stay in this session and are lost on reload.
        </p>
      )}
      <div
        id="notes-panel-body"
        role="tabpanel"
        aria-labelledby={`notes-tab-${view}`}
      >
        {view === "map" && (
          <ContextMap
            items={visible}
            select={setSelectedId}
            filtered={!!query.trim() || filter !== "all"}
            clearFilters={() => {
              setQuery("");
              setFilter("all");
            }}
            ready={workspace.ready}
            memoryEnabled={memoryEnabled}
          />
        )}
        {view === "list" && (
          <div className="record-list">
            {!workspace.ready ? (
              <div className="memory-loading" role="status">
                <span />
                <span />
                Opening your saved thoughts…
              </div>
            ) : visible.length ? (
              visible.slice(0, limit).map((item) => (
                <RecordRow key={item.id} item={item} onOpen={setSelectedId} />
              ))
            ) : (
              <div className="memory-empty">
                <Icon name={query || filter !== "all" ? "search" : "note"} />
                <h3>
                  {query || filter !== "all"
                    ? "Nothing matches yet."
                    : "Your first thought starts something."}
                </h3>
                <p>
                  {query || filter !== "all"
                    ? "Try another word or clear the filters."
                    : "Capture a note, a task, or an idea on Today. You can edit it, connect it to another thought, or find it again here."}
                </p>
                {(query || filter !== "all") && (
                  <button
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    Clear search &amp; filters
                  </button>
                )}
              </div>
            )}
            {visible.length > limit && (
              <button
                className="text-button amber load-more"
                onClick={() => setLimit((n) => n + 50)}
              >
                Show more · {visible.length - limit} remaining
              </button>
            )}
          </div>
        )}
        {view === "activity" && (
          <section className="activity-panel">
            <span className="eyebrow">WHAT YOU ACTUALLY DID</span>
            <h2>Your action history.</h2>
            <p>
              Local receipts verify browser storage—not external services or
              notification delivery.
            </p>
            {workspace.receipts.length === 0 && (
              <div className="plain-empty">
                Your first saved action will appear here.
              </div>
            )}
            {workspace.receipts.slice(0, limit).map((r) => (
              <article className="receipt" key={r.id}>
                <div>
                  <span className="receipt-status">
                    {r.status === "verified-local"
                      ? "✓ Verified locally"
                      : r.status === "session-only"
                        ? "◌ Session only"
                        : "↶ Undone"}
                  </span>
                  <h3>{r.summary}</h3>
                  <small>
                    {new Date(r.at).toLocaleString()} · {r.destination}
                  </small>
                  <details>
                    <summary>Receipt details</summary>
                    <code>{r.id}</code>
                    <p>
                      {r.itemIds.length} affected record(s).{" "}
                      {r.status === "verified-local"
                        ? "Atomic IndexedDB transaction committed."
                        : "See status above."}
                    </p>
                  </details>
                </div>
                {r.status !== "undone" && r.operation !== "undo" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      attempt(
                        () => workspace.undo(r.id),
                        memoryEnabled
                          ? "Action undone locally."
                          : "Undone for this session only.",
                      )
                    }
                  >
                    Undo
                  </button>
                )}
              </article>
            ))}
            {workspace.receipts.length > limit && (
              <button
                className="text-button amber load-more"
                onClick={() => setLimit((n) => n + 50)}
              >
                Show older actions · {workspace.receipts.length - limit} remaining
              </button>
            )}
            <details className="conversation-record">
              <summary>Conversation record ({messages.length})</summary>
              {messages.slice(-50).map((m) => (
                <article key={m.id}>
                  <small>
                    {m.role === "user" ? "You" : "OneBrain"} ·{" "}
                    {new Date(m.createdAt).toLocaleTimeString()}
                  </small>
                  <p>{m.content}</p>
                  {m.meta && <small>{m.meta}</small>}
                </article>
              ))}
            </details>
          </section>
        )}
      </div>
      {view === "list" && openTasks.length > 0 && (
        <p className="notes-foot">
          {openTasks.length} open {openTasks.length === 1 ? "task" : "tasks"} —
          complete them from Today or the{" "}
          <a href="/control?panel=tasks">To-Do</a>.
        </p>
      )}
      {selected && (
        <ItemDetail
          key={selected.id}
          notice={notice}
          item={selected}
          items={workspace.items}
          busy={busy}
          close={() => setSelectedId(null)}
          save={(patch) =>
            attempt(
              () => workspace.update(selected.id, patch),
              memoryEnabled
                ? "Changes verified locally."
                : "Changes kept for this session only.",
            )
          }
          remove={() => {
            if (
              confirm(
                "Delete this item and remove its links? You can undo in Activity.",
              )
            )
              void attempt(
                async () => {
                  await workspace.remove(selected.id);
                  setSelectedId(null);
                },
                memoryEnabled
                  ? "Deleted locally. Undo is available here."
                  : "Hidden for this session only. Saved browser records are unchanged.",
              );
          }}
        />
      )}
    </div>
  );
}

/** Same row Today shows under “Recently saved”, so a record looks identical both ways. */
function RecordRow({
  item,
  onOpen,
}: {
  item: BrainItem;
  onOpen: (id: string) => void;
}) {
  return (
    <button className="record-row" onClick={() => onOpen(item.id)}>
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
  );
}
