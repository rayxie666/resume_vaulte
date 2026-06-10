# Spec: GitHub Connect 面板的 Token 获取引导

- 日期：2026-06-09
- 状态：未实现（Phase 1）
- 目标：让首次使用 GitHub Sync 的用户在面板内就能看懂"怎么拿到 token"，不用退出 App 去搜文档。

---

## 1. 背景

当前 `src/App.tsx` 的 GitHub 设置面板（约 1230–1310 行）已经有：

- Repository URL / PAT / Branch 三个输入框。
- Connect / Sync now / Disconnect 按钮。
- 一行帮助文案 `t("github_help")`：
  - en: "Create a fine-grained PAT with read/write Contents access on the repo. Token is stored locally."
  - zh: "创建 fine-grained PAT 并授予该仓库的 Contents 读写权限。Token 只保存在本地。"

问题：

- 新用户不知道在 GitHub 哪里点 → "fine-grained PAT" 是 jargon。
- "Contents 读写"听起来像菜单项，但 GitHub 实际叫 "Repository permissions → Contents: Read and write"。
- 没有"打开 GitHub Token 设置页"的快捷入口。
- 不知道 token 保存在哪、是否上云。

## 2. 设计

在 PAT 输入框下方加一个**默认收起**的折叠帮助区，不打扰熟手，新手点开就能看完整步骤。

### 2.1 UI 结构

```
[Repository URL ____________________]
[Personal Access Token _____________]
▸ How do I get a token?        ← 默认收起，点击展开
  ├─ 1. Open GitHub → Settings → Developer settings → ...
  ├─ 2. Click "Generate new token". ...
  ├─ 3. Under Repository access, pick "Only select repositories" ...
  ├─ 4. Under Repository permissions, set Contents to Read and write ...
  ├─ 5. Generate, copy (starts with github_pat_...), paste above.
  ├─ [ Open GitHub token page ↗ ]   ← 调 plugin-opener 跳浏览器
  └─ Required scope: Contents — Read and write. Saved only on this device.
[Branch ____________________________]
```

### 2.2 i18n keys

新增到 `src/i18n.ts` 的 `DictShape` 和两个 locale：

| key | 类型 | en | zh |
| --- | --- | --- | --- |
| `github_help_title` | `string` | "How do I get a token?" | "如何获取 Token？" |
| `github_help_steps` | `() => string[]` | 5 步数组（见下） | 5 步数组（见下） |
| `github_open_token_page` | `string` | "Open GitHub token page" | "打开 GitHub Token 设置页" |
| `github_token_scope_hint` | `string` | "Required scope: Contents — Read and write. The token is saved only on this device." | "需要权限：Contents — Read and write。Token 仅保存在本机。" |

`github_help_steps` 是函数而不是字符串，理由：返回 `string[]` 让前端 `<ol><li>` 渲染时不用 split 换行，对未来的本地化和样式都更稳。

英文 5 步：

1. Open GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens.
2. Click "Generate new token". Give it a name (e.g. "Resume Vault") and an expiration.
3. Under Repository access, pick "Only select repositories" and choose the repo above.
4. Under Repository permissions, set Contents to Read and write. Leave the rest as is.
5. Generate the token, copy it (starts with `github_pat_...`), and paste it above.

中文 5 步：

1. 打开 GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens。
2. 点击 "Generate new token"，填名字（如 "Resume Vault"）和到期时间。
3. 在 Repository access 选 "Only select repositories"，勾选上面填的仓库。
4. 在 Repository permissions 把 Contents 设为 Read and write，其它保持默认。
5. 生成 Token 并复制（以 `github_pat_...` 开头），粘贴到上方的 PAT 输入框。

### 2.3 跳转链接

按钮调 `openUrl` 跳：

```
https://github.com/settings/personal-access-tokens/new
```

这是 GitHub 的 fine-grained PAT 直接创建页（已经预选了 fine-grained，省去用户从 classic 切换的步骤）。

