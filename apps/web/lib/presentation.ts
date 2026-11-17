import type { DocumentDTO, SourceLocation } from '@aka/shared';
export function sourceLabel(location: SourceLocation): string {
  if (location.kind === 'pdf') return `Physical page ${location.page}`;
  const lines =
    location.lineStart === location.lineEnd
      ? `Line ${location.lineStart}`
      : `Lines ${location.lineStart}–${location.lineEnd}`;
  return location.kind === 'markdown'
    ? `${location.headingPath.join(' / ') || `Section ${location.sectionOrdinal}`} · ${lines}`
    : `Section ${location.sectionOrdinal} · ${lines}`;
}
export function pollingInterval(
  document: DocumentDTO | undefined,
  failures: number,
  active: boolean,
  retryAfter = 0,
): number | false {
  if (
    !active ||
    !document ||
    !['pending', 'processing', 'deleting'].includes(document.status)
  )
    return false;
  return Math.max(
    retryAfter * 1000,
    Math.min(30_000, 2000 * 2 ** Math.min(failures, 4)),
  );
}
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KiB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
