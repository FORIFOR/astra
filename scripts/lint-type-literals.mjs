#!/usr/bin/env node
/**
 * 6 つの型（live_notes / captions / action_confirmation / meeting_controller /
 * post_meeting / transcript_attribution）を描く view で、文字の大きさを数字で
 * 直に書いていないかを見る。
 *
 * 数字で書けると段が増える。実際、Recording Workspace は 1 面の中に
 * 9 / 10 / 11 / 12 / 13 / 14 / 15 / 16 / 24 の 9 段を持っていた。12 と 13 と 14 と 15 は
 * 「別の段」には見えず「揃っていない」に見える。段は tokens.json の `type`（窓）と
 * `dockType`（Dock）だけから取る。
 *
 * 見るのは Text の大きさだけ。Image(systemName:) の大きさは字ではなく図形の寸法なので、
 * 同じ行か直前の行に `Image(` があるものは通す。
 *
 *   node scripts/lint-type-literals.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = path.join(root, 'apps/astra-macos/Sources/AstraMac');

/** 6 つの型を描く view。ここに無い面（Home / Settings など）はまだ対象外。 */
const SCOPE = [
  'RecordingWorkspace',
  'Main/MainWindowView.swift',
  'Main/WorkspacePanes.swift',
  'Meeting/MeetingArtifactView.swift',
  'VoiceHUD/VoiceHUDView.swift',
];

const LITERAL = /\.font\(\.system\(size:\s*(\d+(?:\.\d+)?)\b/g;

async function files(entry) {
  const p = path.join(src, entry);
  if (entry.endsWith('.swift')) return [p];
  const names = await readdir(p);
  return names.filter((n) => n.endsWith('.swift')).map((n) => path.join(p, n));
}

const problems = [];
for (const entry of SCOPE) {
  for (const file of await files(entry)) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(LITERAL)) {
        const prev = lines[i - 1] ?? '';
        if (line.includes('Image(') || prev.trim().startsWith('Image(')) continue;
        problems.push(`${path.relative(root, file)}:${i + 1}: size ${m[1]} — ${line.trim()}`);
      }
    });
  }
}

if (problems.length) {
  console.error(`TYPE_LITERALS_FAIL: ${problems.length} 箇所が段から外れて数字で書かれている`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(
  `TYPE_LITERALS_OK: 6 つの型の view に字の大きさの直書きは無い（${SCOPE.length} scope）`,
);
