/**
 * The one control that stands for what used to be a stack of banners.
 *
 * What is worth pinning here is everything that used to be free. A banner is
 * seen whether or not anybody wants it; a panel is not, so the button in the
 * bar has to carry the whole of what a reviewer learns without clicking — which
 * notice is the worst one, and how many others are behind it. Get that wrong
 * and the page has quietly stopped saying that its own file list is short.
 *
 * The rest is the cost of having built a popover: it has to be leaveable by
 * keyboard, it must not survive the last notice inside it, and a screen reader
 * has to be told something is there while it is shut.
 */

import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DeniedField } from '@/lib/github/graphql-errors';
import type { PrPayload } from '@/lib/messages';
import { NoticeCenter, announce, pageNotices } from './NoticeCenter';
import { prPayload, pullRequestNode } from './prPayload.fixture';

const MOVED = 'b'.repeat(40);

const denial = (path: string): DeniedField => ({
  message: 'Resource not accessible by personal access token',
  path,
  count: 1,
  type: 'FORBIDDEN',
});

const withDenial = (): PrPayload =>
  prPayload({ denied: [denial('repository.pullRequest.statusCheckRollup')] });

const withTruncation = (): PrPayload =>
  prPayload({ truncated: { files: true, threads: false, commits: false } });

const readOnly = (): PrPayload =>
  prPayload({ pullRequest: pullRequestNode({ repository: { viewerPermission: 'READ' } }) });

interface Options {
  payload?: PrPayload;
  tokenRejected?: boolean;
  movedTo?: string | null;
  reviewPending?: boolean;
  onReload?: () => void;
  onDismissMoved?: () => void;
}

const mount = (options: Options = {}) =>
  render(
    <NoticeCenter
      payload={options.payload ?? prPayload()}
      tokenRejected={options.tokenRejected ?? false}
      movedTo={options.movedTo ?? null}
      reviewPending={options.reviewPending ?? false}
      onReload={options.onReload ?? (() => {})}
      onDismissMoved={options.onDismissMoved ?? (() => {})}
    />,
  );

const trigger = () => screen.getByRole('button', { expanded: false });

describe('what counts as a notice', () => {
  it('finds nothing wrong with an ordinary pull request', () => {
    expect(
      pageNotices({ payload: prPayload(), tokenRejected: false, movedTo: null }),
    ).toEqual([]);
  });

  it('ranks them worst first, and a moved head last', () => {
    // The order is a judgement, not an accident: only the token stops the
    // reviewer writing, the middle two mean the page is incomplete, and a new
    // commit is not a fault at all — the page is correct about a commit that
    // has been superseded.
    const notices = pageNotices({
      payload: prPayload({
        denied: [denial('repository.pullRequest.statusCheckRollup')],
        truncated: { files: true, threads: true, commits: false },
      }),
      tokenRejected: true,
      movedTo: MOVED,
    });

    expect(notices.map((notice) => notice.id)).toEqual([
      'token-rejected',
      'denied',
      'truncated',
      'head-moved',
    ]);
    expect(notices.map((notice) => notice.tone)).toEqual([
      'blocked',
      'incomplete',
      'incomplete',
      'moved',
    ]);
  });

  it('ignores a commit list that was cut short', () => {
    // Nothing on this page is drawn from it. The commit picker says so itself,
    // and a notice about a list nobody is reading is one more thing to dismiss.
    expect(
      pageNotices({
        payload: prPayload({ truncated: { files: false, threads: false, commits: true } }),
        tokenRejected: false,
        movedTo: null,
      }),
    ).toEqual([]);
  });

  it('raises read-only access, which the page otherwise only implies', () => {
    // The whole reason it is here. Without it a reviewer meets the refusal one
    // control at a time — a greyed-out Resolve, a Start a review that is not
    // there — and nothing on the page connects them or names the cause.
    const notices = pageNotices({
      payload: readOnly(),
      tokenRejected: false,
      movedTo: null,
    });

    expect(notices).toEqual([{ id: 'read-only', tone: 'blocked', title: 'Read-only' }]);
  });

  it('says nothing about read-only access when the token is rejected outright', () => {
    // Both stop the reviewer writing, and only one of them is worth acting on:
    // a rejected token stops them writing everywhere, and a second sentence
    // about this repository in particular is noise on top of it.
    const notices = pageNotices({
      payload: readOnly(),
      tokenRejected: true,
      movedTo: null,
    });

    expect(notices.map((notice) => notice.id)).toEqual(['token-rejected']);
  });

  it('puts read-only under a rejected token and above an incomplete page', () => {
    const notices = pageNotices({
      payload: prPayload({
        pullRequest: pullRequestNode({ repository: { viewerPermission: 'READ' } }),
        truncated: { files: true, threads: false, commits: false },
      }),
      tokenRejected: false,
      movedTo: MOVED,
    });

    expect(notices.map((notice) => notice.id)).toEqual([
      'read-only',
      'truncated',
      'head-moved',
    ]);
  });
});

