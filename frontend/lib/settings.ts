import type { UserSettings } from './types';
import { DEFAULT_PROACTIVE, normalizeProactive } from './proactive';

export const defaultSettings: UserSettings = {
  memoryEnabled: true, voiceSpeed: 1, language: 'hinglish', verbosity: 'short',
  theme: 'dark', nightMode: false, autoDeleteDays: 0, ownerOnly: false,
  proactive: DEFAULT_PROACTIVE, silentMode: false,
};

/** Storage/imports are untrusted. In particular, strings must never grant consent. */
export function normalizeSettings(value: unknown): UserSettings {
  const p: Record<string, unknown> = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const finite = (key: string, fallback: number, min: number, max: number) =>
    typeof p[key] === 'number' && Number.isFinite(p[key]) ? Math.min(max, Math.max(min, p[key])) : fallback;
  const aliases = p.speechAliases && typeof p.speechAliases === 'object' && !Array.isArray(p.speechAliases)
    ? Object.fromEntries(Object.entries(p.speechAliases).filter(([k, v]) =>
      !['__proto__', 'prototype', 'constructor'].includes(k) && k.length > 0 && k.length <= 80 && typeof v === 'string' && v.length <= 80).slice(0, 50)) : {};
  return {
    memoryEnabled: p.memoryEnabled === undefined ? true : p.memoryEnabled === true,
    voiceSpeed: finite('voiceSpeed', 1, 0.5, 2),
    language: typeof p.language === 'string' && ['en-IN', 'en-US', 'hinglish', 'hi-IN', 'marathi', 'es-ES'].includes(p.language) ? p.language : 'hinglish',
    verbosity: p.verbosity === 'medium' || p.verbosity === 'long' ? p.verbosity : 'short',
    theme: p.theme === 'light' ? 'light' : 'dark', nightMode: p.nightMode === true,
    autoDeleteDays: Math.floor(finite('autoDeleteDays', 0, 0, 3650)), ownerOnly: p.ownerOnly === true,
    wakePhrase: p.wakePhrase === true, silentMode: p.silentMode === true,
    proactive: normalizeProactive(p.proactive), speechAliases: aliases,
  };
}
