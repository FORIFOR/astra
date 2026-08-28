#!/usr/bin/env node
// #1/#8 の live 検証を turnkey で行う。専用テスト用 Google Desktop OAuth の client_id/secret を
// .env に入れて実行すると、実 Google consent → real id_token → gateway 検証まで通す。
// 既存の JWT/JWKS 検証(services/api-gateway)は再実装しない。ここは「実トークンを取得して
// gateway に検証させる」だけ。secret は .env(gitignored)からのみ読み、commit しない。
//
//   1) .env に ASTRA_AUTH_GOOGLE_CLIENT_IDS(=client_id) と ASTRA_GOOGLE_CLIENT_SECRET を入れる
//   2) gateway をその client_id で起動（compose の env / ASTRA_AUTH_GOOGLE_CLIENT_IDS）
//   3) node scripts/verify-live-oauth.mjs  → 表示された URL をブラウザで開いて同意（← 唯一の人手）
//   4) code をループバックで受け、Google token endpoint で id_token 取得、gateway /v1/auth/idp/token で検証
//
// 結果は /tmp/astra-live-oauth.json に証跡として残す（id_token 生値は保存しない）。
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const GATEWAY = process.env.ASTRA_GATEWAY_URL || 'http://127.0.0.1:3000';
const PORT = Number(process.env.ASTRA_OAUTH_LOOPBACK_PORT || 8765);
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;

function loadEnv() {
  const p = path.join(ROOT, '.env');
  const out = {};
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return out;
}
const b64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function main() {
  const env = loadEnv();
  const clientId = (env.ASTRA_AUTH_GOOGLE_CLIENT_IDS || '').split(',')[0].trim();
  const clientSecret = (env.ASTRA_GOOGLE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    console.error(
      'MISSING: set ASTRA_AUTH_GOOGLE_CLIENT_IDS and ASTRA_GOOGLE_CLIENT_SECRET in .env',
    );
    console.error(
      '  Google Cloud Console → Credentials → OAuth client ID → "Desktop app" (専用テスト用アカウントで)',
    );
    process.exit(2);
  }
  // gateway がその client_id で configured か（audience 検証に必要）。
  try {
    const provs = await fetch(`${GATEWAY}/v1/auth/providers`).then((r) => r.json());
    const g = (provs.providers || []).find((p) => p.id === 'google');
    if (!g || !g.configured) {
      console.error(
        `GATEWAY not configured for google. gateway を ASTRA_AUTH_GOOGLE_CLIENT_IDS=${clientId} で再起動してください。`,
      );
      process.exit(3);
    }
  } catch (e) {
    console.error(`GATEWAY unreachable at ${GATEWAY}: ${e.message}`);
    process.exit(3);
  }

  // PKCE + state
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  const nonce = b64url(crypto.randomBytes(16));
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: 'openid email profile',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      nonce,
      access_type: 'offline',
      prompt: 'consent',
    }).toString();

  // ループバックで code を待つ
  const codePromise = new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/callback') {
        res.writeHead(404).end('not found');
        return;
      }
      const code = u.searchParams.get('code');
      const st = u.searchParams.get('state');
      res
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end('<h2>Astra: サインイン受領。ターミナルに戻ってください。</h2>');
      server.close();
      if (st !== state) return reject(new Error('state mismatch'));
      if (!code) return reject(new Error('no code'));
      resolve(code);
    });
    server.listen(PORT, '127.0.0.1', () => {
      console.log(
        '\n▼ この URL をブラウザで開き、専用テスト用 Google アカウントで同意してください（唯一の人手）:\n',
      );
      console.log(authUrl + '\n');
      console.log(`（ループバック ${REDIRECT} で待機中…）`);
    });
    server.on('error', reject);
  });

  const code = await codePromise;
  console.log('code 受領。Google token endpoint で id_token を交換します…');

  // Google token 交換（client_secret は Desktop OAuth に必要）。
  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }).toString(),
  }).then((r) => r.json());
  if (!tok.id_token) {
    console.error('TOKEN exchange failed:', JSON.stringify(tok));
    process.exit(4);
  }
  // id_token の claims を表示（実 Google 由来の証跡: iss/aud/sub）。生値は保存しない。
  const payload = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString('utf8'));
  console.log('\nid_token claims:', {
    iss: payload.iss,
    aud: payload.aud,
    sub: payload.sub,
    email: payload.email,
    email_verified: payload.email_verified,
  });

  // gateway に検証させる（既存の JWKS/issuer/audience 検証コードを通す）。
  const gw = await fetch(`${GATEWAY}/v1/auth/idp/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'google',
      id_token: tok.id_token,
      nonce: null, // Google は nonce をハッシュ照合しない（Apple 用）。id_token 内の nonce claim は Google では未検証。
      display_name: null,
      device_name: 'live-oauth-verify',
      platform: 'macos',
      app_version: '1.0.0',
    }),
  });
  const gwBody = await gw.json().catch(() => ({}));
  const ok = gw.ok && (gwBody.accessToken || gwBody.access_token || gwBody.session);
  const evidence = {
    provider: 'google',
    iss: payload.iss,
    aud: payload.aud,
    sub: payload.sub,
    email_verified: payload.email_verified,
    gateway_status: gw.status,
    gateway_verified: Boolean(ok),
    mock: false,
    at: new Date().toISOString(),
  };
  fs.writeFileSync('/tmp/astra-live-oauth.json', JSON.stringify(evidence, null, 2));
  if (ok) {
    console.log(
      '\nLIVE_OAUTH_OK: gateway が実 Google id_token を検証し Astra セッションを発行しました。',
    );
    console.log('  iss=' + payload.iss + ' aud=' + payload.aud + ' sub=' + payload.sub);
    console.log('  証跡: /tmp/astra-live-oauth.json （mock/local-JWKS ではない）');
    process.exit(0);
  } else {
    console.error('\nLIVE_OAUTH_FAIL: gateway 検証に失敗:', gw.status, JSON.stringify(gwBody));
    process.exit(5);
  }
}
main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
