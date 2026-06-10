import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import type { JobCategory, ResumeKind, ResumeVersion } from "./types";
import {
  countVersionsByCategory,
  createCategory,
  createVersion,
  deleteCategory,
  deleteVersion,
  listCategories,
  listVersions,
  updateCategory,
  updateVersion,
} from "./db";
import {
  exportFileToDialog,
  importPdfFromDialog,
  readVaultPdf,
  removeVaultFile,
} from "./vault";
import {
  bytesToBase64,
  compileLatex,
  pdfBytesFromResult,
  type CompileAsset,
} from "./latexCompile";
import {
  createCheckpoint,
  getAssetBytes,
  getAssetByName,
  getCategory,
  getVersion,
  linkAssetToVersion,
  listAssetsForVersion,
  listCheckpoints,
} from "./db";
import HistoryPanel from "./HistoryPanel";
import AttachmentsModal from "./AttachmentsModal";
import AssetsPanel from "./AssetsPanel";
import CodeEditor from "./CodeEditor";
import { openUrl } from "@tauri-apps/plugin-opener";
import { findReferencedAssets } from "./assetScan";
import { useThumbnail } from "./useThumbnail";
import {
  gitConnect,
  gitDisconnect,
  gitStatus,
  isGitConnected,
  loadGitConfig,
  saveGitConfig,
  clearGitConfig,
  pushCheckpoint,
  pushNewVersion,
  pushDeleteVersion,
  pushDeleteCategory,
  pushDeleteBulk,
  syncVaultManual,
  throwGitError,
  categorySlug,
  versionFilePath,
  versionHistoryPath,
  versionMetaPath,
  type GitConfig,
  type GitStatus,
} from "./github";
import {
  gitPull,
  gitRemoteSnapshot,
  importRemoteVault,
  snapshotHasCategories,
  type PullSummary,
} from "./githubPull";
import { useSync } from "./SyncStatus";
import {
  AI_PRESETS,
  aiCancel,
  aiRewrite,
  claudeCodeCheck,
  isAiConfigured,
  loadAiConfig,
  saveAiConfig,
  testAiConnection,
  AiError,
  type AiConfig,
  type AiErrorCode,
  type AiPreset,
} from "./ai";
import { aiInline } from "./aiInline";
import { EMOJI_PICKS, GRADIENTS, gradientFor, initials } from "./iconUtils";
import { useDialogs } from "./Dialogs";
import { useLocale, useT, type LangPref } from "./i18n";

// Default template: LaTeXTemplates.com Medium Length Professional CV v3.0
// resume.cls is provided automatically by the Rust compile step.
const LATEX_TEMPLATE = String.raw`%----------------------------------------------------------------------------------------
%	Medium Length Professional CV
%	resume.cls is provided by Resume Vault — do not delete \documentclass{resume}
%----------------------------------------------------------------------------------------

\documentclass[11pt]{resume}
\usepackage{ebgaramond}

\name{Your Name}
\address{123 Street \\ City, State 12345}
\address{(000)~$\cdot$~000~$\cdot$~0000 \\ you@example.com}

\begin{document}

\begin{rSection}{Education}
    \textbf{Your University} \hfill \textit{Graduation Year} \\
    Degree \\
    GPA: x.xx
\end{rSection}

\begin{rSection}{Experience}

    \begin{rSubsection}{Company A}{Start -- Present}{Role}{Location}
        \item Achievement or responsibility number one.
        \item Achievement or responsibility number two.
    \end{rSubsection}

    \begin{rSubsection}{Company B}{Start -- End}{Role}{Location}
        \item Achievement or responsibility number one.
        \item Achievement or responsibility number two.
    \end{rSubsection}

\end{rSection}

\begin{rSection}{Technical Strengths}

    \begin{tabular}{@{} >{\bfseries}l @{\hspace{6ex}} l @{}}
        Languages    & Python, TypeScript, Go \\
        Databases    & PostgreSQL, Redis \\
        Tools        & Docker, Kubernetes, Git
    \end{tabular}

\end{rSection}

\end{document}
`;

type View =
  | { kind: "home" }
  | { kind: "category"; categoryId: number }
  | { kind: "version"; categoryId: number; versionId: number }
  | { kind: "assets" };

type SelectMode = null | "categories" | "versions";

