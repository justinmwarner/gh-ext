/**
 * Which files a filtered review shows.
 *
 * The file tree's text box narrows the rail and nothing else; this is the other
 * kind of narrowing, the one GitHub's filter menu does. A file this hides leaves
 * the tree, the diff column and `j`/`k` together, and the bar above the diff
 * says how many are left. So the rules here decide what a reviewer reads, not
 * merely where they look, and each of them is written down rather than left to
 * whatever a surface happened to do.
 *
 * Seven filters, in two kinds:
 *
 * - **What sort of file it is.** Its change kind, its type, whether a tool wrote
 *   it, whether it was only moved, whether the reviewer owns it. None of these
 *   moves while the review is open.
 * - **Where the review has got to.** Viewed, and still being discussed. These
 *   move every time the reviewer ticks a box or resolves a thread — which is why
 *   the page keeps the file it is on in view regardless (see `ui/Shell.tsx`),
 *   and why nothing in this module has to know that.
 *
 * The facts that need the page — the session's viewed state, its threads, the
 * repository's `.gitattributes`, its CODEOWNERS — arrive as {@link FileFacts}.
 * What can be read off a changed file alone is decided here.
 *
 * Pure by contract: no DOM, no `chrome.*`, no transport.
 */

import type { PatchStatus } from '../github/types';

/**
 * The tree's four words for what happened to a file.
 *
 * Four rather than GitHub's six, because the filter has to agree with the
 * letter drawn on the row. A reviewer who unticks "Added" and still sees a row
 * marked A has been told the filter is broken.
 */
export type ChangeKind = 'added' | 'modified' | 'renamed' | 'deleted';

/** The order the menu lists them in, which is the order a change happens in. */
const KIND_ORDER: readonly ChangeKind[] = ['added', 'modified', 'renamed', 'deleted'];

/**
 * A copy is a new file at its destination, so it reads as `added`; `CHANGED` is
 * GitHub's word for a content change it declined to classify further, which is
 * `modified`. Everything else maps across by name.
 */
const KINDS: Record<PatchStatus, ChangeKind> = {
  ADDED: 'added',
  DELETED: 'deleted',
  RENAMED: 'renamed',
  COPIED: 'added',
  MODIFIED: 'modified',
  CHANGED: 'modified',
};

export function changeKind(status: PatchStatus): ChangeKind {
  return KINDS[status];
}

/**
 * The two types that are not an extension.
 *
 * Spelled without a leading dot, which every extension has, so neither can
 * collide with a real one — a file called `x.none` is `.none`, not "none".
 */
export const DOTFILE = 'dotfile';
export const NO_EXTENSION = 'none';

/**
 * A file's type, as the menu lists it: its last extension, lowercased.
 *
 * The *last* one, so `app.test.ts` is TypeScript and `archive.tar.gz` is a
 * gzip. That is what the file is to the tools that read it. The word before
 * the extension is {@link compoundType}, which the menu lists underneath this
 * one, and only where it picks out a real group of files.
 *
 * Lowercased, so `Logo.PNG` and `icon.png` are one row. A pull request that
 * mixes the two is one that somebody's camera and somebody's editor disagreed
 * about, not one with two kinds of image in it.
 *
 * A name whose only dot is its first — `.gitignore`, `.env` — is a
 * {@link DOTFILE}, which is GitHub's word for the same group. A name with a
 * dot after its first character has an extension even if it also starts with
 * one: `.eslintrc.json` is JSON.
 */
export function fileType(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');

  if (dot === 0) return DOTFILE;
  // No dot, or a trailing one: `notes.` has no extension, and calling it
  // "." would be a row in the menu with nothing to read in it.
  if (dot === -1 || dot === name.length - 1) return NO_EXTENSION;
  return name.slice(dot).toLowerCase();
}

