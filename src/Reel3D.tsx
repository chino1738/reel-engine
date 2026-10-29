/*
 * 3D style: the data reel staged in one Three.js world. Each scene is a "station" on a long
 * lit floor; the camera orbits the active station and flies to the next one between scenes.
 * Numbers, captions and labels stay as crisp DOM overlays on top (shared with the Data style).
 * Renders with concurrency 1 + ANGLE so it fits on an 8GB Mac.
 */
import { AbsoluteFill, Audio, Sequence, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig, delayRender, continueRender, Easing } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { Caption, Chrome, Counter, Statement, sfxFor, type DataProps, type DataScene } from "./Data";

const { fontFamily: DISPLAY } = loadAnton("normal", { subsets: ["latin", "latin-ext"] });
const { fontFamily: SANS } = loadInter("normal", { weights: ["800"], subsets: ["latin", "latin-ext"] });

const BG = "#0A0D13";
const GOLD = "#F5B83D";
const RED = "#FF4D3D";
const WHITE = "#F4F1EA";
const MUTED = "rgba(244,241,234,0.55)";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const GAP = 34; // world units between stations; fog hides the neighbours
const FLY = 16; // frames the camera spends flying to the next station
const CURRENCY = /^[$€£¥]$/; // plain cash only: "$B" units are not coins and not cents

const num = (v: number | string | undefined) => Number(String(v ?? 0).replace(/[^0-9.\-]/g, "")) || 0;
const fmt = (n: number, d: number) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
// "$" or "$B" style units put the symbol in front: $1.50, $39B
const withUnit = (v: string, unit = "") => (/^[$€£¥]/.test(unit) ? `${unit[0]}${v}${unit.slice(1)}` : `${v}${unit}`);
const heroOf = (items: { value: number | string }[]) => items.reduce((h, it, i) => (num(it.value) > num(items[h].value) ? i : h), 0);
const decimals = (v: number | string | undefined, money: boolean) => {
  const d = (String(v ?? "").split(".")[1] ?? "").replace(/\D/g, "").length;
  return money && d > 0 ? 2 : d;
};
// the same landing frame the overlay counter and SFX use
const landOf = (s: DataScene, fps: number) => Math.max(10, Math.round(((s.hit ?? s.start + (s.end - s.start) * 0.6) - s.start) * fps));
const barDelay = (dur: number, i: number) => Math.round(dur * 0.1 + i * Math.min(14, dur * 0.12));
// money under $12 shows as real coins (one per quarter) instead of markers
const asCoins = (s: DataScene) => CURRENCY.test(s.prefix ?? "") && num(s.value) > 0 && num(s.value) <= 12;

type Timed = DataScene & { from: number; frames: number };

// what's on the pedestal right now: the scene's subject, replaced by each beat as its word is spoken
function subjectAt(s: Timed, local: number, fps: number) {
  let src = s.show, since = 0;
  for (const b of s.beats ?? []) {
    const at = Math.round((b.at - s.start) * fps);
    if (local >= at) { src = b.show; since = at; }
  }
  return { src, since };
}

/* ── Camera: orbit the active station, fly between stations ── */

const FRAMING: Record<string, { r: number; h: number; ly: number }> = {
  bars: { r: 22, h: 7, ly: 6 },
  scale: { r: 22, h: 7, ly: 5.4 },
  coins: { r: 16, h: 5, ly: 3.8 },
  pins: { r: 17, h: 7.5, ly: 4.4 },
  pedestal: { r: 16, h: 4.5, ly: 4.6 },
};
const framingOf = (s: DataScene) =>
  s.kind === "bars" ? FRAMING.bars : s.kind === "scale" ? FRAMING.scale
  : (s.kind === "count" || s.kind === "hook") && s.value !== undefined ? (asCoins(s) ? FRAMING.coins : FRAMING.pins)
  : FRAMING.pedestal;

function pose(s: Timed, i: number, local: number) {
  const fr = framingOf(s);
  const k = Math.min(1, Math.max(0, local / s.frames));
  const a = -0.22 + k * 0.3;
  const r = fr.r * (1 - 0.1 * k);
  const cx = i * GAP;
  return { pos: new THREE.Vector3(cx + Math.sin(a) * r, fr.h + k * 0.6, Math.cos(a) * r), look: new THREE.Vector3(cx, fr.ly, 0) };
}

