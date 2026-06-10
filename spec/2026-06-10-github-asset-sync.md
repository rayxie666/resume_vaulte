# Spec: 附件(assets)双向同步 —— 推送到 GitHub 并可拉回

- 日期:2026-06-10
- 前置:
  - `spec/2026-06-10-github-pull-sync.md`(pull 管线,已实装:`src/githubPull.ts`、`git.rs::git_remote_snapshot`)
  - `spec/2026-06-09-asset-blob-roundtrip.md`(bytes_b64 教训:二进制绝不走 plugin-sql 的 number[] 参数)
- 目标:LaTeX 附件(图片 / 字体等编译资产)纳入 GitHub 同步——push 备份、pull 恢复、链接关系(版本 ↔ 附件)随行。
- 状态:**已实装(2026-06-10)。**

---

## 1. 现状与问题

- 附件存于全局 `assets` 表(`name TEXT UNIQUE`,字节在 `bytes_b64` 列),
  版本关联存于 `resume_version_assets`。**push 链路完全不覆盖**:
  `syncVaultManual` / `pushCheckpoint` / `versionToFiles` 只写 `.tex/.pdf/.json`。
- 后果:新机器走 pull 恢复(U1)后,所有 `\includegraphics{...}` 引用的
  图片缺失,编译直接失败——备份是残缺的。
- 远端 snapshot 过滤器(`git.rs:523`)只放行 `vault.json` 与
  `categories/**`,`assets/**` 即使手动放上去也会被 pull 忽略。

## 2. 用例

| # | 场景 | 期望 |
|---|---|---|
| A1 | 新机恢复(衔接 pull spec U1) | pull 后附件全量回到本地库,版本-附件链接恢复,`.tex` 一次编译通过 |
| A2 | 机器 A 上传/更新了图片 | 机器 B pull 后拿到新字节;同名旧字节被覆盖(git 历史留底) |
| A3 | 附件改名 / 删除 | 远端路径同步变化;另一端 pull 后一致(删除走候选确认,与版本同策略) |
| A4 | 仅在 AttachmentsModal 里调整了链接(link/unlink) | 链接关系作为版本元数据同步 |

## 3. 仓库布局(新增)

```
assets/<name>                 # 原始字节,文件名即身份(assets.name UNIQUE)
assets/_meta.json             # { "<name>": { "mime": string|null, "size": number,
                              #               "updated_at": string } }
categories/<ck>/<vk>.json     # 版本元数据新增字段:
                              #   "assets": ["logo.png", "font.otf", ...]  ← 链接名单
```

- **身份 = 文件名**。`assets.name` 本就 UNIQUE,跨机器以 name 对齐,
  无需类似 git_key 的新键。
- `_meta.json` 承载 mime 与 `updated_at`(冲突仲裁用);单文件 map,
  每次涉及附件的 push 全量重写。
- 版本 meta 的 `assets` 字段记录**显式链接**(`resume_version_assets`),
  旧仓库 / 旧 meta 缺该字段 → 拉取端不动链接,靠现有源码扫描自动连接
  (`findReferencedAssets` → `refreshAssets`)兜底,向后兼容。

## 4. push 侧改动(`src/github.ts` + 调用点)

### 4.1 序列化

- `versionMeta(v)` → 改为 async 或由调用方传入
  `assetNames: string[]`(来自 `listAssetsForVersion`),写入 `assets` 字段。
- 新增:

```ts
assetFilePath(name: string): string          // `assets/${name}`
assetsMetaFile(): Promise<FileWrite>         // 全量 _meta.json
assetToFile(a: Asset): Promise<FileWrite>    // { path, bytes: Array.from(getAssetBytes(a.id)) }
```

字节走现有 `FileWrite.bytes: number[]`(与 PDF 版本同路径,经 Tauri IPC
JSON 直达 Rust `fs::write`,不经过 plugin-sql,无 round-trip 风险)。

### 4.2 触发点

| 用户动作 | push 内容 | commit message |
|---|---|---|
| 上传/替换附件(AssetsPanel / AttachmentsModal) | `assets/<name>` + `_meta.json` | `Add asset "<name>"` / `Update asset "<name>"` |
| 重命名附件 | 写新路径 + 删旧路径 + `_meta.json` + **所有 linked 版本的 meta json**(assets 名单变了) | `Rename asset "<old>" → "<new>"` |
| 删除附件 | 删 `assets/<name>` + `_meta.json` + 受影响版本 meta | `Delete asset "<name>"` |
| link / unlink(AttachmentsModal) | 该版本的 meta json | `Update attachments of "<version>"` |
| checkpoint push(现有 `pushCheckpoint`) | 附带该版本 linked 的全部 asset 文件(幂等:内容未变则 git 视为 nothing to commit) | 现有格式不变 |
| Sync now(`syncVaultManual`) | 全量:所有 `assets/*` + `_meta.json` + 各版本 meta 含 `assets` 字段 | 现有格式不变 |

所有触发点均沿用现有模式:`isGitConnected()` 守卫 + `sync.run(label, …)`
异步执行,失败走 SyncBadge,不阻塞本地操作。

### 4.3 文件名约束

