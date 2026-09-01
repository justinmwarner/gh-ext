import type { ParsedDiffFile } from './diff';
import type { PatchStatus } from './types';

/**
 * A file from the REST files endpoint, used when GitHub refuses to generate the
 * unified diff for an oversized pull request.
 */
export interface FallbackDiffFile extends ParsedDiffFile {
  changeType: PatchStatus;
  /**
   * GitHub did not send a patch for this file — it does that for very large
   * files. The file is still listed so the reviewer can see it exists; `patch`
   * is empty.
   */
  patchOmitted: boolean;
}

export interface FallbackDiff {
  files: FallbackDiffFile[];
  /** GitHub's 3000-file cap was hit, so this list is incomplete. */
  truncated: boolean;
}

/** The maximum the files endpoint accepts. */
const PER_PAGE = 100;

/** GitHub returns at most 3000 files, however many pages you ask for. */
const MAX_FILES = 3000;

const STATUS_TO_CHANGE_TYPE: Record<string, PatchStatus> = {
  added: 'ADDED',
  removed: 'DELETED',
  modified: 'MODIFIED',
  renamed: 'RENAMED',
  copied: 'COPIED',
  changed: 'CHANGED',
};

interface RestFile {
  filename: string;
  status: string;
  /** Absent on very large files. */
  patch?: string | null;
  /** Present only on renames and copies. */
  previous_filename?: string;
}

/**
 * Fetch a pull request's files through REST, paginating to GitHub's cap.
 *
 * `fetchImpl` is injected and is expected to already carry authorization — this
 * module does no auth of its own.
 */
export async function fetchFilesFallback(
  owner: string,
  repo: string,
  number: number,
  fetchImpl: typeof fetch,
): Promise<FallbackDiff> {
  const files: FallbackDiffFile[] = [];
  let truncated = false;

  for (let page = 1; ; page += 1) {
    const res = await fetchImpl(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/files` +
        `?per_page=${PER_PAGE}&page=${page}`,
      { headers: { accept: 'application/vnd.github+json' } },
    );
    // Without this the JSON parse of an error body would either throw
    // something unreadable or yield an empty list that looks like a PR with no
    // files at all.
    if (!res.ok) throw new Error(`GitHub files request failed: ${res.status}`);

    const batch = (await res.json()) as RestFile[];
    for (const file of batch) files.push(toFallbackFile(file));

    // A short page is the last page.
    if (batch.length < PER_PAGE) break;
    if (files.length >= MAX_FILES) {
      truncated = true;
      break;
    }
  }

  return { files, truncated };
}

function toFallbackFile(file: RestFile): FallbackDiffFile {
  return {
    path: file.filename,
    oldPath: file.previous_filename ?? file.filename,
    isRename: file.status === 'renamed',
    // The files endpoint carries no binary marker. An absent patch is reported
    // through patchOmitted instead of being guessed at here.
    isBinary: false,
    patch: file.patch ?? '',
    patchOmitted: file.patch === undefined || file.patch === null,
    changeType: STATUS_TO_CHANGE_TYPE[file.status] ?? 'MODIFIED',
  };
}
