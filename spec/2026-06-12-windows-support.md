# Spec: Windows 平台支持 —— 让 Tauri 应用在 Windows 上跑起来

- 日期:2026-06-12
- 前置:无(改的是底层路径 / 工具发现,与既有 sync / latex 行为正交)
- 目标:在 Windows 10/11 (x64) 上,Resume Vault 能正常安装、启动,并完成核心闭环 —— 类目 CRUD、LaTeX 实时编译预览、Checkpoint、GitHub 双向同步、AI 改写。产物形态为 `.msi` 与 `.exe` (NSIS) 安装包。
- 状态:**已实装(2026-06-12)。** 后端 6 处硬编码全部改为 `which` 统一
  发现 + `app_data_dir()` 路径;新增 `which.rs` / `paths.rs`;`git.rs` 六个
  命令注入 `AppHandle`,`ensure_user_config` 锁 `core.autocrlf=false`;
  `tauri.conf.json` 显式 windows bundle 块;README 加 Windows 章节 + 徽章;
  新增 CI matrix。macOS 侧 `app_data_dir()` 解析为既有的
  `~/Library/Application Support/com.zheruixie.resumevault`,数据原地复用,
  `cargo build` + `npm run build` 均通过。Windows 真机验证(§6 / §7 矩阵)
  待有 Windows 环境时执行。

---

## 1. 现状盘点 —— Windows 上为何跑不通

应用栈本身是跨平台的(Tauri 2 + React + SQLite via plugin-sql + 纯 Rust HTTP),但 Rust 后端有 **6 处硬编码 macOS** 的具体位置;前端 i18n 错误文案也只覆盖了 macOS。逐条列出(均为代码引用,非 hypothetical):

| # | 位置 | 现状 | Windows 上的后果 |
|---|---|---|---|
| A | `src-tauri/src/latex.rs:215-229` `COMMON_PATHS / find_tectonic` | 只查 `/opt/homebrew/bin`、`/usr/local/bin`、`/usr/bin` | LaTeX 预览永远 `tectonic not found`,即使 `tectonic.exe` 已在 `PATH` 上 |
| B | `src-tauri/src/latex.rs:406-412` `persist_last_log` | 写到 `$HOME/Library/Application Support/com.zheruixie.resumevault/last-compile.log` | `HOME` 在 Windows 上未定义 → 写入空串路径失败,日志静默丢失 |
| C | `src-tauri/src/git.rs:9-16` `vault_dir / repo_dir` | 同上 macOS 路径,且 **GitHub 同步整个工作树都挂在这里** | clone / push / pull 全线 panic 或写入诡异位置,GitHub Sync 完全不可用 |
| D | `src-tauri/src/ai.rs:141-158` `find_claude_binary` | 探 `/opt/homebrew/bin/claude` / `/usr/local/bin/claude` / `$HOME/.local/bin/claude`,且 `Command::new("claude")` 在 Windows 下不会自动加 `.cmd` 后缀 | Claude Code CLI 永远显示「未找到」,即便已 `npm i -g @anthropic-ai/claude-code` |
| E | `src-tauri/src/ai.rs:189-194` `claude_code_cancel` | `Command::new("kill").arg(pid)` | Windows 上没有 `kill` 命令 → 取消按钮静默失败,子进程残留 |
| F | `src/i18n.ts:255 / :460` `tectonic_missing` | 文案写死 `Install with: brew install tectonic` | 误导用户;Windows 上无 brew |

附加(非阻塞):

