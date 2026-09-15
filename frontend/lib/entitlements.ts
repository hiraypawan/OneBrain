import { platformApi, PlatformRequestError } from './platform';
import type { PlanId, QuotaUse } from './plans';
import { EMPTY_QUOTA } from './plans';

/**
 * Client side of the server-authoritative entitlement ledger.
 *
 * Rules, in order of importance:
 *  1. A signed-in account's plan is whatever the server says — including when
 *     that is a downgrade from a key redeemed in this browser.
 *  2. A signed-out browser may still hold a device-only beta unlock. It is
 *     labeled as such and never implies server features.
 *  3. When the server cannot be reached, the last confirmed plan survives for a
 *     bounded grace window and is marked unverified. It is never silently
 *     downgraded (that would punish a paying user for our outage) and never
 *     silently upgraded.
 */

export type PlanSource = 'server' | 'device-beta' | 'default';

export interface ServerUsageEntry {
  count: number;
  limit: number | null;
  period: string;
}

export interface ServerEntitlement {
  plan: PlanId;
  label?: string;
  source?: string;
  grantedAt?: number | null;
  expiresAt?: number | null;
  authority?: 'server';
  features?: string[];
  limits?: Record<string, number | null>;
  usage?: Record<string, ServerUsageEntry>;
  billing?: string;
  usageHint?: string;
}

/** Last confirmed server answer, cached so an outage cannot strip a plan. */
export interface EntitlementCache {
  entitlement: ServerEntitlement;
  fetchedAt: number;
}

export const ENTITLEMENT_GRACE_MS = 24 * 3600 * 1000;

export interface ResolvedPlan {
  plan: PlanId;
  source: PlanSource;
  /** True only when the server confirmed it inside the grace window. */
  verified: boolean;
  expiresAt: number | null;
  /** Plain-language caveat, or null when nothing needs explaining. */
  notice: string | null;
}

export const DEVICE_BETA_NOTICE =
  'Device-only beta unlock: it changes features in this browser, not your account. Redeem a key while signed in to make it server-side.';

export const UNVERIFIED_NOTICE =
  'Plan unverified — the server could not be reached. Your last confirmed plan is kept for up to 24 hours.';

export function resolvePlan(input: {
  signedIn: boolean;
  server?: ServerEntitlement | null;
  cache?: EntitlementCache | null;
  devicePlan?: PlanId | null;
  now?: number;
}): ResolvedPlan {
  const now = input.now ?? Date.now();
  if (input.signedIn) {
    if (input.server) {
      const expiresAt = input.server.expiresAt ?? null;
      const expired = expiresAt !== null && expiresAt <= now;
      return {
        plan: expired ? 'free' : input.server.plan || 'free',
        source: 'server',
        verified: true,
        expiresAt: expired ? null : expiresAt,
        notice: null,
      };
    }
    const age = input.cache ? now - input.cache.fetchedAt : Infinity;
    if (input.cache && age <= ENTITLEMENT_GRACE_MS) {
      const expiresAt = input.cache.entitlement.expiresAt ?? null;
      const expired = expiresAt !== null && expiresAt <= now;
      return {
        plan: expired ? 'free' : input.cache.entitlement.plan || 'free',
        source: 'server',
        verified: false,
        expiresAt: expired ? null : expiresAt,
        notice: expired ? null : UNVERIFIED_NOTICE,
      };
    }
    // Signed in with no server answer at all: Free, honestly.
    return { plan: 'free', source: 'default', verified: false, expiresAt: null, notice: null };
  }
  if (input.devicePlan && input.devicePlan !== 'free') {
    return { plan: input.devicePlan, source: 'device-beta', verified: false, expiresAt: null, notice: DEVICE_BETA_NOTICE };
  }
  return { plan: 'free', source: 'default', verified: false, expiresAt: null, notice: null };
}

/** Server counters -> the shape the local feature engine already understands. */
export function quotaFromServer(entitlement?: ServerEntitlement | null, translateSession?: string): QuotaUse {
  const usage = entitlement?.usage || {};
  const day = new Date().toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const pick = (feature: string, periodPrefix: string) => {
    const entry = usage[feature];
    if (!entry || !String(entry.period || '').startsWith(periodPrefix)) return 0;
    return Number.isFinite(entry.count) ? entry.count : 0;
  };
  return {
    ...EMPTY_QUOTA,
    researchDay: usage.research?.period?.startsWith('day:') ? usage.research.period.slice(4) : day,
    researchCount: pick('research', 'day:'),
    emailMonth: usage.email?.period?.startsWith('month:') ? usage.email.period.slice(6) : month,
    emailCount: pick('email', 'month:'),
    scribeDay: usage.scribe?.period?.startsWith('day:') ? usage.scribe.period.slice(4) : day,
    scribeCount: pick('scribe', 'day:'),
    storyTrial: usage.story?.count || 0,
    translateMins: translateSession && usage.translate?.period === `session:${translateSession}` ? usage.translate.count || 0 : 0,
  };
}

/** Limits for the resolved plan: server matrix when present, local policy otherwise. */
export function limitsFromServer(entitlement?: ServerEntitlement | null): Record<string, number | null> | null {
  return entitlement?.limits && typeof entitlement.limits === 'object' ? entitlement.limits : null;
}

export interface ConsumeOutcome {
  allowed: boolean;
  count: number;
  limit: number | null;
  message: string;
  /** True when the server answered; false means the local count stands alone. */
  serverAnswered: boolean;
}

/**
 * Count one use of a quota feature on the server. Offline or signed out, this
 * resolves `serverAnswered:false` so callers keep their local count and never
 * pretend a server confirmed anything.
 */
export async function consumeOnServer(
  feature: 'research' | 'email' | 'scribe' | 'story' | 'translate',
  units = 1,
  sessionId?: string,
): Promise<ConsumeOutcome> {
  try {
    const result = await platformApi('/entitlements/consume', 'POST', { feature, units, ...(sessionId ? { sessionId } : {}) });
    return { allowed: !!result.allowed, count: result.count || 0, limit: result.limit ?? null, message: '', serverAnswered: true };
  } catch (error) {
    if (error instanceof PlatformRequestError && error.status === 429) {
      return { allowed: false, count: 0, limit: null, message: error.message, serverAnswered: true };
    }
    return { allowed: true, count: 0, limit: null, message: '', serverAnswered: false };
  }
}

export async function fetchEntitlements(translateSessionId?: string): Promise<ServerEntitlement | null> {
  try {
    const query = translateSessionId ? `?translateSession=${encodeURIComponent(translateSessionId)}` : '';
    return (await platformApi(`/entitlements${query}`)) as ServerEntitlement;
  } catch {
    return null;
  }
}

export async function redeemKeyOnServer(key: string): Promise<{ ok: true; entitlement: ServerEntitlement } | { ok: false; error: string }> {
  try {
    const entitlement = (await platformApi('/entitlements/redeem', 'POST', { key })) as ServerEntitlement;
    return { ok: true, entitlement };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The key could not be redeemed. Nothing was changed.',
    };
  }
}
