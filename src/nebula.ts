// "Ink Nebula" background — brass dust drifting through a perspective
// volume over two or three breathing fog glows. Zero dependencies:
// Canvas 2D + hand-rolled projection, all glows pre-baked into sprites.
//
// Spec: spec/2026-06-10-nebula-background.md. Hard rules: ≤320 particles,
// ≤2ms/frame, no per-frame allocation, no ctx.filter/shadowBlur, alpha caps
// per theme, 12fps when the window is unfocused, static frame under
// prefers-reduced-motion.

export interface NebulaHandle {
  destroy(): void;
}

const MAX_STARS = 320;
const Z_NEAR = 0.4;
const Z_FAR = 2.4;
const SPEED = (Z_FAR - Z_NEAR) / 90; // full traversal ≈ 90s
const PARALLAX_PX = 6;
const SPRITE = 32; // star sprite size (core glow baked in)
const FOG_MAX = 800; // fog sprite size cap (memory budget)

interface ThemeParams {
  /** Star colors: ~9:1 brass to ink. Hex ≈ the oklch brand tokens. */
  star: [string, string];
  starAlpha: number;
  sizeMin: number;
  sizeMax: number;
  /** Projected-radius multiplier (light theme dust is finer). */
  sizeScale: number;
  composite: GlobalCompositeOperation;
  fogAlpha: number;
  /** Fog blob colors — ink, ink, brass. */
  fog: [string, string, string];
}

const DARK: ThemeParams = {
  star: ["#dcb878", "#86aede"], // brass oklch(0.8 0.115 83) / ink oklch(0.72 0.09 245)
  starAlpha: 0.55,
  sizeMin: 0.5,
  sizeMax: 1.8,
  sizeScale: 2.5,
  composite: "lighter",
  fogAlpha: 0.06,
  fog: ["#3c5a86", "#3c5a86", "#8a6f3c"],
};

const LIGHT: ThemeParams = {
  // Dark dust on paper, not glow: bronze oklch(0.5 0.11 78) / ink oklch(0.48 0.1 250)
  star: ["#7e6228", "#3a6191"],
  starAlpha: 0.35,
  sizeMin: 0.4,
  sizeMax: 1.2,
  sizeScale: 1.8,
  composite: "source-over",
  fogAlpha: 0.035,
  fog: ["#5577a8", "#5577a8", "#a08850"],
};

/** Fog blob anchors hug the corners — the viewport center stays clear. */
const FOG_BLOBS = [
  { ax: 0.12, ay: 0.16, period: 45, phase: 0.0 },
  { ax: 0.9, ay: 0.78, period: 70, phase: 2.1 },
  { ax: 0.74, ay: 0.06, period: 100, phase: 4.4 },
] as const;

function makeStarSprite(color: string, dark: boolean): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = SPRITE;
  const g = c.getContext("2d")!;
  const half = SPRITE / 2;
  const grad = g.createRadialGradient(half, half, 0, half, half, half);
  if (dark) {
    // Glowing mote: hot core, soft halo.
    grad.addColorStop(0, color);
    grad.addColorStop(0.22, color);
    grad.addColorStop(0.55, `${color}40`);
    grad.addColorStop(1, `${color}00`);
  } else {
    // Ink fleck on paper: tight, barely any halo.
    grad.addColorStop(0, color);
    grad.addColorStop(0.4, `${color}b0`);
    grad.addColorStop(0.7, `${color}28`);
    grad.addColorStop(1, `${color}00`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, SPRITE, SPRITE);
  return c;
}

