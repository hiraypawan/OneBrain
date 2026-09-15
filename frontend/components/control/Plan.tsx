'use client';
import { useCallback, useEffect, useState } from 'react';
import { useFeaturesStore } from '@/store/features';
import { useWorkspaceStore } from '@/store/workspace';
import { useAssistantStore } from '@/store/assistant';
import { validateBetaKey, PLANS, FREE_LIMITS, planAllows } from '@/lib/plans';
import { fetchEntitlements, redeemKeyOnServer } from '@/lib/entitlements';
import { dayKey } from '@/lib/fitness';

const SOURCE_LABEL: Record<string, string> = {
  server: 'Decided by your account (server)',
  'device-beta': 'This browser only',
  default: 'Free — nothing redeemed',
};

/**
 * Plan panel.
 *
 * Written to answer three questions a person actually has, in this order:
 * what do I have, who decided it, and what changes if I redeem a key. The old
 * panel validated keys in the browser and called that an upgrade; the server
 * now decides, and the copy says so.
 */
export function Plan() {
  const plan = useFeaturesStore((s) => s.plan);
  const planSource = useFeaturesStore((s) => s.planSource);
  const planVerified = useFeaturesStore((s) => s.planVerified);
  const planExpiresAt = useFeaturesStore((s) => s.planExpiresAt);
  const planNotice = useFeaturesStore((s) => s.planNotice);
  const devicePlan = useFeaturesStore((s) => s.devicePlan);
  const betaKey = useFeaturesStore((s) => s.betaKey);
  const serverEntitlement = useFeaturesStore((s) => s.serverEntitlement);
  const usage = useFeaturesStore((s) => s.usage);
  const unlock = useFeaturesStore((s) => s.unlock);
  const applyServerEntitlement = useFeaturesStore((s) => s.applyServerEntitlement);
  const scope = useWorkspaceStore((s) => s.scope);
  const loadScope = useWorkspaceStore((s) => s.load);
  const userId = useAssistantStore((s) => s.user?.id);
  const signedIn = useAssistantStore((s) => s.isAuthenticated);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      applyServerEntitlement(await fetchEntitlements());
    } finally {
      setBusy(false);
    }
  }, [applyServerEntitlement]);

  // Show real counters when the panel is opened, not numbers from last login.
  useEffect(() => {
    if (signedIn) void refresh();
  }, [signedIn, refresh]);

  const redeem = async (rawKey: string) => {
    const trimmed = rawKey.trim();
    if (!trimmed) {
      setMsg('Enter the key exactly as it was issued, for example OB-PRO-A7K2QM.');
      return;
    }
    if (!validateBetaKey(trimmed) && !/^OB(PRO|FAM)[A-Z2-9]{6}$/i.test(trimmed.replace(/[\s-]/g, ''))) {
      setMsg('That does not look like a key. The format is OB-PRO-XXXXXX or OB-FAM-XXXXXX.');
      return;
    }
    setBusy(true);
    try {
      if (signedIn) {
        const result = await redeemKeyOnServer(trimmed);
        if (!result.ok) {
          setMsg(result.error);
          return;
        }
        applyServerEntitlement(result.entitlement);
        setMsg(`Redeemed on your account: ${result.entitlement.plan.toUpperCase()}. This server now decides your plan on every device you sign in on.`);
        setKey('');
        return;
      }
      const device = validateBetaKey(trimmed);
      if (!device) {
        setMsg('That key is not valid for this browser. Check the characters, or sign in and redeem it on your account.');
        return;
      }
      unlock(device, trimmed.toUpperCase());
      setMsg(`Unlocked in this browser only (${device.toUpperCase()}). Sign in with Google and redeem the same key to make it account-wide.`);
      setKey('');
    } finally {
      setBusy(false);
    }
  };

  const attachDeviceKey = async () => {
    if (!betaKey) return;
    setBusy(true);
    try {
      const result = await redeemKeyOnServer(betaKey);
      if (!result.ok) {
        setMsg(`${result.error} Your browser unlock stays as it is; nothing was changed on your account.`);
        return;
      }
      applyServerEntitlement(result.entitlement);
      setMsg(`Attached to your account: ${result.entitlement.plan.toUpperCase()}.`);
    } finally {
      setBusy(false);
    }
  };

  const switchScope = async (next: string) => {
    if (busy || next === scope) return;
    setBusy(true);
    try {
      await loadScope(next);
      setMsg(next === 'household' ? 'Household space open — shared lists live here.' : 'Personal space open.');
    } catch {
      setMsg('Could not switch space. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const exportExpenses = () => {
    if (!planAllows(plan, 'expense-export')) {
      setMsg('Expense export needs Pro or Family. Redeem a key above, or ask the operator for one.');
      return;
    }
    const items = useWorkspaceStore.getState().items.filter(
      (i) => (i.kind === 'expense' || i.kind === 'payment') && i.amount !== undefined,
    );
    const fit = useFeaturesStore.getState().fitnessLogs.filter((l) => l.kind === 'expense');
    const rows = ['date,title,amount,currency,source'];
    const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    for (const i of items) rows.push([new Date(i.createdAt).toISOString().slice(0, 10), esc(i.title), i.amount, i.currency || 'INR', 'memory'].join(','));
    for (const l of fit) rows.push([dayKey(l.createdAt), esc(l.label), l.amount || l.qty || '', l.currency || 'INR', 'voice-log'].join(','));
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `onebrain-expenses-${dayKey(Date.now())}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg(`Exported ${rows.length - 1} expense rows.`);
  };

  const limits = serverEntitlement?.limits;
  const limit = (name: keyof typeof FREE_LIMITS, fallback: number) => {
    const serverKey: Record<string, string> = {
      researchPerDay: 'researchPerDay',
      emailDraftsPerMonth: 'emailDraftsPerMonth',
      scribePerDay: 'scribePerDay',
      storyTrialEpisodes: 'storyEpisodes',
      translateMinsPerSession: 'translateMinutesPerSession',
      recallDays: 'recallDays',
    };
    const value = limits ? limits[serverKey[name]] : undefined;
    if (value === null) return 'Unlimited';
    return typeof value === 'number' ? value : fallback;
  };

  return (
    <div className="panel-stack">
      {msg && <p role="status" className="workspace-notice">{msg}</p>}

      <section className="settings-section plan-current">
        <span className="overline">YOUR PLAN</span>
        <h3>{PLANS.find((p) => p.id === plan)?.name || 'Free'}{planExpiresAt ? ` until ${new Date(planExpiresAt).toLocaleDateString()}` : ''}</h3>
        <p className="plan-source">
          <strong>{SOURCE_LABEL[planSource] || SOURCE_LABEL.default}</strong>
          {planSource === 'server' && (planVerified ? ' · verified this session' : ' · unverified, cached')}
        </p>
        {planNotice && <p className="workspace-notice">{planNotice}</p>}
        <p>
          <small>
            No payment is collected anywhere in OneBrain and there is no checkout. Pro and Family are granted by the
            operator, or by a key the operator minted for you. Free stays free forever.
          </small>
        </p>
        {signedIn && (
          <button className="text-button" disabled={busy} onClick={() => void refresh()}>
            Re-check with the server
          </button>
        )}
      </section>

      <section className="settings-section">
        <h3>Redeem a key</h3>
        <p>
          <small>
            {signedIn
              ? 'You are signed in, so this key is redeemed on your account and applies on every device you sign in on.'
              : 'You are signed out, so a key here unlocks features in this browser only. Sign in with Google to make it account-wide.'}
          </small>
        </p>
        <div className="feat-row">
          <label className="feat-label">
            Key
            <input
              className="feat-input"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="OB-PRO-XXXXXX"
              aria-label="Entitlement key"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button className="primary-button" disabled={busy} onClick={() => void redeem(key)}>
            {signedIn ? 'Redeem on my account' : 'Unlock this browser'}
          </button>
        </div>
        {signedIn && plan === 'free' && devicePlan !== 'free' && betaKey && (
          <div className="feat-row">
            <button className="text-button" disabled={busy} onClick={() => void attachDeviceKey()}>
              Attach my browser key ({betaKey.slice(0, 7)}…) to this account
            </button>
          </div>
        )}
      </section>

      <section className="settings-section">
        <h3>Usage {planSource === 'server' ? '(counted by the server)' : '(counted in this browser)'}</h3>
        <ul className="plan-usage">
          <li><span>Research briefs today</span><strong>{usage.researchCount} / {limit('researchPerDay', FREE_LIMITS.researchPerDay)}</strong></li>
          <li><span>Email drafts this month</span><strong>{usage.emailCount} / {limit('emailDraftsPerMonth', FREE_LIMITS.emailDraftsPerMonth)}</strong></li>
          <li><span>Scribe summaries today</span><strong>{usage.scribeCount} / {limit('scribePerDay', FREE_LIMITS.scribePerDay)}</strong></li>
          <li><span>Story episodes</span><strong>{usage.storyTrial} / {limit('storyTrialEpisodes', FREE_LIMITS.storyTrialEpisodes)}</strong></li>
          <li><span>Translator minutes this session</span><strong>{usage.translateMins} / {limit('translateMinsPerSession', FREE_LIMITS.translateMinsPerSession)}</strong></li>
          <li><span>Memory recall window</span><strong>{limit('recallDays', FREE_LIMITS.recallDays)} days</strong></li>
        </ul>
        <p><small>Reaching a limit pauses that feature and says so. Nothing is charged and nothing is silently dropped.</small></p>
      </section>

      <section className="settings-section">
        <h3>What each plan includes</h3>
        {PLANS.map((p) => (
          <p key={p.id} className={p.id === plan ? 'plan-row current' : 'plan-row'}>
            <strong>{p.name}{p.id === plan ? ' · yours' : ''}</strong> — {p.blurb}
          </p>
        ))}
      </section>

      <section className="settings-section">
        <h3>Spaces</h3>
        <p>Current space: <strong>{scope}</strong>. Personal is yours; Household is for shared family lists. Each space keeps separate records on this browser.</p>
        <div className="sheet-actions">
          <button disabled={busy} onClick={() => void switchScope(userId || 'device')}>Personal space</button>
          <button disabled={busy} onClick={() => void switchScope('household')}>Household space</button>
        </div>
      </section>

      <section className="settings-section">
        <h3>Expense export (Pro or Family)</h3>
        <p>Voice-logged and saved expenses as a CA-friendly CSV.</p>
        <div className="sheet-actions">
          <button onClick={exportExpenses}>Export expenses CSV</button>
        </div>
      </section>
    </div>
  );
}
