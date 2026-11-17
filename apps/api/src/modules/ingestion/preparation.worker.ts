import { parentPort, workerData } from 'node:worker_threads';
import type { Environment } from '../../config/environment';
import { prepareSources, validatePrepared } from './source-processing';
import { limitExceeded, ProcessingFailure } from '../../processing-error';

type Input = { bytes: Uint8Array; mime: string; config: Environment };
async function extract({ bytes, mime, config }: Input): Promise<string[]> {
  if (mime !== 'application/pdf') {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new ProcessingFailure(
        'INVALID_DOCUMENT',
        'Document must contain valid UTF-8 text.',
      );
    }
    if (text.includes('\0'))
      throw new ProcessingFailure(
        'INVALID_DOCUMENT',
        'Binary text is unsupported.',
      );
    if (text.length > config.MAX_EXTRACTED_CHARS) throw limitExceeded();
    return [text];
  }
  // No URL, fetching, rendering, scripts, attachments or annotations are requested.
  // Supplying data prevents document-controlled external resource loading.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: bytes,
    useSystemFonts: false,
    disableFontFace: true,
    useWasm: false,
    isOffscreenCanvasSupported: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  task.onPassword = () => {
    void task.destroy();
  };
  try {
    const pdf = await task.promise;
    if (pdf.numPages > config.MAX_PDF_PAGES) throw limitExceeded();
    const pages: string[] = [];
    let chars = 0;
    for (let page = 1; page <= pdf.numPages; page++) {
      const source = await pdf.getPage(page);
      const stream = source
        .streamTextContent({ includeMarkedContent: false })
        .getReader();
      let text = '';
      while (true) {
        const part = await stream.read();
        if (part.done) break;
        for (const item of part.value.items) {
          if (!('str' in item)) continue;
          const piece = item.str + (item.hasEOL ? '\n' : ' ');
          chars += piece.length;
          if (chars > config.MAX_EXTRACTED_CHARS) {
            throw limitExceeded();
          }
          text += piece;
        }
      }
      pages.push(text);
      source.cleanup();
    }
    return pages;
  } catch (error) {
    if (error instanceof ProcessingFailure) throw error;
    throw new ProcessingFailure(
      'UNSUPPORTED_PDF',
      'PDF is malformed, encrypted or unsupported.',
    );
  } finally {
    await task.destroy();
  }
}
void (async () => {
  try {
    // Worker never receives credentials, paths, URLs or database access.
    const input = workerData as Input;
    const pages = await extract(input);
    const result = prepareSources(pages, input.mime, input.config);
    validatePrepared(result, input.config);
    parentPort!.postMessage({ result });
  } catch (error) {
    const failure =
      error instanceof ProcessingFailure
        ? error
        : new ProcessingFailure(
            'INVALID_DOCUMENT',
            'Document could not be extracted.',
          );
    parentPort!.postMessage({ error: failure.toJSON() });
  }
})();
