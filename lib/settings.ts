/**
 * The reviewer's preferences, and what a stored value is allowed to mean.
 *
 * Pure by contract like the rest of `lib/` — the adapter that actually touches
 * `browser.storage` is `lib/settings-store.ts`. Keeping the validation here is
 * what lets three separate contexts (the content script, the worker and the
 * options page) agree on what a stored blob means without any of them needing a
 * browser to prove it.
 */

import { type ComparisonKind, isRememberedKind, modesFor } from './compare/modes';
import { THEME_FOLLOWS_PAGE, isDiffTheme } from './compare/themes';

/** Where a review opens. */
export type OpenIn = 'new-tab' | 'new-window' | 'same-tab';

/**
 * How much of a changed line is picked out inside it.
 *
 * Pierre's `lineDiffType`, named here so the options page and the diff column
 * agree on the four values without either importing the other's types.
 */
export type LineDiff = 'word-alt' | 'word' | 'char' | 'none';

export interface Settings {
  openIn: OpenIn;
  /** Open a review by itself on landing on a pull request. */
  autoOpen: boolean;
  /**
   * Open the review without moving to it.
   *
   * A sibling of {@link openIn} rather than a value inside it, because it is a
   * different question: that one is *where* the review goes, this one is
   * whether the reviewer goes with it. Triaging a notification digest means
   * opening three pull requests and reading none of them yet, and a click that
   * steals focus turns that into three interruptions.
   *
   * Ignored for `same-tab`, which has no background to open into.
   */
  openInBackground: boolean;
  /**
   * Write diagnostics to the console.
   *
   * Off by default. This extension runs a content script on every github.com
   * page, so anything it logs uninvited lands in a console the reviewer is
   * probably using for their own work.
   */
  debugLogging: boolean;
  /**
   * Draw every file's diff without the changes that were only whitespace.
   *
   * Here rather than on the page, and that reverses a decision this file's
   * neighbours used to argue for. The objection was real and is worth keeping,
   * because this setting has to answer it: a preference that *hides lines*
   * must not be able to arrive already on without the reviewer knowing.
   *
   * What answers it is where the switch now lives. A per-file button on a card,
   * remembered across sessions, is a diff quietly reshaped by a decision made
   * last Tuesday on a different pull request — the reviewer has no reason to
   * look at the card header for the explanation. A checkbox on the options
   * page, under the sentence saying what it hides, is a decision made about
   * every review, in the one place a reviewer already goes to change how this
   * extension behaves.
   *
   * The per-file button is gone rather than demoted. Two switches for one
   * question is how a reviewer ends up unsure which of them is winning.
   */
  ignoreWhitespace: boolean;
  /**
   * Draw the old and new file in two columns rather than one.
   *
   * Purely how the same lines are arranged, so it carries none of the hazard
   * above: nothing is hidden either way. It is stored for the ordinary reason
   * — a reviewer who prefers side by side prefers it on every pull request,
   * and setting it again on each one is the chore an extension exists to
   * remove.
   */
  splitView: boolean;
  /**
   * Fold away the diff of a file nobody wrote.
   *
   * Folded rather than hidden, and that is the whole reason this one is not as
   * dangerous as {@link ignoreWhitespace} despite sounding worse. The file
   * stays in the tree and in the column, keeps its name and its counts, wears a
   * label saying why its body is not drawn, and is one press from open. Nothing
   * about the pull request becomes unknowable; a lockfile's four thousand lines
   * simply stop sitting between two files somebody wrote.
   *
   * Off by default all the same. A fresh install shows what GitHub shows, and
   * `lib/review/generated.ts` is a heuristic over paths — being wrong about one
   * is cheap once the reviewer has opted in and knows the rule exists, and
   * expensive on the first pull request they ever open here.
   */
  hideGenerated: boolean;
  /**
   * Which syntax theme the diff is drawn in.
   *
   * A theme id from `lib/compare/themes.ts`, or {@link THEME_FOLLOWS_PAGE} —
   * the empty string, and the default — meaning Pierre picks its own pair and
   * follows the page.
   *
   * It exists because of contrast rather than taste. Pierre's default palette
   * has tokens that measure 2.14:1 against a white page, which is below what
   * any text needs and well below what code a reviewer reads character by
   * character deserves. Two answers were possible: pick a better theme for
   * everybody, or let the reviewer pick. The second is right here, because the
   * people worst served by the default are the ones whose needs nobody else can
   * guess — the high-contrast themes and the colour-vision-deficiency themes
   * are both in the list, and both are somebody's answer and nobody else's.
   *
   * Naming one theme rather than a light/dark pair is deliberate. A pair sounds
   * tidier and is worse: most of the list has no counterpart in the other mode,
   * so a pair either halves what can be offered or invents partnerships the
   * reviewer did not choose.
   */
  diffTheme: string;
  /**
   * How long a pull request goes without moving before it counts as quiet.
   *
   * A setting rather than a constant because the right number is a property of
   * a team's cadence and not of this extension: a fortnight is nothing on a
   * release branch and an age on a repository that ships twice a day.
   *
   * Whole days, and at least one. Zero would send every pull request to Quiet
   * the moment it was read — a dashboard that empties itself — so it is
   * refused rather than clamped, on the same principle as every other stored
   * value here.
   */
  stalenessDays: number;
  /**
   * The repositories whose whole open list the dashboard shows.
   *
   * Empty by default, and only ever added to by the reviewer ticking a box.
   * Discovery finds every repository the account has opened a pull request in
   * — nineteen, for the account this was built against, most of them scratch
   * work — and watching all of them uninvited is exactly the attention
   * PRODUCT.md says this product does not get to take.
   *
   * Separate from the involvement searches, which need no repository list at
   * all. See `lib/dashboard/repos.ts` for why the two are kept apart.
   */
  watchedRepos: string[];
  /**
   * How much of a changed line is picked out inside it.
   *
   * `word-alt` is Pierre's own default and stays ours. `char` is meaningfully
   * better for a rename inside a line and for prose, where a word-level pass
   * marks a whole sentence changed because its third word gained an 's'.
   * `none` is for anyone who finds the inner highlighting noisier than the
   * line-level colour it sits on.
   *
   * Rearranges nothing and hides nothing, so it carries none of the hazard
   * {@link ignoreWhitespace} does: the same lines are marked changed either
   * way, and only the emphasis inside them moves.
   */
  lineDiff: LineDiff;
  /**
   * Open the file tree with its directories shut.
   *
   * For the monorepo case, where a hundred and fifty files across a deep tree
   * arrive as a wall of rows with no shape to them. Folded rather than hidden,
   * on the same reasoning {@link hideGenerated} is: every directory keeps its
   * row and is one press from open.
   */
  collapseTree: boolean;
  /**
   * Paths the reviewer calls generated, on top of the built-in list.
   *
   * Globs in the syntax `lib/review/filters.ts` supports — `**`, `*` and `?`.
   * Every team has one path the heuristic misses and no heuristic can guess:
   * a generated API client, a snapshot directory, a tree of protobuf stubs.
   *
   * Additive, empty by default, and effective only while {@link hideGenerated}
   * is on. All three of those are the same rule {@link ignoreWhitespace}
   * answers to — a preference that folds a file away must not be able to
   * arrive already doing it without the reviewer having asked.
   *
   * The repository's own `.gitattributes` still outranks this, for the reason
   * `lib/review/generated.ts` gives: a repository marking a path is a
   * statement about that path in particular, where a glob typed here is a
   * standing guess about every repository the reviewer opens.
   */
  generatedPatterns: readonly string[];
  /**
   * Leave the browser's own find to the browser.
   *
   * The review page binds `Mod+F` to its search over changed lines, which is
   * the more useful of the two on a diff and the wrong one when the reviewer
   * wanted the page search they have used everywhere else for twenty years.
   * Turning this on releases the key; the review search keeps `/`.
   *
   * One key rather than a remapping screen. A remapper is a config format, a
   * conflict resolver and a reset button, and PRODUCT.md's "do less,
   * completely" is a straight argument against building all three to solve one
   * collision.
   */
  releaseFindKey: boolean;
}

