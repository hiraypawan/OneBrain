import { fail, hash, id, object, text, type PlatformEnv } from './core';

/**
 * Server-authoritative entitlements.
 *
 * Before this module the plan lived only in the browser (Dexie `kv.plan`) and
 * beta keys were validated client-side by a published check-digit algorithm —
 * a self-service upgrade. Here the plan is a row in D1, keys are stored as
 * hashes and redeemed atomically, and counted quotas are incremented inside
 * the database. The browser copy is a cache for instant UI, never authority.
 *
 * Policy that does not change: no checkout, no card data, no paid overflow.
 * Plans are granted by an operator or by an operator-minted key.
 */

export type PlanId = 'free' | 'pro' | 'family';
export type EntitlementSource = 'operator' | 'key' | 'legacy-beta' | 'import';

/** Boolean gates, mirroring frontend/lib/plans.ts so both agree. */
export type GatedFeature =
  | 'research-deep'
  | 'persona-pro'
  | 'story-full'
  | 'unlimited-memory'
  | 'priority-brain'
  | 'expense-export'
  | 'family-scopes';

/** Counted quotas. `null` means unlimited (still counted, never capped). */
export type CountedFeature = 'research' | 'email' | 'scribe' | 'story' | 'translate';

export interface PlanLimits {
  researchPerDay: number | null;
  emailDraftsPerMonth: number | null;
  scribePerDay: number | null;
  storyEpisodes: number | null;
  translateMinutesPerSession: number | null;
  recallDays: number | null;
  /** Server-side external dispatches per workspace-day (jobs.ts). */
  dispatchPerDay: number;
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: {
    researchPerDay: 3,
    emailDraftsPerMonth: 10,
    scribePerDay: 5,
    storyEpisodes: 3,
    translateMinutesPerSession: 5,
    recallDays: 30,
    dispatchPerDay: 100,
  },
  pro: {
    researchPerDay: 50,
    emailDraftsPerMonth: 200,
    scribePerDay: 50,
    storyEpisodes: 100,
    translateMinutesPerSession: 60,
    recallDays: 3650,
    dispatchPerDay: 250,
  },
  family: {
    researchPerDay: 50,
    emailDraftsPerMonth: 200,
    scribePerDay: 50,
    storyEpisodes: null,
    translateMinutesPerSession: 120,
    recallDays: 3650,
    dispatchPerDay: 500,
  },
};

export const PLAN_LABELS: Record<PlanId, string> = {
  free: 'Free',
  pro: 'Pro',
  family: 'Family',
};

export const PLAN_FEATURES: Record<PlanId, GatedFeature[]> = {
  free: [],
  pro: [
    'research-deep',
    'persona-pro',
    'story-full',
    'unlimited-memory',
    'priority-brain',
    'expense-export',
  ],
  family: [
    'research-deep',
    'persona-pro',
    'story-full',
    'unlimited-memory',
    'priority-brain',
    'expense-export',
    'family-scopes',
  ],
};

export function planAllows(plan: PlanId, feature: GatedFeature): boolean {
  return PLAN_FEATURES[plan]?.includes(feature) === true;
}

