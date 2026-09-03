/**
 * The error states.
 *
 * Three failures the reviewer can act on differently — wait, ask for access, or
 * retry — so they must not collapse into one apology. Each one keeps the "Open
 * in GitHub" escape hatch, because a reviewer stuck here still has a review to
 * finish.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
        retry={() => {}}
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
        retry={() => {}}
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
        retry={() => {}}
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
        retry={() => {}}
      />,
    );

    expect(screen.getByText(/Unexpected token < in JSON/)).toBeDefined();
  });

  it.each(['rate-limit', 'not-found', 'unknown'] as const)(
    'offers an escape hatch to github.com for a %s failure',
    (kind) => {
      render(
        <ErrorState pr={pr} error={{ kind, message: 'nope', resetAt: null }} retry={() => {}} />,
      );

      const link = screen.getByRole('link', { name: /open in github/i });
      expect(link.getAttribute('href')).toBe('https://github.com/acme/widgets/pull/42');
    },
  );
});

describe('offering the token as the culprit', () => {
  const checkToken = () => screen.queryByRole('button', { name: /check your token/i });

  const show = (kind: 'rate-limit' | 'not-found' | 'unknown', message: string) =>
    render(<ErrorState pr={pr} error={{ kind, message, resetAt: null }} retry={() => {}} />);

  it('offers it for a pull request that is out of reach', () => {
    // A fine-grained token that simply does not grant the repository comes back
    // as a plain not-found, so this page is where that reviewer lands.
    show('not-found', 'No pull request acme/widgets#42');
    expect(checkToken()).not.toBeNull();
  });

  it('does not offer it when rate limited', () => {
    // A new token would not refill the quota. Waiting is the only remedy, and
    // a button here would send the reviewer somewhere useless.
    show('rate-limit', 'GitHub rate limit exceeded');
    expect(checkToken()).toBeNull();
  });

  it.each([
    'Resource not accessible by personal access token',
    'Your token has not been granted the required scopes',
    'You must grant SAML SSO authorization for this organization',
    'Forbidden',
  ])('offers it for a permission-shaped failure: %s', (message) => {
    show('unknown', message);
    expect(checkToken()).not.toBeNull();
  });

  it('does not offer it for a failure that has nothing to do with the token', () => {
    show('unknown', 'Unexpected end of JSON input');
    expect(checkToken()).toBeNull();
  });

  it('always offers the escape hatch, whatever the failure', () => {
    show('unknown', 'Unexpected end of JSON input');
    expect(screen.getByRole('link', { name: /github/i })).not.toBeNull();
  });
});

describe('trying again', () => {
  /**
   * Every failure this page shows is one the reviewer might have just fixed
   * elsewhere — a rate limit that has since reset, an owner who has approved
   * the token, a network that has come back. The copy said "wait and reload"
   * and offered no way to do either.
   */
  const rateLimit = { kind: 'rate-limit', message: 'API rate limit exceeded', resetAt: null } as const;

  it('offers a retry', () => {
    render(<ErrorState pr={pr} error={rateLimit} retry={() => {}} />);

    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('asks the worker again when pressed', async () => {
    const retry = vi.fn();
    render(<ErrorState pr={pr} error={rateLimit} retry={retry} />);

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
