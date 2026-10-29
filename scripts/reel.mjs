// One line in, finished reel out.
// usage: npm run reel -- "por qué la comida del avión sabe rara" [--handle @cuenta] [--voice es-MX-JorgeNeural]
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { uploadShort } from "./youtube.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FFMPEG = process.env.FFMPEG ?? join(process.env.HOME, "projects/voice-claude-app/bin/ffmpeg");
// Poly Pizza model picks + misses (see modelAsset)
const MODELS_IDX = join(ROOT, "data", "models.json");
const modelIdx = existsSync(MODELS_IDX) ? JSON.parse(readFileSync(MODELS_IDX, "utf8")) : {};
const modelCredits = [];
const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const BOOL = new Set(["--reuse", "--revoice", "--auto", "--deliver", "--focus"]);
loadEnv(join(dirname(fileURLToPath(import.meta.url)), "..", ".env"));
function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
let topic = args.filter((a, i) => !a.startsWith("--") && !(args[i - 1]?.startsWith("--") && !BOOL.has(args[i - 1]))).join(" ").trim();

// Lanes rotate daily so the numbers can show what sticks. Each lane carries its honesty rule.
const LANES = [
  { name: "curiosity", brief: "an everyday 'why does X happen' science or body question", rule: "Only well-established science." },
  { name: "money", brief: "how a real company, product or everyday thing actually makes money (e.g. why Costco's hot dog is still $1.50)", rule: "Real, checkable business facts. No income promises, no get-rich claims." },
  { name: "true story", brief: "a wild but TRUE, documented story from history or the news (e.g. the man who sold the Eiffel Tower)", rule: "Only documented events. Never invent details, quotes or names." },
  { name: "conspiracy", brief: "a famous conspiracy theory: what people believe, then what the evidence actually shows", rule: "Never present a false claim as true. State plainly what is proven, what is not, and what is false." },
  { name: "ai", brief: "a genuinely useful Claude / AI tip or a surprising fact about how AI works", rule: "Accurate, current, no hype. Nothing you are unsure is true." },
];
const HIST = join(ROOT, "work", "history.json");
const history = existsSync(HIST) ? JSON.parse(readFileSync(HIST, "utf8")) : [];
const day = Math.floor(Date.now() / 86400000);
// the city style lives in one little 3D town, so its topics have to happen in a town
const CITY_LANES = [
  { name: "city", brief: "how cities, traffic, roads, parking or housing really work (e.g. why traffic jams appear with no accident)", rule: "Only well-established urban-planning or traffic research. Real, checkable numbers only." },
  { name: "money", brief: "how a store, chain or everyday business in town actually makes money (e.g. why gas stations sell so many snacks)", rule: "Real, checkable business facts. No income promises, no get-rich claims." },
  { name: "shopping", brief: "a documented trick stores and restaurants use on shoppers (e.g. why the milk is at the back)", rule: "Only documented retail practices; say 'often' or 'many stores', never claim every store does it." },
];
const lanes = flag("--style", "demo") === "city" ? CITY_LANES : LANES;
const lane = lanes.find((l) => l.name === flag("--lane")) ?? lanes[day % lanes.length];
if (args.includes("--auto")) {
  const pick = execFileSync("claude", ["-p", "--model", "sonnet",
    `Pick ONE specific, highly clickable short-video topic. Lane: ${lane.brief}. ${lane.rule}
Already done (never repeat or closely overlap): ${history.map((h) => h.topic).join(" | ") || "none"}.
Phrase it as the single question the video answers, max 9 words (e.g. "Why fingers wrinkle in water"). One idea only: no "and", no "but also".
Return ONLY the topic, no quotes, no punctuation at the end.`], { encoding: "utf8" }).trim().split("\n").pop();
  topic = pick;
  console.log(`▸ Lane "${lane.name}" → ${topic}`);
}
const lang = flag("--lang", "en");
const style = flag("--style", "demo"); // demo | data | 3d | city | collage | footage
const dataLike = style === "data" || style === "3d";
const handle = flag("--handle", lang === "es" ? "@curiosidades" : "@bryzdaily");
// voices he picked 10/28: brian (default) and ava; both Multilingual, tuned for energy
const VOICES = {
  brian: { id: "en-US-BrianMultilingualNeural", rate: "+18%", pitch: "+3Hz" },
  ava: { id: "en-US-AvaMultilingualNeural", rate: "+16%", pitch: "+0Hz" },
  jorge: { id: "es-MX-JorgeNeural", rate: "+12%", pitch: "+0Hz" },
};
// --auto alternates Brian / Ava by day so we learn which one performs
const voicePick = VOICES[flag("--voice", lang === "es" ? "jorge" : args.includes("--auto") ? (day % 2 ? "ava" : "brian") : "brian")] ?? { id: flag("--voice"), rate: "+15%", pitch: "+0Hz" };
if (!topic) {
  console.error('Give it a topic: npm run reel -- "por qué el cielo es azul"');
  process.exit(1);
}

