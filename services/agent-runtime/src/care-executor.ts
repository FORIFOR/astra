/**
 * Care Support の step を task-service へ差し込む。正本 §15.4。
 *
 * **判断はしない。**記録を並べ、下書きを作り、足りない欄を数えるところまで。
 * 書き込みは CARE profile の規則で確認と読み上げを通る（policy 側の仕事）。
 */
import { AstraError } from '@astra/contracts';
import type { DomainService } from './domain.js';
import { handoffSummary, incidentDraft, reviewsDue, toShiftNote } from './care.js';

const CARE_PLUGIN = 'com.astra.care';

interface TaskLike {
  readonly taskId: string;
  readonly tenantId: string;
  readonly input: Record<string, unknown>;
}

interface StepLike {
  readonly toolId: string;
  readonly args: Record<string, unknown>;
}

export interface CareExecutorResult {
  result: unknown;
  detail?: string | null;
  artifact?: { title: string; markdown: string };
}

type Executor = { execute(input: TaskLike, step: StepLike): Promise<CareExecutorResult> };

function argOf(input: TaskLike, step: StepLike, key: string): string | null {
  const fromStep = step.args[key];
  if (typeof fromStep === 'string' && fromStep.length > 0) return fromStep;
  const fromTask = input.input[key];
  return typeof fromTask === 'string' && fromTask.length > 0 ? fromTask : null;
}

export function careExecutors(
  domain: DomainService,
  now: () => Date = () => new Date(),
): Record<string, Executor> {
  const nameOf = async (tenantId: string, id: unknown): Promise<string> => {
    if (typeof id !== 'string' || id.length === 0) return '不明';
    const entity = await domain.get(tenantId, id).catch(() => null);
    return entity ? String(entity.fields['name'] ?? '不明') : '不明';
  };

  return {
    'care.handoff': {
      async execute(input, step) {
        const shift = argOf(input, step, 'shift');
        const entities = await domain.list(input.tenantId, CARE_PLUGIN, 'shift_note', 500);
        const wanted = shift ? entities.filter((e) => e.fields['shift'] === shift) : entities;

        const notes = await Promise.all(
          wanted.map(async (entity) =>
            toShiftNote(entity, await nameOf(input.tenantId, entity.fields['resident'])),
          ),
        );

        return {
          result: { notes: notes.length },
          detail: `${notes.length} 件の記録`,
          artifact: {
            title: shift ? `申し送り（${shift}）` : '申し送り',
            markdown: handoffSummary(notes),
          },
        };
      },
    },

    'care.plan_review': {
      async execute(input) {
        const plans = await domain.list(input.tenantId, CARE_PLUGIN, 'care_plan', 500);
        const resolved = await Promise.all(
          plans.map(async (plan) => ({
            title: String(plan.fields['title'] ?? '無題'),
            residentName: await nameOf(input.tenantId, plan.fields['resident']),
            reviewDue:
              typeof plan.fields['review_due'] === 'string' ? plan.fields['review_due'] : null,
          })),
        );
        const due = reviewsDue(resolved, now());

        const lines = [
          '# 見直しの時期',
          '',
          ...(due.length === 0
            ? ['当面の見直しはありません。']
            : due.map((d) =>
                d.dueAt === null
                  ? `- ${d.residentName}「${d.title}」**期日が入っていません**`
                  : `- ${d.residentName}「${d.title}」残り ${d.daysLeft} 日`,
              )),
        ];

        return {
          result: { due: due.length },
          detail: `${due.length} 件`,
          artifact: { title: '見直しの時期', markdown: lines.join('\n') },
        };
      },
    },

    'care.incident_draft': {
      async execute(input, step) {
        const incidentId = argOf(input, step, 'incident_id');
        if (!incidentId) {
          throw new AstraError('common.validation_failed', 'どの記録の下書きかの指定が要ります');
        }
        const entity = await domain.get(input.tenantId, incidentId);
        const draft = incidentDraft(
          entity,
          await nameOf(input.tenantId, entity.fields['resident']),
        );

        return {
          result: { missing: draft.missing.length },
          // 足りない欄の数を進捗に出す。**足りていることにしない。**
          detail: draft.missing.length === 0 ? '記入済み' : `未記入 ${draft.missing.length} 件`,
          artifact: { title: '事故報告の下書き', markdown: draft.markdown },
        };
      },
    },
  };
}
