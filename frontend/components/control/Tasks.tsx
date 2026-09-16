'use client';
// The one To-Do list. Canvas tasks, reminders and (on request) shared server
// tasks are merged into a single list with due dates, priorities and a
// done-state; completing an item writes back to wherever it came from.
// The merge lives in lib/todo.ts (pure, tested) so the list can never quietly
// invent a task.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useWorkspaceStore } from '@/store/workspace';
import { useAssistantStore } from '@/store/assistant';
import { draftCapture } from '@/lib/workspace/model';
import { platformApi } from '@/lib/platform';
import {
  TODO_VIEWS,
  buildTodoList,
  completeAction,
  filterTodo,
  groupTodo,
  PRIORITY_LABEL,
  speakTodoSummary,
  todoCounts,
  withPriorityNote,
  type TodoView,
} from '@/lib/todo';

const ORIGIN_CHIP: Record<string, string> = {
  device: 'saved here',
  reminder: 'reminder',
  server: 'shared',
};

export function Tasks() {
  const items = useWorkspaceStore((s) => s.items);
  const ready = useWorkspaceStore((s) => s.ready);
  const userId = useAssistantStore((s) => s.user?.id);
  const update = useWorkspaceStore((s) => s.update);
  const capture = useWorkspaceStore((s) => s.capture);
  const removeItem = useWorkspaceStore((s) => s.remove);
  const reminders = useAssistantStore((s) => s.reminders);
  const updateReminder = useAssistantStore((s) => s.updateReminder);
  const dismissReminder = useAssistantStore((s) => s.dismissReminder);

  // “All open” first: a task with no due date still has to appear when you open
  // the list you just saved it into. “Today” is one tap away for the dated view.
  // Your space is its own document (that is what keeps Today's provider script off
  // this screen), so nothing has loaded the canvas store here yet. The To-Do reads
  // from that store, so it loads it — otherwise the list is empty by accident and
  // ticking a row would fail with “Workspace is still loading”.
  useEffect(() => {
    void useWorkspaceStore.getState().load(userId || 'device');
  }, [userId]);

  const [view, setView] = useState<TodoView>('all');
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [server, setServer] = useState<{
    state: 'idle' | 'loading' | 'on' | 'error';
    records: { id: string; kind: string; title: string; data?: Record<string, any>; updated_at?: number }[];
    message?: string;
  }>({ state: 'idle', records: [] });

  const attempt = useCallback(async (work: () => Promise<void>, done: string) => {
    try {
      await work();
      setNotice(done);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'That change could not be saved. Nothing else was touched.');
    }
  }, []);

  const list = useMemo(
    () => buildTodoList({
      tasks: items.filter((i) => i.kind === 'task' || i.kind === 'habit' || i.kind === 'shopping').map((i) => ({
        id: i.id,
        title: i.title,
        body: i.body,
        status: i.status,
        due: i.due,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
      })),
      reminders,
      serverRecords: server.state === 'on' ? server.records : [],
    }),
    [items, reminders, server.state, server.records],
  );
  const counts = useMemo(() => todoCounts(list), [list]);
  const shown = useMemo(() => filterTodo(list, view), [list, view]);
  const groups = useMemo(() => groupTodo(shown), [shown]);

  const addTask = () => {
    const title = draft.trim();
    if (!title) {
      setNotice('Type what needs doing first.');
      return;
    }
    void attempt(async () => {
      await capture([draftCapture(`task: ${title}`)], 'typed');
      setDraft('');
    }, 'Added to your To-Do list on this browser.');
  };

  const loadServerTasks = async () => {
    setServer((s) => ({ ...s, state: 'loading' }));
    try {
      const spaces = await platformApi('/spaces');
      const first = spaces?.spaces?.[0];
      if (!first) {
        setServer({ state: 'error', records: [], message: 'No shared workspace is on this account yet. Tasks stay local until you create one in Connected work.' });
        return;
      }
      const data = await platformApi(`/spaces/${first.id}/records?pageSize=100&kind=task`);
      setServer({ state: 'on', records: data?.records || [], message: `Loaded from “${first.name}”. Server tasks are completed in Connected work, where changes are reviewed.` });
    } catch (e) {
      setServer({ state: 'error', records: [], message: e instanceof Error ? `Shared tasks could not be read: ${e.message}` : 'Shared tasks could not be read. Your local list is unchanged.' });
    }
  };

  const run = (item: (typeof list)[number]) => {
    const action = completeAction(item);
    switch (action.kind) {
      case 'canvas-status':
        return attempt(() => update(action.id, { status: action.status }), action.status === 'done' ? 'Marked done. Undo is available in Today → Activity.' : 'Reopened.');
      case 'reminder-toggle':
        return attempt(async () => {
          await updateReminder(action.id, { active: action.active });
        }, action.active ? 'Reminder switched back on.' : 'Reminder paused — it stays in Reminders.');
      case 'reminder-dismiss':
        return attempt(() => dismissReminder(action.id), 'One-time reminder dismissed.');
      case 'open-panel':
        setNotice('Server tasks are completed in Connected work, where an edit is reviewed against its revision.');
        return undefined;
      default:
        return undefined;
    }
  };

  return (
    <div className="panel-stack">
      <section className="settings-section">
        <h3>Where your To-Do comes from</h3>
        <p>
          {ready
            ? speakTodoSummary(counts)
            : 'Loading your saved records…'}{' '}
          Tasks saved on Today, reminders and shared server tasks are all listed
          here; each row says which one it came from, and finishing it updates
          that source. Nothing is copied into a fourth place.
        </p>
        <div className="sheet-actions" role="group" aria-label="To-Do views">
          {TODO_VIEWS.map((v) => (
            <button
              key={v.id}
              className={view === v.id ? 'primary-button' : 'text-button'}
              aria-pressed={view === v.id}
              onClick={() => setView(v.id)}
            >
              {v.label}
              <span className="todo-count">
                {v.id === 'today'
                  ? counts.dueToday + counts.overdue
                  : v.id === 'upcoming'
                    ? list.filter((i) => !i.done && (i.dueState !== 'none' || i.time)).length
                    : v.id === 'all'
                      ? counts.open
                      : counts.done}
              </span>
            </button>
          ))}
        </div>
        {notice && <p role="status" className="workspace-notice">{notice}</p>}
      </section>

      <section className="settings-section">
        <h3>Add one</h3>
        <div className="todo-add">
          <label className="todo-add-field">
            What needs doing?
            <input
              value={draft}
              maxLength={120}
              placeholder="Call the bank about the card"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addTask();
              }}
            />
          </label>
          <button className="primary-button" onClick={addTask} disabled={!ready}>
            Add task
          </button>
        </div>
        <p>
          <small>
            By voice anywhere in the app: “task: renew the passport”. Overdue and
            same-day items sort to the top automatically — say “mark {draft.trim() || 'that'} urgent”
            never needed; a due date is what makes a task urgent.
          </small>
        </p>
      </section>

      {!list.length ? (
        <section className="settings-section">
          <h3>Nothing to do yet</h3>
          <p>
            Add a task above, or say “remind me to … tomorrow at 7”. Your{' '}
            <Link prefetch={false} href="/control?panel=reminders">reminders</Link> live in the
            same list.
          </p>
        </section>
      ) : view === 'done' && !shown.length ? (
        <section className="settings-section">
          <h3>Nothing finished in this view</h3>
          <p>Tick a task off and it lands here, with the date it was done.</p>
        </section>
      ) : (
        groups.map((group) => (
          <section className="settings-section" key={group.id}>
            <h3>
              {group.label}
              <span className="todo-group-count">{group.items.length}</span>
            </h3>
            <ul className="todo-list">
              {group.items.map((item) => (
                <li key={item.key} className={`todo-row is-${item.origin}${item.done ? ' is-done' : ''}`}>
                  <button
                    className="todo-check"
                    aria-label={`${item.done ? 'Reopen' : 'Complete'} ${item.title}`}
                    onClick={() => void run(item)}
                  >
                    <span aria-hidden="true">{item.done ? '✓' : ''}</span>
                  </button>
                  <span className="todo-main">
                    <strong>{item.title}</strong>
                    <small>
                      {ORIGIN_CHIP[item.origin]}
                      {item.due ? ` · due ${item.due}` : item.time ? ` · ${item.time}` : ''}
                      {item.origin === 'device' ? ` · ${PRIORITY_LABEL[item.priority]}` : ''}
                      {item.alsoIn.length ? ` · also in ${item.alsoIn.map((o) => ORIGIN_CHIP[o]).join(', ')}` : ''}
                    </small>
                    {item.note && <em>{item.note.replace(/^#priority:.*$/gim, '').trim()}</em>}
                  </span>
                  {item.origin === 'device' && (
                    <span className="todo-tools">
                      <label className="todo-due">
                        Due
                        <input
                          type="date"
                          value={item.due || ''}
                          onChange={(e) =>
                            void attempt(
                              () => update(item.id, { due: e.target.value || undefined }),
                              e.target.value ? `Due date set to ${e.target.value}.` : 'Due date cleared.',
                            )
                          }
                        />
                      </label>
                      <select
                        aria-label={`Priority for ${item.title}`}
                        value={item.priority}
                        onChange={(e) =>
                          void attempt(
                            () => {
                              const canvas = items.find((i) => i.id === item.id);
                              return update(item.id, {
                                body: withPriorityNote(canvas?.body, Number(e.target.value) as 1 | 2 | 3),
                              });
                            },
                            `Priority set to ${PRIORITY_LABEL[Number(e.target.value) as 1 | 2 | 3]}.`,
                          )
                        }
                      >
                        {[3, 2, 1].map((p) => (
                          <option key={p} value={p}>
                            {PRIORITY_LABEL[p as 1 | 2 | 3]}
                          </option>
                        ))}
                      </select>
                      <button
                        className="text-button danger"
                        aria-label={`Delete ${item.title}`}
                        onClick={() => void attempt(() => removeItem(item.id), 'Deleted. Undo is available in Today → Activity.')}
                      >
                        Delete
                      </button>
                    </span>
                  )}
                  {item.origin !== 'device' && (
                    <Link prefetch={false} className="text-button" href={item.href}>
                      {item.origin === 'reminder' ? 'Open reminders' : 'Open connected work'} ↗
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <section className="settings-section">
        <h3>Shared server tasks</h3>
        <p>
          {server.state === 'idle' &&
            'Nothing is fetched until you ask. Loading reads your first shared workspace once and lists its task records here.'}
          {server.state === 'loading' && 'Loading shared tasks…'}
          {server.state === 'on' && `Showing ${server.records.length} task record${server.records.length === 1 ? '' : 's'} from the server.`}
          {server.state === 'error' && (server.message || 'Shared tasks are not available.')}
        </p>
        <div className="sheet-actions">
          {server.state === 'idle' && (
            <button onClick={() => void loadServerTasks()}>Load shared tasks</button>
          )}
          {server.state === 'error' && (
            <button onClick={() => void loadServerTasks()}>Try again</button>
          )}
          {server.state === 'on' && (
            <button className="text-button" onClick={() => setServer({ state: 'idle', records: [] })}>
              Hide shared tasks
            </button>
          )}
          <Link prefetch={false} className="text-button" href="/control?panel=shared">
            Approvals and edits happen in Connected work ↗
          </Link>
        </div>
        <p>
          <small>
            Server tasks are read-only in this list on purpose: a shared record
            is edited against its revision, in Connected work, so a change made
            in another tab cannot be overwritten by an old copy.
          </small>
        </p>
      </section>
    </div>
  );
}
