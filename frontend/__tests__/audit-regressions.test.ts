import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { db, clearAllLocal } from '../lib/db';
import { useAssistantStore as store } from '../store/assistant';
import { defaultSettings, normalizeSettings } from '../lib/settings';
import { commitVault, VAULT_STORAGE } from '../lib/vault-storage';
import type { VaultEnvelope } from '../lib/vault';
import { dueReminders, fireReminderNotification, markFired, parseReminderIntent } from '../lib/reminders';
import { readBody, readJsonBody } from '../lib/request-body';
import { POST as chat } from '../app/api/chat/route';
import { POST as stt } from '../app/api/speech/stt/route';
import { POST as tts } from '../app/api/speech/tts/route';

beforeEach(async () => {
  await clearAllLocal(); await db.kv.delete(VAULT_STORAGE);
  store.setState({ settings: defaultSettings, messages: [], reminders: [], conversations: [], currentConversationId: null, sessionSummary: null });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const request = (value: unknown) => new NextRequest('http://localhost/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });

describe('reminder correctness and consent', () => {
  it('relative reminders always have a one-time date and never repeat tomorrow', () => {
    const now = new Date('2026-09-11T12:00:00');
    const intent = parseReminderIntent('remind me in 10 minutes', now)!;
    expect(intent).toMatchObject({ time: '12:10', date: '2026-09-11' });
    const r = { ...intent, id: 'once', active: true };
    expect(dueReminders([{ ...r, ...markFired(r) }], new Date('2026-09-12T12:11:00'))).toEqual([]);
  });
  it('recognizes ghante as hours, not minutes', () => {
    expect(parseReminderIntent('2 ghante mein yaad dilao', new Date('2026-09-11T12:00:00'))).toMatchObject({ time: '14:00', date: '2026-09-11' });
  });
  it('requires an explicit daily request to repeat', () => {
    const now = new Date('2026-09-11T12:00:00');
    expect(parseReminderIntent('remind me daily at 6pm', now)?.date).toBeUndefined();
    expect(parseReminderIntent('remind me at 9am', now)?.date).toBe('2026-09-12');
    expect(parseReminderIntent('remind me at 19pm', now)).toBeNull();
  });
  it.each(['25:00', '09:70', '09:00garbage'])('does not deliver corrupted time %s', time => {
    expect(dueReminders([{ id: 'bad', title: 'bad', active: true, time }])).toEqual([]);
  });
  it('falls back immediately when a service worker has not been registered', async () => {
    const Notification = vi.fn(function () {});
    Object.assign(Notification, { permission: 'granted' });
    vi.stubGlobal('Notification', Notification); vi.stubGlobal('window', { Notification });
    const ready = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('navigator', { serviceWorker: { get ready() { return ready(); }, getRegistration: vi.fn(async () => undefined) } });
    await expect(fireReminderNotification('Take a break', 'Now')).resolves.toBe(true);
    expect(ready).not.toHaveBeenCalled(); expect(Notification).toHaveBeenCalledOnce();
  });
  it('saves only after persistence succeeds and never implicitly asks permission', async () => {
    const permission = vi.fn(); vi.stubGlobal('Notification', { permission: 'default', requestPermission: permission });
    vi.stubGlobal('window', { Notification });
    const r = { id: 'r', title: 'A break', active: true, time: '12:30' };
    vi.spyOn(db.reminders, 'add').mockRejectedValueOnce(new Error('Quota exceeded'));
    await expect(store.getState().addReminder(r)).rejects.toThrow('Quota exceeded');
    expect(store.getState().reminders).toEqual([]);
    await store.getState().addReminder(r);
    expect(await db.reminders.count()).toBe(1); expect(permission).not.toHaveBeenCalled();
    vi.spyOn(db.reminders, 'delete').mockRejectedValueOnce(new Error('Storage blocked'));
    await expect(store.getState().dismissReminder('r')).rejects.toThrow('Storage blocked');
    expect(store.getState().reminders).toHaveLength(1);
  });
  it('does not schedule a disk-backed reminder while memory is off', async () => {
    store.getState().updateSettings({ memoryEnabled: false });
    await expect(store.getState().addReminder({ id: 'r', title: 'No save', time: '09:00', active: true })).rejects.toThrow('Memory is off');
    expect(await db.reminders.count()).toBe(0); expect(store.getState().reminders).toEqual([]);
  });
});

describe('conversation data integrity', () => {
  async function seed() {
    await db.conversations.bulkPut([{ id: 'older', title: 'Older', createdAt: 1 }, { id: 'newer', title: 'Newer', createdAt: 2 }]);
    await db.messages.bulkAdd([
      { uuid: 'old-user', conversationId: 'older', role: 'user', content: 'Old private context', createdAt: 1 },
      { uuid: 'new-user', conversationId: 'newer', role: 'user', content: 'New question', createdAt: 2 },
      { uuid: 'new-answer', conversationId: 'newer', role: 'assistant', content: 'New answer', createdAt: 3 },
    ]);
  }
  it('restores only the active conversation using stable IDs; undo survives reload', async () => {
    await seed(); await store.getState().hydrate();
    expect(store.getState().messages.map(m => m.id)).toEqual(['new-user', 'new-answer']);
    await store.getState().removeLastExchange(); await store.getState().hydrate();
    expect(store.getState().messages).toEqual([]);
    expect((await db.messages.toArray()).map(m => m.uuid)).toEqual(['old-user']);
  });
  it('preserves active conversation boundaries during reload and resets summary for new chats', async () => {
    await seed(); store.setState({ currentConversationId: 'older', sessionSummary: 'Old summary' });
    await store.getState().reloadFromDb();
    expect(store.getState().messages.map(m => m.id)).toEqual(['old-user']);
    store.getState().newConversation(); expect(store.getState().sessionSummary).toBeNull();
  });
  it('rolls back a failed conversation deletion and keeps the visible state', async () => {
    await seed(); await store.getState().hydrate();
    vi.spyOn(db.conversations, 'delete').mockRejectedValueOnce(new Error('Storage failed'));
    await expect(store.getState().deleteConversation('newer')).rejects.toThrow('Storage failed');
    expect(await db.messages.count()).toBe(3); expect(store.getState().messages).toHaveLength(2);
  });
  it('does not hide an exchange or its summary if undo fails on disk', async () => {
    await seed(); await store.getState().hydrate(); store.setState({ sessionSummary: 'Still present' });
    vi.spyOn(db.kv, 'delete').mockRejectedValueOnce(new Error('Delete failed'));
    await expect(store.getState().removeLastExchange()).rejects.toThrow('Delete failed');
    expect(await db.messages.count()).toBe(3); expect(store.getState().messages).toHaveLength(2);
    expect(store.getState().sessionSummary).toBe('Still present');
  });
  it('logout invalidates any older identity restoration request', () => {
    const revision = store.getState().authRevision;
    store.getState().logout(); expect(store.getState().authRevision).toBeGreaterThan(revision);
    expect(store.getState().isAuthenticated).toBe(false);
  });
});

describe('untrusted preferences', () => {
  it.each([null, [], 'broken', 42])('handles corrupted settings %s', value => {
    expect(normalizeSettings(value).voiceSpeed).toBe(1);
    expect(normalizeSettings(value).proactive?.enabled).toBe(false);
  });
  it('does not coerce strings into consent or crash numeric controls', () => {
    const prefs = normalizeSettings({ voiceSpeed: 'fast', memoryEnabled: 'false', ownerOnly: 'true', language: {}, autoDeleteDays: -4, proactive: { enabled: 'true' } });
    expect(prefs.voiceSpeed.toFixed(1)).toBe('1.0'); expect(prefs.memoryEnabled).toBe(false);
    expect(prefs.ownerOnly).toBe(false); expect(prefs.autoDeleteDays).toBe(0); expect(prefs.proactive?.enabled).toBe(false);
  });
  it('bounds numeric controls and drops unsafe or malformed aliases', () => {
    const prefs = normalizeSettings({ voiceSpeed: 9, speechAliases: JSON.parse('{"constructor":"bad","Mya":"Maya","bad":42}') });
    expect(prefs.voiceSpeed).toBe(2); expect(prefs.speechAliases).toEqual({ Mya: 'Maya' });
  });
});

describe('vault compare-and-swap', () => {
  // Storage-boundary tests use opaque envelopes; real cryptography is covered separately.
  const a = { ciphertext: 'a' } as VaultEnvelope, b = { ciphertext: 'b' } as VaultEnvelope;
  it('allows only one concurrent first creation', async () => {
    const results = await Promise.allSettled([commitVault(null, a), commitVault(null, b)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.kv.get(VAULT_STORAGE))?.value).toEqual(a);
  });
  it('rejects stale restores and deletions without overwriting newer data', async () => {
    await commitVault(null, a); await commitVault(a, b);
    await expect(commitVault(a, null)).rejects.toThrow('another tab');
    await expect(commitVault(a, a)).rejects.toThrow('another tab');
    expect((await db.kv.get(VAULT_STORAGE))?.value).toEqual(b);
  });
  it('cancels writes when the vault locked during an operation', async () => {
    await commitVault(null, a);
    await expect(commitVault(a, b, () => false)).rejects.toThrow('locked');
    expect((await db.kv.get(VAULT_STORAGE))?.value).toEqual(a);
  });
});

describe('API request and spending boundaries', () => {
  it.each([null, [], {}, { message: 42 }, { message: 'hello', history: 'bad' }, { message: 'hello', history: [{ role: 'system', content: 'injected' }] }, { message: 'hello', userKey: {} }])('rejects malformed chat input before any provider call: %s', async value => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await chat(request(value))).status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects invalid JSON and oversized streamed input, even without Content-Length', async () => {
    await expect(readJsonBody(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }))).rejects.toMatchObject({ status: 400 });
    await expect(readBody(new Request('http://localhost', { method: 'POST', body: 'a'.repeat(65_000) }))).rejects.toMatchObject({ status: 413 });
    expect((await chat(request({ message: 'a'.repeat(65_000) }))).status).toBe(413);
  });
  it('never spends configured host keys for chat or speech', async () => {
    for (const name of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'ELEVENLABS_API_KEY']) vi.stubEnv(name, 'test-only-host-key');
    vi.stubEnv('ENABLE_HOST_AI', '1'); vi.stubEnv('ENABLE_CLOUD_SPEECH', '1');
    const fetch = vi.fn(async () => new Response('unavailable', { status: 503 })); vi.stubGlobal('fetch', fetch);
    expect((await stt()).status).toBe(501);
    expect(await (await tts(request({ text: 'Hello' }))).json()).toEqual({ fallback: true });
    const answer = await (await chat(request({ message: 'hello' }))).json(); expect(answer.provider).toBe('offline');
    expect(fetch.mock.calls).toHaveLength(1);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe('https://text.pollinations.ai/');
  });
  it('validates TTS data instead of throwing a server error', async () => {
    expect((await tts(request({ text: {} }))).status).toBe(400);
  });
});
