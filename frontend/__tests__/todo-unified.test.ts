import { describe, expect, it } from 'vitest';
import {
  PRIORITY_LABEL,
  TODO_VIEWS,
  buildTodoList,
  cleanTitle,
  completeAction,
  dueStateOf,
  filterTodo,
  groupTodo,
  inferPriority,
  readPriorityNote,
  speakTodoSummary,
  todoCounts,
  todoFingerprint,
  withPriorityNote,
} from '@/lib/todo';

const NOON = Date.parse('2026-09-16T12:00:00');

describe('title hygiene', () => {
  it('strips priority markers out of the visible title', () => {
    expect(cleanTitle('Pay the electric bill !!')).toEqual({ title: 'Pay the electric bill', explicit: 3 });
    expect(cleanTitle('Renew passport!')).toEqual({ title: 'Renew passport', explicit: 2 });
    expect(cleanTitle('Sort the photo archive priority: low')).toEqual({ title: 'Sort the photo archive', explicit: 1 });
    expect(cleanTitle('Buy milk')).toEqual({ title: 'Buy milk', explicit: 0 });
  });
  it('reads Hinglish urgency and calendar urgency alike', () => {
    expect(inferPriority('Bank jaldi', undefined, 'none')).toBe(3);
    expect(inferPriority('Water the plants', undefined, 'overdue')).toBe(3);
    expect(inferPriority('Read the annual report', undefined, 'none')).toBe(2);
    expect(inferPriority('Rearrange the shelf', 'sometime later', 'none')).toBe(1);
  });
  it('keeps an explicit marker as the last word', () => {
    expect(inferPriority('File taxes !!', undefined, 'none')).toBe(3);
  });
});

describe('due states', () => {
  it('classifies a date without timezone drift', () => {
    expect(dueStateOf('2026-09-15', NOON)).toBe('overdue');
    expect(dueStateOf('2026-09-16', NOON)).toBe('today');
    expect(dueStateOf('2026-09-18', NOON)).toBe('soon');
    expect(dueStateOf('2026-10-01', NOON)).toBe('none');
    expect(dueStateOf(undefined, NOON)).toBe('none');
    expect(dueStateOf('whenever', NOON)).toBe('none');
  });
});

describe('the unified list', () => {
  const list = buildTodoList({
    tasks: [
      { id: 'a', title: 'Pay the electric bill !!', due: '2026-09-14', createdAt: NOON - 9e7, updatedAt: NOON - 8e7 },
      { id: 'b', title: 'Draft the Diwali post', due: '2026-09-16', createdAt: NOON - 5e7 },
      { id: 'c', title: 'Read the annual report', createdAt: NOON - 4e7 },
      { id: 'd', title: 'Renew passport', due: '2026-09-19', createdAt: NOON - 3e7, status: 'done' },
      { id: 'e', title: '   ', createdAt: NOON }, // blank titles are dropped
    ],
    reminders: [
      { id: 'r1', title: 'Call Mom', time: '19:30', active: true },
      { id: 'r2', title: 'Pay the electric bill', time: '09:00', date: '2026-09-14', active: true },
      { id: 'r3', title: 'Pick up laundry', time: '17:00', date: '2026-09-10', active: false },
    ],
    serverRecords: [
      { id: 's1', kind: 'task', title: 'Ship release notes', data: { due: '2026-09-17', priority: 'high', status: 'active' }, updated_at: NOON / 1000 },
      { id: 's2', kind: 'note', title: 'ignored', data: {} },
    ],
    now: NOON,
  });

  it('merges three origins and drops blank or foreign kinds', () => {
    expect(list.map((i) => i.origin).sort()).toEqual(['device', 'device', 'device', 'device', 'reminder', 'reminder', 'server']);
    expect(list.find((i) => i.title === 'ignored')).toBeUndefined();
  });

  it('dedupes the same task across places instead of listing it twice', () => {
    const bill = list.filter((i) => i.title === 'Pay the electric bill');
    expect(bill).toHaveLength(1);
    expect(bill[0].origin).toBe('device');
    expect(bill[0].alsoIn).toEqual(['reminder']);
  });

  it('sorts overdue, then today, then priority, and keeps done at the bottom', () => {
    expect(list.map((i) => i.title)).toEqual([
      'Pay the electric bill', // overdue + an explicit !! marker
      'Draft the Diwali post', // due today
      'Ship release notes', // soon, but high on the server record
      'Call Mom', // no date, but it has a time, so it is later than "someday"
      'Read the annual report', // no date, no time
      'Pick up laundry', // a fired one-time reminder lands with the done items
      'Renew passport',
    ]);
  });

  it('treats a fired dated reminder as finished and a paused one as open', () => {
    expect(list.find((i) => i.id === 'r3')?.done).toBe(true);
    expect(list.find((i) => i.id === 'r1')?.done).toBe(false);
  });

  it('counts open work the way the tab header needs', () => {
    const counts = todoCounts(list, NOON);
    expect(counts).toMatchObject({ open: 5, dueToday: 3, overdue: 1, done: 2 });
    expect(counts.byOrigin).toEqual({ device: 3, reminder: 1, server: 1 });
    expect(speakTodoSummary(counts)).toBe('OneBrain To-Do: 5 open tasks, 3 due today, 1 overdue.');
  });

  it('filters by view without losing the one-time reminders that have no date', () => {
    expect(filterTodo(list, 'today', NOON).map((i) => i.title)).toEqual([
      'Pay the electric bill',
      'Draft the Diwali post',
      'Call Mom',
    ]);
    expect(filterTodo(list, 'upcoming', NOON).map((i) => i.title)).toEqual([
      'Pay the electric bill',
      'Draft the Diwali post',
      'Ship release notes',
      'Call Mom',
    ]);
    expect(filterTodo(list, 'done', NOON).map((i) => i.title)).toEqual(['Pick up laundry', 'Renew passport']);
    expect(filterTodo(list, 'all', NOON)).toHaveLength(5);
    expect(TODO_VIEWS.map((v) => v.id)).toEqual(['today', 'upcoming', 'all', 'done']);
  });

  it('groups the list under headings a person can read out loud', () => {
    const groups = groupTodo(filterTodo(list, 'all', NOON), NOON);
    expect(groups.map((g) => g.label)).toEqual(['Overdue', 'Today', 'Next few days', 'Later']);
    expect(groups[1].items.map((i) => i.title)).toEqual(['Draft the Diwali post', 'Call Mom']);
    expect(groups[3].items.map((i) => i.title)).toEqual(['Read the annual report']);
  });

  it('links every row back to the place that owns it', () => {
    expect(list.find((i) => i.origin === 'device')?.href).toBe('/?item=a');
    expect(list.find((i) => i.origin === 'reminder')?.href).toBe('/control?panel=reminders');
    expect(list.find((i) => i.origin === 'server')?.href).toBe('/control?panel=shared');
  });

  it('says the list is empty when it is, and does not pad it', () => {
    expect(speakTodoSummary(todoCounts([], NOON))).toContain('empty');
    expect(speakTodoSummary({ open: 0, dueToday: 0, overdue: 0, done: 2, byOrigin: { device: 0, reminder: 0, server: 0 } })).toContain('already finished');
  });
});

