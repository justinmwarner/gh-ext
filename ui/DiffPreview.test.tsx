/**
 * The live example on the options page.
 *
 * Two things are worth holding to, and they are not the ones a screenshot
 * would catch.
 *
 * The first is the sample itself. It is authored so that each of the four diff
 * settings visibly moves it, and every one of those four is a property of the
 * *text* — one line differing in indentation only, one identifier renamed mid
 * line, one ordinary addition and one ordinary removal. Edit the patch without
 * reading the comment above it and the preview goes on rendering perfectly
 * while quietly ceasing to demonstrate a setting, which is the failure this
 * file exists to make loud.
 *
 * The second is the options object. `theme` has to be *absent* rather than
 * empty when the reviewer is on the default, and the symptom of getting that
 * wrong is a diff with no syntax colours at all — an appearance that a test
 * reading the DOM would pass and a reviewer would file as a bug.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings';
import { withoutWhitespaceChanges } from '@/lib/review/whitespace';
import { DiffPreview, SAMPLE_PATCH, previewOptions, previewPatch } from './DiffPreview';

const settings = (patch: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  ...patch,
});

/** Count how many lines of the patch carry a marker. */
const marked = (patch: string, marker: '+' | '-'): string[] =>
  patch.split('\n').filter((line) => line.startsWith(marker) && !line.startsWith(`${marker}${marker}`));

describe('the sample patch', () => {
  it('carries a line that differs only in its indentation', () => {
    const removed = marked(SAMPLE_PATCH, '-').map((line) => line.slice(1));
    const added = marked(SAMPLE_PATCH, '+').map((line) => line.slice(1));

    const pairs = removed.flatMap((line) => {
      const twin = added.find((other) => other.trim() === line.trim());
      return twin === undefined ? [] : [[line, twin] as const];
    });

    expect(pairs).toHaveLength(1);

    // The same line indented differently, which is the only thing ignoring
    // whitespace is able to remove.
    const [was, now] = pairs[0] ?? ['', ''];
    expect(was).not.toBe(now);
    expect(was.trimStart()).toBe(now.trimStart());
  });

  it('carries an identifier renamed in the middle of a line', () => {
    // `used` became `spent`, which is what separates the four values of
    // "Highlight inside a changed line" from one another.
    expect(SAMPLE_PATCH).toContain('-  const used = ');
    expect(SAMPLE_PATCH).toContain('+  const spent = ');
    expect(SAMPLE_PATCH).toContain('-  return limit - used;');
    expect(SAMPLE_PATCH).toContain('+  return limit - spent;');
  });

  it('carries an ordinary addition and an ordinary removal', () => {
    expect(SAMPLE_PATCH).toContain('-  const stale = Date.now();');
    expect(SAMPLE_PATCH).toContain('+  if (Number.isNaN(limit)) return 0;');
  });

  it('stays a preview rather than a fixture', () => {
    expect(SAMPLE_PATCH.split('\n').length).toBeLessThan(20);
  });
});

describe('previewPatch', () => {
  it('hands over GitHub’s patch untouched while the setting is off', () => {
    expect(previewPatch(settings({ ignoreWhitespace: false }))).toBe(SAMPLE_PATCH);
  });

  it('loses the indentation-only line when whitespace is ignored', () => {
    const hidden = previewPatch(settings({ ignoreWhitespace: true }));

    // The real rewrite ran and took something out — which is the whole reason
    // this preview renders a patch rather than two file contents.
    expect(withoutWhitespaceChanges(SAMPLE_PATCH).changed).toBe(true);
    expect(hidden).not.toBe(SAMPLE_PATCH);
    expect(marked(hidden, '-')).toHaveLength(marked(SAMPLE_PATCH, '-').length - 1);
    expect(marked(hidden, '+')).toHaveLength(marked(SAMPLE_PATCH, '+').length - 1);
    // The reindented line is still in the file, now as context.
    expect(hidden).toContain('x-ratelimit-limit');
    expect(marked(hidden, '-').join('\n')).not.toContain('x-ratelimit-limit');
  });

  it('keeps the rename and the ordinary pair, which are not whitespace', () => {
    const hidden = previewPatch(settings({ ignoreWhitespace: true }));

    expect(hidden).toContain('+  const spent = ');
    expect(hidden).toContain('-  const stale = Date.now();');
    expect(hidden).toContain('+  if (Number.isNaN(limit)) return 0;');
  });
});

describe('previewOptions', () => {
  it('maps side by side onto the layout Pierre names', () => {
    expect(previewOptions(settings({ splitView: true })).diffStyle).toBe('split');
    expect(previewOptions(settings({ splitView: false })).diffStyle).toBe('unified');
  });

  it('passes the intra-line mode straight through', () => {
    expect(previewOptions(settings({ lineDiff: 'char' })).lineDiffType).toBe('char');
    expect(previewOptions(settings({ lineDiff: 'none' })).lineDiffType).toBe('none');
  });

  it('leaves the theme key out entirely on the default', () => {
    // Not `theme: ''`. Pierre falls back to its own light/dark pair only when
    // the key is absent; an empty string is a theme named '' and nothing
    // highlights — which looks like a broken preview rather than a default one.
    expect('theme' in previewOptions(settings({ diffTheme: '' }))).toBe(false);
  });

  it('names the theme once the reviewer has chosen one', () => {
    expect(previewOptions(settings({ diffTheme: 'nord' })).theme).toBe('nord');
  });
});

describe('DiffPreview', () => {
  it('says it is an example, and draws one', async () => {
    render(<DiffPreview settings={settings()} caption="An example." />);

    expect(screen.getByText('An example.')).toBeTruthy();
    await waitFor(() => {
      expect(document.querySelector('diffs-container')?.shadowRoot).toBeTruthy();
    });
  });

  it('hides the drawing from the reader and leaves it the caption', () => {
    render(<DiffPreview settings={settings()} caption="An example." />);

    // A picture of a setting rather than content: the controls above say what
    // they do in words, and nine lines of an invented file read aloud between a
    // checkbox and its result line say nothing about any of them.
    const host = document.querySelector('diffs-container');
    expect(host?.closest('[aria-hidden="true"]')).toBeTruthy();
    expect(screen.getByText('An example.').getAttribute('aria-hidden')).toBeNull();
  });

  it('draws it the way the reviewer reads diffs', async () => {
    const { rerender } = render(
      <DiffPreview settings={settings({ splitView: false })} caption="An example." />,
    );

    // `diffStyle` is something this component passes in, so the only honest
    // check that it took is what came out in the shadow root — and Pierre's
    // spelling out here is not the spelling of the option that asked for it.
    await waitFor(() => {
      expect(layout()).toBe('single');
    });

    rerender(<DiffPreview settings={settings({ splitView: true })} caption="An example." />);

    await waitFor(() => {
      expect(layout()).toBe('split');
    });
  });
});

/** Which of the two layouts Pierre actually drew, read out of the shadow root. */
function layout(): string | null {
  const root = document.querySelector('diffs-container')?.shadowRoot;
  return root?.querySelector('[data-diff-type]')?.getAttribute('data-diff-type') ?? null;
}
