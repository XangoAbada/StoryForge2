import { BarChart3, BookOpenCheck, FileText, PenLine, RefreshCw, Save, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  getBookPlan,
  getCharacterWorkspace,
  getProject,
  getWorldWorkspace,
  listSceneCritiques,
  saveChapterAutoSummary,
  saveSceneAutoSummary,
  saveStorySoFar
} from "../../shared/api/commands";
import type { BookPlan, Chapter, Scene, SceneCritiqueRecord } from "../../shared/api/types";
import { fnv1aHash, htmlToPlainText } from "../../shared/text/plainText";
import { Button, EmptyState, Segmented, StatusPill } from "../../shared/ui";
import { useProjectNavigationStore } from "../../app/projectNavigationStore";
import { useProposalStore, pendingProposalStatus } from "../ai/proposalStore";
import { buildScenePromptContext } from "../ai/scenePromptContext";
import {
  buildSceneCritiquePromptPackage,
  renderSceneCritiquePromptPackage,
  SCENE_CRITIQUE_FIELD
} from "../ai/sceneCritiquePromptPackage";
import {
  refreshSceneAutoSummary,
  refreshStaleContinuity
} from "../ai/continuitySummaryService";
import {
  computeBookStats,
  computeChapterStats,
  computeSceneStats,
  type SceneStats
} from "./manuscriptStats";

type EditingPageProps = {
  projectId: string;
};

type EditingTab = "reports" | "stats" | "summaries";

const tabItems: ReadonlyArray<{ id: EditingTab; label: string }> = [
  { id: "reports", label: "Raporty redaktora" },
  { id: "stats", label: "Statystyki" },
  { id: "summaries", label: "Streszczenia" }
];

