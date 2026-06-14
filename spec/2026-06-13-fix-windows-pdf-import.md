# Fix Spec: Windows 上导入 PDF「没有反应」

- 日期:2026-06-13
- 类型:Bug fix(跨平台路径)
- 影响面:Windows 用户从对话框导入 PDF 新建版本
- 前置:`spec/2026-06-12-windows-support.md`(本条是其遗漏的同类问题)
- 状态:**已实装(2026-06-13)。** `vault.ts` 用跨平台 `basename` 取文件名
  (主修复);`handleAddVersion` PDF 分支加 try/catch + 可见错误提示;
  新增 `import_pdf_failed`(en/zh)。`npm run build` 通过。3.3(basename
  全局抽取)按 spec 不做。Windows 真机验收待有环境时执行。

---

## 1. 症状

Windows 用户在分类页点「导入 PDF」,选好文件后**没有任何反应**:不报错、
不创建版本卡、不进编辑器。macOS 上同样操作正常。

## 2. 根因 —— `vault.ts` 的 basename 只认 `/`

`src/vault.ts:34`(`importPdfFromDialog`):

```ts
const fname = picked.split("/").pop() || "resume.pdf";
```

`picked` 是对话框返回的**绝对路径**。Windows 上是反斜杠分隔
(`C:\Users\张三\resume.pdf`),不含 `/`,于是:

- `split("/")` 不拆分,`.pop()` 拿到的是**整条路径**;
- `fname = "C:\Users\张三\resume.pdf"`;
- 拼出的存储路径(`vault.ts:35`)变成
  `pdfs/{randomId}_C:\Users\张三\resume.pdf`——**含盘符冒号与反斜杠的非法相对路径**;
- `writeFile(stored, bytes, { baseDir: AppData })`(`vault.ts:37`)**抛错**。

调用链 `handleAddVersion`(`src/App.tsx:377`)对 `importPdfFromDialog()` 的
`await` **没有 try/catch**,异常变成未处理的 promise rejection → 静默吞掉 →
"没有反应"。

> 读取原文件这一步(`readFile(picked)`,绝对路径)在 Windows 上是好的;
> **只有 basename 拆错导致写入目标非法**,所以表现为"选完文件就没下文"。

**对照**:`AttachmentsModal.tsx:35`、`AssetsPanel.tsx:34`、`assetScan.ts:22`
都用了跨平台写法 `Math.max(lastIndexOf("/"), lastIndexOf("\\"))`,唯独
`vault.ts` 这处是 `/`-only 的漏网之鱼(2026-06-12 Windows 支持时未覆盖前端
路径处理)。

## 3. 修复方案

### 3.1 主修复:basename 跨平台

`vault.ts:34` 改为同时按 `/` 和 `\` 取尾段:

```ts
const fname = basename(picked) || "resume.pdf";
```

新增本地小工具(或复用现有同款实现):

```ts
function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}
```

修后 `fname = "resume.pdf"`,存储路径回到干净的
`pdfs/{randomId}_resume.pdf`,`writeFile` 正常,版本卡创建、进编辑器、
缩略图照常。

> 说明:存储路径内部用 `/` 拼接没问题——Tauri 的 fs 插件在 Windows 上
> 接受 `/` 作为分隔符。问题只在于**从用户路径里抽文件名**这一步。

### 3.2 防御修复:导入失败不再静默

`handleAddVersion` 的 PDF 分支包一层 try/catch(或在 `importPdfFromDialog`
内对 `writeFile` 失败给出可见错误):导入异常时弹一个 `dlg.confirm`/提示
(复用既有 i18n 风格),而不是无声失败。即便 3.1 已修主因,这条能避免
未来任何同类写入失败再次表现为"没反应"。

- 文案走 i18n(英/中各一),例如 `import_pdf_failed`。
- 失败时若已部分写入,调 `removeVaultFile(stored)` 清理(若拿得到路径)。

### 3.3 顺带(可选,不强制)

把重复了四处的 `basename` 抽到 `src/pathUtil.ts` 统一导出,`vault.ts` /
`AttachmentsModal` / `AssetsPanel` / `assetScan` 共用,杜绝再漏。属小重构,
本 spec 不强制,可另立。

## 4. 边界与回归

- **macOS 行为不变**:`/` 分隔下 `basename` 结果与原 `split("/").pop()`
  完全一致(`lastIndexOf("/")` 取尾段),既有导入流程零回归。
- **Unicode 用户名**(`C:\Users\张三\…`):basename 只做字符串截取,不经
  shell,正常。
- **文件名本身含空格/中文**:截取后原样保留,`writeFile` 接受,正常。
- **同名多次导入**:`randomId()` 前缀保证唯一,既有逻辑不变。

## 5. 验收标准

1. **Windows 主场景**:分类页 →「导入 PDF」→ 选文件 → 填名 → **创建出 PDF
   版本卡并进入查看器**,缩略图正常;文件落在
   `%APPDATA%\com.zheruixie.resumevault\pdfs\{id}_<原名>.pdf`。
2. **Windows 中文路径**:从 `C:\Users\张三\桌面\简历.pdf` 导入成功。
3. **失败可见**(3.2):人为制造写入失败(如只读目录)时,UI 给出明确
   提示,而非无声。
4. **macOS 回归**:导入 PDF 行为与改动前逐字一致。
5. `npm run build` 通过。

## 6. 实装清单

| 文件 | 改动 |
|---|---|
| `src/vault.ts` | `importPdfFromDialog` 用跨平台 `basename` 取文件名;新增 `basename` 小工具 |
| `src/App.tsx` | `handleAddVersion` PDF 分支加 try/catch + 失败提示(3.2) |
| `src/i18n.ts` | 新增 `import_pdf_failed`(en/zh)(3.2) |

预计 ~25 行,无新依赖,无 IPC / DB 变更。

## 7. 不做(out of scope)

- `basename` 全局抽取重构(3.3,另立)
- 导入多选 PDF / 拖拽导入(与本 bug 无关)
- PDF 缩略图渲染链路(那条在 macOS/Windows 都走 pdfjs legacy,已 OK)
