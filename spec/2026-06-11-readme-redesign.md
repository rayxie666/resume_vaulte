# Spec: README 重设计 —— 产品级首页 + 功能截图体系

- 日期:2026-06-11
- 前置:UI 重设计已实装(截图素材即产品本身);星云背景如已实装则入镜
- 目标:把 README 从"纯技术文档"升级为"产品首页":hero 截图 + 动图 +
  按功能组织的截图导览,专业开源项目的排版风格;现有技术内容(安装、
  排错、架构)全部保留但重新排序。
- 状态:**部分实装(2026-06-11)。** README 全文结构、hero、badges、
  TOC、Features 文案与全部图片引用已就位;§4 的截图/动图素材需真机
  运行 app 手工摄制——逐张清单见 `docs/screenshots/SHOT-LIST.md`,
  素材入库后本 spec 即完成。

---

## 1. 受众与结构策略

GitHub README 的两类读者,按到达顺序服务:

1. **潜在用户**(为什么要用?长什么样?)→ 首屏 hero + 功能导览,30 秒
   内看懂产品;
2. **开发者/贡献者**(怎么跑起来?)→ Quick start 及之后的技术章节。

现 README 的问题:第一类读者完全没被服务——首屏是依赖表格。

### 1.1 新章节顺序

```
1. Hero(居中:wordmark + 一句话 + badges + 主截图)
2. ✨ Features(截图导览,本 spec 核心,§3)
3. Quick start(现内容,前移依赖检查为一句话 + 折叠详情)
4. Requirements(现内容)
5. GitHub sync(现内容 + 1 张截图)
6. Attachments(现内容,精简)
7. Where data lives / Building a release / Troubleshooting(现内容)
8. Architecture(= 现 Project layout + Development notes + Tech stack,
   合并为一节,贡献者向)
9. Bundled fonts / License(现内容)
```

语言:保持英文(GitHub 受众);中文版 `README.zh.md` 列入 out of scope。

### 1.2 Hero 区规格

```markdown
<div align="center">
  <h1>Resume Vault</h1>
  <p><em>One vault for every version of you.</em></p>
  <p>Local-first desktop app for managing LaTeX/PDF resume versions —
     live compile, git-style checkpoints, two-way GitHub sync.</p>
  [badges]
  <picture>hero 截图(双主题自适应,§4.3)</picture>
</div>
```

- badges(shields.io,flat 风格,≤ 5 枚):`platform macOS` /
  `Tauri 2` / `React 19` / `license MIT` / `release`(链接 Releases)。
  不堆 CI/coverage 等没有的东西。
- tagline 一句话定位 + 一行功能摘要,不超过两行。

## 2. 截图体系总则

- 所有素材存 `docs/screenshots/`,命名 `NN-slug[.dark|.light].png`
  (NN = 章节序,便于排序);动图 `NN-slug.gif`。
- README 中通过 `<img src="docs/screenshots/…" width="…">` 控制显示宽度
  (GitHub 不支持 markdown 宽度语法)。
- **截图是产品的脸**:必须用统一的演示数据集与窗口规格(§4),禁止
  开发者真实简历/姓名/邮箱入镜。

## 3. 功能导览(Features 节,逐段规格)

每段格式:`### emoji + 动词标题` + 1–2 句说明 + 截图。顺序按用户旅程:

| # | 段落 | 标题(en) | 截图/动图 | 内容要求 |
|---|---|---|---|---|
| F1 | 分类首页 | 🗂 Organize by target role | `10-home.png` | home 视图,6 个分类卡(不同 emoji/渐变色),星云背景可见(若已实装) |
| F2 | 版本网格 | 📄 Every version, one glance | `20-versions.png` | category 视图,4+ 版本卡含 PDF 缩略图、TeX/PDF kind 徽标、JD 折叠块露出 |
| F3 | **编辑+实时预览(主打)** | ⚡ Type LaTeX, watch the PDF | `30-editor.gif`(动图)+ `31-editor.png`(静帧兜底) | 录屏 6–8s:编辑一行 bullet → 进度条扫过 → 新 PDF 落纸;静帧为分栏全景 |
| F4 | AI 改写 | ✦ Rewrite with an expert eye | `40-ai-rewrite.png` | 选中 bullet,就地 diff 已展开(旧红新绿 + Accept/Reject),能看清改写质量 |
| F5 | Checkpoints | 🕰 Checkpoint, diff, restore | `50-history.png` | HistoryPanel:左列 3+ checkpoint,右侧 diff 有红绿行 |
| F6 | GitHub 同步 | ☁️ Two-way GitHub sync | `60-github.png` | 设置页 GitHub 区:已连接状态 + Pull/Sync 按钮;或 Pull 摘要对话框(数字非零) |
| F7 | 附件 | 🖼 Assets that just compile | `70-attachments.png` | AttachmentsModal 含 2–3 个文件;或资产库网格视图 |
| F8 | 双主题 | 🌗 Dark-first, light-ready | `80-themes.png` | 同一视图深浅双截图左右拼接(单图,§4.4) |

