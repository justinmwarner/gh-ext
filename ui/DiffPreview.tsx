/**
 * A real diff on the options page, drawn with the settings beside it.
 *
 * Four of the preferences on that page are claims about what a diff will look
 * like, and until now the only way to check one was to save it, open a pull
 * request and look. "Highlight inside a changed line" offers four values whose
 * difference is a few pixels of background on a word, and the hint under the
 * control — "by character reads better for prose, and for a rename inside a
 * line" — is a sentence about a picture nobody was being shown. So here is the
 * picture, and it is the reviewer's own settings drawing it.
 *
 * **`PatchDiff`, not `MultiFileDiff`, and the reason is the whitespace mode.**
 * `MultiFileDiff` takes two file contents and derives the diff itself, which
 * would leave this component approximating what `ignoreWhitespace` does.
 * `PatchDiff` takes a raw unified patch, which is the same shape GitHub sends
 * and the same shape `lib/review/whitespace.ts` rewrites — so the preview runs
 * the real {@link withoutWhitespaceChanges} over the real patch and shows
 * exactly what the diff column will show, down to which line stops being drawn.
 *
 * **`disableWorkerPool` is not optional.** `ui/DiffColumn.tsx` keeps it in
 * `CODE_VIEW_SAFE_PROPS` with the failure mode written above it: the worker
 * pool reaches for WebAssembly, which dies silently under an extension's
 * content security policy, so a viewer that renders all through development
 * renders nothing at all in the shipped build. A preview that is blank in the
 * one place it matters is worse than no preview. `preferredHighlighter` is
 * absent for the same reason, which is the absence `ui/JsonCompare.tsx` notes
 * too — the default `shiki-js` path touches no WebAssembly.
 *
 * **The diff is hidden from the reader, and that is the honest answer rather
 * than the lazy one.** What is on screen is a picture of a setting, not
 * content: the sample is invented, nothing in it is anybody's code, and the
 * thing it demonstrates is a layout and a colour. Read aloud it is nine lines
 * of a file that does not exist, between a checkbox and its result line, saying
 * nothing about the setting it is under — the controls already say what they do
 * in words, and those words are what a reader should get. So the caption stays
 * and names it as an example; the drawing itself is `aria-hidden`. It carries
 * nothing interactive, so nothing focusable is being hidden: line selection and
 * the gutter "+" are `CodeView` options the review page turns on and this
 * does not.
 */

import { useMemo } from 'react';
import type { FileDiffOptions } from '@pierre/diffs';
import { PatchDiff } from '@pierre/diffs/react';
import { withoutWhitespaceChanges } from '@/lib/review/whitespace';
import type { Settings } from '@/lib/settings';

/**
 * The sample, written so that every setting it is under visibly moves it.
 *
 * Each line in it is doing a job, and losing one costs the preview a setting:
 *
 * - `const limit` changed in **indentation only**, four spaces to two. It is
 *   what "Hide changes where only the whitespace moved" removes, and it is the
 *   only line in the patch that disappears when that box is ticked.
 * - `used` became `spent`, in the middle of two lines that are otherwise
 *   identical. That is what makes "Highlight inside a changed line" legible as
 *   a choice: by word marks the identifier, by character marks the four letters
 *   that differ inside it, and whole line marks neither.
 * - `const stale` went and the `Number.isNaN` guard arrived. An ordinary
 *   removal and an ordinary addition, so the sample is not entirely made of
 *   special cases and split view has two columns worth reading.
 *
 * TypeScript because the highlighting has to be obvious at nine lines — `export`,
 * `function`, `const`, `return`, a string and a number all carry a colour — and
 * because it is what this repository is written in.
 *
 * **No trailing newline.** `withoutWhitespaceChanges` counts the lines it emits
 * against the `@@` header and declines any hunk where the two disagree, and a
 * trailing newline splits into a tenth line that the header does not count. The
 * rewrite would be refused, the patch would come back unchanged, and the
 * whitespace setting would appear to do nothing — silently, which is the worst
 * way for a preview to be wrong.
 */
export const SAMPLE_PATCH = `diff --git a/src/rateLimit.ts b/src/rateLimit.ts
--- a/src/rateLimit.ts
+++ b/src/rateLimit.ts
@@ -1,6 +1,6 @@
 export function remaining(headers: Headers): number {
-    const limit = Number(headers.get('x-ratelimit-limit'));
-  const used = Number(headers.get('x-ratelimit-used'));
-  const stale = Date.now();
-  return limit - used;
+  const limit = Number(headers.get('x-ratelimit-limit'));
+  const spent = Number(headers.get('x-ratelimit-used'));
+  if (Number.isNaN(limit)) return 0;
+  return limit - spent;
 }`;

/**
 * The three settings that reach Pierre as options, in one function so a test
 * can hold them to it.
 *
 * Two of the three are decisions rather than pass-throughs, and neither is
 * visible in the rendered DOM afterwards — the second especially, whose wrong
 * form is a diff with no syntax colours in it at all.
 */
export function previewOptions(settings: Settings): FileDiffOptions<undefined, undefined> {
  return {
    // The same mapping `ui/Shell.tsx` makes, because a preview that answered
    // "side by side" differently from the column it is previewing would be
    // worse than no preview.
    diffStyle: settings.splitView ? 'split' : 'unified',
    lineDiffType: settings.lineDiff,
    // Omitted rather than passed empty, which is the idiom `ui/DiffColumn.tsx`
    // uses at its own options: Pierre falls back to its own light/dark pair
    // only when the key is absent, so an empty string here would be a theme
    // named '' and nothing would highlight.
    ...(settings.diffTheme === '' ? {} : { theme: settings.diffTheme }),
  };
}

/** The sample as the reviewer's whitespace setting leaves it. */
export function previewPatch(settings: Settings): string {
  return settings.ignoreWhitespace
    ? withoutWhitespaceChanges(SAMPLE_PATCH).patch
    : SAMPLE_PATCH;
}

export interface DiffPreviewProps {
  settings: Settings;
  /** What this copy of the preview is here to show, in the caption above it. */
  caption: string;
}

export function DiffPreview({ settings, caption }: DiffPreviewProps) {
  /**
   * Memoized because Pierre compares this object rather than its contents: a
   * fresh one on every render tears the shadow root down and builds it again,
   * which on a page where every keystroke in a textarea re-renders the settings
   * is a rebuilt syntax highlighter per character.
   */
  const options = useMemo(
    () => previewOptions(settings),
    [settings.splitView, settings.lineDiff, settings.diffTheme],
  );

  // Memoized for the same reason and one more: `PatchDiff` re-parses whenever
  // the string changes, and this one only has two values it can hold.
  const patch = useMemo(() => previewPatch(settings), [settings.ignoreWhitespace]);

  return (
    <figure className="diff-preview">
      <figcaption className="diff-preview-caption">{caption}</figcaption>
      <div className="diff-preview-body" aria-hidden="true">
        <PatchDiff patch={patch} options={options} disableWorkerPool />
      </div>
    </figure>
  );
}
