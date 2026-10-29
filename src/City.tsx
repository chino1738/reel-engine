/*
 * City style: one little low-poly city (Kenney CC0 kits) that the script directs like a film set.
 * Each scene picks a location (highway, downtown, suburb, store), a camera shot, and what happens
 * there: traffic thickening or clearing, a lane being laid, a tower rising, houses spreading out,
 * people walking into a store, someone reacting. The world explains the idea; captions stay small.
 * Everything is a pure function of the frame, so renders are deterministic.
 */
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, delayRender, continueRender, Easing } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree, type ThreeElements } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Chrome, Counter, Statement, phrases, sfxFor, type DataScene } from "./Data";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";

const { fontFamily: SANS } = loadInter("normal", { weights: ["800"], subsets: ["latin", "latin-ext"] });
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

type SetName = "highway" | "downtown" | "suburb" | "store" | "track";
type Shot = "aerial" | "street" | "chase" | "orbit" | "reaction" | "driver" | "scientist";
type Mood = "angry" | "bored" | "shocked" | "relieved";
export type CityScene = DataScene & {
  set?: SetName;
  shot?: Shot;
  traffic?: { level?: number; to?: number; at?: number };
  brake?: { at?: number }; // one driver in view brakes hard on this word; the queue behind reacts
  build?: { what?: "lane" | "tower" | "houses"; at?: number };
  people?: { count?: number; do?: "walk" | "run" | "enter"; at?: number };
  reaction?: { do?: "no" | "yes" | "idle" | "pick-up" };
  mood?: Mood; // driver close-ups
  scientists?: { do?: "instruct" | "watch" | "cheer"; bubble?: string }; // test track
};
export type CityProps = { audio: string; handle: string; total: number; scenes: CityScene[] };
type Timed = CityScene & { from: number; frames: number };
type Lib = Record<string, GLTF>;

const T = 4; // world units per road tile (the kits are built on 1-unit tiles)
const SKY = "#BFE2F2";
// each set sits in its own patch of the world; fog hides the others
const ORIGIN: Record<SetName, THREE.Vector3> = {
  highway: new THREE.Vector3(0, 0, 0),
  downtown: new THREE.Vector3(0, 0, -240),
  suburb: new THREE.Vector3(0, 0, 240),
  store: new THREE.Vector3(0, 0, -240), // the store is a shop front inside downtown
  track: new THREE.Vector3(320, 0, 0), // a ring road in a field, for experiments
};
const setOf = (s: CityScene): SetName => s.set ?? "highway";
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const atFrame = (s: Timed, at: number | undefined, fps: number, fallback = 0.35) =>
  Math.round(((at ?? s.start + (s.end - s.start) * fallback) - s.start) * fps);

/* ── assets: every model loads once; scenes place clones ── */

const CARS = ["sedan", "taxi", "suv", "van", "hatchback-sports", "truck", "delivery", "sedan-sports", "suv-luxury", "police"];
const SHOPS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n"].map((k) => `building-${k}`);
const TOWERS = ["a", "b", "c", "d", "e"].map((k) => `building-skyscraper-${k}`);
const HOUSES = "abcdefghijklmnopqrstu".split("").map((k) => `building-type-${k}`);
const PEOPLE = "abcdefghijklmnopqr".split("").map((k) => `character-${k}`);
const ASSETS: Record<string, string> = {
  road: "city/roads/road-straight.glb",
  cross: "city/roads/road-crossroad.glb",
  light: "city/roads/light-square.glb",
  cone: "city/roads/construction-barrier.glb",
  tree: "city/suburban/tree-large.glb",
  treeS: "city/suburban/tree-small.glb",
  drive: "city/suburban/driveway-short.glb",
  fence: "city/suburban/fence-1x4.glb",
  awning: "city/commercial/detail-awning-wide.glb",
  trackCone: "city/cars/cone.glb",
  ...Object.fromEntries(CARS.map((c) => [c, `city/cars/${c}.glb`])),
  ...Object.fromEntries(SHOPS.map((c) => [c, `city/commercial/${c}.glb`])),
  ...Object.fromEntries(TOWERS.map((c) => [c, `city/commercial/${c}.glb`])),
  ...Object.fromEntries(HOUSES.map((c) => [c, `city/suburban/${c}.glb`])),
  ...Object.fromEntries(PEOPLE.map((c) => [c, `city/people/${c}.glb`])),
};

function useAssets() {
  const [lib, setLib] = useState<Lib | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [handle] = useState(() => delayRender("city assets"));
  useEffect(() => {
    const loader = new GLTFLoader();
    Promise.all(Object.entries(ASSETS).map(([k, src]) => loader.loadAsync(staticFile(src)).then((g) => {
      g.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      g.userData.box = new THREE.Box3().setFromObject(g.scene); // tail lights sit on the back face
      g.userData.height = g.userData.box.getSize(new THREE.Vector3()).y; // characters get sized from this
      return [k, g] as const;
    }))).then((all) => setLib(Object.fromEntries(all)), (e) => setErr(String(e?.message ?? e)));
  }, [handle]);
  // release the frame only after React has committed the loaded world (the canvas mounts with it)
  useEffect(() => { if (lib || err) continueRender(handle); }, [lib, err, handle]);
  return { lib, err };
}

function Model({ lib, name, ...rest }: { lib: Lib; name: string } & ThreeElements["group"]) {
  const obj = useMemo(() => lib[name]?.scene.clone(true), [lib, name]);
  return obj ? <group {...rest}><primitive object={obj} /></group> : null;
}

// an animated character: its own clone + mixer, posed at an exact time each frame
const PERSON_H = 1.6; // world units; a car is ~0.9 tall, a shop ~5
function Person({ lib, name, clip, time, size = 1, head, lean = 0, ...rest }: { lib: Lib; name: string; clip: string; time: number; size?: number; head?: { yaw?: number; pitch?: number }; lean?: number } & ThreeElements["group"]) {
  const { obj, mixer, joints } = useMemo(() => {
    const o = lib[name].scene.clone(true);
    // rest pose of the joints we nudge by hand, so the nudges never pile up frame after frame
    const joints = ["head", "torso"].map((n) => { const j = o.getObjectByName(n); return j ? { j, r: j.rotation.clone() } : null; }).filter(Boolean) as { j: THREE.Object3D; r: THREE.Euler }[];
    return { obj: o, mixer: new THREE.AnimationMixer(o), joints };
  }, [lib, name]);
  for (const { j, r } of joints) j.rotation.copy(r);
  const anim = lib[name].animations.find((a) => a.name === clip) ?? lib[name].animations.find((a) => a.name === "idle");
  if (anim) {
    mixer.stopAllAction();
    mixer.clipAction(anim).play();
    mixer.setTime(time % anim.duration);
  }
  const h = obj.getObjectByName("head"), torso = obj.getObjectByName("torso");
  if (h && head) { h.rotation.y += head.yaw ?? 0; h.rotation.x += head.pitch ?? 0; }
  if (torso && lean) torso.rotation.x += lean;
  const k = (PERSON_H / (lib[name].userData.height || 1)) * size;
  return <group {...rest}><group scale={k}><primitive object={obj} /></group></group>;
}

/* ── traffic: cars on loops; density fills more slots and slows everyone down ── */

function densityAt(s: Timed, local: number, fps: number) {
  const tr = s.traffic ?? {};
  const a = tr.level ?? 0.35;
  if (tr.to === undefined) return a;
  const at = atFrame(s, tr.at, fps, 0.4);
  return lerp(a, tr.to, Easing.inOut(Easing.cubic)(interpolate(local, [at, at + fps * 1.6], [0, 1], clamp)));
}

/* ── traffic: a car-following simulation (the Intelligent Driver Model traffic engineers use) ──
   Every car keeps a safe gap and reacts to the car ahead, so one hard brake sends a slowdown wave
   backwards through the queue, and cars can never overlap. Downtown intersections run on lights. */

// `show` is the stretch of the loop that's on the map; outside it cars are hidden and can spawn
type Lane = { id: number; a: THREE.Vector3; dir: THREE.Vector3; len: number; show: [number, number]; opensAt?: number; stops?: number[]; phase?: 0 | 1;
  ring?: { c: THREE.Vector3; r: number }; count?: number; headway?: number };
