# Spec: 设置页 AI 区 —— 按提供商引导获取 API Key

- 日期:2026-06-13
- 前置:`spec/2026-06-10-ai-rewrite-assistant.md`(已实装,AiSection 在
  SettingsModal 内,`src/App.tsx:1487`);复用 GitHub PAT 的折叠引导样式
  `gh-help-details`(`src/App.tsx:1799` 一带)
- 目标:在 AI 助手设置区为每个需要 API Key 的提供商提供"如何获取 key"的
  内联引导——简短步骤 + 一键打开该提供商的 key 申请页。降低新用户配置门槛。
- 状态:**已实装(2026-06-13)。** `ai.ts` 的 api 类 preset 加
  `keyUrl`/`keyConsoleName`(4 个控制台 URL 实测可达,OpenAI/DeepSeek 的
  403 是 Cloudflare 拦 curl、非死链);AiSection 在 API Key 输入框正下方
  插入 `gh-help-details` 折叠引导(复用既有样式,零新增 CSS),有 keyUrl
  的显示步骤+打开按钮+粘贴提示,custom 显示通用文案、无按钮,claude-code
  分支不渲染;i18n 新增 5 个 key(参数化步骤模板,en/zh)。`npm run build`
  通过。控制台 URL 的浏览器逐一点击核对(§6.1)待真机确认。

---

## 1. 现状与缺口

AiSection 现有 `API Key / Base URL / Model` 三个输入框(`isApi` 分支,
`src/App.tsx:1561`),但用户面对空的 `sk-…` 输入框时**不知道去哪申请、
怎么申请**。GitHub PAT 区早有成熟的折叠式引导("如何获取 Token?" → 5 步 +
打开 token 页按钮),AI 区缺同款。

关键差异:GitHub 是单一提供商、固定步骤;**AI 区是多提供商**,每家的
key 申请页 URL 不同,步骤大同小异。因此引导必须**随选中的 preset 切换**。

## 2. 交互与位置

- 在 **API Key 输入框正下方**(`src/App.tsx:1571` 之后)插入一个
  `<details className="gh-help-details">` 折叠块,复用现有样式(▸ 旋转、
  凹陷底色步骤列表、link 按钮),零新增 CSS。
- summary 文案:`ai_key_help_title`("如何获取 API Key?" /
  "How do I get an API key?")。
- 仅在 `isApi === true` 时渲染:
  - `claude-code` 分支不渲染(它无 API Key,已有 CLI 状态 + 安装链接)。
  - `custom` 分支渲染**通用引导**(无固定 URL,见 §3)。
- 默认折叠(首次访问低打扰);展开后显示:
  1. 该提供商的 2–4 步申请说明;
  2. `打开 {提供商} 的 Key 页面 ↗` 链接按钮 → `openUrl(keyUrl)`
     (`@tauri-apps/plugin-opener`,与现有 GitHub `openUrl` 同路径);
  3. 一行获取后的提示("复制以 `sk-` 开头的 key 粘贴到上方")。
- 切换 provider 下拉 → 引导内容(步骤 + 链接)同步切换。

## 3. 每个提供商的引导数据

在 `AI_PRESETS` 的 api 类预设上新增字段(或并入现有 preset 定义):

```ts
keyUrl: string;        // 该提供商的 API keys 控制台页;custom 为 ""
keyConsoleName: string;// 链接按钮里显示的站点名,如 "Anthropic Console"
```

| preset | keyUrl(实装时务必逐一打开核对,控制台路径会变) | 链接名 | 备注步骤 |
|---|---|---|---|
| Claude(anthropic) | `https://console.anthropic.com/settings/keys` | Anthropic Console | 需先在 Billing 充值/绑卡才能用;key 以 `sk-ant-` 开头 |
| ChatGPT(openai) | `https://platform.openai.com/api-keys` | OpenAI Platform | 需账户有余额;key 以 `sk-` 开头 |
| DeepSeek | `https://platform.deepseek.com/api_keys` | DeepSeek Platform | 注册即送额度;key 以 `sk-` 开头 |
| Kimi(moonshot) | `https://platform.moonshot.cn/console/api-keys` | Moonshot 开放平台 | 国内手机号注册;key 以 `sk-` 开头 |
| 自定义(custom) | `""`(无按钮) | — | 通用引导:向你的服务商/网关管理员索取 Base URL + Key |

> URL 准确性:以上为撰写时的已知控制台地址。**实装时必须逐一在浏览器打开
> 确认无 404 / 无重定向到登录后丢失路径**;任何一个不确定就降级为指向该
> 提供商文档首页,宁可少一跳也不给死链。

## 4. 步骤文案(i18n 策略:通用模板 + 提供商名插值)

为避免 5×N 条翻译爆炸,步骤用**一条参数化通用模板**,提供商名作参数:

`ai_key_help_steps(providerName: string): string[]` 返回(en 示例):

1. `Sign in to {providerName} (create an account if needed).`
2. `Open the API keys page and create a new key.`
3. `Copy the key and paste it into the API Key field above.`
4. `Make sure your account has credit / billing enabled, or requests will fail.`

中文同构。`custom` 用单独一条非参数化文案
`ai_key_help_custom`("自定义端点:请向你的服务商或内网网关管理员索取
Base URL、API Key 与可用的 model 名称。")。

提供商特定备注(如 Anthropic 的"key 以 `sk-ant-` 开头")可作为模板第 5
步的可选补充,或并入 placeholder——本 spec 不强制逐家定制,保持低翻译量;
若实装时认为有必要,允许给 anthropic / openai 各加一条 provider 备注 key。

新增 i18n key(en/zh):`ai_key_help_title` / `ai_key_help_steps`(fn)/
`ai_key_help_open`(fn,参数 = 链接名,如 "Open {name} ↗")/
`ai_key_help_custom` / `ai_key_help_paste_hint`。

## 5. 边界

- 切到 `claude-code` 再切回某 api preset:引导随之出现/消失,无残留。
- `keyUrl` 为空(custom)时:不渲染"打开页面"按钮,仅显示通用文案。
- 打开链接失败(无浏览器/openUrl 报错):`.catch(console.error)`,与现有
  GitHub 链接同等降级,不阻塞设置。
- 折叠态不影响"测试连接"按钮与隐私提示的现有布局(引导块插在 API Key 与
  Base URL 之间,或整体置于三字段之下——取**API Key 字段正下方**,贴近
  它要解决的那个输入框)。
- 可访问性:summary 可键盘聚焦/展开(`<details>` 原生);链接按钮有
  `:focus-visible` 环(全局已有)。

## 6. 验收标准

1. 选 Claude / ChatGPT / DeepSeek / Kimi,各自展开引导显示对应步骤与
   `打开 {对应控制台} ↗` 按钮;点击在系统默认浏览器打开**正确且可达**的
   key 申请页(逐一人工点击核对,无 404)。
2. 选"自定义":显示通用文案,无打开按钮。
3. 选"Claude Code(本地)":不显示本引导(仍显示既有 CLI 状态行)。
4. 切换 provider 时引导内容即时切换,无残留旧链接。
5. 中英文 locale 下文案完整、不溢出 modal 宽度。
6. 复用 `gh-help-details` 样式,无新增 CSS;`npm run build` 通过。

## 7. 不做(out of scope)

- 内置 OAuth / 一键登录各家平台(只做"打开申请页 + 步骤说明")
- 每家提供商的可用 model 列表自动拉取(model 仍为可编辑文本框)
- key 余额/额度查询
- 把引导做成多步 stepper 组件(折叠式静态步骤已足够,与 GitHub 区一致)
