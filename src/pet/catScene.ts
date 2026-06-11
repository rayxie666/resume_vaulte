// Renderer + animation engine for the pet cat. Everything is procedural:
// a pose-blending layer (moods), one-shot action timelines, and ambient
// layers (breathing, blinking, tail sway, gaze) composited every frame.
//
// Spec: spec/2026-06-10-pet-cat-3d.md §4 §5 §7 §10.

import * as THREE from "three";
import { buildCat, type CatRig } from "./catModel";
import type { PetBrain, PetMood } from "./petState";

export interface CatSceneOptions {
  brain: PetBrain;
  /** Static portrait mode — single render, no loop. */
  reducedMotion: boolean;
}

export interface CatSceneHandle {
  /** Pointer position relative to the cat, each axis in [-1, 1]. */
  setGaze(nx: number, ny: number): void;
  /** Direction of the current petting stroke, -1..1. */
  setPetLean(dir: number): void;
  setPaused(paused: boolean): void;
  renderOnce(): void;
  dispose(): void;
}

export const CANVAS_W = 200;
export const CANVAS_H = 240;

type V3 = [number, number, number];
interface PoseEntry {
  r?: V3;
  p?: V3;
  s?: V3;
}
type Pose = Partial<Record<string, PoseEntry>>;

// Offsets from the rest (sitting) pose per mood.
const MOOD_POSES: Record<PetMood, Pose> = {
  idle: {},
  watch: {
    earL: { r: [-0.1, 0, 0.08] },
    earR: { r: [-0.1, 0, -0.08] },
  },
  typing: {
    earL: { r: [-0.08, 0, 0.06] },
    earR: { r: [-0.08, 0, -0.06] },
  },
  petted: {
    head: { r: [0.1, 0, 0] },
    earL: { r: [0.1, 0, 0.16] },
    earR: { r: [0.1, 0, -0.16] },
  },
  sleep: {
    body: { p: [0, -0.05, 0], s: [1, 0.92, 1] },
    head: { r: [0.58, 0, 0.06], p: [0, -0.085, 0] },
    earL: { r: [0.24, 0, 0.2] },
    earR: { r: [0.24, 0, -0.2] },
    legL: { r: [0.55, 0, 0] },
    legR: { r: [0.55, 0, 0] },
    tail0: { r: [0.05, 0.45, 0] },
  },
  carried: {
    body: { r: [0.32, 0, 0] },
    legL: { r: [-0.4, 0, 0.14] },
    legR: { r: [-0.4, 0, -0.14] },
    earL: { r: [0.16, 0, 0.1] },
    earR: { r: [0.16, 0, -0.1] },
    tail0: { r: [0.9, 0.7, 0] },
  },
  concerned: {
    head: { r: [0.04, 0, 0.28] },
    earL: { r: [0.32, 0, 0.28] },
    earR: { r: [0.32, 0, -0.28] },
  },
};

const MOOD_EYES_CLOSED: Partial<Record<PetMood, number>> = {
  sleep: 1,
  petted: 0.85,
};
const MOOD_PUPIL: Partial<Record<PetMood, number>> = {
  carried: 1.55,
  petted: 1.3,
};
// Fixed gaze per mood (others follow the pointer). x: + is screen right.
const MOOD_GAZE: Partial<Record<PetMood, [number, number]>> = {
  typing: [-0.75, 0.18], // editor pane, slightly down
  concerned: [0.65, 0.05], // preview pane
  sleep: [0, 0.3],
  carried: [0, -0.1],
};

const ANIMATED_NODES = [
  "root",
  "body",
  "chest",
  "head",
  "earL",
  "earR",
  "legL",
  "legR",
  "tail0",
  "tail1",
  "tail2",
  "tail3",
  "tail4",
] as const;

const smooth = THREE.MathUtils.smoothstep;
const damp = THREE.MathUtils.damp;

/** min(ramp-in, ramp-out) envelope: 0→1→0 with smooth shoulders. */
function env(p: number, a: number, b: number): number {
  return Math.min(smooth(p, 0, a), 1 - smooth(p, b, 1));
}

