# Reel Engine

One line in, finished vertical reel out. Type a topic in Spanish and it writes the script, records the voice, animates every scene, and times the captions to each spoken word.

```bash
npm run reel -- "por qué el mar es salado"
# → out/2026-10-28-por-que-el-mar-es-salado.mp4  (1080×1920, ~30s)
# → out/2026-10-28-por-que-el-mar-es-salado.txt  (caption, hashtags, sources to check)
```

## How it works

1. **Script.** `claude -p` writes a 5–6 scene script as JSON against a fixed schema: hook, stat, compare, list, line, end. It must cite 2–3 real sources and rate its own confidence, and it may only use numbers it's sure of.
2. **Voice.** `edge-tts` voices each scene and returns per-word timings, so captions and scene cuts sync to the voice without a transcription pass.
3. **Animation.** A Remotion composition turns the scenes into kinetic typography: words slam in, numbers count up, comparisons and lists land as the narrator reaches them, and the spoken word lights up in the captions.
4. **Post kit.** The caption, hashtags and sources go in a text file next to the video. Check the sources before posting.

## Why the sources file

AI scripts can state wrong facts confidently. The video is only as good as its facts, so every reel ships with where the claims come from, and nothing gets posted without a human look.

## Stack

Node · Remotion 4 · edge-tts (Python) · ffmpeg · Claude Code CLI. Runs locally, ~1.5 min per reel on an 8GB M-series Mac, $0 per reel beyond the Claude plan.
