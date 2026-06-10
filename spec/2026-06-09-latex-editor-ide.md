# Spec: LaTeX 编辑器 IDE 化（行号、搜索、剪切整行）

- 日期：2026-06-09
- 作者：Claude (Planning)
- 目标：把当前 `<textarea>` 替换成 IDE 级编辑器，至少要有**行号**、**搜索/替换**、**剪切整行**、**LaTeX 语法高亮**，并完整保留现有的 dirty / 保存 / checkpoint / asset 自动关联 / GitHub 自动同步流程。

---

## 1. 背景

当前 `src/App.tsx::LatexEditor` 的源码区是裸 `<textarea className="code">`：

- ❌ 没有行号 —— 排查 tectonic 报错指向「main.tex:367」时只能靠手数行
- ❌ 没有搜索 —— 浏览器原生 Cmd+F 在 textarea 内不工作
- ❌ 没有 Cmd+Shift+K 剪切整行
- ❌ 无语法高亮，`\begin{itemize}` 和正文字符没区分
- ❌ 无括号匹配、活动行高亮、缩进辅助
- ✅ 优点：~0 bundle，已经稳定接入 `code` state、`dirty`、`refreshAssets(code)` 防抖、checkpoint 流程

约束：

- **不能破坏** asset 自动关联（依赖 `code` 字符串变化触发 `refreshAssets`）
- **不能破坏** dirty 标记 / Save / Save Checkpoint / Export 流程
- **不能破坏** PdfPreview 的依赖（`<LatexPreview source={code} assets={...}/>`）
- 现有 dark mode 适配要继续工作
- WKWebView 兼容（之前 `window.prompt` 不可用的教训）

---

## 2. 设计原则

- **最小入侵**：只替换 `<textarea>` 元素，外层 `LatexEditor` 的 state / handler 不动
- **受控**：source of truth 仍是 React `code` state，编辑器把变化回写到 state
- **bundle 可控**：tree-shake 友好，按需引入扩展（不打全套 codemirror-basic-setup 大礼包）
- **键位贴近 macOS**：Cmd+F 搜索、Cmd+Shift+K 剪切行、Cmd+/ 注释（LaTeX 是 `%`）、Cmd+D 选下一个同名 token、Tab/Shift+Tab 缩进
- **暗色模式**自动跟随系统

---

## 3. 技术方案

### 3.1 选型

| 候选 | Bundle | LaTeX 高亮 | Find/Replace | 学习成本 | 选择 |
| --- | --- | --- | --- | --- | --- |
| **CodeMirror 6** | ~150 KB gzip | ✅ `@codemirror/legacy-modes/mode/stex` | ✅ `@codemirror/search` | 中 | ✅ |
| Monaco | ~2 MB | ✅ | ✅ | 高 | ❌ 过重 |
| 自写 | <10 KB | 自己实现 | 自己实现 | 极高 | ❌ |
| Ace | ~250 KB | ✅ | ✅ | 中 | ❌ React 集成生态差 |

走 CodeMirror 6（"CM6"），它是 React 生态里最现代的方案，按需组合，社区活跃。

### 3.2 依赖

```
npm i codemirror @codemirror/state @codemirror/view \
      @codemirror/commands @codemirror/search \
      @codemirror/language @codemirror/legacy-modes \
      @codemirror/autocomplete @uiw/react-codemirror
```

- 直接用 `@uiw/react-codemirror` 包装层（薄薄一层 React adapter，约 5 KB），省得自己写 EditorView 生命周期
- `@codemirror/legacy-modes/mode/stex` 提供 LaTeX 语法高亮
- 不打 `basic-setup`，自己挑扩展以控制大小

### 3.3 新组件 `src/CodeEditor.tsx`

