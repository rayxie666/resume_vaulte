# Spec: 支持带图片资源 / 复杂宏包的 LaTeX 简历渲染

- 日期：2026-06-09
- 作者：Claude (Planning)
- 目标：在不破坏当前 `resume.cls` 模板编译路径的前提下，让用户提供的 `\documentclass{article}` 简历（含 `\companyLogo{bytedance.png}` 等外部图片、`fontawesome5`、`glyphtounicode` 等宏包）能够成功渲染。

## 实施状态（2026-06-09 更新）

| 模块 | 状态 | 备注 |
| --- | --- | --- |
| Backend `CompileRequest { source, assets }` | ✅ 已实现 | `latex.rs` 写 assets 到 tempdir 并安全校验 |
| `compileLatex(source, assets)` 前端 wrapper | ✅ 已实现 | `latexCompile.ts` |
| DB `resume_assets` 表 (per-version, Phase 1 第一版) | ✅ 已实现 | `db.ts: listAssets / addAsset / getAssetBytes / deleteAsset` |
| `AttachmentsModal` 编辑器内附件管理 | ✅ 已实现 | `App.tsx:1352-1395` |
| Tectonic segfault on fontawesome5 (Phase 2) | ✅ 已实现 | 走 auto-compat 路线：`\usepackage{fontawesome5}` → `\usepackage{fontawesome}` v4，绕过 fontspec 字体查找 |
| `\input{glyphtounicode}` / `\pdfgentounicode=1` pdfTeX-only 命令 | ✅ 已实现 | 自动注释掉 |
| **全局 Asset Library**（§3.4 升级版） | ⏳ TODO | 当前 assets 绑定到单个 version；要支持跨简历复用还需建 `assets` 全局表 + `resume_version_assets` 关联表 |
| 编译前正则扫源码、自动补齐关联 | ⏳ TODO | §3.4.4 |
| 缺失素材的红色横幅提示 | ⏳ TODO | §7 验收项 |

**现状**：用户原 LaTeX 已经能跑过 fontawesome、glyphtounicode 等所有宏包，编译只剩"找不到 bytedance.png/cmu.png/cnpc.png"——用户在 `AttachmentsModal` 里上传这三张图就能出 PDF。

---

## 1. 背景

当前 `src-tauri/src/latex.rs::compile_latex_inner` 的行为：

1. 把前端传入的 `source` 写到 `<tempdir>/main.tex`。
2. 把 `RESUME_CLS` 写到 `<tempdir>/resume.cls`。
3. 调用 `tectonic -X compile --keep-logs --print --outdir <tempdir> <tempdir>/main.tex`。
4. 读取 `main.pdf` 与 `main.log` 返回前端，删除临时目录。

用户提供的简历模板特征：

- `\documentclass[letterpaper,11pt]{article}`，不依赖 `resume.cls`。
- 使用 `\input{glyphtounicode}`，`fontawesome5`、`multicol`、`adjustbox`、`tabularx`、`fancyhdr`、`titlesec`、`enumitem`、`marvosym` 等宏包。
- 自定义 `\companyLogo` 命令调用 `\includegraphics[...]{bytedance.png}`、`{cmu.png}`、`{cnpc.png}` —— 这些 PNG 必须出现在编译目录里。

失败根因（按优先级）：

1. **缺失图片资源**：临时目录里根本没有 `bytedance.png` 等文件，`includegraphics` 直接报错并中断 PDF 生成。
2. **首次联网依赖下载**：Tectonic 在用户机器首次编译 `fontawesome5` 时需要联网下载字体；离线环境会失败。
3. **日志反馈不够友好**：前端只能看到 tectonic 的原始 log，用户看不到"缺哪张图"这种 actionable 提示。

目标：以**最小破坏**的方式新增图片资源管理 + 失败信息改善，且 `resume.cls` 路径保持不变。

---

## 2. 设计原则

- **不改变现有 API 签名**：`compile_latex(source: String)` 兼容旧调用方。
- **图片资源与简历版本一一对应**，类似 git LFS 的轻量做法，存到本地 AppData 或 DB blob。
- **离线优先**：第一次编译图片资源走本地缓存。
- **前端零强制升级**：旧版本（`resume.cls` 模板，无图片）继续 work，不需要改动数据库。

