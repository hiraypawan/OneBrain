"use client";
import { create } from "zustand";
import { db } from "../lib/db";
import { sameRecord, validateCapture } from "../lib/workspace/validation";
import { useAssistantStore } from "./assistant";
import type {
  ActionReceipt,
  BrainItem,
  CaptureDraft,
} from "../lib/workspace/model";

interface WorkspaceState {
  scope: string;
  ready: boolean;
  items: BrainItem[];
  receipts: ActionReceipt[];
  error: string | null;
  load: (scope: string) => Promise<void>;
  capture: (
    drafts: CaptureDraft[],
    source?: "typed" | "voice",
  ) => Promise<BrainItem[]>;
  update: (
    id: string,
    patch: Partial<
      Pick<
        BrainItem,
        "title" | "body" | "status" | "due" | "links" | "amount" | "currency"
      >
    >,
  ) => Promise<void>;
  remove: (id: string) => Promise<void>;
  undo: (receiptId: string) => Promise<void>;
  clear: () => Promise<void>;
}
let loadingVersion = 0;
// Serialize local actions so simultaneous click/voice updates cannot overwrite each other.
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const scope = useWorkspaceStore.getState().scope;
  const version = loadingVersion;
  const guarded = () => {
    if (
      scope !== useWorkspaceStore.getState().scope ||
      version !== loadingVersion
    )
      throw new Error("Workspace changed. Review the action again.");
    return fn();
  };
  const next = chain.then(guarded, guarded);
  chain = next.catch(() => {});
  return next;
}
function uuid() {
  return crypto.randomUUID();
}
function requireReady() {
  const state = useWorkspaceStore.getState();
  if (!state.ready)
    throw new Error("Workspace is still loading. Please try again.");
  return state;
}
function assertRelationships(
  disk: BrainItem[],
  before: BrainItem[],
  after: BrainItem[],
) {
  const replacing = new Set([...before, ...after].map((i) => i.id));
  const final = [...disk.filter((i) => !replacing.has(i.id)), ...after];
  const ids = new Set(final.map((i) => i.id));
  if (final.some((i) => i.links.some((id) => !ids.has(id))))
    throw new Error(
      "A related record changed in another tab or is session-only. Reload the workspace and review its links.",
    );
}
async function commit(
  operation: ActionReceipt["operation"],
  before: BrainItem[],
  after: BrainItem[],
  summary: string,
) {
  const state = requireReady();
  const persist = useAssistantStore.getState().settings.memoryEnabled;
  const receipt: ActionReceipt = {
    id: uuid(),
    scope: state.scope,
    at: Date.now(),
    operation,
    status: persist ? "verified-local" : "session-only",
    summary,
    before,
    after,
    itemIds: [...new Set([...before, ...after].map((i) => i.id))],
    destination: "This browser",
  };
  if (persist) {
    await db.transaction("rw", db.brainItems, db.actionReceipts, async () => {
      for (const original of before) {
        if (!sameRecord(await db.brainItems.get(original.id), original))
          throw new Error(
            "This record changed in another tab or while Memory was off. Reload the workspace before editing.",
          );
      }
      const diskItems = await db.brainItems
        .where("scope")
        .equals(state.scope)
        .toArray();
      assertRelationships(diskItems, before, after);
      await db.brainItems.bulkDelete(
        before
          .filter((b) => !after.some((a) => a.id === b.id))
          .map((i) => i.id),
      );
      if (after.length) await db.brainItems.bulkPut(after);
      await db.actionReceipts.add(receipt);
      // A local receipt is verified only after the atomic transaction commits.
    });
  }
  if (useWorkspaceStore.getState().scope !== state.scope) return;
  const replaced = new Set([...before, ...after].map((i) => i.id));
  useWorkspaceStore.setState((s) => ({
    items: [...s.items.filter((i) => !replaced.has(i.id)), ...after].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    ),
    receipts: [receipt, ...s.receipts],
    error: null,
  }));
}
export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  scope: "device",
  ready: false,
  items: [],
  receipts: [],
  error: null,
  load: async (scope) => {
    const version = ++loadingVersion;
    set({ scope, ready: false, items: [], receipts: [], error: null });
    try {
      const [items, receipts] = await Promise.all([
        db.brainItems.where("scope").equals(scope).toArray(),
        db.actionReceipts.where("scope").equals(scope).toArray(),
      ]);
      if (version !== loadingVersion) return;
      set({
        ready: true,
        items: items.sort((a, b) => b.updatedAt - a.updatedAt),
        receipts: receipts.sort((a, b) => b.at - a.at),
      });
    } catch {
      if (version === loadingVersion)
        set({
          error: "Local storage is unavailable. Nothing has been saved.",
          ready: false,
        });
    }
  },
  capture: (drafts, source = "typed") =>
    serialize(async () => {
      const state = requireReady();
      if (
        !drafts.length ||
        drafts.length > 30 ||
        drafts.some((d) => !d.title.trim() || d.body.length > 6000)
      )
        throw new Error(
          "Add 1–30 non-empty items, each under 6,000 characters.",
        );
      drafts.forEach(validateCapture);
      const now = Date.now();
      const items: BrainItem[] = drafts.map((d) => ({
        ...d,
        title: d.title.trim().slice(0, 120),
        id: uuid(),
        scope: state.scope,
        source,
        status: "active",
        createdAt: now,
        updatedAt: now,
        links: [],
      }));
      await commit(
        "capture",
        [],
        items,
        `Captured ${items.length} item${items.length === 1 ? "" : "s"} locally`,
      );
      return items;
    }),
  update: (id, patch) =>
    serialize(async () => {
      const state = requireReady(),
        old = state.items.find((i) => i.id === id);
      if (!old) throw new Error("Item not found in this workspace.");
      if (patch.title !== undefined && !patch.title.trim())
        throw new Error("A title is required.");
      if (
        patch.links?.some(
          (link) => link === id || !state.items.some((i) => i.id === link),
        )
      )
        throw new Error("Choose related items from this workspace.");
      if (patch.due && !Number.isFinite(Date.parse(patch.due)))
        throw new Error("Choose a valid date.");
      if (
        patch.amount !== undefined &&
        (!Number.isFinite(patch.amount) || patch.amount < 0)
      )
        throw new Error("Enter a valid positive amount.");
      // Do not permit runtime callers to replace identity, ownership or source fields.
      const allowed = Object.fromEntries(
        Object.entries(patch).filter(([key]) =>
          [
            "title",
            "body",
            "status",
            "due",
            "links",
            "amount",
            "currency",
          ].includes(key),
        ),
      );
      if (
        allowed.status !== undefined &&
        !["active", "done"].includes(String(allowed.status))
      )
        throw new Error("Choose a valid status.");
      const next = {
        ...old,
        ...allowed,
        updatedAt: Math.max(Date.now(), old.updatedAt + 1),
      };
      validateCapture(next);
      next.links = [...new Set(next.links)];
      await commit("update", [old], [next], `Updated “${next.title}” locally`);
    }),
  remove: (id) =>
    serialize(async () => {
      const state = requireReady(),
        old = state.items.find((i) => i.id === id);
      if (!old) throw new Error("Item not found.");
      const connected = state.items.filter((i) => i.links.includes(id));
      await commit(
        "delete",
        [old, ...connected],
        connected.map((i) => ({
          ...i,
          links: i.links.filter((l) => l !== id),
          updatedAt: Date.now(),
        })),
        `Deleted “${old.title}” locally`,
      );
    }),
  undo: (receiptId) =>
    serialize(async () => {
      const state = requireReady(),
        r = state.receipts.find((r) => r.id === receiptId);
      if (!r || r.status === "undone" || r.operation === "undo")
        throw new Error("This action cannot be undone.");
      for (const after of r.after) {
        const current = state.items.find((i) => i.id === after.id);
        if (!sameRecord(current, after))
          throw new Error(
            "This item changed after that action. Undo newer changes first.",
          );
      }
      for (const before of r.before.filter(
        (b) => !r.after.some((a) => a.id === b.id),
      )) {
        if (state.items.some((i) => i.id === before.id))
          throw new Error("The deleted item has already been restored.");
      }
      const removedIds = new Set(
        r.after
          .filter((a) => !r.before.some((b) => b.id === a.id))
          .map((i) => i.id),
      );
      const hasNewLinks = (items: BrainItem[]) =>
        items.some(
          (i) =>
            !r.itemIds.includes(i.id) &&
            i.links.some((id) => removedIds.has(id)),
        );
      if (hasNewLinks(state.items))
        throw new Error(
          "Other records now link to this item. Remove or undo those links first.",
        );
      const persist = useAssistantStore.getState().settings.memoryEnabled;
      const undoReceipt: ActionReceipt = {
        ...r,
        id: uuid(),
        at: Date.now(),
        operation: "undo",
        before: r.after,
        after: r.before,
        status: persist ? "verified-local" : "session-only",
        summary: `Undid: ${r.summary}`,
      };
      if (persist)
        await db.transaction(
          "rw",
          db.brainItems,
          db.actionReceipts,
          async () => {
            const savedReceipt = await db.actionReceipts.get(r.id);
            if (!savedReceipt || savedReceipt.status === "undone")
              throw new Error(
                "This action changed in another tab or was session-only. Reload the workspace.",
              );
            for (const after of r.after) {
              if (!sameRecord(await db.brainItems.get(after.id), after))
                throw new Error(
                  "This record changed in another tab. Reload the workspace before undoing.",
                );
            }
            for (const original of r.before.filter(
              (b) => !r.after.some((a) => a.id === b.id),
            )) {
              if (await db.brainItems.get(original.id))
                throw new Error(
                  "This item has already been restored in another tab.",
                );
            }
            const diskItems = await db.brainItems
              .where("scope")
              .equals(state.scope)
              .toArray();
            assertRelationships(diskItems, r.after, r.before);
            if (hasNewLinks(diskItems))
              throw new Error(
                "Other records now link to this item. Reload and remove those links first.",
              );
            await db.brainItems.bulkDelete(
              r.after
                .filter((a) => !r.before.some((b) => b.id === a.id))
                .map((i) => i.id),
            );
            if (r.before.length) await db.brainItems.bulkPut(r.before);
            await db.actionReceipts.update(r.id, { status: "undone" });
            await db.actionReceipts.add(undoReceipt);
          },
        );
      if (get().scope !== state.scope) return;
      const affected = new Set(r.itemIds);
      set((s) => ({
        items: [...s.items.filter((i) => !affected.has(i.id)), ...r.before],
        receipts: [
          undoReceipt,
          ...s.receipts.map((i) =>
            i.id === r.id ? { ...i, status: "undone" as const } : i,
          ),
        ],
      }));
    }),
  clear: () =>
    serialize(async () => {
      const scope = get().scope;
      await db.transaction("rw", db.brainItems, db.actionReceipts, async () => {
        await db.brainItems.where("scope").equals(scope).delete();
        await db.actionReceipts.where("scope").equals(scope).delete();
      });
      if (get().scope === scope) set({ items: [], receipts: [] });
    }),
}));
