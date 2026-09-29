/**
 * Jumping to a file by name, under the file filters.
 *
 * The panel lists what the review is showing — `Shell` hands it the filtered
 * list — so the one thing it owes the reviewer here is to say that there is
 * more it is not looking at. A file jump that cannot find a file the reviewer
 * knows is in the pull request, with nothing on screen to say why, reads as a
 * broken search.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchPanel } from './SearchPanel';
import type { ReviewFile } from './reviewFiles';

const file = (path: string): ReviewFile => ({
  path,
  oldPath: path,
  isBinary: false,
  isRename: false,
  patchOmitted: false,
  patch: '',
  additions: 1,
  deletions: 1,
  changeType: 'MODIFIED',
  viewedState: 'UNVIEWED',
  noise: false,
});

describe('SearchPanel, under the file filters', () => {
  it('says how many files it is not searching while the filters hide some', () => {
    render(
      <SearchPanel files={[file('src/app.ts')]} unsearched={1} onChoose={vi.fn()} onClose={vi.fn()} />,
    );

    expect(screen.getByText('Not searching 1 file your filters hide')).toBeDefined();
  });

  it('says nothing of the kind while nothing is hidden', () => {
    render(<SearchPanel files={[file('src/app.ts')]} onChoose={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByText(/not searching/i)).toBeNull();
  });
});
