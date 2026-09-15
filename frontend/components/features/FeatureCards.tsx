'use client';
import { useEffect, useMemo, useState } from 'react';
import { useFeaturesStore, type FeatureCard } from '@/store/features';
import { useAssistantStore } from '@/store/assistant';
import { useWorkspaceStore } from '@/store/workspace';
import { mailtoHref, retone, type EmailTone } from '@/lib/email';
import { formatLogLine } from '@/lib/fitness';
import { formatClock } from '@/lib/workout';
import { PAIRS, LANG_NAMES } from '@/lib/translate';
import { episodesToday, BEDTIME_CAP } from '@/lib/story';
import { evidenceText, smsHref } from '@/lib/witness';
import { validateBetaKey, PLANS, FREE_LIMITS } from '@/lib/plans';
import { Icon } from '@/components/ui/Icon';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

function downloadFile(name: string, text: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Voice-equivalent action: run a command through the same transcript path. */
export function FeatureCards({ say }: { say: (text: string) => void }) {
  const card = useFeaturesStore((s) => s.card);
  const clearCard = useFeaturesStore((s) => s.setCard);
  const persona = useFeaturesStore((s) => s.persona);
  const translator = useFeaturesStore((s) => s.translator);
  const story = useFeaturesStore((s) => s.story);
  const emailSession = useFeaturesStore((s) => s.emailSession);
  const workout = useFeaturesStore((s) => s.workout);
  const witness = useFeaturesStore((s) => s.witness);

  return (
    <div className="feat-wrap">
      {(persona || translator || story || emailSession || workout || witness.phase !== 'idle') && (
        <div className="feat-modes" role="status" aria-label="Active modes">
          {persona && <ModeChip label={`🎭 ${persona.id.replace(/-/g, ' ')}`} onExit={() => say('exit mode')} />}
          {translator && <ModeChip label={`🌐 Translator ${translator.pairId}`} onExit={() => say('translator band')} />}
          {story && <ModeChip label="📖 Story mode" onExit={() => say('kahani band')} />}
          {emailSession?.awaiting && <ModeChip label="✉️ Writing email…" onExit={() => say('cancel email')} />}
          {workout && !workout.finished && <ModeChip label={`⏱️ ${workout.preset.name}`} onExit={() => say('stop workout')} />}
          {witness.phase !== 'idle' && (
            <ModeChip label={witness.phase === 'alert' ? '🚨 WITNESS ALERT' : '🛡️ Witness on'} alert={witness.phase === 'alert'} onExit={() => say('stop witness')} />
          )}
        </div>
      )}
      {card && (
        <section className="feat-card" aria-live="polite" aria-label="OneBrain feature card">
          <button className="feat-close" aria-label="Dismiss card" onClick={() => clearCard(null)}>×</button>
          <CardBody card={card} say={say} />
        </section>
      )}
    </div>
  );
}

function ModeChip({ label, onExit, alert }: { label: string; onExit: () => void; alert?: boolean }) {
  return (
    <span className={`feat-mode${alert ? ' feat-alert' : ''}`}>
      {label}
      <button aria-label={`Exit ${label}`} onClick={onExit}>×</button>
    </span>
  );
}

function CardBody({ card, say }: { card: FeatureCard; say: (t: string) => void }) {
  switch (card.kind) {
    case 'email': return <EmailCard card={card} />;
    case 'fitness': return <FitnessCard card={card} />;
    case 'fitness-ambiguous': return <AmbiguousCard card={card} say={say} />;
    case 'workout': return <WorkoutCard say={say} />;
    case 'research': return <ResearchCard card={card} say={say} />;
    case 'recall': return <RecallCard card={card} />;
    case 'persona': return <PersonaCard card={card} say={say} />;
    case 'translator': return <TranslatorCard card={card} say={say} />;
    case 'story': return <StoryCard card={card} say={say} />;
    case 'night': return <NightCard card={card} />;
    case 'witness': return <WitnessCard say={say} />;
    case 'brief': return <BriefCard card={card} />;
    case 'forgetting': return <ForgettingCard card={card} />;
    case 'followups': return <FollowupsCard card={card} />;
    case 'money': return <MoneyCard card={card} />;
    case 'scribe': return <ScribeCard card={card} say={say} />;
    case 'digest': return <DigestCard card={card} say={say} />;
    case 'plan': return <PlanCard card={card} />;
    case 'message': return <MessageCard card={card} />;
  }
}

function EmailCard({ card }: { card: Extract<FeatureCard, { kind: 'email' }> }) {
  const [subject, setSubject] = useState(card.draft.subject);
  const [body, setBody] = useState(card.draft.body);
  const [tone, setTone] = useState<EmailTone>(card.draft.tone);
  const [copied, setCopied] = useState('');
  const saveEmailDraft = useFeaturesStore((s) => s.saveEmailDraft);
  useEffect(() => {
    setSubject(card.draft.subject);
    setBody(card.draft.body);
    setTone(card.draft.tone);
  }, [card.draft]);
  const current = useMemo(() => ({ ...card.draft, subject, body, tone }), [card.draft, subject, body, tone]);
  const changeTone = (t: EmailTone) => {
    const d = retone({ ...card.draft, subject, body }, t, card.slots, card.userName);
    setTone(t);
    setSubject(d.subject);
    setBody(d.body);
  };
  return (
    <div>
      <span className="eyebrow">✉️ EMAIL DRAFT · {card.draft.kind.toUpperCase()}</span>
      <label className="feat-label">To<input className="feat-input" value={card.draft.toEmail || card.draft.to || ''} readOnly aria-label="Recipient" /></label>
      <label className="feat-label">Subject<input className="feat-input" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} /></label>
      <label className="feat-label">Body<textarea className="feat-input" rows={8} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} /></label>
      <div className="feat-row" role="group" aria-label="Tone">
        {(['formal', 'friendly', 'hinglish'] as EmailTone[]).map((t) => (
          <button key={t} aria-pressed={tone === t} className={tone === t ? 'primary-button' : 'text-button'} onClick={() => changeTone(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="feat-row">
        <button className="primary-button" onClick={async () => setCopied((await copyText(`Subject: ${subject}\n\n${body}`)) ? 'Copied!' : 'Copy failed')}>
          Copy draft
        </button>
        <a className="primary-button" href={mailtoHref(current)}>Open mail app</a>
        <button className="text-button" onClick={() => { saveEmailDraft({ subject, body, tone, kind: card.draft.kind, to: card.draft.to, toEmail: card.draft.toEmail }); setCopied('Saved to drafts!'); }}>
          Save draft
        </button>
      </div>
      {copied && <p role="status" className="feat-note">{copied} OneBrain never sends mail by itself — you always press send.</p>}
    </div>
  );
}

function FitnessCard({ card }: { card: Extract<FeatureCard, { kind: 'fitness' }> }) {
  const remove = useFeaturesStore((s) => s.removeFitnessLog);
  const [gone, setGone] = useState(false);
  return (
    <div>
      <span className="eyebrow">💪 LOGGED</span>
      <p className="feat-big">{formatLogLine(card.log)}</p>
      <p className="feat-note">{card.totalsLine}</p>
      <p className="feat-note">{card.streakLine}</p>
      <div className="feat-row">
        <a className="text-button" href="/control?panel=fitness">Open timeline ↗</a>
        {!gone && (
          <button className="text-button danger" onClick={() => { remove(card.log.id); setGone(true); }}>Delete this log</button>
        )}
      </div>
      {gone && <p role="status" className="feat-note">Deleted.</p>}
    </div>
  );
}

function AmbiguousCard({ card, say }: { card: Extract<FeatureCard, { kind: 'fitness-ambiguous' }>; say: (t: string) => void }) {
  return (
    <div>
      <span className="eyebrow">❓ WHAT DID YOU MEAN?</span>
      <p className="feat-big">{card.value} — kis cheez ka?</p>
      <div className="feat-row">
        {card.candidates.map((c) => (
          <button key={c} className="text-button" onClick={() => say(c.split(' ')[0])}>{c}</button>
        ))}
      </div>
      <p className="feat-note">Or just say it: “pushups”, “rupaye”, “paani”…</p>
    </div>
  );
}

function WorkoutCard({ say }: { say: (t: string) => void }) {
  const workout = useFeaturesStore((s) => s.workout);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!workout || workout.finished) return;
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [workout]);
  if (!workout) return <p className="feat-note">No workout running.</p>;
  const elapsed = Math.max(0, (Date.now() - workout.startedAt - workout.pausedAccum - (workout.pausedAt ? Date.now() - workout.pausedAt : 0)) / 1000);
  const remaining = Math.max(0, workout.schedule.totalSec - elapsed);
  const current = [...workout.schedule.cues].reverse().find((c) => c.atSec <= elapsed && (c.kind === 'go' || c.kind === 'start' || c.kind === 'rest'));
  const pct = Math.min(100, (elapsed / workout.schedule.totalSec) * 100);
  if (workout.finished) {
    return (
      <div>
        <span className="eyebrow">🏁 WORKOUT COMPLETE</span>
        <p className="feat-big">{workout.preset.name} — logged to your fitness timeline!</p>
        <a className="text-button" href="/control?panel=fitness">See timeline ↗</a>
      </div>
    );
  }
  return (
    <div>
      <span className="eyebrow">⏱️ {workout.preset.name.toUpperCase()}</span>
      <p className="feat-clock" aria-live="off">{formatClock(Math.ceil(remaining))}</p>
      <div className="feat-progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <p className="feat-note">{workout.pausedAt ? 'Paused — saans lo.' : current?.text || 'Get ready…'}</p>
      <div className="feat-row">
        {workout.pausedAt
          ? <button className="primary-button" onClick={() => say('resume workout')}>Resume</button>
          : <button className="primary-button" onClick={() => say('pause workout')}>Pause</button>}
        <button className="text-button" onClick={() => say('skip')}>Skip round</button>
        <button className="text-button danger" onClick={() => say('stop workout')}>Stop</button>
      </div>
    </div>
  );
}

function ResearchCard({ card, say }: { card: Extract<FeatureCard, { kind: 'research' }>; say: (t: string) => void }) {
  const b = card.brief;
  return (
    <div>
      <span className="eyebrow">🔍 RESEARCH · {b.grounded ? 'GROUNDED IN SOURCES' : 'NO LIVE SOURCES'} · AS OF {b.asOf}</span>
      <p className="feat-big">{b.query}</p>
      <p>{b.spoken}</p>
      {b.picks.length > 0 && (
        <>
          <h4 className="feat-h">Top picks</h4>
          <ul className="feat-list">{b.picks.map((p, i) => <li key={i}><strong>{p.name}</strong> — {p.detail}</li>)}</ul>
        </>
      )}
      {b.bullets.length > 0 && (
        <>
          <h4 className="feat-h">Verify before deciding</h4>
          <ul className="feat-list">{b.bullets.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </>
      )}
      {b.sources.length > 0 && (
        <>
          <h4 className="feat-h">Sources</h4>
          <ul className="feat-list">{b.sources.map((s, i) => <li key={i}><a href={s.url} target="_blank" rel="noreferrer">{s.title} ↗</a></li>)}</ul>
        </>
      )}
      <div className="feat-row">
        <button className="text-button" onClick={() => say('save brief')}>Save to memory</button>
      </div>
    </div>
  );
}

function RecallCard({ card }: { card: Extract<FeatureCard, { kind: 'recall' }> }) {
  const s = card.summary;
  return (
    <div>
      <span className="eyebrow">⏳ TIME-TRAVEL · {card.range.label.toUpperCase()}</span>
      <p>{s.spoken}</p>
      {s.bullets.map((b, i) => <p key={i} className="feat-note">• {b}</p>)}
      {s.asked.length > 0 && (
        <>
          <h4 className="feat-h">You asked</h4>
          <ul className="feat-list">{s.asked.map((a, i) => <li key={i}>“{a}”</li>)}</ul>
        </>
      )}
      {s.decisions.length > 0 && (
        <>
          <h4 className="feat-h">Decisions</h4>
          <ul className="feat-list">{s.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </>
      )}
      {s.done.length > 0 && (
        <>
          <h4 className="feat-h">Finished</h4>
          <ul className="feat-list">{s.done.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </>
      )}
    </div>
  );
}

function PersonaCard({ card, say }: { card: Extract<FeatureCard, { kind: 'persona' }>; say: (t: string) => void }) {
  const notes = useFeaturesStore((s) => s.personaNotes[card.id] || []);
  return (
    <div>
      <span className="eyebrow">🎭 {card.name.toUpperCase()}</span>
      <p className="feat-note">{card.tagline} · per-mode memory on</p>
      {card.corrections && <p className="feat-pre">{card.corrections}</p>}
      {notes.length > 0 && (
        <details className="feat-details">
          <summary>What {card.name} remembers ({notes.length})</summary>
          <ul className="feat-list">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </details>
      )}
      <div className="feat-row">
        <button className="text-button" onClick={() => say('exit mode')}>Exit mode</button>
      </div>
    </div>
  );
}

function TranslatorCard({ card, say }: { card: Extract<FeatureCard, { kind: 'translator' }>; say: (t: string) => void }) {
  const pair = PAIRS.find((p) => p.id === card.pairId) || PAIRS[0];
  const cycle = () => {
    const next = PAIRS[(PAIRS.indexOf(pair) + 1) % PAIRS.length];
    say(`${LANG_NAMES[next.a]} to ${LANG_NAMES[next.b]}`);
  };
  return (
    <div>
      <span className="eyebrow">🌐 TRANSLATOR · {pair.label.toUpperCase()}</span>
      {card.lastFrom ? (
        <div className="feat-translate">
          <p><small>{card.fromLang}</small><br />“{card.lastFrom}”</p>
          <p className="feat-translate-to"><small>{card.toLang}</small><br />“{card.lastTo}”</p>
        </div>
      ) : (
        <p className="feat-note">Speak either language — I’ll say it back in the other, out loud.</p>
      )}
      <div className="feat-row">
        <button className="text-button" onClick={cycle}>Change pair</button>
        <button className="text-button" onClick={() => say('translator band')}>Exit</button>
      </div>
    </div>
  );
}

function StoryCard({ card, say }: { card: Extract<FeatureCard, { kind: 'story' }>; say: (t: string) => void }) {
  const t = card.thread;
  return (
    <div>
      <span className="eyebrow">📖 {t.title.toUpperCase()} · EPISODE {t.episodes.length}{card.offline ? ' · OFFLINE' : ''}</span>
      <p className="feat-story">{card.episode}</p>
      <p className="feat-note">
        {t.characters.length ? `Cast: ${t.characters.join(', ')}. ` : ''}
        {episodesToday(t)}/{BEDTIME_CAP} bedtime episodes today · ages {t.ageBand}
      </p>
      <div className="feat-row">
        <button className="primary-button" onClick={() => say('aage sunao')}>Aage sunao</button>
        <button className="text-button" onClick={() => say('nayi kahani')}>New story</button>
        <button className="text-button" onClick={() => say('kahani band')}>Goodnight</button>
      </div>
    </div>
  );
}

function NightCard({ card }: { card: Extract<FeatureCard, { kind: 'night' }> }) {
  return (
    <div>
      <span className="eyebrow">🌙 NIGHT NOTE SAVED</span>
      <p>“{card.note.text}”</p>
      <p className="feat-note">Tags: {card.note.tags.join(', ')} · Say “morning digest” after sunrise for reframes + task drafts.</p>
    </div>
  );
}

function WitnessCard({ say }: { say: (t: string) => void }) {
  const witness = useFeaturesStore((s) => s.witness);
  const dispatch = useFeaturesStore((s) => s.witnessDispatch);
  const [name, setName] = useState(witness.contactName || '');
  const [phone, setPhone] = useState(witness.contactPhone || '');
  const [, setTick] = useState(0);
  useEffect(() => {
    if (witness.phase !== 'active') return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [witness.phase]);
  const since = witness.lastCheckinAt ? Math.max(0, witness.intervalSec - Math.floor((Date.now() - witness.lastCheckinAt) / 1000)) : 0;
  const saveContact = () => dispatch({ type: 'set-contact', name: name.trim() || null, phone: phone.replace(/\s+/g, '') || null });
  const logCount = witness.log.filter((e) => e.kind === 'transcript').length;
  return (
    <div>
      <span className="eyebrow">{witness.phase === 'alert' ? '🚨 WITNESS ALERT — NO RESPONSE' : witness.phase === 'active' ? '🛡️ WITNESS ACTIVE' : '🛡️ WITNESS LOG'}</span>
      {witness.phase === 'alert' && (
        <p className="feat-big">Two check-ins missed! If you can read this, say “safe”. Otherwise tap SMS below.</p>
      )}
      {witness.phase === 'active' && (
        <p className="feat-note">Next check-in in ~{Math.floor(since / 60)}:{`${since % 60}`.padStart(2, '0')} · {logCount} notes timestamped · Say “safe” anytime.</p>
      )}
      {witness.phase === 'idle' && <p className="feat-note">{logCount} notes in this log. Export before dismissing.</p>}
      <div className="feat-row">
        <label className="feat-label">Contact<input className="feat-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Priya" /></label>
        <label className="feat-label">Phone<input className="feat-input" value={phone} inputMode="tel" maxLength={16} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" /></label>
        <button className="text-button" onClick={saveContact}>Save</button>
      </div>
      <div className="feat-row">
        <a className="primary-button" href={smsHref(phone || witness.contactPhone, witness)}>SMS alert</a>
        <button className="text-button" onClick={() => downloadFile(`witness-${Date.now()}.txt`, evidenceText(witness))}>Export evidence</button>
        <button className="text-button" onClick={async () => copyText(evidenceText(witness))}>Copy log</button>
        {witness.phase !== 'idle' ? (
          <>
            <button className="primary-button" onClick={() => say('safe')}>I’m safe</button>
            <button className="text-button danger" onClick={() => say('stop witness')}>Stop witness</button>
          </>
        ) : (
          <button className="primary-button" onClick={() => say('witness mode on')}>Start witness</button>
        )}
      </div>
      <p className="feat-note">Free forever. On-device transcript only — nothing is uploaded. Laws on recording vary; you are responsible for your use.</p>
    </div>
  );
}

function BriefCard({ card }: { card: Extract<FeatureCard, { kind: 'brief' }> }) {
  return (
    <div>
      <span className="eyebrow">☀️ {card.title.toUpperCase()}</span>
      {card.result.sections.map((s, i) => (
        <div key={i}>
          <h4 className="feat-h">{s.title}</h4>
          <ul className="feat-list">{s.lines.map((l, j) => <li key={j}>{l}</li>)}</ul>
        </div>
      ))}
      {!card.result.sections.length && <p className="feat-note">All clear — nothing on the radar.</p>}
    </div>
  );
}

function ForgettingCard({ card }: { card: Extract<FeatureCard, { kind: 'forgetting' }> }) {
  return (
    <div>
      <span className="eyebrow">🧠 WHAT YOU MIGHT BE FORGETTING</span>
      {card.result.top.length
        ? <ul className="feat-list">{card.result.top.map((t, i) => <li key={i}>{t}</li>)}</ul>
        : <p className="feat-note">Nothing slipping. Genuinely on top of it all.</p>}
    </div>
  );
}

function FollowupsCard({ card }: { card: Extract<FeatureCard, { kind: 'followups' }> }) {
  const done = useFeaturesStore((s) => s.doneCommitment);
  const r = card.result;
  return (
    <div>
      <span className="eyebrow">🤝 FOLLOW-UP RADAR</span>
      {r.overdue.length > 0 && (
        <>
          <h4 className="feat-h">🔴 Overdue</h4>
          <ul className="feat-list">
            {r.overdue.map((c) => (
              <li key={c.id}>{c.text} <button className="text-button" onClick={() => done(c.id, true)}>Mark done</button></li>
            ))}
          </ul>
        </>
      )}
      {r.upcoming.length > 0 && (
        <>
          <h4 className="feat-h">Upcoming</h4>
          <ul className="feat-list">
            {r.upcoming.map((c) => (
              <li key={c.id}>{c.text}{c.dueKey ? ` (by ${c.dueKey})` : ''} <button className="text-button" onClick={() => done(c.id, true)}>Mark done</button></li>
            ))}
          </ul>
        </>
      )}
      {!r.overdue.length && !r.upcoming.length && <p className="feat-note">No open promises. Your word is clean!</p>}
    </div>
  );
}

function MoneyCard({ card }: { card: Extract<FeatureCard, { kind: 'money' }> }) {
  return (
    <div>
      <span className="eyebrow">💸 MONEY GUARD</span>
      {card.dues.length
        ? <ul className="feat-list">{card.dues.map((d, i) => <li key={i}><strong>{d.title}</strong> — {d.detail}</li>)}</ul>
        : <p className="feat-note">No dues visible. Add one: “remind me to pay electricity bill on 5th”.</p>}
    </div>
  );
}

function ScribeCard({ card, say }: { card: Extract<FeatureCard, { kind: 'scribe' }>; say: (t: string) => void }) {
  const m = card.minutes;
  return (
    <div>
      <span className="eyebrow">📝 SCRIBE MINUTES</span>
      <p className="feat-note">{m.summary}</p>
      <h4 className="feat-h">Decisions</h4>
      <ul className="feat-list">{m.decisions.map((d, i) => <li key={i}>{d}</li>) || null}{!m.decisions.length && <li>None spotted</li>}</ul>
      <h4 className="feat-h">Owners</h4>
      <ul className="feat-list">{m.owners.map((o, i) => <li key={i}><strong>{o.who}</strong> — {o.what}</li>)}{!m.owners.length && <li>None spotted</li>}</ul>
      <h4 className="feat-h">Deadlines</h4>
      <ul className="feat-list">{m.deadlines.map((d, i) => <li key={i}>{d.what} ({d.when})</li>)}{!m.deadlines.length && <li>None spotted</li>}</ul>
      {m.questions.length > 0 && (
        <>
          <h4 className="feat-h">Open questions</h4>
          <ul className="feat-list">{m.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
        </>
      )}
      {card.tasks.length > 0 && (
        <div className="feat-row">
          <button className="primary-button" onClick={() => say('save scribe tasks')}>Save {card.tasks.length} as tasks</button>
        </div>
      )}
    </div>
  );
}

function DigestCard({ card, say }: { card: Extract<FeatureCard, { kind: 'digest' }>; say: (t: string) => void }) {
  const d = card.digest;
  const [saved, setSaved] = useState(false);
  const saveTasks = async () => {
    try {
      await useWorkspaceStore.getState().capture(d.taskDrafts.slice(0, 10).map((t) => ({ kind: 'task' as const, title: t.slice(0, 120), body: `From night notes: ${t}` })), 'voice');
      setSaved(true);
    } catch {
      say('workspace is loading, try again');
    }
  };
  return (
    <div>
      <span className="eyebrow">🌅 MORNING DIGEST</span>
      {d.empty && <p className="feat-note">No night notes. Sleep well, wake fresh!</p>}
      {d.reframes.map((r, i) => (
        <div key={i} className="feat-reframe">
          <p>“{r.note}”</p>
          <p><strong>→ {r.reframe}</strong></p>
        </div>
      ))}
      {d.taskDrafts.length > 0 && (
        <>
          <h4 className="feat-h">Idea → task drafts</h4>
          <ul className="feat-list">{d.taskDrafts.map((t, i) => <li key={i}>{t}</li>)}</ul>
          {!saved
            ? <button className="primary-button" onClick={() => void saveTasks()}>Save as tasks</button>
            : <p role="status" className="feat-note">Saved to your tasks!</p>}
        </>
      )}
      {d.gratitudes.length > 0 && (
        <>
          <h4 className="feat-h">Gratitude</h4>
          <ul className="feat-list">{d.gratitudes.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </>
      )}
    </div>
  );
}

function PlanCard({ card }: { card: Extract<FeatureCard, { kind: 'plan' }> }) {
  const plan = useFeaturesStore((s) => s.plan);
  const planSource = useFeaturesStore((s) => s.planSource);
  const unlock = useFeaturesStore((s) => s.unlock);
  const applyServerEntitlement = useFeaturesStore((s) => s.applyServerEntitlement);
  const usage = useFeaturesStore((s) => s.usage);
  const signedIn = useAssistantStore((s) => s.isAuthenticated);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(card.reason === 'invalid-key' ? 'That key did not validate.' : '');

  // Signed in, the server decides: the key is redeemed there and applies on
  // every device. Signed out, a key only unlocks this browser, and says so.
  const apply = async () => {
    const trimmed = key.trim();
    if (!trimmed) {
      setMsg('Enter a key, for example OB-PRO-A7K2QM.');
      return;
    }
    setBusy(true);
    try {
      if (signedIn) {
        const { redeemKeyOnServer } = await import('@/lib/entitlements');
        const result = await redeemKeyOnServer(trimmed);
        if (!result.ok) {
          setMsg(result.error);
          return;
        }
        applyServerEntitlement(result.entitlement);
        setMsg(`${result.entitlement.plan.toUpperCase()} redeemed on your account.`);
        setKey('');
        return;
      }
      const device = validateBetaKey(trimmed);
      if (!device) {
        setMsg('That key is not valid for this browser. Check the characters, or sign in and redeem it there.');
        return;
      }
      unlock(device, trimmed.toUpperCase());
      setMsg(`${device === 'family' ? 'Family' : 'Pro'} unlocked in this browser only. Sign in to make it account-wide.`);
      setKey('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <span className="eyebrow">⭐ PLAN · YOU ARE ON {plan.toUpperCase()}</span>
      <p className="feat-note">
        {planSource === 'server'
          ? 'Decided by your account on the server.'
          : planSource === 'device-beta'
            ? 'Unlocked in this browser only — not on your account.'
            : 'Nothing redeemed yet.'}
      </p>
      <ul className="feat-list">
        {PLANS.map((p) => <li key={p.id}><strong>{p.name} {p.price}</strong> — {p.blurb}</li>)}
      </ul>
      <p className="feat-note">Usage: {usage.researchCount} research today · {usage.emailCount} drafts this month · {usage.storyTrial}/{FREE_LIMITS.storyTrialEpisodes} story trial · {usage.scribeCount} scribes today</p>
      {plan === 'free' && (
        <div className="feat-row">
          <label className="feat-label">
            Key
            <input className="feat-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="OB-PRO-XXXXXX" aria-label="Entitlement key" autoComplete="off" spellCheck={false} />
          </label>
          <button className="primary-button" disabled={busy} onClick={() => void apply()}>
            {signedIn ? 'Redeem on my account' : 'Unlock this browser'}
          </button>
        </div>
      )}
      {msg && <p role="status" className="feat-note">{msg} No payment is collected; keys are issued by the operator.</p>}
      <a className="text-button" href="/control?panel=plan">Open Plan panel ↗</a>
    </div>
  );
}

function MessageCard({ card }: { card: Extract<FeatureCard, { kind: 'message' }> }) {
  return (
    <div>
      <span className="eyebrow">💡 {card.title.toUpperCase()}</span>
      <p>{card.body}</p>
    </div>
  );
}

const SAY_GROUPS: { label: string; items: { say: string; hint: string }[] }[] = [
  {
    label: 'Save something',
    items: [
      { say: 'task: Send the proposal by Friday', hint: 'Becomes a task you review before it is saved' },
      { say: 'note: Idea for the Diwali campaign', hint: 'Saved on this browser, no AI needed' },
      { say: '20 pushups kar liye', hint: 'Voice-logged fitness, works in Hinglish' },
    ],
  },
  {
    label: 'Ask or calculate',
    items: [
      { say: 'morning brief', hint: 'Your day, spoken in one summary' },
      { say: '15% of 60000', hint: 'Calculated locally and spoken back' },
      { say: 'what did I decide about the flat', hint: 'Searches what you already saved' },
    ],
  },
  {
    label: 'Play music',
    items: [
      { say: 'play kesariya', hint: 'Free sources; a mini-player stays at the bottom' },
      { say: 'gaana band', hint: 'Pause the song (“stop” still ends listening)' },
    ],
  },
  {
    label: 'Start a mode',
    items: [
      { say: 'leave application likh do', hint: 'Drafts an email you review before sending' },
      { say: 'translator mode', hint: 'Two-way translation with a free trial window' },
      { say: 'kahani sunao', hint: 'Story mode for kids, remembers its characters' },
      { say: 'witness mode on', hint: 'Safety companion that logs what you say' },
    ],
  },
];

/**
 * "What can I actually do here?" — the answer, grouped and tappable.
 *
 * This replaced a single line of quoted phrases: it read as noise, and nothing
 * in it could be tried without a microphone. Tapping a chip runs the same
 * transcript path as speaking it, so the visible examples are never decorative.
 */
export function FeatureHint({ say }: { say?: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const groups = open ? SAY_GROUPS : SAY_GROUPS.slice(0, 2);
  return (
    <section className="say-card" aria-label="Things you can say or tap">
      <div className="say-head">
        <span className="overline">TRY ONE OF THESE</span>
        <button
          type="button"
          className="text-button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Show fewer examples' : 'More examples'}
        </button>
      </div>
      {groups.map((group) => (
        <div className="say-group" key={group.label}>
          <h3>{group.label}</h3>
          <div className="say-chips">
            {group.items.map((item) =>
              say ? (
                <button type="button" key={item.say} title={item.hint} onClick={() => say(item.say)}>
                  {item.say}
                </button>
              ) : (
                <span key={item.say} title={item.hint}>
                  {item.say}
                </span>
              ),
            )}
          </div>
        </div>
      ))}
      <p className="feat-hint">
        <Icon name="help" /> Tap a phrase to run it, or say it while listening. Everything is reviewed before it is
        saved, and nothing is uploaded just by trying.
      </p>
    </section>
  );
}
