import type { Config } from 'tailwindcss';

const config: Config = {
  // Forced dark: RareUI components ship light+dark variants; our app is
  // always dark (OLED voice-first theme), so lock the dark branch on.
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './hooks/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};

export default config;