/** `storage.local` key holding the whole {@link Settings} object. */
export const SETTINGS_KEY = 'settings';

/**
 * `storage.local` key holding whether the card is collapsed.
 *
 * Its own key rather than a field on {@link Settings} on purpose. The content
 * script writes it on every toggle while the options page writes the settings
 * object, and two writers doing read-modify-write on one key will eventually
 * lose one of the two edits. Separate keys cannot collide.
 */
export const CARD_COLLAPSED_KEY = 'card-collapsed';

/**
 * `storage.local` key holding the mode each remembered kind opens in.
 *
 * Its own key rather than a field on {@link Settings}, and for the same reason
 * {@link CARD_COLLAPSED_KEY} is: the review page writes this on every press
 * while the options page writes the settings object, and two writers doing
 * read-modify-write on one key will eventually lose one of the two edits.
 */
export const MODE_MEMORY_KEY = 'mode-memory';

/**
 * `storage.local` key holding the file tree rail's width, in pixels.
 *
 * Its own key rather than a field on {@link Settings}, for the reason
 * {@link CARD_COLLAPSED_KEY} is: the review page writes this at the end of
 * every drag while the options page writes the settings object, and two writers
 * doing read-modify-write on one key will eventually lose one of the two edits.
 *
 * Not on the options page at all, and that is the point of it. `ui/Shell.tsx`
 * argues that nothing on the review page is remembered because everything there
 * is an answer to *this* pull request — but a rail width is not an answer to a
 * pull request, it is an answer to a monitor, and it is the same on all of
 * them. A control for it would be a number field for something the reviewer has
 * already said with a drag.
 */
