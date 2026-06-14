---
name: import-to-latex
description: 一键导入 PDF / Word 简历 → AI 转写为本项目 resume.cls 模板的 LaTeX 新版本
metadata:
  type: spec
---

# Spec: 一键导入 PDF / Word → LaTeX 新版本

- 日期:2026-06-13
- 前置:
  - AI 通道已实装:`src/ai.ts`(`complete()`/`AiConfig`)+
    `src-tauri/src/ai.rs`(`ai_complete` / `claude_code_run`),
    handler 注册在 `src-tauri/src/lib.rs:182-195`
  - AI Key 引导已实装:`spec/2026-06-13-ai-apikey-onboarding.md`
  - 模板宏定义:`src-tauri/src/resume_cls.rs`(`\name` `\address`
    `\rSection` `\begin{rSubsection}` …)
  - 版本入库 API:`createVersion()`(`src/db.ts:106`)
  - 编辑/编译流:`CodeEditor.tsx` + `latexCompile.ts`(Tectonic,
    ~800ms debounce)
- 目标:用户在某个 job category 下点「**导入简历**」→ 选一份 PDF 或
  DOCX → 系统抽取文本 → AI 改写成符合 `resume.cls` 的 LaTeX → 弹出
  **预览 + 确认对话框**(左 LaTeX 源 / 右 Tectonic 渲染的 PDF)→
  用户「采用 / 重试 / 取消」三选一;采用即作为该 category 下的**新
  resume_version** 落盘并进入编辑器。
- 状态:**草稿(2026-06-13)。** 未实装。

---

## 1. 决策摘要(已与用户确认)

| 维度 | 决定 |
|---|---|
| 范围 | **只做 AI 路线**;不引 pandoc / pdf2latex 的「忠实转写」备选 |
| PDF 抽取 | **纯 Rust** crate(`pdf-extract` 主,`lopdf` 备),无系统依赖 |
| DOCX 抽取 | 纯 Rust crate(`docx-rs` 或 `dotext`),无系统依赖 |
| 落点 | **先预览 + 确认**再写盘(不直落新版本) |
| 模板 | **两阶段 AI**:第 1 步「分析原简历风格」→ 决定用本项目自带 `resume.cls` 还是要 AI 即兴生成自定义 `.cls`;第 2 步基于该决策产出正文 `.tex` |

> 取舍说明:#4 让 AI 自选/生成模板会让产物的「视觉一致性」更接近原件,
> 但**自定义 cls 不在 `resume_cls.rs` 白名单内**,后续无法用 Tectonic
> 直接编译——见 §6 的 cls 落盘策略与回退。

## 2. 用户路径(happy path)

1. 在某 category 详情视图,顶部操作区(与「新建空白版本」并排)
   出现 **「📥 导入简历」** 按钮。
2. 点击 → 调用 `tauri-plugin-dialog` 的 file picker,过滤
   `*.pdf,*.doc,*.docx`(`.doc` 拒收并提示「请另存为 .docx」,见 §7)。
3. 选定文件后,出现**进度对话框**(不可操作,可取消),状态机:
   `extracting → analyzing → generating → previewing`。
4. `previewing` 阶段弹出**全屏预览模态**:
   - 顶部:文件名 + 「AI 选用模板:**项目默认 resume.cls** / **自定义
     cls(AI 生成)**」徽章
   - 左半:LaTeX 源(只读 CodeMirror,与编辑器同主题)
   - 右半:Tectonic 实时编译出的 PDF(若失败显示日志)
   - 底部按钮:**采用** / **重试**(重新跑第 1+2 步)/ **取消**
5. **采用** → 调用 `createVersion({ kind: "latex", content, name })`,
   新版本名默认 `导入自 <原文件名>`,跳转进编辑器。

## 3. 抽取层(Rust)

新增 `src-tauri/src/import.rs`,导出两个 Tauri command:

