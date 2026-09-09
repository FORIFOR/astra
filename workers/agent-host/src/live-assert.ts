/**
 * DAILY_WORK_LIVE: 同期 → Home → 「これ返して」（実 draft → 確認の代わりの承認 → sink へ実送信）→ 会議のループ → 次の brief。
 *
 *   pnpm exec tsx workers/agent-host/src/live-assert.ts <base-url> <access-token> <seeded.json> [timeout-s]
 *
 * ここでの「確認」は harness が押す（本人の代わり）。**送るのは承認を通してだけ**で、経路は本番と同じ
 * （POST /v1/work/reply/send → 承認 → 端末の worker → provider）。送り先は fixture の sink（identity 自身）。
 */
import { TokenStore } from '@astra/oauth';
import { FileSecretStore } from './keychain.js';
import { saveLiveWriteGrant } from './live-oauth.js';
import { readFile, writeFile, rename } from 'node:fs/promises';
import type { MeetingBrief, WorkContext, WorkSyncState } from '@astra/contracts';
import {
  checkBrief,
  checkHome,
  checkReply,
  syntheticMeetingArtifacts,
  type LiveExpectationRow,
  type LiveFixture,
} from './live-fixture.js';
import { checkLiveControls, checkLiveDailyAnswers } from './live-controls.js';
import { observeReplies, checkReceipt } from './live-receipt.js';

interface Seeded {
  provider: 'google' | 'microsoft';
  fixture: LiveFixture;
  self: string;
  sink: string;
  messages: string[];
}

async function call<T>(
  base: string,
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitTask(
  base: string,
  token: string,
  taskId: string,
  timeoutMs: number,
): Promise<{
  status: string;
  result_artifact_id: string | null;
  error: { code?: string; message?: string } | null;
}> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const { body } = await call<{
      status: string;
      result_artifact_id: string | null;
      error: { code?: string; message?: string } | null;
    }>(base, token, `/v1/tasks/${taskId}`);
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(body.status) || Date.now() > until)
      return body;
    await sleep(1500);
  }
}

