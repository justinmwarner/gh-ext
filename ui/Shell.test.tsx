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

  it('gives the rail a resize handle the keyboard can reach', () => {
    render(<Shell payload={prPayload()} />);

    const separator = screen.getByRole('separator');
    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    expect(separator.getAttribute('tabindex')).toBe('0');
  });
});
