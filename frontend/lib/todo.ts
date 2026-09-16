// One To-Do list, three homes. Tasks today live in the canvas, in reminders and
// (optionally) on the server — this merges them into a single list with due
// dates, priorities and done-state, WITHOUT inventing a fourth store: the
// merge is computed, and completing an item writes back to wherever it came
// from. Pure + tested.

export type TodoOrigin = 'device' | 'reminder' | 'server';

export interface TodoInputTask {
  id: string;
  title: string;
  body?: string;
  status?: string;
  due?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface TodoInputReminder {
  id: string;
  title: string;
  time: string;
  date?: string;
  active: boolean;
}

export interface TodoInputRecord {
  id: string;
  kind: string;
  title: string;
  data?: Record<string, any>;
  updated_at?: number;
}

export interface TodoItem {
  key: string;
  origin: TodoOrigin;
  id: string;
  title: string;
  note?: string;
  /** YYYY-MM-DD when the item carries one. */
  due?: string;
  /** HH:MM for reminders. */
  time?: string;
  priority: 1 | 2 | 3;
  done: boolean;
  completedAt?: number;
  updatedAt: number;
  /** Where this item sits in time, computed once at build time. */
  dueState: 'overdue' | 'today' | 'soon' | 'none';
  href: string;
  /** The same thing also exists in another place; shown, never silently merged away. */
  alsoIn: TodoOrigin[];
}

export type TodoView = 'today' | 'upcoming' | 'all' | 'done';

const DAY = 86400000;

const HIGH = /(!!+|priority:\s*(high|urgent|1)|\burgent\b|\bimmediately\b|jaldi|must do|aaj hi|asap)/i;
const LOW = /(\bpriority:\s*(low|3)\b|\blow\b|sometime|kabhi|no rush|jb tak|jab tak)/i;

/** Pull priority markers out of the title so the list reads cleanly. */
export function cleanTitle(text: string): { title: string; explicit: 0 | 1 | 2 | 3 } {
  let title = String(text || '').trim();
  let explicit: 0 | 1 | 2 | 3 = 0;
  const marker = title.match(/\s*!{1,3}\s*$/);
  if (marker) {
    explicit = marker[0].includes('!!!') ? 3 : marker[0].includes('!!') ? 3 : 2;
    title = title.replace(/\s*!{1,3}\s*$/, '').trim();
  }
  const label = title.match(/\bpriority:\s*(high|med|medium|low|1|2|3)\b/i);
  if (label) {
    const v = label[1].toLowerCase();
    explicit = /high|1/.test(v) ? 3 : /low|3/.test(v) ? 1 : 2;
    title = title.replace(label[0], '').replace(/\s{2,}/g, ' ').trim();
  }
  return { title, explicit };
}

export function inferPriority(
  title: string,
  note: string | undefined,
  dueState: 'overdue' | 'today' | 'soon' | 'none',
): 1 | 2 | 3 {
  const { explicit } = cleanTitle(title);
  const haystack = `${title} ${note || ''}`;
  if (explicit) return explicit as 1 | 2 | 3;
  const stored = readPriorityNote(note);
  if (stored) return stored as 1 | 2 | 3;
  if (HIGH.test(haystack)) return 3;
  if (dueState === 'overdue' || dueState === 'today') return 3;
  if (LOW.test(haystack)) return 1;
  return 2;
}

export const PRIORITY_LABEL: Record<1 | 2 | 3, string> = { 1: 'Someday', 2: 'Normal', 3: 'High' };

function dayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** YYYY-MM-DD comparison without timezone drift. */
export function dueStateOf(due: string | undefined, now = Date.now()): TodoItem['dueState'] {
  if (!due) return 'none';
  const t = Date.parse(`${due}T00:00:00`);
  if (!Number.isFinite(t)) return 'none';
  const today = dayStart(now);
  if (t < today) return 'overdue';
  if (t === today) return 'today';
  if (t <= today + 3 * DAY) return 'soon';
  return 'none';
}

const norm = (s: string) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Duplicate detector: same words + same (or missing) date. */
export function todoFingerprint(title: string, due?: string): string {
  const { title: clean } = cleanTitle(title);
  return `${norm(clean)}|${due || ''}`;
}

const HREF = {
  device: '/?item=',
  reminder: '/control?panel=reminders',
  server: '/control?panel=shared',
} as const;

export interface TodoSources {
  tasks?: TodoInputTask[];
  reminders?: TodoInputReminder[];
  serverRecords?: TodoInputRecord[];
  now?: number;
}

/** Merge, dedupe and sort. Overdue first, then priority, then date, then touch. */
export function buildTodoList({ tasks = [], reminders = [], serverRecords = [], now = Date.now() }: TodoSources): TodoItem[] {
  const raw: TodoItem[] = [];

  for (const t of tasks) {
    if (!t?.id || !String(t.title || '').trim()) continue;
    const due = t.due ? t.due.slice(0, 10) : undefined;
    const dueState = dueStateOf(due, now);
    const { title } = cleanTitle(t.title);
    raw.push({
      key: `device:${t.id}`,
      origin: 'device',
      id: t.id,
      title,
      note: t.body && t.body !== t.title ? t.body.slice(0, 400) : undefined,
      due,
      priority: inferPriority(t.title, t.body, dueState),
      dueState,
      done: t.status === 'done',
      updatedAt: t.updatedAt || t.createdAt,
      href: `${HREF.device}${t.id}`,
      alsoIn: [],
    });
  }

  for (const r of reminders) {
    if (!r?.id || !String(r.title || '').trim()) continue;
    const due = r.date ? String(r.date).slice(0, 10) : undefined;
    const dueState = dueStateOf(due, now);
    const { title } = cleanTitle(r.title);
    raw.push({
      key: `reminder:${r.id}`,
      origin: 'reminder',
      id: r.id,
      title,
      note: `Repeats ${r.date ? 'once' : 'daily'} at ${r.time}`,
      due,
      time: r.time,
      priority: inferPriority(r.title, undefined, dueState),
      dueState,
      // A one-time reminder stops being active once it has fired.
      done: r.active === false && !!r.date,
      updatedAt: Number(r.date ? Date.parse(`${r.date}T${r.time || '09:00'}`) || now : now),
      href: HREF.reminder,
      alsoIn: [],
    });
  }

  for (const rec of serverRecords) {
    if (!rec || rec.kind !== 'task' || !String(rec.title || '').trim()) continue;
    const data = rec.data || {};
    const due = typeof data.due === 'string' ? data.due.slice(0, 10) : undefined;
    const dueState = dueStateOf(due, now);
    const { title } = cleanTitle(rec.title);
    raw.push({
      key: `server:${rec.id}`,
      origin: 'server',
      id: rec.id,
      title,
      note: typeof data.note === 'string' ? data.note.slice(0, 400) : undefined,
      due,
      priority: data.priority === 'high' ? 3 : data.priority === 'low' ? 1 : inferPriority(rec.title, undefined, dueState),
      dueState,
      done: data.status === 'done',
      updatedAt: rec.updated_at ? rec.updated_at * 1000 : now,
      href: HREF.server,
      alsoIn: [],
    });
  }

  // Dedupe by (title, due) across origins, keeping the richer record first.
  const byFp = new Map<string, TodoItem>();
  for (const item of raw) {
    const fp = todoFingerprint(item.title, item.due);
    const prev = byFp.get(fp);
    if (!prev) {
      byFp.set(fp, item);
      continue;
    }
    // Prefer the device canvas item (it holds the note + editing); mark both.
    const keep = prev.origin === 'device' ? prev : item.origin === 'device' ? item : prev;
    const other = keep === prev ? item : prev;
    keep.done = keep.done || other.done;
    keep.note = keep.note || other.note;
    keep.time = keep.time || other.time;
    keep.priority = Math.max(keep.priority, other.priority) as 1 | 2 | 3;
    if (!keep.alsoIn.includes(other.origin)) keep.alsoIn = [...keep.alsoIn, other.origin];
    byFp.set(fp, keep);
  }

  const order: Record<TodoItem['dueState'], number> = { overdue: 0, today: 1, soon: 2, none: 3 };
  return [...byFp.values()].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const sa = order[a.dueState];
    const sb = order[b.dueState];
    if (sa !== sb) return sa - sb;
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

export interface TodoCounts {
  open: number;
  dueToday: number;
  overdue: number;
  done: number;
  byOrigin: Record<TodoOrigin, number>;
}

export function todoCounts(list: TodoItem[], now = Date.now()): TodoCounts {
  const counts: TodoCounts = {
    open: 0,
    dueToday: 0,
    overdue: 0,
    done: 0,
    byOrigin: { device: 0, reminder: 0, server: 0 },
  };
  for (const i of list) {
    if (i.done) {
      counts.done += 1;
      continue;
    }
    counts.open += 1;
    counts.byOrigin[i.origin] += 1;
    const state = dueStateOf(i.due, now);
    if (state === 'today' || i.time) counts.dueToday += 1;
    if (state === 'overdue') counts.overdue += 1;
  }
  return counts;
}

export function filterTodo(list: TodoItem[], view: TodoView, now = Date.now()): TodoItem[] {
  if (view === 'done') return list.filter((i) => i.done);
  const open = list.filter((i) => !i.done);
  if (view === 'all') return open;
  if (view === 'today')
    return open.filter((i) => dueStateOf(i.due, now) === 'overdue' || dueStateOf(i.due, now) === 'today' || (!!i.time && !i.due));
  return open.filter((i) => dueStateOf(i.due, now) !== 'none' || !!i.time);
}

export interface TodoGroup {
  id: 'overdue' | 'today' | 'soon' | 'later';
  label: string;
  items: TodoItem[];
}

/** Section headings for the list, empty groups dropped. */
export function groupTodo(list: TodoItem[], now = Date.now()): TodoGroup[] {
  const buckets: Record<TodoGroup['id'], TodoItem[]> = { overdue: [], today: [], soon: [], later: [] };
  for (const i of list) {
    if (i.done) continue;
    const state = dueStateOf(i.due, now);
    if (state === 'overdue') buckets.overdue.push(i);
    else if (state === 'today' || (!!i.time && !i.due)) buckets.today.push(i);
    else if (state === 'soon') buckets.soon.push(i);
    else buckets.later.push(i);
  }
  const labels: Record<TodoGroup['id'], string> = {
    overdue: 'Overdue',
    today: 'Today',
    soon: 'Next few days',
    later: 'Later',
  };
  return (['overdue', 'today', 'soon', 'later'] as TodoGroup['id'][])
    .map((id) => ({ id, label: labels[id], items: buckets[id] }))
    .filter((g) => g.items.length);
}

/** Priority is stored on the canvas item itself, in a machine-readable line of
 *  its body — no hidden second database, and it survives export/import. */
const PRIORITY_LINE = /(?:^|\n)#priority:\s*(high|medium|low)\b/gi;

export function readPriorityNote(body?: string): 0 | 1 | 2 | 3 {
  const m = PRIORITY_LINE.exec(String(body || ''));
  PRIORITY_LINE.lastIndex = 0;
  if (!m) return 0;
  const v = m[1].toLowerCase();
  return v === 'high' ? 3 : v === 'low' ? 1 : 2;
}

/** Body with exactly one #priority line (the newest one wins). */
export function withPriorityNote(body: string | undefined, level: 1 | 2 | 3 | 0): string {
  const stripped = String(body || '').replace(PRIORITY_LINE, '').replace(/\n{3,}/g, '\n\n').trim();
  PRIORITY_LINE.lastIndex = 0;
  if (!level) return stripped;
  const label = level === 3 ? 'high' : level === 1 ? 'low' : 'medium';
  return stripped ? `${stripped}\n#priority: ${label}` : `#priority: ${label}`;
}

/** What completing a merged row has to touch, per origin. */
export type TodoAction =
  | { kind: 'canvas-status'; id: string; status: 'active' | 'done' }
  | { kind: 'canvas-due'; id: string; due: string | undefined }
  | { kind: 'canvas-priority'; id: string; body: string }
  | { kind: 'reminder-dismiss'; id: string }
  | { kind: 'reminder-toggle'; id: string; active: boolean }
  | { kind: 'open-panel'; panel: string };

export function completeAction(item: TodoItem, all?: TodoItem[]): TodoAction {
  if (item.origin === 'device') return { kind: 'canvas-status', id: item.id, status: item.done ? 'active' : 'done' };
  if (item.origin === 'reminder') {
    // A dated reminder is finished by dismissing it; a daily one is only
    // paused, because deleting it would destroy something the user repeats.
    if (item.due) return { kind: 'reminder-dismiss', id: item.id };
    return { kind: 'reminder-toggle', id: item.id, active: item.done };
  }
  void all;
  return { kind: 'open-panel', panel: 'shared' };
}

export const TODO_VIEWS: { id: TodoView; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'all', label: 'All open' },
  { id: 'done', label: 'Done' },
];

export function speakTodoSummary(counts: TodoCounts): string {
  if (!counts.open)
    return counts.done
      ? `Nothing open — ${counts.done} thing${counts.done === 1 ? '' : 's'} already finished.`
      : 'Your To-Do list is empty. Say “task: …” and I’ll add it here.';
  const bits = [`${counts.open} open task${counts.open === 1 ? '' : 's'}`];
  if (counts.dueToday) bits.push(`${counts.dueToday} due today`);
  if (counts.overdue) bits.push(`${counts.overdue} overdue`);
  return `OneBrain To-Do: ${bits.join(', ')}.`;
}
