'use client';
import { useState } from 'react';
import { useFeaturesStore } from '@/store/features';
import { mailtoHref } from '@/lib/email';

export function Drafts() {
  const drafts = useFeaturesStore((s) => s.emailDrafts);
  const remove = useFeaturesStore((s) => s.removeEmailDraft);
  const [copied, setCopied] = useState('');

  const copy = async (subject: string, body: string, id: string) => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(id);
    } catch {
      setCopied('failed');
    }
  };

  return (
    <div className="panel-stack">
      {copied === 'failed' && <p role="alert" className="workspace-notice">Copy failed — select the text manually.</p>}
      <section className="settings-section">
        <h3>Saved drafts ({drafts.length})</h3>
        <p>Say “leave application likh do” on Today, then save drafts here. OneBrain never sends mail by itself.</p>
        {!drafts.length && <p>No drafts yet.</p>}
        {drafts.map((d) => (
          <details key={d.id}>
            <summary>{d.subject} · {d.tone} · {new Date(d.createdAt).toLocaleDateString('en-IN')}</summary>
            <p><small>To: {d.toEmail || d.to || '(add in mail app)'} · Kind: {d.kind}</small></p>
            <p className="feat-pre">{d.body}</p>
            <div className="sheet-actions">
              <button onClick={() => void copy(d.subject, d.body, d.id)}>{copied === d.id ? 'Copied!' : 'Copy'}</button>
              <a className="primary-button" href={mailtoHref({ subject: d.subject, body: d.body, tone: d.tone as 'formal', kind: d.kind as 'generic', to: d.to, toEmail: d.toEmail })}>Open mail app</a>
              <button className="text-button danger" onClick={() => remove(d.id)}>Delete</button>
            </div>
          </details>
        ))}
      </section>
    </div>
  );
}
