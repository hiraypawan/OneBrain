import { VoiceClient } from '@/components/voice/VoiceClient';
export const metadata = { title: 'Voice · OneBrain' };

// “Active mode” is the name this app spoke and printed for a year: full-screen
// listening. It used to open the entire workspace, which is why Today grew into a
// tool cabinet. The route stays alive and now lands on the Voice tab’s surface —
// client-only for the same reason it always was (the mic and speech APIs do not
// exist on the server).
export default function Page() {
  return <VoiceClient />;
}
