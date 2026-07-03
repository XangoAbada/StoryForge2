import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Download,
  ExternalLink,
  FileArchive,
  FileText,
  FolderOpen,
  Loader2,
  Palette,
  Save,
  Sparkles
} from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  chooseExportDirectory,
  exportBook,
  getBookPlan,
  getProject,
  getWorldWorkspace,
  listExportPresets,
  revealExportFile,
  saveExportPreset
} from "../../shared/api/commands";
import type {
  Book,
  BookPlan,
  ExportBookResult,
  ExportContentMode,
  ExportFormat,
  ExportSeparatorSettings,
  ExportStyleSettings,
  VisualAsset,
  WorldWorkspace
} from "../../shared/api/types";
import { coverImageSource } from "../../shared/api/assets";
import { Button, Chip, Field, Segmented } from "../../shared/ui";
import { useCodexSettingsStore } from "../ai/codexSettingsStore";
import {
  EXPORT_ARTWORK_FIELD,
  pendingProposalStatus,
  useProposalStore
} from "../ai/proposalStore";
import {
  buildExportPreviewBlocks,
  defaultExportStyle,
  selectedExportChapters
} from "./exportFormatting";

type ExportPageProps = {
  projectId: string;
};

type ExportedFile = ExportBookResult & {
  id: string;
  createdAt: string;
};

const exportFormats: Array<{ value: ExportFormat; label: string; hint: string }> = [
  { value: "markdown", label: "Markdown", hint: ".md do dalszej pracy" },
  { value: "txt", label: "TXT", hint: "czysty tekst" },
  { value: "docx", label: "DOCX", hint: "z numeracją stron" },
  { value: "epub", label: "EPUB", hint: "ebook" },
  { value: "mobi", label: "MOBI", hint: "konwersja z EPUB" }
];

