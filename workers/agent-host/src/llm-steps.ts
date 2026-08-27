/**
 * 端末で言語モデルの依頼を走らせる。正本 §8・§21、UI/UX §22。
 *
 * cloud から来るのは問いだけ。**どの利用権で答えるかは端末が決める。**
 *
 * 選ぶ順は契約側（`SELECTION_ORDER`）に置いてある。
 * ここで独自に決めると、画面が言っている順と実際の順がずれる。
 */
import {
  LANGUAGE_MODEL_LABEL,
  NO_MODEL_MESSAGE,
  selectLanguageModel,
  UNAVAILABLE_REASON,
  type LanguageModelKind,
  type LanguageModelOption,
} from '@astra/contracts';
import { ClaudeCodeCli, ClaudeCodeError, CLAUDE_CODE_RECOVERY } from './claude-code.js';
import type { HostStep, StepOutcome } from './connector-steps.js';

/** 端末で答えられるもの。 */
export const LLM_TOOLS = [
  'llm.decompose',
  'llm.extract_claims',
  'llm.synthesize',
  'llm.contradictions',
  'search.web',
] as const;

/**
 * 呼び出しごとに、使ってよい道具。
 *
 * **既定は何も使わせない。**言葉をこねるだけの呼び出しに
 * ファイルや通信の道具を渡す理由が無い。web を引く 1 つだけが例外。
 */
const TOOLS_FOR: Readonly<Record<LlmTool, readonly string[]>> = {
  'llm.decompose': [],
  'llm.extract_claims': [],
  'llm.synthesize': [],
  'llm.contradictions': [],
  'search.web': ['WebSearch'],
};
export type LlmTool = (typeof LLM_TOOLS)[number];

/**
 * 何をどんな形で返してほしいか。
 *
 * **形を先に決めて渡す。**あとから直すのは無理で、
 * 読めない返事は捨てるしかない（捨てると仕事が進まない）。
 */
export function promptFor(tool: LlmTool, args: Record<string, unknown>): string {
  const json = (shape: string): string =>
    `JSON だけを返してください。説明や前置きは書かないでください。形式: ${shape}`;

  switch (tool) {
    case 'llm.decompose':
      return [
        `次の問いを、独立に検索できる下位の問いへ分けてください。最大 ${String(args['max'] ?? 5)} 件。`,
        '元の問いに含まれていない話題を足さないでください。',
        json('{"queries": ["…", "…"]}'),
        '',
        `問い: ${String(args['question'] ?? '')}`,
      ].join('\n');

    case 'llm.extract_claims':
      return [
        '次の抜粋から、確認できる主張だけを取り出してください。',
        /*
         * **原文に無い言葉を根拠にさせない。**
         * cloud 側でも抜粋との一致を機械検査するが、
         * ここで先に言っておくと捨てる件数が減る。
         */
        'supportText は、抜粋の中にそのまま現れる文字列でなければなりません。',
        '要約したり言い換えたりしないでください。',
        json('{"claims": [{"claim": "…", "supportText": "…"}]}'),
        '',
        `問い: ${String(args['question'] ?? '')}`,
        `出典: ${String(args['title'] ?? '')}`,
        `抜粋: ${String(args['snippet'] ?? '')}`,
      ].join('\n');

    case 'llm.synthesize':
      return [
        '次の主張から、問いへの答えをまとめてください。',
        '主張に無いことを足さないでください。分からない部分は書かないでください。',
        /*
         * **どの主張に立っているかを言わせる。**言わせないと、
         * 出来上がった結論を後から根拠へ辿れない。
         * 辿れない結論は、台帳があっても「根拠つき」ではない。
         */
        'supports には、その結論が立っている主張の番号を入れてください。番号は 0 から始まります。',
        '根拠を挙げられない結論は書かないでください。',
        json('{"findings": [{"text": "…", "supports": [0, 2]}]}'),
        '',
        `問い: ${String(args['question'] ?? '')}`,
        `主張:\n${listOf(args['claims'])}`,
      ].join('\n');

    case 'search.web':
      return [
        `WebSearch で次を検索してください: ${String(args['query'] ?? '')}`,
        `結果は最大 ${String(args['limit'] ?? 5)} 件。`,
        /*
         * **実在した URL だけ。**作られた URL が混じると、
         * 台帳の「出典」が辿れないものになる。それは根拠が無いのと同じ。
         */
        'url は、検索結果に実際に現れたものだけを入れてください。',
        '要約や意見は書かないでください。検索結果をそのまま写してください。',
        json(
          '{"results": [{"url": "https://…", "title": "…", "snippet": "…", "published": "YYYY-MM-DD または null"}]}',
        ),
      ].join('\n');

    case 'llm.contradictions':
      return [
        '次の主張の中で、意味が食い違う組を挙げてください。',
        '番号は 0 から始まります。食い違いが無ければ空の配列を返してください。',
        '言い方が違うだけのものは食い違いではありません。',
        json('{"pairs": [{"left": 0, "right": 2}]}'),
        '',
        `主張:\n${listOf(args['claims'])}`,
      ].join('\n');
  }
}

