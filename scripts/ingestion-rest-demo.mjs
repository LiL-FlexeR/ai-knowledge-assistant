import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setImmediate as immediate } from 'node:timers/promises';
import {
  assertOwnedTestDatabase,
  assertOwnedTestStorage,
} from './test-target.mjs';

// Called only by the isolated integration harness. Never read the private .env.
assertOwnedTestDatabase(process.env.DATABASE_URL, {
  database: process.env.AKA_TEST_DATABASE,
  port: Number(process.env.AKA_TEST_PORT),
});
assertOwnedTestStorage(process.env.STORAGE_ROOT, process.env.STORAGE_ROOT);
const root = await mkdtemp(join(process.env.STORAGE_ROOT, 'ingestion-rest-'));
const require = createRequire(
  new URL('../apps/api/package.json', import.meta.url),
);
require('reflect-metadata');
const { Test } = require('@nestjs/testing');
const { AppModule } = require('./dist/app.module.js');
const { API_CONFIG } = require('./dist/config/config.module.js');
const { parseEnvironment } = require('./dist/config/environment.js');
const { configureHttp } = require('./dist/http.js');
const { DatabaseService } = require('./dist/database/database.service.js');
const { EmbeddingClient } = require('./dist/modules/ai/embedding-client.js');
const {
  IngestionRunner,
} = require('./dist/modules/ingestion/ingestion-runner.js');
const { ProcessingFailure } = require('./dist/processing-error.js');
let handler;
const fake = {
  embed: async (inputs, signal) =>
    handler
      ? handler(inputs, signal)
      : {
          vectors: inputs.map(() => [1, ...Array(1535).fill(0)]),
          inputTokens: inputs.reduce((n, item) => n + item.tokenCount, 0),
        },
};
const config = {
  ...parseEnvironment(process.env),
  STORAGE_ROOT: root,
  OPENAI_API_KEY: 'fake-rest-only',
  INGESTION_POLL_MS: 60000,
  UPLOAD_REQUESTS_PER_MINUTE: 10,
};
const module = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(API_CONFIG)
  .useValue(config)
  .overrideProvider(EmbeddingClient)
  .useValue(fake)
  .compile();
