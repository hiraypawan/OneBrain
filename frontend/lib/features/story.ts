// Story mode for kids: serialized tales with persistent characters via the
// memory system. Strict age-band guards, bedtime caps, parent dashboard
// data. Offline fallback weaves known characters into a template episode.

export type AgeBand = '3-6' | '7-10' | '11+';

export interface StoryEpisode {
  text: string;
  at: number;
  offline?: boolean;
}

export interface StoryThread {
  id: string;
  title: string;
  ageBand: AgeBand;
  language: 'hinglish' | 'hindi' | 'english' | 'marathi';
  characters: string[];
  threads: string[];
  episodes: StoryEpisode[];
  createdAt: number;
  updatedAt: number;
}

export const BEDTIME_CAP = 3; // episodes per day per thread (parent can change)
export const TRIAL_EPISODES = 3; // free trial episodes before Family/Pro

export type StoryIntent =
  | { action: 'enter' }
  | { action: 'continue' }
  | { action: 'new' }
  | { action: 'exit' }
  | null;

export function detectStoryIntent(text: string): StoryIntent {
  const t = String(text || '').toLowerCase().trim();
  if (/^(story (mode )?(band|off|stop|exit)|kahani band|bas kahani|good ?night)/.test(t))
    return { action: 'exit' };
  if (/(nayi kahani|nai kahani|new story|dusri kahani|another story|different story)/.test(t))
    return { action: 'new' };
  if (/(aage sunao|continue|phir kya hua|next part|aage batao|aur sunao)/.test(t))
    return { action: 'continue' };
  if (/(kahani sunao|story sunao|kissa sunao|story mode|kahani batao|bedtime story)/.test(t))
    return { action: 'enter' };
  return null;
}

export function ageGuard(band: AgeBand): string {
  const base =
    'SAFE STORY RULES (never break): kind and gentle tone; no horror, violence, romance, or scary cliffhangers; ' +
    'no personal questions to the child (never ask name, school, address, or photos); ' +
    'if the child shares personal info, ignore it and steer back to the story; ' +
    'end with a warm one-line moral and a soft goodnight when it is late.';
  if (band === '3-6')
    return `${base} For ages 3-6: very short sentences, repetition, animal characters, happy endings only, under 120 words.`;
  if (band === '7-10')
    return `${base} For ages 7-10: adventure with mild suspense resolved happily, under 200 words.`;
  return `${base} For ages 11+: richer mystery/adventure, clever twists, still wholesome, under 300 words.`;
}

/** Continuation prompt carrying full story state. Ends with a parseable CAST line. */
export function episodePrompt(thread: StoryThread, kidSaid?: string): string {
  const last = thread.episodes.length
    ? `\nLast episode ended: "${thread.episodes[thread.episodes.length - 1].text.slice(0, 400)}"`
    : '\nThis is episode 1: introduce the world and characters.';
  return (
    `You are a beloved storyteller for a ${thread.ageBand}-year-old, telling the tale in ${thread.language === 'hinglish' ? 'Hinglish (Roman Hindi + simple English)' : thread.language}. ` +
    `${ageGuard(thread.ageBand)}\n` +
    `Story: "${thread.title}". Characters so far: ${thread.characters.join(', ') || 'none yet — invent 1-2 lovable ones'}. ` +
    `Open plot threads: ${thread.threads.join('; ') || 'none yet'}.${last}\n` +
    (kidSaid ? `The child just said: "${kidSaid}". Weave it in gently.\n` : '') +
    `Tell the next episode now. End with exactly one soft hook (no fear). ` +
    `After the story, on a NEW line, write: CAST: <comma names> | THREADS: <comma open threads>`
  );
}

/** Parse the trailing "CAST: … | THREADS: …" state line from an episode. */
export function parseStoryState(text: string): { characters: string[]; threads: string[]; clean: string } {
  const lines = String(text || '').split('\n');
  const last = lines[lines.length - 1] || '';
  const m = last.match(/CAST:\s*(.*?)\s*\|\s*THREADS:\s*(.*)/i);
  if (!m) {
    return { characters: [], threads: [], clean: text.trim() };
  }
  const split = (s: string) =>
    s.split(',').map((x) => x.trim()).filter((x) => x && x.length <= 60 && !/^(none|no|nil)$/i.test(x)).slice(0, 8);
  return {
    characters: split(m[1]),
    threads: split(m[2]),
    clean: lines.slice(0, -1).join('\n').trim(),
  };
}

/** Offline episode: template woven with known characters. Honest label. */
export function offlineEpisode(thread: StoryThread): string {
  const hero = thread.characters[0] || 'Chintu Khargosh';
  const friend = thread.characters[1] || 'Minti Chidiya';
  const n = thread.episodes.length + 1;
  return (
    `Episode ${n}: ${hero} aur ${friend} aaj nadi kinare sair par nikle. ` +
    `Raste mein unhe ek chamakti hui cheez mili — arre, yeh to wahi pehli jo pichli baar adhuri reh gayi thi! ` +
    `Dono ne milkar socha, himmat ki, aur muskurate hue aage badh gaye. ` +
    `Aage kya hua? Woh hum agle episode mein sunenge. ` +
    `Seekh: mushkil kaam bhi doston ke saath aasaan lagta hai. ` +
    `(Yeh kahaani offline sunayi gayi — internet par aur rangeen kahaniyan milengi.)`
  );
}

export function episodesToday(thread: StoryThread, now = Date.now()): number {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return thread.episodes.filter((e) => e.at >= start).length;
}

export function storySpokenIntro(thread: StoryThread, isNew: boolean): string {
  if (isNew)
    return `Kahani shuru! "${thread.title}". Aaram se suno — main tumhare doston ko yaad rakhunga.`;
  const last = thread.episodes[thread.episodes.length - 1];
  return last
    ? `Pichli baar: ${last.text.slice(0, 140)}… Aage suno!`
    : `Chalo, "${thread.title}" shuru karte hain!`;
}

/** Names for a brand-new thread from the child's first line. */
export function titleFromLine(line: string): string {
  const clean = String(line || '')
    .replace(/(kahani|story|sunao|batao|nayi|nai|new|ek|about|ki|ka|ke)/gi, '')
    .replace(/[?.!]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  if (clean.length >= 3) return `${capitalize(clean)} ki Kahani`;
  return 'Jungle Doston ki Kahani';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
