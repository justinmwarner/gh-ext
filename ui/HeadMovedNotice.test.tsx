/**
 * Telling the reviewer the pull request moved.
 *
 * The whole value of this banner is in what it is honest about. It has to name
 * both commits, because "reload" is a request to throw away the reviewer's
 * place and they are entitled to know what they would be trading it for; and it
 * has to say what reloading costs, because the one thing worse than reviewing a
 * stale head is being talked into losing work to stop doing so.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HeadMovedNotice } from './HeadMovedNotice';

const LOADED = 'f1e2d3c4b5a69788796a5b4c3d2e1f0011223344';
const MOVED = 'a9b8c7d6e5f40312236475869708a1b2c3d4e5f6';

const renderNotice = (props: Partial<Parameters<typeof HeadMovedNotice>[0]> = {}) =>
  render(
    <HeadMovedNotice
      loaded={LOADED}
      movedTo={MOVED}
      reviewPending={false}
      onReload={() => {}}
      onDismiss={() => {}}
      {...props}
    />,
  );

describe('HeadMovedNotice', () => {
  it('names both commits, so the reviewer can tell which one they are reading', () => {
    renderNotice();

    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain(MOVED.slice(0, 7));
    expect(notice.textContent).toContain(LOADED.slice(0, 7));
  });

  it('announces politely rather than interrupting', () => {
    // `status`, not `alert`. An assertive region cuts across whatever a screen
    // reader is in the middle of — which, on this page, is quite likely the
    // comment whose line numbers this banner is about. Being told that your
    // comment may land in the wrong place is not worth being told over the top
    // of writing it.
    renderNotice();

    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers the reload rather than performing it', async () => {
    const onReload = vi.fn();
    renderNotice({ onReload });

    await userEvent.click(screen.getByRole('button', { name: /reload/i }));

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('lets the reviewer carry on reading the commit they were reading', async () => {
    const onDismiss = vi.fn();
    renderNotice({ onDismiss });

    await userEvent.click(screen.getByRole('button', { name: /keep reading/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('says what reloading costs when a review is queued', () => {
    // The comments themselves are on GitHub, inside a PENDING review that
    // `initialPendingReview` will resume — so they survive. The summary typed
    // into the footer is component state and does not, and a reviewer who
    // reloads on our suggestion and loses a paragraph was misled by us.
    renderNotice({ reviewPending: true });

    const text = screen.getByRole('status').textContent ?? '';
    expect(text).toMatch(/summary/i);
    expect(text).toMatch(/lose|lost/i);
  });

  it('does not warn about losing work when nothing is queued', () => {
    // Drafts are written to extension storage and come back on their own, so
    // there is nothing to lose but a scroll position. Saying otherwise would
    // teach the reviewer to ignore the sentence on the day it is true.
    renderNotice({ reviewPending: false });

    expect(screen.getByRole('status').textContent ?? '').not.toMatch(/summary/i);
  });
});
