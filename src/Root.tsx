import { Composition } from "remotion";
import { Reel, FPS, type ReelProps } from "./Reel";
import { Collage, type CollageProps } from "./Collage";
import { Demo, type DemoProps } from "./Demo";
import { Data, type DataProps } from "./Data";
import { Data3D, type Data3DProps } from "./Data3D";
import { Reel3D } from "./Reel3D";
import { City, type CityProps } from "./City";

const sample: ReelProps = {
  audio: "work/test.mp3",
  handle: "@curiosidades",
  total: 9,
  scenes: [
    { kind: "hook", big: "¿Por qué la comida del avión sabe rara?", start: 0, end: 2.9, words: [] },
    { kind: "stat", big: "30%", label: "menos sabor salado y dulce", start: 3.15, end: 8.9, words: [] },
  ],
};

const collageSample: CollageProps = { audio: "work/test.mp3", handle: "@yourhandle", total: 9, scenes: [] };

const dataSample: DataProps = { audio: "work/test.mp3", handle: "@yourhandle", total: 9, scenes: [] };

const demoSample: DemoProps = { audio: "work/test.mp3", handle: "@yourhandle", total: 9, scenes: [] };

// hand-made props for previewing the city with `npx remotion still` before any script exists
const citySample: CityProps = { audio: "sfx/pop.wav", handle: "@bryzdaily", total: 18, scenes: [
  { kind: "hook", say: "Why do traffic jams appear out of nowhere?", start: 0, end: 3, words: [], set: "highway", shot: "aerial", traffic: { level: 0.3 }, big: "Jams from nowhere" },
  { kind: "line", say: "One driver taps the brakes.", start: 3, end: 6, words: [], set: "highway", shot: "chase", traffic: { level: 0.6 }, brake: { at: 3.8 } },
  { kind: "line", say: "So the city adds a lane.", start: 6, end: 9, words: [], set: "highway", shot: "orbit", traffic: { level: 0.9 }, build: { what: "lane", at: 6.5 } },
  { kind: "line", say: "People move farther out.", start: 9, end: 12, words: [], set: "suburb", shot: "aerial", traffic: { level: 0.3 }, build: { what: "houses", at: 9.4 } },
  { kind: "line", say: "Downtown fills up.", start: 12, end: 15, words: [], set: "downtown", shot: "chase", traffic: { level: 0.55 } },
  { kind: "end", say: "And shoppers keep coming.", start: 15, end: 18, words: [], set: "store", shot: "street", people: { count: 6, do: "enter", at: 15.2 }, traffic: { level: 0.4 }, big: "Would you shop here?" },
] };

export const Root = () => (
  <>
  <Composition
    id="City"
    component={City}
    fps={FPS}
    width={1080}
    height={1920}
    durationInFrames={Math.ceil((citySample.total + 0.6) * FPS)}
    defaultProps={citySample}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.ceil((props.total + 0.6) * FPS) })}
  />
  <Composition
    id="Reel3D"
    component={Reel3D}
    fps={FPS}
    width={1080}
    height={1920}
    durationInFrames={Math.ceil(dataSample.total * FPS)}
    defaultProps={dataSample}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.ceil((props.total + 0.6) * FPS) })}
  />
  <Composition
    id="Data3D"
    component={Data3D}
    fps={FPS}
    width={1080}
    height={1920}
    durationInFrames={150}
    defaultProps={{ audio: "work/test.mp3", handle: "@yourhandle", scene: { kind: "bars", say: "", start: 0, end: 5, words: [], items: [] } } as Data3DProps}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.ceil((props.scene.end - props.scene.start + 0.8) * FPS) })}
  />
  <Composition
    id="Data"
    component={Data}
    fps={FPS}
    width={1080}
    height={1920}
    durationInFrames={Math.ceil(dataSample.total * FPS)}
    defaultProps={dataSample}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.ceil((props.total + 0.6) * FPS) })}
  />
  <Composition
    id="Demo"
    component={Demo}
    fps={FPS}
    width={1080}
    height={1920}
    durationInFrames={Math.ceil(demoSample.total * FPS)}
    defaultProps={demoSample}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.ceil((props.total + 0.6) * FPS) })}
  />
  <Composition
    id="Collage"
    component={Collage}
    fps={FPS}
    width={1080}
    height={1920}
    durationInFrames={Math.ceil(collageSample.total * FPS)}
    defaultProps={collageSample}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.ceil((props.total + 0.6) * FPS) })}
  />
  <Composition
    id="Reel"
    component={Reel}
    fps={FPS}
    width={1080}
    height={1920}
    durationInFrames={Math.ceil(sample.total * FPS)}
    defaultProps={sample}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.ceil((props.total + 0.6) * FPS) })}
  />
  </>
);
