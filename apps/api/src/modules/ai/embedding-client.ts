export type EmbeddingInput = { content: string; tokenCount: number };
export type EmbeddingResult = {
  vectors: number[][];
  inputTokens: number | null;
};
export abstract class EmbeddingClient {
  abstract embed(
    inputs: EmbeddingInput[],
    signal: AbortSignal,
    deadline: number,
  ): Promise<EmbeddingResult>;
}
