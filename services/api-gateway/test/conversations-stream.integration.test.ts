/**
 * Conversation の SSE。正本 §19 `GET /v1/conversations/{id}/stream` と §20 の統一 envelope
 * （sequence 付き・Last-Event-ID で再開）を HTTP 契約として確かめる。
 *   ./infra/db/with-test-db.sh pnpm --filter @astra/service-api-gateway test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TokenResponse, uuidv7 } from '@astra/contracts';
import { withTenant } from '@astra/db';
import { appendEvent } from '@astra/service-task';
import { makeTestApp, makeTokens, testDbConfig, type TestApp } from './support.js';
import type { App } from '../src/fastify.js';

const url = process.env['TEST_DATABASE_URL'];
const identityUrl = process.env['TEST_IDENTITY_DATABASE_URL'];

describe.skipIf(!url)('conversation sse', () => {
  let harness: TestApp;
  let app: App;
  let auth: { authorization: string };
  let tenantId: string;

  /** §20 の envelope を conversation stream へ積む。 */
  const seed = async (conversationId: string, turnId: string): Promise<void> => {
    await withTenant(harness.db, tenantId, async (tx) => {
      for (const delta of ['こん', 'にちは']) {
        await appendEvent(tx, {
          tenantId,
          streamKind: 'conversation',
          streamId: conversationId,
          type: 'conversation.delta' as never,
          payload: { turn_id: turnId, text_delta: delta },
        });
      }
      await appendEvent(tx, {
        tenantId,
        streamKind: 'conversation',
        streamId: conversationId,
        type: 'conversation.completed' as never,
        payload: { turn_id: turnId, finish_reason: 'stop' },
      });
    });
  };

  const parseSse = (body: string): { id: number; event: string }[] =>
    body
      .split('\n\n')
      .filter((block) => block.startsWith('id: '))
      .map((block) => ({
        id: Number(/^id: (\d+)/.exec(block)![1]),
        event: /event: (.+)/.exec(block)![1]!,
      }));

  const startConversation = async (): Promise<string> => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: auth,
      payload: {},
    });
    return res.json<{ id: string }>().id;
  };

  beforeAll(async () => {
    const tokens = await makeTokens();
    harness = await makeTestApp({ dbConfig: testDbConfig(url!, identityUrl), tokens });
    app = harness.app;

    const issued = await app.inject({
      method: 'POST',
      url: '/v1/auth/dev/token',
      payload: { email: `c-${uuidv7()}@example.com`, display_name: 'C' },
    });
    const token = issued.json<TokenResponse>();
    auth = { authorization: `Bearer ${token.access_token}` };

    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: auth });
    tenantId = me.json<{ tenant: { id: string } }>().tenant.id;
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('replays the conversation stream and closes on the terminal event', async () => {
    const conversationId = await startConversation();
    await seed(conversationId, uuidv7());

    const res = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversationId}/stream`,
      headers: auth,
    });

    expect(res.headers['content-type']).toContain('text/event-stream');
    const frames = parseSse(res.body);
    expect(frames.map((f) => f.id)).toEqual([1, 2, 3]);
    expect(frames.map((f) => f.event)).toEqual([
      'conversation.delta',
      'conversation.delta',
      'conversation.completed',
    ]);
  });

  it('resumes from Last-Event-ID without repeating', async () => {
    const conversationId = await startConversation();
    await seed(conversationId, uuidv7());

    const res = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversationId}/stream`,
      headers: { ...auth, 'last-event-id': '2' },
    });

    const frames = parseSse(res.body);
    expect(frames.map((f) => f.id)).toEqual([3]);
    expect(frames.at(-1)!.event).toBe('conversation.completed');
  });

  it('404s before opening the stream for an unknown conversation', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${uuidv7()}/stream`,
      headers: auth,
    });
    expect(res.statusCode).toBe(404);
  });
});
