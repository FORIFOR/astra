#!/usr/bin/env node
/**
 * 契約が変わったのに CONTRACTS_VERSION が据え置きなら落とす。実装仕様 §14.3-4。
 *
 *   node scripts/check-contracts-version.mjs <base-ref>
 *
 * base-ref を渡せないとき（履歴が浅い等）は検査を飛ばす。
 * ここは「気づかず契約を変えた」を捕まえるためのもので、
 * 検査できない状況で CI を止める価値はない。
 */
import { execFileSync } from 'node:child_process';

const base = process.argv[2];
if (!base) {
  console.log('no base ref given; skipping contracts version check');
  process.exit(0);
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

let changed;
try {
  changed = git(['diff', '--name-only', `${base}...HEAD`])
    .split('\n')
    .filter(Boolean);
} catch {
  console.log(`cannot diff against ${base}; skipping contracts version check`);
  process.exit(0);
}

const contractSources = changed.filter(
  (f) => f.startsWith('packages/contracts/src/') && f !== 'packages/contracts/src/version.ts',
);
if (contractSources.length === 0) {
  console.log('no contract changes; nothing to check');
  process.exit(0);
}

const versionOf = (text) => /CONTRACTS_VERSION = '([^']+)'/.exec(text)?.[1] ?? null;
const current = versionOf(git(['show', 'HEAD:packages/contracts/src/version.ts']));
let previous = null;
try {
  previous = versionOf(git(['show', `${base}:packages/contracts/src/version.ts`]));
} catch {
  console.log('version.ts did not exist on the base ref; skipping');
  process.exit(0);
}

if (current === previous) {
  console.error(
    `FAIL: ${contractSources.length} contract file(s) changed but CONTRACTS_VERSION is still ${current}.`,
  );
  for (const file of contractSources) console.error(`  ${file}`);
  console.error('\nBump packages/contracts/src/version.ts (see spec §3.8).');
  process.exit(1);
}

console.log(`contracts version moved ${previous} → ${current}`);
