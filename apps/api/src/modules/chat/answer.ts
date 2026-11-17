import { askSchema, formatAnswer } from '@aka/shared';
import type { AskResponse } from '@aka/shared';
import { ApiError } from '../../api-error';
import { groundedOutputSchema } from '../ai/grounded-answer-client';
import { mapSource } from '../retrieval/source-mapper';
import type { Evidence } from './context';

export const invalidOutput = () =>
  new ApiError(
    502,
    'AI_OUTPUT_INVALID',
    'The generated answer is invalid. Please retry.',
  );
export function validateAnswer(
  output: unknown,
  evidence: readonly Evidence[],
): {
  status: 'answered' | 'insufficient_context';
  statements: AskResponse['statements'];
  limitation: string | null;
} {
  const parsed = groundedOutputSchema.safeParse(output);
  if (!parsed.success) throw invalidOutput();
  const value = parsed.data;
  const allowed = new Set(evidence.map((source) => source.sourceId));
  if (
    value.status === 'answered'
      ? !value.statements.length ||
        value.statements.some((statement) =>
          statement.sourceIds.some((id) => !allowed.has(id)),
        )
      : value.statements.length > 0 || !value.limitation
  )
    throw invalidOutput();
  return value;
}
export function answeredResponse(
  output: unknown,
  evidence: readonly Evidence[],
  retrieval: AskResponse['retrieval'],
  usage: AskResponse['usage'],
): AskResponse {
  const value = validateAnswer(output, evidence);
  const used = new Set(
    value.statements.flatMap((statement) => statement.sourceIds),
  );
  return askSchema.parse({
    ...value,
    answer: formatAnswer(value.statements, value.limitation),
    reason: value.status === 'answered' ? null : 'EVIDENCE_INSUFFICIENT',
    citations: evidence
      .filter((source) => used.has(source.sourceId))
      .map(({ sourceId, row }) => ({
        sourceId,
        chunkId: row.chunkId,
        source: mapSource(row).source,
      })),
    retrieval,
    usage,
  });
}
