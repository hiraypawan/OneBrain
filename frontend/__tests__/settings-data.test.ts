import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAllLocal, exportAllLocal, db } from "../lib/db";
import { useAssistantStore } from "../store/assistant";
beforeEach(async () => {
  await clearAllLocal();
  await db.conversations.put({
    id: "keep",
    title: "Saved conversation",
    createdAt: Date.now(),
  });
  await db.kv.put({ key: "example", value: "Saved preference" });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("local data settings", () => {
  it("clears all canvas database tables on success", async () => {
    await clearAllLocal();
    for (const table of db.tables) expect(await table.count()).toBe(0);
  });
  it("rolls back earlier deletions if any table fails", async () => {
    vi.spyOn(
      db.tables.find((table) => table.name === "pendingSync")!,
      "clear",
    ).mockRejectedValueOnce(new Error("Storage blocked"));
    await expect(clearAllLocal()).rejects.toThrow("Storage blocked");
    expect(await db.conversations.count()).toBe(1);
    expect(await db.kv.count()).toBe(1);
  });
  it("does not reset state or resolve successfully on a database failure", async () => {
    useAssistantStore.setState({ apiKey: "test-only-key" });
    vi.spyOn(
      db.tables.find((table) => table.name === "pendingSync")!,
      "clear",
    ).mockRejectedValueOnce(new Error("Deletion failed"));
    await expect(useAssistantStore.getState().wipeAll()).rejects.toThrow(
      "Deletion failed",
    );
    expect(useAssistantStore.getState().apiKey).toBe("test-only-key");
  });
  it("propagates localStorage failures rather than claiming preferences were deleted", async () => {
    vi.stubGlobal("window", {
      localStorage: {
        removeItem() {
          throw new Error("Blocked localStorage");
        },
      },
    });
    await expect(useAssistantStore.getState().wipeAll()).rejects.toThrow(
      "Blocked localStorage",
    );
  });
});

it('canvas deletion and export leave the separate encrypted vault alone',async()=>{await db.kv.put({key:'encrypted-vault:v1',value:{testOnly:'encrypted-envelope'}});try{expect((await exportAllLocal()).kv.some(row=>row.key==='encrypted-vault:v1')).toBe(false);await clearAllLocal();expect((await db.kv.get('encrypted-vault:v1'))?.value).toEqual({testOnly:'encrypted-envelope'});}finally{await db.kv.delete('encrypted-vault:v1');}});
