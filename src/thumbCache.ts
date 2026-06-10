const PREFIX = "rv.thumb.";
const FAIL_MARKER = "__FAIL__";

// Failures live only in memory: most are environmental (tectonic missing,
// broken asset) and self-heal after a restart. Persisting them froze cards
// on "Preview failed" forever, because the cache key (updated_at) never
// changes when the environment gets fixed.
const failedThisSession = new Set<string>();

export type ThumbEntry =
  | { status: "hit"; dataUrl: string }
  | { status: "fail" }
  | { status: "miss" };

function key(versionId: number, signature: string): string {
  return `${PREFIX}${versionId}.${signature}`;
}

export function getThumbnail(versionId: number, signature: string): ThumbEntry {
  const k = key(versionId, signature);
  if (failedThisSession.has(k)) return { status: "fail" };
  try {
    const v = localStorage.getItem(k);
    if (v === null) return { status: "miss" };
    if (v === FAIL_MARKER) {
      // Legacy persisted failure from older builds — drop it and retry.
      localStorage.removeItem(k);
      return { status: "miss" };
    }
    return { status: "hit", dataUrl: v };
  } catch {
    return { status: "miss" };
  }
}

export function setThumbnailFailure(
  versionId: number,
  signature: string,
): void {
  failedThisSession.add(key(versionId, signature));
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`${PREFIX}${versionId}.`)) {
        localStorage.removeItem(k);
      }
    }
  } catch {
    // ignore
  }
}

export function setThumbnail(
  versionId: number,
  signature: string,
  dataUrl: string,
): void {
  for (const k of failedThisSession) {
    if (k.startsWith(`${PREFIX}${versionId}.`)) failedThisSession.delete(k);
  }
  try {
    // sweep any previous signatures for this version
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`${PREFIX}${versionId}.`)) {
        localStorage.removeItem(k);
      }
    }
    localStorage.setItem(key(versionId, signature), dataUrl);
  } catch {
    // quota exceeded — drop the oldest half of cache and retry
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) keys.push(k);
      }
      for (let i = 0; i < Math.ceil(keys.length / 2); i++) {
        localStorage.removeItem(keys[i]);
      }
      localStorage.setItem(key(versionId, signature), dataUrl);
    } catch {
      // give up
    }
  }
}

export function clearAllThumbnails(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {
    // ignore
  }
}
