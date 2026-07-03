import {
  CheckCircle2,
  RotateCcw,
  Send,
  SlidersHorizontal,
  X
} from "lucide-react";
import {
  isSourceSelected,
  useAiPromptContextStore
} from "./aiPromptContextStore";
import { Button } from "../../shared/ui";

export function AiPromptContextPanel() {
  const activeTargetId = useAiPromptContextStore((state) => state.activeTargetId);
  const target = useAiPromptContextStore((state) =>
    activeTargetId ? state.targets[activeTargetId] : null
  );
  const draft = useAiPromptContextStore((state) =>
    activeTargetId ? state.drafts[activeTargetId] : undefined
  );
  const setAuthorPriorityComment = useAiPromptContextStore(
    (state) => state.setAuthorPriorityComment
  );
  const toggleContextKey = useAiPromptContextStore(
    (state) => state.toggleContextKey
  );
  const resetDraft = useAiPromptContextStore((state) => state.resetDraft);
  const submitActiveTarget = useAiPromptContextStore(
    (state) => state.submitActiveTarget
  );
  const closeActiveTarget = useAiPromptContextStore(
    (state) => state.closeActiveTarget
  );

  if (!activeTargetId || !target) {
    return null;
  }

  const selectedCount = target.sources.filter((source) =>
    isSourceSelected(source, draft)
  ).length;

  let promptChars: number | null = null;
  if (target.renderPrompt) {
    try {
      promptChars = target.renderPrompt().length;
    } catch {
      promptChars = null;
    }
  }

  return (
    <section
      className="context-section compact prompt-context-panel"
      aria-label="Kontekst promptu AI"
    >
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Kontekst promptu</p>
          <h2>{target.title}</h2>
          <p className="muted-text provider-subtitle">{target.subtitle}</p>
        </div>
        <div className="prompt-context-actions">
          <span className="status-pill">
            <SlidersHorizontal size={14} aria-hidden="true" />
            {selectedCount}/{target.sources.length}
          </span>
          {promptChars !== null ? (
            <span
              className="status-pill"
              title="Rozmiar promptu z aktualnie wybranym kontekstem"
            >
              {"~"}
              {Intl.NumberFormat("pl-PL").format(promptChars)}
              {" znaków"}
            </span>
          ) : null}
          <Button
            variant="icon"
            className="prompt-context-reset"
            onClick={() => resetDraft(activeTargetId)}
            title={"Przywr\u00f3\u0107 domy\u015blny kontekst promptu"}
            aria-label={"Przywr\u00f3\u0107 domy\u015blny kontekst promptu"}
          >
            <RotateCcw size={15} />
          </Button>
          <Button
            variant="icon"
            className="prompt-context-close"
            onClick={closeActiveTarget}
            title="Zamknij kontekst promptu"
            aria-label="Zamknij kontekst promptu"
          >
            <X size={15} />
          </Button>
        </div>
      </div>

      <div className="prompt-context-list">
        {target.sources.map((source) => {
          const selected = isSourceSelected(source, draft);
          return (
            <div
              className={
                source.required
                  ? "prompt-context-source required"
                  : "prompt-context-source"
              }
              key={source.key}
            >
              <input
                type="checkbox"
                aria-label={`Kontekst: ${source.label}`}
                checked={selected}
                disabled={source.required}
                onChange={() => toggleContextKey(activeTargetId, source.key)}
              />
              <span>{source.label}</span>
              {source.required ? (
                <em>
                  <CheckCircle2 size={13} aria-hidden="true" />
                  wymagane
                </em>
              ) : null}
            </div>
          );
        })}
      </div>

      <label className="field-label">
        Komentarz autora
        <textarea
          className="prompt-context-comment"
          value={draft?.authorPriorityComment ?? ""}
          onChange={(event) =>
            setAuthorPriorityComment(activeTargetId, event.target.value)
          }
          placeholder={"Najwa\u017cniejsza intencja dla najbli\u017cszego promptu"}
          rows={3}
        />
      </label>

      <div className="prompt-context-command-row">
        <Button
          variant="primary"
          block
          className="prompt-context-submit"
          onClick={submitActiveTarget}
          disabled={target.submitDisabled || !target.onSubmit}
          title={
            target.submitDisabled
              ? target.submitDisabledReason ?? "Request AI jest teraz niedost\u0119pny."
              : "Wy\u015blij najbli\u017cszy request AI z wybranym kontekstem."
          }
        >
          <Send size={15} aria-hidden="true" />
          {target.submitLabel ?? "Wy\u015blij do AI"}
        </Button>
      </div>
    </section>
  );
}
