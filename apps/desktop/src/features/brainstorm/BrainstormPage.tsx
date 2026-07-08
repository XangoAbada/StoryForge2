import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lightbulb, Pencil, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { Button, Chip, EmptyState, Field, Modal, TwoPane, confirmDialog } from "../../shared/ui";
import {
  appendBrainstormMessage,
  createBrainstormSession,
  deleteBrainstormSession,
  getAiSettings,
  getBookPlan,
  getCharacterWorkspace,
  getProject,
  getWorldWorkspace,
  listAiRuns,
  listBrainstormMessages,
  listBrainstormSessions,
  renameBrainstormSession,
  runCodexPrompt
} from "../../shared/api/commands";
import type { BrainstormMessage, BrainstormSuggestion } from "../../shared/api/types";
import { costOf, formatCostLabel, sumCosts, type CostBreakdown } from "../ai/pricing";
import {
  buildBrainstormChatPromptPackage,
  dedupeBrainstormSuggestions,
  hasBrainstormMaterial,
  parseBrainstormChatResult,
  renderBrainstormChatPromptPackage
} from "../ai/brainstormPromptPackage";
import { useCodexSettingsStore } from "../ai/codexSettingsStore";
import { useBrainstormSessionStore } from "./brainstormSessionStore";
import { useTextProviderInfo } from "../ai/textProviderInfo";

const STARTER_MESSAGE =
  "Nie mam jeszcze pomysłu na książkę. Zaproponuj kilka wyraźnie różnych punktów startowych.";

const DEVELOP_MESSAGE =
  "Zacznijmy od tego, co już mam w koncepcji i story bible. Podsumuj obecny pomysł własnymi słowami, wskaż najsłabsze punkty i białe plamy, a potem zaproponuj, co warto pogłębić w pierwszej kolejności.";

