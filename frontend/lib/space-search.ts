// One searchable roof for Your space. Notes, decisions, tasks, reminders,
// conversations, stories, email drafts, logged life and the tool catalog all
// answer to the same query box, so the space stops being fifteen doors.
// Pure: it takes rows (already in the stores) and returns ranked hits. Vault
// contents are deliberately NOT searched — they are encrypted and stay that way.

export type SpaceSectionId =
  | 'todo'
  | 'notes'
  | 'decisions'
  | 'conversations'
  | 'stories'
  | 'drafts'
  | 'fitness'
  | 'reminders'
  | 'tools';

export interface SpaceHit {
  id: string;
  section: SpaceSectionId;
  sectionLabel: string;
  title: string;
  snippet: string;
  href: string;
  at?: number;
}

export interface SpaceSearchInput {
  query: string;
  items?: {
    id: string;
    kind: string;
    title: string;
    body: string;
    status?: string;
    due?: string;
    createdAt: number;
  }[];
  reminders?: { id: string; title: string; time: string; date?: string; active: boolean; createdAt?: number }[];
  conversations?: { id: string; title: string; summary?: string; createdAt: number }[];
  messages?: { content: string; role: string; createdAt: number }[];
  stories?: { id: string; title: string; premise?: string; updatedAt: number }[];
  drafts?: { id: string; subject: string; body: string; to?: string; createdAt: number }[];
  logs?: { id: string; kind: string; label: string; detail?: string; createdAt: number }[];
  catalog?: { id: string; title: string; description: string; keywords?: string }[];
  limit?: number;
}

const SECTION_LABELS: Record<SpaceSectionId, string> = {
  todo: 'To-Do',
  notes: 'Notes',
  decisions: 'Decisions',
  conversations: 'Conversations',
  stories: 'Stories',
  drafts: 'Email drafts',
  fitness: 'Track',
  reminders: 'Reminders',
  tools: 'Tools & settings',
};

const DAY = 86400000;

function terms(query: string): string[] {
  return [...new Set(
    String(query || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1),
  )];
}

/** Whole-word test for short terms, substring for longer ones: typing "go"
 *  must not light up "google", and "hi" must not match "timings". */
function mentions(hay: string, term: string): boolean {
  if (term.length > 3) return hay.includes(term);
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'u');
  return re.test(hay);
}

/** Score 0..n: 3 per term in the title, 1 per term in the body, plus a small
 *  recency bonus so two equally-good hits surface the fresher one first. */
export function scoreHit(query: string, title: string, body: string, at: number, now = Date.now()): number {
  const list = terms(query);
  if (!list.length) return 0;
  const t = String(title || '').toLowerCase();
  const b = String(body || '').toLowerCase();
  let score = 0;
  for (const term of list) {
    if (mentions(t, term)) score += 3;
    else if (mentions(b, term)) score += 1;
  }
  if (!score) return 0;
  const ageDays = Math.max(0, (now - at) / DAY);
  return score + Math.max(0, 1 - ageDays / 120);
}

const clip = (s: string, n = 130) => {
  const text = String(s || '').replace(/\s+/g, ' ').trim();
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
};

