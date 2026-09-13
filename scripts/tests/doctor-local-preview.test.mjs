import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  diagnose,
  localEndpoint,
  parseArgs,
  render,
  readOnlyCommand,
} from '../doctor-local-preview.mjs';

const exec = promisify(execFile);
const secret = 'DO-NOT-PRINT-this-test-secret';
async function fixture(t, { ready = true, models = ['qwen3.5:9b'], redirect = false } = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'genie-doctor-test-'));
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (redirect) {
      res.writeHead(302, { location: `http://example.invalid/${secret}` });
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/readyz') {
      res.statusCode = ready ? 200 : 503;
      res.end(
        JSON.stringify({
          status: ready ? 'ok' : 'down',
          checks: { database: ready ? 'ok' : 'down', redis: 'ok' },
          error: secret,
        }),
      );
    } else if (req.url === '/v1/models') {
      res.end(JSON.stringify({ data: models.map((id) => ({ id, credentials: secret })) }));
    } else {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: secret }));
    }
  });
  await new Promise((accept) => server.listen(0, '127.0.0.1', accept));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((accept) => server.close(accept));
    await rm(repo, { recursive: true, force: true });
  });
  const port = server.address().port;
  const endpoint = `http://127.0.0.1:${port}`;
  for (const dir of ['scripts', 'infra', 'node_modules/.bin', 'packages/contracts/dist'])
    await mkdir(join(repo, dir), { recursive: true });
  for (const file of [
    'scripts/start-local-host.mjs',
    'infra/docker-compose.dev.yml',
    'node_modules/.bin/tsx',
    'packages/contracts/dist/index.js',
  ])
    await writeFile(join(repo, file), 'fixture');
  await writeFile(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'genie', packageManager: 'pnpm@10.12.2' }),
  );
  const env = `DATABASE_URL=postgres://test:${secret}@localhost/db\nASTRA_API_HOST=127.0.0.1\nASTRA_API_URL=${endpoint}\nASTRA_LOCAL_LLM_URL=${endpoint}/v1\nTEMPORAL_ADDRESS=127.0.0.1:${port}\n`;
  await writeFile(join(repo, '.env'), env);
  const commands = [];
  const dependencies = {
    platform: 'darwin',
    nodeVersion: '22.0.0',
    command: async (file, args) => {
      commands.push([file, args]);
      return {
        ok: true,
        stdout:
          file === 'pnpm'
            ? '10.12.2'
            : file === 'git'
              ? 'v0.1.4'
              : file === 'defaults'
                ? 'fixture-identity'
                : 'available',
      };
    },
  };
  return { repo, env, server, requests, commands, dependencies, endpoint };
}

test('healthy HTTP fixtures only perform reads and retain explicit untested areas', async (t) => {
  const f = await fixture(t);
  const report = await diagnose({ repo: f.repo, timeout: 500 }, f.dependencies);
  assert.equal(report.status, 'checked');
  assert.match(report.unchecked.join(' '), /Task Worker/);
  assert.match(report.unchecked.join(' '), /Agent Host/);
  assert.match(render(report), /統合動作の合格判定ではありません/);
  assert.deepEqual(f.requests.sort(), ['GET /readyz', 'GET /v1/models']);
  assert.equal(await readFile(join(f.repo, '.env'), 'utf8'), f.env);
  assert(!JSON.stringify(report).includes(secret));
  assert(!JSON.stringify(report).includes('fixture-identity'));
  assert(
    f.commands.every(([file]) =>
      ['git', 'pnpm', 'docker', 'dbmate', 'psql', 'xcode-select', 'defaults'].includes(file),
    ),
  );
  assert(
    !f.commands.some(
      ([, args]) => args.includes('install') || args.includes('up') || args.includes('write'),
    ),
  );
});

test('a running gateway with a stopped database does not pass', async (t) => {
  const f = await fixture(t, { ready: false });
  const report = await diagnose({ repo: f.repo }, f.dependencies);
  assert.equal(report.status, 'needs_attention');
  assert.equal(report.checks.find((item) => item.id === 'database').status, 'fail');
  assert.equal(report.checks.find((item) => item.id === 'gateway').status, 'fail');
  assert(!render(report).includes(secret));
  assert(!f.requests.includes('GET /healthz'));
});

test('services not started produce actionable failures rather than thrown network errors', async (t) => {
  const f = await fixture(t);
  const closedPort = f.server.address().port;
  await new Promise((accept) => f.server.close(accept));
  const report = await diagnose(
    {
      repo: f.repo,
      gateway: `http://127.0.0.1:${closedPort}`,
      modelURL: `http://127.0.0.1:${closedPort}/v1`,
      timeout: 300,
    },
    f.dependencies,
  );
  assert.equal(report.status, 'needs_attention');
  for (const id of ['gateway', 'model', 'temporal_port']) {
    const item = report.checks.find((entry) => entry.id === id);
    assert.equal(item.status, 'fail');
    assert(item.next.length > 0);
  }
});

test('a model missing from the list is not downloaded or generated automatically', async (t) => {
  const f = await fixture(t, { models: ['llama3.2', secret] });
  const report = await diagnose({ repo: f.repo }, f.dependencies);
  assert.equal(report.checks.find((entry) => entry.id === 'model').status, 'fail');
  assert(!JSON.stringify(report).includes(secret));
  assert.deepEqual(f.requests.sort(), ['GET /readyz', 'GET /v1/models']);
});

