/**
 * Architecture の step を task-service へ差し込む。正本 §15.6。
 *
 * **どちらの版が正しいかを決めない。**新しい版があることは言う。
 */
import { AstraError } from '@astra/contracts';
import type { DomainService } from './domain.js';
import {
  issueGaps,
  latestRevisions,
  openRfis,
  rfiProblems,
  toRevision,
  toRfi,
} from './architecture.js';

const ARCH_PLUGIN = 'com.astra.architecture';

interface TaskLike {
  readonly taskId: string;
  readonly tenantId: string;
  readonly input: Record<string, unknown>;
}

interface StepLike {
  readonly toolId: string;
  readonly args: Record<string, unknown>;
}

export interface ArchExecutorResult {
  result: unknown;
  detail?: string | null;
  artifact?: { title: string; markdown: string };
}

type Executor = { execute(input: TaskLike, step: StepLike): Promise<ArchExecutorResult> };

function argOf(input: TaskLike, step: StepLike, key: string): string | null {
  const fromStep = step.args[key];
  if (typeof fromStep === 'string' && fromStep.length > 0) return fromStep;
  const fromTask = input.input[key];
  return typeof fromTask === 'string' && fromTask.length > 0 ? fromTask : null;
}

export function architectureExecutors(
  domain: DomainService,
  now: () => Date = () => new Date(),
): Record<string, Executor> {
  const nameOf = async (tenantId: string, id: string): Promise<string> => {
    const entity = await domain.get(tenantId, id).catch(() => null);
    return entity ? String(entity.fields['name'] ?? id) : id;
  };

  return {
    'arch.revisions': {
      async execute(input) {
        const revisions = (await domain.list(input.tenantId, ARCH_PLUGIN, 'revision', 1_000)).map(
          toRevision,
        );
        const latest = latestRevisions(revisions);

        const lines: string[] = ['# 最新の図面', ''];
        for (const drawing of latest) {
          const name = await nameOf(input.tenantId, drawing.drawingId);
          if (drawing.revisions.length === 0) {
            // どれが最新かは言えない。言えないと書く。
            lines.push(`- ${name}: **発行日が入っていないため、最新が決められません**`);
            continue;
          }
          const labels = drawing.revisions.map((r) => r.label).join('・');
          lines.push(
            drawing.ambiguous
              ? // **どちらを使うべきかは人が決める**
                `- ${name}: ${labels}（同じ日に複数あります。どれを使うかご確認ください）`
              : `- ${name}: ${labels}`,
          );
          if (drawing.undated.length > 0) {
            lines.push(`  - 発行日なし: ${drawing.undated.map((r) => r.label).join('・')}`);
          }
        }

        return {
          result: { drawings: latest.length },
          detail: `${latest.length} 図面`,
          artifact: { title: '最新の図面', markdown: lines.join('\n') },
        };
      },
    },

    'arch.open_issues': {
      async execute(input) {
        const rfis = (await domain.list(input.tenantId, ARCH_PLUGIN, 'rfi', 500)).map(toRfi);
        const issues = await domain.list(input.tenantId, ARCH_PLUGIN, 'arch_issue', 500);
        const open = openRfis(rfis, now());
        const gaps = issueGaps(issues);

        const lines = [
          '# 未回答の質疑',
          '',
          ...(open.length === 0
            ? ['未回答の質疑はありません。']
            : open.map((r) =>
                r.daysLeft === null
                  ? `- ${r.question} **期限が入っていません**`
                  : r.daysLeft < 0
                    ? `- ${r.question}（${-r.daysLeft} 日超過）`
                    : `- ${r.question}（残り ${r.daysLeft} 日）`,
              )),
          '',
          '# 担当か期限が抜けている課題',
          '',
          ...(gaps.length === 0
            ? ['ありません。']
            : gaps.map((i) => `- ${i.title}（${i.missing.join('・')}が未記入）`)),
        ];

        return {
          result: { rfis: open.length, issues: gaps.length },
          detail: `質疑 ${open.length} 件`,
          artifact: { title: '未回答と未記入', markdown: lines.join('\n') },
        };
      },
    },

    'arch.rfi_draft': {
      async execute(input, step) {
        const question = argOf(input, step, 'question');
        if (question === null) {
          throw new AstraError('common.validation_failed', '質疑の本文が要ります');
        }
        const problems = rfiProblems(question);
        if (problems.length > 0) {
          // 出せない理由を先に全部言う
          throw new AstraError('common.validation_failed', problems.join(' / '));
        }

        return {
          result: { drafted: true },
          detail: null,
          artifact: {
            title: '質疑の下書き',
            markdown: [question.trim(), '', '※ 下書きです。送るのは人の操作です。'].join('\n'),
          },
        };
      },
    },
  };
}
