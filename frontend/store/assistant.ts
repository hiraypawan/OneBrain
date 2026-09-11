import { create } from 'zustand';
import { DEFAULT_PROACTIVE, normalizeProactive } from '../lib/proactive';
import type { AssistantStatus, Conversation, Message, Reminder, User, UserSettings } from '@/lib/types';
import { db, getRecentMessages, deleteConversationLocal, clearAllLocal } from '@/lib/db';
import type { BgState, BgEvent } from '@/lib/background';
import { pushBgEvent } from '@/lib/background';

interface AssistantState {
  user: User | null;
  isAuthenticated: boolean;
  isActive: boolean;
  currentStatus: AssistantStatus;
  conversations: Conversation[];
  currentConversationId: string | null;
  messages: Message[];
  reminders: Reminder[];
  settings: UserSettings;
  apiKey: string;
  setApiKey: (k: string) => void;
  micNotice: string | null;
  setMicNotice: (m: string | null) => void;
  hydrate: () => Promise<void>;
  voiceBaseline: number | null;
  setVoiceBaseline: (hz: number | null) => void;
  bgState: BgState;
  setBgState: (s: BgState) => void;
  bgLog: BgEvent[];
  logBgEvent: (kind: string, detail?: string) => void;
  sessionStart: number | null;
  markSessionStart: () => void;
  sessionSummary: string | null;
  setSessionSummary: (s: string | null) => void;
  micDeviceId: string | null;
  setMicDeviceId: (id: string | null) => void;
  speakerDeviceId: string | null;
  setSpeakerDeviceId: (id: string | null) => void;
  login: (email: string) => void;
  logout: () => void;
  setIsActive: (v: boolean) => void;
  setCurrentStatus: (s: AssistantStatus) => void;
  addMessage: (role: 'user' | 'assistant', content: string, meta?: string) => void;
  removeLastExchange: () => void;
  deleteConversation: (id: string) => void;
  updateReminder: (id: string, patch: Partial<Reminder>) => void;
  wipeAll: () => Promise<void>;
  loginBackend: (u: { id: string; email: string; displayName?: string }) => void;
  reloadFromDb: () => Promise<void>;
  newConversation: () => void;
  updateSettings: (p: Partial<UserSettings>) => void;
  addReminder: (r: Reminder) => void;
  dismissReminder: (id: string) => void;
}

const defaultSettings: UserSettings = {
  memoryEnabled: true,
  voiceSpeed: 1.0,
  language: 'hinglish',
  verbosity: 'short',
  theme: 'dark',
  nightMode: false,
  autoDeleteDays: 0,
  ownerOnly: false,
  proactive: DEFAULT_PROACTIVE,
  silentMode: false,
};

const SETTINGS_KEY = 'onebrain-settings';

// Persisted so the key + preferences survive page reloads/navigation.
// (Plain <a> nav does full reloads, which wipe in-memory zustand state.)
// NOTE: loading happens in hydrate() (called from an effect after mount),
// never during first render — otherwise server HTML and client HTML differ
// and React throws a hydration error.
function loadPersisted(): {
  apiKey: string;
  settings: UserSettings;
  voiceBaseline: number | null;
  micDeviceId: string | null;
  speakerDeviceId: string | null;
} {
  const fallback = { apiKey: '', settings: defaultSettings, voiceBaseline: null, micDeviceId: null, speakerDeviceId: null };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const dev = localStorage.getItem('onebrain-devices');
    const base = raw ? JSON.parse(raw) : {};
    const dv = dev ? JSON.parse(dev) : {};
    return {
      apiKey: typeof base.apiKey === 'string' ? base.apiKey : '',
      settings: { ...defaultSettings, ...(base.settings || {}), proactive: normalizeProactive(base.settings?.proactive) },
      voiceBaseline: typeof base.voiceBaseline === 'number' ? base.voiceBaseline : null,
      micDeviceId: typeof dv.micDeviceId === 'string' && dv.micDeviceId ? dv.micDeviceId : null,
      speakerDeviceId: typeof dv.speakerDeviceId === 'string' && dv.speakerDeviceId ? dv.speakerDeviceId : null,
    };
  } catch {}
  return fallback;
}

