import { db } from './db';
import { useAssistantStore } from '@/store/assistant';

const API = () => (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');

export function getToken(): string | null {
  try {
    return localStorage.getItem('onebrain_token');
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem('onebrain_token', token);
    else localStorage.removeItem('onebrain_token');
  } catch {}
}

async function backendFetch(path: string, init?: RequestInit): Promise<any> {
  const base = API();
  const token = getToken();
  if (!base || !token) throw new Error('backend not configured (no URL or token)');
  const r = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
  });
  if (!r.ok) throw new Error(`backend ${r.status}`);
  return r.json();
}

export function backendConfigured(): boolean {
  return !!API();
}

// Push local rows up (INSERT OR IGNORE server-side), then pull remote and
// merge anything missing locally. Safe to run every few minutes.
export async function syncNow(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const [convos, msgs, rems] = await Promise.all([
      db.conversations.toArray(),
      db.messages.orderBy('createdAt').reverse().limit(5000).toArray(),
      db.reminders.toArray(),
    ]);
    await backendFetch('/api/sync/backup', {
      method: 'POST',
      body: JSON.stringify({
        conversations: convos.slice(0, 500).map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt })),
        messages: msgs.map((m) => ({
          uuid: m.uuid || `db-${m.id}`, conversationId: m.conversationId,
          role: m.role, content: m.content, createdAt: m.createdAt,
        })),
        reminders: rems.map((r) => ({ id: r.id, title: r.title, time: r.time, date: r.date, active: r.active })),
      }),
    });

    const remote = await backendFetch('/api/sync/backup');
    const localUuids = new Set((await db.messages.toArray()).map((m) => m.uuid));
    const fresh = (remote.messages || []).filter((m: any) => m.uuid && !localUuids.has(m.uuid));
    if (fresh.length) {
      await db.messages.bulkAdd(
        fresh.map((m: any) => ({
          uuid: m.uuid, conversationId: m.conversation_id, role: m.role,
          content: m.content, createdAt: m.created_at,
        }))
      );
    }
    const localConvos = new Set((await db.conversations.toArray()).map((c) => c.id));
    for (const c of remote.conversations || []) {
      if (!localConvos.has(c.id)) {
        await db.conversations.put({ id: c.id, title: c.title, createdAt: c.created_at }).catch(() => {});
      }
    }
    try {
      await db.kv.put({ key: 'lastPush', value: Date.now() });
    } catch {}
    if (fresh.length) {
      try {
        await useAssistantStore.getState().reloadFromDb();
      } catch {}
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.message || 'sync failed' };
  }
}

export async function fetchMe(): Promise<{ id: string; email: string; displayName?: string } | null> {
  try {
    const j = await backendFetch('/api/auth/me');
    return j.user || null;
  } catch {
    return null;
  }
}

export async function fetchDigest(): Promise<any | null> {
  try {
    return await backendFetch('/api/digest');
  } catch {
    return null;
  }
}

export async function fetchAuthConfig(): Promise<{ google: boolean; smtp: boolean }> {
  try {
    const base = API();
    if (!base) return { google: false, smtp: false };
    const r = await fetch(`${base}/api/auth/config`);
    if (!r.ok) return { google: false, smtp: false };
    return await r.json();
  } catch {
    return { google: false, smtp: false };
  }
}
