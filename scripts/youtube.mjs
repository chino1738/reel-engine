// Upload a finished reel to YouTube as a Short (official Data API, resumable upload).
import { readFileSync, statSync } from "node:fs";

export async function uploadShort(file, { title, description, tags = [] }) {
  const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;
  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ client_id: YT_CLIENT_ID, client_secret: YT_CLIENT_SECRET, refresh_token: YT_REFRESH_TOKEN, grant_type: "refresh_token" }),
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error(`token refresh failed: ${JSON.stringify(tok)} (run npm run yt-auth again)`);

  const meta = {
    // YouTube rejects < and > in titles and caps them at 100 chars
    snippet: { title: `${title} #shorts`.replace(/[<>]/g, "").slice(0, 100), description: description.replace(/[<>]/g, "").slice(0, 5000), tags, categoryId: "27" },
    status: { privacyStatus: process.env.YT_PRIVACY || "public", selfDeclaredMadeForKids: false },
  };
  const start = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(statSync(file).size) },
    body: JSON.stringify(meta),
  });
  if (!start.ok) throw new Error(`upload init ${start.status}: ${await start.text()}`);
  const put = await fetch(start.headers.get("location"), { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: readFileSync(file) });
  const video = await put.json();
  if (!put.ok) throw new Error(`upload ${put.status}: ${JSON.stringify(video)}`);
  return { id: video.id, privacy: video.status?.privacyStatus, url: `https://youtube.com/shorts/${video.id}` };
}

// Manual use: node scripts/youtube.mjs out/<id>.mp4 "Title"
if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, title = "test"] = process.argv.slice(2);
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2];
  }
  console.log(await uploadShort(file, { title, description: "" }));
}
