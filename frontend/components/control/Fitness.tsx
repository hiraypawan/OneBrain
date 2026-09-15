'use client';
import { useMemo, useState } from 'react';
import { useFeaturesStore } from '@/store/features';
import {
  dayTotals, dayKey, computeStreaks, recoveryLine, formatLogLine,
  type FitnessKind, type FitnessLog,
} from '@/lib/fitness';

const KIND_LABEL: Record<FitnessKind, string> = {
  workout: 'Workout', food: 'Food', expense: 'Expense', sleep: 'Sleep',
  energy: 'Energy', water: 'Water', weight: 'Weight',
};

export function Fitness() {
  const logs = useFeaturesStore((s) => s.fitnessLogs);
  const remove = useFeaturesStore((s) => s.removeFitnessLog);
  const logFitness = useFeaturesStore((s) => s.logFitness);
  const [kind, setKind] = useState<FitnessKind>('workout');
  const [label, setLabel] = useState('');
  const [qty, setQty] = useState('');
  const [notice, setNotice] = useState('');

  const today = dayKey(Date.now());
  const totals = useMemo(() => dayTotals(logs, today), [logs, today]);
  const streaks = useMemo(() => computeStreaks(logs), [logs]);
  const recovery = useMemo(
    () => recoveryLine({
      sleepHrs: totals.sleepHrs,
      energy: totals.energy,
      workoutsLast3Days: logs.filter((l) => l.kind === 'workout' && l.createdAt >= Date.now() - 3 * 86400000).length,
    }),
    [logs, totals.sleepHrs, totals.energy],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, FitnessLog[]>();
    for (const l of [...logs].reverse()) {
      const k = dayKey(l.createdAt);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(l);
    }
    return [...map.entries()].slice(0, 30);
  }, [logs]);

  const exportCsv = () => {
    const rows = ['day,time,kind,label,qty,unit,calories,amount,currency'];
    for (const l of logs) {
      const d = new Date(l.createdAt);
      const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
      rows.push([dayKey(l.createdAt), d.toLocaleTimeString('en-IN'), l.kind, esc(l.label), l.qty ?? '', l.unit ?? '', l.calories ?? '', l.amount ?? '', l.currency ?? ''].join(','));
    }
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `onebrain-fitness-${today}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const addManual = () => {
    if (!label.trim()) {
      setNotice('Add a label first.');
      return;
    }
    const q = qty.trim() ? Number(qty.trim()) : undefined;
    if (qty.trim() && !Number.isFinite(q)) {
      setNotice('Quantity must be a number.');
      return;
    }
    logFitness({ kind, label: label.trim().slice(0, 120), qty: q }, 'typed');
    setLabel('');
    setQty('');
    setNotice('Logged!');
  };

  return (
    <div className="panel-stack">
      {notice && <p role="status" className="workspace-notice">{notice}</p>}
      <section className="settings-section">
        <h3>Today</h3>
        <p>
          {totals.workoutCount} workouts · {totals.foodCalories} kcal ≈ from {totals.foodItems} items · ₹{totals.spend} spent
          {totals.sleepHrs ? ` · slept ${totals.sleepHrs}h` : ''}{totals.energy ? ` · energy ${totals.energy}` : ''}
          {totals.waterGlass ? ` · ${totals.waterGlass} glasses water` : ''}{totals.weightKg ? ` · ${totals.weightKg} kg` : ''}
        </p>
        <p>🔥 {streaks.logDays}-day log streak · 💪 {streaks.workoutDays}-day workout streak</p>
        <p><strong>{recovery}</strong></p>
        <p><small>General guidance from your logs — not medical advice. Calorie figures are rough home-style estimates.</small></p>
      </section>
      <section className="settings-section">
        <h3>Log by voice</h3>
        <p>Say “20 pushups kar liye”, “2 roti khayi”, “kharcha 200 chai”, “6 ghante soya”, “energy low”. Wrong number? Say “change last log to 60”.</p>
        <div className="sheet-actions">
          <button onClick={exportCsv} disabled={!logs.length}>Export CSV</button>
        </div>
      </section>
      <section className="settings-section">
        <h3>Add manually</h3>
        <div className="settings-grid">
          <label>Type
            <select value={kind} onChange={(e) => setKind(e.target.value as FitnessKind)}>
              {(Object.keys(KIND_LABEL) as FitnessKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </label>
          <label>Label<input value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="Morning run" /></label>
          <label>Quantity (optional)<input value={qty} inputMode="decimal" onChange={(e) => setQty(e.target.value)} placeholder="5" /></label>
        </div>
        <div className="sheet-actions">
          <button className="primary-button" onClick={addManual}>Add entry</button>
        </div>
      </section>
      <section className="settings-section">
        <h3>Timeline</h3>
        {!byDay.length && <p>No logs yet. Your voice logs land here with daily totals.</p>}
        {byDay.map(([day, list]) => (
          <details key={day} open={day === today}>
            <summary>{day === today ? 'Today' : day} · {list.length} entries</summary>
            {list.map((l) => (
              <div className="task-row" key={l.id}>
                <span>{formatLogLine(l)}{l.detail ? ` (${l.detail})` : ''}</span>
                <button className="text-button danger" aria-label={`Delete ${l.label}`} onClick={() => remove(l.id)}>Delete</button>
              </div>
            ))}
          </details>
        ))}
      </section>
    </div>
  );
}
