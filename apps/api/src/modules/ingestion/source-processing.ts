import { getEncoding } from 'js-tiktoken';
import { sourceLocationSchema } from '@aka/shared';
import type { SourceLocation } from '@aka/shared';
import type { Environment } from '../../config/environment';
import { limitExceeded, ProcessingFailure } from '../../processing-error';

export type SourceUnit = {
  unitIndex: number;
  contentStart: number;
  contentEnd: number;
  location: SourceLocation;
  lines: { line: number; charStart: number; charEnd: number }[];
};
export type Chunk = {
  content: string;
  chunkIndex: number;
  tokenCount: number;
  sourceLocation: SourceLocation;
};
export type PreparedDocument = {
  content: string;
  sourceMap: SourceUnit[];
  chunks: Chunk[];
  tokenCount: number;
};
const tokenizer = getEncoding('cl100k_base');
export function countTokens(text: string): number {
  // Special-token strings in untrusted documents are ordinary text.
  return tokenizer.encode(text, [], []).length;
}
export function normalize(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .normalize('NFC')
    .split('\n')
    .map((line) => line.replace(/[\t\p{Zs}]+$/gu, ''))
    .join('\n');
}

export function prepareSources(
  pages: string[],
  mime: string,
  config: Environment,
): PreparedDocument {
  if (
    pages.reduce((n, page) => n + page.length, 0) > config.MAX_EXTRACTED_CHARS
  )
    throw limitExceeded();
  const units: {
    text: string;
    location: SourceLocation;
    lines: SourceUnit['lines'];
  }[] = [];
  if (mime === 'application/pdf') {
    if (pages.length > config.MAX_PDF_PAGES) throw limitExceeded();
    pages.forEach((page, unitIndex) => {
      const text = normalize(page);
      units.push({
        text,
        location: {
          kind: 'pdf',
          unitIndex,
          page: unitIndex + 1,
          charStart: 0,
          charEnd: text.length,
        },
        lines: [],
      });
    });
  } else {
    const lines = normalize(pages[0] ?? '').split('\n');
    let start = 0;
    let fence: { marker: string; length: number } | undefined;
    const headings: { level: number; text: string }[] = [];
    let path: string[] = [];
    function append(end: number) {
      if (end <= start) return;
      const text = lines.slice(start, end).join('\n');
      const unitIndex = units.length;
      let offset = 0;
      const lineMap = lines.slice(start, end).map((line, index) => {
        const entry = {
          line: start + index + 1,
          charStart: offset,
          charEnd: offset + line.length,
        };
        offset += line.length + 1;
        return entry;
      });
      const base = {
        unitIndex,
        sectionOrdinal: unitIndex + 1,
        lineStart: start + 1,
        lineEnd: end,
        charStart: 0,
        charEnd: text.length,
      };
      units.push({
        text,
        lines: lineMap,
        location:
          mime === 'text/markdown'
            ? { kind: 'markdown', ...base, headingPath: path }
            : { kind: 'text', ...base },
      });
    }
    if (mime === 'text/markdown') {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (marker) {
          if (!fence && !(marker[1]![0] === '`' && marker[2]!.includes('`')))
            fence = { marker: marker[1]![0]!, length: marker[1]!.length };
          else if (
            fence &&
            marker[1]![0] === fence.marker &&
            marker[1]!.length >= fence.length &&
            !marker[2]!.trim()
          )
            fence = undefined;
          continue;
        }
        if (fence) continue;
        const heading = /^ {0,3}(#{1,6})(?:[\t ]+|$)(.*)$/.exec(line);
        const setext =
          i + 1 < lines.length &&
          line.trim() &&
          /^ {0,3}(=+|-+)[\t ]*$/.exec(lines[i + 1]!);
        if (!heading && !setext) continue;
        append(i);
        start = i;
        const level = heading
          ? heading[1]!.length
          : setext && setext[1]![0] === '='
            ? 1
            : 2;
        const text = heading
          ? heading[2]!.replace(/[\t ]+#+[\t ]*$/, '').trim()
          : line.trim();
        while (headings.length && headings.at(-1)!.level >= level)
          headings.pop();
        headings.push({ level, text });
        path = headings.map((item) => item.text);
        if (setext && !heading) i++;
      }
    }
    append(lines.length);
  }
  let content = '';
  const sourceMap: SourceUnit[] = [];
  for (const unit of units) {
    if (sourceMap.length) content += '\n\n';
    const contentStart = content.length;
    content += unit.text;
    sourceMap.push({
      unitIndex: sourceMap.length,
      contentStart,
      contentEnd: content.length,
      location: unit.location,
      lines: unit.lines,
    });
  }
  if (!content.trim())
    throw new ProcessingFailure(
      'NO_EXTRACTABLE_TEXT',
      'Document contains no extractable text. OCR is not supported.',
    );
  const tokenCount = units.reduce((n, u) => n + countTokens(u.text), 0);
  if (
    content.length > config.MAX_EXTRACTED_CHARS ||
    tokenCount > config.MAX_DOCUMENT_TOKENS
  )
    throw limitExceeded();
  const chunks: Chunk[] = [];
  for (const unit of sourceMap) {
    const text = content.slice(unit.contentStart, unit.contentEnd);
    // Code-point boundaries keep every span valid UTF-16 even for multi-token emoji.
    const boundaries = [0];
    for (const cp of text) boundaries.push(boundaries.at(-1)! + cp.length);
    let start = 0;
    while (start < boundaries.length - 1) {
      let end = start;
      // Binary search an actual substring, never decode/reconstruct token text.
      let low = start + 1;
      let high = Math.min(
        boundaries.length - 1,
        start + config.CHUNK_TOKENS * 16,
      );
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (
          countTokens(text.slice(boundaries[start], boundaries[mid])) <=
          config.CHUNK_TOKENS
        ) {
          end = mid;
          low = mid + 1;
        } else high = mid - 1;
      }
      if (end === start)
        throw new ProcessingFailure(
          'CHUNK_LIMIT_EXCEEDED',
          'A Unicode character exceeds the chunk token limit.',
        );
      if (end < boundaries.length - 1) {
        const candidate = text.slice(boundaries[start], boundaries[end]);
        const paragraph = candidate.lastIndexOf('\n\n');
        const sentences = [...candidate.matchAll(/[.!?][\t \n]+/g)];
        const preferred =
          paragraph >= candidate.length / 2
            ? paragraph + 2
            : (sentences.at(-1)?.index ?? -1) +
              (sentences.at(-1)?.[0].length ?? 0);
        if (preferred >= candidate.length / 2) {
          const index = boundaries.indexOf(boundaries[start]! + preferred);
          if (index > start) end = index;
        }
      }
      // Changing a BPE prefix can increase its token count; recount the selected span.
      while (
        end > start &&
        countTokens(text.slice(boundaries[start], boundaries[end])) >
          config.CHUNK_TOKENS
      )
        end--;
      if (end === start)
        throw new ProcessingFailure(
          'CHUNK_LIMIT_EXCEEDED',
          'A Unicode character exceeds the chunk token limit.',
        );
      const charStart = boundaries[start]!;
      const charEnd = boundaries[end]!;
      const slice = text.slice(charStart, charEnd);
      if (slice.trim()) {
        let location = { ...unit.location, charStart, charEnd };
        if (location.kind !== 'pdf') {
          const touched = unit.lines.filter(
            (line) => line.charEnd >= charStart && line.charStart < charEnd,
          );
          location = {
            ...location,
            lineStart: touched[0]!.line,
            lineEnd: touched.at(-1)!.line,
          };
        }
        chunks.push({
          content: slice,
          chunkIndex: chunks.length,
          tokenCount: countTokens(slice),
          sourceLocation: location,
        });
        if (chunks.length > config.MAX_CHUNKS)
          throw new ProcessingFailure(
            'CHUNK_LIMIT_EXCEEDED',
            'Document exceeds the chunk limit.',
          );
      }
      if (end === boundaries.length - 1) break;
      let next = end;
      // Overlap is bounded and must leave both start and end moving forwards.
      for (let i = end - 1; i > start; i--) {
        if (
          countTokens(text.slice(boundaries[i], charEnd)) >
          config.CHUNK_OVERLAP_TOKENS
        )
          break;
        next = i;
      }
      start = Math.max(start + 1, next);
    }
  }
  return { content, sourceMap, chunks, tokenCount };
}

