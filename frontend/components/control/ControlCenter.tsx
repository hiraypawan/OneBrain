"use client";
import { useAssistantStore } from "@/store/assistant";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ControlContext } from "./ControlContext";
import { CATALOG, EXTRA_PANELS, GROUPS, type ToolEntry } from "./catalog";
import { Icon } from "../ui/Icon";
import { searchSpace, SPACE_SEARCH_SCOPE, type SpaceHit } from "@/lib/space-search";
import { db, getConversations } from "@/lib/db";
import { useFeaturesStore } from "@/store/features";
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
  tasks: dynamic(() => import("./Tasks").then((m) => m.Tasks), { loading }),
  reminders: dynamic(() => import("./Reminders"), { loading }),
  fitness: dynamic(() => import("./Fitness").then((m) => m.Fitness), { loading }),
  memory: dynamic(() => import("./Memory"), { loading }),
  notes: dynamic(() => import("./Notes").then((m) => m.Notes), { loading }),
  "memory-search": dynamic(() => import("./MemorySearch"), { loading }),
  timeline: dynamic(() => import("./Timeline"), { loading }),
  conversations: dynamic(() => import("./Conversations"), { loading }),
  conversation: dynamic(() => import("./Conversation"), { loading }),
  stories: dynamic(() => import("./Stories").then((m) => m.Stories), { loading }),
  drafts: dynamic(() => import("./Drafts").then((m) => m.Drafts), { loading }),
  plan: dynamic(() => import("./Plan").then((m) => m.Plan), { loading }),
  music: dynamic(() => import("./Music").then((m) => m.Music), { loading }),
};

/**
 * Sections that no longer own a panel. Every old `?panel=` link — from history,
 * bookmarks and the answers OneBrain speaks — still lands somewhere real, so
 * retiring a panel never leaves a dead end behind.
 */
const CATALOG_BY_ID: Record<string, ToolEntry> = Object.fromEntries(
  CATALOG.map((e) => [e.id, e]),
);
const PANEL_REDIRECTS: Record<string, { href: string; label: string }> = {
  track: { href: "/track", label: "Track" },
  todo: { href: "/control?panel=tasks", label: "To-Do" },
  "to-do": { href: "/control?panel=tasks", label: "To-Do" },
  notes: { href: "/", label: "Today" },
  canvas: { href: "/", label: "Today" },
  "shared-space": { href: "/control?panel=shared", label: "Connected work" },
};

function MovedPanel({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.replace(href), 250);
    return () => clearTimeout(t);
  }, [href, router]);
  return (
    <div className="panel-moved" role="status">
      <p>
        That section is now <strong>{label}</strong>. Taking you there…
      </p>
      <Link prefetch={false} className="text-button" href={href}>
        Go to {label}
        <Icon name="arrow" />
      </Link>
    </div>
  );
}

type SpaceRows = {
  items: import('@/lib/workspace/model').BrainItem[];
  conversations: import('@/lib/db').StoredConversation[];
  messages: { content: string; role: string; createdAt: number }[];
};

/** Everything the query box can search, read from the stores the user already has. */
function useSpaceRows(active: boolean) {
  const reminders = useAssistantStore((s) => s.reminders);
  const fitnessLogs = useFeaturesStore((s) => s.fitnessLogs);
  const emailDrafts = useFeaturesStore((s) => s.emailDrafts);
  const stories = useFeaturesStore((s) => s.stories);
  const [rows, setRows] = useState<SpaceRows>({
    items: [],
    conversations: [],
    messages: [],
  });
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void (async () => {
      try {
        const [items, conversations, messages] = await Promise.all([
          db.brainItems.toArray().catch(() => []),
          getConversations().catch(() => []),
          db.messages
            .orderBy("createdAt")
            .reverse()
            .limit(300)
            .toArray()
            .catch(() => []),
        ]);
        if (alive)
          setRows({
            items,
            conversations,
            messages: messages.map((m) => ({ content: m.content, role: m.role, createdAt: m.createdAt })),
          });
      } catch {
        /* a broken store never breaks the search box — the catalog still works */
      }
    })();
    return () => {
      alive = false;
    };
  }, [active]);
  return { rows, reminders, fitnessLogs, emailDrafts, stories };
}

