import { Composition } from "remotion";
import { Reel, FPS, type ReelProps } from "./Reel";
import { Collage, type CollageProps } from "./Collage";
import { Demo, type DemoProps } from "./Demo";
import { Data, type DataProps } from "./Data";
import { Data3D, type Data3DProps } from "./Data3D";
import { Reel3D } from "./Reel3D";

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

export const Root = () => (
  <>
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
