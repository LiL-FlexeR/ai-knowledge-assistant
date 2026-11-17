// Only invoked by the owned, disposable integration harness. No root .env.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  assertOwnedTestDatabase,
  assertOwnedTestStorage,
} from './test-target.mjs';

assertOwnedTestDatabase(process.env.DATABASE_URL, {
  database: process.env.AKA_TEST_DATABASE,
  port: Number(process.env.AKA_TEST_PORT),
});
assertOwnedTestStorage(process.env.STORAGE_ROOT, process.env.STORAGE_ROOT);
const require = createRequire(
  new URL('../apps/api/package.json', import.meta.url),
);
require('reflect-metadata');
const { Test } = require('@nestjs/testing');
const { AppModule } = require('./dist/app.module.js');
const { API_CONFIG } = require('./dist/config/config.module.js');
const { parseEnvironment } = require('./dist/config/environment.js');
const { configureHttp } = require('./dist/http.js');
const { EmbeddingClient } = require('./dist/modules/ai/embedding-client.js');
const {
  GroundedAnswerClient,
} = require('./dist/modules/ai/grounded-answer-client.js');
const { ProcessingFailure } = require('./dist/processing-error.js');
const socket = createServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
let failedOnce = false;
const config = {
  ...parseEnvironment(process.env),
  WEB_ORIGIN: origin,
  OPENAI_API_KEY: 'fake-browser-secret-canary',
  OPENAI_CHAT_MODEL: 'gpt-5.4-mini-2026-03-17',
  INGESTION_POLL_MS: 250,
};
const module = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(API_CONFIG)
  .useValue(config)
  .overrideProvider(EmbeddingClient)
  .useValue({
    embed: async (inputs) => {
      if (
        !failedOnce &&
        inputs.some((item) => item.content.includes('S06_TRANSIENT_ONCE'))
      ) {
        failedOnce = true;
        throw new ProcessingFailure(
          'AI_UPSTREAM_ERROR',
          'Synthetic provider failure. Reprocess to retry.',
          true,
        );
      }
      return {
        vectors: inputs.map(() => [1, ...Array(1535).fill(0)]),
        inputTokens: 10,
      };
    },
  })
  .overrideProvider(GroundedAnswerClient)
  .useValue({
    generate: async () => ({
      status: 'completed',
      output: {
        status: 'answered',
        statements: [
          { text: 'Maintenance is Sunday at 02:00 UTC.', sourceIds: ['S1'] },
        ],
        limitation: null,
      },
      inputTokens: 100,
      outputTokens: 20,
    }),
  })
  .compile();
const app = module.createNestApplication({ bodyParser: false, logger: false });
configureHttp(app);
let web;
async function run(command, args, env) {
  const child = spawn(command, args, {
    env,
    stdio: 'inherit',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
  });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`${command} failed (${code}).`);
}
try {
  await app.listen(0, '127.0.0.1');
  const apiOrigin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const env = {
    ...process.env,
    WEB_ORIGIN: origin,
    API_INTERNAL_URL: apiOrigin,
    PORT: String(port),
    NODE_ENV: 'production',
    AKA_E2E_BASE_URL: origin,
    OPENAI_API_KEY: 'fake-browser-secret-canary',
  };
  await run('pnpm', ['--filter', '@aka/web', 'build'], env);
  await run('node', ['scripts/check-web-bundle.mjs'], env);
  web = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      cwd: fileURLToPath(new URL('../apps/web', import.meta.url)),
      env,
      stdio: 'inherit',
    },
  );
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (web.exitCode !== null)
      throw new Error('Web server exited before startup.');
    try {
      ready = (await globalThis.fetch(`${origin}/documents`)).ok;
    } catch {
      /* starting */
    }
    if (ready) break;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 200));
  }
  if (!ready) throw new Error('Web server did not start.');
  await run('pnpm', ['--filter', '@aka/web', 'test:e2e'], env);
} finally {
  if (web && web.exitCode === null) {
    web.kill('SIGTERM');
    await once(web, 'exit');
  }
  await app.close();
}
