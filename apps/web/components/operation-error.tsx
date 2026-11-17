import { ApiError } from '../lib/api';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';

const advice: Record<string, string> = {
  EVIDENCE_CHANGED:
    'Sources changed during this answer. Submit again to use current evidence.',
  DOCUMENT_BUSY:
    'This document is already being processed or deleted. Wait for its status to change.',
  CAPACITY_EXCEEDED:
    'Wait for processing to finish or delete an unused document.',
  AI_NOT_CONFIGURED: 'Configure OpenAI on the local API, then retry manually.',
  AI_UNAVAILABLE: 'Check the local API configuration, then retry manually.',
  ORIGINAL_FILE_MISSING: 'Delete this entry and upload the original again.',
};
export function OperationError({ error }: { error: unknown }) {
  const api = error instanceof ApiError ? error : null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertTitle>
        {api?.code === 'EVIDENCE_CHANGED'
          ? 'Evidence changed'
          : 'Request could not finish'}
      </AlertTitle>
      <AlertDescription>
        <p>{api?.message || 'Something went wrong. Please try again.'}</p>
        {api && advice[api.code] ? <p>{advice[api.code]}</p> : null}
        {api?.retryAfter != null ? (
          <p>Wait {api.retryAfter} seconds before retrying.</p>
        ) : null}
        {api?.requestId ? (
          <p className="correlation">Request ID: {api.requestId}</p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
