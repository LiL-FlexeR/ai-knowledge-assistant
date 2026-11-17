import { strict as assert } from 'node:assert';
import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  assertOwnedTestDatabase,
  assertOwnedTestStorage,
} from './test-target.mjs';

// Run only inside the harness's disposable database/storage, never the root .env.
assertOwnedTestDatabase(process.env.DATABASE_URL, {
  database: process.env.AKA_TEST_DATABASE,
  port: Number(process.env.AKA_TEST_PORT),
});
assertOwnedTestStorage(process.env.STORAGE_ROOT, process.env.STORAGE_ROOT);
const fixtureRoot = await mkdtemp(join(process.env.STORAGE_ROOT, 'rest-demo-'));
const originals = join(fixtureRoot, 'originals');
const originalRoot = process.env.STORAGE_ROOT;
process.env.STORAGE_ROOT = originals;
const require = createRequire(
  new URL('../apps/api/package.json', import.meta.url),
);
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module.js');
const { configureHttp } = require('./dist/http.js');
const { DatabaseService } = require('./dist/database/database.service.js');
const { parseEnvironment } = require('./dist/config/environment.js');
const app = await NestFactory.create(AppModule, {
  bodyParser: false,
  logger: false,
});
configureHttp(app);
const run = promisify(execFile);
try {
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/documents`;
  const txt = join(fixtureRoot, 'synthetic-notes.txt');
  const unsupported = join(fixtureRoot, 'unsupported.exe');
  const oversized = join(fixtureRoot, 'oversized.txt');
  await writeFile(
    txt,
    'Synthetic notes: the maintenance window is Sunday at 02:00 UTC.\n',
  );
  await writeFile(unsupported, 'unsupported');
  await writeFile(
    oversized,
    Buffer.alloc(parseEnvironment(process.env).MAX_UPLOAD_BYTES + 1, 'a'),
  );
  async function curl(args, expected) {
    const { stdout } = await run('curl', [
      '--silent',
      '--show-error',
      '--max-time',
      '15',
      '-i',
      ...args,
    ]);
    const [firstHeaders, ...bodyParts] = stdout.split('\r\n\r\n');
    let headers = firstHeaders;
    // curl may include an informational 100 Continue before the final response.
    while (Number(headers.split(' ')[1]) < 200) headers = bodyParts.shift();
    const status = Number(headers.split(' ')[1]);
    assert.equal(status, expected);
    console.log(
      `curl ${args.includes('-F') ? 'multipart POST' : args.includes('DELETE') ? 'DELETE' : 'GET'} → ${status}`,
    );
    const body = bodyParts.join('\r\n\r\n').trim();
    return body ? JSON.parse(body) : undefined;
  }
  const uploaded = await curl(['-F', `file=@${txt}`, base], 201);
  assert.equal(uploaded.data.status, 'pending');
  const listed = await curl([`${base}?limit=20`], 200);
  assert.equal(listed.data.items.length, 1);
  await curl([`${base}/${uploaded.data.id}`], 200);
  await curl(['-F', `file=@${unsupported}`, base], 415);
  await curl(['-F', `file=@${oversized}`, base], 413);
  await curl(['-X', 'DELETE', `${base}/${uploaded.data.id}`], 204);
  await curl(['-X', 'DELETE', `${base}/${uploaded.data.id}`], 204);
  assert.equal(await app.get(DatabaseService).client.document.count(), 0);
  assert.deepEqual(await readdir(originals), []);
  console.log(
    'S02 REST demo passed: pending upload/list/detail, invalid/oversize rejection, delete/repeated delete; no retained rows/files.',
  );
} finally {
  await app.close();
  process.env.STORAGE_ROOT = originalRoot;
  await rm(fixtureRoot, { recursive: true, force: true });
}
