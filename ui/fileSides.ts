/**
 * Both whole sides of one file, for the comparisons that need more than a patch.
 *
 * A patch carries the lines that moved. Every rich comparison needs the file:
 * a table has to be parsed to be aligned, a document has to be parsed to be
 * walked, and an image has no lines at all. So this asks the worker for each
 * side at its own commit and hands back either the contents or one sentence
 * saying why there are none.
 *
 * Nothing here calls `fetch`, and for images that is a real constraint rather
 * than a formality: the bytes arrive as base64 through the message channel and
 * become an object URL on this page. An `<img>` pointed at github.com would be
 * a network call from a context that must not make one, and would announce the
 * extension to any page watching its own request log.
 *
 * The cache is not an optimization either. `CodeView` recycles an item whenever
 * it scrolls out of the window, so a reviewer scrolling back up remounts the
 * card — and without this, every remount is another multi-megabyte trip through
 * the message channel for bytes the worker already had. It is bounded by count
 * and revokes the object URLs it evicts, because an unrevoked blob URL keeps
 * its bytes alive for the life of the page.
 */

import { useEffect, useRef, useState } from 'react';
import { type ImageSize, imageSize } from '@/lib/compare/imageSize';
import type { ChangeSides } from '@/lib/compare/modes';
import { decodeBase64 } from '@/lib/github/binary-blobs';
import { type PrRef, message } from '@/lib/messages';
import type { BlobRefs } from './blobLoader';
import { request } from './background';

/**
 * Why a side is not available, in words a reviewer can act on.
 *
 * The same three facts `blobLoader` names, phrased for a comparison that will
 * not be drawn at all rather than for an expander that will not open.
 */
const REASONS: Record<string, string> = {
  absent: 'that version of the file does not exist at that commit',
  'too-large': 'the file is too large to load in full',
  binary: 'the file is not text',
};

export interface LoadedImage {
  /** An object URL. Same-process, never remote. */
  url: string;
  byteLength: number;
  /**
   * Read from the file's header, not from a decoder, and null for a format
   * `imageSize` does not know.
   *
   * The comparison stage draws its layers absolutely positioned, so it has no
   * height of its own. Without this it stays zero pixels tall until the browser
   * decodes something and then inflates by the whole height of the image —
   * after the card is already on screen, which in a virtualized column reads as
   * the scroll sticking.
   */
  size: ImageSize | null;
}

type Loaded<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Sides already fetched, keyed by commit and path — which together name one
 * immutable blob, so nothing here ever goes stale.
 *
 * The promise is cached rather than the result, so two cards asking at once
 * make one request. A rejection is impossible: `load` resolves a failure as a
 * value, because a failed side is something the card has to draw rather than
 * something a caller has to catch.
 */
const cache = new Map<string, Promise<Loaded<unknown>>>();

/**
 * How many sides to keep.
 *
 * Counted rather than measured, and small: an entry may be four megabytes of
 * image, and the worker is still holding its own copy of everything here. This
 * exists to survive scrolling, not to be a second cache.
 */
const CACHE_LIMIT = 24;

function remember<T>(key: string, load: () => Promise<Loaded<T>>): Promise<Loaded<T>> {
  const running = cache.get(key);
  if (running !== undefined) return running as Promise<Loaded<T>>;

  const promise = load();
  cache.set(key, promise as Promise<Loaded<unknown>>);

  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done === true) break;
    const evicted = cache.get(oldest.value);
    cache.delete(oldest.value);
    // An object URL that is never revoked keeps its bytes alive for the life of
    // the page, so eviction has to reach through the promise to release them.
    void evicted?.then((value) => {
      if (value.ok && isImage(value.value)) URL.revokeObjectURL(value.value.url);
    });
  }

  return promise;
}

const isImage = (value: unknown): value is LoadedImage =>
  typeof (value as LoadedImage | null)?.url === 'string';

/** Forget everything. Test support, and the only way to reset module state. */
export function clearSideCache(): void {
  for (const entry of cache.values()) {
    void entry.then((value) => {
      if (value.ok && isImage(value.value)) URL.revokeObjectURL(value.value.url);
    });
  }
  cache.clear();
}

async function loadText(pr: PrRef, ref: string, path: string): Promise<Loaded<string>> {
  const response = await request(message('get-blob', { pr, path, ref }));
  if (!response.ok) return { ok: false, reason: response.error.message };
  if (response.data.status !== 'ok') {
    return {
      ok: false,
      reason: `${path} cannot be compared because ${REASONS[response.data.status] ?? 'it could not be read'}.`,
    };
  }
  return { ok: true, value: response.data.text };
}

