/**
 * The file filters, applied to the review that is on screen.
 *
 * `lib/review/fileFilters.ts` says what each filter means. This is the part
 * that needs the page: the session's viewed state and threads for the two
 * filters that move while the review is open, the repository's rules for the
 * two that ask the repository, and where the reviewer is — because what makes
 * filtering safe mid-review is a rule about what may leave the screen, and when.
 *
 * **A file leaves when the reviewer moves on, not while they act on it.** The
 * file being read is never hidden. Nor is one whose state the reviewer has just
 * changed — ticked viewed, from its card or from the tree, or resolved the last
 * thread of — until they next move to a different file: a tick that pulled the
 * card out from under the pointer would slide the next one into its place, and
 * an accidental tick has to stay on screen to be undone. Nor, ever, is a file
 * with writing on it that GitHub does not have yet: a comment still posting,
 * whose failure is announced on its card, or an open composer.
 *
 * **A change moves the reviewer only if the change is what hides their file.**
 * Unticking the type of the file being read takes the review on to the next
 * file still showing. Unticking some other type does not evict a file that was
 * already staying for the reason above. Rules the repository answers —
 * `.gitattributes`, CODEOWNERS — can arrive a beat after the press, and their
 * arrival is held to the same test: it moves the reviewer if it is what hides
 * the file, and not otherwise.
 *
 * **The menu is one change, from open to shut.** It stays open so several boxes
 * can be set in one visit, and a reviewer who unticks the wrong row and ticks
 * it back has changed nothing about where they are. So while it is open the
 * file being read stays put, whatever the boxes say, and the test above is
 * applied once, when it shuts, to the filters it opened with and the ones it
 * closed on. Everything else on the page follows each press as it happens.
 *
 * The filter state itself is held by the shell rather than here, because the
 * shell has to read one of the filters before this can run: whether the
 * repository's `.gitattributes` is wanted at all is decided by it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type FileFacets,
  type FileFacts,
  type FileFilters,
  fileFacets,
  hiddenPaths,
  isFiltering,
  nearestShown,
  passes,
} from '@/lib/review/fileFilters';
import { type GeneratedRule, isGenerated } from '@/lib/review/generated';
import type { CurrentFile } from './currentFile';
import { type FileComments, fileComments } from './fileTreeData';
import type { ReviewFile } from './reviewFiles';
import { useReviewSession } from './reviewSession';

export interface UseFileFilterArgs {
  /** The whole list on screen, in reading order — a narrowed comparison's, when one is showing. */
  files: readonly ReviewFile[];
  filters: FileFilters;
  setFilters: (next: FileFilters) => void;
  current: CurrentFile;
  /** Put the review on another file, or on none when nothing is left showing. */
  moveTo: (path: string | null) => void;
  gitAttributes: readonly GeneratedRule[];
  /** The reviewer's own globs, which count here because asking for this filter is asking. */
  generatedPatterns: readonly string[];
  /** Whether the reviewer owns a path, or null while nobody knows. */
  owned: ((path: string) => boolean) | null;
  /** The file a composer is open on, if one is. Kept, for the reason a posting comment is. */
  composing?: string | null;
  /**
   * File types the reviewer has chosen outside the filters, the ones read
   * last. Listed in the menu for as long as any file has them, like a type
   * the filters hide; see `fileFacets`.
   */
  chosenTypes?: readonly string[];
}

const NO_TYPES: readonly string[] = [];

export interface FileFilterResult {
  facets: FileFacets;
  /** Anything is being narrowed. What draws the funnel pressed and the sentences. */
  filtering: boolean;
  /** Paths out of the review. The same identity for as long as its members are. */
  hidden: ReadonlySet<string>;
  /** `files` less `hidden`, in the same order. `files` itself when nothing is hidden. */
  shown: readonly ReviewFile[];
  /** Change the filters. Moves the review off its file if this is what hides it. */
  change: (next: FileFilters) => void;
  /** The filter menu opened (`true`) or shut. The menu is one change — see above. */
  menuOpen: (open: boolean) => void;
}

const NOTHING: ReadonlySet<string> = new Set();

const sameMembers = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((path) => b.has(path));

/** What was last seen of the three things "touched" is measured against. */
interface Seen {
  at: string | null;
  viewed: ReadonlyMap<string, string>;
  talk: ReadonlyMap<string, FileComments>;
}

