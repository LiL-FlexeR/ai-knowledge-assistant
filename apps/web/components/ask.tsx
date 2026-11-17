'use client';
import { useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { askRequestSchema } from '@aka/shared';
import type { AskRequest } from '@aka/shared';
import Link from 'next/link';
import { api } from '../lib/api';
import { Answer } from './answer';
import { OperationError } from './operation-error';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from './ui/field';
import { Skeleton } from './ui/skeleton';

export function Ask() {
  const form = useForm<AskRequest>({
    resolver: zodResolver(askRequestSchema),
    defaultValues: { question: '' },
  });
  const ask = useMutation({ mutationFn: api.ask });
  const result = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ask.isSuccess || ask.isError) result.current?.focus();
  }, [ask.isSuccess, ask.isError, ask.data, ask.error]);
  const send = form.handleSubmit(async (values) => {
    try {
      await ask.mutateAsync(values);
    } catch {
      /* rendered below */
    }
  });
  const busy = ask.isPending || form.formState.isSubmitting;
  return (
    <div className="page-stack ask-page">
      <div className="page-heading">
        <div>
          <h1>Ask AI</h1>
          <p className="muted">Ask your documents. Follow the evidence.</p>
        </div>
        <Link className="text-link" href="/documents">
          Manage documents
        </Link>
      </div>
      <form onSubmit={send} className="question-form">
        <FieldGroup>
          <Field data-invalid={!!form.formState.errors.question}>
            <FieldLabel htmlFor="question">Your question</FieldLabel>
            <Textarea
              id="question"
              {...form.register('question')}
              rows={4}
              maxLength={2000}
              autoComplete="off"
              placeholder="When is the maintenance window?…"
              aria-invalid={!!form.formState.errors.question}
              aria-describedby="question-help question-error"
              disabled={busy}
            />
            <FieldDescription id="question-help">
              Up to 2,000 characters. Uses all ready documents. Your question
              and selected text are sent to OpenAI; each submission may incur
              costs.
            </FieldDescription>
            <FieldError id="question-error">
              {form.formState.errors.question
                ? 'Enter a question between 1 and 2,000 characters.'
                : null}
            </FieldError>
          </Field>
        </FieldGroup>
        <div className="form-actions">
          <Button type="submit" disabled={busy}>
            {busy
              ? 'Preparing answer…'
              : ask.isError
                ? 'Retry question'
                : 'Ask AI'}
          </Button>
          <p role="status" className="muted">
            {busy
              ? 'Finding passages and preparing an answer. This can take about a minute.'
              : 'One answer at a time. Nothing is saved as chat history.'}
          </p>
        </div>
      </form>
      {ask.isPending ? (
        <div
          role="status"
          aria-label="Preparing answer"
          className="loading-list"
        >
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-1/2" />
        </div>
      ) : null}
      {ask.isSuccess || ask.isError ? (
        <div
          ref={result}
          tabIndex={-1}
          className="result-region"
          aria-label="Question result"
        >
          {ask.error ? <OperationError error={ask.error} /> : null}
          {ask.data ? <Answer result={ask.data.data} /> : null}
        </div>
      ) : null}
      {ask.isIdle ? (
        <div className="ask-guidance">
          <h2>Start with a question your files can answer</h2>
          <p className="muted">
            Name the topic and ask for a specific fact. Answers include
            reference links to excerpts, so you can inspect their support.
            Missing evidence and provider refusals are shown explicitly.
          </p>
        </div>
      ) : null}
    </div>
  );
}
