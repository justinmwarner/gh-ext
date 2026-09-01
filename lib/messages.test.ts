import { describe, expect, it } from 'vitest';
import { type Message, isMessage, message } from './messages';

const pr = { owner: 'octocat', repo: 'hello-world', number: 42 };

describe('message', () => {
  it('stamps the discriminant so no caller writes the kind by hand', () => {
    expect(message('prefetch-pr', { pr })).toEqual({ kind: 'prefetch-pr', pr });
  });

  it('carries the payload through untouched', () => {
    expect(message('get-pr', { pr, refresh: true })).toEqual({
      kind: 'get-pr',
      pr,
      refresh: true,
    });
  });

  it('builds an empty-payload message', () => {
    expect(message('validate-token', {})).toEqual({ kind: 'validate-token' });
  });
});

describe('isMessage', () => {
  it('accepts every kind the protocol declares', () => {
    const all: Message[] = [
      message('prefetch-pr', { pr }),
      message('open-review', { pr }),
      message('get-pr', { pr }),
      message('mutate', { document: 'mutation {}', variables: {} }),
      message('validate-token', {}),
      message('get-rate-limit', {}),
    ];
    for (const m of all) expect(isMessage(m)).toBe(true);
  });

  it('rejects an unknown kind', () => {
    expect(isMessage({ kind: 'drop-database' })).toBe(false);
  });

  it('rejects values that are not messages at all', () => {
    expect(isMessage(null)).toBe(false);
    expect(isMessage(undefined)).toBe(false);
    expect(isMessage('get-pr')).toBe(false);
    expect(isMessage({})).toBe(false);
    expect(isMessage({ kind: 7 })).toBe(false);
  });

  it('does not mistake inherited Object properties for a kind', () => {
    expect(isMessage({ kind: 'toString' })).toBe(false);
    expect(isMessage({ kind: 'constructor' })).toBe(false);
  });
});
