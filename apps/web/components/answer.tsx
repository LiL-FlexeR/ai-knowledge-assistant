import type { AskResponse } from '@aka/shared';
import { sourceLabel } from '../lib/presentation';
import { Badge } from './ui/badge';
import { Alert, AlertTitle, AlertDescription } from './ui/alert';

const reasons = {
  NO_READY_DOCUMENTS: 'No ready documents',
  NO_RELEVANT_CONTEXT: 'No relevant passages',
  EVIDENCE_INSUFFICIENT: 'Evidence is insufficient',
  PROVIDER_REFUSAL: 'The provider declined this question',
};
export function Answer({ result }: { result: AskResponse }) {
  if (result.status !== 'answered')
    return (
      <Alert>
        <AlertTitle>
          {result.reason ? reasons[result.reason] : 'No answer available'}
        </AlertTitle>
        <AlertDescription>
          <p>{result.limitation}</p>
          <p>
            {result.reason === 'NO_READY_DOCUMENTS'
              ? 'Add a document and wait for it to become ready.'
              : 'Try a more specific question or add a document with the missing evidence.'}
          </p>
        </AlertDescription>
      </Alert>
    );
  return (
    <div className="answer-layout">
      <section aria-labelledby="answer-title">
        <div className="section-heading">
          <h2 id="answer-title">Answer</h2>
          <Badge variant="secondary">With sources</Badge>
        </div>
        <div className="answer-statements">
          {result.statements.map((statement, index) => (
            <p key={index}>
              {statement.text}{' '}
              {statement.sourceIds.map((id) => (
                <a
                  className="citation"
                  key={id}
                  href={`#source-${id}`}
                  aria-label={`Inspect source ${id}`}
                  onClick={() => {
                    document.getElementById(`source-${id}`)?.focus();
                  }}
                >
                  [{id}]
                </a>
              ))}
            </p>
          ))}
        </div>
        {result.limitation ? (
          <p className="limitation">
            <strong>Evidence limitation:</strong> {result.limitation}
          </p>
        ) : null}
        <p className="muted">
          Check the excerpts below. A valid reference does not guarantee the
          statement is correct.
        </p>
      </section>
      <section aria-labelledby="sources-title">
        <h2 id="sources-title">Sources</h2>
        <p className="muted">
          Excerpts from the passages used for this answer. Locations describe
          the full passage.
        </p>
        <div className="source-list">
          {result.citations.map(({ sourceId, source }) => (
            <article
              id={`source-${sourceId}`}
              key={sourceId}
              tabIndex={-1}
              className="source-card"
              aria-label={`Source ${sourceId}`}
            >
              <div className="source-heading">
                <Badge variant="outline">{sourceId}</Badge>
                <h3 className="filename">{source.filename}</h3>
              </div>
              <p className="source-location">{sourceLabel(source.location)}</p>
              <h4>Excerpt</h4>
              <blockquote>{source.excerpt}</blockquote>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
