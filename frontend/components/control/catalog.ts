import type { IconName } from "../ui/Icon";
export type ToolEntry = {
  id: string;
  title: string;
  description: string;
  group: string;
  icon: IconName;
  keywords?: string;
  /**
   * Sections that moved out of the panel maze (Track is a tab now). The link
   * goes to the new home; the old `?panel=` URL still resolves through
   * ControlCenter's redirect table, so nothing that was ever printed or spoken
   * becomes a dead end.
   */
  href?: string;
};
/** The four sections of Your space. Retired 2026-09-16: this replaced a
 *  flat fifteen-tile wall where the same To-Do lived in three places. */
export const GROUPS = [
  "Get things done",
  "Your record",
  "Utilities",
  "Make it yours",
] as const;
export const CATALOG: ToolEntry[] = [
  {
    id: "tasks",
    title: "To-Do",
    description:
      "One list for tasks, reminders and shared work — due dates, priorities, done.",
    group: "Get things done",
    icon: "check",
    keywords:
      "todo to-do task tasks pending due priority urgent list checklist reminders finish complete",
  },
  {
    id: "reminders",
    title: "Reminders",
    description: "A daily nudge or a one-time reminder while the app is open.",
    group: "Get things done",
    icon: "bell",
    keywords: "nudge alarm daily once time",
  },
  {
    id: "shared",
    title: "Connected work",
    description:
      "Shared workspaces, app connections, schedules and approvals — signed-in server work.",
    group: "Get things done",
    icon: "link",
    keywords:
      "operations team calendar gmail sheets telegram slack jobs tasks inbox records import",
  },
  {
    id: "track",
    title: "Track",
    description:
      "Expenses, food, health and workouts — the tab version of your own log.",
    group: "Your record",
    href: "/track",
    icon: "fitness",
    keywords:
      "expenses spending budget kharcha kharcha-paisa food calories diet sleep weight water workouts streak report history diary",
  },
  {
    id: "notes",
    title: "Notes & activity",
    description:
      "Everything you saved: search it, see the context map, undo a change.",
    group: "Your record",
    icon: "note",
    keywords:
      "notes note ideas decisions people projects task list canvas map undo activity receipts history memory session only verified local",
  },
  {
    id: "fitness",
    title: "Fitness log",
    description:
      "Everything Track reads: voice-logged workouts, food, expenses, sleep and streaks.",
    group: "Your record",
    icon: "history",
    keywords:
      "workout gym food calories sleep streak hiit exercise expense expenses kharch kharcha spend spending budget paisa timeline manual add entry",
  },
  {
    id: "conversations",
    title: "Conversations",
    description: "Revisit what you and OneBrain talked about.",
    group: "Your record",
    icon: "history",
    keywords: "chat history talk asked",
  },
  {
    id: "memory",
    title: "Memory",
    description: "Find recurring topics and your saved conversation context.",
    group: "Your record",
    icon: "note",
    keywords: "search timeline digest topics",
  },
  {
    id: "drafts",
    title: "Email drafts",
    description: "Voice-drafted mails, ready to copy or send.",
    group: "Your record",
    icon: "mail",
    keywords: "email mail leave application draft",
  },
  {
    id: "stories",
    title: "Stories",
    description: "Bedtime tales that remember their characters.",
    group: "Your record",
    icon: "book",
    keywords: "kids kahani bedtime story parent",
  },
  {
    id: "tools",
    title: "Everyday tools",
    description: "Calculate, convert, set timers, or check a source.",
    group: "Utilities",
    icon: "tool",
    keywords: "utilities weather currency calculator dates timer stopwatch",
  },
  {
    id: "vault",
    title: "Private vault",
    description: "Password-encrypted entries on this device.",
    group: "Utilities",
    icon: "lock",
    keywords: "password backup encryption secret",
  },
  {
    id: "music",
    title: "Music & podcasts",
    description: "Say “play kesariya”, or search here. Free sources, no accounts.",
    group: "Utilities",
    icon: "music",
    keywords: "song gaana music podcast player audio video youtube kesariya bajao sunao",
  },
  {
    id: "plan",
    title: "Plan",
    description: "What you have, who decided it, and how a key changes it.",
    group: "Make it yours",
    icon: "star",
    keywords: "plan pro family upgrade pricing beta key subscription",
  },
  {
    id: "account",
    title: "Account",
    description: "Google sign-in and control over your sessions.",
    group: "Make it yours",
    icon: "user",
    keywords: "login logout sign in session device",
  },
  {
    id: "voice",
    title: "Voice & conversation",
    description: "Language, replies and permission-first suggestions.",
    group: "Make it yours",
    icon: "mic",
    keywords: "settings speed proactive silent wake language",
  },
  {
    id: "privacy",
    title: "Memory & privacy",
    description: "Choose what stays, how long, and what you delete.",
    group: "Make it yours",
    icon: "sliders",
    keywords: "settings retention export deletion memory",
  },
  {
    id: "advanced",
    title: "Advanced",
    description: "Optional AI key, who may speak to OneBrain, and diagnostics.",
    group: "Make it yours",
    icon: "tool",
    keywords: "settings gemini key debug enrollment voiceprint theme appearance light dark display",
  },
];
export const EXTRA_PANELS: Record<
  string,
  { title: string; description: string }
> = {
  "data-export": {
    title: "Export & delete local data",
    description: "Take a copy or remove the local canvas database.",
  },
  debug: {
    title: "Diagnostics",
    description: "Browser capabilities and local session events.",
  },
  "memory-search": {
    title: "Search conversations",
    description: "Find something you said before.",
  },
  timeline: {
    title: "Conversation timeline",
    description: "Your saved conversations over time.",
  },
  conversation: {
    title: "Conversation",
    description: "Read a saved conversation.",
  },
};
