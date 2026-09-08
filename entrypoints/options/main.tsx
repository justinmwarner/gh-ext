/**
 * The options page.
 *
 * It seals the token into `storage.local` under a passphrase and asks the
 * background worker to check it. The page never calls GitHub itself — the
 * worker owns the only `GitHubClient`, so rate limit accounting stays in one
 * place.
 *
 * The vault has four states and this page is the only place all four are
 * reachable, so it is written as one screen per state rather than one screen
 * with things disabled on it.
 */

import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { passphraseProblem } from '@/lib/crypto/vault';
import { ChromeTokenProvider, type VaultState } from '@/lib/github/token-provider';
import {
  type MessageKind,
  type MessageOf,
  type Ok,
  type RateLimitSnapshot,
  type ResponseOf,
  isErr,
  message,
} from '@/lib/messages';
import { browser } from 'wxt/browser';

const tokens = new ChromeTokenProvider();

/**
 * Send a request and get its reply.
 *
 * The cast below is the one point where the protocol's types stop being
 * enforced — nothing at runtime proves the worker's reply matches `ResultOf<K>`
 * — so it is confined here and every caller above it stays type-safe.
 */
async function request<K extends MessageKind>(
  msg: MessageOf<K>,
): Promise<ResponseOf<K>> {
  let reply: unknown;
  try {
    reply = await browser.runtime.sendMessage(msg);
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: 'unknown',
        message: error instanceof Error ? error.message : String(error),
        resetAt: null,
      },
    };
  }

  if (isErr(reply)) return reply;
  if (typeof reply === 'object' && reply !== null && (reply as Ok<unknown>).ok === true) {
    return reply as ResponseOf<K>;
  }

  return {
    ok: false,
    error: {
      kind: 'unknown',
      // sendMessage resolves undefined when the worker failed to start.
      message: 'The background worker did not reply. Try reloading the extension.',
      resetAt: null,
    },
  };
}

type Result = { tone: 'good' | 'bad'; text: string } | null;

function RateLimit({ snapshot }: { snapshot: RateLimitSnapshot | null }) {
  if (snapshot === null) {
    return (
      <p className="hint">
        Unknown. The background worker reports the headers from its most recent
        GitHub request, and it has not made one since it last started. Validate a
        token to find out.
      </p>
    );
  }

  return (
    <dl>
      <dt>Remaining</dt>
      <dd>
        {snapshot.remaining} of {snapshot.limit}
      </dd>
      <dt>Resets</dt>
      <dd>{new Date(snapshot.resetAt).toLocaleString()}</dd>
    </dl>
  );
}

