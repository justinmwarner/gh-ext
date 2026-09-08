/**
 * Passphrase encryption for the GitHub token.
 *
 * Pure WebCrypto, no extension APIs, so it runs and is tested under plain
 * Node. `lib/github/token-provider.ts` is what puts the result in storage.
 *
 * What this protects against: anything that can read the browser profile off
 * disk — other software under the same user account, a backup, a stolen
 * laptop. `chrome.storage.local` is a plain file.
 *
 * What it does not protect against: code running inside this extension. It can
 * wait for the unlock and read the token out of `storage.session`. Nothing
 * stored client-side survives that, and a key shipped inside the bundle would
 * only look like it did.
 */

/** PBKDF2-HMAC-SHA256 at the OWASP-recommended work factor. */
const ITERATIONS = 600_000;
const SALT_BYTES = 16;
/** 96 bits, the size AES-GCM is specified around. */
const IV_BYTES = 12;
const KEY_BITS = 256;

/**
 * What lands in `storage.local`. Self-describing so a later change to the work
 * factor can still open an old vault.
 */
export interface VaultRecord {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  /** base64 */
  salt: string;
  /** base64 */
  iv: string;
  /** base64 */
  ct: string;
}

/**
 * The passphrase did not open the vault.
 *
 * Also raised for a tampered record: AES-GCM cannot distinguish the two, and
 * the difference is not one a user can act on differently anyway.
 */
export class WrongPassphraseError extends Error {
  constructor() {
    super('That passphrase does not open this vault.');
    this.name = 'WrongPassphraseError';
  }
}

/**
 * The shortest passphrase this will seal a token under.
 *
 * Low, deliberately. The realistic attacker here already has the profile
 * directory, and a length rule that pushes people towards a sticky note is
 * worse than one they will actually use. The copy asks for a phrase.
 */
const MIN_PASSPHRASE = 8;

/**
 * Whether a stored value is a vault this build can open.
 *
 * Storage returns `unknown`, and the same area still holds a legacy plaintext
 * token during migration, so every field is checked rather than assumed.
 */
export function isVaultRecord(value: unknown): value is VaultRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.v === 1 &&
    record.kdf === 'PBKDF2-SHA256' &&
    typeof record.iterations === 'number' &&
    typeof record.salt === 'string' &&
    typeof record.iv === 'string' &&
    typeof record.ct === 'string'
  );
}

/**
 * Why this passphrase cannot be used, or null if it can.
 *
 * Mirrors `tokenProblem` in `lib/github/token-provider.ts`: the check is a
 * pure function so the options page can say what is wrong before anything is
 * written, rather than after.
 */
export function passphraseProblem(passphrase: string): string | null {
  if (passphrase === '') {
    return 'Enter a passphrase. It is what encrypts the token on this machine.';
  }
  if (passphrase.length < MIN_PASSPHRASE) {
    return `That passphrase is ${String(passphrase.length)} characters. Use at least ${String(MIN_PASSPHRASE)} — a few ordinary words beat a short cryptic one.`;
  }
  return null;
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

/**
 * Stretch the passphrase into an AES key.
 *
 * The salt is per-vault, so two people using the same passphrase do not share
 * a key, and a precomputed table is worthless against either.
 */
async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt a token under a passphrase.
 *
 * The policy is enforced here rather than only on the options page, so the
 * weakest vault this code can produce does not depend on which caller reached
 * it.
 */
export async function sealToken(token: string, passphrase: string): Promise<VaultRecord> {
  const problem = passphraseProblem(passphrase);
  if (problem !== null) throw new Error(problem);

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, ITERATIONS);

  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(token),
  );

  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(ct)),
  };
}

/**
 * Decrypt a token, or throw {@link WrongPassphraseError}.
 *
 * The iteration count comes off the record, not from the constant above, so
 * raising the work factor later does not lock anyone out of an old vault.
 */
export async function openVault(record: VaultRecord, passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase, fromBase64(record.salt), record.iterations);

  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(record.iv) as BufferSource },
      key,
      fromBase64(record.ct) as BufferSource,
    );
  } catch {
    // The only failure WebCrypto reports here is the authentication tag not
    // matching, which is a wrong passphrase or a modified record.
    throw new WrongPassphraseError();
  }

  return new TextDecoder().decode(plain);
}