export const RAIL_WIDTH_KEY = 'rail-width';

/**
 * Read a stored rail width, or `null` for "no answer yet, use the default".
 *
 * Clamped to the range the resizer itself enforces rather than trusted: a
 * stored width from a wider monitor, or a corrupted one, would otherwise draw a
 * rail that leaves no room for the diff and cannot be grabbed to fix.
 */
export function parseRailWidth(raw: unknown, min: number, max: number): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.min(Math.max(Math.round(raw), min), max);
}

/** Which mode each remembered kind opens in. Absent means "the kind's default". */
export type ModeMemory = Readonly<Partial<Record<ComparisonKind, string>>>;

/**
 * Nothing remembered, as one shared object.
 *
 * Exported, and the shared identity is the reason rather than a side effect.
 * `ui/useModeMemory.ts` seeds both its state and its ref with this, and a fresh
 * `{}` on each render would be a new identity every time — which is a re-render
 * of every card in the column to say that nothing has changed. That is safe
 * only because the hook never writes to it, and {@link parseModeMemory} spreads
 * rather than returning it, so no caller is handed the instance to keep.
 */
export const EMPTY_MODE_MEMORY: ModeMemory = {};

/**
 * `new-tab` rather than the `same-tab` this extension used to do unconditionally.
 *
 * Replacing the pull request page is a surprising amount to do in response to
 * one click, and it throws away the thing the reviewer may still want: the
 * conversation, the merge button, the rest of GitHub.
 */
export const DEFAULT_SETTINGS: Settings = {
  openIn: 'new-tab',
  autoOpen: false,
  // Off, so a click still goes where a click has always gone. Opening behind
  // the current tab is the right answer for a reviewer queueing three reviews
  // and a baffling one for a reviewer who pressed the button to read this one.
  openInBackground: false,
  debugLogging: false,
  // Both off, so a first review looks like GitHub's own until the reviewer
  // says otherwise. `ignoreWhitespace` especially: the default for a setting
  // that hides lines is the one that hides none of them.
  ignoreWhitespace: false,
  splitView: false,
  hideGenerated: false,
  // Unset, so Pierre keeps choosing. A theme named here would be this version's
  // taste frozen into every install's storage, and a later change to it
  // invisible to anyone who had already opened the options page.
  diffTheme: THEME_FOLLOWS_PAGE,
  // A fortnight. A guess made in the design document rather than a measured
  // figure, and the options page says so beside the field.
  stalenessDays: 14,
  // Nothing. Discovery proposes; the reviewer disposes.
  watchedRepos: [],
  // Pierre's own default, restated rather than left unset: the options page has
  // to draw this choice as selected, and it cannot draw an absence.
  lineDiff: 'word-alt',
  collapseTree: false,
  // Empty, and the type is the frozen literal rather than a fresh array: a
  // shared mutable default is how one caller's push becomes everybody's
  // pattern.
  generatedPatterns: Object.freeze([]),
  // Off: the review page keeps `Mod+F` until asked to give it back. Releasing
  // it by default would leave the diff search reachable only by `/`, which is
  // the key fewer reviewers try first.
  releaseFindKey: false,
};

