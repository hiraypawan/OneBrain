"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  convertUnit,
  dateDifference,
  addDays,
  type Timer,
  timerRemaining,
  pauseTimer,
  resumeTimer,
} from "@/lib/utilities";
import { safeCalculation } from "@/lib/workspace/model";
import "@/app/operations/operations.css";
export default function Utilities() {
  const [expression, setExpression] = useState(""),
    [amount, setAmount] = useState("1"),
    [from, setFrom] = useState("km"),
    [to, setTo] = useState("m"),
    [date, setDate] = useState(""),
    [other, setOther] = useState(""),
    [days, setDays] = useState("7"),
    [result, setResult] = useState("");
  const [kind, setKind] = useState("currency"),
    [lat, setLat] = useState(""),
    [lon, setLon] = useState(""),
    [base, setBase] = useState("USD"),
    [quote, setQuote] = useState("INR"),
    [source, setSource] = useState<any>(null),
    [busy, setBusy] = useState(false);
  function calculate(work: () => unknown) {
    try {
      setResult(String(work()));
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Invalid input.");
    }
  }
  async function lookup() {
    setBusy(true);
    setSource(null);
    try {
      const query =
        kind === "weather"
          ? new URLSearchParams({ kind, lat, lon })
          : new URLSearchParams({ kind, from: base, to: quote });
      const r = await fetch("/api/utilities?" + query);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setSource(j);
    } catch (e) {
      setSource({
        error: e instanceof Error ? e.message : "Source unavailable.",
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="operations">
      <div className="ops-notice" role="status">
        {result ||
          "Calculations and conversions run on this device, without an AI provider."}
      </div>
      <div className="ops-record-grid">
        <section className="ops-card">
          <h2>Calculate</h2>
          <label>
            Expression
            <input
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              placeholder="15% of 60000 or 12 * 8"
            />
          </label>
          <button
            onClick={() =>
              calculate(
                () =>
                  safeCalculation(expression) ||
                  "Use one arithmetic operation or “15% of 60000”.",
              )
            }
          >
            Calculate locally
          </button>
        </section>
        <section className="ops-card">
          <h2>Convert units</h2>
          <label>
            Amount
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <div className="ops-form-grid">
            {[
              ["From unit", from, setFrom],
              ["To unit", to, setTo],
            ].map(([label, value, setter]: any) => (
              <label key={label}>
                {label}
                <select value={value} onChange={(e) => setter(e.target.value)}>
                  {[
                    "m",
                    "km",
                    "cm",
                    "mm",
                    "in",
                    "ft",
                    "mi",
                    "kg",
                    "g",
                    "lb",
                    "oz",
                    "l",
                    "ml",
                    "s",
                    "min",
                    "h",
                    "day",
                    "C",
                    "F",
                    "K",
                  ].map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            onClick={() =>
              calculate(
                () =>
                  `${amount} ${from} = ${convertUnit(Number(amount), from, to)} ${to}`,
              )
            }
          >
            Convert locally
          </button>
        </section>
        <section className="ops-card">
          <h2>Calendar arithmetic</h2>
          <label>
            Start date
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            End date
            <input
              type="date"
              value={other}
              onChange={(e) => setOther(e.target.value)}
            />
          </label>
          <button
            onClick={() =>
              calculate(() => `${dateDifference(date, other)} calendar days`)
            }
          >
            Days between
          </button>
          <label>
            Days to add
            <input
              type="number"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </label>
          <button onClick={() => calculate(() => addDays(date, Number(days)))}>
            Add days
          </button>
        </section>
      </div>
      <Timers />
      <section className="ops-card">
        <h2>A source, not a guess.</h2>
        <label>
          Lookup
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setSource(null);
            }}
          >
            <option value="currency">Dated currency reference rate</option>
            <option value="weather">Weather forecast</option>
          </select>
        </label>
        {kind === "weather" ? (
          <>
            <p>
              Coordinates are sent to MET Norway only when you press Look up. No
              background location tracking.
            </p>
            <div className="ops-form-grid">
              <label>
                Latitude
                <input
                  type="number"
                  min={-90}
                  max={90}
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                />
              </label>
              <label>
                Longitude
                <input
                  type="number"
                  min={-180}
                  max={180}
                  value={lon}
                  onChange={(e) => setLon(e.target.value)}
                />
              </label>
            </div>
            <button
              onClick={() =>
                navigator.geolocation?.getCurrentPosition(
                  (p) => {
                    setLat(p.coords.latitude.toFixed(2));
                    setLon(p.coords.longitude.toFixed(2));
                  },
                  () =>
                    setResult(
                      "Location access failed. You can enter coordinates manually.",
                    ),
                )
              }
            >
              Use my location once
            </button>
          </>
        ) : (
          <div className="ops-form-grid">
            <label>
              Base currency
              <input
                maxLength={3}
                value={base}
                onChange={(e) => setBase(e.target.value.toUpperCase())}
              />
            </label>
            <label>
              Quote currency
              <input
                maxLength={3}
                value={quote}
                onChange={(e) => setQuote(e.target.value.toUpperCase())}
              />
            </label>
          </div>
        )}
        <button
          className="ops-primary"
          disabled={busy || (kind === "weather" && (!lat || !lon))}
          onClick={lookup}
        >
          {busy ? "Checking source…" : "Look up with source"}
        </button>
        {source && (
          <div role="status">
            {source.error ? (
              <p>{source.error}</p>
            ) : (
              <>
                <p>
                  {kind === "currency"
                    ? `1 ${source.from} = ${source.rate} ${source.to} · reference date ${source.rateDate}`
                    : `Forecast for ${new Date(source.forecastAt).toLocaleString()}`}
                </p>
                {source.details && (
                  <pre>
                    {JSON.stringify(
                      { forecast: source.details, units: source.units },
                      null,
                      2,
                    )}
                  </pre>
                )}
                <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                  {source.source} ↗
                </a>
                <p>{source.notice}</p>
                <small>
                  Retrieved {source.fetchedAt}
                  {source.cached ? " · cached for up to 10 minutes" : ""}
                  {source.license ? " · " + source.license : ""}
                </small>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
function Timers() {
  const [timers, setTimers] = useState<Timer[]>([]),
    [label, setLabel] = useState("Focus"),
    [minutes, setMinutes] = useState("5"),
    [now, setNow] = useState(Date.now()),
    [watch, setWatch] = useState({ start: 0, elapsed: 0, running: false });
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) setNow(Date.now());
    };
    const handle = setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(handle);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  const show = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  return (
    <section className="ops-card">
      <span className="eyebrow">SESSION-ONLY TIMERS</span>
      <h2>Make a little time.</h2>
      <p>
        Timers use elapsed wall-clock time, but this page must remain open.
        There is no guaranteed alarm while a browser is suspended. Use
        Operations for durable in-app scheduled reminders.
      </p>
      <form
        className="ops-form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const duration = Number(minutes) * 60000;
          if (
            !Number.isFinite(duration) ||
            duration <= 0 ||
            duration > 86400000 ||
            timers.length >= 10
          )
            return;
          setTimers([
            ...timers,
            {
              id: crypto.randomUUID(),
              label: label || "Timer",
              remaining: duration,
              deadline: Date.now() + duration,
              done: false,
            },
          ]);
        }}
      >
        <label>
          Timer name
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={60}
          />
        </label>
        <label>
          Minutes
          <input
            type="number"
            min={0.01}
            max={1440}
            step="any"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </label>
        <button disabled={timers.length >= 10}>Start timer</button>
      </form>
      {timers.map((t) => {
        const remaining = timerRemaining(t, now);
        return (
          <div className="ops-card ops-member" key={t.id}>
            <div>
              <h3>{t.label}</h3>
              <output aria-live={remaining === 0 ? "polite" : "off"}>
                {remaining === 0 ? "Timer finished" : show(remaining)}
              </output>
            </div>
            <div className="ops-actions">
              <button
                disabled={remaining === 0}
                onClick={() =>
                  setTimers(
                    timers.map((x) =>
                      x.id === t.id
                        ? x.deadline
                          ? pauseTimer(x)
                          : resumeTimer(x)
                        : x,
                    ),
                  )
                }
              >
                {t.deadline ? "Pause" : "Resume"}
              </button>
              <button
                onClick={() => setTimers(timers.filter((x) => x.id !== t.id))}
              >
                Remove timer
              </button>
            </div>
          </div>
        );
      })}
      <h3>
        Stopwatch ·{" "}
        {show(watch.elapsed + (watch.running ? now - watch.start : 0))}
      </h3>
      <div className="ops-actions">
        <button
          onClick={() => {
            const time = Date.now();
            setNow(time);
            setWatch((w) =>
              w.running
                ? {
                    start: 0,
                    elapsed: w.elapsed + time - w.start,
                    running: false,
                  }
                : { ...w, start: time, running: true },
            );
          }}
        >
          {watch.running ? "Pause stopwatch" : "Start stopwatch"}
        </button>
        <button
          onClick={() => setWatch({ start: 0, elapsed: 0, running: false })}
        >
          Reset stopwatch
        </button>
      </div>
    </section>
  );
}
