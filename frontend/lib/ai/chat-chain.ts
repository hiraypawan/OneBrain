// A3 split: the chat chain's request helper, moved out of the voice hook so
// useAssistant keeps only the React wiring. Brain chain lives in @/lib/ai/brain so
// feature modes share it (identical behavior for normal chat: Wikipedia ->
// Puter -> API route -> offline). The provider is recorded so the UI can say
// honestly who answered.
import { askBrainDetailed } from "@/lib/ai/brain";
import { activeLocale } from "@/lib/locale/active";
import { useFeaturesStore } from "@/store/features";
import { useAssistantStore } from "@/store/assistant";

export interface ChatExtra {
  profile?: string;
  recall?: string;
  verbosity?: string;
  language?: string;
  onChunk?: (text: string) => void;
  shouldContinue?: () => boolean;
}

export async function fetchChat(
  message: string,
  history: { role: string; content: string }[],
  userKey?: string,
  extra?: ChatExtra,
) {
  // Every turn carries where the user is and how they talk, so the model
  // answers with their clock, units, money and language (lib/locale).
  const locale = activeLocale();
  const language = extra?.language && extra.language !== "auto" ? extra.language : locale.voice.id;
  const detailed = await askBrainDetailed(message, history, userKey, {
    ...extra,
    language,
    country: locale.country ?? undefined,
    timeZone: locale.timeZone ?? undefined,
    priority: useFeaturesStore.getState().plan !== "free",
  });
  try {
    useAssistantStore.getState().setLastProvider(detailed.provider);
  } catch {}
  return detailed.text;
}
