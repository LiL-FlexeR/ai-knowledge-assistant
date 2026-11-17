import { EmbeddingClient } from '../../src/modules/ai/embedding-client';
import type {
  EmbeddingInput,
  EmbeddingResult,
} from '../../src/modules/ai/embedding-client';
export class FakeEmbeddingClient extends EmbeddingClient {
  readonly calls: { inputs: EmbeddingInput[]; signal: AbortSignal }[] = [];
  handler:
    | ((
        inputs: EmbeddingInput[],
        signal: AbortSignal,
      ) => Promise<EmbeddingResult>)
    | undefined;
  async embed(
    inputs: EmbeddingInput[],
    signal: AbortSignal,
  ): Promise<EmbeddingResult> {
    this.calls.push({ inputs, signal });
    if (this.handler) return this.handler(inputs, signal);
    return {
      vectors: inputs.map(() => [1, ...Array<number>(1535).fill(0)]),
      inputTokens: inputs.reduce((n, input) => n + input.tokenCount, 0),
    };
  }
}
