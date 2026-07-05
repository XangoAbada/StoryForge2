// Lokalne statystyki manuskryptu — czysty TS, bez AI. Liczone z HTML scen
// (TipTap), agregowane per rozdział i książka. Heurystyki językowe (przysłówki)
// są przybliżeniem i tak są opisane w UI.

import type { Chapter, Scene } from "../../shared/api/types";
import { htmlToPlainText } from "../../shared/text/plainText";

export type RepeatedPhrase = { phrase: string; count: number };

export type SceneStats = {
  sceneId: string;
  wordCount: number;
  sentenceCount: number;
  avgSentenceLength: number;
  /** Udział słów w akapitach dialogowych (0-1). */
  dialogueRatio: number;
  /** Przysłówki (heurystyka) na 1000 słów. */
  adverbRate: number;
  repeatedPhrases: RepeatedPhrase[];
  topWords: RepeatedPhrase[];
};

export type ChapterStats = {
  chapterId: string;
  sceneCount: number;
  wordCount: number;
  avgSentenceLength: number;
  dialogueRatio: number;
  adverbRate: number;
};

export type BookStats = {
  wordCount: number;
  sceneCount: number;
  chapterCount: number;
  avgSceneLength: number;
  avgSentenceLength: number;
  dialogueRatio: number;
  adverbRate: number;
  repeatedPhrases: RepeatedPhrase[];
  topWords: RepeatedPhrase[];
};

export function computeSceneStats(scene: Pick<Scene, "id" | "manuscriptContent">): SceneStats {
  const paragraphs = htmlToParagraphs(scene.manuscriptContent ?? "");
  const plain = paragraphs.join("\n");
  const words = tokenize(plain);
  const wordCount = words.length;

  const sentences = plain
    .split(/[.!?…]+(?=\s|$)/)
    .map((item) => item.trim())
    .filter(Boolean);
  const sentenceCount = sentences.length;

  let dialogueWords = 0;
  for (const paragraph of paragraphs) {
    if (isDialogueParagraph(paragraph)) {
      dialogueWords += tokenize(paragraph).length;
    }
  }

  const adverbCount = words.filter(isLikelyAdverb).length;

  return {
    sceneId: scene.id,
    wordCount,
    sentenceCount,
    avgSentenceLength: sentenceCount > 0 ? round1(wordCount / sentenceCount) : 0,
    dialogueRatio: wordCount > 0 ? round3(dialogueWords / wordCount) : 0,
    adverbRate: wordCount > 0 ? round1((adverbCount / wordCount) * 1000) : 0,
    repeatedPhrases: repeatedNgrams(words, 10),
    topWords: topContentWords(words, 10)
  };
}

export function computeChapterStats(
  chapter: Pick<Chapter, "id">,
  sceneStats: SceneStats[]
): ChapterStats {
  const wordCount = sum(sceneStats.map((item) => item.wordCount));
  const sentenceCount = sum(sceneStats.map((item) => item.sentenceCount));
  const dialogueWords = sum(
    sceneStats.map((item) => item.dialogueRatio * item.wordCount)
  );
  const adverbs = sum(sceneStats.map((item) => (item.adverbRate * item.wordCount) / 1000));

  return {
    chapterId: chapter.id,
    sceneCount: sceneStats.length,
    wordCount,
    avgSentenceLength: sentenceCount > 0 ? round1(wordCount / sentenceCount) : 0,
    dialogueRatio: wordCount > 0 ? round3(dialogueWords / wordCount) : 0,
    adverbRate: wordCount > 0 ? round1((adverbs / wordCount) * 1000) : 0
  };
}

export function computeBookStats(
  scenes: Array<Pick<Scene, "id" | "manuscriptContent">>,
  chapterCount: number
): BookStats {
  const sceneStats = scenes.map(computeSceneStats);
  const wordCount = sum(sceneStats.map((item) => item.wordCount));
  const sentenceCount = sum(sceneStats.map((item) => item.sentenceCount));
  const dialogueWords = sum(
    sceneStats.map((item) => item.dialogueRatio * item.wordCount)
  );
  const adverbs = sum(sceneStats.map((item) => (item.adverbRate * item.wordCount) / 1000));
  const allWords = scenes.flatMap((scene) =>
    tokenize(htmlToParagraphs(scene.manuscriptContent ?? "").join("\n"))
  );

  return {
    wordCount,
    sceneCount: scenes.length,
    chapterCount,
    avgSceneLength: scenes.length > 0 ? Math.round(wordCount / scenes.length) : 0,
    avgSentenceLength: sentenceCount > 0 ? round1(wordCount / sentenceCount) : 0,
    dialogueRatio: wordCount > 0 ? round3(dialogueWords / wordCount) : 0,
    adverbRate: wordCount > 0 ? round1((adverbs / wordCount) * 1000) : 0,
    repeatedPhrases: repeatedNgrams(allWords, 15),
    topWords: topContentWords(allWords, 15)
  };
}

/** Akapity HTML (<p>, <li>...) jako czysty tekst — kolejność zachowana. */
export function htmlToParagraphs(html: string): string[] {
  if (!html.trim()) {
    return [];
  }
  return html
    .split(/<\/(?:p|li|h[1-6]|blockquote|div)>/i)
    .map((chunk) => htmlToPlainText(chunk))
    .filter(Boolean);
}

