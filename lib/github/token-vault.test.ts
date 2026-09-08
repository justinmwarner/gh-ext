import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The provider used to be thin enough to exercise through the client. It is
 * not any more: it decides where the token lives, and the whole point of the
 * change is that one of those places must never see plaintext.
 */

interface Area {
  get(key?: string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
  raw: Map<string, unknown>;
}

const makeArea = (): Area => {
  const raw = new Map<string, unknown>();
  return {
    raw,
    async get(key) {
      if (key === undefined || key === null) return Object.fromEntries(raw);
      return raw.has(key) ? { [key]: raw.get(key) } : {};
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) raw.set(k, v);
    },
    async remove(key) {
      raw.delete(key);
    },
  };
};

const local = makeArea();
const session = makeArea();

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      get local() {
        return local;
      },
      get session() {
        return session;
      },
    },
  },
}));

const { ChromeTokenProvider, TOKEN_KEY, VAULT_KEY, SESSION_TOKEN_KEY } = await import(
  './token-provider'
);
const { WrongPassphraseError } = await import('../crypto/vault');

const TOKEN = `github_pat_${'A'.repeat(60)}`;
const PASSPHRASE = 'correct horse battery staple';

beforeEach(() => {
  local.raw.clear();
  session.raw.clear();
});

describe('vault state', () => {
  test('is empty with nothing stored', async () => {
    await expect(new ChromeTokenProvider().state()).resolves.toBe('empty');
  });

  test('is unlocked immediately after saving, so the reviewer can keep working', async () => {
    const provider = new ChromeTokenProvider();
    await provider.save(TOKEN, PASSPHRASE);

    await expect(provider.state()).resolves.toBe('unlocked');
    await expect(provider.getToken()).resolves.toBe(TOKEN);
  });

  test('is locked once the session token is gone', async () => {
    const provider = new ChromeTokenProvider();
    await provider.save(TOKEN, PASSPHRASE);
    await provider.lock();

    await expect(provider.state()).resolves.toBe('locked');
    await expect(provider.getToken()).resolves.toBeNull();
  });

  test('reports a legacy plaintext token as needing migration', async () => {
    local.raw.set(TOKEN_KEY, TOKEN);

    await expect(new ChromeTokenProvider().state()).resolves.toBe('legacy');
  });
});

describe('what reaches the disk', () => {
  test('saving writes no plaintext token to local storage', async () => {
    await new ChromeTokenProvider().save(TOKEN, PASSPHRASE);

    // The entire reason this feature exists.
    expect(JSON.stringify([...local.raw])).not.toContain(TOKEN);
  });

  test('the unlocked token lives only in session, which is never written to disk', async () => {
    await new ChromeTokenProvider().save(TOKEN, PASSPHRASE);

    expect(session.raw.get(SESSION_TOKEN_KEY)).toBe(TOKEN);
    expect(local.raw.has(SESSION_TOKEN_KEY)).toBe(false);
  });

  test('locking removes the plaintext from session', async () => {
    const provider = new ChromeTokenProvider();
    await provider.save(TOKEN, PASSPHRASE);
    await provider.lock();

    expect(JSON.stringify([...session.raw])).not.toContain(TOKEN);
  });
});

describe('unlocking', () => {
  test('the right passphrase brings the token back in a fresh session', async () => {
    const provider = new ChromeTokenProvider();
    await provider.save(TOKEN, PASSPHRASE);
    // What a browser restart does: session is gone, the vault in local is not.
    session.raw.clear();

    await provider.unlock(PASSPHRASE);

    await expect(provider.getToken()).resolves.toBe(TOKEN);
  });

  test('the wrong passphrase is refused and leaves the vault locked', async () => {
    const provider = new ChromeTokenProvider();
    await provider.save(TOKEN, PASSPHRASE);
    session.raw.clear();

    await expect(provider.unlock('wrong passphrase')).rejects.toThrow(WrongPassphraseError);

    await expect(provider.state()).resolves.toBe('locked');
    await expect(provider.getToken()).resolves.toBeNull();
  });

  test('unlocking an empty vault fails rather than pretending to succeed', async () => {
    await expect(new ChromeTokenProvider().unlock(PASSPHRASE)).rejects.toThrow();
  });
});

describe('migrating a legacy plaintext token', () => {
  test('a legacy token is not handed out before it has been encrypted', async () => {
    local.raw.set(TOKEN_KEY, TOKEN);

    // Refusing here is what forces the migration. Returning it would keep the
    // extension working and leave the plaintext on disk indefinitely.
    await expect(new ChromeTokenProvider().getToken()).resolves.toBeNull();
  });

  test('migrating seals the existing token and removes the plaintext', async () => {
    local.raw.set(TOKEN_KEY, TOKEN);
    const provider = new ChromeTokenProvider();

    await provider.migrate(PASSPHRASE);

    expect(local.raw.has(TOKEN_KEY)).toBe(false);
    expect(JSON.stringify([...local.raw])).not.toContain(TOKEN);
    await expect(provider.state()).resolves.toBe('unlocked');
    await expect(provider.getToken()).resolves.toBe(TOKEN);
  });
});

describe('clearing', () => {
  test('clear removes the vault, the session copy and any legacy plaintext', async () => {
    local.raw.set(TOKEN_KEY, 'a-legacy-token');
    const provider = new ChromeTokenProvider();
    await provider.save(TOKEN, PASSPHRASE);

    await provider.clear();

    expect(local.raw.has(VAULT_KEY)).toBe(false);
    expect(local.raw.has(TOKEN_KEY)).toBe(false);
    expect(session.raw.has(SESSION_TOKEN_KEY)).toBe(false);
    await expect(provider.state()).resolves.toBe('empty');
  });
});

describe('refusing a token that cannot be sent', () => {
  test('a token with an interior space is rejected before it is sealed', async () => {
    const provider = new ChromeTokenProvider();

    // Same guarantee tokenProblem already gave: fail where the reviewer can
    // still see what they pasted, not inside fetch three screens later.
    await expect(provider.save('github_pat_ has a space', PASSPHRASE)).rejects.toThrow(/space/);
    expect(local.raw.size).toBe(0);
  });
});