export function limitsFor(plan: PlanId): PlanLimits {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

export function isPlan(value: unknown): value is PlanId {
  return value === 'free' || value === 'pro' || value === 'family';
}

export interface Entitlement {
  plan: PlanId;
  source: EntitlementSource | 'default';
  grantedAt: number | null;
  expiresAt: number | null;
}

export const FREE_ENTITLEMENT: Entitlement = {
  plan: 'free',
  source: 'default',
  grantedAt: null,
  expiresAt: null,
};

/** An expired grant is Free. Nothing is silently extended. */
export function resolveEntitlement(
  row: { plan?: unknown; source?: unknown; granted_at?: unknown; expires_at?: unknown } | null | undefined,
  now = Date.now(),
): Entitlement {
  if (!row || !isPlan(row.plan)) return FREE_ENTITLEMENT;
  const expiresAt = typeof row.expires_at === 'number' ? row.expires_at : null;
  if (expiresAt !== null && expiresAt <= now) return FREE_ENTITLEMENT;
  const source = row.source;
  return {
    plan: row.plan,
    source:
      source === 'operator' || source === 'key' || source === 'legacy-beta' || source === 'import'
        ? source
        : 'operator',
    grantedAt: typeof row.granted_at === 'number' ? row.granted_at : null,
    expiresAt,
  };
}

export async function entitlementFor(env: PlatformEnv, userId: string, now = Date.now()): Promise<Entitlement> {
  try {
    const row = await env.DB.prepare(
      'SELECT plan,source,granted_at,expires_at FROM user_entitlements WHERE user_id=?',
    )
      .bind(userId)
      .first<any>();
    return resolveEntitlement(row, now);
  } catch {
    // An unreadable ledger must not invent privilege: fall back to Free and let
    // the caller's normal capacity handling report the outage.
    return FREE_ENTITLEMENT;
  }
}

/** The shape the client caches. Advisory there, authoritative here. */
export function publicEntitlement(entitlement: Entitlement, usage: UsageSnapshot) {
  return {
    plan: entitlement.plan,
    label: PLAN_LABELS[entitlement.plan],
    source: entitlement.source,
    grantedAt: entitlement.grantedAt,
    expiresAt: entitlement.expiresAt,
    authority: 'server',
    features: PLAN_FEATURES[entitlement.plan],
    limits: limitsFor(entitlement.plan),
    usage,
    billing: 'No payment is collected. Plans are operator-granted or operator-minted keys.',
  };
}

// ---------------------------------------------------------------------------
// Counted usage
// ---------------------------------------------------------------------------

export type UsageSnapshot = Record<CountedFeature, { count: number; limit: number | null; period: string }>;

const FEATURE_PERIOD: Record<CountedFeature, 'day' | 'month' | 'total'> = {
  research: 'day',
  scribe: 'day',
  email: 'month',
  story: 'total',
  translate: 'total',
};

const FEATURE_LIMIT: Record<CountedFeature, keyof PlanLimits> = {
  research: 'researchPerDay',
  scribe: 'scribePerDay',
  email: 'emailDraftsPerMonth',
  story: 'storyEpisodes',
  translate: 'translateMinutesPerSession',
};

export function isCountedFeature(value: unknown): value is CountedFeature {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FEATURE_PERIOD, value);
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Period bucket for a feature. `translate` is per translator session, so the
 * client supplies the session id; everything else is a UTC day/month/total.
 */
export function periodKey(feature: CountedFeature, now = Date.now(), sessionId?: string): string {
  const scope = FEATURE_PERIOD[feature];
  if (scope === 'day') return `day:${utcDay(now)}`;
  if (scope === 'month') return `month:${utcDay(now).slice(0, 7)}`;
  if (feature === 'translate') return `session:${String(sessionId || 'default').slice(0, 64)}`;
  return 'total';
}

export async function usageSnapshot(
  env: PlatformEnv,
  userId: string,
  entitlement: Entitlement,
  now = Date.now(),
  translateSessionId?: string,
): Promise<UsageSnapshot> {
  const limits = limitsFor(entitlement.plan);
  const features = Object.keys(FEATURE_PERIOD) as CountedFeature[];
  const out = {} as UsageSnapshot;
  try {
    const rows = await env.DB.prepare(
      `SELECT feature,period,count FROM entitlement_usage WHERE user_id=? AND period IN (${features
        .map(() => '?')
        .join(',')})`,
    )
      .bind(userId, ...features.map((f) => periodKey(f, now, translateSessionId)))
      .all<{ feature: string; period: string; count: number }>();
    const byFeature = new Map(rows.results.map((r) => [r.feature, r.count]));
    for (const feature of features) {
      out[feature] = {
        count: byFeature.get(feature) || 0,
        limit: limits[FEATURE_LIMIT[feature]] as number | null,
        period: periodKey(feature, now, translateSessionId),
      };
    }
  } catch {
    for (const feature of features) {
      out[feature] = {
        count: 0,
        limit: limits[FEATURE_LIMIT[feature]] as number | null,
        period: periodKey(feature, now, translateSessionId),
      };
    }
  }
  return out;
}

export interface ConsumeResult {
  allowed: boolean;
  count: number;
  limit: number | null;
  period: string;
  plan: PlanId;
  message: string;
}

/**
 * Atomically count one use of a quota feature. The cap is enforced inside the
 * statement, so concurrent requests cannot overshoot it. An unlimited plan
 * still records the count (honest reporting), it just never refuses.
 */
export async function consume(
  env: PlatformEnv,
  userId: string,
  feature: CountedFeature,
  entitlement: Entitlement,
  units = 1,
  now = Date.now(),
  sessionId?: string,
): Promise<ConsumeResult> {
  const step = Math.max(1, Math.min(1000, Math.floor(units) || 1));
  const limit = limitsFor(entitlement.plan)[FEATURE_LIMIT[feature]] as number | null;
  const period = periodKey(feature, now, sessionId);
  if (limit === null) {
    // Unlimited still counts: the total is reported honestly, never capped.
    const row = await env.DB.prepare(
      `INSERT INTO entitlement_usage (user_id,feature,period,count,updated_at) VALUES (?,?,?,?,?)
       ON CONFLICT(user_id,feature,period) DO UPDATE SET count=count+excluded.count, updated_at=excluded.updated_at
       RETURNING count`,
    )
      .bind(userId, feature, period, step, now)
      .first<{ count: number }>();
    return { allowed: true, count: row?.count ?? step, limit: null, period, plan: entitlement.plan, message: '' };
  }
  const row = await env.DB.prepare(
    `INSERT INTO entitlement_usage (user_id,feature,period,count,updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(user_id,feature,period) DO UPDATE SET count=count+excluded.count, updated_at=excluded.updated_at
     WHERE count+excluded.count <= ? RETURNING count`,
  )
    .bind(userId, feature, period, step, now, limit)
    .first<{ count: number }>();
  if (row) {
    return { allowed: true, count: row.count, limit, period, plan: entitlement.plan, message: '' };
  }
  const current = await env.DB.prepare(
    'SELECT count FROM entitlement_usage WHERE user_id=? AND feature=? AND period=?',
  )
    .bind(userId, feature, period)
    .first<{ count: number }>();
  const count = current?.count || 0;
  return {
    allowed: false,
    count,
    limit,
    period,
    plan: entitlement.plan,
    message: quotaMessage(feature, entitlement.plan, limit),
  };
}

export function quotaMessage(feature: CountedFeature, plan: PlanId, limit: number | null): string {
  const label = PLAN_LABELS[plan];
  const what =
    feature === 'research'
      ? 'research briefs a day'
      : feature === 'email'
        ? 'email drafts a month'
        : feature === 'scribe'
          ? 'scribe summaries a day'
          : feature === 'story'
            ? 'story episodes'
            : 'translator minutes per session';
  return `${label} plan allowance reached: ${limit ?? 0} ${what}. No paid overflow is enabled; nothing extra was counted.`;
}

// ---------------------------------------------------------------------------
// Keys, grants and revocation
// ---------------------------------------------------------------------------

const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Operator-minted key. Random body; the server verifies by stored hash. */
export function mintKey(plan: 'pro' | 'family'): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const body = [...bytes].map((b) => KEY_ALPHABET[b % KEY_ALPHABET.length]).join('');
  return `OB-${plan === 'family' ? 'FAM' : 'PRO'}-${body}`;
}