const slug = topic.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
const id = `${new Date().toISOString().slice(0, 10)}-${slug}${style === "demo" ? "" : `-${style}`}`;
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
const FLUENT = JSON.parse(readFileSync(join(ROOT, "data/fluent-index.json"), "utf8"));
const COLLAGE_FIELDS = `Also give every scene:
- "props": 1-3 objects that literally show what's said, each EXACTLY one name from the OBJECT LIST below (hook: 3 props; compare: 2 props, one per side, in a/b order; list: one per item; others: 1-2).
- "em": 1-2 words copied exactly from that scene's "say" to highlight (the surprising or key words).
- "stamp": optional 1-2 word stamp in caps for hook/line/end scenes (e.g. "WHY?", "PLOT TWIST", "NOPE").
OBJECT LIST:
${readFileSync(join(ROOT, "data/fluent-names.txt"), "utf8").split("\n").join(" | ")}`;
const DEMO_FIELDS = `THE VISUALS MUST ACT OUT EXACTLY WHAT IS SAID. Give every scene:
- "beats": 2-4 visual beats, in the order their words are spoken. Each beat:
  {"on": one word copied EXACTLY from that scene's "say" (the moment it should happen),
   "show": the object, EXACTLY one name from the OBJECT LIST, or a drawn rig: "rig:glass" (glass of water), "rig:bottle" (plastic water bottle), "rig:thermometer",
   "do": one verb from the VERBS list that acts out the words,
   "to": optional second object for pour/arrow,
   "fx": optional particles from FX,
   "where": "left" | "center" | "right"}
- Rules: if the words name a concrete thing, show that thing on that word. If they describe something happening (spilling, melting, freezing, falling, growing, evaporating, breaking), use the verb that shows it happening. "glass of water" = rig:glass with appear; "water bottle spilling" = rig:bottle with spill. Use left/right for two things being compared or interacting, center for one hero thing. A new beat in the same "where" replaces the previous one there. The FIRST beat of every scene must be on one of its first 3 words so the screen is never empty; for lead-ins like "Here's the crazy part" show a reaction object (e.g. Exploding head, Face with open mouth, Light bulb) on the first word.
- "em": 1-2 words copied exactly from that scene's "say" to highlight.
- "stamp": optional 1-2 word stamp in caps for hook/line scenes (e.g. "WHY?", "PLOT TWIST").
VERBS: appear (pops in), drop (falls in and lands), slide, fly (flies in on an arc), spin, shake (vibrates/shivers), grow (gets bigger), shrink, pulse (heartbeat), bounce, float (drifts up), sink (sinks down), orbit (circles around), spill (tips over, liquid pours out), pour (tips and pours into "to"), fill (liquid level rises), drain (level drops), rain (drops fall from it), evaporate (steam rises, level drops / it fades up), melt, freeze (turns icy, snow), heat (gets hot, flames), burst (pops apart into particles), crack (splits in two), multiply (becomes many copies), zoom (magnifying glass zooms in), cross (red X: wrong/myth), check (green check: true), arrow (arrow to "to"), glow.
FX: droplets, sparkles, steam, smoke, dust, confetti, snow, fire, bubbles, salt, hearts, zap.
OBJECT LIST:
${readFileSync(join(ROOT, "data/fluent-names.txt"), "utf8").split("\n").join(" | ")}`;
const CITY_KINDS = `THIS REEL HAPPENS IN ONE LITTLE 3D CITY (blocky low-poly toy town). Every scene is a shot in that city that SHOWS what is being said, like a little film.
Scene fields:
- "kind": "hook" (first) | "line" | "count" | "end" (last: asks a question for the comments, then invites a follow).
- "set": "highway" (wide multi-lane highway with trees) | "downtown" (street grid, shops, towers) | "suburb" (street of houses with yards) | "store" (one shop front on a downtown street).
- "shot": "aerial" (drone, high) | "street" (low, at street level) | "chase" (behind a car in traffic: highway or downtown) | "orbit" (slow circle around the set) | "reaction" (close-up of one person reacting, the set behind them).
- "traffic": {"level": 0-1 (0 empty, 0.5 busy, 1 gridlock), "to": optional new level, "on": the exact word in "say" where it changes}.
- "brake": {"on": exact word} = one driver in view slams the brakes on that word; their brake lights flash and the cars behind brake one after another (a real slowdown wave). Use it whenever the words are about braking, slowing or a chain reaction; best with "chase" (we ride behind the car that brakes) or "aerial"/"orbit" (we watch the wave roll back), at traffic level 0.5+.
- "build": {"what": "lane" (highway: a new lane is laid) | "tower" (downtown: a skyscraper rises) | "houses" (suburb: new houses spread out), "on": exact word}.
- "people": {"count": 1-14, "do": "walk" | "run" | "enter" (walk into the shop), "on": exact word} (store or downtown sets).
- "reaction": {"do": "no" (shakes head, frustrated) | "yes" (nods, realises) | "idle" | "pick-up"} (reaction shots only).
- "big": on-screen words, max 5, for hook/line/end (leave it out on reaction shots).
- count scenes: "value" (number only), optional "prefix" ("$"), "suffix" ("%", " min"), "label" (max 6 words), "on" (word where the number is spoken).
- "em": 1-2 words copied from "say" to highlight.
DIRECTING: the shot acts out the sentence, timed to the word ("more people pile on" → traffic rises ON "pile"; "they add a lane" → build lane ON "lane"; "shoppers walk in" → people enter ON "walk"). Change the set or the shot every scene. Use at least 3 different shots and 2 different sets. The reaction person is the viewer's stand-in (frustrated = "no", realisation = "yes"): use them 1-2 times. Open on a strong establishing shot (aerial or chase).
Rules: 5-7 scenes. EVERY number must be real and from your sources; if you can't source a number, leave it out.`;
const DATA_KINDS = `THIS IS A STAT-FLIP REEL: the numbers are the visuals. Story arc: a surprising or bad-sounding number → "sounds bad/weird, until you see why" → the number that flips it → the real reason → end on a question.
Scene kinds:
- hook: first scene. Opens the curiosity gap in the first 1.5 seconds. "big" = on-screen words (max 5). If the hook states a number, also give "value" (the number only, e.g. 3628 or 1.50), optional "prefix" ("$"), "suffix" ("%", "B", " times"), "on" (the word in "say" where the number is spoken).
- count: one hero number that ticks up. "value", optional "prefix"/"suffix", "label" (what it is, max 6 words), "on" (word in "say" where the number is spoken), "pins": true ONLY if it counts physical things or events you could line up (people, stores, crashes); false for times, prices, percentages, sizes.
- bars: compare 2-4 things on one measure. "items": [{"label": max 2 words, "value": number}] (years or dates: oldest to newest, left to right; otherwise main subject first; the biggest value is lit gold), "unit" (optional, e.g. "%" or "B"), "label" (what's measured, max 5 words).
- scale: one thing vs another (or vs "everyone else combined"). "left": {"label","value","show"}, "right": {"label","value","show"} ("show" = that side's object from the OBJECT LIST), "label" (max 5 words). Only when the two values really differ.
- line: "big" = the key idea/reason, max 6 words.
- end: last scene. "say" asks a question that makes people comment, then invites a follow. "big" = the question, max 6 words.
Also every scene: "em": 1-2 words copied exactly from its "say" to highlight; "show": the scene's subject as EXACTLY one name from the OBJECT LIST below; and "beats": [{"on": one exact word from "say", "show": OBJECT LIST name}] = extra subjects that pop in ON the word that names them.
VISUALS MUST MATCH THE WORDS. "show" and every beat are the literal thing being said ("tire treads" → a wheel, "blood vessels" → a drop of blood, "Costco" → a shopping cart), never a stand-in. Reaction faces (Thinking face, raised eyebrow…) at most ONCE per reel, and only for the end question. Nothing on screen may sit still for more than ~3 seconds: every scene over 10 words needs at least 1 beat, over 18 words needs 2. Beats go on the KEY nouns of the idea, never on incidental words (in "your fingers wrinkle in water" the subject is fingers: don't swap to water).
NUMBERS MUST EARN THEIR PLACE. Use count/bars/scale only for a number that surprises or explains (a price, a time, a size, a share people get wrong). Never count obvious things (fingers, days in a week, legs on a dog), never compare two equal values, never restate a number already shown. One strong number beats three weak ones; if the topic has only one, use line scenes with beats for the rest.
Rules: 5-6 scenes, at most TWO line scenes. EVERY number must be real and come from your sources; if you can't source a number, don't use it. "value" fields are plain numbers. Money: put the symbol in "prefix" (count) or "unit" (bars), e.g. "$".
OBJECT LIST:
${readFileSync(join(ROOT, "data/fluent-names.txt"), "utf8").split("\n").join(" | ")}`;
const prompt = lang === "es"
  ? `Eres guionista de reels de curiosidades en español latino neutro. Tema: "${topic}".
Devuelve SOLO un objeto JSON con: "title", "caption" (1-2 frases), "hashtags" (5, sin #), "sources" (2-3 fuentes reales y verificables), "confidence" ("alta"|"media"), "scenes" (lista).
Cada escena: {"kind", "say", "broll", ...campos de su tipo}. "broll" = 2-4 palabras EN INGLÉS para buscar un clip de video de stock que muestre literalmente lo que se dice (ej. "ocean waves aerial", "airplane meal tray").
${SCENE_TYPES_ES}
Reglas: 5 a 6 escenas; todo el "say" junto suma 60-80 palabras (~30 s); cada "say" es una frase corta y natural. Al menos 3 tipos de escena distintos. Solo hechos bien establecidos; nada de cifras inventadas. Explica el porqué de forma simple, sin relleno.`
  : `You write short-form "did you know / why does" explainer reels in plain, punchy American English. Topic: "${topic}".
Return ONLY a JSON object with: "title", "caption" (1-2 sentences), "hashtags" (5, no #), "sources" (2-3 real, checkable sources: institution, study or encyclopedia), "confidence" ("high"|"medium"), "scenes" (array).
Each scene: {"kind", "say", "broll", ...fields for its kind}. "broll" = 2-4 English words to search a stock video clip that literally shows what's being said (e.g. "ocean waves aerial", "airplane meal tray"). Concrete, filmable things only.
${style === "city" ? CITY_KINDS : dataLike ? DATA_KINDS : SCENE_TYPES_EN}
${args.includes("--auto") ? `Lane: ${lane.name}. ${lane.rule}\n` : ""}Rules: 5-6 scenes; all "say" text together is 60-80 words (~30 s); each "say" is one short, natural sentence. Use at least 3 different scene kinds. Only well-established facts; never invent numbers. Sound like an excited friend who just learned this: punchy, contractions, an exclamation point or a "here's the crazy part" beat where it fits, but never fake hype words like "insane" or "mind-blowing". Explain the why simply. No filler, no "did you know".
${style === "collage" ? COLLAGE_FIELDS : style === "demo" ? DEMO_FIELDS : ""}
${style === "3d" ? `Also give every "show" (scene, beat, scale side) a "model": 1-2 plain English nouns to search a 3D model library for that same physical thing ("hand", "brain", "car tire", "shopping cart"). Concrete objects only, no faces or abstract ideas.` : ""}`;
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
// --revoice keeps the script but records the voice again (e.g. after a voice change)
if (!reuse || args.includes("--revoice"))
  execFileSync("python3", [join(ROOT, "scripts/tts.py"), join(work, "script.json"), join(ROOT, "public", audioRel), timingPath, voicePick.id, voicePick.rate, voicePick.pitch], { stdio: "inherit" });