async function loadImage(
  pr: PrRef,
  ref: string,
  path: string,
  mediaType: string,
): Promise<Loaded<LoadedImage>> {
  const response = await request(message('get-blob-bytes', { pr, path, ref }));
  if (!response.ok) return { ok: false, reason: response.error.message };
  if (response.data.status !== 'ok') {
    return {
      ok: false,
      reason: `${path} cannot be shown because ${REASONS[response.data.status] ?? 'it could not be read'}.`,
    };
  }

  const bytes = decodeBase64(response.data.base64);
  // The media type comes from the path rather than from GitHub, because it is
  // what decides how the browser will interpret these bytes and that decision
  // belongs to us. An SVG served this way is loaded by <img> in the mode that
  // runs no script and fetches nothing.
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mediaType }));
  return {
    ok: true,
    value: { url, byteLength: response.data.byteLength, size: imageSize(bytes) },
  };
}

export interface SidesRequest {
  refs: BlobRefs;
  /** Path in the head commit. */
  path: string;
  /** Path in the base commit. Differs only for a rename. */
  oldPath: string;
  sides: ChangeSides;
  /**
   * Whether to fetch at all.
   *
   * False while the card is showing the raw diff, which is the state a lockfile
   * and every unopened smart view start in. Without it, scrolling past fifty
   * JSON files would read a hundred blobs nobody asked for.
   */
  enabled: boolean;
}

export interface SidesState<T> {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  before: T | null;
  after: T | null;
  /** Why there is nothing to show. Null unless `status` is `failed`. */
  reason: string | null;
}

const IDLE = { status: 'idle', before: null, after: null, reason: null } as const;

/**
 * The shared body of both hooks.
 *
 * `load` is called at most once per side per commit; everything else here is
 * about not writing into a component that has moved on. Virtualization unmounts
 * cards mid-flight constantly, and a slow side resolving into a card that is no
 * longer on screen is a React warning at best and a stale render at worst.
 */
function useSides<T>(
  request_: SidesRequest,
  key: string,
  load: (ref: string, path: string) => Promise<Loaded<T>>,
): SidesState<T> {
  const [state, setState] = useState<SidesState<T>>(IDLE);
  // Read inside the effect, which must not re-run when only the loader's
  // identity changed — the caller builds it inline.
  const loader = useRef(load);
  loader.current = load;

  const { refs, path, oldPath, sides, enabled } = request_;
  const wanted = `${enabled ? 'on' : 'off'} ${key} ${refs.baseSha}..${refs.headSha} ${oldPath} ${path} ${sides}`;

  useEffect(() => {
    if (!enabled) {
      setState(IDLE);
      return;
    }

    let live = true;
    setState({ status: 'loading', before: null, after: null, reason: null });

    const before =
      sides === 'added'
        ? Promise.resolve<Loaded<T> | null>(null)
        : remember(`${key} ${refs.baseSha} ${oldPath}`, () =>
            loader.current(refs.baseSha, oldPath),
          );
    const after =
      sides === 'deleted'
        ? Promise.resolve<Loaded<T> | null>(null)
        : remember(`${key} ${refs.headSha} ${path}`, () => loader.current(refs.headSha, path));

    void Promise.all([before, after]).then(([one, two]) => {
      if (!live) return;
      const failure = [one, two].find((side) => side !== null && !side.ok);
      if (failure !== undefined && failure !== null && !failure.ok) {
        setState({ status: 'failed', before: null, after: null, reason: failure.reason });
        return;
      }
      setState({
        status: 'ready',
        before: one !== null && one.ok ? one.value : null,
        after: two !== null && two.ok ? two.value : null,
        reason: null,
      });
    });

    return () => {
      live = false;
    };
    // Every input is folded into one string so the effect cannot re-run because
    // the caller rebuilt an object it did not change.
  }, [wanted]);

  return state;
}

export function useTextSides(request_: SidesRequest): SidesState<string> {
  const pr = request_.refs.pr;
  return useSides(request_, 'text', (ref, path) => loadText(pr, ref, path));
}

export interface ImageSidesRequest extends SidesRequest {
  /** What to tell the browser these bytes are. Derived from the path. */
  mediaType: string;
}

export function useImageSides(request_: ImageSidesRequest): SidesState<LoadedImage> {
  const pr = request_.refs.pr;
  const mediaType = request_.mediaType;
  return useSides(request_, `image ${mediaType}`, (ref, path) =>
    loadImage(pr, ref, path, mediaType),
  );
}
