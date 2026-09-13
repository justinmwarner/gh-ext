/**
 * The body of a card that is not showing a text diff.
 *
 * One component decides which comparison a file gets, because the decision is
 * one thing: the mode the reviewer chose, and the kind the file is. Everything
 * below it is a renderer that has already been handed its two sides.
 *
 * It also owns the states between "the reviewer pressed a mode" and "the
 * comparison is on screen", and those states are the reason this is not four
 * separate components. Both sides have to be read whole from the worker; that
 * takes a moment, it can fail, and it can honestly come back with nothing —
 * a base side that does not exist, a file too large to move. Each of those has
 * to say so in a sentence, because a card that renders empty is
 * indistinguishable from one that failed, and this feature adds four new ways
 * for a card to render empty.
 *
 * The hooks are called unconditionally and gated by `enabled`, which is what
 * React requires and also what keeps a JSON file from fetching image bytes.
 */

import { useMemo } from 'react';
import {
  type ComparisonKind,
  RAW,
  changeSides,
  comparisonKind,
  imageMediaType,
  syntaxOf,
} from '@/lib/compare/modes';
import { compareMarkdown } from '@/lib/compare/markdown';
import { compareNotebooks, parseNotebook } from '@/lib/compare/notebook';
import { compareStructured } from '@/lib/compare/structured';
import { compareTables, delimiterFor, parseDelimited } from '@/lib/compare/tabular';
import { commentableLines } from '@/lib/review/commentable';
import type { BlobRefs } from './blobLoader';
import { useImageSides, useTextSides } from './fileSides';
import { ImageCompare, type ImageVariant } from './ImageCompare';
import { JsonFormatted, JsonKeyPaths } from './JsonCompare';
import { MarkdownCompare, type UnplacedComments } from './MarkdownCompare';
import { NotebookCompare } from './NotebookCompare';
import type { ReviewFile } from './reviewFiles';
import { TableCompare } from './TableCompare';

/** Which side-loader a kind needs. Images and SVG want bytes; the rest, text. */
const NEEDS_BYTES: ReadonlySet<ComparisonKind> = new Set<ComparisonKind>(['image', 'svg']);

/** The image variant a mode id asks for, for the two kinds that share a renderer. */
const VARIANTS: Record<string, ImageVariant> = {
  'image:side-by-side': 'side-by-side',
  'image:swipe': 'swipe',
  'image:onion': 'onion',
  'image:difference': 'difference',
  'svg:side-by-side': 'side-by-side',
  'svg:difference': 'difference',
};

export interface RichCompareProps {
  file: ReviewFile;
  /** The mode this card is in. Already resolved against what the file offers. */
  mode: string;
  /**
   * The two commits to read whole files from.
   *
   * Null when there is no base commit — an older cached payload — and in that
   * state no rich comparison can be built at all, so the card says so rather
   * than showing a control that never resolves.
   */
  refs: BlobRefs | null;
  /**
   * Whether a line number in the diff on screen means what a line number in the
   * pull request's own diff means.
   *
   * False while a narrowed scope is showing, and it is the one thing here that
   * cannot be got wrong quietly. The rendered Markdown view is built from the
   * two commits `refs` names, so under a narrowed scope its blocks are lines of
   * *that* compare — and `addPullRequestReviewThread` has nowhere to say which
   * commit a line was counted in. A comment posted from such a block would look
   * posted, on prose the reviewer never read. `lib/review/diffScope.ts` has the
   * whole argument; `composerFor` refuses for the same reason one file over.
   *
   * A boolean rather than `AnchorableSides` because the object is rebuilt every
   * render, and this one travels through a `renderAnnotation` callback whose
   * identity decides whether Pierre rebuilds a row.
   */
  anchorable: boolean;
  /**
   * Where the rendered Markdown view sends the comments it has no block for.
   *
   * A pass-through and nothing more, but it is not optional at either end. The
   * rendered view is the only thing that knows which lines its blocks cover,
   * and a card whose body drops that answer on the floor is a card that never
   * tells the reviewer a comment exists. `FileBody` owns the drawer it goes to.
   */
  onUnplaced: (unplaced: UnplacedComments) => void;
}

