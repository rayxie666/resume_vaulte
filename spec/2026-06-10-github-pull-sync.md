# Spec: GitHub → 本地反向同步(Pull & Import)

- 日期:2026-06-10
- 前置:现有单向 push 链路(`src/github.ts` + `src-tauri/src/git.rs`)
- 目标:支持从 GitHub 简历仓库拉取变更并合并进本地 SQLite——覆盖"新机器恢复 vault"与"远端编辑回流"两大用例,把同步从单向变为双向。
- 状态:**已实装(2026-06-10)。**

---

## 1. 现状与问题

当前链路:本地 SQLite 为唯一 source of truth,`git_apply` 在本地 clone
(`~/Library/Application Support/com.zheruixie.resumevault/github_repo`)
写文件 → add → commit → push。仓库布局:

```
vault.json                        # 分类索引(hint)
categories/<id>-<slug>/_meta.json # 分类元数据
categories/<id>-<slug>/<vid>-<vslug>.tex|.pdf   # 版本内容
categories/<id>-<slug>/<vid>-<vslug>.json       # 版本元数据
```

问题:

1. **没有任何 pull 路径**。换新机器后 `git_connect` 虽然会 clone 仓库,但
   SQLite 仍是空的——备份无法恢复,这是反向同步最刚需的场景。
2. **远端领先时 push 直接失败**(non-fast-forward),`git.rs:334` 的
   `git push` 无 fetch 前置,用户只能看到一段 git stderr。
3. **路径身份不稳定**(实装前必须解决):`categorySlug = "<本地id>-<slugify(name)>"`。
   - 本地自增 id 在另一台机器上必然不同 → 拉取后若仍按本地 id 重算路径,
     下次 push 会把同一份简历写到**新路径**,远端出现成对重复文件。
   - 现有潜在 bug:重命名分类/版本后 slug 变化,push 写新路径但**从不删旧
     路径**,远端已经会累积重复文件。本 spec 的身份映射顺带修复它。

## 2. 用例

| # | 场景 | 期望 |
|---|---|---|
| U1 | 新机器 / 重装,connect 到已有 vault 仓库 | 提示导入,分类、版本、PDF、元数据全部恢复进本地 DB |
| U2 | 在 GitHub 网页(或另一台机器)改了某 `.tex` | 本地 Pull 后内容更新,且旧内容自动存为 checkpoint,不丢任何字 |
| U3 | 双机各自改动 | Pull 不丢本地新改动(本地较新则保留,汇总里可见);随后 Sync now 把本地推上去 |
| U4 | 远端删除了版本/分类 | Pull 默认不删本地;摘要对话框中显式勾选后才删 |

## 3. 总体方案

三层改动,自底向上:

1. **身份映射(git_key)**:本地行与远端路径之间建立稳定键,push/pull 都
   走它,路径一旦生成永不因 id / 改名而漂移。
2. **Rust 两条新命令**:`git_pull`(fetch + 对齐本地 clone)与
   `git_remote_snapshot`(直接读 `origin/<branch>` 的树,不依赖工作区状态)。
3. **TS 导入管线**(新文件 `src/githubPull.ts`):snapshot → 解析 → 与
   SQLite 调和 → 产出摘要供 UI 展示。

关键原则:**import 永远以 `origin/<branch>` 的真实内容为输入**(经
`git show`),工作区是否分叉只影响 push 路径,不污染导入数据。

## 4. 数据模型:git_key

### 4.1 Migration(`src-tauri/src/lib.rs`,version 10)

```sql
ALTER TABLE job_categories  ADD COLUMN git_key TEXT;
ALTER TABLE resume_versions ADD COLUMN git_key TEXT;
```

- `job_categories.git_key` = 远端目录名,如 `12-swe-backend`
- `resume_versions.git_key` = 文件 stem,如 `34-google-v2`
- 可空;`src/types.ts` 对应字段 `git_key: string | null`。

### 4.2 读写规则(`src/github.ts` 改动)

- `categorySlug(c)` / `versionSlug(v)` 改为:**优先 `git_key`**,为空才按
  现行 `${id}-${slugify(name)}` 计算,并在首次用于 push 时把计算结果
  `UPDATE` 回 DB(lazy 回填,老用户无感迁移——历史推送路径与计算结果一致)。
- 重命名分类/版本**不再改变 git_key**(修复 §1.3 重复文件 bug;远端文件名
  与显示名解耦,显示名一律以 `.json` 元数据为准)。
- 删除场景(`pushDelete*`)同样从 git_key 取路径。
- pull 导入新建行时,git_key 直接记远端 dirname/stem,本地 id 重新自增,
  二者从此互不相干。

## 5. Rust 新命令(`src-tauri/src/git.rs`)