/** Polski zapis dialogu: akapit zaczyna się pauzą/półpauzą albo cudzysłowem otwierającym. */
export function isDialogueParagraph(paragraph: string): boolean {
  return /^[\s]*[—–\-„"]/.test(paragraph);
}

function tokenize(text: string): string[] {
  return text
    .toLocaleLowerCase("pl-PL")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// Heurystyka przysłówków PL: szerokie -ie/-o łapie za dużo rzeczowników
// i przymiotników, więc: (a) jawna lista częstych przysłówków stylistycznych,
// (b) dłuższe słowa z typowo przysłówkowymi końcówkami minus stoplista.
const COMMON_ADVERBS = new Set([
  "nagle", "szybko", "wolno", "powoli", "cicho", "głośno", "bardzo", "trochę",
  "prawie", "zupełnie", "całkiem", "naprawdę", "właściwie", "dokładnie",
  "delikatnie", "gwałtownie", "ostrożnie", "spokojnie", "nerwowo", "niepewnie",
  "pewnie", "mocno", "lekko", "ciężko", "łatwo", "trudno", "dziwnie",
  "dobrze", "źle", "świetnie", "strasznie", "okropnie", "niesamowicie",
  "natychmiast", "wkrótce", "wreszcie", "nareszcie", "ledwo", "ledwie",
  "chyba", "może", "zapewne", "widocznie", "wyraźnie", "niemal", "jedynie",
  "tylko", "znowu", "znów", "wciąż", "ciągle", "stale", "często", "rzadko",
  "zawsze", "nigdy", "czasem", "czasami", "teraz", "potem", "później",
  "wcześniej", "dzisiaj", "wczoraj", "jutro", "obok", "blisko", "daleko",
  "wysoko", "nisko", "głęboko", "długo", "krótko", "chwilowo", "ponownie",
  "milcząco", "bezgłośnie", "pospiesznie", "pośpiesznie", "uważnie", "czule",
  "gniewnie", "smutno", "wesoło", "radośnie", "gorzko", "chłodno", "ciepło"
]);

const ADVERB_SUFFIX_STOPLIST = new Set([
  "właśnie", "zdanie", "wydarzenie", "spotkanie", "mieszkanie", "śniadanie",
  "ubranie", "pytanie", "zadanie", "wrażenie", "spojrzenie", "westchnienie",
  "milczenie", "istnienie", "zdziwienie", "zmęczenie", "przerażenie",
  "zaskoczenie", "uczucie", "przyjęcie", "wspomnienie", "marzenie",
  "znaczenie", "położenie", "pomieszczenie", "oświetlenie", "sklepienie",
  "kamienie", "ramienie", "imienie", "płomienie", "cienie", "drewnianie",
  "zdrowie", "krwie", "brwie"
]);

export function isLikelyAdverb(word: string): boolean {
  if (COMMON_ADVERBS.has(word)) {
    return true;
  }
  if (word.length < 6 || ADVERB_SUFFIX_STOPLIST.has(word)) {
    return false;
  }
  return /(?:ecznie|alnie|ąco|wnie|rnie|lnie|znie|czo|szo)$/.test(word);
}

const STOP_WORDS = new Set([
  "się", "nie", "jak", "ale", "tak", "już", "tylko", "jego", "jej", "ich",
  "tego", "tym", "tej", "ten", "tam", "tutaj", "gdzie", "kiedy", "jeszcze",
  "przez", "przed", "przy", "pod", "nad", "dla", "bez", "być", "był", "była",
  "było", "byli", "jest", "są", "będzie", "mnie", "ciebie", "niego", "niej",
  "nas", "was", "nich", "coś", "ktoś", "czego", "czym", "który", "która",
  "które", "których", "którym", "wszystko", "wszyscy", "żeby", "aby", "bo",
  "ponieważ", "więc", "albo", "lub", "ani", "gdy", "gdyby", "jeśli", "chociaż",
  "może", "mógł", "mogła", "miał", "miała", "mieć", "swoje", "swoją", "swój",
  "jednak", "potem", "wtedy", "teraz", "nawet", "niż", "sobie", "siebie"
]);

function topContentWords(words: string[], limit: number): RepeatedPhrase[] {
  const counts = new Map<string, number>();
  for (const word of words) {
    if (word.length < 4 || STOP_WORDS.has(word)) {
      continue;
    }
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([phrase, count]) => ({ phrase, count }));
}

function repeatedNgrams(words: string[], limit: number): RepeatedPhrase[] {
  const counts = new Map<string, number>();
  for (const size of [3, 4]) {
    for (let index = 0; index + size <= words.length; index += 1) {
      const gram = words.slice(index, index + size).join(" ");
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
  }
  const entries = [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);

  // 4-gram zawiera swoje 3-gramy — pokaż tylko najdłuższą wersję frazy.
  const result: RepeatedPhrase[] = [];
  for (const [phrase, count] of entries) {
    if (result.some((item) => item.phrase.includes(phrase) && item.count >= count)) {
      continue;
    }
    result.push({ phrase, count });
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
