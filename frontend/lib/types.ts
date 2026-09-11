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
  speechAliases?: Record<string,string>;
  proactive?: import('./proactive').ProactivePreferences;
  silentMode?: boolean;
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
