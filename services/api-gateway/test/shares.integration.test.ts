/**
 * 共有リンク。Phase 2 実装仕様 §2、正本 §2.3。AC2-6 〜 AC2-12。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7, type Artifact, type Share, type TokenResponse } from '@astra/contracts';
import { withTenant } from '@astra/db';
import { readAuditChain, verifyAuditChain } from '@astra/telemetry';
import { makeTestApp, makeTokens, testDbConfig, type TestApp } from './support.js';
import type { App } from '../src/fastify.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];
const shareUrl = process.env['TEST_SHARE_DATABASE_URL'];

describe.skipIf(!url || !shareUrl)('share links', () => {
  let harness: TestApp;
  let app: App;
  let auth: { authorization: string };
  let tenantId: string;
  let artifact: Artifact;

  const makeArtifact = async (title = '提案書'): Promise<Artifact> => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/artifacts',
      headers: auth,
      payload: {
        type: 'DOCUMENT',
        title,
        mime_type: 'text/markdown',
        content_base64: Buffer.from(`# ${title}\n\n共有される中身`).toString('base64'),
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json<Artifact>();
  };

  const share = async (payload: Record<string, unknown> = { expires_in: '1d' }) => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/artifacts/${artifact.id}/share`,
      headers: auth,
      payload,
    });
    return res;
  };

  const unlock = (token: string, extra: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: '/public/share/unlock', payload: { token, ...extra } });

  beforeAll(async () => {
    const tokens = await makeTokens();
    harness = await makeTestApp({
      dbConfig: testDbConfig(url!, identityUrl, shareUrl),
      tokens,
    });
    app = harness.app;

    const issued = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `s-${uuidv7()}@example.com`, display_name: 'S' },
    });
    auth = { authorization: `Bearer ${issued.json<TokenResponse>().access_token}` };
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: auth });
    tenantId = me.json<{ tenant: { id: string } }>().tenant.id;
    artifact = await makeArtifact();
  });

  afterAll(async () => {
    await harness?.close();
  });

  describe('creating a share (AC2-6)', () => {
    it('refuses a share with no expiry', async () => {
      // 無期限の共有を作らせない
      const res = await share({});
      expect(res.statusCode).toBe(400);
    });

    it('returns the token exactly once, in the fragment of the url', async () => {
      const res = await share({ expires_in: '1h' });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ share: Share & { url_token: string }; url: string }>();
      expect(body.share.access_count).toBe(0);
      // 秘密はフラグメント。サーバのアクセスログにも Referer にも残らない。
      expect(body.url).toContain('/s#');
      expect(body.url).toContain(body.share.url_token);

      const listed = await app.inject({
        method: 'GET',
        url: `/v1/artifacts/${artifact.id}/shares`,
        headers: auth,
      });
      const items = listed.json<{ items: Share[] }>().items;
      // 一覧には平文のトークンが出ない
      expect(JSON.stringify(items)).not.toContain(body.share.url_token);
    });

    it('defaults to no download and no password', async () => {
      const body = (await share({ expires_in: '1d' })).json<{ share: Share }>();
      expect(body.share.policy.allow_download).toBe(false);
      expect(body.share.policy.requires_password).toBe(false);
      expect(body.share.policy.one_time).toBe(false);
    });

    it('refuses to share another tenant’s artifact (AC2-12)', async () => {
      const other = await app.inject({
        method: 'POST',
        url: '/v1/auth/dev/token',
        payload: { email: `o-${uuidv7()}@example.com`, display_name: 'O' },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/artifacts/${artifact.id}/share`,
        headers: { authorization: `Bearer ${other.json<TokenResponse>().access_token}` },
        payload: { expires_in: '1d' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('opening a share (AC2-7, AC2-8)', () => {
    it('opens a plain link and hands back a short-lived view token', async () => {
      const created = (await share({ expires_in: '1d' })).json<{ share: { url_token: string } }>();
      const res = await unlock(created.share.url_token);
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        view_token: string;
        expires_in: number;
        artifact: Record<string, unknown>;
      }>();
      expect(body.expires_in).toBe(300);
      expect(body.artifact['title']).toBe('提案書');
      // テナントも所有者も共有相手に出さない
      expect(JSON.stringify(body.artifact)).not.toContain(tenantId);
    });

    it('needs the password when one is set', async () => {
      const created = (await share({ expires_in: '1d', password: 'correct horse' })).json<{
        share: { url_token: string };
      }>();

      expect((await unlock(created.share.url_token)).statusCode).toBe(404);
      expect((await unlock(created.share.url_token, { password: 'wrong' })).statusCode).toBe(404);
      expect(
        (await unlock(created.share.url_token, { password: 'correct horse' })).statusCode,
      ).toBe(200);
    });

    it('gives the same answer for every kind of failure', async () => {
      // 「期限切れ」と「パスワード違い」を区別して返すと、
      // 有効なトークンの存在を教えることになる
      const created = (await share({ expires_in: '1d' })).json<{ share: { url_token: string } }>();
      const bogus = 'v1.' + uuidv7() + '.' + 'x'.repeat(43);
      const malformed = 'not-a-token';
      const wrongSecret = created.share.url_token.replace(/\.[^.]+$/, '.' + 'y'.repeat(43));

      const answers = await Promise.all(
        [bogus, malformed, wrongSecret].map(async (token) => {
          const res = await unlock(token);
          return {
            status: res.statusCode,
            code: res.json<{ error: { code: string } }>().error.code,
          };
        }),
      );
      expect(new Set(answers.map((a) => `${a.status}:${a.code}`)).size).toBe(1);
      expect(answers[0]!.status).toBe(404);
    });

    it('stops working once revoked', async () => {
      const created = (await share({ expires_in: '1d' })).json<{
        share: { id: string; url_token: string };
      }>();
      expect((await unlock(created.share.url_token)).statusCode).toBe(200);

      const revoked = await app.inject({
        method: 'DELETE',
        url: `/v1/shares/${created.share.id}`,
        headers: auth,
      });
      expect(revoked.statusCode).toBe(204);
      expect((await unlock(created.share.url_token)).statusCode).toBe(404);
    });

    it('stops working after the first open when it is one-time', async () => {
      const created = (await share({ expires_in: '1d', one_time: true })).json<{
        share: { url_token: string };
      }>();
      expect((await unlock(created.share.url_token)).statusCode).toBe(200);
      expect((await unlock(created.share.url_token)).statusCode).toBe(404);
    });

    it('refuses once the expiry has passed', async () => {
      const created = (await share({ expires_in_seconds: 1 })).json<{
        share: { url_token: string };
      }>();
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      expect((await unlock(created.share.url_token)).statusCode).toBe(404);
    });

    it('honours an allowlist', async () => {
      const created = (
        await share({ expires_in: '1d', allowlist: ['@partner.example.com'] })
      ).json<{ share: { url_token: string } }>();

      expect((await unlock(created.share.url_token)).statusCode).toBe(404);
      expect(
        (await unlock(created.share.url_token, { email: 'someone@other.example.com' })).statusCode,
      ).toBe(404);
      expect(
        (await unlock(created.share.url_token, { email: 'a@partner.example.com' })).statusCode,
      ).toBe(200);
    });
  });

  describe('brute force (AC2-9)', () => {
    it('stops repeated attempts on the same link', async () => {
      const created = (await share({ expires_in: '1d', password: 'secret pass' })).json<{
        share: { url_token: string };
      }>();

      const codes: number[] = [];
      for (let i = 0; i < 12; i += 1) {
        codes.push((await unlock(created.share.url_token, { password: `guess-${i}` })).statusCode);
      }
      expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
      // 制限は**リンク単位**。ほかのリンクは巻き添えにしない。
      const other = (await share({ expires_in: '1d' })).json<{ share: { url_token: string } }>();
      expect((await unlock(other.share.url_token)).statusCode).toBe(200);
    }, 30_000);
  });

  describe('content (AC2-11)', () => {
    it('serves the body only with a view token, and never a storage url', async () => {
      const created = (await share({ expires_in: '1d' })).json<{ share: { url_token: string } }>();
      const opened = (await unlock(created.share.url_token)).json<{ view_token: string }>();

      const denied = await app.inject({ method: 'GET', url: '/public/share/content' });
      expect(denied.statusCode).toBe(404);

      const res = await app.inject({
        method: 'GET',
        url: '/public/share/content',
        headers: { authorization: `Share ${opened.view_token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('共有される中身');
      // 表示はできるが保存はさせない
      expect(res.headers['content-disposition']).toBe('inline');
      expect(res.headers['x-robots-tag']).toContain('noindex');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      // raw なストレージ URL を出さない
      expect(JSON.stringify(res.headers)).not.toContain('file://');
    });

    it('offers download only when the share allows it', async () => {
      const created = (await share({ expires_in: '1d', allow_download: true })).json<{
        share: { url_token: string };
      }>();
      const opened = (await unlock(created.share.url_token)).json<{ view_token: string }>();
      const res = await app.inject({
        method: 'GET',
        url: '/public/share/content',
        headers: { authorization: `Share ${opened.view_token}` },
      });
      expect(res.headers['content-disposition']).toBe('attachment');
    });
  });

  describe('audit (AC2-10)', () => {
    it('records sharing and every access on an intact chain', async () => {
      const chain = await withTenant(harness.db, tenantId, (tx) => readAuditChain(tx, tenantId));
      const actions = chain.map((r) => r.action);
      expect(actions).toContain('artifact.shared');
      expect(actions).toContain('artifact.share_accessed');
      expect(actions).toContain('artifact.share_revoked');
      expect(await verifyAuditChain(chain)).toEqual([]);
      // 外部への公開なので external_effect が立っていること
      expect(chain.some((r) => r.action === 'artifact.shared' && r.external_effect)).toBe(true);
    });

    it('logs denied attempts without keeping the raw address', async () => {
      const logs = await withTenant(harness.db, tenantId, (tx) =>
        tx.selectFrom('share_access_logs').selectAll().execute(),
      );
      expect(logs.some((l) => l.outcome === 'denied')).toBe(true);
      expect(logs.some((l) => l.outcome === 'granted')).toBe(true);
      for (const log of logs) {
        // 生の IP ではなくハッシュ
        if (log.requester_hash) expect(log.requester_hash).toMatch(/^[0-9a-f]{64}$/);
      }
    });
  });
});
