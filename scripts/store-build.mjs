/**
 * Runs a WXT command with the store flag set.
 *
 * This exists because of a bug worth recording. The store build used to be
 * `wxt build --mode store`, chosen so the manifest could branch on the mode
 * without adding a `cross-env` dependency to set an environment variable on
 * Windows.
 *
 * `--mode` is not a free-form flag. Vite derives `isProduction` from
 * `mode === 'production'`, so any custom mode is treated as a development
 * build: React resolves to its development runtime, the store package grew a
 * 378 kB `jsx-dev-runtime` chunk, and every user would have run React in dev
 * mode — slower, and logging warnings to their console. The default `wxt build`
 * was unaffected, so nothing showed it except reading the built output.
 *
 * So the flag is an environment variable again, and this script sets it in a
 * way that works the same from PowerShell, cmd and a POSIX shell. The mode
 * stays `production`, which is the whole point.
 */
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: node scripts/store-build.mjs <build|zip> [...wxt args]');
  process.exit(1);
}

const child = spawn('wxt', args, {
  stdio: 'inherit',
  // `shell` so this resolves `wxt` out of node_modules/.bin on Windows, where
  // the executable is a .cmd shim rather than something spawn can exec.
  shell: true,
  env: { ...process.env, CWS_BUILD: '1' },
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
