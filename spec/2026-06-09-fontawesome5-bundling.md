# Spec Phase 2: 解决 fontawesome5 字体缺失导致 Tectonic segfault

- 日期：2026-06-09
- 前置：`spec/2026-06-09-latex-asset-rendering.md`（asset 注入已实现）
- 目标：让使用 `\usepackage{fontawesome5}` 的简历能在用户机器上零额外安装直接编译。

---

## 1. 根因复核

用户最新一次编译 log（关键片段）：

```
(fontawesome5.sty (expl3.sty (l3backend-xetex.def)) (l3keys2e.sty) (xparse.sty)
 (fontawesome5-utex-helper.sty (tufontawesomefree.fd
exit: <terminated by signal> | pdf: no (0 bytes)
=== main.log ===
[main.log not available: No such file or directory (os error 2)]
```

诊断：

1. Tectonic 0.16.9 默认引擎是 **XeTeX**。
2. `fontawesome5` 在 utex 模式下加载 `tufontawesomefree.fd`，调用 `fontspec` 查找：
   - `FontAwesome5Free-Solid.otf`
   - `FontAwesome5Free-Regular.otf`
   - `FontAwesome5Brands-Regular.otf`
3. 用户系统 `~/Library/Fonts`、`/Library/Fonts`、`/System/Library/Fonts` **均未安装** 这些字体（已 grep 验证）。
4. fontspec 找不到字体时 XeTeX 引擎 **直接 segfault**（这是 Tectonic + fontspec 已知缺陷，不是 graceful error），所以 `main.log` 都没来得及写盘。

这就是为什么 Phase 1 修了图片 asset 之后还是失败 —— 字体问题在加载阶段就把进程打死了，根本没走到图片解析。

---

## 2. 方案对比

| 方案 | 优点 | 缺点 | 选择 |
| --- | --- | --- | --- |
| A. 让用户 `brew install --cask font-fontawesome` | 零代码改动 | 把环境配置推给用户，违背"桌面 App 开箱即用"原则 | ❌ |
| B. 把 FontAwesome 5 OTF 随 App 打包，编译时拷到 tempdir | 一次配好，用户无感；离线可用 | App 体积 +~2 MB；要处理字体许可 | ✅ |
| C. 修改简历模板用 PNG 替代 `\faPhone` 等 | 不动 backend | 用户拒绝 —— 要求"现有功能不变" | ❌ |
| D. 切到 pdfLaTeX 引擎（`--engine pdflatex`） | 绕开 fontspec | Tectonic 不支持 pdfLaTeX 引擎；得换工具链 | ❌ |

选 **B**。FontAwesome 5 Free 走 SIL OFL 1.1 协议，允许重分发。

---

## 3. 技术方案（B）

### 3.1 字体获取

下载 FontAwesome 5 Free Desktop：

```
https://use.fontawesome.com/releases/v5.15.4/fontawesome-free-5.15.4-desktop.zip
```

放到 `src-tauri/resources/fonts/`：

```
src-tauri/resources/fonts/
├── FontAwesome5Free-Solid.otf
├── FontAwesome5Free-Regular.otf
├── FontAwesome5Brands-Regular.otf
└── LICENSE.txt   (SIL OFL 1.1，保留)
```

### 3.2 Cargo & Tauri 资源声明

`src-tauri/tauri.conf.json` 的 `bundle.resources` 加入：

```json
"resources": ["resources/fonts/*.otf", "resources/fonts/LICENSE.txt"]
```

> 这一步是 Tauri 打 release 包时把 fonts 一起塞进 `.app`；开发期 `cargo run` 直接读 `CARGO_MANIFEST_DIR/resources/fonts/` 即可。

### 3.3 代码改动：`latex.rs`

新增辅助函数：

```rust
fn resource_fonts_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    // 1. release: app.path().resource_dir() / "resources/fonts"
    // 2. dev: env!("CARGO_MANIFEST_DIR") / "resources/fonts"
    if cfg!(debug_assertions) {
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/fonts"))
    } else {
        app.path().resource_dir().ok().map(|p| p.join("resources/fonts"))
    }
}

fn stage_fonts(dir: &Path, fonts_src: &Path) -> std::io::Result<()> {
    for name in [
        "FontAwesome5Free-Solid.otf",
        "FontAwesome5Free-Regular.otf",
        "FontAwesome5Brands-Regular.otf",
    ] {
        let src = fonts_src.join(name);
        if src.exists() {
            fs::copy(&src, dir.join(name))?;
        }
    }
    Ok(())
}
```

在 `compile_latex_inner` 写完 `resume.cls` 之后调用 `stage_fonts(&dir, &fonts_src)`，并在调用 tectonic 时设置 **`OSFONTDIR`** 环境变量指向 tempdir，让 XeTeX 的 fontspec/fontconfig 在 tempdir 找到字体：

```rust
let output = Command::new(&tectonic)
    .env("OSFONTDIR", &dir)
    .arg("-X").arg("compile")
    // ...
    .output();
```

