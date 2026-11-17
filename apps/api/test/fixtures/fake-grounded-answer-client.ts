import { GroundedAnswerClient } from '../../src/modules/ai/grounded-answer-client';
import type {
  GroundedPrompt,
  GenerationResult,
} from '../../src/modules/ai/grounded-answer-client';
export class FakeGroundedAnswerClient extends GroundedAnswerClient {
  readonly calls: {
    prompt: GroundedPrompt;
    signal: AbortSignal;
    deadline: number;
  }[] = [];
  handler: (
    prompt: GroundedPrompt,
    signal: AbortSignal,
  ) => Promise<GenerationResult> = async () => ({
    status: 'completed',
    output: {
      status: 'answered',
      statements: [
        { text: 'Maintenance is Sunday at 02:00 UTC.', sourceIds: ['S1'] },
      ],
      limitation: null,
    },
    inputTokens: 300,
    outputTokens: 40,
  });
  async generate(
    prompt: GroundedPrompt,
    signal: AbortSignal,
    deadline: number,
  ): Promise<GenerationResult> {
    this.calls.push({ prompt, signal, deadline });
    return this.handler(prompt, signal);
  }
}
