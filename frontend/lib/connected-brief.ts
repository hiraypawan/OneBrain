// C1: bring Connected-work open tasks into the "what am I forgetting?" scan.
// The user asked directly, so this read is explicit — never a silent background
// fetch on startup. Everything here is best-effort: a timeout, an expired
// session or an offline server degrades to local-only data instead of failing
// the reply, and the reply is labelled only when server tasks actually joined.

import { platformApi } from './platform';

export interface ConnectedTask {
  title: string;
  due?: string;
}

async function loadConnectedTasks(): Promise<ConnectedTask[]> {
  const spaces = await platformApi('/spaces');
  const first = spaces?.spaces?.[0];
  if (!first) return [];
  const data = await platformApi(`/spaces/${first.id}/records?pageSize=60&kind=task`);
  const records: { kind?: string; title?: string; data?: Record<string, unknown> }[] =
    Array.isArray(data?.records) ? data.records : [];
  const out: ConnectedTask[] = [];
  for (const rec of records) {
    if (rec.kind !== 'task' || typeof rec.title !== 'string' || !rec.title.trim()) continue;
    const d = rec.data || {};
    if (d.status === 'done') continue;
    out.push({
      title: rec.title.trim(),
      due: typeof d.due === 'string' ? d.due.slice(0, 10) : undefined,
    });
  }
  return out;
}

/**
 * Open tasks from the signed-in user's first Connected workspace, capped at a
 * short race so the voice reply never stalls waiting for the network.
 * Returns [] (not an error) on any failure.
 */
export async function fetchConnectedOpenTasks(
  timeoutMs = 2500,
  signedIn: boolean,
): Promise<ConnectedTask[]> {
  if (!signedIn) return [];
  try {
    return await Promise.race([
      loadConnectedTasks(),
      new Promise<ConnectedTask[]>((resolve) => setTimeout(() => resolve([]), timeoutMs)),
    ]);
  } catch {
    return [];
  }
}
