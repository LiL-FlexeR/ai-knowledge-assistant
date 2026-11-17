import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { z } = require('zod');

const count = z.number().int().nonnegative();
export const metric = (numerator, denominator) => ({
  numerator,
  denominator,
  value: denominator ? numerator / denominator : null,
});
export const metricSchema = z
  .strictObject({
    numerator: count,
    denominator: count,
    value: z.number().min(0).max(1).nullable(),
  })
  .refine(
    (m) =>
      m.numerator <= m.denominator &&
      m.value === (m.denominator ? m.numerator / m.denominator : null),
  );
export const liveConfigSchema = z.strictObject({
  caseCap: z.number().int().min(1).max(12),
  requestCap: z.number().int().min(1).max(40),
  deadlineMs: z.number().int().min(1000).max(600000),
  outputTokens: z.number().int().min(128).max(800),
  maxEstimatedUsd: z.number().positive().max(10),
  pricing: z.strictObject({
    verifiedAt: z.iso.date(),
    embeddingInputPerMillion: z.literal(0.02),
    generationInputPerMillion: z.literal(0.75),
    generationOutputPerMillion: z.literal(4.5),
    sources: z.tuple([
      z.literal(
        'https://developers.openai.com/api/docs/models/text-embedding-3-small',
      ),
      z.literal('https://developers.openai.com/api/docs/models/gpt-5.4-mini'),
    ]),
  }),
});
export function validateLiveConfig(value, now = Date.now()) {
  const config = liveConfigSchema.parse(value);
  const age = now - Date.parse(config.pricing.verifiedAt);
  if (age < 0 || age > 7 * 86400000) throw new Error('PRICING_REVIEW_REQUIRED');
  return config;
}
export const offlineConfig = {
  caseCap: 12,
  requestCap: 40,
  deadlineMs: 120000,
  outputTokens: 800,
  maxEstimatedUsd: 0,
};

export class Budget {
  constructor(config, now = () => Date.now()) {
    this.config = config;
    this.now = now;
    this.deadline = now() + config.deadlineMs;
    this.requests = 0;
    this.reservedUsd = 0;
    this.calls = [];
  }
  reserve(kind, inputBound, outputBound = 0) {
    if (this.now() >= this.deadline) throw new Error('DEADLINE_CAP');
    if (this.requests >= this.config.requestCap) throw new Error('REQUEST_CAP');
    const p = this.config.pricing;
    const usd = !p
      ? 0
      : (inputBound *
          (kind === 'embedding'
            ? p.embeddingInputPerMillion
            : p.generationInputPerMillion) +
          outputBound * p.generationOutputPerMillion) /
        1e6;
    if (this.reservedUsd + usd > this.config.maxEstimatedUsd)
      throw new Error('COST_CAP');
    this.requests++;
    this.reservedUsd += usd;
    const call = {
      kind,
      inputBound,
      outputBound,
      reservedUsd: usd,
      inputTokens: null,
      outputTokens: null,
      status: 'started',
    };
    this.calls.push(call);
    return call;
  }
  complete(call, inputTokens, outputTokens = 0) {
    call.inputTokens = inputTokens;
    call.outputTokens = outputTokens;
    call.status = 'completed';
    if (inputTokens === null || outputTokens === null)
      throw new Error('USAGE_UNAVAILABLE');
    if (inputTokens > call.inputBound || outputTokens > call.outputBound)
      throw new Error('USAGE_EXCEEDED_RESERVATION');
  }
}

export function intersects(chunk, span) {
  const l = chunk.location ?? chunk.sourceLocation;
  return (
    chunk.filename === span.file &&
    l.unitIndex === span.unitIndex &&
    l.charStart < span.charEnd &&
    l.charEnd > span.charStart
  );
}
// Coverage is the union of intersections, rather than awarding a whole gold span
// for one character of overlap. Gold is independent of chunk size/UUID.
export function spanCovered(chunks, span) {
  let end = span.charStart;
  for (const chunk of chunks
    .filter((c) => intersects(c, span))
    .sort(
      (a, b) =>
        (a.location ?? a.sourceLocation).charStart -
        (b.location ?? b.sourceLocation).charStart,
    )) {
    const l = chunk.location ?? chunk.sourceLocation;
    if (l.charStart > end) return false;
    end = Math.max(end, l.charEnd);
  }
  return end >= span.charEnd;
}
export function retrievalMetrics(rows, spans) {
  return metric(
    spans.filter((span) => spanCovered(rows, span)).length,
    spans.length,
  );
}

