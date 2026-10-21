// Validation for workspace captures before they are saved: kinds, title and
// body limits, due dates, money (two decimals, a supported currency).

import type { BrainItem, CaptureDraft } from "./model";
import { SUPPORTED_CURRENCIES, isSupportedCurrency } from "../locale/countries";
export const ITEM_KINDS = [
  "note",
  "task",
  "idea",
  "person",
  "project",
  "decision",
  "expense",
  "payment",
  "shopping",
  "habit",
] as const;
/** Currencies a record may use (see lib/locale/countries.ts). */
export const CURRENCIES = SUPPORTED_CURRENCIES;
export function validateCapture(draft: CaptureDraft): void {
  if (!ITEM_KINDS.includes(draft.kind))
    throw new Error("Choose a supported record type.");
  if (
    typeof draft.title !== "string" ||
    !draft.title.trim() ||
    draft.title.length > 120
  )
    throw new Error("Use a title between 1 and 120 characters.");
  if (typeof draft.body !== "string" || draft.body.length > 6000)
    throw new Error("Keep each capture under 6,000 characters.");
  if (draft.due && !Number.isFinite(Date.parse(draft.due)))
    throw new Error("Choose a valid due date.");
  if (
    draft.amount !== undefined &&
    (!Number.isFinite(draft.amount) ||
      draft.amount < 0 ||
      draft.amount > 1e12 ||
      Math.abs(draft.amount * 100 - Math.round(draft.amount * 100)) > 0.001)
  )
    throw new Error(
      "Use an amount from 0 to 1 trillion with at most two decimal places.",
    );
  if (draft.currency !== undefined && !isSupportedCurrency(draft.currency))
    throw new Error("Choose a supported currency.");
  if (draft.amount !== undefined && !draft.currency)
    throw new Error("Choose a currency for the amount.");
}
export function sameRecord(
  a: BrainItem | undefined,
  b: BrainItem | undefined,
): boolean {
  // IndexedDB preserves undefined fields; JSON drops them. Compare canonical keys instead of insertion order.
  if (!a || !b) return a === b;
  const canonical = (i: BrainItem) =>
    JSON.stringify([
      i.id,
      i.scope,
      i.kind,
      i.title,
      i.body,
      i.status,
      i.createdAt,
      i.updatedAt,
      i.due ?? null,
      i.amount ?? null,
      i.currency ?? null,
      [...i.links].sort(),
      i.source,
    ]);
  return canonical(a) === canonical(b);
}
