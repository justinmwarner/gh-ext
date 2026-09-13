import type { CommentAnchor } from './selection';

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/**
 * Where a half-written comment belongs.
 *
 * The anchor rather than a line and a side, because a comment may now be about
 * the file: the rendered Markdown view draws the whole document, so most of
 * what a reviewer can point at is outside every hunk and posts with
 * `subjectType: FILE`. A nullable `line` was the alternative and is the shape
 * GitHub's own thread carries, which is exactly why `CommentAnchor` is
 * discriminated — see the argument in `./selection.ts`.
 */
export interface DraftLocation {
  prId: string;
  path: string;
  anchor: CommentAnchor;
}

/**
 * The key a draft is stored under.
 *
 * **The line branch is byte-for-byte what it has always been.** A draft is the
 * copy that survives the tab closing, so a reviewer who updates the extension
 * mid-sentence must find their sentence where they left it; changing the
 * spelling would silently orphan every draft in storage and there is no
 * migration worth writing for a string this short.
 *
 * A file comment takes the `file` suffix, which no line draft can produce: the
 * last segment of a line key is a `DiffSide`, and `LEFT` and `RIGHT` are the
 * only two values that type has. That is what keeps the two families apart
 * whatever a path contains — a path is free to end in `:12:RIGHT` and still
 * cannot be mistaken for the line draft of a shorter one.
 */
export const draftKey = (l: DraftLocation): string =>
  l.anchor.subject === 'file'
    ? `draft:${l.prId}:${l.path}:file`
    : `draft:${l.prId}:${l.path}:${l.anchor.line}:${l.anchor.side}`;

export class DraftStore {
  constructor(private readonly store: KeyValueStore) {}

  /** Saving whitespace clears instead, so abandoned composers leave nothing behind. */
  async save(location: DraftLocation, body: string): Promise<void> {
    if (body.trim() === '') return this.clear(location);
    await this.store.set(draftKey(location), body);
  }

  load(location: DraftLocation): Promise<string | null> {
    return this.store.get(draftKey(location));
  }

  clear(location: DraftLocation): Promise<void> {
    return this.store.remove(draftKey(location));
  }

  async listFor(prId: string): Promise<string[]> {
    const prefix = `draft:${prId}:`;
    return (await this.store.keys()).filter((k) => k.startsWith(prefix));
  }
}