- `tauri.conf.json` 的 `bundle.targets` 是 `"all"`,Windows 上会默认产 `.msi` + NSIS;**没有显式 `wix` / `nsis` 配置块**,签名 / 升级地址等需补。
- Tauri 2 在 Windows 上跑的是 **WebView2**,与 macOS 的 WKWebView 都禁用 `window.alert/prompt/confirm`,所以 `src/Dialogs.tsx` 的 React modal 方案在两端都成立,无需改。
- `OSFONTDIR` 在 XeTeX 下 Windows 也认,且我们只塞一个目录(`dir`),无路径分隔符问题,**字体打包链路无需改动**。
- 资产名校验 (`latex.rs:104`) 已经同时拒绝 `/` 和 `\`,跨平台合规。
- 图标资源 (`src-tauri/icons/icon.ico`、`Square*Logo.png`) 已就绪。

---

## 2. 设计原则

1. **不引入条件编译做主控制流。** Tectonic / git / claude 的发现一律走 "PATH 优先 → 平台典型路径兜底" 的统一逻辑,避免 `#[cfg(windows)]` 散落各处。
2. **路径全部走 Tauri 的 `app.path()` API。** `HOME + 拼接` 替换为 `app_data_dir()`,自然在 macOS 给 `~/Library/Application Support/...`、在 Windows 给 `%APPDATA%\com.zheruixie.resumevault\...`。
3. **文案随 OS 走,不靠 i18n 区分。** 安装命令(`brew install` vs `winget install`)按 `cfg!(target_os)` 在 Rust 端组装,前端只展示。
4. **保持现有 macOS 行为字节级不变。** 同一函数走 macOS 分支时返回的路径、命令必须与今天完全一致;新增逻辑只在「macOS 找不到」或「Windows 上」时生效。
5. **不做的明确不做。** 自动更新、代码签名/公证(EV / 时间戳)、ARM64 Windows、应用商店上架、auto-install Tectonic —— 全部 out of scope(§9)。

---

## 3. 实装变更

### 3.1 通用 helper:`AppHandle → 应用数据目录`

新增 `src-tauri/src/paths.rs`(或就近塞 `lib.rs`):

```rust
pub fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("resolve app_data_dir failed: {e}"))
}
```

Tauri 的 `app_data_dir` 在 macOS = `~/Library/Application Support/<identifier>`,在 Windows = `%APPDATA%\<identifier>`。**identifier 已是 `com.zheruixie.resumevault`,无需迁移**(macOS 既有用户的数据原地复用;Windows 是全新目录,无迁移问题)。

### 3.2 二进制发现的统一工具(`src-tauri/src/which.rs`,新增)

```rust
/// 在 PATH 上查找可执行文件;Windows 下自动尝试 `.exe`/`.cmd`/`.bat`。
pub fn which(name: &str) -> Option<PathBuf>;

/// PATH 找不到时,按给定候选绝对路径列表兜底。
pub fn which_or(name: &str, fallbacks: &[PathBuf]) -> Option<PathBuf>;
```

实现要点:
- 解析 `PATH` 环境变量,逐个目录尝试。
- Windows 上对每个目录额外尝试 `name` + 每个 `PATHEXT` 后缀(取系统 `PATHEXT`,缺省 `.COM;.EXE;.BAT;.CMD`)。
- 不引入新依赖(`which` crate 不需要,自己 10 行写完更可控)。

### 3.3 `latex.rs` —— Tectonic 发现 + 日志路径

**A: `find_tectonic`** 改为先 PATH,再平台兜底:

```rust
fn find_tectonic() -> Option<PathBuf> {
    let mac_fallbacks: &[&str] = &[
        "/opt/homebrew/bin/tectonic",
        "/usr/local/bin/tectonic",
        "/usr/bin/tectonic",
    ];
    let win_fallbacks_owned: Vec<PathBuf> = {
        let local = std::env::var("LOCALAPPDATA").ok().map(PathBuf::from);
        let userprofile = std::env::var("USERPROFILE").ok().map(PathBuf::from);
        let mut v = Vec::new();
        if let Some(p) = local.as_ref() {
            v.push(p.join("Programs").join("Tectonic").join("tectonic.exe"));
            v.push(p.join("Microsoft").join("WinGet").join("Links").join("tectonic.exe"));
        }
        if let Some(p) = userprofile.as_ref() {
            v.push(p.join("scoop").join("shims").join("tectonic.exe"));
            v.push(p.join(".cargo").join("bin").join("tectonic.exe"));
        }
        v
    };

    which::which("tectonic").or_else(|| {
        if cfg!(target_os = "windows") {
            which::which_or("tectonic", &win_fallbacks_owned)
        } else {
            which::which_or("tectonic", &mac_fallbacks.iter().map(PathBuf::from).collect::<Vec<_>>())
        }
    })
}
```