### 5.1 `git_pull`

```rust
#[tauri::command]
async fn git_pull(repo_url: String, pat: String, branch: String)
    -> Result<GitPullResult, String>

struct GitPullResult {
    success: bool,
    log: String,        // 全程 redact(PAT)
    updated: bool,      // origin/<branch> 相对上次是否有新提交
    ahead: u32,         // 本地未推提交数(此前 push 失败遗留)
    behind: u32,
    head: Option<String>, // origin/<branch> 最新 "%h %s"
}
```

流程:

1. `remote set-url origin <带token url>`(PAT 轮换兼容,同 `git_apply`)。
2. `git fetch origin <branch>`,失败(网络 / 401)→ `success=false` 返回。
3. `git rev-list --count origin/<b>..<b>` → ahead;反向 → behind。
4. 工作区对齐(只为后续 push 顺利,不影响 import):
   - `ahead == 0`:`git reset --hard origin/<branch>`。
   - `ahead > 0`:尝试 `git rebase origin/<branch>`;冲突则
     `rebase --abort` 并在 log 标注 `REBASE_CONFLICT`(前端提示:Pull 导入
     完成后点 Sync now,由 DB 全量快照重建并推送)。

### 5.2 `git_remote_snapshot`

```rust
#[tauri::command]
async fn git_remote_snapshot(branch: String)
    -> Result<Vec<RepoFile>, String>

struct RepoFile {
    path: String,                 // 仅 categories/** 与 vault.json
    text: Option<String>,         // .json / .tex(UTF-8 lossy)
    bytes_base64: Option<String>, // .pdf
}
```

实现:`git ls-tree -r --name-only origin/<branch>` 过滤前缀
`categories/`,逐个 `git show origin/<branch>:<path>` 读内容;`.pdf` 走
stdout bytes → base64。单文件 > 30 MB 报错截断(与编译资产上限一致)。

## 6. 导入调和(新文件 `src/githubPull.ts`)

### 6.1 解析

snapshot → `RemoteVault`:

```
RemoteCategory { key: dirname, meta: _meta.json 解析 }      // meta 缺失则跳过该目录并计入 warnings
RemoteVersion  { key: stem, meta: .json 解析, tex?: string, pdfBase64?: string }
```

`vault.json` 仅作日志参考,**以目录扫描为准**。无法解析的 JSON、孤儿
`.tex`(无同名 `.json`)→ 跳过 + 计入 `warnings`,绝不中断整个导入。

### 6.2 匹配

本地查找顺序:① `git_key = remote.key`;② `git_key IS NULL` 且
`${id}-${slugify(name)} = remote.key`(命中即回填 git_key)。不做按名字的
模糊匹配(误绑风险)。

### 6.3 调和规则

| 远端 | 本地 | 动作 |
|---|---|---|
| 分类存在 | 无 | `createCategory` + 写 git_key,meta 字段全量落库 |
| 分类存在 | 有 | `remote.updated_at > local.updated_at` → 覆盖 name/jd/notes/icon/color;否则跳过(计入 `skippedLocalNewer`) |
| 版本存在 | 无 | `createVersion`(latex → content;pdf → `savePdfBytes()` 得 file_path)+ git_key |
| 版本存在,内容不同 | 有(latex) | **先 `createCheckpoint(本地内容, "pre-pull backup")`**,再比 updated_at:远端新 → 覆盖 content;本地新 → 保留,计入 `skippedLocalNewer` |
| 版本存在,内容不同 | 有(pdf) | 远端新 → `savePdfBytes` 新文件、更新 file_path、`removeVaultFile` 旧文件;本地新 → 保留 |
| 无 | 有,且 git_key 非空 | 列入 `deletionCandidates`,**默认不删**;用户在摘要对话框勾选后才执行(删 DB 行 + vault PDF 文件) |
| 无 | 有,git_key 为空 | 本地从未推送过的新内容,不动 |

产出:

```ts
interface PullSummary {
  addedCategories: number;
  addedVersions: number;
  updatedVersions: number;
  skippedLocalNewer: string[];       // "分类/版本" 显示名
  backedUpCheckpoints: number;       // pre-pull checkpoint 数
  deletionCandidates: { label: string; apply: () => Promise<void> }[];
  warnings: string[];
}
```

不变式:**导入永不净删数据**——任何覆盖前先有 checkpoint,任何删除必经
显式勾选。

## 7. push 路径配套改动

- `git_apply` push 失败且 stderr 匹配 `non-fast-forward|fetch first` →
  `GitResult` 增加 `needs_pull: bool`(Rust 端判断,别让前端 grep log)。