`OSFONTDIR` 是 kpathsea 标准变量，XeTeX 启动时会把它喂给 fontconfig，无需额外配置。

> 备选：`TEXMFFONTS` 或直接在 LaTeX 里用 `\setmainfont[Path=./]{FontAwesome5Free-Solid.otf}`，但 `OSFONTDIR` 最不侵入。

### 3.4 改 `compile_latex` 签名拿到 `AppHandle`

当前 `compile_latex` 是 free function。改成：

```rust
#[tauri::command]
pub async fn compile_latex(
    app: tauri::AppHandle,
    req: CompileRequest,
) -> Result<CompileResult, String> {
    let fonts_dir = resource_fonts_dir(&app);
    tauri::async_runtime::spawn_blocking(move || compile_latex_inner(req, fonts_dir))
        .await
        .map_err(|e| format!("join error: {e}"))?
}
```

`compile_latex_inner` 第二参数变为 `Option<PathBuf>`，None 时跳过 stage（兼容测试）。

### 3.5 错误信息改善

如果 `fonts_dir` 为 None 或拷贝失败，在 log 顶部加：

```
[warn] FontAwesome 5 fonts not staged; \faIcon commands may crash tectonic.
```

如果检测到 source 含 `\usepackage{fontawesome5}` 而字体目录为空，直接拒绝并返回带提示的错误。

---

## 4. 关键文件改动清单

| 文件 | 改动 |
| --- | --- |
| `src-tauri/resources/fonts/*.otf` + `LICENSE.txt` | 新增字体资源 |
| `src-tauri/tauri.conf.json` | `bundle.resources` 加入字体路径 |
| `src-tauri/src/latex.rs` | `compile_latex` 接 `AppHandle`，加 `stage_fonts`，设置 `OSFONTDIR` |
| `src-tauri/src/lib.rs` | 无 |
| `src/latexCompile.ts` | 无（invoke 参数结构不变） |
| `README.md` | 致谢 FontAwesome 5 Free OFL 协议 |
| `spec/2026-06-09-fontawesome5-bundling.md` | 本文件 |

---

## 5. 实现步骤

1. **下载并落盘字体**
   - 创建 `src-tauri/resources/fonts/`。
   - 把 3 个 OTF + LICENSE.txt 放进去。
   - 加入 git（这 ~2 MB 二进制是合理的，写进 `.gitattributes` 标 binary）。

2. **Tauri 资源声明**
   - 改 `tauri.conf.json`，验证 `cargo tauri dev` 能从 dev path 读到。

3. **后端改造**
   - `latex.rs` 加 `resource_fonts_dir`、`stage_fonts`。
   - 改 `compile_latex` 签名接 `AppHandle`。
   - 设置 `OSFONTDIR=<tempdir>` 环境变量。
   - `cargo build` 通过。

4. **联调验证**（必做）
   - `npm run tauri dev`。
   - 用例 A：用户原始简历（带 fontawesome5 + 3 张 PNG）能成功出 PDF，phone/envelope/linkedin 图标正确显示。
   - 用例 B：删除 logo PNG 上传，编译报"Missing asset"（Phase 1 行为不退化）。
   - 用例 C：临时删掉 `resources/fonts/` 重启 dev，编译时 log 顶部有 fontawesome 警告，且不再 segfault（应得到 graceful LaTeX error）。

5. **Release 包验证**
   - `cargo tauri build`。
   - 装到一台没有 FontAwesome 的 mac 上跑同一份简历，确认 PDF 渲染正常。

---

## 6. 风险与权衡

| 风险 | 应对 |
| --- | --- |
| FontAwesome 5 Free OFL 要求保留版权声明 | 保留 `LICENSE.txt` 并在 README 致谢；不改字体名 |
| `OSFONTDIR` 在某些平台被 fontconfig 缓存覆盖 | 同时调用 `fc-cache` 是过度设计；先观察，必要时改用 fontspec 显式 `Path=` |
| App 体积 +2 MB | 可接受；如要省，可只 ship Solid + Brands（drop Regular，但用户简历的 `\faEnvelope` 是 Regular，必须保留） |
| 用户简历升级到 fontawesome6 | 当前 fontawesome5 包仍主流；用户切换时再加一组字体 |
| Tectonic 升级后行为变化 | 在 `Cargo.toml` 不固定 tectonic 路径，依然走系统 `tectonic`，但建议在 README 标注最低版本 0.15+ |

---

## 7. 验收标准

- [ ] 用户原始 LaTeX 源码（含 `\faPhone`、`\faEnvelope`、`\faLinkedin` 和 3 张 logo PNG）能编译出正确 PDF。
- [ ] 没有 segfault：tectonic exit code 是 0 或 graceful 非零。
- [ ] Release `.app` 在干净 mac（无 FontAwesome）上同样能渲染。
- [ ] 旧 `resume.cls` 模板不受影响。
- [ ] `cargo build` + `tsc && vite build` 通过。
