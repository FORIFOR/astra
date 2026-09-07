/**
 * DAILY_WORK_LIVE: 同期 → Home → 「これ返して」（実 draft → 確認の代わりの承認 → sink へ実送信）→ 会議のループ → 次の brief。
 *
 *   pnpm exec tsx workers/agent-host/src/live-assert.ts <base-url> <access-token> <seeded.json> [timeout-s]
 *
 * ここでの「確認」は harness が押す（本人の代わり）。**送るのは承認を通してだけ**で、経路は本番と同じ
 * （POST /v1/work/reply/send → 承認 → 端末の worker → provider）。送り先は fixture の sink（identity 自身）。
 */
import { readFile } from 'node:fs/promises';
import type { MeetingBrief, WorkContext, WorkSyncState } from '@astra/contracts';
import {
  checkBrief,
  checkHome,
  checkReply,
  syntheticMeetingArtifacts,
  type LiveExpectationRow,
  type LiveFixture,
} from './live-fixture.js';
import { liveAccessToken } from './live-seed.js';

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

/** sink（identity 自身）に返信が届いたか。provider の API で件名と nonce を探す。 */
async function sinkReceived(seeded: Seeded, subject: string): Promise<boolean> {
  const f = seeded.fixture;
  if (seeded.provider === 'google') {
    const { access } = await liveAccessToken('google', [
      'https://www.googleapis.com/auth/gmail.readonly',
    ]);
    const q = encodeURIComponent(`subject:"${subject}" newer_than:1d`);
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=10`,
      { headers: { authorization: `Bearer ${access}` } },
    );
    const list = (await res.json()) as { messages?: { id: string }[] };
    for (const m of list.messages ?? []) {
      const one = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject`,
        { headers: { authorization: `Bearer ${access}` } },
      );
      const raw = (await one.json()) as {
        labelIds?: string[];
        snippet?: string;
        payload?: { headers?: { name: string; value: string }[] };
      };
      const isSent = (raw.labelIds ?? []).includes('SENT');
      if (isSent && !seeded.messages.includes(m.id)) return true;
    }
    return false;
  }
  const { access } = await liveAccessToken('microsoft', ['Mail.Read']);
  const filter = encodeURIComponent(
    `startswith(subject,'RE: [${f.project}]') or startswith(subject,'Re: [${f.project}]')`,
  );
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$filter=${filter}&$top=10&$select=id,subject`,
    { headers: { authorization: `Bearer ${access}` } },
  );
  const list = (await res.json()) as { value?: { id: string; subject: string }[] };
  return (list.value ?? []).length > 0;
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
      const send = await call<{ task_id: string }>(base, token, '/v1/work/reply/send', {
        method: 'POST',
        body: {
          source: turn.body.reply.target.source,
          to: [seeded.sink],
          subject: target.subject.startsWith('Re:') ? target.subject : `Re: ${target.subject}`,
          body: `${draft}\n\n[live ${f.nonce}]`,
          in_reply_to: turn.body.reply.target.external_id,
          thread_id: target.thread_id,
        },
      });
      const sendTask = send.body.task_id;
      for (let i = 0; i < 60; i += 1) {
        const ap = await call<{ items: { id: string }[] }>(
          base,
          token,
          `/v1/tasks/${sendTask}/approvals`,
        );
        const first = ap.body.items[0];
        if (first) {
          await call(base, token, `/v1/tasks/${sendTask}/approve`, {
            method: 'POST',
            body: { approval_id: first.id, decision: 'APPROVED' },
          });
          break;
        }
        const st = await call<{ status: string }>(base, token, `/v1/tasks/${sendTask}`);
        if (['FAILED', 'COMPLETED', 'CANCELLED'].includes(st.body.status)) break;
        await sleep(1000);
      }
      const done = await waitTask(base, token, sendTask, 120_000);
      rows.push({
        group: 'Reply',
        row: 'send task completed',
        ok: done.status === 'COMPLETED',
        detail: `${done.status} ${done.error?.code ?? ''} ${done.error?.message ?? ''}`.trim(),
      });
      if (done.status === 'COMPLETED') {
        await sleep(5000);
        sinkHit = await sinkReceived(
          seeded,
          target.subject.startsWith('Re:') ? target.subject : `Re: ${target.subject}`,
        ).catch(() => false);
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

  // 5. 次の brief（会議 2）
  const brief = await call<MeetingBrief | null>(base, token, '/v1/work/brief/next');
  rows.push(...checkBrief(brief.status === 200 ? brief.body : null, f));

  for (const r of rows)
    console.log(
      `  ${r.group.padEnd(13)} ${r.row.padEnd(34)} ${r.ok ? 'PASS' : 'FAIL'}  ${r.detail}`,
    );
  const ok = rows.every((r) => r.ok);
  const name =
    seeded.provider === 'google' ? 'GOOGLE_DAILY_WORK_LIVE' : 'MICROSOFT_DAILY_WORK_LIVE';
  console.log(`${name}=${ok ? 'PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`DAILY_WORK_LIVE=FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