export function RichCompare({
  file,
  mode,
  refs,
  anchorable,
  onUnplaced,
}: RichCompareProps) {
  const kind = comparisonKind(file);
  const sides = changeSides(file);
  const active = mode !== RAW.id && kind !== 'none' && refs !== null;

  // A placeholder rather than a null: the hooks below cannot be skipped, and
  // the `enabled` flag is what actually stops them fetching.
  const blobs: BlobRefs =
    refs ?? { pr: { owner: '', repo: '', number: 0 }, baseSha: '', headSha: '' };

  const mediaType = imageMediaType(file.path === '' ? file.oldPath : file.path);

  const bytes = useImageSides({
    refs: blobs,
    path: file.path,
    oldPath: file.oldPath,
    sides,
    enabled: active && NEEDS_BYTES.has(kind) && mediaType !== null,
    mediaType: mediaType ?? 'application/octet-stream',
  });

  const text = useTextSides({
    refs: blobs,
    path: file.path,
    oldPath: file.oldPath,
    sides,
    enabled: active && !NEEDS_BYTES.has(kind),
  });

  const table = useMemo(() => {
    if (kind !== 'table' || text.status !== 'ready') return null;
    const named = file.path === '' ? file.oldPath : file.path;
    // Sniffed from whichever side exists: a semicolon-delimited export read as
    // commas is one enormous column and every row of it reads as changed.
    const delimiter = delimiterFor(named, text.after ?? text.before ?? '');
    return compareTables(
      parseDelimited(text.before ?? '', delimiter),
      parseDelimited(text.after ?? '', delimiter),
    );
  }, [kind, text.status, text.before, text.after, file.path, file.oldPath]);

  // Which of the three spellings this file is written in. Null for everything
  // else, which is also what keeps the structural block below from running.
  const syntax = syntaxOf(file);

  const structured = useMemo(
    () =>
      syntax === null || text.status !== 'ready'
        ? null
        : compareStructured(text.before, text.after, syntax),
    [syntax, text.status, text.before, text.after],
  );

  // Rendering and word-diffing two documents, which is the expensive step in
  // this file — see `HTML_DIFF_BUDGET`. Memoized on the two sides, so a
  // re-render caused by anything else on the card does not pay for it again.
  //
  // The nonce is minted here rather than in `lib/` because `lib/` is pure and
  // has no source of randomness, and it is minted *inside the memo* so that it
  // is exactly as stable as the document it stamps: one value for as long as
  // the two sides do not move, a fresh one the moment they do. A nonce hoisted
  // to module scope, or held in a ref for the life of the card, would be a
  // value the reviewer's own browser has already put in the DOM once — and the
  // whole of `markdownAnchors.ts` rests on a `.md` file never having seen the
  // nonce its anchors will be checked against.
  const markdown = useMemo(
    () =>
      kind !== 'markdown' || text.status !== 'ready'
        ? null
        : compareMarkdown(text.before, text.after, crypto.randomUUID()),
    [kind, text.status, text.before, text.after],
  );

  /**
   * Which lines of this file a comment on a rendered block could name.
   *
   * Empty when the diff on screen is not the pull request's own, which is not a
   * degradation so much as the honest answer: every block then falls back to a
   * file-level comment, and a file-level comment names no line and is right in
   * any scope. Memoized because the walk is over the whole patch and a document
   * of several hundred blocks asks the result one question each.
   */
  const commentable = useMemo(
    () => (anchorable ? commentableLines(file.patch) : new Set<string>()),
    [anchorable, file.patch],
  );

  const notebook = useMemo(() => {
    if (kind !== 'notebook' || text.status !== 'ready') return null;
    const before = parseNotebook(text.before ?? '{"cells":[]}');
    const after = parseNotebook(text.after ?? '{"cells":[]}');
    return {
      comparison: compareNotebooks(before, after),
      // Whichever side declared one. A deleted notebook still has a language.
      languageExtension:
        after.languageExtension === 'txt' ? before.languageExtension : after.languageExtension,
    };
  }, [kind, text.status, text.before, text.after]);

  if (!active) return null;

  if (refs === null) {
    return (
      <p className="file-note" role="note">
        This pull request was loaded before the base commit was known, so there
        is nothing to compare against. Reload the page to fix it.
      </p>
    );
  }

  const loading = NEEDS_BYTES.has(kind) ? bytes : text;
  if (loading.status === 'loading' || loading.status === 'idle') {
    return (
      <p className="file-note" role="status">
        Reading both versions of {file.path}…
      </p>
    );
  }
  if (loading.status === 'failed') {
    return (
      <p className="file-note" role="alert">
        {loading.reason} Raw shows the change as GitHub sent it.
      </p>
    );
  }

  if (NEEDS_BYTES.has(kind)) {
    const variant = VARIANTS[mode];
    if (variant === undefined) return null;
    return (
      <ImageCompare
        variant={variant}
        path={file.path === '' ? file.oldPath : file.path}
        before={bytes.before}
        after={bytes.after}
      />
    );
  }

  if (table !== null) {
    return <TableCompare comparison={table} changedOnly={mode === 'table:changed-rows'} />;
  }

  if (structured !== null && syntax !== null) {
    return mode === 'structured:formatted' ? (
      <JsonFormatted
        path={file.path}
        syntax={syntax}
        before={text.before}
        after={text.after}
      />
    ) : (
      <JsonKeyPaths comparison={structured} />
    );
  }

  if (notebook !== null) {
    return (
      <NotebookCompare
        comparison={notebook.comparison}
        languageExtension={notebook.languageExtension}
        showOutputs={mode === 'notebook:outputs'}
      />
    );
  }

  if (markdown !== null) {
    return (
      <MarkdownCompare
        comparison={markdown}
        path={file.path}
        commentable={commentable}
        onUnplaced={onUnplaced}
      />
    );
  }

  return null;
}
