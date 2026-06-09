# Spec Phase 3: 修复 asset BLOB 存储 / 读取的二进制 round-trip

- 日期：2026-06-09
- 前置：Phase 1（asset 注入）、Phase 2（fontawesome 兼容）
- 目标：让 PNG 在 SQLite ↔ 前端 ↔ Tectonic 整条链路上保持比特一致。

---

## 1. 症状

Phase 1 + 2 实装后编译输出：

```
assets written: bytedance.png, ccb.png, cmu.png, cnpc.png, startup.png
warning: 2-byte read failed
warning: 2-byte read failed
warning: 8-byte read failed
error: main.tex:199: Unable to load picture or PDF file 'bytedance.png'
```

`assets written` 行说明后端确实在 tempdir 写了 5 个文件 —— 文件名也对。但 Tectonic 解析 PNG 时连 PNG 8 字节 magic header (`89 50 4E 47 0D 0A 1A 0A`) 都读不完整 → **磁盘上的"bytedance.png"不是真的 PNG**。

## 2. 根因

`src/db.ts` 当前实现：

```ts
// 写
await db.execute(
  "INSERT INTO resume_assets ... VALUES ($1, $2, $3) ...",
  [versionId, name, Array.from(bytes)],   // ← 这一行是元凶
);

// 读
const rows = await db.select<AssetRow[]>(
  "SELECT ... bytes ... FROM resume_assets WHERE id = $1",
  [id],
);
return new Uint8Array(row.bytes);
```

链路问题：

1. `Array.from(Uint8Array)` → JS 普通 `number[]`。
2. `@tauri-apps/plugin-sql` 通过 Tauri IPC 把参数序列化为 JSON，`number[]` → JSON 文本 `[137,80,78,71,...]`。
3. 后端 sqlx 收到 `serde_json::Value::Array(Vec<Number>)`，绑定到 SQLite 时 **没有走 BLOB 二进制 binding，而是被当成 JSON/TEXT 写入**（SQLite 列亲和性允许 BLOB 列存 TEXT）。
4. 读回时 `decode_sqlite_to_json` 看到列亲和性是 BLOB，按 `Vec<u8>` 解码 → 拿到的是字符串 `"[137,80,78,71,...]"` 的 **UTF-8 字节**（每个数字字符 + 逗号 + 方括号）。
5. JS 端 `new Uint8Array(row.bytes)` 拿到一堆 ASCII 字符码（`0x5B 0x31 0x33 0x37 0x2C 0x38 0x30...`）。
6. `bytesToBase64` 把这堆 ASCII 编码成 base64 发给 Rust。
7. Rust `BASE64.decode` 得到同一堆 ASCII 字节，`fs::write` 落盘 → "bytedance.png" 实际内容是 `[137,80,78,71,13,10,26,10,...]` 这种 JSON 文本。
8. Tectonic 打开"PNG"读 magic header，读到 `[` `1` `3` `7`...，不是 `89 50 4E 47`，报 "2-byte read failed"。

**自检**：列表里 `formatSize(a.size)` 显示的值会比真实 PNG 大 ~3-5×（JSON 数字+逗号膨胀）。如果用户看到 100 KB 的 logo 显示 "400 KB" 左右，就是这个 bug。

## 3. 修复方案

### 方案 A：BLOB 列存 base64 字符串（推荐）

把 BLOB 改成 TEXT，存 base64。优点：完全绕开 plugin-sql 的二进制 binding 坑；缺点：DB 体积 +33%。

迁移（v6）：

```sql
-- 新加列保存 base64 文本
ALTER TABLE resume_assets ADD COLUMN bytes_b64 TEXT;
-- 旧 BLOB 列 bytes 不再使用，但保留以兼容回滚
```

`db.ts` 改造：

```ts
import { bytesToBase64, base64ToBytes } from "./latexCompile";

export async function addAsset(
  versionId: number,
  name: string,
  bytes: Uint8Array,
): Promise<number> {
  const db = await getDb();
  const b64 = bytesToBase64(bytes);
  const r = await db.execute(
    "INSERT INTO resume_assets (version_id, name, bytes_b64, bytes) \
     VALUES ($1, $2, $3, x'') \
     ON CONFLICT(version_id, name) DO UPDATE SET bytes_b64 = excluded.bytes_b64",
    [versionId, name, b64],
  );
  return r.lastInsertId as number;
}

export async function getAssetBytes(id: number): Promise<Uint8Array | null> {
  const db = await getDb();
  const rows = await db.select<{ bytes_b64: string | null }[]>(
    "SELECT bytes_b64 FROM resume_assets WHERE id = $1",
    [id],
  );
  const row = rows[0];
  if (!row?.bytes_b64) return null;
  return base64ToBytes(row.bytes_b64);
}

export async function listAssets(versionId: number): Promise<ResumeAsset[]> {
  const db = await getDb();
  // size 用 base64 长度反推：raw_len = floor(b64_len * 3 / 4) - padding
  return db.select(
    "SELECT id, version_id, name, \
       (length(bytes_b64) * 3 / 4) AS size, \
       created_at \
     FROM resume_assets WHERE version_id = $1 ORDER BY name ASC",
    [versionId],
  );
}
```