const timing = JSON.parse(readFileSync(timingPath, "utf8"));
const scenes = script.scenes.map((s, i) => ({ ...s, ...timing.scenes[i] }));

// 3a. Collage art: 3D objects + a mascot pose per scene, from Microsoft's MIT-licensed Fluent emoji.
const POSES = { hook: "Man raising hand", line: "Man detective", stat: "Man tipping hand", compare: "Man shrugging", list: "Man teacher", end: "Man raising hand" };
if (style === "demo") {
  step("Choreographing beats");
  const norm = (w) => w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9%]/g, "");
  for (const s of scenes) {
    const beats = [];
    let cursor = 0;
    for (const [k, b] of (s.beats ?? []).entries()) {
      const target = norm(b.on ?? "");
      let wi = s.words.findIndex((w, i) => i >= cursor && target && (norm(w.w) === target || norm(w.w).startsWith(target) || target.startsWith(norm(w.w)) && norm(w.w).length > 3));
      if (wi < 0) wi = Math.min(s.words.length - 1, Math.round(((k + 0.5) / (s.beats.length)) * s.words.length) - 1);
      cursor = Math.max(cursor, wi + 1);
      const show = b.show?.startsWith("rig:") ? b.show : await fluentAsset(b.show ?? "");
      if (!show) continue;
      const to = b.to ? (b.to.startsWith("rig:") ? b.to : await fluentAsset(b.to)) : undefined;
      beats.push({ at: s.words[Math.max(0, wi)]?.s ?? s.start, show, do: b.do ?? "appear", to: to ?? undefined, fx: b.fx || undefined, where: ["left", "center", "right"].includes(b.where) ? b.where : "center" });
    }
    // a later beat in the same spot takes over; center clears the sides and vice versa
    for (const [i, b] of beats.entries()) {
      const next = beats.slice(i + 1).find((n) => n.where === b.where || n.where === "center" || b.where === "center");
      if (next) b.until = next.at;
    }
    s.beats = beats;
    s.mascot = await fluentAsset(POSES[s.kind] ?? "Man tipping hand", "medium");
  }
  console.log(`  ${scenes.map((s) => s.beats.map((b) => b.do).join("+")).join(" | ")}`);
}
if (style === "city") {
  // every "on" word becomes the second it's spoken, so the city reacts on cue
  const norm = (w) => String(w).toLowerCase().replace(/[^a-z0-9.%$]/g, "").replace(/^\$/, "");
  const when = (s, on) => {
    const t = norm(on ?? "");
    const w = t && s.words.find((w) => norm(w.w) === t || (norm(w.w).length > 3 && (norm(w.w).startsWith(t) || t.startsWith(norm(w.w)))));
    return w ? w.s : undefined;
  };
  for (const s of scenes) {
    if (Array.isArray(s.big)) s.big = s.big.join(" "); // the writer sometimes splits the headline into lines
    for (const k of ["traffic", "build", "people", "brake"]) if (s[k]?.on) s[k].at = when(s, s[k].on);
    if (s.value !== undefined) {
      const w = [s.on, s.value].filter(Boolean).map((x) => when(s, x)).find((x) => x !== undefined);
      s.hit = w !== undefined ? s.words.find((x) => x.s === w).e : s.start + (s.end - s.start) * 0.6;
    }
  }
  console.log(`  ${scenes.map((s) => `${s.set ?? "highway"}/${s.shot ?? "aerial"}`).join(" → ")}`);
}
if (dataLike) {
  // the count lands on the word where the number is spoken
  const norm = (w) => String(w).toLowerCase().replace(/[^a-z0-9.%$]/g, "").replace(/^\$/, "");
  const wordTime = (s, on, from = 0) => {
    const t = norm(on ?? "");
    const i = s.words.findIndex((w, k) => k >= from && t && (norm(w.w) === t || (norm(w.w).length > 3 && (norm(w.w).startsWith(t) || t.startsWith(norm(w.w))))));
    return i;
  };
  const art = async (show, model) => (style === "3d" && (await modelAsset(model ?? show))) || (show ? await fluentAsset(show) : null);
  for (const s of scenes) {
    s.show = s.show ? await art(s.show, s.model) : undefined;
    // beats: subject swaps timed to the word that names them (cursor keeps them in spoken order)
    const beats = [];
    let cursor = 0;
    for (const b of s.beats ?? []) {
      const asset = b.show ? await art(b.show, b.model) : undefined;
      const wi = wordTime(s, b.on, cursor);
      if (!asset || wi < 0) continue;
      cursor = wi + 1;
      beats.push({ at: s.words[wi].s, show: asset });
    }
    s.beats = beats;
    for (const side of [s.left, s.right]) if (side?.show) side.show = await art(side.show, side.model);
    if (s.value === undefined) continue;
    const targets = [s.on, s.value].filter(Boolean).map(norm);
    const w = s.words.find((w) => targets.some((t) => t && (norm(w.w) === t || norm(w.w).replace(/[,]/g, "") === t.replace(/[,]/g, ""))));
    s.hit = w ? w.e : s.start + (s.end - s.start) * 0.6;
  }
}
if (style === "collage") {
  step("Pulling 3D art");
  for (const s of scenes) {
    s.props = (await Promise.all((s.props ?? []).map((n) => fluentAsset(n)))).filter(Boolean);
    s.mascot = await fluentAsset(POSES[s.kind] ?? "Man tipping hand", "medium");
  }
  console.log(`  ${scenes.map((s) => s.props.length).join("/")} props per scene`);
}

