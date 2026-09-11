import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  draftCapture,
  draftBrainDump,
  financialTotals,
  safeCalculation,
  searchItems,
  retrieveWorkspaceContext,
  workspaceContextBlock,
} from "../lib/workspace/model";
import { interpretLocal } from "../lib/workspace/voice";
import { db } from "../lib/db";
import { useWorkspaceStore } from "../store/workspace";
import { useAssistantStore } from "../store/assistant";

beforeEach(async () => {
  await db.brainItems.clear();
  await db.actionReceipts.clear();
  useAssistantStore.getState().updateSettings({ memoryEnabled: true });
  await useWorkspaceStore.getState().load("test-user");
});
describe("conservative local interpretation", () => {
  it("parses explicit categories without inventing dates", () => {
    expect(draftCapture("task: Send Rahul a proposal Friday")).toMatchObject({
      kind: "task",
      title: "Send Rahul a proposal Friday",
    });
    expect(
      draftCapture("task: Send Rahul a proposal Friday").due,
    ).toBeUndefined();
  });
  it("preserves the source and separates only explicit lines or semicolons", () => {
    const result = draftBrainDump(
      "task: Call the vendor\nidea: Referral offer; shopping: Milk",
    );
    expect(result.map((i) => i.kind)).toEqual(["task", "idea", "shopping"]);
    expect(result[0].body).toBe("task: Call the vendor");
    expect(draftBrainDump("Call the vendor and buy milk")).toHaveLength(1);
  });
  it("extracts amounts but does not invent them from prose", () => {
    expect(draftCapture("expense: ₹1,450.50 petrol")).toMatchObject({
      amount: 1450.5,
      currency: "INR",
    });
    expect(draftCapture("payment: $20")).toMatchObject({
      amount: 20,
      currency: "USD",
    });
    expect(draftCapture("expense: sixty thousand")).not.toHaveProperty(
      "amount",
    );
  });
  it("uses deterministic arithmetic, never eval", () => {
    expect(safeCalculation("15% of 60,000")).toBe("9000");
    expect(safeCalculation("0.1 + 0.2")).toBe("0.3");
    expect(safeCalculation("12 / 0")).toContain("zero");
    expect(safeCalculation("process.exit()")).toBeNull();
    expect(safeCalculation("2 ** 4")).toBeNull();
  });
  it("routes writes to preview and never silently executes", () => {
    expect(interpretLocal("note: Keep the spare keys upstairs", [])?.type).toBe(
      "draft",
    );
    expect(interpretLocal("search memory Rahul", [])).toMatchObject({
      type: "answer",
      text: expect.stringContaining("could not find"),
    });
    expect(interpretLocal("Send an email to Rahul", [])).toBeNull();
  });
});
describe("local action ledger and persistence", () => {
  it("atomically captures records and receipts, and restores them after reload", async () => {
    const [item] = await useWorkspaceStore
      .getState()
      .capture([draftCapture("note: Spare keys upstairs")]);
    expect(await db.brainItems.get(item.id)).toMatchObject({
      title: "Spare keys upstairs",
      scope: "test-user",
    });
    expect(await db.actionReceipts.count()).toBe(1);
    await useWorkspaceStore.getState().load("test-user");
    expect(useWorkspaceStore.getState().items).toHaveLength(1);
    expect(useWorkspaceStore.getState().receipts[0].status).toBe(
      "verified-local",
    );
  });
  it("isolates workspace records by scope", async () => {
    await useWorkspaceStore
      .getState()
      .capture([draftCapture("note: Private work note")]);
    await useWorkspaceStore.getState().load("other-user");
    expect(useWorkspaceStore.getState().items).toEqual([]);
    expect(useWorkspaceStore.getState().receipts).toEqual([]);
    await useWorkspaceStore.getState().load("test-user");
    expect(useWorkspaceStore.getState().items).toHaveLength(1);
  });
  it("does not write session-only captures to disk", async () => {
    useAssistantStore.getState().updateSettings({ memoryEnabled: false });
    await useWorkspaceStore
      .getState()
      .capture([draftCapture("idea: Temporary idea")]);
    expect(useWorkspaceStore.getState().items).toHaveLength(1);
    expect(useWorkspaceStore.getState().receipts[0].status).toBe(
      "session-only",
    );
    expect(await db.brainItems.count()).toBe(0);
    expect(await db.actionReceipts.count()).toBe(0);
  });
  it("rejects invalid relationships and dates", async () => {
    const [item] = await useWorkspaceStore
      .getState()
      .capture([draftCapture("task: Proposal")]);
    await expect(
      useWorkspaceStore
        .getState()
        .update(item.id, { links: ["other-user-item"] }),
    ).rejects.toThrow("workspace");
    await expect(
      useWorkspaceStore.getState().update(item.id, { due: "Fridayish" }),
    ).rejects.toThrow("valid date");
  });
  it("undo restores edits, rejects stale undo and allows newer edits to be undone first", async () => {
    const [item] = await useWorkspaceStore
      .getState()
      .capture([draftCapture("task: Proposal")]);
    const captureReceipt = useWorkspaceStore.getState().receipts[0];
    await useWorkspaceStore.getState().update(item.id, { status: "done" });
    const updateReceipt = useWorkspaceStore.getState().receipts[0];
    await expect(
      useWorkspaceStore.getState().undo(captureReceipt.id),
    ).rejects.toThrow("changed");
    await useWorkspaceStore.getState().undo(updateReceipt.id);
    expect(useWorkspaceStore.getState().items[0].status).toBe("active");
    await useWorkspaceStore.getState().undo(captureReceipt.id);
    expect(useWorkspaceStore.getState().items).toHaveLength(0);
    expect(await db.brainItems.count()).toBe(0);
    await expect(
      useWorkspaceStore.getState().undo(captureReceipt.id),
    ).rejects.toThrow("cannot");
  });
  it("removes backlinks on delete and restores them on undo", async () => {
    const [person, task] = await useWorkspaceStore
      .getState()
      .capture([draftCapture("person: Rahul"), draftCapture("task: Quote")]);
    await useWorkspaceStore.getState().update(task.id, { links: [person.id] });
    await useWorkspaceStore.getState().remove(person.id);
    expect(useWorkspaceStore.getState().items[0].links).toEqual([]);
    await useWorkspaceStore
      .getState()
      .undo(useWorkspaceStore.getState().receipts[0].id);
    expect(
      useWorkspaceStore.getState().items.find((i) => i.id === task.id)?.links,
    ).toEqual([person.id]);
  });
  it("aggregates money by currency without floating-point drift", async () => {
    const items = await useWorkspaceStore
      .getState()
      .capture([
        draftCapture("expense: ₹0.10"),
        draftCapture("expense: ₹0.20"),
        draftCapture("payment: $20"),
      ]);
    expect(financialTotals(items)).toEqual({
      INR: { expense: 0.3, payment: 0 },
      USD: { expense: 0, payment: 20 },
    });
    expect(searchItems(items, "payment")).toHaveLength(1);
  });
  it("reports failed persistence without creating a success receipt in memory", async () => {
    const spy = vi
      .spyOn(db.actionReceipts, "add")
      .mockRejectedValueOnce(new Error("Disk full"));
    await expect(
      useWorkspaceStore.getState().capture([draftCapture("note: fail")]),
    ).rejects.toThrow("Disk full");
    expect(useWorkspaceStore.getState().items).toHaveLength(0);
    expect(await db.brainItems.count()).toBe(0);
    spy.mockRestore();
  });
  it("deletes only the current workspace", async () => {
    await useWorkspaceStore.getState().capture([draftCapture("note: first")]);
    await useWorkspaceStore.getState().load("other");
    await useWorkspaceStore.getState().capture([draftCapture("note: second")]);
    await useWorkspaceStore.getState().clear();
    await useWorkspaceStore.getState().load("test-user");
    expect(useWorkspaceStore.getState().items).toHaveLength(1);
  });
});