export function normalizeKey(raw: unknown): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '');
}

/**
 * The historical browser-validated beta format (OB-PRO-XXXXXX with a check
 * digit). Anyone reading this repository can mint one, so it is honoured only
 * when the operator explicitly sets ENTITLEMENTS_ACCEPT_LEGACY_BETA=1, and it
 * is recorded with its own source so those grants stay visible and revocable.
 */
export function legacyBetaPlan(raw: string): PlanId | null {
  const key = normalizeKey(raw);
  const m = key.match(/^OB(PRO|FAM)([A-Z2-9]{6})$/);
  if (!m) return null;
  const body = m[2];
  const sum = [...body.slice(0, 5)].reduce((a, c) => a + c.charCodeAt(0), 0);
  if (body[5] !== KEY_ALPHABET[sum % KEY_ALPHABET.length]) return null;
  return m[1] === 'FAM' ? 'family' : 'pro';
}

function event(env: PlatformEnv, userId: string | null, actorId: string | null, operation: string, detail: unknown = {}) {
  return env.DB.prepare(
    'INSERT INTO entitlement_events (id,user_id,actor_id,operation,at,detail) VALUES (?,?,?,?,?,?)',
  ).bind(id(), userId, actorId, operation, Date.now(), JSON.stringify(detail));
}

