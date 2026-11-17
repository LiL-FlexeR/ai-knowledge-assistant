import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { metric, reportSchema, summarize } from './core.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { z } = require('zod');
const index = z.number().int().nonnegative();
export const judgmentsSchema = z.strictObject({
  reportSha256: z.string().regex(/^[a-f0-9]{64}$/),
  reviewer: z.string().min(1),
  reviewedAt: z.iso.datetime(),
  cases: z
    .array(
      z.strictObject({
        id: z.string(),
        notes: z.string().min(1),
        retrievalLabels: z.array(
          z.strictObject({ chunkId: z.uuid(), relevant: z.boolean() }),
        ),
        claims: z.array(
          z.strictObject({
            id: z.string().min(1),
            statementIndex: index,
            text: z.string().min(1),
            verdict: z.enum([
              'supported',
              'unsupported',
              'contradicted',
              'unverifiable',
            ]),
          }),
        ),
        pairs: z.array(
          z.strictObject({
            claimId: z.string(),
            sourceId: z.string(),
            supported: z.boolean(),
            notes: z.string().min(1),
          }),
        ),
        special: z
          .strictObject({ passed: z.boolean(), notes: z.string().min(1) })
          .nullable(),
      }),
    )
    .min(1),
});
export function applyReviews(value, judgments) {
  const report = reportSchema.parse(globalThis.structuredClone(value));
  const input = judgmentsSchema.parse(judgments);
  assert.equal(
    report.mode,
    'live',
    'Scripted answers cannot receive live quality scores.',
  );
  const seen = new Set();
  for (const judgment of input.cases) {
    assert.ok(!seen.has(judgment.id), 'Duplicate case judgment.');
    seen.add(judgment.id);
    const c = report.cases.find((c) => c.id === judgment.id);
    assert.ok(c, 'Unknown case.');
    assert.equal(
      new Set(judgment.retrievalLabels.map((l) => l.chunkId)).size,
      c.retrieved.length,
      'Label each retrieved chunk exactly once.',
    );
    assert.equal(judgment.retrievalLabels.length, c.retrieved.length);
    for (const label of judgment.retrievalLabels)
      assert.ok(c.retrieved.some((r) => r.chunkId === label.chunkId));
    const statements = c.response?.statements ?? [];
    assert.equal(
      new Set(judgment.claims.map((c) => c.id)).size,
      judgment.claims.length,
    );
    for (const claim of judgment.claims)
      assert.ok(
        statements[claim.statementIndex],
        'Claim must refer to a returned statement.',
      );
    for (let i = 0; i < statements.length; i++)
      assert.ok(
        judgment.claims.some((c) => c.statementIndex === i),
        'Segment every factual statement into claims.',
      );
    const expectedPairs = judgment.claims.flatMap((claim) =>
      statements[claim.statementIndex].sourceIds.map(
        (id) => `${claim.id}/${id}`,
      ),
    );
    assert.equal(
      new Set(judgment.pairs.map((p) => `${p.claimId}/${p.sourceId}`)).size,
      expectedPairs.length,
      'Review every claim/source pair.',
    );
    assert.equal(judgment.pairs.length, expectedPairs.length);
    for (const pair of judgment.pairs)
      assert.ok(expectedPairs.includes(`${pair.claimId}/${pair.sourceId}`));
    assert.equal(
      judgment.special !== null,
      c.special !== null,
      'Special cases need an explicit judgment.',
    );
    c.review = {
      status: 'reviewed',
      retrievalPrecision: metric(
        judgment.retrievalLabels.filter((r) => r.relevant).length,
        judgment.retrievalLabels.length,
      ),
      citationSupport: metric(
        judgment.pairs.filter((p) => p.supported).length,
        judgment.pairs.length,
      ),
      groundedness: metric(
        judgment.claims.filter((c) => c.verdict === 'supported').length,
        judgment.claims.length,
      ),
      special: judgment.special,
      judgments: {
        reviewer: input.reviewer,
        reviewedAt: input.reviewedAt,
        ...judgment,
      },
      notes: judgment.notes,
    };
  }
  report.summary = summarize(report.cases);
  if (report.status === 'completed')
    report.reason = report.cases.every((c) => c.review.status === 'reviewed')
      ? 'HUMAN_REVIEW_RECORDED_SEE_PER_CASE_FINDINGS'
      : 'HUMAN_REVIEW_REQUIRED';
  return reportSchema.parse(report);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [reportPath, judgmentPath] = process.argv.slice(2);
    assert.ok(reportPath?.endsWith('.json') && judgmentPath);
    const bytes = readFileSync(reportPath);
    const judgments = judgmentsSchema.parse(
      JSON.parse(readFileSync(judgmentPath, 'utf8')),
    );
    assert.equal(
      judgments.reportSha256,
      createHash('sha256').update(bytes).digest('hex'),
      'Judgments must bind the exact source report.',
    );
    const reviewed = applyReviews(JSON.parse(bytes), judgments);
    const output = reportPath.replace(/\.json$/, '.reviewed.json');
    writeFileSync(output, JSON.stringify(reviewed, null, 2) + '\n', {
      flag: 'wx',
    });
    console.log(
      `Human review recorded: ${output}; inspect each case and failures, no aggregate accuracy claim.`,
    );
  } catch {
    console.error(
      'Review rejected: check report hash, schemas, complete chunk/claim/source labels and output path.',
    );
    process.exitCode = 1;
  }
}
