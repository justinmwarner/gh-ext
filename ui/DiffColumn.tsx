/**
 * The main column: stacked per-file diff cards.
 *
 * Empty this task. It reports what it has been handed so the region is not a
 * blank rectangle, and so a payload that arrived by the fallback path says so
 * here rather than looking like a diff with pieces missing.
 */

import type { DiffPayload } from '@/lib/messages';

export function DiffColumn({ diff }: { diff: DiffPayload }) {
  const count = diff.files.length;

  return (
    <main className="column" aria-label="Diff">
      {diff.source === 'files-api' && (
        <p className="notice">
          GitHub would not generate a unified diff for this pull request, so the
          file list came from the files endpoint instead
          {diff.truncated ? ' and was truncated' : ''}. Some files will have no
          patch.
        </p>
      )}
      <p className="placeholder">
        {count === 1 ? '1 changed file' : `${count} changed files`}. The diff
        cards go here.
      </p>
    </main>
  );
}
