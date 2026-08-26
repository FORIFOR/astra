/**
 * 提供者ごとの設定。正本 §2.4・§21。
 *
 * **繋げないことを、繋いだつもりにさせない。**
 */
import { describe, expect, it } from 'vitest';
import {
  OAUTH_PROVIDERS,
  clientIdVar,
  configuredProviders,
  providerConfig,
  unconfiguredProviders,
} from '../src/index.js';

describe('what is configured', () => {
  it('treats an empty client id as not configured', () => {
    expect(configuredProviders({})).toEqual([]);
    expect(configuredProviders({ ASTRA_OAUTH_GOOGLE_CLIENT_ID: '' })).toEqual([]);
    expect(configuredProviders({ ASTRA_OAUTH_GOOGLE_CLIENT_ID: 'g' })).toEqual(['google']);
  });

  it('names the setting that is missing', () => {
    const missing = unconfiguredProviders({ ASTRA_OAUTH_GOOGLE_CLIENT_ID: 'g' });
    expect(missing.map((m) => m.provider)).toEqual(['microsoft']);
    expect(missing[0]!.setting).toBe('ASTRA_OAUTH_MICROSOFT_CLIENT_ID');
  });
});

describe('building the config', () => {
  it('returns nothing rather than an empty client id', () => {
    // 空で始めると、提供者の画面で意味の分からない失敗になる
    expect(providerConfig('google', ['mail.read'], {})).toBeNull();
  });

  it('asks Google for a refresh token', () => {
    const config = providerConfig('google', ['mail.read'], {
      ASTRA_OAUTH_GOOGLE_CLIENT_ID: 'g',
    })!;
    // access_type=offline が無いと 1 時間で黙って切れる
    expect(config.extraAuthorizeParams?.['access_type']).toBe('offline');
    expect(config.clientId).toBe('g');
    expect(config.scopes).toEqual(['mail.read']);
  });

  it('never carries a client secret', () => {
    for (const provider of OAUTH_PROVIDERS) {
      const config = providerConfig(provider, [], { [clientIdVar(provider)]: 'x' })!;
      // native app は秘密を保てない（RFC 8252 §8.5）
      expect(config.clientSecret).toBeUndefined();
    }
  });

  it('points at the real endpoints, over https', () => {
    for (const provider of OAUTH_PROVIDERS) {
      const config = providerConfig(provider, [], { [clientIdVar(provider)]: 'x' })!;
      expect(config.authorizeUrl.startsWith('https://')).toBe(true);
      expect(config.tokenUrl.startsWith('https://')).toBe(true);
    }
  });
});