function activeAt(scenes: Timed[], f: number) {
  let i = scenes.findIndex((s, k) => f < (scenes[k + 1]?.from ?? Infinity));
  if (i < 0) i = scenes.length - 1;
  return i;
}

/* Frames where something lands hard: the camera kicks and the light flashes. */
function impactsOf(s: Timed, fps: number): { at: number; amp: number }[] {
  if ((s.kind === "count" || s.kind === "hook") && s.value !== undefined) return [{ at: landOf(s, fps), amp: 1 }];
  if (s.kind === "bars") return (s.items ?? []).slice(0, 4).map((_, i) => ({ at: barDelay(s.frames, i) + 10, amp: i === 0 ? 0.7 : 0.45 }));
  if (s.kind === "scale") return [{ at: Math.round(s.frames * 0.5) + 8, amp: 0.9 }];
  return [];
}
const KICK = 12;
function kickAt(s: Timed, local: number, fps: number) {
  let k = 0, age = 0;
  for (const im of impactsOf(s, fps)) {
    const a = local - im.at;
    if (a >= 0 && a < KICK) { const v = im.amp * Math.pow(1 - a / KICK, 2); if (v > k) { k = v; age = a; } }
  }
  return { k, age };
}

function cameraAt(scenes: Timed[], f: number, fps: number) {
  const i = activeAt(scenes, f);
  const local = f - scenes[i].from;
  let { pos, look } = pose(scenes[i], i, local);
  if (i > 0 && local < FLY) {
    const prev = pose(scenes[i - 1], i - 1, scenes[i - 1].frames);
    const t = Easing.inOut(Easing.cubic)(local / FLY);
    pos = prev.pos.clone().lerp(pos, t);
    look = prev.look.clone().lerp(look, t);
    pos.y += Math.sin(t * Math.PI) * 2.5; // a little lift mid-flight
  }
  // handheld drift so the camera never feels locked off
  pos.x += Math.sin(f / 37) * 0.09;
  pos.y += Math.sin(f / 29 + 1) * 0.06;
  const { k, age } = kickAt(scenes[i], local, fps);
  if (k > 0) {
    pos.lerp(look, 0.06 * k); // dolly punch toward the subject
    pos.x += Math.sin(age * 2.7) * 0.22 * k;
    pos.y += Math.cos(age * 3.3) * 0.15 * k;
  }
  return { pos, look, flash: k };
}

function Rig({ pos, look }: { pos: THREE.Vector3; look: THREE.Vector3 }) {
  const camera = useThree((s) => s.camera);
  camera.position.copy(pos);
  camera.lookAt(look);
  return null;
}

/* ── Glow: additive shader for the light beam, halos and shockwaves ── */

const GLOW_VERT = `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const GLOW_FRAG = {
  disc: `uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
void main() { float d = distance(vUv, vec2(0.5)); float a = pow(1.0 - smoothstep(0.0, 0.5, d), 2.2) * uOpacity; gl_FragColor = vec4(uColor, a); }`,
  // brightest toward the lamp, soft at the silhouette edges
  beam: `uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main() { float edge = pow(abs(dot(vN, vV)), 1.6); float a = edge * mix(0.12, 1.0, vUv.y) * uOpacity; gl_FragColor = vec4(uColor, a); }`,
  ring: `uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
