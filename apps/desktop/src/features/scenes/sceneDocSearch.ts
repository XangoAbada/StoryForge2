// Wyszukiwanie dosłownego cytatu (z krytyki AI) w dokumencie ProseMirror.
// Zwraca zakres pozycji PM do zaznaczenia. Odporne na różnice białych znaków,
// typograficzne cudzysłowy i pauzy; fallback: dopasowanie początku cytatu.

type DocNodeLike = {
  isText?: boolean;
  text?: string | null;
};

export type DocLike = {
  descendants(callback: (node: DocNodeLike, pos: number) => boolean | void): void;
};

export type DocRange = { from: number; to: number };

const QUOTE_PREFIX_FALLBACK_LENGTH = 60;

export function findQuoteRangeInDoc(doc: DocLike, quote: string): DocRange | null {
  const needle = normalizeForSearch(quote);
  if (!needle) {
    return null;
  }

  const { text: haystack, positions } = collectDocText(doc);
  if (!haystack) {
    return null;
  }

  let index = haystack.indexOf(needle);
  let matchLength = needle.length;
  if (index === -1 && needle.length > QUOTE_PREFIX_FALLBACK_LENGTH) {
    const prefix = needle.slice(0, QUOTE_PREFIX_FALLBACK_LENGTH).trimEnd();
    index = haystack.indexOf(prefix);
    matchLength = prefix.length;
  }
  if (index === -1) {
    return null;
  }

  // Separatory bloków nie mają pozycji w dokumencie — przytnij do znaków mapowanych.
  let startIndex = index;
  let endIndex = index + matchLength - 1;
  while (startIndex <= endIndex && positions[startIndex] === null) {
    startIndex += 1;
  }
  while (endIndex >= startIndex && positions[endIndex] === null) {
    endIndex -= 1;
  }
  const from = positions[startIndex];
  const lastPos = positions[endIndex];
  if (from === null || from === undefined || lastPos === null || lastPos === undefined) {
    return null;
  }

  return { from, to: lastPos + 1 };
}

function collectDocText(doc: DocLike): { text: string; positions: Array<number | null> } {
  const chars: string[] = [];
  const positions: Array<number | null> = [];
  let lastTextEnd = -1;

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      return;
    }
    // Przerwa w pozycjach = granica bloku (tokeny otwarcia/zamknięcia) — wstaw
    // separator bez mapowania, żeby cytaty przez granicę akapitu się kleiły.
    if (lastTextEnd !== -1 && pos > lastTextEnd) {
      pushChar(chars, positions, " ", null);
    }
    for (let index = 0; index < node.text.length; index += 1) {
      pushChar(chars, positions, normalizeChar(node.text[index]), pos + index);
    }
    lastTextEnd = pos + node.text.length;
  });

  return { text: chars.join(""), positions };
}

function pushChar(
  chars: string[],
  positions: Array<number | null>,
  char: string,
  pos: number | null
) {
  // Zbijaj ciągi białych znaków do jednej spacji (jak normalizeForSearch).
  if (char === " " && chars.length > 0 && chars[chars.length - 1] === " ") {
    return;
  }
  if (char === " " && chars.length === 0) {
    return;
  }
  chars.push(char);
  positions.push(pos);
}

function normalizeForSearch(text: string): string {
  let result = "";
  for (const char of text) {
    result += normalizeChar(char);
  }
  return result.replace(/ {2,}/g, " ").trim();
}

function normalizeChar(char: string): string {
  if (/\s/.test(char)) {
    return " ";
  }
  if (char === "„" || char === "”" || char === "“" || char === "«" || char === "»" || char === "\"") {
    return "\"";
  }
  if (char === "’" || char === "‘" || char === "'") {
    return "'";
  }
  if (char === "—" || char === "–") {
    return "-";
  }
  return char;
}