export function searchSpace(input: SpaceSearchInput): {
  hits: SpaceHit[];
  bySection: { section: SpaceSectionId; label: string; hits: SpaceHit[] }[];
  query: string;
  total: number;
  empty: boolean;
} {
  const query = String(input.query || '').trim();
  const limit = input.limit ?? 24;
  if (query.length < 2)
    return { hits: [], bySection: [], query, total: 0, empty: true };

  const found: SpaceHit[] = [];
  const push = (hit: SpaceHit, score: number) => {
    if (score <= 0) return;
    found.push({ ...hit, title: clip(hit.title, 90), snippet: clip(hit.snippet) });
    scores.set(hit.id, score);
  };
  const scores = new Map<string, number>();

  for (const item of input.items || []) {
    const isTask = item.kind === 'task' || item.kind === 'habit' || item.kind === 'shopping';
    const section: SpaceSectionId = item.kind === 'decision'
      ? 'decisions'
      : isTask
        ? 'todo'
        : 'notes';
    push(
      {
        id: `item:${item.id}`,
        section,
        sectionLabel: SECTION_LABELS[section],
        title: item.title,
        snippet:
          (item.status === 'done' ? 'Done · ' : '') +
          (item.due ? `due ${item.due} · ` : '') +
          item.body,
        // The canvas deep link opens the exact record on Today, where it can
        // be edited; every section header already points at its own panel.
        href: `/?item=${item.id}`,
        at: item.createdAt,
      },
      scoreHit(query, item.title, `${item.body} ${item.kind}`, item.createdAt),
    );
  }

  for (const r of input.reminders || []) {
    const when = r.createdAt ?? (r.date ? Date.parse(`${r.date}T00:00:00`) || 0 : 0);
    push(
      {
        id: `reminder:${r.id}`,
        section: 'reminders',
        sectionLabel: SECTION_LABELS.reminders,
        title: r.title,
        snippet: `${r.time}${r.date ? ` on ${r.date}` : ' · daily'}${r.active ? '' : ' · paused'}`,
        href: '/control?panel=reminders',
        at: when,
      },
      scoreHit(query, r.title, r.date || '', when),
    );
  }

  for (const c of input.conversations || []) {
    push(
      {
        id: `conv:${c.id}`,
        section: 'conversations',
        sectionLabel: SECTION_LABELS.conversations,
        title: c.title,
        snippet: c.summary || 'saved conversation',
        href: `/conversations?id=${encodeURIComponent(c.id)}`,
        at: c.createdAt,
      },
      scoreHit(query, c.title, c.summary || '', c.createdAt),
    );
  }

  for (const m of input.messages || []) {
    push(
      {
        id: `msg:${m.createdAt}:${clip(m.content, 24)}`,
        section: 'conversations',
        sectionLabel: SECTION_LABELS.conversations,
        title: `${m.role === 'user' ? 'You said' : 'OneBrain said'}`,
        snippet: m.content,
        href: '/control?panel=memory-search',
        at: m.createdAt,
      },
      scoreHit(query, '', m.content, m.createdAt) - 1.2,
    );
  }

  for (const s of input.stories || []) {
    push(
      {
        id: `story:${s.id}`,
        section: 'stories',
        sectionLabel: SECTION_LABELS.stories,
        title: s.title,
        snippet: s.premise || 'story thread',
        href: '/control?panel=stories',
        at: s.updatedAt,
      },
      scoreHit(query, s.title, s.premise || '', s.updatedAt),
    );
  }

  for (const d of input.drafts || []) {
    push(
      {
        id: `draft:${d.id}`,
        section: 'drafts',
        sectionLabel: SECTION_LABELS.drafts,
        title: d.subject,
        snippet: `${d.to ? `to ${d.to} · ` : ''}${d.body}`,
        href: '/control?panel=drafts',
        at: d.createdAt,
      },
      scoreHit(query, d.subject, d.body, d.createdAt),
    );
  }

  for (const l of input.logs || []) {
    push(
      {
        id: `log:${l.id}`,
        section: 'fitness',
        sectionLabel: SECTION_LABELS.fitness,
        title: l.label,
        snippet: `${l.kind}${l.detail ? ` · ${l.detail}` : ''}`,
        href: `/track?lens=${l.kind === 'expense' ? 'expenses' : l.kind === 'food' ? 'food' : l.kind === 'workout' ? 'workouts' : 'health'}`,
        at: l.createdAt,
      },
      scoreHit(query, l.label, `${l.kind} ${l.detail || ''}`, l.createdAt) - 0.6,
    );
  }

  for (const entry of input.catalog || []) {
    push(
      {
        id: `tool:${entry.id}`,
        section: 'tools',
        sectionLabel: SECTION_LABELS.tools,
        title: entry.title,
        snippet: entry.description,
        href: `/control?panel=${entry.id}`,
        at: 0,
      },
      // The 0.5 keeps a matched tool just ahead of an equally good saved item
      // (it is the one result the user can always act on) without letting a
      // non-matching query fall through to the whole catalog.
      (() => {
        const score = scoreHit(query, entry.title, `${entry.description} ${entry.keywords || ''}`, Date.now());
        return score > 0 ? score + 0.5 : 0;
      })(),
    );
  }

  const ranked = found
    .sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0) || (b.at || 0) - (a.at || 0))
    .slice(0, limit);

  const order: SpaceSectionId[] = [
    'todo',
    'notes',
    'decisions',
    'conversations',
    'stories',
    'drafts',
    'reminders',
    'fitness',
    'tools',
  ];
  const bySection = order
    .map((section) => ({
      section,
      label: SECTION_LABELS[section],
      hits: ranked.filter((h) => h.section === section).slice(0, 6),
    }))
    .filter((group) => group.hits.length);

  return { hits: ranked, bySection, query, total: ranked.length, empty: ranked.length === 0 };
}

/** Honest scope line shown under the result list. */
export const SPACE_SEARCH_SCOPE =
  'Searches the text saved on this device — notes, tasks, reminders, conversations, stories, drafts and your log. Vault entries stay encrypted and are never searched; connected server records are searched inside Connected work.';