```rust
#[tauri::command]
pub async fn extract_pdf_text(path: String) -> Result<ExtractedDoc, String>;

#[tauri::command]
pub async fn extract_docx_text(path: String) -> Result<ExtractedDoc, String>;

pub struct ExtractedDoc {
    pub plain_text: String,        // 段落保留,空行分段
    pub source_kind: &'static str, // "pdf" | "docx"
    pub page_count: Option<u32>,   // PDF 才有
    pub warnings: Vec<String>,     // e.g. "encrypted PDF, text may be partial"
}
```

- PDF:`pdf-extract = "0.7"`(纯 Rust,无系统依赖)。捕 panic 后回退
  `lopdf` 手抠 `/Contents` 流;两者都失败 → 返回错误「无法抽取文本,
  这份 PDF 可能是扫描件,请先 OCR 后导入」。
- DOCX:`docx-rs = "0.4"`(读 `word/document.xml`,按段落输出)。
- 文本规整化(共用工具):
  - 去 Unicode 控制符 / 软连字符 `­`
  - 合并断行连字符(`tion-\nal` → `tional`)
  - 多空行折叠为一行
  - 全角空格归一化(中文简历常见)
- handler 注册到 `lib.rs:182` 列表。

依赖追加(`Cargo.toml`):

```toml
pdf-extract = "0.7"
lopdf       = "0.32"
docx-rs     = "0.4"
```

## 4. AI 转写层(两阶段)

新增 `src/importToLatex.ts`,导出:

```ts
export async function importDocumentToLatex(filePath: string): Promise<{
  tex: string;
  templateChoice: "builtin-resume-cls" | "ai-custom-cls";
  customCls?: string;     // 仅 ai-custom-cls 时存在
  warnings: string[];
}>;
```

复用 `ai.ts` 已有的内部 `complete(system, prompt)`(目前是 module-private,
本 spec 把它**导出**为 `aiComplete` 供本模块复用,不新建第二条 API
通道)。

### 4.1 阶段 1:风格分析

system prompt(摘要,实装时进 `src/importToLatex.ts` 顶部常量):

> 你是简历版式分析师。读下面这份从 PDF/DOCX 抽出的简历文本,判断它的
> 视觉风格是否**贴近**本项目自带的 Medium-Length Professional CV 模板
> (居中大写姓名 + 两行联系方式 + 全大写 section 标题 + 缩进的
> rSubsection 三段式)。
>
> **只输出 JSON**,schema:
> ```
> { "templateChoice": "builtin-resume-cls" | "ai-custom-cls",
>   "reason": string,                    // ≤ 60 字
>   "detected": { "lang": "zh"|"en"|"mixed",
>                 "sections": string[],  // 检出到的 section 标题
>                 "hasPhoto": boolean } }
> ```

判定阈值由 AI 自定;**fallback:JSON 解析失败 → 强制
`builtin-resume-cls`**,并把原始 AI 回复塞进 `warnings`。

### 4.2 阶段 2a:套用内置模板

若 `templateChoice === "builtin-resume-cls"`,system prompt:

> 你是 LaTeX 排版师。把下面的简历正文改写成使用 `\documentclass{resume}`
> (本项目自带的 `resume.cls`)的 `.tex`。**只能使用以下宏**:
> `\name{}` `\address{}` `\begin{rSection}{TITLE}…\end{rSection}`
> `\begin{rSubsection}{…}{…}{…}{…}…\end{rSubsection}` `\item …`
>
> 联系方式合并为 1–2 行,`\\` 分隔为多条目;sections 全大写英文标题
> (中文原稿则保留中文,不要硬翻);项目/工作经历用 rSubsection;
> 教育、技能、证书用 rSection + itemize。
>
> **不要**加 `\usepackage` 之外的包(本模板只允许 `graphicx`,已 preload)。
> **不要**插图,即使原稿有照片。**不要**输出代码块围栏,只输出纯 .tex。

