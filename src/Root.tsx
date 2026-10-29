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
const citySample: CityProps = { audio: "sfx/pop.wav", handle: "@bryzdaily", total: 16, scenes: [
  { kind: "hook", say: "Is walking faster than driving downtown?", start: 0, end: 3, words: [], set: "store", shot: "aerial", traffic: { level: 0.4 },
    actor: [{ do: "walk" }], cuts: [{ at: 1.0, shot: "follow" }], callout: { label: "3 mph", target: "actor", at: 1.4 }, big: "Walk or drive?" },
  { kind: "line", say: "The driver is stuck.", start: 3, end: 6, words: [], set: "highway", shot: "driver", mood: "angry", traffic: { level: 0.85 },
    cuts: [{ at: 4.6, shot: "aerial" }], callout: { label: "6 ft gap", target: "gap", at: 4.8 } },
  { kind: "line", say: "He runs and jumps.", start: 6, end: 9.5, words: [], set: "suburb", shot: "low", traffic: { level: 0.3 },
    actor: [{ do: "run" }, { do: "jump", at: 7.6 }], cuts: [{ at: 7.0, shot: "follow" }] },
  { kind: "line", say: "The tower is huge.", start: 9.5, end: 12.5, words: [], set: "downtown", shot: "orbit", traffic: { level: 0.5 }, callout: { label: "300 ft", target: "tower", at: 10 } },
  { kind: "end", say: "Scientists agree.", start: 12.5, end: 16, words: [], set: "track", shot: "scientist", scientists: { do: "instruct", bubble: "Keep it steady!" }, cuts: [{ at: 14, shot: "overhead" }] },
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
