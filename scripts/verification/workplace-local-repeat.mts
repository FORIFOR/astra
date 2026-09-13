/** Real, sequential Ollama calls through the production LlmRuntime.
 * No mail, browser, gateway or cloud fallback. This is NOT native-app E2E.
 * pnpm exec tsx scripts/verification/workplace-local-repeat.mts [output-dir] [runs]
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { HttpLlmClient } from '../../workers/agent-host/src/http-llm.js';
import { LlmRuntime } from '../../workers/agent-host/src/llm-steps.js';

const output = resolve(process.argv[2] ?? '/tmp/genie-workplace-repeat');
const runs = Number(process.argv[3] ?? 30);
if (!Number.isInteger(runs) || runs < 1 || runs > 30) throw new Error('runs must be 1..30');
const endpoint = 'http://127.0.0.1:11434';
const model = 'qwen3.5:9b';
const models = await fetch(`${endpoint}/api/tags`).then((r) => r.json());
const installed = models.models.find((m: { name: string }) => m.name === model);
if (!installed)
  throw new Error('Install the selected model first; no automatic download/fallback.');
await mkdir(output, { recursive: true });
// Never overwrite earlier evidence. A fresh directory is required.
try {
  await readFile(resolve(output, 'results.json'));
  throw new Error('Use a fresh output directory');
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}
const instruction =
  '以下の営業会議メモからMarkdownを作ってください。見出しは「タスク」「提案メール案」「次のアクション」の3つ。担当者と期限を残し、メールは送信前の下書きと明記してください。未提供の事実・数値を補わないでください。';
const context =
  '架空の検証用会議メモ。案件名は青葉商事の在庫照会PoC。田中が9月18日までに要件を整理。佐藤が9月20日までにデータ項目を確認。顧客の鈴木に、匿名化した在庫一覧の提供を依頼するメール案を作る。費用・導入日・効果は未確定。次回は9月22日に範囲を確認する。送信・発注・予約は行わない。';
let requests = 0;
const countedFetch: typeof fetch = async (input, init) => {
  if (String(input).endsWith('/chat/completions')) requests++;
  return fetch(input, init);
};
const client = new HttpLlmClient({
  kind: 'local',
  endpoint: `${endpoint}/v1`,
  model,
  timeoutMs: 180_000,
  maxOutputTokens: 3000,
  reasoningEffort: 'none',
  fetch: countedFetch,
});
const runtime = new LlmRuntime({ allowedKinds: ['local'], http: { local: client } });
const results: Record<string, unknown>[] = [];
const metadata = {
  startedAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  model,
  modelDigest: installed.digest,
  scope:
    'production LlmRuntime + real loopback Ollama + harness Markdown disk round-trip; not native UI, Work database, restart, cloud or human review',
  externalApiCostUsd: 0,
  costExcludes: ['hardware', 'electricity'],
  instruction,
  context,
};
await writeFile(resolve(output, 'input.json'), JSON.stringify(metadata, null, 2));
for (let i = 0; i < runs; i++) {
  const before = requests,
    started = performance.now();
  const outcome = await runtime.run({
    id: `workplace-${i + 1}`,
    toolId: 'llm.compose',
    args: { instruction, context },
    approval: null,
  });
  const durationMs = Math.round(performance.now() - started);
  const body = (outcome.result as { text?: string } | undefined)?.text ?? '';
  const path = resolve(output, `run-${String(i + 1).padStart(2, '0')}.md`);
  await writeFile(path, body);
  const restored = await readFile(path, 'utf8');
  const normalized = body.normalize('NFKC').replace(/\s+/g, '');
  const checks = {
    runtimeSucceeded: outcome.ok,
    sections: ['タスク', '提案メール案', '次のアクション'].every((s) => body.includes(s)),
    sourceFacts: ['青葉商事', '田中', '佐藤', '鈴木', '9月18日', '9月20日', '9月22日'].every((s) =>
      normalized.includes(s),
    ),
    draftClearlyLabelled: /下書き/.test(body),
    noCompletedSendClaim:
      !/送信しました|予約しました|発注しました|(?:送信|予約|発注)済み(?!ではありません)/.test(body),
    requestNotReversed:
      !/(?:送付|添付|提供)(?:いたします|します|しました|いたしました)|ご査収/.test(body),
    diskRoundTrip: body.length > 0 && restored === body,
  };
  const row = {
    run: i + 1,
    durationMs,
    requests: requests - before,
    checks,
    passed: Object.values(checks).every(Boolean),
    error: outcome.error ?? null,
    outputSha256: createHash('sha256').update(body).digest('hex'),
    file: path.split('/').at(-1),
  };
  results.push(row);
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(
      {
        ...metadata,
        completedAt: new Date().toISOString(),
        requestedRuns: runs,
        completedRuns: results.length,
        results,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(row));
  if (
    results.length >= 3 &&
    results.slice(-3).every((r) => !(r.checks as typeof checks).runtimeSucceeded)
  )
    break;
}
const passed = results.filter((r) => r.passed).length;
console.log(JSON.stringify({ completed: results.length, passed, requests }));
if (passed !== runs) process.exitCode = 1;
