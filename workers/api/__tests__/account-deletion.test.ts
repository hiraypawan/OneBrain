import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { app } from '../src/index';
import { hash } from '../src/platform/core';
import { applyMigrations } from './helpers/migrations';

/**
 * Account deletion and the memory-clear aliases.
 *
 * These pin the 2026-10-08 fixes, which had no coverage: `DELETE
 * /api/user/delete-account` used to delete the `users` row while owned spaces
 * still referenced it (`spaces.owner_id` has no ON DELETE action), so the
 * delete could fail with a foreign-key error and leave sessions, Google
 * identities, entitlements and oauth states behind. The memory aliases let
 * both API shapes (legacy `DELETE /api/memory` and the panel's
 * `/api/memory/clear-all`) reach the same table.
 */
let mf: Miniflare, DB: any, env: any, other: any;

async function fixture(email: string) {
  const user = { id: crypto.randomUUID(), email };
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await DB.batch([
    DB.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').bind(user.id, email, Date.now()),
    DB.prepare('INSERT INTO google_identities (subject,user_id,verified_email,created_at) VALUES (?,?,?,?)').bind('sub-' + user.id, user.id, email, Date.now()),
    DB.prepare("INSERT INTO platform_sessions (token_hash,user_id,created_at,expires_at,auth_provider) VALUES (?,?,?,?,'google')").bind(await hash(token), user.id, Date.now(), Date.now() + 7 * 86400000),
  ]);
  return { user, token };
}

const call = (path: string, who: any, method = 'GET', body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${who.token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, env);

const count = async (sql: string, ...bind: unknown[]) =>
  (await DB.prepare(sql).bind(...bind).first()).n as number;

beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: 'export default { fetch(){ return new Response("ok") } }', compatibilityDate: '2026-08-06', d1Databases: ['DB'] });
  DB = await mf.getD1Database('DB');
  await applyMigrations(DB);
  env = {
    DB,
    TOKEN_ENCRYPTION_KEY: btoa('01234567890123456789012345678901'),
    API_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
  other = await fixture('bystander@example.test');
}, 30000);

afterAll(async () => { await mf?.dispose(); });

