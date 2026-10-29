/*
 * 3D sample: one bars scene rebuilt in real 3D (Three.js) so the 2.5D look can be compared.
 * Coins drop into stacks under real lights and shadows while the camera orbits.
 * Heavier to render than Data (WebGL), so it renders with concurrency 1.
 */
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { Caption, type DataScene } from "./Data";

const { fontFamily: DISPLAY } = loadAnton("normal", { subsets: ["latin"] });
const { fontFamily: SANS } = loadInter("normal", { weights: ["800"], subsets: ["latin"] });

const BG = "#0A0D13";
const GOLD = "#F5B83D";
const WHITE = "#F4F1EA";
const MUTED = "rgba(244,241,234,0.55)";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export type Data3DProps = { audio: string; handle: string; scene: DataScene };

const COIN = 0.17; // coin thickness + gap
const num = (v: number | string) => Number(String(v).replace(/[^0-9.\-]/g, "")) || 0;
// one coin per quarter, so the stacks are honest about the ratio
const coinsFor = (v: number | string) => Math.max(1, Math.min(24, Math.round(num(v) / 0.25)));
const dropDelay = (stack: number, k: number) => 8 + stack * 16 + k * 1.6;

function Rig() {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const camera = useThree((s) => s.camera);
  const a = interpolate(f, [0, durationInFrames], [-0.32, 0.12]);
  const r = interpolate(f, [0, durationInFrames], [17, 14.5]);
  const h = interpolate(f, [0, durationInFrames], [3.5, 5]);
  camera.position.set(Math.sin(a) * r, h, Math.cos(a) * r);
  // aim above the stacks so they sit in the lower half, under the numbers
  camera.lookAt(0, 3.6, 0);
  return null;
}

function Stack({ x, value, hero, index }: { x: number; value: number | string; hero: boolean; index: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const n = coinsFor(value);
  return (
    <group position={[x, 0, 0]}>
      {Array.from({ length: n }, (_, k) => {
        const p = spring({ frame: f - dropDelay(index, k), fps, config: { damping: 11, mass: 0.5, stiffness: 180 } });
        if (f < dropDelay(index, k)) return null;
        const y = 0.08 + k * COIN + (1 - p) * 3.5;
        const wob = (1 - p) * (k % 2 ? 0.35 : -0.35);
        return (
          <mesh key={k} position={[((k * 37) % 7) * 0.006 - 0.018, y, 0]} rotation={[wob, k * 0.6, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.8, 0.8, 0.15, 64]} />
            <meshStandardMaterial color={hero ? GOLD : "#B8C2D4"} metalness={0.45} roughness={0.3} emissive={hero ? "#5A3A00" : "#1A2030"} />
          </mesh>
        );
      })}
    </group>
  );
}

function World({ scene }: { scene: DataScene }) {
  const items = (scene.items ?? []).slice(0, 3);
  const gap = 3.2;
  return (
    <>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 9, 20]} />
      <Rig />
      <hemisphereLight args={["#FFF4E0", "#0A0D13", 0.9]} />
      <spotLight position={[3, 10, 6]} angle={0.45} penumbra={0.7} intensity={420} decay={1.6} color="#FFE2B0" castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-5, 4, -6]} intensity={1.6} color="#7FB8FF" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#10141C" metalness={0.3} roughness={0.45} />
      </mesh>
      <gridHelper args={[40, 40, "#2A3140", "#1A1F2A"]} position={[0, 0.002, 0]} />
      {items.map((it, i) => (
        <Stack key={i} index={i} x={(i - (items.length - 1) / 2) * gap} value={it.value} hero={i === 0} />
      ))}
    </>
  );
}

export function Data3D({ audio, handle, scene }: Data3DProps) {
  const f = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const items = (scene.items ?? []).slice(0, 3);
  const money = /^[$€£¥]$/.test(scene.unit ?? "");
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Audio src={staticFile(audio)} startFrom={Math.round(scene.start * fps)} endAt={Math.round(scene.end * fps) + 6} />
      <ThreeCanvas width={1080} height={1920} shadows camera={{ fov: 38 }}>
        <World scene={scene} />
      </ThreeCanvas>
      <Caption scene={scene} />
      <div style={{ position: "absolute", top: 80, right: 70, fontFamily: "monospace", fontSize: 28, color: MUTED }}>{handle}</div>
      {scene.label && <div style={{ position: "absolute", top: 560, left: 0, right: 0, textAlign: "center", fontFamily: SANS, fontWeight: 800, fontSize: 40, letterSpacing: "0.08em", color: MUTED, textTransform: "uppercase" }}>{scene.label}</div>}
      <div style={{ position: "absolute", top: 640, left: 80, right: 80, display: "flex", justifyContent: "space-around" }}>
        {items.map((it, i) => {
          const n = coinsFor(it.value);
          const landed = interpolate(f, [dropDelay(i, 0), dropDelay(i, n - 1) + 8], [0, 1], clamp);
          const v = (num(it.value) * landed).toFixed(money ? 2 : 0);
          return (
            <div key={i} style={{ textAlign: "center", opacity: f >= dropDelay(i, 0) ? 1 : 0 }}>
              <div style={{ fontFamily: DISPLAY, fontSize: 120, color: i === 0 ? GOLD : WHITE, lineHeight: 1 }}>{money ? `${scene.unit}${v}` : `${v}${scene.unit ?? ""}`}</div>
              <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 34, color: MUTED, textTransform: "uppercase", marginTop: 10 }}>{it.label}</div>
            </div>
          );
        })}
      </div>
      {items.map((it, i) =>
        Array.from({ length: coinsFor(it.value) }, (_, k) => k % 3 === 0 && (
          <Sequence key={`${i}-${k}`} from={Math.round(dropDelay(i, k)) + 5} durationInFrames={10} layout="none">
            <Audio src={staticFile("sfx/pop.wav")} volume={0.16} />
          </Sequence>
        )),
      )}
      <div style={{ position: "absolute", top: 0, left: 0, height: 8, width: `${(f / durationInFrames) * 100}%`, background: GOLD }} />
    </AbsoluteFill>
  );
}
