/**
 * The frame every full-page state shares: a heading, an explanation, and the
 * ways out. Having one of these keeps the three states below it down to their
 * words, which is the only part that differs.
 */

import type { ReactNode } from 'react';

export function FullPage({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <main className="fullpage">
      <h1>{title}</h1>
      {children}
      {actions !== undefined && <div className="fullpage-actions">{actions}</div>}
    </main>
  );
}
