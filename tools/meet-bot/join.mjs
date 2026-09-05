// PC B: 人の代わりに Google Meet へ入り、固定 WAV を仮想マイク（BlackHole）へ流す（HUMAN_INTERVENTION=0）。
//
//   ASTRA_MEET_URL=https://meet.google.com/xxx-yyyy-zzz \
//   ASTRA_MEET_BOT_PROFILE=~/astra-meet-bot-profile \
//   node tools/meet-bot/join.mjs <corpus-dir> <out-dir>
//
// 前提: `npm i` で playwright、`npx playwright install chromium`。プロファイルは bot 用のテスト Google
// アカウントでログイン済み（本人のアカウントは使わない）。音は afplay で BlackHole 2ch へ流し、
// Chrome のマイク入力を BlackHole にする（--use-fake-ui-for-media-stream で許可ダイアログを出さない）。
//
// まだ実機で通していない骨格。通るまで run-real-meeting.sh は AUTOMATION_MISSING のまま。
import { chromium } from "playwright";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [corpus, out] = process.argv.slice(2);
const url = process.env.ASTRA_MEET_URL;
const profile = process.env.ASTRA_MEET_BOT_PROFILE;
if (!url || !profile || !corpus || !out) { console.error("usage: ASTRA_MEET_URL ASTRA_MEET_BOT_PROFILE node join.mjs <corpus> <out>"); process.exit(2); }
mkdirSync(out, { recursive: true });
const log = [];
const note = (m) => { log.push(`${new Date().toISOString()} ${m}`); console.log(m); };

// 出力を BlackHole にして afplay すると、Chrome のマイク（BlackHole）へ入る。終わったら元に戻す。
const prevOut = execFileSync("SwitchAudioSource", ["-c", "-t", "output"]).toString().trim();
execFileSync("SwitchAudioSource", ["-t", "output", "-s", "BlackHole 2ch"]);
const restore = () => { try { execFileSync("SwitchAudioSource", ["-t", "output", "-s", prevOut]); } catch {} };
process.on("exit", restore);

const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: ["--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  permissions: ["microphone", "camera"],
});
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "domcontentloaded" });
note(`opened ${url}`);
// マイク選択: 設定 → 音声 → マイク = BlackHole 2ch（UI は変わるので、text で探す）。
try {
  await page.getByRole("button", { name: /設定|Settings|More options|その他/ }).first().click({ timeout: 8000 });
  await page.getByText(/BlackHole/).first().click({ timeout: 8000 });
  await page.keyboard.press("Escape");
  note("mic = BlackHole 2ch");
} catch (e) { note(`mic select skipped: ${e.message}`); }
await page.getByRole("button", { name: /今すぐ参加|参加をリクエスト|Join now|Ask to join/ }).first().click({ timeout: 20000 });
note("join clicked");
await page.waitForTimeout(8000);
await page.screenshot({ path: join(out, "01-joined.png") });

// 台本を順に流す。行間に 1.2 秒。途中で 6 秒の無音（Astra の一時停止の検査用）。
const lines = readFileSync(join(corpus, "lines.tsv"), "utf8").trim().split("\n").map((l) => l.split("\t"));
for (const [i, [speaker, text, wav]] of lines.entries()) {
  note(`say ${speaker}: ${text}`);
  await new Promise((r) => { const p = spawn("afplay", [join(corpus, wav)]); p.on("exit", r); });
  await page.waitForTimeout(1200);
  if (i === 1) { note("silence 6s (pause window)"); writeFileSync(join(out, "pause-window.txt"), `${Date.now()}\n`); await page.waitForTimeout(6000); }
}
await page.screenshot({ path: join(out, "02-spoken.png") });
try { await page.getByRole("button", { name: /通話から退出|Leave call/ }).first().click({ timeout: 8000 }); note("left"); } catch {}
await ctx.close();
writeFileSync(join(out, "bot.log"), log.join("\n") + "\n");
restore();
console.log("MEET_BOT_OK");
