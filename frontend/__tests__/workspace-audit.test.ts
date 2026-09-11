import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../lib/db";
import { useWorkspaceStore as workspace } from "../store/workspace";
import { useAssistantStore as assistant } from "../store/assistant";
import {
  draftCapture,
  draftBrainDump,
  financialTotals,
  parseAmount,
  safeCalculation,
} from "../lib/workspace/model";
import { sameRecord, validateCapture } from "../lib/workspace/validation";
import {
  normalizeProactive,
  normalizeProactiveHistory,
  DEFAULT_PROACTIVE,
  canInitiate,
  localDay,
} from "../lib/proactive";

beforeEach(async () => {
  await db.brainItems.clear();
  await db.actionReceipts.clear();
  assistant.getState().updateSettings({ memoryEnabled: true });
  await workspace.getState().load("audit");
});
const capture = (text: string) =>
  workspace.getState().capture([draftCapture(text)]);

describe("lossless capture and numeric validation", () => {
  it("rejects a 31-line dump instead of silently discarding the last record", () => {
    expect(() =>
      draftBrainDump(
        Array.from({ length: 31 }, (_, i) => `note: ${i}`).join("\n"),
      ),
    ).toThrow("30 items");
    expect(
      draftBrainDump(
        Array.from({ length: 30 }, (_, i) => `note: ${i}`).join("\n"),
      ),
    ).toHaveLength(30);
  });
  it("rejects oversized sources instead of truncating them", () => {
    expect(() => draftCapture("x".repeat(6001))).toThrow("6,000");
  });
  it.each(["expense: $12.345", "expense: ₹12,34", "expense: transfers50"])(
    "does not invent an amount from %s",
    (input) => {
      expect(parseAmount(input)).toBeUndefined();
    },
  );
  it("supports spaced symbols and Indian grouping", () => {
    expect(parseAmount("₹ 1,23,456.70")).toEqual({
      amount: 123456.7,
      currency: "INR",
    });
  });
  it.each([
    { amount: Infinity, currency: "INR" },
    { amount: 1.234, currency: "INR" },
    { amount: 10, currency: "__proto__" },
    { due: "not-a-date" },
    { kind: "invented" },
  ])("validates captures as well as later edits (%j)", async (invalid) => {
    await expect(
      workspace
        .getState()
        .capture([{ ...draftCapture("expense: lunch"), ...invalid } as any]),
    ).rejects.toThrow();
    expect(await db.brainItems.count()).toBe(0);
    expect(await db.actionReceipts.count()).toBe(0);
  });
  it("does not mutate object prototypes when aggregating malformed stored currencies", async () => {
    const [item] = await capture("expense: $20");
    expect(financialTotals([{ ...item, currency: "__proto__" }])).toEqual({});
    expect(Object.prototype).not.toHaveProperty("expense");
  });
  it("handles percentage overflow and precision consistently", () => {
    expect(safeCalculation(`${"9".repeat(310)}% of 100`)).toContain("outside");
    expect(safeCalculation("10% of 0.3")).toBe("0.03");
  });
  it("protects immutable identity fields even from runtime callers", async () => {
    const [item] = await capture("note: original");
    await workspace
      .getState()
      .update(item.id, {
        title: "Updated",
        id: "replacement",
        scope: "other",
        source: "voice",
      } as any);
    expect(workspace.getState().items[0]).toMatchObject({
      id: item.id,
      scope: "audit",
      source: "typed",
      title: "Updated",
    });
    expect(() =>
      validateCapture({
        ...draftCapture("note: valid"),
        title: "x".repeat(121),
      }),
    ).toThrow("120");
  });
});