```tsx
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { bracketMatching, indentOnInput, StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { autocompletion, closeBrackets } from "@codemirror/autocomplete";

export default function CodeEditor({
  value, onChange, dark,
}: { value: string; onChange: (v: string) => void; dark: boolean }) {
  return (
    <CodeMirror
      value={value}
      height="100%"
      theme={dark ? "dark" : "light"}
      extensions={[
        lineNumbers(),
        highlightActiveLine(),
        history(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        autocompletion(),
        highlightSelectionMatches(),
        StreamLanguage.define(stex),
        keymap.of([
          ...defaultKeymap,        // Cmd+Shift+K deleteLine, etc.
          ...historyKeymap,
          ...searchKeymap,         // Cmd+F search panel
          indentWithTab,
        ]),
        EditorView.lineWrapping,   // 长行自动换行（LaTeX 一行常常超长）
      ]}
      onChange={onChange}
      basicSetup={false}            // 关掉默认大礼包，全部按需上面手动控
    />
  );
}
```

关键扩展能力对照：

| 需求 | 扩展 |
| --- | --- |
| 行号 | `lineNumbers()` |
| 搜索/替换 | `searchKeymap` + 内置 search panel（Cmd+F / Cmd+Alt+F） |
| 剪切/删除整行 | `defaultKeymap` 里有 `deleteLine`（Cmd+Shift+K）|
| 语法高亮 | `StreamLanguage.define(stex)` |
| 暗色 | `theme="dark"` 直接走 oneDark |
| 撤销/重做 | `history()` + `historyKeymap`（Cmd+Z / Cmd+Shift+Z）|
| 多光标 | CM6 默认支持，Alt+click |
| 自动缩进 | `indentOnInput()` + `indentWithTab` |
| 括号匹配 + 自动配对 | `bracketMatching()` + `closeBrackets()` |
| 选中相同 token 高亮 | `highlightSelectionMatches()` |
| 长行换行 | `EditorView.lineWrapping` |

### 3.4 接入 `LatexEditor`

只动一处 —— 把 `<textarea className="code">` 替换成 `<CodeEditor>`：

```tsx
import CodeEditor from "./CodeEditor";

// 在 LatexEditor 组件内
<CodeEditor
  value={code}
  onChange={(v) => { setCode(v); setDirty(true); }}
  dark={prefersDark}     // 沿用现有 dark mode 检测
/>
```

其他都不动：
- `dirty` / Save / Export tex/PDF
- Checkpoint 流程
- `refreshAssets(code)` 在 `[code]` 变化 500ms 后跑
- `<LatexPreview source={code} assets={compileAssets}/>`

### 3.5 Dark mode 接入

CM6 的 `theme="dark"` 用 oneDark；当前 app 走 `@media (prefers-color-scheme: dark)`。两种做法：

1. **被动检测**：在 `CodeEditor` 里 `window.matchMedia('(prefers-color-scheme: dark)').matches` + listener，自动切
2. **走 LocaleProvider 模式**：建一个 ThemeContext，所有需要主题的组件订阅

走方案 1，简单，且 CM6 重渲染成本可接受。

### 3.6 CSS 调整

- `.code` 这个 class 现在是 textarea 样式（字体、padding），移除或改成 wrapper class
- 给 CM6 容器加 class `.cm-wrap`，设 `flex: 1; min-height: 0; overflow: hidden;`
- 行号 gutter 颜色微调贴近系统
- 搜索面板（`.cm-panels`）背景在暗色模式下手动覆盖一下

### 3.7 性能 / 边界

- LaTeX 简历通常 < 500 行，CM6 完全无压力
- `onChange` 每按键触发；保留现有 500ms 防抖 → asset 扫描 / preview 编译不会更频繁
- 切换 version 时 `value` prop 变 → CM6 重新初始化文档；ok
- 复制/粘贴大块 LaTeX (>1000 行) 仍然顺滑
- WKWebView 完全支持（CM6 基于标准 contenteditable + canvas-free）

---

## 4. 关键文件改动

