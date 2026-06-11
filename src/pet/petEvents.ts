// Tiny typed pub/sub connecting app save/compile moments to the pet cat.
// Business code only ever calls `petEvents.emit(...)` — the pet subscribes.

export type PetEvent =
  | "saved"
  | "checkpoint"
  | "pushed"
  | "compiled"
  | "compile-error"
  | "restored"
  | "typing";

type Handler = (e: PetEvent) => void;

const handlers = new Set<Handler>();
const lastEmit = new Map<PetEvent, number>();

export const petEvents = {
  on(fn: Handler): () => void {
    handlers.add(fn);
    return () => handlers.delete(fn);
  },
  emit(e: PetEvent): void {
    for (const fn of handlers) {
      try {
        fn(e);
      } catch {
        // the pet must never break the app
      }
    }
  },
  /** Rate-limited emit — used on hot paths like editor keystrokes. */
  emitThrottled(e: PetEvent, ms: number): void {
    const now = performance.now();
    const last = lastEmit.get(e) ?? -Infinity;
    if (now - last < ms) return;
    lastEmit.set(e, now);
    petEvents.emit(e);
  },
};
