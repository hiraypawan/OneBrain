"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Icon } from "@/components/ui/Icon";
import {
  ConversationPreferences,
  VoicePreferences,
} from "@/components/settings/Preferences";
import { FeatureCards, FeatureHint } from "@/components/features/FeatureCards";
import {
  WitnessRunner,
  WorkoutRunner,
} from "@/components/features/FeatureRunners";
import { useAssistant } from "@/hooks/useAssistant";
import { useBackgroundKeepalive } from "@/hooks/useBackgroundKeepalive";
import { useAssistantStore } from "@/store/assistant";
import { useFeaturesStore } from "@/store/features";
import { useWorkspaceStore } from "@/store/workspace";
import { normalizeProactive } from "@/lib/proactive";
import { buildTodoList, filterTodo, todoCounts } from "@/lib/todo";
import { todayStrip } from "@/lib/track";
import { unlockAudioOutput } from "@/lib/audio";
import {
  briefFacts,
  briefLine,
  dateLine,
  greetingFor,
} from "@/lib/today-brief";
import {
  draftBrainDump,
  draftCapture,
  summarizeDay,
  type BrainItem,
  type CaptureDraft,
} from "@/lib/workspace/model";
import { downloadJson, ItemDetail, Overlay } from "@/components/workspace/ItemSheet";
import {
  AnswerBlock,
  LiveCaption,
  NoticeStrip,
  PendingAnswer,
  ReviewCards,
  VoiceNoticeBar,
} from "./AssistantSurfaces";
import { BriefFacts, NextUp, RecentlySaved } from "./BriefLists";
import { CaptureComposer, type ComposerKind } from "./CaptureComposer";
import { DraftReview } from "./DraftReview";
import { PocketScreen, VoiceCard } from "./VoiceCard";

/**
 * Today — a brief, not a workspace.
 *
 * What a person gets here: where things stand this morning, the one box that
 * captures or answers, the microphone, and the last few saved things. What used
 * to be here (canvas map, record list with search and type filters, the receipt
 * log with undo, the conversation record) is now Your space → Notes & activity,
 * which is where looking something up belongs. Both doors edit the same record
 * through the same sheet, so nothing was forked on the way.
 */
