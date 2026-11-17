import { z } from 'zod';
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';
import type { Environment } from '../../config/environment';
import { groundedOutputSchema } from './grounded-answer-client';
import type { GroundedPrompt } from './grounded-answer-client';

const { $schema: _schema, ...schema } = z.toJSONSchema(groundedOutputSchema);
void _schema;
export function generationRequest(
  prompt: GroundedPrompt,
  config: Environment,
): ResponseCreateParamsNonStreaming {
  return {
    model: config.OPENAI_CHAT_MODEL!,
    instructions: prompt.instructions,
    input: [
      { role: 'user', content: [{ type: 'input_text', text: prompt.input }] },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'grounded_answer_v1',
        strict: true,
        schema,
      },
    },
    reasoning: { effort: 'none' },
    max_output_tokens: config.ANSWER_MAX_OUTPUT_TOKENS,
    tools: [],
    tool_choice: 'none',
    store: false,
    stream: false,
    truncation: 'disabled',
  };
}
