// S07: replay README setup with fresh dependencies and an ephemeral Compose
// project. No private .env, retained application volumes, or provider calls.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'aka-setup-'));
const project = `aka-s07-setup-${randomBytes(8).toString('hex')}`;
const envFile = join(root, 'compose.env');
const override = join(root, 'compose.yaml');
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
const ports = [await freePort(), await freePort(), await freePort()];
const compose = [
  'compose',
  '--env-file',
  envFile,
  '-f',
  'compose.yaml',
  '-f',
  override,
  '-p',
  project,
];
const env = { ...process.env };
for (const key of [
  'POSTGRES_PASSWORD',
  'RUNTIME_DB_PASSWORD',
  'DB_PORT',
  'API_PORT',
  'PORT',
  'OPENAI_API_KEY',
  'OPENAI_CHAT_MODEL',
  'OPENAI_EMBEDDING_MODEL',
  'EMBEDDING_DIMENSIONS',
  'EMBEDDING_PROFILE_ID',
  'PIPELINE_VERSION',
])
  delete env[key];
function run(command, args, runCwd = cwd, capture = false) {
  const result = spawnSync(command, args, {
    cwd: runCwd,
    env,
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`Setup check failed: ${command}.`);
  return result.stdout;
}
let started = false;
try {
  const fresh = join(root, 'install');
  mkdirSync(fresh);
  for (const file of [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    '.npmrc',
    'apps/api/package.json',
    'apps/web/package.json',
    'packages/shared/package.json',
  ]) {
    mkdirSync(dirname(join(fresh, file)), { recursive: true });
    copyFileSync(join(cwd, file), join(fresh, file));
  }
  run('pnpm', ['install', '--frozen-lockfile'], fresh);
  console.log(
    'Fresh frozen-lockfile install passed in an empty temporary workspace.',
  );
  writeFileSync(
    envFile,
    `POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}\nRUNTIME_DB_PASSWORD=${randomBytes(24).toString('hex')}\nDB_PORT=${ports[0]}\nAPI_PORT=${ports[1]}\nPORT=${ports[2]}\nOPENAI_API_KEY=configuration-only-never-sent\nOPENAI_CHAT_MODEL=gpt-5.4-mini-2026-03-17\n`,
    { mode: 0o600 },
  );
  // Preserve production definitions, builds and healthchecks; replace only
  // persistence for this one project. Compose !override requires >=2.24.4.
  writeFileSync(
    override,
    `services:\n  db:\n    volumes: !override\n      - ${join(cwd, 'infra/postgres/init-runtime.sh')}:/docker-entrypoint-initdb.d/10-runtime.sh:ro\n    tmpfs:\n      - /var/lib/postgresql\n  api:\n    volumes: !reset []\n    tmpfs:\n      - /data/documents:uid=1000,gid=1000,mode=0700\n`,
  );
  run('docker', [...compose, 'config', '--quiet']);
  started = true;
  run('docker', [...compose, 'up', '-d', '--wait', 'db']);
  run('docker', [
    ...compose,
    '--profile',
    'tools',
    'run',
    '--rm',
    '--build',
    'migrate',
  ]);
  run('docker', [
    ...compose,
    'up',
    '--build',
    '-d',
    '--wait',
    '--wait-timeout',
    '120',
  ]);
  const json = async (path) => {
    const response = await globalThis.fetch(
      `http://localhost:${ports[1]}${path}`,
      {
        signal: globalThis.AbortSignal.timeout(10000),
        headers: { Connection: 'close' },
      },
    );
    assert.equal(response.status, 200);
    return response.json();
  };
  await json('/api/health');
  await json('/api/health/ready');
  assert.equal((await json('/api/documents')).data.items.length, 0);
  for (const path of ['/documents', '/ask']) {
    const response = await globalThis.fetch(
      `http://localhost:${ports[2]}${path}`,
      {
        signal: globalThis.AbortSignal.timeout(10000),
        headers: { Connection: 'close' },
      },
    );
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes('OpenAI'));
  }
  const bindings = JSON.parse(
    run('docker', [...compose, 'config', '--format', 'json'], cwd, true),
  );
  for (const name of ['db', 'api', 'web'])
    for (const p of bindings.services[name].ports)
      assert.equal(p.host_ip, '127.0.0.1');
  run('docker', [...compose, 'restart', 'api']);
  run('docker', [...compose, 'up', '-d', '--wait', '--wait-timeout', '120']);
  await json('/api/health/ready');
  console.log(
    'Fresh Compose builds/migration/health/readiness/two screens/restart/loopback bindings passed. Configuration-only AI placeholder; zero provider calls.',
  );
} finally {
  if (started) {
    const result = spawnSync(
      'docker',
      [...compose, 'down', '--remove-orphans'],
      { cwd, env, stdio: 'inherit' },
    );
    if (result.status !== 0) process.exitCode = 1;
  }
  rmSync(root, { recursive: true, force: true });
}
