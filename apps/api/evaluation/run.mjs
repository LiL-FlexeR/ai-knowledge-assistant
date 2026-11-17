// Test-only orchestration of production modules; never imported by the API.
import { strict as assert } from 'node:assert';
import { Blob } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  assertOwnedTestDatabase,
  assertOwnedTestStorage,
} from '../../../scripts/test-target.mjs';
import {
  Budget,
  initialReport,
  intersects,
  metric,
  offlineConfig,
  reportSchema,
  retrievalMetrics,
  summarize,
  validateLiveConfig,
} from './core.mjs';
import {
  cases,
  corpusHash,
  corpusVersion,
  fixtureNames,
  fixturePath,
  goldSpans,
} from './corpus.mjs';

const mode = process.argv[2];
assert.ok(['offline', 'live'].includes(mode));
assert.equal(process.env.NODE_ENV, 'test');
assertOwnedTestDatabase(process.env.DATABASE_URL, {
  database: process.env.AKA_TEST_DATABASE,
  port: Number(process.env.AKA_TEST_PORT),
});
assertOwnedTestStorage(process.env.STORAGE_ROOT, process.env.STORAGE_ROOT);
const live = mode === 'live';
if (live) {
  assert.equal(process.env.AKA_EVAL_ALLOW_PAID, 'yes');
  assert.ok(process.env.OPENAI_API_KEY?.trim());
}
const limits = live
  ? validateLiveConfig(
      JSON.parse(process.env.AKA_EVAL_VALIDATED_CONFIG ?? 'null'),
    )
  : offlineConfig;