文案准则:标题动词开头、说明句讲用户收益不讲实现("Never lose a good
paragraph again" 而非 "SQLite-backed snapshots");全节零技术名词例外:
Tectonic/LaTeX 可出现。

GitHub sync 节(正文)复用 F6 截图;Attachments 节复用 F7,不重复截。

## 4. 截图制作规范

### 4.1 演示数据集(截图前一次性搭建)

- 分类 ×6:`Google — SWE`、`ByteDance — Infra`、`Stripe — Backend`、
  `Anthropic — Research Eng`、`Startup — Founding Eng`、`New Grad 2026`,
  各配不同 emoji 与渐变色;首页计数 2–5 不等。
- 简历人设:**Ada Lovelace**(致敬且明显虚构),内容用真实感 bullet
  (含量化数字),地址/邮箱用 `ada@example.com` 类占位。
- 至少 1 个分类填入 JD 文本;至少 1 个版本挂 2 个附件并打 3 个
  checkpoint(note 写真实感:"quantified impact"、"tailor for infra")。
- AI 改写截图的选中段落要能展示专家性:弱句 "Responsible for backend
  services" → 改写后动作动词 + 量化。

### 4.2 窗口与抓取

- 窗口:**1280×800 逻辑像素**(`tauri.conf.json` 临时改或手动拉);截图
  统一 Retina 2x(实际 2560×1600),README 内 `width="800"` 显示。
- 工具:`screencapture -w -o`(窗口模式,`-o` 去阴影后期统一加),或
  CleanShot;统一**不带 macOS 系统阴影**,后期由 GitHub 白/黑底自然呈现
  (避免双主题下阴影违和)。
- 光标不入镜(F4 选区高亮除外);无 hover 态残留(除非该段落就是展示
  hover)。

### 4.3 双主题自适应(hero 专属)

GitHub 支持 `prefers-color-scheme` 的 `<picture>`:

```html
<picture>
  <source media="(prefers-color-scheme: dark)"
          srcset="docs/screenshots/00-hero.dark.png">
  <img src="docs/screenshots/00-hero.light.png" width="840"
       alt="Resume Vault — LaTeX editor with live PDF preview">
</picture>
```

- hero 用 F3 静帧构图(编辑器 + PDF 落纸,产品最有说服力的画面),
  深浅各截一张;**仅 hero 做双主题**(其余 ×2 工作量不值),Features
  截图统一深色(品牌主场)。
- 每张图必须有描述性 `alt`(可访问性 + SEO)。

### 4.4 拼接图(F8)

深浅两张同视图截图横向拼接,中间 2px 透明缝,导出单 PNG;用
ImageMagick:`convert a.png b.png +append 80-themes.png` 或设计工具。

### 4.5 动图(F3)

- 录制:QuickTime/CleanShot 录屏 → 裁剪到窗口 → `gifski` 转 GIF
  (`--fps 12 --width 800`),目标 **≤ 4MB**(GitHub 渲染流畅上限);
  超限则降为 10fps 或缩短时长。
- 内容脚本:光标定位到一行 bullet → 改 5–8 个词 → 停顿 → 黄铜进度条
  扫过 → 新页落纸。一镜到底,不剪辑。
- 同构图补一张静帧 `31-editor.png`:GIF 加载失败/省流模式的兜底,且
  hero 复用此构图。

### 4.6 压缩与体积红线

- 全部 PNG 过 `pngquant --quality 80-95`(或 ImageOptim);单张 ≤ 600KB,
  GIF ≤ 4MB,`docs/screenshots/` 总体积 ≤ 12MB。
- 截图源文件(未压缩)不入库。

## 5. 既有内容的处理

- **零删除**:Requirements、Troubleshooting、Building、Where data lives、
  GitHub sync 步骤、Attachments 机制、Bundled fonts 全部保留。
- Project layout + Development notes + Tech stack 合并为 `## Architecture`
  一节(内部小标题维持),整体后移——贡献者会翻到,用户不被它挡路。
- Quick start 里 "0. verify prerequisites" 压缩为一行 + 指向 Requirements。
- 新增简短 TOC(hero 之后、Features 之前,只列 h2)。

## 6. 验收标准

1. **30 秒测试**:不了解项目的人只看首屏(hero + F1–F3)能答出
   "这是什么、给谁用、长什么样"。
2. GitHub 实际渲染检查(深/浅两种 GitHub 主题):hero `<picture>` 正确
   切换;所有图片加载、宽度统一(800/840)、无原图超宽溢出。
3. F3 动图在 README 页内自动播放流畅,文件 ≤ 4MB。
4. 演示数据零真实个人信息(逐张人工过一遍)。
5. 所有 `<img>` 有 alt;链接(Releases、Tauri、shields)全部可点。
6. 现 README 的每个技术章节都能在新版中找到(diff 检查无内容丢失)。
7. `docs/screenshots/` 命名符合规范,总体积 ≤ 12MB。

## 7. 不做(out of scope)

- `README.zh.md` 中文版(可后续另立,结构直接复用本 spec)
- 产品官网 / GitHub Pages
- Logo / 图标设计(wordmark 暂用文字;icon 设计值得单独一份 spec)
- 视频(YouTube/asciinema)——GIF 足够,降低维护成本
- CI badge / coverage(没有对应基建,不挂空 badge)
