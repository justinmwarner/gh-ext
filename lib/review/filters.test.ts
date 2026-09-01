import { describe, expect, it } from 'vitest';
import { DEFAULT_NOISE_PATTERNS, isNoise } from './filters';

describe('isNoise', () => {
  const noisy = [
    'package-lock.json', 'pnpm-lock.yaml', 'go.sum', 'yarn.lock',
    'Cargo.lock', 'vendor/foo/bar.go', 'dist/bundle.js',
    'node_modules/x/index.js', 'src/generated/api.ts',
  ];
  const signal = ['src/app.ts', 'README.md', 'lib/lockfile-utils.ts', 'src/distance.ts'];

  it.each(noisy)('treats %s as noise', (p) => {
    expect(isNoise(p, DEFAULT_NOISE_PATTERNS)).toBe(true);
  });

  it.each(signal)('treats %s as signal', (p) => {
    expect(isNoise(p, DEFAULT_NOISE_PATTERNS)).toBe(false);
  });

  it('supports a caller-supplied pattern', () => {
    expect(isNoise('snapshots/a.snap', ['**/*.snap'])).toBe(true);
  });

  it('treats an empty pattern list as matching nothing', () => {
    expect(isNoise('package-lock.json', [])).toBe(false);
  });
});
