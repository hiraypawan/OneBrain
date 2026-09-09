'use client';
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAssistantStore } from '@/store/assistant';
import { setToken, fetchMe } from '@/lib/sync';

// Landing spot for Google OAuth: backend redirects here with ?token=...
function CallbackInner() {
  const params = useSearchParams();
  const router = useRouter();
  const loginBackend = useAssistantStore((s) => s.loginBackend);

  useEffect(() => {
    (async () => {
      const token = params.get('token');
      if (!token) {
        router.replace('/auth/login');
        return;
      }
      setToken(token);
      const me = await fetchMe();
      if (me) loginBackend(me);
      router.replace('/active');
    })();
  }, [params, router, loginBackend]);

  return <p className="py-10 text-center">Signing you in…</p>;
}

export default function AuthCallback() {
  return (
    <Suspense fallback={<p className="py-10 text-center">Signing you in…</p>}>
      <CallbackInner />
    </Suspense>
  );
}
