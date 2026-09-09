'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAssistantStore } from '@/store/assistant';
import { setToken } from '@/lib/sync';
import { signupLocal } from '@/lib/localAuth';

const API = () => (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');

export default function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const loginBackend = useAssistantStore((s) => s.loginBackend);
  const login = useAssistantStore((s) => s.login);
  const router = useRouter();

  const onSignup = async () => {
    setError('');
    setBusy(true);
    try {
      if (API()) {
        try {
          const r = await fetch(`${API()}/api/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, displayName: name }),
          });
          const j = await r.json();
          if (r.ok) {
            setToken(j.token);
            loginBackend(j.user);
            router.push('/active');
            return;
          }
          throw new Error(j.error || 'Signup failed');
        } catch (e: any) {
          if (!/backend|fetch|network|Failed to fetch/i.test(e?.message || '')) throw e;
          // fall through to device-local
        }
      }
      const u = await signupLocal(email, password, name);
      login(u.email);
      router.push('/active');
    } catch (e: any) {
      setError(e?.message || 'Signup failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-10 max-w-sm mx-auto space-y-3">
      <h1 className="text-2xl font-bold mb-4">Create account</h1>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-700" />
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-700" />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (8+ chars)" className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-700" />
      <button onClick={onSignup} disabled={busy} className="w-full py-3 bg-blue-600 rounded-lg font-bold disabled:opacity-50">
        {busy ? 'Creating…' : 'Sign up'}
      </button>
      <a href="/auth/login" className="block text-sm underline">Have an account? Login</a>
    </div>
  );
}
