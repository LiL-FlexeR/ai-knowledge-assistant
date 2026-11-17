import { Injectable } from '@nestjs/common';

// Documents owns lifecycle invalidation; ingestion registers cancellable local work.
@Injectable()
export class DocumentWorkSignals {
  private readonly active = new Map<
    string,
    { runId: string; controller: AbortController }
  >();
  register(id: string, runId: string, controller: AbortController): () => void {
    this.active.set(id, { runId, controller });
    return () => {
      if (this.active.get(id)?.controller === controller)
        this.active.delete(id);
    };
  }
  cancel(id: string, preserveRunId?: string): void {
    const active = this.active.get(id);
    if (active && active.runId !== preserveRunId) active.controller.abort();
  }
}
