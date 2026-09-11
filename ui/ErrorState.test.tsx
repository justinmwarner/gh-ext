/**
 * The error page.
 *
 * The failure it was built to end: every cause that was not a rate limit
 * arriving as "Something went wrong. The background worker could not put this
 * pull request together." over the line `GitHub request failed: 404` — with
 * the button to fix the token hidden, because the regular expression that
 * decided whether to show it did not match that text.
 *
 * So these tests are mostly about the reviewer's next move. Each cause has a
 * different one, and the page has to make it obvious which: wait, reconnect a
 * network, authorise an organisation, add a permission, or check the number
 * they typed.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Cause, Diagnosis } from '@/lib/github/diagnosis';
import type { PrRef, ProtocolError } from '@/lib/messages';
import { ErrorState } from './ErrorState';

vi.mock('./openOptions', () => ({ openOptions: vi.fn() }));

const pr: PrRef = { owner: 'acme', repo: 'widgets', number: 42 };

const diagnosis = (cause: Cause, over: Partial<Diagnosis> = {}): Diagnosis => ({
  cause,
  confidence: 'confirmed',
  login: null,
  permission: null,
  section: null,
  fixUrl: null,
  observed: [],
  ...over,
});

const fail = (over: Partial<ProtocolError> = {}): ProtocolError => ({
  kind: 'unknown',
  message: 'GitHub request failed: 404',
  resetAt: null,
  ...over,
});

const show = (error: ProtocolError) =>
  render(<ErrorState pr={pr} error={error} retry={() => {}} />);

const text = () => screen.getByRole('main').textContent ?? '';

describe('naming the cause', () => {
  it('blames the network, not the token, when the request never left', () => {
    show(fail({ diagnosis: diagnosis('offline') }));

    expect(text()).toMatch(/reach GitHub/i);
    expect(text()).toMatch(/never left this machine/i);
    // The one thing it must not do is send someone to regenerate a token over
    // a problem that is their wifi.
    expect(text()).not.toMatch(/expired|revoked/i);
  });

  it('says GitHub is at fault for a 5xx, so nothing here gets changed', () => {
    show(fail({ diagnosis: diagnosis('github-down') }));

    expect(text()).toMatch(/GitHub is having trouble/i);
    expect(screen.getByRole('link', { name: /github status/i })).toBeTruthy();
  });

  it('says the token was rejected outright, and why that happens', () => {
    show(fail({ diagnosis: diagnosis('token-rejected') }));

    expect(text()).toMatch(/rejected your token/i);
    expect(text()).toMatch(/expired|revoked/i);
  });

  it('names the repository the token cannot see', () => {
    show(fail({ diagnosis: diagnosis('token-lacks-repo', { login: 'warne' }) }));

    expect(text()).toMatch(/can’t see acme\/widgets/i);
    // Proof it is not the token itself, which is the fact that stops someone
    // regenerating a perfectly good one.
    expect(text()).toMatch(/@warne/);
  });

  it('names pending owner approval as well as a missing grant', () => {
    // GitHub reports the two identically. A page naming only the first sends
    // half the people who land here to re-grant a repository already granted.
    show(fail({ diagnosis: diagnosis('token-lacks-repo') }));

    expect(text()).toMatch(/Pending owner approval/i);
  });

  it('names the missing permission and the list it is under', () => {
    show(
      fail({
        diagnosis: diagnosis('token-lacks-permission', {
          permission: 'Checks',
          section: 'Repository permissions',
        }),
      }),
    );

    expect(text()).toMatch(/missing the Checks permission/i);
    expect(text()).toMatch(/Repository permissions/);
    expect(text()).toMatch(/Read-only/);
  });

  it('does not claim a permission it could not name', () => {
    show(fail({ diagnosis: diagnosis('token-lacks-permission') }));

    expect(text()).toMatch(/missing a permission/i);
    expect(text()).not.toMatch(/missing the (null|undefined)/i);
  });

  it('clears the token when the repository was reachable and the number was not', () => {
    show(fail({ diagnosis: diagnosis('pr-not-found', { login: 'warne' }) }));

    expect(text()).toMatch(/No pull request #42 in acme\/widgets/i);
    expect(text()).toMatch(/not a permissions problem/i);
  });

  it('sends an SSO failure to the exact authorisation screen GitHub named', () => {
    const fixUrl = 'https://github.com/orgs/acme/sso?authorization_request=ABC';
    show(fail({ diagnosis: diagnosis('sso-required', { fixUrl }) }));

    expect(text()).toMatch(/SSO authorisation/i);
    // Not "the token is wrong" — the token is fine and needs authorising once.
    expect(text()).toMatch(/does not need replacing/i);
    expect(screen.getByRole('link', { name: /authorise this token/i }).getAttribute('href')).toBe(
      fixUrl,
    );
  });

  it('falls back to the token list when SSO is diagnosed with no URL', () => {
    show(fail({ diagnosis: diagnosis('sso-required', { fixUrl: null }) }));

    expect(
      screen.getByRole('link', { name: /your tokens on github/i }).getAttribute('href'),
    ).toBe('https://github.com/settings/personal-access-tokens');
  });
});

describe('hedging', () => {
  it('states a proved cause plainly', () => {
    show(fail({ diagnosis: diagnosis('token-lacks-repo', { confidence: 'confirmed' }) }));

    expect(text()).not.toMatch(/likeliest|most likely/i);
  });

  it('marks an inferred one as inferred', () => {
    // Dressing a guess as a fact is how someone ends up regenerating a
    // perfectly good token.
    show(fail({ diagnosis: diagnosis('token-lacks-repo', { confidence: 'likely' }) }));

    expect(text()).toMatch(/likeliest/i);
  });
});

describe('showing the evidence', () => {
  const observed = [
    'GitHub answered with HTTP 404.',
    'GitHub said: “Not Found”',
    'We asked GitHub who the token belongs to: @warne.',
    'acme/widgets did not resolve for this token.',
  ];

  it('lists what was actually seen, not only what was concluded', () => {
    show(fail({ diagnosis: diagnosis('token-lacks-repo', { observed }) }));

    expect(screen.getByText(/what we saw/i)).toBeTruthy();
    for (const line of observed) {
      expect(screen.getByText(line)).toBeTruthy();
    }
  });

  it('leaves the section out entirely when there is nothing to show', () => {
    // An empty "What we saw" reads as "we saw nothing", which is a claim.
    show(fail({ diagnosis: diagnosis('rate-limited', { observed: [] }) }));

    expect(screen.queryByText(/what we saw/i)).toBeNull();
  });
});

describe('the way out', () => {
  const updateToken = () => screen.queryByRole('button', { name: /update token/i });

  const CAUSES: Cause[] = [
    'offline',
    'github-down',
    'no-token',
    'token-rejected',
    'sso-required',
    'token-lacks-repo',
    'token-lacks-permission',
    'pr-not-found',
    'rate-limited',
    'unknown',
  ];

  it.each(CAUSES)('offers the options page for a %s failure', (cause) => {
    // It used to be gated on a regular expression over the error text, so the
    // screens most likely to be a token problem were the ones that hid it.
    show(fail({ diagnosis: diagnosis(cause) }));

    expect(updateToken()).not.toBeNull();
  });

  it('leads with the token where the token is the likely cause', () => {
    show(fail({ diagnosis: diagnosis('token-lacks-repo') }));

    expect(updateToken()?.className).toMatch(/primary/);
  });

  it('demotes it where the token is not, rather than hiding it', () => {
    // Being wrong about this should cost a reviewer one extra glance, not the
    // remedy.
    show(fail({ diagnosis: diagnosis('offline') }));

    expect(updateToken()?.className).not.toMatch(/primary/);
  });

  it('opens the options page when pressed', async () => {
    const { openOptions } = await import('./openOptions');
    show(fail({ diagnosis: diagnosis('token-rejected') }));

    await userEvent.click(screen.getByRole('button', { name: /update token/i }));

    expect(openOptions).toHaveBeenCalled();
  });

  it.each(CAUSES)('keeps the escape hatch to github.com for a %s failure', (cause) => {
    show(fail({ diagnosis: diagnosis(cause) }));

    expect(
      screen.getByRole('link', { name: /open in github/i }).getAttribute('href'),
    ).toBe('https://github.com/acme/widgets/pull/42');
  });
});

describe('the rate limit', () => {
  it('shows when the quota refills if GitHub said so', () => {
    const resetAt = Date.UTC(2026, 8, 1, 17, 30);
    show(fail({ kind: 'rate-limit', resetAt, diagnosis: diagnosis('rate-limited') }));

    expect(text()).toMatch(/rate limit/i);
    expect(text()).toContain(new Date(resetAt).toLocaleString());
  });

  it('says the reset time is unknown rather than inventing one', () => {
    show(fail({ kind: 'rate-limit', resetAt: null, diagnosis: diagnosis('rate-limited') }));

    // `new Date(null)` is the epoch and `new Date(undefined)` is Invalid Date.
    // Both are worse than admitting GitHub sent no reset header.
    expect(text()).not.toMatch(/undefined|NaN|Invalid Date|1970/);
    expect(text()).toMatch(/did not say|unknown/i);
  });
});

describe('trying again', () => {
  /**
   * Every failure this page shows is one the reviewer might have just fixed
   * elsewhere — a rate limit that has since reset, an owner who has approved
   * the token, a network that has come back.
   */
  it('offers a retry, and asks the worker again when pressed', async () => {
    const retry = vi.fn();
    render(
      <ErrorState
        pr={pr}
        error={fail({ diagnosis: diagnosis('offline') })}
        retry={retry}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('a failure that never reached the classifier', () => {
  /**
   * Only the failures raised before any request was attempted get here, so it
   * should be rare — but it must not regress to the page this replaced.
   */
  it('still explains a not-found in terms of access', () => {
    show(fail({ kind: 'not-found', message: 'No pull request' }));

    expect(text()).toMatch(/acme\/widgets/);
    expect(text()).toMatch(/access/i);
  });

  it('still offers the token and the escape hatch', () => {
    show(fail({ kind: 'unknown', message: 'Unexpected token < in JSON' }));

    expect(screen.getByRole('button', { name: /update token/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /open in github/i })).toBeTruthy();
  });

  it('keeps the worker’s own message, which is the only specific thing it has', () => {
    show(fail({ kind: 'unknown', message: 'Unexpected token < in JSON' }));

    expect(screen.getByText(/Unexpected token < in JSON/)).toBeTruthy();
  });
});

describe('the worker’s raw message', () => {
  it('is shown when there is no evidence block to carry GitHub’s words', () => {
    show(fail({ kind: 'unknown', message: 'Unexpected token < in JSON' }));

    expect(screen.getByText(/Unexpected token < in JSON/)).toBeTruthy();
  });

  it('is not repeated underneath an evidence block that already quotes GitHub', () => {
    // It was written before anything was established, so beside a confident
    // diagnosis it is the same sentence twice — in the reading where it does
    // not contradict it outright.
    const message = 'No pull request acme/widgets#42. GitHub said: Not Found';
    show(
      fail({
        message,
        diagnosis: diagnosis('token-lacks-repo', {
          observed: ['GitHub said: “Not Found”'],
        }),
      }),
    );

    expect(screen.queryByText(message)).toBeNull();
    expect(screen.getByText('GitHub said: “Not Found”')).toBeTruthy();
  });
});
