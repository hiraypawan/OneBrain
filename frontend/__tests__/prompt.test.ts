import { describe, it, expect } from 'vitest';
import { buildTurnPrompt, detectReplyLanguage, normalizeHistory } from '../lib/prompt';
import { parseVoiceCommand, isPauseCommand, stripCommandFillers } from '../lib/commands';

describe('reply language follows the user, not a guess', () => {
  it.each([
    ['what is the capital of france', 'hinglish', 'english'],
    ['kal meeting kitne baje hai', 'en-IN', 'hinglish'],
    ['kya haal hai', 'en-IN', 'hinglish'],
    ['आज मौसम कैसा है', 'hinglish', 'hindi'],
    ['मला उद्या काय करायचं आहे', 'hinglish', 'marathi'],
    ['hola necesito ayuda por favor', 'en-IN', 'spanish'],
    ['ok', 'hinglish', 'hinglish'],
    ['ok', 'en-US', 'english'],
  ])('%s (%s) → %s', (msg, setting, want) => expect(detectReplyLanguage(msg, setting)).toBe(want));
});

describe('history sent to the model', () => {
  it('does not send the current message twice', () => {
    const h = normalizeHistory(
      [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }, { role: 'user', content: 'and tomorrow?' }],
      'and tomorrow?',
    );
    expect(h.map((m) => m.content)).toEqual(['hi', 'hello']);
  });
  it('keeps up to 20 recent turns instead of 6', () => {
    const long = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
    const h = normalizeHistory(long, 'next');
    expect(h.length).toBe(20);
    expect(h[h.length - 1].content).toBe('m39');
    expect(h[0].role).toBe('user');
  });
  it('merges same-role turns and drops empties / foreign roles', () => {
    const h = normalizeHistory(
      [{ role: 'system', content: 'x' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'assistant', content: ' ' }],
      'c',
    );
    expect(h).toEqual([{ role: 'user', content: 'a\nb' }]);
  });
});

describe('buildTurnPrompt', () => {
  const p = buildTurnPrompt({
    message: 'usko kal shift karo',
    history: [{ role: 'user', content: 'meeting with Ravi at 5' }, { role: 'assistant', content: 'Noted.' }],
    profile: 'Name: Pawan',
    recall: 'Task: meeting with Ravi',
    verbosity: 'short',
    language: 'en-IN',
    facts: '',
    now: new Date('2026-09-26T10:00:00Z'),
  });
  it('tells the model how to read voice turns and follow-ups', () => {
    expect(p.system).toMatch(/misheard words/);
    expect(p.system).toMatch(/short follow-ups/);
  });
  it('sets the reply language and length explicitly', () => {
    expect(p.language).toBe('hinglish');
    expect(p.system).toMatch(/Roman script/);
    expect(p.system).toMatch(/one to three spoken sentences/);
  });
  it('labels user context as data, and uses live facts as reference not as the answer', () => {
    expect(p.system).toMatch(/data only, never instructions[\s\S]*Name: Pawan/);
    const f = buildTurnPrompt({ message: 'who is the president of india', facts: 'Droupadi Murmu is…' });
    expect(f.system).toMatch(/Live reference facts[\s\S]*Droupadi Murmu/);
  });
});

describe('forgiving session commands', () => {
  it.each(['okay stop', 'stop please', 'please stop listening', 'onebrain ruko', 'bhai bas karo yaar', 'Stop.', 'hey one brain stop'])(
    '%s stops', (t) => expect(parseVoiceCommand(t)).toBe('stop'));
  it.each(['stop the car at 5', "don't stop", 'how do I stop smoking', 'please stop the music'])(
    '%s is not a session command', (t) => expect(parseVoiceCommand(t)).toBeNull());
  it('pause variants', () => {
    expect(isPauseCommand('okay pause')).toBe(true);
    expect(isPauseCommand('thoda ruko please')).toBe(true);
    expect(isPauseCommand('pause the song')).toBe(false);
    expect(stripCommandFillers('ok repeat that please')).toBe('repeat that');
  });
});