实现：`import { openUrl } from "@tauri-apps/plugin-opener"`。`opener:default` 权限在 `src-tauri/capabilities/default.json` 已 grant，无需改 capability。

### 2.4 React 改动

在 `App.tsx` 的 `GitHubPanel` 组件（约 1244 行）的 PAT `<label>` 之后、Branch `<label>` 之前插入：

```tsx
<details className="gh-help-details">
  <summary>{t("github_help_title")}</summary>
  <ol className="gh-help-steps">
    {t("github_help_steps")().map((s, i) => (
      <li key={i}>{s}</li>
    ))}
  </ol>
  <div className="gh-help-actions">
    <button
      type="button"
      className="link"
      onClick={() =>
        openUrl("https://github.com/settings/personal-access-tokens/new").catch(
          console.error,
        )
      }
    >
      {t("github_open_token_page")} ↗
    </button>
  </div>
  <p className="gh-help-scope">{t("github_token_scope_hint")}</p>
</details>
```

import 加 `import { openUrl } from "@tauri-apps/plugin-opener"`。

### 2.5 CSS

`src/App.css` 加：

- `.gh-help-details` 容器（margin、字号 12px）。
- `summary` 自定义 marker（▸ 旋转动画，蓝色，去掉浏览器默认箭头）。
- `.gh-help-steps` `<ol>` 缩进 + 行高 1.55。
- `.gh-help-actions button.link` 蓝色下划线 link 样式（无背景边框）。
- `.gh-help-scope` 浅灰提示。
- dark mode（`@media (prefers-color-scheme: dark)`）下颜色对调。

具体值跟现有 `.gh-help` 一致即可。

---

## 3. 关键文件改动清单

| 文件 | 改动 |
| --- | --- |
| `src/i18n.ts` | DictShape 加 4 key；en/zh 各加 4 条 |
| `src/App.tsx` | 加 `openUrl` import；`GitHubPanel` 里 PAT label 后插入 `<details>` 块 |
| `src/App.css` | 加 `.gh-help-details*` 6 个选择器 + dark mode 对应项 |
| `src-tauri/capabilities/default.json` | 不动（`opener:default` 已存在） |
| `spec/2026-06-09-github-token-onboarding.md` | 本文件 |

---

## 4. 实现步骤

1. 改 i18n.ts，加 4 个 key + 两组翻译。
2. 改 App.tsx，加 import + JSX 块。
3. 改 App.css，加样式 + dark mode。
4. `npm run tauri dev`，验证：
   - 折叠默认收起。
   - 点开后 5 步可见。
   - 中英文切换文案正确。
   - 点 "Open GitHub token page" 用外部浏览器打开 fine-grained PAT 创建页。
   - dark mode 颜色对比够。
5. 提交。

---

## 5. 风险

| 风险 | 应对 |
| --- | --- |
| GitHub 改 fine-grained PAT 创建页 URL | 当前 `personal-access-tokens/new` 至少自 2023 年起未变；改了再说 |
| 用户用 classic PAT（不在 fine-grained 页面） | 文档里只引导 fine-grained；classic 路径不显式禁止，PAT 输入框照接 |
| 长 token name + 步骤文字超出面板 | `<ol>` 自适应换行，CSS 不用固定宽度 |
| zh 翻译里掺英文（"Repository access"）显得不一致 | 故意保留——GitHub 自己的菜单项没有中文，强翻译反而让用户找不到 |

---

## 6. 验收

- [ ] PAT 输入框下方有可展开的 "How do I get a token?" 折叠区。
- [ ] 展开后能看到 5 步说明 + 跳转按钮 + 权限提示。
- [ ] 按钮跳到 `https://github.com/settings/personal-access-tokens/new`，外部浏览器打开。
- [ ] 中英文切换文案对应。
- [ ] dark mode 视觉对比正常。
- [ ] `tsc && vite build` 通过。