describe("scope-change safety", () => {
  it("rejects queued writes if the account changed before execution", async () => {
    const pending = useWorkspaceStore
      .getState()
      .capture([draftCapture("note: Old-account request")]);
    const switched = useWorkspaceStore.getState().load("new-account");
    await expect(pending).rejects.toThrow("Workspace changed");
    await switched;
    expect(useWorkspaceStore.getState().items).toHaveLength(0);
    expect(await db.brainItems.count()).toBe(0);
  });
});

describe("workspace reference context", () => {
  it("retrieves relevant notes and explicitly connected context with source attribution", async () => {
    const [person, decision, other] = await useWorkspaceStore
      .getState()
      .capture([
        draftCapture("person: Rahul"),
        draftCapture("decision: Monthly payments preferred"),
        draftCapture("note: Spare keys upstairs"),
      ]);
    await useWorkspaceStore
      .getState()
      .update(decision.id, { links: [person.id] });
    const items = useWorkspaceStore.getState().items;
    expect(
      retrieveWorkspaceContext(items, "What does Rahul prefer?")
        .map((i) => i.id)
        .sort(),
    ).toEqual([person.id, decision.id].sort());
    expect(workspaceContextBlock(items, "Rahul")).toContain("untrusted data");
    expect(workspaceContextBlock(items, "Rahul")).not.toContain(other.title);
    expect(retrieveWorkspaceContext(items, "what is this")).toEqual([]);
  });
});

describe('additive migration', () => {
  it('preserves version-3 conversations when adding workspace tables', async () => {
    const { default: Dexie } = await import('dexie');
    db.close();
    await db.delete();
    const old = new Dexie('onebrain');
    old.version(3).stores({ conversations: 'id, createdAt', messages: '++id, conversationId, createdAt, uuid', reminders: 'id, createdAt', kv: 'key', pendingSync: '++id, createdAt' });
    await old.open();
    await old.table('conversations').put({ id: 'legacy-conversation', title: 'Preserve this', createdAt: 1 });
    await old.table('messages').add({ uuid: 'legacy-message', conversationId: 'legacy-conversation', content: 'Saved before the redesign', role: 'user', createdAt: 1 });
    old.close();
    await db.open();
    expect((await db.conversations.get('legacy-conversation'))?.title).toBe('Preserve this');
    expect((await db.messages.toArray())[0].content).toBe('Saved before the redesign');
    expect(await db.brainItems.count()).toBe(0);
    expect(await db.actionReceipts.count()).toBe(0);
  });
});
