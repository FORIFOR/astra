/**
 * request_id の採番と伝播。実装仕様 §11。
 *
 * 受け取ったヘッダをそのまま信用しない。ログの相関キーになるので、
 * 形式を検査し、怪しければサーバ側で採番し直す。
 */
import { HEADER_REQUEST_ID, uuidv7 } from '@astra/contracts';
import type { App } from '../fastify.js';
import { runWithRequestContext } from '../request-context.js';

/** 外部から渡された request id として許す形。長さと文字種を絞る。 */
const ACCEPTABLE = /^[A-Za-z0-9._:-]{8,128}$/;

export function normalizeRequestId(value: unknown): string {
  return typeof value === 'string' && ACCEPTABLE.test(value) ? value : uuidv7();
}

export function registerRequestId(app: App): void {
  app.addHook('onRequest', (request, reply, done) => {
    // `genReqId` が確定させた値をそのまま使う（採番は 1 箇所だけ）
    const requestId = request.id;
    void reply.header(HEADER_REQUEST_ID, requestId);

    // 以降のフック・ハンドラ・ログはこのコンテキストの中で動く
    runWithRequestContext({ requestId }, () => {
      request.log = request.log.child({ request_id: requestId });
      done();
    });
  });
}
