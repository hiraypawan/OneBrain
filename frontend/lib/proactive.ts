import type { Message } from "./types";
import type { BrainItem } from "./workspace/model";

export interface ProactivePreferences {
  enabled: boolean;
  historyTopics: boolean;
  preferenceQuestions: boolean;
  intervalMinutes: number;
  idleSeconds: number;
  maxPerSession: number;
  maxPerDay: number;
  quietStart: number;
  quietEnd: number;
  silent: boolean;
}
export const DEFAULT_PROACTIVE: ProactivePreferences = {
  enabled: false,
  historyTopics: false,
  preferenceQuestions: true,
  intervalMinutes: 30,
  idleSeconds: 90,
  maxPerSession: 3,
  maxPerDay: 5,
  quietStart: 22,
  quietEnd: 8,
  silent: false,
};
/** Treat persisted preferences as untrusted input; never coerce a string into consent. */
export function normalizeProactive(value: unknown): ProactivePreferences {
  const p =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const number = (key: keyof ProactivePreferences, min: number, max: number) =>
    typeof p[key] === "number" && Number.isFinite(p[key])
      ? Math.max(min, Math.min(max, Math.floor(p[key] as number)))
      : (DEFAULT_PROACTIVE[key] as number);
  return {
    enabled: p.enabled === true,
    historyTopics: p.historyTopics === true,
    preferenceQuestions:
      p.preferenceQuestions === undefined
        ? true
        : p.preferenceQuestions === true,
    silent: p.silent === true,
    intervalMinutes: number("intervalMinutes", 10, 1440),
    idleSeconds: number("idleSeconds", 90, 3600),
    maxPerSession: number("maxPerSession", 0, 5),
    maxPerDay: number("maxPerDay", 0, 10),
    quietStart: number("quietStart", 0, 23),
    quietEnd: number("quietEnd", 0, 23),
  };
}
export interface ProactiveCandidate {
  id: string;
  permission: string;
  question: string;
  sourceId?: string;
  reason: string;
}
export interface ProactiveHistory {
  day: string;
  count: number;
  lastAt: number;
  seen: string[];
  snoozedUntil: number;
}
export const EMPTY_PROACTIVE_HISTORY: ProactiveHistory = {
  day: "",
  count: 0,
  lastAt: 0,
  seen: [],
  snoozedUntil: 0,
};
export function normalizeProactiveHistory(
  value: unknown,
  now = Date.now(),
): ProactiveHistory {
  const h =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const number = (key: string, fallback: number) =>
    typeof h[key] === "number" &&
    Number.isFinite(h[key]) &&
    (h[key] as number) >= 0
      ? (h[key] as number)
      : fallback;
  return {
    day: typeof h.day === "string" ? h.day.slice(0, 20) : localDay(now),
    count: Math.min(10, Math.floor(number("count", 10))),
    lastAt: number("lastAt", now),
    snoozedUntil: number("snoozedUntil", now + 30 * 60000),
    seen: Array.isArray(h.seen)
      ? h.seen.filter((id): id is string => typeof id === "string").slice(-200)
      : [],
  };
}
export function localDay(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
export function inQuietHours(
  hour: number,
  start: number,
  end: number,
): boolean {
  if (start === end) return false;
  return start < end
    ? hour >= start && hour < end
    : hour >= start || hour < end;
}
export function canInitiate(
  p: ProactivePreferences,
  input: {
    now: number;
    active: boolean;
    status: string;
    lastActivity: number;
    sessionCount: number;
    history: ProactiveHistory;
    pending: boolean;
    memoryEnabled: boolean;
    micAvailable: boolean;
  },
): boolean {
  p = normalizeProactive(p);
  const { now } = input;
  const h = normalizeProactiveHistory(input.history, now);
  return (
    p.enabled &&
    !p.silent &&
    input.memoryEnabled &&
    input.active &&
    input.micAvailable &&
    input.status === "listening" &&
    !input.pending &&
    now >= h.snoozedUntil &&
    now - input.lastActivity >= Math.max(60, p.idleSeconds) * 1000 &&
    now - h.lastAt >= Math.max(10, p.intervalMinutes) * 60000 &&
    input.sessionCount < Math.max(0, Math.min(5, p.maxPerSession)) &&
    (h.day !== localDay(now) ||
      h.count < Math.max(0, Math.min(10, p.maxPerDay))) &&
    !inQuietHours(new Date(now).getHours(), p.quietStart, p.quietEnd)
  );
}
// Proactive topics intentionally exclude sensitive content, even when present in history.
export function suitableTopic(text: string): boolean {
  return (
    text.length >= 8 &&
    text.length <= 500 &&
    !/(password|passcode|credential|secret|recovery|token|bank|account number|medical|medicin|diagnos|depress|suicid|sex|intima|religio|politic|trauma|cancer|therapy|address|phone number|otp|₹|\$|\b\d{8,}\b)/i.test(
      text,
    )
  );
}
export function chooseCandidate(
  items: BrainItem[],
  messages: Message[],
  p: ProactivePreferences,
  seen: string[],
  now = Date.now(),
): ProactiveCandidate | null {
  const tasks = items
    .filter(
      (i) =>
        i.kind === "task" &&
        i.status === "active" &&
        suitableTopic(i.title) &&
        now - i.createdAt > 10 * 60000 &&
        (i.due
          ? Date.parse(i.due) <= now + 2 * 86400000
          : now - i.updatedAt >= 86400000) &&
        !seen.includes(`task:${i.id}:${i.updatedAt}`),
    )
    .sort(
      (a, b) =>
        (a.due ? Date.parse(a.due) : Infinity) -
        (b.due ? Date.parse(b.due) : Infinity),
    );
  const task = tasks[0];
  if (task)
    return {
      id: `task:${task.id}:${task.updatedAt}`,
      sourceId: task.id,
      permission:
        "There’s a saved follow-up we could revisit. Would you like a quick question?",
      question: `You saved “${task.title}”. Is this still relevant, or would you like to change the next step?`,
      reason:
        "An open task you explicitly saved. No changes will be made automatically.",
    };
  if (p.historyTopics) {
    const message = [...messages]
      .reverse()
      .find(
        (m) =>
          m.role === "user" &&
          now - m.createdAt > 10 * 60000 &&
          now - m.createdAt < 30 * 86400000 &&
          /\b(project|learn|goal|idea|practice|proposal)\b/i.test(m.content) &&
          suitableTopic(m.content) &&
          !seen.includes(`history:${m.createdAt}`),
      );
    if (message)
      return {
        id: `history:${message.createdAt}`,
        sourceId: message.id,
        permission:
          "Something you mentioned earlier might be useful to revisit. May I ask about it?",
        question: `Earlier you said, “${message.content.slice(0, 180)}”. Would you like to explore a next step, or leave it for now?`,
        reason:
          "Your earlier message; history suggestions are enabled. This is not an inferred personal trait.",
      };
  }
  if (p.preferenceQuestions && !seen.includes("preference:help-style"))
    return {
      id: "preference:help-style",
      permission: "May I ask one question about how you prefer to work?",
      question:
        "When you bring up an idea, would you prefer a quick next step or room to think it through? You can skip this.",
      reason:
        "An optional communication preference. Your answer is not automatically added to a profile.",
    };
  return null;
}
export type ProactiveReply = "accept" | "dismiss" | "disable" | null;
export function classifyProactiveReply(text: string): ProactiveReply {
  const s = text
    .toLowerCase()
    .trim()
    .replace(/[.!?]+$/, "");
  if (
    /^(stop asking|disable suggestions|turn off suggestions|quiet mode)$/.test(
      s,
    )
  )
    return "disable";
  if (/^(no|no thanks|not now|later|skip|leave it|nahi|nahin|नहीं)$/.test(s))
    return "dismiss";
  if (/^(yes|yes please|sure|go ahead|ask me|okay|ok|haan|han|हाँ)$/.test(s))
    return "accept";
  return null;
}
