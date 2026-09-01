import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './diff';

const SAMPLE = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 const x = 1;
-const y = 2;
+const y = 3;
diff --git a/old.ts b/new.ts
similarity index 90%
rename from old.ts
rename to new.ts
diff --git a/logo.png b/logo.png
index 3333333..4444444 100644
Binary files a/logo.png and b/logo.png differ
`;

describe('parseUnifiedDiff', () => {
  it('splits into one entry per file', () => {
    expect(parseUnifiedDiff(SAMPLE)).toHaveLength(3);
  });

  it('captures the path and patch text of a modified file', () => {
    const [first] = parseUnifiedDiff(SAMPLE);
    expect(first).toMatchObject({
      path: 'src/a.ts',
      oldPath: 'src/a.ts',
      isBinary: false,
    });
    expect(first?.patch).toContain('@@ -1,3 +1,3 @@');
    expect(first?.patch).toContain('+const y = 3;');
  });

  it('detects renames and reports both paths', () => {
    expect(parseUnifiedDiff(SAMPLE)[1]).toMatchObject({
      oldPath: 'old.ts',
      path: 'new.ts',
      isRename: true,
    });
  });

  it('flags binary files, which have no usable patch', () => {
    expect(parseUnifiedDiff(SAMPLE)[2]).toMatchObject({
      path: 'logo.png',
      isBinary: true,
    });
  });

  it('returns an empty array for an empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });

  it('parses CRLF input identically to LF', () => {
    // A trailing \r defeats the $-anchored header regex, which silently drops
    // the file or appends its lines onto the previous file's patch. Losing a
    // file from a review without any error is the worst failure this parser
    // has, so it is pinned here.
    const crlf = SAMPLE.replace(/\n/g, '\r\n');
    expect(parseUnifiedDiff(crlf)).toEqual(parseUnifiedDiff(SAMPLE));
  });
});
