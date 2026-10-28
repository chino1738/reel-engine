// One line in, finished reel out.
// usage: npm run reel -- "por qué la comida del avión sabe rara" [--handle @cuenta] [--voice es-MX-JorgeNeural]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const topic = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")).join(" ").trim();
const handle = flag("--handle", "@curiosidades");
const voice = flag("--voice", "es-MX-JorgeNeural");
if (!topic) {
  console.error('Give it a topic: npm run reel -- "por qué el cielo es azul"');
  process.exit(1);
}

const slug = topic.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
const id = `${new Date().toISOString().slice(0, 10)}-${slug}`;
const work = join(ROOT, "work", id);
mkdirSync(work, { recursive: true });
mkdirSync(join(ROOT, "out"), { recursive: true });
const step = (s) => console.log(`\n▸ ${s}`);

// 1. Script: Claude writes it, held to facts it can stand behind.
step("Writing the script");
const prompt = `Eres guionista de reels de curiosidades en español latino neutro. Tema: "${topic}".
Devuelve SOLO un objeto JSON, sin texto antes ni después, con esta forma:
{"title": string, "caption": string (1-2 frases para la descripción del post), "hashtags": string[] (5, sin #),
 "sources": string[] (2-3 fuentes reales y verificables: institución, estudio o enciclopedia),
 "confidence": "alta" | "media",
 "scenes": [ {"kind": "hook", "say": string, "big": string}, ... ]}
Tipos de escena permitidos:
- hook: primera escena, pregunta o dato que detiene el scroll. "big" = la frase en pantalla (máx 7 palabras).
- stat: "big" = un número corto como "30%" o "10.000 m", "label" = qué significa (máx 8 palabras).
- compare: "a", "b" = dos opciones cortas (máx 3 palabras cada una), "aNote", "bNote" opcionales (máx 5 palabras).
- list: "items" = 2-3 elementos de máx 3 palabras.
- line: "big" = una idea clave (máx 7 palabras).
- end: última escena, "say" invita a seguir la cuenta, "big" = "Sígueme para más".
Reglas:
- 5 a 6 escenas. TODO el texto "say" junto debe sumar entre 60 y 80 palabras (unos 30 segundos). Cada "say" es una sola frase corta y natural para voz.
- Usa al menos 3 tipos de escena distintos; no repitas "line" más de una vez seguida.
- Solo hechos bien establecidos. Nada de cifras inventadas: si no estás seguro de un número, no uses escena stat.
- Explica el porqué de forma simple, como a un amigo. Sin relleno, sin "¿sabías que...?".`;
const raw = execFileSync("claude", ["-p", "--model", "sonnet", prompt], { encoding: "utf8", maxBuffer: 1 << 24 });
const script = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
const spoken = script.scenes.map((s) => s.say).join(" ").split(/\s+/).length;
if (spoken > 95) console.warn(`  ⚠ script runs long (${spoken} words); expect 40s+`);
writeFileSync(join(work, "script.json"), JSON.stringify(script, null, 2));
console.log(`  "${script.title}" · ${script.scenes.length} scenes · confidence ${script.confidence}`);

// 2. Voice with per-word timing.
step("Recording the voiceover");
const audioRel = `work/${id}.mp3`;
const timingPath = join(work, "timings.json");
execFileSync("python3", [join(ROOT, "scripts/tts.py"), join(work, "script.json"), join(ROOT, "public", audioRel), timingPath, voice], { stdio: "inherit" });
const timing = JSON.parse(readFileSync(timingPath, "utf8"));
const scenes = script.scenes.map((s, i) => ({ ...s, ...timing.scenes[i] }));

// 3. Render.
step("Rendering the video");
const serveUrl = await bundle({ entryPoint: join(ROOT, "src/index.ts"), publicDir: join(ROOT, "public") });
const inputProps = { audio: audioRel, handle, total: timing.total, scenes };
const composition = await selectComposition({ serveUrl, id: "Reel", inputProps });
const outFile = join(ROOT, "out", `${id}.mp4`);
let last = -1;
await renderMedia({
  composition,
  serveUrl,
  codec: "h264",
  outputLocation: outFile,
  inputProps,
  concurrency: 2,
  onProgress: ({ progress }) => {
    const pct = Math.floor(progress * 10) * 10;
    if (pct !== last) { last = pct; process.stdout.write(`  ${pct}%`); }
  },
});

// 4. Post kit: caption, hashtags, and sources to double-check before posting.
const kit = `${script.caption}\n\n${script.hashtags.map((h) => `#${h}`).join(" ")}\n\n--- check before posting (confidence: ${script.confidence}) ---\n${script.sources.map((s) => `• ${s}`).join("\n")}\n`;
writeFileSync(join(ROOT, "out", `${id}.txt`), kit);
console.log(`\n\n✓ ${outFile}\n✓ ${join(ROOT, "out", `${id}.txt`)}`);
