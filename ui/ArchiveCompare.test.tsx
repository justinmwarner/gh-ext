/**
 * What a reviewer is told about an archive.
 *
 * The card exists because GitHub says "Binary file changed" about a `.zip` and
 * stops there. So the claims worth pinning are the ones that would make this
 * card worse than that sentence rather than better: an entry it cannot compare
 * being drawn as unchanged, and a changed-only view that is empty for two
 * different reasons without saying which.
 */

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ArchiveEntry } from '@/lib/compare/archive';
import { compareArchives } from '@/lib/compare/archive';
import { ArchiveCompare } from './ArchiveCompare';

const entry = (path: string, over: Partial<ArchiveEntry> = {}): ArchiveEntry => ({
  path,
  directory: false,
  size: 100,
  compressedSize: 50,
  crc: 1,
  encrypted: false,
  ...over,
});

/** One of each status, so every test below has all four to choose from. */
const MIXED = compareArchives(
  [entry('kept.txt'), entry('edited.txt', { crc: 1 }), entry('gone.txt', { size: 40 })],
  [entry('kept.txt'), entry('edited.txt', { crc: 2 }), entry('new.txt', { size: 70 })],
);

const rowFor = (path: string): HTMLElement =>
  screen.getByRole('row', { name: new RegExp(path.replace('.', '\.')) });

describe('ArchiveCompare', () => {
  it('lists every file inside, which is more than GitHub says at all', () => {
    render(<ArchiveCompare comparison={MIXED} changedOnly={false} />);

    for (const path of ['kept.txt', 'edited.txt', 'gone.txt', 'new.txt']) {
      expect(rowFor(path)).toBeDefined();
    }
  });

  it('says what happened to each one in words, not only in colour', () => {
    render(<ArchiveCompare comparison={MIXED} changedOnly={false} />);

    expect(within(rowFor('edited.txt')).getByText(/changed/i)).toBeDefined();
    expect(within(rowFor('new.txt')).getByText(/added/i)).toBeDefined();
    expect(within(rowFor('gone.txt')).getByText(/removed/i)).toBeDefined();
    expect(within(rowFor('kept.txt')).getByText(/unchanged/i)).toBeDefined();
  });

  it('drops the files that held still when only the changes are wanted', () => {
    render(<ArchiveCompare comparison={MIXED} changedOnly />);

    expect(screen.queryByRole('row', { name: /kept\.txt/ })).toBeNull();
    expect(rowFor('edited.txt')).toBeDefined();
  });

  it('counts what changed rather than leaving it to be read off the rows', () => {
    render(<ArchiveCompare comparison={MIXED} changedOnly={false} />);

    // Three, not four: `gone.txt` is not inside the archive any more, and
    // counting it there would be the one number on the card that is false.
    expect(screen.getByText(/3 files inside/i).textContent).toMatch(
      /1 changed, 1 added, 1 removed/i,
    );
  });

  it('says an archive nothing changed inside is unchanged, rather than drawing nothing', () => {
    // The empty changed-only view has two causes — no changes, or an archive
    // that could not be read — and a blank card tells them apart for nobody.
    const same = compareArchives([entry('a.txt')], [entry('a.txt')]);

    render(<ArchiveCompare comparison={same} changedOnly />);

    expect(screen.getByRole('note').textContent).toMatch(/nothing inside .* changed/i);
  });

  it('refuses to call an entry it cannot read unchanged', () => {
    // An AES-encrypted member carries no usable checksum. Two of them at the
    // same size are two things this card cannot compare, and the one outcome
    // that must never happen is them being drawn as identical.
    const sealed = compareArchives(
      [entry('secret.txt', { crc: null, encrypted: true })],
      [entry('secret.txt', { crc: null, encrypted: true })],
    );

    render(<ArchiveCompare comparison={sealed} changedOnly={false} />);

    const row = rowFor('secret.txt');
    expect(within(row).queryByText(/unchanged/i)).toBeNull();
    expect(within(row).getByText(/could not be compared/i)).toBeDefined();
  });

  it('shows the size a file ended up, and the size a removed one was', () => {
    render(<ArchiveCompare comparison={MIXED} changedOnly={false} />);

    expect(within(rowFor('new.txt')).getByText('70 B')).toBeDefined();
    expect(within(rowFor('gone.txt')).getByText('40 B')).toBeDefined();
  });
});
