import { describe, expect, it } from "vitest";
import {
  canInitiate,
  chooseCandidate,
  classifyProactiveReply,
  DEFAULT_PROACTIVE,
  EMPTY_PROACTIVE_HISTORY,
  inQuietHours,
  localDay,
  suitableTopic,
} from "../lib/proactive";
import type { BrainItem } from "../lib/workspace/model";
const now = new Date(2026, 8, 10, 12, 0).getTime();
const prefs = { ...DEFAULT_PROACTIVE, enabled: true };
const input = {
  now,
  active: true,
  status: "listening",
  lastActivity: now - 120000,
  sessionCount: 0,
  history: { ...EMPTY_PROACTIVE_HISTORY, seen: [] },
  pending: false,
  memoryEnabled: true,
  micAvailable: true,
};
const task: BrainItem = {
  id: "a",
  scope: "device",
  kind: "task",
  title: "Send the website proposal",
  body: "task: Send the website proposal",
  status: "active",
  createdAt: now - 86400000,
  updatedAt: now - 86400000,
  source: "typed",
  links: [],
};
describe("proactive conversation policy", () => {
  it("is off by default", () =>
    expect(canInitiate(DEFAULT_PROACTIVE, input)).toBe(false));
  it("allows only an eligible active session after a sustained pause", () =>
    expect(canInitiate(prefs, input)).toBe(true));
  it.each([
    { active: false },
    { status: "processing" },
    { status: "speaking" },
    { status: "error" },
    { memoryEnabled: false },
    { pending: true },
    { micAvailable: false },
    { lastActivity: now - 10000 },
    { sessionCount: 3 },
  ])("suppresses invitations for %j", (patch) =>
    expect(canInitiate(prefs, { ...input, ...patch })).toBe(false),
  );
  it("respects silent mode", () =>
    expect(canInitiate({ ...prefs, silent: true }, input)).toBe(false));
  it("respects cooldown and snooze", () => {
    expect(
      canInitiate(prefs, {
        ...input,
        history: { ...input.history, lastAt: now - 100000 },
      }),
    ).toBe(false);
    expect(
      canInitiate(prefs, {
        ...input,
        history: { ...input.history, snoozedUntil: now + 100000 },
      }),
    ).toBe(false);
  });
  it("enforces daily caps but resets on the next local day", () => {
    expect(
      canInitiate(prefs, {
        ...input,
        history: { ...input.history, count: 5, day: localDay(now) },
      }),
    ).toBe(false);
    expect(
      canInitiate(prefs, {
        ...input,
        history: { ...input.history, count: 5, day: "old-day" },
      }),
    ).toBe(true);
  });
  it("handles quiet windows crossing midnight and ordinary windows", () => {
    expect(inQuietHours(23, 22, 8)).toBe(true);
    expect(inQuietHours(7, 22, 8)).toBe(true);
    expect(inQuietHours(8, 22, 8)).toBe(false);
    expect(inQuietHours(12, 9, 17)).toBe(true);
    expect(inQuietHours(12, 8, 8)).toBe(false);
  });
  it("never quotes task context in the permission invitation", () => {
    const c = chooseCandidate([task], [], prefs, [], now)!;
    expect(c.permission).not.toContain(task.title);
    expect(c.question).toContain(task.title);
    expect(c.sourceId).toBe("a");
  });
  it("does not repeat an unchanged task", () => {
    expect(
      chooseCandidate(
        [task],
        [],
        { ...prefs, preferenceQuestions: false },
        [`task:a:${task.updatedAt}`],
        now,
      ),
    ).toBeNull();
  });
  it("does not nudge a completed or freshly captured task", () => {
    const p = { ...prefs, preferenceQuestions: false };
    expect(
      chooseCandidate([{ ...task, status: "done" }], [], p, [], now),
    ).toBeNull();
    expect(
      chooseCandidate([{ ...task, createdAt: now }], [], p, [], now),
    ).toBeNull();
  });
  it("requires separate consent for history topics", () => {
    const message = {
      id: "m",
      role: "user" as const,
      content: "I want to learn a new programming language",
      createdAt: now - 86400000,
    };
    expect(
      chooseCandidate(
        [],
        [message],
        { ...prefs, preferenceQuestions: false },
        [],
        now,
      ),
    ).toBeNull();
    expect(
      chooseCandidate([], [message], { ...prefs, historyTopics: true }, [], now)
        ?.sourceId,
    ).toBe("m");
  });
  it("excludes assistant statements and old history", () => {
    const p = { ...prefs, historyTopics: true, preferenceQuestions: false };
    expect(
      chooseCandidate(
        [],
        [
          {
            id: "m",
            role: "assistant",
            content: "You should learn programming",
            createdAt: now - 86400000,
          },
        ],
        p,
        [],
        now,
      ),
    ).toBeNull();
    expect(
      chooseCandidate(
        [],
        [
          {
            id: "m",
            role: "user",
            content: "I want to learn programming",
            createdAt: now - 40 * 86400000,
          },
        ],
        p,
        [],
        now,
      ),
    ).toBeNull();
  });
  it.each([
    "My bank account number is 123456789",
    "project: discuss medical diagnosis",
    "learn the office password",
    "proposal with ₹60000 budget",
  ])("avoids proactively surfacing sensitive content: %s", (text) =>
    expect(suitableTopic(text)).toBe(false),
  );
  it.each(["not now", "No thanks!", "skip", "nahi", "नहीं"])(
    "recognizes dismissal: %s",
    (text) => expect(classifyProactiveReply(text)).toBe("dismiss"),
  );
  it("requires affirmative intent; unrelated speech is not consent", () => {
    expect(classifyProactiveReply("yes")).toBe("accept");
    expect(classifyProactiveReply("stop asking")).toBe("disable");
    expect(classifyProactiveReply("Send my proposal")).toBeNull();
    expect(classifyProactiveReply("")).toBeNull();
  });
});
