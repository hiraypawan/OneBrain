'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useAssistantStore } from '@/store/assistant';
import { NotificationBell } from '@/components/rare/notification-bell';

export default function RemindersPage() {
  const { reminders, addReminder, dismissReminder } = useAssistantStore();
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');
  const activeCount = reminders.filter((r) => r.active).length;
  return (
    <div className="py-6">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-2xl font-bold">Reminders</h1>
        <NotificationBell asChild count={activeCount} size={44} color="green">
          <Link href="/reminders" aria-label={`${activeCount} active reminders`} className="grid place-items-center text-xl">
            🔔
          </Link>
        </NotificationBell>
      </div>
      <p className="text-sm text-gray-400 mb-3">
        Daily at a time, or once on a date. Fires a notification while the app is open.
      </p>
      <div className="flex flex-wrap gap-2 mb-4">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Remind me to..." className="flex-1 min-w-[140px] px-3 py-2 rounded bg-gray-900 border border-gray-700" />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="px-3 py-2 rounded bg-gray-900 border border-gray-700" />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} title="Optional: one-time date" className="px-3 py-2 rounded bg-gray-900 border border-gray-700" />
        <button
          onClick={() => {
            if (!title || !time) return;
            addReminder({ id: `${Date.now()}`, title, time, date: date || undefined, active: true });
            setTitle(''); setDate('');
          }}
          className="px-4 bg-blue-600 rounded"
        >
          Add
        </button>
      </div>
      {reminders.length === 0 && <p className="text-gray-400">No reminders yet.</p>}
      {reminders.map((r) => (
        <div key={r.id} className="flex justify-between p-3 bg-gray-900 rounded mb-2 border border-gray-800">
          <span>
            {r.title} @ {r.date ? `${r.date} ` : 'daily '}{r.time}
            {!r.active && <span className="text-gray-500"> (done)</span>}
          </span>
          <button onClick={() => dismissReminder(r.id)} className="text-red-400">Dismiss</button>
        </div>
      ))}
    </div>
  );
}