export function useFileFilter({
  files,
  filters,
  setFilters,
  current,
  moveTo,
  gitAttributes,
  generatedPatterns,
  owned,
  composing = null,
  chosenTypes = NO_TYPES,
}: UseFileFilterArgs): FileFilterResult {
  const session = useReviewSession();

  /** The session's answer where it has one, and the payload's everywhere else. */
  const viewedNow = useMemo(
    () => new Map(files.map((file) => [file.path, session.viewed.get(file.path) ?? file.viewedState])),
    [files, session.viewed],
  );
  const talk = useMemo(() => fileComments(session.threads), [session.threads]);

  const facts = useMemo(
    (): FileFacts => ({
      isViewed: (path) => viewedNow.get(path) === 'VIEWED',
      hasUnresolved: (path) => (talk.get(path)?.unresolved ?? 0) > 0,
      isGenerated: (path) => isGenerated(path, gitAttributes, generatedPatterns),
      isOwned: owned,
    }),
    [viewedNow, talk, gitAttributes, generatedPatterns, owned],
  );

  // The types already chosen stay listed while any file has them, so a choice
  // made on the whole pull request is never left acting on a commit's single
  // spec file with no row to undo it from.
  const facets = useMemo(
    () =>
      fileFacets(files, [...filters.hiddenTypes, ...(filters.onlyTypes ?? []), ...chosenTypes]),
    [files, filters.hiddenTypes, filters.onlyTypes, chosenTypes],
  );
  const filtering = isFiltering(filters, facets);

  /**
   * Files whose state the reviewer changed since they last moved.
   *
   * Worked out by watching the state rather than by instrumenting the places
   * that change it: a tick can come from a card, a tree row, a folder, `v` or a
   * rollback, a resolve from a thread card or `e`, and every one of them lands
   * in the session's viewed map or its threads. A path whose viewed state or
   * unresolved count moved is touched; moving to another file clears the lot.
   *
   * Moving means a move the reviewer made — the tree, `j`/`k`, a jump, a
   * result — and not the column reporting a scroll. Ticking the file being read
   * folds it, and a fold made halfway down a file leaves its header above the
   * viewport and the next file at the top; the column says so, and if that
   * counted, the ticked file would be gone before anyone could see what the
   * press had done. A scroll the reviewer makes by hand keeps them too, until
   * their next deliberate move: a stack of folded headers is what a column of
   * viewed files has always looked like.
   *
   * Derived during render with its previous inputs held in state, which is the
   * pattern React documents for it — an effect would paint a frame of the card
   * already gone before putting it back.
   */
  const [touched, setTouched] = useState<ReadonlySet<string>>(NOTHING);
  const [seen, setSeen] = useState<Seen>(() => ({
    at: current.path,
    viewed: viewedNow,
    talk,
  }));
  if (seen.at !== current.path || seen.viewed !== viewedNow || seen.talk !== talk) {
    const moved = seen.at !== current.path && current.origin !== 'scroll';
    const next = new Set(moved ? NOTHING : touched);
    if (seen.viewed !== viewedNow) {
      for (const [path, state] of viewedNow) {
        const before = seen.viewed.get(path);
        // A path the last list did not have is a new list, not an action.
        if (before !== undefined && before !== state) next.add(path);
      }
    }
    if (seen.talk !== talk) {
      for (const path of new Set([...seen.talk.keys(), ...talk.keys()])) {
        const before = seen.talk.get(path)?.unresolved ?? 0;
        if (before !== (talk.get(path)?.unresolved ?? 0)) next.add(path);
      }
    }
    setSeen({ at: current.path, viewed: viewedNow, talk });
    if (!sameMembers(next, touched)) setTouched(next.size === 0 ? NOTHING : next);
  }

  /** Files with writing on them that GitHub does not have yet. Never hidden. */
  const writing = useMemo(() => {
    const kept = new Set(session.posting.map((entry) => entry.path));
    if (composing !== null) kept.add(composing);
    return kept;
  }, [session.posting, composing]);

  /** Everything that stays whatever the filters say. */
  const keep = useMemo(() => {
    const kept = new Set(writing);
    for (const path of touched) kept.add(path);
    if (current.path !== null) kept.add(current.path);
    return kept;
  }, [writing, touched, current.path]);

  /**
   * Held at one identity while its members do not move.
   *
   * The facts are rebuilt on every tick and every resolve, and most of those
   * change nothing about which files are out. A new set each time would be a
   * new item list for the viewer and a new stop list for `J` to say that
   * nothing happened. The stable copy lives in state beside the value it was
   * taken from, and is replaced during render only when the members differ.
   */
  const computed = useMemo(
    () => (filtering ? hiddenPaths(files, filters, facts, keep) : NOTHING),
    [filtering, files, filters, facts, keep],
  );
  const [stable, setStable] = useState<ReadonlySet<string>>(NOTHING);
  let hidden = stable;
  if (stable !== computed && !sameMembers(stable, computed)) {
    hidden = computed.size === 0 ? NOTHING : computed;
    setStable(hidden);
  }

  const shown = useMemo(
    () => (hidden.size === 0 ? files : files.filter((file) => !hidden.has(file.path))),
    [files, hidden],
  );

  /** The filters the open menu started from; null while it is shut. */
  const held = useRef<FileFilters | null>(null);

  // Read by the callbacks below, which are handed to a menu and must not be
  // rebuilt on every tick.
  const latest = useRef({ files, facts, current, filters, touched, writing, generatedPatterns });
  latest.current = { files, facts, current, filters, touched, writing, generatedPatterns };

  /**
   * Move the review off its file if — and only if — this change is what hides it.
   *
   * "Before" and "after" are each a set of filters and a set of facts, because
   * both can be what changed: a press changes the filters, and a late answer
   * from the repository changes the facts. A file that already failed before
   * the change was staying for some other reason, and this change is not what
   * decided that.
   */
  const moveOffIfHidden = useCallback(
    (before: FileFilters, after: FileFilters, then: FileFacts, now: FileFacts) => {
      const { files: all, current: at, writing: unsent } = latest.current;
      if (at.path === null) return;
      const on = all.find((file) => file.path === at.path);
      if (on === undefined || unsent.has(on.path)) return;
      if (!passes(on, before, then) || passes(on, after, now)) return;
      // Somewhere to go counts files with unsent writing as showing, because
      // they are, and does not count ones kept only for having been touched:
      // those leave the moment the reviewer moves, which this is.
      moveTo(nearestShown(all, on.path, after, now, unsent));
    },
    [moveTo],
  );

  /**
   * Stop keeping, for having been touched, whatever this change newly hides.
   *
   * A filter change applies at once to every file. The files kept for having
   * been touched were kept so that the reviewer's own action on them would not
   * pull them away; a filter that now hides them is a different action, and
   * turning on "Hide viewed files" is meant to hide the file ticked a moment
   * ago too.
   */
  const release = useCallback(
    (before: FileFilters, after: FileFilters, then: FileFacts, now: FileFacts) => {
      const { files: all, touched: kept } = latest.current;
      if (kept.size === 0) return;
      const byPath = new Map(all.map((file) => [file.path, file]));
      const gone = [...kept].filter((path) => {
        const file = byPath.get(path);
        return file !== undefined && passes(file, before, then) && !passes(file, after, now);
      });
      if (gone.length === 0) return;
      setTouched((previous) => {
        const next = new Set(previous);
        for (const path of gone) next.delete(path);
        return next.size === 0 ? NOTHING : next;
      });
    },
    [],
  );

  const change = useCallback(
    (next: FileFilters) => {
      const { filters: before, facts: now } = latest.current;
      release(before, next, now, now);
      setFilters(next);
      if (held.current === null) moveOffIfHidden(before, next, now, now);
    },
    [setFilters, release, moveOffIfHidden],
  );

  const menuOpen = useCallback(
    (open: boolean) => {
      if (open) {
        held.current ??= latest.current.filters;
        return;
      }
      const before = held.current;
      held.current = null;
      if (before === null) return;
      const { filters: after, facts: now } = latest.current;
      moveOffIfHidden(before, after, now, now);
    },
    [moveOffIfHidden],
  );

  /**
   * The repository's answer arriving after the press.
   *
   * Measured against the answer it replaces, so that only an arrival which is
   * what hides the file being read moves the reviewer — not a viewed tick, not
   * a resolve, and not a re-read of the same rules because a setting elsewhere
   * turned the fetch off and on again.
   */
  const arrived = useRef({ gitAttributes, owned });
  useEffect(() => {
    const was = arrived.current;
    arrived.current = { gitAttributes, owned };
    if (was.gitAttributes === gitAttributes && was.owned === owned) return;

    const { filters: now, facts, generatedPatterns: patterns } = latest.current;
    const then: FileFacts = {
      ...facts,
      isGenerated: (path) => isGenerated(path, was.gitAttributes, patterns),
      isOwned: was.owned,
    };
    release(now, now, then, facts);
    if (held.current === null) moveOffIfHidden(now, now, then, facts);
  }, [gitAttributes, owned, release, moveOffIfHidden]);

  return { facets, filtering, hidden, shown, change, menuOpen };
}
