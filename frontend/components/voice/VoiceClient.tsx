'use client';
import dynamic from 'next/dynamic';

// Client-only mount: the voice engine touches mic + Web Speech APIs that do not
// exist on the server, and this is the same guard the old /active screen used.
// The page around it stays a Server Component so it can still set metadata.
const VoiceSurface = dynamic(
  () => import('./VoiceSurface').then((m) => m.VoiceSurface),
  {
    ssr: false,
    loading: () => <p role="status">Loading the voice engine…</p>,
  },
);

export function VoiceClient() {
  return <VoiceSurface />;
}
