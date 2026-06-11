// The pet cat overlay: a fixed corner stage hosting the 3D scene, plus all
// pointer interaction (gaze, stroke-to-pet, poke, carry-to-corner), the
// speech bubble, quiet-room detection and the purr loop.
//
// Spec: spec/2026-06-10-pet-cat-3d.md §3 §5 §6 §9.

import { useCallback, useEffect, useRef, useState } from "react";
import { petEvents } from "./petEvents";
import { PetBrain } from "./petState";
import { Purr } from "./purr";
import { useT } from "../i18n";
import type { CatSceneHandle } from "./catScene";

export type PetCorner = "br" | "bl" | "tr" | "tl";
export interface PetConfig {
  enabled: boolean;
  sound: boolean;
  corner: PetCorner;
}

const CFG_EVENT = "rv-pet-config";

export function getPetConfig(): PetConfig {
  const corner = localStorage.getItem("rv-pet-corner") as PetCorner | null;
  return {
    enabled: localStorage.getItem("rv-pet-on") !== "0",
    sound: localStorage.getItem("rv-pet-sound") === "1",
    corner: corner === "bl" || corner === "tr" || corner === "tl" ? corner : "br",
  };
}

export function setPetConfig(patch: Partial<PetConfig>): void {
  if (patch.enabled !== undefined) {
    localStorage.setItem("rv-pet-on", patch.enabled ? "1" : "0");
  }
  if (patch.sound !== undefined) {
    localStorage.setItem("rv-pet-sound", patch.sound ? "1" : "0");
  }
  if (patch.corner !== undefined) {
    localStorage.setItem("rv-pet-corner", patch.corner);
  }
  window.dispatchEvent(new Event(CFG_EVENT));
}

export function isPetUnsupported(): boolean {
  return localStorage.getItem("rv-pet-unsupported") === "1";
}

