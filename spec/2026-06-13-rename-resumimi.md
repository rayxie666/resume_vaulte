# Spec: 项目改名 Resume Vault → Resumimi(简历喵喵)

- 日期:2026-06-13
- 类型:品牌改名(显示名 + 技术构件名);**不动 bundle identifier**
- 目标:产品对外名改为 **Resumimi**(英文)/ **简历喵喵**(中文),覆盖
  所有用户可见处与构建产物名;**保证老用户数据零迁移、零丢失**。
- 状态:**已实装(2026-06-13)。** 技术名(package/crate/lib/productName/
  bin)→ `resumimi`,`main.rs` 引用同步;显示名 → Resumimi / 简历喵喵
  (窗口标题、index.html、app_title en/zh、CI releaseName);文案改名
  (LaTeX 模板注释、同步仓库 README、PAT token 名示例、git 提交者);
  README/PRODUCT/DESIGN 改名,下载链接改指 releases/latest(避免死链)。
  **identifier `com.zheruixie.resumevault`、数据目录、`vault.db`、
  `STORAGE_KEY` 全部按 §1/§2.3 保留**——零数据迁移。`npm run build` +
  `cargo build`(编为 `resumimi v0.2.3`)通过。仓库改名(§3)属用户侧可选
  操作,未做。数据原地复用(§4.1)待真机覆盖安装验证。

---

## 0. 命名落点

- 英文显示名 / 品牌:**Resumimi**
- 中文显示名:**简历喵喵**
- 技术构件名(包名 / crate / 二进制 / 产物前缀):**resumimi**(全小写连字符)
- Bundle identifier:**`com.zheruixie.resumevault` 保持不变**(见 §1 命脉)
- 由来:resume + mimi(咪咪/喵),与项目已有的「工坊猫」桌面宠物
  (`spec/2026-06-10-pet-cat-3d.md`、`PetOverlay`)天然呼应——"喵喵"让
  那只猫从彩蛋升格为吉祥物。本 spec 只改名,**不重做视觉/设计系统**
  (排印工坊基调保留,猫是其上的俏皮层)。

## 1. 命脉:为什么 identifier 绝对不能改

应用数据目录由 bundle identifier 派生(`src-tauri/src/paths.rs` →
`app.path().app_data_dir()`):

```
~/Library/Application Support/com.zheruixie.resumevault/
  ├── vault.db        # 所有分类/版本/checkpoint/附件
  ├── pdfs/
  └── github_repo/
```

`src/db.ts` 的 `Database.load("sqlite:vault.db")` 也按此目录解析。

**若改 identifier → 数据目录路径随之改变 → 老用户升级后打开是空库,
vault.db / pdfs / github_repo 全部"丢失"(其实是孤儿在旧目录)。**

决策:**identifier 维持 `com.zheruixie.resumevault` 不变**。

- 它是内部稳定 ID,用户永不可见,改它只有坏处没有好处。
- identifier 不变 ⇒ 数据目录不变 ⇒ **无需任何迁移代码,零数据风险**。
- `paths.rs` 顶部注释已言明"identifier 不变,老 mac 数据原地复用"——本次
  改名继续遵守这条不变量(注释里的字面 identifier 可保留,或仅更新描述)。

> 如果将来确实想把数据目录也改成 `com.zheruixie.resumimi`,那是一次独立的、
> 带"首启迁移旧目录"的高风险变更,**不在本 spec 范围**,且默认不建议。

## 2. 改动清单(按文件,精确到字段)

### 2.1 显示名 "Resume Vault" → Resumimi / 简历喵喵

| 文件 | 位置 | 改为 |
|---|---|---|
| `src-tauri/tauri.conf.json` | `app.windows[0].title` | `"Resumimi"` |
| `index.html` | `<title>` | `Resumimi` |
| `src/i18n.ts` | `app_title`(en) | `"Resumimi"` |
| `src/i18n.ts` | `app_title`(zh) | `"简历喵喵"`(原 "简历库") |
| `.github/workflows/build.yml` | `releaseName` | `"Resumimi ${{ github.ref_name }}"` |
| `README.md` | H1 / hero `<h1>` / 正文首句 / alt 文本 | Resumimi(正文可加"(简历喵喵)") |
| `PRODUCT.md` | 标题与正文产品名 | Resumimi |
| `DESIGN.md` | H1 `# Design — Resume Vault` | `# Design — Resumimi` |
| GitHub PAT 引导里的 token 名示例(`spec/2026-06-09-github-token-onboarding.md` 第 62/70 行、若已实装则对应 i18n) | token 名建议 | "Resumimi" |

`app_title` 是 NavBar 在 home 视图显示的标题(`src/App.tsx` NavBar),改完
home 顶部即显示新名;中文 locale 显示"简历喵喵"。

### 2.2 技术构件名 `resume-vault` → resumimi

| 文件 | 字段 | 现值 → 新值 |
|---|---|---|
| `package.json` | `name` | `resume-vault` → `resumimi` |
| `src-tauri/tauri.conf.json` | `productName` | `resume-vault` → `resumimi` |
| `src-tauri/Cargo.toml` | `[package] name` | `resume-vault` → `resumimi` |
| `src-tauri/Cargo.toml` | `[lib] name` | `resume_vault_lib` → `resumimi_lib` |
| `src-tauri/src/main.rs` | `resume_vault_lib::run()` | `resumimi_lib::run()` |

