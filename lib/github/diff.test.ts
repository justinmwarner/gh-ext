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
    expect(first.path).toBe('src/a.ts');
    expect(first.oldPath).toBe('src/a.ts');
    expect(first.isBinary).toBe(false);
    expect(first.patch).toContain('@@ -1,3 +1,3 @@');
    expect(first.patch).toContain('+const y = 3;');
  });

  it('detects renames and reports both paths', () => {
    const renamed = parseUnifiedDiff(SAMPLE)[1];
    expect(renamed.oldPath).toBe('old.ts');
    expect(renamed.path).toBe('new.ts');
    expect(renamed.isRename).toBe(true);
  });

  it('flags binary files, which have no usable patch', () => {
    const binary = parseUnifiedDiff(SAMPLE)[2];
    expect(binary.path).toBe('logo.png');
    expect(binary.isBinary).toBe(true);
  });

  it('returns an empty array for an empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});
