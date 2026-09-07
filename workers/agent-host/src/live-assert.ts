/**
 * WORK_CONTEXT_LIVE_GATE: 同期を待ち、Work Context が期待した形かを機械で判定する。
 *
 *   pnpm exec tsx workers/agent-host/src/live-assert.ts <base-url> <access-token> <seeded.json> [timeout-s]
 */
import { readFile } from 'node:fs/promises';
import type { WorkContext, WorkSyncState } from '@astra/contracts';
import { checkLiveExpectations, type LiveFixture } from './live-fixture.js';

async function get<T>(base: string, token: string, path: string): Promise<T> {
  const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${path} → ${String(res.status)}`);
  return (await res.json()) as T;
}

async function main(): Promise<void> {
  const [base, token, seededFile, timeoutArg] = process.argv.slice(2);
  if (!base || !token || !seededFile)
    throw new Error('usage: live-assert.ts <base> <token> <seeded.json> [timeout-s]');
  const seeded = JSON.parse(await readFile(seededFile, 'utf8')) as {
    fixture: LiveFixture;
    google?: unknown;
    microsoft?: unknown;
  };
  const wanted = [
    ...(seeded.google ? ['gmail', 'google_calendar'] : []),
    ...(seeded.microsoft ? ['outlook_mail', 'outlook_calendar', 'microsoft_todo'] : []),
  ];
  const deadline = Date.now() + Number(timeoutArg ?? 180) * 1000;
  let synced: WorkSyncState[] = [];
  while (Date.now() < deadline) {
    synced = (await get<{ items: WorkSyncState[] }>(base, token, '/v1/work/sync')).items;
    const done = wanted.every((s) =>
      synced.some((st) => st.source === s && st.last_synced_at && st.artifact_count > 0),
    );
    if (done) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  for (const s of wanted) {
    const st = synced.find((x) => x.source === s);
    console.log(
      `  sync ${s.padEnd(18)} ${st?.last_synced_at ? 'synced' : 'NOT_SYNCED'} artifacts=${String(st?.artifact_count ?? 0)} error=${st?.last_error ?? '-'}`,
    );
  }
  const context = await get<WorkContext>(base, token, '/v1/work/context');
  const rows = checkLiveExpectations(context, seeded.fixture, new Date());
  for (const r of rows) console.log(`  ${r.row.padEnd(20)} ${r.ok ? 'PASS' : 'FAIL'}  ${r.detail}`);
  const allSynced = wanted.every((s) => synced.some((st) => st.source === s && st.last_synced_at));
  const ok = allSynced && rows.every((r) => r.ok);
  console.log(`WORK_CONTEXT_LIVE_GATE=${ok ? 'PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(
    `WORK_CONTEXT_LIVE_GATE=FAIL ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
