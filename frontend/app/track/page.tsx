import { Suspense } from 'react';
import { TrackView } from '@/components/track/TrackView';
export const metadata = { title: 'Track · OneBrain' };
export default function Page() {
  return (
    <Suspense fallback={<p role="status">Opening Track…</p>}>
      <TrackView />
    </Suspense>
  );
}
