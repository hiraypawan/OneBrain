"use client";
import { useAssistantStore } from "@/store/assistant";
import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ControlContext } from "./ControlContext";
import { CATALOG, EXTRA_PANELS } from "./catalog";
import { Icon } from "../ui/Icon";
const loading = () => (
  <div className="panel-loading" role="status">
    <span />
    <span />
    <span />
    Opening your space…
  </div>
);
const PANELS: Record<string, React.ComponentType> = {
  account: dynamic(
    () => import("../settings/AccountSettings").then((m) => m.AccountSettings),
    { loading },
  ),
  voice: dynamic(() => import("./VoiceSettings"), { loading }),
  privacy: dynamic(() => import("./PrivacySettings"), { loading }),
  advanced: dynamic(() => import("./AdvancedSettings"), { loading }),
  "data-export": dynamic(() => import("./DataSettings"), { loading }),
  debug: dynamic(() => import("./Diagnostics"), { loading }),
  shared: dynamic(() => import("./SharedSpace"), { loading }),
  tools: dynamic(() => import("./Utilities"), { loading }),
  vault: dynamic(() => import("./Vault"), { loading }),
  reminders: dynamic(() => import("./Reminders"), { loading }),
  memory: dynamic(() => import("./Memory"), { loading }),
  "memory-search": dynamic(() => import("./MemorySearch"), { loading }),
  timeline: dynamic(() => import("./Timeline"), { loading }),
  conversations: dynamic(() => import("./Conversations"), { loading }),
  conversation: dynamic(() => import("./Conversation"), { loading }),
};
export function ControlCenter() {
  const storageNotice = useAssistantStore(s => s.storageNotice);
  const params = useSearchParams(),
    panel = params.get("panel") || "",
    entry =
      CATALOG.find((e) => e.id === panel) ||
      (Object.hasOwn(EXTRA_PANELS, panel) ? EXTRA_PANELS[panel] : undefined),
    Panel = Object.hasOwn(PANELS, panel) ? PANELS[panel] : undefined;
  const [query, setQuery] = useState("");
  const matches = CATALOG.filter((e) =>
    `${e.title} ${e.description} ${e.keywords || ""}`
      .toLowerCase()
      .includes(query.toLowerCase().trim()),
  );
  return (
    <ControlContext.Provider value={true}>
      <div className="control-center">
        {storageNotice && <p role="alert" className="workspace-notice">{storageNotice}</p>}
        {Panel && entry ? (
          <>
            <div className="control-breadcrumb">
              <Link prefetch={false} href="/control">
                <Icon name="back" />
                Your space
              </Link>
              <span>/</span>
              <span>{entry.title}</span>
            </div>
            <header className="control-heading">
              <h1>{entry.title}</h1>
              <p>{entry.description}</p>
            </header>
            <div className={`control-panel panel-${panel}`} key={panel}>
              <Panel />
            </div>
          </>
        ) : (
          <>
            <header className="control-heading control-home-heading">
              <span className="overline">TOOLS, MEMORIES & PREFERENCES</span>
              <h1>Your space</h1>
              <p>
                Your everyday flow is on Today. The rest lives here, ready when
                you need it.
              </p>
            </header>
            {panel && (
              <p role="status" className="workspace-notice">
                That section wasn’t found. Choose a section below.
              </p>
            )}
            <label className="control-search">
              <Icon name="search" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a tool, setting or connection"
                aria-label="Find a tool or setting"
              />
              {query && (
                <button
                  aria-label="Clear tool search"
                  onClick={() => setQuery("")}
                >
                  <Icon name="close" />
                </button>
              )}
            </label>
            <div className="control-groups">
              {["Keep track", "Do more", "Make it yours"].map((group) => {
                const rows = matches.filter((e) => e.group === group);
                return rows.length ? (
                  <section key={group}>
                    <h2>{group}</h2>
                    {rows.map((e) => (
                      <Link prefetch={false}
                        className="control-entry"
                        href={`/control?panel=${e.id}`}
                        key={e.id}
                      >
                        <span className="entry-icon">
                          <Icon name={e.icon} />
                        </span>
                        <span>
                          <strong>{e.title}</strong>
                          <small>{e.description}</small>
                        </span>
                        <Icon name="arrow" />
                      </Link>
                    ))}
                  </section>
                ) : null;
              })}
            </div>
            {!matches.length && (
              <div className="control-empty">
                <h2>No matching tools</h2>
                <p>Try “voice”, “reminders”, “Google” or “export”.</p>
                <button onClick={() => setQuery("")}>Show all tools</button>
              </div>
            )}
            <div className="space-note">
              <Icon name="lock" />
              <p>
                Your local records stay on this browser. Connected work uses a
                separate, signed-in server workspace. Nothing is uploaded just
                by opening this screen.
              </p>
            </div>
          </>
        )}
      </div>
    </ControlContext.Provider>
  );
}
