/*
 * Data style: the number itself is the visual. Stats count up on a dark 2.5D stage,
 * comparisons race as lit bars, "one vs everyone" tips a scale. Inspired by stat-flip reels:
 * bad-sounding number → the flip → the real reason → a question to end on.
 * All SVG and gradients (no blur filters) so it renders quickly on an 8GB Mac.
 */
import { AbsoluteFill, Audio, Img, Sequence, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadSerif } from "@remotion/google-fonts/InstrumentSerif";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

const { fontFamily: DISPLAY } = loadAnton("normal", { subsets: ["latin", "latin-ext"] });
const { fontFamily: SANS } = loadInter("normal", { weights: ["600", "800"], subsets: ["latin", "latin-ext"] });
const { fontFamily: SERIF } = loadSerif("italic", { subsets: ["latin", "latin-ext"] });
const { fontFamily: MONO } = loadMono("normal", { weights: ["500"], subsets: ["latin"] });

export const FPS = 30;
const BG = "#0A0D13";
const WHITE = "#F4F1EA";
const MUTED = "rgba(244,241,234,0.55)";
const GOLD = "#F5B83D";
const RED = "#FF4D3D";
const SLATE = "#4A5468";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

type Word = { w: string; s: number; e: number };
type Item = { label: string; value: number | string; show?: string };
export type DataScene = {
  kind: "hook" | "count" | "bars" | "scale" | "line" | "end";
  say: string;
  start: number;
  end: number;
  words: Word[];
  em?: string[] | string;
  big?: string;
  label?: string;
  value?: number | string;
  prefix?: string;
  suffix?: string;
  pins?: boolean;
  show?: string; // resolved Fluent 3D image in public/
  hit?: number; // seconds: when the number is spoken, so the count lands on it
  beats?: { at: number; show: string }[]; // subject swaps, timed to the word that names them (seconds)
  items?: Item[];
  unit?: string;
  left?: Item;
  right?: Item;
};
export type DataProps = { audio: string; handle: string; total: number; scenes: DataScene[] };

const num = (v: number | string | undefined) => Number(String(v ?? 0).replace(/[^0-9.\-]/g, "")) || 0;
const CURRENCY = /^[$€£¥]$/; // plain cash only: "$B" units are not coins and not cents
// money reads as $1.50, never $1.5
const decimals = (v: number | string | undefined, money = false) => {
  const d = (String(v ?? "").split(".")[1] ?? "").replace(/\D/g, "").length;
  return money && d > 0 ? 2 : d;
};
const fmt = (n: number, d: number) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
// "$" or "$B" style units put the symbol in front: $1.50, $39B
const withUnit = (v: string, unit = "") => (/^[$€£¥]/.test(unit) ? `${unit[0]}${v}${unit.slice(1)}` : `${v}${unit}`);
const heroOf = (items: { value: number | string }[]) => items.reduce((h, it, i) => (num(it.value) > num(items[h].value) ? i : h), 0);
const pop = (f: number, fps: number, delay = 0, damping = 12) =>
  spring({ frame: f - delay, fps, config: { damping, mass: 0.6, stiffness: 160 } });

/* ── Stage: perspective floor + spotlight. proj() maps floor coords (u: side, v: depth) to screen. ── */

const HORIZON = 900;
const NEAR = 1920;
export const proj = (u: number, v: number) => {
  const z = 1 + v * 3;
  return { x: 540 + (u * 640) / z, y: HORIZON + (NEAR - HORIZON) / z, s: 1 / z };
};