describe("atomic conflict and relationship checks", () => {
  it("rejects undo when another record acquired a backlink after the capture", async () => {
    const [person] = await capture("person: Rahul");
    const receipt = workspace.getState().receipts[0];
    const [task] = await capture("task: Follow up");
    await workspace.getState().update(task.id, { links: [person.id] });
    await expect(workspace.getState().undo(receipt.id)).rejects.toThrow("link");
    expect(await db.brainItems.get(person.id)).toBeDefined();
  });
  it("does not overwrite a more recent edit from another tab", async () => {
    const [item] = await capture("note: original");
    await db.brainItems.update(item.id, {
      title: "Other tab",
      updatedAt: item.updatedAt + 1,
    });
    await expect(
      workspace.getState().update(item.id, { title: "Stale edit" }),
    ).rejects.toThrow("another tab");
    expect((await db.brainItems.get(item.id))?.title).toBe("Other tab");
    expect(await db.actionReceipts.count()).toBe(1);
  });
  it("does not undo a record modified in another tab", async () => {
    const [item] = await capture("note: original");
    const receipt = workspace.getState().receipts[0];
    await db.brainItems.update(item.id, { title: "Other tab" });
    await expect(workspace.getState().undo(receipt.id)).rejects.toThrow(
      "another tab",
    );
    expect((await db.actionReceipts.get(receipt.id))?.status).toBe(
      "verified-local",
    );
  });
  it("rejects a second undo based on a stale receipt", async () => {
    const [item] = await capture("note: original");
    const receipt = workspace.getState().receipts[0];
    await db.actionReceipts.update(receipt.id, { status: "undone" });
    await expect(workspace.getState().undo(receipt.id)).rejects.toThrow(
      "another tab",
    );
    expect(await db.brainItems.get(item.id)).toBeDefined();
  });
  it("does not delete an endpoint of a new relationship in another tab", async () => {
    const [person] = await capture("person: Rahul");
    const [task] = await capture("task: Follow up");
    await db.brainItems.update(task.id, { links: [person.id] });
    await expect(workspace.getState().remove(person.id)).rejects.toThrow(
      "another tab",
    );
    expect(await db.brainItems.get(person.id)).toBeDefined();
  });
  it("rejects adding a relationship to a record deleted in another tab", async () => {
    const [person] = await capture("person: Rahul");
    const [task] = await capture("task: Follow up");
    await db.brainItems.delete(person.id);
    await expect(
      workspace.getState().update(task.id, { links: [person.id] }),
    ).rejects.toThrow("another tab");
    expect((await db.brainItems.get(task.id))?.links).toEqual([]);
  });
  it("does not silently persist temporary edits when Memory is enabled again", async () => {
    const [item] = await capture("note: saved");
    assistant.getState().updateSettings({ memoryEnabled: false });
    await workspace.getState().update(item.id, { title: "Temporary edit" });
    assistant.getState().updateSettings({ memoryEnabled: true });
    await expect(
      workspace.getState().update(item.id, { title: "New edit" }),
    ).rejects.toThrow("Memory was off");
    expect((await db.brainItems.get(item.id))?.title).toBe("saved");
  });
  it("canonical record equality is not affected by key order or explicit undefined", async () => {
    const [item] = await capture("note: original");
    expect(
      sameRecord(item, {
        due: undefined,
        ...Object.fromEntries(Object.entries(item).reverse()),
      } as any),
    ).toBe(true);
  });
});

describe("persisted proactive settings validation", () => {
  it("never coerces string values into consent", () => {
    expect(
      normalizeProactive({ enabled: "false", historyTopics: "true" }),
    ).toMatchObject({ enabled: false, historyTopics: false });
  });
  it("bounds numeric preferences and falls back from non-finite settings", () => {
    expect(
      normalizeProactive({
        idleSeconds: 1,
        intervalMinutes: -5,
        maxPerDay: Infinity,
        maxPerSession: 999,
        quietStart: NaN,
        quietEnd: 999,
      }),
    ).toMatchObject({
      idleSeconds: 90,
      intervalMinutes: 10,
      maxPerDay: 5,
      maxPerSession: 5,
      quietStart: 22,
      quietEnd: 23,
    });
  });
  it("bounds stored history and waits rather than immediately initiating on corrupted data", () => {
    const now = new Date(2026, 8, 10, 12).getTime();
    const history = normalizeProactiveHistory(
      { day: localDay(now), count: "0", seen: [null, "valid"], lastAt: NaN },
      now,
    );
    expect(history.seen).toEqual(["valid"]);
    expect(history.count).toBe(10);
    expect(
      canInitiate(
        { ...DEFAULT_PROACTIVE, enabled: true },
        {
          now,
          active: true,
          status: "listening",
          lastActivity: 0,
          sessionCount: 0,
          history,
          pending: false,
          memoryEnabled: true,
          micAvailable: true,
        },
      ),
    ).toBe(false);
    expect(
      normalizeProactiveHistory({ seen: Array(400).fill("id") }).seen,
    ).toHaveLength(200);
  });
});
