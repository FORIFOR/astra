/**
 * 意味の**代役**（規則）。端末の LLM（llm.classify_email）が無いときに使う。**賢くしない。**
 * 分類は表面の手掛かり（疑問符・依頼の語・自分宛か）だけで決め、確度は低く付ける。
 */
import type { WorkArtifact, WorkSemantic } from '@astra/contracts';
import { extractDeadline } from './deadline.js';

const REQUEST =
  /(お願い|ください|いただけ|頂け|していただ|ご対応|ご確認|ご返信|お返事|返信を|承認|please|could you|can you|kindly|would you)/i;
const QUESTION = /[?？]/;
const APPROVAL = /(承認|approve|approval|決裁|サイン)/i;
const SCHEDULING = /(日程|候補日|都合|schedule|availability|いつがよ|いつ頃|何時)/i;
const WAITING = /(返信待ち|お待ちして|待ってい|pending|awaiting|waiting for)/i;

export function ruleSemantic(a: WorkArtifact, now: Date): WorkSemantic {
  const text = `${a.title}\n${a.body_excerpt ?? ''}`;
  const due = extractDeadline(text, now);
  let category: WorkSemantic['category'] = 'info';
  if (a.kind === 'task') category = 'request_to_me';
  else if (APPROVAL.test(text)) category = 'approval_pending';
  else if (SCHEDULING.test(text)) category = 'scheduling';
  else if (a.direction === 'inbound' && (REQUEST.test(text) || QUESTION.test(text)))
    category = 'request_to_me';
  else if (a.direction === 'outbound' && (REQUEST.test(text) || QUESTION.test(text)))
    category = 'request_to_other';
  else if (QUESTION.test(text)) category = 'question';
  const to = a.people.find((p) => p.role === 'to')?.name ?? null;
  const from = a.people.find((p) => p.role === 'from')?.name ?? null;
  return {
    category,
    project: a.project_hint,
    request: category === 'info' ? null : a.title.slice(0, 200),
    owner: category === 'request_to_me' ? 'me' : category === 'request_to_other' ? to : null,
    waiting_on:
      category === 'request_to_other'
        ? to
        : WAITING.test(text) && a.direction === 'outbound'
          ? to
          : WAITING.test(text) && from
            ? from
            : null,
    due: due?.at ?? null,
    confidence: 0.4,
    extracted_by: 'rule',
  };
}