function Stage({ tint = GOLD, intensity = 1 }: { tint?: string; intensity?: number }) {
  const f = useCurrentFrame();
  const drift = (f * 0.004) % 0.1; // the floor creeps toward camera so the scene never sits still
  const rows = Array.from({ length: 12 }, (_, i) => i * 0.1 + drift);
  const cols = Array.from({ length: 17 }, (_, i) => -1.6 + i * 0.2);
  return (
    <AbsoluteFill>
      <svg width={1080} height={1920} style={{ position: "absolute" }}>
        <defs>
          <radialGradient id="spot" cx="50%" cy="58%" r="55%">
            <stop offset="0%" stopColor={tint} stopOpacity={0.16 * intensity} />
            <stop offset="45%" stopColor={tint} stopOpacity={0.05 * intensity} />
            <stop offset="100%" stopColor={BG} stopOpacity={0} />
          </radialGradient>
          <linearGradient id="fade" x1="0" y1={HORIZON} x2="0" y2={NEAR} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={BG} stopOpacity={1} />
            <stop offset="35%" stopColor={BG} stopOpacity={0.4} />
            <stop offset="100%" stopColor={BG} stopOpacity={0.15} />
          </linearGradient>
        </defs>
        <rect width={1080} height={1920} fill={BG} />
        <rect width={1080} height={1920} fill="url(#spot)" />
        <g stroke="rgba(244,241,234,0.09)" strokeWidth={2}>
          {rows.map((v) => {
            const a = proj(-1.6, v), b = proj(1.6, v);
            return <line key={`r${v}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
          {cols.map((u) => {
            const a = proj(u, 0), b = proj(u, 1.2);
            return <line key={`c${u}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
        </g>
        <rect y={HORIZON} width={1080} height={NEAR - HORIZON} fill="url(#fade)" />
      </svg>
    </AbsoluteFill>
  );
}

/* Slow push-in per scene, with a small settle when the scene lands. */
function Camera({ frames, children }: { frames: number; children: React.ReactNode }) {
  const f = useCurrentFrame();
  const z = interpolate(f, [0, frames], [1.0, 1.06], clamp) * interpolate(f, [0, 8], [1.05, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const out = interpolate(f, [frames - 5, frames], [1, 0], clamp);
  return <AbsoluteFill style={{ scale: String(z), opacity: out, transformOrigin: "50% 62%" }}>{children}</AbsoluteFill>;
}

/* ── Counter: the hero number ticks up and lands when the voice says it ── */

export function Counter({ scene, y = 760, size = 250 }: { scene: DataScene; y?: number; size?: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const land = Math.max(10, Math.round(((scene.hit ?? scene.start + (scene.end - scene.start) * 0.6) - scene.start) * fps));
  const p = interpolate(f, [4, land], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const value = num(scene.value);
  const shown = `${scene.prefix ?? ""}${fmt(value * p, decimals(scene.value, CURRENCY.test(scene.prefix ?? "")))}${scene.suffix ?? ""}`;
  const slam = spring({ frame: f - land, fps, config: { damping: 9, mass: 0.5, stiffness: 220 } });
  const scale = f < land ? interpolate(p, [0, 1], [0.85, 1]) : 1 + (1 - slam) * 0.12;
  const enter = pop(f, fps, 0);
  // long numbers shrink to fit the frame
  const fit = Math.min(size, 1900 / Math.max(4, shown.length * 1.0));
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: y, textAlign: "center", opacity: Math.min(1, enter * 1.4) }}>
      <div style={{ fontFamily: DISPLAY, fontSize: fit, lineHeight: 1, color: f >= land ? GOLD : WHITE, scale: String(scale), letterSpacing: "0.01em", textShadow: `0 0 60px ${f >= land ? "rgba(245,184,61,0.35)" : "rgba(244,241,234,0.12)"}` }}>
        {shown}
      </div>
      {scene.label && (
        <div style={{ marginTop: 26, fontFamily: SANS, fontWeight: 800, fontSize: 46, color: MUTED, letterSpacing: "0.04em", textTransform: "uppercase", opacity: interpolate(f, [land - 6, land + 4], [0, 1], clamp), padding: "0 80px" }}>
          {scene.label}
        </div>
      )}
    </div>
  );
}

/* Impact markers on the floor, one per slice of the count, like a heatmap filling in. */
function Pins({ scene, color = RED }: { scene: DataScene; color?: string }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const land = Math.max(10, Math.round(((scene.hit ?? scene.start + (scene.end - scene.start) * 0.6) - scene.start) * fps));
  const N = 42;
  return (
    <svg width={1080} height={1920} style={{ position: "absolute" }}>
      {Array.from({ length: N }, (_, i) => {
        const born = 4 + Math.round(Math.pow(i / N, 0.7) * (land - 4));
        const age = f - born;
        if (age < 0) return null;
        const r = (k: string) => random(`${scene.start}-${i}-${k}`);
        const { x, y, s } = proj((r("u") - 0.5) * 2.2, 0.05 + r("v") * 0.9);
        const ring = interpolate(age, [0, 18], [0, 70], { ...clamp, easing: Easing.out(Easing.cubic) }) * s;
        const ringO = interpolate(age, [0, 18], [0.9, 0], clamp);
        const dot = interpolate(age, [0, 5], [0, 1], clamp);
        return (
          <g key={i}>
            <ellipse cx={x} cy={y} rx={ring} ry={ring * 0.35} fill="none" stroke={color} strokeWidth={4 * s + 1} opacity={ringO} />
            <ellipse cx={x} cy={y} rx={14 * s * dot} ry={5 * s * dot} fill={color} opacity={0.9} />
          </g>
        );
      })}
    </svg>
  );
}

/* ── Bars: isometric blocks rising off the floor, the hero lit in gold ── */

function Block({ x, base, w, h, color, top, side }: { x: number; base: number; w: number; h: number; color: string; top: string; side: string }) {
  const dx = w * 0.32, dy = w * 0.2;
  const L = x - w / 2, R = x + w / 2, T = base - h;
  return (
    <g>
      <ellipse cx={x + dx / 2} cy={base + 6} rx={w * 0.95} ry={w * 0.22} fill={color} opacity={0.18} />
      <polygon points={`${R},${T} ${R + dx},${T - dy} ${R + dx},${base - dy} ${R},${base}`} fill={side} />
      <rect x={L} y={T} width={w} height={h} fill={color} />
      <polygon points={`${L},${T} ${L + dx},${T - dy} ${R + dx},${T - dy} ${R},${T}`} fill={top} />
    </g>
  );
}

const SHADES: Record<string, [string, string, string]> = {
  hero: [GOLD, "#FFD98A", "#B9841F"],
  rest: [SLATE, "#6B768C", "#333B4A"],
};

function Bars({ scene }: { scene: DataScene }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const items = (scene.items ?? []).slice(0, 4);
  const max = Math.max(...items.map((it) => num(it.value)), 1);
  const dur = (scene.end - scene.start) * fps;
  const base = 1480;
  const w = items.length > 3 ? 150 : 180;
  const gap = items.length > 3 ? 230 : 290;
  const x0 = 540 - ((items.length - 1) * gap) / 2 - w * 0.16; // offset for the side face so the group sits centered
  const money = CURRENCY.test(scene.unit ?? "");
  return (
    <>
      {scene.label && (
        <div style={{ position: "absolute", top: 640, left: 0, right: 0, textAlign: "center", fontFamily: SANS, fontWeight: 800, fontSize: 40, letterSpacing: "0.08em", textTransform: "uppercase", color: MUTED, opacity: pop(f, fps, 0) }}>
          {scene.label}
        </div>
      )}
      <svg width={1080} height={1920} style={{ position: "absolute" }}>
        {items.map((it, i) => {
          const delay = Math.round(dur * 0.1 + i * Math.min(14, dur * 0.12));
          const g = spring({ frame: f - delay, fps, config: { damping: 15, mass: 0.8, stiffness: 90 } });
          const h = Math.max(4, (num(it.value) / max) * 600 * g);
          const [c, t, s] = SHADES[i === heroOf(items) ? "hero" : "rest"];
          return <Block key={i} x={x0 + i * gap} base={base} w={w} h={h} color={c} top={t} side={s} />;
        })}
      </svg>
      {items.map((it, i) => {
        const delay = Math.round(dur * 0.1 + i * Math.min(14, dur * 0.12));
        const g = spring({ frame: f - delay, fps, config: { damping: 15, mass: 0.8, stiffness: 90 } });
        const h = Math.max(4, (num(it.value) / max) * 600 * g);
        const x = x0 + i * gap;
        const v = fmt(num(it.value) * Math.min(1, g), decimals(it.value, money));
        const value = withUnit(v, scene.unit);
        return (
          <div key={i} style={{ opacity: f >= delay ? 1 : 0 }}>
            <div style={{ position: "absolute", left: x - 140, width: 300, top: base - h - 110, textAlign: "center", fontFamily: DISPLAY, fontSize: 72, color: i === heroOf(items) ? GOLD : WHITE }}>{value}</div>
            <div style={{ position: "absolute", left: x - 140, width: 300, top: base + 40, textAlign: "center", fontFamily: SANS, fontWeight: 800, fontSize: 36, color: i === heroOf(items) ? WHITE : MUTED, textTransform: "uppercase", letterSpacing: "0.03em" }}>{it.label}</div>
          </div>
        );
      })}
    </>
  );
}

/* ── Scale: one side vs the other, the beam tips toward the heavier number ── */

function Scale({ scene }: { scene: DataScene }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur = (scene.end - scene.start) * fps;
  const L = scene.left ?? { label: "", value: 0 }, R = scene.right ?? { label: "", value: 0 };
  const lv = num(L.value), rv = num(R.value);
  const tipAt = Math.round(dur * 0.5);
  const tip = spring({ frame: f - tipAt, fps, config: { damping: 7, mass: 0.9, stiffness: 80 } });
  const target = Math.max(-13, Math.min(13, ((rv - lv) / Math.max(lv + rv, 1)) * 26)); // + = right side down
  const angle = target * tip;
  const px = 540, py = 1080, arm = 360;
  const rad = (angle * Math.PI) / 180;
  const ends = [-1, 1].map((d) => ({ x: px + d * arm * Math.cos(rad), y: py + d * arm * Math.sin(rad) }));
  const sides = [L, R];
  const appear = [pop(f, fps, Math.round(dur * 0.08)), pop(f, fps, Math.round(dur * 0.25))];
  const maxV = Math.max(lv, rv, 1);
  return (
    <>
      <svg width={1080} height={1920} style={{ position: "absolute" }}>
        <polygon points={`${px},${py} ${px - 70},${py + 380} ${px + 70},${py + 380}`} fill={SLATE} />
        <polygon points={`${px},${py} ${px + 70},${py + 380} ${px + 95},${py + 370} ${px + 18},${py}`} fill="#333B4A" />
        <rect x={px - 150} y={py + 375} width={300} height={22} rx={6} fill="#333B4A" />
        <line x1={ends[0].x} y1={ends[0].y} x2={ends[1].x} y2={ends[1].y} stroke={WHITE} strokeWidth={14} strokeLinecap="round" />
        <circle cx={px} cy={py} r={22} fill={GOLD} />
        {ends.map((e, i) => {
          const panY = e.y + 170;
          const blocks = Math.max(1, Math.round((num(sides[i].value) / maxV) * 6));
          const color = num(sides[i].value) >= maxV ? SHADES.hero : SHADES.rest;
          return (
            <g key={i} opacity={appear[i]}>
              <line x1={e.x} y1={e.y} x2={e.x - 110} y2={panY} stroke={MUTED} strokeWidth={3} />
              <line x1={e.x} y1={e.y} x2={e.x + 110} y2={panY} stroke={MUTED} strokeWidth={3} />
              <path d={`M ${e.x - 140} ${panY} Q ${e.x} ${panY + 70} ${e.x + 140} ${panY} Z`} fill="#2A303C" stroke={MUTED} strokeWidth={3} />
              {Array.from({ length: blocks }, (_, k) => {
                const show = interpolate(f, [Math.round(dur * (i ? 0.25 : 0.08)) + k * 2, Math.round(dur * (i ? 0.25 : 0.08)) + k * 2 + 6], [0, 1], clamp);
                const col = k % 3, row = Math.floor(k / 3);
                return <g key={k} opacity={show} transform={`translate(0 ${(1 - show) * -60})`}><Block x={e.x - 70 + col * 70} base={panY - row * 52} w={52} h={46} color={color[0]} top={color[1]} side={color[2]} /></g>;
              })}
            </g>
          );
        })}
      </svg>
      {ends.map((e, i) => (
        <div key={i} style={{ position: "absolute", left: e.x - 200, width: 400, top: e.y + 280, textAlign: "center", opacity: appear[i] }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 84, color: num(sides[i].value) >= maxV ? GOLD : WHITE }}>{fmt(num(sides[i].value) * Math.min(1, appear[i]), decimals(sides[i].value))}</div>
          <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 34, color: MUTED, textTransform: "uppercase", letterSpacing: "0.03em" }}>{sides[i].label}</div>
        </div>
      ))}
      {scene.label && (
        <div style={{ position: "absolute", top: 640, left: 0, right: 0, textAlign: "center", fontFamily: SANS, fontWeight: 800, fontSize: 40, letterSpacing: "0.08em", textTransform: "uppercase", color: MUTED }}>{scene.label}</div>
      )}
    </>
  );
}

/* ── Hero object: the scene's subject standing in the spotlight on the floor ── */

function Hero({ src, y = 1330, size = 320 }: { src: string; y?: number; size?: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = pop(f, fps, 3, 10);
  const bob = Math.sin(f / 14) * 10;
  return (
    <>
      <svg width={1080} height={1920} style={{ position: "absolute" }}>
        <defs>
          <radialGradient id="heroShadow"><stop offset="0%" stopColor="#000" stopOpacity={0.7} /><stop offset="100%" stopColor="#000" stopOpacity={0} /></radialGradient>
          <radialGradient id="heroPool"><stop offset="0%" stopColor={GOLD} stopOpacity={0.22} /><stop offset="100%" stopColor={GOLD} stopOpacity={0} /></radialGradient>
        </defs>
        <ellipse cx={540} cy={y + size * 0.5} rx={size * 0.95} ry={size * 0.24} fill="url(#heroPool)" opacity={p} />
        <ellipse cx={540} cy={y + size * 0.48} rx={size * 0.42 * (1 - bob / 120)} ry={size * 0.09} fill="url(#heroShadow)" opacity={p} />
      </svg>
      <Img src={staticFile(src)} style={{ position: "absolute", left: 540 - size / 2, top: y - size / 2 + bob - (1 - p) * 160, width: size, height: size, objectFit: "contain", scale: String(0.4 + p * 0.6), rotate: `${(1 - p) * -14}deg` }} />
    </>
  );
}

/* ── Big statement: Anton, line by line, with a gold sweep under it ── */

export function Statement({ text, y = 760, size = 128, accent = GOLD }: { text: string; y?: number; size?: number; accent?: string }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");
  const lines: string[][] = [[]];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if ((cur.join(" ") + " " + w).length > 14 && cur.length) lines.push([w]);
    else cur.push(w);
  }
  const sweep = interpolate(f, [lines.length * 4 + 6, lines.length * 4 + 18], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <div style={{ position: "absolute", top: y, left: 70, right: 70, textAlign: "center" }}>
      {lines.map((l, i) => {
        const p = pop(f, fps, i * 4, 14);
        return (
          <div key={i} style={{ fontFamily: DISPLAY, fontSize: size, lineHeight: 1.04, color: WHITE, textTransform: "uppercase", opacity: Math.min(1, p * 1.5), translate: `0px ${(1 - p) * 50}px` }}>
            {l.join(" ")}
          </div>
        );
      })}
      <div style={{ margin: "26px auto 0", height: 12, width: `${sweep * 60}%`, background: accent, borderRadius: 6 }} />
    </div>
  );
}

/* ── Caption: one short phrase at a time, the spoken word lights up, key words go gold serif ── */

// ≤5 words per phrase, breaking at punctuation, so the eye reads one beat at a time instead of a paragraph.
// TTS word timings drop punctuation, so it's read from the script text when the word counts line up.
export function phrases(words: Word[], say: string) {
  const toks = say.split(/\s+/).filter(Boolean);
  const punct = (i: number) => /[.,!?;:\u2014]$/.test(toks.length === words.length ? toks[i] : words[i].w);
  const out: Word[][] = [];
  let cur: Word[] = [];
  for (const [i, w] of words.entries()) {
    cur.push(w);
    if (cur.length >= 5 || (punct(i) && cur.length >= 2)) { out.push(cur); cur = []; }
  }
  if (cur.length === 1 && out.length) out[out.length - 1].push(cur[0]);
  else if (cur.length) out.push(cur);
  return out;
}

export function Caption({ scene }: { scene: DataScene }) {
  const f = useCurrentFrame();
  const t = scene.start + f / FPS;
  const em = new Set([scene.em ?? []].flat().flatMap((w) => w.split(/\s+/)).map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")));
  const words = scene.words.length ? scene.words : scene.say.split(" ").map((w) => ({ w, s: scene.start, e: scene.start }));
  const groups = phrases(words, scene.say);
  let gi = 0;
  groups.forEach((g, k) => { if (t >= g[0].s - 0.05) gi = k; });
  const group = groups[gi];
  // the first phrase is up from the scene's first frame, so there's never a beat with no words
  const age = gi === 0 ? f + 2 : (t - group[0].s) * FPS;
  // top 250px clears the TikTok/Reels top bar
  return (
    <div style={{ position: "absolute", left: 80, right: 80, top: 250, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0 18px", alignItems: "baseline", textAlign: "center",
      opacity: interpolate(age, [-1, 2], [0, 1], clamp), scale: String(interpolate(age, [-1, 5], [0.92, 1], clamp)), textShadow: "0 4px 18px rgba(0,0,0,0.55)" }}>
      {group.map((w, i) => {
        const said = t >= w.s - 0.05;
        const isEm = em.has(w.w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
        return (
          <span key={`${gi}-${i}`} style={{ fontFamily: isEm ? SERIF : SANS, fontStyle: isEm ? "italic" : "normal", fontWeight: isEm ? 400 : 700, fontSize: isEm ? 92 : 76, lineHeight: 1.15, letterSpacing: isEm ? "0" : "-0.015em", color: isEm ? GOLD : WHITE, opacity: said ? 1 : 0.35 }}>
            {w.w}
          </span>
        );
      })}
    </div>
  );
}

export function Chrome({ scenes, total, handle }: { scenes: DataScene[]; total: number; handle: string }) {
  const f = useCurrentFrame();
  const t = f / FPS;
  let i = scenes.findIndex((s) => t < s.end + 0.25);
  if (i < 0) i = scenes.length - 1;
  return (
    <>
      <div style={{ position: "absolute", top: 0, left: 0, height: 8, width: `${Math.min(1, t / total) * 100}%`, background: GOLD }} />
      <div style={{ position: "absolute", top: 80, left: 70, fontFamily: MONO, fontSize: 28, color: MUTED }}>{`${String(i + 1).padStart(2, "0")} / ${String(scenes.length).padStart(2, "0")}`}</div>
      <div style={{ position: "absolute", top: 80, right: 70, fontFamily: MONO, fontSize: 28, color: MUTED }}>{handle}</div>
    </>
  );
}

function Visual({ scene }: { scene: DataScene }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur = (scene.end - scene.start) * fps;
  switch (scene.kind) {
    case "hook":
      return scene.value !== undefined
        ? <><Pins scene={scene} />{scene.show && <Hero src={scene.show} y={1250} size={360} />}<Counter scene={scene} y={640} size={270} /></>
        : <>{scene.show && <Hero src={scene.show} y={1290} size={400} />}<Statement text={scene.big ?? scene.say} y={640} /></>;
    case "count":
      return <>{scene.pins !== false && <Pins scene={scene} color={GOLD} />}{scene.show && <Hero src={scene.show} y={1290} size={320} />}<Counter scene={scene} y={640} /></>;
    case "bars":
      return <Bars scene={scene} />;
    case "scale":
      return <Scale scene={scene} />;
    case "end": {
      const p = pop(f, fps, Math.round(dur * 0.45), 10);
      return (
        <>
          <Statement text={scene.big ?? "Follow for more"} y={700} size={112} accent={RED} />
          <div style={{ position: "absolute", top: 1330, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: Math.min(1, p * 1.5), scale: String(0.6 + p * 0.4) }}>
            <div style={{ padding: "26px 60px", borderRadius: 999, background: GOLD, color: BG, fontFamily: SANS, fontWeight: 800, fontSize: 46, letterSpacing: "0.04em" }}>FOLLOW FOR MORE</div>
          </div>
        </>
      );
    }
    default:
      return <>{scene.show && <Hero src={scene.show} y={1300} size={420} />}<Statement text={scene.big ?? scene.say} y={640} /></>;
  }
}

/* SFX on the same frames the visuals use. */
export function sfxFor(s: DataScene, fps: number): { at: number; src: string; vol: number }[] {
  const dur = (s.end - s.start) * fps;
  const land = Math.round(((s.hit ?? s.start + (s.end - s.start) * 0.6) - s.start) * fps);
  if ((s.kind === "count" || s.kind === "hook") && s.value !== undefined) {
    const ticks = [0.2, 0.4, 0.6, 0.8].map((k) => ({ at: Math.round(4 + k * (land - 4)), src: "pop", vol: 0.18 }));
    return [...ticks, { at: land, src: "thud", vol: 0.55 }, { at: land + 1, src: "ding", vol: 0.3 }];
  }
  if (s.kind === "bars") {
    const n = Math.min(4, s.items?.length ?? 0);
    return Array.from({ length: n }, (_, i) => ({ at: Math.round(dur * 0.1 + i * Math.min(14, dur * 0.12)), src: i === 0 ? "thud" : "pop", vol: i === 0 ? 0.45 : 0.3 }));
  }
  if (s.kind === "scale") return [{ at: Math.round(dur * 0.08), src: "pop", vol: 0.3 }, { at: Math.round(dur * 0.25), src: "pop", vol: 0.3 }, { at: Math.round(dur * 0.5) + 6, src: "thud", vol: 0.6 }];
  if (s.kind === "end") return [{ at: Math.round(dur * 0.45), src: "ding", vol: 0.4 }];
  return [{ at: 2, src: "thud", vol: 0.35 }];
}

export function Data({ audio, handle, total, scenes }: DataProps) {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Audio src={staticFile(audio)} />
      {scenes.map((s, i) => {
        const from = Math.round(s.start * fps);
        const next = scenes[i + 1];
        const until = Math.round((next ? next.start : total + 0.6) * fps);
        const frames = Math.max(1, until - from);
        const tint = s.kind === "hook" || s.kind === "end" ? RED : GOLD;
        return (
          <Sequence key={i} from={from} durationInFrames={frames}>
            <Stage tint={tint} intensity={s.kind === "line" ? 0.7 : 1} />
            <Camera frames={frames}><Visual scene={s} /></Camera>
            <Caption scene={s} />
            {i > 0 && <Sequence from={-2} durationInFrames={12} layout="none"><Audio src={staticFile("sfx/whoosh.wav")} volume={0.22} /></Sequence>}
            {sfxFor(s, fps).map((x, k) => (
              <Sequence key={k} from={Math.max(0, x.at)} durationInFrames={16} layout="none"><Audio src={staticFile(`sfx/${x.src}.wav`)} volume={x.vol} /></Sequence>
            ))}
          </Sequence>
        );
      })}
      <Chrome scenes={scenes} total={total} handle={handle} />
    </AbsoluteFill>
  );
}