export function EditingPage({ projectId }: EditingPageProps) {
  const [tab, setTab] = useState<EditingTab>("reports");
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

  const plan = planQuery.data;
  const book = projectQuery.data?.book;

  if (!plan || !book || !projectQuery.data) {
    return (
      <section className="editing-page">
        <EmptyState
          title="Wczytywanie danych redakcji"
          description="Za chwilę pojawią się raporty, statystyki i streszczenia."
        />
      </section>
    );
  }

  return (
    <section className="editing-page">
      <Segmented ariaLabel="Sekcje redakcji" items={tabItems} value={tab} onChange={setTab} />
      {tab === "reports" ? (
        <CritiqueReportsSection projectId={projectId} bookId={book.id} plan={plan} />
      ) : null}
      {tab === "stats" ? <ManuscriptStatsSection plan={plan} /> : null}
      {tab === "summaries" ? (
        <SummaryReviewSection
          projectId={projectId}
          book={book}
          plan={plan}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// a) Raporty redaktora
// ---------------------------------------------------------------------------

function CritiqueReportsSection({
  projectId,
  bookId,
  plan
}: {
  projectId: string;
  bookId: string;
  plan: BookPlan;
}) {
  const navigate = useNavigate();
  const enqueueProposal = useProposalStore((state) => state.enqueueProposal);
  const proposals = useProposalStore((state) => state.proposals);
  const setProjectViewState = useProjectNavigationStore((state) => state.setProjectViewState);
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId),
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
  const critiquesQuery = useQuery({
    queryKey: ["scene-critiques", bookId],
    queryFn: () => listSceneCritiques(bookId),
    retry: 0
  });

  const critiquesByScene = useMemo(() => {
    const map = new Map<string, SceneCritiqueRecord>();
    for (const record of critiquesQuery.data ?? []) {
      map.set(record.sceneId, record);
    }
    return map;
  }, [critiquesQuery.data]);

  const scenes = orderedScenesWithChapters(plan);

  function openInEditor(sceneId: string) {
    setProjectViewState(projectId, "searchSceneId", sceneId);
    void navigate({ to: "/projects/$projectId/editor", params: { projectId } });
  }

  function queueCritique(scene: Scene) {
    const project = projectQuery.data?.project;
    const book = projectQuery.data?.book;
    const characters = characterQuery.data;
    const world = worldQuery.data;
    if (!project || !book || !characters || !world) {
      return;
    }
    const sceneContext = buildScenePromptContext({
      book,
      plan,
      characters,
      world,
      sceneId: scene.id
    });
    if (!sceneContext) {
      return;
    }
    const promptPackage = buildSceneCritiquePromptPackage({
      project,
      book,
      scene,
      sceneContext,
      sceneText: htmlToPlainText(scene.manuscriptContent ?? "")
    });
    enqueueProposal({
      scope: "sceneEditor",
      projectId,
      bookId,
      field: SCENE_CRITIQUE_FIELD,
      action: promptPackage.action,
      promptPackageId: promptPackage.id,
      promptPackageJson: promptPackage,
      prompt: renderSceneCritiquePromptPackage(promptPackage)
    });
  }

  if (scenes.length === 0) {
    return (
      <EmptyState
        title="Brak scen w manuskrypcie"
        description="Raporty redaktora pojawią się, gdy książka będzie miała sceny."
      />
    );
  }

  return (
    <div className="editing-section">
      <p className="muted-text">
        Krytyka redaktorska sceny: tempo, dialogi, POV, telling, powtórzenia, ciągłość.
        Uwagi z przyciskiem „Zastosuj” pojawiają się w prawym panelu AI.
      </p>
      <table className="editing-table">
        <thead>
          <tr>
            <th>Scena</th>
            <th>Rozdział</th>
            <th>Raport</th>
            <th>Uwagi</th>
            <th>Akcje</th>
          </tr>
        </thead>
        <tbody>
          {scenes.map(({ scene, chapter }) => {
            const critique = critiquesByScene.get(scene.id);
            const findings = critique ? parseFindingCounts(critique.findingsJson) : null;
            const stale = critique
              ? critique.sourceHash !==
                fnv1aHash(htmlToPlainText(scene.manuscriptContent ?? ""))
              : false;
            const pending = pendingProposalStatus(proposals, {
              projectId,
              bookId,
              scope: "sceneEditor",
              field: SCENE_CRITIQUE_FIELD,
              targetEntityId: scene.id
            });
            const hasText = Boolean((scene.manuscriptContent ?? "").trim());
            return (
              <tr key={scene.id}>
                <td>{scene.title || "Bez tytułu"}</td>
                <td>{chapter ? `${chapter.number}. ${chapter.workingTitle || ""}`.trim() : "—"}</td>
                <td>
                  {critique ? (
                    <span className="editing-report-meta">
                      {new Date(critique.updatedAt).toLocaleDateString("pl-PL")}
                      {stale ? <StatusPill tone="warn">nieaktualny</StatusPill> : null}
                    </span>
                  ) : (
                    <span className="muted-text">brak</span>
                  )}
                </td>
                <td>
                  {findings ? (
                    <span className="editing-report-meta">
                      {findings.open > 0 ? `${findings.open} otwarte` : null}
                      {findings.applied > 0 ? ` · ${findings.applied} zast.` : null}
                      {findings.dismissed > 0 ? ` · ${findings.dismissed} odrz.` : null}
                      {findings.total === 0 ? "bez uwag" : null}
                    </span>
                  ) : (
                    <span className="muted-text">—</span>
                  )}
                </td>
                <td>
                  <div className="editing-row-actions">
                    <Button
                      variant="ai"
                      size="sm"
                      busy={Boolean(pending)}
                      disabled={!hasText}
                      title={hasText ? "Uruchom krytykę redaktorską tej sceny" : "Scena nie ma tekstu"}
                      onClick={() => queueCritique(scene)}
                    >
                      <PenLine size={14} />
                      {pending ? "Czyta…" : critique ? "Ponów" : "Krytyka"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openInEditor(scene.id)}>
                      <FileText size={14} />
                      Otwórz
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function parseFindingCounts(findingsJson: string): {
  total: number;
  open: number;
  applied: number;
  dismissed: number;
} | null {
  try {
    const parsed = JSON.parse(findingsJson || "[]");
    if (!Array.isArray(parsed)) {
      return null;
    }
    const counts = { total: parsed.length, open: 0, applied: 0, dismissed: 0 };
    for (const item of parsed) {
      const status = item && typeof item === "object" ? (item as { status?: string }).status : "";
      if (status === "applied") counts.applied += 1;
      else if (status === "dismissed") counts.dismissed += 1;
      else counts.open += 1;
    }
    return counts;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// b) Statystyki (lokalne, bez AI)
// ---------------------------------------------------------------------------

function ManuscriptStatsSection({ plan }: { plan: BookPlan }) {
  const stats = useMemo(() => {
    const scenes = orderedScenesWithChapters(plan);
    const sceneStats = new Map<string, SceneStats>();
    for (const { scene } of scenes) {
      sceneStats.set(scene.id, computeSceneStats(scene));
    }
    const chapterStats = plan.chapters.map((chapter) =>
      computeChapterStats(
        chapter,
        scenes
          .filter(({ scene }) => (scene.chapterId ?? null) === chapter.id)
          .map(({ scene }) => sceneStats.get(scene.id)!)
      )
    );
    const bookStats = computeBookStats(
      scenes.map(({ scene }) => scene),
      plan.chapters.length
    );
    return { scenes, sceneStats, chapterStats, bookStats };
  }, [plan]);

  const { bookStats } = stats;

  if (bookStats.wordCount === 0) {
    return (
      <EmptyState
        title="Brak tekstu do analizy"
        description="Statystyki pojawią się, gdy sceny będą miały treść."
      />
    );
  }

  return (
    <div className="editing-section">
      <div className="editing-stats-grid">
        <StatCard icon={<BookOpenCheck size={16} />} label="Słowa w książce" value={bookStats.wordCount.toLocaleString("pl-PL")} />
        <StatCard icon={<FileText size={16} />} label="Sceny / rozdziały" value={`${bookStats.sceneCount} / ${bookStats.chapterCount}`} />
        <StatCard icon={<BarChart3 size={16} />} label="Śr. długość sceny" value={`${bookStats.avgSceneLength.toLocaleString("pl-PL")} słów`} />
        <StatCard icon={<BarChart3 size={16} />} label="Śr. długość zdania" value={`${bookStats.avgSentenceLength} słów`} />
        <StatCard icon={<BarChart3 size={16} />} label="Udział dialogów" value={`${Math.round(bookStats.dialogueRatio * 100)}%`} />
        <StatCard icon={<BarChart3 size={16} />} label="Przysłówki (heurystyka)" value={`${bookStats.adverbRate} / 1000 słów`} />
      </div>

      <h3>Rozdziały</h3>
      <table className="editing-table">
        <thead>
          <tr>
            <th>Rozdział</th>
            <th>Sceny</th>
            <th>Słowa</th>
            <th>Śr. zdanie</th>
            <th>Dialogi</th>
            <th>Przysłówki*</th>
          </tr>
        </thead>
        <tbody>
          {plan.chapters.map((chapter) => {
            const row = stats.chapterStats.find((item) => item.chapterId === chapter.id);
            if (!row) {
              return null;
            }
            return (
              <tr key={chapter.id}>
                <td>{chapter.number}. {chapter.workingTitle || "Bez tytułu"}</td>
                <td>{row.sceneCount}</td>
                <td>{row.wordCount.toLocaleString("pl-PL")}</td>
                <td>{row.avgSentenceLength}</td>
                <td>{Math.round(row.dialogueRatio * 100)}%</td>
                <td>{row.adverbRate}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3>Sceny</h3>
      <table className="editing-table">
        <thead>
          <tr>
            <th>Scena</th>
            <th>Słowa</th>
            <th>Cel</th>
            <th>Śr. zdanie</th>
            <th>Dialogi</th>
            <th>Przysłówki*</th>
          </tr>
        </thead>
        <tbody>
          {stats.scenes.map(({ scene, chapter }) => {
            const row = stats.sceneStats.get(scene.id)!;
            const target = scene.targetWordCount ?? chapter?.targetWordCount ?? null;
            return (
              <tr key={scene.id}>
                <td>{scene.title || "Bez tytułu"}</td>
                <td>{row.wordCount.toLocaleString("pl-PL")}</td>
                <td>{target ? `${Math.round((row.wordCount / target) * 100)}% z ${target.toLocaleString("pl-PL")}` : "—"}</td>
                <td>{row.avgSentenceLength}</td>
                <td>{Math.round(row.dialogueRatio * 100)}%</td>
                <td>{row.adverbRate}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted-text">* przybliżona heurystyka językowa, nie pełna analiza gramatyczna.</p>

      {bookStats.repeatedPhrases.length > 0 ? (
        <>
          <h3>Powtarzające się frazy</h3>
          <ul className="editing-phrase-list">
            {bookStats.repeatedPhrases.map((item) => (
              <li key={item.phrase}>
                „{item.phrase}” <span className="muted-text">× {item.count}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {bookStats.topWords.length > 0 ? (
        <>
          <h3>Najczęstsze słowa</h3>
          <ul className="editing-phrase-list">
            {bookStats.topWords.map((item) => (
              <li key={item.phrase}>
                {item.phrase} <span className="muted-text">× {item.count}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="editing-stat-card">
      <span className="editing-stat-label">
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

// ---------------------------------------------------------------------------
// c) Streszczenia (pipeline ciągłości)
// ---------------------------------------------------------------------------

function SummaryReviewSection({
  projectId,
  book,
  plan
}: {
  projectId: string;
  book: { id: string; storySoFar: string; storySoFarStale: number };
  plan: BookPlan;
}) {
  const queryClient = useQueryClient();
  const [statusText, setStatusText] = useState("");

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ["book-plan", book.id] });
    await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  }

  const scenes = orderedScenesWithChapters(plan);

  return (
    <div className="editing-section">
      {statusText ? <p className="muted-text">{statusText}</p> : null}

      <div className="editing-summary-block">
        <div className="editing-summary-heading">
          <h3>Story so far</h3>
          {book.storySoFarStale === 1 ? <StatusPill tone="warn">nieaktualne</StatusPill> : null}
          <Button
            variant="ghost"
            size="sm"
            title="Odśwież nieaktualne streszczenia rozdziałów i story so far przez AI"
            onClick={() => {
              setStatusText("Odświeżam nieaktualne streszczenia…");
              void refreshStaleContinuity(projectId, book.id, {
                onSaved: invalidate,
                onStatus: setStatusText
              });
            }}
          >
            <Sparkles size={14} />
            Odśwież (AI)
          </Button>
        </div>
        <SummaryEditor
          initialValue={book.storySoFar}
          placeholder="Skrót całej historii budowany przez pipeline ciągłości…"
          onSave={async (value) => {
            await saveStorySoFar({ bookId: book.id, storySoFar: value });
            await invalidate();
            setStatusText("Zapisano story so far");
          }}
        />
      </div>

      <h3>Rozdziały</h3>
      {plan.chapters.map((chapter) => (
        <div className="editing-summary-block" key={chapter.id}>
          <div className="editing-summary-heading">
            <h4>
              {chapter.number}. {chapter.workingTitle || "Bez tytułu"}
            </h4>
            {chapter.autoSummaryStale === 1 ? (
              <StatusPill tone="warn">nieaktualne</StatusPill>
            ) : null}
          </div>
          <SummaryEditor
            initialValue={chapter.autoSummary}
            placeholder="Brak auto-streszczenia rozdziału."
            onSave={async (value) => {
              await saveChapterAutoSummary({ chapterId: chapter.id, autoSummary: value });
              await invalidate();
              setStatusText(`Zapisano streszczenie rozdziału ${chapter.number}`);
            }}
          />
        </div>
      ))}

      <h3>Sceny</h3>
      {scenes.map(({ scene, chapter }) => {
        const stale =
          fnv1aHash(htmlToPlainText(scene.manuscriptContent ?? "")) !==
          scene.autoSummarySourceHash;
        return (
          <div className="editing-summary-block" key={scene.id}>
            <div className="editing-summary-heading">
              <h4>
                {scene.title || "Bez tytułu"}
                {chapter ? (
                  <span className="muted-text"> — rozdz. {chapter.number}</span>
                ) : null}
              </h4>
              {stale ? <StatusPill tone="warn">nieaktualne</StatusPill> : null}
              <Button
                variant="ghost"
                size="sm"
                title="Wygeneruj streszczenie tej sceny od nowa przez AI"
                onClick={() => {
                  setStatusText("Odświeżam streszczenie sceny…");
                  void refreshSceneAutoSummary(
                    projectId,
                    book.id,
                    scene.id,
                    { onSaved: invalidate, onStatus: setStatusText },
                    true
                  );
                }}
              >
                <RefreshCw size={14} />
                Odśwież (AI)
              </Button>
            </div>
            <SummaryEditor
              initialValue={scene.autoSummary}
              placeholder="Brak auto-streszczenia sceny."
              onSave={async (value) => {
                // Zachowujemy dotychczasowy hash: ręczna edycja nie udaje świeżości.
                await saveSceneAutoSummary({
                  sceneId: scene.id,
                  autoSummary: value,
                  sourceHash: scene.autoSummarySourceHash
                });
                await invalidate();
                setStatusText("Zapisano streszczenie sceny");
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function SummaryEditor({
  initialValue,
  placeholder,
  onSave
}: {
  initialValue: string;
  placeholder: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);
  const saveMutation = useMutation({ mutationFn: onSave });
  const dirty = value !== initialValue;

  return (
    <div className="editing-summary-editor">
      <textarea
        value={value}
        placeholder={placeholder}
        rows={4}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="editing-row-actions">
        <Button
          variant="primary"
          size="sm"
          disabled={!dirty}
          busy={saveMutation.isPending}
          onClick={() => saveMutation.mutate(value)}
        >
          <Save size={14} />
          Zapisz
        </Button>
        {saveMutation.isError ? (
          <span className="warning-text">Nie udało się zapisać.</span>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function orderedScenesWithChapters(
  plan: BookPlan
): Array<{ scene: Scene; chapter: Chapter | null }> {
  const chapters = [...plan.chapters].sort((a, b) => a.number - b.number);
  const result: Array<{ scene: Scene; chapter: Chapter | null }> = [];
  for (const chapter of chapters) {
    const chapterScenes = plan.scenes
      .filter((scene) => scene.chapterId === chapter.id)
      .sort((a, b) => a.orderIndex - b.orderIndex);
    for (const scene of chapterScenes) {
      result.push({ scene, chapter });
    }
  }
  const orphanScenes = plan.scenes
    .filter((scene) => !scene.chapterId || !chapters.some((chapter) => chapter.id === scene.chapterId))
    .sort((a, b) => a.orderIndex - b.orderIndex);
  for (const scene of orphanScenes) {
    result.push({ scene, chapter: null });
  }
  return result;
}
