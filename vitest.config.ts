import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * Two suites, one command.
 *
 * `lib/` is pure by contract — it names no DOM and no `chrome.*` API — so it
 * runs in `node`, where an accidental `document` reference fails loudly instead
 * of quietly working. `ui/` is React and needs a document, so it gets `jsdom`.
 *
 * The alias is spelled as a regex rather than the string `'@'` so it can only
 * ever match the `@/…` project paths and never a scoped package name.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'lib',
          environment: 'node',
          include: ['lib/**/*.test.ts'],
        },
      },
      {
        resolve: {
          alias: [{ find: /^@\/(.*)$/, replacement: `${root}$1` }],
        },
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['ui/**/*.test.tsx'],
          setupFiles: ['./ui/testSetup.ts'],
        },
      },
      {
        /**
         * The card the content script puts on github.com.
         *
         * Its own project rather than a wider `include` on `ui` above: it needs
         * a document, but not React, not Testing Library and not the Pierre
         * shims that suite sets up. It is plain DOM in a shadow root, and it is
         * tested as such.
         */
        resolve: {
          alias: [{ find: /^@\/(.*)$/, replacement: `${root}$1` }],
        },
        test: {
          name: 'content',
          environment: 'jsdom',
          include: ['entrypoints/content/**/*.test.ts'],
        },
      },
    ],
  },
});
