/**
 * プロバイダの組み立て。Phase 2 §1.1（OQ-3）。
 */
import { describe, expect, it } from 'vitest';
import { researchProvidersFromEnv, standIns } from '../src/factory.js';
import type { SearchProvider } from '../src/providers.js';

const realSearch: SearchProvider = {
  name: 'some-vendor',
  isStandIn: false,
  async search() {
    return [];
  },
};

describe('researchProvidersFromEnv', () => {
  it('names what is still missing rather than failing silently', () => {
    const providers = researchProvidersFromEnv({});
    expect(standIns(providers)).toEqual(['search (static)', 'language model (deterministic)']);
  });

  it('uses Claude once a key is configured, and still flags search', () => {
    // 検索プロバイダは本当に未決。ここで勝手に決めない。
    const providers = researchProvidersFromEnv({ ANTHROPIC_API_KEY: 'k' });
    expect(providers.model.isStandIn).toBe(false);
    expect(standIns(providers)).toEqual(['search (static)']);
  });

  it('reports nothing left once both are real', () => {
    const providers = researchProvidersFromEnv({ ANTHROPIC_API_KEY: 'k' }, realSearch);
    expect(standIns(providers)).toEqual([]);
  });

  it('honours an explicit model choice', () => {
    const providers = researchProvidersFromEnv({
      ANTHROPIC_API_KEY: 'k',
      ASTRA_RESEARCH_MODEL: 'claude-opus-5',
    });
    expect(providers.model.name).toBe('anthropic:claude-opus-5');
  });
});