export async function writeGrant(
  env: PlatformEnv,
  userId: string,
  plan: PlanId,
  source: EntitlementSource,
  actorId: string | null,
  opts: { days?: number; reason?: string; keyId?: string } = {},
  now = Date.now(),
): Promise<Entitlement> {
  const expiresAt = opts.days && opts.days > 0 ? now + Math.min(3650, opts.days) * 86400000 : null;
  const receipt = JSON.stringify({
    plan,
    source,
    reason: opts.reason || '',
    keyId: opts.keyId || '',
    grantedAt: now,
    expiresAt,
  });
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user_entitlements (user_id,plan,source,granted_by,granted_at,expires_at,receipt)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET plan=excluded.plan, source=excluded.source,
         granted_by=excluded.granted_by, granted_at=excluded.granted_at,
         expires_at=excluded.expires_at, receipt=excluded.receipt`,
    ).bind(userId, plan, source, actorId, now, expiresAt, receipt),
    event(env, userId, actorId, plan === 'free' ? 'entitlement.revoked' : 'entitlement.granted', {
      plan,
      source,
      reason: opts.reason || '',
      expiresAt,
    }),
  ]);
  return { plan, source, grantedAt: now, expiresAt };
}

export async function redeemKey(env: PlatformEnv, userId: string, rawKey: unknown, now = Date.now()): Promise<Entitlement> {
  const normalized = normalizeKey(rawKey);
  if (!normalized) fail(400, 'Enter the key exactly as it was issued.');
  const digest = await hash(normalized);
  // Atomic single-use redemption: two concurrent requests cannot both win.
  const row = await env.DB.prepare(
    `UPDATE entitlement_keys SET redeemed_by=?, redeemed_at=?
     WHERE key_hash=? AND redeemed_by IS NULL AND revoked=0 AND (expires_at IS NULL OR expires_at>?)
     RETURNING key_hash, plan, label`,
  )
    .bind(userId, now, digest, now)
    .first<{ key_hash: string; plan: string; label: string }>();
  if (row && isPlan(row.plan) && row.plan !== 'free') {
    return writeGrant(env, userId, row.plan, 'key', userId, { keyId: row.key_hash.slice(0, 12), reason: row.label }, now);
  }
  const known = await env.DB.prepare('SELECT revoked, expires_at, redeemed_by FROM entitlement_keys WHERE key_hash=?')
    .bind(digest)
    .first<{ revoked: number; expires_at: number | null; redeemed_by: string | null }>();
  if (known) {
    if (known.revoked) fail(400, 'That key was revoked by the operator. Nothing was changed.');
    if (known.redeemed_by) {
      fail(400, known.redeemed_by === userId
        ? 'That key is already redeemed on your account. Your plan was not changed.'
        : 'That key was already used on another account. Keys are single-use.');
    }
    fail(400, 'That key expired. Ask the operator for a new one; nothing was changed.');
  }
  if (env.ENTITLEMENTS_ACCEPT_LEGACY_BETA === '1') {
    const legacy = legacyBetaPlan(normalized);
    if (legacy) return writeGrant(env, userId, legacy, 'legacy-beta', userId, { reason: 'Legacy browser-issued beta key' }, now);
  }
  return fail(400, 'That key is not one this server issued. Check the code, or ask the operator; nothing was changed.');
}

export function isEntitlementAdmin(env: PlatformEnv, email: string | null | undefined): boolean {
  const list = String(env.ENTITLEMENT_ADMINS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !!email && list.includes(String(email).toLowerCase());
}

export async function mintKeys(
  env: PlatformEnv,
  input: { plan: 'pro' | 'family'; count: number; createdBy: string; label?: string; days?: number },
  now = Date.now(),
): Promise<{ key: string; plan: PlanId; expiresAt: number | null }[]> {
  const count = Math.max(1, Math.min(50, Math.floor(input.count) || 1));
  const expiresAt = input.days && input.days > 0 ? now + Math.min(3650, input.days) * 86400000 : null;
  const issued: { key: string; plan: PlanId; expiresAt: number | null }[] = [];
  const statements = [];
  for (let i = 0; i < count; i++) {
    const key = mintKey(input.plan);
    const digest = await hash(normalizeKey(key));
    statements.push(
      env.DB.prepare(
        'INSERT INTO entitlement_keys (key_hash,plan,label,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?)',
      ).bind(digest, input.plan, String(input.label || '').slice(0, 120), input.createdBy, now, expiresAt),
    );
    issued.push({ key, plan: input.plan, expiresAt });
  }
  statements.push(event(env, null, input.createdBy, 'entitlement.keys-minted', { plan: input.plan, count, expiresAt }));
  await env.DB.batch(statements);
  return issued;
}

export async function revokeEntitlement(env: PlatformEnv, userId: string, actorId: string, reason: string, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM user_entitlements WHERE user_id=?').bind(userId),
    event(env, userId, actorId, 'entitlement.revoked', { reason, at: now }),
  ]);
}

/** Plan-derived daily dispatch allowance for a workspace's owner (jobs.ts). */
export async function dispatchAllowance(env: PlatformEnv, spaceId: string, now = Date.now()): Promise<number> {
  try {
    const row = await env.DB.prepare(
      `SELECT e.plan, e.expires_at FROM spaces s
       LEFT JOIN user_entitlements e ON e.user_id = s.owner_id WHERE s.id=?`,
    )
      .bind(spaceId)
      .first<{ plan: string | null; expires_at: number | null }>();
    const entitlement = resolveEntitlement(row ? { plan: row.plan, expires_at: row.expires_at } : null, now);
    return limitsFor(entitlement.plan).dispatchPerDay;
  } catch {
    return PLAN_LIMITS.free.dispatchPerDay;
  }
}

/** Public catalog for /capabilities: no secrets, no per-user data. */
export function entitlementCatalog() {
  return {
    authority: 'server',
    plans: (Object.keys(PLAN_LIMITS) as PlanId[]).map((plan) => ({
      id: plan,
      label: PLAN_LABELS[plan],
      limits: PLAN_LIMITS[plan],
      features: PLAN_FEATURES[plan],
    })),
    billing: 'No checkout, cards or paid overflow. Operator grants and operator-minted keys only.',
  };
}

/** Route helpers kept here so platform/index.ts stays readable. */
export function grantInput(raw: unknown) {
  const body = object(raw);
  const plan = text(body.plan, 'Plan', 10);
  if (!isPlan(plan) || plan === 'free') fail(400, 'Choose pro or family, or revoke to return to Free.');
  const days = body.days === undefined ? 0 : Number(body.days);
  if (!Number.isFinite(days) || days < 0 || days > 3650) fail(400, 'Days must be 0–3650 (0 = no expiry).');
  return {
    plan: plan as PlanId,
    days,
    email: body.email === undefined ? '' : text(body.email, 'Email', 254).toLowerCase(),
    userId: body.userId === undefined ? '' : text(body.userId, 'User ID', 64),
    reason: body.reason === undefined ? '' : text(body.reason, 'Reason', 200),
  };
}

