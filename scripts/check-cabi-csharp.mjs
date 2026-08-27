#!/usr/bin/env node
// C ABI の三者一致を照合する: Rust の #[no_mangle] extern "C"（実体）↔ C ヘッダ（宣言）↔ C# の P/Invoke。
// Windows 実機でビルドできないぶん、C# が呼ぶ境界が実体とズレていないことをここで担保する（§6 FFI contract）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUST = resolve(ROOT, 'core/astra-core/src/capi.rs');
const HEADER = resolve(ROOT, 'core/astra-core/include/astra_core.h');
const CSHARP = resolve(ROOT, 'apps/windows/Astra/CoreBridge/AstraCore.cs');

/** 引数リスト文字列 → 引数個数。"void"/"" は 0。トップレベルのカンマで数える。 */
function argCount(args) {
  const a = args.trim().replace(/,\s*$/, ''); // Rust の末尾カンマを無視
  if (a === '' || a === 'void') return 0;
  let depth = 0, count = 1;
  for (const ch of a) {
    if (ch === '(' || ch === '<') depth++;
    else if (ch === ')' || ch === '>') depth--;
    else if (ch === ',' && depth === 0) count++;
  }
  return count;
}

/** 文字列から astra_core_* の (name -> argCount) を集める。 */
function collect(text, pattern) {
  const map = new Map();
  let m;
  while ((m = pattern.exec(text)) !== null) {
    map.set(m[1], argCount(m[2]));
  }
  return map;
}

// Rust: 実体。`pub [unsafe] extern "C" fn astra_core_NAME(<args>) [-> ...]`
const rustText = readFileSync(RUST, 'utf8');
const rust = collect(
  rustText,
  /extern\s+"C"\s+fn\s+(astra_core_[a-z0-9_]+)\s*\(([^)]*)\)/gis,
);

// Header: 宣言。`<type> astra_core_NAME(<args>);`（複数行に跨るので改行を潰す）
const headerText = readFileSync(HEADER, 'utf8').replace(/\s+/g, ' ');
const header = collect(headerText, /(astra_core_[a-z0-9_]+)\s*\(([^)]*)\)/gi);

// C#: P/Invoke。`extern <type> astra_core_NAME(<args>);`
const csText = readFileSync(CSHARP, 'utf8');
const csharp = collect(
  csText,
  /extern\s+[A-Za-z0-9_<>]+\s+(astra_core_[a-z0-9_]+)\s*\(([^)]*)\)/gis,
);

const problems = [];

// Rust（実体）と Header（宣言）が一致するか。実体に無いものを宣言していないか。
for (const [name, n] of rust) {
  if (!header.has(name)) problems.push(`header に ${name} の宣言が無い（Rust には実体がある）`);
  else if (header.get(name) !== n) problems.push(`${name}: Rust 引数 ${n} 個 ≠ header ${header.get(name)} 個`);
}
for (const [name] of header) {
  if (!rust.has(name)) problems.push(`Rust に ${name} の実体が無い（header が宣言している）`);
}

// C#（呼び出し側）が header の宣言と一致するか。C# が呼ぶものが実体とズレていないか。
for (const [name, n] of csharp) {
  if (!header.has(name)) problems.push(`C# が呼ぶ ${name} が header に無い`);
  else if (header.get(name) !== n) problems.push(`${name}: C# 引数 ${n} 個 ≠ header ${header.get(name)} 個`);
  if (!rust.has(name)) problems.push(`C# が呼ぶ ${name} の実体が Rust に無い`);
}

if (problems.length > 0) {
  console.error('C ABI 三者一致に不整合:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

console.log(
  `C ABI contract ok: Rust ${rust.size} = header ${header.size}, C# が呼ぶ ${csharp.size} 個すべて一致`,
);
