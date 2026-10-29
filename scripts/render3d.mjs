// Render one scene of an existing data reel in real 3D, for comparison.
// usage: node scripts/render3d.mjs <work id> [scene index, default: first bars scene]
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [id, idx] = process.argv.slice(2);
const work = join(ROOT, "work", id);
const script = JSON.parse(readFileSync(join(work, "script.json"), "utf8"));
const timing = JSON.parse(readFileSync(join(work, "timings.json"), "utf8"));
const i = idx !== undefined ? Number(idx) : script.scenes.findIndex((s) => s.kind === "bars");
const scene = { ...script.scenes[i], ...timing.scenes[i] };
const inputProps = { audio: `work/${id}.mp3`, handle: "@bryzdaily", scene };
const serveUrl = await bundle({ entryPoint: join(ROOT, "src/index.ts"), publicDir: join(ROOT, "public") });
const composition = await selectComposition({ serveUrl, id: "Data3D", inputProps });
const out = join(ROOT, "out", `${id}-3d-s${i}.mp4`);
await renderMedia({
  composition, serveUrl, inputProps, codec: "h264", crf: 20, outputLocation: out,
  concurrency: 1, // WebGL is memory hungry on 8GB
  chromiumOptions: { gl: "angle" },
  onProgress: ({ progress }) => process.stdout.write(`\r  ${Math.round(progress * 100)}%`),
});
console.log(`\n✓ ${out}`);
