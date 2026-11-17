import 'reflect-metadata';
import { parseEnvironment } from '../src/config/environment';
import { ExtractionService } from '../src/modules/ingestion/extraction.service';
import {
  countTokens,
  normalize,
  prepareSources,
  validatePrepared,
} from '../src/modules/ingestion/source-processing';
import { syntheticPdf, imageOnlyPdf } from './fixtures/synthetic-pdf';

const config = parseEnvironment({});
const signal = () => new AbortController().signal;
describe('canonical sources and deterministic token spans', () => {
  it('normalizes BOM/CRLF/CR/NFC/trailing space and preserves original lines', () => {
    const text = '\uFEFFCafe\u0301  \r\n\t\rthree\t \n';
    expect(normalize(text)).toBe('Café\n\nthree\n');
    const result = prepareSources([text], 'text/plain', config);
    expect(result.content).toBe('Café\n\nthree\n');
    expect(result.sourceMap[0]!.lines.map((line) => line.line)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(result.chunks[0]!.sourceLocation).toMatchObject({
      kind: 'text',
      sectionOrdinal: 1,
      lineStart: 1,
      lineEnd: 3,
    });
    validatePrepared(result, config);
  });
  it('keeps repeated headings, setext headings and fences in their original sections', () => {
    const text =
      'Preamble\n# Same\na\n```md\n# Fake\n~~~\n```\n## Child\nb\n# Same\nc\nTitle\n=====\nd';
    const result = prepareSources([text], 'text/markdown', config);
    expect(
      result.sourceMap.map((unit) =>
        unit.location.kind === 'markdown' ? unit.location.headingPath : [],
      ),
    ).toEqual([[], ['Same'], ['Same', 'Child'], ['Same'], ['Title']]);
    expect(
      result.sourceMap.map(
        (unit) => unit.location.kind !== 'pdf' && unit.location.sectionOrdinal,
      ),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(result.chunks[1]!.content).toContain('# Fake');
    expect(result.chunks[2]!.sourceLocation).toMatchObject({
      lineStart: 8,
      lineEnd: 9,
    });
    validatePrepared(result, config);
  });
  it('creates exact Unicode spans, bounded overlap and continuous progress on long lines', () => {
    const local = { ...config, CHUNK_TOKENS: 20, CHUNK_OVERLAP_TOKENS: 5 };
    const text = 'Hello 🌍. 雪 e\u0301 abcdefghijklmnop '.repeat(45);
    const a = prepareSources([text], 'text/plain', local);
    expect(a).toEqual(prepareSources([text], 'text/plain', local));
    let previousStart = -1;
    let previousEnd = 0;
    for (const chunk of a.chunks) {
      const span = chunk.sourceLocation;
      expect(chunk.content).toBe(a.content.slice(span.charStart, span.charEnd));
      expect(/[\uD800-\uDFFF]/u.test(chunk.content)).toBe(false);
      expect(chunk.tokenCount).toBe(countTokens(chunk.content));
      expect(chunk.tokenCount).toBeLessThanOrEqual(20);
      expect(span.charStart).toBeGreaterThan(previousStart);
      expect(span.charEnd).toBeGreaterThan(previousEnd);
      if (previousEnd)
        expect(
          countTokens(a.content.slice(span.charStart, previousEnd)),
        ).toBeLessThanOrEqual(5);
      previousStart = span.charStart;
      previousEnd = span.charEnd;
    }
    expect(previousEnd).toBe(a.content.length);
    validatePrepared(a, local);
  });
  it('emits one tiny chunk, no empty trailing chunk, and treats special tokens as text', () => {
    const result = prepareSources(['<|endoftext|> x\n'], 'text/plain', config);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]!.content).toBe(result.content);
  });
  it.each([
    [{ MAX_EXTRACTED_CHARS: 3 }, 'hello', 'EXTRACTION_LIMIT_EXCEEDED'],
    [{ MAX_DOCUMENT_TOKENS: 1 }, 'hello world', 'EXTRACTION_LIMIT_EXCEEDED'],
    [
      { MAX_CHUNKS: 1, CHUNK_TOKENS: 3, CHUNK_OVERLAP_TOKENS: 0 },
      'a b c d e f g',
      'CHUNK_LIMIT_EXCEEDED',
    ],
    [{}, ' \n ', 'NO_EXTRACTABLE_TEXT'],
  ])('rejects budgets before paid calls (%s)', (overrides, text, code) => {
    expect(() =>
      prepareSources([text], 'text/plain', { ...config, ...overrides }),
    ).toThrow(expect.objectContaining({ code }));
  });
  it('rejects corrupted canonical spans before publication', () => {
    const result = prepareSources(['text'], 'text/plain', config);
    result.chunks[0]!.sourceLocation.charEnd = 100;
    expect(() => validatePrepared(result, config)).toThrow();
  });
});
describe('terminable production extraction worker', () => {
  it('retains real physical pages including an empty page', async () => {
    const result = await new ExtractionService(config).prepare(
      syntheticPdf(['Page one handbook', '', 'Page three policy']),
      'application/pdf',
      signal(),
    );
    expect(
      result.sourceMap.map(
        (unit) => unit.location.kind === 'pdf' && unit.location.page,
      ),
    ).toEqual([1, 2, 3]);
    expect(
      result.chunks.map(
        (chunk) =>
          chunk.sourceLocation.kind === 'pdf' && chunk.sourceLocation.page,
      ),
    ).toEqual([1, 3]);
    validatePrepared(result, config);
  });
  it.each([
    [imageOnlyPdf(), 'NO_EXTRACTABLE_TEXT'],
    [Buffer.from('%PDF-1.7\nbroken'), 'UNSUPPORTED_PDF'],
    [syntheticPdf(['secret'], true), 'UNSUPPORTED_PDF'],
  ])('rejects scanned/malformed/encrypted input (%s)', async (bytes, code) => {
    await expect(
      new ExtractionService(config).prepare(bytes, 'application/pdf', signal()),
    ).rejects.toMatchObject({ code });
  });
  it('enforces page and character limits while reading', async () => {
    await expect(
      new ExtractionService({ ...config, MAX_PDF_PAGES: 1 }).prepare(
        syntheticPdf(['one', 'two']),
        'application/pdf',
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'EXTRACTION_LIMIT_EXCEEDED' });
    await expect(
      new ExtractionService({ ...config, MAX_EXTRACTED_CHARS: 2 }).prepare(
        syntheticPdf(['hello']),
        'application/pdf',
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'EXTRACTION_LIMIT_EXCEEDED' });
  });
  it('terminates on deadline and cancellation, and rejects invalid UTF-8/binary', async () => {
    await expect(
      new ExtractionService({ ...config, EXTRACTION_TIMEOUT_MS: 1 }).prepare(
        syntheticPdf(['hello']),
        'application/pdf',
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'EXTRACTION_LIMIT_EXCEEDED' });
    const controller = new AbortController();
    const running = new ExtractionService(config).prepare(
      syntheticPdf(['hello']),
      'application/pdf',
      controller.signal,
    );
    controller.abort();
    await expect(running).rejects.toMatchObject({
      code: 'PROCESSING_INTERRUPTED',
    });
    for (const bytes of [Buffer.from([0xff]), Buffer.from('a\0b')])
      await expect(
        new ExtractionService(config).prepare(bytes, 'text/plain', signal()),
      ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' });
  });
});

it('cancels only invalidated work when a new run has already registered', async () => {
  const { DocumentWorkSignals } =
    await import('../src/modules/documents/document-work-signals.js');
  const work = new DocumentWorkSignals();
  const old = new AbortController();
  work.register('id', 'old', old);
  work.cancel('id', 'new');
  expect(old.signal.aborted).toBe(true);
  const next = new AbortController();
  work.register('id', 'new', next);
  work.cancel('id', 'new');
  expect(next.signal.aborted).toBe(false);
  work.cancel('id');
  expect(next.signal.aborted).toBe(true);
});
it('rejects extraction when the worker exhausts its small heap budget', async () => {
  await expect(
    new ExtractionService({ ...config, EXTRACTION_MAX_MEMORY_MB: 8 }).prepare(
      Buffer.from('text'),
      'text/plain',
      signal(),
    ),
  ).rejects.toMatchObject({ code: 'EXTRACTION_LIMIT_EXCEEDED' });
});
