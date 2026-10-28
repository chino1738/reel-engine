import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  random,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadSerif } from "@remotion/google-fonts/InstrumentSerif";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { loadFont as loadHand } from "@remotion/google-fonts/Caveat";

export const { fontFamily: STAMP } = loadAnton("normal", { subsets: ["latin", "latin-ext"] });
export const { fontFamily: SANS } = loadInter("normal", { weights: ["600", "800"], subsets: ["latin", "latin-ext"] });
const { fontFamily: SERIF } = loadSerif("italic", { subsets: ["latin", "latin-ext"] });
const { fontFamily: MONO } = loadMono("normal", { weights: ["500"], subsets: ["latin"] });
export const { fontFamily: HAND } = loadHand("normal", { weights: ["700"], subsets: ["latin", "latin-ext"] });

export const FPS = 30;
export const PAPER = "#F1ECE2";
export const INK = "#191613";
export const RED = "#E0352B";
const CORK = "#B98A5A";

type Word = { w: string; s: number; e: number };
type Base = {
  start: number;
  end: number;
  words: Word[];
  say: string;
  em?: string[] | string;
  stamp?: string;
  props?: string[]; // resolved image paths in public/
  mascot?: string; // resolved image path
};
export type CScene = Base &
  (
    | { kind: "hook" | "line" | "end"; big?: string }
    | { kind: "stat"; big: string; label: string }
    | { kind: "compare"; a: string; b: string; aNote?: string; bNote?: string }
    | { kind: "list"; items: string[] }
  );
export type CollageProps = { audio: string; handle: string; total: number; scenes: CScene[] };

export const pop = (f: number, fps: number, delay = 0, damping = 11) =>
  spring({ frame: f - delay, fps, config: { damping, mass: 0.55, stiffness: 170 } });
export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/* Die-cut sticker: white outline + soft contact shadow, made from the PNG's own alpha. */
export const STICKER =
  "drop-shadow(4px 0 0 #fff) drop-shadow(-4px 0 0 #fff) drop-shadow(0 4px 0 #fff) drop-shadow(0 -4px 0 #fff) drop-shadow(0 18px 22px rgba(40,25,10,0.28))";

function Sticker({ src, size, delay = 0, tilt = 0, x = 0, y = 0 }: { src: string; size: number; delay?: number; tilt?: number; x?: number; y?: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = pop(f, fps, delay);
  const bob = Math.sin((f + delay * 7) / 14) * 8;
  return (
    <Img
      src={staticFile(src)}
      style={{
        position: "absolute",
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        objectFit: "contain",
        filter: STICKER,
        scale: String(Math.max(0, p)),
        rotate: `${tilt + (1 - p) * -25}deg`,
        translate: `0px ${bob}px`,
      }}
    />
  );
}

/* Rubber stamp that slams down. */
export function Stamp({ text, x, y, size = 120, delay = 0, tilt = -8 }: { text: string; x: number; y: number; size?: number; delay?: number; tilt?: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: f - delay, fps, config: { damping: 9, mass: 0.5, stiffness: 260 } });
  if (f < delay) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        translate: "-50% -50%",
        rotate: `${tilt}deg`,
        scale: String(interpolate(p, [0, 1], [2.2, 1])),
        opacity: interpolate(p, [0, 0.25], [0, 1], clamp),
        fontFamily: STAMP,
        fontSize: size,
        lineHeight: 0.95,
        color: RED,
        textTransform: "uppercase",
        border: `${Math.round(size / 14)}px solid ${RED}`,
        borderRadius: 14,
        padding: `${size * 0.08}px ${size * 0.2}px ${size * 0.04}px`,
        background: "rgba(255,255,255,0.85)",
        whiteSpace: "nowrap",
        boxShadow: "0 10px 24px rgba(40,25,10,0.18)",
      }}
    >
      {text}
    </div>
  );
}

