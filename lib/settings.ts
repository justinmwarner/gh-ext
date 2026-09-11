/**
 * The reviewer's preferences, and what a stored value is allowed to mean.
 *
 * Pure by contract like the rest of `lib/` — the adapter that actually touches
 * `browser.storage` is `lib/settings-store.ts`. Keeping the validation here is
 * what lets three separate contexts (the content script, the worker and the
 * options page) agree on what a stored blob means without any of them needing a
 * browser to prove it.
 */

import { THEME_FOLLOWS_PAGE, isDiffTheme } from './compare/themes';

/** Where a review opens. */
export type OpenIn = 'new-tab' | 'new-window' | 'same-tab';

export interface Settings {
  openIn: OpenIn;
  /** Open a review by itself on landing on a pull request. */
  autoOpen: boolean;
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
 * `new-tab` rather than the `same-tab` this extension used to do unconditionally.
 *
 * Replacing the pull request page is a surprising amount to do in response to
 * one click, and it throws away the thing the reviewer may still want: the
 * conversation, the merge button, the rest of GitHub.
 */
export const DEFAULT_SETTINGS: Settings = {
  openIn: 'new-tab',
  autoOpen: false,
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
};

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
    return { ...DEFAULT_SETTINGS };
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
    debugLogging: flag('debugLogging'),
    ignoreWhitespace: flag('ignoreWhitespace'),
    splitView: flag('splitView'),
    hideGenerated: flag('hideGenerated'),
    // Checked against what this build can actually draw, rather than passed
    // through. A theme id from a later version, or one Shiki has since dropped,
    // would otherwise reach Pierre and produce a diff rendered without
    // highlighting at all, with nothing on the page to say why.
    diffTheme: isDiffTheme(stored.diffTheme)
      ? stored.diffTheme
      : DEFAULT_SETTINGS.diffTheme,
  };
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
