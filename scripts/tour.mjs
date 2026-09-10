/**
 * Records the store walkthrough, with the recording flag set portably.
 *
 * The same shape as `store-build.mjs` and for the same reason: this project
 * takes no `cross-env` dependency, and `TOUR_VIDEO=... playwright test` is not
 * a command PowerShell or cmd understands. Setting it here works from all
 * three shells.
 *
 * `TOUR_VIDEO` names the directory Playwright drops its raw recording into.
 * `tour.shot.ts` renames the file out of there and into `store/video`, so this
 * is scratch space rather than an output anybody looks at.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'abr-tour-'));

const child = spawn(
  'playwright',
  ['test', '--config', 'playwright.screenshots.config.ts', 'tour.shot'],
  {
    stdio: 'inherit',
    // `shell` so this resolves the binary out of node_modules/.bin on Windows,
    // where it is a .cmd shim rather than something spawn can exec.
    shell: true,
    env: { ...process.env, TOUR_VIDEO: scratch },
  },
);

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