export function usePetConfig(): PetConfig {
  const [cfg, setCfg] = useState(getPetConfig);
  useEffect(() => {
    const onChange = () => setCfg(getPetConfig());
    window.addEventListener(CFG_EVENT, onChange);
    return () => window.removeEventListener(CFG_EVENT, onChange);
  }, []);
  return cfg;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function PetOverlay() {
  const cfg = usePetConfig();
  const reduced = useReducedMotion();
  const [unsupported, setUnsupported] = useState(isPetUnsupported);
  const markUnsupported = useCallback(() => setUnsupported(true), []);
  if (!cfg.enabled || unsupported) return null;
  return (
    <PetStage
      key={reduced ? "static" : "live"}
      cfg={cfg}
      reduced={reduced}
      onUnsupported={markUnsupported}
    />
  );
}

/** Anything that demands quiet: open modals, the compile-error drawer. */
function roomIsQuiet(): boolean {
  return document.querySelector(".modal-backdrop, .compile-error") !== null;
}

function PetStage({
  cfg,
  reduced,
  onUnsupported,
}: {
  cfg: PetConfig;
  reduced: boolean;
  onUnsupported: () => void;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<CatSceneHandle | null>(null);
  const brainRef = useRef<PetBrain | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const bubbleTimer = useRef(0);
  const [lifted, setLifted] = useState(false);
  const [carryPos, setCarryPos] = useState<{ x: number; y: number } | null>(null);

  const showBubble = useCallback((text: string) => {
    setBubble(text);
    window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(null), 2500);
  }, []);

  // Keep latest strings without retriggering the main effect.
  const bubbleTextRef = useRef({ meow: "", saved: "" });
  bubbleTextRef.current = {
    meow: t("pet_bubble_meow"),
    saved: t("pet_bubble_saved"),
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    const brain = new PetBrain({
      now: () => performance.now(),
      isQuiet: roomIsQuiet,
      random: Math.random,
      onBubble: () => showBubble(bubbleTextRef.current.meow),
    });
    brainRef.current = brain;

    const offEvents = petEvents.on((e) => {
      if (reduced && (e === "saved" || e === "checkpoint")) {
        showBubble(bubbleTextRef.current.saved);
        return;
      }
      brain.handleEvent(e);
    });

    void import("./catScene").then((mod) => {
      if (cancelled) return;
      const scene = mod.createCatScene(canvas, { brain, reducedMotion: reduced });
      if (!scene) {
        localStorage.setItem("rv-pet-unsupported", "1");
        onUnsupported();
        return;
      }
      localStorage.removeItem("rv-pet-unsupported");
      sceneRef.current = scene;
    });

    // Global activity → gaze + wake; never reads key content.
    const onMove = (e: MouseEvent) => {
      brain.pointerActive();
      const el = containerRef.current;
      const scene = sceneRef.current;
      if (!el || !scene) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height * 0.4; // head height
      const nx = Math.max(-1, Math.min(1, (e.clientX - cx) / (window.innerWidth * 0.45)));
      const ny = Math.max(-1, Math.min(1, (e.clientY - cy) / (window.innerHeight * 0.45)));
      scene.setGaze(nx, ny);
    };
    const onKey = () => brain.keyActive();
    document.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("keydown", onKey, { passive: true });

    // Pause rendering when the window is hidden or unfocused.
    const syncPaused = () => {
      sceneRef.current?.setPaused(document.hidden || !document.hasFocus());
    };
    document.addEventListener("visibilitychange", syncPaused);
    window.addEventListener("blur", syncPaused);
    window.addEventListener("focus", syncPaused);

    // Purr loop while petted (sound is opt-in).
    const purr = new Purr();
    const purrTimer = window.setInterval(() => {
      const wantPurr =
        !reduced &&
        getPetConfig().sound &&
        brainRef.current?.mood === "petted" &&
        !document.hidden;
      if (wantPurr) purr.start();
      else purr.stop();
    }, 400);

    // Yield the corner to the select-bar / sync-badge.
    const syncLift = () => {
      setLifted(
        document.querySelector(".select-bar, .sync-badge") !== null,
      );
    };
    const mo = new MutationObserver(syncLift);
    mo.observe(document.body, { childList: true, subtree: false });
    const appEl = document.querySelector(".app");
    if (appEl) mo.observe(appEl, { childList: true, subtree: false });
    syncLift();

    return () => {
      cancelled = true;
      offEvents();
      document.removeEventListener("mousemove", onMove);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", syncPaused);
      window.removeEventListener("blur", syncPaused);
      window.removeEventListener("focus", syncPaused);
      window.clearInterval(purrTimer);
      window.clearTimeout(bubbleTimer.current);
      purr.stop();
      mo.disconnect();
      sceneRef.current?.dispose();
      sceneRef.current = null;
      brainRef.current = null;
    };
  }, [reduced, showBubble, onUnsupported]);

  // --- hit-area gestures: poke / stroke-to-pet / carry-to-corner ------------
  const gesture = useRef<{
    active: boolean;
    mode: "tap" | "stroke" | "carry";
    startX: number;
    startY: number;
    lastX: number;
    dirSign: number;
    reversals: number;
  } | null>(null);

  function onHitDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    gesture.current = {
      active: true,
      mode: "tap",
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      dirSign: 0,
      reversals: 0,
    };
  }

  function onHitMove(e: React.PointerEvent) {
    const g = gesture.current;
    const brain = brainRef.current;
    if (!g?.active || !brain) return;
    if (g.mode === "carry") {
      setCarryPos({ x: e.clientX, y: e.clientY });
      return;
    }
    const dx = e.clientX - g.lastX;
    if (Math.abs(dx) > 2) {
      const sign = Math.sign(dx);
      if (g.dirSign !== 0 && sign !== g.dirSign) {
        g.reversals += 1;
        g.mode = "stroke";
        if (g.reversals >= 2) {
          brain.strokeTick();
          sceneRef.current?.setPetLean(sign);
        }
      }
      g.dirSign = sign;
      g.lastX = e.clientX;
    }
    const dist = Math.hypot(e.clientX - g.startX, e.clientY - g.startY);
    if (g.mode === "tap" && dist > 24) {
      g.mode = "carry";
      brain.setCarried(true);
      setCarryPos({ x: e.clientX, y: e.clientY });
    }
  }

  function onHitUp(e: React.PointerEvent) {
    const g = gesture.current;
    const brain = brainRef.current;
    gesture.current = null;
    if (!g || !brain) return;
    if (g.mode === "carry") {
      brain.setCarried(false);
      setCarryPos(null);
      const corner: PetCorner = `${
        e.clientY < window.innerHeight / 2 ? "t" : "b"
      }${e.clientX < window.innerWidth / 2 ? "l" : "r"}` as PetCorner;
      setPetConfig({ corner });
    } else if (g.mode === "tap") {
      brain.poke();
    }
  }

  const carryStyle = carryPos
    ? {
        left: Math.max(0, Math.min(window.innerWidth - 200, carryPos.x - 100)),
        top: Math.max(0, Math.min(window.innerHeight - 240, carryPos.y - 150)),
        right: "auto",
        bottom: "auto",
      }
    : undefined;

  return (
    <div
      ref={containerRef}
      className={[
        "pet-overlay",
        `pet-${cfg.corner}`,
        lifted ? "pet-lifted" : "",
        carryPos ? "pet-carrying" : "",
      ].join(" ")}
      style={carryStyle}
      aria-hidden="true"
    >
      {bubble && <div className="pet-bubble">{bubble}</div>}
      <canvas ref={canvasRef} className="pet-canvas" width={200} height={240} />
      <div
        className="pet-hit"
        onPointerEnter={() => brainRef.current?.hover()}
        onPointerDown={onHitDown}
        onPointerMove={onHitMove}
        onPointerUp={onHitUp}
        onPointerCancel={() => {
          brainRef.current?.setCarried(false);
          gesture.current = null;
          setCarryPos(null);
        }}
      />
    </div>
  );
}
