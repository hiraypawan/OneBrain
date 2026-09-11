'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAssistantStore } from '@/store/assistant';

const LANGS = [
  { id: 'hinglish', label: 'Hinglish' },
  { id: 'en-IN', label: 'English' },
  { id: 'hi-IN', label: 'Hindi' },
  { id: 'marathi', label: 'Marathi' },
];

// 3-step first run: mic permission → language → optional extras.
// Nothing here can fail the setup: every step is skippable.
export default function WelcomePage() {
  const [step, setStep] = useState(0);
  const [mic, setMic] = useState<'unknown' | 'ok' | 'blocked'>('unknown');
  const updateSettings = useAssistantStore((s) => s.updateSettings);
  const language = useAssistantStore((s) => s.settings.language);
  const router = useRouter();

  const testMic = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      setMic('ok');
    } catch {
      setMic('blocked');
    }
  };

  const finish = () => {
    try {
      localStorage.setItem('onebrain-onboarded', '1');
    } catch {}
    router.push('/active');
  };

  return (
    <div className="py-10 max-w-md mx-auto text-center">
      <p className="text-xs text-gray-500 mb-2">Step {step + 1} of 3</p>

      {step === 0 && (
        <div>
          <div className="text-6xl mb-4">🎤</div>
          <h1 className="text-2xl font-bold mb-2">Allow the microphone</h1>
          <p className="text-gray-400 mb-6 text-sm">OneBrain listens only while Active. Nothing is recorded or uploaded.</p>
          {mic === 'unknown' && (
            <button onClick={testMic} className="px-8 py-3 bg-green-700 rounded-xl font-bold">Enable mic</button>
          )}
          {mic === 'ok' && <p className="text-green-400 font-bold mb-4">✓ Mic works</p>}
          {mic === 'blocked' && (
            <p className="text-red-300 text-sm mb-4">Blocked — click the lock icon in the address bar → allow microphone → retry.</p>
          )}
          {mic !== 'unknown' && (
            <button onClick={testMic} className="block mx-auto mt-2 text-xs underline text-gray-400">Retest</button>
          )}
        </div>
      )}

      {step === 1 && (
        <div>
          <div className="text-6xl mb-4">🗣️</div>
          <h1 className="text-2xl font-bold mb-2">Your language?</h1>
          <p className="text-gray-400 mb-6 text-sm">Listening, replies and voice all follow this.</p>
          <div className="grid grid-cols-2 gap-2">
            {LANGS.map((l) => (
              <button
                key={l.id}
                onClick={() => updateSettings({ language: l.id })}
                className={`px-4 py-3 rounded-xl border font-bold ${language === l.id ? 'bg-green-700 border-green-500' : 'bg-gray-900 border-gray-700'}`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <div className="text-6xl mb-4">🚀</div>
          <h1 className="text-2xl font-bold mb-2">You are set</h1>
          <p className="text-gray-400 mb-6 text-sm">
            Works immediately, no account needed. Optional upgrades live in Settings:
            free AI key, voice enrollment, earbud device picker.
          </p>
          <a href="/settings" className="block mb-3 px-8 py-3 bg-gray-800 rounded-xl font-bold">Open Settings first</a>
        </div>
      )}

      <div className="flex gap-2 mt-8">
        {step > 0 && (
          <button onClick={() => setStep(step - 1)} className="px-6 py-3 bg-gray-800 rounded-xl">Back</button>
        )}
        {step < 2 ? (
          <button onClick={() => setStep(step + 1)} className="flex-1 px-6 py-3 bg-blue-700 rounded-xl font-bold">Next</button>
        ) : (
          <button onClick={finish} className="flex-1 px-6 py-3 bg-green-600 rounded-xl font-bold text-lg">▶ Start talking</button>
        )}
        {step < 2 && (
          <button onClick={finish} className="px-4 py-3 text-xs text-gray-500 underline">Skip</button>
        )}
      </div>
    </div>
  );
}