**B: 错误文案** —— `compile_latex_inner` 里:

```rust
let hint = if cfg!(target_os = "windows") {
    "tectonic not found. Install with: winget install --id TectonicProject.Tectonic"
} else {
    "tectonic not found. Install with `brew install tectonic`."
};
```

并把 hint 透传到前端(下文 §3.6)。

**C: `persist_last_log`** —— 签名改成接 `AppHandle`:

```rust
fn persist_last_log(app: &tauri::AppHandle, log: &str) -> std::io::Result<()> {
    let dir = app_data_dir(app).map_err(|e| std::io::Error::other(e))?;
    fs::create_dir_all(&dir)?;
    fs::write(dir.join("last-compile.log"), log)
}
```

`compile_latex` 命令把 `app` 透传进 `compile_latex_inner`(已经透了 `fonts_src`,加一个无成本)。

### 3.4 `git.rs` —— vault 目录 / repo 目录全部走 AppHandle

`vault_dir()` 和 `repo_dir()` 改成接 `&AppHandle`(或在文件头封装一个 `fn vault_dir(app: &AppHandle)`)。每个 `#[tauri::command]` 都已经能拿到 `AppHandle`(给 `git_connect` / `git_disconnect` / `git_status` / `git_apply` / `git_pull` / `git_remote_snapshot` 全部加 `app: tauri::AppHandle` 入参,前端 invoke 不变,Tauri 自动注入)。

`run_git` 不动 —— `Command::new("git")` 在 Windows 上会自动通过 `PATH` 找到 Git for Windows 安装的 `git.exe`,**前提是用户装了 Git for Windows**(Requirements 文档加一行,§3.7)。

子进程行为差异验证:
- `git clone https://x-access-token:TOKEN@github.com/...` 在 Git for Windows 下走 wincred / Schannel,**不会**弹凭据 UI(token 已嵌 URL),与 macOS 一致。
- 路径里有空格(`C:\Users\张三\AppData\...`)→ 我们传 `&Path` 给 `Command::current_dir`,不走 shell,无引号问题。

### 3.5 `ai.rs` —— Claude CLI 发现 + 进程取消

**A: `find_claude_binary`** 复用 `which`:

```rust
fn find_claude_binary() -> Option<PathBuf> {
    if let Some(p) = which::which("claude") { return Some(p); }
    // Windows: npm 全局装在 %APPDATA%\npm\claude.cmd
    let win_fallbacks: Vec<PathBuf> = std::env::var("APPDATA")
        .ok()
        .map(|p| vec![PathBuf::from(p).join("npm").join("claude.cmd")])
        .unwrap_or_default();
    let mac_fallbacks: Vec<PathBuf> = {
        let home = std::env::var("HOME").unwrap_or_default();
        vec![
            "/opt/homebrew/bin/claude".into(),
            "/usr/local/bin/claude".into(),
            PathBuf::from(&home).join(".local").join("bin").join("claude"),
        ]
    };
    if cfg!(target_os = "windows") {
        which::which_or("claude", &win_fallbacks)
    } else {
        which::which_or("claude", &mac_fallbacks)
    }
}
```

**B: `claude_code_cancel`** —— 不再 shell 出 `kill`,改为持有 `Child` 句柄:

