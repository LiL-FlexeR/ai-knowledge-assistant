import { getEncoding } from 'js-tiktoken';
const tokenizer = getEncoding('o200k_base');
export const countGenerationTokens = (text: string): number =>
  tokenizer.encode(text, [], []).length;
