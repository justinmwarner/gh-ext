/**
 * The main column: stacked per-file diff cards, in one scroll region.
 *
 * Built on `CodeView` rather than a `FileDiff` per file, because `CodeView`
 * virtualizes the whole stack itself against a single scrollport. A five-
 * hundred-file pull request is the case this has to survive, and mounting five
 * hundred shadow roots is not a way to survive it.
 *
 * Four settings are load-bearing and none of them is a preference:
 *
 * - `disableWorkerPool` — §16.4. Grammars resolve on the main thread anyway,
 *   Vite hands dev workers a `http://localhost` URL that is cross-origin from a
 *   `chrome-extension://` page, and Chrome 148+ crashes the render process
 *   rather than throwing.
 * - **`preferredHighlighter` is never set.** The default is `shiki-js`, which
 *   touches no WebAssembly. WXT emits no CSP key in production builds, so the
 *   `shiki-wasm` path works in dev and dies silently in a shipped extension.
 * - **`disableLineNumbers` is never set.** Line selection is only reachable
 *   through the line-number gutter; without numbers, commenting is unreachable.
 * - `enableGutterUtility` — the familiar "+" affordance. Without it there is a
 *   gutter but nothing to press.
 *
 * This file also owns the obligation `partitionThreads` cannot discharge: it
 * has the parsed patch, so it is the only layer that knows which lines will
 * actually be drawn. Pierre drops an annotation outside a rendered hunk in
 * silence, so every anchor is cross-checked against the real hunk ranges and
 * anything outside them is demoted into the per-file section on the card.
 *
 * `sides` is the second such obligation and the sharper one. The column can be
 * showing a diff between two commits of the pull request rather than the pull
 * request's own, and a thread's line — or a line the reviewer just selected —
 * is numbered against the latter. Where the two disagree, the thread is listed
 * and the composer refuses, because in that case Pierre would draw the
 * annotation rather than drop it, on whatever text happened to be there.
 */

import {
  type CSSProperties,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CodeView } from '@pierre/diffs/react';
import type { CodeViewHandle, CodeViewReactOptions } from '@pierre/diffs/react';
import type {
  CodeViewItem,
  DiffLineAnnotation,
  FileDiffMetadata,
  LineAnnotation,
  SelectedLineRange,
} from '@pierre/diffs';
import { RAW, comparisonKind, isRememberedKind, resolveModeForFile } from '@/lib/compare/modes';
import type { FileViewedState } from '@/lib/github/types';
import type { DiffPayload } from '@/lib/messages';
import type { AnchorableSides } from '@/lib/review/diffScope';
import type { AnnotationSide } from '@/lib/review/threads';
import { tailDeficit } from '@/lib/review/columnTail';
import { type WhitespaceDiff, withoutWhitespaceChanges } from '@/lib/review/whitespace';
import {
  type GeneratedRule,
  NO_ATTRIBUTES,
  isGenerated,
} from '@/lib/review/generated';
import { type PostingComment, postsOnPath } from '@/lib/review/posting';
import { Composer } from './Composer';
import { FileBody, hasBodyContent } from './FileBody';
import { FileCard } from './FileCard';
import { PostingCard } from './PostingCard';
import { ThreadCard } from './ThreadCard';
import { type ComposerTarget, composerFor } from './composerAnchor';
import { type CardTop, type CurrentFile, shouldScrollDiff, topmostFile } from './currentFile';
import { type BlobRefs, createDiffFilesLoader } from './blobLoader';
import {
  codeViewItems,
  diffGeneration,
  fileBody,
  fileDiffFor,
  fileDiffSignature,
  hunkStops,
  showsTextDiff,
} from './diffItems';
import type { ReviewFile } from './reviewFiles';
import { useReviewSession } from './reviewSession';
import {
  type AnnotationMetadata,
  type ComposerMetadata,
  type FileThreadLayout,
  type ListedThread,
  type PostingMetadata,
  type RenderedLines,
  type ThreadMetadata,
  isRenderedLine,
  layoutThreads,
  renderedLines,
  sourceLines,
} from './reviewThreads';
import { useModeMemory } from './useModeMemory';

/**
 * Reading one file without its whitespace, on demand and never by default.
 *
 * The same shape as expanding context: an affordance on the file the reviewer
 * is actually looking at, not a policy over the pull request. The recompute is
 * a rewrite of GitHub's own patch — see `lib/review/whitespace.ts` — so it
 * costs no request, which is why it can be instant and per file at all.
 *
 * The rule this obeys, and the reason it is safe: **GitHub's patch stays the
 * authority on where a comment goes.** `layouts` below is built from
 * `fileDiffFor(file)` — the patch as GitHub sent it — throughout, and the
 * recomputed geometry is handed in separately as `drawn`, where it can only
 * take an anchor away. Nothing anchored here is anchored *because* of the
 * recompute, so no comment can move; some become listed instead, which is a
 * failure mode this column already has a surface for.
 */

/**
 * Which of Pierre's two layouts the column draws.
 *
 * The library's own default is `'split'`; ours is `'unified'`, because the
 * reviewer arrived from GitHub's Files-changed tab and that is what it shows.
 * That is a good default and was a bad fixed answer — people hold this
 * preference firmly and hold it both ways, and §B.3 is explicit that moving
 * between the two needs no change to the annotation data, so nothing about
 * comments depends on which one is up.
 */
export type DiffStyle = 'unified' | 'split';

/** Where the file list came from, and whether it was cut short getting here. */
export interface DiffOrigin {
  source: DiffPayload['source'];
  truncated: boolean;
}

/**
 * A request from the Overview to bring one thread into view.
 *
 * `token` rather than a bare id: two jumps to the same thread are two requests,
 * and the second has to act. Nothing here can be derived from `current`, whose
 * whole design is to *stop* repeating itself.
 */
export interface ThreadJump {
  threadId: string;
  token: number;
}

/**
 * What the keyboard needs from the column and cannot express as a prop.
 *
 * Three things, and each is about something only this component holds: the
 * parsed hunks, the viewer's scroll, and Pierre's own line selection.
 */
export interface DiffColumnHandle {
  /** Move to the next hunk (`1`) or the previous one (`-1`), across files. */
  goToHunk(direction: 1 | -1): void;
  /** Bring one line into view. What a search result jumps to. */
  goToLine(path: string, side: AnnotationSide, line: number): void;
  /** Open the composer on whatever the reviewer has selected in the gutter. */
  commentOnSelection(): void;
}

