import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const commands = {
  generate: ['generate'],
  migrate: ['migrate', 'deploy'],
  'migrate:dev': ['migrate', 'dev', '--create-only'],
};
const command = commands[process.argv[2]];
if (!command) {
  console.error('Expected generate, migrate, or migrate:dev.');
  process.exit(1);
}
if (process.argv[2] !== 'generate' && !process.env.MIGRATION_DATABASE_URL) {
  console.error('MIGRATION_DATABASE_URL is required for explicit migrations.');
  process.exit(1);
}
const result = spawnSync(
  'pnpm',
  ['exec', 'prisma', ...command, ...process.argv.slice(3)],
  {
    cwd: fileURLToPath(new URL('../apps/api', import.meta.url)),
    env: process.env,
    stdio: 'inherit',
  },
);
process.exitCode = result.status ?? 1;
