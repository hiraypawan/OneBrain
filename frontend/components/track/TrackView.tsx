'use client';
// The Track tab: one home for the four lenses over the log you already keep.
// Lens + window live in the URL, so an answer on Today can deep-link straight
// into "Track → Expenses → this week" and Back still works.

import { useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useFeaturesStore } from '@/store/features';
import { useAssistantStore } from '@/store/assistant';
import { Icon } from '@/components/ui/Icon';
import {
  TRACK_LENSES,
  isRangeKind,
  isTrackLens,
  rangeFor,
  shiftAnchor,
  todayStrip,
  trackHref,
  type TrackLens,
  type TrackRangeKind,
} from '@/lib/track';
import { plainMoney } from '@/lib/track';
import { ExpensesLens, FoodLens, HealthLens, WorkoutsLens } from './Lenses';

const RANGE_KINDS: { id: TrackRangeKind; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

export function TrackView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const logs = useFeaturesStore((s) => s.fitnessLogs);
  const goals = useFeaturesStore((s) => s.trackGoals);
  const ready = useFeaturesStore((s) => s.ready);
  const storageNotice = useAssistantStore((s) => s.storageNotice);

  const lens: TrackLens = isTrackLens(params.get('lens'))
    ? (params.get('lens') as TrackLens)
    : 'expenses';
  const rangeKind: TrackRangeKind = isRangeKind(params.get('range'))
    ? (params.get('range') as TrackRangeKind)
    : 'week';
  const anchor = params.get('day') || undefined;
  const range = useMemo(() => rangeFor(rangeKind, anchor), [rangeKind, anchor]);
  const strip = useMemo(() => todayStrip(logs, { kcalGoal: goals.kcalGoal, budget: goals.budget, budgetCurrency: goals.budgetCurrency }), [logs, goals]);
  const activeMeta = TRACK_LENSES.find((l) => l.id === lens) || TRACK_LENSES[0];

  const go = (next: { lens?: TrackLens; range?: TrackRangeKind; day?: string }) => {
    const l = next.lens || lens;
    const r = next.range || rangeKind;
    const d = next.day !== undefined ? next.day : anchor || range.anchor;
    router.replace(`${trackHref({ lens: l, range: r, day: d })}`, { scroll: false });
  };

  const step = (delta: number) => {
    router.replace(`${pathname}?${new URLSearchParams({ lens, range: rangeKind, day: shiftAnchor(rangeKind, range.anchor, delta) }).toString()}`, { scroll: false });
  };

  return (
    <div className="track-wrap">
      <header className="control-heading">
        <span className="overline">YOUR LOGGED LIFE · THIS DEVICE</span>
        <h1>Track</h1>
        <p>
          {activeMeta.blurb}. Everything here is built from what you logged by
          voice or typed — nothing is fetched, guessed or rounded up.
        </p>
      </header>

      {storageNotice && <p role="alert" className="workspace-notice">{storageNotice}</p>}
      {!ready && logs.length === 0 && (
        <p role="status" className="workspace-notice">
          Loading this device’s log…
        </p>
      )}

      <div className="track-topline">
        <nav className="track-lenses" aria-label="Track views">
          {TRACK_LENSES.map((entry) => (
            <button
              key={entry.id}
              className="track-lens"
              aria-pressed={lens === entry.id}
              onClick={() => go({ lens: entry.id })}
            >
              <span aria-hidden="true">{entry.icon}</span>
              {entry.label}
            </button>
          ))}
        </nav>
        <div className="track-window">
          <div className="track-window-kind" role="group" aria-label="Window size">
            {RANGE_KINDS.map((r) => (
              <button
                key={r.id}
                onClick={() => go({ range: r.id })}
                aria-pressed={rangeKind === r.id}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="track-window-step">
            <button className="icon-button" aria-label="Previous window" onClick={() => step(-1)}>
              <Icon name="back" />
            </button>
            <strong>{range.label}</strong>
            <button className="icon-button" aria-label="Next window" onClick={() => step(1)} disabled={range.isCurrent}>
              <Icon name="arrow" />
            </button>
            {!range.isCurrent && (
              <button className="text-button" onClick={() => go({ day: '' })}>
                Back to {rangeKind === 'day' ? 'today' : `this ${rangeKind}`}
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="track-today-strip" role="status">
        <b>Today so far:</b> {strip.entries ? `${strip.entries} entr${strip.entries === 1 ? 'y' : 'ies'}` : 'nothing logged yet'}
        {strip.spend > 0 ? ` · ${plainMoney(strip.spend, goals.budgetCurrency)} spent` : ''}
        {strip.kcal > 0 ? ` · ≈${strip.kcal} kcal` : ''}
        {strip.workouts > 0 ? ` · ${strip.workouts} workout${strip.workouts === 1 ? '' : 's'}` : ''}
        {strip.water > 0 ? ` · ${strip.water} glass${strip.water === 1 ? '' : 'es'}` : ''}
        {strip.streak > 0 ? ` · 🔥 ${strip.streak}-day streak` : ''}
      </p>

      {lens === 'expenses' && <ExpensesLens logs={logs} range={range} />}
      {lens === 'food' && <FoodLens logs={logs} range={range} />}
      {lens === 'health' && <HealthLens logs={logs} range={range} />}
      {lens === 'workouts' && <WorkoutsLens logs={logs} range={range} />}

      <footer className="track-foot">
        <p>
          Logged by voice anywhere in the app — “kharcha 200 chai”, “2 roti
          khayi”, “20 pushups kar liye”, “6 ghante soya”. Wrong entry? Say
          “change last log to 60” or delete it above.
        </p>
        <div className="sheet-actions">
          <Link prefetch={false} className="text-button" href="/control?panel=fitness">
            Manual log + full timeline in Your space
            <Icon name="arrow" />
          </Link>
        </div>
      </footer>
    </div>
  );
}
