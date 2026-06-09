import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Lang = "en" | "zh";
export type LangPref = Lang | "system";

const STORAGE_KEY = "resume-vault.lang";

type DictShape = {
  app_title: string;
  back: string;
  edit: string;
  settings: string;
  versions_in: string;
  cancel: string;
  save: string;
  saved: string;
  saving: string;
  create: string;
  delete: string;
  ok: string;
  import: string;
  new_category: string;
  new_category_label: string;
  new_category_placeholder: string;
  versions_count: (n: number) => string;
  import_pdf: string;
  job_description: string;
  edit_category: string;
  edit_version: string;
  name: string;
  icon: string;
  color: string;
  notes: string;
  use_initials: string;
  auto: string;
  version_name: string;
  import_pdf_title: string;
  delete_category_title: string;
  delete_category_msg: (name: string) => string;
  delete_version_title: string;
  delete_version_msg: (name: string) => string;
  export_pdf: string;
  loading_pdf: string;
  language: string;
  lang_system: string;
  lang_en: string;
  lang_zh: string;
  preview: string;
  rendering: string;
  compile_error: string;
  export_compiled_pdf: string;
  new_latex: string;
  new_latex_title: string;
  latex_name_placeholder: string;
  export_tex: string;
  tectonic_missing: string;
  checkpoint: string;
  new_checkpoint: string;
  checkpoint_note: string;
  checkpoint_note_placeholder: string;
  history: string;
  no_checkpoints: string;
  no_note: string;
  select_checkpoint: string;
  current: string;
  restore_this: string;
  restore: string;
  restore_checkpoint_title: string;
  restore_checkpoint_msg: (label: string) => string;
  delete_checkpoint_title: string;
  delete_checkpoint_msg: (label: string) => string;
  diff_label: string;
  render_failed: string;
  github: string;
  github_repo_url: string;
  github_pat: string;
  github_branch: string;
  github_auto_sync: string;
  github_connect: string;
  github_connecting: string;
  github_disconnect: string;
  github_sync_now: string;
  github_syncing: string;
  github_not_connected: string;
  github_connected_to: (url: string) => string;
  github_last_commit: (h: string) => string;
  github_sync_failed: string;
  github_sync_done: string;
  github_help: string;
  select: string;
  select_all: string;
  deselect_all: string;
  done: string;
  selected_count: (n: number) => string;
  delete_selected: string;
  delete_n_categories_title: string;
  delete_n_categories_msg: (n: number) => string;
  delete_n_versions_title: string;
  delete_n_versions_msg: (n: number) => string;
};