export function ExportPage({ projectId }: ExportPageProps) {
  const queryClient = useQueryClient();
  const enqueueProposal = useProposalStore((state) => state.enqueueProposal);
  const proposals = useProposalStore((state) => state.proposals);
  const codexPath = useCodexSettingsStore((state) => state.codexPath);
  const timeoutSeconds = useCodexSettingsStore((state) => state.timeoutSeconds);
  const model = useCodexSettingsStore((state) => state.model);
  const reasoningEffort = useCodexSettingsStore((state) => state.reasoningEffort);
  const [format, setFormat] = useState<ExportFormat>("docx");
  const [contentMode, setContentMode] = useState<ExportContentMode>("manuscript");
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);
  const [style, setStyle] = useState<ExportStyleSettings>(defaultExportStyle);
  const [outputDirectory, setOutputDirectory] = useState("");
  const [presetName, setPresetName] = useState("Domyślny eksport");
  const [statusText, setStatusText] = useState("");
  const [exportedFiles, setExportedFiles] = useState<ExportedFile[]>([]);

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId),
    retry: 0
  });
  const book = projectQuery.data?.book;
  const bookId = book?.id;
  const planQuery = useQuery({
    queryKey: ["book-plan", bookId],
    queryFn: () => getBookPlan(bookId ?? ""),
    enabled: Boolean(bookId),
    retry: 0
  });
  const worldQuery = useQuery({
    queryKey: ["world-workspace", projectId],
    queryFn: () => getWorldWorkspace(projectId),
    retry: 0
  });
  const presetsQuery = useQuery({
    queryKey: ["export-presets", projectId, bookId],
    queryFn: () => listExportPresets(projectId, bookId ?? ""),
    enabled: Boolean(bookId),
    retry: 0
  });

  const plan = planQuery.data ?? emptyPlan(bookId ?? "");
  const world = worldQuery.data ?? emptyWorldWorkspace();
  const chapters = selectedExportChapters(plan, []);
  const activeChapterIds = selectedChapterIds.length
    ? selectedChapterIds
    : chapters.map((chapter) => chapter.id);
  const previewBlocks = book
    ? buildExportPreviewBlocks({
        book,
        plan,
        chapterIds: activeChapterIds,
        contentMode,
        style,
        visualAssets: world.visualAssets,
        previewLimit: 3
      })
    : [];
  const selectedChapterCount = activeChapterIds.length;
  const pendingArtworkStatus = pendingProposalStatus(proposals, {
    projectId,
    bookId,
    field: EXPORT_ARTWORK_FIELD,
    action: "generate_export_artwork",
    scope: "export"
  });

  const chooseDirectoryMutation = useMutation({
    mutationFn: chooseExportDirectory,
    onSuccess: (selectedDirectory) => {
      if (selectedDirectory) {
        setOutputDirectory(selectedDirectory);
        setStatusText(`Folder eksportu: ${selectedDirectory}`);
        return;
      }
      setStatusText("Nie wybrano folderu eksportu.");
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : String(error));
    }
  });

  const exportMutation = useMutation({
    mutationFn: () => {
      if (!book) {
        throw new Error("Nie znaleziono książki.");
      }
      return exportBook({
        projectId,
        bookId: book.id,
        format,
        chapterIds: activeChapterIds,
        contentMode,
        style,
        outputDirectory: outputDirectory.trim() || null
      });
    },
    onMutate: () => {
      setStatusText("Tworzę plik eksportu...");
    },
    onSuccess: (result) => {
      setExportedFiles((current) => [
        {
          ...result,
          id: `${Date.now()}:${result.filePath}`,
          createdAt: new Date().toISOString()
        },
        ...current
      ]);
      setStatusText(
        result.warning
          ? `${result.warning} Plik: ${result.filePath}`
          : `Zapisano eksport: ${result.filePath}`
      );
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : String(error));
    }
  });

  const revealMutation = useMutation({
    mutationFn: revealExportFile,
    onSuccess: () => {
      setStatusText("Otworzono lokalizację pliku eksportu.");
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : String(error));
    }
  });

  const presetMutation = useMutation({
    mutationFn: () => {
      if (!book) {
        throw new Error("Nie znaleziono książki.");
      }
      return saveExportPreset({
        projectId,
        bookId: book.id,
        name: presetName,
        settingsJson: JSON.stringify({ format, contentMode, selectedChapterIds, style, outputDirectory })
      });
    },
    onSuccess: async () => {
      setStatusText("Zapisano preset eksportu.");
      await queryClient.invalidateQueries({ queryKey: ["export-presets", projectId, bookId] });
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : String(error));
    }
  });

  const acceptedExportAssets = useMemo(
    () =>
      world.visualAssets.filter(
        (asset) =>
          asset.status === "canon" &&
          asset.assetType === "image" &&
          ["book", "chapter", "scene"].includes(asset.relatedType)
      ),
    [world.visualAssets]
  );

  function toggleChapter(chapterId: string) {
    setSelectedChapterIds((current) =>
      current.includes(chapterId)
        ? current.filter((id) => id !== chapterId)
        : [...current, chapterId]
    );
  }

  function updateSeparator(
    key: "chapterSeparator" | "sceneSeparator",
    patch: Partial<ExportSeparatorSettings>
  ) {
    setStyle((current) => ({
      ...current,
      [key]: {
        ...current[key],
        ...patch
      }
    }));
  }

  function applyPreset(settingsJson: string) {
    try {
      const parsed = JSON.parse(settingsJson) as {
        format?: ExportFormat;
        contentMode?: ExportContentMode;
        selectedChapterIds?: string[];
        style?: ExportStyleSettings;
        outputDirectory?: string;
      };
      if (parsed.format) setFormat(parsed.format);
      if (parsed.contentMode) setContentMode(parsed.contentMode);
      if (Array.isArray(parsed.selectedChapterIds)) {
        setSelectedChapterIds(parsed.selectedChapterIds);
      }
      if (parsed.style) setStyle(parsed.style);
      if (typeof parsed.outputDirectory === "string") {
        setOutputDirectory(parsed.outputDirectory);
      }
      setStatusText("Wczytano preset.");
    } catch {
      setStatusText("Nie udało się wczytać presetu.");
    }
  }

  function enqueueArtwork(target: "book" | "chapter" | "scene") {
    if (!book) {
      return;
    }
    const firstChapter = chapters.find((chapter) => activeChapterIds.includes(chapter.id));
    const relatedType = target === "chapter" && firstChapter ? "chapter" : "book";
    const relatedId = relatedType === "chapter" && firstChapter ? firstChapter.id : book.id;
    const targetLabel =
      relatedType === "chapter" && firstChapter
        ? `rozdziału ${firstChapter.number}: ${firstChapter.workingTitle}`
        : "książki";
    const imagePrompt = [
      `Elegancka grafika separatora eksportu dla ${targetLabel}.`,
      `Tytuł: ${book.title || book.workingTitle}.`,
      book.genre ? `Gatunek: ${book.genre}.` : "",
      book.tone ? `Ton: ${book.tone}.` : "",
      book.styleGuide ? `Style guide: ${book.styleGuide}.` : "",
      "Bez tekstu na obrazie, czytelny ornament, użyteczne jako separator w książce."
    ]
      .filter(Boolean)
      .join("\n");
    const promptPackageJson = {
      version: 1,
      kind: "export_artwork",
      context: {
        targetEntityId: relatedId,
        relatedType,
        book: {
          title: book.title,
          workingTitle: book.workingTitle,
          genre: book.genre,
          tone: book.tone,
          styleGuide: book.styleGuide
        },
        chapter: firstChapter ?? null
      }
    };

    enqueueProposal({
      scope: "export",
      projectId,
      bookId: book.id,
      field: EXPORT_ARTWORK_FIELD,
      action: "generate_export_artwork",
      promptPackageId: `export-artwork:${relatedType}:${relatedId}`,
      promptPackageJson,
      prompt: imagePrompt,
      coverPrompt: imagePrompt,
      coverNegativePrompt: "tekst, litery, logo, watermark, niska jakość"
    });
    setStatusText("Dodano grafikę eksportu do kolejki AI.");
  }

  function showExportFile(filePath: string) {
    if (filePath.startsWith("browser-preview://")) {
      setStatusText("W trybie podglądu przeglądarkowego plik nie istnieje na dysku.");
      return;
    }
    revealMutation.mutate(filePath);
  }

  const exportState = exportMutation.isPending
    ? "running"
    : exportMutation.isError
      ? "error"
      : exportedFiles.length
        ? "success"
        : "idle";
  const lastExportedFile = exportedFiles[0] ?? null;

  return (
    <section className="export-workbench">
      <div className="export-toolbar">
        <div>
          <p className="eyebrow">Eksport</p>
          <h2>{book?.workingTitle || "Manuskrypt"}</h2>
        </div>
        <Button
          variant="primary"
          busy={exportMutation.isPending}
          onClick={() => exportMutation.mutate()}
          disabled={!book}
        >
          {exportMutation.isPending ? (
            "Eksportuję..."
          ) : (
            <>
              <Download size={17} />
              Eksportuj
            </>
          )}
        </Button>
      </div>

      <section className={`export-job-status ${exportState}`} aria-live="polite">
        <div className="export-job-icon">
          {exportState === "running" ? (
            <Loader2 size={18} className="spin-icon" />
          ) : exportState === "error" ? (
            <AlertCircle size={18} />
          ) : exportState === "success" ? (
            <CheckCircle2 size={18} />
          ) : (
            <Download size={18} />
          )}
        </div>
        <div className="export-job-copy">
          <strong>
            {exportState === "running"
              ? "Trwa generowanie eksportu"
              : exportState === "error"
                ? "Eksport nie powiódł się"
                : exportState === "success"
                  ? "Ostatni eksport gotowy"
                  : "Eksport gotowy do uruchomienia"}
          </strong>
          <span>
            {exportState === "running"
              ? `Tworzę plik ${formatLabel(format)} dla ${selectedChapterCount} rozdz.`
              : statusText || "Wybierz format, zakres i kliknij Eksportuj."}
          </span>
          {exportState === "running" ? <span className="export-progress-bar" /> : null}
        </div>
        {lastExportedFile ? (
          <Button
            size="sm"
            onClick={() => showExportFile(lastExportedFile.filePath)}
            disabled={revealMutation.isPending}
          >
            <FolderOpen size={16} />
            Pokaż plik
          </Button>
        ) : null}
      </section>

      <div className="export-layout">
        <aside className="export-controls" aria-label="Ustawienia eksportu">
          <section className="export-panel">
            <div className="section-title-row">
              <FileArchive size={18} />
              <h3>Format</h3>
            </div>
            <div className="format-grid">
              {exportFormats.map((item) => (
                <button
                  type="button"
                  key={item.value}
                  className={format === item.value ? "format-tile active" : "format-tile"}
                  onClick={() => setFormat(item.value)}
                >
                  <strong>{item.label}</strong>
                  <span>{item.hint}</span>
                </button>
              ))}
            </div>
            {format !== "docx" ? (
              <p className="muted-text">Numeracja stron jest dostępna tylko dla DOCX.</p>
            ) : null}
          </section>

          <section className="export-panel">
            <div className="section-title-row">
              <FolderOpen size={18} />
              <h3>Folder zapisu</h3>
            </div>
            <Field label="Lokalizacja eksportu">
              <div className="folder-field-row">
                <input
                  value={outputDirectory}
                  readOnly
                  placeholder="Domyślny folder aplikacji"
                  title={outputDirectory || "Domyślny folder aplikacji"}
                />
                <Button
                  variant="icon"
                  onClick={() => chooseDirectoryMutation.mutate()}
                  disabled={chooseDirectoryMutation.isPending}
                  title="Wybierz folder zapisu eksportu"
                  aria-label="Wybierz folder zapisu eksportu"
                >
                  {chooseDirectoryMutation.isPending ? (
                    <Loader2 size={16} className="ui-spin" />
                  ) : (
                    <FolderOpen size={16} />
                  )}
                </Button>
              </div>
            </Field>
            {outputDirectory ? (
              <Button variant="ghost" size="sm" onClick={() => setOutputDirectory("")}>
                Użyj folderu domyślnego
              </Button>
            ) : null}
          </section>

          <section className="export-panel">
            <div className="section-title-row">
              <FileText size={18} />
              <h3>Zakres</h3>
            </div>
            <Segmented
              ariaLabel="Tryb treści eksportu"
              value={contentMode}
              onChange={setContentMode}
              items={[
                { id: "manuscript", label: "Rękopis" },
                { id: "manuscript_with_summaries", label: "Z adnotacjami" }
              ]}
            />
            <div className="chapter-export-list">
              {chapters.map((chapter) => (
                <label key={chapter.id} className="chapter-export-row">
                  <input
                    type="checkbox"
                    checked={activeChapterIds.includes(chapter.id)}
                    onChange={() => toggleChapter(chapter.id)}
                  />
                  <span>
                    <b>{chapter.number}.</b> {chapter.workingTitle || "Bez tytułu"}
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="export-panel">
            <div className="section-title-row">
              <Save size={18} />
              <h3>Presety</h3>
            </div>
            <Field
              label="Nazwa presetu"
              actions={
                <Button
                  variant="icon"
                  title="Zaproponuj nazwę presetu"
                  aria-label="Zaproponuj nazwę presetu"
                  onClick={() => setPresetName("Eksport z separatorami")}
                >
                  <Bot size={15} />
                </Button>
              }
            >
              <input
                value={presetName}
                onChange={(event) => setPresetName(event.target.value)}
              />
            </Field>
            <Button
              block
              busy={presetMutation.isPending}
              onClick={() => presetMutation.mutate()}
              disabled={!book}
            >
              <Save size={16} />
              Zapisz preset
            </Button>
            {presetsQuery.data?.length ? (
              <div className="preset-list">
                {presetsQuery.data.map((preset) => (
                  <Chip
                    key={preset.id}
                    tone="accent"
                    title="Wczytaj preset"
                    onClick={() => applyPreset(preset.settingsJson)}
                  >
                    {preset.name}
                  </Chip>
                ))}
              </div>
            ) : null}
          </section>
        </aside>

        <main className="export-preview-column">
          <section className="export-panel style-panel">
            <div className="section-title-row">
              <Palette size={18} />
              <h3>Styl separatorów</h3>
            </div>
            <div className="separator-grid">
              <SeparatorEditor
                title="Rozdziały"
                settings={style.chapterSeparator}
                assets={acceptedExportAssets}
                onChange={(patch) => updateSeparator("chapterSeparator", patch)}
                onGenerateArtwork={() => enqueueArtwork("chapter")}
                pending={Boolean(pendingArtworkStatus)}
              />
              <SeparatorEditor
                title="Sceny"
                settings={style.sceneSeparator}
                assets={acceptedExportAssets}
                onChange={(patch) => updateSeparator("sceneSeparator", patch)}
                onGenerateArtwork={() => enqueueArtwork("scene")}
                pending={Boolean(pendingArtworkStatus)}
              />
            </div>
          </section>

          <section className="export-panel preview-panel">
            <div className="section-title-row">
              <CheckCircle2 size={18} />
              <h3>Podgląd próbki</h3>
              <span className="pill">{selectedChapterCount} rozdz.</span>
            </div>
            <div className="export-preview-page">
              {previewBlocks.length ? (
                previewBlocks.map((block) => (
                  <PreviewBlock
                    key={`${block.kind}:${block.id}`}
                    block={block}
                    chapterStyle={style.chapterSeparator}
                    sceneStyle={style.sceneSeparator}
                  />
                ))
              ) : (
                <p className="muted-text">Brak treści do podglądu.</p>
              )}
            </div>
          </section>
        </main>
      </div>

      <section className="export-panel export-files-panel">
        <div className="section-title-row">
          <FolderOpen size={18} />
          <h3>Utworzone pliki</h3>
        </div>
        {exportedFiles.length ? (
          <div className="export-file-list">
            {exportedFiles.map((file) => (
              <article className="export-file-card ui-card" key={file.id}>
                <div className="export-file-main">
                  <span className="export-file-format">{formatLabel(file.format)}</span>
                  <div>
                    <strong>{fileNameFromPath(file.filePath)}</strong>
                    <small>{new Date(file.createdAt).toLocaleString()}</small>
                  </div>
                </div>
                <code>{file.filePath}</code>
                {file.warning ? <p className="warning-text">{file.warning}</p> : null}
                {file.fallbackFilePath && file.fallbackFilePath !== file.filePath ? (
                  <small className="muted-text">Plik zapasowy: {file.fallbackFilePath}</small>
                ) : null}
                <div className="export-file-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => showExportFile(file.filePath)}
                    disabled={revealMutation.isPending}
                  >
                    <ExternalLink size={15} />
                    Pokaż w folderze
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted-text">
            Po eksporcie pojawią się tutaj utworzone pliki z szybką akcją otwarcia lokalizacji.
          </p>
        )}
      </section>
    </section>
  );
}

type SeparatorEditorProps = {
  title: string;
  settings: ExportSeparatorSettings;
  assets: VisualAsset[];
  pending: boolean;
  onChange: (patch: Partial<ExportSeparatorSettings>) => void;
  onGenerateArtwork: () => void;
};

function SeparatorEditor({
  title,
  settings,
  assets,
  pending,
  onChange,
  onGenerateArtwork
}: SeparatorEditorProps) {
  return (
    <div className="separator-editor">
      <div className="separator-editor-heading">
        <h4>{title}</h4>
        <Button
          variant="ai"
          size="sm"
          busy={pending}
          onClick={onGenerateArtwork}
          title="Wygeneruj grafikę separatora"
          aria-label="Wygeneruj grafikę separatora"
        >
          {pending ? null : <Sparkles size={15} />}
        </Button>
      </div>
      <Field
        label="Tekst / ornament"
        actions={
          <Button
            variant="icon"
            title="Zaproponuj ornament dla tego separatora"
            aria-label="Zaproponuj ornament dla tego separatora"
            onClick={() => onChange({ text: title === "Rozdziały" ? "Rozdział {number}. {title}" : "✦ ✦ ✦" })}
          >
            <Bot size={15} />
          </Button>
        }
      >
        <input
          value={settings.text}
          onChange={(event) => onChange({ text: event.target.value })}
        />
      </Field>
      <div className="separator-controls">
        <Field label="Rozmiar">
          <input
            type="number"
            min={10}
            max={48}
            value={settings.fontSize}
            onChange={(event) => onChange({ fontSize: clampNumber(Number(event.target.value), 10, 48) })}
          />
        </Field>
        <Field label="Przed">
          <input
            type="number"
            min={0}
            max={80}
            value={settings.spacingBefore}
            onChange={(event) => onChange({ spacingBefore: clampNumber(Number(event.target.value), 0, 80) })}
          />
        </Field>
        <Field label="Po">
          <input
            type="number"
            min={0}
            max={80}
            value={settings.spacingAfter}
            onChange={(event) => onChange({ spacingAfter: clampNumber(Number(event.target.value), 0, 80) })}
          />
        </Field>
      </div>
      <div className="separator-controls">
        <Field label="Wyrównanie">
          <select
            value={settings.align}
            onChange={(event) => onChange({ align: event.target.value as ExportSeparatorSettings["align"] })}
          >
            <option value="left">Lewo</option>
            <option value="center">Środek</option>
            <option value="right">Prawo</option>
          </select>
        </Field>
        <Field label="Kolor" className="color-field">
          <input
            type="color"
            value={settings.color}
            onChange={(event) => onChange({ color: event.target.value })}
          />
        </Field>
        <Field label="Tło" className="color-field">
          <input
            type="color"
            value={settings.background}
            onChange={(event) => onChange({ background: event.target.value })}
          />
        </Field>
      </div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={settings.line}
          onChange={(event) => onChange({ line: event.target.checked })}
        />
        Linia przy separatorze
      </label>
      <Field label="Grafika">
        <select
          value={settings.imageAssetId ?? ""}
          onChange={(event) => onChange({ imageAssetId: event.target.value || null })}
        >
          <option value="">Bez grafiki</option>
          {assets.map((asset) => (
            <option value={asset.id} key={asset.id}>
              {asset.title || asset.relatedType}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

type PreviewBlockProps = {
  block: ReturnType<typeof buildExportPreviewBlocks>[number];
  chapterStyle: ExportSeparatorSettings;
  sceneStyle: ExportSeparatorSettings;
};

function PreviewBlock({ block, chapterStyle, sceneStyle }: PreviewBlockProps) {
  if (block.kind === "cover") {
    return (
      <div className={block.imagePath ? "preview-cover has-image" : "preview-cover"}>
        {block.imagePath ? (
          <img src={coverImageSource(block.imagePath)} alt={`Okładka książki ${block.title}`} />
        ) : (
          <strong>{block.title}</strong>
        )}
      </div>
    );
  }
  const style = block.kind === "chapter" ? chapterStyle : sceneStyle;
  if (block.kind === "body") {
    return <p className="preview-body">{block.text}</p>;
  }
  if (block.kind === "summary") {
    return <p className="preview-summary">{block.text}</p>;
  }
  return (
    <div
      className={`preview-separator ${block.kind}`}
      style={{
        textAlign: style.align,
        color: style.color,
        backgroundColor: style.background,
        marginTop: style.spacingBefore,
        marginBottom: style.spacingAfter,
        fontSize: style.fontSize
      }}
    >
      {style.line ? <span className="separator-line" /> : null}
      {block.image ? (
        <img src={coverImageSource(block.image.filePath)} alt="" />
      ) : null}
      <strong>{block.text}</strong>
    </div>
  );
}

function formatLabel(format: ExportFormat): string {
  return exportFormats.find((item) => item.value === format)?.label ?? format.toUpperCase();
}

function fileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? filePath;
}

function emptyPlan(bookId: string): BookPlan {
  const now = new Date().toISOString();
  return {
    planVersion: {
      id: "empty",
      bookId,
      name: "Plan główny",
      description: "",
      isActive: true,
      createdAt: now,
      updatedAt: now
    },
    planVersions: [],
    structure: null,
    acts: [],
    beats: [],
    threads: [],
    chapters: [],
    chapterThreads: [],
    chapterBeats: [],
    scenes: [],
    sceneCharacters: [],
    sceneThreads: [],
    sceneWorldElements: [],
    sceneWorldRules: []
  };
}

function emptyWorldWorkspace(): WorldWorkspace {
  return {
    elements: [],
    rules: [],
    elementCharacters: [],
    elementThreads: [],
    elementChapters: [],
    elementScenes: [],
    elementRules: [],
    ruleThreads: [],
    ruleChapters: [],
    ruleScenes: [],
    visualAssets: []
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
