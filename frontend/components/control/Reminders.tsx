"use client";
import { useState } from "react";
import { useAssistantStore } from "@/store/assistant";
import { Icon } from "../ui/Icon";
export default function Reminders() {
  const { reminders, addReminder, dismissReminder, settings } = useAssistantStore();
  const [title, setTitle] = useState(""),
    [time, setTime] = useState(""),
    [date, setDate] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="reminder-tool">
      <p className="panel-explainer">
        Reminders can notify you while this app is open. They are not guaranteed
        phone alarms. A date makes a one-time reminder; leave it empty to repeat
        daily.
      </p>
      <button
        className="reminder-permission"
        onClick={async () => {
          try {
            if (!("Notification" in window)) {
              setMessage(
                "Browser notifications are not supported here. Keep OneBrain open and check your reminders.",
              );
              return;
            }
            const permission = await Notification.requestPermission();
            setMessage(
              permission === "granted"
                ? "Browser notifications enabled. Keep OneBrain open for reminder checks."
                : "Notifications are not enabled. You can change this in your browser’s site settings.",
            );
          } catch {
            setMessage(
              "Notification permission could not be changed. Check your browser’s site settings.",
            );
          }
        }}
      >
        Enable browser notifications
      </button>
      {!settings.memoryEnabled && <p className="workspace-notice">Memory is off. <a href="/control?panel=privacy">Enable saved memory</a> before scheduling new reminders. Existing reminders remain until dismissed.</p>}
      <form
        className="reminder-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !title.trim() || !time) return;
          setBusy(true);
          try {
          await addReminder({
            id: crypto.randomUUID(),
            title: title.trim(),
            time,
            date: date || undefined,
            active: true,
          });
          setTitle("");
          setMessage("Reminder added. Keep OneBrain open for reminder checks.");
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "Reminder was not saved. Check browser storage and try again.");
          } finally { setBusy(false); }
        }}
      >
        <label>
          What should I remind you about?
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Take a break, call someone, send a proposal…"
          />
        </label>
        <div className="reminder-fields">
          <label>
            Time
            <input
              type="time"
              required
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
          <label>
            Date · optional
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <button className="primary-button" disabled={busy || !settings.memoryEnabled}>
            {busy ? "Saving…" : "Add reminder"}
            <Icon name="arrow" />
          </button>
        </div>
      </form>
      {message && (
        <p role="status" className="workspace-notice">
          {message}
        </p>
      )}
      <div className="reminder-list">
        <h2>
          Your reminders <span>{reminders.length}</span>
        </h2>
        {!reminders.length && (
          <p>No reminders yet. Add one above when something needs a nudge.</p>
        )}
        {reminders.map((r) => (
          <article key={r.id}>
            <Icon name="bell" />
            <div>
              <strong>{r.title}</strong>
              <small>
                {r.date || "Every day"} · {r.time}
                {!r.active ? " · Done" : ""}
              </small>
            </div>
            <button
              aria-label={`Dismiss ${r.title}`}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try { await dismissReminder(r.id); setMessage("Reminder dismissed."); }
                catch { setMessage("Reminder could not be dismissed. Check browser storage and try again."); }
                finally { setBusy(false); }
              }}
            >
              Dismiss
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