/* Hand-drawn red loop that draws itself around something. */
export function DrawCircle({ cx, cy, rx, ry, delay = 0 }: { cx: number; cy: number; rx: number; ry: number; delay?: number }) {
  const f = useCurrentFrame();
  const t = interpolate(f, [delay, delay + 14], [0, 1], clamp);
  const len = 2 * Math.PI * Math.max(rx, ry) * 1.15;
  // slightly overshooting loop, like a marker
  const d = `M ${cx - rx} ${cy} C ${cx - rx} ${cy - ry * 1.1}, ${cx + rx * 1.05} ${cy - ry * 1.05}, ${cx + rx} ${cy} S ${cx - rx * 0.6} ${cy + ry * 1.15}, ${cx - rx * 1.02} ${cy - ry * 0.15}`;
  return (
    <svg style={{ position: "absolute", inset: 0 }} width={1080} height={1920}>
      <path d={d} fill="none" stroke={RED} strokeWidth={9} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - t)} />
    </svg>
  );
}

/* Polaroid pinned to the board. */
function Polaroid({ src, caption, x, y, tilt, delay }: { src: string; caption: string; x: number; y: number; tilt: number; delay: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = pop(f, fps, delay, 13);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 400,
        translate: "-50% -50%",
        rotate: `${tilt + (1 - p) * 12}deg`,
        scale: String(Math.max(0, p)),
        background: "#FBF8F2",
        padding: "18px 18px 10px",
        boxShadow: "0 16px 30px rgba(40,25,10,0.35)",
      }}
    >
      <div style={{ position: "absolute", top: -14, left: "50%", translate: "-50% 0", width: 26, height: 26, borderRadius: "50%", background: RED, boxShadow: "0 3px 6px rgba(0,0,0,0.35)" }} />
      <div style={{ height: 330, background: "#E6DED0", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Img src={staticFile(src)} style={{ width: 250, height: 250, objectFit: "contain", filter: "drop-shadow(0 10px 12px rgba(0,0,0,0.25))" }} />
      </div>
      <div style={{ fontFamily: HAND, fontWeight: 700, fontSize: 50, color: INK, textAlign: "center", marginTop: 4 }}>{caption}</div>
    </div>
  );
}

/* The spoken sentence builds word by word; chosen words go red italic serif. */
export function Headline({ scene }: { scene: CScene }) {
  const cork = scene.kind === "hook";
  const f = useCurrentFrame();
  const t = scene.start + f / FPS;
  const em = new Set([scene.em ?? []].flat().map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")));
  const words = scene.words.length ? scene.words : scene.say.split(" ").map((w) => ({ w, s: scene.start, e: scene.start }));
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: 150, display: "flex", flexWrap: "wrap", gap: "0 18px", alignItems: "baseline" }}>
      {words.map((w, i) => {
        const shown = t >= w.s - 0.05;
        const key = w.w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
        const isEm = em.has(key);
        const age = (t - w.s) * FPS;
        return (
          <span
            key={i}
            style={{
              fontFamily: isEm ? SERIF : SANS,
              fontStyle: isEm ? "italic" : "normal",
              fontWeight: isEm ? 400 : 600,
              fontSize: isEm ? 84 : 70,
              lineHeight: 1.18,
              letterSpacing: isEm ? "0" : "-0.02em",
              color: cork ? (isEm ? "#FFD08A" : "#FFF8EC") : isEm ? RED : INK,
              textShadow: cork ? "0 3px 14px rgba(20,12,4,0.55)" : undefined,
              opacity: shown ? interpolate(age, [0, 3], [0.25, 1], clamp) : 0,
              translate: `0px ${shown ? interpolate(age, [0, 4], [10, 0], clamp) : 0}px`,
            }}
          >
            {w.w}
          </span>
        );
      })}
    </div>
  );
}

