# Spec: 编辑页 AI 改写助手(选中即改 + 编辑器内 diff,多 LLM 提供商 + 本地 Claude Code)

- 日期:2026-06-10
- 前置:无硬依赖;复用设计 token 体系
- 目标:选中一段文字 → 选区旁弹出"AI 改写"浮动按钮 → 一键开始改写 →
  **在编辑器内就地显示新旧差异** → 接受 / 拒绝。AI 人设固定为资深简历与
  职场经验专家。提供商在设置页配置:Kimi、DeepSeek、ChatGPT、Claude(API)
  及任意 OpenAI 兼容端点;并支持调用本机已安装的 Claude Code CLI(零 API key)。
- 状态:**已实装(2026-06-10)。**

---

## 1. 用例

| # | 场景 | 期望 |
|---|---|---|
| R1 | 选中一段经历描述 | 选区上方浮出 `✦ AI 改写` 按钮;点击即开始,无需再选动作 |
| R2 | 改写完成 | 编辑器内就地显示 diff(旧文标红、新文标绿),浮动 `✓ 接受 / ✕ 拒绝`;接受后一次 Cmd+Z 可整体还原 |
| R3 | 分类配置了 JD | 改写自动携带 `category.jd_text` 作为目标岗位上下文,向 JD 靠拢 |
| R4 | 用户已装 Claude Code,不想配 API key | 设置页选"Claude Code(本地)",检测到 CLI 即可用,走本地账号 |
| R5 | 公司内网自建 OpenAI 兼容网关 | 选"自定义",填 Base URL + key + model 即可 |

## 2. 架构总览

```
CodeMirror 选区 → AiButtonTooltip(浮动按钮)
  └─ 点击 → src/ai.ts: aiRewrite(selection, jdText?)
       ├─ provider = loadAiConfig()
       ├─ kind = "api"         → invoke("ai_complete", …)    # Rust reqwest 转发
       └─ kind = "claude-code" → invoke("claude_code_run", …) # Rust 子进程
  └─ 完成 → InlineDiff 装饰(编辑器内,选区高亮 + diff widget + 接受/拒绝)
```

**HTTP 必须走 Rust 转发**(新命令 `ai_complete`,reqwest):WKWebView 内
直接 fetch 第三方 API 会被 CORS 拦截(OpenAI/DeepSeek/Kimi 均不放行浏览器
跨域)。前端不发任何外网请求,key 不进 webview 网络层。

## 3. 编辑器交互(核心,CodeMirror 6 扩展 `src/aiInline.ts`)

### 3.1 浮动按钮(AiButtonTooltip)

- 实现:CM6 `showTooltip`(`StateField<Tooltip|null>`),锚在选区头部上方,
  `above: true`;CM 自带翻转避让,不会被编辑器边缘裁掉。
- 出现条件:选区非空 && 选区长度 ≤ 12,000 字符 && 无进行中的改写会话。
  选区折叠或文档变更 → 立即消失。
- 外观:胶囊按钮,`--brand` 填充 + `--brand-ink` 文字,文案 `✦ {ai_button}`
  ("AI 改写" / "Rewrite with AI"),进入动画 `--t-fast` 渐入(reduced-motion
  下瞬时)。
- 键盘等价:**Cmd+J** 对当前选区触发同一流程(按钮只是可见入口)。
- 未配置提供商时点击 → tooltip 原位变为一行提示 + "打开设置"链接按钮。

### 3.2 进行中状态

- 点击后按钮变为 `⋯ {ai_generating}`("改写中…"),不可重复点击;选区加
  `--brand-soft` 底色高亮(mark decoration)标记"正在被改写的范围"。
- 编辑器**保持可编辑**,但若用户改动了选区范围内的文本 → 立即取消本次
  会话(见 §3.5 失效规则);选区外的编辑不受影响。
- 同一时刻全局只允许一个改写会话。
- Esc 或点击按钮上的 ✕ → 取消:API 请求结果到达后直接丢弃;CLI 子进程 kill。

### 3.3 就地 diff 预览(InlineDiff)

