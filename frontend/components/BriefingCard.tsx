'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { digestMessages } from '@/lib/digest';
import { db } from '@/lib/db';

// Home briefing: time-aware greeting + one routine nudge from local memory.
export function BriefingCard() {
  const [line, setLine] = useState<string | null>(null);
  const [onboarded, setOnboarded] = useState(true);

  useEffect(() => {
    try {
      if (!localStorage.getItem('onebrain-onboarded')) setOnboarded(false);
    } catch {}
    (async () => {
      try {
        const msgs = await db.messages.orderBy('createdAt').reverse().limit(200).toArray();
        if (!msgs.length) return;
        const d = digestMessages(msgs.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })));
        const h = new Date().getHours();
        const greet = h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
        const note = d.routineNotes[0];
        setLine(note ? `${greet}! Heads up: ${note}` : `${greet}! ${d.userMessages} questions so far.`);
      } catch {}
    })();
  }, []);

  return (
    <div className="space-y-3 mb-8">
      {!onboarded && (
        <Link prefetch={false} href="/welcome" className="block p-4 bg-green-900 border border-green-700 rounded-xl font-bold">
          👋 New here? 1-minute setup →
        </Link>
      )}
      {line && <div className="p-4 bg-gray-900 border border-gray-700 rounded-xl text-sm">{line}</div>}
    </div>
  );
}
