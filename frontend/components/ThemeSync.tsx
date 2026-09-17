'use client';
import { useEffect } from 'react';
import { useAssistantStore } from '@/store/assistant';

/**
 * The theme preference already existed in settings with nothing reading it.
 * This wires it: dark stays the reviewed default, "light" swaps the same
 * tokens on the surfaces that use them. No third palette, no auto-flip.
 */
export function ThemeSync() {
  const theme = useAssistantStore((s) => s.settings.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') root.setAttribute('data-ob-theme', 'light');
    else root.removeAttribute('data-ob-theme');
  }, [theme]);
  return null;
}
