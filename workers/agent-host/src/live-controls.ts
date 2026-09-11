/** Control checks through the running gateway, using the provider-synced tenant. */
import type { PersonalizationProfile } from '@astra/contracts';
import type { LiveExpectationRow, LiveFixture } from './live-fixture.js';
interface TaskInput {
  taskId?: string;
  context?: string;
  context_meta?: { intent: string; selected_artifacts: number };
}
async function request<T>(base: string, token: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : path === '/v1/personalization' ? 'PUT' : 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`control check ${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}
async function ask(
  base: string,
  token: string,
  text: string,
  fixture: LiveFixture,
): Promise<TaskInput> {
  const conversation = await request<{ id: string }>(base, token, '/v1/conversations', {});
  const turn = await request<{ task_id?: string }>(
    base,
    token,
    `/v1/conversations/${conversation.id}/turns`,
    { text, reply_candidates: [{ kind: 'mail', label: fixture.mailA.subject, app: 'Mail' }] },
  );
  if (!turn.task_id) throw new Error(`no task created for control check: ${text}`);
  return {
    ...(await request<{ input: TaskInput }>(base, token, `/v1/tasks/${turn.task_id}`)).input,
    taskId: turn.task_id,
  };
}
export async function checkLiveControls(
  base: string,
  token: string,
  fixture: LiveFixture,
): Promise<LiveExpectationRow[]> {
  const rows: LiveExpectationRow[] = [];
  const record = (row: string, ok: boolean, detail: string) =>
    rows.push({ group: 'Personalization', row, ok, detail });
  const original = await request<PersonalizationProfile>(base, token, '/v1/personalization');
  const key = 'style.prefersConcise';
  const old = original.working_style.find((trait) => trait.key === key);
  const corrected = `確認用の書き方 ${fixture.nonce}`;
  try {
    await request(base, token, '/v1/personalization', {
      inference_enabled: true,
      traits: [{ key, status: 'confirmed', enabled: true, value: corrected }],
    });
    const after = await request<PersonalizationProfile>(base, token, '/v1/personalization');
    const reply = await ask(base, token, 'これ返して', fixture);
    record(
      'correction immediate',
      after.working_style.some(
        (trait) => trait.key === key && trait.value === corrected && trait.label === corrected,
      ) && Boolean(reply.context?.includes(corrected)),
      'stored value, visible label, next reply context',
    );
    await request(base, token, '/v1/personalization', { traits: [{ key, enabled: false }] });
    const disabled = await ask(base, token, 'これ返して', fixture);
    record(
      'individual OFF immediate',
      !disabled.context?.includes(corrected),
      'next reply context excludes disabled preference',
    );
    await request(base, token, '/v1/personalization', {
      inference_enabled: false,
      traits: [{ key, enabled: true }],
    });
    const off = await ask(base, token, 'これ返して', fixture);
    record(
      'all OFF immediate',
      !off.context?.includes(corrected),
      'confirmed preference remains stored but is not injected',
    );
    const coding = await ask(base, token, 'この Swift コード直して', fixture);
    record(
      'unrelated coding injection',
      !coding.context && coding.context_meta?.selected_artifacts === 0,
      'Swift request receives zero work artifacts',
    );
  } finally {
    await request(base, token, '/v1/personalization', {
      inference_enabled: original.inference_enabled,
      traits: [
        old
          ? { key, status: old.status, value: old.value, enabled: old.enabled }
          : { key, value: 0, enabled: false },
      ],
    });
  }
  return rows;
}

/** Five daily questions; the sixth (reply) is measured by the real send/receipt loop. */
export async function checkLiveDailyAnswers(
  base: string,
  token: string,
  fixture: LiveFixture,
): Promise<LiveExpectationRow[]> {
  const rows: LiveExpectationRow[] = [];
  const questions = [
    ['今日何をすべき？', 'priorities', '見積'],
    ['誰を待っている？', 'waiting', '導入'],
    ['私が返すものは？', 'owed', '見積'],
    ['次の会議を準備して', 'meeting_prep', 'Standard'],
    ['今週何がやばい？', 'priorities', '見積'],
  ] as const;
  for (const [question, intent, topic] of questions) {
    const input = await ask(base, token, `${question} 案件名と出所を含めて答えて。`, fixture);
    let answer = '';
    let status = '';
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const task = await request<{ status: string; result_artifact_id?: string }>(
        base,
        token,
        `/v1/tasks/${input.taskId}`,
      );
      status = task.status;
      if (task.status === 'COMPLETED' && task.result_artifact_id) {
        const response = await fetch(`${base}/v1/artifacts/${task.result_artifact_id}/content`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error(`daily answer artifact: HTTP ${response.status}`);
        answer = await response.text();
        break;
      }
      if (['FAILED', 'CANCELLED'].includes(task.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    rows.push({
      group: 'Daily answers',
      row: question,
      ok:
        input.context_meta?.intent === intent &&
        (input.context_meta?.selected_artifacts ?? 0) > 0 &&
        status === 'COMPLETED' &&
        answer.includes(fixture.project) &&
        answer.includes(topic),
      detail: `intent=${input.context_meta?.intent ?? '-'} status=${status} project=${answer.includes(fixture.project)} topic=${answer.includes(topic)}`,
    });
    console.log('LIVE_DAILY_ANSWER', JSON.stringify({ question, answer, context: input.context }));
  }
  const context = await request<{ priorities: { id: string; project: string }[] }>(
    base,
    token,
    '/v1/work/context',
  );
  const priority = context.priorities.find((item) => item.project === fixture.project);
  const evidence = priority
    ? await request<{ items: { id: string }[] }>(
        base,
        token,
        `/v1/work/evidence/${encodeURIComponent(priority.id)}`,
      )
    : null;
  rows.push({
    group: 'Daily answers',
    row: 'source endpoint resolves',
    ok: (evidence?.items.length ?? 0) > 0,
    detail: `one evidence request; artifacts=${evidence?.items.length ?? 0} (UI click count is separate)`,
  });
  return rows;
}
