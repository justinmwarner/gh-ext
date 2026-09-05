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
import { compareNotebooks, parseNotebook } from '@/lib/compare/notebook';
import { compareStructured } from '@/lib/compare/structured';
import { compareTables, delimiterFor, parseDelimited } from '@/lib/compare/tabular';
import type { BlobRefs } from './blobLoader';
import { useImageSides, useTextSides } from './fileSides';
import { ImageCompare, type ImageVariant } from './ImageCompare';
import { JsonFormatted, JsonKeyPaths } from './JsonCompare';
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
}

export function RichCompare({ file, mode, refs }: RichCompareProps) {
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

  return null;
}
