#!/usr/bin/env node
/**
 * Sales CRM の entity 定義を plugin の schemas へ書き出す。
 *
 * **TS 側を正本にする。**手で写すと必ずずれ、ずれた瞬間に
 * 「定義に無い項目」として弾かれるようになる。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SALES_CRM_ENTITIES } from '../services/agent-runtime/dist/sales-crm.js';

const out = fileURLToPath(
  new URL('../plugins/builtin/sales-crm/schemas/entities.json', import.meta.url),
);
const expected = `${JSON.stringify({ entities: Object.values(SALES_CRM_ENTITIES) }, null, 2)}\n`;

if (process.argv.includes('--check')) {
  let actual = '';
  try {
    actual = readFileSync(out, 'utf8');
  } catch {
    /* 無ければ下で落ちる */
  }
  if (actual !== expected) {
    console.error(
      'FAIL: plugins/builtin/sales-crm/schemas/entities.json is stale. ' +
        'Run: node scripts/gen-crm-entities.mjs',
    );
    process.exit(1);
  }
  console.log('sales-crm entity definitions are current');
} else {
  writeFileSync(out, expected);
  console.log(`wrote ${out}`);
}
