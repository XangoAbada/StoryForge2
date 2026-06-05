import { Image as ImageIcon, Loader2, Plus, Save, Sparkles, X } from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import {
  checkCodexCli,
  generateBookCover,
  getProject,
  runCodexPrompt,
  updateBookConcept
} from "../../shared/api/commands";
import { isTauriRuntime } from "../../shared/api/browserDevCommands";
import type {
  BookConceptInput,
  CoverGenerationProgressEvent
} from "../../shared/api/types";
import { coverImageSource } from "../../shared/api/assets";
import { parseConceptFieldSuggestion } from "../ai/conceptFieldSuggestion";
import {
  buildBookCoverPromptPackage,
  renderBookCoverPromptPackage
} from "../ai/coverPromptPackage";
import {
  buildConceptFieldPromptPackage,
  conceptFieldConfigs,
  ConceptFieldKey,
  renderPromptPackage
} from "../ai/promptPackage";
import { useCodexSettingsStore } from "../ai/codexSettingsStore";
import { useProposalStore } from "../ai/proposalStore";

type BookConceptPageProps = {
  projectId: string;
};

type ConceptForm = {
  workingTitle: string;
  premise: string;
  genre: string;
  targetAudience: string;
  tone: string;
  styleGuide: string;
};

type ChoiceOption = {
  value: string;
  hint: string;
};

const emptyForm: ConceptForm = {
  workingTitle: "",
  premise: "",
  genre: "",
  targetAudience: "",
  tone: "",
  styleGuide: ""
};

const fieldHints: Record<ConceptFieldKey, string> = {
  workingTitle:
    "Tytuł roboczy pomaga AI utrzymać motyw przewodni. Przykład: Sekret Trzeciego Dnia.",
  premise:
    "Premise to 1-2 zdania o bohaterze, konflikcie i stawce. Przykład: Archiwistka odkrywa, że każde skłamane wspomnienie skraca życie miasta.",
  genre:
    "Gatunek ustawia konwencje i oczekiwania. Możesz łączyć etykiety, np. fantasy, kryminał, realizm magiczny.",
  targetAudience:
    "Odbiorcy sterują językiem, tempem i poziomem mroku. Przykład: adult, YA, fani kryminału.",
  tone:
    "Ton pilnuje nastroju scen i propozycji. Przykład: mroczny, liryczny, ironiczny.",
  styleGuide:
    "Style guide zbiera preferencje języka, rytmu i zakazy. Przykład: krótkie zdania w scenach napięcia, zero ekspozycyjnych monologów."
};

const genreOptions: ChoiceOption[] = [
  { value: "fantasy", hint: "Magia, reguły świata, obietnica niezwykłości." },
  { value: "kryminał", hint: "Zagadka, tropy, śledztwo i ujawnianie prawdy." },
  { value: "obyczajowa", hint: "Relacje, codzienność i emocjonalna przemiana." },
  { value: "thriller", hint: "Presja czasu, zagrożenie i wysokie napięcie." },
  { value: "horror", hint: "Lęk, niepewność i narastające poczucie grozy." },
  { value: "science fiction", hint: "Technologia, spekulacja i konsekwencje idei." },
  { value: "romans", hint: "Relacja uczuciowa jako główna oś napięcia." },
  { value: "realizm magiczny", hint: "Niezwykłość traktowana jak część codzienności." }
];

const audienceOptions: ChoiceOption[] = [
  { value: "adult", hint: "Dorosły czytelnik, większa złożoność i tematy." },
  { value: "YA", hint: "Młodzi dorośli, szybkie tempo i silna identyfikacja." },
  { value: "new adult", hint: "Wejście w dorosłość, relacje i niezależność." },
  { value: "middle grade", hint: "Młodsi czytelnicy, przygoda i klarowny konflikt." },
  { value: "dzieci", hint: "Prostszy język, bezpieczniejsze tematy i wyraźny rytm." },
  { value: "fani kryminału", hint: "Czytelnicy oczekujący tropów, zwrotów i fair play." },
  { value: "fani fantasy", hint: "Czytelnicy lubiący świat, mitologię i konsekwencje magii." }
];

