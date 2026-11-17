import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  Budget,
  initialReport,
  metric,
  metricSchema,
  reportSchema,
  retrievalMetrics,
  validateLiveConfig,
} from '../apps/api/evaluation/core.mjs';
import {
  cases,
  corpusHash,
  goldSpans,
  handbookPdf,
} from '../apps/api/evaluation/corpus.mjs';
import { applyReviews } from '../apps/api/evaluation/review.mjs';

test('all twelve fictional cases and logical gold evidence are materialized without drift', () => {
  assert.equal(cases.length, 12);
  assert.equal(new Set(cases.map((c) => c.id)).size, 12);
  for (const c of cases)
    for (const id of c.gold) assert.ok(goldSpans.some((s) => s.id === id));
  assert.equal(corpusHash().length, 64);
  assert.match(handbookPdf().toString(), /\/Count 2 \/Kids \[4 0 R 6 0 R\]/);
  assert.ok(
    handbookPdf().equals(
      readFileSync(
        new URL(
          '../apps/api/evaluation/fixtures/handbook.pdf',
          import.meta.url,
        ),
      ),
    ),
  );
});
test('zero denominators remain N/A and inconsistent ratios are rejected', () => {
  assert.deepEqual(metric(0, 0), { numerator: 0, denominator: 0, value: null });
  assert.equal(
    metricSchema.safeParse({ numerator: 0, denominator: 0, value: 1 }).success,
    false,
  );
  assert.equal(metricSchema.safeParse(metric(2, 1)).success, false);
  assert.equal(
    reportSchema.parse(initialReport('offline')).summary.citationIdentity.value,
    null,
  );
});
test('gold coverage uses unit identity and union of spans independently of chunk boundaries', () => {
  const gold = [{ file: 'a.md', unitIndex: 1, charStart: 10, charEnd: 30 }];
  const row = (start, end, unit = 1) => ({
    filename: 'a.md',
    location: { unitIndex: unit, charStart: start, charEnd: end },
  });
  assert.equal(
    retrievalMetrics([row(0, 15), row(15, 22), row(20, 40)], gold).value,
    1,
  );
  assert.equal(retrievalMetrics([row(0, 15), row(16, 40)], gold).value, 0);
  assert.equal(retrievalMetrics([row(0, 40, 0)], gold).value, 0);
  assert.equal(retrievalMetrics([], []).value, null);
});
const live = JSON.parse(
  readFileSync(
    new URL('../apps/api/evaluation/live-config.example.json', import.meta.url),
    'utf8',
  ),
);
test('live config rejects missing, expanded, stale, future or unreviewed pricing/configuration', () => {
  const now = Date.parse('2026-11-17T12:00:00Z');
  assert.equal(validateLiveConfig(live, now).requestCap, 28);
  for (const changed of [
    { ...live, caseCap: 13 },
    { ...live, requestCap: 41 },
    { ...live, outputTokens: 801 },
    { ...live, deadlineMs: 600001 },
    { ...live, maxEstimatedUsd: 0 },
    { ...live, pricing: { ...live.pricing, generationInputPerMillion: 0 } },
  ])
    assert.throws(() => validateLiveConfig(changed, now));
  assert.throws(
    () => validateLiveConfig(live, now + 8 * 86400000),
    /PRICING_REVIEW_REQUIRED/,
  );
  assert.throws(
    () => validateLiveConfig(live, now - 86400000),
    /PRICING_REVIEW_REQUIRED/,
  );
});
test('request, monetary and deadline limits reserve before any provider work, including unknown usage', () => {
  let now = 0;
  const budget = new Budget({ ...live, requestCap: 1 }, () => now);
  const call = budget.reserve('generation', 272000, 800);
  assert.equal(budget.requests, 1);
  assert.throws(() => budget.reserve('embedding', 1), /REQUEST_CAP/);
  assert.throws(() => budget.complete(call, null), /USAGE_UNAVAILABLE/);
  assert.ok(budget.reservedUsd > 0);
  const cheap = new Budget({ ...live, maxEstimatedUsd: 0.001 }, () => now);
  assert.throws(() => cheap.reserve('generation', 272000, 800), /COST_CAP/);
  assert.equal(cheap.requests, 0);
  now = live.deadlineMs;
  assert.throws(() => budget.reserve('embedding', 1), /DEADLINE_CAP/);
  const exceeded = new Budget(live);
  const c = exceeded.reserve('embedding', 5);
  assert.throws(() => exceeded.complete(c, 6), /USAGE_EXCEEDED_RESERVATION/);
});

test('human review requires all retrieved chunks, segmented claims and cited source pairs; failed support stays failed', () => {
  const report = initialReport('live');
  report.status = 'completed';
  const chunkId = '11111111-1111-4111-8111-111111111111';
  const c = {
    id: 'E10',
    question: 'Support hours?',
    rubric: 'Both ranges, no supersession.',
    gold: ['support', 'notice'],
    special: 'conflict',
    status: 'completed',
    error: null,
    elapsedMs: 1,
    retrieved: [
      {
        chunkId,
        documentId: chunkId,
        filename: 'handbook.pdf',
        content: 'Synthetic',
        location: {},
        similarity: 1,
        goldSpanIds: ['support'],
      },
    ],
    admitted: [],
    response: { statements: [{ text: 'One claim.', sourceIds: ['S1'] }] },
    expectedStatus: true,
    evidenceRecall: metric(1, 2),
    citationIdentity: metric(1, 1),
    review: {
      status: 'not_reviewed',
      retrievalPrecision: metric(0, 0),
      citationSupport: metric(0, 0),
      groundedness: metric(0, 0),
      special: null,
      judgments: null,
      notes: '',
    },
  };
  report.cases = [c];
  const review = {
    reportSha256: 'a'.repeat(64),
    reviewer: 'Synthetic test reviewer',
    reviewedAt: '2026-11-17T12:00:00.000Z',
    cases: [
      {
        id: 'E10',
        notes: 'Missing conflict handling is retained.',
        retrievalLabels: [{ chunkId, relevant: true }],
        claims: [
          {
            id: 'c1',
            statementIndex: 0,
            text: 'One claim.',
            verdict: 'unsupported',
          },
        ],
        pairs: [
          {
            claimId: 'c1',
            sourceId: 'S1',
            supported: false,
            notes: 'Passage does not support the claim.',
          },
        ],
        special: { passed: false, notes: 'Conflict not explained.' },
      },
    ],
  };
  const result = applyReviews(report, review);
  assert.equal(result.cases[0].review.citationSupport.value, 0);
  assert.equal(result.cases[0].review.groundedness.value, 0);
  assert.equal(result.cases[0].review.special.passed, false);
  assert.equal(result.summary.humanReview.value, 1);
  assert.equal(report.cases[0].review.status, 'not_reviewed');
  for (const key of ['retrievalLabels', 'claims', 'pairs']) {
    const incomplete = globalThis.structuredClone(review);
    incomplete.cases[0][key] = [];
    assert.throws(() => applyReviews(report, incomplete));
  }
  assert.throws(() => applyReviews({ ...report, mode: 'offline' }, review));
});
