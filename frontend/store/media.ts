import { create } from 'zustand';
import { useAssistantStore } from './assistant';
import { useFeaturesStore } from './features';
import {
  AUTOPLAY_BLOCKED_NOTICE,
  describeMediaError,
  mediaSourceLabel,
  nextPlayableIndex,
  pickFirstPlayable,
  searchMedia,
  youtubeSearchUrlFor,
  type MediaKind,
  type MediaTrack,
} from '@/lib/media';

/**
 * Music, podcasts and video playback state.
 *
 * This lives in a store (not in window events) for three reasons: the state is
 * visible in tests, several surfaces can render it (sticky mini-player, Your
 * space → Music, voice feedback), and nothing can be dispatched into a void —
 * `playerMounted` makes "the player is not on screen" an explicit, reportable
 * condition instead of a silent no-op.
 */
export type MediaStatus =
  | 'idle'
  | 'searching'
  | 'playing'
  | 'paused'
  | 'blocked'
  | 'error'
  | 'empty';

export type MediaControlAction = 'pause' | 'resume' | 'close' | 'next';

export interface MediaState {
  /** Set by <MediaPlayer /> on mount; used to report an unreachable player. */
  playerMounted: boolean;
  query: string;
  kinds?: MediaKind[];
  list: MediaTrack[];
  current: MediaTrack | null;
  youtubeSearchUrl: string;
  status: MediaStatus;
  notice: string | null;
  /** Tracks tried and refused in this request, so we never loop forever. */
  refused: number;
  expanded: boolean;

  setPlayerMounted: (mounted: boolean) => void;
  setExpanded: (expanded: boolean) => void;
  request: (query: string, kinds?: MediaKind[]) => Promise<void>;
  select: (track: MediaTrack) => void;
  control: (action: MediaControlAction) => void;
  /** Called by the <audio> element: real playback state beats our guesses. */
  reportPlayback: (status: MediaStatus, notice?: string | null) => void;
  /** Current track failed; try the next playable one or say so honestly. */
  refuseCurrent: (code?: number) => void;
  close: () => void;
}

const speak = (text: string) => {
  try {
    const fn = useFeaturesStore.getState().speaker;
    if (fn) void fn(text);
  } catch {
    /* Speech is a bonus; the visible notice is the contract. */
  }
};

const say = (text: string, spoken = true) => {
  try {
    useAssistantStore.getState().addMessage('assistant', text);
  } catch {
    /* The store may be unavailable during teardown; the UI still shows it. */
  }
  if (spoken) speak(text);
};

export const useMediaStore = create<MediaState>((set, get) => ({
  playerMounted: false,
  query: '',
  list: [],
  current: null,
  youtubeSearchUrl: '',
  status: 'idle',
  notice: null,
  refused: 0,
  expanded: false,

  setPlayerMounted: (playerMounted) => set({ playerMounted }),
  setExpanded: (expanded) => set({ expanded }),

  request: async (query, kinds) => {
    const term = String(query || '').trim();
    if (!term) return;
    if (!get().playerMounted) {
      // The one failure mode that used to be invisible: no player on screen.
      set({ status: 'error', notice: 'The music player is not mounted on this screen.' });
      say('The music player is not available right now. Reload the app and try again.', true);
      return;
    }

    const assistant = useAssistantStore.getState();
    assistant.setCurrentStatus('processing');
    set({ query: term, kinds, status: 'searching', notice: null, list: [], current: null, refused: 0 });

    const apiBase = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
    const result = await searchMedia(term, kinds, { apiBase });

    // A newer request won; drop this stale answer.
    if (get().query !== term) return;

    const first = pickFirstPlayable(result.tracks);
    set({
      list: result.tracks,
      youtubeSearchUrl: result.youtubeSearchUrl || youtubeSearchUrlFor(term),
      status: first ? 'playing' : 'empty',
      current: first,
      notice: first ? null : result.failure
        ? `No free source could play “${term}” (${result.failure}).`
        : `Nothing playable came back for “${term}”.`,
    });

    if (useAssistantStore.getState().isActive) {
      useAssistantStore.getState().setCurrentStatus('listening');
    }

    if (first) {
      say(`Playing: ${first.title}${first.artist ? ` — ${first.artist}` : ''} (${mediaSourceLabel(first.source)})`, false);
      return;
    }
    const spoken = `Kuch nahi mila "${term}" ke liye. Free sources busy hain — YouTube link player mein hai.`;
    say(spoken, true);
  },

  select: (track) => {
    if (!track?.url) return;
    set({ current: track, status: track.kind === 'video' ? 'playing' : 'playing', notice: null });
  },

  control: (action) => {
    const state = get();
    if (action === 'close') {
      state.close();
      return;
    }
    if (!state.current) {
      set({ notice: 'Nothing is loaded to control yet. Say “play <song name>”.' });
      return;
    }
    if (action === 'pause') {
      set({ status: 'paused', notice: null });
      return;
    }
    if (action === 'resume') {
      // The element decides: if the browser still blocks it, onPlay never
      // fires and reportPlayback('blocked') replaces this optimism.
      set({ status: 'playing', notice: null });
      return;
    }
    if (action === 'next') {
      const index = state.list.findIndex((t) => t.url === state.current?.url);
      const next = nextPlayableIndex(state.list, index);
      if (next < 0) {
        set({ notice: 'That was the last playable result. Say “play <song name>” for more.' });
        return;
      }
      set({ current: state.list[next], status: 'playing', notice: null });
    }
  },

  reportPlayback: (status, notice = null) => {
    if (status === 'blocked') {
      set({ status, notice: notice ?? AUTOPLAY_BLOCKED_NOTICE });
      return;
    }
    set({ status, notice });
  },

  refuseCurrent: (code) => {
    const state = get();
    // Already given up: ignore further error events from the same element
    // instead of repeating the announcement on every retry/stall event.
    if (state.status === 'error') return;
    const reason = describeMediaError(code);
    const index = state.list.findIndex((t) => t.url === state.current?.url);
    const next = nextPlayableIndex(state.list, index);
    const refused = state.refused + 1;
    if (next >= 0 && refused < 4) {
      set({ current: state.list[next], refused, status: 'playing', notice: `${reason} Trying the next result.` });
      return;
    }
    set({
      status: 'error',
      refused,
      notice: `${reason} No other result played, so nothing is streaming.`,
      youtubeSearchUrl: state.youtubeSearchUrl || youtubeSearchUrlFor(state.query),
    });
    say(
      `That source would not stream “${state.query}”. ${reason} A YouTube search link is in the player.`,
      true,
    );
  },

  close: () => {
    set({
      current: null,
      list: [],
      status: 'idle',
      notice: null,
      query: '',
      youtubeSearchUrl: '',
      refused: 0,
      expanded: false,
    });
  },
}));