type Car = { id: number; u: number; v: number; a: number };

const CAR_LEN = 1.75, GAP0 = 0.9, HEADWAY = 1.0, ACC = 1.2, DEC = 2.4, V0 = 9; // world units (~2.8 m) and seconds
const PREROLL = 90; // frames simulated before the scene starts so traffic has already settled
// signal cycle: x-roads green 0–5 s, all-red 1 s, z-roads green 6–11 s, all-red 1 s
const green = (phase: 0 | 1, t: number) => { const c = ((t % 12) + 12) % 12; return phase === 0 ? c < 5 : c >= 6 && c < 11; };
const hidden = (ln: Lane, u: number) => u < ln.show[0] || u > ln.show[1];

type LaneSim = { lane: Lane; frames: Car[][] };
type Sim = { lanes: LaneSim[]; heroLane?: number; hero?: number; braker?: number };

function simulateLane(ln: Lane, s: Timed, fps: number, brakeFrame: number, pickBraker?: (cars: Car[]) => number | undefined, pickHero?: (cars: Car[]) => number | undefined) {
  const nmax = Math.floor(ln.len / (CAR_LEN + GAP0 + 0.4));
  const target = (f: number) => (ln.count !== undefined ? ln.count : ln.opensAt !== undefined && f < ln.opensAt ? 0 : Math.round(densityAt(s, Math.max(0, f), fps) * nmax));
  const headway = ln.headway ?? HEADWAY;
  let cars: (Car & { v0: number })[] = [];
  let next = 0;
  const n0 = target(-PREROLL);
  for (let k = 0; k < n0; k++) cars.push({ id: next++, u: (k / Math.max(1, n0)) * ln.len, v: V0 * 0.5, a: 0, v0: 0 });
  cars.forEach((c) => (c.v0 = V0 * (0.88 + 0.24 * hash(ln.id * 13 + c.id))));
  const frames: Car[][] = [];
  let braker: number | undefined, hero: number | undefined, brakeUntil = -1;
  const dt = 1 / fps / 2;
  for (let f = -PREROLL; f <= s.frames + 2; f++) {
    if (f === 0 && pickHero) hero = pickHero(cars);
    if (f === brakeFrame && pickBraker) { braker = pickBraker(cars); brakeUntil = f + Math.round(fps * 1.2); }
    const t = (s.from + f) / fps;
    for (let sub = 0; sub < 2; sub++) {
      cars.sort((x, y) => x.u - y.u);
      const n = cars.length;
      for (let i = 0; i < n; i++) {
        const c = cars[i], lead = cars[(i + 1) % n];
        let gap = n > 1 ? (((lead.u - c.u - CAR_LEN) % ln.len) + ln.len) % ln.len : 1e9, vl = n > 1 ? lead.v : c.v;
        // a red light is a stopped car at the line, unless we're already over it
        if (ln.stops && ln.phase !== undefined && !green(ln.phase, t))
          for (const st of ln.stops) {
            const dl = (((st - c.u - CAR_LEN / 2) % ln.len) + ln.len) % ln.len;
            if (dl < gap && dl < 30 && c.v * c.v / (2 * 6) < dl + 0.5) { gap = dl; vl = 0; }
          }
        const sStar = GAP0 + Math.max(0, c.v * headway + (c.v * (c.v - vl)) / (2 * Math.sqrt(ACC * DEC)));
        c.a = ACC * (1 - Math.pow(c.v / c.v0, 4) - Math.pow(sStar / Math.max(gap, 0.05), 2));
        if (c.id === braker && f >= brakeFrame && f < brakeUntil) c.a = -7; // the driver who taps the brakes
        c.a = Math.max(-9, c.a);
      }
      for (const c of cars) { const v = Math.max(0, c.v + c.a * dt); c.u += ((c.v + v) / 2) * dt; c.v = v; }
      // hard guarantee: nobody ever ends up inside the car ahead
      cars.sort((x, y) => x.u - y.u);
      for (let i = cars.length - 2; i >= 0; i--) {
        const c = cars[i], lead = cars[i + 1];
        if (lead.u - c.u < CAR_LEN + 0.05) { c.u = lead.u - CAR_LEN - 0.05; c.v = Math.min(c.v, lead.v); }
      }
      for (const c of cars) c.u = ((c.u % ln.len) + ln.len) % ln.len;
    }
    // more or fewer cars: they join and leave off the map, never in view
    if (f % 4 === 0) {
      const want = target(f);
      if (cars.length < want) {
        cars.sort((x, y) => x.u - y.u);
        let best = -1, bestGap = 0;
        cars.forEach((c, i) => {
          const lead = cars[(i + 1) % cars.length];
          const g = cars.length > 1 ? (((lead.u - c.u) % ln.len) + ln.len) % ln.len : ln.len;
          const mid = (c.u + g / 2) % ln.len;
          if (g > bestGap && g > 2 * (CAR_LEN + GAP0) + 1 && hidden(ln, mid)) { best = i; bestGap = g; }
        });
        if (cars.length === 0) cars.push({ id: next++, u: (ln.show[1] + ln.len) / 2 % ln.len, v: V0 * 0.7, a: 0, v0: V0 });
        else if (best >= 0) { const c = cars[best]; cars.push({ id: next++, u: (c.u + bestGap / 2) % ln.len, v: c.v, a: 0, v0: V0 * (0.88 + 0.24 * hash(ln.id * 13 + next)) }); }
      } else if (cars.length > want) {
        const k = cars.findIndex((c) => hidden(ln, c.u) && c.id !== hero && c.id !== braker);
        if (k >= 0) cars.splice(k, 1);
      }
    }
    if (f >= 0) frames.push(cars.map((c) => ({ id: c.id, u: c.u, v: c.v, a: c.a })));
  }
  return { frames, braker, hero };
}

const simCache = new Map<string, Sim>();
const laneAt = (ln: Lane, u: number) => {
  if (!ln.ring) return ln.a.clone().addScaledVector(ln.dir, u);
  const th = u / ln.ring.r;
  return new THREE.Vector3(ln.ring.c.x + Math.cos(th) * ln.ring.r, 0, ln.ring.c.z + Math.sin(th) * ln.ring.r);
};
const dirAt = (ln: Lane, u: number) => (ln.ring ? new THREE.Vector3(-Math.sin(u / ln.ring.r), 0, Math.cos(u / ln.ring.r)) : ln.dir);

function simFor(s: Timed, fps: number): Sim {
  const key = `${s.from}|${s.frames}|${setOf(s)}|${s.shot}`;
  const hit = simCache.get(key);
  if (hit) return hit;
  const lanes = lanesFor(s, fps);
  const brakeFrame = s.brake ? atFrame(s, s.brake.at, fps, 0.3) : setOf(s) === "track" ? Math.round(s.frames * 0.3) : -1e9;
  const heroLane = s.shot === "aerial" || s.shot === "orbit" ? NEAR_LANE[setOf(s)] : HERO_LANE[setOf(s)];
  const sim: Sim = { lanes: [], heroLane };
  for (const ln of lanes) {
    if (ln.id !== heroLane) { sim.lanes.push({ lane: ln, frames: simulateLane(ln, s, fps, -1e9).frames }); continue; }
    // the hero lane: the camera rides behind one car; in a chase the car just ahead of it brakes,
    // otherwise whichever car is nearest the middle of the shot
    const focusU = (x: number) => (cars: Car[]) => cars.reduce<Car | undefined>((b, c) => (!b || Math.abs(laneAt(ln, c.u).x - x) < Math.abs(laneAt(ln, b.u).x - x) ? c : b), undefined)?.id;
    let heroId: number | undefined;
    const r = simulateLane(ln, s, fps, brakeFrame,
      s.shot === "chase"
        ? (cars) => { const sorted = [...cars].sort((x, y) => x.u - y.u); const i = sorted.findIndex((c) => c.id === heroId); return i >= 0 ? sorted[(i + 1) % sorted.length].id : undefined; }
        : focusU(FOCUS_X[setOf(s)]),
      (cars) => (heroId = focusU(FOCUS_X[setOf(s)] - 10)(cars)));
    sim.lanes.push({ lane: ln, frames: r.frames });
    sim.hero = r.hero;
    sim.braker = r.braker;
  }
  simCache.set(key, sim);
  return sim;
}