export function Board({ cork }: { cork: boolean }) {
  // deterministic speckles so the cork reads as a material, not a flat fill
  const dots = cork
    ? Array.from({ length: 260 }, (_, i) => ({ x: random(`x${i}`) * 1080, y: random(`y${i}`) * 1920, r: 2 + random(`r${i}`) * 5, o: 0.12 + random(`o${i}`) * 0.25 }))
    : [];
  return (
    <AbsoluteFill style={{ background: cork ? CORK : PAPER }}>
      {cork ? (
        dots.map((d, i) => (
          <div key={i} style={{ position: "absolute", left: d.x, top: d.y, width: d.r, height: d.r, borderRadius: "50%", background: i % 3 ? "#7A5530" : "#E2C49A", opacity: d.o }} />
        ))
      ) : (
        <AbsoluteFill
          style={{
            backgroundImage:
              "linear-gradient(rgba(25,22,19,0.045) 2px, transparent 2px), linear-gradient(90deg, rgba(25,22,19,0.045) 2px, transparent 2px)",
            backgroundSize: "72px 72px",
          }}
        />
      )}
      {cork && <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(20,12,4,0.55) 0%, rgba(20,12,4,0) 30%, rgba(20,12,4,0) 70%, rgba(20,12,4,0.35) 100%)" }} />}
    </AbsoluteFill>
  );
}