function makeFogSprite(color: string, size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const half = size / 2;
  const grad = g.createRadialGradient(half, half, 0, half, half, half);
  // Blur is baked into the gradient falloff — never ctx.filter at runtime.
  // Gaussian-ish stops, then dithered: at fog alpha caps (≤0.06) an 8-bit
  // radial gradient shows concentric banding without per-pixel noise.
  grad.addColorStop(0, color);
  grad.addColorStop(0.2, `${color}d9`);
  grad.addColorStop(0.4, `${color}8c`);
  grad.addColorStop(0.6, `${color}47`);
  grad.addColorStop(0.8, `${color}1a`);
  grad.addColorStop(1, `${color}00`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  const data = img.data;
  // Dither amplitude must reach ~one quantization step AFTER the ≤0.06
  // globalAlpha composite (≈1/0.06 ≈ 17 sprite-alpha units), or the rings
  // survive the noise.
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    if (a > 0 && a < 250) {
      data[i] = Math.max(0, Math.min(255, a + ((Math.random() * 48) | 0) - 24));
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function createNebula(canvas: HTMLCanvasElement): NebulaHandle {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { destroy() {} };

  // --- state (preallocated; nothing allocates inside the loop) -------------
  const xs = new Float32Array(MAX_STARS);
  const ys = new Float32Array(MAX_STARS);
  const zs = new Float32Array(MAX_STARS);
  const sizes = new Float32Array(MAX_STARS);
  const phases = new Float32Array(MAX_STARS);
  const hues = new Uint8Array(MAX_STARS); // 0 brass, 1 ink

  let w = 0;
  let h = 0;
  let dpr = 1;
  let count = 0;
  let theme = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? DARK
    : LIGHT;
  let starSprites: [HTMLCanvasElement, HTMLCanvasElement] = [
    makeStarSprite(theme.star[0], theme === DARK),
    makeStarSprite(theme.star[1], theme === DARK),
  ];
  let fogSprites: HTMLCanvasElement[] = [];
  let raf = 0;
  let running = false;
  let blurred = false;
  let lastTick = 0;
  let lastRender = 0;
  let parallaxX = 0;
  let parallaxY = 0;
  let targetPX = 0;
  let targetPY = 0;
  let destroyed = false;

  const reducedMq = window.matchMedia("(prefers-reduced-motion: reduce)");
  const darkMq = window.matchMedia("(prefers-color-scheme: dark)");

  function spawn(i: number, initial: boolean): void {
    const aspect = w > 0 && h > 0 ? w / h : 1.5;
    xs[i] = (Math.random() * 2 - 1) * 1.5 * Math.max(aspect, 1);
    ys[i] = (Math.random() * 2 - 1) * 1.5;
    // Initial fill spreads stars through the whole volume; respawns at far.
    zs[i] = initial ? Z_NEAR + Math.random() * (Z_FAR - Z_NEAR) : Z_FAR;
    sizes[i] = Math.random();
    phases[i] = Math.random() * Math.PI * 2;
    hues[i] = Math.random() < 0.9 ? 0 : 1; // 9:1 brass
  }

  function rebuildFog(): void {
    const size = Math.min(FOG_MAX, Math.round(Math.max(w, h) * 0.6)) || 256;
    fogSprites = theme.fog.map((c) => makeFogSprite(c, size));
  }

  function step(dt: number): void {
    for (let i = 0; i < count; i++) {
      zs[i] -= SPEED * dt;
      if (zs[i] < Z_NEAR) spawn(i, false);
    }
    // Low-pass the pointer into a gentle camera offset.
    parallaxX += (targetPX - parallaxX) * 0.05;
    parallaxY += (targetPY - parallaxY) * 0.05;
  }

  function draw(t: number): void {
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.clearRect(0, 0, w, h);
    ctx!.globalCompositeOperation = "source-over";

    // Fog first, under the dust.
    for (let b = 0; b < FOG_BLOBS.length; b++) {
      const blob = FOG_BLOBS[b];
      const sprite = fogSprites[b];
      if (!sprite) continue;
      const ph = (t * Math.PI * 2) / blob.period + blob.phase;
      const cx = blob.ax * w + Math.sin(ph) * w * 0.04 + parallaxX * 0.5;
      const cy = blob.ay * h + Math.cos(ph * 0.8) * h * 0.04 + parallaxY * 0.5;
      const scale = 1 + 0.05 * Math.sin(ph * 1.3);
      const s = sprite.width * scale;
      ctx!.globalAlpha = theme.fogAlpha * (0.75 + 0.25 * Math.sin(ph * 0.7));
      ctx!.drawImage(sprite, cx - s / 2, cy - s / 2, s, s);
    }

    // Dust through a perspective projection.
    ctx!.globalCompositeOperation = theme.composite;
    const f = h * 0.55;
    const cx0 = w / 2 + parallaxX;
    const cy0 = h / 2 + parallaxY;
    for (let i = 0; i < count; i++) {
      const z = zs[i];
      const depth = Z_NEAR / z; // 1 near → ~0.17 far
      const sx = cx0 + (xs[i] / z) * f;
      const sy = cy0 + (ys[i] / z) * f;
      const r =
        (theme.sizeMin + sizes[i] * (theme.sizeMax - theme.sizeMin)) *
        depth *
        theme.sizeScale;
      const d = r * 8; // sprite halo padding
      if (sx < -d || sx > w + d || sy < -d || sy > h + d) continue;
      const twinkle = 0.85 + 0.15 * Math.sin(t * 0.8 + phases[i]);
      ctx!.globalAlpha = theme.starAlpha * depth * twinkle;
      ctx!.drawImage(starSprites[hues[i]], sx - d / 2, sy - d / 2, d, d);
    }
    ctx!.globalAlpha = 1;
    ctx!.globalCompositeOperation = "source-over";
  }

  function renderStatic(): void {
    step(0);
    draw(8); // arbitrary fixed time → frozen mid-breath
  }

  function frame(now: number): void {
    if (!running || destroyed) return;
    raf = requestAnimationFrame(frame);
    const minInterval = blurred ? 1000 / 12 : 0;
    if (now - lastRender < minInterval - 1) return;
    const dt = Math.min((now - lastTick) / 1000, 0.1);
    lastTick = now;
    lastRender = now;
    step(dt);
    draw(now / 1000);
  }

  function start(): void {
    if (running || destroyed || reducedMq.matches) return;
    running = true;
    lastTick = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop(): void {
    running = false;
    cancelAnimationFrame(raf);
  }

  // --- environment listeners -------------------------------------------------
  const onVisibility = () => {
    if (document.hidden) stop();
    else start();
  };
  const onBlur = () => {
    blurred = true;
  };
  const onFocus = () => {
    blurred = false;
  };
  const onMove = (e: MouseEvent) => {
    targetPX = -(e.clientX / Math.max(w, 1) - 0.5) * 2 * PARALLAX_PX;
    targetPY = -(e.clientY / Math.max(h, 1) - 0.5) * 2 * PARALLAX_PX;
  };
  const onTheme = () => {
    theme = darkMq.matches ? DARK : LIGHT;
    starSprites = [
      makeStarSprite(theme.star[0], theme === DARK),
      makeStarSprite(theme.star[1], theme === DARK),
    ];
    rebuildFog();
    if (reducedMq.matches) renderStatic();
  };
  const onReduced = () => {
    if (reducedMq.matches) {
      stop();
      renderStatic();
    } else {
      start();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  window.addEventListener("mousemove", onMove, { passive: true });
  darkMq.addEventListener("change", onTheme);
  reducedMq.addEventListener("change", onReduced);

  const ro = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, Math.round(rect.width));
    h = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const prev = count;
    count = Math.min(MAX_STARS, Math.floor((w * h) / 4800));
    for (let i = prev; i < count; i++) spawn(i, true);
    rebuildFog();
    if (reducedMq.matches || !running) renderStatic();
  });
  ro.observe(canvas);

  if (!document.hidden) start();
  blurred = !document.hasFocus();

  return {
    destroy() {
      destroyed = true;
      stop();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("mousemove", onMove);
      darkMq.removeEventListener("change", onTheme);
      reducedMq.removeEventListener("change", onReduced);
    },
  };
}
