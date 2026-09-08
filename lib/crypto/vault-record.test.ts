import { describe, expect, test } from 'vitest';
import { isVaultRecord, passphraseProblem } from './vault';
import { sealToken } from './vault';

/**
 * Storage hands back `unknown`. A vault that has been half-written, hand-edited
 * or left over from an older shape must be reported as "no usable vault"
 * rather than thrown at WebCrypto.
 */
describe('isVaultRecord', () => {
  test('accepts a record that sealToken actually produced', async () => {
    const record = await sealToken('token', 'a passphrase');

    expect(isVaultRecord(record)).toBe(true);
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a legacy plaintext token', 'github_pat_11ABCDEFG0'],
    ['an empty object', {}],
    ['a record missing its ciphertext', { v: 1, kdf: 'PBKDF2-SHA256', iterations: 1, salt: 'a', iv: 'b' }],
    ['a record from a future version', { v: 2, kdf: 'PBKDF2-SHA256', iterations: 1, salt: 'a', iv: 'b', ct: 'c' }],
    ['a record with a non-numeric iteration count', { v: 1, kdf: 'PBKDF2-SHA256', iterations: '600000', salt: 'a', iv: 'b', ct: 'c' }],
  ])('rejects %s', (_label, value) => {
    expect(isVaultRecord(value)).toBe(false);
  });
});

describe('passphraseProblem', () => {
  test('a reasonable passphrase has no problem', () => {
    expect(passphraseProblem('correct horse battery staple')).toBeNull();
  });

  test('an empty passphrase is reported', () => {
    expect(passphraseProblem('')).toContain('passphrase');
  });

  test('a short passphrase is reported with the length it needs', () => {
    const problem = passphraseProblem('short');

    expect(problem).toContain('8');
  });

  test('whitespace is allowed, because a passphrase is not a password', () => {
    // Padding out to the minimum with a real multi-word phrase, which is the
    // shape being encouraged.
    expect(passphraseProblem('two words')).toBeNull();
  });
});