连带效应(预期内,非额外改动):

- 构建产物前缀变化:`resume-vault.app` → `resumimi.app`、
  `resume-vault_<v>_aarch64.dmg` → `resumimi_<v>_aarch64.dmg`、
  Windows `resumimi_<v>_x64-setup.exe` / `_x64_en-US.msi`。
- `Cargo.lock` 的 package 名、`target/` 产物名随之变(rebuild 自动)。
- **README 的下载/产物文件名引用**(`resume-vault_0.2.2_*`、`resume-vault.app`、
  `resume-vault/` 项目树标题)需同步改为 `resumimi_*`;**但历史 release 的
  旧链接(v0.2.2 及之前)文件名仍是 `resume-vault_*`**——README 的"已发布
  下载表"指向的是已存在的旧产物,改名后**下一个 tag 起**产物才叫 resumimi。
  处理:README 下载链接指向 `releases/latest` 或在改名后的首个 release 发布
  时再更新具体文件名,避免指向不存在的 `resumimi_0.2.2_*`(死链)。

### 2.3 不改(显式保留)

- `src-tauri/tauri.conf.json` `identifier`(§1)。
- `paths.rs` 中的目录字面量 `com.zheruixie.resumevault`(数据命脉)。
- `git.rs` / `latex.rs` 等经 `paths::app_data_dir()` 取目录的逻辑——它们
  不含名称字面量,无需动。
- SQLite 文件名 `vault.db`(数据命脉;它不是品牌名,改它=丢数据)。
- 仓库内 `assets/`、`categories/` 等 GitHub 同步布局命名(数据协议,非品牌)。

## 3. GitHub 仓库与远程(用户侧动作,非代码)

仓库当前为 `rayxie666/resume_vaulte`。是否把仓库一并改名(如
`rayxie666/resumimi`)是**用户在 GitHub 上的操作**,可选:

- 若改名:GitHub 会自动 301 旧 URL,但仍应更新:
  - `README.md` 所有 `rayxie666/resume_vaulte` → 新 repo(badge、clone、
    releases、下载链接)。
  - 本地 `git remote set-url origin …`。
  - 本地工作目录 `resume_vaulte/`(纯本地名,改不改都行;改了会让
    `.claude/settings.local.json` 里的绝对路径失效,需同步或重授权)。
- 若**不改仓库名**:README 里的 repo URL 维持 `resume_vaulte` 即可,只改
  §2 的显示名/产物名。**推荐先只做应用内改名,仓库改名作为可选后续**,
  降低一次性风险面。

注意:GitHub 用户数据备份仓库(用户各自的 `*_resume_vault_data` 私库)与
本改名**无关**,不受影响。

## 4. 验收标准

1. **数据零丢失(最高优先级)**:用改名后的构建覆盖安装,启动后
   **原有分类/版本/checkpoint/附件/GitHub 连接全部在**(因 identifier 未变,
   数据目录 `com.zheruixie.resumevault/` 原地复用)。
2. **显示名**:窗口标题栏、home 顶部标题英文显示 "Resumimi";切到中文
   locale 显示 "简历喵喵";`index.html` 标签页标题为 Resumimi。
3. **构建产物**:`npm run tauri build` 产出 `resumimi.app` /
   `resumimi_<v>_aarch64.dmg`(及 Windows 对应);CI release 名为
   "Resumimi <tag>"。
4. **编译通过**:`npm run build` + `cargo build`(lib 改名后 `main.rs`
   引用同步,无 unresolved import)。
5. **README**:无指向不存在产物的死链(下载链接改为 latest 或随首个
   resumimi release 更新)。
6. **全局无残留**:`grep -riI "resume.\?vault\|简历库" src/ src-tauri/src/
   index.html` 仅剩 identifier/数据目录/db 文件名等§2.3 显式保留项,无
   遗漏的用户可见 "Resume Vault"。

## 5. 实装顺序建议

1. 先改 §2.2 技术名(package/Cargo/main.rs/tauri productName)→ `cargo build`
   + `npm run build` 确认编译链通。
2. 再改 §2.1 显示名 + i18n → 启动确认 home 标题/窗口标题/双 locale。
3. `npm run tauri build` 确认产物名,装到**已有数据的机器**验证 §4.1 数据
   原地复用。
4. README/PRODUCT/DESIGN 文案改名;下载链接处理为 latest。
5. (可选,单独提交)GitHub 仓库改名 + remote/README URL 更新。

## 6. 不做(out of scope)

- 改 bundle identifier / 数据目录迁移(§1,高风险,默认不做)
- 重做视觉识别 / 设计系统 / 配色(排印工坊基调保留;Logo/图标设计另立 spec)
- 把「工坊猫」升级为全局品牌吉祥物的视觉改造(命名呼应到此为止)
- 历史 release 产物重命名(GitHub 不允许改已发布资产名,只影响未来 tag)
- App 图标(.icns/.ico)更换——若要配合"喵喵"换猫主题图标,单独一份 spec
