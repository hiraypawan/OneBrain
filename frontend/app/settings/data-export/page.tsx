'use client';
import { useState } from 'react';
import { exportAllLocal } from '@/lib/db';
import { useAssistantStore } from '@/store/assistant';

export default function DataExport() {
  const wipeAll = useAssistantStore((s) => s.wipeAll);
  const [summary, setSummary] = useState('');

  const download = async () => {
    const data = await exportAllLocal();
    const store = useAssistantStore.getState();
    const full = {
      ...data,
      session: {
        messagesInView: store.messages.length,
        settings: store.settings,
        hasApiKey: !!store.apiKey,
        voiceEnrolled: store.voiceBaseline != null,
      },
    };
    setSummary(
      `${data.conversations.length} conversations, ${data.messages.length} messages, ` +
      `${data.reminders.length} reminders stored locally.`
    );
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([JSON.stringify(full, null, 2)], { type: 'application/json' }));
    a.href = url;
    a.download = 'onebrain-data.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const wipe = async () => {
    if (!confirm('Delete ALL local data (chats, reminders, account, key)?')) return;
    await wipeAll();
    setSummary('Local browser data deleted. Remote services and backend copies are not deleted by this action.');
  };
  return (
    <div className="py-6 space-y-3">
      <h1 className="text-xl font-bold">Local data export & deletion</h1>
      {summary && <p className="text-sm text-gray-300">{summary}</p>}
      <button onClick={download} className="px-4 py-2 bg-blue-600 rounded block">Download all (JSON)</button>
      <button onClick={wipe} className="px-4 py-2 bg-red-600 rounded block">Delete local data</button>
    </div>
  );
}