| 文件 | 改动 |
| --- | --- |
| `package.json` | 新增 6 个 codemirror 相关依赖 |
| `src/CodeEditor.tsx` (新) | CM6 受控包装组件，~80 行 |
| `src/App.tsx` | LatexEditor 里 textarea → CodeEditor；保留所有其他逻辑 |
| `src/App.css` | 移除/调整 `.code` 样式；新增 `.cm-wrap`、暗色模式下 `.cm-*` 覆写 |
| `src/i18n.ts` | 无 |
| `src-tauri/*` | 无 |
| `spec/2026-06-09-latex-editor-ide.md` | 本文件 |

---

## 5. 实现步骤

1. **加依赖 + 新组件**
   - `npm i` 上面 6 个包
   - 写 `src/CodeEditor.tsx`
   - `npm run build` 通过

2. **接入 LatexEditor**
   - 替换 textarea 那一行
   - 检查 `dirty`、save、refreshAssets、preview 都还正常

3. **样式收尾**
   - 删 `.code` 的 textarea-specific 规则
   - 加 `.cm-wrap` 容器
   - 暗色模式 CM 面板背景对齐

4. **联调验证**（必做）
   - `npm run tauri dev`
   - 用例 A：编辑现有 LaTeX 简历，保存触发 dirty 状态变化 → Save 按钮变可点
   - 用例 B：Cmd+F 弹出搜索面板，输入 `\section`，能高亮所有匹配
   - 用例 C：光标在某行任意位置，Cmd+Shift+K → 整行删除
   - 用例 D：左侧 gutter 显示行号；tectonic 报错 `main.tex:367` 时直接 Cmd+G 跳转
   - 用例 E：行号宽度自适应（>999 行不挤）
   - 用例 F：暗色模式下编辑器背景、行号、搜索面板都正常
   - 用例 G：粘贴一份 600 行简历，无卡顿
   - 用例 H：切换 version → 编辑器内容立即更新，dirty 重置为 false

5. **文档**
   - README 加一段「LaTeX editor shortcuts」表格

---

## 6. 风险与权衡

| 风险 | 应对 |
| --- | --- |
| Bundle 体积 +150 KB | 已经接受 (~700 KB → ~850 KB)；如要省，去 `@codemirror/autocomplete` 砍 ~30 KB |
| @uiw/react-codemirror 把 CM 重新初始化时丢光标位置 | 它内部用 `controlled` 模式，已处理；如仍有问题，自己用 `useRef` 持有 `EditorView` |
| CM6 的 search panel 样式跟 iOS 风格不一致 | 接受 v1；后续可写 `EditorView.theme({...})` 覆盖 |
| stex 语法高亮覆盖率有限（不认识 `\resumeItem` 等自定义命令）| 接受，高亮的是 `\` 开头的命令通用规则，自定义命令也会被高亮 |
| Tab 在 LaTeX 里既要缩进又要 \tab 字符 | `indentWithTab` 默认 indent；如果想插入 tab 字符可 Cmd+] |
| 切换 version 时光标位置丢失 | 不需要保留 —— 切到不同文件位置自然重置 |

---

## 7. 验收标准

- [ ] 左侧 gutter 显示行号，跟随 viewport 滚动
- [ ] Cmd+F 弹出搜索面板，找下一个 Cmd+G，找上一个 Cmd+Shift+G，Esc 关闭
- [ ] Cmd+Option+F 弹出搜索 + 替换面板
- [ ] Cmd+Shift+K 删除/剪切整行
- [ ] LaTeX 关键字（`\section`、`\begin{}`、`\textbf{}` 等）有高亮颜色
- [ ] 暗色模式下编辑器、gutter、搜索面板都不是白底
- [ ] 编辑触发 `dirty` 状态，Save 按钮可用
- [ ] 切换到别的版本后编辑器内容更新，dirty 重置
- [ ] 右侧 PDF 预览正常重新编译（asset 注入逻辑无回归）
- [ ] checkpoint / GitHub 自动同步无回归
- [ ] `npm run tauri build` 出包正常
