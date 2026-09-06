/**
 * スクショ自動コンテキスト（SCREENSHOT_CONTEXT_GATE の gateway 側）。
 *
 * 「⌘⇧4 → 『これ何？』」で聞き返されないこと。撮ったばかりのスクショは
 * 「いま見ているもの」で、会話に何も無くても「これ」はそれで解ける。
 * 添付は id とラベルだけで、**画素は cloud を通らない。**
 *   ./infra/db/with-test-db.sh pnpm --filter @astra/service-api-gateway test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TokenResponse, uuidv7 } from '@astra/contracts';
import { makeTestApp, makeTokens, testDbConfig, type TestApp } from './support.js';
import type { App } from '../src/fastify.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];

describe.skipIf(!url)('asking about a screenshot just taken', () => {
  let harness: TestApp;
  let app: App;
  let auth: { authorization: string };

  const startConversation = async (): Promise<string> => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: auth,
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string }>().id;
  };

  const turn = async (conversationId: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/turns`,
      headers: auth,
      payload,
    });

  beforeAll(async () => {
    const tokens = await makeTokens();
    harness = await makeTestApp({ dbConfig: testDbConfig(url!, identityUrl), tokens });
    app = harness.app;
    const issued = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `s-${uuidv7()}@example.com`, display_name: 'S' },
    });
    auth = { authorization: `Bearer ${issued.json<TokenResponse>().access_token}` };
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('asks back for a bare "これ" when nothing is on screen or in the conversation', async () => {
    const res = await turn(await startConversation(), { text: 'これ何？' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ needs_clarification: boolean }>().needs_clarification).toBe(true);
  });

  it('does not ask back when the turn carries the screenshot the person just took', async () => {
    const res = await turn(await startConversation(), {
      text: 'これ何？',
      attachments: [
        {
          id: 'a1b2c3d4-0000-7000-8000-000000000001',
          kind: 'screenshot',
          label: 'スクリーンショット（たった今）',
        },
      ],
    });
    // 解けたので聞き返さない。仕事が始まるか、始められない理由（notice）が返る。
    expect(res.statusCode).toBe(202);
    expect(res.json<{ needs_clarification: boolean }>().needs_clarification).toBe(false);
  });

  it('refuses an attachment id that could become a path on the device', async () => {
    const res = await turn(await startConversation(), {
      text: 'これ何？',
      attachments: [{ id: '../etc/passwd', kind: 'screenshot', label: 'x' }],
    });
    expect(res.statusCode).toBe(400);
  });
});
