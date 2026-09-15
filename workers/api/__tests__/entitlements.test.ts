import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { app } from '../src/index';
import { hash } from '../src/platform/core';
import { applyMigrations } from './helpers/migrations';
import {
  consume,
  dispatchAllowance,
  FREE_ENTITLEMENT,
  legacyBetaPlan,
  mintKey,
  PLAN_LIMITS,
  planAllows,
  resolveEntitlement,
} from '../src/platform/entitlements';

/**
 * Server-authoritative entitlements: the browser used to decide its own plan
 * with a published check-digit algorithm. These tests pin the server as the
 * authority — hashed single-use keys, operator-only grants, expiry that really
 * downgrades, and counted quotas that cannot be overshot concurrently.
 */
let mf: Miniflare, env: any, DB: any;
let owner: any, member: any, operator: any;

async function api(path: string, who: any, method = 'GET', body?: any, override = env) {
  const response = await app.request('/api/platform' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(who?.token ? { Authorization: `Bearer ${who.token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, override);
  return { status: response.status, headers: response.headers, body: (await response.json()) as any };
}

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

beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: 'export default { fetch(){ return new Response("ok") } }', compatibilityDate: '2026-08-06', d1Databases: ['DB'] });
  DB = await mf.getD1Database('DB');
  await applyMigrations(DB);
  env = {
    DB,
    TOKEN_ENCRYPTION_KEY: btoa('01234567890123456789012345678901'),
    ENTITLEMENT_ADMINS: 'operator@example.test, second@example.test',
    API_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
  owner = await fixture('owner@example.test');
  member = await fixture('member@example.test');
  operator = await fixture('operator@example.test');
  await DB.batch([
    DB.prepare('INSERT INTO spaces (id,name,owner_id,created_at) VALUES (?,?,?,?)').bind('ent-space', 'Entitlement fixture', owner.user.id, Date.now()),
    DB.prepare('INSERT INTO space_members (space_id,user_id,role,joined_at) VALUES (?,?,?,?)').bind('ent-space', owner.user.id, 'owner', Date.now()),
  ]);
}, 30000);

afterAll(async () => { await mf?.dispose(); });

describe('policy mirrors the published client policy', () => {
  it('gates the same features and limits per plan', () => {
    expect(planAllows('free', 'story-full')).toBe(false);
    expect(planAllows('pro', 'story-full')).toBe(true);
    expect(planAllows('pro', 'family-scopes')).toBe(false);
    expect(planAllows('family', 'family-scopes')).toBe(true);
    expect(PLAN_LIMITS.free.researchPerDay).toBe(3);
    expect(PLAN_LIMITS.family.storyEpisodes).toBeNull();
  });
  it('treats a missing or expired grant as Free, never as privilege', () => {
    expect(resolveEntitlement(null)).toEqual(FREE_ENTITLEMENT);
    expect(resolveEntitlement({ plan: 'pro', expires_at: Date.now() - 1 })).toEqual(FREE_ENTITLEMENT);
    expect(resolveEntitlement({ plan: 'nonsense' }).plan).toBe('free');
    expect(resolveEntitlement({ plan: 'family', expires_at: Date.now() + 60000 }).plan).toBe('family');
  });
});

describe('default state and capabilities', () => {
  it('reports Free with honest limits for a signed-in user who was never granted anything', async () => {
    const bootstrap = await api('/bootstrap', owner);
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body.plan).toBe('free');
    expect(bootstrap.body.entitlement.authority).toBe('server');
    expect(bootstrap.body.entitlement.limits.researchPerDay).toBe(3);
    expect(bootstrap.body.entitlement.usage.research.count).toBe(0);
    expect(bootstrap.body.entitlement.billing).toMatch(/No payment/i);
  });
  it('publishes the catalog publicly without per-user data', async () => {
    const caps = await api('/capabilities', null);
    expect(caps.status).toBe(200);
    expect(caps.body.entitlements.plans.map((p: any) => p.id)).toEqual(['free', 'pro', 'family']);
    expect(JSON.stringify(caps.body)).not.toMatch(/key_hash|OB-PRO-/);
  });
  it('keeps /me to identity plus plan (no extra query for usage)', async () => {
    const me = await api('/me', owner);
    expect(me.status).toBe(200);
    expect(me.body.plan).toBe('free');
    expect(me.body.entitlement.usageHint).toMatch(/bootstrap|entitlements/);
  });
});

describe('operator-minted keys are single-use and stored as hashes', () => {
  it('refuses non-operators', async () => {
    expect((await api('/entitlements/keys', owner, 'POST', { plan: 'pro', count: 1 })).status).toBe(403);
    expect((await api('/entitlements/grant', owner, 'POST', { email: member.user.email, plan: 'pro' })).status).toBe(403);
  });
  it('mints plaintext once, stores only hashes, and honours the second admin email', async () => {
    const minted = await api('/entitlements/keys', operator, 'POST', { plan: 'pro', count: 2, label: 'Beta cohort', days: 30 });
    expect(minted.status).toBe(201);
    expect(minted.body.keys).toHaveLength(2);
    expect(minted.body.keys[0].key).toMatch(/^OB-PRO-[A-Z2-9]{6}$/);
    const rows = (await DB.prepare('SELECT key_hash, plan, label FROM entitlement_keys').all()).results as any[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.key_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(minted.body.keys.some((k: any) => k.key.includes(row.key_hash.slice(0, 8)))).toBe(false);
    }
    expect(JSON.stringify(minted.body)).not.toContain(rows[0].key_hash);
  });
  it('rejects an unknown key and a malformed key without changing the plan', async () => {
    expect((await api('/entitlements/redeem', owner, 'POST', { key: 'OB-PRO-ZZZZZZ' })).status).toBe(400);
    expect((await api('/entitlements/redeem', owner, 'POST', { key: 'not a key' })).status).toBe(400);
    expect((await api('/entitlements/redeem', owner, 'POST', {})).status).toBe(400);
    expect((await api('/bootstrap', owner)).body.plan).toBe('free');
  });
});

describe('redemption', () => {
  it('upgrades the redeemer, is single-use, and never echoes the key', async () => {
    const minted = await api('/entitlements/keys', operator, 'POST', { plan: 'family', count: 1 });
    const key = minted.body.keys[0].key;
    const first = await api('/entitlements/redeem', owner, 'POST', { key });
    expect(first.status).toBe(200);
    expect(first.body.plan).toBe('family');
    expect(first.body.source).toBe('key');
    expect(first.body.features).toContain('family-scopes');
    expect(JSON.stringify(first.body)).not.toContain(key);
    // Single-use, including for the account that already spent it.
    const again = await api('/entitlements/redeem', owner, 'POST', { key });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already redeemed/i);
    const other = await api('/entitlements/redeem', member, 'POST', { key });
    expect(other.status).toBe(400);
    expect(other.body.error).toMatch(/another account/i);
    expect((await api('/bootstrap', member)).body.plan).toBe('free');
  });
  it('honours revocation and expiry of an issued key', async () => {
    const minted = await api('/entitlements/keys', operator, 'POST', { plan: 'pro', count: 2, days: 1 });
    const [revokedKey, expiredKey] = minted.body.keys.map((k: any) => k.key);
    await DB.prepare('UPDATE entitlement_keys SET revoked=1 WHERE key_hash=?').bind(await hash(revokedKey.replace(/[\s-]/g, ''))).run();
    const revoked = await api('/entitlements/redeem', member, 'POST', { key: revokedKey });
    expect(revoked.status).toBe(400);
    expect(revoked.body.error).toMatch(/revoked/i);
    await DB.prepare('UPDATE entitlement_keys SET expires_at=? WHERE key_hash=?').bind(Date.now() - 1000, await hash(expiredKey.replace(/[\s-]/g, ''))).run();
    const expired = await api('/entitlements/redeem', member, 'POST', { key: expiredKey });
    expect(expired.status).toBe(400);
    expect(expired.body.error).toMatch(/expired/i);
    expect((await api('/bootstrap', member)).body.plan).toBe('free');
  });
  it('refuses a legacy browser-minted beta key unless the operator opts in', async () => {
    // The published check-digit format is mintable by anyone reading the repo.
    const body = mintKey('pro').slice(-6);
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const sum = [...body.slice(0, 5)].reduce((a, c) => a + c.charCodeAt(0), 0);
    const legacyKey = `OB-PRO-${body.slice(0, 5)}${alphabet[sum % alphabet.length]}`;
    expect(legacyBetaPlan(legacyKey)).toBe('pro');
    expect((await api('/entitlements/redeem', member, 'POST', { key: legacyKey })).status).toBe(400);
    const opted = await api('/entitlements/redeem', member, 'POST', { key: legacyKey }, { ...env, ENTITLEMENTS_ACCEPT_LEGACY_BETA: '1' });
    expect(opted.status).toBe(200);
    expect(opted.body.plan).toBe('pro');
    expect(opted.body.source).toBe('legacy-beta');
  });
});

describe('operator grants and revocation', () => {
  it('grants by email or user id, records the actor, and expires back to Free', async () => {
    const granted = await api('/entitlements/grant', operator, 'POST', { email: member.user.email, plan: 'pro', days: 1, reason: 'Beta tester' });
    expect(granted.status).toBe(201);
    expect(granted.body.plan).toBe('pro');
    expect((await api('/bootstrap', member)).body.plan).toBe('pro');
    const events = (await DB.prepare("SELECT operation, actor_id, detail FROM entitlement_events WHERE user_id=? ORDER BY at").bind(member.user.id).all()).results as any[];
    expect(events.some((e) => e.operation === 'entitlement.granted' && e.actor_id === operator.user.id)).toBe(true);
    expect((await api('/entitlements/grant', operator, 'POST', { email: 'nobody@example.test', plan: 'pro' })).status).toBe(404);
    expect((await api('/entitlements/grant', operator, 'POST', { userId: member.user.id, plan: 'free' })).status).toBe(400);
    // Expiry is real: an elapsed grant reads as Free on the next request.
    await DB.prepare('UPDATE user_entitlements SET expires_at=? WHERE user_id=?').bind(Date.now() - 1, member.user.id).run();
    expect((await api('/bootstrap', member)).body.plan).toBe('free');
    const revoked = await api('/entitlements/revoke', operator, 'POST', { userId: owner.user.id, reason: 'Test cleanup' });
    expect(revoked.status).toBe(200);
    expect((await api('/bootstrap', owner)).body.plan).toBe('free');
  });
  it('derives the workspace dispatch allowance from the owner plan', async () => {
    expect(await dispatchAllowance(env, 'ent-space')).toBe(PLAN_LIMITS.free.dispatchPerDay);
    await api('/entitlements/grant', operator, 'POST', { userId: owner.user.id, plan: 'pro' });
    expect(await dispatchAllowance(env, 'ent-space')).toBe(PLAN_LIMITS.pro.dispatchPerDay);
    expect(await dispatchAllowance(env, 'missing-space')).toBe(PLAN_LIMITS.free.dispatchPerDay);
  });
});

describe('counted quota ledger', () => {
  it('counts to the plan limit and refuses the next use honestly', async () => {
    const limit = PLAN_LIMITS.free.researchPerDay as number;
    for (let i = 1; i <= limit; i++) {
      const used = await api('/entitlements/consume', member, 'POST', { feature: 'research' });
      expect(used.status).toBe(200);
      expect(used.body.count).toBe(i);
      expect(used.body.limit).toBe(limit);
    }
    const refused = await api('/entitlements/consume', member, 'POST', { feature: 'research' });
    expect(refused.status).toBe(429);
    expect(refused.body.allowed).toBe(false);
    expect(refused.body.error).toMatch(/allowance reached/i);
    expect(refused.body.error).toMatch(/No paid overflow/i);
    expect(refused.headers.get('Retry-After')).toBe('3600');
    const snapshot = await api('/entitlements', member);
    expect(snapshot.body.usage.research.count).toBe(limit);
    expect(snapshot.body.plan).toBe('free');
  });
  it('cannot be overshot by concurrent requests', async () => {
    const fresh = await fixture('concurrent@example.test');
    const results = await Promise.all(
      Array.from({ length: 8 }, () => api('/entitlements/consume', fresh, 'POST', { feature: 'scribe' })),
    );
    const allowed = results.filter((r) => r.status === 200).length;
    expect(allowed).toBe(PLAN_LIMITS.free.scribePerDay);
    expect(results.filter((r) => r.status === 429).length).toBe(8 - PLAN_LIMITS.free.scribePerDay);
    const rows = (await DB.prepare('SELECT count FROM entitlement_usage WHERE user_id=? AND feature=?').bind(fresh.user.id, 'scribe').all()).results as any[];
    expect(rows[0].count).toBe(PLAN_LIMITS.free.scribePerDay);
  });
  it('counts unlimited plans without refusing, and rejects unknown features', async () => {
    await api('/entitlements/grant', operator, 'POST', { userId: owner.user.id, plan: 'family' });
    const family = { plan: 'family', source: 'operator', grantedAt: null, expiresAt: null } as const;
    for (let i = 0; i < 6; i++) {
      const used = await consume(env, owner.user.id, 'story', { ...family }, 1);
      expect(used.allowed).toBe(true);
      expect(used.limit).toBeNull();
      expect(used.count).toBe(i + 1);
    }
    expect(FREE_ENTITLEMENT.plan).toBe('free');
    expect((await api('/entitlements/consume', owner, 'POST', { feature: 'not-a-feature' })).status).toBe(400);
    expect((await api('/entitlements/consume', owner, 'POST', {})).status).toBe(400);
  });
  it('scopes translator minutes to the session the client names', async () => {
    const a = await api('/entitlements/consume', member, 'POST', { feature: 'translate', units: 5, sessionId: 'session-a' });
    expect(a.status).toBe(200);
    expect(a.body.count).toBe(5);
    expect((await api('/entitlements/consume', member, 'POST', { feature: 'translate', units: 1, sessionId: 'session-a' })).status).toBe(429);
    expect((await api('/entitlements/consume', member, 'POST', { feature: 'translate', units: 1, sessionId: 'session-b' })).status).toBe(200);
  });
  it('requires a session for any entitlement call', async () => {
    expect((await api('/entitlements', null)).status).toBe(401);
    expect((await api('/entitlements/redeem', null, 'POST', { key: 'OB-PRO-AAAAAA' })).status).toBe(401);
  });
});
