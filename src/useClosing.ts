import { useEffect, useRef, useState } from "react";

/**
 * Exit-animation helpers. Both are timeout-driven on purpose — never
 * animation-event-driven — so reduced-motion (where animations collapse to
 * 0ms) still completes every state transition.
 */

/** Keep a conditionally-rendered element mounted through its exit animation.
 *  Render while `mounted`; set `data-closing` while `closing`. */
export function useClosing(
  open: boolean,
  ms = 160,
): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    setClosing(true);
    const id = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, ms);
    return () => window.clearTimeout(id);
  }, [open, ms]);
  return { mounted: open || mounted, closing: !open && closing };
}

/** For modals that unmount via a parent callback: intercept the close,
 *  play the exit, then notify the parent. */
export function useModalExit(
  onClose: () => void,
  ms = 160,
): { closing: boolean; close: () => void } {
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );
  const close = () => {
    if (closing) return;
    setClosing(true);
    timer.current = window.setTimeout(onClose, ms);
  };
  return { closing, close };
}
