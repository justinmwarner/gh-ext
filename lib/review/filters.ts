export const DEFAULT_NOISE_PATTERNS = [
  '**/*.lock',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
  '**/go.sum',
  'vendor/**',
  '**/vendor/**',
  'dist/**',
  '**/dist/**',
  'node_modules/**',
  '**/node_modules/**',
  '**/generated/**',
];

/** Translates a glob into a RegExp. Supports `**`, `*`, and `?` only. */
function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    // `i < glob.length` guarantees a character; `?? ''` only satisfies
    // noUncheckedIndexedAccess, and appending '' is a no-op regardless.
    const c = glob[i] ?? '';
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more leading segments.
        if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2; }
        else { out += '.*'; i += 1; }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

const cache = new Map<string, RegExp>();
const compile = (glob: string): RegExp => {
  let re = cache.get(glob);
  if (!re) { re = globToRegExp(glob); cache.set(glob, re); }
  return re;
};

export function isNoise(path: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => compile(p).test(path));
}