describe('writing back to the source', () => {
  it('maps each origin to its own completion path', () => {
    const build = (over: Record<string, unknown>) =>
      buildTodoList({ tasks: [], reminders: [], serverRecords: [], ...over, now: NOON } as never)[0];
    expect(completeAction(build({ tasks: [{ id: 'a', title: 'x', createdAt: NOON }] }))).toEqual({ kind: 'canvas-status', id: 'a', status: 'done' });
    expect(completeAction(build({ tasks: [{ id: 'a', title: 'x', createdAt: NOON, status: 'done' }] }))).toEqual({ kind: 'canvas-status', id: 'a', status: 'active' });
    expect(completeAction(build({ reminders: [{ id: 'r', title: 'x', time: '07:00', active: true }] }))).toEqual({ kind: 'reminder-toggle', id: 'r', active: false });
    expect(completeAction(build({ reminders: [{ id: 'r', title: 'x', time: '07:00', date: '2026-09-16', active: true }] }))).toEqual({ kind: 'reminder-dismiss', id: 'r' });
    // A shared record is never toggled from here: it needs its revision.
    expect(completeAction(build({ serverRecords: [{ id: 's', kind: 'task', title: 'x', data: {} }] }))).toEqual({ kind: 'open-panel', panel: 'shared' });
  });
});

describe('priority storage on the canvas item', () => {
  it('keeps one machine line in the body and leaves the prose alone', () => {
    const body = withPriorityNote('Notes from the call', 3);
    expect(body).toBe('Notes from the call\n#priority: high');
    expect(readPriorityNote(body)).toBe(3);
    const changed = withPriorityNote(body, 1);
    expect(changed.match(/#priority:/g)).toHaveLength(1);
    expect(changed).toBe('Notes from the call\n#priority: low');
    expect(withPriorityNote(changed, 0)).toBe('Notes from the call');
    expect(readPriorityNote('nothing here')).toBe(0);
    expect(PRIORITY_LABEL[3]).toBe('High');
  });
  it('fingerprints ignore case, punctuation and markers but respect the date', () => {
    expect(todoFingerprint('Pay the ELECTRIC bill!!')).toBe(todoFingerprint('pay the electric bill'));
    expect(todoFingerprint('Pay bill', '2026-09-14')).not.toBe(todoFingerprint('Pay bill'));
  });
});