describe('DELETE /api/user/delete-account', () => {
  it('removes the user, their owned workspace and every row scoped to them', async () => {
    const doomed = await fixture('doomed@example.test');
    const shared = await fixture('teammate@example.test');
    const now = Date.now();
    const uid = doomed.user.id;

    await DB.batch([
      // A workspace this user owns — the row that used to make the delete fail.
      DB.prepare('INSERT INTO spaces (id,name,owner_id,created_at) VALUES (?,?,?,?)').bind('owned-space', 'Owned', uid, now),
      DB.prepare("INSERT INTO space_members (space_id,user_id,role,joined_at) VALUES (?,?,?,?)").bind('owned-space', uid, 'owner', now),
      DB.prepare('INSERT INTO space_records (id,space_id,kind,title,data,revision,created_by,created_at,updated_at,mutation_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .bind('rec-1', 'owned-space', 'note', 'title', '{}', 1, uid, now, now, 'm1'),
      // A workspace someone else owns, where this user is only a member.
      DB.prepare('INSERT INTO spaces (id,name,owner_id,created_at) VALUES (?,?,?,?)').bind('shared-space', 'Shared', other.user.id, now),
      DB.prepare("INSERT INTO space_members (space_id,user_id,role,joined_at) VALUES (?,?,?,?)").bind('shared-space', uid, 'editor', now),
      DB.prepare('INSERT INTO conversations (id,user_id,created_at) VALUES (?,?,?)').bind('conv-1', uid, now),
      DB.prepare('INSERT INTO messages (uuid,conversation_id,user_id,role,content,created_at) VALUES (?,?,?,?,?,?)').bind('msg-1', 'conv-1', uid, 'user', 'hi', now),
      DB.prepare('INSERT INTO user_memory (id,user_id,memory_type,key,value,created_at) VALUES (?,?,?,?,?,?)').bind('mem-1', uid, 'fact', 'k', '"v"', now),
      DB.prepare('INSERT INTO reminders (id,user_id,title,reminder_time,created_at) VALUES (?,?,?,?,?)').bind('rem-1', uid, 't', '09:00', now),
      DB.prepare('INSERT INTO reset_tokens (token,user_id,expires_at) VALUES (?,?,?)').bind('reset-1', uid, now + 1000),
      DB.prepare("INSERT INTO user_entitlements (user_id,plan,source,granted_at) VALUES (?,?,?,?)").bind(uid, 'pro', 'key', now),
      DB.prepare('INSERT INTO entitlement_usage (user_id,feature,period,count,updated_at) VALUES (?,?,?,?,?)').bind(uid, 'researchPerDay', '2026-10-08', 2, now),
      DB.prepare('INSERT INTO entitlement_events (id,user_id,actor_id,operation,at) VALUES (?,?,?,?,?)').bind('evt-1', uid, uid, 'redeem', now),
      DB.prepare("INSERT INTO entitlement_keys (key_hash,plan,label,created_by,created_at,redeemed_by,redeemed_at) VALUES (?,?,?,?,?,?,?)").bind('key-1', 'pro', 'k', 'operator@example.test', now, uid, now),
      DB.prepare('INSERT INTO oauth_states (state_hash,space_id,user_id,provider,verifier,expires_at) VALUES (?,?,?,?,?,?)').bind('state-1', 'owned-space', uid, 'google', 'sealed', now + 600000),
    ]);

    const response = await call('/api/user/delete-account', doomed, 'DELETE');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    for (const [table, column] of [
      ['users', 'id'], ['conversations', 'user_id'], ['messages', 'user_id'], ['user_memory', 'user_id'],
      ['reminders', 'user_id'], ['reset_tokens', 'user_id'], ['platform_sessions', 'user_id'],
      ['google_identities', 'user_id'], ['user_entitlements', 'user_id'], ['entitlement_usage', 'user_id'],
      ['entitlement_events', 'user_id'], ['space_members', 'user_id'], ['oauth_states', 'user_id'],
      ['spaces', 'owner_id'],
    ] as const) {
      expect(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`, uid), `${table}.${column} still references the deleted user`).toBe(0);
    }

    // The redeemed key survives as a used key, not as a dangling owner.
    const key = await DB.prepare('SELECT redeemed_by FROM entitlement_keys WHERE key_hash = ?').bind('key-1').first();
    expect(key).toEqual({ redeemed_by: null });

    // Someone else's workspace and membership untouched.
    expect(await count('SELECT COUNT(*) AS n FROM spaces WHERE owner_id = ?', other.user.id)).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM space_members WHERE user_id = ?', other.user.id)).toBe(0);
  });

  it('refuses to delete anything without a session', async () => {
    const response = await app.request('/api/user/delete-account', { method: 'DELETE' }, env);
    expect(response.status).toBe(401);
    expect(await count('SELECT COUNT(*) AS n FROM users')).toBeGreaterThan(0);
  });
});

describe('memory clearing accepts both API shapes', () => {
  it('clears only the caller under DELETE /api/memory and /api/memory/clear-all', async () => {
    const owner = await fixture('memory-owner@example.test');
    const now = Date.now();
    for (const [id, who] of [['m-own-1', owner], ['m-other-1', other]] as const) {
      await DB.prepare('INSERT INTO user_memory (id,user_id,memory_type,key,value,created_at) VALUES (?,?,?,?,?,?)')
        .bind(id, who.user.id, 'fact', 'k', '"v"', now).run();
    }

    const legacy = await call('/api/memory', owner, 'DELETE');
    expect(legacy.status).toBe(200);
    expect(await count('SELECT COUNT(*) AS n FROM user_memory WHERE user_id = ?', owner.user.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM user_memory WHERE user_id = ?', other.user.id)).toBe(1);

    // The other shape still works for a client that saved memories again.
    await DB.prepare('INSERT INTO user_memory (id,user_id,memory_type,key,value,created_at) VALUES (?,?,?,?,?,?)')
      .bind('m-own-2', owner.user.id, 'fact', 'k2', '"v"', now).run();
    const named = await call('/api/memory/clear-all', owner, 'DELETE');
    expect(named.status).toBe(200);
    expect(await count('SELECT COUNT(*) AS n FROM user_memory WHERE user_id = ?', owner.user.id)).toBe(0);
  });
});

describe('speech boundary is honest', () => {
  it('answers server transcription with 501 and no transcript instead of a fake empty success', async () => {
    const who = await fixture('speaker@example.test');
    const response = await call('/api/speech/stt', who, 'POST', {});
    expect(response.status).toBe(501);
    const body: any = await response.json();
    expect(body.transcript).toBe('');
    expect(String(body.error)).toMatch(/not enabled/i);
    expect(body.note).toBeUndefined();
  });
});
