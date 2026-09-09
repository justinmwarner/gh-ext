/**
 * The two adapters that put extension storage behind interfaces the pure
 * modules already speak: `TokenProvider` for `GitHubClient`, and
 * `KeyValueStore` for `DraftStore` and `PrCache`.
 *
 * This is the one place in `lib/` that touches an extension API. It exists so
 * that `lib/github/client.ts`, `lib/review/drafts.ts` and `lib/cache.ts` stay
 * free of it and remain testable in plain Node.
 */

import { browser } from 'wxt/browser';
import type { TokenProvider } from './client';
import type { KeyValueStore } from '../review/drafts';
import { isVaultRecord, openVault, sealToken } from '../crypto/vault';

/**
 * The token, unencrypted, in `storage.local`.
 *
 * A supported way to store it, not a legacy one. Encryption is opt-in: most
 * people will never set a passphrase, and refusing to work until they do would
 * be trading their willingness to use the extension for a protection they did
 * not ask for.
 */
export const TOKEN_KEY = 'github-token';

/**
 * The sealed token, in `storage.local`.
 *
 * `local`, never `sync`. A `sync` value is replicated by Chrome to every
 * machine the profile is signed in on, which is not a decision to make on a
 * user's behalf for a credential — even an encrypted one.
 */
export const VAULT_KEY = 'github-token-vault';

/**
 * The decrypted token, in `storage.session`.
 *
 * `session` is memory-only and is dropped when the browser closes, which is
 * what makes the encryption worth anything: the plaintext never reaches a file.
 */
export const SESSION_TOKEN_KEY = 'github-token-unlocked';

export type StorageAreaName = 'local' | 'session';

/**
 * - `empty` — nothing configured.
 * - `plain` — a token stored without a passphrase. Usable, always.
 * - `locked` — an encrypted token, and the passphrase has not been entered.
 * - `unlocked` — an encrypted token, in use for this browser session.
 *
 * Only one of `plain` and the encrypted pair can exist at a time: every write
 * clears the other representation, so there is never a stale copy of the token
 * sitting behind the one in use.
 */
export type VaultState = 'empty' | 'plain' | 'locked' | 'unlocked';

const area = (name: StorageAreaName) =>
  name === 'session' ? browser.storage.session : browser.storage.local;

const readString = async (name: StorageAreaName, key: string): Promise<string | null> => {
  const stored = await area(name).get(key);
  const value = stored[key];
  return typeof value === 'string' && value !== '' ? value : null;
};

/**
 * The token, behind a passphrase.
 *
 * Reads `storage.session` on every call rather than caching: the options page
 * can lock or replace the token at any moment, and the background worker holds
 * a single long-lived `GitHubClient` that must not outlive a sign-out.
 *
 * `getToken` returning null means either nothing is configured or an encrypted
 * token is locked. Callers that only need a token do not care which; the UI
 * asks {@link state}, because "set one up" and "enter your passphrase" are very
 * different things to be told.
 */
export class ChromeTokenProvider implements TokenProvider {
  /**
   * The unlocked copy if there is one, otherwise the unencrypted token.
   *
   * Session first, so that an encrypted token in use wins over a plaintext one
   * that a half-finished write left behind.
   */
  async getToken(): Promise<string | null> {
    const unlocked = await readString('session', SESSION_TOKEN_KEY);
    if (unlocked !== null) return unlocked;
    return readString('local', TOKEN_KEY);
  }

  async state(): Promise<VaultState> {
    if ((await readString('session', SESSION_TOKEN_KEY)) !== null) return 'unlocked';
    const stored = await browser.storage.local.get(VAULT_KEY);
    if (isVaultRecord(stored[VAULT_KEY])) return 'locked';
    if ((await readString('local', TOKEN_KEY)) !== null) return 'plain';
    return 'empty';
  }

  /**
   * Store a token, encrypted if a passphrase is given.
   *
   * Omitting the passphrase is a supported choice, not a lesser one: the token
   * goes to `storage.local` as it stands, which is what every browser
   * extension holding a credential does by default.
   *
   * Throws for a token that cannot be sent, rather than storing it and letting
   * it fail opaquely on the first request. See {@link tokenProblem}.
   */
  async save(token: string, passphrase?: string): Promise<void> {
    const problem = tokenProblem(token);
    if (problem !== null) throw new Error(problem);

    const trimmed = token.trim();

    if (passphrase === undefined || passphrase === '') {
      await browser.storage.local.set({ [TOKEN_KEY]: trimmed });
      // Whatever was encrypted is gone: leaving the vault would mean a second
      // credential on disk that nothing reads and nobody remembers is there.
      await browser.storage.local.remove(VAULT_KEY);
      await browser.storage.session.remove(SESSION_TOKEN_KEY);
      return;
    }

    const record = await sealToken(trimmed, passphrase);
    await browser.storage.local.set({ [VAULT_KEY]: record });
    // The plaintext copy goes, or encrypting would leave the very thing it was
    // meant to protect sitting beside it in the same storage area.
    await browser.storage.local.remove(TOKEN_KEY);
    await browser.storage.session.set({ [SESSION_TOKEN_KEY]: trimmed });
  }

  /** Throws {@link WrongPassphraseError} for a bad passphrase. */
  async unlock(passphrase: string): Promise<void> {
    const stored = await browser.storage.local.get(VAULT_KEY);
    const record = stored[VAULT_KEY];
    if (!isVaultRecord(record)) {
      throw new Error('There is no encrypted token on this machine to unlock.');
    }
    const token = await openVault(record, passphrase);
    await browser.storage.session.set({ [SESSION_TOKEN_KEY]: token });
  }

