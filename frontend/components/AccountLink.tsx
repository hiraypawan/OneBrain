"use client";
import { useAssistantStore } from "@/store/assistant";
export function AccountLink() {
  const authenticated = useAssistantStore((s) => s.isAuthenticated);
  return (
    <a
      className="header-account-link"
      href={authenticated ? "/control?panel=account" : "/auth/login"}
      aria-label={authenticated ? "Account settings" : "Sign in with Google"}
    >
      <span aria-hidden="true">{authenticated ? "◉" : "↗"}</span>
      {authenticated ? "Account" : "Sign in"}
    </a>
  );
}