/**
 * A file's longer type: the word before its extension, and the extension.
 *
 * `Button.spec.tsx` is a `.spec.tsx` file as well as a `.tsx` one, and that is
 * the difference a reviewer means when they ask for the specs after the code,
 * or for no snapshots at all. A `.ts` row alone cannot say it.
 *
 * Only a word counts: letters, nothing else. So `jquery-3.6.0.min.js` is
 * `.min.js`, but `v1.2.3.txt` has a version number there and is just `.txt`.
 * There has to be a name before the word as well, so a dotfile such as
 * `.eslintrc.json` has no longer type: `eslintrc` is its name. Null whenever
 * there is no such word. Lowercased, like {@link fileType}.
 */
export function compoundType(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const parts = (name.startsWith('.') ? name.slice(1) : name).split('.');
  if (parts.length < 3) return null;
  const extension = parts.at(-1) ?? '';
  const word = parts.at(-2) ?? '';
  if (extension === '' || !/^[a-z]+$/i.test(word)) return null;
  return `.${word}.${extension}`.toLowerCase();
}

/**
 * A type as words for the screen. The two types that are not an extension
 * get names; an extension, longer or not, is its own name.
 */
export function typeLabel(type: string): string {
  return type === DOTFILE ? 'Dotfiles' : type === NO_EXTENSION ? 'No extension' : type;
}

/**
 * The extension a longer type sits under, or null for a type that is not a
 * longer one. `.spec.tsx` sits under `.tsx`.
 */
export function parentType(type: string): string | null {
  const last = type.lastIndexOf('.');
  return last <= 0 ? null : type.slice(last);
}

/**
 * Whether a file is of a type, by its extension or by its longer type.
 *
 * The one test every type row means: `.tsx` takes in every `.tsx` file,
 * specs included, and `.spec.tsx` only the specs.
 */
export function typeMatches(path: string, type: string): boolean {
  return fileType(path) === type || compoundType(path) === type;
}

/** A changed file, as far as these rules read it. `ReviewFile` satisfies it. */
export interface FilterableFile {
  path: string;
  changeType: PatchStatus;
  additions: number;
  deletions: number;
  isBinary: boolean;
}

/**
 * Renamed, and nothing else.
 *
 * No line added and no line removed — but that alone is not enough, because a
 * binary file has no lines to count either way. One that was renamed *and*
 * changed reports +0 −0 like a pure move, and its patch carries a `Binary
 * files … differ` line that a pure move does not; `isBinary` is that line.
 *
 * The files-endpoint fallback cannot draw the distinction — it carries no
 * binary marker — so there a changed binary rename counts as moved. It is the
 * one place the rule guesses, on a path only an oversized pull request takes.
 */
export function isMoved(file: FilterableFile): boolean {
  return (
    file.changeType === 'RENAMED' &&
    file.additions === 0 &&
    file.deletions === 0 &&
    !file.isBinary
  );
}

/**
 * What the reviewer asked the review to leave out.
 *
 * Kinds and types are held as what was *unticked*, not what is shown, and that
 * is what lets a choice survive a change of scope. Hiding lockfiles on the whole
 * pull request and then opening one commit that touches none leaves `.lock` in
 * this set, matching nothing; going back to the whole pull request hides them
 * again, which is what the reviewer said. A set of shown types would have had
 * to invent an answer for every type the commit did not have.
 *
 * Never stored. Every review opens with {@link NO_FILTERS}: a filter is an
 * answer to *this* pull request, and one that arrived already on would be a
 * review quietly missing files it never said it was missing.
 */
export interface FileFilters {
  hiddenKinds: ReadonlySet<ChangeKind>;
  /** By {@link fileType}. */
  hiddenTypes: ReadonlySet<string>;
  hideViewed: boolean;
  hideGenerated: boolean;
  hideMoved: boolean;
  onlyUnresolved: boolean;
  onlyOwned: boolean;
}

/**
 * Nothing left out, as one shared object.
 *
 * Frozen at the top level, and the sets are typed read-only, which is what stops
 * a caller adding to them. Changing a filter builds new sets, which is also what
 * tells React something moved.
 */
