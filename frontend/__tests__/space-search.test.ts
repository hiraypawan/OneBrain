import { describe, expect, it } from 'vitest';
import { SPACE_SEARCH_SCOPE, scoreHit, searchSpace } from '@/lib/space-search';

const NOW = Date.parse('2026-09-16T12:00:00');
const day = (n: number) => NOW - n * 86400000;

const input = {
  query: 'passport',
  items: [
    { id: 'n1', kind: 'note', title: 'Police station timings', body: 'For the passport appointment.', status: 'active', createdAt: day(2) },
    { id: 't1', kind: 'task', title: 'Renew passport', body: '', status: 'active', due: '2026-09-20', createdAt: day(1) },
    { id: 'd1', kind: 'decision', title: 'Decided: renew before travel', body: 'passport queue is long', status: 'active', createdAt: day(9) },
    { id: 't2', kind: 'task', title: 'Renew passport', body: '', status: 'done', createdAt: day(3) },
  ],
  reminders: [{ id: 'r1', title: 'Collect the passport form', time: '10:00', date: '2026-09-18', active: true }],
  conversations: [{ id: 'c1', title: 'Travel paperwork', summary: 'passport fees and the police station', createdAt: day(4) }],
  messages: [{ content: 'I said I would renew my passport this month', role: 'user', createdAt: day(4) }],
  stories: [{ id: 's1', title: 'Passport Pete the pilot', updatedAt: day(6) }],
  drafts: [{ id: 'e1', subject: 'Leave request for passport renewal', body: 'Two days, please.', createdAt: day(5) }],
  logs: [{ id: 'l1', kind: 'expense', label: 'Spent ₹1500 — passport fee', createdAt: day(3) }],
  catalog: [
    { id: 'tasks', title: 'To-Do', description: 'One list for tasks, reminders and shared work.', keywords: 'todo task pending' },
    { id: 'reminders', title: 'Reminders', description: 'A daily nudge or a one-time reminder.', keywords: 'nudge alarm' },
  ],
};

describe('one search box over the whole space', () => {
  const result = searchSpace(input);

  it('finds every kind of saved thing, not just notes', () => {
    expect(result.bySection.map((g) => g.section)).toEqual(
      expect.arrayContaining(['todo', 'notes', 'decisions', 'conversations', 'stories', 'drafts', 'fitness', 'reminders']),
    );
    expect(result.total).toBeGreaterThanOrEqual(8);
    expect(result.empty).toBe(false);
  });

  it('routes each hit to the panel that can act on it', () => {
    const by = (section: string) => result.hits.find((h) => h.section === section);
    expect(by('todo')?.href).toBe('/?item=t1');
    expect(by('notes')?.href).toBe('/?item=n1');
    expect(by('decisions')?.href).toBe('/?item=d1');
    expect(by('conversations')?.href).toBe('/conversations?id=c1');
    expect(by('reminders')?.href).toBe('/control?panel=reminders');
    expect(by('fitness')?.href).toContain('/track?lens=');
    // A word that names a tool finds the tool itself, linking to its panel.
    const tools = searchSpace({ ...input, query: 'reminders' }).hits.filter((h) => h.section === 'tools');
    expect(tools.map((h) => h.href)).toContain('/control?panel=reminders');
  });

  it('ranks a title hit above a body-only hit', () => {
    const noteIndex = result.hits.findIndex((h) => h.id === 'item:n1'); // body match
    const firstTitle = result.hits.findIndex((h) => h.title.toLowerCase().includes('passport'));
    expect(noteIndex).toBeGreaterThan(firstTitle);
    expect(result.hits[0].title.toLowerCase()).toContain('passport');
  });

  it('shows a finished task as finished instead of hiding it', () => {
    const todo = result.hits.filter((h) => h.section === 'todo');
    expect(todo.map((h) => h.id)).toEqual(['item:t1', 'item:t2']);
    expect(todo[1].snippet.startsWith('Done ·')).toBe(true);
  });

  it('says which sections it searched, and never touches the vault', () => {
    expect(SPACE_SEARCH_SCOPE).toMatch(/[Vv]ault/);
    expect(SPACE_SEARCH_SCOPE).toMatch(/never searched/i);
    expect(result.hits.some((h) => /vault/i.test(h.sectionLabel))).toBe(false);
  });

  it('is empty, not creative, when nothing matches', () => {
    const none = searchSpace({ ...input, query: 'zzqq nothingzz qqzz' });
    expect(none.hits).toEqual([]);
    expect(none.total).toBe(0);
    expect(none.empty).toBe(true);
    expect(none.bySection).toEqual([]);
  });

  it('ignores a query too short to mean anything', () => {
    for (const q of ['  ', 'a b', 'go', 'hi']) {
      expect(searchSpace({ ...input, query: q }).empty, q).toBe(true);
    }
  });

  it('respects the result limit', () => {
    expect(searchSpace({ ...input, limit: 3 }).hits).toHaveLength(3);
  });

  it('scores by term, with a bounded recency nudge', () => {
    expect(scoreHit('passport', 'Renew passport', '', NOW)).toBeGreaterThan(scoreHit('passport', 'Timings', 'passport office', NOW));
    // Short terms are whole-word: "hi" must not match "timings".
    expect(scoreHit('hi', 'Police station timings', '', NOW)).toBe(0);
    expect(scoreHit('missing', 'anything', 'body', NOW)).toBe(0);
    expect(scoreHit('', 'anything', 'body', NOW)).toBe(0);
    const fresh = scoreHit('xx', 'xx', '', NOW, NOW);
    const old = scoreHit('xx', 'xx', '', day(400), NOW);
    expect(fresh - old).toBeLessThanOrEqual(1);
    expect(fresh - old).toBeGreaterThan(0.9);
  });
});