```rust
// 由 PID Mutex 改为 Mutex<Option<Arc<Mutex<Child>>>> 不现实(Child 不可跨 await 持有),
// 折中:保留 PID,kill 时按平台分发。
#[tauri::command]
pub async fn claude_code_cancel() -> Result<(), String> {
    let pid = RUNNING_CLI_PID.lock().unwrap().take();
    if let Some(pid) = pid {
        if cfg!(target_os = "windows") {
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .output();
        } else {
            let _ = Command::new("kill").arg(pid.to_string()).output();
        }
    }
    Ok(())
}
```

`/T` 是为了把子树一起杀掉(CLI 可能 spawn 子进程),与 Unix `kill` 不严格对等,但「取消」语义下更安全。

### 3.6 前端文案

`src/i18n.ts:255 / :460` 的 `tectonic_missing` 从 **写死的英文/中文** 改为 **从后端透传**:`compile_latex` 失败结果里已有 `log` 字段,首屏 hint 由 Rust 端按 §3.3-B 生成,前端只展示 `result.log` 的第一行 hint —— 现有 `summarize_errors` 已经走的就是这个机制,顺势把「未找到 tectonic」一并塞进 hints。

无需新 i18n key —— hint 文本在 Rust 端组装好(英/中两份按 `app.config().active_locale` 选,**或者更简单:始终输出英文 hint + 命令,中文 UI 下用户也认得 `winget install ...`**,与现有 i18n 风格一致 §3.6.note)。

> §3.6.note:既有 `tectonic_missing` 已经是「双语 + 命令」混排(中文文案里直接拼了 `brew install tectonic` 英文命令),沿用此风格,**仅替换命令**,文案主体不动。

### 3.7 文档 + 打包

**`README.md`** 新增 Windows 段:

```md
## Windows

| 工具 | 安装 |
|---|---|
| Node.js ≥ 20 | https://nodejs.org/ 或 `winget install OpenJS.NodeJS.LTS` |
| Rust stable ≥ 1.78 | https://rustup.rs/(选 `x86_64-pc-windows-msvc`) |
| MSVC Build Tools | Visual Studio Installer → "Desktop development with C++" |
| WebView2 Runtime | Windows 11 自带;Windows 10 需要 `winget install Microsoft.EdgeWebView2Runtime` |
| Git for Windows(GitHub 同步用) | `winget install Git.Git` |
| Tectonic(LaTeX 预览用) | `winget install TectonicProject.Tectonic` 或下载 https://tectonic-typesetting.github.io/ |
```

启动命令仍是 `npm install && npm run tauri dev`,与 macOS 同。

**`tauri.conf.json`** 新增显式 windows bundle 块(可选,主要为可重复构建):

```json
"bundle": {
  "targets": ["app", "dmg", "nsis", "msi"],
  "windows": {
    "wix": { "language": ["en-US"] },
    "nsis": { "installerIcon": "icons/icon.ico", "installMode": "perMachine" }
  }
}
```

如未签名,Windows SmartScreen 会拦首启(右键属性 → 「解除锁定」,或在 SmartScreen 弹窗点「仍要运行」)。README 注明,签名留给后续。

**CI(`.github/workflows/release.yml`,新增或修改)**:matrix 加 `windows-latest`,产物 `*.msi` 与 `*-setup.exe` 上传至 Release。

---

## 4. 文件改动清单

| 文件 | 改动 |
|---|---|
| `src-tauri/src/which.rs` | **新增**:`which` / `which_or` |
| `src-tauri/src/lib.rs` | 暴露 `mod which`、`mod paths`(若拆),命令签名加 `AppHandle` |
| `src-tauri/src/latex.rs` | `find_tectonic` 改写;`persist_last_log` 接 `AppHandle`;hint 文案分平台 |
| `src-tauri/src/git.rs` | `vault_dir / repo_dir` 接 `AppHandle`;6 个 `#[tauri::command]` 加 `app` 入参 |
| `src-tauri/src/ai.rs` | `find_claude_binary` 复用 `which`;`claude_code_cancel` 平台分发 |
| `src/i18n.ts` | `tectonic_missing` 命令片段不再写死(由后端 hint 替代),或移除该字段 |
| `src-tauri/tauri.conf.json` | 显式 `bundle.windows.{wix,nsis}` 块 |
| `README.md` | 新增 Windows 章节;徽章 macOS → macOS / Windows |
| `.github/workflows/*.yml` | CI matrix 加 `windows-latest` |

