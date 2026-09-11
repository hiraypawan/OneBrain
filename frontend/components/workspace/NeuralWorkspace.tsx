"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useId,
  useDeferredValue,
} from "react";
import Link from "next/link";
import { ContextMap, SYMBOLS } from "./ContextMap";
import { useAssistant } from "@/hooks/useAssistant";
import { useBackgroundKeepalive } from "@/hooks/useBackgroundKeepalive";
import { useAssistantStore } from "@/store/assistant";
import { useWorkspaceStore } from "@/store/workspace";
import { normalizeProactive } from "@/lib/proactive";
import {
  draftCapture,
  draftBrainDump,
  financialTotals,
  searchItems,
  summarizeDay,
  type BrainItem,
  type CaptureDraft,
  type ItemKind,
} from "@/lib/workspace/model";

const KINDS: ItemKind[] = [
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
const CONNECTORS = [
  [
    "Google Calendar",
    "Availability, meetings, and approved event updates",
    "OAuth consent and a server-side token vault required",
  ],
  [
    "Google Sheets",
    "Client notes, expenses, and operational records",
    "OAuth consent and verified write adapters required",
  ],
  [
    "Telegram",
    "Reminder delivery and action receipts",
    "Bot configuration, chat linking, and durable scheduling required",
  ],
  [
    "Gmail",
    "Selected inbox context and approved drafts",
    "Restricted-scope review and secure OAuth required",
  ],
  [
    "Notion / Todoist / HubSpot",
    "Project, task, and client destinations",
    "Individual authenticated adapters required",
  ],
  [
    "Slack / Microsoft Teams",
    "Approved team updates",
    "Workspace authorization and tenant permissions required",
  ],
  [
    "Home Assistant",
    "Read device states and approve actions",
    "Secure access to a user-owned installation required",
  ],
  [
    "Webhooks / MCP",
    "Named, approved automation tools",
    "Destination allowlisting and credential isolation required",
  ],
];
function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Overlay({
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
          <span className="eyebrow">ONEBRAIN / WORKSPACE</span>
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

export function NeuralWorkspace() {
  const assistant = useAssistant();
  useBackgroundKeepalive(assistant.recover);
  const state = useAssistantStore();
  const workspace = useWorkspaceStore();
  const [view, setView] = useState<"canvas" | "list" | "today" | "activity">(
    "canvas",
  );
  const [query, setQuery] = useState("");
  const [input, setInput] = useState("");
  const [captureKind, setCaptureKind] = useState<ItemKind | "dump" | "ask">(
    "note",
  );
  const [drafts, setDrafts] = useState<CaptureDraft[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<"settings" | "connections" | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const startAttemptRef = useRef(0);
  const deferredQuery = useDeferredValue(query);
  const [offline, setOffline] = useState(false);
  const [listLimit, setListLimit] = useState(50);
  const [pocket, setPocket] = useState(false);
  const [filter, setFilter] = useState("all");
  const prefs = normalizeProactive(state.settings.proactive);
  const selected = workspace.items.find((i) => i.id === selectedId);
  const visible = useMemo(
    () =>
      searchItems(workspace.items, deferredQuery)
        .filter((i) => filter === "all" || i.kind === filter)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    [workspace.items, deferredQuery, filter],
  );
  const openTasks = workspace.items.filter(
    (i) => i.kind === "task" && i.status === "active",
  );
  const totals = financialTotals(workspace.items);
  const latest = state.messages
    .filter((m) => m.role === "assistant")
    .slice(-1)[0];
  useEffect(() => {
    setDrafts(null);
    setSelectedId(null);
    setInput("");
    setNotice("");
    void useWorkspaceStore.getState().load(state.user?.id || "device");
  }, [state.user?.id]);
  useEffect(() => {
    setListLimit(50);
  }, [query, filter, view]);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const updatePrefs = (patch: Partial<typeof prefs>) =>
    state.updateSettings({ proactive: { ...prefs, ...patch } });

  async function attempt(fn: () => Promise<unknown>, success?: string) {
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
  }
  async function start() {
    if (starting) return;
    const request = ++startAttemptRef.current;
    setStarting(true);
    setNotice("");
    try {
      await assistant.startActive();
    } catch (e) {
      if (request !== startAttemptRef.current) return;
      setNotice(
        e instanceof Error
          ? e.message
          : "Microphone unavailable. You can type instead.",
      );
    } finally {
      if (request === startAttemptRef.current) setStarting(false);
    }
  }
  function compose() {
    if (!input.trim()) return;
    if (captureKind === "ask") {
      void assistant.handleTranscript(input);
      setInput("");
      return;
    }
    try {
      setNotice("");
      setDrafts(
        captureKind === "dump"
          ? draftBrainDump(input)
          : [draftCapture(input, captureKind)],
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to prepare this capture. Your text is still here.",
      );
    }
  }
  const saveDrafts = () =>
    attempt(
      async () => {
        if (!drafts?.length) return;
        await workspace.capture(drafts);
        setDrafts(null);
        setInput("");
      },
      state.settings.memoryEnabled
        ? "Saved and verified on this browser. No external app was changed."
        : "Kept for this session only. Memory is off.",
    );

  if (pocket)
    return (
      <section className="pocket-screen">
        <div className={`listening-line ${assistant.isActive ? "on" : ""}`} />
        <span className="eyebrow">POCKET MODE</span>
        <h1>{assistant.isActive ? assistant.currentStatus : "Paused"}</h1>
        <p>
          Background listening depends on your phone and browser. This screen
          does not lock your device.
        </p>
        <div className="pocket-caption" aria-live="polite">
          {latest?.content}
        </div>
        <button
          className="primary-button"
          onClick={() => {
            assistant.stopActive();
            setPocket(false);
          }}
        >
          Stop & return
        </button>
        <button className="text-button" onClick={() => setPocket(false)}>
          Show workspace
        </button>
      </section>
    );

  return (
    <div className="brain-workspace">
      <header className="brain-header">
        <Link href="/" className="wordmark">
          <span className="brand-mark">∷</span> onebrain
          <span className="wordmark-period">.</span>
        </Link>
        <div className="header-tools">
          <a href="/operations" className="text-button" style={{fontSize:12}}>Operations ↗</a>
          <span className="local-badge">
            <i />{" "}
            {offline
              ? "Offline · local capture available"
              : "Device-local workspace"}
          </span>
          <button
            className="icon-button"
            aria-label="Open connections"
            title="Connections"
            onClick={() => setOverlay("connections")}
          >
            ↗
          </button>
          <button
            className="icon-button"
            aria-label="Open settings"
            title="Settings"
            onClick={() => setOverlay("settings")}
          >
            ⚙
          </button>
        </div>
      </header>
      <section className="workspace-intro">
        <div>
          <div className="eyebrow">LESS IN YOUR HEAD. MORE IN YOUR HANDS.</div>
          <h1>
            A little space <br />
            for <em>everything.</em>
          </h1>
          <p>Capture a thought. Connect the context. Find your next step.</p>
          <div className="workspace-pulse" aria-label="Workspace summary">
            <span>
              <b>{workspace.items.length}</b> thoughts collected
            </span>
            <span className="pulse-divider" />
            <span>
              <b>{openTasks.length}</b> open tasks
            </span>
          </div>
        </div>
        <div className="session-card">
          <span className="eyebrow">YOUR POCKET COMPANION</span>
          <div className="session-state">
            <span
              className={
                assistant.isActive ? "status-dot active" : "status-dot"
              }
            />
            {starting
              ? "Requesting microphone"
              : assistant.isActive
                ? assistant.currentStatus
                : assistant.currentStatus === "paused" ? "Paused — microphone released" : "Ready when you are"}
          </div>
          <button
            data-testid={assistant.isActive ? "stop-button" : "active-button"}
            className="primary-button"
            onClick={assistant.isActive ? assistant.stopActive : start}
            disabled={starting}
          >
            {assistant.isActive ? "■  Stop listening" : assistant.currentStatus === "paused" ? "Resume Pocket Mode" : "Start Pocket Mode"}
            <span aria-hidden="true">↗</span>
          </button>
          {starting && (
            <button
              className="text-button cancel-start"
              onClick={() => {
                startAttemptRef.current += 1;
                assistant.stopActive();
                setStarting(false);
                setNotice("Microphone start cancelled.");
              }}
            >
              Cancel microphone start
            </button>
          )}
          <div className="session-options">
            {assistant.isActive && <button className="text-button" onClick={assistant.pauseActive}>Pause session</button>}
            <button
              className="text-button"
              aria-pressed={!!state.settings.silentMode}
              onClick={() =>
                state.updateSettings({ silentMode: !state.settings.silentMode })
              }
            >
              {state.settings.silentMode
                ? "◌ Silent mode on"
                : "◌ Spoken replies on"}
            </button>
            {assistant.isActive && (
              <button className="text-button" onClick={() => setPocket(true)}>
                Dark screen
              </button>
            )}
          </div>
        </div>
      </section>
      <section className="capture-composer">
        <div className="composer-top">
          <span className="eyebrow">MAKE A LITTLE ROOM</span>
          <select
            aria-label="Capture type"
            value={captureKind}
            onChange={(e) =>
              setCaptureKind(e.target.value as typeof captureKind)
            }
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
            <option value="dump">brain dump</option>
            <option value="ask">ask OneBrain</option>
          </select>
        </div>
        <div
          className="capture-shortcuts"
          role="group"
          aria-label="Capture shortcuts"
        >
          {(["note", "task", "idea", "dump", "ask"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={captureKind === kind}
              onClick={() => {
                setCaptureKind(kind);
                document.getElementById("capture-input")?.focus();
              }}
            >
              <span aria-hidden="true">
                {kind === "dump" ? "∷" : kind === "ask" ? "✳" : SYMBOLS[kind]}
              </span>
              {kind === "dump"
                ? "Brain dump"
                : kind === "ask"
                  ? "Ask"
                  : kind[0].toUpperCase() + kind.slice(1)}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            compose();
          }}
        >
          <textarea
            id="capture-input"
            aria-label="Capture a thought"
            placeholder={
              captureKind === "dump"
                ? "One thought per line. Try “task: Send the proposal” or “idea: A referral offer”."
                : captureKind === "ask"
                  ? "Ask a question, search memory, or try “15% of 60000”…"
                  : "A thought, a commitment, something worth remembering…"
            }
            value={input}
            maxLength={6000}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (
                (e.metaKey || e.ctrlKey) &&
                e.key === "Enter" &&
                !e.nativeEvent.isComposing &&
                workspace.ready &&
                !busy
              ) {
                e.preventDefault();
                compose();
              }
            }}
            rows={2}
          />
          <button
            className="send-button"
            aria-label={
              captureKind === "ask" ? "Ask OneBrain" : "Review capture"
            }
            disabled={!input.trim() || !workspace.ready || busy}
            type="submit"
          >
            ↗
          </button>
        </form>
        <div className="composer-bottom">
          <span>
            {captureKind === "ask"
              ? "General questions may use an external AI provider."
              : "Review before saving · no external AI needed"}
          </span>
          <span>{input.length}/6000</span>
        </div>
      </section>
      <div className="workspace-toolbar">
        <div
          className="view-tabs"
          role="tablist"
          aria-label="Workspace view"
          onKeyDown={(event) => {
            const tabs = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]',
              ),
            );
            const index = tabs.indexOf(
              document.activeElement as HTMLButtonElement,
            );
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
          }}
        >
          {(["canvas", "list", "today", "activity"] as const).map((v) => (
            <button
              role="tab"
              id={`workspace-tab-${v}`}
              aria-controls="workspace-panel"
              tabIndex={view === v ? 0 : -1}
              aria-selected={view === v}
              key={v}
              onClick={() => setView(v)}
              className={view === v ? "selected" : ""}
            >
              {v === "canvas" ? "Context map" : v[0].toUpperCase() + v.slice(1)}
              {v === "today" && <span>{openTasks.length}</span>}
            </button>
          ))}
        </div>
        <button
          className={`conversation-toggle ${prefs.enabled ? "enabled" : ""}`}
          onClick={() => setOverlay("settings")}
        >
          ✧ {prefs.enabled ? "Open to conversation" : "Quiet by default"}
        </button>
      </div>
      {(view === "canvas" || view === "list") && (
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
            {KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </div>
      )}
      {(notice || workspace.error || assistant.micNotice) && (
        <div className="workspace-notice" role="status">
          {notice || workspace.error || assistant.micNotice}
          {workspace.error ||
          /another tab|Reload the workspace/.test(notice) ? (
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                attempt(async () => {
                  if (
                    confirm(
                      "Reload saved records? Unsaved session-only changes will be lost.",
                    )
                  ) {
                    await workspace.load(state.user?.id || "device");
                    if (useWorkspaceStore.getState().error)
                      throw new Error(useWorkspaceStore.getState().error!);
                  }
                })
              }
            >
              Reload workspace
            </button>
          ) : null}
          <button
            onClick={() => {
              setNotice("");
              state.setMicNotice(null);
            }}
            aria-label="Dismiss notice"
          >
            ×
          </button>
        </div>
      )}
      {!state.settings.memoryEnabled && (
        <p className="privacy-strip">
          Memory is off. New workspace changes stay in this session and are lost
          on reload.
        </p>
      )}
      <div
        id="workspace-panel"
        role="tabpanel"
        aria-labelledby={`workspace-tab-${view}`}
      >
        {view === "canvas" && (
          <ContextMap
            items={visible}
            select={setSelectedId}
            filtered={!!query.trim() || filter !== "all"}
            clearFilters={() => {
              setQuery("");
              setFilter("all");
            }}
            ready={workspace.ready}
            memoryEnabled={state.settings.memoryEnabled}
          />
        )}
        {view === "list" && (
          <div className="record-list">
            {visible.length ? (
              visible.slice(0, listLimit).map((item) => (
                <button
                  key={item.id}
                  className="record-row"
                  onClick={() => setSelectedId(item.id)}
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
              ))
            ) : (
              <div className="plain-empty">
                No matching records. Capture a thought below.
              </div>
            )}
            {visible.length > listLimit && (
              <button
                className="text-button amber load-more"
                onClick={() => setListLimit((n) => n + 50)}
              >
                Show more · {visible.length - listLimit} remaining
              </button>
            )}
          </div>
        )}
        {view === "today" && (
          <section className="today-panel">
            <span className="eyebrow">YOUR NEXT STEPS</span>
            <h2>
              {openTasks.length
                ? `${openTasks.length} things on your mind.`
                : "Room for what matters."}
            </h2>
            <p>{summarizeDay(workspace.items)}</p>
            <div className="today-actions">
              <button onClick={() => setNotice(summarizeDay(workspace.items))}>
                What am I forgetting?
              </button>
              <button
                onClick={() => {
                  setCaptureKind("dump");
                  document.getElementById("capture-input")?.focus();
                }}
              >
                Clear my head
              </button>
            </div>
            {openTasks.map((i) => (
              <div className="task-row" key={i.id}>
                <button
                  aria-label={`Complete ${i.title}`}
                  disabled={busy}
                  onClick={() =>
                    attempt(
                      () => workspace.update(i.id, { status: "done" }),
                      state.settings.memoryEnabled
                        ? "Marked complete locally."
                        : "Marked complete for this session only.",
                    )
                  }
                >
                  ○
                </button>
                <button onClick={() => setSelectedId(i.id)}>{i.title}</button>
                <small>
                  {i.due ? new Date(i.due).toLocaleDateString() : "No deadline"}
                </small>
              </div>
            ))}
            {Object.entries(totals).map(([currency, total]) => (
              <div className="finance-total" key={currency}>
                {currency}: {total.expense.toFixed(2)} expenses ·{" "}
                {total.payment.toFixed(2)} payments logged{" "}
                <small>
                  Recorded entries only. Not bank-verified balances.
                </small>
              </div>
            ))}
          </section>
        )}
        {view === "activity" && (
          <section className="activity-panel">
            <span className="eyebrow">EVIDENCE, NOT JUST “DONE”</span>
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
            {workspace.receipts.slice(0, listLimit).map((r) => (
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
                        state.settings.memoryEnabled
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
            {workspace.receipts.length > listLimit && (
              <button
                className="text-button amber load-more"
                onClick={() => setListLimit((n) => n + 50)}
              >
                Show older actions · {workspace.receipts.length - listLimit}{" "}
                remaining
              </button>
            )}
            <details className="conversation-record">
              <summary>Conversation record ({state.messages.length})</summary>
              {state.messages.slice(-50).map((m) => (
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
      {assistant.proactiveInvitation && (
        <section className="proactive-card" aria-live="polite">
          <span className="eyebrow">AN OPTIONAL OPENING</span>
          <p>{assistant.proactiveInvitation.permission}</p>
          <small>{assistant.proactiveInvitation.reason}</small>
          <div>
            <button onClick={() => assistant.handleTranscript("yes")}>
              Go ahead
            </button>
            <button onClick={() => assistant.handleTranscript("not now")}>
              Not now · pause 30 min
            </button>
            <button onClick={() => assistant.handleTranscript("stop asking")}>
              Turn off
            </button>
          </div>
        </section>
      )}
      {assistant.sharedPreview&&<section className="proactive-card" aria-label="Review shared upload"><span className="eyebrow">REVIEW SHARED UPLOAD · NOT DEVICE-LOCAL</span><p>{assistant.sharedPreview.kind}: {assistant.sharedPreview.title}</p><small>Destination: {assistant.sharedPreview.spaceName}. Members will be able to read this. A reminder is saved only as an action draft, not an approved schedule.</small><div><button onClick={()=>assistant.handleTranscript('save shared')}>Save shared</button><button onClick={()=>assistant.handleTranscript('cancel')}>Discard upload</button><a href="/operations">Open Operations ↗</a></div></section>}
      {assistant.capturePreview && (
        <section className="proactive-card">
          <span className="eyebrow">REVIEW VOICE CAPTURE</span>
          {assistant.capturePreview.map((d, i) => (
            <p key={i}>
              {d.kind}: {d.title}
            </p>
          ))}
          <small>
            Dates and relationships are not inferred. Open the saved item to set
            them.
          </small>
          <div>
            <button onClick={() => assistant.handleTranscript("save")}>
              Save on this device
            </button>
            <button onClick={() => assistant.handleTranscript("cancel")}>
              Discard
            </button>
          </div>
        </section>
      )}
      {latest && (
        <div className="last-response" aria-live="polite">
          <span className="eyebrow">LATEST RESPONSE</span>
          <p>{latest.content}</p>
        </div>
      )}
      <footer className="workspace-footer">
        <span>Your context. Your control.</span>
        <div>
          <Link href="/settings/privacy">Privacy</Link>
          <Link href="/settings/data-export">Export & delete</Link>
          <Link href="/reminders">Reminders</Link>
          <Link href="/settings/debug">Diagnostics</Link>
        </div>
      </footer>

      {drafts && (
        <Overlay
          notice={notice}
          title="Review your capture"
          close={() => setDrafts(null)}
        >
          <p className="sheet-description">
            Nothing is saved yet. Check the type, words, and date. Each line in
            a brain dump is a separate proposed item; no hidden AI extraction.
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
                        i === index
                          ? { ...x, kind: e.target.value as ItemKind }
                          : x,
                      ),
                    )
                  }
                >
                  {KINDS.map((k) => (
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
                            i === index
                              ? { ...x, currency: e.target.value }
                              : x,
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
            <button onClick={() => setDrafts(null)}>Discard</button>
            <button
              className="primary-button"
              disabled={
                busy || !drafts.length || drafts.some((d) => !d.title.trim())
              }
              onClick={saveDrafts}
            >
              {busy
                ? "Saving…"
                : `Save ${drafts.length} item${drafts.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </Overlay>
      )}
      {selected && (
        <ItemDetail
          notice={notice}
          key={selected.id}
          item={selected}
          items={workspace.items}
          close={() => setSelectedId(null)}
          busy={busy}
          save={(patch) =>
            attempt(
              () => workspace.update(selected.id, patch),
              state.settings.memoryEnabled
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
                state.settings.memoryEnabled
                  ? "Deleted locally. Undo is available in Activity."
                  : "Hidden for this session only. Saved browser records are unchanged.",
              );
          }}
        />
      )}
      {overlay === "settings" && (
        <Overlay
          notice={notice}
          title="Make it yours"
          close={() => setOverlay(null)}
        >
          <section className="settings-section">
            <h3>Conversation, on your terms</h3>
            <p>
              OneBrain can offer an occasional, relevant opening during an
              active listening session. It asks permission first, never treats
              silence as consent, and never pressures you to reply.
            </p>
            <label className="switch-row">
              <span>
                Proactive conversation
                <small>
                  Off by default. Only while Pocket Mode is listening.
                </small>
              </span>
              <input
                type="checkbox"
                checked={prefs.enabled}
                onChange={(e) => updatePrefs({ enabled: e.target.checked })}
              />
            </label>
            <label className="switch-row">
              <span>
                Revisit earlier conversation topics
                <small>
                  Uses eligible user messages. Sensitive topics are excluded
                  conservatively.
                </small>
              </span>
              <input
                type="checkbox"
                checked={prefs.historyTopics}
                onChange={(e) =>
                  updatePrefs({ historyTopics: e.target.checked })
                }
              />
            </label>
            <label className="switch-row">
              <span>
                Ask occasional preference questions
                <small>
                  No automatic personality profile or sensitive inference.
                </small>
              </span>
              <input
                type="checkbox"
                checked={prefs.preferenceQuestions}
                onChange={(e) =>
                  updatePrefs({ preferenceQuestions: e.target.checked })
                }
              />
            </label>
            <div className="settings-grid">
              <label>
                Minimum time between invitations
                <select
                  value={prefs.intervalMinutes}
                  onChange={(e) =>
                    updatePrefs({ intervalMinutes: Number(e.target.value) })
                  }
                >
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>60 minutes</option>
                </select>
              </label>
              <label>
                Maximum invitations per session
                <select
                  value={prefs.maxPerSession}
                  onChange={(e) =>
                    updatePrefs({ maxPerSession: Number(e.target.value) })
                  }
                >
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Quiet hours start
                <select
                  value={prefs.quietStart}
                  onChange={(e) =>
                    updatePrefs({ quietStart: Number(e.target.value) })
                  }
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Quiet hours end
                <select
                  value={prefs.quietEnd}
                  onChange={(e) =>
                    updatePrefs({ quietEnd: Number(e.target.value) })
                  }
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="settings-footnote">
              At least 90 seconds without detected speech. At most{" "}
              {prefs.maxPerDay} invitations a day. “Not now” pauses suggestions
              for 30 minutes. No answer also pauses them. Same-hour quiet
              settings disable the quiet window.
            </p>
          </section>
          <section className="settings-section">
            <h3>Voice & memory</h3>
            <label className="switch-row"><span>Require an active-session wake phrase<small>Start a request with “OneBrain” or “Hey OneBrain”. Stop and pause still work without it. This cannot wake a closed or suspended browser.</small></span><input type="checkbox" checked={!!state.settings.wakePhrase} onChange={e=>state.updateSettings({wakePhrase:e.target.checked})}/></label>
            <label>Recognition name aliases · one heard name = saved name per line<textarea rows={3} defaultValue={Object.entries(state.settings.speechAliases||{}).map(([a,b])=>`${a} = ${b}`).join('\n')} onBlur={e=>{const pairs=e.target.value.split('\n').filter(Boolean).slice(0,20).map(line=>line.split('=').map(x=>x.trim())).filter(p=>p.length===2&&p[0]&&p[1]);state.updateSettings({speechAliases:Object.fromEntries(pairs)});}} placeholder="ABC co = ABC Corporation"/></label>
            <label className="switch-row">
              <span>
                Silent Mode
                <small>No spoken answers or proactive invitations.</small>
              </span>
              <input
                type="checkbox"
                checked={!!state.settings.silentMode}
                onChange={(e) => {
                  if (e.target.checked) window.speechSynthesis?.cancel();
                  state.updateSettings({ silentMode: e.target.checked });
                }}
              />
            </label>
            <label className="switch-row">
              <span>
                Save memory on this device
                <small>
                  Turning off keeps new captures session-only. Existing saved
                  records remain until deleted.
                </small>
              </span>
              <input
                type="checkbox"
                checked={state.settings.memoryEnabled}
                onChange={(e) =>
                  state.updateSettings({ memoryEnabled: e.target.checked })
                }
              />
            </label>
            <label>
              Recognition language
              <select
                value={state.settings.language}
                onChange={(e) =>
                  state.updateSettings({ language: e.target.value })
                }
              >
                <option value="en-IN">English (India)</option>
                <option value="en-US">English (US)</option>
                <option value="hinglish">Hindi / Hinglish</option>
                <option value="marathi">Marathi</option>
                <option value="es-ES">Spanish</option>
              </select>
            </label>
            <p className="settings-footnote">
              Restart listening after changing language. Browser recognition may
              process audio remotely. Voice-based speaker profiles are not
              authentication.
            </p>
          </section>
          <section className="settings-section">
            <h3>Your data belongs to you</h3>
            <p>
              Workspace records and receipts are currently device-local, not
              cloud-synced. This browser profile is not suitable for
              shared-device confidential data.
            </p>
            <div className="sheet-actions">
              <button
                onClick={() =>
                  downloadJson("onebrain-workspace.json", {
                    version: 1,
                    exportedAt: new Date().toISOString(),
                    items: workspace.items,
                    receipts: workspace.receipts,
                  })
                }
              >
                Export workspace
              </button>
              <button
                onClick={() => {
                  if (
                    confirm(
                      "Delete this workspace and its action receipts permanently?",
                    )
                  )
                    void attempt(workspace.clear, "Workspace deleted.");
                }}
              >
                Delete workspace
              </button>
            </div>
            <Link href="/settings">Account & advanced settings ↗</Link>
          </section>
        </Overlay>
      )}
      {overlay === "connections" && (
        <Overlay title="Your tools, connected" close={() => setOverlay(null)}>
          <p className="sheet-description">
            Adapters are not live connections until you authorize them. Open Operations to connect tools, create shared workspaces, and review scheduled actions. Local canvas records are not uploaded automatically.
          </p>
          <p><a href="/operations" className="primary-button">Open Operations ↗</a></p>
          <div className="connection-grid">
            {CONNECTORS.map(([name, purpose, requirement]) => (
              <article key={name}>
                <span className="eyebrow">CONFIGURE IN OPERATIONS</span>
                <h3>{name}</h3>
                <p>{purpose}</p>
                <small>
                  {requirement}. Free hosted APIs still have limits.
                </small>
              </article>
            ))}
          </div>
          <p className="settings-footnote">
            Local capture stays on this device. Operations uses a separately authenticated server workspace with adapters, approvals and durable jobs. See
            docs/IMPLEMENTATION-STATUS.md for the full scope and remaining work.
          </p>
        </Overlay>
      )}
    </div>
  );
}

function ItemDetail({
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
