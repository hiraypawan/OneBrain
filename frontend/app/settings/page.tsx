'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAssistantStore } from '@/store/assistant';
import { useAssistant } from '@/hooks/useAssistant';
import { rangeFromPitch } from '@/lib/voiceprint';

export default function SettingsPage() {
  const { settings, updateSettings, apiKey, setApiKey, user, logout } = useAssistantStore();
  const router = useRouter();
  const voiceBaseline = useAssistantStore((s) => s.voiceBaseline);
  const { enrollVoice } = useAssistant();
  const [keyTest, setKeyTest] = useState('');
  const [enrollMsg, setEnrollMsg] = useState('');

  const testKey = async () => {
    if (!apiKey) {
      setKeyTest('✗ Paste a key first.');
      return;
    }
    setKeyTest('Testing key…');
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Reply with only the word OK', history: [], userKey: apiKey }),
      });
      const j = await r.json();
      if (j.provider === 'gemini') setKeyTest('✓ Key works — full AI active');
      else setKeyTest('✗ Key failed: ' + (j.answer || 'unknown error'));
    } catch {
      setKeyTest('✗ Network error — is the server running?');
    }
  };

  const onEnroll = async () => {
    setEnrollMsg('Listening… read one sentence aloud.');
    try {
      const hz = await enrollVoice();
      if (hz == null) {
        setEnrollMsg('Could not hear a clear voice. Go somewhere quiet and try again.');
      } else {
        const range = rangeFromPitch(hz);
        setEnrollMsg(`Enrolled (~${hz} Hz${range !== 'unknown' ? `, ${range}-range` : ''}). Very different voices will now be flagged.`);
      }
    } catch {
      setEnrollMsg('Mic unavailable — allow microphone first.');
    }
  };
  return (
    <div className="py-6 space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="p-4 bg-gray-900 border border-gray-700 rounded-xl space-y-2">
        <div className="font-bold">🔑 AI key (free, optional)</div>
        <p className="text-sm text-gray-400">
          Get a free key at <span className="text-blue-400">aistudio.google.com</span> → paste here →
          full AI answers. The key is stored in this browser and sent to the configured app backend for requests to Google. Browser storage is not an encrypted vault.
        </p>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value.trim())}
          placeholder="AIza... (Gemini key)"
          className="w-full px-3 py-2 rounded bg-black border border-gray-700"
        />
        {apiKey && <p className="text-green-400 text-sm">Key saved locally — use Test key to check availability</p>}
        <div className="flex items-center gap-2">
          <button onClick={testKey} className="px-4 py-2 bg-blue-600 rounded text-sm font-bold">
            Test key
          </button>
          {keyTest && <span className="text-sm">{keyTest}</span>}
        </div>
      </div>
      <label className="flex justify-between">Memory <input type="checkbox" checked={settings.memoryEnabled} onChange={(e) => updateSettings({ memoryEnabled: e.target.checked })} /></label>
      <label className="flex justify-between">Voice speed {settings.voiceSpeed.toFixed(1)}<input type="range" min="0.5" max="2" step="0.1" value={settings.voiceSpeed} onChange={(e) => updateSettings({ voiceSpeed: Number(e.target.value) })} /></label>
      <label className="flex justify-between">Language
        <select value={settings.language} onChange={(e) => updateSettings({ language: e.target.value })} className="bg-gray-900">
          <option value="hinglish">Hinglish</option>
          <option value="en-IN">English</option>
          <option value="hi-IN">Hindi</option>
          <option value="marathi">Marathi</option>
        </select>
      </label>
      <div className="p-4 bg-gray-900 border border-gray-700 rounded-xl space-y-2">
        <div className="font-bold">🎙 My voice (speaker recognition)</div>        <p className="text-sm text-gray-400">
          Experimental pitch-based filter only. This is not identity verification and cannot authorize actions or reliably exclude other people.
          {voiceBaseline ? ` Enrolled at ~${voiceBaseline} Hz.` : ' Not enrolled yet.'}
        </p>
        <button onClick={onEnroll} className="px-4 py-2 bg-purple-700 rounded text-sm font-bold">
          Enroll my voice
        </button>
        {enrollMsg && <p className="text-sm">{enrollMsg}</p>}
        <label className="flex justify-between items-center gap-2 pt-2 border-t border-gray-800">
          <span className="text-sm">Only answer my enrolled voice
            <span className="block text-xs text-gray-500">Attempts to filter very different pitches. Can make mistakes; not a security boundary.</span>
          </span>
          <input
            type="checkbox"
            checked={settings.ownerOnly}
            onChange={(e) => updateSettings({ ownerOnly: e.target.checked })}
          />
        </label>
      </div>
      <label className="flex justify-between">Verbosity
        <select value={settings.verbosity} onChange={(e) => updateSettings({ verbosity: e.target.value as any })} className="bg-gray-900">
          <option value="short">Short</option>
          <option value="medium">Medium</option>
          <option value="long">Long</option>
        </select>
      </label>
      <div className="flex items-center justify-between p-4 bg-gray-900 border border-gray-700 rounded-xl">
        <span className="text-sm">{user ? `Logged in as ${user.email}` : 'Not logged in (demo mode)'}</span>
        {user ? (
          <button
            onClick={async () => { const response=await fetch('/api/platform/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); if(response.ok||response.status===401){logout();router.push('/');}else alert('Server sign-out could not be confirmed. Try again.'); }}
            className="px-4 py-2 bg-red-700 rounded text-sm font-bold"
          >
            Logout
          </button>
        ) : (
          <a href="/auth/login" className="px-4 py-2 bg-blue-600 rounded text-sm font-bold">Login</a>
        )}
      </div>
      <label className="flex justify-between items-center gap-2">Forget chats older than
        <select
          value={String(settings.autoDeleteDays)}
          onChange={(e) => updateSettings({ autoDeleteDays: Number(e.target.value) })}
          className="bg-gray-900 px-2 py-1 rounded"
        >
          <option value="0">Never</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="365">1 year</option>
        </select>
      </label>
      <div className="flex gap-3 pt-4">
        <a href="/settings/privacy" className="underline">Privacy</a>
        <a href="/settings/data-export" className="underline">Data export</a>
        <a href="/settings/debug" className="underline">Debug</a>
      </div>
    </div>
  );
}