export interface DiffColumnProps {
  files: readonly ReviewFile[];
  diff: DiffOrigin;
  /**
   * Which sides of the diff on screen number their lines the way the pull
   * request's own diff does.
   *
   * Everything anchored to a line consults this: the threads, and the
   * composer. A narrowed diff between two other commits numbers its rows
   * against different files, and a line number that means something else is
   * the one failure here that produces no symptom at all — the annotation
   * renders, on the wrong text.
   */
  sides: AnchorableSides;
  /** The file the review is on, and which surface last moved it. */
  current: CurrentFile;
  /** A different file reached the top of the column. */
  onScrollTo: (path: string) => void;
  /** The Overview asked for a thread. Null until it has. */
  jump?: ThreadJump | null;
  /**
   * The two commits to read whole files from, for expanding context.
   *
   * Null when there is no base commit to read — an older cached payload — and
   * the column then passes no loader at all, which is the state Pierre already
   * handles by drawing no expander rather than one that always fails.
   */
  blobs?: BlobRefs | null;
  /** Unified or side by side. From the options page — see `Shell`. */
  diffStyle?: DiffStyle;
  /**
   * Which syntax theme to draw the code in. Empty means Pierre chooses.
   *
   * Also decides whether this page keeps overriding Pierre's addition and
   * deletion colours — see `syntaxTheme` in `Shell`, which is where that is
   * explained, because the override lives in CSS rather than here.
   */
  syntaxTheme?: string;
  /**
   * Read every file through the whitespace rewrite rather than GitHub's patch.
   *
   * One flag for the whole column, from the options page. It was a set of
   * paths and a button on each file header, on the argument that two files in
   * one pull request ask different questions — one is a reformat, the next is
   * not. That is still true, and it is not what the reviewer was asking: they
   * wanted the answer to hold across files and across pull requests, and two
   * ways to set the same thing is how you stop being able to tell which one is
   * winning.
   *
   * Every card whose body is drawn this way still says so on its face, which
   * is the guarantee that mattered: nobody reads a shortened diff without
   * being told it is one.
   */
  ignoreWhitespace?: boolean;
  /** Fold away the diff of a file nobody wrote. From the options page. */
  hideGenerated?: boolean;
  /**
   * What the repository declared about its own generated files.
   *
   * Empty when it declared nothing, which is the ordinary case and is why the
   * patterns exist. Read once per pull request by `useGitAttributes`.
   */
  gitAttributes?: readonly GeneratedRule[];
  ref?: Ref<DiffColumnHandle>;
}

/**
 * Why a card's body is not being drawn.
 *
 * Two rules with one shape, so one control can undo either — see `held`.
 */
export type HeldBack = 'generated' | 'whitespace';

// The second type parameter is caret metadata, added in 1.4.0 for the editor
// this page does not use: no item is ever handed `edit`, and `createEditor` is
// not on the React options at all. `undefined` is what the components
// themselves default it to; only the exported aliases require it spelled out.
/**
 * A rich comparison gets the whole card, rather than one split column of it.
 *
 * A rich card hands Pierre an empty diff (`emptyDiffFor` in `diffItems.ts`), so
 * in split view both columns hold nothing but the file-level annotation the
 * body is slotted into — and Pierre sizes annotation content to a single
 * column. Measured on the fixture, a rendered Markdown document drew 405px
 * inside an 880px card, beside a 440px column containing nothing at all. None
 * of these comparisons is a two-column diff; an image's own side-by-side is
 * laid out inside `.image-compare`. So the pair collapses to one.
 *
 * The selector is what keeps this off ordinary diffs. `-1,-1` is Pierre's file
 * level (§B.2), and `:only-child` is the load-bearing half: a *text* diff can
 * carry a file-level annotation too — unanchored threads, the whitespace
 * notice — and its columns hold its lines as well, which are the diff the
 * reviewer asked for.
 *
 * Delivered through `unsafeCSS` because every element it names is inside the
 * `diffs-container` shadow root, which the page stylesheet cannot reach. That
 * is the library's own door for this (§E.6) and it ships inside `@layer
 * unsafe`, the highest layer, so it wins without a specificity argument.
 * §E.6 also warns that structural selectors are the fragile kind across Pierre
 * versions: if a future release moves the annotation, this stops matching and
 * the body goes back to half a card. It does not break anything else.
 */
const FULL_WIDTH_RICH_BODY = /* css */ `
pre[data-diff-type="split"]:has([data-content] > [data-line-annotation="-1,-1"]:only-child) {
  grid-template-columns: 1fr;
}

pre[data-diff-type="split"]:has([data-content] > [data-line-annotation="-1,-1"]:only-child) > [data-deletions] {
  display: none;
}
`;

const CODE_VIEW_OPTIONS: CodeViewReactOptions<AnnotationMetadata, undefined> = {
  // The default rather than the answer: the reviewer arrived from GitHub's
  // Files-changed tab, which is unified, and the `diffStyle` prop overrides it.
  diffStyle: 'unified',
  stickyHeaders: true,
  // The "+" in the gutter, and the drag that turns it into a range.
  enableGutterUtility: true,
  enableLineSelection: true,
  unsafeCSS: FULL_WIDTH_RICH_BODY,
};

/**
 * The settings that are not preferences, in one place so a test can hold them
 * to it. Two of them are absences, which a comment cannot enforce and a
 * reviewer cannot see: the failure mode of naming `shiki-wasm` here is a diff
 * column that works all through development and is blank in the shipped
 * extension.
 */
export const CODE_VIEW_SAFE_PROPS = {
  disableWorkerPool: true,
  options: CODE_VIEW_OPTIONS,
} as const;

/**
 * Room to scroll past the last file.
 *
 * `CodeView` sizes its scroll region from the items it has measured, so at
 * maximum scroll the final item's *bottom* is level with the bottom of the
 * scrollport — which puts the top of that card, where all of its controls
 * live, below the fold with nowhere further to scroll. Measured in Chrome: the
 * last card's header sat 23px past the edge with the column already at its
 * limit, and its mode buttons could not be clicked at all.
 *
 * That is latent in any column whose last card has a tall header, and rich
 * comparisons are what made the headers tall. `renderCodeViewFooter` is the
 * library's own answer: a non-virtualized element after the last item, whose
 * height it measures and includes.
 *
 * A module constant rather than an inline arrow because `SlotPortals` memoizes
 * on this callback's identity.
 */
const renderTail = () => <div className="column-tail" aria-hidden="true" />;


const NO_ANNOTATIONS: DiffLineAnnotation<AnnotationMetadata>[] = [];
/** One empty list, so a card with no listed threads never gets a new array. */
const NO_LISTED: readonly ListedThread[] = [];
const NO_LAYOUT: FileThreadLayout = { annotations: NO_ANNOTATIONS, listed: NO_LISTED };

/** Shared, so a file with no comment in flight allocates nothing for one. */
const NO_POSTING: readonly PostingComment[] = [];

/**
 * The two questions only the renderer can answer about a hydrated diff.
 *
 * Structural rather than the `FileDiff` class, because the instance handed to
 * `onPostRender` under `CodeView` is a `VirtualizedFileDiff` and neither is
 * exported as a value this module should depend on. Both take a one-based
 * new-file line; there is no deletion-side counterpart in the library.
 */
interface LineProbe {
  /** Is this line on screen *now*, given whatever has been expanded? */
  isLineRenderable(lineNumber: number): boolean;
  /** Expand enough context to put it there. False if it already is. */
  revealLine(lineNumber: number): boolean;
}

