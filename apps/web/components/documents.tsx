'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import type { DocumentDTO } from '@aka/shared';
import Link from 'next/link';
import { api, ApiError } from '../lib/api';
import { uploadSchema } from '../lib/forms';
import { fileSize, pollingInterval } from '../lib/presentation';
import { useActivity } from './use-activity';
import { OperationError } from './operation-error';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from './ui/field';
import { Badge } from './ui/badge';
import { Skeleton } from './ui/skeleton';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';

export function Documents() {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [notice, setNotice] = useState('');
  const cursor = cursors[cursors.length - 1];
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ['documents', 'list', cursor],
    queryFn: ({ signal }) => api.list(cursor, signal),
  });
  const form = useForm<z.infer<typeof uploadSchema>>({
    resolver: zodResolver(uploadSchema),
  });
  const formElement = useRef<HTMLFormElement>(null);
  const upload = useMutation({
    mutationFn: api.upload,
    onSuccess: async () => {
      setNotice('Upload complete. See the current processing status below.');
      form.reset();
      formElement.current?.reset();
      setCursors([undefined]);
      await client.invalidateQueries({ queryKey: ['documents'] });
    },
  });
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <h1>Documents</h1>
          <p className="muted">Build the collection your answers will use.</p>
        </div>
        <Link className="text-link" href="/ask">
          Ask a question
        </Link>
      </div>
      <section aria-labelledby="upload-title" className="upload-region">
        <h2 id="upload-title">Add a document</h2>
        <p className="muted">
          PDF with selectable text, TXT, or Markdown. One file, up to 10 MiB.
          Scanned PDFs need OCR elsewhere.
        </p>
        <form
          ref={formElement}
          onSubmit={form.handleSubmit(async ({ file }) => {
            setNotice('');
            try {
              await upload.mutateAsync(file);
            } catch {
              /* shown below */
            }
          })}
        >
          <FieldGroup>
            <Controller
              control={form.control}
              name="file"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="upload-file">Choose a file</FieldLabel>
                  <div className="upload-controls">
                    <Input
                      id="upload-file"
                      type="file"
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      onChange={(event) => {
                        field.onChange(event.target.files?.[0]);
                        upload.reset();
                      }}
                      accept=".pdf,.txt,.md,.markdown"
                      aria-invalid={fieldState.invalid}
                      aria-describedby="upload-help upload-error"
                      disabled={upload.isPending}
                    />
                    <Button
                      type="submit"
                      disabled={upload.isPending || form.formState.isSubmitting}
                    >
                      {upload.isPending ? 'Uploading…' : 'Upload document'}
                    </Button>
                  </div>
                  <FieldDescription id="upload-help">
                    Uploading sends text to OpenAI when processing is
                    configured. Processing may incur costs.
                  </FieldDescription>
                  <FieldError id="upload-error">
                    {fieldState.error?.message}
                  </FieldError>
                </Field>
              )}
            />
          </FieldGroup>
        </form>
        {upload.error ? <OperationError error={upload.error} /> : null}
        <p role="status" className="status-message">
          {upload.isPending
            ? 'Transferring file… Processing starts after the upload completes.'
            : notice}
        </p>
      </section>
      <section aria-labelledby="collection-title">
        <div className="section-heading">
          <h2 id="collection-title" tabIndex={-1}>
            Your collection
          </h2>
          <Button
            variant="outline"
            size="sm"
            disabled={list.isFetching}
            onClick={() => {
              void list.refetch();
            }}
          >
            Refresh list
          </Button>
        </div>
        {list.error ? (
          <div className="page-stack">
            <OperationError error={list.error} />
            <Button
              variant="outline"
              onClick={() => {
                setCursors([undefined]);
                void list.refetch();
              }}
            >
              Restart listing
            </Button>
          </div>
        ) : null}
        {list.isPending ? (
          <div
            aria-label="Loading documents"
            role="status"
            className="loading-list"
          >
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <span className="sr-only">Loading documents…</span>
          </div>
        ) : null}
        {list.data?.data.items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                {cursor ? 'No more documents' : 'Your collection starts here'}
              </EmptyTitle>
              <EmptyDescription>
                {cursor
                  ? 'Return to the first page to see your collection.'
                  : 'Choose a document above. Once it is ready, you can ask questions and inspect its sources.'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        <ul className="document-list">
          {list.data?.data.items.map((item) => (
            <DocumentRow key={item.id} item={item} onNotice={setNotice} />
          ))}
        </ul>
        {list.data ? (
          <div className="pagination">
            <p className="muted">
              Page {cursors.length} · {list.data.data.items.length} documents on
              this page
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={cursors.length === 1 || list.isFetching}
                onClick={() => setCursors((old) => old.slice(0, -1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={
                  !list.data.data.pagination.nextCursor || list.isFetching
                }
                onClick={() => {
                  const next = list.data?.data.pagination.nextCursor;
                  if (next) setCursors((old) => [...old, next]);
                }}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function DocumentRow({
  item,
  onNotice,
}: {
  item: DocumentDTO;
  onNotice: (notice: string) => void;
}) {
  const client = useQueryClient();
  const active = useActivity();
  const row = useRef<HTMLLIElement>(null);
  const actionTrigger = useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [action, setAction] = useState<'delete' | 'reprocess' | null>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry?.isIntersecting ?? false),
    );
    if (row.current) observer.observe(row.current);
    return () => observer.disconnect();
  }, []);
  const detail = useQuery({
    queryKey: ['documents', 'detail', item.id],
    initialData: item,
    queryFn: async ({ signal }) => {
      try {
        return (await api.detail(item.id, signal)).data;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404)
          void client.invalidateQueries({ queryKey: ['documents', 'list'] });
        throw error;
      }
    },
    enabled: active && visible,
    gcTime: 0,
    refetchIntervalInBackground: false,
    refetchInterval: (query) =>
      pollingInterval(
        query.state.data,
        query.state.error ? query.state.errorUpdateCount : 0,
        active && visible,
        query.state.error instanceof ApiError
          ? (query.state.error.retryAfter ?? 0)
          : 0,
      ),
  });
  const doc = detail.data;
  const operation = useMutation({
    mutationFn: async (kind: 'delete' | 'reprocess') => {
      if (kind === 'delete') {
        await api.remove(doc.id);
        return;
      }
      return api.reprocess(doc.id);
    },
    onSuccess: async (result, kind) => {
      if (result)
        client.setQueryData(['documents', 'detail', doc.id], result.data);
      setAction(null);
      onNotice(
        kind === 'delete'
          ? 'Document deleted.'
          : 'Reprocessing queued. This document is unavailable for answers until ready.',
      );
      await client.invalidateQueries({ queryKey: ['documents'] });
      if (kind === 'delete')
        document.getElementById('collection-title')?.focus();
    },
    onError: async () => {
      setAction(null);
      await client.invalidateQueries({ queryKey: ['documents'] });
    },
  });
  return (
    <li ref={row} className="document-row" aria-label={doc.filename}>
      <div className="document-main">
        <div className="document-identity">
          <h3 className="filename">{doc.filename}</h3>
          <Badge
            variant={
              doc.status === 'failed'
                ? 'destructive'
                : doc.status === 'ready'
                  ? 'success'
                  : 'secondary'
            }
          >
            {doc.status}
          </Badge>
        </div>
        <p className="metadata">
          {doc.mimeType === 'application/pdf'
            ? 'PDF'
            : doc.mimeType === 'text/plain'
              ? 'TXT'
              : 'Markdown'}{' '}
          · {fileSize(doc.size)}
          {doc.status === 'ready'
            ? ` · ${doc.chunkCount} ${doc.chunkCount === 1 ? 'chunk' : 'chunks'}`
            : ''}
        </p>
        <p role="status" className="muted">
          {doc.status === 'pending'
            ? 'Waiting for processing. If this persists, check AI configuration on the API.'
            : doc.status === 'processing'
              ? 'Processing text and embeddings…'
              : doc.status === 'ready'
                ? 'Ready to use in answers.'
                : doc.status === 'deleting'
                  ? 'Deleting… Retry deletion if cleanup failed.'
                  : 'Processing failed. Review the error below.'}
        </p>
        {doc.processingError ? (
          <p className="processing-error">
            {doc.processingError.code}: {doc.processingError.message}
            {doc.processingError.retryable
              ? ' Manual retry may help.'
              : ' Review the original file before reprocessing.'}
          </p>
        ) : null}
        {detail.error ? <OperationError error={detail.error} /> : null}
        {operation.error ? <OperationError error={operation.error} /> : null}
      </div>
      <div className="row-actions">
        <Button
          variant="outline"
          size="sm"
          disabled={
            !['ready', 'failed'].includes(doc.status) || operation.isPending
          }
          onClick={(event) => {
            actionTrigger.current = event.currentTarget;
            operation.reset();
            setAction('reprocess');
          }}
        >
          Reprocess
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={operation.isPending}
          onClick={(event) => {
            actionTrigger.current = event.currentTarget;
            operation.reset();
            setAction('delete');
          }}
        >
          {doc.status === 'deleting' ? 'Retry deletion' : 'Delete'}
        </Button>
      </div>
      <AlertDialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open && !operation.isPending) setAction(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            actionTrigger.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {action === 'delete'
                ? 'Delete this document?'
                : 'Reprocess this document?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {action === 'delete'
                ? `${doc.filename} will be removed from local storage and future answers. Already displayed excerpts may remain in browser memory.`
                : `${doc.filename} will be unavailable for answers until processing finishes. Its text will be sent to OpenAI again and new embeddings may incur costs.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={operation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={operation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (action) operation.mutate(action);
              }}
            >
              {operation.isPending
                ? 'Working…'
                : action === 'delete'
                  ? 'Delete document'
                  : 'Reprocess document'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