export function BrainstormPage({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const codexPath = useCodexSettingsStore((state) => state.codexPath);
  const timeoutSeconds = useCodexSettingsStore((state) => state.timeoutSeconds);
  const model = useCodexSettingsStore((state) => state.model);
  const reasoningEffort = useCodexSettingsStore((state) => state.reasoningEffort);
  const setStoreSessionId = useBrainstormSessionStore((state) => state.setActiveSessionId);
  const providerInfo = useTextProviderInfo();

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId),
    retry: 0
  });
  const bookId = projectQuery.data?.book.id;
  const planQuery = useQuery({
    queryKey: ["book-plan", bookId],
    queryFn: () => getBookPlan(bookId ?? ""),
    enabled: Boolean(bookId),
    retry: 0
  });
  const characterQuery = useQuery({
    queryKey: ["character-workspace", projectId],
    queryFn: () => getCharacterWorkspace(projectId),
    retry: 0
  });
  const worldQuery = useQuery({
    queryKey: ["world-workspace", projectId],
    queryFn: () => getWorldWorkspace(projectId),
    retry: 0
  });
  const sessionsQuery = useQuery({
    queryKey: ["brainstorm-sessions", projectId],
    queryFn: () => listBrainstormSessions(projectId),
    retry: 0
  });

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const sessions = sessionsQuery.data ?? [];
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;

  useEffect(() => {
    if (!activeSession && sessions.length > 0) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSession, sessions]);

  // Publikuj wybraną sesję do globalnego panelu AI (prawy sidebar renderuje jej
  // sugestie); przy wyjściu z widoku wyczyść, żeby panel je ukrył.
  useEffect(() => {
    setStoreSessionId(activeSessionId);
    return () => setStoreSessionId(null);
  }, [activeSessionId, setStoreSessionId]);

  const messagesQuery = useQuery({
    queryKey: ["brainstorm-messages", activeSessionId],
    queryFn: () => listBrainstormMessages(activeSessionId ?? ""),
    enabled: Boolean(activeSessionId),
    retry: 0
  });
  const messages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);

  // Koszt liczymy z tych samych runów (ai_runs), które napędzają log AI i
  // licznik projektu — mapujemy po aiRunId zapisanym przy wiadomości asystenta.
  const aiSettingsQuery = useQuery({
    queryKey: ["ai-settings"],
    queryFn: getAiSettings,
    retry: 0
  });
  const plnPerUsd = aiSettingsQuery.data?.plnPerUsd ?? 4;
  const aiRunsQuery = useQuery({
    queryKey: ["ai-runs", projectId],
    queryFn: () => listAiRuns(projectId),
    retry: 0
  });
  const runCostById = useMemo(() => {
    const map = new Map<string, CostBreakdown>();
    for (const run of aiRunsQuery.data ?? []) {
      map.set(
        run.id,
        costOf(
          {
            inputTokens: run.inputTokens,
            outputTokens: run.outputTokens,
            cacheReadTokens: run.cacheReadTokens,
            cacheCreationTokens: run.cacheCreationTokens,
            tokensEstimated: run.tokensEstimated
          },
          run.providerId,
          run.model
        )
      );
    }
    return map;
  }, [aiRunsQuery.data]);
  const sessionCost = useMemo(
    () =>
      sumCosts(
        messages.flatMap((message) => {
          const cost = message.aiRunId ? runCostById.get(message.aiRunId) : undefined;
          return cost ? [cost] : [];
        })
      ),
    [messages, runCostById]
  );

  const [draft, setDraft] = useState("");
  // Ulotny wybór inline-chipów z odpowiedzi AI — etykiety przypięte do composera,
  // dedup po chipKey; czyszczony po wysłaniu. Nie zapisujemy go w bazie.
  const [selectedChips, setSelectedChips] = useState<string[]>([]);
  const selectedChipKeys = useMemo(
    () => new Set(selectedChips.map(chipKey)),
    [selectedChips]
  );
  const toggleChip = useCallback((label: string) => {
    const key = chipKey(label);
    if (!key) {
      return;
    }
    setSelectedChips((prev) =>
      prev.some((item) => chipKey(item) === key)
        ? prev.filter((item) => chipKey(item) !== key)
        : [...prev, label.trim()]
    );
  }, []);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = messagesRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages.length, isSending]);

  // Nazwy istniejących sugestii i encji — przekazywane do promptu, żeby AI
  // ich nie dublowało (druga linia obrony obok dedupu po stronie parsera).
  const existingTitles = useMemo(() => {
    const titles = messages.flatMap((message) =>
      parseSuggestions(message).map((suggestion) => suggestion.title)
    );
    const characters = characterQuery.data?.characters.map((item) => item.name) ?? [];
    const elements = worldQuery.data?.elements.map((item) => item.name) ?? [];
    const rules = worldQuery.data?.rules.map((item) => item.name) ?? [];
    const threads = planQuery.data?.threads.map((item) => item.name) ?? [];
    return [...titles, ...characters, ...elements, ...rules, ...threads];
  }, [messages, characterQuery.data, worldQuery.data, planQuery.data]);

  const contextReady = Boolean(
    projectQuery.data && planQuery.data && characterQuery.data && worldQuery.data
  );
  const hasMaterial =
    contextReady &&
    hasBrainstormMaterial({
      book: projectQuery.data!.book,
      plan: planQuery.data ?? null,
      characters: characterQuery.data!,
      world: worldQuery.data!
    });
  const lastMessage = messages[messages.length - 1];
  const canRetry = Boolean(sendError && lastMessage?.role === "user");

  async function createSession() {
    const project = projectQuery.data;
    if (!project) {
      return;
    }
    const session = await createBrainstormSession({
      projectId,
      bookId: project.book.id,
      name: `Sesja ${new Date().toLocaleDateString("pl-PL")}`
    });
    await queryClient.invalidateQueries({ queryKey: ["brainstorm-sessions", projectId] });
    setActiveSessionId(session.id);
    setSendError(null);
  }

  async function removeSession(sessionId: string) {
    const confirmed = await confirmDialog({
      title: t("common.delete"),
      message: t("brainstorm.confirmDeleteSession"),
      confirmLabel: t("common.delete"),
      danger: true
    });
    if (!confirmed) {
      return;
    }
    await deleteBrainstormSession(sessionId);
    await queryClient.invalidateQueries({ queryKey: ["brainstorm-sessions", projectId] });
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
    }
  }

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    if (!activeSession || renameDraft === null) {
      return;
    }
    const name = renameDraft.trim();
    if (name) {
      await renameBrainstormSession(activeSession.id, name);
      await queryClient.invalidateQueries({ queryKey: ["brainstorm-sessions", projectId] });
    }
    setRenameDraft(null);
  }

  /**
   * Dogenerowuje odpowiedź AI do ostatniej wiadomości autora zapisanej w bazie.
   * Wołane po wysłaniu nowej wiadomości oraz z przycisku "Ponów" po błędzie.
   */
  async function requestAssistantReply() {
    const project = projectQuery.data;
    const plan = planQuery.data;
    const characters = characterQuery.data;
    const world = worldQuery.data;
    const session = activeSession;
    if (!project || !plan || !characters || !world || !session) {
      return;
    }

    setIsSending(true);
    setSendError(null);
    try {
      const currentMessages = await queryClient.fetchQuery({
        queryKey: ["brainstorm-messages", session.id],
        queryFn: () => listBrainstormMessages(session.id)
      });
      const last = currentMessages[currentMessages.length - 1];
      if (!last || last.role !== "user") {
        return;
      }

      const promptPackage = buildBrainstormChatPromptPackage({
        project: project.project,
        book: project.book,
        plan,
        characters,
        world,
        session,
        messages: currentMessages.slice(0, -1),
        userMessage: last.content,
        existingSuggestionTitles: existingTitles
      });
      const result = await runCodexPrompt({
        projectId,
        action: "brainstorm_chat",
        promptPackageId: promptPackage.id,
        promptPackageJson: promptPackage,
        prompt: renderBrainstormChatPromptPackage(promptPackage),
        codexPath,
        timeoutSeconds,
        model,
        reasoningEffort
      });
      if (result.status !== "success" || !result.rawOutput) {
        throw new Error(
          result.errorMessage ||
            t("brainstorm.generationFailed", { provider: providerInfo.providerLabel })
        );
      }

      const parsed = parseBrainstormChatResult(result.rawOutput);
      const suggestions = dedupeBrainstormSuggestions(parsed.suggestions, existingTitles);
      await appendBrainstormMessage({
        sessionId: session.id,
        projectId,
        role: "assistant",
        content: parsed.reply,
        suggestionsJson: JSON.stringify(suggestions),
        aiRunId: result.id,
        stateSummary: parsed.stateSummary || null
      });
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSending(false);
      await queryClient.invalidateQueries({ queryKey: ["brainstorm-messages", session.id] });
      await queryClient.invalidateQueries({ queryKey: ["brainstorm-sessions", projectId] });
      // Odśwież koszt od razu: chip sesji tu oraz licznik projektu w górnym pasku.
      await queryClient.invalidateQueries({ queryKey: ["ai-runs", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["ai-run-usage-totals", projectId] });
    }
  }

  async function sendMessage(contentOverride?: string) {
    // Composer bez override łączy przypięte chipy z wpisanym tekstem w jedną
    // wiadomość; startery przekazują gotową treść i pomijają chipy.
    const content = (
      contentOverride ?? [selectedChips.join("; "), draft.trim()].filter(Boolean).join("\n\n")
    ).trim();
    const session = activeSession;
    if (!content || !session || isSending || !contextReady) {
      return;
    }

    setIsSending(true);
    setSendError(null);
    try {
      await appendBrainstormMessage({
        sessionId: session.id,
        projectId,
        role: "user",
        content,
        suggestionsJson: "[]"
      });
      setDraft("");
      setSelectedChips([]);
      await queryClient.invalidateQueries({ queryKey: ["brainstorm-messages", session.id] });
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
      setIsSending(false);
      return;
    }
    setIsSending(false);
    await requestAssistantReply();
  }

  return (
    <>
      <TwoPane
        paneWidth={280}
        pane={
          <>
            <div className="bible-list">
              {sessions.map((session) => (
                <button
                  type="button"
                  key={session.id}
                  className={session.id === activeSessionId ? "bible-item active" : "bible-item"}
                  onClick={() => {
                    setActiveSessionId(session.id);
                    setSendError(null);
                  }}
                >
                  <span className="t">{session.name || t("brainstorm.sessionUntitled")}</span>
                  <span className="m">
                    {new Date(session.updatedAt).toLocaleDateString("pl-PL")}
                  </span>
                </button>
              ))}
              {sessions.length === 0 ? (
                <p className="bible-list-empty">{t("brainstorm.emptySessions")}</p>
              ) : null}
            </div>
            <Button variant="secondary" block onClick={() => void createSession()}>
              <Plus size={15} aria-hidden />
              {t("brainstorm.newSession")}
            </Button>
          </>
        }
      >
        {activeSession ? (
          <main className="brainstorm-chat">
            <div className="bible-editor-heading">
              <div className="bible-avatar">
                <Lightbulb size={18} aria-hidden />
              </div>
              <div className="bible-editor-heading-body">
                <p className="eyebrow">{t("brainstorm.eyebrow")}</p>
                <h3>{activeSession.name || t("brainstorm.sessionUntitled")}</h3>
                <p className="muted-text">{t("brainstorm.intro")}</p>
                {sessionCost.hasPricing ? (
                  <span
                    className="ai-cost-chip"
                    title={t("brainstorm.sessionCostTitle")}
                  >
                    {t("brainstorm.sessionCost", {
                      cost: formatCostLabel(sessionCost, plnPerUsd)
                    })}
                  </span>
                ) : null}
              </div>
              <div className="button-row">
                <Button variant="ghost" size="sm" onClick={() => setRenameDraft(activeSession.name)}>
                  <Pencil size={14} aria-hidden />
                  {t("brainstorm.rename")}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void removeSession(activeSession.id)}
                >
                  <Trash2 size={14} aria-hidden />
                  {t("brainstorm.delete")}
                </Button>
              </div>
            </div>

            <div className="brainstorm-messages" ref={messagesRef}>
              {messages.length === 0 && !isSending ? (
                <div className="brainstorm-starter">
                  <p>
                    {hasMaterial
                      ? t("brainstorm.starterWithMaterial")
                      : t("brainstorm.starterNoMaterial")}
                  </p>
                  <Button
                    variant="ai"
                    size="sm"
                    disabled={!contextReady || isSending}
                    onClick={() => void sendMessage(hasMaterial ? DEVELOP_MESSAGE : STARTER_MESSAGE)}
                  >
                    <Sparkles size={14} aria-hidden />
                    {hasMaterial
                      ? t("brainstorm.developButton")
                      : t("brainstorm.starterButton")}
                  </Button>
                </div>
              ) : null}
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`brainstorm-message ${message.role === "user" ? "user" : "assistant"}`}
                >
                  <span className="brainstorm-message-author">
                    {message.role === "user" ? t("brainstorm.authorUser") : t("brainstorm.authorAi")}
                  </span>
                  {message.role === "assistant" ? (
                    <BrainstormMarkdown
                      content={message.content}
                      selectedChipKeys={selectedChipKeys}
                      onToggleChip={toggleChip}
                    />
                  ) : (
                    <p className="brainstorm-plain">{message.content}</p>
                  )}
                  {message.role === "assistant" &&
                  message.aiRunId &&
                  runCostById.get(message.aiRunId)?.hasPricing ? (
                    <span
                      className="ai-cost-chip brainstorm-message-cost"
                      title={t("brainstorm.messageCostTitle")}
                    >
                      {formatCostLabel(runCostById.get(message.aiRunId)!, plnPerUsd)}
                    </span>
                  ) : null}
                </article>
              ))}
              {isSending ? (
                <article className="brainstorm-message assistant pending">
                  <span className="brainstorm-message-author">{t("brainstorm.authorAi")}</span>
                  <p className="brainstorm-plain">
                    {t("brainstorm.thinking", { provider: providerInfo.providerLabel })}
                  </p>
                </article>
              ) : null}
            </div>

            {sendError ? (
              <div className="brainstorm-error" role="alert">
                <p>{sendError}</p>
                {canRetry ? (
                  <Button variant="secondary" size="sm" onClick={() => void requestAssistantReply()}>
                    {t("brainstorm.retry")}
                  </Button>
                ) : null}
              </div>
            ) : null}

            <form
              className="brainstorm-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage();
              }}
            >
              <div className="brainstorm-composer-field">
                {selectedChips.length > 0 ? (
                  <div className="brainstorm-composer-chips chip-row">
                    {selectedChips.map((label) => (
                      <Chip
                        key={chipKey(label)}
                        tone="ai"
                        pressed
                        onClick={() => toggleChip(label)}
                        title={t("brainstorm.removeChipTitle", { label })}
                      >
                        {label}
                      </Chip>
                    ))}
                  </div>
                ) : null}
                <textarea
                  className="ui-input"
                  value={draft}
                  rows={3}
                  placeholder={t("brainstorm.composerPlaceholder")}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Backspace" && draft === "" && selectedChips.length > 0) {
                      event.preventDefault();
                      setSelectedChips((prev) => prev.slice(0, -1));
                      return;
                    }
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                />
              </div>
              <Button
                variant="ai"
                type="submit"
                busy={isSending}
                disabled={!contextReady || (!draft.trim() && selectedChips.length === 0)}
              >
                <Send size={15} aria-hidden />
                {t("brainstorm.send")}
              </Button>
            </form>
          </main>
        ) : (
          <EmptyState
            icon={<Lightbulb size={28} aria-hidden />}
            title={t("brainstorm.emptyTitle")}
            description={t("brainstorm.emptyDescription")}
            action={
              <Button variant="primary" onClick={() => void createSession()}>
                <Plus size={15} aria-hidden />
                {t("brainstorm.newSession")}
              </Button>
            }
          />
        )}
      </TwoPane>

      {renameDraft !== null && activeSession ? (
        <Modal title={t("brainstorm.renameModalTitle")} size="sm" onClose={() => setRenameDraft(null)}>
          <form onSubmit={(event) => void submitRename(event)}>
            <Field label={t("brainstorm.sessionNameLabel")}>
              <input
                className="ui-input"
                value={renameDraft}
                autoFocus
                onChange={(event) => setRenameDraft(event.target.value)}
              />
            </Field>
            <div className="button-row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
              <Button variant="ghost" onClick={() => setRenameDraft(null)}>
                {t("brainstorm.cancel")}
              </Button>
              <Button variant="primary" type="submit">
                {t("brainstorm.save")}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

type MarkdownBlock =
  | { type: "p"; text: string }
  | { type: "ol" | "ul"; items: string[] };

// Lekki renderer podzbioru Markdown, którego używa AI: akapity oddzielone
// pustą linią, listy numerowane/punktowane i **pogrubienia** w treści.
// ponytail: świadomie bez react-markdown — pełny parser byłby przerostem
// dla tak wąskiego formatu; rozszerz, jeśli AI zacznie zwracać tabele/kod.
type ChipHandlers = {
  selectedChipKeys: Set<string>;
  onToggleChip: (label: string) => void;
};

function BrainstormMarkdown({
  content,
  selectedChipKeys,
  onToggleChip
}: { content: string } & ChipHandlers) {
  const { t } = useTranslation();
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);
  const handlers: ChipHandlers & { addChipTitle: (label: string) => string } = {
    selectedChipKeys,
    onToggleChip,
    addChipTitle: (label) => t("brainstorm.addChipTitle", { label })
  };
  return (
    <div className="brainstorm-message-body">
      {blocks.map((block, index) => {
        if (block.type === "p") {
          return <p key={index}>{renderInlineMarkdown(block.text, handlers)}</p>;
        }
        const ListTag = block.type === "ol" ? "ol" : "ul";
        return (
          <ListTag key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInlineMarkdown(item, handlers)}</li>
            ))}
          </ListTag>
        );
      })}
    </div>
  );
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: { type: "ol" | "ul"; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: "p", text: paragraph.join(" ") });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const ordered = /^\d+[.)]\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (ordered) {
      flushParagraph();
      if (!list || list.type !== "ol") {
        flushList();
        list = { type: "ol", items: [] };
      }
      list.items.push(ordered[1]);
    } else if (bullet) {
      flushParagraph();
      if (!list || list.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(bullet[1]);
    } else {
      flushList();
      paragraph.push(line);
    }
  }

  flushParagraph();
  flushList();
  return blocks;
}

