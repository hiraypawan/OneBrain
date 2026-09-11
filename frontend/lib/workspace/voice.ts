import {
  draftCapture,
  draftBrainDump,
  safeCalculation,
  summarizeDay,
  searchItems,
} from "./model";
import type { BrainItem, CaptureDraft } from "./model";
export type LocalIntent =
  | { type: "draft"; drafts: CaptureDraft[] }
  | { type: "answer"; text: string }
  | null;
export function interpretLocal(text: string, items: BrainItem[]): LocalIntent {
  const clean = text.trim();
  const calc = safeCalculation(clean);
  if (calc !== null) return { type: "answer", text: calc };
  if (
    /^(what am i forgetting|what(?:'s| is) my day|close my day|start my workday)[?.!]?$/i.test(
      clean,
    )
  )
    return { type: "answer", text: summarizeDay(items) };
  const search = clean.match(
    /^(?:search memory|find memory|recall)\s*:?\s+(.+)/i,
  );
  if (search) {
    const found = searchItems(items, search[1]).slice(0, 3);
    return {
      type: "answer",
      text: found.length
        ? found
            .map(
              (i) =>
                `${i.title}. Saved ${new Date(i.createdAt).toLocaleDateString()}.`,
            )
            .join(" ")
        : "I could not find that in this browser’s structured memory.",
    };
  }
  const dump = clean.match(/^brain dump\s*:\s*([\s\S]+)/i);
  if (dump) return { type: "draft", drafts: draftBrainDump(dump[1]) };
  if (
    /^(?:remember this|remember that|note|task|todo|idea|project|person|client|decision|expense|payment|shopping|habit)\s*:/i.test(
      clean,
    ) ||
    /^(?:remember (?:that |this )|log (?:₹|rs|inr|\$|usd)|we decided\b)/i.test(
      clean,
    )
  ) {
    return { type: "draft", drafts: [draftCapture(clean)] };
  }
  return null;
}
