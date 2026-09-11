// Voice commands: exact-phrase controls so the user can drive the session
// hands-free ("stop", "continue", "new chat", "repeat"). Pure + tested.
// Everything else falls through to normal chat.
export type VoiceCommand = 'stop' | 'continue' | 'new' | 'repeat' | 'notyou' | null;

const norm = (t: string) =>
  String(t || '').toLowerCase().replace(/[?!.,:;]+$/g, '').replace(/\s+/g, ' ').trim();

const EXACT: Record<string, VoiceCommand> = {
  stop: 'stop',
  'stop listening': 'stop',
  ruko: 'stop',
  'ruk jao': 'stop',
  'ruk jaao': 'stop',
  'band karo': 'stop',
  'bas karo': 'stop',
  chup: 'stop',
  quiet: 'stop',
  'shut up': 'stop',
  continue: 'continue',
  resume: 'continue',
  'start listening': 'continue',
  'shuru karo': 'continue',
  'phir se suno': 'continue',
  'sun-na shuru karo': 'continue',
  'new chat': 'new',
  'start new chat': 'new',
  'naya chat': 'new',
  'nayi chat': 'new',
  'naya chat shuru karo': 'new',
  'fresh start': 'new',
  'nayi baat karte hain': 'new',
  repeat: 'repeat',
  'repeat that': 'repeat',
  'say that again': 'repeat',
  'phir se bolo': 'repeat',
  'dobara bolo': 'repeat',
  // "Wasn't talking to you" — deletes the last exchange, no AI call.
  'not you': 'notyou',
  'ignore that': 'notyou',
  'cancel that': 'notyou',
  'forget that': 'notyou',
  'tumse nahi': 'notyou',
  'tujhse nahi': 'notyou',
  'tujh se nahi': 'notyou',
  'tumse baat nahi': 'notyou',
  'galat sun liya': 'notyou',
  'wrong sun liya': 'notyou',
  'i was not talking to you': 'notyou',
  'main tumse baat nahi kar raha': 'notyou',
  'main tumse baat nahi kar rahi': 'notyou',
};

export function parseVoiceCommand(text: string): VoiceCommand {
  return EXACT[norm(text)] || null;
}

export type MediaAction =
  | { action: 'play'; query: string; kinds?: ('song' | 'podcast' | 'video')[] }
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'close' };

// "play kesariya" / "kesariya bajao" / "pause" / "stop song".
// Exact session commands ('stop' alone etc.) are matched FIRST by
// parseVoiceCommand, so there is no conflict: "stop" stops the session,
// "stop song" stops the music.
export function parseMediaCommand(text: string): MediaAction | null {
  const t = norm(text);

  const pauseRe = /^(pause|pause karo|roko|gaana band|song band|music band|rukko)$/;
  if (pauseRe.test(t)) return { action: 'pause' };

  const resumeRe = /^(resume|phir se chalao|continue (the )?(song|music|gaana|video))$/;
  if (resumeRe.test(t)) return { action: 'resume' };

  const closeRe = /^(close|band karo )?(song|music|gaana|video|player)( band karo| stop)?$/;
  if (closeRe.test(t) || /^(stop (the )?(song|music|gaana|video))$/.test(t)) {
    return { action: 'close' };
  }

  let raw: string | null = null;
  let m = t.match(/^(play|bajao|chalao|sunao|play karo)\s+(.+)$/);
  if (m && m[2].length > 1) raw = m[2];
  if (!raw) {
    m = t.match(/^(.+?)\s+(bajao|play karo|play kar do|chalao|sunao|laga do|lgao)$/);
    if (m && m[1].length > 1) raw = m[1];
  }
  if (!raw) return null;

  // "play a song name play date" -> "play date": drop filler/type words.
  // "play song saudebaji" -> "saudebaji".
  let query = raw
    .replace(/^(a|an|ek|the)\s+/i, '')
    .replace(/^(song|songs|gaana|gana|music|video|podcast)(\s+name)?\s+/i, '')
    .replace(/\s+(song|songs|gaana|gana|music|video|podcast)$/i, '')
    .trim();
  if (query.length < 2) return null;

  // Kind hints so "play a song" never returns a podcast.
  const has = (re: RegExp) => re.test(t);
  let kinds: ('song' | 'podcast' | 'video')[] | undefined;
  if (has(/podcast/)) kinds = ['podcast'];
  else if (has(/video|youtube/)) kinds = ['video'];
  else if (has(/song|songs|gaana|gana|music|sunao|bajao/)) kinds = ['song', 'video'];
  return { action: 'play', query, kinds };
}
