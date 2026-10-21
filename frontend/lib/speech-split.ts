// Sentence-aware text splitting for spoken replies.
//
// Shared by the browser voice (lib/speech.ts) and the server read-aloud voice
// (lib/tts-server.ts), so it is pure: no DOM, no audio, safe in a route.

// Break a cleaned reply into utterance-sized pieces. Chrome's speechSynthesis
// goes quiet mid-sentence on long utterances (~15 s on desktop; Android may
// end without firing any event), so each chunk stays comfortably short and
// splits only on sentence/clause boundaries — never mid-word.
export function splitForSpeech(text: string, maxChars = 180): string[] {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  if (t.length <= maxChars) return [t];
  // Sentence enders in Latin scripts plus the Devanagari danda (।).
  const sentences = t.match(/[^.!?।]+[.!?।]*\s*/g) || [t];
  const out: string[] = [];
  let buf = '';
  const flush = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = '';
  };
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (s.length > maxChars) {
      flush();
      // One very long sentence: split on commas/semicolons, then on spaces.
      let piece = '';
      for (const part of s.split(/(?<=[,;:])\s+/)) {
        if ((piece + ' ' + part).trim().length > maxChars && piece) {
          out.push(piece.trim());
          piece = '';
        }
        if (part.length > maxChars) {
          for (const word of part.split(' ')) {
            if ((piece + ' ' + word).trim().length > maxChars && piece) {
              out.push(piece.trim());
              piece = '';
            }
            piece = (piece + ' ' + word).trim();
          }
        } else {
          piece = (piece + ' ' + part).trim();
        }
      }
      if (piece) out.push(piece);
      continue;
    }
    if ((buf + ' ' + s).trim().length > maxChars) flush();
    buf = (buf + ' ' + s).trim();
  }
  flush();
  return out;
}

/**
 * Split a reply so that the FIRST piece is short and the rest are long.
 *
 * Reply audio is fetched piece by piece. A short opening piece means the
 * first words are heard quickly; the larger pieces after it are fetched while
 * the opening plays, so there is no gap between them.
 */
export function splitForProgressiveSpeech(text: string, firstMax = 220, restMax = 900): string[] {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  if (t.length <= firstMax) return [t];
  const lead = splitForSpeech(t, firstMax)[0] || '';
  // The lead is always a prefix of the normalised text; if that ever stops
  // holding, fall back to even pieces rather than risk dropping words.
  if (!lead || !t.startsWith(lead)) return splitForSpeech(t, restMax);
  const rest = t.slice(lead.length).trim();
  return rest ? [lead, ...splitForSpeech(rest, restMax)] : [lead];
}
