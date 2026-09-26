"use client";
import { usePathname } from "next/navigation";
import { useAssistantStore } from "@/store/assistant";
import { loginHref } from "@/lib/auth-return";
export function AccountLink() {
  const authenticated = useAssistantStore((s) => s.isAuthenticated);
  const path = usePathname();
  return (
    <a
      className="header-account-link"
      href={authenticated ? "/control?panel=account" : loginHref(path)}
      aria-label={authenticated ? "Account settings" : "Sign in with Google"}
    >
      <span aria-hidden="true">{authenticated ? "◉" : "↗"}</span>
      {authenticated ? "Account" : "Sign in"}
    </a>
  );
}
