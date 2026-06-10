import { useCallback, useEffect, useState } from "react";
import { diffLines } from "diff";
import type { ResumeCheckpoint } from "./types";
import { deleteCheckpoint, getVersion, listCheckpoints } from "./db";
import { isGitConnected, pushHistoryUpdate, throwGitError } from "./github";
import { useSync } from "./SyncStatus";
import { useT } from "./i18n";
import { useDialogs } from "./Dialogs";

interface Props {
  versionId: number;
  currentContent: string;
  onClose: () => void;
  onRestore: (content: string) => void;
}

export default function HistoryPanel({
  versionId,
  currentContent,
  onClose,
  onRestore,
}: Props) {
  const t = useT();
  const dlg = useDialogs();
  const sync = useSync();
  const [list, setList] = useState<ResumeCheckpoint[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const rows = await listCheckpoints(versionId);
    setList(rows);
    if (rows.length && selectedId == null) setSelectedId(rows[0].id);
    if (!rows.length) setSelectedId(null);
  }, [versionId, selectedId]);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  const selected = list.find((c) => c.id === selectedId) ?? null;

  async function handleDelete(c: ResumeCheckpoint) {
    const ok = await dlg.confirm({
      title: t("delete_checkpoint_title"),
      message: t("delete_checkpoint_msg")(`v${c.seq}`),
      confirmText: t("delete"),
      cancelText: t("cancel"),
      danger: true,
    });
    if (!ok) return;
    await deleteCheckpoint(c.id);
    await refresh();
    if (isGitConnected()) {
      const v = await getVersion(versionId);
      if (!v) return;
      void sync.run(t("sync_checkpoint_delete")(c.seq, v.name), async () => {
        const r = await pushHistoryUpdate(
          versionId,
          `Delete checkpoint v${c.seq} of "${v.name}"`,
        );
        if (!r.success) throwGitError(r);
      });
    }
  }

  async function handleRestore(c: ResumeCheckpoint) {
    const ok = await dlg.confirm({
      title: t("restore_checkpoint_title"),
      message: t("restore_checkpoint_msg")(`v${c.seq}`),
      confirmText: t("restore"),
      cancelText: t("cancel"),
    });
    if (!ok) return;
    onRestore(c.content);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal history-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="history-header">
          <h3>{t("history")}</h3>
          <button className="link-btn" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="history-body">
          <ul className="history-list">
            {list.map((c) => (
              <li
                key={c.id}
                className={c.id === selectedId ? "active" : ""}
                onClick={() => setSelectedId(c.id)}
              >
                <div className="hist-row">
                  <span className="hist-tag">v{c.seq}</span>
                  <span className="hist-note">
                    {c.note?.trim() || <em className="muted">{t("no_note")}</em>}
                  </span>
                </div>
                <div className="hist-date">{c.created_at}</div>
              </li>
            ))}
            {!list.length && (
              <li className="empty">{t("no_checkpoints")}</li>
            )}
          </ul>

          <div className="history-detail">
            {selected ? (
              <>
                <div className="actions">
                  <button
                    className="primary"
                    onClick={() => handleRestore(selected)}
                  >
                    {t("restore_this")}
                  </button>
                  <button onClick={() => handleDelete(selected)}>
                    {t("delete")}
                  </button>
                </div>
                <DiffView
                  oldText={selected.content}
                  newText={currentContent}
                  oldLabel={`v${selected.seq}`}
                  newLabel={t("current")}
                />
              </>
            ) : (
              <div className="placeholder">{t("select_checkpoint")}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DiffView({
  oldText,
  newText,
  oldLabel,
  newLabel,
}: {
  oldText: string;
  newText: string;
  oldLabel: string;
  newLabel: string;
}) {
  const t = useT();
  const parts = diffLines(oldText, newText);
  const added = parts.filter((p) => p.added).reduce((n, p) => n + (p.count ?? 0), 0);
  const removed = parts.filter((p) => p.removed).reduce((n, p) => n + (p.count ?? 0), 0);

  return (
    <div className="diff">
      <div className="diff-header">
        <span className="muted">{t("diff_label")}</span>
        <span className="diff-tag old">{oldLabel}</span>
        <span className="arrow">→</span>
        <span className="diff-tag new">{newLabel}</span>
        <span className="grow" />
        <span className="diff-stat added">+{added}</span>
        <span className="diff-stat removed">−{removed}</span>
      </div>
      <pre className="diff-body">
        {parts.map((p, i) => {
          const cls = p.added ? "add" : p.removed ? "rem" : "ctx";
          const prefix = p.added ? "+ " : p.removed ? "- " : "  ";
          const lines = p.value.split("\n");
          // drop trailing empty line that comes from a final \n
          if (lines[lines.length - 1] === "") lines.pop();
          return lines.map((ln, j) => (
            <div key={`${i}-${j}`} className={`diff-ln ${cls}`}>
              <span className="diff-pfx">{prefix}</span>
              <span className="diff-txt">{ln || "​"}</span>
            </div>
          ));
        })}
      </pre>
    </div>
  );
}