输入:`detected` 的 JSON + 抽出的纯文本。

### 4.3 阶段 2b:AI 生成自定义 cls

若 `templateChoice === "ai-custom-cls"`,**两个独立 AI 调用**:

- 调用 ①:产 `customCls`(完整 `.cls` 文件,包含
  `\ProvidesClass{custom_resume}` + 所有自定义宏);约束「**只能依赖
  Tectonic 默认可拉取的 CTAN 包**」(article / geometry / parskip /
  fontspec(若中文)/ xcolor / titlesec / enumitem)。
- 调用 ②:产 `tex`,顶部 `\documentclass{custom_resume}`,正文复用
  ① 里定义的宏。

实装时 ① 在 token 上不便宜,**默认关掉**;阶段 1 即使返回
`ai-custom-cls` 也先回退到 `builtin-resume-cls`,在 §6 的 settings
里加一个 **「实验性:允许 AI 生成自定义模板」** 开关由用户显式打开。
预览模态的徽章如实显示当前用的是哪条路径。

> 这一节是本 spec 的最大不确定点。先按「开关默认 off」实装,等
> §8 的验收跑过后再决定要不要默认开。

## 5. 预览模态(前端)

新增 `src/ImportPreviewModal.tsx`,接口:

```ts
interface ImportPreviewModalProps {
  source: { name: string; kind: "pdf" | "docx" };
  templateChoice: "builtin-resume-cls" | "ai-custom-cls";
  tex: string;
  customCls?: string;
  warnings: string[];
  onAccept(): void;   // 落盘 + 关闭 + 跳编辑器
  onRetry(): void;    // 重跑 4.1 + 4.2
  onCancel(): void;
}
```

- 左半 LaTeX 源:复用 `CodeEditor.tsx` 的只读模式(若不存在 readOnly
  prop,加一个;受影响范围 = 该 prop 在编辑器主页同样可选用 `false`)。
- 右半 PDF:复用 `latexCompile.ts` 的 `compile()`;若 `customCls`
  存在则把它作为附加输入文件传给 Tectonic(需确认 `compile_latex`
  command 是否支持多文件;若不支持,**先**把 `customCls` 写到与
  `.tex` 同目录的临时 `custom_resume.cls`,再 invoke——见 §6 临时目录)。
- 编译失败:右半显示 Tectonic 日志(monospace,可滚动);**禁用「采用」
  按钮**,鼓励「重试」。
- 「重试」每次都重新跑 §4.1 阶段 1(因为温度 > 0,结果会变),
  最多 3 次后按钮变灰提示「连续 3 次未编译通过,建议取消并手动检查
  原文件」。

## 6. 落盘策略

- **不**在抽取/AI 阶段写盘;所有中间产物在内存里。
- 「采用」时:
  1. 若 `templateChoice === "builtin-resume-cls"`:`createVersion({
     kind: "latex", content: tex, name: "导入自 <文件名>" })` —— `.cls`
     不用落,编辑器编译时 Tectonic 会从本项目内置位置找(参见
     `latexCompile.ts` 现有逻辑)。
  2. 若 `ai-custom-cls`:把 `customCls` 作为 **asset**(复用
     `AssetsPanel` 的 assets 表;`src/db.ts:286` 已有 `INSERT INTO
     assets`)挂到这个 version,文件名 `custom_resume.cls`。Tectonic
     编译时 working dir 包含该 asset(确认 `latexCompile.ts` 是否
     在编译前把 assets 落到临时目录;若否,本 spec 触发该增强,但
     **此分支默认关闭**,见 §4.3)。
- 临时编译目录(预览右半):`std::env::temp_dir()` 下随机 uuid 子目录,
  关闭模态后清理。

## 7. 边界与错误处理

- **`.doc`(老二进制格式)**:file picker 允许选中,但抽取层直接返回
  错误,前端提示「Word 97-2003 (.doc) 不支持,请用 Word 另存为
  `.docx`(或 PDF)后再导入」。
