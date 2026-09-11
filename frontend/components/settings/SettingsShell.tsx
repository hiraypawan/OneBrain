"use client";
import { useContext } from "react";
import Link from "next/link";
import { ControlContext } from "../control/ControlContext";
import type { ReactNode } from "react";
import "./settings.css";
export type SettingsSection = "account" | "voice" | "privacy" | "advanced";
const sections = [
  ["account", "Account", "Google sign-in & sessions"],
  ["voice", "Voice & conversation", "Language, replies & invitations"],
  ["privacy", "Memory & privacy", "Storage, retention & exports"],
  ["advanced", "Advanced", "Optional tools & diagnostics"],
] as const;
export function SettingsShell({
  active,
  title,
  description,
  children,
}: {
  active: SettingsSection;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const embedded = useContext(ControlContext);
  if (embedded)
    return (
      <div className="embedded-settings">
        <nav className="settings-subnav" aria-label="Settings sections">
          {sections.map(([key, label]) => (
            <Link
              key={key}
              href={`/control?panel=${key}`}
              aria-current={active === key ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="settings-content">{children}</div>
      </div>
    );
  return (
    <div className="settings-center">
      <header className="settings-heading">
        <a className="settings-back" href="/">
          ← Back to workspace
        </a>
        <span className="eyebrow">YOUR BRAIN. YOUR PREFERENCES.</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <div className="settings-layout">
        <aside>
          <nav aria-label="Settings sections">
            {sections.map(([key, label, detail]) => (
              <a
                key={key}
                href={`/settings/${key}`}
                aria-current={active === key ? "page" : undefined}
              >
                <strong>{label}</strong>
                <small>{detail}</small>
                <span aria-hidden="true">↗</span>
              </a>
            ))}
          </nav>
          <p className="settings-sidebar-note">
            Local preferences stay on this browser. Shared workspaces have
            separate server permissions.
          </p>
        </aside>
        <div className="settings-content">{children}</div>
      </div>
    </div>
  );
}
