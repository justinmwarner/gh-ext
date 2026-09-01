export interface ParsedDiffFile {
  /** Path in the head commit. For a delete, the path that was removed. */
  path: string;
  /** Path in the base commit. Differs from `path` only for renames and copies. */
  oldPath: string;
  isBinary: boolean;
  isRename: boolean;
  /** Raw unified-diff text for this file, header included. */
  patch: string;
}

const FILE_HEADER = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/;

export function parseUnifiedDiff(diff: string): ParsedDiffFile[] {
  if (diff.trim() === '') return [];

  // Split on either line ending. A trailing \r would defeat the $-anchored
  // header regex, dropping the file or merging it into the previous one's
  // patch with no error. Rejoining with \n normalizes the stored patch text.
  const lines = diff.split(/\r?\n/);
  const files: ParsedDiffFile[] = [];
  let current: string[] | null = null;

  const flush = () => {
    if (current) files.push(toFile(current));
    current = null;
  };

  for (const line of lines) {
    if (FILE_HEADER.test(line)) {
      flush();
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  flush();

  return files;
}

function toFile(block: string[]): ParsedDiffFile {
  const patch = block.join('\n');
  const header = block[0]?.match(FILE_HEADER);

  let oldPath = header?.[1] ?? '';
  let path = header?.[2] ?? '';
  let isRename = false;

  for (const line of block) {
    if (line.startsWith('rename from ')) {
      oldPath = line.slice('rename from '.length);
      isRename = true;
    } else if (line.startsWith('rename to ')) {
      path = line.slice('rename to '.length);
      isRename = true;
    }
  }

  return {
    path,
    oldPath,
    isRename,
    isBinary: block.some((l) => l.startsWith('Binary files ')),
    patch,
  };
}
