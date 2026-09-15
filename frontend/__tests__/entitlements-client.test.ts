import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEVICE_BETA_NOTICE,
  ENTITLEMENT_GRACE_MS,
  UNVERIFIED_NOTICE,
  consumeOnServer,
  fetchEntitlements,
  quotaFromServer,
  redeemKeyOnServer,
  resolvePlan,
  type ServerEntitlement,
} from '../lib/entitlements';
import { useFeaturesStore } from '../store/features';
import { useAssistantStore } from '../store/assistant';
import { EMPTY_QUOTA } from '../lib/plans';

const HOUR = 3600_000;
const now = Date.UTC(2026, 8, 15, 12, 0, 0);

const server = (plan: 'free' | 'pro' | 'family', expiresAt: number | null = null): ServerEntitlement => ({
  plan,
  source: plan === 'free' ? 'default' : 'key',
  grantedAt: now - HOUR,
  expiresAt,
  authority: 'server',
  features: plan === 'free' ? [] : ['story-full'],
  limits: { researchPerDay: plan === 'free' ? 3 : 50, storyEpisodes: plan === 'family' ? null : 100 },
  usage: {
    research: { count: 2, limit: 3, period: `day:${new Date(now).toISOString().slice(0, 10)}` },
    story: { count: 1, limit: 3, period: 'total' },
  },
});

function jsonResponse(body: unknown, status = 200) {
  return vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
  useAssistantStore.setState({ isAuthenticated: false, user: null });
  useFeaturesStore.setState({
    plan: 'free',
    devicePlan: 'free',
    betaKey: null,
    planSource: 'default',
    planVerified: false,
    planNotice: null,
    serverEntitlement: null,
    entitlementCache: null,
    usage: { ...EMPTY_QUOTA },
  });
});

describe('who decides the plan', () => {
  it('takes the server answer when signed in, including a downgrade', () => {
    const resolved = resolvePlan({ signedIn: true, server: server('pro'), devicePlan: 'family', now });
    expect(resolved).toMatchObject({ plan: 'pro', source: 'server', verified: true });
    expect(resolved.notice).toBeNull();
  });

  it('never lets a browser key raise a signed-in account above the server', () => {
    const resolved = resolvePlan({ signedIn: true, server: server('free'), devicePlan: 'pro', now });
    expect(resolved.plan).toBe('free');
    expect(resolved.source).toBe('server');
  });

  it('labels a device-only unlock as exactly that when signed out', () => {
    const resolved = resolvePlan({ signedIn: false, devicePlan: 'pro', now });
    expect(resolved).toMatchObject({ plan: 'pro', source: 'device-beta', verified: false });
    expect(resolved.notice).toBe(DEVICE_BETA_NOTICE);
  });

  it('keeps the last confirmed plan during an outage, marked unverified', () => {
    const cached = { entitlement: server('pro'), fetchedAt: now - HOUR };
    const resolved = resolvePlan({ signedIn: true, server: null, cache: cached, now });
    expect(resolved).toMatchObject({ plan: 'pro', verified: false });
    expect(resolved.notice).toBe(UNVERIFIED_NOTICE);
  });

  it('drops back to Free once the grace window has passed', () => {
    const cached = { entitlement: server('pro'), fetchedAt: now - ENTITLEMENT_GRACE_MS - 1000 };
    expect(resolvePlan({ signedIn: true, server: null, cache: cached, now }).plan).toBe('free');
  });

  it('treats an elapsed grant as Free even if the row still exists', () => {
    expect(resolvePlan({ signedIn: true, server: server('pro', now - 1), now }).plan).toBe('free');
    expect(resolvePlan({ signedIn: true, server: server('pro', now + HOUR), now }).plan).toBe('pro');
  });

  it('is Free by default, with no invented notice', () => {
    expect(resolvePlan({ signedIn: false, now })).toMatchObject({ plan: 'free', source: 'default', verified: false, notice: null });
    expect(resolvePlan({ signedIn: true, now })).toMatchObject({ plan: 'free', source: 'default', verified: false });
  });
});

