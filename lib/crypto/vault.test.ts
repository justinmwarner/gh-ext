import { describe, expect, test } from 'vitest';
import { WrongPassphraseError, openVault, sealToken } from './vault';

/**
 * The vault is the only thing standing between a stolen browser profile and a
 * GitHub token with write access to pull requests, so these tests are about
 * the guarantees rather than the shape of the record.
 *
 * WebCrypto is used directly, which is why these run under Node with no
 * browser: `globalThis.crypto.subtle` is the same implementation.
 */

const TOKEN = 'github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz0123456789ABCDEFGHIJ';
const PASSPHRASE = 'correct horse battery staple';

describe('sealToken / openVault', () => {
  test('a sealed token comes back out under the same passphrase', async () => {
    const record = await sealToken(TOKEN, PASSPHRASE);

    await expect(openVault(record, PASSPHRASE)).resolves.toBe(TOKEN);
  });

  test('the token does not appear anywhere in the sealed record', async () => {
    const record = await sealToken(TOKEN, PASSPHRASE);

    // The record is what lands in storage.local. If the token is recoverable
    // from it without the passphrase then none of this bought anything.
    expect(JSON.stringify(record)).not.toContain(TOKEN);
  });

  test('the wrong passphrase is refused, and says so specifically', async () => {
    const record = await sealToken(TOKEN, PASSPHRASE);

    // A distinct error type, because "wrong passphrase" is the one failure the
    // UI must phrase differently from a corrupt or missing vault.
    await expect(openVault(record, 'not the passphrase')).rejects.toThrow(WrongPassphraseError);
  });

  test('a tampered ciphertext is refused rather than decrypted to garbage', async () => {
    const record = await sealToken(TOKEN, PASSPHRASE);
    const flipped = [...atob(record.ct)];
    flipped[0] = flipped[0] === 'A' ? 'B' : 'A';
    const tampered = { ...record, ct: btoa(flipped.join('')) };

    // This is AES-GCM's authentication tag doing the work. Without it an
    // attacker could flip bits in the stored token and we would hand the
    // result to GitHub.
    await expect(openVault(tampered, PASSPHRASE)).rejects.toThrow(WrongPassphraseError);
  });

  test('sealing the same token twice produces different records', async () => {
    const first = await sealToken(TOKEN, PASSPHRASE);
    const second = await sealToken(TOKEN, PASSPHRASE);

    // Fresh salt and IV per seal. Reusing either under one key is the classic
    // way to make AES-GCM leak.
    expect(first.salt).not.toBe(second.salt);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ct).not.toBe(second.ct);
  });

  test('an empty passphrase is not a passphrase', async () => {
    await expect(sealToken(TOKEN, '')).rejects.toThrow();
  });

  test('a passphrase too short for the policy is refused at the seal, not just in the UI', async () => {
    // The options page checks this before calling, but the check that matters
    // is the one that cannot be skipped by reaching the storage layer directly.
    await expect(sealToken(TOKEN, 'short')).rejects.toThrow(/at least 8/);
  });
});
