import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";

const { fontFamily: DISPLAY } = loadAnton("normal", { subsets: ["latin", "latin-ext"] });
const { fontFamily: TEXT } = loadInter("normal", { weights: ["500", "800"], subsets: ["latin", "latin-ext"] });

export const FPS = 30;
const INK = "#0E0C0A";
const PAPER = "#F4EFE6";
const SUN = "#FFD23F";

type Word = { w: string; s: number; e: number };
type Base = { start: number; end: number; words: Word[] };
export type Scene = Base &
  (
    | { kind: "hook" | "line" | "end"; big: string }
    | { kind: "stat"; big: string; label: string }
    | { kind: "compare"; a: string; b: string; aNote?: string; bNote?: string }
    | { kind: "list"; items: string[] }
  );
export type ReelProps = { audio: string; handle: string; total: number; scenes: Scene[] };

const ease = (f: number, fps: number, delay = 0, damping = 14) =>
  spring({ frame: f - delay, fps, config: { damping, mass: 0.6, stiffness: 140 } });

/* Big words land one after another, each with its own spring. */
function SlamText({ text, size, color = PAPER, accentLast = false }: { text: string; size: number; color?: string; accentLast?: boolean }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `0 ${size * 0.22}px`, lineHeight: 1.02 }}>
      {words.map((w, i) => {
        const p = ease(f, fps, i * 2.5);
        return (
          <span
            key={i}
            style={{
              fontFamily: DISPLAY,
              fontSize: size,
              textTransform: "uppercase",
              letterSpacing: "-0.01em",
              color: accentLast && i === words.length - 1 ? SUN : color,
              display: "inline-block",
              opacity: interpolate(p, [0, 0.3], [0, 1], { extrapolateRight: "clamp" }),
              transform: `translateY(${(1 - p) * 70}px) scale(${1 + (1 - p) * 0.25})`,
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
}

/* Counts the leading number up, keeps any suffix like % or x. */
function CountUp({ value }: { value: string }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const m = value.match(/^([^\d]*)([\d.,]+)(.*)$/);
  const p = ease(f, fps, 0, 22);
  let shown = value;
  // count up with the source's own decimals and separators, land exactly on the written value
  if (m && p < 0.97) {
    const decimalComma = /,\d{1,2}$/.test(m[2]);
    const decimals = decimalComma ? m[2].split(",")[1].length : 0;
    const n = parseFloat(decimalComma ? m[2].replace(/\./g, "").replace(",", ".") : m[2].replace(/[.,]/g, ""));
    if (!Number.isNaN(n)) {
      const cur = (n * Math.max(0, p)).toFixed(decimals);
      const [int, frac] = cur.split(".");
      const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      shown = `${m[1]}${grouped}${frac ? "," + frac : ""}${m[3]}`;
    }
  }
  return (
    <div style={{ fontFamily: DISPLAY, fontSize: 340, color: SUN, lineHeight: 0.9, transform: `scale(${0.85 + 0.15 * p})`, fontVariantNumeric: "tabular-nums" }}>
      {shown}
    </div>
  );
}

function Label({ children, delay = 8 }: { children: string; delay?: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = ease(f, fps, delay);
  return (
    <div style={{ fontFamily: TEXT, fontWeight: 800, fontSize: 58, color: PAPER, textAlign: "center", maxWidth: 860, lineHeight: 1.15, opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}>
      {children}
    </div>
  );
}

function SceneBody({ scene }: { scene: Scene }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  switch (scene.kind) {
    case "hook":
      return <SlamText text={scene.big} size={156} accentLast />;
    case "line":
      return <SlamText text={scene.big} size={110} />;
    case "end":
      return <SlamText text={scene.big} size={104} accentLast />;
    case "stat":
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 36 }}>
          <CountUp value={scene.big} />
          <Label>{scene.label}</Label>
        </div>
      );
    case "compare": {
      const col = (title: string, note: string | undefined, d: number, hot: boolean) => {
        const p = ease(f, fps, d);
        return (
          <div style={{ flex: 1, borderRadius: 28, padding: "56px 36px", background: hot ? SUN : "#1C1915", color: hot ? INK : PAPER, opacity: p, transform: `translateY(${(1 - p) * 80}px)`, textAlign: "center" }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 92, textTransform: "uppercase", lineHeight: 1 }}>{title}</div>
            {note && <div style={{ fontFamily: TEXT, fontWeight: 800, fontSize: 44, marginTop: 22, lineHeight: 1.15 }}>{note}</div>}
          </div>
        );
      };
      return (
        <div style={{ display: "flex", gap: 28, width: 960 }}>
          {col(scene.a, scene.aNote, 0, false)}
          {col(scene.b, scene.bNote, 8, true)}
        </div>
      );
    }
    case "list":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 30, width: 900 }}>
          {scene.items.map((it, i) => {
            // each item lands when the narrator gets near it
            const p = ease(f, fps, i * Math.max(10, ((scene.end - scene.start) * fps) / (scene.items.length + 1)));
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 32, opacity: p, transform: `translateX(${(1 - p) * -90}px)` }}>
                <div style={{ fontFamily: DISPLAY, fontSize: 120, color: SUN, width: 90, lineHeight: 1 }}>{i + 1}</div>
                <div style={{ fontFamily: DISPLAY, fontSize: 96, color: PAPER, textTransform: "uppercase", lineHeight: 1 }}>{it}</div>
              </div>
            );
          })}
        </div>
      );
  }
}