void main() { float d = distance(vUv, vec2(0.5)) * 2.0; float a = smoothstep(0.78, 0.95, d) * (1.0 - smoothstep(0.95, 1.0, d)) * uOpacity; gl_FragColor = vec4(uColor, a); }`,
};
function Glow({ kind, color, opacity }: { kind: keyof typeof GLOW_FRAG; color: string; opacity: number }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG[kind], transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
  }), [kind, color]);
  mat.uniforms.uOpacity.value = opacity;
  return <primitive object={mat} attach="material" />;
}

/* The key light, its visible beam, and dust drifting through it. */
function LightRig({ x, target, flash }: { x: number; target: THREE.Object3D; flash: number }) {
  const f = useCurrentFrame();
  const H = 13, R = 4.4, N = 170;
  const dust = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = (k: string) => random(`dust-${i}-${k}`);
    const y = (r("y") * H + f * (0.006 + r("v") * 0.012)) % (H - 1);
    const rad = (1 - y / H) * R * 0.85 * Math.sqrt(r("r"));
    const th = r("t") * Math.PI * 2 + f * 0.003;
    dust[i * 3] = x + Math.cos(th) * rad + Math.sin(f / 40 + i) * 0.08;
    dust[i * 3 + 1] = y + 0.2;
    dust[i * 3 + 2] = Math.sin(th) * rad;
  }
  return (
    <>
      <spotLight position={[x + 1.2, H, 2.6]} angle={0.42} penumbra={0.75} intensity={480 * (1 + flash * 0.6)} decay={1.6} color="#FFE2B0" castShadow shadow-mapSize={[1024, 1024]} target={target} />
      <directionalLight position={[x - 6, 5, -7]} intensity={1.8} color="#7FB8FF" />
      <mesh position={[x, H / 2, 0]}>
        <coneGeometry args={[R, H, 64, 1, true]} />
        <Glow kind="beam" color="#FFD9A0" opacity={0.1 + flash * 0.08} />
      </mesh>
      <mesh position={[x, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[R * 1.15, 64]} />
        <Glow kind="disc" color="#FFD9A0" opacity={0.22 + flash * 0.25} />
      </mesh>
      <points>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[dust, 3]} /></bufferGeometry>
        <pointsMaterial size={0.055} color="#FFE6BF" transparent opacity={0.75} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
    </>
  );
}

function Shockwave({ at, local, color = GOLD, size = 7 }: { at: number; local: number; color?: string; size?: number }) {
  const age = local - at;
  if (age < 0 || age > 22) return null;
  const r = interpolate(age, [0, 22], [0.4, size], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[r, r, r]}>
      <planeGeometry args={[2, 2]} />
      <Glow kind="ring" color={color} opacity={interpolate(age, [0, 22], [1.2, 0], clamp)} />
    </mesh>
  );
}

/* ── Textures: delay the render until the scene's 3D art has loaded ── */

function useTexture(src?: string) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  const [handle] = useState(() => (src ? delayRender(`texture ${src}`) : null));
  useEffect(() => {
    if (!src || handle === null) return;
    new THREE.TextureLoader().load(
      staticFile(src),
      (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; setTex(t); continueRender(handle); },
      undefined,
      () => continueRender(handle),
    );
  }, [src, handle]);
  return tex;
}

/* ── Station pieces ── */

function Coin({ x = 0, y, z = 0, tilt = 0, spin = 0, hero = true, r = 0.8 }: { x?: number; y: number; z?: number; tilt?: number; spin?: number; hero?: boolean; r?: number }) {
  return (
    <mesh position={[x, y, z]} rotation={[tilt, spin, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[r, r, r * 0.19, 48]} />
      <meshStandardMaterial color={hero ? GOLD : "#B8C2D4"} metalness={0.45} roughness={0.3} emissive={hero ? "#5A3A00" : "#1A2030"} />
    </mesh>
  );
}

function CoinStack({ s, local }: { s: Timed; local: number }) {
  const { fps } = useVideoConfig();
  const land = landOf(s, fps);
  const n = Math.max(1, Math.min(48, Math.round(num(s.value) / 0.25)));
  const perCol = 16; // wide piles split into columns so they stay in frame
  return (
    <>
      {Array.from({ length: n }, (_, k) => {
        const at = 4 + (k / Math.max(1, n - 1)) * (land - 6);
        if (local < at) return null;
        const p = spring({ frame: local - at, fps, config: { damping: 11, mass: 0.5, stiffness: 180 } });
        const col = Math.floor(k / perCol), row = k % perCol;
        const cols = Math.ceil(n / perCol);
        return <Coin key={k} x={(col - (cols - 1) / 2) * 1.9} y={0.09 + row * 0.17 + (1 - p) * 4} spin={k * 0.6} tilt={(1 - p) * (k % 2 ? 0.4 : -0.4)} />;
      })}
    </>
  );
}

function Pins({ s, local, color }: { s: Timed; local: number; color: string }) {
  const { fps } = useVideoConfig();
  const land = landOf(s, fps);
  const N = 40;
  const pts = useMemo(() => Array.from({ length: N }, (_, i) => {
    const a = i * 2.39996; // golden-angle spiral: even spread, no clumps
    const r = 2 + Math.sqrt(i / N) * 2.6;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r * 0.9 };
  }), []);
  return (
    <>
      {pts.map((p, i) => {
        const born = 4 + Math.round(Math.pow(i / N, 0.7) * (land - 4));
        const age = local - born;
        if (age < 0) return null;
        const up = spring({ frame: age, fps, config: { damping: 10, mass: 0.4, stiffness: 200 } });
        const ring = interpolate(age, [0, 20], [0.15, 0.8], { ...clamp, easing: Easing.out(Easing.cubic) });
        const ringO = interpolate(age, [0, 20], [0.9, 0], clamp);
        return (
          <group key={i} position={[p.x, 0, p.z]}>
            <mesh position={[0, 0.28 * up, 0]} scale={[1, Math.max(0.01, up), 1]} castShadow>
              <cylinderGeometry args={[0.12, 0.12, 0.55, 16]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} scale={[ring, ring, ring]}>
              <ringGeometry args={[0.8, 1, 40]} />
              <meshBasicMaterial color={color} transparent opacity={ringO} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

function Pedestal({ src, local, x = 0, size = 3.4, cam, world }: { src?: string; local: number; x?: number; size?: number; cam: THREE.Vector3; world: [number, number] }) {
  const { fps } = useVideoConfig();
  const tex = useTexture(src);
  const p = spring({ frame: local - 3, fps, config: { damping: 10, mass: 0.6, stiffness: 150 } });
  const bob = Math.sin(local / 14) * 0.12;
  // the art always turns to face the camera, with a slow sway so it feels alive
  const yaw = Math.atan2(cam.x - (world[0] + x), cam.z - world[1]) + Math.sin(local / 30) * 0.12;
  const cy = 0.6 + size / 2 + 0.15 + bob + (1 - p) * 3;
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.7, 1.9, 0.6, 64]} />
        <meshStandardMaterial color="#1B2130" metalness={0.5} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.61, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.45, 1.6, 64]} />
        <meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.9} />
      </mesh>
      {tex && (
        <group position={[0, cy, 0]} rotation={[0, yaw, (1 - p) * -0.4]} scale={[p, p, p]}>
          <mesh position={[0, 0, -0.08]}>
            <circleGeometry args={[size * 0.85, 64]} />
            <Glow kind="disc" color={GOLD} opacity={0.32 + Math.sin(local / 10) * 0.05} />
          </mesh>
          <mesh castShadow>
            <planeGeometry args={[size, size]} />
            <meshStandardMaterial map={tex} transparent alphaTest={0.4} roughness={0.9} emissive="#ffffff" emissiveMap={tex} emissiveIntensity={0.4} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}
    </group>
  );
}

function Bars({ s, local }: { s: Timed; local: number }) {
  const { fps } = useVideoConfig();
  const items = (s.items ?? []).slice(0, 4);
  const max = Math.max(...items.map((it) => num(it.value)), 1);
  // the vertical frame is ~6 units wide here, so the row always spans about 4.6
  const gap = items.length > 1 ? Math.min(2.8, 4.6 / (items.length - 1)) : 0;
  const w = Math.min(1.7, gap * 0.62 || 1.7);
  const heroI = heroOf(items);
  return (
    <>
      {items.map((it, i) => {
        const g = spring({ frame: local - barDelay(s.frames, i), fps, config: { damping: 10, mass: 0.8, stiffness: 110 } });
        const h = Math.max(0.05, (num(it.value) / max) * 6 * g);
        const hero = i === heroI;
        return (
          <mesh key={i} position={[(i - (items.length - 1) / 2) * gap, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, w]} />
            <meshStandardMaterial color={hero ? GOLD : "#5B6578"} metalness={0.35} roughness={0.35} emissive={hero ? "#4A2E00" : "#10141C"} />
          </mesh>
        );
      })}
    </>
  );
}

// an object standing in a scale pan, turned to the camera like the pedestal art
function PanItem({ src, y, size, cam, world }: { src: string; y: number; size: number; cam: THREE.Vector3; world: [number, number] }) {
  const tex = useTexture(src);
  if (!tex) return null;
  const yaw = Math.atan2(cam.x - world[0], cam.z - world[1]);
  return (
    <group position={[0, y + size / 2, 0]} rotation={[0, yaw, 0]}>
      <mesh castShadow>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial map={tex} transparent alphaTest={0.4} roughness={0.9} emissive="#ffffff" emissiveMap={tex} emissiveIntensity={0.4} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function Scale({ s, local, cam, ox }: { s: Timed; local: number; cam: THREE.Vector3; ox: number }) {
  const { fps } = useVideoConfig();
  // coins only when the scale is weighing money; otherwise each pan holds the thing it's about
  const money = CURRENCY.test(s.unit ?? "") || CURRENCY.test(s.prefix ?? "");
  const lv = num(s.left?.value), rv = num(s.right?.value);
  const tip = spring({ frame: local - Math.round(s.frames * 0.5), fps, config: { damping: 7, mass: 0.9, stiffness: 80 } });
  const target = Math.max(-13, Math.min(13, ((rv - lv) / Math.max(lv + rv, 1)) * 26)) * (Math.PI / 180);
  const ang = target * tip;
  const arm = 3.4, py = 4.2;
  const maxV = Math.max(lv, rv, 1);
  return (
    <>
      <mesh position={[0, 0.15, 0]} receiveShadow castShadow><cylinderGeometry args={[1.5, 1.7, 0.3, 48]} /><meshStandardMaterial color="#1B2130" metalness={0.5} roughness={0.35} /></mesh>
      <mesh position={[0, py / 2, 0]} castShadow><cylinderGeometry args={[0.16, 0.22, py, 24]} /><meshStandardMaterial color="#8B95A8" metalness={0.5} roughness={0.3} /></mesh>
      <mesh position={[0, py, 0]} rotation={[0, 0, -ang]} castShadow><boxGeometry args={[arm * 2 + 0.4, 0.18, 0.3]} /><meshStandardMaterial color={WHITE} metalness={0.3} roughness={0.4} /></mesh>
      <mesh position={[0, py, 0.2]}><sphereGeometry args={[0.28, 24, 24]} /><meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.5} /></mesh>
      {[-1, 1].map((d, side) => {
        const ex = d * arm * Math.cos(ang), ey = py - d * arm * Math.sin(ang);
        const panY = ey - 1.9;
        const v = side ? rv : lv;
        const item = side ? s.right?.show : s.left?.show;
        const n = Math.max(1, Math.round((v / maxV) * 8));
        const t0 = Math.round(s.frames * (side ? 0.25 : 0.08));
        const show = spring({ frame: local - t0, fps, config: { damping: 12 } });
        return (
          <group key={d} position={[ex, 0, 0]} scale={[show, show, show]}>
            <mesh position={[0, (ey + panY) / 2, 0]}><cylinderGeometry args={[0.03, 0.03, ey - panY, 8]} /><meshStandardMaterial color="#8B95A8" /></mesh>
            <mesh position={[0, panY, 0]} castShadow receiveShadow><cylinderGeometry args={[1.2, 0.9, 0.16, 48]} /><meshStandardMaterial color="#2A303C" metalness={0.5} roughness={0.35} /></mesh>
            {!money && item && <PanItem src={item} y={panY + 0.08} size={1.3 + 1.1 * (v / maxV)} cam={cam} world={[ox + ex, 0]} />}
            {(money || !item) && Array.from({ length: n }, (_, k) => {
              const at = t0 + k * 2;
              if (local < at) return null;
              const p = spring({ frame: local - at, fps, config: { damping: 11, mass: 0.5, stiffness: 180 } });
              return <Coin key={k} r={0.6} y={panY + 0.14 + k * 0.12 + (1 - p) * 3} spin={k} hero={v >= maxV} />;
            })}
          </group>
        );
      })}
    </>
  );
}

function Station({ s, local, cam, ox }: { s: Timed; local: number; cam: THREE.Vector3; ox: number }) {
  const { fps } = useVideoConfig();
  const subj = subjectAt(s, local, fps);
  const shocks = impactsOf(s, fps).map((im, k) => <Shockwave key={`sh${k}`} at={im.at} local={local} color={s.kind === "hook" ? RED : GOLD} size={4 + im.amp * 4} />);
  let body: React.ReactNode;
  if ((s.kind === "count" || s.kind === "hook") && s.value !== undefined)
    body = asCoins(s)
      ? <><group position={[0.9, 0, 2]}><CoinStack s={s} local={local} /></group>{subj.src && <group position={[-1.3, 0, -3]}><Pedestal key={subj.src} src={subj.src} local={local - subj.since + (subj.since ? 3 : 0)} size={2.8} cam={cam} world={[ox - 1.3, -3]} /></group>}</>
      : <><Pins s={s} local={local} color={s.kind === "hook" ? RED : GOLD} />{subj.src && <Pedestal key={subj.src} src={subj.src} local={local - subj.since + (subj.since ? 3 : 0)} size={2.8} cam={cam} world={[ox, 0]} />}</>;
  else if (s.kind === "bars") body = <Bars s={s} local={local} />;
  else if (s.kind === "scale") body = <Scale s={s} local={local} cam={cam} ox={ox} />;
  else body = <Pedestal key={subj.src} src={subj.src} local={local - subj.since + (subj.since ? 3 : 0)} cam={cam} world={[ox, 0]} />;
  return <>{body}{shocks}</>;
}

function World({ scenes }: { scenes: Timed[] }) {
  const f = useCurrentFrame();
  const target = useMemo(() => new THREE.Object3D(), []);
  const i = activeAt(scenes, f);
  const { fps } = useVideoConfig();
  const cam = cameraAt(scenes, f, fps);
  target.position.set(cam.look.x, 0.5, 0); // the key light follows the camera's target
  return (
    <>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 14, 30]} />
      <Rig pos={cam.pos} look={cam.look} />
      <primitive object={target} />
      <hemisphereLight args={["#FFF4E0", "#0A0D13", 0.8]} />
      <LightRig x={cam.look.x} target={target} flash={cam.flash} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(scenes.length - 1) * GAP / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[scenes.length * GAP + 80, 80]} />
        <meshStandardMaterial color="#0F131B" metalness={0.5} roughness={0.28} />
      </mesh>
      <gridHelper args={[400, 200, "#1E2430", "#141821"]} position={[100, 0.003, 0]} />
      {scenes.map((s, k) =>
        // only the active station and its neighbours are drawn; the rest is hidden by fog anyway
        Math.abs(k - i) <= 1 ? <group key={k} position={[k * GAP, 0, 0]}><Station s={s} local={f - s.from} cam={cam.pos} ox={k * GAP} /></group> : null,
      )}
    </>
  );
}

/* ── Overlays: numbers and words stay sharp as DOM on top of the 3D ── */

function ValueRow({ s, items, delays }: { s: Timed; items: { label: string; value: number | string }[]; delays: number[] }) {
  const f = useCurrentFrame();
  const money = CURRENCY.test(s.unit ?? "");
  const heroI = heroOf(items);
  return (
    <div style={{ position: "absolute", top: 650, left: 60, right: 60, display: "flex", justifyContent: "space-around" }}>
      {items.map((it, i) => {
        const p = interpolate(f, [delays[i], delays[i] + 20], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
        const v = fmt(num(it.value) * p, decimals(it.value, money));
        const hero = i === heroI;
        return (
          <div key={i} style={{ textAlign: "center", opacity: f >= delays[i] ? 1 : 0, translate: `0px ${(1 - p) * 20}px` }}>
            <div style={{ fontFamily: DISPLAY, fontSize: items.length > 3 ? 84 : 110, color: hero ? GOLD : WHITE, lineHeight: 1 }}>{withUnit(v, s.unit)}</div>
            <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 32, color: MUTED, textTransform: "uppercase", marginTop: 10, letterSpacing: "0.03em" }}>{it.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function Label({ text }: { text?: string }) {
  if (!text) return null;
  return <div style={{ position: "absolute", top: 570, left: 0, right: 0, textAlign: "center", fontFamily: SANS, fontWeight: 800, fontSize: 40, letterSpacing: "0.08em", textTransform: "uppercase", color: MUTED }}>{text}</div>;
}

function Overlay({ s }: { s: Timed }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = interpolate(f, [s.frames - 5, s.frames], [1, 0], clamp);
  let body: React.ReactNode;
  if ((s.kind === "count" || s.kind === "hook") && s.value !== undefined) body = <Counter scene={s} y={600} size={250} />;
  else if (s.kind === "bars") {
    const items = (s.items ?? []).slice(0, 4);
    body = <><Label text={s.label} /><ValueRow s={s} items={items} delays={items.map((_, i) => barDelay(s.frames, i))} /></>;
  } else if (s.kind === "scale") {
    body = <><Label text={s.label} /><ValueRow s={s} items={[s.left ?? { label: "", value: 0 }, s.right ?? { label: "", value: 0 }]} delays={[Math.round(s.frames * 0.08), Math.round(s.frames * 0.25)]} /></>;
  } else if (s.kind === "end") {
    const p = spring({ frame: f - Math.round(s.frames * 0.45), fps, config: { damping: 10, mass: 0.6, stiffness: 160 } });
    body = (
      <>
        <Statement text={s.big ?? "Follow for more"} y={560} size={104} accent={RED} />
        <div style={{ position: "absolute", top: 860, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: Math.min(1, p * 1.5), scale: String(0.6 + p * 0.4) }}>
          <div style={{ padding: "26px 60px", borderRadius: 999, background: GOLD, color: BG, fontFamily: SANS, fontWeight: 800, fontSize: 46, letterSpacing: "0.04em" }}>FOLLOW FOR MORE</div>
        </div>
      </>
    );
  } else body = <Statement text={s.big ?? s.say} y={560} size={110} />;
  return <AbsoluteFill style={{ opacity: fade }}>{body}</AbsoluteFill>;
}

/* Film grain + vignette: takes the clean-render edge off so it reads as shot, not generated. */
function Grade() {
  const f = useCurrentFrame();
  return (
    <>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 85% 70% at 50% 55%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)" }} />
      <AbsoluteFill style={{ backgroundImage: `url(${staticFile("fx/grain.png")})`, backgroundPosition: `${Math.floor(random(`gx${f}`) * 512)}px ${Math.floor(random(`gy${f}`) * 512)}px`, opacity: 0.06 }} />
    </>
  );
}

export function Reel3D({ audio, handle, total, scenes }: DataProps) {
  const { fps } = useVideoConfig();
  const timed: Timed[] = scenes.map((s, i) => {
    const from = Math.round(s.start * fps);
    const until = Math.round((scenes[i + 1] ? scenes[i + 1].start : total + 0.6) * fps);
    return { ...s, from, frames: Math.max(1, until - from) };
  });
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Audio src={staticFile(audio)} />
      <ThreeCanvas width={1080} height={1920} shadows camera={{ fov: 38, near: 0.1, far: 120 }}>
        <World scenes={timed} />
      </ThreeCanvas>
      {/* a soft vignette keeps the overlay text readable over the lit floor */}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(10,13,19,0.85) 0%, rgba(10,13,19,0.35) 28%, rgba(10,13,19,0) 45%)" }} />
      {timed.map((s, i) => (
        <Sequence key={i} from={s.from} durationInFrames={s.frames}>
          <Overlay s={s} />
          <Caption scene={s} />
          {i > 0 && <Sequence from={-2} durationInFrames={14} layout="none"><Audio src={staticFile("sfx/whoosh.wav")} volume={0.3} /></Sequence>}
          {sfxFor(s, fps).map((x, k) => (
            <Sequence key={k} from={Math.max(0, x.at)} durationInFrames={16} layout="none"><Audio src={staticFile(`sfx/${x.src}.wav`)} volume={x.vol} /></Sequence>
          ))}
        </Sequence>
      ))}
      <Grade />
      <Chrome scenes={scenes} total={total} handle={handle} />
    </AbsoluteFill>
  );
}