push 前校验 `name`:拒绝含 `/`、`\`、前导 `.`、`..`(路径穿越);超出
5 MB(`MAX_BYTES`)的不可能存在(上传时已拦截),无需再查。

## 5. pull 侧改动

### 5.1 Rust(`git.rs::git_remote_snapshot`)

过滤器放行 `assets/` 前缀;`assets/**`(除 `_meta.json`)一律按二进制走
`bytes_base64`,`_meta.json` 走 text。单文件 > 5 MB → 跳过并在 log 标注
(他人手动塞入的超限文件不进库)。

### 5.2 解析(`githubPull.ts::parseSnapshot` 扩展)

`RemoteVault` 增加:

```ts
assets: Map<string, { name: string; bytesBase64: string;
                      mime: string | null; updatedAt: string | null }>
```

- `_meta.json` 缺失(老仓库)→ `updatedAt = null`(仲裁时视为远端新)。
- 非法名(§4.3 规则)→ 跳过 + warnings。
- 版本解析:meta json 的 `assets` 字段存入 `RemoteVersion.assetNames?: string[]`。

### 5.3 调和(`importRemoteVault` 扩展)

**顺序:附件先于分类/版本**(版本落库后的源码扫描和显式链接都依赖
asset 行已存在)。

| 远端 | 本地(按 name) | 动作 |
|---|---|---|
| 有 | 无 | `upsertAsset(name, bytes)` → 计 `addedAssets` |
| 有,字节不同 | 有 | 比 `updated_at`(远端取 `_meta.json`,null 视为较新):远端新 → `upsertAsset` 覆盖,计 `updatedAssets`;本地新 → 保留,计入 skipped 列表 |
| 有,字节相同 | 有 | 跳过(比较用 size 预筛 + base64 串等值,避免无谓解码) |
| 无(但远端存在 `_meta.json`,说明 asset 同步已启用) | 有 | 并入现有 `deletionCandidates`,默认不删;勾选执行 `deleteAsset`(级联解链) |
| 无且远端无 `_meta.json`(老仓库) | 有 | 不动(无法区分"远端删了"与"远端从没同步过") |

链接恢复:对每个导入/匹配成功的版本,若 `assetNames` 存在 →
逐名 `getAssetByName` + `linkAssetToVersion`(幂等,PRIMARY KEY 去重);
名单中找不到的 name → warnings。**不做 unlink 回放**(远端名单少于本地
不解链,避免老 meta 覆盖新链接;unlink 的收敛交给下一次 push)。

覆盖无备份说明:附件没有 checkpoint 机制,远端较新时旧字节直接被覆盖。
可接受:若旧字节曾推送过,git 历史留底;从未推送过的本地新字节只在
"本地较新"分支保留,不会被覆盖。该语义写入摘要文案。

### 5.4 `PullSummary` 扩展

```ts
addedAssets: number;
updatedAssets: number;
skippedAssetsLocalNewer: string[];   // 并入摘要"本地较新"区
relinkedCount: number;               // 成功恢复的链接条数
// 删除候选并入现有 deletionCandidates(label 前缀 "附件:")
```

## 6. UI 规格

- Pull 摘要对话框增加一行计数:`github_pull_assets_line`
  ("附件:新增 X,更新 Y,恢复链接 Z")。
- 删除候选列表里附件项与版本项混排,label 带类型前缀,复选交互不变。
- AssetsPanel / AttachmentsModal 的上传、改名、删除操作在 connected 时
  触发 §4.2 push,SyncBadge 反馈,无新增 UI 元素。
- i18n 新 key(en/zh):`github_pull_assets_line`(x,y,z)、
  `sync_asset_add`(name)、`sync_asset_rename`、`sync_asset_delete`、
  `sync_attachments_update`(versionName)。

## 7. 边界情况

- **base64 round-trip**:导入写库必须走 `upsertAsset`(内部 bytes_b64
  路径),禁止任何 `number[]` 经 plugin-sql 参数传 BLOB(见前置 spec 教训)。
- **同名不同内容跨机并发**:按 `_meta.json.updated_at` 仲裁,时钟相等且
  内容不同 → 远端胜(与版本规则一致)。
- **重命名竞态**(A 机改名、B 机仍引用旧名):B pull 后旧名进入删除候选
  (默认保留),新名作为新增导入;`.tex` 里引用哪个名就编译哪个,无破坏。
- **字体等非图片资产**:mime 为空或非 image/* 均按字节同步,无差别。
- **远端 `assets/` 下有子目录**:跳过 + warnings(本地模型是平面名单)。
- **导入半途退出**:逐条 upsert,幂等可重入(同 pull spec §9)。

## 8. 验收标准

1. **A1**:机器 A 有 2 张图 + 1 字体并被两个版本引用 → Sync now → 空库
   机器 B connect + 导入 → AssetsPanel 三个附件齐全、usage 计数正确、
   两个版本直接编译通过(无 missing-assets banner)。
2. **A2**:A 机替换 `logo.png` 字节 → push;B 机 pull → 字节更新(以
   size + 内容校验),摘要显示"更新 1"。
3. **A3 改名**:A 机 `logo.png → brand.png` → 远端旧路径消失、新路径出现、
   linked 版本 meta 的 `assets` 名单同步;B 机 pull → 新名导入,旧名出现
   在删除候选(默认保留)。
4. **A3 删除**:勾选删除候选后,本地 asset 行与链接级联移除。
5. **A4**:仅 link/unlink 操作 → 远端该版本 meta json 的 `assets` 字段
   变化;另一端 pull → link 恢复(unlink 不回放,符合 §5.3 设计)。
6. **老仓库兼容**:对无 `assets/`、无 `_meta.json`、版本 meta 无 `assets`
   字段的存量仓库 pull → 行为与现状完全一致,零 warnings 之外的副作用。
7. **5 MB 守卫**:远端手动放入 6 MB 文件 → pull 跳过 + warning,本地无变化。
8. `npm run build` + `cargo build` 通过;PAT 全程 redact。

## 9. 不做(out of scope)

- 附件的 checkpoint / 历史版本回流(git 历史已留底,需要时另立 spec)
- Git LFS / 大于 5 MB 资产
- 附件去重(同字节不同名)与内容寻址存储
- unlink 操作的跨机回放(见 §5.3,有意省略)
