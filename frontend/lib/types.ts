export type AssistantStatus = 'idle' | 'listening' | 'processing' | 'speaking' | 'error' | 'paused';

export interface User {
  id: string;
  email: string;
  displayName?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  meta?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  messages: Message[];
}

export interface UserSettings {
  wakePhrase?: boolean;
  /** Opt-out for the music/podcast player. On by default, never implied. */
  musicEnabled?: boolean;
  speechAliases?: Record<string,string>;
  proactive?: import('./proactive').ProactivePreferences;
  silentMode?: boolean;
  /** Quiet time (ms) after you stop talking before OneBrain answers. 700–4000, default 1600. */
  endOfSpeechMs?: number;
  /** Show half-finished features (Stories, Email drafts, Music) in Your space. */
  labsEnabled?: boolean;
  /**
   * Let you talk over a spoken reply. Only interruption phrases are accepted
   * while it speaks (see lib/barge-in.ts), so the microphone cannot turn the
   * assistant's own voice into a new question. On by default.
   */
  bargeIn?: boolean;
  memoryEnabled: boolean;
  voiceSpeed: number;
  language: string;
  verbosity: 'short' | 'medium' | 'long';
  theme: 'light' | 'dark';
  nightMode: boolean;
  autoDeleteDays: number;
  ownerOnly: boolean;
}

export interface Reminder {
  id: string;
  title: string;
  time: string;
  date?: string;
  active: boolean;
  lastFired?: string;
}
