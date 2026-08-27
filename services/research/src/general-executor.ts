/**
 * General Assistant の step。正本 §2.2・§29。
 *
 * 何をする話か決まらないときの受け皿。chat lane がここへ来る。
 *
 * この executor が無かった間、`general.answer` と `general.compose` は
 * **宣言だけで実装が無く**、走らせると空の成功を返していた。
 * MVP に必須の agent が、黙って何もしない状態だった。
 *
 * ここが持つ性質は 2 つ:
 *   - **根拠を集めない仕事だと分かるように書く。**調査とは別のもの
 *   - **書くのは下書きまで。**送るのは人の操作
 */
import type { LanguageModel } from './providers.js';

interface TaskLike {
  readonly taskId: string;
  readonly tenantId: string;
  readonly input: Record<string, unknown>;
}

interface StepLike {
  readonly toolId: string;
  readonly args: Record<string, unknown>;
}

export interface GeneralExecutorResult {
  result: unknown;
  detail?: string | null;
  artifact?: { title: string; markdown: string };
}

type Executor = { execute(input: TaskLike, step: StepLike): Promise<GeneralExecutorResult> };

/** step か task か、どちらかに入っている値を読む。 */
function value(input: TaskLike, step: StepLike, key: string): string | null {
  const fromStep = step.args[key];
  if (typeof fromStep === 'string' && fromStep.trim().length > 0) return fromStep;
  const fromTask = input.input[key];
  return typeof fromTask === 'string' && fromTask.trim().length > 0 ? fromTask : null;
}

/** 題名。長い依頼をそのまま題にしない。 */
function titleOf(text: string): string {
  const firstLine = text.split('\n')[0]!.trim();
  return firstLine.length <= 40 ? firstLine : `${firstLine.slice(0, 39)}…`;
}

export function generalExecutors(model: LanguageModel): Record<string, Executor> {
  return {
    'general.answer': {
      async execute(input, step) {
        const question = value(input, step, 'question') ?? value(input, step, 'message');
        if (!question) {
          // 何を聞かれたのか分からないまま、それらしい答えを作らない
          throw new Error('there is nothing to answer');
        }
        const context = value(input, step, 'context') ?? undefined;
        const answer = await model.answer(question, context);

        return {
          result: { answered: true },
          detail: null,
          artifact: { title: titleOf(question), markdown: answer },
        };
      },
    },

    'general.compose': {
      async execute(input, step) {
        const instruction = value(input, step, 'instruction') ?? value(input, step, 'message');
        if (!instruction) throw new Error('there is nothing to write');

        const context = value(input, step, 'context') ?? undefined;
        const text = await model.compose(instruction, context);

        return {
          result: { composed: true },
          detail: null,
          artifact: {
            title: titleOf(instruction),
            // **下書きだと分かるようにする。**送ったと読まれない。
            markdown: `${text}\n\n---\n\n※ 下書きです。送信はしていません。`,
          },
        };
      },
    },
  };
}
