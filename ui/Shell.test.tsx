/**
 * The loaded layout.
 *
 * Three regions, mirroring GitHub's Files-changed tab. Two of them are empty
 * until later tasks fill them; these tests pin the frame so those tasks have
 * somewhere to land rather than a layout to invent.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Shell } from './Shell';
import { prPayload } from './prPayload.fixture';

describe('Shell', () => {
  it('renders the top bar, the left rail and the main column', () => {
    render(<Shell payload={prPayload()} />);

    expect(screen.getByRole('banner')).toBeDefined();
    expect(screen.getByRole('complementary')).toBeDefined();
    expect(screen.getByRole('main')).toBeDefined();
  });

  it('puts a collapsible Overview at the top of the rail', () => {
    render(<Shell payload={prPayload()} />);

    const rail = screen.getByRole('complementary');
    const overview = screen.getByText('Overview');

    expect(rail.contains(overview)).toBe(true);
    expect(overview.closest('details')).not.toBeNull();
  });

  it('says when a list was cut short, and offers the way out', () => {
    // The worst outcome is a reviewer who cannot tell "no more comments" from
    // "we dropped them", so a capped list is announced rather than absorbed.
    render(
      <Shell payload={prPayload({ truncated: { files: true, threads: true } })} />,
    );

    const notice = screen.getByRole('alert');
    expect(notice.textContent).toMatch(/files/i);
    expect(notice.textContent).toMatch(/comment|thread/i);
    expect(
      screen.getAllByRole('link', { name: /open in github/i }).length,
    ).toBeGreaterThan(0);
  });

  it('says nothing about truncation for an ordinary pull request', () => {
    render(<Shell payload={prPayload()} />);

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('gives the rail a resize handle the keyboard can reach', () => {
    render(<Shell payload={prPayload()} />);

    const separator = screen.getByRole('separator');
    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    expect(separator.getAttribute('tabindex')).toBe('0');
  });
});
