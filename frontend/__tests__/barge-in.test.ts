import { describe, expect, it } from 'vitest';
import {
  classifyWhileSpeaking,
  resumePlan,
  isEndSessionPhrase,
  isInterruptPhrase,
  isProgressStale,
  isResumeRequest,
  recordInterruption,
  remainingSpeech,
  resumeOffer,
  resumeText,
  sentencesSpoken,
  splitSentences,
} from '../lib/barge-in';

describe('interrupting the assistant', () => {
  it('accepts real stop phrases, including Hinglish and the wake word', () => {
    for (const phrase of ['stop', 'Stop.', 'stop it', 'chup karo', 'ruko', 'bas', 'wait', 'OneBrain stop', 'hey onebrain ruk jao', 'pause', 'ek minute']) {
      expect(isInterruptPhrase(phrase), phrase).toBe(true);
      expect(classifyWhileSpeaking(phrase), phrase).toBe('stop-speaking');
    }
  });

  it('accepts resume phrases separately from stop phrases', () => {
    for (const phrase of ['continue', 'carry on', 'go on', 'aage bolo', 'baaki sunao', 'the rest', 'jahan chhoda']) {
      expect(isResumeRequest(phrase), phrase).toBe(true);
      expect(classifyWhileSpeaking(phrase), phrase).toBe('resume');
    }
    expect(isInterruptPhrase('aage bolo')).toBe(false);
    expect(isResumeRequest('stop it')).toBe(false);
  });

  it('treats session-ending phrases as such, not as a resume', () => {
    expect(isEndSessionPhrase('stop listening')).toBe(true);
    expect(classifyWhileSpeaking('stop listening')).toBe('end-session');
  });

  it('ignores everything else, so the assistant never answers its own voice', () => {
    const ownReply = 'Aapka kal ka kharcha 240 rupaye tha, aur aaj ka budget bacha hua hai.';
    expect(classifyWhileSpeaking(ownReply)).toBe('ignore');
    expect(classifyWhileSpeaking('what is the weather in Pune tomorrow')).toBe('ignore');
    expect(classifyWhileSpeaking('')).toBe('ignore');
    // A sentence that merely contains a stop word is not a stop command.
    expect(classifyWhileSpeaking('please stop the music later tonight')).toBe('ignore');
  });
});

describe('resuming where the answer stopped', () => {
  const reply = 'Pehla point ye hai. Doosra point zyada zaroori hai. Teesra point aakhir mein.';

  it('splits a reply on sentence boundaries, keeping terminal punctuation', () => {
    expect(splitSentences(reply)).toEqual([
      'Pehla point ye hai.',
      'Doosra point zyada zaroori hai.',
      'Teesra point aakhir mein.',
    ]);
    expect(splitSentences('')).toEqual([]);
    // Devanagari danda is a sentence end too.
    expect(splitSentences('पहला वाक्य। दूसरा वाक्य।')).toHaveLength(2);
  });

  it('counts only whole sentences as heard', () => {
    const first = 'Pehla point ye hai.';
    expect(sentencesSpoken(reply, 0)).toBe(0);
    expect(sentencesSpoken(reply, first.length)).toBe(1);
    expect(sentencesSpoken(reply, first.length + 5)).toBe(1);
    expect(sentencesSpoken(reply, reply.length)).toBe(3);
  });

  it('never records a resume point when nothing was heard yet', () => {
    expect(recordInterruption(reply, 0, 1000)).toBeNull();
    expect(recordInterruption(reply, reply.length, 1000)).toBeNull();
    expect(recordInterruption('', 5, 1000)).toBeNull();
  });

  it('keeps the unspoken remainder and trims it', () => {
    const progress = recordInterruption(reply, 'Pehla point ye hai.'.length, 1000)!;
    expect(progress.spokenChars).toBe('Pehla point ye hai.'.length);
    expect(remainingSpeech(progress)).toBe('Doosra point zyada zaroori hai. Teesra point aakhir mein.');
    expect(remainingSpeech(null)).toBe('');
  });

  it('offers the rest with a count and expires stale progress', () => {
    const progress = recordInterruption(reply, 'Pehla point ye hai.'.length, 1000)!;
    expect(resumeOffer(progress)).toMatch(/continue/i);
    expect(resumeOffer(progress)).toMatch(/2 lines left/);
    expect(resumeOffer(null)).toBeNull();
    expect(resumeOffer(recordInterruption(reply, reply.length - 1, 1000))).toMatch(/1 line left/);
    expect(isProgressStale(progress, 1000 + 60_000)).toBe(false);
    expect(isProgressStale(progress, 1000 + 11 * 60_000)).toBe(true);
    expect(isProgressStale(null, 1000)).toBe(true);
  });

  it('re-speaks the interrupted sentence whole, so a resume never opens on a fragment', () => {
    // Cut three characters into the last sentence: "Tee|sra point…".
    const progress = recordInterruption(reply, reply.indexOf('Teesra') + 3, 1000)!;
    const text = resumeText(progress)!;
    expect(text).toBe('Teesra point aakhir mein.');
    expect(text.startsWith('sra')).toBe(false);
    // A cut exactly on a boundary resumes at the next sentence, with no repeat.
    const clean = recordInterruption(reply, 'Pehla point ye hai. '.length, 1000)!;
    expect(resumeText(clean)).toBe('Doosra point zyada zaroori hai. Teesra point aakhir mein.');
    expect(resumeText(null)).toBeNull();
    // The plan carries the offset, so a resume is measured against the original
    // reply rather than the sliced text.
    const plan = resumePlan(progress)!;
    expect(plan.text).toBe('Teesra point aakhir mein.');
    expect(reply.slice(plan.offset, plan.offset + plan.text.length)).toBe(plan.text);
    expect(resumePlan(null)).toBeNull();
  });

  it('is a different behaviour from the session "continue" control', () => {
    // "continue" alone is the resume phrase; the session control also accepts
    // "start"/"listen" and is handled by the command parser, not here.
    expect(isResumeRequest('continue')).toBe(true);
    expect(isResumeRequest('start')).toBe(false);
  });
});
