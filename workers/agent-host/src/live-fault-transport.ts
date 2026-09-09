/** Opt-in transport fault for a dedicated live fixture, never enabled in production. */
import { writeFile } from 'node:fs/promises';
export function liveFaultTransport(
  env: NodeJS.ProcessEnv,
  realFetch: typeof fetch = fetch,
): typeof fetch | undefined {
  if (env['ASTRA_LIVE_FAULT_MODE'] !== 'send-response-loss') return undefined;
  const nonce = env['ASTRA_LIVE_FAULT_NONCE'];
  const log = env['ASTRA_LIVE_FAULT_LOG'];
  if (env['ASTRA_ENV'] !== 'development' || !env['ASTRA_SECRET_STORE_FILE'] || !nonce || !log)
    throw new Error('live fault requires an isolated development fixture');
  let attempts = 0;
  let accepted = 0;
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const isSend =
      (url.hostname === 'gmail.googleapis.com' && url.pathname.endsWith('/messages/send')) ||
      (url.hostname === 'graph.microsoft.com' && /\/messages\/[^/]+\/reply$/.test(url.pathname));
    if (!isSend || init?.method !== 'POST' || typeof init.body !== 'string')
      return realFetch(input, init);
    const body = JSON.parse(init.body) as { raw?: string; comment?: string };
    let content = body.raw
      ? Buffer.from(body.raw, 'base64url').toString('utf8')
      : (body.comment ?? '');
    if (body.raw) {
      const separator = /\r?\n\r?\n/.exec(content);
      if (separator) {
        const headers = content.slice(0, separator.index);
        content = content.slice(separator.index + separator[0].length);
        if (/^Content-Transfer-Encoding:\s*base64\s*$/im.test(headers))
          content = Buffer.from(content, 'base64').toString('utf8');
      }
    }
    if (!content.includes(`[live ${nonce}]`)) return realFetch(input, init);
    attempts += 1;
    const record = () => writeFile(log, JSON.stringify({ attempts, accepted }), { mode: 0o600 });
    await record();
    // A retry is counted as a failure by the gate, and blocked before a duplicate side effect.
    if (attempts > 1) throw new Error('live fault: duplicate send attempt blocked');
    const response = await realFetch(input, init);
    if (!response.ok) return response;
    accepted += 1;
    await record();
    throw new TypeError('live fault: response lost after provider accepted send');
  };
}