---

## 3. 技术方案

### 3.1 后端：扩展 `compile_latex` 接受 asset map

修改 `src-tauri/src/latex.rs`：

```rust
#[derive(serde::Deserialize)]
pub struct CompileRequest {
    pub source: String,
    #[serde(default)]
    pub assets: Vec<CompileAsset>,
}

#[derive(serde::Deserialize)]
pub struct CompileAsset {
    pub name: String,           // 例如 "bytedance.png"
    pub bytes_base64: String,   // base64 编码的二进制内容
}
```

把 `compile_latex` 改成：

```rust
#[tauri::command]
pub async fn compile_latex(req: CompileRequest) -> Result<CompileResult, String> { ... }
```

`compile_latex_inner` 在写入 `main.tex` / `resume.cls` 后，遍历 `req.assets`，把每个文件解码后写入 `<tempdir>/<name>`。必须做的安全校验：

- `name` 不能包含 `/` 或 `..`，防路径逃逸（拒绝并写入 log）。
- 单个 asset 大小上限（建议 5 MB），总量上限 30 MB。
- base64 解码失败要 fall through 而非 panic。

### 3.2 前端：`latexCompile.ts` 兼容旧签名

```ts
export interface CompileAsset { name: string; bytesBase64: string }

export async function compileLatex(
  source: string,
  assets: CompileAsset[] = [],
): Promise<CompileResult> {
  return invoke<CompileResult>("compile_latex", { req: { source, assets } });
}
```

调用方零改动；新增 `assets` 参数走默认空数组分支。

### 3.3 资源存储：复用 SQLite

新增迁移（version 5）：

```sql
CREATE TABLE IF NOT EXISTS resume_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES resume_versions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(version_id, name)
);
CREATE INDEX IF NOT EXISTS idx_assets_version ON resume_assets(version_id);
```

- 通过 `tauri-plugin-sql` 已有连接读写；存 base64 字符串或直接 BLOB（推荐 BLOB，二进制更省空间）。
- 编辑器侧加上传按钮：把用户选中的 PNG/JPG 读成字节 → 写入 `resume_assets` → 渲染时一并取出传给 `compileLatex`。

### 3.4 UI 改动：Asset Library 面板

App 里需要一个**显式可见、用户可管理**的图片素材库，而不是隐藏在编辑器里的小按钮。设计两层结构：

#### 3.4.1 全局 Asset Library（顶级页面 / 侧边栏入口）

- 在主侧边栏新增一项 **"素材库 / Assets"**，与"分类（Categories）"、"历史（History）"平级。
- 点击进入一个独立 view（`src/AssetsPanel.tsx`，新文件），展示**该用户所有 assets**的网格视图：
  - 缩略图 + 文件名 + 大小 + 引用计数（被几个 version 引用）+ 更新时间。
  - 支持：上传（多文件）、重命名、删除、复制 LaTeX 引用名（点一下复制 `bytedance.png` 到剪贴板）。
  - 顶部搜索框按文件名过滤。
  - 上方"上传"按钮调用 `@tauri-apps/plugin-dialog::open({ multiple: true, filters: [{ name: 'Image', extensions: ['png','jpg','jpeg','pdf','svg'] }] })`。
- **全局共享**：素材库里的图片不绑定到单个 version，多份简历都能引用（按文件名引用）。

#### 3.4.2 编辑器内联面板（快捷入口）

- LaTeX 编辑区顶部 toolbar 增加 **"附件"折叠面板**（默认展开）。
- 面板内容：
  - 横向缩略图条，展示**当前 version 已关联**的 assets（来自 `resume_version_assets` 关联表）。
  - 每个缩略图角标显示文件名；hover 弹出 `\includegraphics{xxx}` 的一键插入。
  - 右侧"+ 添加"按钮 → 弹小窗，列出全局素材库供勾选关联，或直接"上传新文件"。
  - 删除关联（不删素材本体）vs 删除素材本体（影响所有引用）要明确区分。

