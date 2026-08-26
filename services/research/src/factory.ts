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

export interface ResearchProviderEnv {
  readonly ANTHROPIC_API_KEY?: string | undefined;
  readonly ASTRA_RESEARCH_MODEL?: string | undefined;
}

export function researchProvidersFromEnv(
  env: ResearchProviderEnv,
  search?: SearchProvider,
): ResearchProviders {
  return {
    // OQ-3 の未決部分。決まったらここへ実装を渡す。
    search: search ?? new StaticSearchProvider([]),
    model: env.ANTHROPIC_API_KEY
      ? new AnthropicLanguageModel({
          apiKey: env.ANTHROPIC_API_KEY,
          ...(env.ASTRA_RESEARCH_MODEL ? { model: env.ASTRA_RESEARCH_MODEL } : {}),
        })
      : new DeterministicLanguageModel(),
  };
}
