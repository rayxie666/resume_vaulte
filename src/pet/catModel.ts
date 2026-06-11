// Procedurally built fluffy tabby kitten with shell fur.
// No external model asset: the body is assembled from lathe/sphere parts,
// each furry part gets an instanced stack of "shells" displaced along the
// normals — the classic real-time fur technique (one draw call per part).
//
// Look reference (user-provided photo): long-haired tabby kitten — golden
// face, grey-brown striped coat, cream ruff/chest and paws, big round eyes.
// Spec: spec/2026-06-10-pet-cat-3d.md §2 §11 (procedural variant approved
// by the user in lieu of a purchased GLB).

import * as THREE from "three";

export const SHELLS = 16;

// ---------------------------------------------------------------------------
// Textures (generated once, shared)
// ---------------------------------------------------------------------------

/** Grey-brown tabby: dense soft stripes + fine grain speckle. */
function makeTabbyTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;

  g.fillStyle = "#9b8878"; // grey-brown base coat
  g.fillRect(0, 0, 512, 512);
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, "rgba(120,96,66,0.5)"); // darker along the spine
  grad.addColorStop(0.55, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(238,224,198,0.7)"); // pale underside
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);

  // Tabby stripes: many thin, soft, slightly broken vertical strokes.
  g.lineCap = "round";
  for (let i = 0; i < 26; i++) {
    const x0 = (i + 0.5) * 20 + (Math.random() - 0.5) * 10;
    g.strokeStyle = `rgba(64,52,38,${0.36 + Math.random() * 0.26})`;
    g.lineWidth = 3.5 + Math.random() * 4;
    let y = -8;
    while (y < 380) {
      const seg = 30 + Math.random() * 50;
      const x = x0 + Math.sin(y * 0.02 + i * 1.7) * 10;
      g.beginPath();
      g.moveTo(x + (Math.random() - 0.5) * 6, y);
      g.lineTo(x + (Math.random() - 0.5) * 6, y + seg);
      g.stroke();
      y += seg + 14 + Math.random() * 26; // gaps → broken stripes
    }
  }
  // Fine fur grain.
  for (let i = 0; i < 12000; i++) {
    const v = Math.random();
    g.fillStyle =
      v < 0.5 ? "rgba(255,244,220,0.06)" : "rgba(52,40,26,0.05)";
    g.fillRect(Math.random() * 512, Math.random() * 512, 1, 2 + Math.random() * 4);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Per-texel random — thresholded per shell to carve fur strands. */
function makeFurNoiseTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.floor(Math.pow(Math.random(), 0.8) * 255);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------------------------------------------------------------------------
// Fur shader (shared by the base "skin" pass and the instanced shell pass)
// ---------------------------------------------------------------------------

const FUR_VERT = /* glsl */ `
uniform float uShells;
uniform float uFurLen;
out vec2 vUv;
out float vShell;
out vec3 vN;
out vec3 vWp;
void main() {
  #ifdef INSTANCED
    float shell = (float(gl_InstanceID) + 1.0) / uShells;
  #else
    float shell = 0.0;
  #endif
  vShell = shell;
  vUv = uv;
  vec3 n = normalize(normal);
  vec3 p = position + n * uFurLen * shell;
  // Strands droop a little under gravity toward the tip.
  p.y -= uFurLen * shell * shell * 0.45;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWp = wp.xyz;
  vN = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FUR_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform sampler2D uNoise;
uniform float uNoiseScale;
uniform vec3 uTint;
uniform float uCream; // blend toward cream where the surface faces forward
uniform float uGold;  // blend toward golden where the surface faces forward
in vec2 vUv;
in float vShell;
in vec3 vN;
in vec3 vWp;
out vec4 outColor;
void main() {
  if (vShell > 0.0) {
    float nz = texture(uNoise, vUv * uNoiseScale).r;
    // Strands thin out toward the tip.
    if (nz < vShell * (0.78 + 0.3 * vShell)) discard;
  }
  vec3 base = texture(uMap, vUv).rgb * uTint;
  vec3 N = normalize(vN);

  // Regional coloring driven by world orientation (UV-layout agnostic):
  // forward-facing fur → cream chest / golden face, like the reference kitten.
  float front = smoothstep(0.35, 0.95, N.z);
  base = mix(base, vec3(0.95, 0.90, 0.80), front * uCream);
  base = mix(base, vec3(0.83, 0.63, 0.40), front * uGold);

  // Hemisphere fill (warm lamp above, soft bounce below).
  vec3 hemi = mix(vec3(0.52, 0.47, 0.42), vec3(1.0, 0.97, 0.92), N.y * 0.5 + 0.5);
  vec3 L = normalize(vec3(0.45, 0.7, 0.7));
  float dif = max(dot(N, L), 0.0);
  vec3 col = base * (hemi * 0.78 + vec3(1.0, 0.95, 0.86) * dif * 0.7);

  // Self-shadowing: darker roots, bright cream-tipped strands.
  float depth = vShell > 0.0 ? vShell : 0.35;
  col *= mix(0.62, 1.22, depth);
  col = mix(col, col * vec3(1.06, 1.02, 0.94), vShell * 0.5);

  // Soft rim so the silhouette reads as backlit fluff.
  vec3 V = normalize(cameraPosition - vWp);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.2);
  col += vec3(0.5, 0.44, 0.34) * rim * (0.2 + 0.6 * depth);

  outColor = vec4(col, 1.0);
}
`;

export interface FurMaterialPair {
  skin: THREE.ShaderMaterial;
  shells: THREE.ShaderMaterial;
}

interface FurOpts {
  furLen: number;
  noiseScale: number;
  tint?: THREE.ColorRepresentation;
  cream?: number;
  gold?: number;
}

function makeFurMaterials(
  map: THREE.Texture,
  noise: THREE.Texture,
  o: FurOpts,
): FurMaterialPair {
  const uniforms = () => ({
    uMap: { value: map },
    uNoise: { value: noise },
    uShells: { value: SHELLS },
    uFurLen: { value: o.furLen },
    uNoiseScale: { value: o.noiseScale },
    uTint: { value: new THREE.Color(o.tint ?? 0xffffff) },
    uCream: { value: o.cream ?? 0 },
    uGold: { value: o.gold ?? 0 },
  });
  const skin = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FUR_VERT,
    fragmentShader: FUR_FRAG,
    uniforms: uniforms(),
  });
  const shells = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FUR_VERT,
    fragmentShader: FUR_FRAG,
    uniforms: uniforms(),
    defines: { INSTANCED: "" },
    side: THREE.DoubleSide,
  });
  return { skin, shells };
}

