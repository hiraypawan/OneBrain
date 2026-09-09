'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { GooeyNav } from './rare/gooey-nav';

const TABS = [
  { href: '/active', label: 'Active', icon: '🎤' },
  { href: '/conversations', label: 'History', icon: '💬' },
  { href: '/memory', label: 'Memory', icon: '🧠' },
  { href: '/reminders', label: 'Reminders', icon: '🔔' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
];

export function MainNav() {
  const path = usePathname() || '/';
  const active = (href: string) => path === href || path.startsWith(href + '/');

  return (
    <>
      {/* Desktop / top bar */}
      <nav className="hidden md:flex gap-5 px-5 py-3 text-sm text-gray-300 border-b border-gray-800 sticky top-0 bg-black/90 z-10 items-center">
        <Link href="/" className="font-bold text-white text-base">🧠 OneBrain</Link>
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={active(t.href) ? 'text-white font-bold' : 'hover:text-white'}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {/* Mobile: compact top brand + gooey thumb tab bar */}
      <nav className="md:hidden flex justify-between items-center px-4 py-3 border-b border-gray-800 sticky top-0 bg-black/90 z-10">
        <Link href="/" className="font-bold text-white">🧠 OneBrain</Link>
        <Link href="/night" className="text-xs text-gray-500">🌙</Link>
      </nav>
      <div
        className="md:hidden fixed bottom-0 left-0 right-0 z-10 flex justify-center pointer-events-none"
        style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
      >
        <div className="pointer-events-auto max-w-full overflow-x-auto px-2">
          <GooeyNav
            items={TABS.map((t) => ({ label: t.label, href: t.href, icon: <span>{t.icon}</span> }))}
            size="xs"
            activeColor="#16A34A"
            activeLabelColor="#ffffff"
          />
        </div>
      </div>
    </>
  );
}
