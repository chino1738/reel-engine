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

type SetName = "highway" | "downtown" | "suburb" | "store";
type Shot = "aerial" | "street" | "chase" | "orbit" | "reaction";
export type CityScene = DataScene & {
  set?: SetName;
  shot?: Shot;
  traffic?: { level?: number; to?: number; at?: number };
  build?: { what?: "lane" | "tower" | "houses"; at?: number };
  people?: { count?: number; do?: "walk" | "run" | "enter"; at?: number };
  reaction?: { do?: "no" | "yes" | "idle" | "pick-up" };
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
      g.userData.height = new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3()).y; // characters get sized from this
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
function Person({ lib, name, clip, time, size = 1, ...rest }: { lib: Lib; name: string; clip: string; time: number; size?: number } & ThreeElements["group"]) {
  const { obj, mixer } = useMemo(() => {
    const o = lib[name].scene.clone(true);
    return { obj: o, mixer: new THREE.AnimationMixer(o) };
  }, [lib, name]);
  const anim = lib[name].animations.find((a) => a.name === clip) ?? lib[name].animations.find((a) => a.name === "idle");
  if (anim) {
    mixer.stopAllAction();
    mixer.clipAction(anim).play();
    mixer.setTime(time % anim.duration);
  }
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
const speedOf = (d: number) => lerp(15, 0.7, Math.pow(d, 0.8)); // free flow ~15 u/s, gridlock crawls

type Lane = { id: number; a: THREE.Vector3; dir: THREE.Vector3; len: number; slots: number; opensAt?: number };

function Traffic({ lib, s, local, lanes }: { lib: Lib; s: Timed; local: number; lanes: Lane[] }) {
  const { fps } = useVideoConfig();
  const dist = useMemo(() => {
    const out = [0];
    for (let f = 1; f <= s.frames + 2; f++) out.push(out[f - 1] + speedOf(densityAt(s, f, fps)) / fps);
    return out;
  }, [s, fps]);
  const d = densityAt(s, local, fps);
  const travelled = dist[Math.max(0, Math.min(local, dist.length - 1))];
  const cars: React.ReactNode[] = [];
  for (const ln of lanes) {
    if (ln.opensAt !== undefined && local < ln.opensAt) continue;
    const yaw = Math.atan2(ln.dir.x, ln.dir.z);
    for (let i = 0; i < ln.slots; i++) {
      if (hash(ln.id * 31 + i) > d * 1.05) continue; // more slots fill as density rises
      const u = (((i / ln.slots) * ln.len + travelled * (0.92 + hash(ln.id) * 0.16) + hash(ln.id + 5) * ln.len) % ln.len);
      const p = ln.a.clone().addScaledVector(ln.dir, u);
      const kind = CARS[Math.floor(hash(ln.id * 7 + i * 3) * CARS.length)];
      cars.push(<Model key={`${ln.id}-${i}`} lib={lib} name={kind} position={[p.x, 0.02, p.z]} rotation={[0, yaw, 0]} scale={0.62} />);
    }
  }
  return <>{cars}</>;
}

const X = new THREE.Vector3(1, 0, 0), NX = new THREE.Vector3(-1, 0, 0), Z = new THREE.Vector3(0, 0, 1), NZ = new THREE.Vector3(0, 0, -1);

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
  const lanes: Lane[] = [];
  for (let strip = 0; strip < strips; strip++)
    for (let lane = 0; lane < 2; lane++)
      lanes.push({ id: strip * 2 + lane, a: new THREE.Vector3(-L / 2, 0, strip * T + (lane ? 0.9 : -0.9)), dir: X, len: L, slots: 26, opensAt: strip >= HWY.strips ? buildAt + 40 : undefined });
  const side: React.ReactNode[] = [];
  for (let k = 0; k < HWY.len; k += 2) {
    const x = (k - HWY.len / 2) * T;
    side.push(<Model key={`t${k}`} lib={lib} name={k % 4 ? "tree" : "treeS"} position={[x + hash(k) * 3, 0, -T * 1.2 - hash(k + 9) * 7]} scale={T * 1.6} />);
    side.push(<Model key={`u${k}`} lib={lib} name={k % 6 ? "tree" : "treeS"} position={[x + hash(k + 3) * 3, 0, (strips - 0.5) * T + T * 0.8 + hash(k + 5) * 7]} scale={T * 1.6} />);
  }
  // construction barriers while the new lane goes down
  if (building && local > buildAt && local < buildAt + 60)
    for (let k = -3; k <= 3; k++) side.push(<Model key={`c${k}`} lib={lib} name="cone" position={[k * T * 1.5, 0, (strips - 1) * T - 1.7]} scale={T * 1.8} />);
  return <>{tiles}{side}<Traffic lib={lib} s={s} local={local} lanes={lanes} /></>;
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
  const half = (DT.n / 2) * T;
  const lanes: Lane[] = [];
  [0, 3, 6, 9].forEach((k, n) => {
    const c = dtPos(k, k);
    const quiet = setOf(s) === "store" && k === STORE.j + 1; // the shop's own street stays clear for the shot
    if (!quiet) {
      lanes.push({ id: 100 + n * 4, a: new THREE.Vector3(-half, 0, c.z - 0.9), dir: X, len: half * 2, slots: 10 });
      lanes.push({ id: 101 + n * 4, a: new THREE.Vector3(half, 0, c.z + 0.9), dir: NX, len: half * 2, slots: 10 });
    }
    lanes.push({ id: 102 + n * 4, a: new THREE.Vector3(c.x + 0.9, 0, -half), dir: Z, len: half * 2, slots: 10 });
    lanes.push({ id: 103 + n * 4, a: new THREE.Vector3(c.x - 0.9, 0, half), dir: NZ, len: half * 2, slots: 10 });
  });
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
        <planeGeometry args={[DT.n * T, DT.n * T]} />
        <meshStandardMaterial color="#C9CDD3" roughness={1} />
      </mesh>
      {tiles}
      <Traffic lib={lib} s={s} local={local} lanes={lanes} />
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

function Suburb({ lib, s, local }: { lib: Lib; s: Timed; local: number }) {
  const { fps } = useVideoConfig();
  const n = 18;
  const L = n * T;
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
  const lanes: Lane[] = [
    { id: 300, a: new THREE.Vector3(-L / 2, 0, -0.9), dir: X, len: L, slots: 8 },
    { id: 301, a: new THREE.Vector3(L / 2, 0, 0.9), dir: NX, len: L, slots: 8 },
  ];
  return <>{items}<Traffic lib={lib} s={s} local={local} lanes={lanes} /></>;
}

/* ── the reaction close-up: one person, front and centre, the set behind them ── */

const REACT_CLIP = { no: "emote-no", yes: "emote-yes", idle: "idle", "pick-up": "pick-up" } as const;
// where the person stands, and which way the action is (the camera looks past them at it)
function reactionSpot(set: SetName) {
  if (set === "highway") return { p: new THREE.Vector3(2, 0, -T * 1.4), toward: 1 };
  if (set === "suburb") return { p: new THREE.Vector3(T * 2, 0, -T * 0.95), toward: 1 };
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

function shotAt(s: Timed, local: number) {
  const k = Math.min(1, local / Math.max(1, s.frames));
  const set = setOf(s);
  const o = ORIGIN[set];
  const at = (x: number, y: number, z: number) => new THREE.Vector3(o.x + x, o.y + y, o.z + z);
  if (s.shot === "reaction") {
    const { p, toward } = reactionSpot(set);
    const r = 3.4 - k * 0.5; // slow push-in on the face
    return { pos: at(p.x + 0.5, 1.75, p.z - toward * r), look: at(p.x, 1.45, p.z) };
  }
  if (set === "highway") {
    const mid = ((HWY.strips - 1) * T) / 2;
    switch (s.shot) {
      case "street": return { pos: at(-30 + k * 8, 2.2, -5.5), look: at(10 + k * 8, 1.2, mid) };
      case "chase": return { pos: at(-14 + k * 4, 4.2, -0.9), look: at(4 + k * 4, 1, -0.6) };
      case "orbit": { const a = -0.6 + k * 0.7; return { pos: at(Math.sin(a) * 42, 22, mid + Math.cos(a) * 42), look: at(0, 0, mid) }; }
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
    case "chase": return { pos: at(-20 + k * 6, 4, dtPos(6, 6).z - 0.9), look: at(-2 + k * 6, 1, dtPos(6, 6).z - 0.9) };
    case "orbit": { const a = -0.7 + k * 0.8; return { pos: at(Math.sin(a) * 34, 26, Math.cos(a) * 34), look: at(0, 4, 0) }; }
    default: return { pos: at(-14 + k * 6, 40, 30), look: at(2 + k * 4, 0, 0) };
  }
}

const WHIP = 10, SLAM = 20;
function cameraAt(scenes: Timed[], f: number) {
  let i = scenes.findIndex((_, k) => f < (scenes[k + 1]?.from ?? Infinity));
  if (i < 0) i = scenes.length - 1;
  const s = scenes[i];
  const local = f - s.from;
  let { pos, look } = shotAt(s, local);
  let roll = 0, whip = 0;
  if (i > 0 && local < WHIP) {
    // whip pan: hangs, snaps through, settles; blur follows the speed
    const prev = shotAt(scenes[i - 1], scenes[i - 1].frames);
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

const SETS: Record<SetName, (p: { lib: Lib; s: Timed; local: number }) => React.ReactNode> = { highway: Highway, downtown: Downtown, store: Downtown, suburb: Suburb };

function World({ scenes, lib }: { scenes: Timed[]; lib: Lib }) {
  const f = useCurrentFrame();
  const cam = cameraAt(scenes, f);
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

function Overlay({ s }: { s: Timed }) {
  const outline = { WebkitTextStroke: "10px #161616", paintOrder: "stroke fill" } as React.CSSProperties;
  if (s.value !== undefined) return <div style={outline}><Counter scene={s} y={760} size={210} /></div>;
  if (s.big && s.shot !== "reaction" && (s.kind === "line" || s.kind === "end" || s.kind === "hook")) return <div style={outline}><Statement text={s.big} y={1260} size={112} /></div>;
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
  const blur = cameraAt(timed, frame).whip * 34;
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
