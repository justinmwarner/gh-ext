/**
 * Who owns which files, as the repository's CODEOWNERS file says.
 *
 * What "Show only files you own" asks. GitHub decides ownership server-side and
 * says nothing about it per file over any API — `PullRequestChangedFile` carries
 * no owner, and a review request's `asCodeOwner` says the viewer was asked, not
 * for which files — so the answer has to be reached here, from the file itself
 * and from who the reviewer is.
 *
 * The format is gitignore-shaped and is not gitignore, and the differences are
 * the ones GitHub documents: no `!` negation, no `[ ]` ranges, no escaping a
 * leading `#`, matching that is case-sensitive, and — the one that decides real
 * matches — a pattern ending in a wildcard does not reach into directories.
 * `docs/*` owns `docs/getting-started.md` and not `docs/build-app/x.md`, where
 * `**\/logs` owns everything beneath every `logs`. {@link codeownerGlobs} is
 * where that is decided; `lib/review/codeowners.test.ts` holds it to GitHub's
 * own examples.
 *
 * Owners are compared without case, because GitHub reads logins and team slugs
 * that way. An email owner is kept and never matched: nothing this extension
 * can see says which addresses are the reviewer's.
 *
 * Pure by contract: no DOM, no `chrome.*`, no transport. Reading the file and
 * asking GitHub who the reviewer is are `ui/useCodeOwners.ts` and the worker.
 */

import { isNoise } from './filters';

/**
 * Where GitHub looks, in the order it looks, using the first it finds.
 *
 * Only these three. A CODEOWNERS file anywhere else in the tree is ignored by
 * GitHub, so reading one would be inventing owners the repository does not
 * have.
 */
export const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'] as const;

/** One line of the file: what it matches, and who it says owns that. */
export interface OwnerRule {
  /** The pattern, translated to the glob dialect `isNoise` understands. */
  globs: readonly string[];
  /**
   * Owners as written, lowercased: `@login`, `@org/team`, or an address.
   *
   * Empty means the line names nobody, which is not a mistake in the file: a
   * later line with no owners takes the paths it matches away from whoever an
   * earlier one gave them to.
   */
  owners: readonly string[];
}

/**
 * A CODEOWNERS pattern, as one or more globs.
 *
 * - A leading slash anchors to the repository root. So does a slash anywhere
 *   but the end, as in gitignore: `docs/*` means the root's `docs`.
 * - A pattern with no slash in it, or with only a trailing one, matches at
 *   any depth: `*.js` and `apps/` are both about every such file or directory.
 * - A trailing slash names a directory, which means everything beneath it.
 * - A last segment with no wildcard could be a file or a directory, and the
 *   pattern cannot say which, so both readings are emitted — which is what
 *   makes `**\/logs` own the whole of every `logs`.
 * - A last segment *with* a wildcard is not followed into directories. That is
 *   GitHub's `docs/*` rule, and it is where this differs from gitignore.
 */
export function codeownerGlobs(pattern: string): string[] {
  let glob = pattern;

  const anchored = glob.startsWith('/');
  if (anchored) glob = glob.slice(1);

  const directory = glob.endsWith('/');
  if (directory) glob = glob.slice(0, -1);
  if (glob === '') return [];

  // Asked after the ends are trimmed: a slash left in the middle is gitignore's
  // signal that the path is being spelled from the root.
  if (!anchored && !glob.includes('/')) glob = `**/${glob}`;

  if (directory) return [`${glob}/**`];

  const last = glob.slice(glob.lastIndexOf('/') + 1);
  const names = !last.includes('*') && !last.includes('?');
  return names ? [glob, `${glob}/**`] : [glob];
}

/**
 * A line's words, split on whitespace that is not escaped.
 *
 * `\ ` is gitignore's way to put a space in a pattern, and a path with a space
 * in it has no other way to be written on a line whose words are separated by
 * spaces. GitHub's own page on the format does not mention it either way; read
 * like this, `/docs/My\ Guide/` is one directory, where split on every space it
 * would be the pattern `/docs/My\` owned by `Guide/` and whoever followed.
 */
function wordsOf(line: string): string[] {
  const words: string[] = [];
  let word = '';
  for (let at = 0; at < line.length; at += 1) {
    const character = line[at] ?? '';
    if (character === '\\' && line[at + 1] === ' ') {
      word += ' ';
      at += 1;
    } else if (character === ' ' || character === '\t') {
      if (word !== '') words.push(word);
      word = '';
    } else {
      word += character;
    }
  }
  if (word !== '') words.push(word);
  return words;
}

/**
 * The lines of a CODEOWNERS file that say something, in file order.
 *
 * Order is kept because the **last** matching line wins, and a file that sets
 * default owners with `*` and then hands directories to their teams depends on
 * that.
 *
 * A line is a pattern and then owners, separated by whitespace, and a `#`
 * starts a comment wherever it begins a word — GitHub's own example puts one
 * after the owners. Lines GitHub would reject are skipped rather than guessed
 * at: a negated pattern means nothing in this format.
 */
export function parseCodeowners(text: string): OwnerRule[] {
  const rules: OwnerRule[] = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;

    const words = wordsOf(line);
    const pattern = words[0];
    if (pattern === undefined || pattern.startsWith('!')) continue;

    const owners: string[] = [];
    for (const word of words.slice(1)) {
      if (word.startsWith('#')) break;
      owners.push(word.toLowerCase());
    }

    const globs = codeownerGlobs(pattern);
    if (globs.length > 0) rules.push({ globs, owners });
  }

  return rules;
}

/**
 * Who owns a path: the owners on the last line that matches it.
 *
 * Null when no line matches, which is a different answer from `[]` — a line
 * that matched and named nobody. Both mean nobody owns it; only the second
 * means the repository said so.
 */
export function ownersOf(path: string, rules: readonly OwnerRule[]): readonly string[] | null {
  // Backwards, because the last matching line wins and this finds it first.
  for (let at = rules.length - 1; at >= 0; at -= 1) {
    const rule = rules[at];
    if (rule !== undefined && isNoise(path, rule.globs)) return rule.owners;
  }
  return null;
}

/** Who the reviewer is, as far as CODEOWNERS can name them. */
export interface OwnerIdentity {
  /** Their login, without the `@`. */
  login: string;
  /** Their teams, as CODEOWNERS spells them: `@org/team`, lowercased. */
  teams: readonly string[];
}

/** Whether the reviewer is among a path's owners, by login or by team. */
export function isOwnedBy(
  path: string,
  rules: readonly OwnerRule[],
  identity: OwnerIdentity,
): boolean {
  const owners = ownersOf(path, rules);
  if (owners === null || owners.length === 0) return false;
  const login = `@${identity.login.toLowerCase()}`;
  return owners.some((owner) => owner === login || identity.teams.includes(owner));
}
