/**
 * Everything the store listing needs, from one command.
 *
 * Refreshing a listing used to be six commands and a `node -e` pasted out of
 * `store/SUBMITTING.md`, run in an order that is not written down anywhere and
 * matters in two places. This is that order, executed.
 *
 * What it produces, in the order it produces it:
 *
 * 1. the unpacked build the screenshots are taken against
 * 2. the screenshots, the promo tiles, the README card and dashboard stills
 * 3. the walkthrough video
 * 4. the store package, from its own build with the manifest `key` omitted
 *
 * Two of those orderings are load-bearing. The shots drive the *real*
 * extension, so they need a build that already exists — which is why this
 * builds once up front rather than letting `npm run screenshots` build again
 * for itself. And the video has to be a second Playwright pass: `TOUR_VIDEO`
 * turns on `recordVideo` for every context the fixture makes, so a single pass
 * would record the screenshot runs too and pay for frames nobody looks at.
 *
 * It ends by reading the manifest it just packaged and saying what the listing
 * has to agree with. That is not a flourish. `store/LISTING.md` carries two
 * different justifications for `https://github.com/*` and only one of them is
 * true of any given build; sending the wrong one is the kind of mismatch items
 * get rejected for, and until now the only thing standing between those two
 * paragraphs was somebody remembering to run a command from step 3 of the
 * submission guide.
 *
 * Usage:
 *
 *   node scripts/store-assets.mjs [--dirty] [--no-video]
 *
 *   --dirty      build anyway with uncommitted changes in the tree
 *   --no-video   skip the walkthrough, which is the slow half and is gitignored
 *
 * Spawned with `shell: true` throughout for the reason `store-build.mjs` gives:
 * on Windows these binaries are `.cmd` shims rather than something `spawn` can
 * execute directly.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const flags = new Set(process.argv.slice(2));
const allowDirty = flags.has('--dirty');
const withVideo = !flags.has('--no-video');

const unknown = [...flags].filter((flag) => !['--dirty', '--no-video'].includes(flag));
if (unknown.length > 0) {
  console.error(`unknown option${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
  console.error('usage: node scripts/store-assets.mjs [--dirty] [--no-video]');
  process.exit(1);
}

/** Run something, and stop the whole script if it fails. */
function run(label, command, args, env = {}) {
  console.log(`\n→ ${label}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    console.error(`\n✗ ${label} failed`);
    process.exit(result.status ?? 1);
  }
}

/** Read a command's output rather than showing it. */
function read(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: true });
  return result.status === 0 ? result.stdout.trim() : '';
}

/**
 * Refuse a dirty tree, because the build packages the disk rather than the
 * commit.
 *
 * `store/SUBMITTING.md` says this at length and in bold, which is the sign of
 * a hazard somebody has already been bitten by: a half-finished feature or a
 * debugging edit ships to the store and cannot be unshipped without another
 * review cycle. A guard is worth more than the warning, so this is the guard.
 */
const dirty = read('git', ['status', '--porcelain']);
if (dirty !== '' && !allowDirty) {
  console.error('\n✗ the working tree has uncommitted changes:\n');
  console.error(dirty);
  console.error(
    '\nThe build packages what is on disk, not what is committed — so this would\n' +
      'ship those changes. Commit them, or build from a worktree at the commit you\n' +
      'mean to release (store/SUBMITTING.md step 3 has the incantation).\n' +
      '\nPass --dirty to do it anyway.',
  );
  process.exit(1);
}
if (dirty !== '' && allowDirty) {
  console.warn('\n⚠ --dirty: packaging uncommitted changes. This is not a release build.\n');
}

const head = read('git', ['rev-parse', '--short', 'HEAD']);
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
console.log(`Refreshing store assets for v${version} at ${head === '' ? 'an unknown commit' : head}.`);

run('building the extension', 'wxt', ['build']);

run('screenshots, promo tiles and stills', 'playwright', [
  'test',
  '--config',
  'playwright.screenshots.config.ts',
]);

if (withVideo) {
  // Scratch space for Playwright's raw recording. `tour.shot.ts` renames the
  // file out of here into `store/video`, so nothing looks at this directory.
  const scratch = mkdtempSync(join(tmpdir(), 'abr-tour-'));
  run(
    'walkthrough video',
    'playwright',
    ['test', '--config', 'playwright.screenshots.config.ts', 'tour.shot'],
    { TOUR_VIDEO: scratch },
  );
} else {
  console.log('\n(skipping the walkthrough video)');
}

run('store package', 'node', ['scripts/store-build.mjs', 'zip']);

/**
 * What the listing has to say, read off the package rather than remembered.
 *
 * The content script's `matches` is the one that decides between the two
 * `https://github.com/*` justifications in `store/LISTING.md`.
 */
const manifest = JSON.parse(readFileSync('.output/store/chrome-mv3/manifest.json', 'utf8'));
const matches = (manifest.content_scripts ?? []).flatMap((script) => script.matches ?? []);
const wholeSite = matches.includes('https://github.com/*');

console.log('\n─── the package ───');
console.log(`  version           ${manifest.version}`);
console.log(`  permissions       ${(manifest.permissions ?? []).join(', ') || '(none)'}`);
console.log(`  host permissions  ${(manifest.host_permissions ?? []).join(', ') || '(none)'}`);
console.log(`  content script    ${matches.join(', ') || '(none)'}`);
console.log(`  manifest key      ${'key' in manifest ? '⚠ PRESENT — the store rejects this' : 'omitted, as the store wants'}`);

console.log('\n─── the listing ───');
console.log(
  wholeSite
    ? '  Use the WHOLE-SITE justification for https://github.com/* in LISTING.md —\n' +
        '  the one that explains the single-page-app problem. The manifest matches\n' +
        '  the whole of github.com, so the narrower wording would understate it.'
    : '  Use the NARROWER justification for https://github.com/* in LISTING.md —\n' +
        '  say the script runs on pull request pages and drop the single-page-app\n' +
        '  paragraph. The manifest does not match the whole site, so the broader\n' +
        '  wording would be a misrepresentation.',
);

/**
 * What actually moved, so the upload is the changed files rather than all of
 * them. `store/video/` is gitignored and never shows up here, so it is named
 * separately below.
 */
const changed = read('git', ['status', '--porcelain', '--', 'store']);
console.log('\n─── what changed ───');
console.log(changed === '' ? '  nothing under store/ — the assets already matched this build' : changed);

console.log('\n─── what to upload ───');
console.log(`  package      .output/store/a-better-reviewer-${manifest.version}-chrome.zip`);
console.log('  screenshots  store/screenshots/   (01-review.png first)');
console.log('  promo tiles  store/promo/');
if (withVideo) console.log('  video        store/video/tour-1280x800.webm → YouTube, then paste the URL');
console.log('  copy         store/LISTING.md');
console.log(
  '\nThe version must be higher than the published one. `npm version patch` bumps it —\n' +
    'note that it also tags, and pushing that tag starts the release workflow.\n',
);
