import { Composition } from "remotion";
import { Reel, FPS, type ReelProps } from "./Reel";
import { Collage, type CollageProps } from "./Collage";

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

export const Root = () => (
  <>
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