function listOf(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.map((item, index) => `${String(index)}. ${String(item)}`).join('\n');
}

export interface LlmRuntimeDeps {
  readonly claudeCode?: ClaudeCodeCli;
  /** ほかの持ち込み（API キー）。無ければ Claude Code だけ。 */
  readonly others?: readonly LanguageModelOption[];
  /** 実際に呼ぶもの。種類ごとに 1 つ。 */
  readonly askWith?: Partial<
    Record<LanguageModelKind, (prompt: string, allowedTools: readonly string[]) => Promise<unknown>>
  >;
}

export class LlmRuntime {
  readonly #deps: LlmRuntimeDeps;
  #options: LanguageModelOption[] | null = null;

  constructor(deps: LlmRuntimeDeps) {
    this.#deps = deps;
  }

  handles(toolId: string): boolean {
    return (LLM_TOOLS as readonly string[]).includes(toolId);
  }

  /**
   * この端末で何が使えるか。
   *
   * **一度調べたら覚えておく。**呼ぶたびに `claude --version` を走らせると、
   * 1 回の調査で何十回もプロセスが立つ。
   */
  async options(): Promise<LanguageModelOption[]> {
    if (this.#options) return this.#options;

    const found: LanguageModelOption[] = [];
    if (this.#deps.claudeCode) {
      const probe = await this.#deps.claudeCode.probe();
      found.push({
        kind: 'claude_code',
        available: probe.available,
        reason: probe.available ? null : (probe.reason ?? UNAVAILABLE_REASON.claude_code),
        // 資格情報は Claude Code のもの。Astra は持たない。
        credential: 'claude_code',
        implementation: probe.version,
      });
    }
    found.push(...(this.#deps.others ?? []));
    this.#options = found;
    return found;
  }

  /** 覚えたことを忘れる。端末で Claude Code を入れ直したときに使う。 */
  forget(): void {
    this.#options = null;
  }

  async run(step: HostStep): Promise<StepOutcome> {
    if (!this.handles(step.toolId)) {
      return {
        ok: false,
        error: { code: 'host.unsupported_step', message: 'この端末はこの操作に対応していません。' },
      };
    }

    const chosen = selectLanguageModel(await this.options());
    if (!chosen) {
      /*
       * 使えるものが無い。**運営側のモデルへ落ちない。**
       * 落ちれば、利用者が選んだ経路と料金の外で処理が走る。
       */
      return { ok: false, error: { code: 'llm.no_model', message: NO_MODEL_MESSAGE } };
    }

    const ask = this.#askFor(chosen.kind);
    if (!ask) {
      return {
        ok: false,
        error: {
          code: 'llm.not_wired',
          message: `${LANGUAGE_MODEL_LABEL[chosen.kind]}は、まだ呼び出せる状態になっていません。`,
        },
      };
    }

    try {
      const tool = step.toolId as LlmTool;
      return { ok: true, result: await ask(promptFor(tool, step.args), TOOLS_FOR[tool]) };
    } catch (error) {
      if (error instanceof ClaudeCodeError) {
        if (error.reason === 'not_installed' || error.reason === 'not_signed_in') {
          // 使えなくなった。次の呼び出しで調べ直す。
          this.forget();
        }
        return {
          ok: false,
          error: {
            code: `llm.${error.reason}`,
            message: CLAUDE_CODE_RECOVERY[error.reason],
          },
        };
      }
      return {
        ok: false,
        error: { code: 'llm.failed', message: 'この端末でモデルを呼び出せませんでした。' },
      };
    }
  }

  #askFor(
    kind: LanguageModelKind,
  ): ((prompt: string, allowedTools: readonly string[]) => Promise<unknown>) | null {
    const provided = this.#deps.askWith?.[kind];
    if (provided) return provided;
    if (kind === 'claude_code' && this.#deps.claudeCode) {
      const cli = this.#deps.claudeCode;
      return (prompt, allowedTools) => cli.ask(prompt, { allowedTools });
    }
    return null;
  }
}