export const NO_FILTERS: FileFilters = Object.freeze({
  hiddenKinds: new Set<ChangeKind>(),
  hiddenTypes: new Set<string>(),
  hideViewed: false,
  hideGenerated: false,
  hideMoved: false,
  onlyUnresolved: false,
  onlyOwned: false,
});

/**
 * The answers that need the page rather than the file.
 *
 * Functions rather than maps, so a caller answers from whatever it already holds
 * — the session's optimistic viewed state, a thread tally, a `.gitattributes`
 * rule list — without building a copy of it per file list.
 */
export interface FileFacts {
  /** VIEWED, and nothing else. A file changed since it was viewed needs another look. */
  isViewed(path: string): boolean;
  hasUnresolved(path: string): boolean;
  isGenerated(path: string): boolean;
  /**
   * Null while nobody knows yet — CODEOWNERS unread, or not asked for — and the
   * ownership filter then hides nothing. Narrowing to nothing while a request
   * was in flight would say "you own none of this" for as long as it took.
   */
  isOwned: ((path: string) => boolean) | null;
}

/** Whether a file survives every filter at once. */
export function passes(file: FilterableFile, filters: FileFilters, facts: FileFacts): boolean {
  if (filters.hiddenKinds.has(changeKind(file.changeType))) return false;
  if (filters.hiddenTypes.has(fileType(file.path))) return false;
  const longer = compoundType(file.path);
  if (longer !== null && filters.hiddenTypes.has(longer)) return false;
  if (filters.hideMoved && isMoved(file)) return false;
  if (filters.hideViewed && facts.isViewed(file.path)) return false;
  if (filters.hideGenerated && facts.isGenerated(file.path)) return false;
  if (filters.onlyUnresolved && !facts.hasUnresolved(file.path)) return false;
  if (filters.onlyOwned && facts.isOwned !== null && !facts.isOwned(file.path)) return false;
  return true;
}

/**
 * Every path the filters take out of the review.
 *
 * `keep` is what the page will not let go of whatever the filters say: the
 * file the reviewer is on, which does not disappear under them because they
 * ticked it or resolved its last thread, and any file with a comment still
 * posting, whose failure would otherwise be announced on a card nobody can
 * see. Which files those are is the page's knowledge, so it is handed in
 * rather than worked out here.
 */
export function hiddenPaths(
  files: readonly FilterableFile[],
  filters: FileFilters,
  facts: FileFacts,
  keep: ReadonlySet<string>,
): Set<string> {
  const hidden = new Set<string>();
  for (const file of files) {
    if (!keep.has(file.path) && !passes(file, filters, facts)) hidden.add(file.path);
  }
  return hidden;
}

/**
 * Where the review goes when a filter hides the file it is on.
 *
 * The next file still showing, and failing that the one before: a reviewer who
 * hid the file they were reading has asked to move on rather than back, and the
 * end of the list is not a reason to leave them nowhere. Null only when the
 * filters hide everything, which is its own state on screen.
 *
 * `files` in reading order, which is the order `ReviewFile` lists arrive in.
 */
export function nearestShown(
  files: readonly FilterableFile[],
  from: string,
  filters: FileFilters,
  facts: FileFacts,
  keep: ReadonlySet<string>,
): string | null {
  const at = files.findIndex((file) => file.path === from);
  const shows = (file: FilterableFile | undefined): file is FilterableFile =>
    file !== undefined && (keep.has(file.path) || passes(file, filters, facts));

  for (let next = at + 1; next < files.length; next += 1) {
    const file = files[next];
    if (shows(file)) return file.path;
  }
  for (let next = at - 1; next >= 0; next -= 1) {
    const file = files[next];
    if (shows(file)) return file.path;
  }
  return null;
}

