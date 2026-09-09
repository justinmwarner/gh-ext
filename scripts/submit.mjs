/**
 * Submits the built packages to whichever stores are configured.
 *
 * `wxt submit` takes one flag per zip and refuses a store whose credentials it
 * cannot find. This wrapper decides which stores are in play by looking at
 * which secrets are actually set, so adding a store to a release means adding
 * its secrets and nothing else — no workflow edit, no flag to remember.
 *
 * That matters most for Firefox. Nothing has ever run this extension in
 * Firefox, and a release should not start submitting there the day someone
 * adds the credentials for an unrelated reason. It should, but only once
 * somebody has decided it is ready.
 *
 * Run by `.github/workflows/release.yml`, or locally with the same
 * environment variables. `DRY_RUN=true` checks credentials and uploads
 * nothing.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
// `--dry` locally, `DRY_RUN` from the workflow input. Either is enough: this
// is the flag people reach for when they are unsure, so it should be hard to
// ask for and not get.
const dryRun = process.env.DRY_RUN === 'true' || process.argv.includes('--dry');

/** The one zip in a directory matching a suffix, or null. */
const findZip = (dir, suffix) => {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const match = names.find((n) => n.endsWith(suffix) && n.includes(version));
  return match ? `${dir}/${match}` : null;
};

const set = (name) => (process.env[name] ?? '').trim() !== '';

const chromeZip = findZip('.output/store', '-chrome.zip');
const firefoxZip = findZip('.output', '-firefox.zip');
const sourcesZip = findZip('.output', '-sources.zip');

const args = [];
const stores = [];

// Chrome. The service account is API v2; the older client-id/refresh-token
// pair still works but Google has deprecated it.
if (set('CHROME_EXTENSION_ID') && set('CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL')) {
  if (!chromeZip) throw new Error('Chrome is configured but no chrome zip was built.');
  args.push('--chrome-zip', chromeZip);
  stores.push(`chrome (${chromeZip})`);
}

// Firefox. The sources zip is not optional — the submission is minified, so
// AMO cannot review it without the source, and a submission missing it is
// rejected rather than queued.
if (set('FIREFOX_EXTENSION_ID') && set('FIREFOX_JWT_ISSUER')) {
  if (!firefoxZip) throw new Error('Firefox is configured but no firefox zip was built.');
  if (!sourcesZip) throw new Error('Firefox needs the sources zip; none was built.');
  args.push('--firefox-zip', firefoxZip, '--firefox-sources-zip', sourcesZip);
  stores.push(`firefox (${firefoxZip} + sources)`);
}

// Edge takes the Chrome package unchanged — same Chromium, same manifest.
if (set('EDGE_PRODUCT_ID') && set('EDGE_CLIENT_ID')) {
  if (!chromeZip) throw new Error('Edge is configured but no chrome zip was built.');
  args.push('--edge-zip', chromeZip);
  stores.push(`edge (${chromeZip})`);
}

if (stores.length === 0) {
  console.error(
    'No store credentials are configured, so there is nothing to submit.\n' +
      'Add the secrets for a store to release to it. See store/SUBMITTING.md.',
  );
  process.exit(1);
}

if (dryRun) args.push('--dry-run');

console.log(`Submitting ${version} to:`);
for (const store of stores) console.log(`  - ${store}`);
if (dryRun) console.log('DRY RUN: credentials are checked, nothing is uploaded.');

// `npx` rather than a bare `wxt`, so this works whether it was started by an
// npm script (which puts node_modules/.bin on PATH) or run directly by node
// from a CI step (which does not).
const result = spawnSync('npx', ['wxt', 'submit', ...args], {
  stdio: 'inherit',
  shell: true,
});
process.exit(result.status ?? 1);