async function main(): Promise<void> {
  const [base, token, seededFile, timeoutArg] = process.argv.slice(2);
  if (!base || !token || !seededFile)
    throw new Error('usage: live-assert.ts <base> <token> <seeded.json> [timeout-s]');
  const seeded = JSON.parse(await readFile(seededFile, 'utf8')) as Seeded;
  const f = seeded.fixture;
  const wanted =
    seeded.provider === 'google'
      ? ['gmail', 'google_calendar']
      : ['outlook_mail', 'outlook_calendar'];
  const rows: LiveExpectationRow[] = [];
  const responseLoss = process.env['ASTRA_LIVE_FAULT_MODE'] === 'send-response-loss';
  const now = new Date();

  // 1. 同期を待つ
  const deadline = Date.now() + Number(timeoutArg ?? 240) * 1000;
  let synced: WorkSyncState[] = [];
  while (Date.now() < deadline) {
    synced = (await call<{ items: WorkSyncState[] }>(base, token, '/v1/work/sync')).body.items;
    if (
      wanted.every((s) =>
        synced.some((st) => st.source === s && st.last_synced_at && st.artifact_count > 0),
      )
    )
      break;
    await sleep(3000);
  }
  for (const s of wanted) {
    const st = synced.find((x) => x.source === s);
    rows.push({
      group: 'Sync',
      row: s,
      ok: Boolean(st?.last_synced_at),
      detail: `artifacts=${String(st?.artifact_count ?? 0)} error=${st?.last_error ?? '-'}`,
    });
  }
  console.log('LIVE_SYNC', JSON.stringify(rows));

  // 2. 会議 1 の結論を Work Graph へ（実の finalize と同じ publisher の形。音声の代わりに bundle）
  const meetingArts = syntheticMeetingArtifacts(f, now.toISOString());
  const pub = await call(base, token, '/v1/work/artifacts', {
    method: 'POST',
    body: { source: 'meeting', cursor: null, watermark: null, artifacts: meetingArts },
  });
  rows.push({
    group: 'Meeting loop',
    row: 'decision artifact exists',
    ok: pub.status === 202,
    detail: `POST /v1/work/artifacts → ${String(pub.status)}`,
  });
  rows.push({
    group: 'Meeting loop',
    row: 'action artifact exists',
    ok: pub.status === 202,
    detail: meetingArts.map((a) => a.id).join(', '),
  });

  // 3. Home
  const context = (await call<WorkContext>(base, token, '/v1/work/context')).body;
  rows.push(...checkHome(context, f, now));

  rows.push(...(await checkLiveControls(base, token, f)));
  rows.push(...(await checkLiveDailyAnswers(base, token, f)));

  // Diagnostic scope ends before creating any send task or loading a write grant.
  if (process.env['ASTRA_LIVE_READ_DIAGNOSTIC'] === '1') {
    const brief = await call<MeetingBrief | null>(base, token, '/v1/work/brief/next');
    rows.push(...checkBrief(brief.status === 200 ? brief.body : null, f));
    for (const row of rows) console.log('LIVE_READ_ROW', JSON.stringify(row));
    const ok = rows.every((row) => row.ok);
    console.log(
      `${seeded.provider.toUpperCase()}_READ_DIAGNOSTIC_ASSERTIONS=${ok ? 'PASS' : 'FAIL'}`,
    );
    process.exit(ok ? 0 : 1);
  }

  // 4. 「これ返して」: 開いているメール = Mail A の題名 → 実 draft（端末の LLM）→ 承認 → 送る
  let target: { subject: string; thread_id: string | null } | null = null;
  let draft: string | null = null;
  let contextText: string | null = null;
  let sinkHit: boolean | null = null;
  const conv = (
    await call<{ id: string }>(base, token, '/v1/conversations', { method: 'POST', body: {} })
  ).body.id;
  const turn = await call<{
    task_id: string | null;
    reply?: {
      target: {
        subject: string;
        thread_id: string | null;
        external_id: string;
        to: { email: string | null } | null;
        source: string;
      };
    };
    needs_clarification: boolean;
  }>(base, token, `/v1/conversations/${conv}/turns`, {
    method: 'POST',
    body: {
      text: 'これ返して',
      reply_candidates: [{ kind: 'mail', label: f.mailA.subject, app: 'Mail' }],
    },
  });
  if (turn.body.reply && turn.body.task_id) {
    target = turn.body.reply.target;
    const task = await waitTask(base, token, turn.body.task_id, 180_000);
    const full = await call<{ input: { context?: string } }>(
      base,
      token,
      `/v1/tasks/${turn.body.task_id}`,
    );
    contextText = full.body.input.context ?? null;
    if (task.status === 'COMPLETED' && task.result_artifact_id) {
      const art = await fetch(`${base}/v1/artifacts/${task.result_artifact_id}/content`, {
        headers: { authorization: `Bearer ${token}` },
      });
      draft = (await art.text()).replace(/\n\n---\n\n※ 下書きです。送信はしていません。/, '');
    }
    if (draft) {
      // 本人が確認カードで「送る」を押した、に相当（harness が押す）。経路は本番と同じ。
      const replySubject = target.subject.startsWith('Re:')
        ? target.subject
        : `Re: ${target.subject}`;
      const replyBody = `${draft}\n\n[live ${f.nonce}]`;
      const send = await call<{ task_id: string }>(base, token, '/v1/work/reply/send', {
        method: 'POST',
        body: {
          source: turn.body.reply.target.source,
          to: [seeded.sink],
          subject: replySubject,
          body: replyBody,
          in_reply_to: turn.body.reply.target.external_id,
          thread_id: target.thread_id,
        },
      });
      const sendTask = send.body.task_id;
      let approvalAccepted = false;
      for (let i = 0; i < 60; i += 1) {
        const ap = await call<{ items: { id: string }[] }>(
          base,
          token,
          `/v1/tasks/${sendTask}/approvals`,
        );
        const first = ap.body.items[0];
        if (first) {
          const before = await observeReplies(seeded.provider, f.nonce, f.project);
          rows.push({
            group: 'Reply',
            row: 'unapproved provider effects',
            ok: before.length === 0,
            detail: `messages=${before.length}`,
          });
          if (before.length !== 0) throw new Error('provider effects occurred before approval');
          const storeFile = process.env['ASTRA_SECRET_STORE_FILE'];
          if (!storeFile) throw new Error('dedicated live credential store missing');
          await saveLiveWriteGrant(
            seeded.provider,
            new TokenStore(new FileSecretStore(storeFile)),
            seeded.self,
          );
          const approved = await call(base, token, `/v1/tasks/${sendTask}/approve`, {
            method: 'POST',
            body: { approval_id: first.id, decision: 'APPROVED' },
          });
          approvalAccepted = approved.status >= 200 && approved.status < 300;
          break;
        }
        const st = await call<{ status: string }>(base, token, `/v1/tasks/${sendTask}`);
        if (['FAILED', 'COMPLETED', 'CANCELLED'].includes(st.body.status)) break;
        await sleep(1000);
      }
      rows.push({
        group: 'Reply',
        row: 'external approval accepted',
        ok: approvalAccepted,
        detail: approvalAccepted
          ? 'approval observed and accepted by API'
          : 'missing or rejected approval',
      });
      const done = await waitTask(base, token, sendTask, 120_000);
      rows.push({
        group: 'Reply',
        row: responseLoss ? 'ambiguous send stopped' : 'send task completed',
        ok: done.status === (responseLoss ? 'FAILED' : 'COMPLETED'),
        detail: `${done.status} ${done.error?.code ?? ''} ${done.error?.message ?? ''}`.trim(),
      });
      if (done.status === 'COMPLETED' || responseLoss) {
        let observed: Awaited<ReturnType<typeof observeReplies>> = [];
        for (let attempt = 0; attempt < 12; attempt += 1) {
          observed = await observeReplies(seeded.provider, f.nonce, f.project);
          // Record every observed effect, including wrong replies and duplicates, for cleanup.
          const journal = JSON.parse(await readFile(seededFile, 'utf8')) as { messages: string[] };
          journal.messages = [
            ...new Set([...journal.messages, ...observed.map((mail) => mail.id)]),
          ];
          await writeFile(`${seededFile}.tmp`, JSON.stringify(journal, null, 2), { mode: 0o600 });
          await rename(`${seededFile}.tmp`, seededFile);
          sinkHit = checkReceipt(observed, {
            subject: replySubject,
            body: replyBody,
            to: seeded.sink,
            thread: (target.thread_id ?? '').replace(
              seeded.provider === 'google' ? /^gmail:/ : /^outlook_mail:/,
              '',
            ),
            nonce: f.nonce,
          });
          if (sinkHit) break;
          await sleep(5000);
        }
      } else {
        sinkHit = false;
      }
    }
  } else {
    rows.push({
      group: 'Reply',
      row: 'turn resolved a reply target',
      ok: false,
      detail: JSON.stringify(turn.body).slice(0, 200),
    });
  }
  rows.push(...checkReply({ target, context: contextText, draft, sinkHit }, f));
  if (responseLoss) {
    const log = process.env['ASTRA_LIVE_FAULT_LOG'];
    const evidence = log
      ? (JSON.parse(
          await readFile(log, 'utf8').catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return 'null';
            throw error;
          }),
        ) as { attempts: number; accepted: number } | null)
      : null;
    rows.push({
      group: 'Recovery',
      row: 'accepted once / no retry',
      ok: evidence?.attempts === 1 && evidence.accepted === 1 && sinkHit === true,
      detail: `attempts=${evidence?.attempts ?? 0} accepted=${evidence?.accepted ?? 0} exactReceipt=${sinkHit}`,
    });
  }

  // 5. 次の brief（会議 2）
  const brief = await call<MeetingBrief | null>(base, token, '/v1/work/brief/next');
  rows.push(...checkBrief(brief.status === 200 ? brief.body : null, f));

  for (const r of rows)
    console.log(
      `  ${r.group.padEnd(13)} ${r.row.padEnd(34)} ${r.ok ? 'PASS' : 'FAIL'}  ${r.detail}`,
    );
  const ok = rows.every((r) => r.ok);
  const name = responseLoss
    ? `${seeded.provider.toUpperCase()}_CONNECTOR_RESPONSE_LOSS_LIVE`
    : seeded.provider === 'google'
      ? 'GOOGLE_DAILY_WORK_LIVE'
      : 'MICROSOFT_DAILY_WORK_LIVE';
  console.log(
    `${name}${process.env['ASTRA_LIVE_ASSERT_PHASE_ONLY'] === '1' ? '_ASSERTIONS' : ''}=${ok ? 'PASS' : 'FAIL'}`,
  );
  process.exit(ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`DAILY_WORK_LIVE=FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
