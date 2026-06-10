# Spec: LaTeX 卡片缩略图 / pdfjs 渲染优化

- 日期：2026-06-09
- 状态：**已实现**（包含在 commit `c5e7368` 里，一起进了 CodeMirror 那次提交）
- 目标：让 LaTeX 版本的卡片也能展示编译后的 PDF 缩略图；同时修一些 pdfjs 6.x 下 PDF 缩略图渲染的写法。

> 这是一份**回溯 spec**：实现先于 spec 进入仓库，写下来是为了让 `/spec` 和代码状态对齐，未来回看不困惑。

---

## 1. 背景

实现前的状态：

- `src/thumbnail.ts` 用 pdfjs-dist 6.0.227 渲染 PDF 第一页为 PNG dataURL。
- `src/useThumbnail.ts` 中 `SUPPORTED_KINDS = new Set(["pdf"])`，**LaTeX kind 被显式跳过** —— 卡片始终显示 "TeX" 占位图。
- pdfjs 6.x 的 `RenderParameters` 里 `canvas` 是必填、`canvasContext` 是 legacy（同时传两个会触发警告，且文档明确说"如果非要用 context，canvas 必须为 null"）。
- 没有 retina 高分屏的 DPR 适配，缩略图在 mac 上偏糊。

需求：

1. LaTeX 卡片要能显示编译后的 PDF 第一页缩略图。
2. PDF 缩略图本身写法跟着 pdfjs 6.x 推荐姿势走。
3. 不能让长列表瞬间触发 N 个并发 tectonic 编译（CPU 会爆）。

---

## 2. 设计

### 2.1 `thumbnail.ts` 渲染调用

- `page.render({ canvas, viewport })`，**只传 canvas，不再传 canvasContext**。
- 渲染目标尺寸乘以 `min(2, window.devicePixelRatio)`，提升 retina 清晰度，canvas 像素变 2x，输出 dataURL 物理尺寸不变。
- cleanup 仍然 `loadingTask.destroy()`（pdfjs 6.x 的 `PDFDocumentProxy` 没有公开 `destroy`，只有 `cleanup`；`destroy()` 在 `loadingTask` 上）。

### 2.2 `useThumbnail.ts` 支持 LaTeX

- `SUPPORTED_KINDS` 改为 `new Set(["pdf", "latex"])`，`tsx` 仍然跳过。
- `fetchPdfBytes` 加 latex 分支：
  1. `source = version.content`，空则抛 "empty latex source" 走 failed。
  2. `listAssetsForVersion(version.id)` → 每条 `getAssetBytes` → `bytesToBase64`。
  3. `compileLatex(source, assets)` → `pdfBytesFromResult(result)`。
  4. 拿不到 pdf 就抛 "latex compile failed"。
- 沿用现有的串行队列 `MAX_CONCURRENT = 2`，长列表不会瞬间起 10 个 tectonic。
- 缓存签名 `THUMB_PIPELINE_VERSION` 从 `v3` 升到 `v4`，旧的 fail marker 自动作废一遍，让用户立刻看到新效果。

### 2.3 缓存

- 现有 `thumbCache.ts` 按 `${versionId}.${signature}` 写 localStorage 已经足够。
- 缓存签名带 `version.updated_at`，LaTeX 内容变更会让 `updated_at` 变 → 自动失效。
- 编辑后没保存就不会触发重渲染（保存才更新 `updated_at`）。

---

## 3. 关键改动（已在仓库里）

| 文件 | 改动 |
| --- | --- |
| `src/thumbnail.ts` | `getDocument().promise` 直拿 doc；render 只传 `canvas`；DPR 2x；cleanup 用 `loadingTask.destroy()` |
| `src/useThumbnail.ts` | `SUPPORTED_KINDS` 加 `latex`；`fetchPdfBytes` 加 latex 分支调 `compileLatex`；签名 `v3 → v4` |

均已在 `c5e7368 feat(editor): replace LaTeX textarea with CodeMirror 6` 内提交（虽然 commit 标题是 CodeMirror，这两块缩略图代码搭车进来了，commit message 没单独列出来）。

---

## 4. 风险与权衡

| 风险 | 应对 |
| --- | --- |
| 打开一个版本列表会触发 N 次 tectonic 编译，慢 | 队列限流到 2 并发；首次渲染慢但用户能看到占位/进度文字 |
| 编译占用磁盘临时空间 | `latex.rs` 已 `cleanup_dir` 编译后清理 |
| LaTeX 源损坏 / 缺 asset 时反复触发编译失败 | 失败会写 `setThumbnailFailure` 缓存 fail marker，签名不变时不重试 |
| 缩略图缓存写满 localStorage | 已有 quota-exceeded fallback：删一半旧缓存重试 |
| 用户希望缩略图永远是"最近一次成功编译"的 PDF，而不是当前 source | 当前实现要求 source 必须能编译；如果想要"最近成功"语义，需要把 pdf bytes 持久化（spec 之外） |

---

## 5. 后续可考虑

- 把 LaTeX 编译产物（PDF bytes）持久化到 AppData，新建一列 `resume_versions.cached_pdf_path`。
  - 缩略图直接读缓存 PDF，不再每次重编。
  - 编辑器手动编译成功后写缓存；版本列表展示用缓存。
  - 收益：版本列表打开瞬间出图；CPU 不再背锅。
  - 代价：DB 加列 + migration；缓存失效策略（content hash 列）。
- 把缩略图渲染挪到 Web Worker，避免主线程卡顿（当前 pdfjs worker 已在子线程，但 base64 转换和 canvas 绘制在主线程）。

这两条**不进 Phase 1**，等用户实际抱怨"慢"再说。

---

## 6. 验收（事后验证）

- [ ] LaTeX 卡片能显示编译后的第一页缩略图。
- [ ] PDF 卡片仍正常显示缩略图。
- [ ] tsx 卡片继续显示彩色占位（无回归）。
- [ ] 缩略图在 retina 屏上比之前清晰。
- [ ] 同时打开 5 个 LaTeX 卡片不会让机器风扇起飞（队列限流生效）。
- [ ] 编辑后保存，缩略图自动刷新。
