import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// Resolve from this file, never the child workspace's working directory.
try {
  loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.error(
      'Unable to load root .env; check file syntax and permissions.',
    );
    process.exit(1);
  }
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Expected a command to run with the root environment.');
  process.exit(1);
}
const child = spawn(command, args, { stdio: 'inherit', env: process.env });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', () => {
  console.error('Unable to start workspace command.');
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
});