/** How many files of each kind and type there are, for the menu to list. */
export interface FileFacets {
  /** In {@link KIND_ORDER}, and only the kinds present. */
  kinds: ReadonlyMap<ChangeKind, number>;
  /**
   * Alphabetical, with {@link DOTFILE} and {@link NO_EXTENSION} after every
   * extension — they are the two rows that are not a type, and in among the
   * extensions they would read as a pair of odd suffixes.
   *
   * Each extension is followed by the longer types under it, alphabetically,
   * and its count takes them in: `.tsx` counts the specs too. See
   * {@link fileFacets} for which longer types make the list.
   */
  types: ReadonlyMap<string, number>;
}

/** Sentinels after every extension, and the extensions counting as a person does. */
const typeOrder = (a: string, b: string): number => {
  const rank = (type: string): number =>
    type === DOTFILE ? 1 : type === NO_EXTENSION ? 2 : 0;
  return rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true });
};

/**
 * Counted over the whole list rather than what the other filters left.
 *
 * A count that shrank as other boxes were unticked would make every row in the
 * menu move while the reviewer was reading it, and would answer a question
 * nobody asked. "This pull request has twelve deleted files" is the fact that
 * decides whether to hide them.
 *
 * A longer type is listed when it picks out a real group: at least two files
 * share it, and not every file of its extension does, since then its row would
 * say the same thing as the extension's. That keeps a one-off `my.notes.md`
 * from becoming a row of its own. `chosen` names the types the reviewer has
 * already set, unticked or sent to the end. Those stay listed for as long as
 * any file here has them. Otherwise a choice made on the whole pull request
 * could act on a single file in one commit with no row to see it on or undo
 * it from.
 */
export function fileFacets(
  files: readonly FilterableFile[],
  chosen: Iterable<string> = [],
): FileFacets {
  const kinds = new Map<ChangeKind, number>();
  const types = new Map<string, number>();
  const longer = new Map<string, number>();

  for (const file of files) {
    const kind = changeKind(file.changeType);
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    const type = fileType(file.path);
    types.set(type, (types.get(type) ?? 0) + 1);
    const compound = compoundType(file.path);
    if (compound !== null) longer.set(compound, (longer.get(compound) ?? 0) + 1);
  }

  const kept = new Set(chosen);
  const under = new Map<string, string[]>();
  for (const [compound, count] of longer) {
    const parent = parentType(compound);
    if (parent === null) continue;
    const real = count >= 2 && count < (types.get(parent) ?? 0);
    if (!real && !kept.has(compound)) continue;
    under.set(parent, [...(under.get(parent) ?? []), compound]);
  }

  const listed: [string, number][] = [];
  for (const [type, count] of [...types].sort(([a], [b]) => typeOrder(a, b))) {
    listed.push([type, count]);
    const children = (under.get(type) ?? []).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    for (const child of children) listed.push([child, longer.get(child) ?? 0]);
  }

  return {
    kinds: new Map(
      KIND_ORDER.flatMap((kind): [ChangeKind, number][] => {
        const count = kinds.get(kind);
        return count === undefined ? [] : [[kind, count]];
      }),
    ),
    types: new Map(listed),
  };
}

/**
 * Whether any filter is narrowing this list.
 *
 * A toggle counts whenever it is on, even where it matches nothing: the funnel
 * is showing what the reviewer asked for, and they asked. An unticked kind or
 * type counts only if this list has one — see {@link FileFilters} for why such
 * a choice is kept — because the menu lists no row for it, and a pressed
 * funnel over a menu with every box ticked is pointing at nothing anybody can
 * find.
 */
export function isFiltering(filters: FileFilters, facets: FileFacets): boolean {
  if (
    filters.hideViewed ||
    filters.hideGenerated ||
    filters.hideMoved ||
    filters.onlyUnresolved ||
    filters.onlyOwned
  ) {
    return true;
  }
  for (const kind of filters.hiddenKinds) if (facets.kinds.has(kind)) return true;
  for (const type of filters.hiddenTypes) if (facets.types.has(type)) return true;
  return false;
}