export function TodayView() {
  const assistant = useAssistant();
  useBackgroundKeepalive(assistant.recover);
  const state = useAssistantStore();
  const workspace = useWorkspaceStore();
  const goals = useFeaturesStore((s) => s.trackGoals);
  const fitnessLogs = useFeaturesStore((s) => s.fitnessLogs);
  const [now] = useState(() => new Date());
  const [input, setInput] = useState("");
  const [captureKind, setCaptureKind] = useState<ComposerKind>("note");
  const [drafts, setDrafts] = useState<CaptureDraft[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<"settings" | "connections" | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [pocket, setPocket] = useState(false);
  const startAttemptRef = useRef(0);

  // Feature runners speak through the live assistant voice (stable ref so
  // store churn never re-registers the speaker).
  const speakRef = useRef(assistant.speak);
  speakRef.current = assistant.speak;
  useEffect(() => {
    useFeaturesStore.getState().setSpeaker((t: string) => speakRef.current(t));
    void useFeaturesStore.getState().load();
    return () => useFeaturesStore.getState().setSpeaker(null);
  }, []);
  const say = (text: string) => {
    void unlockAudioOutput();
    void assistant.handleTranscript(text);
  };

  const prefs = normalizeProactive(state.settings.proactive);
  const selected = workspace.items.find((i) => i.id === selectedId);
  const recent = useMemo(
    () => workspace.items.slice(0, 4),
    [workspace.items],
  );
  const openDeviceTasks = useMemo(
    () =>
      workspace.items
        .filter((i) => i.kind === "task" && i.status === "active")
        .slice(0, 3),
    [workspace.items],
  );
  const todo = useMemo(
    () =>
      buildTodoList({
        tasks: workspace.items,
        reminders: state.reminders,
        now: Date.now(),
      }),
    [workspace.items, state.reminders],
  );
  const counts = useMemo(() => todoCounts(todo), [todo]);
  const strip = useMemo(
    () =>
      todayStrip(
        fitnessLogs,
        { kcalGoal: goals.kcalGoal, budget: goals.budget, budgetCurrency: goals.budgetCurrency },
        now,
      ),
    [fitnessLogs, goals, now],
  );
  const facts = useMemo(
    () =>
      briefFacts(
        { counts, strip, goals, items: workspace.items.length },
        now,
      ),
    [counts, strip, goals, workspace.items.length, now],
  );
  const dueToday = useMemo(
    () => filterTodo(todo, "today").slice(0, 3),
    [todo],
  );
  void dueToday; // the brief lists device tasks it can complete; the rest is a count
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
    void unlockAudioOutput();
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
      void unlockAudioOutput();
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
  const completeTask = (item: BrainItem) =>
    attempt(
      () => workspace.update(item.id, { status: "done" }),
      state.settings.memoryEnabled
        ? "Marked complete locally."
        : "Marked complete for this session only.",
    );

  if (pocket)
    return (
      <>
        <AppHeader />
        <PocketScreen assistant={assistant} onExit={() => setPocket(false)} />
      </>
    );

  return (
    <div className="today-screen">
      <AppHeader />
      <main className="today-wrap">
        <section className="today-brief" aria-label="Your day so far">
          <div>
            <p className="brief-date">{dateLine(now)}</p>
            <h1>{greetingFor(now)}.</h1>
            <p className="brief-summary">
              {briefLine(
                { counts, strip, goals, items: workspace.items.length },
                summarizeDay(workspace.items),
              )}
            </p>
            <p className="brief-product">
              OneBrain is your voice-first assistant for notes, tasks and
              questions. Write or speak. Review what gets saved. Find it in
              Space later.
            </p>
            <div className="brief-side">
              <button
                className="conversation-toggle"
                onClick={() => setOverlay("settings")}
              >
                <Icon name="mic" />{" "}
                {prefs.enabled ? "Open to conversation" : "Suggestions off"}
              </button>
              {workspace.items.length > 0 && (
                <button
                  className="text-button"
                  onClick={() => setNotice(summarizeDay(workspace.items))}
                >
                  What am I forgetting?
                </button>
              )}
            </div>
          </div>
          <BriefFacts facts={facts} />
        </section>

        <section className="today-input" aria-label="Write or speak">
          <h2 className="today-input-heading">
            Notes. Tasks. <span>Answers.</span>
          </h2>
          <CaptureComposer
            kind={captureKind}
            onKind={setCaptureKind}
            input={input}
            onInput={setInput}
            onCompose={compose}
            ready={workspace.ready}
            busy={busy}
            firstTime={workspace.ready && !workspace.items.length}
          />
          <PendingAnswer />
          <LiveCaption assistant={assistant} />
          <VoiceCard
            assistant={assistant}
            starting={starting}
            onStart={start}
            onCancelStart={() => {
              startAttemptRef.current += 1;
              assistant.stopActive();
              setStarting(false);
              setNotice("Microphone start cancelled.");
            }}
            onPocket={() => setPocket(true)}
          />
        </section>

        <WorkoutRunner />
        <WitnessRunner />

        <NoticeStrip
          notice={notice}
          workspaceError={workspace.error}
          busy={busy}
          onDismiss={() => {
            setNotice("");
            state.setMicNotice(null);
          }}
          onReload={() =>
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
        />
        <VoiceNoticeBar assistant={assistant} />
        <ReviewCards assistant={assistant} />

        <div className="today-panels">
          <NextUp
            tasks={openDeviceTasks}
            counts={counts}
            busy={busy}
            onComplete={completeTask}
            onOpen={setSelectedId}
          />
          <RecentlySaved
            items={recent}
            total={workspace.items.length}
            onOpen={setSelectedId}
          />
        </div>

        <AnswerBlock latest={latest} />

        <FeatureCards say={say} />
        <FeatureHint say={say} />

        <footer className="home-footer">
          <p>Made for your thoughts. Not another feed.</p>
          <button
            className="quick-preferences"
            aria-label="Open settings"
            onClick={() => setOverlay("settings")}
          >
            <Icon name="sliders" />
            Quick preferences
          </button>
          <a href="/control">
            Your space
            <Icon name="arrow" />
          </a>
        </footer>
      </main>

      {drafts && (
        <DraftReview
          drafts={drafts}
          setDrafts={setDrafts}
          notice={notice}
          busy={busy}
          memoryEnabled={state.settings.memoryEnabled}
          close={() => setDrafts(null)}
          onSave={saveDrafts}
        />
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
          title="Quick preferences"
          close={() => setOverlay(null)}
        >
          <nav className="settings-shortcuts" aria-label="Settings sections">
            <a href="/control?panel=account">Account</a>
            <a href="/control?panel=notes">Notes &amp; activity</a>
            <a href="/control?panel=voice">Voice &amp; conversation</a>
            <a href="/control?panel=privacy">Memory &amp; privacy</a>
            <a href="/control?panel=advanced">Advanced</a>
          </nav>
          <p className="quick-settings-explainer">
            Adjust the essentials here. All your tools and detailed preferences
            live in <a href="/control">Your space</a>.
          </p>
          <button
            className="text-button"
            aria-label="Open connections"
            onClick={() => setOverlay("connections")}
          >
            Connected apps &amp; shared work
            <Icon name="arrow" />
          </button>
          <ConversationPreferences />
          <VoicePreferences />
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
            <a href="/control?panel=privacy">
              Memory, privacy &amp; data controls ↗
            </a>
          </section>
        </Overlay>
      )}
      {overlay === "connections" && (
        <Overlay title="Connected work" close={() => setOverlay(null)}>
          <p>
            Connect apps, create shared workspaces, and review scheduled actions
            in Your space. Local notes are not uploaded automatically.
          </p>
          <a className="primary-button" href="/control?panel=shared">
            Open connected work
          </a>
        </Overlay>
      )}
    </div>
  );
}
