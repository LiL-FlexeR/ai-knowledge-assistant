export type EmbeddingInput = { content: string; tokenCount: number };
export type EmbeddingResult = {
  vectors: number[][];
  inputTokens: number | null;
};
export type EmbeddingOptions = { waitForCapacity?: boolean };
export abstract class EmbeddingClient {
  abstract embed(
    inputs: EmbeddingInput[],
    signal: AbortSignal,
    deadline: number,
    options?: EmbeddingOptions,
  ): Promise<EmbeddingResult>;
}