const DICT: Record<Lang, DictShape> = {
  en: {
    app_title: "Resume Vault",
    back: "Back",
    edit: "Edit",
    settings: "Settings",
    versions_in: "Versions",
    cancel: "Cancel",
    save: "Save",
    saved: "Saved",
    saving: "Saving…",
    create: "Create",
    delete: "Delete",
    ok: "OK",
    import: "Import",
    // Home
    new_category: "New Category",
    new_category_label: "Give it a name like the job title or company.",
    new_category_placeholder: "e.g. Google SWE",
    versions_count: (n: number) => `${n} version${n === 1 ? "" : "s"}`,
    // Category view
    import_pdf: "Import PDF",
    job_description: "Job description",
    edit_category: "Edit Category",
    edit_version: "Edit Version",
    name: "Name",
    icon: "Icon",
    color: "Color",
    notes: "Notes",
    use_initials: "Use initials",
    auto: "Auto",
    // Version
    version_name: "Version name",
    import_pdf_title: "Import PDF",
    // Confirm
    delete_category_title: "Delete category?",
    delete_category_msg: (name: string) =>
      `"${name}" and all its versions will be deleted permanently.`,
    delete_version_title: "Delete version?",
    delete_version_msg: (name: string) =>
      `"${name}" will be deleted permanently.`,
    // Actions
    export_pdf: "Export .pdf",
    loading_pdf: "Loading PDF…",
    // Settings
    language: "Language",
    lang_system: "System",
    lang_en: "English",
    lang_zh: "中文",
    preview: "Preview",
    rendering: "Rendering…",
    compile_error: "Compile error",
    export_compiled_pdf: "Export PDF",
    new_latex: "New LaTeX",
    new_latex_title: "New LaTeX version",
    latex_name_placeholder: "e.g. main, en, zh",
    export_tex: "Export .tex",
    tectonic_missing:
      "tectonic not found. Install with: brew install tectonic",
    checkpoint: "Checkpoint",
    new_checkpoint: "New checkpoint",
    checkpoint_note: "Note",
    checkpoint_note_placeholder: "what changed in this version",
    history: "History",
    no_checkpoints: "No checkpoints yet. Click + Checkpoint to save one.",
    no_note: "no note",
    select_checkpoint: "Select a checkpoint to compare.",
    current: "current",
    restore_this: "Restore this version",
    restore: "Restore",
    restore_checkpoint_title: "Restore checkpoint?",
    restore_checkpoint_msg: (label: string) =>
      `Replace the editor with the contents of ${label}? Your unsaved edits will be lost (consider saving a checkpoint first).`,
    delete_checkpoint_title: "Delete checkpoint?",
    delete_checkpoint_msg: (label: string) =>
      `${label} will be deleted permanently.`,
    diff_label: "Diff",
    render_failed: "Preview failed",
    github: "GitHub Sync",
    github_repo_url: "Repository URL",
    github_pat: "Personal Access Token",
    github_branch: "Branch",
    github_auto_sync: "Auto-push on checkpoint",
    github_connect: "Connect",
    github_connecting: "Connecting…",
    github_disconnect: "Disconnect",
    github_sync_now: "Sync now",
    github_syncing: "Syncing…",
    github_not_connected: "Not connected",
    github_connected_to: (url: string) => `Connected: ${url}`,
    github_last_commit: (h: string) => `Last commit: ${h}`,
    github_sync_failed: "Sync failed",
    github_sync_done: "Sync complete",
    github_help:
      "Create a fine-grained PAT with read/write Contents access on the repo. Token is stored locally.",
    select: "Select",
    select_all: "Select All",
    deselect_all: "Deselect All",
    done: "Done",
    selected_count: (n: number) => `${n} selected`,
    delete_selected: "Delete",
    delete_n_categories_title: "Delete categories?",
    delete_n_categories_msg: (n: number) =>
      `${n} categor${n === 1 ? "y" : "ies"} and all their versions will be deleted permanently.`,
    delete_n_versions_title: "Delete versions?",
    delete_n_versions_msg: (n: number) =>
      `${n} version${n === 1 ? "" : "s"} will be deleted permanently.`,
  },
  zh: {
    app_title: "简历库",
    back: "返回",
    edit: "编辑",
    settings: "设置",
    versions_in: "版本",
    cancel: "取消",
    save: "保存",
    saved: "已保存",
    saving: "保存中…",
    create: "创建",
    delete: "删除",
    ok: "确定",
    import: "导入",
    new_category: "新建分类",
    new_category_label: "起个名字，比如目标岗位或公司。",
    new_category_placeholder: "比如 Google 研发",
    versions_count: (n: number) => `${n} 个版本`,
    import_pdf: "导入 PDF",
    job_description: "岗位描述",
    edit_category: "编辑分类",
    edit_version: "编辑版本",
    name: "名称",
    icon: "图标",
    color: "颜色",
    notes: "备注",
    use_initials: "使用首字母",
    auto: "自动",
    version_name: "版本名称",
    import_pdf_title: "导入 PDF",
    delete_category_title: "删除分类？",
    delete_category_msg: (name: string) =>
      `"${name}" 及其所有版本将被永久删除。`,
    delete_version_title: "删除版本？",
    delete_version_msg: (name: string) => `"${name}" 将被永久删除。`,
    export_pdf: "导出 .pdf",
    loading_pdf: "加载 PDF 中…",
    language: "语言",
    lang_system: "跟随系统",
    lang_en: "English",
    lang_zh: "中文",
    preview: "预览",
    rendering: "渲染中…",
    compile_error: "编译错误",
    export_compiled_pdf: "导出 PDF",
    new_latex: "新建 LaTeX",
    new_latex_title: "新建 LaTeX 版本",
    latex_name_placeholder: "比如 main、中文版",
    export_tex: "导出 .tex",
    tectonic_missing: "未找到 tectonic。请先执行：brew install tectonic",
    checkpoint: "存档点",
    new_checkpoint: "新建存档点",
    checkpoint_note: "备注",
    checkpoint_note_placeholder: "这个版本改了什么",
    history: "历史",
    no_checkpoints: "还没有存档点，点 + 存档点 创建第一个。",
    no_note: "无备注",
    select_checkpoint: "选一个存档点对比。",
    current: "当前",
    restore_this: "恢复到这个版本",
    restore: "恢复",
    restore_checkpoint_title: "恢复存档点？",
    restore_checkpoint_msg: (label: string) =>
      `将用 ${label} 的内容替换当前编辑器，未存档的修改会丢失（建议先存一个 checkpoint）。`,
    delete_checkpoint_title: "删除存档点？",
    delete_checkpoint_msg: (label: string) => `${label} 将被永久删除。`,
    diff_label: "差异",
    render_failed: "预览失败",
    github: "GitHub 同步",
    github_repo_url: "仓库地址",
    github_pat: "个人访问令牌（PAT）",
    github_branch: "分支",
    github_auto_sync: "保存 checkpoint 时自动推送",
    github_connect: "连接",
    github_connecting: "连接中…",
    github_disconnect: "断开",
    github_sync_now: "立即同步",
    github_syncing: "同步中…",
    github_not_connected: "未连接",
    github_connected_to: (url: string) => `已连接：${url}`,
    github_last_commit: (h: string) => `最近提交：${h}`,
    github_sync_failed: "同步失败",
    github_sync_done: "同步完成",
    github_help: "创建 fine-grained PAT 并授予该仓库的 Contents 读写权限。Token 只保存在本地。",
    select: "选择",
    select_all: "全选",
    deselect_all: "全不选",
    done: "完成",
    selected_count: (n: number) => `已选 ${n} 项`,
    delete_selected: "删除",
    delete_n_categories_title: "删除选中分类？",
    delete_n_categories_msg: (n: number) =>
      `${n} 个分类及其所有版本将被永久删除。`,
    delete_n_versions_title: "删除选中版本？",
    delete_n_versions_msg: (n: number) => `${n} 个版本将被永久删除。`,
  },
};

