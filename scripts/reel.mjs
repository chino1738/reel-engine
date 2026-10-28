// One line in, finished reel out.
// usage: npm run reel -- "por qué la comida del avión sabe rara" [--handle @cuenta] [--voice es-MX-JorgeNeural]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const BOOL = new Set(["--reuse"]);
loadEnv(join(dirname(fileURLToPath(import.meta.url)), "..", ".env"));
function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const topic = args.filter((a, i) => !a.startsWith("--") && !(args[i - 1]?.startsWith("--") && !BOOL.has(args[i - 1]))).join(" ").trim();
const lang = flag("--lang", "en");
const handle = flag("--handle", lang === "es" ? "@curiosidades" : "@yourhandle");
const voice = flag("--voice", lang === "es" ? "es-MX-JorgeNeural" : "en-US-BrianNeural");
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
const SCENE_TYPES_EN = `Scene kinds:
- hook: first scene, a question or fact that stops the scroll. "big" = on-screen words (max 7).
- stat: "big" = a short number like "30%" or "35,000 ft", "label" = what it means (max 8 words).
- compare: "a", "b" = two short options (max 3 words each), optional "aNote", "bNote" (max 5 words).
- list: "items" = 2-3 entries of max 3 words.
- line: "big" = one key idea (max 7 words).
- end: last scene, "say" invites people to follow, "big" = "Follow for more".`;
const SCENE_TYPES_ES = `Tipos de escena:
- hook: primera escena, pregunta o dato que detiene el scroll. "big" = la frase en pantalla (máx 7 palabras).
- stat: "big" = un número corto como "30%" o "10.000 m", "label" = qué significa (máx 8 palabras).
- compare: "a", "b" = dos opciones cortas (máx 3 palabras cada una), "aNote", "bNote" opcionales (máx 5 palabras).
- list: "items" = 2-3 elementos de máx 3 palabras.
- line: "big" = una idea clave (máx 7 palabras).
- end: última escena, "say" invita a seguir la cuenta, "big" = "Sígueme para más".`;
const prompt = lang === "es"
  ? `Eres guionista de reels de curiosidades en español latino neutro. Tema: "${topic}".
Devuelve SOLO un objeto JSON con: "title", "caption" (1-2 frases), "hashtags" (5, sin #), "sources" (2-3 fuentes reales y verificables), "confidence" ("alta"|"media"), "scenes" (lista).
Cada escena: {"kind", "say", "broll", ...campos de su tipo}. "broll" = 2-4 palabras EN INGLÉS para buscar un clip de video de stock que muestre literalmente lo que se dice (ej. "ocean waves aerial", "airplane meal tray").
${SCENE_TYPES_ES}
Reglas: 5 a 6 escenas; todo el "say" junto suma 60-80 palabras (~30 s); cada "say" es una frase corta y natural. Al menos 3 tipos de escena distintos. Solo hechos bien establecidos; nada de cifras inventadas. Explica el porqué de forma simple, sin relleno.`
  : `You write short-form "did you know / why does" explainer reels in plain, punchy American English. Topic: "${topic}".
Return ONLY a JSON object with: "title", "caption" (1-2 sentences), "hashtags" (5, no #), "sources" (2-3 real, checkable sources: institution, study or encyclopedia), "confidence" ("high"|"medium"), "scenes" (array).
Each scene: {"kind", "say", "broll", ...fields for its kind}. "broll" = 2-4 English words to search a stock video clip that literally shows what's being said (e.g. "ocean waves aerial", "airplane meal tray"). Concrete, filmable things only.
${SCENE_TYPES_EN}
Rules: 5-6 scenes; all "say" text together is 60-80 words (~30 s); each "say" is one short, natural sentence. Use at least 3 different scene kinds. Only well-established facts; never invent numbers. Explain the why simply, like to a friend. No filler, no "did you know".`;
// --reuse re-renders today's existing script and voice (for template tweaks)
const reuse = args.includes("--reuse") && existsSync(join(work, "timings.json"));
let script;
if (reuse) {
  script = JSON.parse(readFileSync(join(work, "script.json"), "utf8"));
} else {
  const raw = execFileSync("claude", ["-p", "--model", "sonnet", prompt], { encoding: "utf8", maxBuffer: 1 << 24 });
  script = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
}
const spoken = script.scenes.map((s) => s.say).join(" ").split(/\s+/).length;
if (spoken > 95) console.warn(`  ⚠ script runs long (${spoken} words); expect 40s+`);
writeFileSync(join(work, "script.json"), JSON.stringify(script, null, 2));
console.log(`  "${script.title}" · ${script.scenes.length} scenes · confidence ${script.confidence}`);

