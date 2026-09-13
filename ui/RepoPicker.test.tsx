/**
 * The opt-in list.
 *
 * It decides what the dashboard fetches, so what it has to get right is not
 * cosmetic: a repository that is ticked and unreachable must say so rather
 * than quietly contributing nothing, and nothing may be ticked that the
 * reviewer did not tick.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DiscoveredRepo } from '@/lib/dashboard/repos';
import { RepoPicker } from './RepoPicker';

/** One box, typed, because the assertions are about `checked`. */
const box = (name: RegExp): HTMLInputElement =>
  screen.getByRole('checkbox', { name }) as HTMLInputElement;

const repo = (
  nameWithOwner: string,
  overrides: Partial<DiscoveredRepo> = {},
): DiscoveredRepo => ({ nameWithOwner, isPrivate: false, reachable: true, ...overrides });

function draw(options: {
  discovered?: DiscoveredRepo[];
  watched?: string[];
  discovering?: boolean;
  asked?: boolean;
  onToggle?: () => void;
  onDiscover?: () => void;
}) {
  return render(
    <RepoPicker
      discovered={options.discovered ?? []}
      watched={options.watched ?? []}
      discovering={options.discovering ?? false}
      asked={options.asked ?? true}
      onToggle={options.onToggle ?? vi.fn()}
      onDiscover={options.onDiscover ?? vi.fn()}
    />,
  );
}

describe('RepoPicker', () => {
  it('lists what was discovered', () => {
    draw({ discovered: [repo('acme/widgets'), repo('acme/gears')] });

    expect(screen.getByRole('checkbox', { name: /acme\/widgets/ })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /acme\/gears/ })).toBeTruthy();
  });

  it('ticks only what is being watched', () => {
    draw({
      discovered: [repo('acme/widgets'), repo('acme/gears')],
      watched: ['acme/widgets'],
    });

    expect(box(/acme\/widgets/).checked).toBe(true);
    expect(box(/acme\/gears/).checked).toBe(false);
  });

  it('reports a repository the reviewer ticked', async () => {
    const onToggle = vi.fn();
    draw({ discovered: [repo('acme/widgets')], onToggle });

    await userEvent.click(screen.getByRole('checkbox', { name: /acme\/widgets/ }));

    expect(onToggle).toHaveBeenCalledWith('acme/widgets');
  });

  it('marks a private repository as one', () => {
    draw({ discovered: [repo('acme/secrets', { isPrivate: true })] });

    expect(screen.getByText('Private')).toBeTruthy();
  });

  it('says when a watched repository is out of the token reach', () => {
    // Watched, discovered earlier, and now refused. Dropping it silently would
    // leave the reviewer with a list they believe is complete and is not.
    draw({
      discovered: [repo('acme/secrets', { reachable: false })],
      watched: ['acme/secrets'],
    });

    expect(screen.getByText(/cannot reach/i)).toBeTruthy();
  });

  it('says nothing about an unreachable repository nobody asked for', () => {
    draw({ discovered: [repo('acme/secrets', { reachable: false })], watched: [] });

    expect(screen.queryByText(/cannot reach/i)).toBeNull();
  });

  it('offers to look for repositories before it has been asked', async () => {
    const onDiscover = vi.fn();
    draw({ asked: false, onDiscover });

    await userEvent.click(screen.getByRole('button', { name: /find my repositories/i }));

    expect(onDiscover).toHaveBeenCalledOnce();
  });

  it('says it is looking while it looks', () => {
    draw({ discovering: true, asked: true });

    expect(screen.getByText(/looking/i)).toBeTruthy();
  });

  it('says plainly when the account has none', () => {
    draw({ discovered: [], asked: true, discovering: false });

    expect(screen.getByText(/no repositories/i)).toBeTruthy();
  });

  it('ticks nothing on its own', () => {
    // Discovery proposes; the reviewer disposes. Nineteen repositories of
    // scratch work is not a list anybody wants fetched uninvited.
    draw({ discovered: [repo('a/one'), repo('a/two'), repo('a/three')] });

    for (const entry of screen.getAllByRole('checkbox')) {
      expect((entry as HTMLInputElement).checked).toBe(false);
    }
  });

  it('sorts the watched ones to the top so the fetched set reads first', () => {
    draw({
      discovered: [repo('a/one'), repo('a/two'), repo('a/three')],
      watched: ['a/three'],
    });

    const names = screen.getAllByRole('checkbox').map((box) => box.getAttribute('value'));

    expect(names[0]).toBe('a/three');
  });
});
