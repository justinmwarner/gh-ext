/**
 * One list of changed files, assembled from the two GitHub sends.
 *
 * The diff — unified or, for an oversized pull request, the files endpoint —
 * says *what* changed and carries the patch. The GraphQL `files` connection
 * says *how much* changed and whether this reviewer has already looked at it.
 * Neither is sufficient: rendering needs the patch, the tree needs the counts,
 * and the card header needs the viewed state.
 *
 * The diff is the spine. It decides which files exist and in what order,
 * because that is the order the reviewer reads them in. GraphQL metadata is
 * joined on to it by path, and every field it supplies has a fallback derived
 * from the patch — the connection is capped and GraphQL nulls out what it could
 * not resolve, so "the row is missing" is a case, not a bug.
 */

import type { FallbackDiffFile } from '@/lib/github/files-fallback';
import type { FileViewedState, PatchStatus } from '@/lib/github/types';
import type { PrPayload } from '@/lib/messages';
import { DEFAULT_NOISE_PATTERNS, isNoise } from '@/lib/review/filters';

export interface ReviewFile {
  /** Path in the head commit. For a delete, the path that was removed. */
  path: string;
  /** Path in the base commit. Differs from `path` only for renames and copies. */
  oldPath: string;
  isBinary: boolean;
  isRename: boolean;
  /**
   * GitHub listed the file but sent no patch for it. Only ever true on the
   * files-endpoint fallback; the unified diff either has a patch or has no file.
   */
  patchOmitted: boolean;
  /** Raw unified-diff text for this file, header included. */
  patch: string;
  additions: number;
  deletions: number;
  changeType: PatchStatus;
  viewedState: FileViewedState;
  /** Matched a noise pattern — a lockfile, a vendored tree, generated output. */
  noise: boolean;
}

/** The GraphQL row for one file, as far as this module reads it. */
interface FileMetadata {
  additions: number;
  deletions: number;
  changeType: PatchStatus;
  viewedState: FileViewedState;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

const CHANGE_TYPES: Record<string, PatchStatus> = {
  ADDED: 'ADDED',
  DELETED: 'DELETED',
  RENAMED: 'RENAMED',
  COPIED: 'COPIED',
  MODIFIED: 'MODIFIED',
  CHANGED: 'CHANGED',
};

const VIEWED_STATES: Record<string, FileViewedState> = {
  VIEWED: 'VIEWED',
  UNVIEWED: 'UNVIEWED',
  DISMISSED: 'DISMISSED',
};

/**
 * Index the GraphQL files connection by path.
 *
 * Every level is optional because the node arrives under an index signature and
 * GraphQL is entitled to have nulled any of it out. A row that cannot be read
 * is skipped rather than defaulted, so the caller falls back to the patch
 * instead of showing a confident zero.
 */
function metadataByPath(node: PrPayload['pullRequest']): Map<string, FileMetadata> {
  const byPath = new Map<string, FileMetadata>();

  const files = node['files'];
  if (!isRecord(files)) return byPath;
  const nodes = files['nodes'];
  if (!Array.isArray(nodes)) return byPath;

  for (const row of nodes) {
    if (!isRecord(row)) continue;
    const path = row['path'];
    if (typeof path !== 'string' || path === '') continue;

    const changeType = CHANGE_TYPES[String(row['changeType'])];
    const viewedState = VIEWED_STATES[String(row['viewerViewedState'])];

    byPath.set(path, {
      additions: readCount(row['additions']) ?? 0,
      deletions: readCount(row['deletions']) ?? 0,
      changeType: changeType ?? 'MODIFIED',
      viewedState: viewedState ?? 'UNVIEWED',
    });
  }

  return byPath;
}

/**
 * Added and removed line counts, read off the patch.
 *
 * `+++`/`---` are the file headers, not content, and counting them would put a
 * spurious `+1 −1` on every file. Everything else beginning with `+` or `-`
 * inside a patch body is a changed line.
 */
export function countPatchLines(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  // The headers are only above the first `@@`. Filtering them by prefix across
  // the whole patch also swallows content: a deleted `-- comment` arrives as
  // `--- comment` and an added `++i;` as `+++i;`, so a file that removed ten
  // SQL comments or YAML separators reported a confident, wrong, zero — in the
  // one situation where nothing else can correct it.
  let inBody = false;

  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      inBody = true;
      continue;
    }
    if (!inBody) continue;
    if (line.startsWith('+')) additions += 1;
    else if (line.startsWith('-')) deletions += 1;
  }

  return { additions, deletions };
}

/** The best change type available without the GraphQL row. */
function inferChangeType(file: { isRename: boolean }): PatchStatus {
  return file.isRename ? 'RENAMED' : 'MODIFIED';
}

export function reviewFiles(payload: PrPayload): ReviewFile[] {
  const metadata = metadataByPath(payload.pullRequest);

  return payload.diff.files.map((file): ReviewFile => {
    const row = metadata.get(file.path);
    const counted = row ?? countPatchLines(file.patch);

    // `patchOmitted` and `changeType` exist only on the fallback arm of the
    // union. Narrowing by property rather than by `payload.diff.source` keeps
    // this honest for a single file handed in from either shape.
    const fallback = file as Partial<FallbackDiffFile>;

    return {
      path: file.path,
      oldPath: file.oldPath,
      isBinary: file.isBinary,
      isRename: file.isRename,
      patchOmitted: fallback.patchOmitted ?? false,
      patch: file.patch,
      additions: counted.additions,
      deletions: counted.deletions,
      changeType: row?.changeType ?? fallback.changeType ?? inferChangeType(file),
      viewedState: row?.viewedState ?? 'UNVIEWED',
      noise: isNoise(file.path, DEFAULT_NOISE_PATTERNS),
    };
  });
}
