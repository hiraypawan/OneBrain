'use client';
import { useState } from 'react';
import { useFeaturesStore } from '@/store/features';
import { useWorkspaceStore } from '@/store/workspace';
import { useAssistantStore } from '@/store/assistant';
import { validateBetaKey, PLANS, FREE_LIMITS, planAllows } from '@/lib/plans';
import { dayKey } from '@/lib/fitness';

export function Plan() {
  const plan = useFeaturesStore((s) => s.plan);
  const unlock = useFeaturesStore((s) => s.unlock);
  const usage = useFeaturesStore((s) => s.usage);
  const scope = useWorkspaceStore((s) => s.scope);
  const loadScope = useWorkspaceStore((s) => s.load);
  const userId = useAssistantStore((s) => s.user?.id);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = () => {
    const p = validateBetaKey(key);
    if (!p) {
      setMsg('Invalid key — format OB-PRO-XXXXXX.');
      return;
    }
    unlock(p, key.trim().toUpperCase());
    setMsg(`${p === 'family' ? 'Family' : 'Pro'} unlocked! (Beta unlock — billing connects at launch.)`);
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
      setMsg('Expense export is a Pro feature. Unlock with a beta key to export.');
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

  return (
    <div className="panel-stack">
      {msg && <p role="status" className="workspace-notice">{msg}</p>}
      <section className="settings-section">
        <h3>Your plan: {plan.toUpperCase()}</h3>
        {PLANS.map((p) => (
          <p key={p.id}>
            <strong>{p.name} · {p.price}</strong> — {p.blurb}
            {p.id === plan ? ' ✓ current' : ''}
          </p>
        ))}
        <p><small>Free stays generous: voice logging, recall (30 days), timers, translator trial, English Tutor + Gym Coach, witness mode, night notes.</small></p>
      </section>
      <section className="settings-section">
        <h3>Usage</h3>
        <p>Research today: {usage.researchCount}/{FREE_LIMITS.researchPerDay} · Drafts this month: {usage.emailCount}/{FREE_LIMITS.emailDraftsPerMonth} · Scribe today: {usage.scribeCount}/{FREE_LIMITS.scribePerDay} · Story trial: {usage.storyTrial}/{FREE_LIMITS.storyTrialEpisodes}</p>
        {plan === 'free' && (
          <div className="feat-row">
            <label className="feat-label">Beta key<input className="feat-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="OB-PRO-XXXXXX" /></label>
            <button className="primary-button" onClick={apply}>Unlock Pro/Family</button>
          </div>
        )}
        <p><small>Beta unlock — real billing connects at launch. No payment is collected; no card is asked.</small></p>
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
        <h3>Expense export (Pro)</h3>
        <p>Voice-logged + saved expenses as CA-friendly CSV.</p>
        <div className="sheet-actions">
          <button onClick={exportExpenses}>Export expenses CSV</button>
        </div>
      </section>
    </div>
  );
}
