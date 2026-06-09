const PREFIX = "rv.thumb.";
const FAIL_MARKER = "__FAIL__";

export type ThumbEntry =
  | { status: "hit"; dataUrl: string }
  | { status: "fail" }
  | { status: "miss" };

function key(versionId: number, signature: string): string {
  return `${PREFIX}${versionId}.${signature}`;
}

export function getThumbnail(versionId: number, signature: string): ThumbEntry {
  try {
    const v = localStorage.getItem(key(versionId, signature));
    if (v === null) return { status: "miss" };
    if (v === FAIL_MARKER) return { status: "fail" };
    return { status: "hit", dataUrl: v };
  } catch {
    return { status: "miss" };
  }
}

export function setThumbnailFailure(
  versionId: number,
  signature: string,
): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`${PREFIX}${versionId}.`)) {
        localStorage.removeItem(k);
      }
    }
    localStorage.setItem(key(versionId, signature), FAIL_MARKER);
  } catch {
    // ignore
  }
}

export function setThumbnail(
  versionId: number,
  signature: string,
  dataUrl: string,
): void {
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
