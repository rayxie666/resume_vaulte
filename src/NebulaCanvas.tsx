// React shell for the ink-nebula background (spec/2026-06-10-nebula-background.md).
// Mounting starts the loop; unmounting (editor view, settings off) fully
// stops rAF and frees the canvas — the lifecycle rules live in App.tsx.

import { useEffect, useRef, useState } from "react";
import { createNebula } from "./nebula";

const STORAGE_KEY = "rv.nebula";
const CFG_EVENT = "rv-nebula-config";

export function getNebulaEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== "0";
}

export function setNebulaEnabled(on: boolean): void {
  localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  window.dispatchEvent(new Event(CFG_EVENT));
}

export function useNebulaEnabled(): boolean {
  const [on, setOn] = useState(getNebulaEnabled);
  useEffect(() => {
    const onChange = () => setOn(getNebulaEnabled());
    window.addEventListener(CFG_EVENT, onChange);
    return () => window.removeEventListener(CFG_EVENT, onChange);
  }, []);
  return on;
}

export default function NebulaCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const nebula = createNebula(canvas);
    return () => nebula.destroy();
  }, []);
  return <canvas ref={ref} className="nebula" aria-hidden="true" />;
}
