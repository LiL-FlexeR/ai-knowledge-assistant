import { z } from 'zod';
import { answerStatementSchema, answerLimitationSchema } from '@aka/shared';

export const groundedOutputSchema = z.strictObject({
  status: z.enum(['answered', 'insufficient_context']),
  statements: z.array(answerStatementSchema).max(8),
  limitation: answerLimitationSchema.nullable(),
});
export type GroundedOutput = z.infer<typeof groundedOutputSchema>;
export type GroundedPrompt = { instructions: string; input: string };
export type GenerationResult = {
  status: 'completed' | 'refused';
  output: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
};
export abstract class GroundedAnswerClient {
  abstract generate(
    prompt: GroundedPrompt,
    signal: AbortSignal,
    deadline: number,
  ): Promise<GenerationResult>;
}
