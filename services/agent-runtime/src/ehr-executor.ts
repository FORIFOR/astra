/**
 * EHR の step を task-service へ差し込む。正本 §15.5。
 *
 * **下書きが線を越えていたら、残さずに止める。**
 * 「診断/治療を自律決定しない」は、書いたあとで人が消す約束ではなく、
 * そもそも作らない約束として実装する。
 */
import { AstraError } from '@astra/contracts';
import type { DomainService } from './domain.js';
import {
  checkDraft,
  citedLines,
  encounterSummary,
  extract,
  extractionTable,
  toClinicalNote,
} from './ehr.js';

const EHR_PLUGIN = 'com.astra.ehr';

interface TaskLike {
  readonly taskId: string;
  readonly tenantId: string;
  readonly input: Record<string, unknown>;
}

interface StepLike {
  readonly toolId: string;
  readonly args: Record<string, unknown>;
}

export interface EhrExecutorResult {
  result: unknown;
  detail?: string | null;
  artifact?: { title: string; markdown: string };
}

type Executor = { execute(input: TaskLike, step: StepLike): Promise<EhrExecutorResult> };

function argOf(input: TaskLike, step: StepLike, key: string): string | null {
  const fromStep = step.args[key];
  if (typeof fromStep === 'string' && fromStep.length > 0) return fromStep;
  const fromTask = input.input[key];
  return typeof fromTask === 'string' && fromTask.length > 0 ? fromTask : null;
}

export function ehrExecutors(domain: DomainService): Record<string, Executor> {
  const notesOf = async (tenantId: string, encounterId: string) =>
    (await domain.linked(tenantId, encounterId, 'clinical_note')).map(toClinicalNote);

  const requireEncounter = (input: TaskLike, step: StepLike): string => {
    const id = argOf(input, step, 'encounter_id');
    if (!id) throw new AstraError('common.validation_failed', 'どの受診かの指定が要ります');
    return id;
  };

  return {
    'ehr.search': {
      async execute(input, step) {
        const query = (argOf(input, step, 'query') ?? '').trim();
        if (query.length === 0) {
          throw new AstraError('common.validation_failed', '探す言葉の指定が要ります');
        }

        // **その利用者が既に見られる記録の中だけ**を探す（RLS がテナントを絞る）
        const notes = (await domain.list(input.tenantId, EHR_PLUGIN, 'clinical_note', 500)).map(
          toClinicalNote,
        );
        const hits = notes.filter(
          (note) => note.title.includes(query) || note.body.includes(query),
        );

        const lines = hits.map((note) => `- ${note.title}（${note.id}）`);
        return {
          result: { hits: hits.length },
          detail: `${hits.length} 件`,
          artifact: {
            title: `「${query}」の記録`,
            markdown:
              hits.length === 0
                ? `「${query}」を含む記録は見つかりませんでした。`
                : ['# 見つかった記録', '', ...lines].join('\n'),
          },
        };
      },
    },

    'ehr.encounter_summary': {
      async execute(input, step) {
        const encounterId = requireEncounter(input, step);
        const notes = await notesOf(input.tenantId, encounterId);
        return {
          result: { notes: notes.length },
          detail: `${notes.length} 件の記録`,
          artifact: { title: '受診の記録', markdown: encounterSummary(notes) },
        };
      },
    },

    'ehr.extract': {
      async execute(input, step) {
        const encounterId = requireEncounter(input, step);
        const notes = await notesOf(input.tenantId, encounterId);
        const rows = extract(notes);
        const found = rows.filter((row) => row.value !== null).length;

        return {
          result: { found, total: rows.length },
          // 見つかった数を出す。**全部埋まったことにしない。**
          detail: `${found}/${rows.length} 項目`,
          artifact: { title: '取り出した値', markdown: extractionTable(rows) },
        };
      },
    },

    'ehr.draft_note': {
      async execute(input, step) {
        const encounterId = requireEncounter(input, step);
        const draft = argOf(input, step, 'draft');
        if (!draft) throw new AstraError('common.validation_failed', '下書きの本文が要ります');

        const notes = await notesOf(input.tenantId, encounterId);
        const check = checkDraft(draft, citedLines(notes));
        if (!check.ok) {
          /*
           * **残さずに止める。**「診断/治療を自律決定しない」は、
           * 書いたあとで人が消す約束ではない。
           */
          throw new AstraError(
            'common.validation_failed',
            `この下書きには、記録に無い診断・治療の判断が含まれています: ${check.problems.join(' / ')}`,
          );
        }

        return {
          result: { lines: draft.split('\n').filter((l) => l.trim().length > 0).length },
          detail: null,
          artifact: {
            title: '記録の下書き',
            markdown: [draft, '', '※ 下書きです。署名と記録への反映は人が行います。'].join('\n'),
          },
        };
      },
    },
  };
}
