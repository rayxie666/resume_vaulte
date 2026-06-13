import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import type { Asset, AssetUsage } from "./types";
import {
  getAssetByName,
  getVersion,
  linkAssetToVersion,
  listAllAssets,
  listAssetsForVersion,
  unlinkAssetFromVersion,
  upsertAsset,
} from "./db";
import {
  isGitConnected,
  pushAssetsUpsert,
  pushAttachmentsUpdate,
  throwGitError,
} from "./github";
import { useSync } from "./SyncStatus";
import { useT } from "./i18n";
import { useDialogs } from "./Dialogs";
import { useModalExit } from "./useClosing";

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

export default function AttachmentsModal({
  versionId,
  onClose,
  onChanged,
}: {
  versionId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const dlg = useDialogs();
  const sync = useSync();
  const { closing, close } = useModalExit(onClose);
  const [linked, setLinked] = useState<Asset[]>([]);
  const [library, setLibrary] = useState<AssetUsage[]>([]);
  const [busy, setBusy] = useState(false);

  // link/unlink only touch the version's meta json on the remote (§A4).
  function pushLinkChange() {
    if (!isGitConnected()) return;
    void (async () => {
      const v = await getVersion(versionId);
      if (!v) return;
      void sync.run(t("sync_attachments_update")(v.name), async () => {
        const r = await pushAttachmentsUpdate(versionId, v.name);
        if (!r.success) throwGitError(r);
      });
    })();
  }

  const refresh = useCallback(async () => {
    setLinked(await listAssetsForVersion(versionId));
    setLibrary(await listAllAssets());
  }, [versionId]);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  const linkedIds = useMemo(
    () => new Set(linked.map((a) => a.id)),
    [linked],
  );
  const libraryUnlinked = useMemo(
    () => library.filter((a) => !linkedIds.has(a.id)),
    [library, linkedIds],
  );

  async function handleUpload() {
    const picked = await open({
      multiple: true,
      filters: [
        { name: "Image", extensions: ["png", "jpg", "jpeg", "pdf", "eps", "svg"] },
      ],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    setBusy(true);
    const uploaded: { name: string; isNew: boolean }[] = [];
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
        const name = basename(p);
        const isNew = (await getAssetByName(name)) == null;
        const id = await upsertAsset(name, bytes);
        await linkAssetToVersion(versionId, id);
        uploaded.push({ name, isNew });
      }
      await refresh();
      onChanged();
    } finally {
      setBusy(false);
    }
    if (uploaded.length > 0 && isGitConnected()) {
      const names = uploaded.map((u) => u.name);
      const msg =
        uploaded.length === 1
          ? `${uploaded[0].isNew ? "Add" : "Update"} asset "${uploaded[0].name}"`
          : `Update ${uploaded.length} assets`;
      void sync.run(t("sync_asset_add")(names.join(", ")), async () => {
        const r = await pushAssetsUpsert(names, msg, versionId);
        if (!r.success) throwGitError(r);
      });
    }
  }

  async function handleLink(a: AssetUsage) {
    await linkAssetToVersion(versionId, a.id);
    await refresh();
    onChanged();
    pushLinkChange();
  }

  async function handleUnlink(a: Asset) {
    await unlinkAssetFromVersion(versionId, a.id);
    await refresh();
    onChanged();
    pushLinkChange();
  }

  // Portal to <body> so the backdrop escapes the `.content` stacking context
  // (which sits below the navbar) and correctly covers the whole window.
  return createPortal(
    <div
      className="modal-backdrop"
      data-closing={closing || undefined}
      onClick={close}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("attachments")}</h3>

        {linked.length === 0 ? (
          <p className="dlg-message">{t("no_attachments")}</p>
        ) : (
          <ul className="att-list">
            {linked.map((a) => (
              <li key={a.id}>
                <span className="att-name" title={a.name}>
                  {a.name}
                </span>
                <span className="att-size">{formatSize(a.size)}</span>
                <button
                  className="att-del"
                  title={t("delete")}
                  onClick={() => handleUnlink(a)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {libraryUnlinked.length > 0 && (
          <>
            <div className="field">
              <span>{t("link_from_library")}</span>
              <ul className="att-list compact">
                {libraryUnlinked.map((a) => (
                  <li key={a.id}>
                    <span className="att-name" title={a.name}>
                      {a.name}
                    </span>
                    <span className="att-size">{formatSize(a.size)}</span>
                    <button
                      className="att-link"
                      title={t("link_from_library")}
                      onClick={() => handleLink(a)}
                    >
                      +
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        <div className="modal-actions">
          <button onClick={close}>{t("done")}</button>
          <button className="primary" disabled={busy} onClick={handleUpload}>
            + {t("add_attachment")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