const app = module.createNestApplication({ bodyParser: false, logger: false });
configureHttp(app);
const run = promisify(execFile);
try {
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/documents`;
  const runner = app.get(IngestionRunner);
  const db = app.get(DatabaseService).client;
  const fixtures = fileURLToPath(
    new URL('../apps/api/test/fixtures/', import.meta.url),
  );
  async function curl(path, expected, args = []) {
    const { stdout } = await run('curl', [
      '--silent',
      '--show-error',
      '--max-time',
      '15',
      ...args,
      '--write-out',
      '\n%{http_code}',
      `${path.startsWith('/search') ? base.replace(/\/documents$/, '') : base}${path}`,
    ]);
    const index = stdout.lastIndexOf('\n');
    assert.equal(Number(stdout.slice(index + 1)), expected);
    const text = stdout.slice(0, index).trim();
    return text ? JSON.parse(text).data : undefined;
  }
  const ids = [];
  for (const name of ['notes.txt', 'handbook.pdf', 'policy.md']) {
    const uploaded = await curl('', 201, [
      '-F',
      `file=@${join(fixtures, name)}`,
    ]);
    ids.push(uploaded.id);
    assert.equal(uploaded.status, 'pending');
    await runner.tick();
    const ready = await curl(`/${uploaded.id}`, 200);
    assert.equal(ready.status, 'ready');
    console.log(
      `curl ${name}: 201/pending → 200/ready (${ready.chunkCount} chunks)`,
    );
    if (name.endsWith('.pdf')) {
      const chunks =
        await db.$queryRaw`SELECT source_location FROM document_chunks WHERE document_id = ${uploaded.id}::uuid ORDER BY chunk_index`;
      assert.deepEqual(
        chunks.map((row) => row.source_location.page),
        [1, 2],
      );
      console.log('Stored PDF physical source pages: 1, 2.');
    }
  }
  const query = (body) =>
    curl('/search', 200, [
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify(body),
    ]);
  const hits = await query({ query: 'maintenance window', topK: 5 });
  assert.equal(hits.status, 'results');
  assert.ok(
    hits.results.some((hit) => hit.source.location.kind === 'markdown'),
  );
  console.log(
    'curl POST /api/search: 200/results with stored Markdown location and score.',
  );
  const pdfHits = await query({
    query: 'maintenance window',
    documentIds: [ids[1]],
  });
  assert.ok(pdfHits.results.length > 0);
  assert.ok(
    pdfHits.results.every(
      (hit) =>
        hit.source.documentId === ids[1] && hit.source.location.kind === 'pdf',
    ),
  );
  console.log('curl document-filtered search: only stored PDF pages returned.');
  handler = async () => ({
    vectors: [[0, 1, ...Array(1534).fill(0)]],
    inputTokens: 2,
  });
  assert.equal(
    (await query({ query: 'unrelated synthetic direction' })).reason,
    'NO_RELEVANT_CONTEXT',
  );
  handler = undefined;
  const scanned = await curl('', 201, [
    '-F',
    `file=@${join(fixtures, 'scanned.pdf')}`,
  ]);
  ids.push(scanned.id);
  await runner.tick();
  assert.equal(
    (await curl(`/${scanned.id}`, 200)).processingError.code,
    'NO_EXTRACTABLE_TEXT',
  );
  console.log('curl image-only PDF: 201/pending → failed/NO_EXTRACTABLE_TEXT.');
  handler = async () => {
    throw new ProcessingFailure(
      'AI_UPSTREAM_ERROR',
      'Synthetic transient failure.',
      true,
    );
  };
  const retry = await curl('', 201, [
    '-F',
    `file=@${join(fixtures, 'notes.txt')}`,
  ]);
  ids.push(retry.id);
  await runner.tick();
  assert.equal((await curl(`/${retry.id}`, 200)).status, 'failed');
  handler = undefined;
  assert.equal(
    (await curl(`/${retry.id}/reprocess`, 202, ['-X', 'POST'])).status,
    'pending',
  );
  await runner.tick();
  assert.equal((await curl(`/${retry.id}`, 200)).status, 'ready');
  console.log(
    'curl transient failure → 202/reprocess → ready with a new complete generation.',
  );
  for (const id of ids) await curl(`/${id}`, 204, ['-X', 'DELETE']);
  handler = async () => {
    throw new Error('Empty corpus must skip embedding.');
  };
  assert.equal(
    (await query({ query: 'maintenance window' })).reason,
    'NO_READY_DOCUMENTS',
  );
  console.log(
    'curl unrelated/empty corpus: NO_RELEVANT_CONTEXT / NO_READY_DOCUMENTS.',
  );
  let entered;
  const called = new Promise((resolve) => {
    entered = resolve;
  });
  let release;
  let cancelled = false;
  handler = (_inputs, signal) =>
    new Promise((resolve) => {
      release = resolve;
      signal.addEventListener(
        'abort',
        () => {
          cancelled = true;
        },
        { once: true },
      );
      entered();
    });
  const deleting = await curl('', 201, [
    '-F',
    `file=@${join(fixtures, 'notes.txt')}`,
  ]);
  const running = runner.tick();
  await called;
  await curl(`/${deleting.id}`, 204, ['-X', 'DELETE']);
  await running;
  assert.equal(cancelled, true);
  release({ vectors: [[1, ...Array(1535).fill(0)]], inputTokens: 1 });
  await immediate();
  assert.equal(await db.document.count(), 0);
  assert.equal(await db.documentChunk.count(), 0);
  assert.deepEqual(await readdir(root), []);
  console.log(
    'curl delete during processing: 204; provider cancelled; no resurrected rows/chunks/files.',
  );
  console.log(
    'S03/S04 curl demos passed with fake AI; no provider calls or semantic-quality claims.',
  );
} finally {
  await app.close();
  await rm(root, { recursive: true, force: true });
}
