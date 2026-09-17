'use client';
// The four Track lenses. Presentational on purpose: every number is produced by
// lib/track.ts (pure, unit-tested), so a rendering change can never move a total.

import { useMemo, useState } from 'react';
import { useFeaturesStore } from '@/store/features';
import { dayKey, formatLogLine, type FitnessLog } from '@/lib/fitness';
import {
  barPct,
  budgetBar,
  budgetStatus,
  classifyExpense,
  csvName,
  expenseAmount,
  expenseView,
  fitnessCsv,
  foodSummary,
  foodView,
  healthView,
  inRange,
  plainMoney,
  seriesMax,
  tickLabel,
  workoutView,
  type TrackRange,
} from '@/lib/track';

// ---------------------------------------------------------------- helpers ----

function clockOf(ts: number): string {
  try {
    return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ts));
  } catch {
    return '';
  }
}


export function downloadText(name: string, text: string, mime = 'text/csv') {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

function ExportButton({ logs, range, prefix }: { logs: FitnessLog[]; range: TrackRange; prefix: string }) {
  const rows = logs.filter((l) => inRange(l, range));
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  return (
    <div className="track-export">
      <button
        className="text-button"
        disabled={!rows.length}
        onClick={() => {
          setState(downloadText(csvName(prefix, range), fitnessCsv(rows)) ? 'done' : 'failed');
        }}
      >
        Export {rows.length} {rows.length === 1 ? 'entry' : 'entries'} as CSV
      </button>
      {state === 'failed' && (
        <p role="status" className="track-inline-error">
          Your browser blocked the download. Try again, or export from Your space → Fitness.
        </p>
      )}
      {state === 'done' && (
        <p role="status" className="track-inline-ok">
          CSV saved to your downloads — one row per logged entry.
        </p>
      )}
    </div>
  );
}

function Bars({
  points,
  unit,
  goal,
  tone = 'accent',
}: {
  points: { key: string; label: string; value: number; note?: string }[];
  unit: string;
  goal?: number;
  tone?: 'accent' | 'sleep' | 'water' | 'kcal';
}) {
  if (!points.length)
    return <p className="track-empty-bars">No days with data in this stretch — bars fill in as you log.</p>;
  const max = seriesMax(points);
  return (
    <ul className={`track-bars track-bars-${tone}`}>
      {points.map((p) => (
        <li key={p.key} className="track-bar-col" title={`${p.label}: ${p.value}${unit}`}>
          <span
            className={`track-bar${goal && p.value >= goal ? ' is-met' : ''}`}
            style={{ height: `${barPct(p.value, max)}%` }}
            aria-hidden="true"
          />
          <b>{p.value}</b>
          <span className="track-bar-label">{p.label}</span>
        </li>
      ))}
    </ul>
  );
}

function StatRow({ children }: { children: React.ReactNode }) {
  return <ul className="track-stats">{children}</ul>;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <li className="track-stat">
      <span className="track-stat-label">{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </li>
  );
}

function Empty({ title, say }: { title: string; say: string }) {
  return (
    <div className="track-empty">
      <h3>{title}</h3>
      <p>{say}</p>
    </div>
  );
}

// --------------------------------------------------------------- expenses ----

export function ExpensesLens({ logs, range }: { logs: FitnessLog[]; range: TrackRange }) {
  const goals = useFeaturesStore((s) => s.trackGoals);
  const setTrackGoal = useFeaturesStore((s) => s.setTrackGoal);
  const remove = useFeaturesStore((s) => s.removeFitnessLog);
  const logFitness = useFeaturesStore((s) => s.logFitness);
  const [draft, setDraft] = useState({ amount: '', item: '' });
  const [saved, setSaved] = useState('');
  const [editBudget, setEditBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState(String(goals.budget || ''));

  const view = useMemo(() => expenseView(logs, range), [logs, range]);
  const month = useMemo(() => {
    const now = new Date();
    const spent = logs
      .filter((l) => l.kind === 'expense')
      .filter((l) => {
        const d = new Date(l.createdAt);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      })
      .reduce((s, l) => s + expenseAmount(l), 0);
    return budgetStatus({
      spent,
      limit: goals.budget || 0,
      monthDays: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
      dayOfMonth: now.getDate(),
      currency: goals.budgetCurrency || 'INR',
    });
  }, [logs, goals.budget, goals.budgetCurrency]);
  const bar = budgetBar(month);

  const addExpense = () => {
    const amount = Number(String(draft.amount).replace(/[^\d.]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      setSaved('Enter an amount above zero first.');
      return;
    }
    const label = draft.item.trim() ? `Spent ${plainMoney(amount, goals.budgetCurrency)} — ${draft.item.trim().slice(0, 60)}` : `Spent ${plainMoney(amount, goals.budgetCurrency)}`;
    logFitness(
      { kind: 'expense', label, qty: amount, unit: goals.budgetCurrency, amount, currency: goals.budgetCurrency, detail: draft.item.trim() || undefined },
      'typed',
    );
    setDraft({ amount: '', item: '' });
    setSaved(`Logged ${label}. It is in this list now.`);
  };

  return (
    <div className="panel-stack">
      <section className="settings-section track-summary">
        <h3>{range.label}</h3>
        <StatRow>
          <Stat label="Spent" value={plainMoney(view.total, view.currency)} hint={`${view.count} item${view.count === 1 ? '' : 's'}`} />
          <Stat label="Daily average" value={plainMoney(view.perDayAvg, view.currency)} hint={`${view.activeDays} of ${range.days.length} day${range.days.length === 1 ? '' : 's'} with spend`} />
          {view.largest && (
            <Stat
              label="Largest"
              value={plainMoney(view.largest.amount, view.currency)}
              hint={view.largest.log.label.replace(/^Spent\s+[^—]+—?\s*/i, '') || view.largest.log.label}
            />
          )}
        </StatRow>
        <div className={`track-budget is-${bar.tone}`}>
          <div className="track-budget-head">
            <strong>{month.line}</strong>
            <button className="text-button" onClick={() => setEditBudget((v) => !v)} aria-expanded={editBudget}>
              {month.set ? 'Change limit' : 'Set a monthly limit'}
            </button>
          </div>
          <div className="track-meter" role="img" aria-label={`${plainMoney(month.spent)} of ${month.set ? plainMoney(month.limit) : 'no limit set'} — ${Math.round(month.pct * 100)} percent used`}>
            <span className="track-meter-fill" style={{ width: `${bar.pct}%` }} />
          </div>
          <p>{month.paceLine}</p>
          {editBudget && (
            <div className="track-budget-edit">
              <label>
                Monthly limit ({goals.budgetCurrency})
                <input value={budgetInput} inputMode="decimal" onChange={(e) => setBudgetInput(e.target.value)} />
              </label>
              <button
                className="primary-button"
                onClick={() => {
                  const n = Number(String(budgetInput).replace(/[^\d.]/g, ''));
                  setTrackGoal({ budget: Number.isFinite(n) && n > 0 ? n : 0 });
                  setEditBudget(false);
                }}
              >
                Save
              </button>
              <button className="text-button" onClick={() => { setTrackGoal({ budget: 0 }); setBudgetInput(''); setEditBudget(false); }}>
                Remove limit
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="settings-section">
        <h3>Where it went</h3>
        {view.byCategory.length ? (
          <ul className="track-categories">
            {view.byCategory.map((c) => (
              <li key={c.id}>
                <span className="track-cat-emoji" aria-hidden="true">{c.emoji}</span>
                <span className="track-cat-name">{c.label}</span>
                <span className="track-meter is-inline" aria-hidden="true">
                  <span className="track-meter-fill" style={{ width: `${Math.max(3, Math.round(c.share * 100))}%` }} />
                </span>
                <b>{plainMoney(c.total, view.currency)}</b>
                <small>{Math.round(c.share * 100)}% · {c.count} item{c.count === 1 ? '' : 's'}</small>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="Nothing in this window" say="Say “kharcha 200 chai” — or use the quick log below. Categories are read from what you typed or said; nothing is guessed." />
        )}
      </section>

      <section className="settings-section">
        <h3>Day by day</h3>
        <Bars
          points={view.series.map((p) => ({ ...p, label: tickLabel(p.key, range.kind) }))}
          unit={view.currency}
        />
      </section>

      <section className="settings-section">
        <h3>Every item</h3>
        <div className="track-add">
          <label>
            Amount
            <input value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} inputMode="decimal" placeholder="200" />
          </label>
          <label>
            What for
            <input value={draft.item} onChange={(e) => setDraft({ ...draft, item: e.target.value })} maxLength={60} placeholder="chai at the corner stall" />
          </label>
          <button className="primary-button" onClick={addExpense}>Log expense</button>
        </div>
        {saved && <p role="status" className="workspace-notice">{saved}</p>}
        {!view.items.length ? (
          <p className="track-hint">No expenses logged {range.kind === 'day' ? 'that day' : 'in this range'}.</p>
        ) : (
          <ul className="track-items">
            {view.items.map((l) => {
              const cat = classifyExpense(`${l.label} ${l.detail || ''}`);
              return (
                <li key={l.id} className="track-item">
                  <span className="track-item-emoji" aria-hidden="true">{cat.emoji}</span>
                  <span className="track-item-main">
                    <strong>{plainMoney(expenseAmount(l), l.currency || 'INR')}</strong>
                    <small>{formatLogLine(l).replace(/^💸\s*/, '')}</small>
                  </span>
                  <span className="track-item-cat">{cat.label}</span>
                  <button className="text-button danger" aria-label={`Delete ${l.label}`} onClick={() => remove(l.id)}>
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <ExportButton logs={logs.filter((l) => l.kind === 'expense')} range={range} prefix="expenses" />
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ food ----

export function FoodLens({ logs, range }: { logs: FitnessLog[]; range: TrackRange }) {
  const goals = useFeaturesStore((s) => s.trackGoals);
  const setTrackGoal = useFeaturesStore((s) => s.setTrackGoal);
  const remove = useFeaturesStore((s) => s.removeFitnessLog);
  const days = useMemo(() => foodView(logs, range, goals.kcalGoal), [logs, range, goals.kcalGoal]);
  const summary = useMemo(() => foodSummary(days), [days]);
  const [goalInput, setGoalInput] = useState(String(goals.kcalGoal));
  const total = summary.totalKcal;
  const goal = goals.kcalGoal;
  const pct = goal > 0 ? Math.min(100, Math.round((summary.avgPerDay / goal) * 100)) : 0;

  return (
    <div className="panel-stack">
      <section className="settings-section track-summary">
        <h3>{range.label}</h3>
        <StatRow>
          <Stat label="Logged" value={`≈${total} kcal`} hint={`${summary.itemCount} item${summary.itemCount === 1 ? '' : 's'} over ${summary.daysWithData} day${summary.daysWithData === 1 ? '' : 's'}`} />
          <Stat label="Daily average" value={goal ? `≈${summary.avgPerDay} of ${goal} kcal` : `≈${summary.avgPerDay} kcal`} hint={goal ? `${pct}% of your goal` : 'no goal set'} />
          <Stat label="Within goal" value={`${summary.goalDays} of ${days.length} day${days.length === 1 ? '' : 's'}`} hint={summary.overDays ? `${summary.overDays} day${summary.overDays === 1 ? '' : 's'} over` : 'never over'} />
        </StatRow>
        <div className="track-meter" role="img" aria-label={`Average day is ${pct} percent of your ${goal} calorie goal`}>
          <span className="track-meter-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="track-hint">
          Every figure is a rough home-style estimate (marked ≈), not a lab value and not medical advice.
        </p>
        <div className="track-inline-edit">
          <label>
            Daily kcal goal
            <input value={goalInput} inputMode="numeric" onChange={(e) => setGoalInput(e.target.value)} />
          </label>
          <button onClick={() => setTrackGoal({ kcalGoal: Number(goalInput.replace(/[^\d]/g, '')) || 0 })}>Save goal</button>
        </div>
      </section>

      {!days.length || !summary.itemCount ? (
        <Empty title="No meals in this stretch" say="Say “2 roti khayi” or “chai piya” — logged items appear here grouped by meal, with the estimate next to each one." />
      ) : (
        days.map((d) => (
          <section className="settings-section" key={d.key}>
            <h3 className="track-day-head">
              {d.label}
              <span className={d.over ? 'is-over' : ''}>
                ≈{d.totalKcal} kcal{d.goal ? ` of ${d.goal}` : ''}
                {d.remaining > 0 && !d.over ? ` · ≈${d.remaining} left` : ''}
              </span>
            </h3>
            <ul className="track-meals">
              {d.meals.map((m) => (
                <li key={m.slot}>
                  <span className="track-meal-slot">{m.slot}</span>
                  <ul>
                    {m.items.map((l) => (
                      <li key={l.id}>
                        <span>{l.label}</span>
                        {l.calories ? <em>≈{l.calories} kcal</em> : <em>no estimate</em>}
                        <button className="text-button danger" aria-label={`Delete ${l.label}`} onClick={() => remove(l.id)}>
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                  <b>≈{m.kcal}</b>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {summary.topLabel && summary.topCount > 1 && (
        <p className="track-note">Most-logged: {summary.topLabel} ({summary.topCount} times in this window).</p>
      )}
      <ExportButton logs={logs.filter((l) => l.kind === 'food')} range={range} prefix="food" />
    </div>
  );
}

// ---------------------------------------------------------------- health ----

export function HealthLens({ logs, range }: { logs: FitnessLog[]; range: TrackRange }) {
  const goals = useFeaturesStore((s) => s.trackGoals);
  const setTrackGoal = useFeaturesStore((s) => s.setTrackGoal);
  const health = useMemo(() => healthView(logs, range, { sleep: goals.sleepGoal, water: goals.waterGoal }), [logs, range, goals.sleepGoal, goals.waterGoal]);
  const [sleepInput, setSleepInput] = useState(String(goals.sleepGoal));
  const [waterInput, setWaterInput] = useState(String(goals.waterGoal));
  const energyCounts = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0 } as Record<'high' | 'medium' | 'low', number>;
    for (const e of health.energy) c[e.value] += 1;
    return c;
  }, [health.energy]);

  return (
    <div className="panel-stack">
      <section className="settings-section track-summary">
        <h3>{range.label}</h3>
        <StatRow>
          <Stat label="Sleep" value={health.avgSleep !== undefined ? `${health.avgSleep}h avg` : 'not logged'} hint={health.sleep.length ? `${health.sleepGoalDays}/${health.sleep.length} nights at ${health.sleepGoal}h+` : `goal ${health.sleepGoal}h`} />
          <Stat label="Water" value={health.avgWater !== undefined ? `${health.avgWater} glasses avg` : 'not logged'} hint={`${health.waterGoalDays} day${health.waterGoalDays === 1 ? '' : 's'} at ${health.waterGoal}+ glasses`} />
          <Stat
            label="Weight"
            value={health.latestWeight ? `${health.latestWeight.value} kg` : 'not logged'}
            hint={health.weightChange !== undefined ? `${health.weightChange > 0 ? '+' : ''}${health.weightChange} kg across ${health.weight.length} logs` : `${health.weight.length} log${health.weight.length === 1 ? '' : 's'}`}
          />
          <Stat label="Energy" value={`${energyCounts.high} high · ${energyCounts.low} low`} hint={`${health.energy.length} check-in${health.energy.length === 1 ? '' : 's'}`} />
        </StatRow>
        <p className="track-insight">{health.insight}</p>
        <p className="track-hint">General guidance from your own logs — not a diagnosis, and no medical advice.</p>
      </section>

      <section className="settings-section">
        <h3>Sleep hours</h3>
        <Bars points={health.sleep} unit="h" goal={health.sleepGoal} tone="sleep" />
      </section>
      <section className="settings-section">
        <h3>Water glasses</h3>
        <Bars points={health.water} unit="glasses" goal={health.waterGoal} tone="water" />
      </section>
      {health.weight.length > 0 && (
        <section className="settings-section">
          <h3>Weight</h3>
          <ul className="track-points">
            {health.weight.map((p) => (
              <li key={p.key}>
                <span>{p.label}</span>
                <b>{p.value} kg</b>
                <small>
                  {p.key === health.weight[0].key
                    ? 'first log in this window'
                    : `${Math.round((p.value - health.weight[0].value) * 10) / 10 > 0 ? '+' : ''}${Math.round((p.value - health.weight[0].value) * 10) / 10} kg vs then`}
                </small>
              </li>
            ))}
          </ul>
          <p className="track-hint">Weight needs two logs in the same conditions to mean anything. One number is just one weigh-in.</p>
        </section>
      )}
      {health.energy.length > 0 && (
        <section className="settings-section">
          <h3>Energy check-ins</h3>
          <ul className="track-energy">
            {health.energy.map((e) => (
              <li key={e.key} className={`is-${e.value}`}>
                <span>{e.label}</span>
                <b>{e.value}</b>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="settings-section">
        <h3>Goals</h3>
        <div className="track-inline-edit">
          <label>
            Sleep (hours)
            <input value={sleepInput} inputMode="decimal" onChange={(e) => setSleepInput(e.target.value)} />
          </label>
          <label>
            Water (glasses)
            <input value={waterInput} inputMode="numeric" onChange={(e) => setWaterInput(e.target.value)} />
          </label>
          <button
            onClick={() =>
              setTrackGoal({
                sleepGoal: Number(sleepInput.replace(/[^\d.]/g, '')) || 0,
                waterGoal: Number(waterInput.replace(/[^\d]/g, '')) || 0,
              })
            }
          >
            Save goals
          </button>
        </div>
      </section>
      <ExportButton logs={logs.filter((l) => ['sleep', 'water', 'weight', 'energy'].includes(l.kind))} range={range} prefix="health" />
    </div>
  );
}

// -------------------------------------------------------------- workouts ----

export function WorkoutsLens({ logs, range }: { logs: FitnessLog[]; range: TrackRange }) {
  const remove = useFeaturesStore((s) => s.removeFitnessLog);
  const view = useMemo(() => workoutView(logs, range), [logs, range]);
  const perDay = useMemo(
    () => view.days.map((d) => ({ key: d.key, label: tickLabel(d.key, range.kind), value: d.count })),
    [view.days, range.kind],
  );

  return (
    <div className="panel-stack">
      <section className="settings-section track-summary">
        <h3>{range.label}</h3>
        <StatRow>
          <Stat label="Sessions" value={String(view.sessions)} hint={`${view.activeDays} active day${view.activeDays === 1 ? '' : 's'}`} />
          <Stat label="Logging streak" value={`🔥 ${view.streaks.logDays} day${view.streaks.logDays === 1 ? '' : 's'}`} hint="consecutive days with any log" />
          <Stat label="Training streak" value={`💪 ${view.streaks.workoutDays} day${view.streaks.workoutDays === 1 ? '' : 's'}`} hint="consecutive days with a workout" />
        </StatRow>
        <p className="track-insight">{view.volumeLine}</p>
        {view.lastSession && (
          <p className="track-hint">
            Last session: {view.lastSession.label} — logged {clockOf(view.lastSession.createdAt)} on {dayKey(view.lastSession.createdAt)}.
          </p>
        )}
      </section>

      <section className="settings-section">
        <h3>Sessions per day</h3>
        <Bars points={perDay} unit=" sessions" tone="accent" />
      </section>

      {view.byType.length > 0 && (
        <section className="settings-section">
          <h3>By movement</h3>
          <ul className="track-types">
            {view.byType.map((t) => (
              <li key={t.label}>
                <span>{t.label}</span>
                <b>
                  {t.count}×{t.unit && t.total ? ` · ${Math.round(t.total)} ${t.unit}` : ''}
                </b>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!view.days.length ? (
        <Empty title="No workouts in this window" say="Say “20 pushups kar liye” or “gym 45 min”. A guided timer starts with “start hiit” — it logs itself when it finishes." />
      ) : (
        view.days.map((d) => (
          <section className="settings-section" key={d.key}>
            <h3 className="track-day-head">
              {d.label}
              <span>{d.count} session{d.count === 1 ? '' : 's'}</span>
            </h3>
            <ul className="track-items">
              {d.items.map((l) => (
                <li key={l.id} className="track-item">
                  <span className="track-item-main">
                    <strong>{l.label}</strong>
                    <small>{l.qty && l.unit ? `${l.qty} ${l.unit}` : 'logged without a count'}</small>
                  </span>
                  <button className="text-button danger" aria-label={`Delete ${l.label}`} onClick={() => remove(l.id)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <ExportButton logs={logs.filter((l) => l.kind === 'workout')} range={range} prefix="workouts" />
    </div>
  );
}