新增 `base64ToBytes` 在 `latexCompile.ts`：

```ts
export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
```

整个链路变成：**Uint8Array → base64 字符串（前端）→ TEXT 列（DB）→ base64 字符串（前端读回）→ base64 → 后端 → 二进制落盘**。没有任何隐式 binary binding。

### 方案 B：让 plugin-sql 走真正的 BLOB binding

需要在 JS 端传 `Uint8Array` 而不是 `Array.from(bytes)`，但 `@tauri-apps/plugin-sql` v2.4.0 的 IPC 层 **不支持** TypedArray 直接序列化（会被转成对象 `{0: 137, 1: 80, ...}` 或失败）。验证不通过则只能上 fork 改插件，不推荐。

→ **选方案 A**。

## 4. 数据迁移

存量数据（已经被错误写入的 BLOB 内容）无法 100% 还原成原始 PNG（信息在 IPC 那一层就丢了）。处理：

- 迁移脚本（v6）只新建列，不动旧 BLOB。
- 启动时跑一次一次性 sweep：对所有 `bytes_b64 IS NULL` 的行做兜底——但内容已坏，没法救。
- UI 上加红色横幅"检测到 N 个素材因旧版本 bug 损坏，请重新上传"，引导用户再拖一次 PNG。

如果用户在 Phase 1 之后上传过的素材不多，直接清空 `resume_assets` 让用户重传也可以接受（**这次最干净**）。

## 5. 验证步骤

1. **改 backend & frontend**，按方案 A 改。
2. **二进制 sanity check**：在 `addAsset` 之后立刻 `getAssetBytes` 取回，比对 `bytes[0..8]` 是否等于 `[0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]`。可以在 dev console 加一行 `console.log(Array.from(roundtrip.slice(0,8)).map(b=>b.toString(16)))`。
3. **磁盘 sanity check**：在 Rust 里 `compile_latex_inner` 写完 asset 后 `head -c 8 bytedance.png | xxd`（或 Rust 里 read + log 前 8 字节）。预期 `8950 4e47 0d0a 1a0a`。如果不是，链路还有问题。
4. **完整编译**：跑用户原 LaTeX，确认 PDF 出来且 logo 显示正确。
5. **回归**：旧 `resume.cls` 模板无附件场景不变。

## 6. 关键文件改动

| 文件 | 改动 |
| --- | --- |
| `src-tauri/src/lib.rs` | 加 migration v6：`ALTER TABLE resume_assets ADD COLUMN bytes_b64 TEXT` |
| `src/db.ts` | `addAsset` / `getAssetBytes` / `listAssets` 改走 `bytes_b64` |
| `src/latexCompile.ts` | 新增 `base64ToBytes` 导出 |
| `src/AttachmentsModal.tsx` | 不改；继续 `readFile() → addAsset()` |
| `src/App.tsx` | 不改；继续 `getAssetBytes() → bytesToBase64() → compileLatex()` |
| `src-tauri/src/latex.rs` | 不改；base64 路径已 OK，问题不在它 |
| `spec/2026-06-09-asset-blob-roundtrip.md` | 本文件 |

## 7. 风险

| 风险 | 应对 |
| --- | --- |
| 旧 BLOB 数据无法迁移 | UI 横幅提示重传；样本量小可以直接 `DELETE FROM resume_assets` |
| base64 让 DB 体积 +33% | 单文件 5 MB 限制下可接受；Git 同步压缩后差不多 |
| `length(bytes_b64) * 3 / 4` 反推 size 有 ±2 字节误差 | UI 显示只看个大概，不影响功能 |
| 后续若想支持 SVG/PDF，要确认 atob 大字符串性能 | 5 MB 内无性能问题；更大再分块 |

## 8. 验收

- [ ] 用户原 LaTeX 简历能编译出 PDF，5 张 logo 正确渲染。
- [ ] `getAssetBytes` round-trip 后 PNG magic 字节正确（`89 50 4E 47`）。
- [ ] DB 体积膨胀可接受（< 1.5×）。
- [ ] 旧"损坏" asset 在 UI 上给出明确提示。
- [ ] `cargo build` + `tsc && vite build` 通过。