export function ControlCenter() {
  const storageNotice = useAssistantStore((s) => s.storageNotice);
  const params = useSearchParams();
  const panel = params.get("panel") || "";
  // Own-property checks only: `?panel=constructor` must not find Object's
  // constructor and treat it as a redirect target.
  const moved = panel && Object.hasOwn(PANEL_REDIRECTS, panel) ? PANEL_REDIRECTS[panel] : undefined;
  /** A catalog entry whose home is no longer a panel here (Track is a tab). */
  const away = panel && Object.hasOwn(CATALOG_BY_ID, panel) ? CATALOG_BY_ID[panel]?.href : undefined;
  const entry =
    CATALOG.find((e) => e.id === panel) ||
    (Object.hasOwn(EXTRA_PANELS, panel) ? EXTRA_PANELS[panel] : undefined),
    Panel = Object.hasOwn(PANELS, panel) ? PANELS[panel] : undefined;
  const [query, setQuery] = useState("");
  const searching = query.trim().length >= 2;
  const { rows, reminders, fitnessLogs, emailDrafts, stories } = useSpaceRows(searching);
  const matches = CATALOG.filter((e) =>
    `${e.title} ${e.description} ${e.keywords || ""}`
      .toLowerCase()
      .includes(query.toLowerCase().trim()),
  );
  const space = useMemo(
    () =>
      searching
        ? searchSpace({
            query,
            items: rows.items,
            conversations: rows.conversations,
            messages: rows.messages,
            reminders,
            stories,
            drafts: emailDrafts,
            logs: fitnessLogs,
            catalog: CATALOG as ToolEntry[],
          })
        : null,
    [searching, query, rows, reminders, stories, emailDrafts, fitnessLogs],
  );
  const savedHits: SpaceHit[] = space
    ? space.bySection.filter((g) => g.section !== "tools").flatMap((g) => g.hits)
    : [];

  // A panel URL renders its panel; a retired URL redirects; anything else is
  // reported instead of silently showing the hub.
  if (panel && !Panel && (moved || away)) {
    return (
      <ControlContext.Provider value={true}>
        <div className="control-center">
          <MovedPanel href={moved?.href || away!} label={moved?.label || entry?.title || "that section"} />
        </div>
      </ControlContext.Provider>
    );
  }
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
              <span className="overline">EVERYTHING YOU SAVED, IN ONE PLACE</span>
              <h1>Your space</h1>
              <p>
                Four sections instead of fifteen doors. Your everyday flow is on
                Today; the numbers of your logged life are on Track.
              </p>
            </header>
            {panel && (
              <p role="status" className="workspace-notice">
                That section wasn’t found. Choose a section below.
              </p>
            )}
            <div className="space-shortcuts">
              <Link prefetch={false} href="/track" className="space-shortcut">
                <span className="entry-icon">
                  <Icon name="fitness" />
                </span>
                <span>
                  <strong>Track</strong>
                  <small>Expenses, food, health and workouts from your own log</small>
                </span>
                <Icon name="arrow" />
              </Link>
              <Link prefetch={false} href="/voice" className="space-shortcut">
                <span className="entry-icon">
                  <Icon name="mic" />
                </span>
                <span>
                  <strong>Voice</strong>
                  <small>Full-screen listening, captions and answers</small>
                </span>
                <Icon name="arrow" />
              </Link>
              <Link prefetch={false} href="/you" className="space-shortcut">
                <span className="entry-icon">
                  <Icon name="user" />
                </span>
                <span>
                  <strong>You</strong>
                  <small>Account, plan, voice and privacy preferences</small>
                </span>
                <Icon name="arrow" />
              </Link>
            </div>
            <label className="control-search">
              <Icon name="search" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your saved things, tools and settings"
                aria-label="Find a tool or setting"
                aria-describedby="space-search-scope"
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
            {savedHits.length > 0 && (
              <section className="space-results" aria-label="In your saved things">
                <h2>
                  In your things
                  <span>{space?.total ?? 0} match{(space?.total ?? 0) === 1 ? "" : "es"}</span>
                </h2>
                {space?.bySection
                  .filter((g) => g.section !== "tools")
                  .map((group) => (
                    <div key={group.section} className="space-results-group">
                      <h3>{group.label}</h3>
                      <ul>
                        {group.hits.map((hit) => (
                          <li key={hit.id}>
                            <Link prefetch={false} href={hit.href}>
                              <span>
                                <strong>{hit.title}</strong>
                                <small>{hit.snippet}</small>
                              </span>
                              <Icon name="arrow" />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                <p id="space-search-scope" className="space-scope">
                  {SPACE_SEARCH_SCOPE}
                </p>
              </section>
            )}
            <div className="control-groups">
              {GROUPS.map((group) => {
                const rows = matches.filter((e) => e.group === group);
                return rows.length ? (
                  <section key={group}>
                    <h2>{group}</h2>
                    {rows.map((e) => (
                      <Link prefetch={false}
                        className="control-entry"
                        href={e.href || `/control?panel=${e.id}`}
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
                <p>
                  Try “voice”, “reminders”, “Google” or “export”. Saved notes,
                  tasks and conversations are searched too.
                </p>
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