// 2. Voice with per-word timing.
step("Recording the voiceover");
const audioRel = `work/${id}.mp3`;
const timingPath = join(work, "timings.json");
if (!reuse) execFileSync("python3", [join(ROOT, "scripts/tts.py"), join(work, "script.json"), join(ROOT, "public", audioRel), timingPath, voice], { stdio: "inherit" });
const timing = JSON.parse(readFileSync(timingPath, "utf8"));
const scenes = script.scenes.map((s, i) => ({ ...s, ...timing.scenes[i] }));

// 3. B-roll: one matching vertical clip per scene from Pexels (free, commercial use allowed).
step("Finding footage");
if (!process.env.PEXELS_API_KEY && !process.env.PIXABAY_API_KEY) console.warn("  no PEXELS_API_KEY or PIXABAY_API_KEY in .env, rendering without footage");
else {
  const used = new Set();
  for (const [i, s] of scenes.entries()) {
    const rel = `work/${id}-s${i}.mp4`;
    if (reuse && existsSync(join(ROOT, "public", rel))) { s.video = rel; continue; }
    const clip = await findClip(s.broll || script.title, used, s.end - s.start);
    if (!clip) { console.log(`  scene ${i + 1}: no clip for "${s.broll}"`); continue; }
    used.add(clip.id);
    const buf = Buffer.from(await (await fetch(clip.link)).arrayBuffer());
    writeFileSync(join(ROOT, "public", rel), buf);
    s.video = rel;
    s.credit = clip.credit;
    console.log(`  scene ${i + 1}: "${s.broll}" → ${clip.credit.split(" / ")[1].toLowerCase()} ${clip.id} (${(buf.length / 1e6).toFixed(1)} MB)`);
  }
}

// 4. Render.
step("Rendering the video");
const serveUrl = await bundle({ entryPoint: join(ROOT, "src/index.ts"), publicDir: join(ROOT, "public") });
const inputProps = { audio: audioRel, handle, lang, total: timing.total, scenes };
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

// 5. Post kit: caption, hashtags, and sources to double-check before posting.
const credits = [...new Set(scenes.map((s) => s.credit).filter(Boolean))];
const kit = `${script.caption}\n\n${script.hashtags.map((h) => `#${h}`).join(" ")}\n\n--- check before posting (confidence: ${script.confidence}) ---\n${script.sources.map((s) => `• ${s}`).join("\n")}\n${credits.length ? `\nFootage: ${credits.join(", ")}\n` : ""}`;
writeFileSync(join(ROOT, "out", `${id}.txt`), kit);
console.log(`\n\n✓ ${outFile}\n✓ ${join(ROOT, "out", `${id}.txt`)}`);

async function findClip(query, used, need) {
  return process.env.PEXELS_API_KEY ? findPexels(query, used, need) : findPixabay(query, used, need);
}

async function findPexels(query, used, need) {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=15&size=medium`;
  const r = await fetch(url, { headers: { Authorization: process.env.PEXELS_API_KEY } });
  if (!r.ok) { console.warn(`  pexels ${r.status} for "${query}"`); return null; }
  const { videos = [] } = await r.json();
  for (const v of videos) {
    if (used.has(v.id) || v.duration < need) continue;
    // smallest file that still fills a 1080-wide frame
    const f = v.video_files
      .filter((x) => x.file_type === "video/mp4" && x.height > x.width && x.width >= 720)
      .sort((a, b) => a.width - b.width)[0];
    if (f) return { id: v.id, link: f.link, credit: `${v.user?.name ?? "Pexels"} / Pexels` };
  }
  return null;
}

// Pixabay has few vertical clips, so landscape ones get center-cropped to 9:16 by the template.
async function findPixabay(query, used, need) {
  const url = `https://pixabay.com/api/videos/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(query)}&per_page=20&safesearch=true`;
  const r = await fetch(url);
  if (!r.ok) { console.warn(`  pixabay ${r.status} for "${query}"`); return null; }
  const { hits = [] } = await r.json();
  const ranked = hits
    .filter((h) => !used.has(h.id) && h.duration >= need)
    .sort((a, b) => (b.videos.medium.height > b.videos.medium.width) - (a.videos.medium.height > a.videos.medium.width));
  for (const h of ranked) {
    const f = [h.videos.medium, h.videos.large].find((x) => x?.url && Math.min(x.width, x.height) >= 720);
    if (f) return { id: h.id, link: f.url, credit: `${h.user} / Pixabay` };
  }
  return null;
}
