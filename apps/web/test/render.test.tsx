import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { askRequestSchema, askSchema, formatAnswer } from '@aka/shared';
import { Answer } from '../components/answer';

void test('question bounds trim and reject empty/oversized input', () => {
  for (const question of ['', '  ', 'x'.repeat(2001)])
    assert.equal(askRequestSchema.safeParse({ question }).success, false);
  assert.equal(
    askRequestSchema.parse({ question: '  Policy?  ' }).question,
    'Policy?',
  );
});
void test('source and model hostile text is escaped, citations are local server-ID anchors', () => {
  const statements = [
    { text: '<script>alert(1)</script> https://evil.test', sourceIds: ['S1'] },
  ];
  const result = askSchema.parse({
    status: 'answered',
    answer: formatAnswer(statements, null),
    statements,
    citations: [
      {
        sourceId: 'S1',
        chunkId: '11111111-1111-4111-8111-111111111111',
        source: {
          documentId: '22222222-2222-4222-8222-222222222222',
          filename: '<img src=x onerror=alert(1)>.md',
          excerpt: '<svg onload=alert(1)>',
          location: {
            kind: 'markdown',
            unitIndex: 0,
            charStart: 0,
            charEnd: 20,
            sectionOrdinal: 1,
            lineStart: 1,
            lineEnd: 2,
            headingPath: ['<b>Policy</b>'],
          },
        },
      },
    ],
    reason: null,
    limitation: null,
    retrieval: { requestedTopK: 5, matchedChunks: 1, contextChunks: 1 },
    usage: {
      embeddingInputTokens: 1,
      generationInputTokens: 1,
      generationOutputTokens: 1,
    },
  });
  const html = renderToStaticMarkup(<Answer result={result} />);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;svg/);
  assert.match(html, /href="#source-S1"/);
  assert.doesNotMatch(html, /<script|<svg|<img|href="https:\/\/evil/);
});