#### 3.4.3 数据模型调整

将原 `resume_assets` 表拆成两张，让素材可跨 version 复用：

```sql
-- 全局素材表
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,           -- LaTeX 引用名，如 "bytedance.png"
  bytes BLOB NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- version ↔ asset 多对多关联
CREATE TABLE IF NOT EXISTS resume_version_assets (
  version_id INTEGER NOT NULL REFERENCES resume_versions(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  PRIMARY KEY (version_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_va_version ON resume_version_assets(version_id);
CREATE INDEX IF NOT EXISTS idx_va_asset ON resume_version_assets(asset_id);
```

> 替换 3.3 节里临时定义的 `resume_assets`。如果 Phase 1 已经按 3.3 实现，需要补一个迁移：建新表 → 复制数据（asset 内容 + 引用关系）→ DROP `resume_assets`。

#### 3.4.4 编译前的 asset 拼装

`App.tsx` 在调 `compileLatex(source, assets)` 之前：

1. `db.listAssetsForVersion(versionId)` 拿到当前 version 关联的所有素材。
2. **额外**用正则扫一遍 `source`，匹配 `\includegraphics[...]{NAME}` / `\companyLogo{NAME}` 等命令里的 `NAME`。
3. 把扫描结果与关联表做 union：
   - 关联表里有的：直接喂给编译器。
   - 源码引用但关联表没有的：在素材库里查全局名匹配，如果有 → 自动补上关联；如果没有 → 在 UI 顶部红色横幅 "缺失素材 NAME，点击上传"。
4. 把最终 asset 列表 base64 后传给 `compileLatex`。

这样**用户感受**：不论从哪个入口（素材库 / 编辑器附件面板 / 源码里写一个新名字）添加图片，系统都能正确找到并编译。

#### 3.4.5 存储位置取舍

| 选项 | 备份 / Git 同步 | 体积 | 选择 |
| --- | --- | --- | --- |
| 存 SQLite BLOB | 跟随 `vault.db` 一起被 GitHub 同步 | DB 文件膨胀 | ✅ Phase 1 |
| 存 AppData/files/，DB 存路径 | 同步需要单独处理 | DB 小 | 备选 Phase 3 |

Phase 1 走 BLOB，简单；后续如果素材库 > 50 MB 再考虑迁移到文件系统。

### 3.5 日志改善

`latex.rs` 在 tectonic 失败后扫描 `main.log`，提取常见错误模式追加到返回 `log`：

- `! LaTeX Error: File 'XYZ' not found.` → 在 log 顶部加：`Missing asset: XYZ. Upload it via the attachments panel.`
- `! Package fontawesome5 Error:` → 提示首次编译需联网下载字体。

实现：在 `main_log` 读到内容后，跑一个简单正则提取错误行，prepend 到返回 log 的 `=== summary ===` 段。

### 3.6 离线 / 字体兜底（可选 Phase 2）

- 把 `fontawesome5` 所需的 OTF/TTF 在 `src-tauri/resources/` 里随包发出，编译前 copy 到 tempdir。
- 这步可以等用户真的在离线环境遇到才做，不阻塞 Phase 1。

---

## 4. 关键文件改动清单

| 文件 | 改动 |
| --- | --- |
| `src-tauri/src/latex.rs` | 新增 `CompileRequest` / `CompileAsset`，在 `compile_latex_inner` 写资源；增加路径安全校验；增强 log 摘要 |
| `src-tauri/src/lib.rs` | 新增 migration v5（`assets` 表）、v6（`resume_version_assets` 关联表）；若已有 `resume_assets` 则补迁移到新表 |
| `src/latexCompile.ts` | 更新 `compileLatex` 签名，新增 `CompileAsset` 类型 |
| `src/db.ts` | 新增 `listAssets / getAsset / addAsset / renameAsset / deleteAsset / linkAssetToVersion / unlinkAssetFromVersion / listAssetsForVersion / assetUsageCount` |
| `src/types.ts` | 新增 `Asset`、`AssetUsage` 类型 |
| `src/AssetsPanel.tsx` (新文件) | 全局素材库视图：网格、上传、重命名、删除、引用计数 |
| `src/App.tsx` | 主侧栏增加"素材库"入口；LaTeX 编辑器加附件折叠面板；编译前正则扫描 + 关联表 union 拼装 assets |
| `src/i18n.ts` | 新增 "素材库" / "附件" / "引用计数" / "缺失素材" / "复制引用名" 等文案 |
| `spec/2026-06-09-latex-asset-rendering.md` | 本文件 |

