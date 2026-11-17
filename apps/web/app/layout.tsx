import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { connection } from 'next/server';
import { Providers } from '../components/providers';
import { Navigation } from '../components/navigation';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Knowledge Assistant',
  description: 'Ask questions about your documents and inspect the sources.',
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  await connection();
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div className="app-shell">
          <header className="app-header">
            <div className="brand">
              AI Knowledge Assistant
              <span className="local-label">Local workspace</span>
            </div>
            <Navigation />
          </header>
          <aside className="disclosure" aria-label="Privacy and processing">
            <strong>Local, single-user app.</strong> Use only on this computer.
            Document text and questions are sent to OpenAI for processing, which
            may incur costs. Provider retention policies apply. Answers can be
            wrong; inspect the excerpts.
          </aside>
          <Providers>
            <main id="main" tabIndex={-1}>
              {children}
            </main>
          </Providers>
          <footer>
            Private originals stay in the local API. No saved chat history.
          </footer>
        </div>
      </body>
    </html>
  );
}
