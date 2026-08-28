#!/usr/bin/env node
// 最終製品経路（macOS native app + astra-core）が Tauri に依存していないことを機械で担保する（Done#8）。
// native app が Tauri/apps-desktop/AppHandle/WebviewWindow を参照したら fail。
// core が tauri crate に依存したら fail。既存 Tauri アプリ(apps/desktop)は参照側なので対象外（§7: 残置）。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, exts) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

const problems = [];

// コメントを外してから実コードだけを見る（"Tauri を介さない" のような説明コメントは依存ではない）。
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // ブロックコメント
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '')) // 行コメント / ドキュメントコメント
    .join('\n');
}

// 1) native app の Swift に「実コードとしての」Tauri 依存が無いこと。
//    import Tauri / WebviewWindow / AppHandle / apps-desktop パス参照 は依存。
const FORBIDDEN = [
  /\bimport\s+Tauri\b/,
  /\bWebviewWindow\b/,
  /\bAppHandle\b/,
  /apps\/desktop/,
  /src-tauri/,
];
const swiftFiles = walk(resolve(ROOT, 'apps/astra-macos/Sources'), ['.swift']);
for (const f of swiftFiles) {
  const code = stripComments(readFileSync(f, 'utf8'));
  for (const pat of FORBIDDEN) {
    if (pat.test(code)) {
      problems.push(`${f.replace(ROOT + '/', '')}: 最終製品経路が Tauri を参照している (${pat})`);
    }
  }
}

// Package.swift が Tauri を link/依存していないこと。
const pkg = readFileSync(resolve(ROOT, 'apps/astra-macos/Package.swift'), 'utf8');
if (/tauri/i.test(stripComments(pkg))) {
  problems.push('apps/astra-macos/Package.swift: Tauri を参照している');
}

// 2) astra-core が tauri crate に依存していないこと。
const coreCargo = readFileSync(resolve(ROOT, 'core/astra-core/Cargo.toml'), 'utf8');
if (/^\s*tauri\s*=/m.test(coreCargo) || /\btauri-/.test(coreCargo)) {
  problems.push('core/astra-core/Cargo.toml: astra-core が tauri に依存している');
}

if (problems.length > 0) {
  console.error('最終製品経路に Tauri 依存が見つかった (Done#8 違反):');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

console.log(
  `native product path is Tauri-free: ${swiftFiles.length} Swift files + astra-core に Tauri 依存なし (Done#8)`,
);