/**
 * `owner/name`, and not much more than that.
 *
 * Deliberately loose. GitHub's own rules for what may appear in an owner or a
 * repository name have changed more than once, and a strict pattern here would
 * quietly drop a repository somebody really does contribute to. One slash, no
 * empty halves, no whitespace — enough to reject a stored value that is
 * obviously not a repository, and no more.
 */
const REPO_NAME = /^[^\s/]+\/[^\s/]+$/;

/**
 * Typed as `Record<OpenIn, true>` so adding a destination to the union without
 * adding it here is a compile error, and the runtime check cannot fall behind.
 */
const OPEN_IN: Record<OpenIn, true> = {
  'new-tab': true,
  'new-window': true,
  'same-tab': true,
};

export function isOpenIn(value: unknown): value is OpenIn {
  // `hasOwn` rather than `in`, so `'constructor'` and friends are not
  // destinations.
  return typeof value === 'string' && Object.hasOwn(OPEN_IN, value);
}

/** Typed like {@link OPEN_IN}, and for the same reason. */
const LINE_DIFF: Record<LineDiff, true> = {
  'word-alt': true,
  word: true,
  char: true,
  none: true,
};

export function isLineDiff(value: unknown): value is LineDiff {
  return typeof value === 'string' && Object.hasOwn(LINE_DIFF, value);
}

/**
 * How many globs {@link Settings.generatedPatterns} will carry, and how long
 * each may be.
 *
 * Not a judgement about how many a reviewer needs — it is a bound on what a
 * corrupted or hostile storage blob can make the matcher do. `isNoise` compiles
 * every pattern to a `RegExp` and runs it against every path in the pull
 * request, so an unbounded list is an unbounded amount of work on the way to
 * drawing a diff.
 */
export const MAX_PATTERNS = 100;
export const MAX_PATTERN_LENGTH = 200;

/**
 * Read a stored glob list, dropping per entry.
 *
 * Dropped rather than rejected, like {@link parseSettings} and
 * {@link parseModeMemory}: one unusable glob must not discard the twenty beside
 * it that were fine. Blank entries go too, because the options page stores this
 * as typed lines and an empty line is what a reviewer leaves behind, not a
 * pattern — and an empty glob matches everything, which would fold away the
 * whole pull request.
 */
export function parsePatterns(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return DEFAULT_SETTINGS.generatedPatterns;

  const patterns: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const glob = entry.trim();
    if (glob === '' || glob.length > MAX_PATTERN_LENGTH) continue;
    if (patterns.includes(glob)) continue;
    patterns.push(glob);
    if (patterns.length === MAX_PATTERNS) break;
  }

  return patterns;
}

