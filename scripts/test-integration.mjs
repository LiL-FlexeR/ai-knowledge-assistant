import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertOwnedTestDatabase,
  assertOwnedTestStorage,
} from './test-target.mjs';

// Never load root .env or accept externally supplied test/migration targets.
if (process.env.TEST_DATABASE_URL || process.env.TEST_STORAGE_ROOT) {
  console.error(
    'Integration targets are generated and owned by the harness; unset TEST_DATABASE_URL/TEST_STORAGE_ROOT.',
  );
  process.exit(1);
}
const runId = randomBytes(8).toString('hex');
const database = `aka_test_${runId}`;
const storage = mkdtempSync(join(tmpdir(), 'aka-integration-'));
const env = {
  ...process.env,
  NODE_ENV: 'test',
  OPENAI_API_KEY: '',
  OPENAI_CHAT_MODEL: '',
  AKA_TEST_DATABASE: database,
  AKA_TEST_PASSWORD: randomBytes(24).toString('hex'),
  AKA_TEST_RUNTIME_PASSWORD: randomBytes(24).toString('hex'),
  STORAGE_ROOT: storage,
  SHADOW_DATABASE_URL: '',
};
const cwd = fileURLToPath(new URL('..', import.meta.url));
const compose = [
  'compose',
  '-f',
  'compose.integration.yaml',
  '-p',
  `aka-s01-test-${runId}`,
];
function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0)
    throw new Error(`Integration command failed: ${command}.`);
  return result.stdout?.trim();
}
let started = false;
try {
  started = true;
  run('docker', [...compose, 'up', '-d', '--wait', '--wait-timeout', '90']);
  const binding = run('docker', [...compose, 'port', 'db-test', '5432'], true);
  const port = Number(binding.split(':').at(-1));
  if (!Number.isInteger(port) || port < 1)
    throw new Error('No isolated database port.');
  env.MIGRATION_DATABASE_URL = `postgresql://aka_test_migrator:${env.AKA_TEST_PASSWORD}@127.0.0.1:${port}/${database}`;
  env.DATABASE_URL = `postgresql://aka_runtime:${env.AKA_TEST_RUNTIME_PASSWORD}@127.0.0.1:${port}/${database}`;
  env.TEST_DATABASE_URL = env.MIGRATION_DATABASE_URL;
  env.AKA_TEST_PORT = String(port);
  assertOwnedTestDatabase(env.TEST_DATABASE_URL, { database, port });
  assertOwnedTestDatabase(env.DATABASE_URL, { database, port });
  run('pnpm', ['db:generate']);
  run('pnpm', ['db:migrate']);
  // A second deploy must be a no-op, preserving the custom SQL/type.
  run('pnpm', ['db:migrate']);
  const introspected = run(
    'pnpm',
    ['--filter', '@aka/api', 'exec', 'prisma', 'db', 'pull', '--print'],
    true,
  );
  // Prisma 7 introspection reports the base vector type without its typmod.
  // Never overwrite the reviewed schema; SQL/readiness tests verify 1536.
  if (!/embedding\s+Unsupported\("vector(?:\(1536\))?"\)/.test(introspected)) {
    throw new Error(
      'Introspection did not preserve the required custom vector mapping.',
    );
  }
  run('pnpm', [
    '--filter',
    '@aka/api',
    'exec',
    'prisma',
    'migrate',
    'diff',
    '--from-config-datasource',
    '--to-schema',
    'prisma/schema.prisma',
    '--exit-code',
  ]);
  run('pnpm', ['db:generate']);
  run('pnpm', ['--filter', '@aka/shared', 'build']);
  run('pnpm', ['--filter', '@aka/api', 'test:integration']);
  run('pnpm', ['--filter', '@aka/api', 'build']);
  run('node', ['scripts/document-rest-demo.mjs']);
  run('node', ['scripts/ingestion-rest-demo.mjs']);
  run('pnpm', [
    '--filter',
    '@aka/api',
    'exec',
    'prisma',
    'migrate',
    'diff',
    '--from-config-datasource',
    '--to-schema',
    'prisma/schema.prisma',
    '--exit-code',
  ]);
  console.log(
    'Isolated migrations, runtime privileges, vectors, readiness, document lifecycle and REST demo passed.',
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (started) {
    const result = spawnSync(
      'docker',
      [...compose, 'down', '--remove-orphans'],
      { cwd, env, stdio: 'inherit' },
    );
    if (result.status !== 0) process.exitCode = 1;
  }
  assertOwnedTestStorage(storage, storage);
  rmSync(storage, { recursive: true });
}
