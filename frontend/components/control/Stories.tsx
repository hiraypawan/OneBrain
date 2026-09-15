'use client';
import { useState } from 'react';
import { useFeaturesStore } from '@/store/features';
import { episodesToday, type AgeBand, type StoryThread } from '@/lib/story';
import { useAssistantStore } from '@/store/assistant';

export function Stories() {
  const stories = useFeaturesStore((s) => s.stories);
  const saveStory = useFeaturesStore((s) => s.saveStory);
  const removeStory = useFeaturesStore((s) => s.removeStory);
  const cap = useFeaturesStore((s) => s.storyCap);
  const setCap = useFeaturesStore((s) => s.setStoryCap);
  const [openId, setOpenId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [age, setAge] = useState<AgeBand>('7-10');
  const [notice, setNotice] = useState('');

  const create = () => {
    const lang = useAssistantStore.getState().settings.language;
    const storyLang = (lang === 'marathi' ? 'marathi' : lang === 'hi-IN' ? 'hindi' : lang.startsWith('en') ? 'english' : 'hinglish') as StoryThread['language'];
    const t: StoryThread = {
      id: `story-${Date.now()}`,
      title: title.trim() || 'Jungle Doston ki Kahani',
      ageBand: age,
      language: storyLang,
      characters: [],
      threads: [],
      episodes: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    saveStory(t);
    setTitle('');
    setOpenId(t.id);
    setNotice('Story created! Say “kahani sunao” on Today to hear episode 1.');
  };

  return (
    <div className="panel-stack">
      {notice && <p role="status" className="workspace-notice">{notice}</p>}
      <section className="settings-section">
        <h3>Parent controls</h3>
        <p>Stories remember characters across episodes via on-device memory. Bedtime cap stops new episodes after the limit.</p>
        <label>Bedtime episodes per day
          <input type="number" min={1} max={20} value={cap} onChange={(e) => setCap(Number(e.target.value))} />
        </label>
        <p><small>Safety: no horror/romance, no personal questions to the child, age-banded language.</small></p>
      </section>
      <section className="settings-section">
        <h3>New story</h3>
        <div className="settings-grid">
          <label>Title<input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="Chintu Bandar ki Kahani" /></label>
          <label>Age band
            <select value={age} onChange={(e) => setAge(e.target.value as AgeBand)}>
              <option value="3-6">3–6 years</option>
              <option value="7-10">7–10 years</option>
              <option value="11+">11+ years</option>
            </select>
          </label>
        </div>
        <div className="sheet-actions">
          <button className="primary-button" onClick={create}>Create story</button>
        </div>
      </section>
      <section className="settings-section">
        <h3>Library ({stories.length})</h3>
        {!stories.length && <p>No stories yet. Create one above or say “kahani sunao”.</p>}
        {stories.map((s) => (
          <details key={s.id} open={openId === s.id} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) setOpenId(s.id); }}>
            <summary>{s.title} · {s.episodes.length} episodes · ages {s.ageBand} · {episodesToday(s)} today</summary>
            {s.characters.length > 0 && <p><small>Cast: {s.characters.join(', ')}</small></p>}
            {s.threads.length > 0 && <p><small>Open threads: {s.threads.join('; ')}</small></p>}
            {s.episodes.map((e, i) => (
              <article key={i}>
                <small>Episode {i + 1} · {new Date(e.at).toLocaleString('en-IN')}{e.offline ? ' · offline' : ''}</small>
                <p>{e.text}</p>
              </article>
            ))}
            {!s.episodes.length && <p><small>No episodes yet — say “kahani sunao” on Today.</small></p>}
            <div className="sheet-actions">
              <button className="text-button danger" onClick={() => { if (confirm(`Delete “${s.title}” and all episodes?`)) removeStory(s.id); }}>Delete story</button>
            </div>
          </details>
        ))}
      </section>
    </div>
  );
}