/**
 * Read stored settings, falling back per field.
 *
 * Every failure mode lands on a default rather than an exception: this runs in
 * the background worker on the way to opening a review, and a settings object
 * written by a later version — or corrupted, or simply absent — must not be
 * able to stop a reviewer opening a pull request.
 *
 * Per field rather than all-or-nothing, so one unrecognized value does not
 * discard a neighbouring one that was perfectly good.
 */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    // `watchedRepos` is an array, so the spread alone would hand every caller
    // the same one. The first of them to push onto what it got back would be
    // adding a watched repository to every later parse in the process.
    return { ...DEFAULT_SETTINGS, watchedRepos: [...DEFAULT_SETTINGS.watchedRepos] };
  }

  const stored = raw as Record<string, unknown>;

  // Strictly a boolean: the string 'false' is truthy, so a loose check would
  // turn a setting on for someone whose stored value was trying to turn it off.
  const flag = (key: keyof Settings & string): boolean =>
    typeof stored[key] === 'boolean'
      ? (stored[key] as boolean)
      : (DEFAULT_SETTINGS[key] as boolean);

  return {
    openIn: isOpenIn(stored.openIn) ? stored.openIn : DEFAULT_SETTINGS.openIn,
    autoOpen: flag('autoOpen'),
    openInBackground: flag('openInBackground'),
    debugLogging: flag('debugLogging'),
    ignoreWhitespace: flag('ignoreWhitespace'),
    splitView: flag('splitView'),
    hideGenerated: flag('hideGenerated'),
    // Checked rather than passed through, for the reason `diffTheme` is below:
    // an unrecognized value reaching Pierre is a diff drawn some way nobody
    // chose, with nothing on the page to say why.
    lineDiff: isLineDiff(stored.lineDiff) ? stored.lineDiff : DEFAULT_SETTINGS.lineDiff,
    collapseTree: flag('collapseTree'),
    generatedPatterns: parsePatterns(stored.generatedPatterns),
    releaseFindKey: flag('releaseFindKey'),
    // Checked against what this build can actually draw, rather than passed
    // through. A theme id from a later version, or one Shiki has since dropped,
    // would otherwise reach Pierre and produce a diff rendered without
    // highlighting at all, with nothing on the page to say why.
    diffTheme: isDiffTheme(stored.diffTheme)
      ? stored.diffTheme
      : DEFAULT_SETTINGS.diffTheme,
    // Whole days and at least one. A fraction is rejected rather than rounded:
    // it can only have arrived by a bug or by hand, and neither is a preference
    // worth honouring approximately.
    stalenessDays:
      typeof stored.stalenessDays === 'number' &&
      Number.isInteger(stored.stalenessDays) &&
      stored.stalenessDays >= 1
        ? stored.stalenessDays
        : DEFAULT_SETTINGS.stalenessDays,
    // Filtered rather than rejected wholesale. One unrecognizable entry is no
    // reason to forget the other eighteen repositories somebody chose.
    watchedRepos: Array.isArray(stored.watchedRepos)
      ? stored.watchedRepos.filter(
          (name): name is string => typeof name === 'string' && REPO_NAME.test(name),
        )
      : [...DEFAULT_SETTINGS.watchedRepos],
  };
}

/**
 * Read a stored mode memory, dropping per entry.
 *
 * Four things can make an entry unusable, and all four are ordinary rather than
 * exceptional: the value is not a string at all, the kind is one a later build
 * remembers and this one does not, the mode id has since been withdrawn, or the
 * id is real but belongs to a different kind.
 *
 * What dropping them buys is that the returned memory means one thing wherever
 * it is read. The card is not the thing being protected — `resolveModeForFile`
 * already narrows a mode a file cannot offer, and says so where it does it. The
 * hazard here is upstream of that: an entry for a kind this build deliberately
 * does not remember is a *later build's policy* arriving in storage, and
 * honouring it would make images behave the way some future version decided
 * they should while this one still argues they should not.
 *
 * Dropped one at a time, like {@link parseSettings}, so one bad entry does not
 * discard a neighbouring good one.
 */
export function parseModeMemory(raw: unknown): ModeMemory {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    // A fresh object, as {@link parseSettings} returns on the same path: the
    // `Readonly` on {@link ModeMemory} is a claim about this codebase rather
    // than a property of the object.
    return { ...EMPTY_MODE_MEMORY };
  }

  const stored = raw as Record<string, unknown>;
  const memory: Partial<Record<ComparisonKind, string>> = {};

  for (const [kind, mode] of Object.entries(stored)) {
    if (typeof mode !== 'string') continue;
    // Narrows `kind` from `string` for the rest of the loop, which is why the
    // two reads below need no cast.
    if (!isRememberedKind(kind)) continue;
    // Asked of the kind rather than of a file: this is read before any file
    // list exists, and `resolveModeForFile` narrows it again per file. That is
    // what lets a remembered `markdown:rendered` survive here and still fall
    // back on a one-sided `.md`, where the mode is not offered at all.
    const offered = modesFor(kind, 'both');
    if (!offered.some((candidate) => candidate.id === mode)) continue;
    memory[kind] = mode;
  }

  return memory;
}

/**
 * Whether auto-open can be offered for this destination.
 *
 * `same-tab` is excluded, and not as a matter of taste. Auto-opening over the
 * pull request page replaces it the instant you arrive; pressing Back returns
 * to the pull request, where the content script loads afresh and immediately
 * does it again. The reviewer is trapped with no way back short of editing the
 * URL. The options page disables the checkbox for this reason and
 * `openTarget` refuses the combination independently, because a settings
 * object written before that rule existed can still be sitting in storage.
 */
export function autoOpenAvailable(openIn: OpenIn): boolean {
  return openIn !== 'same-tab';
}