export function validatePrepared(
  prepared: PreparedDocument,
  config: Environment,
): void {
  if (
    !prepared.chunks.length ||
    prepared.chunks.length > config.MAX_CHUNKS ||
    prepared.content.length > config.MAX_EXTRACTED_CHARS ||
    !Number.isInteger(prepared.tokenCount) ||
    prepared.tokenCount < 1 ||
    prepared.tokenCount > config.MAX_DOCUMENT_TOKENS
  )
    throw limitExceeded();
  let end = 0;
  for (const [index, unit] of prepared.sourceMap.entries()) {
    const location = sourceLocationSchema.parse(unit.location);
    if (
      unit.unitIndex !== index ||
      location.unitIndex !== index ||
      unit.contentStart !== (index ? end + 2 : 0) ||
      unit.contentEnd < unit.contentStart ||
      unit.contentEnd > prepared.content.length ||
      location.charStart !== 0 ||
      location.charEnd !== unit.contentEnd - unit.contentStart ||
      (index && prepared.content.slice(end, unit.contentStart) !== '\n\n')
    )
      throw new ProcessingFailure(
        'SOURCE_LOCATION_UNAVAILABLE',
        'Document source units could not be verified.',
      );
    if (location.kind === 'pdf') {
      if (
        location.page !== index + 1 ||
        prepared.sourceMap.length > config.MAX_PDF_PAGES
      )
        throw new ProcessingFailure(
          'SOURCE_LOCATION_UNAVAILABLE',
          'PDF physical pages could not be verified.',
        );
    } else {
      if (
        location.sectionOrdinal !== index + 1 ||
        !unit.lines.length ||
        location.lineStart !== unit.lines[0]!.line ||
        location.lineEnd !== unit.lines.at(-1)!.line
      )
        throw new ProcessingFailure(
          'SOURCE_LOCATION_UNAVAILABLE',
          'Document lines could not be verified.',
        );
      let offset = 0;
      for (const [lineIndex, line] of unit.lines.entries()) {
        if (
          line.line !== location.lineStart + lineIndex ||
          line.charStart !== offset ||
          line.charEnd < line.charStart ||
          line.charEnd > location.charEnd
        )
          throw new ProcessingFailure(
            'SOURCE_LOCATION_UNAVAILABLE',
            'Document line map is invalid.',
          );
        offset = line.charEnd + 1;
      }
      if (offset - 1 !== location.charEnd)
        throw new ProcessingFailure(
          'SOURCE_LOCATION_UNAVAILABLE',
          'Document line map is incomplete.',
        );
    }
    end = unit.contentEnd;
  }
  if (end !== prepared.content.length) throw limitExceeded();
  for (const [index, chunk] of prepared.chunks.entries()) {
    const location = sourceLocationSchema.parse(chunk.sourceLocation);
    const unit = prepared.sourceMap[location.unitIndex];
    if (
      !unit ||
      unit.unitIndex !== location.unitIndex ||
      chunk.chunkIndex !== index ||
      location.kind !== unit.location.kind ||
      !chunk.content.trim() ||
      location.charEnd <= location.charStart ||
      location.charEnd > unit.contentEnd - unit.contentStart ||
      chunk.content !==
        prepared.content.slice(
          unit.contentStart + location.charStart,
          unit.contentStart + location.charEnd,
        ) ||
      chunk.tokenCount < 1 ||
      chunk.tokenCount > config.CHUNK_TOKENS
    )
      throw new ProcessingFailure(
        'SOURCE_LOCATION_UNAVAILABLE',
        'Document source locations could not be verified.',
      );
    if (
      !Number.isInteger(chunk.tokenCount) ||
      /[\uD800-\uDFFF]/u.test(chunk.content)
    )
      throw new ProcessingFailure(
        'SOURCE_LOCATION_UNAVAILABLE',
        'Chunk token spans could not be verified.',
      );
    if (
      location.kind === 'pdf' &&
      unit.location.kind === 'pdf' &&
      location.page !== unit.location.page
    )
      throw new ProcessingFailure(
        'SOURCE_LOCATION_UNAVAILABLE',
        'Chunk page does not match its source.',
      );
    if (location.kind !== 'pdf' && unit.location.kind !== 'pdf') {
      const touched = unit.lines.filter(
        (line) =>
          line.charEnd >= location.charStart &&
          line.charStart < location.charEnd,
      );
      if (
        location.sectionOrdinal !== unit.location.sectionOrdinal ||
        location.lineStart !== touched[0]?.line ||
        location.lineEnd !== touched.at(-1)?.line ||
        (location.kind === 'markdown' &&
          unit.location.kind === 'markdown' &&
          JSON.stringify(location.headingPath) !==
            JSON.stringify(unit.location.headingPath))
      )
        throw new ProcessingFailure(
          'SOURCE_LOCATION_UNAVAILABLE',
          'Chunk lines do not match their source.',
        );
    }
  }
}
