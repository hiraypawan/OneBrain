"use client";
import Link from "next/link";
import { AccountLink } from "./AccountLink";
import { Icon } from "./ui/Icon";
export function AppHeader({ active }: { active: "today" | "space" }) {
  return (
    <header className="app-header">
      <Link href="/" className="app-brand" aria-label="OneBrain home">
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
        <a href="/" aria-current={active === "today" ? "page" : undefined}>
          <Icon name="sun" />
          Today
        </a>
        <a
          href="/control"
          aria-current={active === "space" ? "page" : undefined}
        >
          <Icon name="space" />
          Your space
        </a>
      </nav>
      <AccountLink />
    </header>
  );
}