export default function App() {
  const [view, setView] = useState<View>({ kind: "home" });
  const [categories, setCategories] = useState<JobCategory[]>([]);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [versions, setVersions] = useState<ResumeVersion[]>([]);
  const [editingCategory, setEditingCategory] = useState<JobCategory | null>(null);
  const [editingVersion, setEditingVersion] = useState<ResumeVersion | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [selectMode, setSelectMode] = useState<SelectMode>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const dlg = useDialogs();
  const t = useT();
  const sync = useSync();

  const exitSelect = useCallback(() => {
    setSelectMode(null);
    setSelectedIds(new Set());
  }, []);

  const toggleSelected = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const refreshHome = useCallback(async () => {
    const [cs, ct] = await Promise.all([listCategories(), countVersionsByCategory()]);
    setCategories(cs);
    setCounts(ct);
  }, []);

  const refreshVersions = useCallback(async (catId: number) => {
    const vs = await listVersions(catId);
    setVersions(vs);
  }, []);

  // Stable identity: this reaches the CodeMirror AI extension, which must not
  // rebuild (and drop its rewrite session) on unrelated App re-renders.
  const openSettings = useCallback(() => setShowSettings(true), []);

  // Pull import rewrites the DB outside normal UI flows — refresh every view.
  const handleVaultChanged = useCallback(async () => {
    await refreshHome();
    if (view.kind === "category" || view.kind === "version") {
      await refreshVersions(view.categoryId);
    }
  }, [refreshHome, refreshVersions, view]);

  useEffect(() => {
    refreshHome().catch(console.error);
  }, [refreshHome]);

  useEffect(() => {
    if (view.kind === "category" || view.kind === "version") {
      refreshVersions(view.categoryId).catch(console.error);
    }
  }, [view, refreshVersions]);

  // Exit select mode when changing views — selection doesn't carry across scopes.
  useEffect(() => {
    exitSelect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.kind, view.kind === "category" ? view.categoryId : null]);

  const activeCategory = useMemo(() => {
    if (view.kind !== "category" && view.kind !== "version") return null;
    return categories.find((c) => c.id === view.categoryId) ?? null;
  }, [view, categories]);

  const activeVersion = useMemo(() => {
    if (view.kind !== "version") return null;
    return versions.find((v) => v.id === view.versionId) ?? null;
  }, [view, versions]);

  async function handleCreateCategory() {
    const name = await dlg.prompt({
      title: t("new_category"),
      label: t("new_category_label"),
      placeholder: t("new_category_placeholder"),
      confirmText: t("create"),
      cancelText: t("cancel"),
    });
    if (!name) return;
    const id = await createCategory(name, "");
    await refreshHome();
    setView({ kind: "category", categoryId: id });
  }

  async function handleDeleteCategory(c: JobCategory) {
    const ok = await dlg.confirm({
      title: t("delete_category_title"),
      message: t("delete_category_msg")(c.name),
      confirmText: t("delete"),
      cancelText: t("cancel"),
      danger: true,
    });
    if (!ok) return;
    const vs = await listVersions(c.id);
    for (const v of vs) if (v.file_path) await removeVaultFile(v.file_path);
    await deleteCategory(c.id);
    await refreshHome();
    if (
      (view.kind === "category" || view.kind === "version") &&
      view.categoryId === c.id
    ) {
      setView({ kind: "home" });
    }
    if (isGitConnected()) {
      void sync.run(`Delete ${c.name}`, async () => {
        const r = await pushDeleteCategory(c);
        if (!r.success) throwGitError(r);
      });
    }
  }

  async function handleAddVersion(kind: ResumeKind) {
    if (view.kind !== "category" && view.kind !== "version") return;
    const catId = view.categoryId;
    let createdId: number | null = null;
    if (kind === "latex") {
      const name = await dlg.prompt({
        title: t("new_latex_title"),
        label: t("version_name"),
        placeholder: t("latex_name_placeholder"),
        confirmText: t("create"),
        cancelText: t("cancel"),
      });
      if (!name) return;
      createdId = await createVersion({
        category_id: catId,
        name,
        kind: "latex",
        content: LATEX_TEMPLATE,
      });
    } else {
      const picked = await importPdfFromDialog();
      if (!picked) return;
      const name = await dlg.prompt({
        title: t("import_pdf_title"),
        label: t("version_name"),
        defaultValue: picked.originalName.replace(/\.pdf$/i, ""),
        confirmText: t("import"),
        cancelText: t("cancel"),
      });
      if (!name) {
        await removeVaultFile(picked.storedPath);
        return;
      }
      createdId = await createVersion({
        category_id: catId,
        name,
        kind: "pdf",
        file_path: picked.storedPath,
      });
    }
    await refreshVersions(catId);
    await refreshHome();
    setView({ kind: "version", categoryId: catId, versionId: createdId });

    // Auto-sync new version to GitHub if connected.
    if (isGitConnected() && createdId != null) {
      const [cat, ver] = await Promise.all([
        getCategory(catId),
        getVersion(createdId),
      ]);
      if (cat && ver) {
        void sync.run(`${ver.name}`, async () => {
          const r = await pushNewVersion(cat, ver);
          if (!r.success) throwGitError(r);
        });
      }
    }
  }

  async function handleBulkDelete() {
    if (!selectMode || selectedIds.size === 0) return;
    if (selectMode === "categories") {
      const ok = await dlg.confirm({
        title: t("delete_n_categories_title"),
        message: t("delete_n_categories_msg")(selectedIds.size),
        confirmText: t("delete"),
        cancelText: t("cancel"),
        danger: true,
      });
      if (!ok) return;
      const toDelete = categories.filter((c) => selectedIds.has(c.id));
      const paths: string[] = [];
      for (const c of toDelete) {
        const vs = await listVersions(c.id);
        for (const v of vs) if (v.file_path) await removeVaultFile(v.file_path);
        await deleteCategory(c.id);
        paths.push(`categories/${categorySlug(c)}`);
      }
      exitSelect();
      await refreshHome();
      if (
        (view.kind === "category" || view.kind === "version") &&
        selectedIds.has(view.categoryId)
      ) {
        setView({ kind: "home" });
      }
      if (isGitConnected() && paths.length) {
        const names = toDelete.map((c) => `"${c.name}"`).join(", ");
        const n = toDelete.length;
        void sync.run(`Delete ${n} categor${n === 1 ? "y" : "ies"}`, async () => {
          const r = await pushDeleteBulk(
            paths,
            `Delete ${n} categor${n === 1 ? "y" : "ies"}: ${names}`,
          );
          if (!r.success) throwGitError(r);
        });
      }
    } else {
      const ok = await dlg.confirm({
        title: t("delete_n_versions_title"),
        message: t("delete_n_versions_msg")(selectedIds.size),
        confirmText: t("delete"),
        cancelText: t("cancel"),
        danger: true,
      });
      if (!ok) return;
      const toDelete = versions.filter((v) => selectedIds.has(v.id));
      const cat =
        isGitConnected() &&
        (view.kind === "category" || view.kind === "version")
          ? await getCategory(view.categoryId)
          : null;
      const paths: string[] = [];
      for (const v of toDelete) {
        if (cat) {
          paths.push(
            versionFilePath(cat, v),
            versionMetaPath(cat, v),
            versionHistoryPath(cat, v),
          );
        }
        if (v.file_path) await removeVaultFile(v.file_path);
        await deleteVersion(v.id);
      }
      exitSelect();
      if (view.kind === "category") await refreshVersions(view.categoryId);
      await refreshHome();
      if (cat && paths.length) {
        const names = toDelete.map((v) => `"${v.name}"`).join(", ");
        const n = toDelete.length;
        void sync.run(`Delete ${n} version${n === 1 ? "" : "s"}`, async () => {
          const r = await pushDeleteBulk(
            paths,
            `Delete ${n} version${n === 1 ? "" : "s"} (${cat.name}): ${names}`,
          );
          if (!r.success) throwGitError(r);
        });
      }
    }
  }

  async function handleDeleteVersion(v: ResumeVersion) {
    const ok = await dlg.confirm({
      title: t("delete_version_title"),
      message: t("delete_version_msg")(v.name),
      confirmText: t("delete"),
      cancelText: t("cancel"),
      danger: true,
    });
    if (!ok) return;
    // Capture category before DB delete (need it for the git path).
    const cat = isGitConnected() ? await getCategory(v.category_id) : null;
    if (v.file_path) await removeVaultFile(v.file_path);
    await deleteVersion(v.id);
    if (view.kind === "version" && view.versionId === v.id) {
      setView({ kind: "category", categoryId: v.category_id });
    }
    await refreshVersions(v.category_id);
    await refreshHome();
    if (cat) {
      void sync.run(`Delete ${v.name}`, async () => {
        const r = await pushDeleteVersion(cat, v);
        if (!r.success) throwGitError(r);
      });
    }
  }

  return (
    <div className="app">
      <NavBar
        view={view}
        category={activeCategory}
        version={activeVersion}
        selectMode={selectMode}
        onBack={() => {
          if (view.kind === "version") {
            setView({ kind: "category", categoryId: view.categoryId });
          } else if (view.kind === "category" || view.kind === "assets") {
            setView({ kind: "home" });
          }
        }}
        onEditCategory={() => activeCategory && setEditingCategory(activeCategory)}
        onEditVersion={() => activeVersion && setEditingVersion(activeVersion)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenAssets={() => setView({ kind: "assets" })}
        onEnterSelect={() => {
          if (view.kind === "home") setSelectMode("categories");
          else if (view.kind === "category") setSelectMode("versions");
        }}
        onExitSelect={exitSelect}
      />

      <main className="content">
        {view.kind === "home" && (
          <HomeView
            categories={categories}
            counts={counts}
            onOpen={(c) => setView({ kind: "category", categoryId: c.id })}
            onCreate={handleCreateCategory}
            onEdit={(c) => setEditingCategory(c)}
            onDelete={handleDeleteCategory}
            selecting={selectMode === "categories"}
            selectedIds={selectedIds}
            onToggle={toggleSelected}
          />
        )}
        {view.kind === "category" && activeCategory && (
          <CategoryView
            category={activeCategory}
            versions={versions}
            onOpenVersion={(v) =>
              setView({ kind: "version", categoryId: v.category_id, versionId: v.id })
            }
            onAddVersion={handleAddVersion}
            onEditVersion={(v) => setEditingVersion(v)}
            onDeleteVersion={handleDeleteVersion}
            selecting={selectMode === "versions"}
            selectedIds={selectedIds}
            onToggle={toggleSelected}
          />
        )}
        {view.kind === "version" && activeVersion && (
          <VersionDetail
            version={activeVersion}
            onSaved={() => view.kind === "version" && refreshVersions(view.categoryId)}
            onOpenSettings={openSettings}
          />
        )}
        {view.kind === "assets" && <AssetsPanel />}
      </main>

      {editingCategory && (
        <CategoryEditorModal
          category={editingCategory}
          onClose={() => setEditingCategory(null)}
          onSaved={async () => {
            await refreshHome();
            setEditingCategory(null);
          }}
        />
      )}

      {editingVersion && (
        <VersionEditorModal
          version={editingVersion}
          onClose={() => setEditingVersion(null)}
          onSaved={async () => {
            if (view.kind === "category" || view.kind === "version") {
              await refreshVersions(view.categoryId);
            }
            await refreshHome();
            setEditingVersion(null);
          }}
        />
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onVaultChanged={handleVaultChanged}
        />
      )}

      {selectMode && (
        <SelectBar
          count={selectedIds.size}
          totalIds={
            selectMode === "categories"
              ? categories.map((c) => c.id)
              : versions.map((v) => v.id)
          }
          onSelectAll={(ids) => setSelectedIds(new Set(ids))}
          onClear={() => setSelectedIds(new Set())}
          onDelete={handleBulkDelete}
          onDone={exitSelect}
        />
      )}
    </div>
  );
}

function SelectBar({
  count,
  totalIds,
  onSelectAll,
  onClear,
  onDelete,
  onDone,
}: {
  count: number;
  totalIds: number[];
  onSelectAll: (ids: number[]) => void;
  onClear: () => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const allSelected = totalIds.length > 0 && count === totalIds.length;
  return (
    <div className="select-bar">
      <button
        className="bar-btn"
        onClick={() => (allSelected ? onClear() : onSelectAll(totalIds))}
      >
        {allSelected ? t("deselect_all") : t("select_all")}
      </button>
      <span className="bar-count">{t("selected_count")(count)}</span>
      <button
        className="bar-btn danger"
        disabled={count === 0}
        onClick={onDelete}
      >
        {t("delete_selected")} {count > 0 ? `(${count})` : ""}
      </button>
      <button className="bar-btn" onClick={onDone}>
        {t("done")}
      </button>
    </div>
  );
}

function NavBar({
  view,
  category,
  version,
  selectMode,
  onBack,
  onEditCategory,
  onEditVersion,
  onOpenSettings,
  onOpenAssets,
  onEnterSelect,
  onExitSelect,
}: {
  view: View;
  category: JobCategory | null;
  version: ResumeVersion | null;
  selectMode: SelectMode;
  onBack: () => void;
  onEditCategory: () => void;
  onEditVersion: () => void;
  onOpenSettings: () => void;
  onOpenAssets: () => void;
  onEnterSelect: () => void;
  onExitSelect: () => void;
}) {
  const t = useT();
  let title = t("app_title");
  let subtitle: string | null = null;
  if (view.kind === "category" && category) {
    title = category.name;
    subtitle = t("versions_in");
  } else if (view.kind === "version" && version && category) {
    title = version.name;
    subtitle = category.name;
  } else if (view.kind === "assets") {
    title = t("assets_library");
  }
  const canSelect =
    !selectMode && (view.kind === "home" || view.kind === "category");
  return (
    <header className="navbar">
      <div className="nav-left">
        {selectMode ? (
          <button className="nav-btn" onClick={onExitSelect}>
            {t("cancel")}
          </button>
        ) : view.kind !== "home" ? (
          <button className="nav-btn" onClick={onBack}>
            <span className="chev">‹</span> {t("back")}
          </button>
        ) : null}
      </div>
      <div className="nav-title">
        <div className="t1">{title}</div>
        {subtitle && <div className="t2">{subtitle}</div>}
      </div>
      <div className="nav-right">
        {!selectMode && view.kind === "category" && category && (
          <button className="nav-btn" onClick={onEditCategory}>
            {t("edit")}
          </button>
        )}
        {!selectMode && view.kind === "version" && version && (
          <button className="nav-btn" onClick={onEditVersion}>
            {t("edit")}
          </button>
        )}
        {canSelect && (
          <button className="nav-btn" onClick={onEnterSelect}>
            {t("select")}
          </button>
        )}
        {!selectMode && view.kind === "home" && (
          <>
            <button className="nav-btn" onClick={onOpenAssets}>
              {t("assets_library")}
            </button>
            <button
              className="nav-btn icon-btn"
              onClick={onOpenSettings}
              title={t("settings")}
              aria-label={t("settings")}
            >
              <GearIcon />
            </button>
          </>
        )}
      </div>
    </header>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function HomeView({
  categories,
  counts,
  onOpen,
  onCreate,
  onEdit,
  onDelete,
  selecting,
  selectedIds,
  onToggle,
}: {
  categories: JobCategory[];
  counts: Record<number, number>;
  onOpen: (c: JobCategory) => void;
  onCreate: () => void;
  onEdit: (c: JobCategory) => void;
  onDelete: (c: JobCategory) => void;
  selecting: boolean;
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
}) {
  const t = useT();
  return (
    <div className="grid">
      {categories.map((c) => (
        <CategoryCard
          key={c.id}
          category={c}
          count={counts[c.id] ?? 0}
          onOpen={() => (selecting ? onToggle(c.id) : onOpen(c))}
          onEdit={() => onEdit(c)}
          onDelete={() => onDelete(c)}
          selecting={selecting}
          selected={selectedIds.has(c.id)}
        />
      ))}
      {!selecting && <AddCard label={t("new_category")} onClick={onCreate} />}
    </div>
  );
}

function CategoryCard({
  category,
  count,
  onOpen,
  onEdit,
  onDelete,
  selecting,
  selected,
}: {
  category: JobCategory;
  count: number;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  selecting: boolean;
  selected: boolean;
}) {
  const t = useT();
  const bg = gradientFor(category.name, category.color);
  const symbol = category.icon || initials(category.name);
  return (
    <div
      className={`card-tile ${selecting ? "selecting" : ""} ${selected ? "selected" : ""}`}
      onClick={onOpen}
    >
      {selecting && <SelectCheck checked={selected} />}
      <div className="tile-icon" style={{ background: bg }}>
        <span className={category.icon ? "emoji" : "letters"}>{symbol}</span>
      </div>
      <div className="tile-meta">
        <div className="tile-name">{category.name}</div>
        {category.notes ? (
          <div className="tile-note">{category.notes}</div>
        ) : (
          <div className="tile-sub">{t("versions_count")(count)}</div>
        )}
      </div>
      {!selecting && (
        <div className="tile-actions" onClick={(e) => e.stopPropagation()}>
          <button className="tile-mini" onClick={onEdit} title={t("edit")}>
            ✎
          </button>
          <button
            className="tile-mini danger"
            onClick={onDelete}
            title={t("delete")}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function SelectCheck({ checked }: { checked: boolean }) {
  return (
    <div className={`select-check ${checked ? "on" : ""}`}>
      {checked && <span className="check">✓</span>}
    </div>
  );
}

function AddCard({
  label,
  onClick,
  tall = false,
}: {
  label: string;
  onClick: () => void;
  tall?: boolean;
}) {
  if (tall) {
    return (
      <div className="version-card add-tall" onClick={onClick}>
        <div className="page-thumb add-thumb">
          <span className="plus">+</span>
        </div>
        <div className="version-meta">
          <div className="tile-name muted">{label}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="card-tile add" onClick={onClick}>
      <div className="tile-icon add-icon">
        <span className="plus">+</span>
      </div>
      <div className="tile-meta">
        <div className="tile-name muted">{label}</div>
      </div>
    </div>
  );
}

function CategoryView({
  category,
  versions,
  onOpenVersion,
  onAddVersion,
  onEditVersion,
  onDeleteVersion,
  selecting,
  selectedIds,
  onToggle,
}: {
  category: JobCategory;
  versions: ResumeVersion[];
  onOpenVersion: (v: ResumeVersion) => void;
  onAddVersion: (k: ResumeKind) => void;
  onEditVersion: (v: ResumeVersion) => void;
  onDeleteVersion: (v: ResumeVersion) => void;
  selecting: boolean;
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
}) {
  const t = useT();
  return (
    <div className="cat-view">
      {category.jd_text && (
        <details className="jd-block">
          <summary>{t("job_description")}</summary>
          <pre>{category.jd_text}</pre>
        </details>
      )}
      <div className="version-grid">
        {versions.map((v) => (
          <VersionCard
            key={v.id}
            version={v}
            onOpen={() => (selecting ? onToggle(v.id) : onOpenVersion(v))}
            onEdit={() => onEditVersion(v)}
            onDelete={() => onDeleteVersion(v)}
            selecting={selecting}
            selected={selectedIds.has(v.id)}
          />
        ))}
        {!selecting && (
          <>
            <AddCard
              label={t("new_latex")}
              onClick={() => onAddVersion("latex")}
              tall
            />
            <AddCard
              label={t("import_pdf")}
              onClick={() => onAddVersion("pdf")}
              tall
            />
          </>
        )}
      </div>
    </div>
  );
}

function VersionCard({
  version,
  onOpen,
  onEdit,
  onDelete,
  selecting,
  selected,
}: {
  version: ResumeVersion;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  selecting: boolean;
  selected: boolean;
}) {
  const t = useT();
  const { url: thumbUrl, state: thumbState } = useThumbnail(version);
  const bg =
    version.kind === "tsx"
      ? "linear-gradient(135deg, #4f8cff 0%, #1a4fff 100%)"
      : version.kind === "latex"
      ? "linear-gradient(135deg, #5ed273 0%, #2aa84b 100%)"
      : "linear-gradient(135deg, #ff7059 0%, #d83026 100%)";
  const symbol =
    version.kind === "tsx" ? "</>" : version.kind === "latex" ? "TeX" : "PDF";
  const showThumb = !!thumbUrl;
  return (
    <div
      className={`version-card ${selecting ? "selecting" : ""} ${selected ? "selected" : ""}`}
      onClick={onOpen}
    >
      {selecting && <SelectCheck checked={selected} />}
      <div className={`page-thumb ${showThumb ? "" : "no-thumb"}`}>
        {showThumb ? (
          <img src={thumbUrl} alt={version.name} />
        ) : (
          <div className="thumb-placeholder" style={{ background: bg }}>
            <span className="letters">{symbol}</span>
            {thumbState === "loading" && (
              <span className="thumb-spinner-hint">{t("rendering")}</span>
            )}
            {thumbState === "failed" && (
              <span className="thumb-spinner-hint">{t("render_failed")}</span>
            )}
          </div>
        )}
        <span className={`kind-pill kind-${version.kind}`}>{symbol}</span>
      </div>
      <div className="version-meta">
        <div className="tile-name">{version.name}</div>
        {version.notes ? (
          <div className="tile-note">{version.notes}</div>
        ) : (
          <div className="tile-sub">{version.updated_at.slice(0, 10)}</div>
        )}
      </div>
      {!selecting && (
        <div className="tile-actions" onClick={(e) => e.stopPropagation()}>
          <button className="tile-mini" onClick={onEdit} title={t("edit")}>
            ✎
          </button>
          <button
            className="tile-mini danger"
            onClick={onDelete}
            title={t("delete")}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function VersionDetail({
  version,
  onSaved,
  onOpenSettings,
}: {
  version: ResumeVersion;
  onSaved: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="version-detail">
      {version.kind === "latex" ? (
        <LatexEditor
          version={version}
          onSaved={onSaved}
          onOpenSettings={onOpenSettings}
        />
      ) : version.kind === "pdf" ? (
        <PdfViewer version={version} />
      ) : (
        <LegacyTsxNotice version={version} />
      )}
    </div>
  );
}

function LegacyTsxNotice({ version }: { version: ResumeVersion }) {
  return (
    <div className="legacy-notice">
      <h3>TSX no longer supported</h3>
      <p>
        This version was created with the legacy React-PDF editor. The source is
        kept below — copy what you need and delete this version.
      </p>
      <textarea
        className="error-log"
        readOnly
        value={version.content ?? ""}
      />
    </div>
  );
}

function CategoryEditorModal({
  category,
  onClose,
  onSaved,
}: {
  category: JobCategory;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(category.name);
  const [jd, setJd] = useState(category.jd_text ?? "");
  const [notes, setNotes] = useState(category.notes ?? "");
  const [icon, setIcon] = useState<string | null>(category.icon);
  const [color, setColor] = useState<string | null>(category.color);

  async function handleSave() {
    await updateCategory(category.id, {
      name: name.trim(),
      jd_text: jd,
      notes,
      icon,
      color,
    });
    onSaved();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("edit_category")}</h3>

        <label className="field">
          <span>{t("name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="field">
          <span>{t("icon")}</span>
          <div className="emoji-grid">
            <button
              className={`emoji-pick ${icon === null ? "active" : ""}`}
              onClick={() => setIcon(null)}
              title={t("use_initials")}
            >
              Aa
            </button>
            {EMOJI_PICKS.map((e) => (
              <button
                key={e}
                className={`emoji-pick ${icon === e ? "active" : ""}`}
                onClick={() => setIcon(e)}
              >
                {e}
              </button>
            ))}
          </div>
        </label>

        <label className="field">
          <span>{t("color")}</span>
          <div className="color-grid">
            <button
              className={`color-pick ${color === null ? "active" : ""}`}
              onClick={() => setColor(null)}
              title={t("auto")}
              style={{ background: "#ddd" }}
            />
            {GRADIENTS.map((g) => (
              <button
                key={g.name}
                className={`color-pick ${color === g.name ? "active" : ""}`}
                onClick={() => setColor(g.name)}
                style={{ background: g.css }}
                title={g.name}
              />
            ))}
          </div>
        </label>

        <label className="field">
          <span>{t("notes")}</span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        <label className="field">
          <span>{t("job_description")}</span>
          <textarea
            rows={6}
            value={jd}
            onChange={(e) => setJd(e.target.value)}
          />
        </label>

        <div className="modal-actions">
          <button onClick={onClose}>{t("cancel")}</button>
          <button className="primary" onClick={handleSave}>
            {t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function VersionEditorModal({
  version,
  onClose,
  onSaved,
}: {
  version: ResumeVersion;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(version.name);
  const [notes, setNotes] = useState(version.notes ?? "");

  async function handleSave() {
    await updateVersion(version.id, { name: name.trim(), notes });
    onSaved();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <h3>{t("edit_version")}</h3>
        <label className="field">
          <span>{t("name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("notes")}</span>
          <textarea
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button onClick={onClose}>{t("cancel")}</button>
          <button
            className="primary"
            onClick={handleSave}
            disabled={!name.trim()}
          >
            {t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsModal({
  onClose,
  onVaultChanged,
}: {
  onClose: () => void;
  onVaultChanged: () => Promise<void>;
}) {
  const t = useT();
  const { pref, setPref } = useLocale();
  const options: { value: LangPref; label: string }[] = [
    { value: "system", label: t("lang_system") },
    { value: "en", label: t("lang_en") },
    { value: "zh", label: t("lang_zh") },
  ];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("settings")}</h3>
        <label className="field">
          <span>{t("language")}</span>
          <div className="segmented">
            {options.map((o) => (
              <button
                key={o.value}
                className={pref === o.value ? "seg-active" : ""}
                onClick={() => setPref(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </label>

        <GitHubSection onVaultChanged={onVaultChanged} />

        <AiSection />

        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            {t("ok")}
          </button>
        </div>
      </div>
    </div>
  );
}

const AI_PRESET_ORDER: AiPreset[] = [
  "claude",
  "openai",
  "deepseek",
  "kimi",
  "custom",
  "claude-code",
];

function AiSection() {
  const t = useT();
  const [cfg, setCfg] = useState<AiConfig>(() => loadAiConfig());
  const [cli, setCli] = useState<{ found: boolean; version: string | null } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testErr, setTestErr] = useState<string | null>(null);

  const presetLabel = (p: AiPreset): string => {
    switch (p) {
      case "claude": return "Claude (API)";
      case "openai": return "ChatGPT";
      case "deepseek": return "DeepSeek";
      case "kimi": return "Kimi";
      case "custom": return t("ai_preset_custom");
      case "claude-code": return t("ai_preset_claude_code");
    }
  };

  useEffect(() => {
    if (cfg.kind !== "claude-code") return;
    claudeCodeCheck().then(setCli).catch(console.error);
  }, [cfg.kind]);

  function update(patch: Partial<AiConfig>) {
    setCfg((c) => {
      const next = { ...c, ...patch };
      saveAiConfig(next);
      return next;
    });
    setTestMsg(null);
    setTestErr(null);
  }

  function handlePresetChange(p: AiPreset) {
    const def = AI_PRESETS[p];
    update({ preset: p, kind: def.kind, baseUrl: def.baseUrl, model: def.model });
  }

  async function handleTest() {
    setTesting(true);
    setTestMsg(null);
    setTestErr(null);
    try {
      await testAiConnection();
      setTestMsg(t("ai_test_ok"));
    } catch (e) {
      const log = e instanceof AiError ? (e.log ?? e.code) : String(e);
      setTestErr(log.slice(0, 1500));
    } finally {
      setTesting(false);
    }
  }

  const isApi = cfg.kind !== "claude-code";

  return (
    <div className="gh-section">
      <div className="gh-title">{t("ai_assistant")}</div>

      <label className="field">
        <span>{t("ai_provider")}</span>
        <select
          value={cfg.preset}
          onChange={(e) => handlePresetChange(e.target.value as AiPreset)}
        >
          {AI_PRESET_ORDER.map((p) => (
            <option key={p} value={p}>
              {presetLabel(p)}
            </option>
          ))}
        </select>
      </label>

      {isApi ? (
        <>
          <label className="field">
            <span>{t("ai_api_key")}</span>
            <input
              type="password"
              value={cfg.apiKey}
              placeholder="sk-…"
              onChange={(e) => update({ apiKey: e.target.value.trim() })}
            />
          </label>
          <label className="field">
            <span>{t("ai_base_url")}</span>
            <input
              value={cfg.baseUrl}
              placeholder="https://…"
              onChange={(e) => update({ baseUrl: e.target.value.trim() })}
            />
          </label>
          <label className="field">
            <span>{t("ai_model")}</span>
            <input
              value={cfg.model}
              placeholder={AI_PRESETS[cfg.preset].modelPlaceholder ?? "model"}
              onChange={(e) => update({ model: e.target.value.trim() })}
            />
          </label>
        </>
      ) : (
        <>
          <div className="gh-status">
            {cli == null ? (
              "…"
            ) : cli.found ? (
              <span>{t("ai_cli_found")(cli.version ?? "")}</span>
            ) : (
              <span>
                {t("ai_cli_missing")}{" "}
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    openUrl("https://claude.com/claude-code").catch(console.error)
                  }
                >
                  claude.com/claude-code ↗
                </button>
              </span>
            )}
          </div>
          <label className="field">
            <span>{t("ai_model")}</span>
            <input
              value={cfg.model}
              placeholder="claude-sonnet-4-6 (optional)"
              onChange={(e) => update({ model: e.target.value.trim() })}
            />
          </label>
        </>
      )}

      <div className="gh-actions">
        <button disabled={testing} onClick={handleTest}>
          {testing ? t("ai_testing") : t("ai_test_connection")}
        </button>
      </div>

      <p className="gh-help">{t("ai_privacy_hint")}</p>
      {testMsg && <div className="gh-msg ok">{testMsg}</div>}
      {testErr && (
        <details className="gh-msg err">
          <summary>{t("ai_test_failed")}</summary>
          <pre>{testErr}</pre>
        </details>
      )}
    </div>
  );
}

function GitHubSection({
  onVaultChanged,
}: {
  onVaultChanged: () => Promise<void>;
}) {
  const t = useT();
  const dlg = useDialogs();
  const sync = useSync();
  const [cfg, setCfg] = useState<GitConfig>(() => loadGitConfig());
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [busy, setBusy] = useState<null | "connect" | "sync" | "pull">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<PullSummary | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await gitStatus());
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function update<K extends keyof GitConfig>(k: K, v: GitConfig[K]) {
    setCfg((c) => ({ ...c, [k]: v }));
  }

  async function handleConnect() {
    setBusy("connect");
    setErr(null);
    setMsg(null);
    try {
      saveGitConfig(cfg);
      const r = await gitConnect(cfg);
      if (!r.success) {
        setErr(r.log.slice(-1500));
      } else {
        setMsg(t("github_connected_to")(cfg.url));
        await maybeRestoreFromRemote();
      }
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  }

  // U1: connecting an empty local DB to a repo that already holds a vault →
  // offer to import everything.
  async function maybeRestoreFromRemote() {
    try {
      const cats = await listCategories();
      if (cats.length > 0) return;
      const snap = await gitRemoteSnapshot();
      if (!snapshotHasCategories(snap)) return;
      const ok = await dlg.confirm({
        title: t("github"),
        message: t("github_restore_prompt"),
        confirmText: t("import"),
        cancelText: t("cancel"),
      });
      if (!ok) return;
      const sum = await importRemoteVault(snap);
      await onVaultChanged();
      setSummary(sum);
    } catch (e) {
      console.error(e);
    }
  }

  async function handlePull() {
    setBusy("pull");
    setErr(null);
    setMsg(null);
    saveGitConfig(cfg);
    const r = await sync.run("Pull", async () => {
      const pr = await gitPull();
      if (!pr.success) throw new Error(pr.log.slice(-400));
      const snap = await gitRemoteSnapshot();
      return importRemoteVault(snap);
    });
    if (r) {
      await onVaultChanged();
      const quiet =
        r.addedCategories === 0 &&
        r.addedVersions === 0 &&
        r.updatedVersions === 0 &&
        r.addedAssets === 0 &&
        r.updatedAssets === 0 &&
        r.relinkedCount === 0 &&
        r.restoredCheckpoints === 0 &&
        r.skippedLocalNewer.length === 0 &&
        r.skippedAssetsLocalNewer.length === 0 &&
        r.deletionCandidates.length === 0 &&
        r.warnings.length === 0;
      if (quiet) setMsg(t("github_pull_up_to_date"));
      else setSummary(r);
    }
    await refresh();
    setBusy(null);
  }

  async function handleDisconnect() {
    setBusy("connect");
    setErr(null);
    setMsg(null);
    try {
      await gitDisconnect();
      clearGitConfig();
      setCfg({ url: "", pat: "", branch: "main" });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function handleSync() {
    setBusy("sync");
    setErr(null);
    setMsg(null);
    saveGitConfig(cfg);
    const r = await sync.run("manual", async () => {
      const result = await syncVaultManual();
      if (!result.success) throwGitError(result);
      return result;
    });
    if (r) setMsg(t("github_sync_done"));
    await refresh();
    setBusy(null);
  }

  const connected = status?.connected ?? false;

  return (
    <div className="gh-section">
      <div className="gh-title">{t("github")}</div>

      <label className="field">
        <span>{t("github_repo_url")}</span>
        <input
          value={cfg.url}
          placeholder="https://github.com/you/your-resume-vault.git"
          onChange={(e) => update("url", e.target.value.trim())}
        />
      </label>
      <label className="field">
        <span>{t("github_pat")}</span>
        <input
          type="password"
          value={cfg.pat}
          placeholder="github_pat_..."
          onChange={(e) => update("pat", e.target.value.trim())}
        />
      </label>
      <details className="gh-help-details">
        <summary>{t("github_help_title")}</summary>
        <ol className="gh-help-steps">
          {t("github_help_steps")().map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        <div className="gh-help-actions">
          <button
            type="button"
            className="link"
            onClick={() =>
              openUrl(
                "https://github.com/settings/personal-access-tokens/new",
              ).catch(console.error)
            }
          >
            {t("github_open_token_page")} ↗
          </button>
        </div>
        <p className="gh-help-scope">{t("github_token_scope_hint")}</p>
      </details>
      <label className="field">
        <span>{t("github_branch")}</span>
        <input
          value={cfg.branch}
          placeholder="main"
          onChange={(e) => update("branch", e.target.value.trim() || "main")}
        />
      </label>

      <div className="gh-status">
        {connected ? (
          <>
            <div className="dot ok" />
            {status?.remote
              ? t("github_connected_to")(status.remote)
              : t("github_connected_to")(cfg.url)}
            {status?.head && (
              <div className="gh-sub">{t("github_last_commit")(status.head)}</div>
            )}
          </>
        ) : (
          <>
            <div className="dot off" />
            {t("github_not_connected")}
          </>
        )}
      </div>

      <div className="gh-actions">
        {!connected ? (
          <button
            className="primary"
            disabled={!cfg.url || !cfg.pat || busy !== null}
            onClick={handleConnect}
          >
            {busy === "connect" ? t("github_connecting") : t("github_connect")}
          </button>
        ) : (
          <>
            <button disabled={busy !== null} onClick={handlePull}>
              {busy === "pull" ? t("github_pulling") : t("github_pull")}
            </button>
            <button
              className="primary"
              disabled={busy !== null}
              onClick={handleSync}
            >
              {busy === "sync" ? t("github_syncing") : t("github_sync_now")}
            </button>
            <button disabled={busy !== null} onClick={handleDisconnect}>
              {t("github_disconnect")}
            </button>
          </>
        )}
      </div>

      <p className="gh-help">
        {t("github_help")} {connected && t("github_auto_hint")}
      </p>
      {msg && <div className="gh-msg ok">{msg}</div>}
      {err && (
        <details className="gh-msg err">
          <summary>{t("github_sync_failed")}</summary>
          <pre>{err}</pre>
        </details>
      )}

      {summary && (
        <PullSummaryModal
          summary={summary}
          onClose={() => setSummary(null)}
          onVaultChanged={onVaultChanged}
        />
      )}
    </div>
  );
}

function PullSummaryModal({
  summary,
  onClose,
  onVaultChanged,
}: {
  summary: PullSummary;
  onClose: () => void;
  onVaultChanged: () => Promise<void>;
}) {
  const t = useT();
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState(false);

  function toggle(i: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function handleConfirm() {
    if (checked.size === 0) {
      onClose();
      return;
    }
    setApplying(true);
    try {
      for (const i of checked) {
        await summary.deletionCandidates[i].apply();
      }
      await onVaultChanged();
    } catch (e) {
      console.error(e);
    } finally {
      setApplying(false);
      onClose();
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("github_pull_summary_title")}</h3>
        <p>
          {t("github_pull_added")(summary.addedCategories, summary.addedVersions)}
          {" · "}
          {t("github_pull_updated")(summary.updatedVersions)}
        </p>
        {(summary.addedAssets > 0 ||
          summary.updatedAssets > 0 ||
          summary.relinkedCount > 0) && (
          <p>
            {t("github_pull_assets_line")(
              summary.addedAssets,
              summary.updatedAssets,
              summary.relinkedCount,
            )}
          </p>
        )}
        {summary.restoredCheckpoints > 0 && (
          <p>{t("github_pull_checkpoints_line")(summary.restoredCheckpoints)}</p>
        )}
        {summary.backedUpCheckpoints > 0 && (
          <p>{t("github_pull_backed_up")(summary.backedUpCheckpoints)}</p>
        )}

        {(summary.skippedLocalNewer.length > 0 ||
          summary.skippedAssetsLocalNewer.length > 0) && (
          <div className="pull-block">
            <div className="pull-block-title">{t("github_pull_skipped_title")}</div>
            <ul className="pull-list">
              {summary.skippedLocalNewer.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
              {summary.skippedAssetsLocalNewer.map((s, i) => (
                <li key={`a${i}`}>{`${t("attachments")}: ${s}`}</li>
              ))}
            </ul>
          </div>
        )}

        {summary.deletionCandidates.length > 0 && (
          <div className="pull-block">
            <div className="pull-block-title pull-danger">
              {t("github_pull_deletions_title")}
            </div>
            <ul className="pull-list">
              {summary.deletionCandidates.map((d, i) => (
                <li key={i}>
                  <label className="pull-del">
                    <input
                      type="checkbox"
                      checked={checked.has(i)}
                      onChange={() => toggle(i)}
                    />
                    <span className="pull-danger">
                      {d.kind === "asset" ? `${t("attachments")}: ${d.label}` : d.label}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {summary.warnings.length > 0 && (
          <details className="gh-msg err">
            <summary>
              {t("github_pull_warnings")} ({summary.warnings.length})
            </summary>
            <pre>{summary.warnings.join("\n")}</pre>
          </details>
        )}

        <div className="modal-actions">
          {checked.size > 0 && (
            <button onClick={onClose} disabled={applying}>
              {t("cancel")}
            </button>
          )}
          <button className="primary" onClick={handleConfirm} disabled={applying}>
            {checked.size > 0 ? t("github_pull_delete_confirm") : t("ok")}
          </button>
        </div>
      </div>
    </div>
  );
}

function LatexEditor({
  version,
  onSaved,
  onOpenSettings,
}: {
  version: ResumeVersion;
  onSaved: () => void;
  onOpenSettings: () => void;
}) {
  const t = useT();
  const dlg = useDialogs();
  const sync = useSync();
  const [code, setCode] = useState(version.content ?? "");
  const [dirty, setDirty] = useState(false);

  // JD context for AI rewrites (R3) — a ref so the editor extension doesn't
  // rebuild (and drop its session state) when the category loads.
  const jdRef = useRef<string | null>(null);
  useEffect(() => {
    jdRef.current = null;
    getCategory(version.category_id)
      .then((c) => {
        jdRef.current = c?.jd_text ?? null;
      })
      .catch(console.error);
  }, [version.category_id]);

  const aiExtensions = useMemo(
    () => [
      aiInline({
        isConfigured: isAiConfigured,
        rewrite: (text, prev) => aiRewrite(text, jdRef.current, prev),
        cancel: () => {
          void aiCancel();
        },
        openSettings: onOpenSettings,
        onApplied: () => setDirty(true),
        labels: {
          button: t("ai_button"),
          generating: t("ai_generating"),
          apply: t("ai_apply"),
          reject: t("ai_reject"),
          retry: t("ai_retry"),
          suggestionLabel: t("ai_suggestion_label"),
          notConfigured: t("ai_not_configured"),
          openSettings: t("ai_open_settings"),
          error: (code: AiErrorCode) => {
            switch (code) {
              case "auth": return t("ai_err_auth");
              case "rate": return t("ai_err_rate");
              case "no_cli": return t("ai_err_no_cli");
              case "empty": return t("ai_err_empty");
              case "stale": return t("ai_err_stale");
              case "too_long": return t("ai_err_too_long");
              case "not_configured": return t("ai_not_configured");
              default: return t("ai_err_network");
            }
          },
        },
      }),
    ],
    [t, onOpenSettings],
  );
  const [showHistory, setShowHistory] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [checkpointCount, setCheckpointCount] = useState(0);
  const [assetCount, setAssetCount] = useState(0);
  const [compileAssets, setCompileAssets] = useState<CompileAsset[]>([]);
  const [missingAssets, setMissingAssets] = useState<string[]>([]);

  const refreshCheckpointCount = useCallback(async () => {
    const list = await listCheckpoints(version.id);
    setCheckpointCount(list.length);
  }, [version.id]);

  // Build the asset bundle to ship to the compiler:
  //   linked-to-this-version  ∪  source-referenced-and-available-globally
  // Anything still missing after that is reported in `missingAssets`.
  const refreshAssets = useCallback(
    async (sourceText: string) => {
      const linked = await listAssetsForVersion(version.id);
      const linkedById = new Map(linked.map((a) => [a.id, a]));
      const haveByName = new Map(linked.map((a) => [a.name, a]));

      const referenced = findReferencedAssets(sourceText);
      const missing: string[] = [];

      for (const name of referenced) {
        if (haveByName.has(name)) continue;
        const found =
          (await getAssetByName(name)) ??
          (await getAssetByName(`${name}.png`)) ??
          (await getAssetByName(`${name}.jpg`)) ??
          (await getAssetByName(`${name}.pdf`));
        if (found) {
          await linkAssetToVersion(version.id, found.id);
          linkedById.set(found.id, found);
          haveByName.set(found.name, found);
        } else {
          missing.push(name);
        }
      }

      const all = Array.from(linkedById.values());
      setAssetCount(all.length);
      const loaded: CompileAsset[] = [];
      for (const a of all) {
        const bytes = await getAssetBytes(a.id);
        if (bytes)
          loaded.push({ name: a.name, bytesBase64: bytesToBase64(bytes) });
      }
      setCompileAssets(loaded);
      setMissingAssets(missing);
    },
    [version.id],
  );

  useEffect(() => {
    setCode(version.content ?? "");
    setDirty(false);
    refreshCheckpointCount().catch(console.error);
    refreshAssets(version.content ?? "").catch(console.error);
  }, [version.id, version.content, refreshCheckpointCount, refreshAssets]);

  // Re-scan live source when typing (debounced; DB is local so cheap).
  useEffect(() => {
    if (code === (version.content ?? "")) return;
    const id = window.setTimeout(() => {
      refreshAssets(code).catch(console.error);
    }, 500);
    return () => window.clearTimeout(id);
  }, [code, version.content, refreshAssets]);

  async function handleSave() {
    await updateVersion(version.id, { content: code });
    setDirty(false);
    onSaved();
  }

  async function handleExportTex() {
    const bytes = new TextEncoder().encode(code);
    await exportFileToDialog(bytes, `${version.name}.tex`, "tex");
  }

  async function handleExportPdf() {
    const r = await compileLatex(code, compileAssets);
    const bytes = pdfBytesFromResult(r);
    if (!bytes) {
      alert(`${t("compile_error")}\n\n${r.log.slice(-2000)}`);
      return;
    }
    await exportFileToDialog(bytes, `${version.name}.pdf`, "pdf");
  }

  async function handleCheckpoint() {
    const note = await dlg.prompt({
      title: t("new_checkpoint"),
      label: t("checkpoint_note"),
      placeholder: t("checkpoint_note_placeholder"),
      defaultValue: "",
      confirmText: t("save"),
      cancelText: t("cancel"),
    });
    if (note == null) return;
    if (dirty) {
      await updateVersion(version.id, { content: code });
      setDirty(false);
      onSaved();
    }
    const cpId = await createCheckpoint(version.id, code, note);
    await refreshCheckpointCount();

    // Auto-push to GitHub if connected.
    if (isGitConnected()) {
      const [cat, freshVersion, allCps] = await Promise.all([
        getCategory(version.category_id),
        getVersion(version.id),
        listCheckpoints(version.id),
      ]);
      if (cat && freshVersion) {
        const seq = allCps.find((c) => c.id === cpId)?.seq ?? allCps.length;
        void sync.run(`v${seq} ${freshVersion.name}`, async () => {
          const r = await pushCheckpoint(cat, freshVersion, note, seq);
          if (!r.success) throwGitError(r);
        });
      }
    }
  }

  function handleRestore(content: string) {
    setCode(content);
    setDirty(true);
  }

  // Resizable editor/preview split — fraction of width given to the editor.
  const splitRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(() => {
    const s = Number(localStorage.getItem("rv-split"));
    return s >= 0.25 && s <= 0.75 ? s : 0.5;
  });
  const [draggingSplit, setDraggingSplit] = useState(false);

  function handleDividerDown(e: React.PointerEvent) {
    e.preventDefault();
    const el = splitRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setDraggingSplit(true);
    const move = (ev: PointerEvent) => {
      const f = (ev.clientX - rect.left) / rect.width;
      setSplit(Math.min(0.75, Math.max(0.25, f)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDraggingSplit(false);
      setSplit((s) => {
        localStorage.setItem("rv-split", String(s));
        return s;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function handleDividerReset() {
    setSplit(0.5);
    localStorage.setItem("rv-split", "0.5");
  }

  return (
    <div className="tsx">
      <div className="actions">
        <button className="primary" onClick={handleCheckpoint}>
          + {t("checkpoint")}
        </button>
        <button onClick={() => setShowHistory(true)}>
          {t("history")}
          {checkpointCount > 0 && (
            <span className="count-badge">{checkpointCount}</span>
          )}
        </button>
        <button onClick={() => setShowAttachments(true)}>
          {t("attachments")}
          {assetCount > 0 && (
            <span className="count-badge">{assetCount}</span>
          )}
        </button>
        <span className="grow" />
        <button onClick={handleSave} disabled={!dirty}>
          {dirty ? t("save") : t("saved")}
        </button>
        <button onClick={handleExportTex}>{t("export_tex")}</button>
        <button onClick={handleExportPdf}>{t("export_compiled_pdf")}</button>
      </div>
      {missingAssets.length > 0 && (
        <div className="missing-banner">
          <span>{t("missing_assets_banner")(missingAssets.join(", "))}</span>
          <button
            className="banner-btn"
            onClick={() => setShowAttachments(true)}
          >
            {t("upload_missing")}
          </button>
        </div>
      )}
      <div
        className={`tsx-split ${draggingSplit ? "dragging" : ""}`}
        ref={splitRef}
        style={{ gridTemplateColumns: `${split}fr 6px ${1 - split}fr` }}
      >
        <div className="code-pane">
          <CodeEditor
            value={code}
            onChange={(v) => {
              setCode(v);
              setDirty(true);
            }}
            extraExtensions={aiExtensions}
          />
        </div>
        <div
          className="preview-divider"
          onPointerDown={handleDividerDown}
          onDoubleClick={handleDividerReset}
        />
        <LatexPreview source={code} assets={compileAssets} />
      </div>
      {showHistory && (
        <HistoryPanel
          versionId={version.id}
          currentContent={code}
          onClose={() => setShowHistory(false)}
          onRestore={handleRestore}
        />
      )}
      {showAttachments && (
        <AttachmentsModal
          versionId={version.id}
          onClose={() => setShowAttachments(false)}
          onChanged={() => {
            refreshAssets(code).catch(console.error);
          }}
        />
      )}
    </div>
  );
}

function LatexPreview({
  source,
  assets,
}: {
  source: string;
  assets: CompileAsset[];
}) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logOpen, setLogOpen] = useState(true);

  // Stable signature so the effect re-fires when the asset set actually changes.
  const assetsSig = assets.map((a) => `${a.name}:${a.bytesBase64.length}`).join("|");

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const r = await compileLatex(source, assets);
        if (cancelled) return;
        if (r.success && r.pdf) {
          const blob = new Blob([new Uint8Array(r.pdf) as BlobPart], {
            type: "application/pdf",
          });
          const next = URL.createObjectURL(blob);
          setUrl((old) => {
            if (old) URL.revokeObjectURL(old);
            return next;
          });
          setError(null);
        } else {
          setError(r.log.trim() || t("compile_error"));
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, assetsSig]);

  return (
    <div className="preview">
      <div className="preview-header">
        <span className="preview-title">{t("preview")}</span>
        {error && !busy && (
          <span className="preview-state err">{t("compile_error")}</span>
        )}
        <span className="grow" />
        {error && (
          <button
            className="link-btn"
            onClick={() => navigator.clipboard.writeText(error)}
            title="Copy full log"
          >
            Copy log
          </button>
        )}
        {busy && <span className="preview-busy">{t("rendering")}</span>}
        {busy && <div className="preview-progress" />}
      </div>
      <div className="preview-stage">
        {url ? (
          <iframe className="pdf-frame" src={url} title="preview" />
        ) : !error ? (
          <div className="placeholder">{t("rendering")}</div>
        ) : null}
        {error && (
          <div
            className={
              url
                ? `compile-error overlay ${logOpen ? "" : "collapsed"}`
                : "compile-error full"
            }
          >
            <div className="compile-error-head">
              <span className="compile-error-title">{t("compile_error")}</span>
              <span className="grow" />
              {url && (
                <button
                  className="compile-error-toggle"
                  onClick={() => setLogOpen((v) => !v)}
                  aria-expanded={logOpen}
                >
                  {logOpen ? "▾" : "▸"}
                </button>
              )}
            </div>
            {(logOpen || !url) && (
              <textarea
                className="error-log"
                readOnly
                spellCheck={false}
                value={error}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PdfViewer({ version }: { version: ResumeVersion }) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    (async () => {
      if (!version.file_path) return;
      const bytes = await readVaultPdf(version.file_path);
      if (cancelled) return;
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      revoke = URL.createObjectURL(blob);
      setUrl(revoke);
    })().catch(console.error);
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [version.id, version.file_path]);

  async function handleExport() {
    if (!version.file_path) return;
    const bytes = await readVaultPdf(version.file_path);
    await exportFileToDialog(bytes, `${version.name}.pdf`, "pdf");
  }

  return (
    <div className="pdf">
      <div className="actions">
        <button onClick={handleExport}>{t("export_pdf")}</button>
      </div>
      {url ? (
        <iframe className="pdf-frame" src={url} title={version.name} />
      ) : (
        <div className="placeholder">{t("loading_pdf")}</div>
      )}
    </div>
  );
}