无 DB schema 变更,无前端组件改动,无 IPC 接口签名变更(前端 `invoke('git_apply', {...})` 不传 app,Tauri 自动注入)。

---

## 5. 边界情况

- **用户既无 `tectonic` 又无 `git`**:与 macOS 行为一致 —— LaTeX 预览和 GitHub Sync 各自报错,其他功能不受影响(README 已声明的「降级运行」契约保留)。
- **PATH 上同时有 `tectonic.exe` 和 scoop shim**:`which` 取 PATH 命中的第一个,与「直接在终端打 `tectonic`」语义一致。
- **`%APPDATA%` 含 Unicode(中文用户名)**:`PathBuf` + `Command::current_dir` 全程走 OS-native 编码,不经 shell,验证清单见 §6 第 6 项。
- **`%APPDATA%` 在 OneDrive 同步目录下**:SQLite 写入可能与 OneDrive 同步冲突。**不在本 spec 解决** —— 与 macOS 上 iCloud Documents 同步冲突同性质,文档建议关闭对该子目录的同步。
- **Windows 上 Git for Windows 的换行符自动转换 (`core.autocrlf=true`)**:`.tex` push 后远端会变 CRLF,B 机 pull(macOS)显示 LF —— 在 `ensure_user_config` 里追加 `git config core.autocrlf false`,锁死 LF。这是**新增的全平台行为**,但只影响 vault repo,不污染用户其他 git 配置(`--local` 默认作用域)。
- **Tectonic 缓存路径**:`tectonic` 自己负责(macOS `~/Library/Caches/Tectonic`,Windows `%LOCALAPPDATA%\TectonicProject\Tectonic\cache`)—— 我们不干预,首启「下载包慢」的体验两平台同。
- **Claude Code CLI 在 Windows 装在 `.cmd` 而非 `.exe`**:`which` 已通过 `PATHEXT` 覆盖。
- **`taskkill /T` 杀不掉 / 没权限**:静默失败 → 残留进程最长 120s 后自然超时(`CLI_TIMEOUT_SECS`),与 Unix `kill` 失败时的行为对等。

---

## 6. 验收标准