不动：`resume_cls.rs`、`git.rs`、`HistoryPanel.tsx`、`SyncStatus.tsx`、其他迁移。

---

## 5. 实现步骤

1. **Backend 改造**（独立 commit）
   - 改 `latex.rs` 接受 `CompileRequest`。
   - 增加路径安全校验（reject `..`、`/`、空 name）。
   - 增加 log error-pattern 摘要。
   - `cargo build` 通过。

2. **前端 wrapper 同步**（独立 commit）
   - 改 `latexCompile.ts`，保持旧调用方默认空 assets。
   - `npm run build` 通过。

3. **DB 迁移 + 类型**
   - 加 migration v5。
   - `types.ts` 加 `ResumeAsset`。
   - `db.ts` 加 CRUD。

4. **UI 集成**
   - 在 LaTeX 编辑器加附件面板。
   - 编译前 `listAssets(versionId)` → base64 → 传入 `compileLatex`。
   - 错误提示 i18n。

5. **联调验证**（必做，因为是 UI 改动）
   - `npm run tauri dev`。
   - 用例 A：旧 `resume.cls` 简历仍能编译。
   - 用例 B：用户的新简历，先编译报"missing bytedance.png" → 上传三张 PNG → 编译成功 → PDF 渲染正确。
   - 用例 C：上传 6 MB 文件，被 size limit 拒绝并给出明确错误。

6. **文档**
   - 在 `README.md` 增加"附件"小节说明 `\includegraphics` 工作方式。

---

## 6. 风险与权衡

| 风险 | 应对 |
| --- | --- |
| `CompileRequest` 改了 Tauri command 签名，老前端调用会断 | 前后端在同一仓库同一发布周期，统一升级；旧字段 `source` 保留 |
| BLOB 存图片会让 SQLite 文件变大，影响 GitHub 同步 | Phase 1 接受；若变大明显，Phase 2 改成 AppData 文件 + DB 存路径 |
| Tectonic 首次下载 fontawesome 失败 | Phase 1 在 log 里提示；Phase 2 bundle 字体 |
| base64 编码膨胀 ~33%，跨进程传输大图慢 | 单文件 5 MB 限制；后续可以换 `tauri::ipc::Channel` 流式传输 |
| 用户给 asset 起的 name 与 LaTeX 里的 `\includegraphics{...}` 不一致 | UI 上传时显示"将以此文件名作为 LaTeX 引用名"，可重命名 |

---

## 7. 验收标准

- [ ] 用户提供的简历（保留所有 `\begin{comment}` 块）能编译出 PDF，公司 logo 正确渲染。
- [ ] 旧 `\documentclass{resume}` 模板编译路径无回归。
- [ ] **主侧栏可进入"素材库"页面**，看到所有已上传的图片，支持上传 / 重命名 / 删除 / 复制引用名。
- [ ] 素材库显示每张图片的"被几份简历引用"。
- [ ] 编辑器内的附件折叠面板能列出当前 version 关联的素材，支持从素材库勾选关联，支持直接上传。
- [ ] 用户在源码里写 `\includegraphics{newlogo.png}` 但素材库已有 `newlogo.png` 时，编译自动找到并使用。
- [ ] 源码引用的素材名不存在时，UI 顶部有红色横幅 + 一键上传按钮。
- [ ] 删除一个素材时，前端有"该素材被 X 份简历引用，确认删除？"二次确认。
- [ ] 删除 version 时，仅删除关联，不删素材本体（除非该素材引用数归零并用户选择"清理孤儿素材"）。
- [ ] 编译失败时 log 顶部能看到 actionable 提示（缺哪个文件）。
- [ ] `cargo build` + `tsc && vite build` 通过。
