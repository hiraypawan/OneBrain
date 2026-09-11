import type { IconName } from "../ui/Icon";
export type ToolEntry = {
  id: string;
  title: string;
  description: string;
  group: string;
  icon: IconName;
  keywords?: string;
};
export const CATALOG: ToolEntry[] = [
  {
    id: "reminders",
    title: "Reminders",
    description: "A daily nudge or a one-time reminder while the app is open.",
    group: "Keep track",
    icon: "bell",
  },
  {
    id: "conversations",
    title: "Conversations",
    description: "Revisit what you and OneBrain talked about.",
    group: "Keep track",
    icon: "history",
  },
  {
    id: "memory",
    title: "Memory",
    description: "Find recurring topics and your saved conversation context.",
    group: "Keep track",
    icon: "note",
    keywords: "search timeline digest",
  },
  {
    id: "shared",
    title: "Connected work",
    description: "Shared workspaces, app connections, schedules and approvals.",
    group: "Do more",
    icon: "link",
    keywords:
      "operations team calendar gmail sheets telegram slack jobs tasks inbox records import",
  },
  {
    id: "tools",
    title: "Everyday tools",
    description: "Calculate, convert, set timers, or check a source.",
    group: "Do more",
    icon: "tool",
    keywords: "utilities weather currency calculator dates",
  },
  {
    id: "vault",
    title: "Private vault",
    description: "Password-encrypted entries on this device.",
    group: "Do more",
    icon: "lock",
    keywords: "password backup encryption",
  },
  {
    id: "account",
    title: "Account",
    description: "Google sign-in and control over your sessions.",
    group: "Make it yours",
    icon: "user",
    keywords: "login logout sign in",
  },
  {
    id: "voice",
    title: "Voice & conversation",
    description: "Language, replies and permission-first suggestions.",
    group: "Make it yours",
    icon: "mic",
    keywords: "settings speed proactive silent wake",
  },
  {
    id: "privacy",
    title: "Memory & privacy",
    description: "Choose what stays, how long, and what you delete.",
    group: "Make it yours",
    icon: "sliders",
    keywords: "settings retention export deletion",
  },
  {
    id: "advanced",
    title: "Advanced",
    description: "Optional AI provider, speaker filter and diagnostics.",
    group: "Make it yours",
    icon: "tool",
    keywords: "settings gemini key debug enrollment",
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