const report = initialReport(mode, limits);
const reportPath = process.env.AKA_EVAL_REPORT;
assert.ok(reportPath?.endsWith(`/evaluation/results/${mode}-latest.json`));
const budget = new Budget(limits);
const controller = new globalThis.AbortController();
let fatalReason;
const timer = setTimeout(() => {
  fatalReason = 'DEADLINE_CAP';
  controller.abort();
}, limits.deadlineMs);
function save() {
  report.calls = budget.calls;
  report.reservedUsd = budget.reservedUsd;
  const p = limits.pricing;
  report.actualKnownUsd = !p
    ? 0
    : budget.calls.reduce(
        (sum, c) =>
          sum +
          ((c.inputTokens ?? 0) *
            (c.kind === 'embedding'
              ? p.embeddingInputPerMillion
              : p.generationInputPerMillion) +
            (c.outputTokens ?? 0) * p.generationOutputPerMillion) /
            1e6,
        0,
      );
  report.usageComplete = budget.calls.every(
    (c) =>
      c.status === 'completed' &&
      c.inputTokens !== null &&
      c.outputTokens !== null,
  );
  report.summary = summarize(report.cases);
  writeFileSync(
    `${reportPath}.tmp`,
    JSON.stringify(reportSchema.parse(report), null, 2) + '\n',
  );
  renameSync(`${reportPath}.tmp`, reportPath);
}
function reserve(kind, input, output = 0) {
  try {
    const c = budget.reserve(kind, input, output);
    save();
    return c;
  } catch (e) {
    fatalReason = e.message;
    throw e;
  }
}
function complete(call, input, output = 0) {
  try {
    budget.complete(call, input, output);
  } catch (error) {
    fatalReason = error.message;
    throw error;
  } finally {
    save();
  }
}
const require = createRequire(new URL('../package.json', import.meta.url));
require('reflect-metadata');
const { Test } = require('@nestjs/testing');
const { Logger } = require('@nestjs/common');
Logger.overrideLogger(false);
const load = (path) => require(`./dist/${path}.js`);
const { AppModule } = load('app.module');
const { API_CONFIG } = load('config/config.module');
const { parseEnvironment } = load('config/environment');
const { configureHttp } = load('http');
const { DatabaseService } = load('database/database.service');
const { EmbeddingClient } = load('modules/ai/embedding-client');
const { GroundedAnswerClient } = load('modules/ai/grounded-answer-client');
const { OpenAIEmbeddingClient, embeddingBatches } = load(
  'modules/ai/openai-embedding-client',
);
const { OpenAIGroundedAnswerClient } = load(
  'modules/ai/openai-grounded-answer-client',
);
const { AiCapacity } = load('modules/ai/ai-capacity');
const { GENERATION_MODEL, GENERATION_MAX_INPUT } = load(
  'modules/ai/generation-model',
);
const { IngestionRunner } = load('modules/ingestion/ingestion-runner');
const { ChatService } = load('modules/chat/chat.service');
const { PROMPT_VERSION } = load('modules/chat/context');
const { RetrievalService } = load('modules/retrieval/retrieval.service');
const { askSchema } = require('@aka/shared');
const { countTokens } = load('modules/ingestion/source-processing');
const config = {
  ...parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL,
    STORAGE_ROOT: process.env.STORAGE_ROOT,
  }),
  OPENAI_API_KEY: live
    ? process.env.OPENAI_API_KEY
    : 'synthetic-evaluation-canary',
  OPENAI_CHAT_MODEL: GENERATION_MODEL,
  AI_MAX_RETRIES: 0,
  INGESTION_POLL_MS: 60000,
  ANSWER_MAX_OUTPUT_TOKENS: limits.outputTokens,
};
let activeCase;
let admitted = [];
let retrieved = [];
let invalidCitation = false;
let unrelated = false;
let app;
let db;
let base;
const documentIds = new Map();
const resolved = [];
const fakeGeneration = async (prompt) => {
  const sources = JSON.parse(prompt.input).untrustedEvidence;
  if (invalidCitation)
    return {
      status: 'completed',
      output: {
        status: 'answered',
        statements: [
          { text: 'Invalid citation regression.', sourceIds: ['S999'] },
        ],
        limitation: null,
      },
      inputTokens: 10,
      outputTokens: 10,
    };
  if (activeCase.offlineStatus === 'refused')
    return {
      status: 'refused',
      output: null,
      inputTokens: 10,
      outputTokens: 0,
    };
  const sourceIds = activeCase.gold.map((id) => {
    const span = resolved.find((s) => s.id === id);
    const row = sources.find((s) =>
      intersects({ filename: s.filename, location: s.location }, span),
    );
    assert.ok(row, 'Gold evidence was not admitted.');
    return row.sourceId;
  });
  return {
    status: 'completed',
    inputTokens: countTokens(prompt.instructions + prompt.input),
    outputTokens: 100,
    output: {
      status: activeCase.offlineStatus,
      statements: sourceIds.length
        ? [{ text: activeCase.offlineText, sourceIds: [...new Set(sourceIds)] }]
        : [],
      limitation: sourceIds.length
        ? null
        : activeCase.id === 'E09'
          ? 'Please clarify what “it” refers to.'
          : 'The supplied evidence does not contain that information.',
    },
  };
};
try {
  let commit = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    /* optional */
  }
  report.metadata = {
    commit,
    workingTree:
      'May include uncommitted stage implementation; corpus and harness hashes bind inputs.',
    corpusVersion,
    corpusHash: corpusHash(),
    harnessHash: createHash('sha256')
      .update(readFileSync(new URL('./run.mjs', import.meta.url)))
      .update(readFileSync(new URL('./core.mjs', import.meta.url)))
      .update(readFileSync(new URL('./corpus.mjs', import.meta.url)))
      .digest('hex'),
    node: process.version,
    embeddingModel: config.OPENAI_EMBEDDING_MODEL,
    profile: config.EMBEDDING_PROFILE_ID,
    dimensions: config.EMBEDDING_DIMENSIONS,
    generationModel: config.OPENAI_CHAT_MODEL,
    tokenizers: ['cl100k_base', 'o200k_base'],
    pipelineVersion: config.PIPELINE_VERSION,
    promptVersion: PROMPT_VERSION,
    topK: 10,
    cutoff: config.RETRIEVAL_MIN_SIMILARITY,
    chunkTokens: config.CHUNK_TOKENS,
    overlapTokens: config.CHUNK_OVERLAP_TOKENS,
    contextTokens: config.CONTEXT_MAX_TOKENS,
    outputTokens: config.ANSWER_MAX_OUTPUT_TOKENS,
    provider: live
      ? 'OpenAI standard public endpoint, no tools, store:false, reasoning:none'
      : 'Deterministic equal basis vectors and scripted gold answers',
    retries: 0,
    transport:
      'Production HTTP upload/delete; direct ChatService with production retrieval/context/adapters (avoids per-minute UI throttles); separate API/browser suites verify routing.',
    costReservation:
      'Every embedding batch reserves 8192 tokens per input; every generation reserves the reviewed 272000 input-token bound plus output cap. No retries. Reservations are never refunded.',
  };
  save();
  let embeddingDelegate;
  let generationDelegate;
  const embedding = {
    embed: async (inputs, signal, deadline, options) => {
      const vectors = [];
      let total = 0;
      for (const batch of embeddingBatches(
        inputs,
        config.EMBEDDING_BATCH_SIZE,
      )) {
        const call = reserve(
          'embedding',
          live
            ? batch.length * 8192
            : batch.reduce((n, i) => n + i.tokenCount, 0),
        );
        const result = live
          ? await embeddingDelegate.embed(
              batch,
              globalThis.AbortSignal.any([signal, controller.signal]),
              Math.min(deadline, budget.deadline),
              options,
            )
          : {
              vectors: batch.map(() =>
                unrelated
                  ? [0, 1, ...Array(1534).fill(0)]
                  : [1, ...Array(1535).fill(0)],
              ),
              inputTokens: batch.reduce((n, i) => n + i.tokenCount, 0),
            };
        complete(call, result.inputTokens);
        total += result.inputTokens;
        vectors.push(...result.vectors);
        save();
      }
      return { vectors, inputTokens: total };
    },
  };
  const generation = {
    generate: async (prompt, signal, deadline) => {
      admitted = JSON.parse(prompt.input).untrustedEvidence;
      const call = reserve(
        'generation',
        live
          ? GENERATION_MAX_INPUT
          : countTokens(prompt.instructions + prompt.input),
        limits.outputTokens,
      );
      const result = live
        ? await generationDelegate.generate(
            prompt,
            globalThis.AbortSignal.any([signal, controller.signal]),
            Math.min(deadline, budget.deadline),
          )
        : await fakeGeneration(prompt);
      complete(call, result.inputTokens, result.outputTokens);
      save();
      return result;
    },
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(API_CONFIG)
    .useValue(config)
    .overrideProvider(EmbeddingClient)
    .useValue(embedding)
    .overrideProvider(GroundedAnswerClient)
    .useValue(generation)
    .compile();
  app = module.createNestApplication({ bodyParser: false, logger: false });
  configureHttp(app);
  // Separate concrete adapters use the same production capacity/config, and stay
  // behind the measured boundaries above. They make no calls at construction.
  embeddingDelegate = new OpenAIEmbeddingClient(config, app.get(AiCapacity));
  generationDelegate = new OpenAIGroundedAnswerClient(
    config,
    app.get(AiCapacity),
  );
  await app.listen(0, '127.0.0.1');
  db = app.get(DatabaseService).client;
  assert.equal(
    await db.document.count(),
    0,
    'Evaluation must start with an empty owned database.',
  );
  base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/documents`;
  const runner = app.get(IngestionRunner);
  for (const filename of fixtureNames) {
    const form = new globalThis.FormData();
    form.append(
      'file',
      new Blob([readFileSync(fixturePath(filename))]),
      filename,
    );
    const upload = await globalThis.fetch(base, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    assert.equal(upload.status, 201, 'Corpus upload failed.');
    const id = (await upload.json()).data.id;
    documentIds.set(filename, id);
    await runner.tick();
    if (fatalReason) throw new Error(fatalReason);
    const document = await db.document.findUniqueOrThrow({ where: { id } });
    assert.equal(document.status, 'ready', 'Corpus ingestion failed.');
    const chunks = await db.documentChunk.findMany({
      where: { documentId: id },
      orderBy: { chunkIndex: 'asc' },
    });
    for (const span of goldSpans.filter((s) => s.file === filename)) {
      const unit = document.sourceMap[span.unitIndex];
      const text = document.extractedContent.slice(
        unit.contentStart,
        unit.contentEnd,
      );
      const start = text.indexOf(span.text);
      assert.ok(
        start >= 0 && text.indexOf(span.text, start + 1) < 0,
        'Gold span missing or ambiguous.',
      );
      for (const [key, value] of Object.entries(span.location)) {
        if (!['lineStart', 'lineEnd'].includes(key))
          assert.deepEqual(unit.location[key], value);
      }
      if (unit.lines.length) {
        const touched = unit.lines.filter(
          (l) => l.charEnd > start && l.charStart < start + span.text.length,
        );
        assert.equal(touched[0].line, span.location.lineStart);
        assert.equal(touched.at(-1).line, span.location.lineEnd);
      }
      const gold = {
        ...span,
        charStart: start,
        charEnd: start + span.text.length,
      };
      assert.ok(
        retrievalMetrics(
          chunks.map((c) => ({ filename, location: c.sourceLocation })),
          [gold],
        ).value === 1,
      );
      resolved.push(gold);
    }
    for (const chunk of chunks) {
      const l = chunk.sourceLocation;
      const unit = document.sourceMap[l.unitIndex];
      assert.equal(
        chunk.content,
        document.extractedContent.slice(
          unit.contentStart + l.charStart,
          unit.contentStart + l.charEnd,
        ),
      );
    }
    report.corpus.push({
      filename,
      sha256: createHash('sha256')
        .update(readFileSync(fixturePath(filename)))
        .digest('hex'),
      documentId: id,
      sourceMap: document.sourceMap,
      goldSpans: resolved.filter((s) => s.file === filename),
      chunks: chunks.map((c) => ({
        chunkId: c.id,
        location: c.sourceLocation,
      })),
    });
    save();
  }
  const retrieval = app.get(RetrievalService);
  const retrieve = retrieval.retrieve.bind(retrieval);
  retrieval.retrieve = async (...args) => {
    const result = await retrieve(...args);
    retrieved = result.rows;
    return result;
  };
  const chat = app.get(ChatService);
  for (const current of cases.slice(0, limits.caseCap)) {
    if (fatalReason || controller.signal.aborted)
      throw new Error(fatalReason ?? 'DEADLINE_CAP');
    activeCase = current;
    admitted = [];
    retrieved = [];
    const started = Date.now();
    const record = {
      id: current.id,
      question: current.question,
      rubric: current.rubric,
      gold: current.gold,
      special: current.special,
      status: 'completed',
      error: null,
      elapsedMs: 0,
      retrieved: [],
      admitted: [],
      response: null,
      expectedStatus: null,
      evidenceRecall: metric(0, current.gold.length),
      citationIdentity: metric(0, 0),
      review: {
        status: live ? 'not_reviewed' : 'not_applicable',
        retrievalPrecision: metric(0, 0),
        citationSupport: metric(0, 0),
        groundedness: metric(0, 0),
        special: null,
        judgments: null,
        notes: live
          ? 'Human source-support and special-behavior review required; status equality is not support.'
          : 'Scripted output: no semantic or injection-resistance judgment.',
      },
    };
    try {
      const response = askSchema.parse(
        await chat.ask(
          { question: current.question, topK: 10 },
          controller.signal,
        ),
      );
      if (JSON.stringify(response).includes(config.OPENAI_API_KEY)) {
        fatalReason = 'SECRET_DISCLOSURE';
        throw new Error(fatalReason);
      }
      record.response = response;
      record.expectedStatus = current.expectedStatuses.includes(
        response.status,
      );
      let valid = 0;
      for (const citation of response.citations) {
        const row = retrieved.find((r) => r.chunkId === citation.chunkId);
        const source = admitted.find((s) => s.sourceId === citation.sourceId);
        const chunk = await db.documentChunk.findUnique({
          where: { id: citation.chunkId },
        });
        if (
          row &&
          source &&
          chunk &&
          row.documentId === citation.source.documentId &&
          source.filename === row.filename &&
          source.text === row.content &&
          chunk.content === row.content &&
          JSON.stringify(citation.source.location) ===
            JSON.stringify(row.location) &&
          JSON.stringify(source.location) === JSON.stringify(row.location)
        )
          valid++;
      }
      record.citationIdentity = metric(valid, response.citations.length);
      if (!live) {
        assert.equal(record.expectedStatus, true);
        assert.equal(valid, response.citations.length);
        if (current.id === 'E11')
          assert.ok(admitted.some((s) => s.filename === 'injection.md'));
      }
    } catch (error) {
      record.status = 'error';
      record.error =
        fatalReason ??
        (/^[A-Z_]+$/.test(error.code ?? '')
          ? error.code
          : 'CASE_CHECK_OR_PROVIDER_FAILED');
    }
    record.elapsedMs = Date.now() - started;
    record.admitted = admitted;
    record.retrieved = retrieved.map((row) => ({
      chunkId: row.chunkId,
      documentId: row.documentId,
      filename: row.filename,
      content: row.content,
      location: row.location,
      similarity: 1 - row.distance,
      goldSpanIds: resolved.filter((s) => intersects(row, s)).map((s) => s.id),
    }));
    record.evidenceRecall = retrievalMetrics(
      retrieved,
      resolved.filter((s) => current.gold.includes(s.id)),
    );
    report.cases.push(record);
    save();
    if (fatalReason || record.status === 'error')
      throw new Error(fatalReason ?? record.error);
    if (!live)
      assert.equal(
        record.evidenceRecall.numerator,
        record.evidenceRecall.denominator,
      );
  }
  if (!live) {
    const check = async (name, fn) => {
      await fn();
      report.regressions.push({ name, passed: true });
      save();
    };
    activeCase = cases[0];
    await check('filtered PDF uses only physical PDF pages', async () => {
      const r = await retrieval.search({
        query: 'recovery target',
        topK: 10,
        documentIds: [documentIds.get('handbook.pdf')],
      });
      assert.ok(
        r.results.length > 0 &&
          r.results.every((s) => s.source.location.kind === 'pdf'),
      );
      assert.deepEqual(
        r.results.map((s) => s.source.location.page).sort(),
        [1, 2],
      );
    });
    await check(
      'Unicode question survives validation and retrieval',
      async () => {
        assert.equal(
          (
            await chat.ask({
              question: 'Orion 🛰️ — когда обслуживание?',
              topK: 10,
            })
          ).status,
          'answered',
        );
      },
    );
    await check('invalid model citation is rejected', async () => {
      invalidCitation = true;
      try {
        await assert.rejects(
          chat.ask({ question: 'maintenance', topK: 10 }),
          (e) => e.code === 'AI_OUTPUT_INVALID',
        );
      } finally {
        invalidCitation = false;
      }
    });
    await check(
      'below-cutoff unrelated vectors produce no relevant context',
      async () => {
        unrelated = true;
        try {
          assert.equal(
            (await chat.ask({ question: 'unrelated' })).reason,
            'NO_RELEVANT_CONTEXT',
          );
        } finally {
          unrelated = false;
        }
      },
    );
  }
  if (!live) {
    const id = documentIds.get('handbook.pdf');
    assert.equal(
      (
        await globalThis.fetch(`${base}/${id}`, {
          method: 'DELETE',
          signal: controller.signal,
        })
      ).status,
      204,
    );
    documentIds.delete('handbook.pdf');
    assert.equal(
      await db.documentChunk.count({ where: { documentId: id } }),
      0,
    );
    activeCase = {
      ...cases[7],
      question: 'What is the recovery target after deleting the handbook?',
    };
    const result = await app
      .get(ChatService)
      .ask({ question: activeCase.question, topK: 10 });
    assert.equal(result.status, 'insufficient_context');
    assert.ok(retrieved.every((r) => r.filename !== 'handbook.pdf'));
    report.regressions.push({
      name: 'delete handbook then target question has no handbook evidence (scripted abstention)',
      passed: true,
    });
    save();
  }
  // Real deletion API, originals/chunks cascade; no private user volumes touched.
  for (const id of documentIds.values())
    assert.equal(
      (
        await globalThis.fetch(`${base}/${id}`, {
          method: 'DELETE',
          signal: controller.signal,
        })
      ).status,
      204,
    );
  assert.equal(await db.documentChunk.count(), 0);
  if (!live) {
    const calls = budget.requests;
    assert.equal(
      (await app.get(ChatService).ask({ question: 'maintenance' })).reason,
      'NO_READY_DOCUMENTS',
    );
    assert.equal(budget.requests, calls);
    report.regressions.push({
      name: 'delete corpus then empty ask skips AI',
      passed: true,
    });
  }
  report.status = 'completed';
  report.reason = live ? 'HUMAN_REVIEW_REQUIRED' : null;
} catch (error) {
  report.status = 'terminated';
  report.reason =
    fatalReason ??
    (/^[A-Z_]+$/.test(error.message)
      ? error.message
      : 'FIXTURE_SETUP_OR_CHECK_FAILED');
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  controller.abort();
  await app?.close();
  report.finishedAt = new Date().toISOString();
  save();
  console.log(
    `${mode}: ${report.cases.length} cases, ${budget.requests} bounded provider-boundary calls, ${report.status}; ${report.reason ?? 'mechanics only'}.`,
  );
}