const nullableCount = count.nullable();
const callSchema = z.strictObject({
  kind: z.enum(['embedding', 'generation']),
  inputBound: count,
  outputBound: count,
  reservedUsd: z.number().nonnegative(),
  inputTokens: nullableCount,
  outputTokens: nullableCount,
  status: z.enum(['started', 'completed']),
});
const rowSchema = z.strictObject({
  chunkId: z.uuid(),
  documentId: z.uuid(),
  filename: z.string(),
  content: z.string(),
  location: z.record(z.string(), z.unknown()),
  similarity: z.number(),
  goldSpanIds: z.array(z.string()),
});
const caseSchema = z.strictObject({
  id: z.string(),
  question: z.string(),
  rubric: z.string(),
  gold: z.array(z.string()),
  special: z.string().nullable(),
  status: z.enum(['completed', 'error']),
  error: z.string().nullable(),
  elapsedMs: count,
  retrieved: z.array(rowSchema),
  admitted: z.array(z.record(z.string(), z.unknown())),
  response: z.record(z.string(), z.unknown()).nullable(),
  expectedStatus: z.boolean().nullable(),
  evidenceRecall: metricSchema,
  citationIdentity: metricSchema,
  // Human-only measures deliberately remain unscored until explicit review.
  review: z.strictObject({
    status: z.enum(['not_reviewed', 'not_applicable', 'reviewed']),
    retrievalPrecision: metricSchema,
    citationSupport: metricSchema,
    groundedness: metricSchema,
    special: z
      .strictObject({ passed: z.boolean(), notes: z.string() })
      .nullable(),
    judgments: z.record(z.string(), z.unknown()).nullable(),
    notes: z.string(),
  }),
});
export const reportSchema = z.strictObject({
  schemaVersion: z.literal('evaluation-report-v1'),
  mode: z.enum(['offline', 'live']),
  status: z.enum(['running', 'completed', 'terminated', 'not_run']),
  reason: z.string().nullable(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  config: z.record(z.string(), z.unknown()),
  corpus: z.array(z.record(z.string(), z.unknown())),
  cases: z.array(caseSchema),
  regressions: z.array(
    z.strictObject({ name: z.string(), passed: z.boolean() }),
  ),
  calls: z.array(callSchema),
  reservedUsd: z.number().nonnegative(),
  actualKnownUsd: z.number().nonnegative(),
  usageComplete: z.boolean(),
  summary: z.strictObject({
    evidenceRecall: metricSchema,
    multiSpanRecall: metricSchema,
    citationIdentity: metricSchema,
    missingEvidenceAbstention: metricSchema,
    falseAbstention: metricSchema,
    humanReview: metricSchema,
  }),
  limitations: z.array(z.string()),
});
export function summarize(cases) {
  const sum = (key, selected = cases) =>
    metric(
      selected.reduce((n, c) => n + c[key].numerator, 0),
      selected.reduce((n, c) => n + c[key].denominator, 0),
    );
  const missing = cases.filter((c) => ['E07', 'E08'].includes(c.id));
  const answerable = cases.filter((c) => c.gold.length > 0);
  return {
    evidenceRecall: sum('evidenceRecall'),
    multiSpanRecall: sum(
      'evidenceRecall',
      cases.filter((c) => c.gold.length > 1),
    ),
    citationIdentity: sum('citationIdentity'),
    missingEvidenceAbstention: metric(
      missing.filter((c) => c.response?.status === 'insufficient_context')
        .length,
      missing.length,
    ),
    falseAbstention: metric(
      answerable.filter((c) => c.response?.status === 'insufficient_context')
        .length,
      answerable.length,
    ),
    humanReview: metric(
      cases.filter((c) => c.review.status === 'reviewed').length,
      cases.filter((c) => c.review.status !== 'not_applicable').length,
    ),
  };
}
export function initialReport(mode, config = {}) {
  return {
    schemaVersion: 'evaluation-report-v1',
    mode,
    status: 'running',
    reason: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    metadata: {},
    config,
    corpus: [],
    cases: [],
    regressions: [],
    calls: [],
    reservedUsd: 0,
    actualKnownUsd: 0,
    usageComplete: true,
    summary: summarize([]),
    limitations: [
      'Offline fake outputs measure mechanics only, never semantic quality.',
      'Citation identity does not establish claim support.',
      'Live answers require source-support review before release; no live quality pass is inferred from structural checks.',
      'Known usage is not a billing statement; failed requests may have unknown usage.',
    ],
  };
}
