# Spec: 全局 UI 重设计 ——「深夜排印工坊」设计系统

- 日期：2026-06-10
- 前置：无(纯前端样式/交互层,不触碰 db / git / compile 链路)
- 目标:跳出 iOS 模板审美(#007aff / 毛玻璃 / 灰上灰),建立有辨识度的品牌化界面;重点打磨编辑器 + PDF 预览工作区。
- 状态:**已实装,未提交**(`src/App.css` 重写、`src/App.tsx` / `src/CodeEditor.tsx` / `index.html` 修改)。本文是该实装的规格记录与验收依据;`PRODUCT.md` / `DESIGN.md` 为配套的长期设计文档。

---

## 1. 动机

旧 UI 的问题(按影响排序):

1. **编译失败即丢预览**:`LatexPreview` 出错时整个预览区被红色错误面板替换,用户每打错一个字符就失去对页面的视觉锚点。
2. **无品牌辨识度**:iOS 克隆(#007aff、frosted navbar、SF 灰阶),与"LaTeX 排版工具"的产品气质无关。
3. **层级靠灰度堆**:#8e8e93 / #6e6e73 / #c0c0c5 多档灰承担全部信息层级,深色模式下对比度踩线。
4. **分栏固定 50/50**:编辑长行 LaTeX 或核对 PDF 细节时无法调整。
5. **硬编码色值 1670 行**:无 token 系统,双主题靠整块复制维护。

## 2. 设计决策

### 2.1 品牌:「深夜排印工坊」

一句话场景:深夜台灯下的活字印刷工作室——黄铜活字、墨黑石板、灯桌上发光的纸页。

- **register**: product(工具优先,设计服务于任务,见 `PRODUCT.md`)
- **色彩策略**: Restrained——黄铜是唯一品牌声音,语义色只在激活态出现
- **反面清单**: SaaS 奶油色、渐变文字、side-stripe 色条、terminal 霓虹黑、Apple 默认蓝

### 2.2 色板(OKLCH,深色优先)

全部色值收敛为语义 token,定义于 `src/App.css` 的 `:root`(浅色)与 `@media (prefers-color-scheme: dark)` 块(深色):

| token | 深色 | 浅色 | 用途 |
|---|---|---|---|
| `--bg` | `oklch(0.15 0.005 80)` | `oklch(0.975 0.004 85)` | 应用底色 |
| `--surface` / `--surface-2` | `0.19` / `0.23` | `1.0` / `0.955` | 卡片、面板 / 凹陷工具条 |
| `--ink` / `--ink-2` / `--ink-3` | `0.92` / `0.70` / `0.58` | `0.235` / `0.45` / `0.55` | 正文 ≥7:1 / 次级 ≥4.5:1 / 弱化(仅图标禁用态) |
| `--brand` + `--brand-ink` | 黄铜 `0.78 0.125 82` + 近黑字 | 青铜 `0.55 0.115 78` + 白字 | 主按钮填充 |
| `--brand-text` | `0.80 0.115 83` | `0.50 0.11 78` | 底色上的品牌色文字(链接、导航) |
| `--brand-soft` / `--brand-edge` | 黄铜淡底 / 焦点环、分栏把手 | 同 | |
| `--accent-text` / `--accent-soft` | 墨蓝 `0.72 0.09 245` | `0.48 0.10 250` | diff "new"、选择匹配、信息态 |
| `--danger*` / `--ok*` | 填充 / 文字 / 淡底 三件套 | 同 | 错误 / 成功 |
| `--stage` | `0.11` | `0.27`(**两主题均为深色**) | PDF 灯桌 |
| `--code-*` | 黄铜命令 / 墨蓝字面量 / 斜体灰注释 | 同构 | CodeMirror 语法 |

约束(后续改色必须保持):

- `--ink` vs `--bg` ≥ 7:1;`--ink-2` vs `--bg` ≥ 4.5:1(双主题)
- 品牌填充上的文字按 Helmholtz-Kohlrausch 规则取向:浅色主题青铜(L 0.55)配白字,深色主题黄铜(L 0.78,淡填充)配近黑字
- 禁止在组件样式里出现裸色值;新增颜色一律先进 token

### 2.3 排版

- `--font-serif`(New York / ui-serif):**仅限标题**——导航标题、modal h3、`.preview-title`、`.gh-title`、占位首字母。禁止用于按钮 / 标签 / 数据。
- `--font-sans`(SF Pro 栈):其余全部;根字号 14px,UI 运行在 11–13px。
- `--font-mono`(SF Mono 栈):代码、diff、文件名、日期、tag;计数与日期开 `font-variant-numeric: tabular-nums`。

### 2.4 形状 / 深度 / 动效

- 圆角刻度 `--r-xs 6 / sm 8 / md 10 / lg 14 / xl 18`;卡片 lg、按钮 sm–md、modal xl、胶囊 999。
- 分隔靠 1px 边框;阴影(`--shadow-sm/md/lg`)只用于 hover 抬升、浮动条、modal。**不再使用 backdrop-filter 毛玻璃**。
- z-index 语义刻度:`--z-nav 10 < --z-bar 30 < --z-backdrop 40 < --z-modal 50 < --z-toast 60`,禁止裸数字。
- 动效:`--t-fast 140ms`(hover)/ `--t-med 220ms`(入场),曲线 `--ease-out`;动效只表达状态(modal 升起、抽屉升起、sync pop、编译进度)。`prefers-reduced-motion` 下全部塌缩为瞬时,进度条退化为静态色带。
- 全局 `:focus-visible` 焦点环 = 2px `--brand-edge`。

## 3. 核心交互规格(PDF 预览区)

### 3.1 编译状态机(`LatexPreview`)

状态:`url`(最近一次成功 PDF 的 blob URL)、`error`(最近一次失败 log)、`busy`、`logOpen`。

| 场景 | 表现 |
|---|---|
| 编译中 | header 显示"渲染中…" + 2px 黄铜不定进度条(`.preview-progress`,贴 header 底边) |
| 成功 | iframe 展示新 PDF;`error` 清空 |
| 失败 + 已有旧 PDF | **旧 PDF 保留在台上**;`.compile-error.overlay` 抽屉从舞台底部升起(max-height 45%),含标题行 + ▾/▸ 折叠钮 + 只读 mono log;header 出现红色 "Compile error" 胶囊 + "Copy log" |
| 失败 + 无 PDF | `.compile-error.full` 占满舞台 |

不变式:`url` 只在编译成功时被替换(旧 URL revoke);错误从不清空 `url`。

### 3.2 可拖拽分栏(`LatexEditor`)

- 分栏把手 6px,中心 1px 线;hover / 拖拽时加粗为 3px 黄铜色,光标 `col-resize`。
- 拖拽范围 clamp 到 [0.25, 0.75];拖拽期间容器加 `.dragging`(iframe `pointer-events: none`,防止 PDF iframe 吃掉 pointermove)。
- 双击复位 0.5;松手时写入 `localStorage["rv-split"]`,加载时读取(非法值回退 0.5)。

### 3.3 CodeMirror 品牌主题(`CodeEditor.tsx`)

- `theme="none"` + 自定义 `HighlightStyle`,颜色全部经 `var(--code-*)` 间接引用 → 主题切换零 JS 参与。
- `EditorView.theme({}, { dark })` 仅用于告知 CM 控件(自动补全弹层)当前明暗;`dark` 变化时重建 extensions。
- 选区 / 活动行 / 括号匹配 / 面板样式由 `App.css` 的 `.code-pane` 块接管。

## 4. 其余界面改动清单

- **导航栏**:实底 `--surface` + 1px hairline,衬线标题,品牌色文字按钮。
- **卡片**(分类 / 版本 / 资产):`--surface` + 1px 边框 + `--r-lg`,hover 抬升 2px;Add 卡为虚线框,hover 转黄铜。分类渐变图标保留(用户数据,非品牌 chrome)。
- **选择模式**:选中 = 2px 黄铜环(`box-shadow`),勾选盘黄铜填充;底部浮条改为带边框的 surface 胶囊,删除键红色填充。
- **历史 / diff**:活动 checkpoint 行 = `--brand-soft` 填充(**废除 border-left 色条**);diff 增删行用 `--ok-soft` / `--danger-soft`;"new" 标签用墨蓝。
- **Modal / 表单**:`--r-xl`,标题左对齐衬线;表单标签去掉 uppercase;focus 态 = 黄铜边框 + 3px `--brand-soft` 光环。
- **GitHub PAT 区**:状态行升级为 `--surface-2` 圆角条 + 发光状态点;步骤列表放进凹陷底色块,序号 marker 黄铜色。
- **Sync 徽标**:从全饱和填充改为"安静直到出事"——surface 底 + 语义色边框/文字。
- **index.html**:标题改 "Resume Vault";内联 `<style>` 按 media query 预置 html 底色,消除启动闪白。

## 5. 验收标准

1. `npm run build`(tsc + vite)通过。✅(已验证)
2. 双主题截图:首页、编辑器屏(正常 / 编译错误)均与 token 规格一致。✅(已验证,无头 Chrome + 像素采样)
3. `grep -E "#[0-9a-fA-F]{3,6}" src/App.css` 仅允许出现在注释或 `#fff`-on-gradient 等明确豁免处(当前:渐变图标白字)。
4. 实机(`npm run tauri dev`)回归:
   - 故意写错 LaTeX → 旧 PDF 保留 + 错误抽屉升起;修复后抽屉消失
   - 拖拽分栏、双击复位、重启后宽度记忆
   - 系统深浅色切换,编辑器语法色跟随
   - 中 / 英文 locale 下所有按钮、标签不溢出
5. 可访问性抽查:正文与次级文字对比度(双主题)、Tab 键全流程焦点环可见、系统"减弱动态效果"开启后无持续动画。

## 6. 遗留 / 后续(只出 spec,不实装)

- PAT 引导五步流程可做成显式 stepper(现仍为 `<details>` 折叠)
- 空状态(首页无分类 / 无 checkpoint)只有文字,缺引导
- 缩略图加载无骨架屏(`thumb-pending` 仅降透明度)
- 错误 log 可解析首个 `! ` 行做结构化摘要,点击跳转源码行