type Dict = DictShape;
export type TKey = keyof Dict;

function detectSystemLang(): Lang {
  const nav =
    typeof navigator !== "undefined"
      ? navigator.language || (navigator as Navigator & { userLanguage?: string }).userLanguage
      : "en";
  return (nav || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
}

function loadPref(): LangPref {
  if (typeof localStorage === "undefined") return "system";
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === "en" || v === "zh" || v === "system") return v;
  return "system";
}

function savePref(p: LangPref) {
  try {
    localStorage.setItem(STORAGE_KEY, p);
  } catch {
    // ignore
  }
}

interface LocaleApi {
  pref: LangPref;
  lang: Lang;
  setPref: (p: LangPref) => void;
  t: <K extends TKey>(key: K) => Dict[K];
}

const LocaleCtx = createContext<LocaleApi | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<LangPref>(() => loadPref());
  const [systemLang, setSystemLang] = useState<Lang>(() => detectSystemLang());

  useEffect(() => {
    if (typeof window === "undefined" || !("matchMedia" in window)) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)"); // re-trigger on locale changes is harder; fall back to navigator
    const handler = () => setSystemLang(detectSystemLang());
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const lang: Lang = pref === "system" ? systemLang : pref;
  const dict = DICT[lang];

  const setPref = useCallback((p: LangPref) => {
    savePref(p);
    setPrefState(p);
  }, []);

  const t = useCallback(
    <K extends TKey>(key: K): Dict[K] => dict[key],
    [dict],
  );

  const value = useMemo<LocaleApi>(
    () => ({ pref, lang, setPref, t }),
    [pref, lang, setPref, t],
  );

  return createElement(LocaleCtx.Provider, { value }, children);
}

export function useLocale(): LocaleApi {
  const ctx = useContext(LocaleCtx);
  if (!ctx) throw new Error("useLocale must be used inside LocaleProvider");
  return ctx;
}

export function useT() {
  return useLocale().t;
}
