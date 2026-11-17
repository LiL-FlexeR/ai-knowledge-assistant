import { searchHitSchema } from '@aka/shared';
import type { SearchHit } from '@aka/shared';
import { vectorRowSchema } from './vector-reader';
import type { VectorRow } from './vector-reader';

export function excerpt(content: string): string {
  let end = Math.min(1000, content.length);
  if (end < content.length && /[\uD800-\uDBFF]/u.test(content[end - 1]!)) end--;
  return content.slice(0, end);
}
export function mapSource(row: VectorRow): SearchHit {
  const parsed = vectorRowSchema.parse(row);
  const location = parsed.location;
  if (
    location.charEnd - location.charStart !== parsed.content.length ||
    (location.kind !== 'pdf' && location.lineEnd < location.lineStart) ||
    (location.kind === 'text' &&
      (location.unitIndex !== 0 || location.sectionOrdinal !== 1))
  )
    throw new Error('Invalid stored source span.');
  return searchHitSchema.parse({
    chunkId: parsed.chunkId,
    chunkIndex: parsed.chunkIndex,
    similarity: 1 - parsed.distance,
    source: {
      documentId: parsed.documentId,
      filename: parsed.filename,
      location,
      excerpt: excerpt(parsed.content),
    },
  });
}
