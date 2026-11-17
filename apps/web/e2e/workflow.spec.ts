import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { formatAnswer } from '@aka/shared';

const requestId = '11111111-1111-4111-8111-111111111111';
const docId = '22222222-2222-4222-8222-222222222222';
const span = { unitIndex: 0, charStart: 0, charEnd: 30 };
const makeDocument = (status = 'ready', id = docId) => ({
  id,
  filename: 'policy.md',
  mimeType: 'text/markdown',
  size: 80,
  status,
  chunkCount: status === 'ready' ? 1 : 0,
  processingError: null,
  createdAt: '2026-11-17T12:00:00.000Z',
  updatedAt: '2026-11-17T12:00:00.000Z',
  processedAt: status === 'ready' ? '2026-11-17T12:00:00.000Z' : null,
});
const envelope = (data: unknown) => ({ data, requestId });
async function mockList(page: Page, status = 'ready') {
  await page.route('**/api/documents?*', (route) =>
    route.fulfill({
      json: envelope({
        items: [makeDocument(status)],
        pagination: { limit: 20, nextCursor: null },
      }),
    }),
  );
  await page.route(`**/api/documents/${docId}`, (route) =>
    route.fulfill({ json: envelope(makeDocument(status)) }),
  );
}
function answered() {
  const statements = [
    {
      text: 'Maintenance is Sunday at 02:00 UTC. <script>window.hostile=true</script>',
      sourceIds: ['S1', 'S2', 'S3'],
    },
  ];
  return {
    status: 'answered',
    answer: formatAnswer(statements, null),
    statements,
    reason: null,
    limitation: null,
    citations: [
      {
        sourceId: 'S1',
        chunkId: requestId,
        source: {
          documentId: docId,
          filename: 'handbook.pdf',
          excerpt: 'Maintenance is Sunday.',
          location: { kind: 'pdf', page: 2, ...span },
        },
      },
      {
        sourceId: 'S2',
        chunkId: docId,
        source: {
          documentId: docId,
          filename: 'policy.md',
          excerpt: '<img src=x onerror="window.hostile=true">',
          location: {
            kind: 'markdown',
            sectionOrdinal: 2,
            headingPath: ['Policy', 'Maintenance'],
            lineStart: 3,
            lineEnd: 5,
            ...span,
          },
        },
      },
      {
        sourceId: 'S3',
        chunkId: '33333333-3333-4333-8333-333333333333',
        source: {
          documentId: docId,
          filename: 'notes.txt',
          excerpt: 'Operations owns maintenance.',
          location: {
            kind: 'text',
            sectionOrdinal: 1,
            lineStart: 1,
            lineEnd: 2,
            ...span,
          },
        },
      },
    ],
    retrieval: { requestedTopK: 5, matchedChunks: 3, contextChunks: 3 },
    usage: {
      embeddingInputTokens: 10,
      generationInputTokens: 100,
      generationOutputTokens: 20,
    },
  };
}

