// Light-weight "which language is this text in" for the languages OneBrain
// speaks. Two uses: the prompt answers in the language the user actually
// typed this turn, and speech picks a voice that can read the reply.
// Script first (unambiguous), then common-word counts for Latin-script
// languages. Deliberately conservative: when unsure it returns null and the
// caller keeps the user's own language. Pure, no DOM.

import type { ReplyLanguage } from './voice-languages';

export type ScriptLanguage = Extract<ReplyLanguage, 'japanese' | 'korean' | 'chinese' | 'arabic'>;

/** Languages identified by their writing system alone. Devanagari is left to the caller (Hindi vs Marathi). */
export function scriptLanguage(text: string): ScriptLanguage | null {
  const t = String(text || '');
  // Kana before Han: Japanese mixes kanji (Han) with kana, Chinese never uses kana.
  if (/[\u3040-\u30FF]/.test(t)) return 'japanese';
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(t)) return 'korean';
  if (/[\u4E00-\u9FFF]/.test(t)) return 'chinese';
  if (/[\u0600-\u06FF]/.test(t)) return 'arabic';
  return null;
}

type LatinLanguage = Extract<ReplyLanguage,
  'english' | 'spanish' | 'french' | 'german' | 'italian' | 'portuguese' | 'dutch' |
  'swedish' | 'danish' | 'norwegian' | 'finnish' | 'polish' | 'turkish'>;

// Frequent, fairly distinctive words. Overlaps between languages are fine:
// the decision needs a clear winner, not a single hit.
const WORDS: Record<LatinLanguage, ReadonlySet<string>> = {
  english: new Set(('the you your are was were this that what how why when where which with and have has will would ' +
    'could should they from about there here just been today tomorrow please thanks of is it not yes my we can our ' +
    "an it's i'm don't can't me").split(' ')),
  spanish: new Set(('el la los las que y en un una es por para con no sí qué cómo dónde cuándo está estoy hola gracias ' +
    'pero muy también hoy mañana necesito quiero puedes tengo mi tu del al lo se').split(' ')),
  french: new Set(("le la les des du de et est un une je tu il elle nous vous que qui pas ne pour avec dans sur bonjour " +
    "merci oui non c'est très aujourd'hui demain comment pourquoi où mon ma mes").split(' ')),
  german: new Set(('der die das und ist nicht ich du sie wir ihr ein eine zu mit auf für von den dem was wie warum wo ' +
    'hallo danke bitte ja nein heute morgen kannst können mein meine auch aber').split(' ')),
  italian: new Set(('il lo la gli le di che e è un una per con non sono sei come perché dove quando ciao grazie sì oggi ' +
    'domani voglio posso mio mia anche ma del della').split(' ')),
  portuguese: new Set(('o a os as de que e é um uma para com não sim como onde quando porque olá obrigado obrigada você ' +
    'hoje amanhã quero posso meu minha também mas do da dos das está estou').split(' ')),
  dutch: new Set(('de het een en is niet ik jij je wij we zij van met op voor wat hoe waarom waar hallo dank bedankt ' +
    'ja nee vandaag morgen kun kunt mijn ook maar dat dit').split(' ')),
  swedish: new Set(('och är inte jag du vi de det en ett att med på för av vad hur varför var hej tack ja nej idag ' +
    'imorgon kan min också men som').split(' ')),
  danish: new Set(('og er ikke jeg du vi de det en et at med på for af hvad hvordan hvorfor hvor hej tak ja nej kan ' +
    'min også men som').split(' ')),
  norwegian: new Set(('og er ikke jeg du vi de det en et å med på for av hva hvordan hvorfor hvor hei takk ja nei kan ' +
    'min også men som').split(' ')),
  finnish: new Set(('ja on ei minä sinä me he se että kanssa mitä miten miksi missä hei kiitos kyllä tänään huomenna ' +
    'voi voitko minun myös mutta ole olen').split(' ')),
  polish: new Set(('i w nie jest to na że się z do co jak dlaczego gdzie kiedy cześć dziękuję tak dzisiaj jutro mogę ' +
    'możesz mój moja też ale czy jestem').split(' ')),
  turkish: new Set(('ve bir bu da de için ile ne nasıl neden nerede merhaba teşekkür teşekkürler evet hayır bugün yarın ' +
    'değil benim ama mı mi var yok').split(' ')),
};

const LATIN = Object.keys(WORDS) as LatinLanguage[];

function words(text: string): string[] {
  return String(text || '').toLowerCase().match(/[\p{L}']+/gu) ?? [];
}

/** How many words of `text` belong to each Latin-script language's list. */
export function latinScores(text: string): Record<LatinLanguage, number> & { total: number } {
  const list = words(text);
  const scores = Object.fromEntries(LATIN.map((lang) => [lang, 0])) as Record<LatinLanguage, number>;
  for (const word of list) for (const lang of LATIN) if (WORDS[lang].has(word)) scores[lang] += 1;
  return { ...scores, total: list.length };
}

/**
 * The Latin-script language `text` is clearly written in, or null. "Clearly"
 * means at least two list words, a strict lead over every other language, and
 * list words making up a fair share of the text.
 */
export function detectLatinLanguage(text: string): LatinLanguage | null {
  const scores = latinScores(text);
  let best: LatinLanguage | null = null;
  let bestScore = 0;
  let runnerUp = 0;
  for (const lang of LATIN) {
    const score = scores[lang];
    if (score > bestScore) { runnerUp = bestScore; best = lang; bestScore = score; }
    else if (score > runnerUp) runnerUp = score;
  }
  if (!best || bestScore < 2 || bestScore === runnerUp) return null;
  return bestScore / Math.max(1, scores.total) >= 0.2 ? best : null;
}

/** Whether `text` reads as English rather than `other` (for picking a voice). */
export function looksEnglish(text: string, other: ReplyLanguage): boolean {
  const scores = latinScores(text);
  const theirs = (scores as Record<string, number>)[other] ?? 0;
  return scores.english > theirs && scores.english / Math.max(1, scores.total) >= 0.15;
}