设计原则:**预览阶段不修改文档**——结果以装饰呈现,接受才写入,因此
撤销栈干净、随时可拒绝。

- 旧文:原选区加删除线 + `--danger-soft` 背景(mark decoration)。
- 新文:选区末尾插入 **block widget**,渲染 AI 建议文本,`--ok-soft` 背景、
  等宽字体、保留换行;块底部一条操作行:
  `✓ {ai_apply}(Tab) ✕ {ai_reject}(Esc) ↻ {ai_retry}`。
- 词级高亮:widget 内对新文与旧文跑 `diffWords`(已有 `diff` 依赖),
  变化词加 `--ok-text` 加粗;旧文 mark 不做词级(避免装饰爆炸),整段示意
  即可。
- 快捷键:会话存在期间 `Tab` = 接受,`Esc` = 拒绝(高优先 keymap,仅在
  会话激活时生效,不干扰缩进/补全)。
- **接受**:单个 CodeMirror 事务 `dispatch({changes: {from, to, insert: 新文}})`
  替换原选区,同时清除所有装饰;一次 Cmd+Z 完整还原。应用后 `setDirty(true)`。
- **拒绝**:仅清除装饰,文档零变化。
- **换个写法(↻)**:保持旧文高亮,widget 回到加载态,携带相同输入 + 上次
  输出重新请求(提示词附加 "provide a different rewrite than the previous
  attempt")。

### 3.4 失败状态

widget 原位显示错误行(`--danger-text`):文案按 §7 错误映射 + `↻ 重试` +
`✕ 关闭`;不弹 modal,不弹系统 alert。

### 3.5 失效规则(防错位,全部静默取消并清装饰)

- 预览期间选区范围内文本被用户编辑(用 CM 的 `changes.touchesRange` 判定;
  范围外编辑时装饰位置随 `StateField` 自动 map,继续有效)。
- 切换版本 / 关闭编辑器(组件卸载即清理会话与子进程)。
- 接受前再次校验:被标记范围当前文本 === 发起时的原文,不等则按
  `ai_err_stale` 提示并拒绝应用(理论上 touchesRange 已拦截,此为兜底)。

## 4. AI 人设与提示词规格(`src/ai.ts` 常量)

system prompt(英文书写,所有提供商一致),要点:

1. **人设**:
   > You are a senior resume writer and career coach with 15+ years of
   > experience in tech hiring — you have reviewed thousands of resumes as
   > a hiring manager and recruiter, and you know exactly what makes a
   > bullet point land an interview.
2. **改写准则**(专家规则,内嵌于 system prompt):
   - 动作动词开头,杜绝 "responsible for / participated in" 式弱表述;
   - 尽量突出可量化的成果与影响(规模、百分比、时间、金额),但**严禁
     编造数字**——原文没有的数据不得新增,只能强化既有信息的表达;
   - STAR 取向:情境/动作/结果完整,删冗余、去套话;
   - 时态一致(过往经历用过去时,在职用现在时),术语准确;
   - 长度与原文相当(±20%),不擅自扩写。
3. **输出契约**:只返回替换文本本身——no preamble、no code fence、
   no explanations。
4. **LaTeX 安全**:不增删 `\command`、环境、`%` 注释结构;只改自然语言;
   特殊字符转义保持合法。
5. **语言跟随**:中文原文回中文,英文回英文。
6. user message = 选中文本;若分类有 `jd_text`,附加段落
   "Target job description (tailor the wording toward it): …"(R3 自动生效,
   无需用户操作)。

后处理防御:剥离首尾 code fence 与首尾空行;空串视为失败。

## 5. 提供商抽象与配置

### 5.1 数据模型(`src/ai.ts`)

```ts
type AiProviderKind = "anthropic" | "openai-compatible" | "claude-code";

interface AiConfig {
  kind: AiProviderKind;
  preset: "claude" | "openai" | "deepseek" | "kimi" | "custom" | "claude-code";
  baseUrl: string;   // kind=claude-code 时忽略
  apiKey: string;    // 同上
  model: string;
}
```

存储:localStorage(键 `rv.ai.*`),与现有 GitHub PAT 同精度的本地明文
存储(桌面单用户应用,沿用既有威胁模型;设置页放一行隐私提示,见 §6)。

### 5.2 预设(选中后预填 Base URL 与默认 model,均可改)

| preset | kind | Base URL | 默认 model | 认证 |
|---|---|---|---|---|
| Claude(API) | anthropic | `https://api.anthropic.com` | `claude-opus-4-8` | `x-api-key` + `anthropic-version: 2023-06-01` |
| ChatGPT | openai-compatible | `https://api.openai.com/v1` | (留空,placeholder 提示填如 `gpt-4o`) | `Authorization: Bearer` |
| DeepSeek | openai-compatible | `https://api.deepseek.com` | `deepseek-chat` | 同上 |
| Kimi | openai-compatible | `https://api.moonshot.cn/v1` | (留空,placeholder `kimi-…`/`moonshot-…`) | 同上 |
| 自定义 | openai-compatible | 用户填 | 用户填 | 同上 |
| Claude Code(本地) | claude-code | — | (留空 = CLI 默认;可填如 `claude-sonnet-4-6`) | 本机 CLI 既有登录 |

model 一律可编辑文本框:第三方模型名迭代快,不硬编码枚举,正确性由
"测试连接"按钮兜底验证。

### 5.3 请求协议(Rust 侧组装)

- **anthropic**:`POST {base}/v1/messages`,body
  `{model, max_tokens: 2048, system, messages:[{role:"user",content}]}`。
  **不发送 `temperature` 等采样参数**(Opus 4.7+ 已移除,发了直接 400);
  响应取 `content[]` 中 `type=="text"` 块拼接。
- **openai-compatible**:`POST {base}/chat/completions`,body
  `{model, messages:[{role:"system"},{role:"user"}], max_tokens: 2048}`;
  响应取 `choices[0].message.content`。同样不发采样参数。
- **claude-code**:子进程
  `claude -p --output-format json [--model <m>]`,prompt(system + user 合并)
  经 **stdin** 传入(避免超长 argv 与注入);解析输出 JSON 的 `result` 字段。

## 6. 设置页(SettingsModal 新增 "AI 助手" 区)

- 位置:GitHub 区之后,同样的 `gh-section` 分隔样式。
- 控件:
  - 提供商下拉(§5.2 六项)。
  - kind=api:`API Key`(password)、`Base URL`、`Model` 三个 `.field`。
  - kind=claude-code:只读状态行 —— 挂载时 `claude_code_check`:
    `✓ 已检测到 Claude Code vX.Y.Z` / `✗ 未检测到,请先安装`(附
    `claude.com/claude-code` 外链);可选 `Model` 字段。
  - `[测试连接]`:发最小请求(prompt "ping",max_tokens 16),成功显示
    `gh-msg ok`,失败显示 `gh-msg err` 折叠详情(复用现有样式)。
  - 隐私提示一行(`ai_privacy_hint`):"改写时所选文本(及 JD)将发送给
    所选 AI 提供商;Claude Code 本地模式同样会将文本交给其供应商处理。"

## 7. Rust 新命令(`src-tauri/src/ai.rs`)

```rust
#[tauri::command]
async fn ai_complete(
    kind: String, base_url: String, api_key: String, model: String,
    system: String, prompt: String, max_tokens: u32,
) -> Result<AiResult, String>
// AiResult { success: bool, text: String, log: String }

#[tauri::command]
async fn claude_code_check() -> Result<ClaudeCodeStatus, String>
// { found: bool, version: Option<String> }   // `claude --version`

#[tauri::command]
async fn claude_code_run(prompt: String, model: Option<String>)
    -> Result<AiResult, String>
```

- 依赖:`reqwest`(rustls,json feature)。超时 90s;HTTP 非 2xx 时把
  响应体前 1500 字节放入 `log`(**先 redact api_key**,复用 git.rs 的
  redact 思路)。
- `claude_code_run`:prompt 写 stdin;`--output-format json`;120s 超时
  后 kill 子进程;非零退出码 → `success:false` + stderr 入 log。
- PATH 问题:macOS GUI 应用继承的 PATH 不含 Homebrew;查找 `claude` 时
  依次检查 `claude`(继承 PATH)、`/opt/homebrew/bin/claude`、
  `/usr/local/bin/claude`、`~/.local/bin/claude`。
- `lib.rs` 注册三条命令。

错误映射(前端文案):

| 错误 | 文案 key |
|---|---|
| 401/403 | `ai_err_auth`("API Key 无效或无权限,请到设置中检查") |
| 429 | `ai_err_rate`("请求过于频繁,稍后再试") |
| 网络/超时 | `ai_err_network`(+ 可折叠原始 log) |
| CLI 未安装 | `ai_err_no_cli`(+ 打开设置) |
| 返回空/纯 fence | `ai_err_empty`(提供重试) |
| 原文已改动 | `ai_err_stale` |
| 选区过长 | `ai_err_too_long` |

## 8. i18n 新增 key(en/zh)

`ai_assistant` / `ai_provider` / `ai_api_key` / `ai_base_url` / `ai_model` /
`ai_test_connection` / `ai_test_ok` / `ai_test_failed` / `ai_privacy_hint` /
`ai_cli_found`(v)/ `ai_cli_missing` / `ai_button` / `ai_generating` /
`ai_apply` / `ai_reject` / `ai_retry` / `ai_suggestion_label` /
`ai_not_configured` / `ai_open_settings` / 七个 `ai_err_*`

## 9. 边界情况

- **选区过大**:> 12,000 字符 → 按钮不出现;Cmd+J 触发时给 `ai_err_too_long`。
- **选区跨 LaTeX 结构**(如半个环境):不做语法校验,靠提示词第 4 条约束
  + 用户 diff 预览把关;预览即最后防线。
- **widget 与滚动**:block widget 参与正常文档流滚动;接受/拒绝按钮在
  widget 内部,不存在 fixed 漂浮错位问题。
- **多行旧文很长**:旧文 mark 不折叠(用户需要看清被替换内容);widget
  最大高度 40vh 内部滚动。
- **key 含空白**:保存时 trim;Base URL 去尾部 `/`。
- **代理用户**:reqwest 默认读系统代理环境变量,不另做配置项。
- **Anthropic 浏览器直连 header**(`anthropic-dangerous-direct-browser-access`)
  不使用——统一走 Rust,无需特例。

## 10. 验收标准

1. R1—R5 全部走通;R4 在未配置任何 key 的机器上,仅凭已登录的
   Claude Code 即可改写。
2. 流程体验:选中 → 按钮 300ms 内出现;点击后选区高亮 + 按钮转加载态;
   完成后旧红新绿就地呈现;`Tab` 接受 / `Esc` 拒绝均生效;接受后一次
   Cmd+Z 完整还原;拒绝后文档与发起前逐字节一致。
3. 失效规则:预览期间编辑选区内文本 → 会话静默取消;编辑选区外文本 →
   预览存活且位置正确。
4. 专家质量抽查(人工):弱动词开头的 bullet 改写后以动作动词开头;原文
   无数字时**改写结果不得出现新造数字**;中文简历回中文;LaTeX 命令
   (`\textbf`、`\item`、`%` 注释)不被破坏。
5. 四个预设各发一次"测试连接"按 §7 正确反馈;断网 → 网络错误文案;
   改写中取消 → UI 立即恢复,无残留装饰。
6. log 中 API key 全程 redact;`npm run build` + `cargo build` 通过。
7. 设置项重启后保留;切换提供商后再次改写走新提供商。

## 11. 不做(out of scope,另立 spec)

- 多动作菜单(更简洁/语法修正/自定义指令)——v1 只有一个"专家改写"
  按钮,JD 贴合自动生效;动作分化等用户反馈后再加
- 流式输出(片段短,非流式延迟可接受)
- 多轮对话式修改(只做单发改写 + "换个写法")
- 编译错误 AI 诊断(值得单独一份 spec)
- key 进 macOS Keychain(与 PAT 一起迁移,单独安全加固 spec)
- token 用量统计