- **扫描版 PDF / 加密 PDF**:抽出文本为空或显著乱码 → 不进 AI,直接
  在进度对话框报「这份 PDF 似乎是扫描件或加密,导入需要 OCR;暂不
  支持」,文案见 i18n。
- **AI not_configured / auth / network / empty**:沿用 `AiError`
  类型,弹现有错误 toast,关闭进度对话框,不进预览。
- **抽出文本 > 30 KB**:截断到前 30 KB,`warnings.push("文档较长,
  仅前 30KB 进入 AI;可能需要手动补全后半部分")`;不报错。
- **空文档 / 0 字符**:不进 AI,直接报错。
- **取消**:任何阶段点 X / Esc / 「取消」→ 立即 abort 当前 AI 调用
  (`ai_complete` 当前是否支持 abort?若否本 spec 不强求,记为已知
  限制:抽取很快可忽略,AI 阶段最坏等 1 次完整响应)。
- **隐私**:导入文档内容会发到用户配置的 AI 提供商。预览模态底部
  附一行小字「内容已经发送给 <provider name>;不会持久化在本项目
  之外」。这条文案不可关。

## 8. 验收标准

1. **PDF(英文,文本型)**:选一份典型工程师简历 PDF → 预览模态
   显示可编译的 `resume.cls` 版 LaTeX,右侧 PDF 渲染正常;采用后
   该版本进入编辑器,内容与原稿在「姓名 / 联系方式 / 至少 1 段教育
   / 至少 1 段工作经历」四要素上一致。
2. **DOCX(中文)**:中文姓名/section 标题保留为中文,采用后正常
   编译(`fontspec` / 中文字体由 Tectonic 处理,与现状一致;若现
   状不处理,本 spec **不**新增中文字体配置,记为已知限制)。
3. **扫描 PDF**:正确报错,不进 AI,不消耗 token。
4. **AI 未配置**:点「导入简历」即提示去设置页配置 AI,不弹 file picker
   (或弹但选完文件后报错——二选一,实装时倾向**先校验**)。
5. **重试**:连点 2 次「重试」每次产出可以不同;连续 3 次失败后按钮
   置灰。
6. **取消**:在 `extracting`/`generating` 阶段取消,无残留临时文件、
   无残留 DB 行。
7. **i18n**:en/zh 文案完整,模态在两种 locale 下不溢出宽度。
8. **`npm run build` + `cargo build` 通过**;新增三个 Rust crate
   不引发跨平台编译失败(Windows / macOS / Linux dev 机各 build 一次)。

## 9. 不做(out of scope)

- 老 `.doc` 二进制格式、`.rtf`、`.pages`、`.odt`。
- OCR 扫描版 PDF(可记一条后续 spec:接 Tesseract 或云 OCR)。
- 把原 PDF 里的**照片 / logo / 图表**搬进 LaTeX。
- 「忠实版式」转写管线(pandoc / pdf2latex);本 spec 已明确只走 AI。
- 导入后自动 diff 对比原 PDF 与新编译 PDF(可记为后续 spec)。
- 批量导入(一次选多份)。
- 把导入结果直接 push 到 GitHub(走现有 checkpoint / sync 流即可)。

## 10. 实装顺序建议

1. Rust 抽取层(`import.rs` + `Cargo.toml` 三 crate)+ 两个 command 单测。
2. `src/importToLatex.ts` 的阶段 1 + 阶段 2a(默认路径),先用
   `console.log` 看 AI 输出。
3. `ImportPreviewModal.tsx` + 接入 category 详情视图的「导入简历」按钮。
4. 错误路径、i18n、预览模态的编译失败 UI。
5. **(可选,实验开关)** 阶段 2b 自定义 cls 路径 + asset 落盘。
6. 三平台 build 验证。
