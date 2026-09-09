import Link from 'next/link';
import { BriefingCard } from '@/components/BriefingCard';
import GravityLetters from '@/components/rare/gravity-letters';

export default function Home() {
  return (
    <div className="py-10 text-center">
      <GravityLetters
        className="h-36 mb-4 rounded-2xl border border-gray-800 bg-gray-950"
        items={['🎤', '🧠', '🔔', '💬', '⚡']}
        size={30}
        color="#22C55E"
        maxGlyphs={40}
        deviceTilt={false}
      />
      <h1 className="text-4xl font-bold mb-3">🧠 Your AI lives in your earbuds</h1>
      <p className="text-gray-400 mb-8">Press Active → speak → hear answers in your earbuds. Memory learns your routine.</p>
      <BriefingCard />
      <Link href="/active" className="px-10 py-4 bg-green-600 rounded-xl text-xl font-bold inline-block min-h-[56px]">▶ Go Active</Link>
      <div className="grid grid-cols-2 gap-3 mt-10 text-left">
        {[
          ['🎤 Voice-first', 'Continuous listening, Hinglish supported'],
          ['🧠 Memory', 'Conversations + routine learning, exportable'],
          ['🔔 Reminders', 'Time-based + commute nudges'],
          ['📴 Offline queue', 'Requests sync when back online'],
        ].map(([t, d]) => (
          <div key={t} className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
            <div className="font-bold">{t}</div>
            <div className="text-sm text-gray-400">{d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
