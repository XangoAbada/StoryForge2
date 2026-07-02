// Limity rozmiaru kontekstu Story Bible w promptach — chronią przed
// rozsadzeniem budżetu tokenów przy dużych projektach.
// ponytail: stałe limity per sekcja; konfigurowalność dodać, gdy ktoś o nią poprosi.

const DEFAULT_SECTION_LIMITS: Record<string, number> = {
  characters: 30,
  relations: 60,
  memories: 60,
  worldElements: 40,
  worldRules: 40
};

const FALLBACK_SECTION_LIMIT = 40;
const MAX_FIELD_CHARS = 600;

function truncateStringsDeep(value: unknown): unknown {
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
