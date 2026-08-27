/**
 * 環境変数からプロバイダを組み立てる。Phase 2 実装仕様 §1.1（OQ-3）。
 *
 * **検索プロバイダは未決のまま**。Brave / Tavily / Google CSE のどれを使うかは
 * 製品の判断であって、ここで勝手に決めない。決まるまでは代役を返し、
 * 代役であることを名乗る。
 */
import { DeterministicLanguageModel, StaticSearchProvider } from './providers.js';
import type { LanguageModel, SearchProvider } from './providers.js';
import { AnthropicLanguageModel } from './anthropic.js';
import { HostLanguageModel, type HostCall, type HostModelContext } from './host-model.js';
import { searchProviderFromEnv, type SearchEnv } from './search.js';
import { HostSearchProvider } from './host-search.js';

export interface ResearchProviders {
  readonly search: SearchProvider;
  readonly model: LanguageModel;
}

/** 代役が混ざっていれば、その名前を返す。空なら全部本物。 */
export function standIns(providers: ResearchProviders): string[] {
  return [
    providers.search.isStandIn ? `search (${providers.search.name})` : null,
    providers.model.isStandIn ? `language model (${providers.model.name})` : null,
  ].filter((name): name is string => name !== null);
}

export interface ResearchProviderEnv extends SearchEnv {
  readonly ANTHROPIC_API_KEY?: string | undefined;
  readonly ASTRA_RESEARCH_MODEL?: string | undefined;
  /** 端末で呼ぶのをやめるとき。既定は端末（正本 §21、UI/UX §22）。 */
  readonly ASTRA_MODEL_ON_DEVICE?: string | undefined;
}

export interface ResearchProviderParts {
  readonly search?: SearchProvider;
  /**
   * 端末へ頼む口。`HostStepExecutor` がこれを満たす。
   *
   * **gateway と worker の両方が同じものを渡す。**片方だけ渡すと、
   * 同じ構成なのに二つの面が違うことを言う。実際に起きた:
   * worker は「言語モデルは本物」、gateway は「代役」と報告していた。
   */
  readonly host?: HostCall;
}

/**
 * どこで言語モデルを呼ぶか。**1 箇所で決める。**
 *
 *   端末で呼ぶ  … 利用者が持ち込んだ利用権（Claude Code / 自分のキー）
 *   ここで呼ぶ  … `ANTHROPIC_API_KEY` が置かれている自己ホスト構成
 *   どちらも無い … 代役。**本番では起動を拒む**
 */
export function researchProvidersFromEnv(
  env: ResearchProviderEnv,
  parts: SearchProvider | ResearchProviderParts = {},
): ResearchProviders {
  // 以前の呼び出し（第 2 引数が SearchProvider）も通す
  const options: ResearchProviderParts =
    parts && 'search' in parts && typeof (parts as SearchProvider).search === 'function'
      ? { search: parts as SearchProvider }
      : (parts as ResearchProviderParts);

  const onDevice = env.ASTRA_MODEL_ON_DEVICE !== 'false';

  return {
    /*
     * どの検索を使うかは**利用者が選ぶ**（正本 §8、OQ-3）。
     * 既定を決めないのは、調べたい内容そのものが問い合わせ先へ渡るから。
     * 選ばれていなければ代役のまま名乗り、本番では起動を拒む。
     */
    search:
      options.search ??
      searchProviderFromEnv(env) ??
      // 選ばれていなければ端末で引く。利用者が既に持っている利用権で足りる。
      (onDevice && options.host
        ? new HostSearchProvider({ host: options.host, context: currentContext })
        : new StaticSearchProvider([])),
    model: pickModel(env, onDevice, options.host),
  };
}

function pickModel(
  env: ResearchProviderEnv,
  onDevice: boolean,
  host: HostCall | undefined,
): LanguageModel {
  if (env.ANTHROPIC_API_KEY) {
    return new AnthropicLanguageModel({
      apiKey: env.ANTHROPIC_API_KEY,
      ...(env.ASTRA_RESEARCH_MODEL ? { model: env.ASTRA_RESEARCH_MODEL } : {}),
    });
  }
  if (onDevice && host) {
    return new HostLanguageModel({
      host,
      // 仕事の中から呼ばれたときだけ。外から呼ばれたら断る。
      context: () => currentContext(),
      implementation: 'device (bring your own)',
    });
  }
  return new DeterministicLanguageModel();
}

/**
 * いまどの step の中に居るか。
 *
 * module に置いてあるのは、`LanguageModel` の口に task を持ち込まないため。
 * 調査の実装は「どの仕事の一部か」を知らないし、知る必要もない。
 * 置くのは activity で、**置かれていなければ端末には頼めない**。
 */
let context: HostModelContext | null = null;

export function setModelContext(where: HostModelContext | null): void {
  context = where;
}

function currentContext(): HostModelContext | null {
  return context;
}