const toneOptions: ChoiceOption[] = [
  { value: "mroczny", hint: "Cięższy nastrój, tajemnica i moralne koszty." },
  { value: "ciepły", hint: "Bliskość, nadzieja i empatia wobec postaci." },
  { value: "ironiczny", hint: "Dystans, błyskotliwość i lekko podważający narrator." },
  { value: "liryczny", hint: "Obrazowy język, rytm i emocjonalna gęstość." },
  { value: "napięty", hint: "Krótki oddech, presja i ciągłe pytanie co dalej." },
  { value: "kameralny", hint: "Mniejsza skala, intymne sceny i relacje." },
  { value: "epicki", hint: "Szeroka skala, wysokie stawki i rozmach." },
  { value: "humorystyczny", hint: "Lekki rytm, komizm sytuacyjny lub dialogowy." }
];

export function BookConceptPage({ projectId }: BookConceptPageProps) {
  const queryClient = useQueryClient();
  const codexPath = useCodexSettingsStore((state) => state.codexPath);
  const timeoutSeconds = useCodexSettingsStore((state) => state.timeoutSeconds);
  const model = useCodexSettingsStore((state) => state.model);
  const reasoningEffort = useCodexSettingsStore(
    (state) => state.reasoningEffort
  );
  const startProposal = useProposalStore((state) => state.startProposal);
  const finishProposal = useProposalStore((state) => state.finishProposal);
  const failProposal = useProposalStore((state) => state.failProposal);
  const activeProposal = useProposalStore((state) => state.activeProposal);
  const [form, setForm] = useState<ConceptForm>(emptyForm);
  const [saveMessage, setSaveMessage] = useState("");
  const [coverMessage, setCoverMessage] = useState("");
  const [coverProgressText, setCoverProgressText] = useState("");
  const [coverStartedAt, setCoverStartedAt] = useState<number | null>(null);
  const [streamedCoverPreview, setStreamedCoverPreview] = useState("");
  const [aiError, setAiError] = useState("");

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId),
    retry: 0
  });

  const codexStatusQuery = useQuery({
    queryKey: ["codex-cli", codexPath],
    queryFn: () => checkCodexCli(codexPath),
    retry: 0
  });

  useEffect(() => {
    if (!projectQuery.data) {
      return;
    }

    const { book } = projectQuery.data;
    setForm({
      workingTitle: book.workingTitle,
      premise: book.premise,
      genre: book.genre,
      targetAudience: book.targetAudience,
      tone: book.tone,
      styleGuide: book.styleGuide
    });
  }, [projectQuery.data?.book.id, projectQuery.data?.book.updatedAt]);

  const bookForPrompt = useMemo(() => {
    if (!projectQuery.data) {
      return null;
    }

    return {
      ...projectQuery.data.book,
      workingTitle: form.workingTitle,
      premise: form.premise,
      genre: form.genre,
      targetAudience: form.targetAudience,
      tone: form.tone,
      styleGuide: form.styleGuide
    };
  }, [form, projectQuery.data]);

  useEffect(() => {
    const activeBookId = projectQuery.data?.book.id;
    if (!activeBookId || !isTauriRuntime()) {
      return;
    }

    let cancelled = false;
    const unlistenPromise = listen<CoverGenerationProgressEvent>(
      "cover-generation-progress",
      (event) => {
        const payload = event.payload;
        if (
          payload.projectId !== projectId ||
          payload.bookId !== activeBookId
        ) {
          return;
        }

        setCoverProgressText(payload.message);
        if (payload.partialImageDataUrl) {
          setStreamedCoverPreview(payload.partialImageDataUrl);
        }
      }
    );

    return () => {
      cancelled = true;
      unlistenPromise
        .then((unlisten) => {
          if (cancelled) {
            unlisten();
          }
        })
        .catch(() => undefined);
    };
  }, [projectId, projectQuery.data?.book.id]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!projectQuery.data) {
        throw new Error("Brak projektu do zapisu.");
      }

      return updateBookConcept(projectQuery.data.book.id, conceptInputFromForm(form));
    },
    onSuccess: async () => {
      setSaveMessage("Zapisano koncepcje.");
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    }
  });

  const generateFieldMutation = useMutation({
    mutationFn: async (field: ConceptFieldKey) => {
      if (!projectQuery.data || !bookForPrompt) {
        throw new GenerationError("Brak danych projektu.");
      }

      const promptPackage = buildConceptFieldPromptPackage(
        projectQuery.data.project,
        bookForPrompt,
        field
      );
      const prompt = renderPromptPackage(promptPackage);
      const snapshot = {
        projectId,
        bookId: projectQuery.data.book.id,
        field,
        action: promptPackage.action,
        promptPackageId: promptPackage.id,
        promptPackageJson: promptPackage,
        prompt
      };

      startProposal(snapshot);

      const result = await runCodexPrompt({
        projectId,
        action: promptPackage.action,
        promptPackageId: promptPackage.id,
        promptPackageJson: promptPackage,
        prompt,
        codexPath,
        timeoutSeconds,
        model,
        reasoningEffort
      });

      if (result.status !== "success" || !result.rawOutput) {
        throw new GenerationError(
          result.errorMessage || "Codex CLI nie zwrócił wyniku.",
          result.rawOutput ?? ""
        );
      }

      const parsed = parseConceptFieldSuggestion(result.rawOutput, field);
      return { parsed, result };
    },
    onSuccess: ({ parsed, result }) => {
      setAiError("");
      finishProposal({
        aiRunId: result.id,
        rawOutput: result.rawOutput ?? "",
        parsed,
        editableValue: parsed.textValue,
        durationMs: result.durationMs
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      const rawOutput = error instanceof GenerationError ? error.rawOutput : "";
      setAiError(message);
      failProposal(message, rawOutput);
    }
  });

  const generateCoverMutation = useMutation({
    mutationFn: async () => {
      if (!projectQuery.data || !bookForPrompt) {
        throw new GenerationError("Brak danych projektu.");
      }

      const promptPackage = buildBookCoverPromptPackage(
        projectQuery.data.project,
        bookForPrompt
      );
      const prompt = renderBookCoverPromptPackage(promptPackage);

      return generateBookCover({
        projectId,
        bookId: projectQuery.data.book.id,
        promptPackageId: promptPackage.id,
        promptPackageJson: promptPackage,
        prompt,
        coverPrompt: promptPackage.coverPrompt,
        coverNegativePrompt: promptPackage.negativePrompt,
        codexPath,
        timeoutSeconds,
        model,
        reasoningEffort
      });
    },
    onSuccess: async (result) => {
      setAiError("");
      setCoverMessage("Utworzono okladke.");
      setCoverProgressText("Okladka zapisana.");
      setCoverStartedAt(null);
      setStreamedCoverPreview(coverImageSource(result.book.coverImagePath));
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      setCoverProgressText("Generowanie okladki zatrzymane.");
      setCoverStartedAt(null);
      setAiError(message);
    }
  });

  useEffect(() => {
    if (!generateCoverMutation.isPending || coverStartedAt === null) {
      return;
    }

    const startedAt = coverStartedAt;

    function updateProgressText() {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      if (elapsedSeconds < 2) {
        setCoverProgressText("Przygotowuje prompt okladki...");
        return;
      }
      if (elapsedSeconds < 8) {
        setCoverProgressText("Uruchamiam Codex CLI...");
        return;
      }
      if (elapsedSeconds < 45) {
        setCoverProgressText(`Codex CLI generuje okladke (${elapsedSeconds}s)...`);
        return;
      }
      setCoverProgressText(`Dopracowuje finalny obraz (${elapsedSeconds}s)...`);
    }

    updateProgressText();
    const intervalId = window.setInterval(updateProgressText, 1000);
    return () => window.clearInterval(intervalId);
  }, [coverStartedAt, generateCoverMutation.isPending]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaveMessage("");
    saveMutation.mutate();
  }

  function updateField<Key extends keyof ConceptForm>(
    key: Key,
    value: ConceptForm[Key]
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function generateField(field: ConceptFieldKey) {
    setAiError("");
    generateFieldMutation.mutate(field);
  }

  function generateCover() {
    setAiError("");
    setCoverMessage("");
    setStreamedCoverPreview("");
    setCoverProgressText("Przygotowuje prompt okladki...");
    setCoverStartedAt(Date.now());
    generateCoverMutation.mutate();
  }

  const codexUnavailable = codexStatusQuery.data?.available === false;
  const activeField =
    activeProposal?.projectId === projectId && activeProposal.status === "running"
      ? activeProposal.field
      : null;
  const coverSrc =
    streamedCoverPreview || coverImageSource(projectQuery.data?.book.coverImagePath);

  return (
    <div className="concept-page-grid">
    <section className="content-panel concept-panel">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Faza 1</p>
          <h2>Koncepcja książki</h2>
        </div>
      </div>

      {projectQuery.isError ? (
        <div className="empty-state">
          <h3>Nie można wczytać projektu</h3>
          <p>Sprawdź, czy aplikacja działa w Tauri i baza jest dostępna.</p>
        </div>
      ) : null}

      <form className="concept-form" onSubmit={handleSubmit}>
        <FieldFrame
          label="Tytuł roboczy"
          field="workingTitle"
          onGenerate={generateField}
          disabled={generateFieldMutation.isPending || !projectQuery.data || codexUnavailable}
          loading={activeField === "workingTitle"}
        >
          <input
            value={form.workingTitle}
            onChange={(event) => updateField("workingTitle", event.target.value)}
            placeholder="Tytuł roboczy"
            title={fieldHints.workingTitle}
            aria-label="Tytuł roboczy"
          />
        </FieldFrame>

        <FieldFrame
          label="Premise"
          field="premise"
          onGenerate={generateField}
          disabled={generateFieldMutation.isPending || !projectQuery.data || codexUnavailable}
          loading={activeField === "premise"}
        >
          <textarea
            value={form.premise}
            onChange={(event) => updateField("premise", event.target.value)}
            placeholder="Jedno lub dwa zdania o obietnicy historii"
            title={fieldHints.premise}
            aria-label="Premise"
            rows={5}
          />
        </FieldFrame>

        <div className="form-grid concept-choice-grid">
          <MultiChoiceField
            label="Gatunek"
            field="genre"
            value={form.genre}
            options={genreOptions}
            onChange={(value) => updateField("genre", value)}
            onGenerate={generateField}
            disabled={generateFieldMutation.isPending || !projectQuery.data || codexUnavailable}
            loading={activeField === "genre"}
          />

          <MultiChoiceField
            label="Odbiorcy"
            field="targetAudience"
            value={form.targetAudience}
            options={audienceOptions}
            onChange={(value) => updateField("targetAudience", value)}
            onGenerate={generateField}
            disabled={generateFieldMutation.isPending || !projectQuery.data || codexUnavailable}
            loading={activeField === "targetAudience"}
          />

          <MultiChoiceField
            label="Ton"
            field="tone"
            value={form.tone}
            options={toneOptions}
            onChange={(value) => updateField("tone", value)}
            onGenerate={generateField}
            disabled={generateFieldMutation.isPending || !projectQuery.data || codexUnavailable}
            loading={activeField === "tone"}
          />
        </div>

        <FieldFrame
          label="Style guide"
          field="styleGuide"
          onGenerate={generateField}
          disabled={generateFieldMutation.isPending || !projectQuery.data || codexUnavailable}
          loading={activeField === "styleGuide"}
        >
          <textarea
            className="style-guide-textarea"
            value={form.styleGuide}
            onChange={(event) => updateField("styleGuide", event.target.value)}
            placeholder="Notatki o języku, rytmie, zakazach i preferencjach"
            title={fieldHints.styleGuide}
            aria-label="Style guide"
            rows={5}
          />
        </FieldFrame>

        <div className="button-row">
          <button
            type="submit"
            className="primary-button"
            disabled={saveMutation.isPending || !projectQuery.data}
          >
            <Save size={16} />
            {saveMutation.isPending ? "Zapisuje" : "Zapisz"}
          </button>
          {saveMessage ? <span className="success-text">{saveMessage}</span> : null}
          {saveMutation.isError ? (
            <span className="warning-text">Nie udało się zapisać koncepcji.</span>
          ) : null}
        </div>
      </form>

      {codexUnavailable ? (
        <p className="warning-text">
          Codex CLI nie jest gotowy. Skonfiguruj go w prawym panelu albo ekranie AI.
        </p>
      ) : null}

      {aiError && !generateCoverMutation.isError ? (
        <p className="warning-text">{aiError}</p>
      ) : null}
    </section>

      <aside className="content-panel cover-panel">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Okladka</p>
            <h2>Robocza okladka</h2>
          </div>
          <ImageIcon size={20} aria-hidden="true" />
        </div>

        <div className={coverSrc ? "cover-preview has-image" : "cover-preview"}>
          {coverSrc ? (
            <img src={coverSrc} alt="Okladka robocza" />
          ) : (
            <div className="cover-placeholder">
              <ImageIcon size={30} aria-hidden="true" />
              <span>Brak okladki</span>
            </div>
          )}
        </div>

        {projectQuery.data?.book.coverGeneratedAt ? (
          <p className="muted-text">
            Wygenerowano: {projectQuery.data.book.coverGeneratedAt}
          </p>
        ) : null}

        <button
          type="button"
          className="secondary-button"
          onClick={generateCover}
          disabled={
            generateCoverMutation.isPending ||
            !projectQuery.data ||
            codexUnavailable
          }
          title="Utworz okladke na podstawie danych z widoku koncepcji"
        >
          {generateCoverMutation.isPending ? (
            <Loader2 size={16} className="spin-icon" />
          ) : (
            <Sparkles size={16} />
          )}
          {generateCoverMutation.isPending ? "Tworze" : "Utworz okladke"}
        </button>

        {coverProgressText ? (
          <div
            className={
              generateCoverMutation.isPending
                ? "cover-progress active"
                : "cover-progress"
            }
            role={generateCoverMutation.isPending ? "status" : undefined}
            aria-live="polite"
          >
            <span>{coverProgressText}</span>
            {generateCoverMutation.isPending ? (
              <div className="cover-progress-track" aria-hidden="true">
                <span />
              </div>
            ) : null}
          </div>
        ) : null}

        {coverMessage ? <p className="success-text">{coverMessage}</p> : null}
        {generateCoverMutation.isError ? (
          <p className="warning-text">Nie udalo sie utworzyc okladki.</p>
        ) : null}
        {generateCoverMutation.isError && aiError ? (
          <p className="warning-text">{aiError}</p>
        ) : null}
      </aside>
    </div>
  );
}

type FieldFrameProps = {
  label: string;
  field: ConceptFieldKey;
  children: ReactNode;
  disabled: boolean;
  loading: boolean;
  onGenerate: (field: ConceptFieldKey) => void;
};

function FieldFrame({
  label,
  field,
  children,
  disabled,
  loading,
  onGenerate
}: FieldFrameProps) {
  return (
    <div className="field-shell" title={fieldHints[field]}>
      <div className="field-heading">
        <span className="field-label-text">{label}</span>
        <AiFieldButton
          field={field}
          disabled={disabled}
          loading={loading}
          onGenerate={onGenerate}
        />
      </div>
      {children}
    </div>
  );
}

type AiFieldButtonProps = {
  field: ConceptFieldKey;
  disabled: boolean;
  loading: boolean;
  onGenerate: (field: ConceptFieldKey) => void;
};

function AiFieldButton({
  field,
  disabled,
  loading,
  onGenerate
}: AiFieldButtonProps) {
  const config = conceptFieldConfigs[field];

  return (
    <button
      type="button"
      className="icon-button ai-field-button"
      onClick={() => onGenerate(field)}
      disabled={disabled}
      title={`Generuj pole "${config.label}" z AI. Prompt uwzględni pozostałe pola koncepcji.`}
      aria-label={`Generuj ${config.label} z AI`}
    >
      <Sparkles size={15} />
      <span>{loading ? "Generuje" : "AI"}</span>
    </button>
  );
}

type MultiChoiceFieldProps = {
  label: string;
  field: ConceptFieldKey;
  value: string;
  options: ChoiceOption[];
  disabled: boolean;
  loading: boolean;
  onChange: (value: string) => void;
  onGenerate: (field: ConceptFieldKey) => void;
};

function MultiChoiceField({
  label,
  field,
  value,
  options,
  disabled,
  loading,
  onChange,
  onGenerate
}: MultiChoiceFieldProps) {
  const [customValue, setCustomValue] = useState("");
  const selectedValues = parseChoiceString(value);
  const knownValues = new Set(options.map((option) => option.value));
  const customSelectedValues = selectedValues.filter(
    (selected) => !knownValues.has(selected)
  );

  function setSelected(nextValues: string[]) {
    onChange(nextValues.join(", "));
  }

  function toggleChoice(choice: string) {
    if (selectedValues.includes(choice)) {
      setSelected(selectedValues.filter((selected) => selected !== choice));
      return;
    }

    setSelected([...selectedValues, choice]);
  }

  function addCustomValue() {
    const nextValue = customValue.trim();
    if (!nextValue || selectedValues.includes(nextValue)) {
      setCustomValue("");
      return;
    }

    setSelected([...selectedValues, nextValue]);
    setCustomValue("");
  }

  return (
    <FieldFrame
      label={label}
      field={field}
      disabled={disabled}
      loading={loading}
      onGenerate={onGenerate}
    >
      <div className="choice-field" aria-label={label}>
        <div className="choice-chip-list">
          {options.map((option) => {
            const selected = selectedValues.includes(option.value);
            return (
              <button
                type="button"
                key={option.value}
                className={selected ? "choice-chip selected" : "choice-chip"}
                onClick={() => toggleChoice(option.value)}
                title={`${option.value}: ${option.hint}`}
                aria-pressed={selected}
              >
                {option.value}
              </button>
            );
          })}
          {customSelectedValues.map((selected) => (
            <button
              type="button"
              key={selected}
              className="choice-chip selected custom"
              onClick={() => toggleChoice(selected)}
              title={`Własna opcja: ${selected}. Kliknij, aby usunąć.`}
              aria-pressed
            >
              {selected}
              <X size={12} />
            </button>
          ))}
        </div>
        <div className="choice-custom-row">
          <input
            value={customValue}
            onChange={(event) => setCustomValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addCustomValue();
              }
            }}
            placeholder="Własna opcja"
            title={`Dopisz własną wartość dla pola ${label}, np. hybryda gatunkowa albo grupa czytelników.`}
            aria-label={`Własna opcja ${label}`}
          />
          <button
            type="button"
            className="icon-button"
            onClick={addCustomValue}
            title={`Dodaj własną opcję do pola ${label}`}
            aria-label={`Dodaj własną opcję ${label}`}
          >
            <Plus size={15} />
          </button>
        </div>
      </div>
    </FieldFrame>
  );
}

function parseChoiceString(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function conceptInputFromForm(form: ConceptForm): BookConceptInput {
  return {
    workingTitle: form.workingTitle,
    premise: form.premise,
    genre: form.genre,
    targetAudience: form.targetAudience,
    tone: form.tone,
    styleGuide: form.styleGuide
  };
}

class GenerationError extends Error {
  rawOutput: string;

  constructor(message: string, rawOutput = "") {
    super(message);
    this.name = "GenerationError";
    this.rawOutput = rawOutput;
  }
}
