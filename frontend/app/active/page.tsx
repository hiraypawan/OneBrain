'use client';
import dynamic from 'next/dynamic';

// Client-only: the voice engine touches mic/speech APIs that don't exist on
// the server, and this keeps any bundle skew from crashing hydration.
const ActiveMode = dynamic(
  () => import('@/components/ActiveMode').then((m) => m.ActiveMode),
  {
    ssr: false,
    loading: () => <p className="py-10 text-center text-gray-400">Loading voice engine…</p>,
  }
);

export default function ActivePage() {
  return <ActiveMode />;
}
