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
  attachments: string;
  add_attachment: string;
  no_attachments: string;
  attachment_name: string;
  attachment_size: string;
  attachment_too_large: (limit_mb: number) => string;
  rename_attachment: string;
  assets_library: string;
  no_assets: string;
  no_assets_filtered: string;
  search_assets: string;
  asset_usage_count: (n: number) => string;
  asset_delete_with_usage: (name: string, n: number) => string;
  copy_reference_name: string;
  link_from_library: string;
  missing_assets_banner: (names: string) => string;
  upload_missing: string;
  insert_into_source: string;
  github_status_syncing: string;
  github_status_synced: string;
  github_status_failed: string;
  github_auto_hint: string;
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
  github_help_title: string;
  github_help_steps: () => string[];
  github_open_token_page: string;
  github_token_scope_hint: string;
  github_pull: string;
  github_pulling: string;
  github_pull_up_to_date: string;
  github_pull_done: string;
  github_pull_summary_title: string;
  github_pull_added: (cats: number, vers: number) => string;
  github_pull_updated: (n: number) => string;
  github_pull_backed_up: (n: number) => string;
  github_pull_skipped_title: string;
  github_pull_deletions_title: string;
  github_pull_delete_confirm: string;
  github_pull_warnings: string;
  github_needs_pull: string;
  github_restore_prompt: string;
  github_pull_assets_line: (added: number, updated: number, relinked: number) => string;
  sync_asset_add: (name: string) => string;
  sync_asset_rename: string;
  sync_asset_delete: string;
  sync_attachments_update: (versionName: string) => string;
  github_pull_checkpoints_line: (n: number) => string;
  sync_checkpoint_delete: (seq: number, versionName: string) => string;
  ai_assistant: string;
  ai_provider: string;
  ai_api_key: string;
  ai_base_url: string;
  ai_model: string;
  ai_preset_custom: string;
  ai_preset_claude_code: string;
  ai_test_connection: string;
  ai_testing: string;
  ai_test_ok: string;
  ai_test_failed: string;
  ai_privacy_hint: string;
  ai_cli_found: (v: string) => string;
  ai_cli_missing: string;
  ai_button: string;
  ai_generating: string;
  ai_apply: string;
  ai_reject: string;
  ai_retry: string;
  ai_suggestion_label: string;
  ai_not_configured: string;
  ai_open_settings: string;
  ai_err_auth: string;
  ai_err_rate: string;
  ai_err_network: string;
  ai_err_no_cli: string;
  ai_err_empty: string;
  ai_err_stale: string;
  ai_err_too_long: string;
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
  pet_section: string;
  pet_show: string;
  pet_sound: string;
  pet_on: string;
  pet_off: string;
  pet_unsupported: string;
  pet_bubble_meow: string;
  pet_bubble_saved: string;
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
    attachments: "Attachments",
    add_attachment: "Add file",
    no_attachments: "No attachments yet. Add PNG/JPG/PDF to use with \\includegraphics{...}.",
    attachment_name: "Name",
    attachment_size: "Size",
    attachment_too_large: (m: number) => `File exceeds the ${m} MB limit.`,
    rename_attachment: "Rename",
    assets_library: "Assets",
    no_assets: "No assets yet. Upload PNG/JPG/PDF — they'll be reachable from any LaTeX resume via \\includegraphics{filename}.",
    no_assets_filtered: "No assets match your search.",
    search_assets: "Search assets…",
    asset_usage_count: (n: number) =>
      `used by ${n} resume${n === 1 ? "" : "s"}`,
    asset_delete_with_usage: (name: string, n: number) =>
      `"${name}" is referenced by ${n} resume${n === 1 ? "" : "s"}. Delete anyway?`,
    copy_reference_name: "Copy filename",
    link_from_library: "Pick from library",
    missing_assets_banner: (names: string) =>
      `Source references missing assets: ${names}. Upload them to compile.`,
    upload_missing: "Upload",
    insert_into_source: "Insert \\includegraphics",
    github_status_syncing: "Syncing to GitHub",
    github_status_synced: "Synced",
    github_status_failed: "Sync failed",
    github_auto_hint:
      "Once connected, new versions and checkpoints push automatically.",
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
    github_help_title: "How do I get a token?",
    github_help_steps: () => [
      "Open GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens.",
      'Click "Generate new token". Give it a name (e.g. "Resume Vault") and an expiration.',
      'Under Repository access, pick "Only select repositories" and choose the repo above.',
      "Under Repository permissions, set Contents to Read and write. Leave the rest as is.",
      "Generate the token, copy it (starts with `github_pat_...`), and paste it above.",
    ],
    github_open_token_page: "Open GitHub token page",
    github_token_scope_hint:
      "Required scope: Contents — Read and write. The token is saved only on this device.",
    github_pull: "Pull from GitHub",
    github_pulling: "Pulling…",
    github_pull_up_to_date: "Already up to date",
    github_pull_done: "Pull complete",
    github_pull_summary_title: "Pull summary",
    github_pull_added: (cats: number, vers: number) =>
      `Added ${cats} categor${cats === 1 ? "y" : "ies"} / ${vers} version${vers === 1 ? "" : "s"}`,
    github_pull_updated: (n: number) => `Updated ${n} version${n === 1 ? "" : "s"}`,
    github_pull_backed_up: (n: number) =>
      `Backed up ${n} checkpoint${n === 1 ? "" : "s"} before overwriting`,
    github_pull_skipped_title: "Kept (local copy is newer)",
    github_pull_deletions_title:
      "Deleted on remote — check items to also delete locally",
    github_pull_delete_confirm: "Apply",
    github_pull_warnings: "Warnings",
    github_needs_pull: "Remote has new commits — Pull from GitHub first.",
    github_restore_prompt:
      "This repository already contains a vault. Import it to this machine?",
    github_pull_assets_line: (added: number, updated: number, relinked: number) =>
      `Attachments: ${added} added, ${updated} updated, ${relinked} link${relinked === 1 ? "" : "s"} restored`,
    sync_asset_add: (name: string) => `Asset ${name}`,
    sync_asset_rename: "Rename asset",
    sync_asset_delete: "Delete asset",
    sync_attachments_update: (versionName: string) =>
      `Attachments of ${versionName}`,
    github_pull_checkpoints_line: (n: number) =>
      `Restored ${n} checkpoint${n === 1 ? "" : "s"}`,
    sync_checkpoint_delete: (seq: number, versionName: string) =>
      `Delete v${seq} of ${versionName}`,
    ai_assistant: "AI Assistant",
    ai_provider: "Provider",
    ai_api_key: "API Key",
    ai_base_url: "Base URL",
    ai_model: "Model",
    ai_preset_custom: "Custom",
    ai_preset_claude_code: "Claude Code (local)",
    ai_test_connection: "Test connection",
    ai_testing: "Testing…",
    ai_test_ok: "Connection OK",
    ai_test_failed: "Connection failed",
    ai_privacy_hint:
      "When rewriting, the selected text (and the category's job description) is sent to the chosen AI provider. The local Claude Code mode also hands the text to its vendor.",
    ai_cli_found: (v: string) => `✓ Claude Code detected: ${v}`,
    ai_cli_missing: "✗ Claude Code not found — install it first",
    ai_button: "Rewrite with AI",
    ai_generating: "Rewriting…",
    ai_apply: "Apply",
    ai_reject: "Reject",
    ai_retry: "Try another",
    ai_suggestion_label: "AI suggestion",
    ai_not_configured: "No AI provider configured.",
    ai_open_settings: "Open Settings",
    ai_err_auth: "API key invalid or unauthorized — check it in Settings.",
    ai_err_rate: "Too many requests — try again in a moment.",
    ai_err_network: "Network error or timeout.",
    ai_err_no_cli: "Claude Code CLI not found.",
    ai_err_empty: "The model returned an empty result.",
    ai_err_stale: "The selected text changed — rewrite not applied.",
    ai_err_too_long: "Selection is too long (max 12,000 characters).",
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
    pet_section: "Pet cat",
    pet_show: "Show the cat",
    pet_sound: "Purr sound",
    pet_on: "On",
    pet_off: "Off",
    pet_unsupported: "3D rendering is not supported in this environment.",
    pet_bubble_meow: "mew?",
    pet_bubble_saved: "✓ Saved, meow",
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
    attachments: "附件",
    add_attachment: "添加文件",
    no_attachments: "暂无附件。添加 PNG/JPG/PDF，可在源码里用 \\includegraphics{...} 引用。",
    attachment_name: "文件名",
    attachment_size: "大小",
    attachment_too_large: (m: number) => `文件超过 ${m} MB 限制。`,
    rename_attachment: "重命名",
    assets_library: "素材库",
    no_assets: "暂无素材。上传 PNG/JPG/PDF，任一份 LaTeX 简历都能通过 \\includegraphics{文件名} 引用。",
    no_assets_filtered: "没有匹配搜索的素材。",
    search_assets: "搜索素材…",
    asset_usage_count: (n: number) => `被 ${n} 份简历引用`,
    asset_delete_with_usage: (name: string, n: number) =>
      `"${name}" 当前被 ${n} 份简历引用，确认删除？`,
    copy_reference_name: "复制文件名",
    link_from_library: "从素材库选择",
    missing_assets_banner: (names: string) =>
      `源码引用了未上传的素材：${names}。上传后即可编译。`,
    upload_missing: "上传",
    insert_into_source: "插入 \\includegraphics",
    github_status_syncing: "正在同步到 GitHub",
    github_status_synced: "同步完成",
    github_status_failed: "同步失败",
    github_auto_hint: "连接后，新建版本和保存 checkpoint 都会自动推送。",
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
    github_help_title: "如何获取 Token？",
    github_help_steps: () => [
      "打开 GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens。",
      '点击 "Generate new token"，填名字（如 "Resume Vault"）和到期时间。',
      '在 Repository access 选 "Only select repositories"，勾选上面填的仓库。',
      "在 Repository permissions 把 Contents 设为 Read and write，其它保持默认。",
      "生成 Token 并复制（以 `github_pat_...` 开头），粘贴到上方的 PAT 输入框。",
    ],
    github_open_token_page: "打开 GitHub Token 设置页",
    github_token_scope_hint:
      "需要权限：Contents — Read and write。Token 仅保存在本机。",
    github_pull: "从 GitHub 拉取",
    github_pulling: "拉取中…",
    github_pull_up_to_date: "已是最新",
    github_pull_done: "拉取完成",
    github_pull_summary_title: "拉取结果",
    github_pull_added: (cats: number, vers: number) =>
      `新增 ${cats} 个分类 / ${vers} 个版本`,
    github_pull_updated: (n: number) => `更新 ${n} 个版本`,
    github_pull_backed_up: (n: number) => `覆盖前已备份 ${n} 个存档点`,
    github_pull_skipped_title: "已保留（本地较新）",
    github_pull_deletions_title: "远端已删除——勾选后同时删除本地",
    github_pull_delete_confirm: "应用",
    github_pull_warnings: "警告",
    github_needs_pull: "远端有新提交，请先从 GitHub 拉取。",
    github_restore_prompt: "检测到该仓库已有 vault，是否导入到本机？",
    github_pull_assets_line: (added: number, updated: number, relinked: number) =>
      `附件：新增 ${added}，更新 ${updated}，恢复链接 ${relinked}`,
    sync_asset_add: (name: string) => `附件 ${name}`,
    sync_asset_rename: "重命名附件",
    sync_asset_delete: "删除附件",
    sync_attachments_update: (versionName: string) => `${versionName} 的附件`,
    github_pull_checkpoints_line: (n: number) => `恢复 checkpoint：${n} 条`,
    sync_checkpoint_delete: (seq: number, versionName: string) =>
      `删除 ${versionName} 的 v${seq}`,
    ai_assistant: "AI 助手",
    ai_provider: "提供商",
    ai_api_key: "API Key",
    ai_base_url: "Base URL",
    ai_model: "模型",
    ai_preset_custom: "自定义",
    ai_preset_claude_code: "Claude Code（本地）",
    ai_test_connection: "测试连接",
    ai_testing: "测试中…",
    ai_test_ok: "连接成功",
    ai_test_failed: "连接失败",
    ai_privacy_hint:
      "改写时所选文本（及分类的岗位描述）将发送给所选 AI 提供商；Claude Code 本地模式同样会将文本交给其供应商处理。",
    ai_cli_found: (v: string) => `✓ 已检测到 Claude Code：${v}`,
    ai_cli_missing: "✗ 未检测到 Claude Code，请先安装",
    ai_button: "AI 改写",
    ai_generating: "改写中…",
    ai_apply: "接受",
    ai_reject: "拒绝",
    ai_retry: "换个写法",
    ai_suggestion_label: "AI 建议",
    ai_not_configured: "尚未配置 AI 提供商。",
    ai_open_settings: "打开设置",
    ai_err_auth: "API Key 无效或无权限，请到设置中检查。",
    ai_err_rate: "请求过于频繁，稍后再试。",
    ai_err_network: "网络错误或超时。",
    ai_err_no_cli: "未找到 Claude Code CLI。",
    ai_err_empty: "模型返回了空结果。",
    ai_err_stale: "所选文本已被修改，未应用改写。",
    ai_err_too_long: "选中内容过长（上限 12,000 字符）。",
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
    pet_section: "宠物猫",
    pet_show: "显示宠物猫",
    pet_sound: "呼噜声",
    pet_on: "开",
    pet_off: "关",
    pet_unsupported: "当前环境不支持 3D 渲染。",
    pet_bubble_meow: "喵?",
    pet_bubble_saved: "✓ 已保存,喵",
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