export function createCatScene(
  canvas: HTMLCanvasElement,
  opts: CatSceneOptions,
): CatSceneHandle | null {
  if (!canvas.getContext("webgl2")) return null; // fur needs gl_InstanceID

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(CANVAS_W, CANVAS_H, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, CANVAS_W / CANVAS_H, 0.1, 10);
  camera.position.set(0, 0.6, 2.95);
  camera.lookAt(0, 0.5, 0);

  scene.add(new THREE.HemisphereLight(0xfff1dd, 0x6a5d4e, 1.4));
  const key = new THREE.DirectionalLight(0xffeed0, 1.6);
  key.position.set(0.45, 0.7, 0.7);
  scene.add(key);

  const rig: CatRig = buildCat();
  scene.add(rig.group);

  // Base transforms = the rest pose; everything else is offsets on top.
  const base = new Map<
    string,
    { r: THREE.Euler; p: THREE.Vector3; s: THREE.Vector3 }
  >();
  const cur = new Map<string, { r: V3; p: V3; s: V3 }>();
  for (const name of ANIMATED_NODES) {
    const o = rig.nodes[name];
    base.set(name, {
      r: o.rotation.clone(),
      p: o.position.clone(),
      s: o.scale.clone(),
    });
    cur.set(name, { r: [0, 0, 0], p: [0, 0, 0], s: [0, 0, 0] });
  }

  // --- brass dust burst (celebrate-big) ------------------------------------
  const P_N = 42;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(P_N * 3);
  const pCol = new Float32Array(P_N * 3);
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
  const pVel = new Float32Array(P_N * 3);
  const pLife = new Float32Array(P_N); // 0 = dead
  const pMat = new THREE.PointsMaterial({
    size: 0.032,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  points.visible = false;
  scene.add(points);
  const BRASS = new THREE.Color("#d9b36a");

  function burst(): void {
    for (let i = 0; i < P_N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.18 + Math.random() * 0.12;
      pPos[i * 3] = Math.cos(a) * r;
      pPos[i * 3 + 1] = 0.25 + Math.random() * 0.3;
      pPos[i * 3 + 2] = Math.sin(a) * r * 0.6 + 0.1;
      pVel[i * 3] = Math.cos(a) * (0.25 + Math.random() * 0.35);
      pVel[i * 3 + 1] = 0.7 + Math.random() * 0.9;
      pVel[i * 3 + 2] = Math.sin(a) * 0.25;
      pLife[i] = 0.9 + Math.random() * 0.45;
    }
    points.visible = true;
  }

  function updateParticles(dt: number): void {
    if (!points.visible) return;
    let alive = false;
    for (let i = 0; i < P_N; i++) {
      if (pLife[i] <= 0) continue;
      alive = true;
      pLife[i] -= dt;
      pVel[i * 3 + 1] -= 1.7 * dt;
      pPos[i * 3] += pVel[i * 3] * dt;
      pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
      pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      // Additive blending: fading to black = fading out.
      const f = Math.max(pLife[i], 0);
      pCol[i * 3] = BRASS.r * f;
      pCol[i * 3 + 1] = BRASS.g * f;
      pCol[i * 3 + 2] = BRASS.b * f;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
    if (!alive) points.visible = false;
  }

  // --- ambient state ---------------------------------------------------------
  let gazeX = 0;
  let gazeY = 0.1;
  let headYaw = 0;
  let headPitch = 0;
  let eyeYaw = 0;
  let eyePitch = 0;
  let petLean = 0;
  let petLeanCur = 0;
  let eyesClosedCur = 0;
  let pupilCur = 1;
  let nextBlink = performance.now() + 2500;
  let blinkStart = -1;
  let nextTwitch = performance.now() + 5000;
  let twitchStart = -1;
  let twitchEar: "earL" | "earR" = "earR";
  let burstFiredFor = -1;

  // --- additive application helpers ------------------------------------------
  function addR(name: string, x: number, y: number, z: number): void {
    const o = rig.nodes[name];
    o.rotation.x += x;
    o.rotation.y += y;
    o.rotation.z += z;
  }
  function addP(name: string, x: number, y: number, z: number): void {
    rig.nodes[name].position.x += x;
    rig.nodes[name].position.y += y;
    rig.nodes[name].position.z += z;
  }
  function addS(name: string, x: number, y: number, z: number): void {
    rig.nodes[name].scale.x += x;
    rig.nodes[name].scale.y += y;
    rig.nodes[name].scale.z += z;
  }

  let blinkExtra = 0; // one-shot actions can force a blink

  function applyAction(name: string, p: number): void {
    switch (name) {
      case "wake-stretch": {
        const arch = Math.sin(p * Math.PI);
        addR("body", 0.28 * arch, 0, 0);
        addR("legL", -0.75 * arch, 0, 0);
        addR("legR", -0.75 * arch, 0, 0);
        addR("head", -0.4 * arch, 0, 0);
        addP("body", 0, -0.025 * arch, 0.02 * arch);
        blinkExtra = Math.max(blinkExtra, 1 - p);
        break;
      }
      case "invite-paw": {
        const lift = env(p, 0.2, 0.82);
        const tap =
          p > 0.25 && p < 0.75
            ? Math.sin(((p - 0.25) / 0.5) * Math.PI * 4) * 0.2
            : 0;
        addR("legR", (-1.05 + tap) * lift, 0, -0.12 * lift);
        addR("body", -0.07 * lift, 0, -0.04 * lift);
        addR("head", -0.08 * lift, 0, 0);
        break;
      }
      case "invite-stretch": {
        const e = env(p, 0.3, 0.7);
        addR("body", 0.48 * e, 0, 0);
        addP("body", 0, -0.045 * e, 0.05 * e);
        addR("legL", -1.05 * e, 0, 0);
        addR("legR", -1.05 * e, 0, 0);
        addR("head", -0.55 * e, 0, 0);
        addR("tail0", -0.7 * e, 0, 0);
        break;
      }
      case "invite-tailchase": {
        const e = env(p, 0.2, 0.85);
        const spin = smooth(p, 0.08, 0.92) * Math.PI * 2;
        addR("root", 0, spin, 0);
        addS("body", 0, -0.05 * e, 0);
        addR("head", 0.1 * e, 0.7 * e, 0);
        for (let i = 1; i < 5; i++) addR(`tail${i}`, 0, 0.28 * e, 0);
        break;
      }
      case "celebrate-small": {
        const e = Math.sin(Math.min(p * 1.15, 1) * Math.PI);
        addS("body", 0, 0.045 * e, 0);
        addR("head", -0.13 * e, 0, 0);
        addR("tail0", -1.15 * e, -0.3 * e, 0);
        for (let i = 1; i < 5; i++) {
          addR(`tail${i}`, 0.25 * e, Math.sin(p * Math.PI * 5) * 0.3 * e, 0);
        }
        blinkExtra = Math.max(blinkExtra, 0.5 * e);
        break;
      }
      case "celebrate-glance": {
        const e = env(p, 0.25, 0.75);
        addR("tail3", -0.45 * Math.sin(p * Math.PI), 0, 0);
        addR("tail4", -0.45 * Math.sin(p * Math.PI), 0, 0);
        addR("earL", -0.12 * e, 0, 0.06 * e);
        addR("earR", -0.12 * e, 0, -0.06 * e);
        break;
      }
      case "celebrate-big": {
        if (p >= 0.16 && burstFiredFor === -1) {
          burstFiredFor = 1;
          burst();
        }
        if (p < 0.16) {
          const c = Math.sin((p / 0.16) * Math.PI * 0.5);
          addS("body", 0, -0.09 * c, 0);
        } else if (p < 0.62) {
          const q = (p - 0.16) / 0.46;
          addP("root", 0, 0.3 * 4 * q * (1 - q), 0);
          addS("body", 0, 0.06 * Math.sin(q * Math.PI), 0);
          addR("legL", -0.5 * Math.sin(q * Math.PI), 0, 0.15);
          addR("legR", -0.5 * Math.sin(q * Math.PI), 0, -0.15);
        } else if (p < 0.74) {
          const c = Math.sin(((p - 0.62) / 0.12) * Math.PI);
          addS("body", 0, -0.07 * c, 0);
        }
        const after = smooth(p, 0.62, 0.8) * (1 - smooth(p, 0.92, 1));
        addR("tail0", -1.2 * after, 0, 0);
        for (let i = 1; i < 5; i++) {
          addR(`tail${i}`, 0.2 * after, Math.sin(p * Math.PI * 7) * 0.3 * after, 0);
        }
        break;
      }
      case "celebrate-nod": {
        addR("head", 0.28 * Math.sin(p * Math.PI), 0, 0);
        break;
      }
      case "surprise-shake": {
        addR("head", 0, Math.sin(p * Math.PI * 6) * (1 - p) * 0.32, 0);
        addR("earL", 0.12 * (1 - p), 0, 0.1 * (1 - p));
        addR("earR", 0.12 * (1 - p), 0, -0.1 * (1 - p));
        break;
      }
      case "poke-flick": {
        const e = Math.sin(p * Math.PI);
        addR("earR", 0.12 * e, 0, -0.38 * e);
        addR("head", -0.07 * e, 0, 0);
        addP("head", 0, 0, -0.012 * e);
        break;
      }
      case "blink-ack": {
        blinkExtra = Math.max(blinkExtra, Math.sin(p * Math.PI));
        addR("tail4", 0, 0.35 * Math.sin(p * Math.PI), 0);
        break;
      }
    }
  }

  // Per-mood tail sway: [amplitude, speed Hz].
  const TAIL: Record<PetMood, [number, number]> = {
    idle: [0.07, 0.4],
    watch: [0.09, 0.55],
    typing: [0.17, 1.4],
    petted: [0.12, 0.3],
    sleep: [0.015, 0.15],
    carried: [0.05, 0.5],
    concerned: [0.12, 1.8],
  };

  function animate(dt: number, now: number): void {
    const brain = opts.brain;
    brain.update();
    const mood = brain.mood;
    const action = brain.action;
    if (action?.name !== "celebrate-big") burstFiredFor = -1;

    // 1) Mood pose blending: damp offsets toward the mood's targets.
    const pose = MOOD_POSES[mood];
    const lambda = 4.5;
    for (const name of ANIMATED_NODES) {
      const c = cur.get(name)!;
      const t = pose[name];
      for (let k = 0; k < 3; k++) {
        c.r[k] = damp(c.r[k], t?.r?.[k] ?? 0, lambda, dt);
        c.p[k] = damp(c.p[k], t?.p?.[k] ?? 0, lambda, dt);
        const st = t?.s ? t.s[k] - 1 : 0;
        c.s[k] = damp(c.s[k], st, lambda, dt);
      }
      const b = base.get(name)!;
      const o = rig.nodes[name];
      o.rotation.set(b.r.x + c.r[0], b.r.y + c.r[1], b.r.z + c.r[2]);
      o.position.set(b.p.x + c.p[0], b.p.y + c.p[1], b.p.z + c.p[2]);
      o.scale.set(b.s.x + c.s[0], b.s.y + c.s[1], b.s.z + c.s[2]);
    }

    // 2) One-shot action layer.
    blinkExtra = 0;
    if (action) {
      applyAction(action.name, Math.min((now - action.start) / action.dur, 1));
    }

    // 3) Ambient layers ------------------------------------------------------
    const ts = now / 1000;

    // Breathing.
    if (mood === "sleep") {
      addS("body", 0, 0.02 * Math.sin(ts * Math.PI * 2 * 0.22), 0);
    } else {
      addS("chest", 0.006 * Math.sin(ts * Math.PI * 2 * 0.35), 0.013 * Math.sin(ts * Math.PI * 2 * 0.35), 0);
    }
    // Purr tremble while petted.
    if (mood === "petted") {
      addS("body", 0, 0.005 * Math.sin(ts * Math.PI * 2 * 2), 0);
    }

    // Tail sway.
    const [amp, speed] = TAIL[mood];
    for (let i = 0; i < 5; i++) {
      const w = 0.25 + i * 0.3;
      addR(
        `tail${i}`,
        0,
        Math.sin(ts * Math.PI * 2 * speed - i * 0.7) * amp * w,
        0,
      );
    }

    // Gaze: pointer-driven unless the mood pins it.
    const pinned = MOOD_GAZE[mood];
    let gx = pinned ? pinned[0] : gazeX;
    let gy = pinned ? pinned[1] : gazeY;
    if (action?.name === "invite-paw") {
      gx = 0;
      gy = -0.1; // up toward the user
    } else if (action?.name === "celebrate-glance") {
      gx = 0.7;
      gy = -0.05;
    } else if (action?.name === "celebrate-nod") {
      gx = 0.75;
      gy = -0.85; // up toward the sync badge
    }
    const yawT = THREE.MathUtils.clamp(gx, -1, 1) * 0.6;
    const pitchT = THREE.MathUtils.clamp(gy, -1, 1) * 0.42;
    headYaw = damp(headYaw, yawT * 0.8, 6, dt);
    headPitch = damp(headPitch, pitchT * 0.8, 6, dt);
    // Eyes lead the head — they are faster and cover the remainder.
    eyeYaw = damp(eyeYaw, THREE.MathUtils.clamp(yawT - headYaw, -0.35, 0.35), 16, dt);
    eyePitch = damp(eyePitch, THREE.MathUtils.clamp(pitchT - headPitch, -0.3, 0.3), 16, dt);
    if (mood !== "sleep") {
      addR("head", headPitch, headYaw, 0);
      rig.nodes.eyeL.rotation.set(eyePitch, eyeYaw, 0);
      rig.nodes.eyeR.rotation.set(eyePitch, eyeYaw, 0);
    }

    // Lean into the petting hand.
    petLeanCur = damp(petLeanCur, mood === "petted" ? petLean : 0, 6, dt);
    addR("head", 0, petLeanCur * 0.18, petLeanCur * 0.14);

    // Blinking.
    let closed = MOOD_EYES_CLOSED[mood] ?? 0;
    if (blinkStart < 0 && now >= nextBlink && closed < 0.5) {
      blinkStart = now;
      nextBlink = now + 2000 + Math.random() * 4000;
    }
    if (blinkStart >= 0) {
      const bp = (now - blinkStart) / 150;
      if (bp >= 1) blinkStart = -1;
      else closed = Math.max(closed, Math.sin(bp * Math.PI));
    }
    closed = Math.max(closed, blinkExtra);
    eyesClosedCur = damp(eyesClosedCur, closed, 22, dt);
    rig.setEyesClosed(eyesClosedCur);

    // Pupils.
    pupilCur = damp(pupilCur, MOOD_PUPIL[mood] ?? 1, 8, dt);
    rig.setPupil(pupilCur);

    // Ear twitch.
    if (twitchStart < 0 && now >= nextTwitch && mood !== "sleep") {
      twitchStart = now;
      twitchEar = Math.random() < 0.5 ? "earL" : "earR";
      nextTwitch = now + 4000 + Math.random() * 5000;
    }
    if (twitchStart >= 0) {
      const tp = (now - twitchStart) / 160;
      if (tp >= 1) twitchStart = -1;
      else {
        addR(twitchEar, 0.1 * Math.sin(tp * Math.PI), 0, (twitchEar === "earL" ? 1 : -1) * 0.16 * Math.sin(tp * Math.PI));
      }
    }

    updateParticles(dt);
  }

  // --- loop -------------------------------------------------------------------
  let raf = 0;
  let paused = false;
  let lastRender = 0;
  let lastTick = performance.now();
  let disposed = false;

  function needsFastFps(): boolean {
    const b = opts.brain;
    if (b.action) return true;
    return b.mood !== "idle" && b.mood !== "sleep";
  }

  function frame(now: number): void {
    if (paused || disposed) return;
    raf = requestAnimationFrame(frame);
    const fps = needsFastFps() ? 60 : 12;
    if (now - lastRender < 1000 / fps - 1) return;
    const dt = Math.min((now - lastTick) / 1000, 0.1);
    lastTick = now;
    lastRender = now;
    animate(dt, now);
    renderer.render(scene, camera);
  }

  if (!opts.reducedMotion) {
    raf = requestAnimationFrame(frame);
  } else {
    // One settled portrait: rest pose, eyes open, no loop.
    animate(0.016, performance.now());
    renderer.render(scene, camera);
  }

  return {
    setGaze(nx, ny) {
      gazeX = nx;
      gazeY = ny;
    },
    setPetLean(dir) {
      petLean = THREE.MathUtils.clamp(dir, -1, 1);
    },
    setPaused(p) {
      if (disposed || p === paused) return;
      paused = p;
      if (p) {
        cancelAnimationFrame(raf);
      } else if (!opts.reducedMotion) {
        lastTick = performance.now();
        raf = requestAnimationFrame(frame);
      }
    },
    renderOnce() {
      if (disposed) return;
      animate(0.016, performance.now());
      renderer.render(scene, camera);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      rig.dispose();
      pGeo.dispose();
      pMat.dispose();
      renderer.dispose();
    },
  };
}