describe('server counters reach the local feature engine', () => {
  it('maps day, month and total buckets into the quota shape', () => {
    const usage = quotaFromServer(server('pro'));
    expect(usage.researchCount).toBe(2);
    expect(usage.storyTrial).toBe(1);
    expect(usage.researchDay).toBe(new Date(now).toISOString().slice(0, 10));
    expect(usage.emailCount).toBe(0);
  });

  it('only counts translator minutes for the session it was asked about', () => {
    const entitlement = server('free');
    entitlement.usage!.translate = { count: 4, limit: 5, period: 'session:abc' };
    expect(quotaFromServer(entitlement, 'abc').translateMins).toBe(4);
    expect(quotaFromServer(entitlement, 'other').translateMins).toBe(0);
  });

  it('falls back to zero counters (with today’s buckets) when the server sent none', () => {
    const usage = quotaFromServer({ plan: 'free' });
    expect(usage.researchCount).toBe(0);
    expect(usage.emailCount).toBe(0);
    expect(usage.scribeCount).toBe(0);
    expect(usage.storyTrial).toBe(0);
    expect(usage.translateMins).toBe(0);
    expect(usage.researchDay).toBe(new Date().toISOString().slice(0, 10));
    expect(usage.emailMonth).toBe(new Date().toISOString().slice(0, 7));
  });
});

describe('store integration', () => {
  it('applies a server entitlement over a device unlock', () => {
    useFeaturesStore.getState().unlock('pro', 'OB-PRO-AAAAAA');
    expect(useFeaturesStore.getState().plan).toBe('pro');
    expect(useFeaturesStore.getState().planSource).toBe('device-beta');
    useAssistantStore.setState({ isAuthenticated: true });
    useFeaturesStore.getState().applyServerEntitlement(server('family'), now);
    const state = useFeaturesStore.getState();
    expect(state.plan).toBe('family');
    expect(state.planSource).toBe('server');
    expect(state.planVerified).toBe(true);
    expect(state.usage.researchCount).toBe(2);
    // The device key is still recorded, but it no longer decides anything.
    expect(state.devicePlan).toBe('pro');
  });

  it('clears the account plan on sign-out without erasing the device key', () => {
    useAssistantStore.setState({ isAuthenticated: true });
    useFeaturesStore.getState().applyServerEntitlement(server('pro'), now);
    useFeaturesStore.getState().unlock('family', 'OB-FAM-AAAAAA');
    useAssistantStore.setState({ isAuthenticated: false });
    useFeaturesStore.getState().clearServerEntitlement();
    const state = useFeaturesStore.getState();
    expect(state.serverEntitlement).toBeNull();
    expect(state.plan).toBe('family');
    expect(state.planSource).toBe('device-beta');
  });

  it('returns a signed-out device with no key to Free', () => {
    useAssistantStore.setState({ isAuthenticated: true });
    useFeaturesStore.getState().applyServerEntitlement(server('pro'), now);
    useAssistantStore.setState({ isAuthenticated: false });
    useFeaturesStore.getState().clearServerEntitlement();
    expect(useFeaturesStore.getState().plan).toBe('free');
  });
});

describe('talking to the ledger', () => {
  it('reads entitlements and tolerates an unreachable server', async () => {
    jsonResponse(server('pro'));
    expect((await fetchEntitlements())?.plan).toBe('pro');
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    expect(await fetchEntitlements()).toBeNull();
  });

  it('reports a successful redemption', async () => {
    jsonResponse(server('pro'));
    const result = await redeemKeyOnServer('OB-PRO-AAAAAA');
    expect(result.ok).toBe(true);
  });

  it('surfaces the server refusal verbatim instead of guessing', async () => {
    jsonResponse({ error: 'That key was already used on another account. Keys are single-use.' }, 400);
    const result = await redeemKeyOnServer('OB-PRO-AAAAAA');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/single-use/);
  });

  it('counts locally when the server cannot answer, and never claims a confirmation', async () => {
    jsonResponse({ allowed: true, count: 1, limit: 3, period: 'day:2026-09-15', plan: 'free', message: '' });
    expect(await consumeOnServer('research')).toMatchObject({ allowed: true, count: 1, serverAnswered: true });
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    expect(await consumeOnServer('research')).toMatchObject({ allowed: true, serverAnswered: false });
  });

  // Last: platformApi starts a shared cooldown after a 429, by design.
  it('reports an exhausted allowance as a refusal', async () => {
    jsonResponse({ error: 'Free plan allowance reached: 3 research briefs a day. No paid overflow is enabled.', allowed: false, count: 3, limit: 3 }, 429);
    const result = await consumeOnServer('research');
    expect(result).toMatchObject({ allowed: false, serverAnswered: true });
    expect(result.message).toMatch(/allowance reached/i);
  });
});