1. **冷启动**:Windows 11 (x64) 干净机,装好 Node + Rust + MSVC + WebView2(Win 11 自带),`npm install && npm run tauri dev` 启动成功,主窗口可见。
2. **类目 CRUD**:新建 / 编辑 / 删除类目,数据写入 `%APPDATA%\com.zheruixie.resumevault\vault.db`,重启后保留。
3. **LaTeX 预览(有 tectonic)**:`winget install TectonicProject.Tectonic` 后,新建 latex 版本 → 自动编译 → PDF 在右栏显示,`last-compile.log` 落入 `%APPDATA%\com.zheruixie.resumevault\`。
4. **LaTeX 预览(无 tectonic)**:卸载后编辑器报错文案是 `tectonic not found. Install with: winget install --id TectonicProject.Tectonic`(中文 locale 下命令片段同此)。
5. **GitHub Sync 全链路**:Connect → Sync now 上传 → 删除本地 `github_repo` → Sync now 拉回 → 数据完整。仓库目录确为 `%APPDATA%\com.zheruixie.resumevault\github_repo\`。
6. **Unicode 用户名**:用户 `张三` 登录,`%APPDATA%` 实际为 `C:\Users\张三\AppData\Roaming\com.zheruixie.resumevault`,所有 1–5 步可重复;`vault.db` 可读写,`git clone` 成功。
7. **CRLF 不污染**:Windows push 一份 `.tex`,macOS pull,文件内容字节级一致(无 `\r\n`)。
8. **Claude Code 集成**:`npm i -g @anthropic-ai/claude-code` 后,AI 改写面板的「Claude Code」状态显示 found + 版本号;触发一次 rewrite 能拿到结果;运行中点取消能在 ≤2s 内结束子进程(任务管理器查无 `node.exe` 残留)。
9. **macOS 回归**:同一 PR 在 macOS 上 `npm run tauri build`,产物 `.app` 启动后 1–8 流程(除 6)与改动前行为完全一致(逐项手测或 diff 既有截图)。
10. **打包产物**:`npm run tauri build` 在 Windows 上生成 `src-tauri/target/release/bundle/{msi,nsis}/` 下的 `resume-vault_<version>_x64_en-US.msi` 和 `resume-vault_<version>_x64-setup.exe`,双击都能装,装完桌面/开始菜单图标正确(从 `Square*Logo.png` / `icon.ico`)。
11. **`cargo build` + `npm run build`** 在 Windows / macOS 两端均通过,无新增 warning。

---

## 7. 测试矩阵

| 平台 | 用例集 | 频率 |
|---|---|---|
| Windows 11 x64 | §6 全部 1–8、10、11 | 每次 PR(CI) |
| Windows 10 x64(无预装 WebView2) | §6 第 1 项 + WebView2 安装提示验证 | 手测一次 |
| macOS 14 (Apple Silicon) | §6 第 9 项 + 既有冒烟 | 每次 PR(CI) |
| macOS 13 (Intel) | 手测冒烟 | release tag 时 |

CI 配置:GitHub Actions matrix `[macos-latest, windows-latest]`,各跑 `npm run tauri build` 不上传 artifacts(开 PR 时);release tag 触发完整 build + 上传到 Releases。

---

## 8. 风险与回退

- **风险:Windows 路径长度上限(MAX_PATH = 260)**。`%APPDATA%\com.zheruixie.resumevault\github_repo\categories\1-google-swe\1-polished.tex` 已接近 100 字符,深嵌套 + Unicode 时风险存在。Windows 10 1607+ 可启用长路径,但不强制。**应对**:实测一次 50 个类目 × 长名,若实际撞到再考虑迁 vault 目录到 `%LOCALAPPDATA%`(更短,且本就是「本地不漫游」语义)—— 但这需 macOS 上对应迁移,**留到出问题再说,本 spec 不预防**。
- **风险:WebView2 Runtime 未装的 Windows 10**。Tauri 安装包可选「embedded」/「downloadBootstrapper」模式;首版用 `downloadBootstrapper`(installer 体积小,首启联网拉 runtime)。Tauri 默认即此,无需改。
- **回退**:本 spec 所有改动都是「PATH 优先 → 老路径兜底」叠加 + AppHandle 注入,任一改动单独 revert 都不会破坏 macOS;CI 矩阵保证 macOS 始终绿。

---

## 9. 不做(out of scope)

- **代码签名 / 公证**:EV 证书、Authenticode、SmartScreen 信誉积累 —— 独立工程,留下一份 spec。
- **自动更新**:Tauri updater 在 Windows 上要 endpoint + 签名,与签名捆绑。
- **ARM64 Windows**:`aarch64-pc-windows-msvc` target,目标用户量极小。
- **Microsoft Store / MSIX 上架**:涉及商店配额、内购、隐私 manifest,独立项目。
- **Auto-install Tectonic / Git**:不替用户管包管理器;只给清晰提示。
- **WSL 路径互操作**:不识别 `\\wsl$\...`,不在 WSL 下编译 LaTeX。
- **Linux 支持**:本 spec 不顺手做。Tauri 同样支持,但 GTK/AppImage 打包、字体路径、`OSFONTDIR` 行为另起一份 spec。
- **既有 macOS 用户数据迁移**:Windows 是全新平台,无此概念;macOS 路径不动,无迁移。