// ---------------------------------------------------------------------------
// Cat assembly
// ---------------------------------------------------------------------------

export interface CatRig {
  group: THREE.Group;
  /** Named animation pivots. */
  nodes: Record<string, THREE.Object3D>;
  /** Ordered base→tip tail pivots (subset of nodes). */
  tail: THREE.Object3D[];
  /** 0 = open, 1 = closed. */
  setEyesClosed(amount: number): void;
  /** 1 = normal, up to ~1.8 dilated. */
  setPupil(scale: number): void;
  dispose(): void;
}

export function buildCat(): CatRig {
  const tabby = makeTabbyTexture();
  const noise = makeFurNoiseTexture();
  const disposables: { dispose(): void }[] = [tabby, noise];
  const nodes: Record<string, THREE.Object3D> = {};

  const furBody = makeFurMaterials(tabby, noise, {
    furLen: 0.075,
    noiseScale: 4.0,
    cream: 0.22,
  });
  const furHead = makeFurMaterials(tabby, noise, {
    furLen: 0.045,
    noiseScale: 6.0,
    gold: 0.45,
  });
  const furCheek = makeFurMaterials(tabby, noise, {
    furLen: 0.065,
    noiseScale: 5.0,
    gold: 0.45,
    cream: 0.15,
  });
  const furRuff = makeFurMaterials(tabby, noise, {
    furLen: 0.09,
    noiseScale: 4.0,
    cream: 0.6,
  });
  const furCream = makeFurMaterials(tabby, noise, {
    furLen: 0.022,
    noiseScale: 9.0,
    tint: 0xfff1dc,
    cream: 0.5,
  });
  const furEar = makeFurMaterials(tabby, noise, {
    furLen: 0.014,
    noiseScale: 9.0,
    tint: 0xd2bb9e,
    gold: 0.3,
  });
  const furTail = makeFurMaterials(tabby, noise, {
    furLen: 0.08,
    noiseScale: 4.5,
  });
  const furSets = [furBody, furHead, furCheek, furRuff, furCream, furEar, furTail];
  for (const f of furSets) disposables.push(f.skin, f.shells);

  /** Base mesh + instanced shell stack, parented together. */
  function furry(geo: THREE.BufferGeometry, mats: FurMaterialPair): THREE.Group {
    disposables.push(geo);
    const g = new THREE.Group();
    const base = new THREE.Mesh(geo, mats.skin);
    const shells = new THREE.InstancedMesh(geo, mats.shells, SHELLS);
    // Identity per-instance transforms — displacement happens in the shader.
    const m = new THREE.Matrix4();
    for (let i = 0; i < SHELLS; i++) shells.setMatrixAt(i, m);
    shells.frustumCulled = false;
    g.add(base, shells);
    return g;
  }

  const root = new THREE.Group();
  nodes.root = root;
  const body = new THREE.Group();
  nodes.body = body;
  root.add(body);

  // --- seated kitten torso: small, round, wide-hipped ----------------------
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(0.001, 0.0),
    new THREE.Vector2(0.245, 0.012),
    new THREE.Vector2(0.28, 0.10),
    new THREE.Vector2(0.265, 0.2),
    new THREE.Vector2(0.23, 0.32),
    new THREE.Vector2(0.2, 0.42),
    new THREE.Vector2(0.165, 0.5),
    new THREE.Vector2(0.12, 0.56),
    new THREE.Vector2(0.001, 0.59),
  ];
  const torsoGeo = new THREE.LatheGeometry(profile, 36);
  torsoGeo.scale(0.95, 1, 0.98);
  torsoGeo.translate(0, 0, -0.05);
  body.add(furry(torsoGeo, furBody));

  // Haunches bulging at the sides.
  for (const s of [-1, 1]) {
    const g = new THREE.SphereGeometry(0.14, 20, 16);
    g.scale(0.85, 0.78, 1.2);
    g.translate(s * 0.165, 0.13, -0.02);
    body.add(furry(g, furBody));
  }
  // Hind paws peeking out beside the front legs (cream like the reference).
  for (const s of [-1, 1]) {
    const g = new THREE.SphereGeometry(0.05, 14, 10);
    g.scale(1, 0.6, 1.65);
    g.translate(s * 0.17, 0.032, 0.2);
    body.add(furry(g, furCream));
  }

  // --- front legs (slim, cream) ---------------------------------------------
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.09, 0.3, 0.17);
    nodes[s < 0 ? "legL" : "legR"] = shoulder;
    const legGeo = new THREE.CylinderGeometry(0.036, 0.044, 0.3, 12);
    legGeo.translate(0, -0.13, 0);
    const leg = furry(legGeo, furCream);
    const pawGeo = new THREE.SphereGeometry(0.052, 14, 10);
    pawGeo.scale(1, 0.62, 1.4);
    pawGeo.translate(0, -0.27, 0.025);
    leg.add(furry(pawGeo, furCream));
    shoulder.add(leg);
    body.add(shoulder);
  }

  // --- chest / ruff / head ----------------------------------------------------
  const chest = new THREE.Group();
  chest.position.set(0, 0.42, 0.02);
  nodes.chest = chest;
  body.add(chest);

  // The fluffy cream ruff bursting out under the chin…
  const ruffGeo = new THREE.SphereGeometry(0.13, 20, 16);
  ruffGeo.scale(1.0, 0.82, 0.55);
  ruffGeo.translate(0, 0.06, 0.1);
  chest.add(furry(ruffGeo, furRuff));
  // …continuing as a cream bib down between the front legs.
  const bibGeo = new THREE.SphereGeometry(0.125, 18, 14);
  bibGeo.scale(0.85, 1.25, 0.5);
  bibGeo.translate(0, 0.22, 0.16);
  body.add(furry(bibGeo, furRuff));

  const head = new THREE.Group();
  head.position.set(0, 0.34, 0.05); // world ≈ (0, 0.76)
  nodes.head = head;
  chest.add(head);

  // Big kitten skull.
  const skullGeo = new THREE.SphereGeometry(0.185, 32, 24);
  skullGeo.scale(1.02, 0.94, 0.9);
  head.add(furry(skullGeo, furHead));

  // Fluffy cheeks widening the lower face.
  for (const s of [-1, 1]) {
    const g = new THREE.SphereGeometry(0.085, 18, 14);
    g.scale(0.8, 0.55, 0.55);
    g.translate(s * 0.105, -0.06, 0.09);
    head.add(furry(g, furCheek));
  }

  // Small cream muzzle low on the face.
  const muzzleGeo = new THREE.SphereGeometry(0.062, 18, 14);
  muzzleGeo.scale(1.25, 0.7, 0.75);
  muzzleGeo.translate(0, -0.08, 0.152);
  head.add(furry(muzzleGeo, furCream));

  // Nose — tiny soft pink triangle.
  const noseGeo = new THREE.ConeGeometry(0.016, 0.013, 3, 1);
  noseGeo.rotateX(Math.PI / 2);
  noseGeo.rotateZ(Math.PI);
  const noseMat = new THREE.MeshStandardMaterial({
    color: 0xc08070,
    roughness: 0.35,
  });
  const nose = new THREE.Mesh(noseGeo, noseMat);
  nose.position.set(0, -0.055, 0.208);
  head.add(nose);
  disposables.push(noseGeo, noseMat);

  // --- ears: wide-set, generous, light inner fur ------------------------------
  const innerMat = new THREE.MeshStandardMaterial({
    color: 0xd8b9a4,
    roughness: 0.95,
  });
  disposables.push(innerMat);
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(s * 0.115, 0.13, -0.015);
    ear.rotation.set(-0.1, s * 0.12, s * 0.42);
    nodes[s < 0 ? "earL" : "earR"] = ear;
    const earGeo = new THREE.ConeGeometry(0.07, 0.145, 18);
    earGeo.scale(1, 1, 0.42);
    earGeo.translate(0, 0.068, 0);
    ear.add(furry(earGeo, furEar));
    const innerGeo = new THREE.ConeGeometry(0.045, 0.11, 14);
    innerGeo.scale(1, 1, 0.26);
    innerGeo.translate(0, 0.05, 0.018);
    const inner = new THREE.Mesh(innerGeo, innerMat);
    ear.add(inner);
    disposables.push(earGeo, innerGeo);
    head.add(ear);
  }

  // --- eyes: big, round, green-grey — the heart of the kitten look ------------
  const eyeballMat = new THREE.MeshStandardMaterial({
    color: 0x9aa878, // green-grey iris
    roughness: 0.12,
    emissive: 0x2a3018,
    emissiveIntensity: 0.55,
  });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x0d0b08 });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xfffbef });
  disposables.push(eyeballMat, pupilMat, glintMat);
  const pupils: THREE.Object3D[] = [];
  const lids: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(s * 0.082, 0.012, 0.135);
    nodes[s < 0 ? "eyeL" : "eyeR"] = eye;
    const ballGeo = new THREE.SphereGeometry(0.047, 20, 16);
    const ball = new THREE.Mesh(ballGeo, eyeballMat);
    eye.add(ball);
    // Big round kitten pupil floating just off the iris.
    const pupilGeo = new THREE.CircleGeometry(0.026, 20);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(0, 0, 0.0445);
    eye.add(pupil);
    pupils.push(pupil);
    const glintGeo = new THREE.CircleGeometry(0.009, 10);
    const glint = new THREE.Mesh(glintGeo, glintMat);
    glint.position.set(-0.013, 0.015, 0.049);
    eye.add(glint);
    const glint2Geo = new THREE.CircleGeometry(0.004, 8);
    const glint2 = new THREE.Mesh(glint2Geo, glintMat);
    glint2.position.set(0.012, -0.008, 0.049);
    eye.add(glint2);
    disposables.push(ballGeo, pupilGeo, glintGeo, glint2Geo);
    head.add(eye);

    // Eyelid: fur-colored cap that rotates down over the eye.
    const lidGeo = new THREE.SphereGeometry(
      0.051,
      18,
      10,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.55,
    );
    const lid = new THREE.Mesh(lidGeo, furHead.skin);
    lid.position.copy(eye.position);
    lid.rotation.x = -1.5; // tucked up into the brow when open
    lids.push(lid);
    disposables.push(lidGeo);
    head.add(lid);
  }

  // --- whiskers -----------------------------------------------------------------
  const whiskerMat = new THREE.LineBasicMaterial({
    color: 0xf8f0e0,
    transparent: true,
    opacity: 0.45,
  });
  const whiskerPts: THREE.Vector3[] = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const y = -0.065 - i * 0.012;
      const droop = i * 0.018;
      whiskerPts.push(
        new THREE.Vector3(s * 0.045, y, 0.175),
        new THREE.Vector3(s * 0.26, y + 0.03 - droop, 0.1),
      );
    }
  }
  const whiskerGeo = new THREE.BufferGeometry().setFromPoints(whiskerPts);
  const whiskers = new THREE.LineSegments(whiskerGeo, whiskerMat);
  head.add(whiskers);
  disposables.push(whiskerGeo, whiskerMat);

  // --- tail: five pivots of dense fluff curling around the flank ---------------
  const tail: THREE.Object3D[] = [];
  let parent: THREE.Object3D = body;
  const tailRest: [number, number, number][] = [
    [0.12, 1.45, 0],
    [0, 0.5, 0],
    [0, 0.48, 0],
    [-0.04, 0.45, 0],
    [-0.08, 0.4, 0],
  ];
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Group();
    if (i === 0) seg.position.set(0.02, 0.085, -0.21);
    else seg.position.set(0, 0, 0.115);
    seg.rotation.set(...tailRest[i]);
    nodes[`tail${i}`] = seg;
    tail.push(seg);
    const r0 = 0.042 - i * 0.005;
    const segGeo = new THREE.CylinderGeometry(r0 - 0.004, r0, 0.125, 10);
    segGeo.rotateX(Math.PI / 2);
    segGeo.translate(0, 0, 0.06);
    seg.add(furry(segGeo, furTail));
    if (i === 4) {
      const tipGeo = new THREE.SphereGeometry(0.032, 10, 8);
      tipGeo.translate(0, 0, 0.125);
      seg.add(furry(tipGeo, furTail));
    }
    parent.add(seg);
    parent = seg;
  }

  // --- contact shadow --------------------------------------------------------------
  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = shadowCanvas.height = 128;
  const sg = shadowCanvas.getContext("2d")!;
  const rad = sg.createRadialGradient(64, 64, 8, 64, 64, 62);
  rad.addColorStop(0, "rgba(0,0,0,0.4)");
  rad.addColorStop(1, "rgba(0,0,0,0)");
  sg.fillStyle = rad;
  sg.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false,
  });
  const shadowGeo = new THREE.PlaneGeometry(0.95, 0.8);
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.004;
  root.add(shadow);
  disposables.push(shadowTex, shadowMat, shadowGeo);

  return {
    group: root,
    nodes,
    tail,
    setEyesClosed(amount: number) {
      const a = THREE.MathUtils.clamp(amount, 0, 1);
      for (const lid of lids) lid.rotation.x = -1.5 * (1 - a);
    },
    setPupil(scale: number) {
      for (const p of pupils) {
        p.scale.set(scale, scale, 1);
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