export const useAssistantStore = create<AssistantState>((set) => ({
  user: null,
  isAuthenticated: false,
  isActive: false,
  currentStatus: 'idle',
  conversations: [],
  currentConversationId: null,
  messages: [],
  reminders: [],
  settings: defaultSettings,
  apiKey: '',
  setApiKey: (apiKey) => set({ apiKey }),
  micNotice: null,
  setMicNotice: (micNotice) => set({ micNotice }),
  hydrate: async () => {
    // Cheap prefs first (sync-feeling), then heavy IndexedDB restore.
    set(loadPersisted());
    try {
      const [messages, reminders, convos, userRow, summaryRow] = await Promise.all([
        getRecentMessages(500),
        db.reminders.orderBy('createdAt').toArray(),
        db.conversations.orderBy('createdAt').reverse().toArray(),
        db.kv.get('user'),
        db.kv.get('sessionSummary'),
      ]);
      const mapped = messages.map((m) => ({
        id: `db-${m.id}`,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        meta: m.meta,
      }));
      // Rebuild a rolling summary if the restored history is long.
      let summary: string | null = typeof summaryRow?.value === 'string' ? summaryRow.value : null;
      if (!summary && mapped.length > 20) {
        try {
          const { extractiveSummary } = await import('@/lib/summarize');
          summary = extractiveSummary(mapped.slice(0, -10));
        } catch {}
      }
      set({
        messages: mapped,
        reminders: reminders.map((r) => ({
          id: r.id, title: r.title, time: r.time, date: r.date,
          active: r.active, lastFired: r.lastFired,
        })),
        conversations: convos.map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, messages: [] })),
        user: userRow?.value || null,
        isAuthenticated: false,
        currentConversationId: convos[0]?.id || `${Date.now()}`,
        sessionSummary: summary,
      });
    } catch {}
  },
  voiceBaseline: null,
  setVoiceBaseline: (voiceBaseline) => set({ voiceBaseline }),
  bgState: 'foreground',
  setBgState: (bgState) => set({ bgState }),
  bgLog: [],
  logBgEvent: (kind, detail) => {
    const s = useAssistantStore.getState();
    const base = s.sessionStart || Date.now();
    set({ bgLog: pushBgEvent(s.bgLog, { elapsed: Date.now() - base, kind, detail }) });
  },
  sessionStart: null,
  markSessionStart: () => set({ sessionStart: Date.now(), bgLog: [] }),
  sessionSummary: null,
  setSessionSummary: (sessionSummary) => {
    set({ sessionSummary });
    if (useAssistantStore.getState().settings.memoryEnabled) db.kv.put({ key: 'sessionSummary', value: sessionSummary }).catch(() => {});
  },
  micDeviceId: null,
  setMicDeviceId: (micDeviceId) => {
    set({ micDeviceId });
    try {
      localStorage.setItem('onebrain-devices', JSON.stringify({ micDeviceId, speakerDeviceId: useAssistantStore.getState().speakerDeviceId }));
    } catch {}
  },
  speakerDeviceId: null,
  setSpeakerDeviceId: (speakerDeviceId) => {
    set({ speakerDeviceId });
    try {
      localStorage.setItem('onebrain-devices', JSON.stringify({ micDeviceId: useAssistantStore.getState().micDeviceId, speakerDeviceId }));
    } catch {}
  },
  login: () => { throw new Error('Password/local account sign-in is retired. Use Google.'); },
  logout: () => {
    set({ user: null, isAuthenticated: false, isActive: false, currentStatus: 'idle' });
    db.kv.delete('user').catch(() => {});
  },
  setIsActive: (isActive) => set({ isActive }),
  setCurrentStatus: (currentStatus) => set({ currentStatus }),
  addMessage: (role, content, meta) => {
    const st = useAssistantStore.getState();
    const msg: Message = {
      id: `${Date.now()}-${Math.random()}`, role, content, createdAt: Date.now(), meta,
    };
    const cid = st.currentConversationId || `${Date.now()}`;
    set((s) => {
      let convos = s.conversations;
      const existing = convos.find((c) => c.id === cid);
      if (!existing) {
        convos = [
          {
            id: cid,
            title: role === 'user' && content.trim() ? content.slice(0, 50) : 'Conversation',
            createdAt: Date.now(), messages: [],
          },
          ...convos,
        ];
      } else if (existing.title === 'Conversation' && role === 'user' && content.trim()) {
        convos = convos.map((c) => (c.id === cid ? { ...c, title: content.slice(0, 50) } : c));
      }
      return { messages: [...s.messages, msg], conversations: convos, currentConversationId: cid };
    });
    // Memory OFF = session only, nothing written to disk.
    if (!st.settings.memoryEnabled) return;
    const after = useAssistantStore.getState();
    const conv = after.conversations.find((c) => c.id === cid);
    db.conversations
      .put({ id: cid, title: conv?.title || 'Conversation', createdAt: conv?.createdAt || Date.now() })
      .catch(() => {});
    db.messages
      .add({ uuid: msg.id, conversationId: cid, role, content, meta, createdAt: msg.createdAt })
      .catch(() => {});
  },
  // "Wasn't talking to you" undo: drop the last user+assistant pair,
  // from state AND disk, so a stray pickup vanishes completely.
  removeLastExchange: () => {
    const msgs = useAssistantStore.getState().messages;
    if (!msgs.length) return;
    const dropIds = new Set<string>();
    for (let i = msgs.length - 1; i >= 0; i--) {
      dropIds.add(msgs[i].id);
      if (msgs[i].role === 'user') break;
    }
    set((s) => ({ messages: s.messages.filter((m) => !dropIds.has(m.id)) }));
    const uuids = [...dropIds].map((id) => id.replace(/^db-/, ''));
    db.messages.where('uuid').anyOf(uuids).delete().catch(() => {});
  },
  deleteConversation: (id) => {
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      messages: s.currentConversationId === id ? [] : s.messages,
      currentConversationId: s.currentConversationId === id ? `${Date.now()}` : s.currentConversationId,
    }));
    deleteConversationLocal(id).catch(() => {});
  },
  newConversation: () => {
    const id = `${Date.now()}`;
    set((s) => ({
      messages: [],
      currentConversationId: id,
      conversations: [{ id, title: 'Conversation', createdAt: Date.now(), messages: [] }, ...s.conversations],
    }));
    try {
      const st = useAssistantStore.getState();
      if (st.settings.memoryEnabled) {
        db.conversations.put({ id, title: 'Conversation', createdAt: Date.now() }).catch(() => {});
      }
    } catch {}
  },
  updateSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
  addReminder: (r) => {
    set((s) => ({ reminders: [...s.reminders, r] }));
    db.reminders.put({ ...r, createdAt: Date.now() }).catch(() => {});
    // Asking now (on tap) is the only reliable moment for permission.
    try {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    } catch {}
  },
  dismissReminder: (id) => {
    set((s) => ({ reminders: s.reminders.filter((r) => r.id !== id) }));
    db.reminders.delete(id).catch(() => {});
  },
  updateReminder: (id, patch) => {
    set((s) => ({ reminders: s.reminders.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
    db.reminders
      .get(id)
      .then((row) => {
        if (row) db.reminders.put({ ...row, ...patch }).catch(() => {});
      })
      .catch(() => {});
  },
  wipeAll: async () => {
    try {
      await clearAllLocal();
    } catch {}
    try {
      localStorage.removeItem('onebrain-settings');
    } catch {}
    try {
      localStorage.removeItem('onebrain_token');
    } catch {}
    try { const { useWorkspaceStore } = await import('./workspace'); await useWorkspaceStore.getState().load('device'); } catch {}
    set({
      settings: defaultSettings, sessionSummary: null,
      messages: [], conversations: [], reminders: [], user: null,
      isAuthenticated: false, isActive: false, currentStatus: 'idle',
      currentConversationId: `${Date.now()}`, apiKey: '', voiceBaseline: null, micNotice: null,
      bgLog: [], sessionStart: null,
    });
  },
  loginBackend: (u) => {
    const user = { id: u.id, email: u.email, displayName: u.displayName || u.email.split('@')[0] };
    set({ user, isAuthenticated: true });
    db.kv.put({ key: 'user', value: user }).catch(() => {});
  },
  // Refresh lists from disk without touching the live session (post-sync).
  reloadFromDb: async () => {
    try {
      const [messages, convos] = await Promise.all([
        getRecentMessages(500),
        db.conversations.orderBy('createdAt').reverse().toArray(),
      ]);
      set({
        messages: messages.map((m) => ({
          id: `db-${m.id}`, role: m.role, content: m.content, createdAt: m.createdAt, meta: m.meta,
        })),
        conversations: convos.map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, messages: [] })),
      });
    } catch {}
  },
}));

// Save key + settings on every change (client only).
if (typeof window !== 'undefined') {
  useAssistantStore.subscribe((s) => {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ apiKey: s.apiKey, settings: s.settings, voiceBaseline: s.voiceBaseline })
      );
    } catch {}
  });
}