function Stage({ scene, index }: { scene: CScene; index: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur = (scene.end - scene.start) * fps;
  const props = scene.props ?? [];
  const stampAt = Math.round(dur * 0.45);
  switch (scene.kind) {
    case "hook":
      return (
        <>
          {props[0] && <Polaroid src={props[0]} caption={labelOf(props[0])} x={290} y={780} tilt={-7} delay={2} />}
          {props[1] && <Polaroid src={props[1]} caption={labelOf(props[1])} x={790} y={730} tilt={5} delay={6} />}
          {props[2] && <Polaroid src={props[2]} caption={labelOf(props[2])} x={430} y={1270} tilt={-3} delay={10} />}
          <Stamp text={scene.stamp || "WHY?"} x={600} y={1040} size={170} delay={stampAt} />
        </>
      );
    case "line":
      return (
        <>
          {props[0] && <Sticker src={props[0]} size={640} x={520} y={960} delay={2} tilt={-4} />}
          {props[1] && <Sticker src={props[1]} size={270} x={860} y={660} delay={9} tilt={10} />}
          <DrawCircle cx={520} cy={960} rx={390} ry={360} delay={12} />
          {scene.stamp && <Stamp text={scene.stamp} x={330} y={1360} size={110} delay={stampAt} tilt={-6} />}
        </>
      );
    case "stat": {
      const p = pop(f, fps, 0, 14);
      const u = interpolate(f, [8, 22], [0, 1], clamp);
      return (
        <>
          <div style={{ position: "absolute", top: 700, width: "100%", textAlign: "center", fontFamily: STAMP, fontSize: 400, color: INK, lineHeight: 1, scale: String(0.7 + 0.3 * p), opacity: p, fontVariantNumeric: "tabular-nums" }}>
            {scene.big}
          </div>
          <svg style={{ position: "absolute", inset: 0 }} width={1080} height={1920}>
            <path d="M 190 1120 Q 540 1070 890 1110" fill="none" stroke={RED} strokeWidth={16} strokeLinecap="round" strokeDasharray={620} strokeDashoffset={620 * (1 - u)} />
          </svg>
          <div style={{ position: "absolute", top: 1170, left: 110, right: 110, textAlign: "center", fontFamily: SANS, fontWeight: 800, fontSize: 62, color: INK, opacity: interpolate(f, [10, 18], [0, 1], clamp) }}>{scene.label}</div>
          {props[0] && <Sticker src={props[0]} size={300} x={850} y={640} delay={6} tilt={12} />}
          {props[1] && <Sticker src={props[1]} size={220} x={190} y={1380} delay={12} tilt={-10} />}
        </>
      );
    }
    case "compare": {
      const card = (title: string, note: string | undefined, src: string | undefined, x: number, tilt: number, d: number) => {
        const p = pop(f, fps, d, 13);
        return (
          <div style={{ position: "absolute", left: x, top: 640, width: 460, height: 640, translate: "-50% 0", rotate: `${tilt}deg`, scale: String(Math.max(0, p)), background: "#FFFDF8", borderRadius: 16, boxShadow: "0 18px 34px rgba(40,25,10,0.22)", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 40 }}>
            <div style={{ position: "absolute", top: -22, width: 150, height: 44, background: "rgba(232,214,170,0.85)", rotate: "-4deg" }} />
            {src && <Img src={staticFile(src)} style={{ width: 280, height: 280, objectFit: "contain", filter: "drop-shadow(0 12px 14px rgba(0,0,0,0.22))" }} />}
            <div style={{ fontFamily: STAMP, fontSize: 76, color: INK, textTransform: "uppercase", marginTop: 26, textAlign: "center", lineHeight: 1 }}>{title}</div>
            {note && <div style={{ fontFamily: HAND, fontWeight: 700, fontSize: 48, color: RED, marginTop: 12, textAlign: "center", padding: "0 20px", lineHeight: 1 }}>{note}</div>}
          </div>
        );
      };
      return (
        <>
          {card(scene.a, scene.aNote, props[0], 300, -4, 0)}
          {card(scene.b, scene.bNote, props[1], 780, 3, 7)}
          <Stamp text="VS" x={540} y={1330} size={120} delay={14} tilt={-10} />
        </>
      );
    }
    case "list": {
      const step = Math.max(10, dur / (scene.items.length + 1));
      return (
        <>
          {scene.items.map((it, i) => {
            const d = Math.round(i * step);
            const p = pop(f, fps, d, 12);
            return (
              <div key={i} style={{ position: "absolute", left: 90, right: 90, top: 660 + i * 230, display: "flex", alignItems: "center", gap: 34, opacity: Math.min(1, p * 1.5), translate: `${(1 - p) * -140}px 0px` }}>
                <div style={{ width: 150, height: 150, flex: "none", borderRadius: 34, background: INK, color: "#fff", fontFamily: STAMP, fontSize: 110, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 12px 20px rgba(0,0,0,0.25)", rotate: `${i % 2 ? 3 : -3}deg` }}>{i + 1}</div>
                <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 66, color: INK, lineHeight: 1.05, letterSpacing: "-0.02em" }}>{it}</div>
                {props[i] && <Img src={staticFile(props[i])} style={{ marginLeft: "auto", width: 130, height: 130, objectFit: "contain", filter: STICKER }} />}
              </div>
            );
          })}
        </>
      );
    }
    case "end":
      return (
        <>
          {props[0] && <Sticker src={props[0]} size={520} x={540} y={900} delay={2} tilt={-6} />}
          {props[1] && <Sticker src={props[1]} size={240} x={200} y={700} delay={7} tilt={-12} />}
          <Stamp text="FOLLOW FOR MORE" x={540} y={1300} size={110} delay={8} tilt={-5} />
        </>
      );
  }
  void index;
}

function labelOf(src: string) {
  const words = src.split("/").pop()!.replace(/\.png$/, "").split("-").filter((w) => !["and", "with", "of", "the", "a", "in", "on"].includes(w));
  return words.slice(0, 2).join(" ");
}

/* The 3D mascot: swaps pose per scene with a squash-and-stretch hop, idles with a gentle bob. */
export function Mascot({ scenes }: { scenes: CScene[] }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = f / fps;
  let i = scenes.findIndex((s) => t < s.end + 0.25);
  if (i < 0) i = scenes.length - 1;
  const s = scenes[i];
  if (!s.mascot) return null;
  const since = Math.round((t - s.start) * fps);
  const hop = spring({ frame: since, fps, config: { damping: 8, mass: 0.5, stiffness: 220 } });
  const enter = spring({ frame: f, fps, config: { damping: 14 } });
  return (
    <Img
      src={staticFile(s.mascot)}
      style={{
        position: "absolute",
        right: -30,
        bottom: -40,
        width: 470,
        height: 470,
        objectFit: "contain",
        filter: "drop-shadow(0 18px 24px rgba(40,25,10,0.35))",
        translate: `${(1 - enter) * 300}px ${Math.sin(f / 11) * 7 - interpolate(hop, [0, 1], [40, 0])}px`,
        scale: `${interpolate(hop, [0, 1], [1.08, 1])} ${interpolate(hop, [0, 1], [0.9, 1])}`,
        rotate: `${Math.sin(f / 17) * 2}deg`,
      }}
    />
  );
}

export function Chrome({ scenes, total, handle }: { scenes: CScene[]; total: number; handle: string }) {
  const f = useCurrentFrame();
  const t = f / FPS;
  let i = scenes.findIndex((s) => t < s.end + 0.25);
  if (i < 0) i = scenes.length - 1;
  const cork = scenes[i].kind === "hook";
  const tone = cork ? "rgba(255,248,236,0.85)" : "rgba(25,22,19,0.55)";
  const names: Record<string, string> = { hook: "the hook", line: "the why", stat: "the number", compare: "side by side", list: "the steps", end: "that's it" };
  return (
    <>
      <div style={{ position: "absolute", top: 82, left: 70, fontFamily: MONO, fontSize: 28, color: tone, letterSpacing: "0.02em" }}>
        {`// ${String(i + 1).padStart(2, "0")} · ${names[scenes[i].kind]}`}
      </div>
      <div style={{ position: "absolute", top: 80, right: 70, fontFamily: MONO, fontSize: 28, color: tone }}>{handle}</div>
      <div style={{ position: "absolute", top: 0, left: 0, height: 8, width: `${Math.min(1, t / total) * 100}%`, background: RED }} />
    </>
  );
}

/* Pops, stamp thuds and whooshes on the same frames the visuals use. */
function sfxFor(s: CScene, fps: number): { at: number; src: string; vol: number }[] {
  const dur = (s.end - s.start) * fps;
  const stampAt = Math.round(dur * 0.45);
  const pops = (ds: number[]) => ds.map((d) => ({ at: d + 3, src: "sfx/pop.wav", vol: 0.35 }));
  const n = (s.props ?? []).length;
  switch (s.kind) {
    case "hook":
      return [...pops([2, 6, 10].slice(0, n)), { at: stampAt + 2, src: "sfx/thud.wav", vol: 0.8 }];
    case "line":
      return [...pops([2, 9].slice(0, n)), ...(s.stamp ? [{ at: stampAt + 2, src: "sfx/thud.wav", vol: 0.7 }] : [])];
    case "stat":
      return [{ at: 2, src: "sfx/thud.wav", vol: 0.6 }, ...pops([6, 12].slice(0, n))];
    case "compare":
      return [...pops([0, 7]), { at: 16, src: "sfx/thud.wav", vol: 0.7 }];
    case "list": {
      const step = Math.max(10, dur / (s.items.length + 1));
      return pops(s.items.map((_, i) => Math.round(i * step)));
    }
    case "end":
      return [...pops([2, 7].slice(0, Math.max(1, n))), { at: 10, src: "sfx/thud.wav", vol: 0.8 }];
  }
}

export function Collage({ audio, handle, total, scenes }: CollageProps) {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <Audio src={staticFile(audio)} />
      {scenes.map((s, i) => {
        const from = Math.round(s.start * fps);
        return (
          <Sequence key={`fx${i}`} from={from} layout="none">
            {i > 0 && <Sequence from={-2} durationInFrames={12} layout="none"><Audio src={staticFile("sfx/whoosh.wav")} volume={0.25} /></Sequence>}
            {sfxFor(s, fps).map((x, k) => (
              <Sequence key={k} from={x.at} durationInFrames={10} layout="none">
                <Audio src={staticFile(x.src)} volume={x.vol} />
              </Sequence>
            ))}
          </Sequence>
        );
      })}
      {scenes.map((s, i) => {
        const from = Math.round(s.start * fps);
        const next = scenes[i + 1];
        const until = Math.round((next ? next.start : total + 0.6) * fps);
        return (
          <Sequence key={i} from={from} durationInFrames={Math.max(1, until - from)}>
            <Board cork={s.kind === "hook"} />
            <Exit frames={until - from}>
              <Stage scene={s} index={i} />
            </Exit>
            <Headline scene={s} />
          </Sequence>
        );
      })}
      <Mascot scenes={scenes} />
      <Chrome scenes={scenes} total={total} handle={handle} />
    </AbsoluteFill>
  );
}

export function Exit({ frames, children }: { frames: number; children: React.ReactNode }) {
  const f = useCurrentFrame();
  const o = interpolate(f, [frames - 5, frames], [1, 0], clamp);
  return <AbsoluteFill style={{ opacity: o, scale: String(interpolate(f, [frames - 5, frames], [1, 0.94], clamp)) }}>{children}</AbsoluteFill>;
}
