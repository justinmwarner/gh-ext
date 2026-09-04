/**
 * The tree row's context menu.
 *
 * The tick in the decoration is a glyph with a click handler — fast, but not
 * focusable, because a row is a `<button>` and nothing focusable may nest in
 * one. The context menu is the one per-row affordance `@pierre/trees` does
 * sanction, and it is real DOM: this is how the keyboard reaches the same
 * action the tick does.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FileViewedState } from '@/lib/github/types';
import { FileTreeMenu } from './FileTreeMenu';

function mount(
  options: {
    kind?: 'file' | 'directory';
    path?: string;
    viewed?: FileViewedState;
  } = {},
) {
  const onToggleViewed = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <FileTreeMenu
      item={{ kind: options.kind ?? 'file', path: options.path ?? 'src/app.ts' }}
      viewed={options.viewed ?? 'UNVIEWED'}
      onToggleViewed={onToggleViewed}
      onClose={onClose}
    />,
  );
  return { ...view, onToggleViewed, onClose };
}

describe('FileTreeMenu', () => {
  it('offers to mark an unviewed file viewed', () => {
    mount();

    expect(screen.getByRole('button', { name: 'Mark as viewed' })).toBeDefined();
  });

  it('offers to take the mark off again', () => {
    mount({ viewed: 'VIEWED' });

    expect(screen.getByRole('button', { name: 'Mark as not viewed' })).toBeDefined();
  });

  it('offers to mark a file that changed after it was viewed', () => {
    // DISMISSED is not viewed: the reviewer has not seen this version. The
    // action is to mark it, not to unmark it.
    mount({ viewed: 'DISMISSED' });

    expect(screen.getByRole('button', { name: 'Mark as viewed' })).toBeDefined();
  });

  it('toggles the file and closes itself', async () => {
    const { onToggleViewed, onClose } = mount();

    await userEvent.click(screen.getByRole('button', { name: 'Mark as viewed' }));

    expect(onToggleViewed).toHaveBeenCalledWith('src/app.ts');
    expect(onClose).toHaveBeenCalled();
  });

  it('says why a folder has nothing to offer, rather than opening empty', () => {
    // Viewed is a per-file state on GitHub. An empty menu reads as broken.
    mount({ kind: 'directory', path: 'src/' });

    const action = screen.getByRole('button', { name: /viewed/i });
    expect((action as HTMLButtonElement).disabled).toBe(true);
    expect(action.getAttribute('title')).toMatch(/file/i);
  });
});
