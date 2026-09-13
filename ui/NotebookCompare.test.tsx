/**
 * A notebook drawn cell by cell, in the colours the reviewer chose.
 *
 * The alignment itself is `lib/compare/notebook.ts` and is tested there. What
 * is asserted here is the thing that cannot be seen from either side alone:
 * every changed cell mounts a `<diffs-container>` of its own, and a container
 * themes itself from the options it is handed rather than from the page it is
 * standing in. For a long time it was handed a module constant naming
 * `unified` and no theme at all, so a notebook under a dark theme came out as
 * Pierre's light pair — black source on a dark cell, which is what somebody
 * reported — and came out unified beside a column the reviewer had put in
 * split.
 *
 * **The theme is asserted on the options rather than on the DOM, and that is
 * deliberate.** The hazard being guarded is an *absence*: Pierre falls back to
 * its own light/dark pair only when the `theme` key is missing, so passing an
 * empty string is a theme named `''` and nothing highlights at all. No
 * rendering tells those two apart in jsdom — an unloaded theme resolves
 * asynchronously and never arrives here — so the honest place to look is what
 * the component handed the instance. `diffStyle` needs no such excuse: it
 * comes out in the shadow root, so it is read from there.
 */

import { FileDiff, type FileDiffOptions } from '@pierre/diffs';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compareNotebooks, parseNotebook } from '@/lib/compare/notebook';
import { NotebookCompare } from './NotebookCompare';

/** A notebook of code cells, which is the only part of the format this needs. */
const notebook = (...sources: readonly string[]): string =>
  JSON.stringify({
    cells: sources.map((source) => ({
      cell_type: 'code',
      source,
      outputs: [],
    })),
    metadata: { language_info: { file_extension: '.py' } },
  });

const comparisonOf = (before: string, after: string) =>
  compareNotebooks(parseNotebook(before), parseNotebook(after));

/** One cell whose source moved, so exactly one cell gets a rendered diff. */
const CHANGED = comparisonOf(
  notebook('value = 1\n', 'print(value)\n'),
  notebook('value = 2\n', 'print(value)\n'),
);

describe('NotebookCompare, drawing a cell in the reviewer’s settings', () => {
  const spyOnSetOptions = () => vi.spyOn(FileDiff.prototype, 'setOptions');
  let setOptions: ReturnType<typeof spyOnSetOptions>;

  beforeEach(() => {
    // Called through: `FileDiff` is what the React component drives, and a
    // stub would leave the container half-built and the DOM assertion below
    // with nothing to read.
    setOptions = spyOnSetOptions();
  });

  afterEach(() => {
    setOptions.mockRestore();
  });

  /** The options every embedded cell diff was actually handed. */
  const handed = (): FileDiffOptions<undefined, undefined>[] =>
    setOptions.mock.calls.flatMap(([options]) =>
      options == null ? [] : [options as FileDiffOptions<undefined, undefined>],
    );

  const mount = (props: { syntaxTheme: string; diffStyle: 'unified' | 'split' }) =>
    render(
      <NotebookCompare
        comparison={CHANGED}
        languageExtension="py"
        showOutputs={false}
        {...props}
      />,
    );

  it('draws a changed cell in the theme the reviewer chose', async () => {
    // The reported bug, in one assertion: without this the cell is drawn in
    // Pierre's own light pair inside a card that is not light.
    mount({ syntaxTheme: 'catppuccin-frappe', diffStyle: 'unified' });

    await waitFor(() => {
      expect(handed().length).toBeGreaterThan(0);
    });
    for (const options of handed()) {
      expect(options.theme).toBe('catppuccin-frappe');
    }
  });

  it('names no theme at all when the reviewer has not chosen one', async () => {
    // Absent, not empty. `theme: ''` is a theme named '' and nothing
    // highlights; the missing key is what hands Pierre back its own default
    // pair, which is what an install that never opened the options page gets.
    mount({ syntaxTheme: '', diffStyle: 'unified' });

    await waitFor(() => {
      expect(handed().length).toBeGreaterThan(0);
    });
    for (const options of handed()) {
      expect('theme' in options).toBe(false);
    }
  });

  it('lays a cell out the way the column around it is laid out', async () => {
    // Read out of the shadow root rather than off the options, for the reason
    // `ui/DiffColumn.test.tsx` gives about `diffStyle`: it is something we pass
    // in, so the only honest evidence that it took is what came out. Pierre's
    // spelling of the two is `single` and `split`.
    const { container } = mount({ syntaxTheme: '', diffStyle: 'split' });

    await waitFor(() => {
      expect(layoutOf(container)).toBe('split');
    });
  });

  it('leaves the cell unified when that is what the reviewer is reading', async () => {
    const { container } = mount({ syntaxTheme: '', diffStyle: 'unified' });

    await waitFor(() => {
      expect(layoutOf(container)).toBe('single');
    });
  });
});

/** Which layout Pierre drew, from inside the cell's own shadow root. */
function layoutOf(container: HTMLElement): string | null {
  const host = container.querySelector('diffs-container');
  const root = host instanceof HTMLElement ? host.shadowRoot : null;
  return root?.querySelector('[data-diff-type]')?.getAttribute('data-diff-type') ?? null;
}