// where the hero car is at a frame (for the chase camera)
function heroPos(sim: Sim, local: number) {
  const ls = sim.lanes.find((l) => l.lane.id === sim.heroLane);
  const c = ls?.frames[Math.min(local, ls.frames.length - 1)]?.find((x) => x.id === sim.hero);
  return ls && c ? laneAt(ls.lane, c.u) : null;
}

function Traffic({ lib, s, local }: { lib: Lib; s: Timed; local: number }) {
  const { fps } = useVideoConfig();
  const sim = simFor(s, fps);
  const far = s.shot === "aerial" || s.shot === "orbit";
  const out: React.ReactNode[] = [];
  for (const { lane: ln, frames } of sim.lanes) {
    const cars = frames[Math.max(0, Math.min(local, frames.length - 1))] ?? [];
    for (const c of cars) {
      if (hidden(ln, c.u)) continue;
      const d = dirAt(ln, c.u);
      const yaw = Math.atan2(d.x, d.z);
      if (s.shot === "driver" && ln.id === sim.heroLane && c.id === sim.hero) {
        const p = laneAt(ln, c.u);
        out.push(<group key="cockpit" position={[p.x, 0.02, p.z]} rotation={[0, yaw, 0]}><Cockpit lib={lib} s={s} local={local} /></group>);
        continue;
      }
      // ease in/out at the map edge instead of popping
      const edge = Math.min(c.u - ln.show[0], ln.show[1] - c.u);
      const sc = Math.min(1, edge / 1.5);
      const p = laneAt(ln, c.u);
      const kind = CARS[Math.floor(hash(ln.id * 7 + c.id * 3) * CARS.length)];
      const braking = c.a < -0.4 || c.v < 0.3;
      // nose dips a touch under hard braking
      out.push(<CarModel key={`${ln.id}-${c.id}`} lib={lib} kind={kind} braking={braking} far={far} position={[p.x, 0.02, p.z]} rotation={[Math.max(0, -c.a) * 0.006, yaw, 0]} scale={0.62 * sc} />);
    }
  }
  return <>{out}</>;
}

