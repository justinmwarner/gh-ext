/**
 * The error states.
 *
 * Three failures the reviewer can act on differently — wait, ask for access, or
 * retry — so they must not collapse into one apology. Each one keeps the "Open
 * in GitHub" escape hatch, because a reviewer stuck here still has a review to
 * finish.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PrRef } from '@/lib/messages';
import { ErrorState } from './ErrorState';

const pr: PrRef = { owner: 'acme', repo: 'widgets', number: 42 };

describe('ErrorState', () => {
  it('shows when the quota refills if GitHub said so', () => {
    const resetAt = Date.UTC(2026, 8, 1, 17, 30);

    const { container } = render(
      <ErrorState
        pr={pr}
        error={{ kind: 'rate-limit', message: 'API rate limit exceeded', resetAt }}
      />,
    );

    expect(container.textContent).toMatch(/rate limit/i);
    expect(container.textContent).toContain(new Date(resetAt).toLocaleString());
  });

  it('says the reset time is unknown rather than inventing one', () => {
    const { container } = render(
      <ErrorState
        pr={pr}
        error={{ kind: 'rate-limit', message: 'API rate limit exceeded', resetAt: null }}
      />,
    );

    const text = container.textContent ?? '';
    expect(text).toMatch(/rate limit/i);
    // `new Date(null)` is the epoch and `new Date(undefined)` is Invalid Date.
    // Both are worse than admitting GitHub sent no reset header.
    expect(text).not.toMatch(/undefined|NaN|Invalid Date|1970/);
    expect(text).toMatch(/did not say|unknown/i);
  });

  it('explains an inaccessible repository in terms of token access', () => {
    const { container } = render(
      <ErrorState
        pr={pr}
        error={{ kind: 'not-found', message: 'No pull request', resetAt: null }}
      />,
    );

    expect(container.textContent).toMatch(/acme\/widgets/);
    expect(container.textContent).toMatch(/access/i);
    expect(container.textContent).not.toMatch(/rate limit/i);
  });

  it('falls back to the worker’s own message for an unexpected failure', () => {
    render(
      <ErrorState
        pr={pr}
        error={{ kind: 'unknown', message: 'Unexpected token < in JSON', resetAt: null }}
      />,
    );

    expect(screen.getByText(/Unexpected token < in JSON/)).toBeDefined();
  });

  it.each(['rate-limit', 'not-found', 'unknown'] as const)(
    'offers an escape hatch to github.com for a %s failure',
    (kind) => {
      render(<ErrorState pr={pr} error={{ kind, message: 'nope', resetAt: null }} />);

      const link = screen.getByRole('link', { name: /open in github/i });
      expect(link.getAttribute('href')).toBe('https://github.com/acme/widgets/pull/42');
    },
  );
});
