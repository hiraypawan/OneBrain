import { describe, it, expect } from 'vitest';
import { parseMediaCommand, parseVoiceCommand } from '../lib/commands';
import {
  mapSaavn, mapItunesPodcast, firstEnclosureUrl, mapInvidious,
  pickFirstPlayable, youtubeEmbedUrl,
} from '../lib/media';

describe('parseVoiceCommand', () => {
  it('matches exact controls across languages', () => {
    expect(parseVoiceCommand('stop')).toBe('stop');
    expect(parseVoiceCommand('Ruko!')).toBe('stop');
    expect(parseVoiceCommand('continue')).toBe('continue');
    expect(parseVoiceCommand('new chat')).toBe('new');
    expect(parseVoiceCommand('naya chat')).toBe('new');
    expect(parseVoiceCommand('repeat')).toBe('repeat');
    expect(parseVoiceCommand('phir se bolo')).toBe('repeat');
  });

  it('ignores normal chat (no false triggers)', () => {
    expect(parseVoiceCommand('stop the song')).toBeNull();
    expect(parseVoiceCommand('please continue talking')).toBeNull();
    expect(parseVoiceCommand('what time is it')).toBeNull();
    expect(parseVoiceCommand('remind me at 6pm')).toBeNull();
  });

  it('catches "was not talking to you" undo phrases', () => {
    expect(parseVoiceCommand('not you')).toBe('notyou');
    expect(parseVoiceCommand('ignore that')).toBe('notyou');
    expect(parseVoiceCommand('tumse nahi')).toBe('notyou');
    expect(parseVoiceCommand('galat sun liya')).toBe('notyou');
    expect(parseVoiceCommand('i was not talking to you')).toBe('notyou');
    expect(parseVoiceCommand('not yogurt')).toBeNull();
  });
});

describe('parseMediaCommand', () => {
  it('catches play requests in both orders', () => {
    expect(parseMediaCommand('play kesariya')).toEqual({ action: 'play', query: 'kesariya', kinds: undefined });
    expect(parseMediaCommand('kesariya bajao')).toEqual({ action: 'play', query: 'kesariya', kinds: ['song', 'video'] });
    expect(parseMediaCommand('Hanuman Chalisa sunao')).toEqual({ action: 'play', query: 'hanuman chalisa', kinds: ['song', 'video'] });
  });

  it('strips filler words so the search matches real titles', () => {
    expect(parseMediaCommand('play song saudebaji')).toEqual({ action: 'play', query: 'saudebaji', kinds: ['song', 'video'] });
    expect(parseMediaCommand('play a song name play date')).toEqual({ action: 'play', query: 'play date', kinds: ['song', 'video'] });
  });

  it('hints podcast/video kinds so songs never return podcasts', () => {
    expect(parseMediaCommand('play some podcast on cricket')).toEqual({
      action: 'play', query: 'some podcast on cricket', kinds: ['podcast'],
    });
  });

  it('catches pause / resume / close', () => {
    expect(parseMediaCommand('pause')).toEqual({ action: 'pause' });
    expect(parseMediaCommand('gaana band')).toEqual({ action: 'pause' });
    expect(parseMediaCommand('continue the song')).toEqual({ action: 'resume' });
    expect(parseMediaCommand('stop song')).toEqual({ action: 'close' });
  });

  it('leaves session commands and chitchat alone', () => {
    expect(parseMediaCommand('stop')).toBeNull();
    expect(parseMediaCommand('continue')).toBeNull();
    expect(parseMediaCommand('what time is it')).toBeNull();
    expect(parseMediaCommand('play')).toBeNull();
  });
});

describe('media mappers', () => {
  it('maps saavn songs to best-quality audio', () => {
    const tracks = mapSaavn([{
      name: 'Kesariya', artists: { primary: [{ name: 'Arijit' }] },
      image: [{ url: 'small' }, { url: 'big' }],
      downloadUrl: [{ url: 'low.mp3' }, { url: 'high.mp3' }],
    }, { name: 'NoAudio' }]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].url).toBe('high.mp3');
    expect(tracks[0].artist).toBe('Arijit');
  });

  it('pulls the first podcast enclosure from RSS', () => {
    const rss = '<channel><item><enclosure url="https://x/ep1.mp3" length="1" type="audio"/> </item></channel>';
    expect(firstEnclosureUrl(rss)).toBe('https://x/ep1.mp3');
    expect(firstEnclosureUrl('nope')).toBe('');
    const t = mapItunesPodcast({ trackName: 'Ep', artistName: 'Show' }, 'https://x/ep1.mp3');
    expect(t?.kind).toBe('podcast');
    expect(mapItunesPodcast({}, '')).toBeNull();
  });

  it('maps invidious results to embeds, skipping non-videos', () => {
    const tracks = mapInvidious([
      { type: 'video', videoId: 'abc123', title: 'T', author: 'A' },
      { type: 'playlist', videoId: 'zzz' },
      { type: 'video' },
    ]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].url).toBe(youtubeEmbedUrl('abc123'));
  });

  it('picks the first playable track', () => {
    expect(pickFirstPlayable([])).toBeNull();
    expect(pickFirstPlayable([{ url: '' } as any, { url: 'x' } as any])?.url).toBe('x');
  });
});