test('HTTP redirects are rejected without following or printing the destination', async (t) => {
  const f = await fixture(t, { redirect: true });
  const report = await diagnose({ repo: f.repo, timeout: 300 }, f.dependencies);
  assert.equal(report.status, 'needs_attention');
  assert(!JSON.stringify(report).includes(secret));
  assert.deepEqual(f.requests.sort(), ['GET /readyz', 'GET /v1/models']);
});

test('remote, credential-bearing and shell-interpolated inputs cannot trigger requests', async (t) => {
  const f = await fixture(t);
  for (const input of [
    'https://example.com',
    `http://me:${secret}@localhost:3000`,
    `http://localhost:3000?token=${secret}`,
    'http://localhost.example.com',
    'http://127.0.0.1/path',
  ]) {
    await assert.rejects(diagnose({ repo: f.repo, gateway: input }, f.dependencies));
  }
  await assert.rejects(diagnose({ repo: f.repo, model: 'qwen; touch /tmp/never' }, f.dependencies));
  assert.deepEqual(f.requests, []);
  assert.equal(await readFile(join(f.repo, '.env'), 'utf8'), f.env);
  assert.equal(localEndpoint('http://[::1]:11434/v1'), 'http://[::1]:11434/v1');
});

test('missing tools and build outputs are reported together', async (t) => {
  const f = await fixture(t);
  await rm(join(f.repo, 'node_modules'), { recursive: true });
  await rm(join(f.repo, 'packages/contracts/dist'), { recursive: true });
  const original = f.dependencies.command;
  f.dependencies.command = async (file, args) =>
    ['dbmate', 'psql'].includes(file) ? { ok: false, stdout: secret } : original(file, args);
  const report = await diagnose({ repo: f.repo }, f.dependencies);
  for (const id of ['dbmate', 'psql', 'dependencies', 'build'])
    assert.equal(report.checks.find((entry) => entry.id === id).status, 'fail');
  assert(!JSON.stringify(report).includes(secret));
});

test('an omitted or externally bound API_HOST fails even when readiness responds', async (t) => {
  const f = await fixture(t);
  for (const replacement of ['', 'ASTRA_API_HOST=0.0.0.0\n']) {
    await writeFile(join(f.repo, '.env'), f.env.replace('ASTRA_API_HOST=127.0.0.1\n', replacement));
    const report = await diagnose({ repo: f.repo }, f.dependencies);
    assert.equal(report.checks.find((entry) => entry.id === 'gateway_binding').status, 'fail');
    assert.equal(report.status, 'needs_attention');
    assert.equal(report.checks.find((entry) => entry.id === 'gateway').status, 'pass');
  }
});

test('CLI probes disable Corepack provisioning, pnpm version switching, and git optional locks', async () => {
  const original = process.env.COREPACK_ENABLE_NETWORK;
  const response = await readOnlyCommand(process.execPath, [
    '-e',
    `
    const env = process.env;
    if (env.COREPACK_ENABLE_NETWORK !== '0'
      || env.COREPACK_ENABLE_AUTO_PIN !== '0'
      || env.COREPACK_DEFAULT_TO_LATEST !== '0'
      || env.npm_config_manage_package_manager_versions !== 'false'
      || env.GIT_OPTIONAL_LOCKS !== '0') process.exit(1);
    process.stdout.write('read-only-probe');
  `,
  ]);
  assert.deepEqual(response, { ok: true, stdout: 'read-only-probe' });
  assert.equal(process.env.COREPACK_ENABLE_NETWORK, original);
});

test('standalone CLI has help, structured missing-checkout output, and distinct misuse exit code', async () => {
  const path = new URL('../doctor-local-preview.mjs', import.meta.url).pathname;
  const help = await exec(process.execPath, [path, '--help']);
  assert.match(help.stdout, /終了コード/);
  await assert.rejects(
    exec(process.execPath, [path, '--repo', '/does-not-exist/genie', '--json']),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(JSON.parse(error.stdout).status, 'needs_attention');
      return true;
    },
  );
  await assert.rejects(exec(process.execPath, [path, '--unknown', secret]), (error) => {
    assert.equal(error.code, 2);
    assert(!error.stderr.includes(secret));
    return true;
  });
  assert.throws(() => parseArgs(['--repo']));
});

test('renamed standalone downloads run through a symlink directory and remain inert on import', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'genie-doctor-launch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const physical = join(root, 'downloaded files');
  const linked = join(root, 'download-link');
  await mkdir(physical);
  await symlink(physical, linked, 'dir');
  const filename = 'genie-doctor-downloaded.mjs';
  await copyFile(
    fileURLToPath(new URL('../doctor-local-preview.mjs', import.meta.url)),
    join(physical, filename),
  );
  const entry = join(linked, filename);

  const help = await exec(process.execPath, [entry, '--help']);
  assert.match(help.stdout, /使い方/);
  assert.match(help.stdout, /終了コード/);
  assert.equal(help.stderr, '');
  await assert.rejects(
    exec(process.execPath, [entry, '--repo', join(root, 'missing'), '--json']),
    (error) => {
      assert.equal(error.code, 1);
      const report = JSON.parse(error.stdout);
      assert.equal(report.status, 'needs_attention');
      assert.equal(report.checks.find((check) => check.id === 'checkout').status, 'fail');
      return true;
    },
  );

  const importer = join(root, 'import-only.mjs');
  await writeFile(
    importer,
    `await import(${JSON.stringify(pathToFileURL(entry).href)});\nconsole.log('import-only');\n`,
  );
  const imported = await exec(process.execPath, [importer]);
  assert.equal(imported.stdout, 'import-only\n');
  assert.equal(imported.stderr, '');
});
