/**
 * A JSON document compared by key path, or re-indented and diffed as text.
 *
 * The two modes answer the two questions a JSON change raises. "What values
 * moved" is the key-path list, which is immune to reformatting and to array
 * insertion because it never looks at a line. "Show me the document" is the
 * formatted diff, which is the ordinary text view with the one thing that makes
 * it useless removed: both sides are re-indented identically first, so a
 * minified file compared against a pretty-printed one shows the edit rather
 * than the whole file.
 *
 * The formatted mode is `MultiFileDiff` from the library this project already
 * renders every diff with, so it inherits the same highlighting, the same
 * theme and the same shadow-root isolation. It is bounded by size: two
 * pretty-printed sides of a large document is a lot of main-thread highlighting
 * inside a card that was never virtualized, and past the bound the honest
 * answer is to say so and offer the key paths instead.
 */

import { useMemo } from 'react';
import { MultiFileDiff } from '@pierre/diffs/react';
import type { FileDiffOptions } from '@pierre/diffs';
import type { JsonComparison } from '@/lib/compare/structured';
import { formatJson } from '@/lib/compare/structured';

/**
 * How much re-indented JSON to hand the diff renderer, per side.
 *
 * A quarter of a megabyte of formatted document is already several thousand
 * lines of highlighting on the main thread, in a card that `CodeView` does not
 * virtualize because the content lives in its header slot. Past that the key
 * paths are both cheaper and more useful.
 */
const MAX_FORMATTED_CHARS = 250_000;

const DIFF_OPTIONS: FileDiffOptions<undefined> = {
  diffStyle: 'unified',
  // Deliberately absent, exactly as in `DiffColumn`: `preferredHighlighter` is
  // never set, because the default `shiki-js` touches no WebAssembly and the
  // wasm path dies silently in a build with no CSP key.
  disableLineNumbers: false,
};

export function JsonKeyPaths({ comparison }: { comparison: JsonComparison }) {
  if (comparison.status !== 'ok') {
    return (
      <p className="file-note" role="note">
        {comparison.reason}
      </p>
    );
  }

  if (comparison.changes.length === 0) {
    return (
      <p className="file-note" role="note">
        No values changed. The difference between these two versions is
        whitespace, key order, or both.
      </p>
    );
  }

  return (
    <div className="json-compare">
      <ul className="key-paths">
        {comparison.changes.map((change) => (
          <li key={`${change.type}:${change.path}`} className={`key-${change.type}`}>
            <code className="key-path">{change.path}</code>
            <span className="key-values">
              {change.before !== null && <code className="key-before">{change.before}</code>}
              {change.before !== null && change.after !== null && (
                <span aria-hidden="true"> → </span>
              )}
              {change.after !== null && <code className="key-after">{change.after}</code>}
            </span>
            <span className="visually-hidden">{change.type}</span>
          </li>
        ))}
      </ul>
      {comparison.truncated && (
        <p className="file-note" role="note">
          More values changed than are listed here. Switch to Raw for the whole
          change.
        </p>
      )}
      <p className="compare-summary">{comparison.changes.length} values changed</p>
    </div>
  );
}

export function JsonFormatted({
  path,
  before,
  after,
}: {
  path: string;
  before: string | null;
  after: string | null;
}) {
  const formatted = useMemo(() => {
    const one = before === null ? null : formatJson(before);
    const two = after === null ? null : formatJson(after);
    return { before: one, after: two };
  }, [before, after]);

  if (
    (before !== null && formatted.before === null) ||
    (after !== null && formatted.after === null)
  ) {
    return (
      <p className="file-note" role="note">
        One side of this file is not valid JSON, so there is nothing to
        re-indent. The raw diff is the only view of it.
      </p>
    );
  }

  const size = (formatted.before?.length ?? 0) + (formatted.after?.length ?? 0);
  if (size > MAX_FORMATTED_CHARS * 2) {
    return (
      <p className="file-note" role="note">
        This document is too large to re-indent and diff here. The key paths
        show what changed; Raw shows the change as GitHub sent it.
      </p>
    );
  }

  // Pierre requires one of the two sides to exist and takes null for the other,
  // which is exactly how an addition and a deletion arrive here.
  const oldFile =
    formatted.before === null ? null : { name: path, contents: formatted.before };
  const newFile =
    formatted.after === null ? null : { name: path, contents: formatted.after };

  if (oldFile === null && newFile === null) {
    return (
      <p className="file-note" role="note">
        Neither version of this file could be read.
      </p>
    );
  }

  return (
    <div className="embedded-diff">
      {newFile === null ? (
        <MultiFileDiff
          // A deletion: Pierre derives the removed side from the file it is
          // given and the null tells it there is nothing on the other.
          oldFile={oldFile as { name: string; contents: string }}
          newFile={null}
          options={DIFF_OPTIONS}
          disableWorkerPool
        />
      ) : oldFile === null ? (
        <MultiFileDiff
          oldFile={null}
          newFile={newFile}
          options={DIFF_OPTIONS}
          disableWorkerPool
        />
      ) : (
        <MultiFileDiff
          oldFile={oldFile}
          newFile={newFile}
          options={DIFF_OPTIONS}
          disableWorkerPool
        />
      )}
    </div>
  );
}