const isLineProbe = (value: unknown): value is LineProbe =>
  typeof (value as LineProbe | null)?.isLineRenderable === 'function' &&
  typeof (value as LineProbe).revealLine === 'function';

/** Everything about a thread that decides where — or whether — it anchors. */
const anchorSignature = (thread: {
  id: string;
  line: number | null;
  diffSide: string;
  subjectType: string;
  isOutdated: boolean;
}): string =>
  `${thread.id}#${thread.line ?? 'x'}#${thread.diffSide}#${thread.subjectType}#${thread.isOutdated}`;

/**
 * How many frames to keep looking for a thread the column was asked to reach.
 *
 * The file has to be scrolled to, virtualized in and rendered before the
 * thread's element exists, and none of that is synchronous. A handful of frames
 * covers it; giving up quietly after that is correct, because the file scroll
 * has already happened and that is most of the answer.
 */
const JUMP_FRAMES = 8;

export function DiffColumn({
  files,
  diff,
  sides,
  current,
  onScrollTo,
  jump = null,
  blobs = null,
  ignoreWhitespace = false,
  hideGenerated = false,
  gitAttributes = NO_ATTRIBUTES,
  diffStyle = 'unified',
  syntaxTheme = '',
  ref,
}: DiffColumnProps) {
  const session = useReviewSession();
  /**
   * Cards the reviewer has folded or unfolded by hand.
   *
   * A map of overrides rather than a set of the folded, because a card now has
   * a *default* to override: a file whose diff is being withheld arrives folded.
   * A set could not tell "the reviewer opened this one" from "nobody has
   * touched it", and the two have to look different or a folded lockfile would
   * spring shut again on the next render.
   */
  const [folds, setFolds] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  /**
   * Files the reviewer asked to see in full, in spite of a rule hiding part.
   *
   * The escape hatch, and it has to be per file rather than per rule: "show me
   * this lockfile" is not "stop folding lockfiles", and a reviewer who wants
   * one of them is not asking to undo their own setting for the other nineteen.
   *
   * Unremembered, deliberately. It is a peek at what a rule is holding back, and
   * a peek that outlived the tab would quietly become a second settings system
   * — which is the door `Settings` closed when these moved to the options page.
   */
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * How each file is being compared, for the files the reviewer has moved.
   *
   * Per file rather than per type, because two images in one pull request are
   * answering different questions — one was redrawn and wants side by side, the
   * next moved four pixels and wants the difference blend. A single mode would
   * make each choice undo the last.
   *
   * Markdown is the one kind that argument does not reach, and it is held in
   * `modeMemory` instead: there are two modes, and which of them a reviewer
   * wants is a fact about the reviewer rather than about the file. So no
   * Markdown path ever lives in here — `changeMode` clears the kind's entries
   * on its way to remembering the press, because an entry left behind would
   * outrank the preference and pin one card while its neighbours moved.
   *
   * Sparse, and deliberately not seeded with every file's default. The default
   * is a function of the file, so writing it down would only create a second
   * copy to keep in step with the first — and the file list is replaced
   * wholesale by "changes since my last review", which would leave that copy
   * describing files that are no longer here.
   */
  const [chosenModes, setChosenModes] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [modeMemory, rememberMode] = useModeMemory();
  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const [unplaceable, setUnplaceable] = useState<string | null>(null);
  const [expansionError, setExpansionError] = useState<string | null>(null);

  /**
   * Which lines the renderer has told us it will actually draw, per file.
   *
   * Expanding unchanged context is invisible in the metadata — `expandedHunks`
   * lives on Pierre's renderer and nothing about `FileDiffMetadata` moves when
   * a hunk grows — so the only honest source for "is line N on screen" is the
   * instance's own `isLineRenderable`. That is asked after each render and the
   * answers accumulate here.
   *
   * Accumulating is sound because expansion only ever grows: `expandHunk` adds
   * to the region and nothing shrinks it short of tearing the renderer down —
   * which is exactly what the remount below does, so these are cleared with it.
   */
  const revealed = useRef(new Map<string, Set<number>>());
  /** Lines already offered to `revealLine`, so a refusal is never retried. */
  const revealAttempted = useRef(new Set<string>());

  /**
   * Forget what the last renderer drew, because it no longer exists.
   *
   * `CodeView` is keyed on the generation, so a new file list tears the whole
   * thing down and rebuilds it collapsed. These two refs outlive that, and a
   * line the old renderer had expanded into view reads as still drawable —
   * so a thread anchored there is emitted as an annotation for a row the new
   * renderer has not got. Pierre keeps that annotation in the DOM but does not
   * display it, and because the thread was not demoted it is left off the
   * per-file list too: the comment is on neither surface, with nothing raised.
   *
   * Done during render rather than in an effect. The layouts memo below reads
   * `revealed` in this same pass, and an effect would let it build one round
   * of annotations from the dead renderer's answers first.
   */
  /**
   * The rewrite, per file, and only while the setting asks for one.
   *
   * Files with no text diff are skipped rather than rewritten to nothing. This
   * did not have to be said when the switch was a button on the card — that
   * button was only drawn where there was a patch to take the whitespace out
   * of — but one setting reaches every file in the pull request, and
   * `withoutWhitespaceChanges('')` is perfectly happy to report that nothing
   * but whitespace changed. On a PNG that is a card announcing its contents
   * were shortened.
   *
   * Computed for every file the rewrite touches, including one the reviewer has
   * opened: it is what the rule *says*, and the card needs that to keep offering
   * the way back. `drawnFiles` is where being opened takes effect.
   */
  const recomputed = useMemo(() => {
    const built = new Map<string, WhitespaceDiff>();
    if (!ignoreWhitespace) return built;
    for (const file of files) {
      if (fileBody(file).kind !== 'diff') continue;
      const rewrite = withoutWhitespaceChanges(file.patch);
      // Only the files it actually shortened. Most files in a pull request have
      // no whitespace-only change in them, and an entry here is what puts the
      // caveat on the card — a caveat on all nineteen files is one nobody reads
      // on the one that needed it.
      if (!rewrite.changed) continue;
      built.set(file.path, rewrite);
    }
    return built;
  }, [files, ignoreWhitespace]);

  /**
   * Which files are being read through a rule, and which rule.
   *
   * Two rules, one shape. They arrive from different places and mean different
   * things, but from the card's point of view they are the same situation —
   * "this body is not what GitHub sent, and here is the word for why" — and
   * giving them one shape is what lets one control undo either.
   *
   * `generated` outranks `whitespace` on a file that is both. It is the more
   * useful sentence: "nobody wrote this" explains the folding on its own, where
   * "every change in it was whitespace" invites the reviewer to wonder what a
   * lockfile is doing reindenting itself.
   *
   * Being opened does not clear this. The card goes on wearing the word while
   * the reviewer reads it, because that word is also the way back.
   */
  const flags = useMemo(() => {
    const built = new Map<string, HeldBack>();
    for (const file of files) {
      if (hideGenerated && isGenerated(file.path, gitAttributes)) {
        built.set(file.path, 'generated');
      } else if (recomputed.has(file.path)) {
        built.set(file.path, 'whitespace');
      }
    }
    return built;
  }, [files, hideGenerated, gitAttributes, recomputed]);

  /**
   * The viewed state each card is actually in.
   *
   * The payload's value with this session's own changes over the top, which is
   * the same two-layer read `ViewedCheckbox` does — and it has to be the same
   * one, or a file would fold on a reload and not when it was ticked.
   */
  const viewedNow = useMemo(() => {
    const built = new Map<string, FileViewedState>();
    for (const file of files) {
      built.set(file.path, session.viewed.get(file.path) ?? file.viewedState);
    }
    return built;
  }, [files, session.viewed]);

  /**
   * A file the reviewer has just ticked or unticked answers to the rule again.
   *
   * Without this, marking a file viewed would fold every card except the ones
   * the reviewer had opened by hand — which is most of the ones they are about
   * to tick, because opening a file is how you come to have read it. The
   * override is dropped rather than overwritten, so unticking puts the card
   * back to whatever the rules say rather than to whatever it happened to be
   * doing when it was ticked.
   *
   * During render rather than in an effect. The fold is read in this same
   * pass, and an effect would paint one frame of the card open before folding
   * it — a flinch on the one control whose whole job is to get a finished file
   * out of the way.
   */
  const lastViewed = useRef(viewedNow);
  if (lastViewed.current !== viewedNow) {
    const previous = lastViewed.current;
    lastViewed.current = viewedNow;
    const moved = [...viewedNow]
      .filter(([path, state]) => previous.get(path) !== state)
      .map(([path]) => path);
    if (moved.length > 0) {
      setFolds((current) => {
        if (!moved.some((path) => current.has(path))) return current;
        const next = new Map(current);
        for (const path of moved) next.delete(path);
        return next;
      });
    }
  }

  /**
   * Folded unless the reviewer said otherwise.
   *
   * Three rules fold a card, and they are the same idea three times: this is
   * not what the reviewer is here to read.
   *
   * A generated file, and a file whose every change turned out to be
   * whitespace, both cost a header's height and nothing more until they are
   * asked for — four thousand lines of lockfile between two files somebody
   * wrote is how a real change gets skimmed past.
   *
   * A file marked viewed is the third, and it is the one that also fires
   * mid-review: ticking the box folds the card on the spot, and a reload finds
   * it folded because GitHub remembers the tick. It is not a persisted
   * interface preference — nothing here persists one, see `ModeSwitcher` — it
   * is read off the same state the checkbox draws itself from.
   *
   * A file the rewrite merely *shortened* is not folded. There is still a diff
   * in it worth reading, and it is already marked.
   *
   * **A file with a comment still in flight is not folded either**, and that
   * exception is not symmetry. An entry in `posting` is writing that is on
   * GitHub nowhere; if the post fails, the alert saying so is drawn on that
   * card. Folding it because the reviewer ticked the box on their way past
   * would hide a failure they have no other way to hear about. The fold is
   * only withheld — an explicit press still folds it, because that is a
   * decision rather than a side effect.
   *
   * The reviewer's own fold beats every default both ways, so a card they
   * opened stays open and one they closed stays closed.
   */
  const collapsed = useMemo(() => {
    const built = new Set<string>();
    for (const file of files) {
      const unsent = session.posting.some((entry) => entry.path === file.path);
      const byRule =
        !unsent &&
        (viewedNow.get(file.path) === 'VIEWED' ||
          (!shown.has(file.path) &&
            (flags.get(file.path) === 'generated' ||
              recomputed.get(file.path)?.hunks === 0)));
      if (folds.get(file.path) ?? byRule) built.add(file.path);
    }
    return built;
  }, [files, folds, flags, recomputed, shown, viewedNow, session.posting]);

  /**
   * The list as it is *drawn*, which is the list `files` is not.
   *
   * Only this feeds the renderer. Everything about where a comment goes keeps
   * reading `files`, and the two are kept apart deliberately rather than
   * merged into one list with a flag on it.
   */
  const drawnFiles = useMemo(() => {
    // The prop itself while nothing is being recomputed, which is almost
    // always. `generation` is derived from this array's identity and remounts
    // the viewer when it moves, and `useMemo` is a hint React is entitled to
    // discard — so a mapped copy here would mean a dropped memo could throw
    // away the reviewer's scroll position and every line of context they had
    // expanded, at a moment nothing on screen had changed.
    if (recomputed.size === 0) return files;
    return files.map((file) => {
      // A file the reviewer opened is drawn from GitHub's own patch. That is
      // what the escape hatch has to mean: unfolding a card around a patch that
      // has already lost lines would show them a shorter diff and call it all
      // of it.
      if (shown.has(file.path)) return file;
      const recompute = recomputed.get(file.path);
      return recompute === undefined ? file : { ...file, patch: recompute.patch };
    });
  }, [files, recomputed, shown]);
  const drawnByPath = useMemo(
    () => new Map(drawnFiles.map((file) => [file.path, file])),
    [drawnFiles],
  );

  // Derived from the drawn list, so toggling whitespace on one file remounts
  // the viewer exactly as replacing the file list does. It has to: `CodeView`
  // keeps the code it first rendered for an item id, so a new patch under an
  // existing path would leave the old rows on screen under the new header.
  const generation = diffGeneration(drawnFiles);
  const lastGeneration = useRef(generation);
  if (lastGeneration.current !== generation) {
    lastGeneration.current = generation;
    revealed.current.clear();
    revealAttempted.current.clear();
    // The notice names a file, and the file list has just been replaced. It
    // may not even be in the column any more.
    setExpansionError(null);
  }

  /** Bumped when a file hydrates or grows, which is what re-runs the layouts. */
  const [expansion, setExpansion] = useState(0);

  /**
   * Annotation metadata, kept alive across renders and across thread updates.
   *
   * Pierre compares metadata **by reference**. A fresh object per render reads
   * as a changed annotation and rebuilds the row's DOM every time; keyed by
   * thread id rather than by thread object, a resolve does not churn it either.
   */
  const metadata = useRef(new Map<string, ThreadMetadata>());
  const composerMetadata = useRef<ComposerMetadata>({ kind: 'composer' });

  /**
   * Layouts, recomputed per file only when that file's threads moved — or when
   * the diff under them did.
   *
   * Rebuilding every file's annotation array whenever any thread changes would
   * hand `CodeView` a new array for five hundred untouched files and re-render
   * all of them. So the signature is exactly the fields anchoring reads, and
   * anchoring reads two things, not one: the thread, and the hunks it has to
   * fall inside. `fileDiffSignature` is the second half. Without it, switching
   * to "changes since my last review" leaves every thread with the verdict it
   * got against the *full* diff — and one whose line is no longer in any hunk
   * stays an annotation Pierre silently declines to draw.
   *
   * That signature is a *string of mutable state*, not an identity number,
   * because expanding context hydrates the metadata **in place** — the object
   * grows a whole file's worth of lines without ever becoming a different
   * object. And the revealed-line set is folded in beside it, because the one
   * thing hydration does *not* write anywhere is which of those new lines the
   * renderer has been asked to draw.
   */
  /**
   * The two booleans as one string, so the memo below can depend on their
   * values rather than on the object identity the shell rebuilds each render.
   * They belong in the per-file signature too: a file whose threads and hunks
   * have not moved still needs re-laying out when the diff under them stops
   * being the pull request's own.
   */
  const sidesKey = `${sides.additions ? 'a' : ''}${sides.deletions ? 'd' : ''}`;

  const cache = useRef(new Map<string, { signature: string; layout: FileThreadLayout }>());
  const layouts = useMemo(() => {
    const built = new Map<string, FileThreadLayout>();
    for (const file of files) {
      const threads = session.byPath.get(file.path) ?? [];
      const open = revealed.current.get(file.path);
      // The drawn parse is only in the signature, never the anchor: what
      // changes when whitespace starts being ignored is which of these
      // verdicts is still true, not how any of them is reached.
      const drawnFile = drawnByPath.get(file.path);
      const recomputing = drawnFile !== undefined && drawnFile !== file;
      const signature =
        `${fileDiffSignature(file)}#${open?.size ?? 0}#${sidesKey}#` +
        `${recomputing ? fileDiffSignature(drawnFile) : '-'}#` +
        threads.map(anchorSignature).join('|');
      const cached = cache.current.get(file.path);
      if (cached !== undefined && cached.signature === signature) {
        built.set(file.path, cached.layout);
        continue;
      }
      const layout =
        threads.length === 0
          ? NO_LAYOUT
          : layoutThreads(threads, fileDiffFor(file), {
              sides,
              metadata: metadata.current,
              revealed: open,
              // GitHub's patch is the first argument and stays the authority.
              // This is the second gate and can only close.
              ...(recomputing ? { drawn: renderedLines(fileDiffFor(drawnFile)) } : {}),
            });
      cache.current.set(file.path, { signature, layout });
      built.set(file.path, layout);
    }
    return built;
    // `expansion` is not read here — it is what tells React the mutable state
    // above has moved. Pierre hydrates in place and fires no callback a
    // consumer can subscribe to, so a render has to be provoked from the
    // outside or the memo would never be asked the question again.
  }, [files, drawnByPath, session.byPath, expansion, sidesKey]);

  /**
   * Annotation metadata for the comments in flight, kept alive the same way
   * the threads' is.
   *
   * Keyed by the entry's id rather than by the entry, so a post that fails —
   * which rewrites the entry to carry the reason — does not read to Pierre as
   * a different annotation and rebuild the row. The card is already re-rendering
   * to show the error; the row it sits in should not move.
   */
  const postingMetadata = useRef(new Map<string, PostingMetadata>());

  /**
   * Where each comment in flight is drawn, and which cannot be drawn in place.
   *
   * The same three gates `layoutThreads` applies to a thread, for the same
   * reason and with the same consequence for getting it wrong: Pierre discards
   * an annotation outside a rendered hunk in silence, and a failed post that
   * is silently discarded is the reviewer's own writing gone with no message
   * anywhere. Anything that cannot be anchored is listed in the file's body
   * instead — see `FileBody`.
   *
   * Nearly always the first branch. An entry is created from a composer that
   * was open on a visible line moments earlier; it takes changing the diff on
   * screen while a post is in flight, or while a failed one is still sitting
   * there, to reach the second.
   *
   * Kept out of the `layouts` memo above deliberately. That one is cached per
   * file on a signature, and folding a short-lived entry into it would make
   * every post invalidate a thread layout that had not moved.
   */
  const postings = useMemo(() => {
    const built = new Map<
      string,
      {
        annotations: DiffLineAnnotation<AnnotationMetadata>[];
        listed: PostingComment[];
      }
    >();
    if (session.posting.length === 0) return built;

    for (const file of files) {
      const entries = postsOnPath(session.posting, file.path);
      if (entries.length === 0) continue;

      const lines = renderedLines(fileDiffFor(file));
      const open = revealed.current.get(file.path);
      const drawnFile = drawnByPath.get(file.path);
      const drawn =
        drawnFile !== undefined && drawnFile !== file
          ? renderedLines(fileDiffFor(drawnFile))
          : null;

      const annotations: DiffLineAnnotation<AnnotationMetadata>[] = [];
      const listed: PostingComment[] = [];

      for (const entry of entries) {
        const side = entry.anchor.side === 'LEFT' ? 'deletions' : 'additions';
        const { line } = entry.anchor;
        // Expanded context counts, exactly as it does for a thread: those rows
        // are on screen and no hunk header says so.
        const shown = (at: RenderedLines): boolean =>
          isRenderedLine(at, side, line) ||
          (side === 'additions' && (open?.has(line) ?? false));

        if (!sides[side] || !shown(lines) || (drawn !== null && !shown(drawn))) {
          listed.push(entry);
          continue;
        }

        let memoized = postingMetadata.current.get(entry.id);
        if (memoized === undefined) {
          memoized = { kind: 'posting', postId: entry.id };
          postingMetadata.current.set(entry.id, memoized);
        }
        annotations.push({ side, lineNumber: line, metadata: memoized });
      }

      built.set(file.path, { annotations, listed });
    }
    return built;
    // `expansion` for the same reason as above: hydration rewrites the parsed
    // diff in place, so only a provoked render asks this question again.
  }, [files, drawnByPath, session.posting, expansion, sidesKey]);

  const annotationsByPath = useMemo(() => {
    const built = new Map<string, DiffLineAnnotation<AnnotationMetadata>[]>();
    for (const [path, layout] of layouts) {
      const inFlight = postings.get(path)?.annotations ?? NO_ANNOTATIONS;
      const composing = composer !== null && composer.path === path;
      // The untouched array whenever there is nothing to add to it. A fresh
      // one for a file that did not move re-versions the item and re-renders
      // the whole card.
      built.set(
        path,
        inFlight.length === 0 && !composing
          ? layout.annotations
          : [
              ...layout.annotations,
              ...inFlight,
              ...(composing
                ? [
                    {
                      side: composer.side,
                      lineNumber: composer.lineNumber,
                      metadata: composerMetadata.current,
                    },
                  ]
                : []),
            ],
      );
    }
    return built;
  }, [layouts, postings, composer]);

  /**
   * The mode every file is actually in, resolved rather than stored.
   *
   * `resolveModeForFile` is what makes the sparse map above safe: a file the
   * reviewer never touched gets its default, and a stored mode that the file no
   * longer offers — the list was replaced, a path that used to be a PNG is now
   * a CSV — falls back to the default rather than rendering a control the file
   * does not have.
   */
  const modes = useMemo(() => {
    const built = new Map<string, string>();
    for (const file of files) {
      // Per-file first, then the remembered preference for the kind, then the
      // file's own default. A remembered mode the file cannot offer — a one-sided
      // `.md`, where `markdown:rendered` is `needsBothSides` — falls back inside
      // `resolveModeForFile` rather than here.
      const chosen = chosenModes.get(file.path) ?? modeMemory[comparisonKind(file)];
      built.set(file.path, resolveModeForFile(file, chosen));
    }
    return built;
  }, [files, chosenModes, modeMemory]);

  const changeMode = useCallback(
    (path: string, mode: string) => {
      const pressed = files.find((file) => file.path === path);
      const kind = pressed === undefined ? 'none' : comparisonKind(pressed);

      if (isRememberedKind(kind)) {
        // The press is a preference rather than a choice about this one file, so
        // the per-file entries for the kind are forgotten: left in place they
        // would outrank the preference and the other cards would not move.
        setChosenModes((previous) => {
          const next = new Map(previous);
          for (const file of files) {
            if (comparisonKind(file) === kind) next.delete(file.path);
          }
          return next;
        });
        rememberMode(kind, mode);
        return;
      }

      setChosenModes((previous) => {
        const next = new Map(previous);
        next.set(path, mode);
        return next;
      });
    },
    [files, rememberMode],
  );

  /**
   * Which cards have something to put in a body besides a comparison.
   *
   * Kept out of `codeViewItems` because both halves of the answer live in this
   * component's state, and handed in as a set so that module stays a pure
   * function of its arguments. A file that is not in here and not in a rich
   * mode gets no annotation at all — an unfilled annotation host is a strip of
   * empty space between the header and the first hunk, on every file.
   */
  const withBody = useMemo(() => {
    const built = new Set<string>();
    for (const file of drawnFiles) {
      const listed = layouts.get(file.path)?.listed ?? NO_LISTED;
      const unplaceable = postings.get(file.path)?.listed ?? NO_POSTING;
      if (hasBodyContent(listed, unplaceable)) built.add(file.path);
    }
    return built;
  }, [drawnFiles, layouts, postings, recomputed]);

  const items = useMemo(
    () => codeViewItems(drawnFiles, collapsed, annotationsByPath, modes, withBody),
    [drawnFiles, collapsed, annotationsByPath, modes, withBody],
  );

  /**
   * How much slack the tail needs, decided before the column has rendered.
   *
   * It has to be decided here rather than measured later: `CodeView` takes the
   * footer's height once, when it mounts, and never looks again — so a tail
   * that grew as the rich comparisons arrived would be ignored, and the core
   * would go on clamping scroll to the stale number. `lib/review/columnTail.ts`
   * has the two library facts behind that and the measurements.
   *
   * Counted off the same predicate `codeViewItems` collapses on, because they
   * are the same cards: the ones whose header carries a comparison the metric
   * knows nothing about.
   */
  const tailSlack = useMemo(
    () =>
      tailDeficit(
        drawnFiles.filter((file) => !showsTextDiff(file, modes.get(file.path) ?? RAW.id))
          .length,
      ),
    [drawnFiles, modes],
  );
  // GitHub's files, not the drawn ones. The card reports the pull request's
  // own counts and the composer seeds suggestions from the patch GitHub sent,
  // and neither should change because a hunk was hidden from the screen.
  const byPath = useMemo(
    () => new Map(files.map((file) => [file.path, file])),
    [files],
  );

  const viewer = useRef<CodeViewHandle<AnnotationMetadata, undefined>>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const headers = useRef(new Map<string, HTMLElement>());

  /**
   * Fold or unfold one card, whatever it was doing before.
   *
   * Written against the *effective* state rather than the override, so the
   * first press on a withheld card opens it rather than recording "fold this
   * one" on something already folded and appearing to do nothing.
   */
  const toggleCollapsed = useCallback(
    (path: string) => {
      const open = !collapsed.has(path);
      setFolds((previous) => new Map(previous).set(path, open));
    },
    [collapsed],
  );

  /**
   * Show one file as GitHub has it, or put the rule back.
   *
   * The one control for both rules. On a generated file it unfolds the card; on
   * a whitespace one it restores GitHub's patch, which for a file that was
   * nothing but whitespace also gives it a body again. Either way the fold
   * override is dropped, because it was recorded against a card that was
   * describing something else.
   */
  const toggleShown = useCallback((path: string) => {
    setShown((previous) => {
      const next = new Set(previous);
      if (!next.delete(path)) next.add(path);
      return next;
    });
    setFolds((previous) => {
      if (!previous.has(path)) return previous;
      const next = new Map(previous);
      next.delete(path);
      return next;
    });
  }, []);

  const registerHeader = useCallback((path: string, node: HTMLElement | null) => {
    if (node === null) headers.current.delete(path);
    else headers.current.set(path, node);
  }, []);

  /**
   * A gutter gesture, turned into somewhere to write.
   *
   * Held in a ref so the `options` object below can be built once. A new
   * options identity on every render makes `CodeView` re-render every mounted
   * diff, which is the opposite of what virtualizing them was for.
   */
  const openComposer = useRef((path: string, range: SelectedLineRange) => {});
  openComposer.current = (path, range) => {
    const target = composerFor(path, range, sides);
    if (target === null) {
      // Nothing on screen to attach even the explanation to. Saying so here is
      // the alternative to posting `line: NaN` and reporting an opaque 422.
      setComposer(null);
      setUnplaceable(
        'That line selection could not be read, so there is nowhere to put a ' +
          'comment. Try selecting the lines again.',
      );
      return;
    }
    setUnplaceable(null);
    setComposer(target);
  };

  const closeComposer = useCallback(() => {
    setComposer(null);
  }, []);

  /**
   * Hunk navigation, as an index into every hunk in the column.
   *
   * Flattened across files so `J` runs off the end of one file into the next,
   * which is how a pull request is read. The cursor is re-anchored whenever it
   * has drifted away from the file the reviewer is actually on — they may have
   * arrived by `j`, by the tree, or by scrolling — so `J` always means "the
   * next hunk from here" rather than "the next hunk from wherever I last was".
   */
  // Over the drawn list: `J` has to land on hunks that are on screen, and a
  // hunk the recompute took away is not one of them.
  const stops = useMemo(() => hunkStops(drawnFiles), [drawnFiles]);
  const hunkCursor = useRef(-1);
  const currentPath = useRef(current.path);
  currentPath.current = current.path;

  useEffect(() => {
    // A new file list invalidates every index into the old one.
    hunkCursor.current = -1;
  }, [stops]);

  useImperativeHandle(
    ref,
    (): DiffColumnHandle => ({
      goToHunk(direction) {
        if (stops.length === 0) return;

        const path = currentPath.current;
        const cursor = hunkCursor.current;
        const anchored =
          cursor >= 0 && (path === null || stops[cursor]?.path === path);

        let next: number;
        if (anchored) {
          next = Math.min(Math.max(cursor + direction, 0), stops.length - 1);
        } else {
          // Land on the current file's first hunk rather than stepping from a
          // position that has nothing to do with where the reviewer is.
          const first = stops.findIndex((stop) => stop.path === path);
          next = first === -1 ? (direction > 0 ? 0 : stops.length - 1) : first;
        }

        hunkCursor.current = next;
        const stop = stops[next];
        if (stop === undefined) return;
        viewer.current?.scrollTo({
          type: 'line',
          id: stop.path,
          lineNumber: stop.line,
          side: stop.side,
          align: 'start',
        });
      },

      goToLine(path, side, line) {
        viewer.current?.scrollTo({
          type: 'line',
          id: path,
          lineNumber: line,
          side,
          align: 'center',
        });
      },

      commentOnSelection() {
        const selection = viewer.current?.getSelectedLines() ?? null;
        if (selection === null) {
          setComposer(null);
          setUnplaceable(
            'Nothing is selected, so there is no line to comment on. Select ' +
              'one or more lines in the number gutter first, or use the "+" ' +
              'that appears there.',
          );
          return;
        }
        openComposer.current(selection.id, selection.range);
      },
    }),
    [stops],
  );

  /**
   * What a rendered file has to say about itself, once per render pass.
   *
   * This is the only channel there is. Pierre hydrates the metadata in place
   * and fires no hydration or expansion callback a consumer of `CodeView` can
   * subscribe to — `onHunkExpand` is wired to the library's own handler and is
   * not on the options a consumer can set — so `onPostRender` is where the
   * question gets asked, and the instance it hands over is what answers it.
   */
  const noticeExpansion = useRef(
    (path: string, fileDiff: FileDiffMetadata, probe: LineProbe) => {},
  );
  noticeExpansion.current = (path, fileDiff, probe) => {
    // A partial diff draws exactly its hunks, which the layout already knows.
    if (fileDiff.isPartial) return;

    const threads = session.byPath.get(path) ?? [];
    if (threads.length === 0) return;

    const drawn = renderedLines(fileDiff);
    let open = revealed.current.get(path);
    let grew = false;

    for (const thread of threads) {
      const line = thread.line;
      // Only the additions side, and only threads with a live line: those are
      // the ones `isLineRenderable` can be asked about at all.
      if (line === null || thread.diffSide !== 'RIGHT' || thread.subjectType !== 'LINE') {
        continue;
      }
      if (isRenderedLine(drawn, 'additions', line) || open?.has(line) === true) continue;

      if (probe.isLineRenderable(line)) {
        if (open === undefined) {
          open = new Set<number>();
          revealed.current.set(path, open);
        }
        open.add(line);
        grew = true;
        continue;
      }

      // Still collapsed. Ask once for it to be drawn: the reviewer has already
      // chosen to expand this file, and a comment sitting invisibly in the
      // middle of the context they just revealed is the exact failure the
      // per-file list exists to prevent.
      const attempt = `${path} ${line}`;
      if (revealAttempted.current.has(attempt)) continue;
      revealAttempted.current.add(attempt);
      probe.revealLine(line);
    }

    // Only when something actually moved. This runs after every render of
    // every mounted file, and an unconditional bump would be a render loop.
    if (grew) setExpansion((count) => count + 1);
  };

  /**
   * The loader, rebuilt only when the two commits move.
   *
   * Keyed on a string rather than on `blobs` itself because the caller builds
   * that object inline; a new identity per render would hand `CodeView` new
   * options every render and re-render every mounted diff.
   */
  const refsKey =
    blobs === null
      ? ''
      : `${blobs.pr.owner}/${blobs.pr.repo}/${blobs.pr.number}@${blobs.baseSha}..${blobs.headSha}`;
  const refs = useRef(blobs);
  refs.current = blobs;
  const loadDiffFiles = useMemo(() => {
    if (refs.current === null) return null;
    const load = createDiffFilesLoader(refs.current, (_path, reason) => {
      setExpansionError(reason);
    });
    // Wrapped so a success can clear the notice. It was only ever set, never
    // unset, so one file that could not be expanded — a binary base side, say
    // — left "…cannot be expanded because the file is not text" at the top of
    // the column for the rest of the session, naming a file the reviewer had
    // long since scrolled past, and reading as a live failure of whatever they
    // were looking at now. The loader rethrows after reporting, so this line
    // is reached only when the expansion actually worked.
    return async (fileDiff: Parameters<typeof load>[0]) => {
      const loaded = await load(fileDiff);
      setExpansionError(null);
      return loaded;
    };
  }, [refsKey]);

  const options = useMemo<CodeViewReactOptions<AnnotationMetadata, undefined>>(
    () => ({
      ...CODE_VIEW_OPTIONS,
      // Rebuilding `options` re-renders every mounted diff, which is exactly
      // what changing the layout has to do and the reason this is in the
      // dependency list rather than read through a ref.
      diffStyle,
      // Omitted rather than passed empty. Pierre falls back to its own
      // light/dark pair only when the key is absent, so an empty string here
      // would be a theme named '' and nothing would highlight.
      ...(syntaxTheme === '' ? {} : { theme: syntaxTheme }),
      // Present only when there is somewhere to load from. Its mere presence
      // is what makes Pierre draw an expander at all, so an always-present
      // loader that always failed would be worse than none.
      ...(loadDiffFiles === null ? {} : { loadDiffFiles }),
      onGutterUtilityClick(range: SelectedLineRange, context: { item: { id: string } }) {
        openComposer.current(context.item.id, range);
      },
      onPostRender(_node: HTMLElement, instance: unknown, phase: string, context: unknown) {
        // 'unmount' fires whenever virtualization recycles an item out of the
        // window. Nothing to read from an instance that is being torn down.
        if (phase === 'unmount' || !isLineProbe(instance)) return;

        const record = context as {
          type?: unknown;
          item?: { id?: unknown; fileDiff?: FileDiffMetadata };
        };
        if (record.type !== 'diff') return;
        const path = record.item?.id;
        const fileDiff = record.item?.fileDiff;
        if (typeof path !== 'string' || fileDiff === undefined) return;

        noticeExpansion.current(path, fileDiff, instance);
      },
    }),
    [loadDiffFiles, diffStyle, syntaxTheme],
  );

  /** The source text under the composer's selection, for the suggestion button. */
  const composerLines = useMemo((): readonly string[] => {
    if (composer === null || composer.anchor === null) return [];
    const file = byPath.get(composer.path);
    if (file === undefined) return [];
    const { anchor } = composer;
    return sourceLines(
      fileDiffFor(file),
      anchor.side,
      anchor.startLine ?? anchor.line,
      anchor.line,
    );
  }, [composer, byPath]);

  const renderAnnotation = useCallback(
    (
      annotation:
        | LineAnnotation<AnnotationMetadata>
        | DiffLineAnnotation<AnnotationMetadata>,
      item: CodeViewItem<AnnotationMetadata>,
    ) => {
      const meta = annotation.metadata;
      if (meta.kind === 'thread') return <ThreadCard threadId={meta.threadId} />;
      if (meta.kind === 'posting') return <PostingCard postId={meta.postId} />;
      // Which file this is comes from the item rather than from the metadata,
      // so one frozen `{ kind: 'body' }` can be shared by every card.
      if (meta.kind === 'body') {
        const file = byPath.get(item.id);
        if (file === undefined) return null;
        return (
          <FileBody
            file={file}
            mode={modes.get(file.path) ?? RAW.id}
            unanchored={layouts.get(file.path)?.listed ?? NO_LISTED}
            posting={postings.get(file.path)?.listed ?? NO_POSTING}
            blobs={blobs}
          />
        );
      }
      if (composer === null) return null;
      return (
        <Composer
          path={composer.path}
          anchor={composer.anchor}
          rejection={composer.rejection}
          selectedLines={composerLines}
          onClose={closeComposer}
        />
      );
    },
    [
      composer,
      composerLines,
      closeComposer,
      byPath,
      modes,
      recomputed,
      layouts,
      postings,
      blobs,
    ],
  );

  /**
   * The file card, memoized because `SlotPortals` watches this callback's
   * identity as well as the item versions.
   *
   * An inline arrow here defeated both its `memo` and the `useMemo` building
   * its portal list, so every mounted card, thread and composer re-rendered on
   * every render of this column — including every frame of a rail drag.
   *
   * Safe to memoize now, and deliberately was not before: `versionOf` in
   * `diffItems.ts` folds `mode`, `collapsed` and `body` into each item's
   * version, which is the guard rail its comment describes. Without that, a
   * memoized callback would leave the mode buttons changing nothing — silently,
   * one file type at a time.
   */
  const renderHeader = useCallback(
    (item: { id: string }) => {
      const file = byPath.get(item.id);
      if (file === undefined) return null;
      return (
        <FileCard
          file={file}
          collapsed={collapsed.has(file.path)}
          onToggleCollapsed={toggleCollapsed}
          onHeaderRef={registerHeader}
          mode={modes.get(file.path) ?? RAW.id}
          onChangeMode={changeMode}
          whitespace={recomputed.get(file.path) ?? null}
          held={flags.get(file.path) ?? null}
          shown={shown.has(file.path)}
          onToggleShown={toggleShown}
        />
      );
    },
    [
      byPath,
      collapsed,
      toggleCollapsed,
      registerHeader,
      modes,
      changeMode,
      recomputed,
      flags,
      shown,
      toggleShown,
    ],
  );

  /**
   * Which file the reviewer is looking at, measured rather than counted.
   *
   * `CodeView` keeps its item offsets private, so the answer comes from where
   * the mounted card headers actually are. Virtualization means only the
   * headers near the viewport exist, which is exactly the set that could be at
   * the top of it.
   */
  const reported = useRef<string | null>(null);
  const handleScroll = useCallback(() => {
    const container = scroller.current;
    if (container === null) return;

    const origin = container.getBoundingClientRect().top;
    const tops: CardTop[] = [];
    for (const [path, node] of headers.current) {
      if (!node.isConnected) continue;
      tops.push({ path, top: node.getBoundingClientRect().top - origin });
    }

    const path = topmostFile(tops);
    // Scroll fires at frame rate and most frames are still on the same file.
    // The reducer would absorb the repeats, but only after React had rendered
    // the shell again to find that out.
    if (path === null || path === reported.current) return;
    reported.current = path;
    onScrollTo(path);
  }, [onScrollTo]);

  // Follow the tree — and only the tree. Scrolling because the column scrolled
  // is the other half of the feedback loop the origin exists to break. The
  // dependencies are the two primitives rather than `current` itself, so a
  // state object that was rebuilt without moving does not re-scroll.
  const target = current.path;
  const acts = shouldScrollDiff(current);
  useEffect(() => {
    if (!acts || target === null) return;
    viewer.current?.scrollTo({ type: 'item', id: target, align: 'start' });
  }, [acts, target]);

  /**
   * The second half of a jump from the Overview.
   *
   * The file scroll above puts the card on screen; this finds the thread inside
   * it. Both halves are needed and only the first is reliable — a thread may be
   * in a collapsed file, inside the closed per-file section, or on a file this
   * column has no card for at all. So the element is looked for over a few
   * frames and, if it never turns up, nothing further happens: the reviewer is
   * on the right file, which is what the list could honestly promise.
   */
  const jumpId = jump?.threadId ?? null;
  const jumpToken = jump?.token ?? 0;
  useEffect(() => {
    if (jumpId === null) return;

    let frame = 0;
    let attempts = 0;

    const reach = () => {
      const container = scroller.current;
      const found =
        container === null
          ? undefined
          : // Matched by attribute value rather than by selector: thread ids
            // are opaque server strings and are not escaped for CSS here.
            [...container.querySelectorAll('[data-thread]')].find(
              (node) => node.getAttribute('data-thread') === jumpId,
            );

      if (found !== undefined) {
        // Resolved threads and every listed one sit inside a closed <details>,
        // where scrolling to them would land on a summary line.
        let box = found.closest('details');
        while (box !== null) {
          box.open = true;
          box = box.parentElement?.closest('details') ?? null;
        }
        // Absent in jsdom, and not worth a polyfill for a scroll.
        if (typeof found.scrollIntoView === 'function') {
          found.scrollIntoView({ block: 'center' });
        }
        return;
      }

      attempts += 1;
      if (attempts < JUMP_FRAMES) frame = requestAnimationFrame(reach);
    };

    frame = requestAnimationFrame(reach);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [jumpId, jumpToken]);

  return (
    <main
      className="column"
      aria-label="Diff"
      style={{ '--tail-deficit': `${tailSlack}px` } as CSSProperties}
    >
      {diff.source === 'files-api' && (
        <p className="notice" role="status">
          GitHub would not generate a unified diff for this pull request, so the
          file list came from the files endpoint instead
          {diff.truncated ? ' and was truncated' : ''}. Some files will have no
          patch.
        </p>
      )}

      {unplaceable !== null && (
        <p className="notice" role="alert">
          {unplaceable}
        </p>
      )}

      {expansionError !== null && (
        // Pierre catches a rejected `loadDiffFiles`, logs it and leaves the
        // hunk shut — so without this the expander is a control that visibly
        // does nothing.
        <p className="notice" role="alert" data-expansion-error>
          {expansionError}
        </p>
      )}

      {files.length === 0 ? (
        <p className="placeholder">No changed files.</p>
      ) : (
        <CodeView<AnnotationMetadata>
          // Remounted when the file list is replaced wholesale — a refreshed
          // payload, or the switch to "changes since my last review". Through
          // 1.3.6 this was load-bearing: CodeView kept the code it first
          // rendered for an item id, so a new patch under an existing path
          // left the old diff on screen under the new headers. 1.4.1 draws the
          // new patch, and this stays for the weaker reason — every card's
          // collapsed and mode choice was made about a comparison that no
          // longer exists. Stable across every other render, because the
          // generation is derived from the list's identity.
          key={generation}
          ref={viewer}
          disableWorkerPool
          containerRef={scroller}
          options={options}
          items={items}
          onScroll={handleScroll}
          className="diff-view"
          renderCodeViewFooter={renderTail}
          renderAnnotation={renderAnnotation}
          renderCustomHeader={renderHeader}
        />
      )}
    </main>
  );
}
