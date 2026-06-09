import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import type { AssetUsage } from "./types";
import {
  deleteAsset,
  getAssetBytes,
  listAllAssets,
  renameAsset,
  upsertAsset,
} from "./db";
import { useT } from "./i18n";
import { useDialogs } from "./Dialogs";

const MAX_BYTES = 5 * 1024 * 1024;

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

export default function AssetsPanel() {
  const t = useT();
  const dlg = useDialogs();
  const [list, setList] = useState<AssetUsage[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});

  const refresh = useCallback(async () => {
    const rows = await listAllAssets();
    setList(rows);
    // build thumbnails for image MIMEs
    const next: Record<number, string> = {};
    for (const a of rows) {
      if (a.mime && a.mime.startsWith("image/")) {
        const bytes = await getAssetBytes(a.id);
        if (bytes) {
          const blob = new Blob([bytes as BlobPart], { type: a.mime });
          next[a.id] = URL.createObjectURL(blob);
        }
      }
    }
    setThumbs((prev) => {
      // revoke previous URLs
      for (const k of Object.keys(prev)) URL.revokeObjectURL(prev[Number(k)]);
      return next;
    });
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
    return () => {
      setThumbs((prev) => {
        for (const k of Object.keys(prev)) URL.revokeObjectURL(prev[Number(k)]);
        return {};
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () =>
      query
        ? list.filter((a) =>
            a.name.toLowerCase().includes(query.toLowerCase()),
          )
        : list,
    [list, query],
  );

  async function handleAdd() {
    const picked = await open({
      multiple: true,
      filters: [
        { name: "Image", extensions: ["png", "jpg", "jpeg", "pdf", "eps", "svg"] },
      ],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    setBusy(true);
    try {
      for (const p of paths) {
        const bytes = await readFile(p);
        if (bytes.length > MAX_BYTES) {
          await dlg.confirm({
            title: basename(p),
            message: t("attachment_too_large")(5),
            confirmText: t("ok"),
            cancelText: t("cancel"),
          });
          continue;
        }
        await upsertAsset(basename(p), bytes);
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(a: AssetUsage) {
    const name = await dlg.prompt({
      title: t("rename_attachment"),
      label: t("attachment_name"),
      defaultValue: a.name,
      confirmText: t("save"),
      cancelText: t("cancel"),
    });
    if (!name || name === a.name) return;
    await renameAsset(a.id, name);
    await refresh();
  }

  async function handleDelete(a: AssetUsage) {
    const ok = await dlg.confirm({
      title: t("delete"),
      message:
        a.usage_count > 0
          ? t("asset_delete_with_usage")(a.name, a.usage_count)
          : a.name,
      confirmText: t("delete"),
      cancelText: t("cancel"),
      danger: true,
    });
    if (!ok) return;
    await deleteAsset(a.id);
    await refresh();
  }

  async function handleCopyName(a: AssetUsage) {
    try {
      await navigator.clipboard.writeText(a.name);
    } catch {
      // ignore
    }
  }

  return (
    <div className="assets-view">
      <div className="assets-toolbar">
        <input
          className="assets-search"
          placeholder={t("search_assets")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="primary"
          disabled={busy}
          onClick={handleAdd}
        >
          + {t("add_attachment")}
        </button>
      </div>
      {filtered.length === 0 ? (
        <div className="assets-empty">
          {list.length === 0 ? t("no_assets") : t("no_assets_filtered")}
        </div>
      ) : (
        <div className="assets-grid">
          {filtered.map((a) => (
            <div key={a.id} className="asset-card">
              <div className="asset-thumb">
                {thumbs[a.id] ? (
                  <img src={thumbs[a.id]} alt={a.name} />
                ) : (
                  <span className="asset-mono">
                    {(a.name.split(".").pop() ?? "?").toUpperCase()}
                  </span>
                )}
              </div>
              <div className="asset-meta">
                <div className="asset-name" title={a.name}>
                  {a.name}
                </div>
                <div className="asset-sub">
                  {formatSize(a.size)} ·{" "}
                  {t("asset_usage_count")(a.usage_count)}
                </div>
              </div>
              <div className="asset-actions">
                <button
                  className="link-btn"
                  title={t("copy_reference_name")}
                  onClick={() => handleCopyName(a)}
                >
                  ⧉
                </button>
                <button
                  className="link-btn"
                  title={t("rename_attachment")}
                  onClick={() => handleRename(a)}
                >
                  ✎
                </button>
                <button
                  className="link-btn danger"
                  title={t("delete")}
                  onClick={() => handleDelete(a)}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
