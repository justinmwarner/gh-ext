/**
 * The formatted half of the JSON comparison, in the reviewer's settings.
 *
 * `JsonKeyPaths` is a list of our own elements and is covered where the rest
 * of the comparison modes are. This file is about `JsonFormatted`, which is
 * the one other place on this page that mounts a `<diffs-container>` of its
 * own — and a container themes and lays itself out from the options it was
 * handed rather than from the page around it. It had the same fault
 * `NotebookCompare` had, in the same words: a module constant naming
 * `unified` and no theme, so a re-indented document was drawn in Pierre's
 * light pair inside a card the reviewer had turned dark.
 *
 * The theme is read off the options and the layout out of the shadow root, for
 * the reasons `ui/NotebookCompare.test.tsx` sets out at length: the hazard in
 * the theme is an absent key, which nothing rendered distinguishes from an
 * empty one, and the layout is a claim about a library and so is checked
 * against what the library drew.
 */

import { FileDiff, type FileDiffOptions } from '@pierre/diffs';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JsonFormatted } from './JsonCompare';

const BEFORE = JSON.stringify({ name: 'widgets', version: '1.0.0' });
const AFTER = JSON.stringify({ name: 'widgets', version: '1.1.0' });

describe('JsonFormatted, drawing a document in the reviewer’s settings', () => {
  const spyOnSetOptions = () => vi.spyOn(FileDiff.prototype, 'setOptions');
  let setOptions: ReturnType<typeof spyOnSetOptions>;

  beforeEach(() => {
    setOptions = spyOnSetOptions();
  });

  afterEach(() => {
    setOptions.mockRestore();
  });

  /** The options the embedded diff was actually handed. */
  const handed = (): FileDiffOptions<undefined, undefined>[] =>
    setOptions.mock.calls.flatMap(([options]) =>
      options == null ? [] : [options as FileDiffOptions<undefined, undefined>],
    );

  const mount = (props: { syntaxTheme: string; diffStyle: 'unified' | 'split' }) =>
    render(
      <JsonFormatted
        path="package.json"
        syntax="json"
        before={BEFORE}
        after={AFTER}
        {...props}
      />,
    );

  it('draws the document in the theme the reviewer chose', async () => {
    mount({ syntaxTheme: 'catppuccin-frappe', diffStyle: 'unified' });

    await waitFor(() => {
      expect(handed().length).toBeGreaterThan(0);
    });
    for (const options of handed()) {
      expect(options.theme).toBe('catppuccin-frappe');
    }
  });

  it('names no theme at all when the reviewer has not chosen one', async () => {
    // Absent rather than empty: `theme: ''` is a theme named '' and nothing
    // highlights at all, where a missing key is Pierre's own light/dark pair.
    mount({ syntaxTheme: '', diffStyle: 'unified' });

    await waitFor(() => {
      expect(handed().length).toBeGreaterThan(0);
    });
    for (const options of handed()) {
      expect('theme' in options).toBe(false);
    }
  });

  it('keeps the line numbers, which is how a comment is reachable elsewhere', async () => {
    // Not a preference, and the same absence `CODE_VIEW_SAFE_PROPS` pins for
    // the column: line selection is only reachable through the gutter. It
    // survived being moved into a memo, which is what this says.
    mount({ syntaxTheme: '', diffStyle: 'unified' });

    await waitFor(() => {
      expect(handed().length).toBeGreaterThan(0);
    });
    for (const options of handed()) {
      expect(options.disableLineNumbers).toBe(false);
      expect('preferredHighlighter' in options).toBe(false);
    }
  });

  it('lays the document out the way the column around it is laid out', async () => {
    const { container } = mount({ syntaxTheme: '', diffStyle: 'split' });

    await waitFor(() => {
      expect(layoutOf(container)).toBe('split');
    });
  });

  it('leaves it unified when that is what the reviewer is reading', async () => {
    const { container } = mount({ syntaxTheme: '', diffStyle: 'unified' });

    await waitFor(() => {
      expect(layoutOf(container)).toBe('single');
    });
  });
});

/** Which layout Pierre drew, from inside the document's own shadow root. */
function layoutOf(container: HTMLElement): string | null {
  const host = container.querySelector('diffs-container');
  const root = host instanceof HTMLElement ? host.shadowRoot : null;
  return root?.querySelector('[data-diff-type]')?.getAttribute('data-diff-type') ?? null;
}