- 前端 `sync.run` 失败处理:`needs_pull` 时 SyncBadge 错误文案改为
  "远端有新提交,请先 Pull"(i18n `github_needs_pull`)。

## 8. UI 规格

### 8.1 GitHubSection(SettingsModal 内)

- connected 状态按钮区:`[Pull from GitHub] [Sync now] [Disconnect]`,
  Pull 为次级按钮(非 primary,避免双 primary)。
- Pull 点击 → `busy="pull"` → `git_pull` → `git_remote_snapshot` →
  `importRemoteVault` → 弹**摘要对话框**:
  - 计数行:新增 X 分类 / Y 版本,更新 Z,备份 N 个 checkpoint
  - `skippedLocalNewer` 列表(本地较新,未覆盖)
  - `deletionCandidates` 复选列表,默认全不选;确认后执行勾选项
  - `warnings` 折叠区
- behind=0 且无变化 → 直接 toast 式提示 `github_pull_up_to_date`,不弹框。
- 导入完成后必须刷新外层视图:`SettingsModal` 增加 `onVaultChanged` 回调,
  App 收到后 `refreshHome()` + 当前视图 `refreshVersions()`。

### 8.2 连接即恢复(U1)

`handleConnect` 成功后:若本地 DB 无任何分类**且** snapshot 含至少一个
分类 → 自动弹确认框 `github_restore_prompt`("检测到远端已有 vault,
是否导入到本机?"),确认即走 §6 管线。拒绝则不再自动提示(本次会话内)。

### 8.3 i18n 新增 key(en/zh 都要)

`github_pull` / `github_pulling` / `github_pull_up_to_date` /
`github_pull_done` / `github_pull_summary_title` /
`github_pull_added`(n,m)/ `github_pull_updated`(n)/
`github_pull_backed_up`(n)/ `github_pull_skipped_title` /
`github_pull_deletions_title` / `github_pull_delete_confirm` /
`github_pull_warnings` / `github_needs_pull` / `github_restore_prompt`

### 8.4 视觉

复用现有 token 体系:摘要对话框为标准 `.modal`;删除候选区文字用
`--danger-text`;SyncBadge 复用 syncing 态(label = "Pull")。无新增视觉
组件。

## 9. 边界情况

- **PAT 失效**:fetch 401 → `success=false`,提示重新连接;DB 零改动。
- **断网**:同上;import 只在 snapshot 成功返回后开始(事务性:先全部
  解析成功,再逐条写库)。
- **远端 force-push**:`reset --hard origin/<branch>` 本就以远端为准,安全。
- **远端有用户手动添加的无关文件**:忽略且不删(现行 `add -A` 行为保留)。
- **同一 stem 出现 `.tex` 与 `.pdf` 并存**:取与 `.json` meta `kind` 一致
  的那个,另一个计入 warnings。
- **`updated_at` 双方相等但内容不同**(时钟漂移):视为远端新(远端是
  显式 Pull 动作的目标),本地内容已有 pre-pull checkpoint 兜底。
- **导入过程中 app 退出**:每条 create/update 独立提交,半完成状态可由
  再次 Pull 幂等补齐(匹配靠 git_key,不会重复创建)。

## 10. 验收标准

1. **U1 恢复**:机器 A 推送的 vault,在空库机器 B connect → 提示导入 →
   分类(含 emoji/颜色/JD)、latex 版本(内容一致)、pdf 版本(可预览、
   缩略图正常)全部出现。
2. **U2 回流**:GitHub 网页改 `.tex` → Pull → 编辑器内容更新,History 中
   出现 "pre-pull backup" checkpoint,旧内容可恢复。
3. **U3 双改不丢**:本地改 A 版本未推、远端改 B 版本 → Pull → B 更新、
   A 保留且出现在 skipped 列表;Sync now 后远端两者皆最新。
4. **U4 删除受控**:远端删一个版本 → Pull → 本地默认仍在;勾选删除候选
   后 DB 行与 vault PDF 文件均移除。
5. **路径稳定**:Pull 导入的版本在本地编辑后 push,远端写回**原路径**
   (无新增重复文件);本地重命名分类后 push,远端目录名不变,仅
   `_meta.json` 的 name 变化。
6. **push 防撞**:远端领先时 Sync now → 错误徽标提示先 Pull(而非裸 git
   stderr);Pull 后重试成功。
7. 全流程 log 中 PAT 已 redact;`npm run build` + `cargo build` 通过。

## 11. 不做(out of scope,另立 spec)

- 定时 / 启动时自动 pull(可基于 `git_pull` 的 behind 字段做角标提醒)
- checkpoint 历史从 git log 回流重建
- `.tex` 三方文本合并(冲突 = checkpoint 备份 + 整文件取舍,已够安全)
- 多人协作 / 分支策略