describe('the control in the bar', () => {
  it('is absent when there is nothing to say', () => {
    mount();

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('names the worst one rather than counting them', () => {
    // A bell with a number on it says something is wrong and nothing about
    // what. The label is the only part of a notice anybody reads for free.
    mount({ payload: withDenial(), tokenRejected: true });

    expect(trigger().textContent).toMatch(/token rejected/i);
  });

  it('counts the ones behind it', () => {
    mount({ payload: withDenial(), tokenRejected: true, movedTo: MOVED });

    expect(trigger().textContent).toMatch(/3/);
  });

  it('shows no count when it is the only one', () => {
    mount({ payload: withTruncation() });

    expect(trigger().textContent).not.toMatch(/\d/);
  });

  it('carries the worst tone, not the first one found', () => {
    mount({ payload: withDenial(), tokenRejected: true, movedTo: MOVED });

    expect(trigger().getAttribute('data-tone')).toBe('blocked');
  });
});

describe('the panel', () => {
  it('stays shut until it is asked for', () => {
    mount({ payload: withTruncation() });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens onto every notice at once', async () => {
    mount({ payload: withDenial(), tokenRejected: true, movedTo: MOVED });

    await userEvent.click(trigger());

    const panel = screen.getByRole('dialog');
    expect(panel.textContent).toMatch(/rejected your token/i);
    expect(panel.textContent).toMatch(/would not show this token/i);
    expect(panel.textContent).toMatch(/new commits have been pushed/i);
  });

  it('names both remedies for read-only access', async () => {
    // The point of saying it here rather than on the greyed-out button: the
    // reviewer standing in front of this can usually resolve conversations on
    // GitHub perfectly well, and the difference is the token. That has to be
    // the first thing offered, and it has to be reachable.
    mount({ payload: readOnly() });

    await userEvent.click(trigger());

    const panel = screen.getByRole('dialog');
    expect(panel.textContent).toMatch(/read-only on this repository/i);
    expect(panel.textContent).toMatch(/pull requests: read and write/i);
    expect(within(panel).getByRole('button', { name: /check your token/i })).toBeDefined();
  });

  it('closes on Escape and hands the keyboard back', async () => {
    // A popover that can only be left with a pointer is a trap rather than a
    // panel, and focus dropped on the floor sends the next Tab to the top of
    // the document.
    mount({ payload: withTruncation() });
    const button = trigger();

    await userEvent.click(button);
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('closes when something else is pressed', async () => {
    mount({ payload: withTruncation() });

    await userEvent.click(trigger());
    await userEvent.click(document.body);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('goes away with the last notice in it', async () => {
    // "Keep reading" dismisses the only notice there was, which takes the
    // button with it — and a panel left hanging under a bar with nothing in it
    // to have opened it cannot be closed again.
    const Host = () => {
      const [moved, setMoved] = useState<string | null>(MOVED);
      return (
        <NoticeCenter
          payload={prPayload()}
          tokenRejected={false}
          movedTo={moved}
          reviewPending={false}
          onReload={() => {}}
          onDismissMoved={() => setMoved(null)}
        />
      );
    };
    render(<Host />);

    await userEvent.click(screen.getByRole('button', { name: /new commits/i }));
    await userEvent.click(screen.getByRole('button', { name: /^keep reading/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /new commits/i })).toBeNull();
  });

  it('passes the reload through', async () => {
    const onReload = vi.fn();
    mount({ payload: prPayload(), movedTo: MOVED, onReload });

    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('button', { name: /^reload at/i }));

    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe('what a screen reader is told', () => {
  it('says nothing when there is nothing wrong', () => {
    expect(announce([])).toBe('');
  });

  it('names every notice, and where to find them', () => {
    // The detail is inside a closed panel, where a live region announces
    // nothing at all. This sentence is the whole of what is heard until the
    // reviewer opens it.
    const text = announce(
      pageNotices({
        payload: withDenial(),
        tokenRejected: true,
        movedTo: null,
      }),
    );

    expect(text).toMatch(/2 notices/i);
    expect(text).toMatch(/token rejected/i);
    expect(text).toMatch(/partly hidden/i);
    expect(text).toMatch(/top bar/i);
  });

  it('is a live region that was already there', () => {
    // Mounted empty rather than created with its text: a region that arrives at
    // the same instant as its content is one some readers never announce. And
    // deliberately not `role="status"`, which every other query for a status on
    // this page would then find twice.
    const { container } = mount();

    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.getAttribute('role')).toBeNull();
  });
});