export type InlineSegment =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "chip"; label: string };

// **pogrubienie** oraz [[etykieta chipa]] — jedna alternatywa, żeby oba markery
// dzieliły ten sam tekst. Etykieta chipa nie może zawierać ] ani |.
const INLINE_MARKDOWN_PATTERN = /(\*\*[^*]+\*\*|\[\[[^\]|]+\]\])/g;

/** Czysta funkcja (bez Reacta) — testowalny podział tekstu na segmenty inline. */
export function parseInlineSegments(text: string): InlineSegment[] {
  return text
    .split(INLINE_MARKDOWN_PATTERN)
    .filter((part) => part.length > 0)
    .map((part): InlineSegment => {
      const bold = /^\*\*([^*]+)\*\*$/.exec(part);
      if (bold) {
        return { type: "bold", text: bold[1] };
      }
      const chip = /^\[\[([^\]|]+)\]\]$/.exec(part);
      const label = chip ? chip[1].trim() : "";
      // Marker bez treści (np. [[ ]]) traktujemy jako zwykły tekst.
      return chip && label ? { type: "chip", label } : { type: "text", text: part };
    });
}

/** Klucz dedupu/porównań chipów — jedno źródło prawdy dla renderu i stanu wyboru. */
export function chipKey(label: string): string {
  return label.trim().toLowerCase();
}

function renderInlineMarkdown(
  text: string,
  handlers: ChipHandlers & { addChipTitle: (label: string) => string }
): ReactNode[] {
  return parseInlineSegments(text).map((segment, index) => {
    if (segment.type === "bold") {
      return <strong key={index}>{segment.text}</strong>;
    }
    if (segment.type === "chip") {
      return (
        <Chip
          key={index}
          tone="ai"
          pressed={handlers.selectedChipKeys.has(chipKey(segment.label))}
          onClick={() => handlers.onToggleChip(segment.label)}
          title={handlers.addChipTitle(segment.label)}
        >
          {segment.label}
        </Chip>
      );
    }
    return <span key={index}>{segment.text}</span>;
  });
}

function parseSuggestions(message: BrainstormMessage): BrainstormSuggestion[] {
  try {
    const parsed = JSON.parse(message.suggestionsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
