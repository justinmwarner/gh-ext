import type { DiffSide } from '../github/types';

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface DraftLocation {
  prId: string;
  path: string;
  line: number;
  side: DiffSide;
}

export const draftKey = (l: DraftLocation): string =>
  `draft:${l.prId}:${l.path}:${l.line}:${l.side}`;

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