// a car plus its tail lights; the lights only glow when it's slowing down or stopped
function CarModel({ lib, kind, braking, far = false, ...rest }: { lib: Lib; kind: string; braking: boolean; far?: boolean } & ThreeElements["group"]) {
  const obj = useMemo(() => lib[kind]?.scene.clone(true), [lib, kind]);
  const box = lib[kind]?.userData.box as THREE.Box3 | undefined;
  if (!obj || !box) return null;
  const rear = CAR_FRONT > 0 ? box.min.z : box.max.z;
  const w = (box.max.x - box.min.x) * 0.34, y = box.min.y + (box.max.y - box.min.y) * 0.42;
  return (
    <group {...rest}>
      <primitive object={obj} />
      {[-w, w].map((x) => (
        <group key={x} position={[x, y, rear - CAR_FRONT * 0.02]}>
          <mesh>
            <boxGeometry args={[0.36, 0.2, 0.06]} />
            <meshStandardMaterial color={braking ? "#FF2A1A" : "#5A1410"} emissive={braking ? "#FF2A1A" : "#000000"} emissiveIntensity={braking ? 4 : 0} toneMapped={false} />
          </mesh>
          {braking && (
            // soft glow so the brake reads on a phone screen, even from the drone
            // from the drone it lies flat and wide, so a braking wave reads as red rolling back down the lane
            <mesh position={far ? [0, 0.6, -CAR_FRONT * 0.4] : [0, 0, -CAR_FRONT * 0.05]} rotation={far ? [-Math.PI / 2, 0, 0] : [0, CAR_FRONT > 0 ? Math.PI : 0, 0]}>
              <circleGeometry args={[far ? 0.95 : 0.24, 20]} />
              <meshBasicMaterial color="#FF3B2A" transparent opacity={far ? 0.75 : 0.35} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

const X = new THREE.Vector3(1, 0, 0), NX = new THREE.Vector3(-1, 0, 0), Z = new THREE.Vector3(0, 0, 1), NZ = new THREE.Vector3(0, 0, -1);
const CAR_FRONT = 1; // the car kit's models face +z

/* ── roads as lanes, per set ── */

const MARGIN = 14; // off-map run-out at each end of a road, where cars wait out of sight
const HERO_LANE: Record<SetName, number> = { highway: 0, downtown: 108, store: 108, suburb: 300, track: 400 };
// on drone/orbit shots the brake happens in the lane nearest the camera, so the wave is easy to follow
const NEAR_LANE: Record<SetName, number> = { highway: 5 /* outer lane of the 3rd strip */, downtown: 108, store: 108, suburb: 300, track: 400 };
const FOCUS_X: Record<SetName, number> = { highway: 6, downtown: 0, store: 0, suburb: 0, track: 10 };

function lanesFor(s: Timed, fps: number): Lane[] {
  const set = setOf(s);
  const lanes: Lane[] = [];
  if (set === "track") {
    // the 2008 Nagoya experiment: 22 cars on a 230 m ring (89 world units), told to hold a steady speed
    const len = 2 * Math.PI * TRACK.r;
    lanes.push({ id: 400, a: new THREE.Vector3(), dir: X, len, show: [0, len], ring: { c: new THREE.Vector3(), r: TRACK.r }, count: 22, headway: 0.5 });
    return lanes;
  }
  if (set === "highway") {
    const L = HWY.len * T;
    const building = s.build?.what === "lane";
    const strips = HWY.strips + (building ? 1 : 0);
    const opens = building ? atFrame(s, s.build?.at, fps, 0.3) + 40 : undefined;
    for (let strip = 0; strip < strips; strip++)
      for (let lane = 0; lane < 2; lane++)
        lanes.push({ id: strip * 2 + lane, a: new THREE.Vector3(-L / 2, 0, strip * T + (lane ? 0.9 : -0.9)), dir: X, len: L, show: [0, L - 26], opensAt: strip >= HWY.strips ? opens : undefined });
    return lanes;
  }
  if (set === "suburb") {
    const L = SUB.n * T, M = 20;
    lanes.push({ id: 300, a: new THREE.Vector3(-L / 2 - M, 0, 0.9), dir: X, len: L + 2 * M, show: [M, L + M] });
    lanes.push({ id: 301, a: new THREE.Vector3(L / 2 + M, 0, -0.9), dir: NX, len: L + 2 * M, show: [M, L + M] });
    return lanes;
  }
  // downtown grid: every road line carries both directions; intersections run on two light phases
  const half = (DT.n / 2) * T, M = MARGIN, len = DT.n * T + 2 * M;
  const centres = [0, 3, 6, 9].map((k) => dtPos(k, k));
  const stopsAlong = (toU: (c: THREE.Vector3) => number) => centres.map((c) => toU(c) - T / 2 - 0.25).map((u) => ((u % len) + len) % len);
  [0, 3, 6, 9].forEach((k, n) => {
    const c = dtPos(k, k);
    const quiet = setOf(s) === "store" && k === STORE.j + 1; // the shop's own street stays clear for the shot
    if (!quiet) {
      lanes.push({ id: 100 + n * 4, a: new THREE.Vector3(-half - M, 0, c.z + 0.9), dir: X, len, show: [M, len - M], phase: 0, stops: stopsAlong((q) => q.x + half + M) });
      lanes.push({ id: 101 + n * 4, a: new THREE.Vector3(half + M, 0, c.z - 0.9), dir: NX, len, show: [M, len - M], phase: 0, stops: stopsAlong((q) => half + M - q.x) });
    }
    lanes.push({ id: 102 + n * 4, a: new THREE.Vector3(c.x - 0.9, 0, -half - M), dir: Z, len, show: [M, len - M], phase: 1, stops: stopsAlong((q) => q.z + half + M) });
    lanes.push({ id: 103 + n * 4, a: new THREE.Vector3(c.x + 0.9, 0, half + M), dir: NZ, len, show: [M, len - M], phase: 1, stops: stopsAlong((q) => half + M - q.z) });
  });
  return lanes;
}

/* ── highway: wide straight road; a new lane can be laid tile by tile ── */

const HWY = { strips: 3, len: 44 };
function Highway({ lib, s, local }: { lib: Lib; s: Timed; local: number }) {
  const { fps } = useVideoConfig();
  const building = s.build?.what === "lane";
  const buildAt = building ? atFrame(s, s.build?.at, fps, 0.3) : Infinity;
  const strips = HWY.strips + (building ? 1 : 0);
  const L = HWY.len * T;
  const tiles: React.ReactNode[] = [];
  for (let strip = 0; strip < strips; strip++) {
    const isNew = strip >= HWY.strips;
    for (let k = 0; k < HWY.len; k++) {
      const x = (k - HWY.len / 2 + 0.5) * T;
      let y = 0, sc = 1;
      if (isNew) {
        const t0 = buildAt + Math.abs(k - HWY.len / 2) * 0.6; // laid from the middle outwards
        if (local < t0) continue;
        const p = spring({ frame: local - t0, fps, config: { damping: 12, stiffness: 160 } });
        y = (1 - p) * 6; sc = Math.max(0.01, p);
      }
      tiles.push(<Model key={`r${strip}-${k}`} lib={lib} name="road" position={[x, y, strip * T]} scale={[T * sc, T, T * sc]} />);
    }
  }
  const side: React.ReactNode[] = [];
  for (let k = 0; k < HWY.len; k += 2) {
    const x = (k - HWY.len / 2) * T;
    side.push(<Model key={`t${k}`} lib={lib} name={k % 4 ? "tree" : "treeS"} position={[x + hash(k) * 3, 0, -T * 1.2 - hash(k + 9) * 7]} scale={T * 1.6} />);
    side.push(<Model key={`u${k}`} lib={lib} name={k % 6 ? "tree" : "treeS"} position={[x + hash(k + 3) * 3, 0, (strips - 0.5) * T + T * 0.8 + hash(k + 5) * 7]} scale={T * 1.6} />);
  }
  // construction barriers while the new lane goes down
  if (building && local > buildAt && local < buildAt + 60)
    for (let k = -3; k <= 3; k++) side.push(<Model key={`c${k}`} lib={lib} name="cone" position={[k * T * 1.5, 0, (strips - 1) * T - 1.7]} scale={T * 1.8} />);
  return <>{tiles}{side}<Traffic lib={lib} s={s} local={local} /></>;
}

/* ── downtown: a street grid with shops, towers in the middle, one storefront ── */

const DT = { n: 10 }; // tiles per side; roads on every 3rd row/column
const isRoad = (i: number) => i % 3 === 0;
const dtPos = (i: number, j: number) => new THREE.Vector3((i - DT.n / 2 + 0.5) * T, 0, (j - DT.n / 2 + 0.5) * T);
export const STORE = { i: 4, j: 5 }; // faces the road at j = 6

function Downtown({ lib, s, local }: { lib: Lib; s: Timed; local: number }) {
  const { fps } = useVideoConfig();
  const tiles: React.ReactNode[] = [];
  const towerAt = s.build?.what === "tower" ? atFrame(s, s.build.at, fps, 0.3) : Infinity;
  for (let i = 0; i < DT.n; i++)
    for (let j = 0; j < DT.n; j++) {
      const p = dtPos(i, j);
      const ri = isRoad(i), rj = isRoad(j);
      if (ri && rj) { tiles.push(<Model key={`x${i}-${j}`} lib={lib} name="cross" position={p} scale={T} />); continue; }
      if (ri || rj) { tiles.push(<Model key={`r${i}-${j}`} lib={lib} name="road" position={p} rotation={[0, rj ? 0 : Math.PI / 2, 0]} scale={T} />); continue; }
      // block cell: face whichever road it touches
      const yaw = isRoad(j + 1) ? 0 : isRoad(j - 1) ? Math.PI : isRoad(i + 1) ? Math.PI / 2 : -Math.PI / 2;
      const central = Math.abs(i - DT.n / 2 + 0.5) < 2.5 && Math.abs(j - DT.n / 2 + 0.5) < 2.5;
      const isStore = i === STORE.i && j === STORE.j;
      const name = isStore ? "building-e" : central && hash(i * 13 + j) > 0.35 ? TOWERS[Math.floor(hash(i + j * 7) * TOWERS.length)] : SHOPS[Math.floor(hash(i * 5 + j * 11) * SHOPS.length)];
      // a "tower" build raises the central tower out of the ground
      let sy = 1;
      if (central && i === 4 && j === 4 && towerAt < Infinity) sy = Math.max(0.02, spring({ frame: local - towerAt, fps, config: { damping: 14, stiffness: 60 } }));
      const fit = name.includes("skyscraper") ? T * 0.68 : T * 0.96;
      tiles.push(<Model key={`b${i}-${j}`} lib={lib} name={name} position={p} rotation={[0, yaw, 0]} scale={[fit, fit * sy, fit]} />);
      if (isStore) tiles.push(<Model key="awning" lib={lib} name="awning" position={[p.x, 0, p.z + T * 0.42]} scale={T * 0.96} />);
    }
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
        <planeGeometry args={[DT.n * T, DT.n * T]} />
        <meshStandardMaterial color="#C9CDD3" roughness={1} />
      </mesh>
      {tiles}
      <Traffic lib={lib} s={s} local={local} />
      <Walkers lib={lib} s={s} local={local} />
    </>
  );
}

// people on the sidewalk in front of the store; "enter" walks them in the door one after another
function Walkers({ lib, s, local }: { lib: Lib; s: Timed; local: number }) {
  const { fps } = useVideoConfig();
  if (!s.people) return null;
  const n = Math.max(1, Math.min(14, s.people.count ?? 6));
  const door = dtPos(STORE.i, STORE.j).add(new THREE.Vector3(0, 0, T * 0.5)); // the shop's front wall
  const walkZ = door.z + 0.45; // on the sidewalk strip of the road tile
  const start = atFrame(s, s.people.at, fps, 0.15);
  const run = s.people.do === "run";
  const out: React.ReactNode[] = [];
  for (let k = 0; k < n; k++) {
    const t = (local - start - k * (run ? 3 : 7)) / fps; // seconds since this person set off
    if (t < 0) continue;
    const speed = run ? 4.2 : 1.9;
    const fromLeft = k % 2 === 0;
    const sx = door.x + (fromLeft ? -1 : 1) * (3 + (k >> 1) * 1.6 + hash(k) * 1.5);
    if (s.people.do === "enter") {
      // walk along the sidewalk to the door, turn, walk in, disappear
      const along = Math.abs(sx - door.x), dAlong = Math.min(along, t * speed);
      const x = lerp(sx, door.x, dAlong / along);
      const inT = Math.max(0, t - along / speed);
      const z = walkZ - Math.min(1.6, inT * speed);
      if (inT > 1.4) continue;
      const yaw = inT > 0 ? Math.PI : fromLeft ? Math.PI / 2 : -Math.PI / 2;
      out.push(<Person key={k} lib={lib} name={PEOPLE[k % PEOPLE.length]} clip="walk" time={t} position={[x, 0.05, z]} rotation={[0, yaw, 0]} size={inT > 1 ? Math.max(0.01, 1 - (inT - 1) / 0.4) : 1} />);
    } else {
      const x = sx + (fromLeft ? 1 : -1) * t * speed;
      out.push(<Person key={k} lib={lib} name={PEOPLE[k % PEOPLE.length]} clip={run ? "sprint" : "walk"} time={t} position={[x, 0.05, walkZ + (k % 3) * 0.5]} rotation={[0, fromLeft ? Math.PI / 2 : -Math.PI / 2, 0]} />);
    }
  }
  return <>{out}</>;
}

/* ── suburb: a street of houses; "houses" spreads new ones out to the far rows ── */

const SUB = { n: 18 };
function Suburb({ lib, s, local }: { lib: Lib; s: Timed; local: number }) {
  const { fps } = useVideoConfig();
  const n = SUB.n;
  const spreadAt = s.build?.what === "houses" ? atFrame(s, s.build.at, fps, 0.3) : Infinity;
  const items: React.ReactNode[] = [];
  for (let k = 0; k < n; k++) {
    const x = (k - n / 2 + 0.5) * T;
    items.push(<Model key={`r${k}`} lib={lib} name="road" position={[x, 0, 0]} scale={T} />);
    if (k % 2) continue;
    for (const side of [-1, 1]) {
      const z = side * T * 1.9;
      items.push(<Model key={`h${k}${side}`} lib={lib} name={HOUSES[Math.floor(hash(k * 3 + side) * HOUSES.length)]} position={[x, 0, z]} rotation={[0, side < 0 ? 0 : Math.PI, 0]} scale={T * 1.1} />);
      items.push(<Model key={`d${k}${side}`} lib={lib} name="drive" position={[x + T * 0.9, 0.01, side * T * 0.95]} rotation={[0, side < 0 ? 0 : Math.PI, 0]} scale={T} />);
      items.push(<Model key={`t${k}${side}`} lib={lib} name={hash(k + side) > 0.5 ? "tree" : "treeS"} position={[x - T * 0.8, 0, z + side * T * 0.9]} scale={T * 1.7} />);
      // farther rows: only exist once the town has spread
      for (const row of [2, 3]) {
        const t0 = spreadAt + (row - 2) * 12 + Math.abs(k - n / 2) * 1.5;
        if (local < t0) continue;
        const p = spring({ frame: local - t0, fps, config: { damping: 11, stiffness: 140 } });
        items.push(<Model key={`f${k}${side}${row}`} lib={lib} name={HOUSES[Math.floor(hash(k * 7 + side * row) * HOUSES.length)]} position={[x + T * 0.5, (1 - p) * 8, side * T * (1.9 + row * 1.7)]} rotation={[0, side < 0 ? 0 : Math.PI, 0]} scale={T * 1.1 * Math.max(0.01, p)} />);
      }
    }
  }
  return <>{items}<Traffic lib={lib} s={s} local={local} /></>;
}

/* ── the driver close-up: inside the hero car, the jam through the glass behind them ── */

const HERO_RED = "#D63A2F";
const DRIVER = { x: 0.34, z: -0.2 }; // US cars: driver on the left (+x when the car faces +z)
const HONKS = [0.45, 1.5, 2.6]; // seconds into an angry shot when they lean on the horn

// how hard they're leaning on the horn right now (0..1), for angry drivers
const honkAt = (t: number) => Math.max(0, ...HONKS.map((h) => (t >= h && t < h + 0.35 ? 1 - (t - h) / 0.35 : 0)));

function Cockpit({ lib, s, local }: { lib: Lib; s: Timed; local: number }) {
  const { fps } = useVideoConfig();
  const t = local / fps;
  const mood = s.mood ?? "angry";
  const honk = mood === "angry" ? honkAt(t) : 0;
  const shake = mood === "angry" && t % 1.5 > 0.8 ? Math.sin(t * 22) * 0.4 : 0; // "unbelievable"
  const head =
    mood === "angry" ? { yaw: shake, pitch: honk * 0.25 } :
    mood === "bored" ? { yaw: Math.sin(t * 0.9) * 0.15, pitch: 0.38 } :
    mood === "shocked" ? { yaw: 0, pitch: -0.28 * Math.min(1, t * 5) } :
    { yaw: 0, pitch: Math.sin(t * 5) * 0.18 }; // relieved: nodding along
  const lean = mood === "angry" ? honk * 0.45 : mood === "shocked" ? -0.25 * Math.min(1, t * 5) : mood === "bored" ? 0.12 : 0;
  const body = (args: [number, number, number], pos: [number, number, number], color = HERO_RED, rot: [number, number, number] = [0, 0, 0]) => (
    <mesh position={pos} rotation={rot} castShadow receiveShadow><boxGeometry args={args} /><meshStandardMaterial color={color} roughness={0.45} metalness={0.15} /></mesh>
  );
  const hx = DRIVER.x, hy = 1.42, hz = DRIVER.z;
  return (
    <group>
      {body([1.7, 0.6, 3.4], [0, 0.42, 0])}
      {body([1.66, 0.22, 1.1], [0, 0.82, 1.15])}
      {body([1.4, 0.24, 0.36], [0, 1.0, 0.62], "#262A31")}
      {body([0.56, 1.0, 0.18], [hx, 1.0, hz - 0.32], "#30343C")}
      {body([0.56, 1.0, 0.18], [-hx, 1.0, hz - 0.32], "#30343C")}
      {body([1.7, 0.08, 1.5], [0, 1.98, -0.35])}
      {[-0.8, 0.8].map((x) => <group key={x}>{body([0.09, 0.8, 0.09], [x, 1.62, 0.55], HERO_RED, [-0.55, 0, 0])}{body([0.09, 0.95, 0.09], [x, 1.5, -1.05])}</group>)}
      {/* the wheel jolts when they hit the horn */}
      <mesh position={[hx, 1.16 - honk * 0.03, 0.42]} rotation={[-1.05, 0, Math.sin(t * 3) * 0.05]}><torusGeometry args={[0.2, 0.035, 8, 24]} /><meshStandardMaterial color="#1C1F24" /></mesh>
      <mesh position={[0, 1.6, 0.6]} rotation={[-0.55, 0, 0]}><planeGeometry args={[1.5, 0.78]} /><meshStandardMaterial color="#BFE6FF" transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <Person lib={lib} name="character-a" clip="drive" time={t} position={[hx, 0.55, hz]} head={head} lean={lean} size={0.95} />
      {mood === "angry" && <AngerMarks t={t} at={[hx, hy + 0.55, hz]} />}
      {mood === "shocked" && t > 0.15 && <Bang t={t - 0.15} at={[hx, hy + 0.7, hz]} />}
    </group>
  );
}

// comic anger: red "vein" crosses pop by the head on every honk, steam puffs off the top
function AngerMarks({ t, at }: { t: number; at: [number, number, number] }) {
  const out: React.ReactNode[] = [];
  HONKS.forEach((h, k) => {
    const a = t - h;
    if (a < 0 || a > 0.9) return;
    const p = Math.min(1, a * 8) * (a > 0.6 ? 1 - (a - 0.6) / 0.3 : 1);
    out.push(
      <group key={`v${k}`} position={[at[0] + (k % 2 ? 0.28 : -0.24), at[1] + 0.05, at[2] + 0.1]} rotation={[0, 0, 0.4 * (k % 2 ? 1 : -1)]} scale={p * 0.9}>
        {[0, Math.PI / 2].map((r) => <mesh key={r} rotation={[0, 0, r]}><boxGeometry args={[0.24, 0.06, 0.03]} /><meshBasicMaterial color="#FF2D2D" toneMapped={false} /></mesh>)}
      </group>,
    );
  });
  for (let k = 0; k < 4; k++) {
    const a = (t * 1.3 + k * 0.25) % 1;
    out.push(<mesh key={`s${k}`} position={[at[0] + Math.sin(k * 2.1) * 0.12, at[1] + 0.15 + a * 0.7, at[2]]} scale={0.08 + a * 0.12}><sphereGeometry args={[1, 10, 8]} /><meshStandardMaterial color="#FFFFFF" transparent opacity={0.75 * (1 - a)} depthWrite={false} /></mesh>);
  }
  return <>{out}</>;
}

function Bang({ t, at }: { t: number; at: [number, number, number] }) {
  const p = Math.min(1, t * 6);
  const bob = Math.sin(t * 9) * 0.03;
  return (
    <group position={[at[0], at[1] + bob, at[2]]} scale={p * (1 + 0.25 * Math.max(0, 1 - t * 4))}>
      <mesh position={[0, 0.14, 0]}><boxGeometry args={[0.09, 0.3, 0.05]} /><meshBasicMaterial color="#FFC93C" toneMapped={false} /></mesh>
      <mesh position={[0, -0.09, 0]}><boxGeometry args={[0.09, 0.09, 0.05]} /><meshBasicMaterial color="#FFC93C" toneMapped={false} /></mesh>
    </group>
  );
}

/* ── the test track: a ring road in a field, scientists in the middle running the experiment ── */

const TRACK = { r: 14.2 };
const SCIENTISTS = [
  { name: "character-k", at: new THREE.Vector3(6.4, 0, 6.4), role: "megaphone" },
  { name: "character-m", at: new THREE.Vector3(-4.5, 0, 5.2), role: "clipboard" },
  { name: "character-h", at: new THREE.Vector3(-1.5, 0, -6.5), role: "watch" },
] as const;

const MEGA = (() => {
  const at = SCIENTISTS[0].at, out = at.clone().normalize();
  return { pos: at.clone().addScaledVector(out, 0.42).setY(1.42), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), out.clone().negate()) };
})();

function Track({ lib, s, local }: { lib: Lib; s: Timed; local: number }) {
  const { fps } = useVideoConfig();
  const t = local / fps;
  const act = s.scientists?.do ?? "watch";
  const r = TRACK.r;
  const cones: React.ReactNode[] = [];
  for (let k = 0; k < 24; k++) {
    const th = (k / 24) * Math.PI * 2;
    cones.push(<Model key={k} lib={lib} name="trackCone" position={[Math.cos(th) * (r - 1.75), 0, Math.sin(th) * (r - 1.75)]} scale={0.9} />);
  }
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow><ringGeometry args={[r - 1.4, r + 1.4, 128]} /><meshStandardMaterial color="#4B505B" roughness={0.9} /></mesh>
      {[r - 1.35, r + 1.28].map((rr) => <mesh key={rr} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}><ringGeometry args={[rr, rr + 0.08, 128]} /><meshBasicMaterial color="#F2F2F2" /></mesh>)}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow><circleGeometry args={[r - 1.4, 64]} /><meshStandardMaterial color="#9CCB7A" roughness={1} /></mesh>
      {cones}
      {/* research tent with a table and a laptop */}
      <group position={[-2.5, 0, -2.5]}>
        {[[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]].map(([x, z]) => <mesh key={`${x}${z}`} position={[x, 1.2, z]} castShadow><cylinderGeometry args={[0.05, 0.05, 2.4, 6]} /><meshStandardMaterial color="#DADDE2" /></mesh>)}
        <mesh position={[0, 2.75, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[2.1, 0.8, 4]} /><meshStandardMaterial color="#F4F6F8" roughness={0.8} /></mesh>
        <mesh position={[0, 0.75, 0]} castShadow><boxGeometry args={[1.8, 0.08, 0.9]} /><meshStandardMaterial color="#8B6B4A" /></mesh>
        <mesh position={[0.2, 0.9, 0]} rotation={[-0.3, 0.3, 0]}><boxGeometry args={[0.55, 0.36, 0.03]} /><meshStandardMaterial color="#2A2E35" emissive="#5AA9FF" emissiveIntensity={0.4} /></mesh>
      </group>
      {SCIENTISTS.map((sc, k) => {
        // they face the track; the megaphone lead gestures out at the drivers while instructing
        const yaw = Math.atan2(sc.at.x, sc.at.z);
        const clip = act === "cheer" ? "emote-yes" : sc.role === "megaphone" && act === "instruct" ? "interact-right" : sc.role === "clipboard" ? "holding-right" : "idle";
        return <Person key={k} lib={lib} name={sc.name} clip={clip} time={t + k * 0.4} position={[sc.at.x, 0.02, sc.at.z]} rotation={[0, yaw, 0]} head={sc.role === "watch" ? { yaw: Math.sin(t * 0.8) * 0.5 } : undefined} />;
      })}
      {/* the megaphone: narrow end at the mouth, bell pointing out at the drivers */}
      <mesh position={MEGA.pos} quaternion={MEGA.q}><coneGeometry args={[0.17, 0.44, 14, 1, true]} /><meshStandardMaterial color="#F5C542" side={THREE.DoubleSide} /></mesh>
      <Traffic lib={lib} s={s} local={local} />
    </>
  );
}

/* ── the reaction close-up: one person, front and centre, the set behind them ── */

const REACT_CLIP = { no: "emote-no", yes: "emote-yes", idle: "idle", "pick-up": "pick-up" } as const;
// where the person stands, and which way the action is (the camera looks past them at it)
function reactionSpot(set: SetName) {
  if (set === "highway") return { p: new THREE.Vector3(2, 0, -T * 1.4), toward: 1 };
  if (set === "suburb") return { p: new THREE.Vector3(2.0, 0, -2.3), toward: 1 }; // in the gap between two houses, street behind
  if (set === "track") return { p: SCIENTISTS[1].at.clone(), toward: 1 };
  return { p: dtPos(STORE.i, STORE.j).add(new THREE.Vector3(T * 0.7, 0, T * 0.9)), toward: -1 }; // store sidewalk, shop behind
}

function Reactor({ lib, s, local }: { lib: Lib; s: Timed; local: number }) {
  const { fps } = useVideoConfig();
  if (s.shot !== "reaction") return null;
  const { p, toward } = reactionSpot(setOf(s));
  const clip = REACT_CLIP[s.reaction?.do ?? "no"] ?? "emote-no";
  // faces the camera, which stands on the far side from the action
  return <Person lib={lib} name="character-a" clip={clip} time={local / fps} position={[p.x, 0.05, p.z]} rotation={[0, toward > 0 ? Math.PI : 0, 0]} />;
}

/* ── camera shots, per set ── */

function shotAt(s: Timed, local: number, fps: number) {
  const k = Math.min(1, local / Math.max(1, s.frames));
  const set = setOf(s);
  const o = ORIGIN[set];
  const at = (x: number, y: number, z: number) => new THREE.Vector3(o.x + x, o.y + y, o.z + z);
  if (s.shot === "driver") {
    // outside the windshield on the driver's side, looking back in at them; the jam behind
    const sim = simFor(s, fps);
    const ls = sim.lanes.find((l) => l.lane.id === sim.heroLane);
    const c = ls?.frames[Math.min(local, (ls?.frames.length ?? 1) - 1)]?.find((x) => x.id === sim.hero);
    if (ls && c) {
      const p = laneAt(ls.lane, c.u), d = dirAt(ls.lane, c.u);
      const side = new THREE.Vector3(d.z, 0, -d.x); // the car's +x (driver side) in world space
      const head = p.clone().add(o).addScaledVector(side, DRIVER.x).addScaledVector(d, DRIVER.z).setY(1.5); // lanes are set-local
      // chest-up through the windshield: wheel, the window frame, and the stalled traffic behind them
      const push = 1 - k * 0.1;
      return { pos: head.clone().addScaledVector(d, 3.4 * push).addScaledVector(side, 0.9).setY(1.85), look: head.clone().setY(1.25) };
    }
  }
  if (s.shot === "scientist" || (set === "track" && s.shot === "reaction")) {
    // from the track side looking in at the lead: the tent and the far side of the ring behind them
    const lead = SCIENTISTS[0].at;
    const out = lead.clone().normalize(), tan = new THREE.Vector3(-out.z, 0, out.x);
    const r = 3.2 - k * 0.4;
    return { pos: at(lead.x + out.x * r + tan.x * 1.1, 1.8, lead.z + out.z * r + tan.z * 1.1), look: at(lead.x, 1.35, lead.z) };
  }
  if (set === "track") {
    switch (s.shot) {
      case "street": { const a = 1.1 + k * 0.25; return { pos: at(Math.cos(a) * (TRACK.r + 6), 1.9, Math.sin(a) * (TRACK.r + 6)), look: at(0, 1, 0) }; }
      case "orbit": { const a = 0.3 + k * 0.8; return { pos: at(Math.cos(a) * 30, 13, Math.sin(a) * 30), look: at(0, 0, 0) }; }
      default: { const a = k * 0.5; return { pos: at(Math.sin(a) * 14, 44, 18 + Math.cos(a) * 6), look: at(0, 0, 0) }; }
    }
  }
  if (s.shot === "reaction") {
    const { p, toward } = reactionSpot(set);
    const r = 3.4 - k * 0.5; // slow push-in on the face
    return { pos: at(p.x + 0.5, 1.75, p.z - toward * r), look: at(p.x, 1.45, p.z) };
  }
  if (set === "highway") {
    const mid = ((HWY.strips - 1) * T) / 2;
    switch (s.shot) {
      case "street": return { pos: at(-30 + k * 8, 2.2, -5.5), look: at(10 + k * 8, 1.2, mid) };
      case "chase": {
        // ride behind the hero car: when the car ahead brakes, we brake with it
        const h = heroPos(simFor(s, fps), local);
        if (h) return { pos: at(h.x - 8.5, 3.4, h.z - 0.3), look: at(h.x + 7, 0.9, h.z) };
        return { pos: at(-14 + k * 4, 4.2, -0.9), look: at(4 + k * 4, 1, -0.6) };
      }
      case "orbit": { const a = -0.6 + k * 0.7; return { pos: at(Math.sin(a) * 30 - 6, 15, mid + Math.cos(a) * 30), look: at(-4, 0, mid) }; }
      default: return { pos: at(-26 + k * 10, 34, mid + 26), look: at(6 + k * 10, 0, mid) };
    }
  }
  if (set === "suburb") {
    switch (s.shot) {
      case "street": case "chase": return { pos: at(-26 + k * 10, 2.6, -1.8), look: at(10 + k * 10, 1.4, 0) };
      case "orbit": { const a = -0.5 + k * 0.6; return { pos: at(Math.sin(a) * 40, 24, Math.cos(a) * 40), look: at(0, 0, 0) }; }
      default: return { pos: at(-18 + k * 8, 42, 34), look: at(4 + k * 8, 0, 2) };
    }
  }
  // downtown + store
  const door = dtPos(STORE.i, STORE.j);
  if (set === "store" || s.shot === "street") {
    // across the street from the store front, drifting slowly sideways
    // down the middle of the (quiet) street: the shop on the left, shoppers heading for its door
    return { pos: at(door.x - 13 + k * 2.5, 3.2, door.z + T * 1.0), look: at(door.x + 1 + k * 1.5, 1.7, door.z + T * 0.55) };
  }
  switch (s.shot) {
    case "chase": {
      const h = heroPos(simFor(s, fps), local);
      if (h) return { pos: at(h.x - 8, 3.6, h.z - 0.2), look: at(h.x + 7, 0.9, h.z) };
      return { pos: at(-20 + k * 6, 4, dtPos(6, 6).z - 0.9), look: at(-2 + k * 6, 1, dtPos(6, 6).z - 0.9) };
    }
    case "orbit": { const a = -0.7 + k * 0.8; return { pos: at(Math.sin(a) * 34, 26, Math.cos(a) * 34), look: at(0, 4, 0) }; }
    default: return { pos: at(-14 + k * 6, 40, 30), look: at(2 + k * 4, 0, 0) };
  }
}

/* ── camera guard: the lens never sits inside a building, and low shots always see their subject ── */

type Box = { min: THREE.Vector3; max: THREE.Vector3 };
const solidCache = new Map<SetName, Box[]>();
function solids(set: SetName): Box[] {
  const hit = solidCache.get(set);
  if (hit) return hit;
  const o = ORIGIN[set];
  const box = (x: number, z: number, hx: number, hz: number, h: number): Box => ({ min: new THREE.Vector3(o.x + x - hx, -1, o.z + z - hz), max: new THREE.Vector3(o.x + x + hx, h, o.z + z + hz) });
  const out: Box[] = [];
  if (set === "downtown" || set === "store") {
    for (let i = 0; i < DT.n; i++) for (let j = 0; j < DT.n; j++) {
      if (isRoad(i) || isRoad(j)) continue;
      const p = dtPos(i, j);
      out.push(box(p.x, p.z, T * 0.49, T * 0.49, 12));
    }
  } else if (set === "suburb") {
    for (let k = 0; k < SUB.n; k += 2) {
      const x = (k - SUB.n / 2 + 0.5) * T;
      for (const side of [-1, 1]) {
        out.push(box(x, side * T * 1.9, 2.9, 2.4, 5));
        for (const row of [2, 3]) out.push(box(x + T * 0.5, side * T * (1.9 + row * 1.7), 2.9, 2.4, 5));
        out.push(box(x - T * 0.8, side * T * 2.8, 0.8, 0.8, 6)); // yard tree
      }
    }
  } else if (set === "track") {
    out.push(box(-2.5, -2.5, 1.5, 1.5, 3.2));
  } else {
    for (let k = 0; k < HWY.len; k += 2) {
      const x = (k - HWY.len / 2) * T;
      out.push(box(x + hash(k) * 3, -T * 1.2 - hash(k + 9) * 7, 0.8, 0.8, 6));
      out.push(box(x + hash(k + 3) * 3, (HWY.strips - 0.5) * T + T * 0.8 + hash(k + 5) * 7, 0.8, 0.8, 6));
    }
  }
  solidCache.set(set, out);
  return out;
}
const inside = (p: THREE.Vector3, b: Box, pad = 0.4) =>
  p.x > b.min.x - pad && p.x < b.max.x + pad && p.y < b.max.y + pad && p.z > b.min.z - pad && p.z < b.max.z + pad;
const ray = new THREE.Ray();
const tmpBox = new THREE.Box3();
function blocks(from: THREE.Vector3, to: THREE.Vector3, b: Box) {
  if (inside(to, b, 0)) return false; // the subject itself may sit against a wall (a shop front)
  ray.set(from, to.clone().sub(from).normalize());
  const hit = ray.intersectBox(tmpBox.set(b.min, b.max), new THREE.Vector3());
  return !!hit && hit.distanceTo(from) < from.distanceTo(to);
}
// walk the camera toward its subject until it's out of every wall and (on low shots) has a clear view
function guard(pos: THREE.Vector3, look: THREE.Vector3, set: SetName, low: boolean) {
  const bs = solids(set);
  const p = pos.clone();
  for (let n = 0; n < 40; n++) {
    if (!bs.some((b) => inside(p, b) || (low && blocks(p, look, b)))) return p;
    p.lerp(look, 0.06);
  }
  return p;
}

const LOW = new Set(["reaction", "street", "chase", "scientist"]); // the driver cam is meant to look through glass
const WHIP = 10, SLAM = 20;
function cameraAt(scenes: Timed[], f: number, fps: number) {
  let i = scenes.findIndex((_, k) => f < (scenes[k + 1]?.from ?? Infinity));
  if (i < 0) i = scenes.length - 1;
  const s = scenes[i];
  const local = f - s.from;
  let { pos, look } = shotAt(s, local, fps);
  pos = guard(pos, look, setOf(s), LOW.has(s.shot ?? ""));
  let roll = 0, whip = 0;
  if (i > 0 && local < WHIP) {
    // whip pan: hangs, snaps through, settles; blur follows the speed
    const ps = scenes[i - 1];
    const prev = shotAt(ps, ps.frames, fps);
    prev.pos = guard(prev.pos, prev.look, setOf(ps), LOW.has(ps.shot ?? ""));
    const ease = Easing.inOut(Easing.exp);
    const u = local / WHIP, t = ease(u);
    pos = prev.pos.clone().lerp(pos, t);
    look = prev.look.clone().lerp(look, t);
    if (prev.pos.distanceTo(pos) > 80) pos.y += Math.sin(t * Math.PI) * 30; // across town: hop up over it
    roll = Math.sin(u * Math.PI) * 0.1 * (i % 2 ? 1 : -1);
    whip = Math.min(1, ((ease(Math.min(1, u + 1 / WHIP)) - t) * WHIP) / 3.5);
  } else if (i === 0 && local < SLAM) {
    const t = Easing.out(Easing.exp)(local / SLAM);
    pos = pos.clone().sub(look).multiplyScalar(1.7).add(look).lerp(pos, t);
    roll = (1 - t) * -0.15;
  }
  pos.x += Math.sin(f / 41) * 0.12; // handheld drift
  pos.y += Math.sin(f / 33 + 1) * 0.08;
  return { i, local, pos, look, roll, whip };
}

function Rig({ pos, look, roll }: { pos: THREE.Vector3; look: THREE.Vector3; roll: number }) {
  const camera = useThree((st) => st.camera);
  camera.position.copy(pos);
  camera.lookAt(look);
  camera.rotateZ(roll);
  return null;
}

const SETS: Record<SetName, (p: { lib: Lib; s: Timed; local: number }) => React.ReactNode> = { highway: Highway, downtown: Downtown, store: Downtown, suburb: Suburb, track: Track };

function World({ scenes, lib }: { scenes: Timed[]; lib: Lib }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cam = cameraAt(scenes, f, fps);
  const s = scenes[cam.i];
  // the set we're in, plus the one we're whipping in from
  const prev = cam.i > 0 && cam.local < WHIP ? scenes[cam.i - 1] : null;
  const sun = useMemo(() => new THREE.Object3D(), []);
  sun.position.copy(cam.look).setY(0);
  const SetNow = SETS[setOf(s)];
  const SetPrev = prev ? SETS[setOf(prev)] : null;
  const o = ORIGIN[setOf(s)];
  const po = prev ? ORIGIN[setOf(prev)] : null;
  return (
    <>
      <color attach="background" args={[SKY]} />
      <fog attach="fog" args={[SKY, 70, 190]} />
      <Rig pos={cam.pos} look={cam.look} roll={cam.roll} />
      <hemisphereLight args={["#EAF6FF", "#6F8F55", 1.15]} />
      <primitive object={sun} />
      <directionalLight position={[cam.look.x - 30, 60, cam.look.z + 25]} target={sun} intensity={2.2} color="#FFF1D6" castShadow
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-55} shadow-camera-right={55} shadow-camera-top={55} shadow-camera-bottom={-55} shadow-camera-far={200} shadow-bias={-0.0004} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[1200, 1200]} />
        <meshStandardMaterial color="#86C06A" roughness={1} />
      </mesh>
      <group position={o}>
        <SetNow lib={lib} s={s} local={cam.local} />
        <Reactor lib={lib} s={s} local={cam.local} />
      </group>
      {SetPrev && prev && po && (setOf(prev) !== setOf(s) || ORIGIN[setOf(prev)] !== o) && (
        <group position={po}><SetPrev lib={lib} s={prev} local={prev.frames} /></group>
      )}
    </>
  );
}

/* ── overlays: subtitle card for captions; numbers and lines get a dark outline over the bright world ── */

function CityCaption({ scene }: { scene: Timed }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = scene.start + f / fps;
  const words = scene.words.length ? scene.words : scene.say.split(" ").map((w) => ({ w, s: scene.start, e: scene.start }));
  const groups = phrases(words, scene.say);
  let gi = 0;
  groups.forEach((g, k) => { if (t >= g[0].s - 0.05) gi = k; });
  const age = gi === 0 ? f + 2 : (t - groups[gi][0].s) * fps;
  return (
    <div style={{ position: "absolute", top: 270, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
      <div style={{ maxWidth: 780, background: "rgba(255,255,255,0.95)", borderRadius: 22, padding: "14px 26px", textAlign: "center", fontFamily: SANS, fontWeight: 800, fontSize: 50, lineHeight: 1.18, color: "#141414",
        boxShadow: "0 6px 0 rgba(0,0,0,0.16)", opacity: interpolate(age, [-1, 2], [0, 1], clamp), scale: String(interpolate(age, [-1, 4], [0.94, 1], clamp)) }}>
        {groups[gi].map((w, i) => <span key={i} style={{ opacity: t >= w.s - 0.05 ? 1 : 0.35 }}>{w.w} </span>)}
      </div>
    </div>
  );
}

// a comic speech bubble for the scientist on the megaphone
function Bubble({ text }: { text: string }) {
  const f = useCurrentFrame();
  const p = spring({ frame: f - 8, fps: 30, config: { damping: 11, stiffness: 180 } });
  return (
    <div style={{ position: "absolute", top: 470, left: 0, right: 0, display: "flex", justifyContent: "center", scale: String(p), transformOrigin: "50% 100%" }}>
      <div style={{ position: "relative", background: "#FFFFFF", border: "6px solid #161616", borderRadius: 40, padding: "22px 34px", fontFamily: SANS, fontWeight: 800, fontSize: 64, color: "#161616", maxWidth: 820, textAlign: "center", boxShadow: "0 8px 0 rgba(0,0,0,0.2)" }}>
        {text}
        <div style={{ position: "absolute", bottom: -38, left: "58%", width: 0, height: 0, borderLeft: "26px solid transparent", borderRight: "26px solid transparent", borderTop: "38px solid #161616" }} />
      </div>
    </div>
  );
}

function Overlay({ s }: { s: Timed }) {
  if (s.shot === "scientist" && s.scientists?.bubble) return <Bubble text={s.scientists.bubble} />;
  const outline = { WebkitTextStroke: "10px #161616", paintOrder: "stroke fill" } as React.CSSProperties;
  if (s.value !== undefined) return <div style={outline}><Counter scene={s} y={760} size={210} /></div>;
  // on low shots the action is mid-frame, so the headline sits up under the caption instead
  const low = s.shot === "chase" || s.shot === "street";
  if (s.big && s.shot !== "reaction" && s.shot !== "driver" && (s.kind === "line" || s.kind === "end" || s.kind === "hook")) return <div style={outline}><Statement text={s.big} y={low ? 560 : 1260} size={low ? 96 : 112} /></div>;
  return null;
}

export function City({ audio, handle, total, scenes }: CityProps) {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const timed: Timed[] = scenes.map((s, i) => {
    const from = Math.round(s.start * fps);
    const until = Math.round((scenes[i + 1] ? scenes[i + 1].start : total + 0.6) * fps);
    return { ...s, from, frames: Math.max(1, until - from) };
  });
  const blur = cameraAt(timed, frame, fps).whip * 34;
  const { lib, err } = useAssets();
  return (
    <AbsoluteFill style={{ background: SKY }}>
      <Audio src={staticFile(audio)} />
      <svg width={0} height={0} style={{ position: "absolute" }}>
        <filter id="whip" x="-5%" y="0" width="110%" height="100%"><feGaussianBlur stdDeviation={`${blur.toFixed(1)} 0`} edgeMode="duplicate" /></filter>
      </svg>
      <AbsoluteFill style={{ filter: blur > 0.6 ? "url(#whip)" : undefined }}>
        {lib && (
          <ThreeCanvas width={1080} height={1920} shadows camera={{ fov: 40, near: 0.5, far: 420 }}>
            <World scenes={timed} lib={lib} />
          </ThreeCanvas>
        )}
        {timed.map((s, i) => (
          <Sequence key={i} from={s.from} durationInFrames={s.frames}>
            <Overlay s={s} />
            <CityCaption scene={s} />
            {i > 0 && <Sequence from={-2} durationInFrames={14} layout="none"><Audio src={staticFile("sfx/whoosh.wav")} volume={0.3} /></Sequence>}
            {s.shot === "driver" && (s.mood ?? "angry") === "angry" && HONKS.map((h, k) => (
              <Sequence key={`h${k}`} from={Math.round(h * fps)} durationInFrames={14} layout="none"><Audio src={staticFile("sfx/honk.wav")} volume={0.35} /></Sequence>
            ))}
            {sfxFor(s, fps).map((x, k) => (
              <Sequence key={k} from={Math.max(0, x.at)} durationInFrames={16} layout="none"><Audio src={staticFile(`sfx/${x.src}.wav`)} volume={x.vol} /></Sequence>
            ))}
          </Sequence>
        ))}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "radial-gradient(120% 90% at 50% 45%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.2) 100%)" }} />
      <Chrome scenes={scenes} total={total} handle={handle} />
      {err && <div style={{ position: "absolute", bottom: 120, left: 40, right: 40, color: "red", fontSize: 30, fontFamily: "monospace", background: "white" }}>{err}</div>}
    </AbsoluteFill>
  );
}
