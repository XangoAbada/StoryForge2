import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { router } from "../../app/router";

// Klik przycisku AI przy POJEDYNCZYM polu przenosi do brainstormingu i startuje
// nową sesję o tym polu (seed wysyłany automatycznie). Temat budujemy z etykiety
// pola + nazwy encji; pełny kontekst i tak dowozi prompt package brainstormu, więc
// treść pola przycinamy do sensownego podglądu.
//
// Nawigujemy przez singleton `router` (a nie hooki useNavigate/useParams), żeby
// komponenty pól dało się montować w testach bez RouterProvider — dostęp do routera
// następuje dopiero w callbacku (na klik), nie podczas renderu.
const SEED_VALUE_MAX = 400;

export type BrainstormFieldSeed = {
  fieldLabel: string;
  entityName?: string;
  value?: string;
};

function currentProjectId(): string | undefined {
  const match = /\/projects\/([^/]+)/.exec(router.state.location.pathname);
  return match?.[1];
}

export function useBrainstormField(): (seed: BrainstormFieldSeed) => void {
  const { t } = useTranslation();

  return useCallback(
    ({ fieldLabel, entityName, value }: BrainstormFieldSeed) => {
      const projectId = currentProjectId();
      if (!projectId) {
        return;
      }
      const trimmed = value?.trim() ?? "";
      const preview =
        trimmed.length > SEED_VALUE_MAX ? `${trimmed.slice(0, SEED_VALUE_MAX)}…` : trimmed;
      const entity = entityName?.trim();
      const key = trimmed
        ? entity
          ? "brainstorm.fieldSeed"
          : "brainstorm.fieldSeedNoEntity"
        : entity
          ? "brainstorm.fieldSeedEmpty"
          : "brainstorm.fieldSeedEmptyNoEntity";
      const seed = t(key, { field: fieldLabel, entity: entity ?? "", value: preview });
      const topic = entity ? `${fieldLabel} — ${entity}` : fieldLabel;
      void router.navigate({
        to: "/projects/$projectId/brainstorm",
        params: { projectId },
        search: { seed, topic }
      });
    },
    [t]
  );
}
