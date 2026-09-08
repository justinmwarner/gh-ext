import { defineConfig } from '@playwright/test';

/**
 * Store screenshots, which are not tests.
 *
 * A separate config rather than another `*.spec.ts`, because these write PNGs
 * into the repository and take a viewport the review suite has no reason to
 * pin. `testMatch` is `*.shot.ts`, a spelling neither Vitest nor
 * `playwright.config.ts` looks at, so `npm test` and `npm run test:e2e` cannot
 * pick these up and this cannot pick them up either.
 *
 * Run with `npm run screenshots`, after a build.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.shot.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
});
