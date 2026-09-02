import { defineConfig } from '@playwright/test';

/**
 * The browser suite, and only the browser suite.
 *
 * `testDir` is `e2e/` and the match is `*.spec.ts`, which is a spelling Vitest
 * never looks at: its two projects include `lib/**\/*.test.ts` and
 * `ui/**\/*.test.tsx` and nothing else. So `npx vitest run` cannot pick these
 * up, and `npx playwright test` cannot pick up the unit tests.
 *
 * One worker. Every test launches a persistent Chromium with the unpacked
 * extension loaded, and running several of those against one profile directory
 * is a way to spend the afternoon debugging the harness.
 *
 * No `projects` and no `use.browserName`: the extension has to be loaded with
 * `launchPersistentContext` and explicit flags, so the context comes from
 * `e2e/extension.ts` rather than from Playwright's own browser fixture.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  // A cold Chromium plus a real Shiki highlight of fourteen files is slower
  // than a jsdom render by a wide margin, and a flaky timeout would teach
  // nothing.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});
