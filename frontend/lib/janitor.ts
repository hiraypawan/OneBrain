import { db } from './db';
import { digestMessages } from './digest';

// Storage janitor: phones fill up. Keep the latest KEEP messages, fold the
// pruned remainder into per-month digest rows, then delete the rows.
// Respects the memory toggle (paused = skip) and autoDeleteDays setting.
export const KEEP_LATEST = 2000;

export interface PruneReport {
  pruned: number;
  kept: number;
  months: string[];
  deletedAll: boolean;
}

export function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}`;
}

export async function janitor(options?: {
  keepLatest?: number;
  autoDeleteDays?: number;
  now?: number;
}): Promise<PruneReport> {
  const keep = options?.keepLatest ?? KEEP_LATEST;
  const now = options?.now ?? Date.now();
  const total = await db.messages.count();

  // Nuclear option first: user asked to forget everything older than N days.
  if (options?.autoDeleteDays && options.autoDeleteDays > 0) {
    const cutoff = now - options.autoDeleteDays * 86400000;
    const old = await db.messages.where('createdAt').below(cutoff).primaryKeys();
    if (old.length) await db.messages.bulkDelete(old);
    const oldConvos = await db.conversations.where('createdAt').below(cutoff).primaryKeys();
    if (oldConvos.length) await db.conversations.bulkDelete(oldConvos);
    return { pruned: old.length, kept: total - old.length, months: [], deletedAll: false };
  }

  if (total <= keep) return { pruned: 0, kept: total, months: [], deletedAll: false };

  const pruneCount = total - keep;
  const oldest = await db.messages.orderBy('createdAt').limit(pruneCount).toArray();
  const byMonth = new Map<string, typeof oldest>();
  for (const m of oldest) {
    const k = monthKey(m.createdAt);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k)!.push(m);
  }
  const months: string[] = [];
  for (const [month, msgs] of byMonth) {
    const d = digestMessages(msgs.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })));
    await db.kv.put({
      key: `digest:${month}`,
      value: { month, prunedAt: now, ...d },
    });
    months.push(month);
  }
  await db.messages.bulkDelete(oldest.map((m) => m.id!));
  return { pruned: oldest.length, kept: total - oldest.length, months, deletedAll: false };
}
