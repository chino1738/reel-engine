// One-time YouTube login. Saves a refresh token to .env so the nightly run can upload on its own.
// usage: npm run yt-auth -- ~/Downloads/client_secret_XXXX.json
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ENV = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error("Pass the client_secret JSON you downloaded from Google Cloud:\n  npm run yt-auth -- ~/Downloads/client_secret_XXXX.json");
  process.exit(1);
}
const { installed } = JSON.parse(readFileSync(file, "utf8"));
if (!installed) { console.error("That JSON isn't a Desktop app client. Create the OAuth client as type 'Desktop app'."); process.exit(1); }
const { client_id, client_secret } = installed;

const PORT = 53682;
const redirect = `http://127.0.0.1:${PORT}`;
const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id, redirect_uri: redirect, response_type: "code", access_type: "offline", prompt: "consent",
  scope: "https://www.googleapis.com/auth/youtube.upload",
});

const server = createServer(async (req, res) => {
  const code = new URL(req.url, redirect).searchParams.get("code");
  if (!code) { res.end("No code. Close this tab and run yt-auth again."); return; }
  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ code, client_id, client_secret, redirect_uri: redirect, grant_type: "authorization_code" }),
  }).then((r) => r.json());
  if (!tok.refresh_token) { res.end("Google didn't return a refresh token. Check the terminal."); console.error(tok); process.exit(1); }
  const keep = existsSync(ENV) ? readFileSync(ENV, "utf8").split("\n").filter((l) => l && !/^YT_(CLIENT_ID|CLIENT_SECRET|REFRESH_TOKEN)=/.test(l)) : [];
  writeFileSync(ENV, [...keep, `YT_CLIENT_ID=${client_id}`, `YT_CLIENT_SECRET=${client_secret}`, `YT_REFRESH_TOKEN=${tok.refresh_token}`].join("\n") + "\n");
  res.end("YouTube connected. You can close this tab.");
  console.log("✓ YouTube connected. Token saved to .env");
  server.close();
});
server.listen(PORT, "127.0.0.1", () => {
  console.log("Opening Google login. Pick the account that owns @bryzdaily (choose the channel if asked).");
  execFileSync("open", [url]);
});