  /** Forget the decrypted copy. The vault itself is untouched. */
  async lock(): Promise<void> {
    await browser.storage.session.remove(SESSION_TOKEN_KEY);
  }

  /**
   * Add a passphrase to a token that was stored without one.
   *
   * Saves re-entering the token to encrypt it, which is the difference between
   * a decision someone makes later and one they never get round to.
   */
  async encrypt(passphrase: string): Promise<void> {
    const plain = await readString('local', TOKEN_KEY);
    if (plain === null) {
      throw new Error('There is no unencrypted token on this machine to encrypt.');
    }
    await this.save(plain, passphrase);
  }

  /**
   * Drop the passphrase and keep the token.
   *
   * Only possible while unlocked, because the token has to be readable to be
   * written back — a locked vault has to be unlocked first, which is the same
   * proof of the passphrase that removing it should require anyway.
   */
  async decrypt(): Promise<void> {
    const token = await readString('session', SESSION_TOKEN_KEY);
    if (token === null) {
      throw new Error('Unlock the token before removing its passphrase.');
    }
    await this.save(token);
  }

  /** Remove every trace of the token: vault, session copy and legacy plaintext. */
  async clear(): Promise<void> {
    await browser.storage.local.remove(VAULT_KEY);
    await browser.storage.local.remove(TOKEN_KEY);
    await browser.storage.session.remove(SESSION_TOKEN_KEY);
  }
}

/**
 * A `KeyValueStore` over an extension storage area.
 *
 * `session` is cleared when the browser closes and is not written to disk,
 * which is what the pull request cache wants. `local` survives restarts, which
 * is what comment drafts want.
 */
export function chromeKeyValueStore(name: StorageAreaName = 'local'): KeyValueStore {
  const store = area(name);
  return {
    async get(key) {
      const stored = await store.get(key);
      const value = stored[key];
      return typeof value === 'string' ? value : null;
    },
    async set(key, value) {
      await store.set({ [key]: value });
    },
    async remove(key) {
      await store.remove(key);
    },
    async keys() {
      // `get(null)` returns the whole area. There is no key-listing API.
      return Object.keys(await store.get(null));
    },
  };
}

type Change = { oldValue?: unknown; newValue?: unknown } | undefined;

/** A write of the same value is not a change. */
const replaced = (change: Change): boolean =>
  change !== undefined && change.oldValue !== change.newValue;

/**
 * Whether the usable credential just changed in any way.
 *
 * Split out from the listeners so the decision can be tested without a
 * browser. Both areas are watched, for different reasons:
 *
 * - `local` holds the sealed vault. A replaced or cleared vault is a different
 *   token, or none.
 * - `session` holds the decrypted copy *and* the pull request cache, which is
 *   why the key is checked and not just the area.
 *
 * This is what the review page listens to: unlocking has to take it off the
 * locked screen and load the pull request it promised would appear.
 */
export function isTokenChange(
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: string,
): boolean {
  if (areaName === 'local') {
    // A re-seal of the same token produces a different record, so this cannot
    // tell a re-save from a new token. Treating it as a change is the safe
    // direction for both callers.
    return replaced(changes[VAULT_KEY]) || replaced(changes[TOKEN_KEY]);
  }
  if (areaName === 'session') return replaced(changes[SESSION_TOKEN_KEY]);
  return false;
}

/**
 * Whether cached reads no longer belong to whoever is signed in.
 *
 * {@link isTokenChange} minus one case. The background worker sweeps on this
 * rather than on every token change, because the first unlock of a browser
 * session is not a sign-out: `session` storage holds the cache too, so if the
 * token was absent the cache was empty. Sweeping there would be pure churn on
 * an event that happens every single time a browser opens.
 *
 * Locking *is* a sweep. Leaving a warm cache would keep whole pull requests
 * readable behind a vault the reviewer just locked.
 */
export function invalidatesCachedReads(
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: string,
): boolean {
  if (!isTokenChange(changes, areaName)) return false;

  const unlocked = changes[SESSION_TOKEN_KEY];
  if (areaName === 'session' && unlocked !== undefined && unlocked.oldValue === undefined) {
    return false;
  }
  return true;
}

/**
 * Why this token cannot be used, or null if it can.
 *
 * A token becomes an HTTP header value, and a header value cannot hold a line
 * break, an interior space or a non-ASCII character. `fetch` refuses one with
 * "Failed to construct 'Headers': Invalid value" — a TypeError saying nothing
 * about tokens, which the worker classifies as `unknown` and the page renders
 * as "Something went wrong", after the options page has already said "Token
 * saved."
 *
 * The realistic way to get one is copying out of a wrapped terminal line, or
 * out of a document that turned a hyphen into an en dash. Both are worth
 * catching where the reviewer can still see what they pasted.
 *
 * Surrounding whitespace is not a problem — it is trimmed, and a trailing
 * newline comes with almost every paste. Empty is not a problem either: that
 * is how the token is cleared.
 */
export function tokenProblem(raw: string): string | null {
  const token = raw.trim();
  if (token === '') return null;

  if (/\s/.test(token)) {
    return 'That token contains a space or a line break in the middle. It was probably copied across a wrapped line — paste it again as one piece.';
  }
  // Printable ASCII only, which is what a header value may hold.
  if (!/^[!-~]+$/.test(token)) {
    return 'That token contains a character GitHub tokens never use — often a smart quote or an en dash picked up from a document. Copy it from GitHub directly.';
  }
  return null;
}