test('real API: keyboard upload → ready → ask → inspect source → delete → empty evidence', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/documents');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to content' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByLabel('Choose a file').setInputFiles({
    name: `journey-${info.project.name}.md`,
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Maintenance\n\nMaintenance is Sunday at 02:00 UTC.'),
  });
  await page.getByRole('button', { name: 'Upload document' }).focus();
  await page.keyboard.press('Enter');
  const row = page.getByRole('listitem', {
    name: `journey-${info.project.name}.md`,
  });
  await row.scrollIntoViewIfNeeded();
  await expect(row.getByText('ready', { exact: true })).toBeVisible();
  await page.screenshot({
    path: `test-results/${info.project.name}-documents.png`,
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Ask AI', exact: true }).click();
  await page.getByLabel('Your question').fill('When is maintenance?');
  await page.getByRole('button', { name: 'Ask AI', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Answer', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Question result')).toBeFocused();
  await page.getByRole('link', { name: 'Inspect source S1' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('article', { name: 'Source S1' })).toBeFocused();
  await expect(page.getByText('Maintenance · Lines 1–3')).toBeVisible();
  await expect(page.getByRole('blockquote')).toContainText(
    'Maintenance is Sunday',
  );
  await page.screenshot({
    path: `test-results/${info.project.name}-answer.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('link', { name: 'Manage documents' }).click();
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page
    .getByRole('button', { name: 'Delete document', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(row).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Your collection' }),
  ).toBeFocused();
  await page.getByRole('link', { name: 'Ask AI', exact: true }).click();
  await page.getByLabel('Your question').fill('When is maintenance?');
  await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
  await expect(
    page.getByText('No ready documents', { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test('real API: failed ingestion remains visible, paid reprocess recovers, delete confirms', async ({
  page,
}, info) => {
  await page.goto('/documents');
  // The fake embedding adapter fails once per harness; each project uploads a scanned PDF for a permanent failure as well.
  await page
    .getByLabel('Choose a file')
    .setInputFiles('../api/test/fixtures/scanned.pdf');
  await page.getByRole('button', { name: 'Upload document' }).click();
  const scanned = page.getByRole('listitem', { name: 'scanned.pdf' });
  await scanned.scrollIntoViewIfNeeded();
  await expect(scanned.getByText('failed', { exact: true })).toBeVisible();
  await expect(scanned).toContainText('NO_EXTRACTABLE_TEXT');
  await scanned.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('button', { name: 'Delete document', exact: true })
    .click();
  await expect(scanned).toHaveCount(0);
  if (info.project.name !== 'desktop') return;
  await page.getByLabel('Choose a file').setInputFiles({
    name: 'retry.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      'S06_TRANSIENT_ONCE Maintenance is Sunday at 02:00 UTC.',
    ),
  });
  await page.getByRole('button', { name: 'Upload document' }).click();
  const row = page.getByRole('listitem', { name: 'retry.txt' });
  await expect(row.getByText('failed', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Reprocess', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('may incur costs');
  await page
    .getByRole('button', { name: 'Reprocess document', exact: true })
    .click();
  await expect(row.getByText('ready', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('button', { name: 'Delete document', exact: true })
    .click();
  await expect(row).toHaveCount(0);
});

test('isolated rendering: empty/validation, all source kinds, hostile text, single paid submission and explicit retries', async ({
  page,
}) => {
  let posts = 0;
  await page.route('**/api/chat/ask', async (route) => {
    posts++;
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fulfill({ json: envelope(answered()) });
  });
  await page.goto('/ask');
  await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
  await expect(page.getByLabel('Your question')).toBeFocused();
  expect(posts).toBe(0);
  await page.getByLabel('Your question').fill('Maintenance?');
  await page.getByRole('button', { name: 'Ask AI', exact: true }).dblclick();
  await expect(page.getByText('Physical page 2')).toBeVisible();
  await expect(
    page.getByText('Policy / Maintenance · Lines 3–5'),
  ).toBeVisible();
  await expect(page.getByText('Section 1 · Lines 1–2')).toBeVisible();
  expect(posts).toBe(1);
  expect(await page.locator('main script, main img').count()).toBe(0);
  await page.getByRole('link', { name: 'Inspect source S2' }).click();
  await expect(page.getByRole('article', { name: 'Source S2' })).toBeFocused();
  for (const [status, reason, title] of [
    ['insufficient_context', 'NO_RELEVANT_CONTEXT', 'No relevant passages'],
    [
      'insufficient_context',
      'EVIDENCE_INSUFFICIENT',
      'Evidence is insufficient',
    ],
    ['refused', 'PROVIDER_REFUSAL', 'The provider declined this question'],
  ]) {
    await page.route('**/api/chat/ask', (route) =>
      route.fulfill({
        json: envelope({
          ...answered(),
          status,
          reason,
          statements: [],
          citations: [],
          limitation: 'Not enough evidence for this request.',
          answer: 'Not enough evidence for this request.',
          retrieval: {
            requestedTopK: 5,
            matchedChunks: reason === 'NO_RELEVANT_CONTEXT' ? 0 : 1,
            contextChunks: reason === 'NO_RELEVANT_CONTEXT' ? 0 : 1,
          },
        }),
      }),
    );
    await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
    await expect(page.getByText(title!, { exact: true })).toBeVisible();
  }
  for (const [status, code] of [
    [409, 'EVIDENCE_CHANGED'],
    [429, 'AI_CAPACITY_EXCEEDED'],
    [502, 'AI_UPSTREAM_ERROR'],
    [503, 'AI_NOT_CONFIGURED'],
    [504, 'AI_TIMEOUT'],
  ] as const) {
    await page.route('**/api/chat/ask', (route) =>
      route.fulfill({
        status,
        headers: { 'Retry-After': '2' },
        json: {
          error: { code, message: 'Safe synthetic failure.' },
          requestId,
        },
      }),
    );
    await page
      .getByRole('button', { name: /Ask AI|Retry question/, exact: true })
      .click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      requestId,
    );
    await expect(
      page.getByRole('button', { name: 'Retry question' }),
    ).toBeEnabled();
  }
});

test('isolated rendering: cursor pages, active-only polling, offline/hidden/unmount pause and delete failure', async ({
  page,
}) => {
  await mockList(page, 'pending');
  let polls = 0;
  await page.route(`**/api/documents/${docId}`, (route) => {
    polls++;
    return route.fulfill({
      json: envelope(makeDocument(polls >= 3 ? 'ready' : 'pending')),
    });
  });
  await page.goto('/documents');
  await page.getByRole('listitem').scrollIntoViewIfNeeded();
  await expect.poll(() => polls).toBeGreaterThanOrEqual(1);
  await page.context().setOffline(true);
  const paused = polls;
  await page.waitForTimeout(2300);
  expect(polls).toBe(paused);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.context().setOffline(false);
  const hidden = polls;
  await page.waitForTimeout(2300);
  expect(polls).toBe(hidden);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByText('ready', { exact: true })).toBeVisible();
  const terminal = polls;
  await page.waitForTimeout(2400);
  expect(polls).toBe(terminal);
  await page.getByRole('link', { name: 'Ask AI', exact: true }).click();
  await page.waitForTimeout(2300);
  expect(polls).toBe(terminal);
  await page.route('**/api/documents?*', (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    return route.fulfill({
      json: envelope({
        items: cursor ? [] : [makeDocument()],
        pagination: { limit: 20, nextCursor: cursor ? null : 'opaque-next' },
      }),
    });
  });
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('No more documents')).toBeVisible();
  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await page.route(`**/api/documents/${docId}`, (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({
          status: 500,
          json: {
            error: {
              code: 'DELETE_FAILED',
              message: 'Cleanup failed. Retry deletion.',
            },
            requestId,
          },
        })
      : route.fulfill({
          json: envelope({
            ...makeDocument('deleting'),
            processingError: {
              code: 'DELETE_FAILED',
              message: 'Cleanup failed.',
              retryable: true,
            },
          }),
        }),
  );
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('button', { name: 'Delete document', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Retry deletion' }),
  ).toBeVisible();
  await expect(page.getByRole('listitem')).toContainText('DELETE_FAILED');
  await page.route(`**/api/documents/${docId}`, (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route('**/api/documents?*', (route) =>
    route.fulfill({
      json: envelope({
        items: [],
        pagination: { limit: 20, nextCursor: null },
      }),
    }),
  );
  await page.getByRole('button', { name: 'Retry deletion' }).click();
  await page
    .getByRole('button', { name: 'Delete document', exact: true })
    .click();
  await expect(page.getByRole('listitem')).toHaveCount(0);
});

test('real proxy: rejects unexpected Origin/Host, preserves multipart errors/IDs and response security headers', async ({
  request,
  baseURL,
}) => {
  const denied = await request.post('/api/chat/ask', {
    headers: { Origin: 'http://evil.test' },
    data: { question: 'test' },
  });
  expect(denied.status()).toBe(403);
  const host = await request.get('/api/documents', {
    headers: { Host: 'evil.test' },
  });
  expect(host.status()).toBe(403);
  const invalid = await request.post('/api/documents', {
    headers: { Origin: baseURL! },
    multipart: {
      file: {
        name: 'wrong.exe',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('no'),
      },
    },
  });
  expect(invalid.status()).toBe(415);
  expect((await invalid.json()).requestId).toBe(
    invalid.headers()['x-request-id'],
  );
  const response = await request.get('/ask');
  expect(response.headers()['content-security-policy']).toContain("'nonce-");
  expect(response.headers()['content-security-policy']).not.toContain(
    "'unsafe-eval'",
  );
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
});
