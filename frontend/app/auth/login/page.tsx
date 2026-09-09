'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAssistantStore } from '@/store/assistant';
import { setToken, fetchAuthConfig } from '@/lib/sync';
import { loginLocal } from '@/lib/localAuth';

const API = () => (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState(false);
  const loginBackend = useAssistantStore((s) => s.loginBackend);
  const login = useAssistantStore((s) => s.login);
  const router = useRouter();

  useEffect(() => {
    fetchAuthConfig().then((c) => setGoogle(c.google)).catch(() => {});
  }, []);

  const onLogin = async () => {
    setError('');
    setBusy(true);
    try {
      // 1. Real backend when configured.
      if (API()) {
        try {
          const r = await fetch(`${API()}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });
          const j = await r.json();
          if (r.ok) {
            setToken(j.token);
            loginBackend(j.user);
            router.push('/active');
            return;
          }
          throw new Error(j.error || 'Login failed');
        } catch (e: any) {
          // Backend unreachable? Fall through to device-local accounts.
          if (/backend|fetch|network|Failed to fetch/i.test(e?.message || '')) {
            const u = await loginLocal(email, password);
            login(u.email);
            router.push('/active');
            return;
          }
          throw e;
        }
      }
      // 2. Device-local account.
      const u = await loginLocal(email, password);
      login(u.email);
      router.push('/active');
    } catch (e: any) {
      setError(e?.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-10 max-w-sm mx-auto space-y-3">
      <h1 className="text-2xl font-bold mb-4">Login</h1>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <input data-testid="login-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-700" />
      <input data-testid="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (8+ chars)" className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-700" />
      <button data-testid="login-button" onClick={onLogin} disabled={busy} className="w-full py-3 bg-green-600 rounded-lg font-bold disabled:opacity-50">
        {busy ? 'Logging in…' : 'Login'}
      </button>
      {google && API() && (
        <a href={`${API()}/api/auth/google`} className="block text-center w-full py-3 bg-white text-black rounded-lg font-bold">
          Continue with Google
        </a>
      )}
      <div className="flex justify-between text-sm">
        <a href="/auth/signup" className="underline">Create account</a>
        <a href="/auth/forgot-password" className="underline">Forgot password?</a>
      </div>
      <p className="text-xs text-gray-500">No backend configured? Accounts live on this device only.</p>
    </div>
  );
}
