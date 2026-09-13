#!/usr/bin/env node
/** Standalone, read-only preview checks. Works outside a v0.1.4 checkout. */
import { execFile } from 'node:child_process';
import { readFile, access, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createConnection } from 'node:net';

const exec = promisify(execFile);
const UNCHECKED = [
  'Task Workerの稼働・Temporalのタスクキュー',
  'Agent Hostの登録・認証・アプリとの接続',
  'DBマイグレーションの完全性・モデルの回答品質・最初のタスク完了',
];
const CONFIG_KEYS = new Set([
  'ASTRA_API_URL',
  'ASTRA_API_HOST',
  'ASTRA_LOCAL_LLM_URL',
  'ASTRA_LOCAL_LLM_MODEL',
  'TEMPORAL_ADDRESS',
]);

export function localEndpoint(value, rootOnly = false) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('接続先の形式が不正です。');
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (rootOnly && url.pathname !== '/')
  ) {
    throw new Error('検査先は認証情報を含まない、このMacのHTTPアドレスに限定されます。');
  }
  return url.toString().replace(/\/$/, '');
}

function selectedConfig(text) {
  const config = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (!match || !CONFIG_KEYS.has(match[1])) continue;
    let value = match[2];
    if (value.startsWith('"') || value.startsWith("'")) {
      const end = value.indexOf(value[0], 1);
      if (end < 0 || !/^\s*(?:#.*)?$/.test(value.slice(end + 1))) {
        throw new Error('.envのローカル接続設定を読み取れません。引用符を確認してください。');
      }
      value = value.slice(1, end);
    } else value = value.replace(/\s+#.*$/, '').trim();
    config[match[1]] = value;
  }
  return config;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
export async function readOnlyCommand(file, args) {
  try {
    const { stdout } = await exec(file, args, {
      timeout: 4000,
      maxBuffer: 65536,
      env: {
        ...process.env,
        // Version probes must not provision a package manager or modify package.json.
        COREPACK_ENABLE_NETWORK: '0',
        COREPACK_ENABLE_AUTO_PIN: '0',
        COREPACK_DEFAULT_TO_LATEST: '0',
        npm_config_manage_package_manager_versions: 'false',
        npm_config_update_notifier: 'false',
        NO_UPDATE_NOTIFIER: '1',
        GIT_OPTIONAL_LOCKS: '0',
      },
    });
    return { ok: true, stdout: stdout.trim() };
  } catch {
    return { ok: false, stdout: '' };
  }
}
async function getJSON(url, timeout) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
    });
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 65536) return { ok: false, body: null };
      chunks.push(chunk);
    }
    return { ok: response.ok, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { ok: false, body: null };
  }
}
async function portOpen(host, port, timeout) {
  return new Promise((accept) => {
    const socket = createConnection({ host: host.replace(/^\[|\]$/g, ''), port });
    const done = (value) => {
      socket.destroy();
      accept(value);
    };
    socket.setTimeout(timeout, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export async function diagnose(options, dependencies = {}) {
  const repo = resolve(options.repo ?? process.cwd());
  const timeout = options.timeout ?? 2500;
  const run = dependencies.command ?? readOnlyCommand;
  const request = dependencies.getJSON ?? getJSON;
  const connect = dependencies.portOpen ?? portOpen;
  const platform = dependencies.platform ?? process.platform;
  const nodeVersion = dependencies.nodeVersion ?? process.versions.node;
  const checks = [];
  const add = (id, status, detail, next = []) => checks.push({ id, status, detail, next });
  const result = () => ({
    schema_version: 1,
    scope: 'ローカルプレビューの事前条件のみ。統合動作の合格判定ではありません。',
    status: checks.some((check) => check.status === 'fail') ? 'needs_attention' : 'checked',
    checks,
    unchecked: UNCHECKED,
    privacy:
      'ファイル変更・認証トークン作成・生成リクエストは行いません。秘密値とサーバー応答本文は出力しません。',
  });
  add(
    'macos',
    platform === 'darwin' ? 'pass' : 'fail',
    platform === 'darwin'
      ? 'Macで実行しています。OSバージョンと配布アプリの対応は別途確認してください。'
      : 'ネイティブMac版の診断です。macOS 14以降のMacで実行してください。',
  );
  add(
    'node',
    Number(nodeVersion.split('.')[0]) >= 22 ? 'pass' : 'fail',
    Number(nodeVersion.split('.')[0]) >= 22 ? 'Node 22以降です。' : 'Node 22以降が必要です。',
  );

  let manifest;
  try {
    manifest = JSON.parse(await readFile(resolve(repo, 'package.json'), 'utf8'));
  } catch {
    /* bounded report below */
  }
  if (
    !['genie', 'astra'].includes(manifest?.name) ||
    !(await exists(resolve(repo, 'scripts/start-local-host.mjs'))) ||
    !(await exists(resolve(repo, 'infra/docker-compose.dev.yml')))
  ) {
    add(
      'checkout',
      'fail',
      'Genieのチェックアウトが見つかりません。--repoにv0.1.4をcloneしたフォルダを指定してください。',
    );
    return result();
  }
  const revision = await run('git', ['-C', repo, 'describe', '--tags', '--exact-match', 'HEAD']);
  const tag = revision.ok && /^v\d+\.\d+\.\d+$/.test(revision.stdout) ? revision.stdout : null;
  add(
    'checkout',
    tag === 'v0.1.4' ? 'pass' : 'warn',
    tag === 'v0.1.4'
      ? 'チェックアウトはv0.1.4です。未コミット変更の互換性は検査しません。'
      : 'v0.1.4タグ上と確認できません。配布アプリとソースの対応を確認してください。',
  );

  const envExists = await exists(resolve(repo, '.env'));
  add(
    'env_file',
    envExists ? 'pass' : 'fail',
    envExists
      ? '.envがあります。ローカル接続先に関する5項目だけを読み取ります。'
      : '.envがありません。既存の設定がないことを確認してから用意してください。',
    envExists ? [] : ['cp .env.example .env'],
  );
  const config = envExists ? selectedConfig(await readFile(resolve(repo, '.env'), 'utf8')) : {};
  const localBinding = ['127.0.0.1', 'localhost', '::1'].includes(config.ASTRA_API_HOST);
  add(
    'gateway_binding',
    localBinding ? 'pass' : 'fail',
    localBinding
      ? '.envにloopbackの待受設定があります。実際の起動時の環境上書きは未検査です。'
      : '.envに明示的なloopback待受設定がありません。ASTRA_API_HOST=127.0.0.1を設定してください。未設定時のGatewayは外部から到達可能な待受が既定です。',
  );
  const gateway = localEndpoint(
    options.gateway ?? config.ASTRA_API_URL ?? 'http://127.0.0.1:3000',
    true,
  );
  const modelURL = localEndpoint(
    options.modelURL ?? config.ASTRA_LOCAL_LLM_URL ?? 'http://127.0.0.1:11434/v1',
  );
  const model = options.model ?? config.ASTRA_LOCAL_LLM_MODEL ?? 'qwen3.5:9b';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,150}$/.test(model))
    throw new Error('モデル名の形式を確認してください。');
  const temporal = localEndpoint(`http://${config.TEMPORAL_ADDRESS ?? 'localhost:7233'}`, true);
  const temporalURL = new URL(temporal);

  const tools = [
    ['pnpm', 'pnpm', ['--version'], 'pnpm 10.12.2を用意してください。'],
    [
      'docker_compose',
      'docker',
      ['compose', 'version', '--short'],
      'Docker Desktop等を起動し、docker composeを使える状態にしてください。',
    ],
    ['dbmate', 'dbmate', ['--version'], 'dbmateを用意してください。'],
    [
      'psql',
      'psql',
      ['--version'],
      'PostgreSQLクライアントのpsqlをPATHで使える状態にしてください。',
    ],
    ['xcode_cli', 'xcode-select', ['-p'], 'Xcode Command Line Toolsを用意してください。'],
  ];
  const toolResults = await Promise.all(
    tools.map(async ([id, bin, args, missing]) => {
      const output = await run(bin, args);
      const ok = output.ok && (id !== 'pnpm' || output.stdout === '10.12.2');
      return [id, ok ? 'pass' : 'fail', ok ? `${id}を利用できます。` : missing];
    }),
  );
  toolResults.forEach((row) => add(...row));
  const installed = await exists(resolve(repo, 'node_modules/.bin/tsx'));
  add(
    'dependencies',
    installed ? 'pass' : 'fail',
    installed
      ? 'tsxが見つかりました。依存全体の整合性は検査していません。'
      : 'チェックアウトにtsxがありません。依存をインストールしてください。',
    installed ? [] : ['pnpm install'],
  );
  const built = await exists(resolve(repo, 'packages/contracts/dist/index.js'));
  add(
    'build',
    built ? 'pass' : 'fail',
    built
      ? 'contractsのビルド出力があります。鮮度は検査していません。'
      : 'ビルド出力がありません。DBの準備後にビルドしてください。',
    built ? [] : ['pnpm build'],
  );

  const [ready, models, temporalReachable] = await Promise.all([
    request(`${gateway}/readyz`, timeout),
    request(`${modelURL}/models`, timeout),
    connect(temporalURL.hostname, Number(temporalURL.port || 80), timeout),
  ]);
  if (ready.body?.checks && typeof ready.body.checks === 'object') {
    for (const id of ['database', 'redis']) {
      const state = ready.body.checks[id];
      if (state === undefined) continue;
      add(
        id,
        state === 'ok' ? 'pass' : 'fail',
        state === 'ok'
          ? `Gatewayから${id}へ到達できます。`
          : `Gatewayの${id}検査が通りません。ローカルサービスと設定を確認してください。`,
        state === 'ok' ? [] : ['pnpm dev:infra'],
      );
    }
  }
  const gatewayReady =
    ready.ok &&
    ready.body?.status === 'ok' &&
    ready.body?.checks?.database === 'ok' &&
    (ready.body.checks.redis === undefined || ready.body.checks.redis === 'ok');
  add(
    'gateway',
    gatewayReady ? 'pass' : 'fail',
    gatewayReady
      ? 'Gatewayの/readyzが応答しました。Workerの確認は含みません。'
      : 'Gatewayの依存確認が通りません。Gateway未起動・依存停止・設定違いを確認してください。',
    gatewayReady ? [] : ['node --env-file=.env --import tsx services/api-gateway/src/server.ts'],
  );
  add(
    'temporal_port',
    temporalReachable ? 'pass' : 'fail',
    temporalReachable
      ? 'Temporal設定先のTCPポートに接続できます。Temporal API・Worker稼働は未確認です。'
      : 'Temporal設定先のTCPポートに接続できません。',
    temporalReachable ? [] : ['pnpm dev:infra'],
  );
  const modelFound =
    models.ok &&
    Array.isArray(models.body?.data) &&
    models.body.data.some((entry) => entry?.id === model);
  add(
    'model',
    modelFound ? 'pass' : 'fail',
    modelFound
      ? '選択したモデルがローカル一覧にあります。生成・画像対応・速度は未検査です。'
      : 'ローカルモデル一覧から選択モデルを確認できません。Ollamaの起動とモデルを確認してください。',
    modelFound ? [] : ['open -a Ollama', `ollama pull ${model}`],
  );

  const identity =
    platform === 'darwin'
      ? await run('defaults', ['read', 'com.astra.desktop', `astra.dev.identity.${gateway}`])
      : { ok: false, stdout: '' };
  const identityFound = identity.ok && /^[a-z0-9-]{1,80}$/i.test(identity.stdout);
  add(
    'desktop_identity',
    identityFound ? 'pass' : 'fail',
    identityFound
      ? 'Macアプリの識別情報があります。値と認証トークンは出力しません。'
      : 'このGateway用のMacアプリ識別情報がありません。Gateway起動後、GenieのHomeを一度開いてください。',
    identityFound ? [] : ['open -a Genie'],
  );
  return result();
}

export function parseArgs(args) {
  const options = {};
  const flags = {
    '--repo': 'repo',
    '--gateway': 'gateway',
    '--model-url': 'modelURL',
    '--model': 'model',
  };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--json') options.json = true;
    else if (flag === '--help' || flag === '-h') options.help = true;
    else if (flags[flag] && args[index + 1] && !args[index + 1].startsWith('--'))
      options[flags[flag]] = args[++index];
    else throw new Error('オプションを確認してください。--helpで使い方を表示できます。');
  }
  return options;
}
export function render(report) {
  const markers = { pass: 'OK', fail: '要対応', warn: '確認' };
  return [
    'Genie ローカルプレビュー診断',
    report.scope,
    ...report.checks.flatMap((check) => [
      `[${markers[check.status]}] ${check.id}: ${check.detail}`,
      ...check.next.map((next) => `  次の操作（チェックアウト内で）: ${next}`),
    ]),
    '',
    '未確認:',
    ...report.unchecked.map((item) => `- ${item}`),
    '',
    report.status === 'checked'
      ? '今回の事前検査は通りました。Worker・Hostの起動と、アプリでの最初の依頼は別途確認してください。'
      : '要対応の項目があります。準備途中の初回診断では、この表示が正常です。',
    report.privacy,
  ].join('\n');
}
async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(
        '使い方: node doctor-local-preview.mjs --repo /path/to/genie-preview [--json]\n任意: --gateway http://127.0.0.1:3000 --model-url http://127.0.0.1:11434/v1 --model qwen3.5:9b\n.envのローカル接続設定を使用。シェル環境の設定は読み込みません。カスタム接続先はオプションで指定してください。\n終了コード: 0=検査対象を確認（未検査項目あり）、1=要対応、2=引数・設定・検査エラー。\nファイル変更・モデル生成・認証操作はしません。',
      );
      return;
    }
    const report = await diagnose(options);
    console.log(options.json ? JSON.stringify(report, null, 2) : render(report));
    process.exitCode = report.status === 'checked' ? 0 : 1;
  } catch {
    // Never echo supplied arguments, config values, child stderr, or HTTP bodies.
    console.error(
      '診断を完了できません。--helpを確認し、ローカル接続先・.envの書式・フォルダへのアクセスを確認してください。秘密値は出力していません。',
    );
    process.exitCode = 2;
  }
}
// Node resolves module paths through symlinks, but argv can retain /tmp (which is
// /private/tmp on macOS), another linked directory, or a renamed downloaded file.
// Compare physical paths on both sides without running the CLI when imported.
if (process.argv[1]) {
  const invokedPath = await realpath(resolve(process.argv[1])).catch(() => null);
  const modulePath = await realpath(fileURLToPath(import.meta.url)).catch(() => null);
  if (invokedPath && invokedPath === modulePath) await main();
}
