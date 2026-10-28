/*
 * Demo style: every visual acts out the words being spoken.
 * The script marks beats ("on the word 'spills', the water bottle spills"); each beat is an
 * object + a verb, and lands on that word's timestamp from the voice track.
 */
import { AbsoluteFill, Audio, Img, Sequence, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import {
  Board, Chrome, Exit, Headline, Mascot, Stamp, PAPER, INK, RED, STAMP, SANS, HAND, STICKER, clamp, pop, type CScene,
} from "./Collage";

export const FPS = 30;
const BLUE = "#4FA3E8";

export type Verb =
  | "appear" | "drop" | "slide" | "fly" | "spin" | "shake" | "grow" | "shrink" | "pulse" | "bounce" | "float" | "sink" | "orbit"
  | "spill" | "pour" | "fill" | "drain" | "rain" | "evaporate" | "melt" | "freeze" | "heat" | "burst" | "crack" | "multiply"
  | "zoom" | "cross" | "check" | "arrow" | "glow";
export type Fx = "droplets" | "sparkles" | "steam" | "smoke" | "dust" | "confetti" | "snow" | "fire" | "bubbles" | "salt" | "hearts" | "zap";
export type Slot = "left" | "center" | "right";
export type Beat = { at: number; until?: number; show: string; do: Verb; to?: string; fx?: Fx; where: Slot };
export type DScene = CScene & { beats?: Beat[] };
export type DemoProps = { audio: string; handle: string; total: number; scenes: DScene[] };

const SLOT_X: Record<Slot, number> = { left: 290, center: 540, right: 790 };

/* ── Particles: deterministic, so every render of a frame is identical ── */

function ParticleShape({ kind, size }: { kind: Fx; size: number }) {
  switch (kind) {
    case "droplets":
      return <svg width={size} height={size * 1.3} viewBox="0 0 20 26"><path d="M10 0 C10 0 0 12 0 17 a10 9 0 0 0 20 0 C20 12 10 0 10 0Z" fill={BLUE} /><ellipse cx="6.5" cy="16" rx="2" ry="3.5" fill="#fff" opacity="0.6" /></svg>;
    case "sparkles":
      return <svg width={size} height={size} viewBox="0 0 20 20"><path d="M10 0 L12 8 L20 10 L12 12 L10 20 L8 12 L0 10 L8 8Z" fill="#FFC93C" /></svg>;
    case "steam":
    case "smoke":
      // steam is tinted cool grey so it reads on the cream paper as well as the cork
      return <div style={{ width: size, height: size, borderRadius: "50%", background: `radial-gradient(circle, ${kind === "steam" ? "rgba(150,172,195,0.75)" : "rgba(110,104,98,0.75)"} 0%, rgba(150,172,195,0) 70%)` }} />;
    case "dust":
      return <div style={{ width: size, height: size, borderRadius: "50%", background: "rgba(170,140,100,0.55)" }} />;
    case "confetti":
      return <div style={{ width: size * 0.6, height: size, background: ["#E0352B", "#FFC93C", "#4FA3E8", "#3DBE6E"][Math.floor(size) % 4], borderRadius: 2 }} />;
    case "snow":
      return <svg width={size} height={size} viewBox="0 0 20 20" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M10 1v18M2 5.5l16 9M2 14.5l16-9" /></svg>;
    case "fire":
      return <svg width={size} height={size * 1.3} viewBox="0 0 20 26"><path d="M10 26 C2 26 0 19 3 13 C5 9 8 8 8 3 C13 7 18 12 18 18 C18 23 15 26 10 26Z" fill="#FF7A1A" /><path d="M10 26 C6 26 5 22 7 19 C8 17 10 16 10 13 C13 16 15 19 14 22 C13.5 24.5 12 26 10 26Z" fill="#FFD23F" /></svg>;
    case "bubbles":
      return <div style={{ width: size, height: size, borderRadius: "50%", border: `3px solid rgba(79,163,232,0.85)`, background: "rgba(255,255,255,0.35)" }} />;
    case "salt":
      return <div style={{ width: size * 0.5, height: size * 0.5, background: "#fff", boxShadow: "0 0 0 1px rgba(0,0,0,0.12)", rotate: `${size * 37}deg` }} />;
    case "hearts":
      return <svg width={size} height={size} viewBox="0 0 20 18"><path d="M10 18 C-6 7 3 -4 10 4 C17 -4 26 7 10 18Z" fill={RED} /></svg>;
    case "zap":
      return <svg width={size} height={size * 1.6} viewBox="0 0 20 32"><path d="M12 0 L2 18 H10 L7 32 L18 12 H10Z" fill="#FFC93C" stroke={INK} strokeWidth="1.5" /></svg>;
  }
}

type Motion = "fall" | "rise" | "burst" | "drift";
const FX_MOTION: Record<Fx, Motion> = {
  droplets: "fall", salt: "fall", snow: "drift", dust: "burst", sparkles: "burst", confetti: "burst",
  steam: "rise", smoke: "rise", fire: "rise", bubbles: "rise", hearts: "rise", zap: "burst",
};

/* Emits `kind` from (x, y) starting at local frame `from`; `stream` keeps emitting until `to`. */
function Particles({ kind, x, y, from, to, rate = 2, burst = 0, spread = 60, seed, life: lifeOverride }: { kind: Fx; x: number; y: number; from: number; to?: number; rate?: number; burst?: number; spread?: number; seed: string; life?: number }) {
  const f = useCurrentFrame();
  const motion = FX_MOTION[kind];
  const life = lifeOverride ?? (motion === "rise" ? 40 : motion === "burst" ? 26 : 34);
  const births: number[] = [];
  for (let i = 0; i < burst; i++) births.push(from);
  if (to !== undefined) for (let t = from; t < to; t += 1 / rate) births.push(Math.floor(t));
  return (
    <>
      {births.map((b, i) => {
        const age = f - b;
        if (age < 0 || age > life) return null;
        const r = (k: string) => random(`${seed}-${i}-${k}`);
        const size = (kind === "steam" || kind === "smoke" ? 70 : 26) * (0.7 + r("s") * 0.6);
        let px = x + (r("x") - 0.5) * spread * 0.4;
        let py = y;
        if (motion === "fall") { px += (r("vx") - 0.5) * 6 * age; py += 4 * age + 0.55 * age * age; }
        if (motion === "rise") { px += Math.sin(age / 6 + r("p") * 6) * 14; py -= (3 + r("v") * 3) * age; }
        if (motion === "drift") { px += Math.sin(age / 8 + r("p") * 6) * 30; py += 3.2 * age; }
        if (motion === "burst") { const a = r("a") * Math.PI * 2; const v = 9 + r("v") * 13; px += Math.cos(a) * v * age * 0.9; py += Math.sin(a) * v * age * 0.9 + 0.35 * age * age; }
        const o = interpolate(age, [0, 3, life * 0.7, life], [0, 1, 1, 0], clamp);
        const grow = kind === "steam" || kind === "smoke" ? 1 + age / 25 : 1;
        return (
          <div key={i} style={{ position: "absolute", left: px, top: py, translate: "-50% -50%", opacity: o, scale: String(grow), rotate: kind === "confetti" ? `${age * 14 * (r("d") > 0.5 ? 1 : -1)}deg` : undefined }}>
            <ParticleShape kind={kind} size={size} />
          </div>
        );
      })}
    </>
  );
}

/* ── Drawn rigs for things the emoji set can't animate: liquid that fills, tips and spills ── */

function Rig({ kind, size, level, t, frost = 0 }: { kind: string; size: number; level: number; t: number; frost?: number }) {
  const wave = (w: number, top: number) => {
    let d = `M 0 ${top}`;
    for (let x = 0; x <= w; x += 10) d += ` L ${x} ${top + Math.sin(x / 18 + t * 5) * 3}`;
    return d + ` L ${w} 400 L 0 400 Z`;
  };
  if (kind === "thermometer") {
    const top = 40 + (1 - level) * 190;
    return (
      <svg width={size * 0.6} height={size * 1.2} viewBox="0 0 100 300">
        <rect x="35" y="20" width="30" height="230" rx="15" fill="#fff" stroke={INK} strokeWidth="6" />
        <rect x="43" y={top} width="14" height={250 - top} fill={RED} />
        <circle cx="50" cy="258" r="30" fill={RED} stroke={INK} strokeWidth="6" />
        {[60, 100, 140, 180, 220].map((y) => <line key={y} x1="65" x2="78" y1={y} y2={y} stroke={INK} strokeWidth="4" />)}
      </svg>
    );
  }
  const bottle = kind === "bottle";
  const body = bottle
    ? "M 70 70 L 70 40 L 130 40 L 130 70 C 165 85 170 105 170 130 L 170 290 C 170 300 162 305 150 305 L 50 305 C 38 305 30 300 30 290 L 30 130 C 30 105 35 85 70 70 Z"
    : "M 25 30 L 175 30 L 155 300 L 45 300 Z";
  const top = bottle ? 80 + (1 - level) * 215 : 40 + (1 - level) * 255;
  const id = `clip-${kind}`;
  return (
    <svg width={size * 0.8} height={size * 1.2} viewBox="0 0 200 310" style={{ overflow: "visible" }}>
      <defs><clipPath id={id}><path d={body} /></clipPath></defs>
      <path d={body} fill="rgba(215,233,245,0.55)" />
      <g clipPath={`url(#${id})`}>
        <path d={frost > 0.5 ? `M 0 ${top} L 200 ${top} L 200 400 L 0 400 Z` : wave(200, top)} fill={mix(BLUE, "#CFEAFF", frost)} opacity="0.92" />
        <path d={wave(200, top + 8)} fill={mix("#3B8FD6", "#E8F6FF", frost)} opacity="0.5" />
        {frost > 0.2 && [0, 1, 2, 3, 4].map((i) => <path key={i} d={`M ${30 + i * 36} ${top + 30 + (i % 2) * 40} l 16 -12 l 16 12 l -16 12 z`} fill="#fff" opacity={frost * 0.8} />)}
      </g>
      {bottle && (
        <>
          <rect x="62" y="8" width="76" height="36" rx="8" fill="#2D6FD1" stroke={INK} strokeWidth="5" />
          <rect x="30" y="165" width="140" height="62" fill="#fff" opacity="0.9" />
          <path d="M 45 196 q 18 -14 36 0 t 36 0 t 36 0" fill="none" stroke={BLUE} strokeWidth="7" strokeLinecap="round" />
        </>
      )}
      <path d={body} fill="none" stroke={INK} strokeWidth="6" strokeLinejoin="round" />
      <path d={bottle ? "M 48 140 L 48 280" : "M 50 55 L 64 270"} stroke="#fff" strokeWidth="10" strokeLinecap="round" opacity="0.75" />
    </svg>
  );
}

const RIG_LEVEL: Record<string, number> = { glass: 0.72, bottle: 0.8, thermometer: 0.4 };

function mix(a: string, b: string, k: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(",")})`;
}

function Thing({ src, size, level, t, filter, frost = 0 }: { src: string; size: number; level: number; t: number; filter?: string; frost?: number }) {
  if (src.startsWith("rig:")) return <div style={{ filter: "drop-shadow(0 16px 18px rgba(40,25,10,0.25))" }}><Rig kind={src.slice(4)} size={size} level={level} t={t} frost={frost} /></div>;
  return <Img src={staticFile(src)} style={{ width: size, height: size, objectFit: "contain", filter: `${filter ?? ""} ${STICKER}` }} />;
}

/* ── One beat: an object doing a verb, starting on its word ── */

function Actor({ beat, sceneStart, stageY, scale }: { beat: Beat; sceneStart: number; stageY: number; scale: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const startF = Math.round((beat.at - sceneStart) * fps);
  const lf = f - startF;
  if (lf < 0) return null;
  const T = lf / fps;
  const endF = beat.until !== undefined ? Math.round((beat.until - sceneStart) * fps) - startF : Infinity;
  const leaving = Number.isFinite(endF) ? interpolate(lf, [endF - 6, endF], [1, 0], clamp) : 1;
  if (lf > endF) return null;

  const size = (beat.where === "center" ? 480 : 385) * scale;
  const enter = pop(lf, fps, 0);
  let x = SLOT_X[beat.where];
  let y = stageY;
  let s = enter;
  let rot = 0;
  let opacity = 1;
  let filter: string | undefined;
  let frost = 0;
  let origin = "50% 50%";
  let sx = 1;
  let sy = 1;
  const rigKind = beat.show.startsWith("rig:") ? beat.show.slice(4) : null;
  let level = rigKind ? RIG_LEVEL[rigKind] ?? 0.7 : 0;
  const extras: React.ReactNode[] = [];
  const bob = Math.sin(lf / 14) * 6;
  const ease = (a: number, b: number) => interpolate(T, [a, b], [0, 1], { ...clamp, easing: Easing.bezier(0.33, 1, 0.68, 1) });
  // geometry for tipping: things rotate around a point near their base, liquid leaves from the top
  const H = rigKind && rigKind !== "thermometer" ? size * 1.2 : size;
  const floorY = stageY + H / 2;
  const PIVOT = 0.42; // pivot sits 0.42·H below the center (transformOrigin 50% 92%)
  const mouthFrom = (cx: number, cy: number, deg: number) => {
    const r = (deg * Math.PI) / 180;
    const px = cx, py = cy + H * PIVOT, L = H * 0.84;
    return { mx: px + Math.sin(r) * L, my: py - Math.cos(r) * L };
  };

  switch (beat.do) {
    case "drop": {
      const d = spring({ frame: lf, fps, config: { damping: 7, stiffness: 120, mass: 0.7 } });
      y = stageY - (1 - d) * 900; s = 1;
      extras.push(<Particles key="dust" kind="dust" x={x} y={stageY + size * 0.4} from={startF + 9} burst={10} seed={`${beat.at}d`} />);
      break;
    }
    case "slide": x = interpolate(enter, [0, 1], [beat.where === "left" ? -400 : 1480, x]); s = 1; break;
    case "fly": {
      const p = ease(0, 0.9);
      x = interpolate(p, [0, 1], [-350, x]); y = stageY - Math.sin(p * Math.PI) * 220; rot = (1 - p) * -18; s = 1; break;
    }
    case "spin": rot = lf * 7; break;
    case "shake": x += Math.sin(lf * 2.3) * 12 * Math.min(1, T * 3); rot = Math.sin(lf * 1.7) * 5; break;
    case "grow": s = enter * interpolate(T, [0.3, 1.8], [0.55, 1.35], clamp); break;
    case "shrink": s = enter * interpolate(T, [0.3, 1.6], [1, 0.3], clamp); break;
    case "pulse": s = enter * (1 + 0.14 * Math.pow(Math.max(0, Math.sin(lf / 4.5)), 10)); break;
    case "bounce": y -= Math.abs(Math.sin(lf / 7)) * 110; break;
    case "float": y -= Math.min(T * 70, 150 * scale); break;
    case "sink": y += T * 90; opacity = interpolate(T, [0.5, 2.5], [1, 0.25], clamp); break;
    case "orbit": x = 540 + Math.cos(lf / 16) * 300; y = stageY + Math.sin(lf / 16) * 130; break;
    case "spill": {
      origin = "50% 92%";
      const dir = beat.where === "right" ? -1 : 1;
      const k = ease(0.35, 0.95);
      rot = dir * 96 * k;
      x -= dir * H * 0.3 * k; // keep the tipped body on stage
      if (rigKind) level = level * (1 - interpolate(T, [0.75, 1.9], [0, 0.95], clamp));
      const { mx, my } = mouthFrom(x, y, rot);
      extras.push(<Particles key="sp" kind="droplets" x={mx} y={my} from={startF + 20} to={startF + 56} rate={1.8} spread={30} seed={`${beat.at}s`} />);
      const pw = interpolate(T, [0.8, 2.2], [0, 1], clamp);
      extras.push(<div key="pud" style={{ position: "absolute", left: mx + dir * 60, top: floorY + 30, width: 460 * pw * scale, height: 64 * pw * scale, translate: "-50% -50%", borderRadius: "50%", background: "rgba(79,163,232,0.55)" }} />);
      break;
    }
    case "pour": {
      origin = "50% 92%";
      // target glass sits right of the slot; the source is placed so its mouth ends up over the rim
      const tx = SLOT_X[beat.where] + 120 * scale;
      const tH = size * 0.85 * 1.2;
      const ty = floorY - tH / 2;
      const k = ease(0.35, 0.9);
      rot = 112 * k;
      const L = H * 0.84;
      const r = (112 * Math.PI) / 180;
      const pivotX = tx - 30 * scale - Math.sin(r) * L;
      const pivotY = ty - tH / 2 - 50 * scale + Math.cos(r) * L;
      // walks from standing beside the glass up to the pour position as it tips
      x = interpolate(k, [0, 1], [tx - 330 * scale, pivotX]);
      y = interpolate(k, [0, 1], [floorY - H / 2, pivotY - H * PIVOT]);
      if (rigKind) level = level * (1 - interpolate(T, [0.8, 2.4], [0, 0.8], clamp));
      const { mx, my } = mouthFrom(x, y, rot);
      const tLevel = interpolate(T, [0.9, 2.4], [0.06, 0.82], clamp);
      const surface = ty + tH / 2 - tH * 0.1 - tH * 0.8 * tLevel;
      const stream = interpolate(T, [0.8, 1.0, 2.3, 2.5], [0, 1, 1, 0], clamp);
      extras.push(
        <svg key="stream" style={{ position: "absolute", inset: 0 }} width={1080} height={1920}>
          <path d={`M ${mx} ${my} Q ${mx + 6} ${(my + surface) / 2}, ${mx + 4} ${surface}`} stroke={BLUE} strokeWidth={16 * scale} fill="none" strokeLinecap="round" opacity={stream} />
        </svg>,
      );
      if (beat.to)
        extras.unshift(
          <div key="to" style={{ position: "absolute", left: tx, top: ty, translate: "-50% -50%", scale: String(pop(lf, fps, 4)) }}>
            <Thing src={beat.to} size={size * 0.85} level={tLevel} t={T} />
          </div>,
        );
      extras.push(<Particles key="bub" kind="bubbles" x={mx} y={surface + 30} from={startF + 30} to={startF + 72} rate={0.5} spread={60} seed={`${beat.at}p`} />);
      break;
    }
    case "fill":
      if (rigKind) level = interpolate(T, [0.3, 1.8], [0.06, 0.9], clamp);
      extras.push(<Particles key="b" kind="bubbles" x={x} y={y + size * 0.3} from={startF + 10} to={startF + 55} rate={0.5} spread={size * 0.6} seed={`${beat.at}f`} />);
      break;
    case "drain":
      if (rigKind) level = interpolate(T, [0.3, 1.8], [0.88, 0.04], clamp);
      break;
    case "rain":
      y = stageY - 260 * scale;
      extras.push(<Particles key="r" kind="droplets" x={x} y={y + size * 0.25} from={startF + 6} to={startF + 150} rate={1.8} spread={size * 1.4} seed={`${beat.at}r`} />);
      break;
    case "evaporate":
      if (rigKind) level = level * interpolate(T, [0.4, 2.6], [1, 0.15], clamp);
      else { y -= T * 50; opacity = interpolate(T, [0.8, 2.6], [1, 0], clamp); }
      extras.push(<Particles key="st" kind="steam" x={x} y={y - size * 0.35} from={startF + 8} to={startF + 90} rate={0.7} spread={size * 0.6} seed={`${beat.at}e`} />);
      break;
    case "melt": {
      origin = "50% 100%";
      const m = ease(0.3, 2.0);
      sy = 1 - m * 0.55; sx = 1 + m * 0.25;
      extras.push(<Particles key="dr" kind="droplets" x={x} y={y + size * 0.3} from={startF + 12} to={startF + 60} rate={0.6} spread={size * 0.7} seed={`${beat.at}m`} />);
      extras.push(<div key="pud" style={{ position: "absolute", left: x, top: stageY + size * 0.5, width: 460 * m * scale, height: 56 * m * scale, translate: "-50% -50%", borderRadius: "50%", background: "rgba(79,163,232,0.5)" }} />);
      break;
    }
    case "freeze": {
      const k = ease(0.3, 1.0);
      if (rigKind === "thermometer") level = interpolate(k, [0, 1], [0.45, 0.06]);
      frost = k;
      // sepia first flattens every hue, so the rotate lands on icy blue whatever the object's color
      filter = `sepia(${k * 0.7}) hue-rotate(${k * 165}deg) saturate(${1 + k * 0.6}) brightness(${1 + k * 0.12})`;
      extras.push(<Particles key="sn" kind="snow" x={x} y={y - size * 0.6} from={startF + 6} to={startF + 90} rate={0.9} spread={size * 1.2} seed={`${beat.at}z`} />);
      break;
    }
    case "heat": {
      const k = ease(0.3, 1.2);
      if (rigKind === "thermometer") level = interpolate(k, [0, 1], [0.3, 0.95]);
      filter = `sepia(${k * 0.5}) saturate(${1 + k * 1.5}) hue-rotate(${-k * 25}deg)`;
      rot = Math.sin(lf / 3) * 1.5 * k;
      y -= 40 * k * scale;
      extras.push(<Particles key="fi" kind="fire" x={x} y={floorY + 28} from={startF + 8} to={startF + 100} rate={1.4} spread={size * 0.7} life={14} seed={`${beat.at}h`} />);
      break;
    }
    case "burst": {
      s = enter * interpolate(T, [0.35, 0.6], [1, 1.35], clamp);
      opacity = interpolate(T, [0.6, 0.68], [1, 0], clamp);
      extras.push(<Particles key="bu" kind={beat.fx ?? "confetti"} x={x} y={y} from={startF + 19} burst={34} seed={`${beat.at}b`} />);
      break;
    }
    case "crack": {
      const c = ease(0.45, 0.8);
      if (T > 0.45) {
        const half = (side: -1 | 1) => (
          <div key={`h${side}`} style={{ position: "absolute", left: x, top: y, translate: `calc(-50% + ${side * c * 50}px) -50%`, rotate: `${side * c * 14}deg`, clipPath: side < 0 ? "polygon(0 0, 52% 0, 44% 35%, 56% 60%, 46% 100%, 0 100%)" : "polygon(52% 0, 100% 0, 100% 100%, 46% 100%, 56% 60%, 44% 35%)" }}>
            <Thing src={beat.show} size={size} level={level} t={T} />
          </div>
        );
        return <AbsoluteFill style={{ opacity: leaving }}>{half(-1)}{half(1)}<Particles kind="dust" x={x} y={y} from={startF + 14} burst={14} seed={`${beat.at}c`} /></AbsoluteFill>;
      }
      break;
    }
    case "multiply": {
      const n = 9;
      return (
        <AbsoluteFill style={{ opacity: leaving }}>
          {Array.from({ length: n }, (_, i) => {
            const gx = x + ((i % 3) - 1) * size * 0.42;
            const gy = y + (Math.floor(i / 3) - 1) * size * 0.42;
            const p = pop(lf, fps, i * 3);
            return (
              <div key={i} style={{ position: "absolute", left: gx, top: gy, translate: "-50% -50%", scale: String(Math.max(0, p)), rotate: `${(random(`m${i}`) - 0.5) * 24}deg` }}>
                <Thing src={beat.show} size={size * 0.4} level={level} t={T} />
              </div>
            );
          })}
        </AbsoluteFill>
      );
    }
    case "zoom": {
      const z = ease(0.3, 0.8);
      s = enter * (1 + z * 0.45);
      const r = size * 0.62 * (1 + z * 0.3);
      extras.push(
        <div key="lens" style={{ position: "absolute", left: x, top: y, width: r * 2, height: r * 2, translate: "-50% -50%", borderRadius: "50%", border: `16px solid ${INK}`, opacity: z, boxShadow: "inset 0 0 0 6px rgba(255,255,255,0.7)" }}>
          <div style={{ position: "absolute", right: -r * 0.55, bottom: -r * 0.55, width: r * 0.75, height: 34, background: INK, borderRadius: 17, rotate: "45deg" }} />
        </div>,
      );
      break;
    }
    case "cross":
    case "check": {
      const d = ease(0.35, 0.75);
      const len = 700;
      const path = beat.do === "cross"
        ? `M ${x - size * 0.42} ${y - size * 0.42} L ${x + size * 0.42} ${y + size * 0.42} M ${x + size * 0.42} ${y - size * 0.42} L ${x - size * 0.42} ${y + size * 0.42}`
        : `M ${x - size * 0.38} ${y} L ${x - size * 0.08} ${y + size * 0.3} L ${x + size * 0.45} ${y - size * 0.35}`;
      extras.push(
        <svg key="mark" style={{ position: "absolute", inset: 0 }} width={1080} height={1920}>
          <path d={path} stroke={beat.do === "cross" ? RED : "#2FA35A"} strokeWidth={34 * scale} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray={len * 2} strokeDashoffset={len * 2 * (1 - d)} />
        </svg>,
      );
      if (beat.do === "cross") filter = `grayscale(${d * 0.7})`;
      break;
    }
    case "arrow": {
      const d = ease(0.35, 0.9);
      const tx = beat.where === "right" ? 260 : 820;
      const fromX = x + (tx > x ? 1 : -1) * size * 0.4;
      const toX = tx - (tx > x ? 1 : -1) * size * 0.32;
      extras.push(
        <svg key="arr" style={{ position: "absolute", inset: 0 }} width={1080} height={1920}>
          <path d={`M ${fromX} ${y} Q ${(fromX + toX) / 2} ${y - 160}, ${toX} ${y}`} stroke={RED} strokeWidth={14} fill="none" strokeLinecap="round" strokeDasharray={900} strokeDashoffset={900 * (1 - d)} />
        </svg>,
      );
      if (beat.to) extras.push(<div key="to" style={{ position: "absolute", left: tx, top: y, translate: "-50% -50%", scale: String(Math.max(0, pop(lf, fps, 16))) }}><Thing src={beat.to} size={size * 0.85} level={0.7} t={T} /></div>);
      break;
    }
    case "glow":
      extras.push(<div key="g" style={{ position: "absolute", left: x, top: y, width: size * 1.5, height: size * 1.5, translate: "-50% -50%", borderRadius: "50%", background: "radial-gradient(circle, rgba(255,201,60,0.55) 0%, rgba(255,201,60,0) 65%)", scale: String(1 + 0.08 * Math.sin(lf / 6)) }} />);
      break;
  }

  if (beat.fx && beat.do !== "burst") {
    extras.push(<Particles key="fx" kind={beat.fx} x={x} y={FX_MOTION[beat.fx] === "rise" ? y - size * 0.3 : y} from={startF + 8} to={startF + 75} rate={0.8} spread={size} burst={FX_MOTION[beat.fx] === "burst" ? 18 : 0} seed={`${beat.at}x`} />);
  }

  const glowFirst = extras.filter((e) => (e as React.ReactElement)?.key === "g" || (e as React.ReactElement)?.key === "pud");
  const rest = extras.filter((e) => !glowFirst.includes(e));
  return (
    <AbsoluteFill style={{ opacity: leaving * opacity }}>
      {glowFirst}
      <div style={{ position: "absolute", left: x, top: y + (["appear", "grow", "pulse", "glow", "zoom", "fill"].includes(beat.do) ? bob : 0), translate: "-50% -50%", transformOrigin: origin, rotate: `${rot}deg`, scale: `${Math.max(0, s) * sx} ${Math.max(0, s) * sy}` }}>
        <Thing src={beat.show} size={size} level={level} t={T} filter={filter} frost={frost} />
      </div>
      {rest}
    </AbsoluteFill>
  );
}

/* ── Scene text layouts; the stage under them belongs to the beats ── */

function SceneText({ scene }: { scene: DScene }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (scene.kind === "stat") {
    const p = pop(f, fps, 0, 14);
    const u = interpolate(f, [8, 22], [0, 1], clamp);
    return (
      <>
        <div style={{ position: "absolute", top: 560, width: "100%", textAlign: "center", fontFamily: STAMP, fontSize: 250, color: INK, lineHeight: 1, scale: String(0.7 + 0.3 * p), opacity: p }}>{scene.big}</div>
        <svg style={{ position: "absolute", inset: 0 }} width={1080} height={1920}>
          <path d="M 260 845 Q 540 810 820 838" fill="none" stroke={RED} strokeWidth={14} strokeLinecap="round" strokeDasharray={620} strokeDashoffset={620 * (1 - u)} />
        </svg>
        <div style={{ position: "absolute", top: 875, left: 110, right: 110, textAlign: "center", fontFamily: SANS, fontWeight: 800, fontSize: 52, color: INK, opacity: interpolate(f, [10, 18], [0, 1], clamp) }}>{scene.label}</div>
      </>
    );
  }
  if (scene.kind === "compare") {
    const tag = (text: string, note: string | undefined, x: number, d: number, tilt: number) => {
      const p = pop(f, fps, d, 13);
      return (
        <div style={{ position: "absolute", left: x, top: 590, translate: "-50% 0", rotate: `${tilt}deg`, scale: String(Math.max(0, p)), background: "#FFFDF8", padding: "18px 34px 14px", borderRadius: 12, boxShadow: "0 12px 24px rgba(40,25,10,0.18)", textAlign: "center", minWidth: 330 }}>
          <div style={{ position: "absolute", top: -18, left: "50%", translate: "-50% 0", width: 120, height: 34, background: "rgba(232,214,170,0.85)", rotate: "-3deg" }} />
          <div style={{ fontFamily: STAMP, fontSize: 70, color: INK, textTransform: "uppercase", lineHeight: 1 }}>{text}</div>
          {note && <div style={{ fontFamily: HAND, fontWeight: 700, fontSize: 44, color: RED, marginTop: 6 }}>{note}</div>}
        </div>
      );
    };
    return (
      <>
        {tag(scene.a, scene.aNote, 290, 0, -3)}
        {tag(scene.b, scene.bNote, 790, 6, 3)}
        <Stamp text="VS" x={540} y={1400} size={100} delay={14} tilt={-10} />
      </>
    );
  }
  if (scene.kind === "list") {
    const dur = (scene.end - scene.start) * fps;
    const step = Math.max(10, dur / (scene.items.length + 1));
    return (
      <>
        {scene.items.map((it, i) => {
          const p = pop(f, fps, Math.round(i * step), 12);
          return (
            <div key={i} style={{ position: "absolute", left: 80, right: 80, top: 570 + i * 128, display: "flex", alignItems: "center", gap: 26, opacity: Math.min(1, p * 1.5), translate: `${(1 - p) * -120}px 0px` }}>
              <div style={{ width: 100, height: 100, flex: "none", borderRadius: 26, background: INK, color: "#fff", fontFamily: STAMP, fontSize: 72, display: "flex", alignItems: "center", justifyContent: "center", rotate: `${i % 2 ? 3 : -3}deg` }}>{i + 1}</div>
              <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 54, color: INK, letterSpacing: "-0.02em" }}>{it}</div>
            </div>
          );
        })}
      </>
    );
  }
  const dur = (scene.end - scene.start) * fps;
  if (scene.kind === "end") return <Stamp text="FOLLOW FOR MORE" x={540} y={1380} size={100} delay={Math.round(dur * 0.35)} tilt={-5} />;
  if (scene.stamp) return <Stamp text={scene.stamp} x={scene.kind === "hook" ? 560 : 330} y={1390} size={scene.kind === "hook" ? 150 : 100} delay={Math.round(dur * 0.55)} tilt={-7} />;
  return null;
}

const STAGE: Record<string, { y: number; scale: number }> = {
  hook: { y: 960, scale: 1 }, line: { y: 980, scale: 1 }, end: { y: 930, scale: 1 },
  stat: { y: 1200, scale: 0.86 }, compare: { y: 1070, scale: 0.95 }, list: { y: 1250, scale: 0.78 },
};

const VERB_SFX: Partial<Record<Verb, { src: string; at: number; vol: number }>> = {
  appear: { src: "pop", at: 0.05, vol: 0.35 }, grow: { src: "pop", at: 0.05, vol: 0.35 }, pulse: { src: "pop", at: 0.05, vol: 0.35 },
  multiply: { src: "pop", at: 0.05, vol: 0.4 }, drop: { src: "thud", at: 0.3, vol: 0.6 }, slide: { src: "whoosh", at: 0, vol: 0.4 },
  fly: { src: "whoosh", at: 0, vol: 0.45 }, orbit: { src: "whoosh", at: 0, vol: 0.3 }, spill: { src: "splash", at: 0.75, vol: 0.5 },
  pour: { src: "splash", at: 0.8, vol: 0.45 }, melt: { src: "splash", at: 0.5, vol: 0.3 }, rain: { src: "splash", at: 0.3, vol: 0.3 },
  crack: { src: "crack", at: 0.45, vol: 0.7 }, burst: { src: "crack", at: 0.6, vol: 0.6 }, check: { src: "ding", at: 0.4, vol: 0.5 },
  zoom: { src: "ding", at: 0.3, vol: 0.35 }, glow: { src: "ding", at: 0.1, vol: 0.35 }, cross: { src: "thud", at: 0.4, vol: 0.6 },
  arrow: { src: "whoosh", at: 0.35, vol: 0.35 }, freeze: { src: "ding", at: 0.4, vol: 0.35 }, fill: { src: "splash", at: 0.3, vol: 0.25 },
};

export function Demo({ audio, handle, total, scenes }: DemoProps) {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <Audio src={staticFile(audio)} />
      {scenes.map((s, i) => {
        const from = Math.round(s.start * fps);
        const next = scenes[i + 1];
        const until = Math.round((next ? next.start : total + 0.6) * fps);
        const stage = STAGE[s.kind] ?? STAGE.line;
        return (
          <Sequence key={i} from={from} durationInFrames={Math.max(1, until - from)}>
            <Board cork={s.kind === "hook"} />
            <Exit frames={until - from}>
              <SceneText scene={s} />
              {(s.beats ?? []).map((b, k) => <Actor key={k} beat={b} sceneStart={s.start} stageY={stage.y} scale={stage.scale} />)}
            </Exit>
            <Headline scene={s} />
            {i > 0 && <Sequence from={-2} durationInFrames={12} layout="none"><Audio src={staticFile("sfx/whoosh.wav")} volume={0.22} /></Sequence>}
            {(s.beats ?? []).map((b, k) => {
              const fx = VERB_SFX[b.do];
              if (!fx) return null;
              return (
                <Sequence key={`a${k}`} from={Math.round((b.at - s.start + fx.at) * fps)} durationInFrames={16} layout="none">
                  <Audio src={staticFile(`sfx/${fx.src}.wav`)} volume={fx.vol} />
                </Sequence>
              );
            })}
          </Sequence>
        );
      })}
      <Mascot scenes={scenes} />
      <Chrome scenes={scenes} total={total} handle={handle} />
    </AbsoluteFill>
  );
}