/* A big warm disc drifts to a new spot on every scene: geometry, not decoration. */
function Backdrop({ scenes }: { scenes: Scene[] }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = f / fps;
  const spots = [
    [820, 420, 620], [260, 1500, 760], [900, 1350, 540], [180, 380, 680], [560, 960, 900],
  ];
  let idx = scenes.findIndex((s) => t < s.end + 0.25);
  if (idx < 0) idx = scenes.length - 1;
  const from = spots[Math.max(0, idx - 1) % spots.length];
  const to = spots[idx % spots.length];
  const p = ease(Math.round((t - scenes[idx].start) * fps), fps, 0, 20);
  const [x, y, r] = from.map((v, k) => v + (to[k] - v) * Math.min(1, p));
  return (
    <AbsoluteFill style={{ background: INK, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: x - r / 2, top: y - r / 2, width: r, height: r, borderRadius: "50%", background: SUN, opacity: 0.1 }} />
      <div style={{ position: "absolute", left: 1080 - x - r / 4, top: 1920 - y - r / 4, width: r / 2, height: r / 2, borderRadius: "50%", border: `3px solid ${SUN}`, opacity: 0.18 }} />
    </AbsoluteFill>
  );
}

/* Word-by-word captions: 4 words at a time, never mixing two scenes' sentences. */
function Captions({ scenes }: { scenes: Scene[] }) {
  const f = useCurrentFrame();
  const t = f / FPS;
  const scene = scenes.find((s) => t >= s.start && t < s.end + 0.2);
  if (!scene || scene.words.length === 0) return null;
  const words = scene.words;
  let cur = words.findIndex((w) => t >= w.s && t < w.e + 0.12);
  if (cur < 0) cur = Math.max(0, words.findLastIndex((w) => w.e <= t));
  const chunkStart = Math.floor(cur / 4) * 4;
  const chunk = words.slice(chunkStart, chunkStart + 4);
  return (
    <div style={{ position: "absolute", left: 60, right: 60, top: 1470, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "6px 20px" }}>
      {chunk.map((w, k) => {
        const on = chunkStart + k === cur && t >= w.s;
        return (
          <span key={k} style={{ fontFamily: TEXT, fontWeight: 800, fontSize: 66, color: on ? INK : PAPER, background: on ? SUN : "transparent", padding: "2px 14px", borderRadius: 12, transform: `scale(${on ? 1.06 : 1})` }}>
            {w.w}
          </span>
        );
      })}
    </div>
  );
}

export function Reel({ audio, handle, total, scenes }: ReelProps) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      <Backdrop scenes={scenes} />
      <Audio src={staticFile(audio)} />
      {/* progress along the top so viewers feel how short it is */}
      <div style={{ position: "absolute", top: 0, left: 0, height: 10, width: `${Math.min(1, f / fps / total) * 100}%`, background: SUN }} />
      <div style={{ position: "absolute", top: 70, width: "100%", textAlign: "center", fontFamily: TEXT, fontWeight: 800, fontSize: 38, color: PAPER, opacity: 0.7 }}>{handle}</div>
      {scenes.map((s, i) => {
        const from = Math.round(s.start * fps);
        const next = scenes[i + 1];
        const until = Math.round((next ? next.start : total + 0.6) * fps);
        return (
          <Sequence key={i} from={from} durationInFrames={Math.max(1, until - from)}>
            <ExitFade frames={until - from}>
              <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: "0 70px 420px" }}>
                <SceneBody scene={s} />
              </AbsoluteFill>
            </ExitFade>
          </Sequence>
        );
      })}
      <Captions scenes={scenes} />
    </AbsoluteFill>
  );
}

function ExitFade({ frames, children }: { frames: number; children: React.ReactNode }) {
  const f = useCurrentFrame();
  const o = interpolate(f, [frames - 6, frames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
}