function App() {
  const [vault, setVault] = useState<VaultState | null>(null);
  const [token, setToken] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [rateLimit, setRateLimit] = useState<RateLimitSnapshot | null>(null);

  const refreshRateLimit = useCallback(async () => {
    const response = await request(message('get-rate-limit', {}));
    setRateLimit(response.ok ? response.data : null);
  }, []);

  const refreshVault = useCallback(async () => {
    setVault(await tokens.state());
  }, []);

  useEffect(() => {
    // The token is never read back into the page. It is not displayed, and an
    // unlocked vault is described rather than shown.
    void refreshVault();
    void refreshRateLimit();
  }, [refreshRateLimit, refreshVault]);

  /** Wipe the secrets held in component state once they have been used. */
  const forgetInputs = useCallback(() => {
    setToken('');
    setPassphrase('');
    setConfirm('');
  }, []);

  /**
   * Run a vault operation and report it in one place.
   *
   * Every one of these can fail in a way the reviewer has to read — a wrong
   * passphrase, a token with a smart quote in it — so none of them are allowed
   * to fail silently.
   */
  const run = useCallback(
    async (operation: () => Promise<void>, success: string) => {
      setBusy(true);
      setResult(null);
      try {
        await operation();
        setResult({ tone: 'good', text: success });
        forgetInputs();
      } catch (error) {
        setResult({
          tone: 'bad',
          text: error instanceof Error ? error.message : 'That did not work.',
        });
      } finally {
        await refreshVault();
        setBusy(false);
      }
    },
    [forgetInputs, refreshVault],
  );

  /** Shared by the first save and by migrating a legacy token. */
  const passphraseIssue = useCallback((): string | null => {
    const problem = passphraseProblem(passphrase);
    if (problem !== null) return problem;
    if (passphrase !== confirm) return 'The two passphrases do not match.';
    return null;
  }, [passphrase, confirm]);

  const save = useCallback(async () => {
    const problem = passphraseIssue();
    if (problem !== null) {
      setResult({ tone: 'bad', text: problem });
      return;
    }
    // A token that cannot be sent is refused inside `save`, where the reviewer
    // can still see what they pasted, rather than sealed and left to fail as an
    // unrecognizable TypeError on the first request.
    await run(() => tokens.save(token, passphrase), 'Token encrypted and unlocked.');
  }, [passphraseIssue, run, token, passphrase]);

  const migrate = useCallback(async () => {
    const problem = passphraseIssue();
    if (problem !== null) {
      setResult({ tone: 'bad', text: problem });
      return;
    }
    await run(
      () => tokens.migrate(passphrase),
      'Your existing token is now encrypted. The plaintext copy has been deleted.',
    );
  }, [passphraseIssue, run, passphrase]);

  const unlock = useCallback(
    () => run(() => tokens.unlock(passphrase), 'Unlocked for this browser session.'),
    [run, passphrase],
  );

  const lock = useCallback(
    () => run(() => tokens.lock(), 'Locked. The passphrase is needed again to review.'),
    [run],
  );

  const clear = useCallback(
    () => run(() => tokens.clear(), 'Token deleted from this machine.'),
    [run],
  );

  const validate = useCallback(async () => {
    setBusy(true);
    setResult(null);
    try {
      // Validate what is stored, not what is typed, so the answer describes the
      // token the worker will actually use.
      const response = await request(message('validate-token', {}));
      setResult(
        response.ok
          ? { tone: 'good', text: `Authenticated as ${response.data.login}.` }
          : { tone: 'bad', text: `${response.error.kind}: ${response.error.message}` },
      );
      await refreshRateLimit();
    } finally {
      setBusy(false);
    }
  }, [refreshRateLimit]);

  return (
    <main>
      <h1>A Better Reviewer</h1>

      {/* Only while there is no token to speak of. Once one is stored this is
          six inches of instructions for something already done. */}
      {vault === 'empty' && (
        <>
      <ol className="setup">
        <li>
          Open{' '}
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noreferrer noopener"
          >
            github.com/settings/personal-access-tokens/new
          </a>
          .
        </li>
        <li>
          Give it a name you will recognise later, such as{' '}
          <strong>A Better Reviewer</strong>, and set an expiry. GitHub will not
          show you the token again after you leave that page.
        </li>
        <li>
          Under <strong>Repository access</strong>, choose the repositories you
          review. <strong>Only select repositories</strong> is the safer choice;{' '}
          <strong>All repositories</strong> is less work but grants far more.
        </li>
        <li>
          Under <strong>Permissions &rarr; Repository permissions</strong>, set
          exactly these five and leave every other one at <em>No access</em>:
          <table className="perms">
            <thead>
              <tr>
                <th scope="col">Permission</th>
                <th scope="col">Access</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Pull requests</td>
                <td>
                  <strong>Read and write</strong>
                </td>
                <td>Read the review, and post comments, resolves and approvals</td>
              </tr>
              <tr>
                <td>Contents</td>
                <td>Read-only</td>
                <td>Fetch the diff, and whole files when you expand context</td>
              </tr>
              <tr>
                <td>Commit statuses</td>
                <td>Read-only</td>
                <td>Show the older-style commit statuses</td>
              </tr>
              <tr>
                <td>Checks</td>
                <td>Read-only</td>
                <td>
                  Show GitHub Actions runs. Without it GitHub refuses every
                  check run individually and the page can only say the checks
                  are hidden
                </td>
              </tr>
              <tr>
                <td>Metadata</td>
                <td>Read-only</td>
                <td>Required by GitHub whenever any other permission is set</td>
              </tr>
            </tbody>
          </table>
        </li>
        <li>
          Click <strong>Generate token</strong> and copy it. It starts with{' '}
          <code>github_pat_</code>.
        </li>
        <li>
          Paste it below and choose a passphrase to encrypt it with, then press{' '}
          <strong>Encrypt and save</strong>. The token is encrypted on this
          machine and unlocked with that passphrase once per browser session.
        </li>
      </ol>

      <p className="hint">
        If your repositories belong to an organisation, an owner may have to
        approve the token before it works. GitHub shows it as{' '}
        <em>Pending owner approval</em> on the token page, and until it is
        approved this extension will report the pull request as out of reach.
      </p>

      <label htmlFor="token">GitHub fine-grained personal access token</label>
      <input
        id="token"
        type="password"
        value={token}
        autoComplete="off"
        spellCheck={false}
        placeholder="github_pat_..."
        onChange={(event) => setToken(event.target.value)}
      />

      <label htmlFor="passphrase">Passphrase</label>
      <input
        id="passphrase"
        type="password"
        value={passphrase}
        autoComplete="new-password"
        spellCheck={false}
        onChange={(event) => setPassphrase(event.target.value)}
      />
      <label htmlFor="confirm">Passphrase again</label>
      <input
        id="confirm"
        type="password"
        value={confirm}
        autoComplete="new-password"
        spellCheck={false}
        onChange={(event) => setConfirm(event.target.value)}
      />
      <p className="hint">
        The passphrase encrypts the token on this machine. It is never stored
        and never sent anywhere, so it cannot be recovered — if you forget it,
        delete the token and paste a new one. A few ordinary words work better
        than one short cryptic one.
      </p>

      <div className="actions">
        <button type="button" onClick={() => void save()} disabled={busy}>
          Encrypt and save
        </button>
      </div>
        </>
      )}

      {vault === 'legacy' && (
        <>
          <div className="warning">
            <h2>Your token is stored unencrypted</h2>
            <p>
              This machine has a token saved from before this extension
              encrypted them. It is sitting in <code>chrome.storage.local</code>{' '}
              as plain text, readable by anything that can read this browser
              profile's files.
            </p>
            <p>
              Set a passphrase to encrypt it. The plaintext copy is deleted as
              soon as the encrypted one is written. Reviewing is disabled until
              then.
            </p>
          </div>

          <label htmlFor="passphrase">Passphrase</label>
          <input
            id="passphrase"
            type="password"
            value={passphrase}
            autoComplete="new-password"
            spellCheck={false}
            onChange={(event) => setPassphrase(event.target.value)}
          />
          <label htmlFor="confirm">Passphrase again</label>
          <input
            id="confirm"
            type="password"
            value={confirm}
            autoComplete="new-password"
            spellCheck={false}
            onChange={(event) => setConfirm(event.target.value)}
          />

          <div className="actions">
            <button type="button" onClick={() => void migrate()} disabled={busy}>
              Encrypt my existing token
            </button>
            <button type="button" onClick={() => void clear()} disabled={busy}>
              Delete it instead
            </button>
          </div>
        </>
      )}

      {vault === 'locked' && (
        <>
          <p>
            There is an encrypted token on this machine. Enter its passphrase to
            unlock it for this browser session.
          </p>

          <label htmlFor="passphrase">Passphrase</label>
          <input
            id="passphrase"
            type="password"
            value={passphrase}
            autoComplete="current-password"
            spellCheck={false}
            onChange={(event) => setPassphrase(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !busy) void unlock();
            }}
          />

          <div className="actions">
            <button type="button" onClick={() => void unlock()} disabled={busy}>
              Unlock
            </button>
            <button type="button" onClick={() => void clear()} disabled={busy}>
              Forget this token
            </button>
          </div>
          <p className="hint">
            The passphrase cannot be recovered. If it is lost, forget the token
            and paste a new one — nothing else on this machine is affected.
          </p>
        </>
      )}

      {vault === 'unlocked' && (
        <>
          <p>
            A token is saved and unlocked for this browser session. It is
            encrypted on disk and decrypted only in memory.
          </p>

          <div className="actions">
            <button type="button" onClick={() => void validate()} disabled={busy}>
              Validate saved token
            </button>
            <button type="button" onClick={() => void lock()} disabled={busy}>
              Lock now
            </button>
            <button type="button" onClick={() => void clear()} disabled={busy}>
              Delete token
            </button>
          </div>
          <p className="hint">
            Locking, closing the browser, or deleting the token all stop this
            extension reading GitHub until the passphrase is entered again. To
            replace the token, delete this one and paste a new one.
          </p>
        </>
      )}

      {result && <p className={`result ${result.tone}`}>{result.text}</p>}

      <div className="warning">
        <h2>What the passphrase does and does not protect</h2>
        <p>
          <strong>It protects the token on disk.</strong>{' '}
          <code>chrome.storage.local</code> is an ordinary file. Encrypting the
          token means another program running as you, a backup, or someone with
          the laptop cannot read it without the passphrase.
        </p>
        <p>
          <strong>It does not protect against this extension itself.</strong>{' '}
          While unlocked, the decrypted token is in memory and any code running
          inside the extension can read it. That is true of every browser
          extension that holds a credential, and no client-side design changes
          it.
        </p>
        <p>
          So it is still worth using a fine-grained token limited to the
          repositories you review, giving it the shortest expiry you can live
          with, and revoking it if you suspect this machine is compromised.
          <strong> This token can write to your pull requests</strong> — post
          comments, resolve threads and submit approvals as you.
        </p>
      </div>

      <h2>GitHub rate limit</h2>
      <RateLimit snapshot={rateLimit} />
    </main>
  );
}

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
