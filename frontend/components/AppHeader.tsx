"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountLink } from "./AccountLink";
import { Icon, type IconName } from "./ui/Icon";

export type TabId = "today" | "voice" | "track" | "space" | "you";

export const TABS: {
  id: TabId;
  href: string;
  label: string;
  icon: IconName;
  /** Which URL prefixes belong to this tab (redirects + sub-pages included,
   *  so the highlight never lies about where you are). */
  prefixes: string[];
}[] = [
  { id: "today", href: "/", label: "Today", icon: "sun", prefixes: ["/", "/active"] },
  { id: "voice", href: "/voice", label: "Voice", icon: "mic", prefixes: ["/voice"] },
  {
    id: "track",
    href: "/track",
    label: "Track",
    icon: "fitness",
    prefixes: ["/track"],
  },
  {
    id: "space",
    href: "/control",
    label: "Space",
    icon: "space",
    prefixes: ["/control", "/reminders", "/memory", "/conversations", "/utilities", "/vault", "/operations", "/night"],
  },
  {
    id: "you",
    href: "/you",
    label: "You",
    icon: "user",
    prefixes: ["/you", "/settings", "/auth"],
  },
];

export function tabForPath(pathname: string | null): TabId {
  if (!pathname) return "today";
  if (pathname === "/") return "today";
  const hit = TABS.find((tab) =>
    tab.prefixes.some((p) => p !== "/" && (pathname === p || pathname.startsWith(`${p}/`))),
  );
  return hit?.id || "space";
}

export function AppHeader() {
  const pathname = usePathname();
  const active = tabForPath(pathname);
  return (
    <header className="app-header">
      <Link prefetch={false} href="/" className="app-brand" aria-label="OneBrain home">
        <svg
          width="30"
          height="30"
          viewBox="0 0 30 30"
          fill="none"
          aria-hidden="true"
        >
          <path d="M5 7h8v8H5zm12 8h8v8h-8z" fill="currentColor" />
          <path d="M17 7h8M5 23h8" stroke="currentColor" strokeWidth="3" />
        </svg>
        <span>
          onebrain<span className="brand-stop">.</span>
        </span>
      </Link>
      <nav aria-label="Main navigation">
        {TABS.map((tab) => (
          <Link
            prefetch={false}
            key={tab.id}
            href={tab.href}
            aria-current={active === tab.id ? "page" : undefined}
          >
            <Icon name={tab.icon} />
            {tab.label}
          </Link>
        ))}
      </nav>
      <AccountLink />
    </header>
  );
}
