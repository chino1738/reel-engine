"""Voice every scene with edge-tts and keep per-word timings.

usage: python3 tts.py <script.json> <out.mp3> <timings.json> [voice] [rate] [pitch]
Writes one mp3 for the whole reel and a JSON list of scenes with start/end
seconds plus every word's start/end, so the video can sync to the voice.
"""
import asyncio, json, subprocess, sys, tempfile, os

FFMPEG = os.environ.get("FFMPEG", os.path.expanduser("~/projects/voice-claude-app/bin/ffmpeg"))
TAIL = 0.5  # silence after the last word, so the outro can land


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


def norm(t):
    return "".join(ch for ch in t.lower() if ch.isalnum())


async def main(script_path, out_mp3, out_json, voice, rate, pitch):
    """Voice the whole script in ONE pass so it reads as one take: natural sentence pauses and no
    pitch reset at every scene. Word boundaries are then split back into scenes by their text."""
    script = json.load(open(script_path))
    says = [sc["say"].strip() for sc in script["scenes"]]
    tmp = tempfile.mkdtemp()
    raw = os.path.join(tmp, "all.mp3")
    words = await voice_scene(" ".join(says), voice, raw, rate, pitch)
    # walk the spoken words in order, handing each scene as many as its own text holds
    scenes, k = [], 0
    for i, say in enumerate(says):
        need, got, mine = len(norm(say)), 0, []
        while k < len(words) and (got < need or not mine):
            if i < len(says) - 1 and mine and got + len(norm(words[k]["w"])) > need + 2:
                break
            mine.append(words[k]); got += len(norm(words[k]["w"])); k += 1
        scenes.append({"words": mine})
    if k < len(words):
        scenes[-1]["words"] += words[k:]
    total = duration(raw) + TAIL
    # a scene starts halfway through the pause before its first word and runs to the next scene
    for i, sc in enumerate(scenes):
        w = sc["words"]
        if i == 0:
            sc["start"] = 0.0
        else:
            prev = scenes[i - 1]["words"]
            sc["start"] = (prev[-1]["e"] + w[0]["s"]) / 2 if prev and w else scenes[i - 1]["start"] + 0.5
    for i, sc in enumerate(scenes):
        sc["end"] = scenes[i + 1]["start"] if i + 1 < len(scenes) else total
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", raw, "-af", f"apad=pad_dur={TAIL}",
                    "-c:a", "libmp3lame", "-q:a", "3", out_mp3], check=True)
    json.dump({"total": total, "scenes": scenes}, open(out_json, "w"), ensure_ascii=False)


if __name__ == "__main__":
    a = sys.argv[1:]
    asyncio.run(main(a[0], a[1], a[2], a[3] if len(a) > 3 else "es-MX-JorgeNeural",
                     a[4] if len(a) > 4 else "+12%", a[5] if len(a) > 5 else "+0Hz"))
