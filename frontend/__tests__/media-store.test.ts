import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaStore } from '../store/media';
import { useAssistantStore } from '../store/assistant';
import { useFeaturesStore } from '../store/features';
import type { MediaTrack } from '../lib/media';

const song = (id: string, url = `https://cdn.example.test/${id}.mp4`): MediaTrack => ({
  kind: 'song',
  title: `Song ${id}`,
  artist: 'Artist',
  image: '',
  url,
  source: 'saavn',
});

function stubSearch(tracks: MediaTrack[], opts: { status?: number; throw?: boolean } = {}) {
  return vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (opts.throw) throw new Error('network down');
      return new Response(JSON.stringify({ tracks, youtubeSearchUrl: 'https://www.youtube.com/results?search_query=x' }), {
        status: opts.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

const lastAssistantMessage = () => {
  const messages = useAssistantStore.getState().messages;
  return messages[messages.length - 1]?.content || '';
};

beforeEach(async () => {
  vi.unstubAllGlobals();
  useAssistantStore.setState({ messages: [], isActive: false, isAuthenticated: false });
  useFeaturesStore.setState({ speaker: null });
  useMediaStore.getState().close();
  useMediaStore.setState({ playerMounted: true });
});

describe('media player reachability', () => {
  it('refuses to search into a void when no player is mounted, and says so', async () => {
    useMediaStore.setState({ playerMounted: false });
    stubSearch([song('a')]);
    await useMediaStore.getState().request('kesariya');
    const state = useMediaStore.getState();
    expect(state.status).toBe('error');
    expect(state.notice).toMatch(/not mounted/i);
    expect(state.current).toBeNull();
    expect(lastAssistantMessage()).toMatch(/not available/i);
  });

  it('reports a mounted player so the voice path can trust it', () => {
    expect(useMediaStore.getState().playerMounted).toBe(true);
    useMediaStore.getState().setPlayerMounted(false);
    expect(useMediaStore.getState().playerMounted).toBe(false);
  });
});

describe('searching and playing', () => {
  it('loads the first playable track and names its source honestly', async () => {
    stubSearch([song('a'), song('b')]);
    await useMediaStore.getState().request('kesariya', ['song']);
    const state = useMediaStore.getState();
    expect(state.status).toBe('playing');
    expect(state.current?.title).toBe('Song a');
    expect(state.list).toHaveLength(2);
    expect(lastAssistantMessage()).toMatch(/Playing: Song a/);
    expect(lastAssistantMessage()).toMatch(/JioSaavn/);
  });

  it('skips tracks without a playable URL', async () => {
    stubSearch([{ ...song('a'), url: '' }, song('b')]);
    await useMediaStore.getState().request('kesariya');
    expect(useMediaStore.getState().current?.title).toBe('Song b');
  });

  it('never claims playback when nothing came back, and offers the YouTube hand-off', async () => {
    stubSearch([]);
    await useMediaStore.getState().request('obscure track');
    const state = useMediaStore.getState();
    expect(state.status).toBe('empty');
    expect(state.current).toBeNull();
    expect(state.notice).toMatch(/no free source returned a playable link/i);
    expect(state.youtubeSearchUrl).toContain('youtube.com/results');
    expect(lastAssistantMessage()).toMatch(/Kuch nahi mila/);
  });

  it('survives a dead network without inventing a result', async () => {
    stubSearch([], { throw: true });
    await useMediaStore.getState().request('kesariya');
    expect(useMediaStore.getState().status).toBe('empty');
    expect(useMediaStore.getState().notice).toMatch(/could not reach the network|timed out/i);
  });

  it('drops a stale answer when a newer request already won', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        if (body.query === 'slow') await gate;
        return new Response(JSON.stringify({ tracks: [song(body.query)] }), { headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const slow = useMediaStore.getState().request('slow');
    await useMediaStore.getState().request('fast');
    expect(useMediaStore.getState().current?.title).toBe('Song fast');
    release!();
    await slow;
    // The older answer must not overwrite the newer one.
    expect(useMediaStore.getState().current?.title).toBe('Song fast');
  });
});

describe('queue, refusal and controls', () => {
  it('advances to the next playable result when a stream is refused', async () => {
    stubSearch([song('a'), song('b'), song('c')]);
    await useMediaStore.getState().request('kesariya');
    useMediaStore.getState().refuseCurrent(4);
    const state = useMediaStore.getState();
    expect(state.current?.title).toBe('Song b');
    expect(state.refused).toBe(1);
    expect(state.notice).toMatch(/refused the stream/i);
  });

  it('stops trying after the queue is exhausted and speaks the honest outcome', async () => {
    stubSearch([song('a'), song('b')]);
    await useMediaStore.getState().request('kesariya');
    useMediaStore.getState().refuseCurrent(2);
    useMediaStore.getState().refuseCurrent(2);
    const state = useMediaStore.getState();
    expect(state.status).toBe('error');
    expect(state.notice).toMatch(/No other result played/i);
    expect(lastAssistantMessage()).toMatch(/would not stream/i);
  });

  it('never loops forever on a long list of dead streams', async () => {
    stubSearch([song('a'), song('b'), song('c'), song('d'), song('e'), song('f')]);
    await useMediaStore.getState().request('kesariya');
    for (let i = 0; i < 6; i++) useMediaStore.getState().refuseCurrent(4);
    expect(useMediaStore.getState().status).toBe('error');
    expect(useMediaStore.getState().refused).toBeLessThanOrEqual(4);
  });

  it('pauses, resumes, steps and closes', async () => {
    stubSearch([song('a'), song('b')]);
    await useMediaStore.getState().request('kesariya');
    const store = useMediaStore.getState();
    store.control('pause');
    expect(useMediaStore.getState().status).toBe('paused');
    store.control('resume');
    expect(useMediaStore.getState().status).toBe('playing');
    store.control('next');
    expect(useMediaStore.getState().current?.title).toBe('Song b');
    store.control('next');
    expect(useMediaStore.getState().notice).toMatch(/last playable result/i);
    store.control('close');
    const closed = useMediaStore.getState();
    expect(closed.current).toBeNull();
    expect(closed.list).toEqual([]);
    expect(closed.status).toBe('idle');
    expect(closed.query).toBe('');
  });

  it('explains that nothing is loaded when a control arrives with an empty player', () => {
    useMediaStore.getState().control('pause');
    expect(useMediaStore.getState().notice).toMatch(/Nothing is loaded/i);
  });

  it('reports a blocked autoplay instead of sitting at 0:00 silently', () => {
    useMediaStore.getState().reportPlayback('blocked');
    expect(useMediaStore.getState().status).toBe('blocked');
    expect(useMediaStore.getState().notice).toMatch(/blocked automatic playback/i);
  });
});

describe('spoken feedback', () => {
  it('uses the shared speaker when one is registered and never throws without one', async () => {
    const spoken: string[] = [];
    useFeaturesStore.setState({ speaker: async (text: string) => void spoken.push(text) });
    stubSearch([]);
    await useMediaStore.getState().request('missing song');
    expect(spoken.join(' ')).toMatch(/Kuch nahi mila/);
    useFeaturesStore.setState({ speaker: null });
    await expect(useMediaStore.getState().request('missing song')).resolves.toBeUndefined();
  });
});
