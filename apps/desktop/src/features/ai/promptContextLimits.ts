// Limity rozmiaru kontekstu Story Bible w promptach — chronią przed
// rozsadzeniem budżetu tokenów przy dużych projektach.
// ponytail: stałe limity per sekcja; konfigurowalność dodać, gdy ktoś o nią poprosi.

import type { Character, CharacterMemory, CharacterRelation } from "../../shared/api/types";

const DEFAULT_SECTION_LIMITS: Record<string, number> = {
  characters: 30,
  relations: 60,
  memories: 60,
  worldElements: 40,
  worldRules: 40
};

const FALLBACK_SECTION_LIMIT = 40;
const MAX_FIELD_CHARS = 600;

export function truncateStringsDeep(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > MAX_FIELD_CHARS
      ? `${value.slice(0, MAX_FIELD_CHARS)}…`
      : value;
  }
  if (Array.isArray(value)) {
    return value.map(truncateStringsDeep);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        truncateStringsDeep(entry)
      ])
    );
  }
  return value;
}

/**
 * Serializuje obiekt Story Bible (mapę sekcji-tablic) z limitem liczby wpisów
 * per sekcja i przycięciem długich pól tekstowych. Kompaktowy JSON (bez
 * pretty-print) oszczędza ~30% tokenów.
 */
export function renderCappedStoryBible(
  storyBible: Record<string, unknown>
): string {
  const capped: Record<string, unknown> = {};
  const omissions: string[] = [];

  for (const [key, value] of Object.entries(storyBible)) {
    if (Array.isArray(value)) {
      const limit = DEFAULT_SECTION_LIMITS[key] ?? FALLBACK_SECTION_LIMIT;
      capped[key] = truncateStringsDeep(value.slice(0, limit));
      if (value.length > limit) {
        omissions.push(`${key}: pominięto ${value.length - limit} kolejnych wpisów`);
      }
    } else {
      capped[key] = truncateStringsDeep(value);
    }
  }

  const json = JSON.stringify(capped);
  return omissions.length
    ? `${json}\n(Ograniczono kontekst Story Bible — ${omissions.join("; ")}.)`
    : json;
}

/**
 * Linia kontekstu "Etykieta: wartość" — pomijana w całości, gdy wartość jest
 * pusta (zamiast placeholdera "(brak)", który uczy model zwracania "(brak)").
 */
export function optionalLine(
  label: string,
  value: string | number | null | undefined,
  prefix = ""
): string {
  const text = typeof value === "number" ? String(value) : value?.trim();
  return text ? `${prefix}${label}: ${text}` : "";
}

/**
 * Serializuje pojedynczą listę wpisów (np. postacie w prompcie planu)
 * z limitem liczby wpisów i przycięciem długich pól.
 */
export function renderCappedEntityList(
  items: unknown[],
  maxItems: number
): string {
  const capped = truncateStringsDeep(items.slice(0, maxItems));
  const json = JSON.stringify(capped);
  return items.length > maxItems
    ? `${json} (pominięto ${items.length - maxItems} kolejnych wpisów)`
    : json;
}

/**
 * Sortuje wpisy tak, by encje istotne dla bieżącego celu (np. powiązane ze
 * sceną) trafiły przed limit sekcji, a nie wypadły przez przypadkowy
 * order_index. Stabilne: w obrębie grupy zachowuje kolejność wejściową,
 * opcjonalny `score` (malejąco) rozstrzyga wewnątrz grup.
 */
export function prioritizeEntities<T>(
  items: T[],
  isPriority: (item: T) => boolean,
  score?: (item: T) => number
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const priorityDiff = Number(isPriority(b.item)) - Number(isPriority(a.item));
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      const scoreDiff = (score?.(b.item) ?? 0) - (score?.(a.item) ?? 0);
      return scoreDiff !== 0 ? scoreDiff : a.index - b.index;
    })
    .map(({ item }) => item);
}

// Wspólne kompakty encji Story Bible — jedna reprezentacja we wszystkich
// pakietach promptów (plan, postacie, sceny).
export function compactCharacter(character: Character | null | undefined) {
  return character
    ? {
        id: character.id,
        type: character.characterType,
        name: character.name,
        role: character.role,
        description: character.shortDescription,
        goal: character.externalGoal,
        need: character.internalNeed,
        voice: character.voiceNotes,
        arc: character.arcSummary,
        status: character.status
      }
    : null;
}

export function compactRelation(relation: CharacterRelation) {
  return {
    id: relation.id,
    fromCharacterId: relation.fromCharacterId,
    toCharacterId: relation.toCharacterId,
    relationType: relation.relationType,
    description: relation.description,
    conflict: relation.conflict,
    opinion: relation.opinion,
    trustLevel: scaleLabel(relation.trustLevel)
  };
}

export function compactMemory(memory: CharacterMemory) {
  return {
    id: memory.id,
    characterId: memory.characterId,
    title: memory.title,
    summary: memory.summary,
    subject: memory.subject,
    emotion: memory.emotion,
    importance: scaleLabel(memory.importance)
  };
}

/** Goła liczba 0-100 nic modelowi nie mówi — dokleja słowną skalę. */
function scaleLabel(value: number | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const label = value >= 67 ? "wysoki" : value >= 34 ? "średni" : "niski";
  return `${value}/100 (${label})`;
}
