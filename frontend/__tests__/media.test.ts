import { describe, it, expect } from 'vitest';
import { parseMediaCommand, parseVoiceCommand } from '../lib/commands';
import {
  mapSaavn, mapItunesPodcast, firstEnclosureUrl, mapInvidious,
  pickFirstPlayable, youtubeEmbedUrl, nextPlayableIndex, describeMediaError,
  mediaSourceLabel, searchMedia, youtubeSearchUrlFor, AUTOPLAY_BLOCKED_NOTICE,
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

describe('queue and failure copy', () => {
  it('finds the next playable result, or says there is none', () => {
    const list = [{ url: 'a' }, { url: '' }, { url: 'b' }] as any[];
    expect(nextPlayableIndex(list, 0)).toBe(2);
    expect(nextPlayableIndex(list, 2)).toBe(-1);
    expect(nextPlayableIndex([], 0)).toBe(-1);
  });

  it('describes every media error code honestly', () => {
    expect(describeMediaError(2)).toMatch(/stopped mid-play/i);
    expect(describeMediaError(3)).toMatch(/could not be decoded/i);
    expect(describeMediaError(4)).toMatch(/refused the stream/i);
    expect(describeMediaError(undefined)).toMatch(/did not serve the audio/i);
    expect(AUTOPLAY_BLOCKED_NOTICE).toMatch(/Tap play once/i);
  });

  it('names sources in plain language', () => {
    expect(mediaSourceLabel('saavn')).toMatch(/JioSaavn/);
    expect(mediaSourceLabel('itunes')).toMatch(/Podcast feed/);
    expect(mediaSourceLabel('invidious')).toMatch(/Invidious/);
    expect(mediaSourceLabel('mystery')).toMatch(/Unknown/);
  });
});

describe('media command: next', () => {
  it('recognises queue stepping without stealing session commands', () => {
    expect(parseMediaCommand('next song')).toEqual({ action: 'next' });
    expect(parseMediaCommand('agli gaana')).toEqual({ action: 'next' });
    expect(parseMediaCommand('next episode')).toEqual({ action: 'next' });
    expect(parseMediaCommand('next')).toEqual({ action: 'next' });
    expect(parseMediaCommand('what is next on my list')).toBeNull();
    // Session commands still win: a bare "continue" resumes listening, and
    // music needs "continue the song" so the two never collide.
    expect(parseVoiceCommand('continue')).toBe('continue');
    expect(parseMediaCommand('continue')).toBeNull();
    expect(parseMediaCommand('continue the song')).toEqual({ action: 'resume' });
  });
});

describe('searchMedia transport', () => {
  const ok = (body: unknown) => async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

  it('prefers the cloud worker and reports which endpoint answered', async () => {
    const calls: string[] = [];
    const result = await searchMedia('kesariya', ['song'], {
      apiBase: 'https://api.example.test/',
      fetchImpl: (async (url: string) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ tracks: [{ kind: 'song', title: 'T', url: 'u', source: 'saavn' }] }), { status: 200 });
      }) as any,
    });
    expect(calls).toEqual(['https://api.example.test/api/media']);
    expect(result.via).toBe('worker');
    expect(result.tracks).toHaveLength(1);
  });

  it('falls back to the local route when the worker answers without tracks', async () => {
    const calls: string[] = [];
    const result = await searchMedia('kesariya', undefined, {
      apiBase: 'https://api.example.test',
      fetchImpl: (async (url: string) => {
        calls.push(String(url));
        if (String(url).startsWith('https://api.example.test')) {
          return new Response(JSON.stringify({ tracks: [] }), { status: 500 });
        }
        return new Response(JSON.stringify({ tracks: [{ kind: 'song', title: 'Local', url: 'u', source: 'saavn' }] }), { status: 200 });
      }) as any,
    });
    expect(calls).toEqual(['https://api.example.test/api/media', '/api/media']);
    expect(result.via).toBe('local');
  });

  it('never throws: a dead network yields an honest failure plus a hand-off URL', async () => {
    const result = await searchMedia('kesariya', undefined, {
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as any,
    });
    expect(result.tracks).toEqual([]);
    expect(result.via).toBe('none');
    expect(result.failure).toMatch(/could not reach the network/);
    expect(result.youtubeSearchUrl).toBe(youtubeSearchUrlFor('kesariya'));
  });

  it('drops tracks without a URL and refuses an empty query', async () => {
    const result = await searchMedia('  ', undefined, { fetchImpl: ok({ tracks: [{ url: 'x' }] }) as any });
    expect(result.tracks).toEqual([]);
    expect(result.failure).toMatch(/Say what to play/);
    const filtered = await searchMedia('x', undefined, {
      fetchImpl: ok({ tracks: [{ url: '' }, { url: 'good' }] }) as any,
    });
    expect(filtered.tracks.map((t) => t.url)).toEqual(['good']);
  });
});
