/**
 * The sticky top bar.
 *
 * Everything it shows is already in the payload, so none of it is a placeholder
 * — if the bar renders "#undefined" or an empty branch pair against a realistic
 * node, these tests say so before a real pull request does.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TopBar } from './TopBar';
import { prPayload, pullRequestNode } from './prPayload.fixture';

describe('TopBar', () => {
  it('renders the title and number from the payload', () => {
    render(<TopBar payload={prPayload()} />);

    expect(screen.getByText('Cache the diff on head SHA')).toBeDefined();
    expect(screen.getByText('#42')).toBeDefined();
  });

  it('renders the state badge and the branch pair', () => {
    const { container } = render(<TopBar payload={prPayload()} />);

    expect(screen.getByText('Open')).toBeDefined();
    expect(container.textContent).toContain('main');
    expect(container.textContent).toContain('cache-the-diff');
  });

  it('prefers Draft and Merged over the raw state', () => {
    const { rerender } = render(
      <TopBar
        payload={prPayload({ pullRequest: pullRequestNode({ isDraft: true }) })}
      />,
    );
    expect(screen.getByText('Draft')).toBeDefined();

    rerender(
      <TopBar
        payload={prPayload({
          pullRequest: pullRequestNode({ state: 'MERGED', merged: true }),
        })}
      />,
    );
    expect(screen.getByText('Merged')).toBeDefined();
  });

  it('summarizes the check rollup, including the absence of one', () => {
    const { rerender, container } = render(<TopBar payload={prPayload()} />);
    expect(container.textContent).toMatch(/checks passed/i);

    rerender(<TopBar payload={prPayload({ checks: { state: 'FAILURE' } })} />);
    expect(container.textContent).toMatch(/checks failed/i);

    // A head commit with no checks at all is not a pending check.
    rerender(<TopBar payload={prPayload({ checks: null })} />);
    expect(container.textContent).toMatch(/no checks/i);
  });

  it('names every reviewer, requested or already reviewed', () => {
    render(<TopBar payload={prPayload()} />);

    expect(screen.getByRole('img', { name: /dana/ })).toBeDefined();
    expect(screen.getByRole('img', { name: /kim/ })).toBeDefined();
  });

  it('names a team and a bot reviewer as such, not as usernames', () => {
    // A pull request whose only pending reviewer is a team used to render no
    // avatars at all, which reads as "nobody has been asked to review".
    render(
      <TopBar
        payload={prPayload({
          pullRequest: pullRequestNode({
            latestReviews: { nodes: [] },
            reviewRequests: {
              nodes: [
                {
                  requestedReviewer: {
                    __typename: 'Team',
                    name: 'Platform Infrastructure',
                    slug: 'platform-infra',
                  },
                },
                {
                  requestedReviewer: {
                    __typename: 'Bot',
                    login: 'copilot-pull-request-reviewer',
                    avatarUrl: 'https://avatars.example/copilot',
                  },
                },
              ],
            },
          }),
        })}
      />,
    );

    expect(screen.getByRole('img', { name: /platform-infra \(team\)/ })).toBeDefined();
    expect(
      screen.getByRole('img', { name: /copilot-pull-request-reviewer \(bot\)/ }),
    ).toBeDefined();
  });

  it('links to the pull request on github.com', () => {
    render(<TopBar payload={prPayload()} />);

    const link = screen.getByRole('link', { name: /open in github/i });
    expect(link.getAttribute('href')).toBe('https://github.com/acme/widgets/pull/42');
  });

  it('carries a Review changes control', () => {
    render(<TopBar payload={prPayload()} />);

    expect(screen.getByRole('button', { name: /review changes/i })).toBeDefined();
  });
});