// Real 3D models from Poly Pizza (free low-poly library, CC0 / CC-BY). Needs POLY_PIZZA_KEY in .env;
// without it, or with no good match, the Fluent sprite is used. Picks and misses are cached in data/models.json.
async function modelAsset(query) {
  if (!process.env.POLY_PIZZA_KEY || !query) return null;
  const q = query.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim();
  if (!(q in modelIdx)) {
    modelIdx[q] = null;
    try {
      const r = await fetch(`https://api.poly.pizza/v1.1/search/${encodeURIComponent(q)}?Limit=16`, { headers: { "x-auth-token": process.env.POLY_PIZZA_KEY } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const words = q.split(" ");
      // title must actually be the thing; prefer CC0, static models, sane triangle counts
      const pick = ((await r.json()).results ?? [])
        .filter((m) => m.Download && words.every((w) => String(m.Title ?? "").toLowerCase().includes(w)) && !m.Animated)
        .map((m) => ({ m, score: (/cc0|public/i.test(m.Licence ?? "") ? 2 : 0) + (m["Tri Count"] > 200 && m["Tri Count"] < 40000 ? 1 : 0) - String(m.Title).split(" ").length * 0.1 }))
        .sort((a, b) => b.score - a.score)[0]?.m;
      if (pick) {
        const rel = `models/${q.replace(/ /g, "-")}-${pick.ID}.glb`;
        const glb = await fetch(pick.Download);
        if (!glb.ok) throw new Error(`download HTTP ${glb.status}`);
        mkdirSync(join(ROOT, "public", "models"), { recursive: true });
        writeFileSync(join(ROOT, "public", rel), Buffer.from(await glb.arrayBuffer()));
        modelIdx[q] = { file: rel, title: pick.Title, by: pick.Creator?.Username ?? "unknown", licence: pick.Licence ?? "" };
      }
    } catch (e) { console.log(`  model search failed for "${q}": ${e.message}`); delete modelIdx[q]; }
    writeFileSync(MODELS_IDX, JSON.stringify(modelIdx, null, 2));
  }
  const hit = modelIdx[q];
  if (!hit || !existsSync(join(ROOT, "public", hit.file))) return null;
  if (!/cc0|public/i.test(hit.licence)) modelCredits.push(`"${hit.title}" by ${hit.by} (${hit.licence}) via Poly Pizza`);
  return hit.file;
}

async function fluentAsset(name, tone) {
  const keys = Object.keys(FLUENT);
  const want = (tone ? `${name}|${tone}` : name).toLowerCase();
  const key = keys.find((k) => k.toLowerCase() === want) ?? (!tone && keys.find((k) => !k.includes("|") && k.toLowerCase().includes(name.toLowerCase())));
  if (!key) { console.log(`  no 3D art for "${name}"`); return null; }
  const rel = `fluent/${key.replace("|", "-").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
  const abs = join(ROOT, "public", rel);
  if (!existsSync(abs)) {
    const url = `https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/${FLUENT[key].split("/").map(encodeURIComponent).join("/")}`;
    const r = await fetch(url);
    if (!r.ok) { console.log(`  download failed for "${name}"`); return null; }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, Buffer.from(await r.arrayBuffer()));
  }
  return rel;
}

// 3b. B-roll: one matching vertical clip per scene (footage style).
if (style === "footage") step("Finding footage");
if (style !== "footage") {}
else if (!process.env.PEXELS_API_KEY && !process.env.PIXABAY_API_KEY) console.warn("  no PEXELS_API_KEY or PIXABAY_API_KEY in .env, rendering without footage");
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
// --focus quits heavy apps first so the render gets the RAM (8GB Mac)
if (args.includes("--focus")) {
  for (const app of (process.env.FOCUS_QUIT ?? "Google Chrome,Notion,ChatGPT,CapCut,Antigravity").split(",")) {
    try { execFileSync("osascript", ["-e", `if application "${app}" is running then tell application "${app}" to quit`]); } catch {}
  }
  console.log("  focus: closed heavy apps");
}
const serveUrl = await bundle({ entryPoint: join(ROOT, "src/index.ts"), publicDir: join(ROOT, "public") });
const inputProps = { audio: audioRel, handle, lang, total: timing.total, scenes };
const composition = await selectComposition({ serveUrl, id: { demo: "Demo", data: "Data", "3d": "Reel3D", collage: "Collage", city: "City" }[style] ?? "Reel", inputProps });
const outFile = join(ROOT, "out", `${id}.mp4`);
let last = -1;
await renderMedia({
  composition,
  serveUrl,
  codec: "h264",
  crf: 23, // about half the size of the default 18; the apps re-encode anyway, and texts send faster
  outputLocation: outFile,
  inputProps,
  concurrency: style === "3d" || style === "city" ? 1 : 2, // WebGL is memory hungry on 8GB
  ...(style === "3d" || style === "city" ? { chromiumOptions: { gl: "angle" } } : {}),
  onProgress: ({ progress }) => {
    const pct = Math.floor(progress * 10) * 10;
    if (pct !== last) { last = pct; process.stdout.write(`  ${pct}%`); }
  },
});

// 4b. Master the audio. Raw TTS + SFX lands around -19 LUFS, ~5 dB quieter than the feed; social
// platforms play at -14. Low cut + gentle compression first so the voice sits forward, then two-pass loudnorm.
step("Mastering audio");
{
  const chain = "highpass=f=70,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=120:makeup=1.5";
  const probe = spawnSync(FFMPEG, ["-hide_banner", "-i", outFile, "-af", `${chain},loudnorm=I=-14:TP=-1.5:LRA=9:print_format=json`, "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const m = JSON.parse(probe.slice(probe.lastIndexOf("{"), probe.lastIndexOf("}") + 1));
  const mastered = outFile.replace(/\.mp4$/, ".master.mp4");
  execFileSync(FFMPEG, ["-loglevel", "error", "-y", "-i", outFile, "-c:v", "copy", "-af",
    `${chain},loudnorm=I=-14:TP=-1.5:LRA=9:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", mastered]);
  execFileSync("mv", [mastered, outFile]);
  console.log(`  ${(+m.input_i).toFixed(1)} → -14 LUFS`);
}

// 5. Post kit: caption, hashtags, and sources to double-check before posting.
const credits = [...new Set([...scenes.map((s) => s.credit), ...modelCredits].filter(Boolean))];
const kit = `${script.caption}\n\n${script.hashtags.map((h) => `#${h}`).join(" ")}\n\n--- check before posting (confidence: ${script.confidence}) ---\n${script.sources.map((s) => `• ${s}`).join("\n")}\n${credits.length ? `\nCredits: ${credits.join(", ")}\n` : ""}\nDisclosure line for the caption: Narration is AI-generated; graphics are illustrations.\n`;
writeFileSync(join(ROOT, "out", `${id}.txt`), kit);
console.log(`\n\n✓ ${outFile}\n✓ ${join(ROOT, "out", `${id}.txt`)}`);

history.push({ date: id.slice(0, 10), topic, lane: args.includes("--auto") ? lane.name : "manual", voice: voicePick.id, file: `${id}.mp4` });
writeFileSync(HIST, JSON.stringify(history, null, 2));

// 6. Deliver: iCloud Drive/Reels for the phone, plus a text if a number is set.
if (args.includes("--deliver")) {
  step("Delivering");
  const reels = join(process.env.HOME, "Library/Mobile Documents/com~apple~CloudDocs/Reels");
  mkdirSync(reels, { recursive: true });
  execFileSync("cp", [outFile, join(ROOT, "out", `${id}.txt`), reels]);
  console.log(`  → iCloud Drive/Reels/${id}.mp4`);
  // Grain makes 3D renders ~48MB; a 5.5 Mbps copy (~20MB) texts much faster and the apps re-encode anyway.
  const phoneFile = outFile.replace(/\.mp4$/, "-phone.mp4");
  try {
    execFileSync(FFMPEG, ["-loglevel", "error", "-y", "-i", outFile,
      "-c:v", "libx264", "-preset", "slow", "-b:v", "5500k", "-maxrate", "6500k", "-bufsize", "11000k", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", phoneFile]);
  } catch { execFileSync("cp", [outFile, phoneFile]); }
  if (process.env.IMESSAGE_TO) {
    // Text the post kit, then the video. Uploads from the Mac are slow, so the text goes first.
    execFileSync("osascript", [join(ROOT, "scripts/imessage.applescript"), process.env.IMESSAGE_TO,
      `🎬 New @bryzdaily reel (${lane.name}, ${voicePick.id.includes("Ava") ? "Ava" : "Brian"}): ${script.title}\nVideo is the next message (can take a few minutes to upload).\n\n${kit}`, phoneFile]);
    console.log(`  → texted to ${process.env.IMESSAGE_TO}`);
  }
  if (process.env.YT_REFRESH_TOKEN) {
    // A failed upload shouldn't fail the night: the reel is already on his phone.
    try {
      const yt = await uploadShort(outFile, { title: script.title, description: `${script.caption}\n\nSources:\n${script.sources.map((s) => `• ${s}`).join("\n")}\n\n${script.hashtags.map((h) => `#${h}`).join(" ")}`, tags: script.hashtags });
      console.log(`  → YouTube ${yt.privacy}: ${yt.url}`);
    } catch (e) {
      console.log(`  ✗ YouTube upload failed: ${e.message}`);
    }
  }
}

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
