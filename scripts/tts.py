"""Voice every scene with edge-tts and keep per-word timings.

usage: python3 tts.py <script.json> <out.mp3> <timings.json> [voice] [rate] [pitch]
Writes one mp3 for the whole reel and a JSON list of scenes with start/end
seconds plus every word's start/end, so the video can sync to the voice.
"""
import asyncio, json, subprocess, sys, tempfile, os

FFMPEG = os.environ.get("FFMPEG", os.path.expanduser("~/projects/voice-claude-app/bin/ffmpeg"))
GAP = 0.25  # breath between scenes, seconds


async def voice_scene(text, voice, path, rate, pitch):
    words, audio = [], bytearray()
    comm = __import__("edge_tts").Communicate(text, voice, rate=rate, pitch=pitch, boundary="WordBoundary")
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            s = chunk["offset"] / 1e7
            words.append({"w": chunk["text"], "s": s, "e": s + chunk["duration"] / 1e7})
    open(path, "wb").write(audio)
    return words


def duration(path):
    out = subprocess.run([FFMPEG, "-i", path], capture_output=True, text=True).stderr
    h, m, s = out.split("Duration: ")[1].split(",")[0].split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


async def main(script_path, out_mp3, out_json, voice, rate, pitch):
    script = json.load(open(script_path))
    tmp = tempfile.mkdtemp()
    parts, scenes, t = [], [], 0.0
    silence = os.path.join(tmp, "gap.mp3")
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
                    "-t", str(GAP), "-q:a", "9", silence], check=True)
    for i, sc in enumerate(script["scenes"]):
        p = os.path.join(tmp, f"s{i}.mp3")
        words = await voice_scene(sc["say"], voice, p, rate, pitch)
        d = duration(p)
        scenes.append({"start": t, "end": t + d, "words": [{**w, "s": w["s"] + t, "e": w["e"] + t} for w in words]})
        parts += [p, silence]
        t += d + GAP
    listfile = os.path.join(tmp, "list.txt")
    open(listfile, "w").write("".join(f"file '{p}'\n" for p in parts))
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listfile,
                    "-c:a", "libmp3lame", "-q:a", "3", out_mp3], check=True)
    json.dump({"total": t, "scenes": scenes}, open(out_json, "w"), ensure_ascii=False)


if __name__ == "__main__":
    a = sys.argv[1:]
    asyncio.run(main(a[0], a[1], a[2], a[3] if len(a) > 3 else "es-MX-JorgeNeural",
                     a[4] if len(a) > 4 else "+12%", a[5] if len(a) > 5 else "+0Hz"))
