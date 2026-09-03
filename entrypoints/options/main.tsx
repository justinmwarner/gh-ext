/**
 * The options page.
 *
 * It writes the token to `storage.local` and asks the background worker to
 * check it. The page never calls GitHub itself — the worker owns the only
 * `GitHubClient`, so rate limit accounting stays in one place.
 */

import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChromeTokenProvider } from '@/lib/github/token-provider';
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
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [rateLimit, setRateLimit] = useState<RateLimitSnapshot | null>(null);

  const refreshRateLimit = useCallback(async () => {
    const response = await request(message('get-rate-limit', {}));
    setRateLimit(response.ok ? response.data : null);
  }, []);

  useEffect(() => {
    void tokens.getToken().then((stored) => setToken(stored ?? ''));
    void refreshRateLimit();
  }, [refreshRateLimit]);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      await tokens.setToken(token);
      setResult({
        tone: 'good',
        text: token.trim() === '' ? 'Token cleared.' : 'Token saved.',
      });
    } catch (error) {
      // A token that cannot be sent is refused here, where the reviewer can
      // still see what they pasted, rather than stored and left to fail as an
      // unrecognizable TypeError on the first request.
      setResult({
        tone: 'bad',
        text: error instanceof Error ? error.message : 'That token could not be saved.',
      });
    } finally {
      setBusy(false);
    }
  }, [token]);

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
      <h1>Fast GitHub Review</h1>

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
          <strong>Fast GitHub Review</strong>, and set an expiry. GitHub will not
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
          Paste it below, press <strong>Save token</strong>, then{' '}
          <strong>Validate saved token</strong>. A valid token answers with your
          GitHub username.
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
      <p className="hint">
        Saving replaces whatever is stored now. Saving an empty box clears the
        token, which is how you sign out.
      </p>

      <div className="actions">
        <button type="button" onClick={() => void save()} disabled={busy}>
          Save token
        </button>
        <button type="button" onClick={() => void validate()} disabled={busy}>
          Validate saved token
        </button>
      </div>

      {result && <p className={`result ${result.tone}`}>{result.text}</p>}

      <div className="warning">
        <h2>This token is stored unencrypted</h2>
        <p>
          The token is written verbatim to <code>chrome.storage.local</code>. It
          is not encrypted and it is not protected by a password.
        </p>
        <p>
          Anything running inside this extension can read it, and so can anyone
          who can read this browser profile's files on disk — including other
          software running under your user account.
        </p>
        <p>
          Use a fine-grained token limited to the repositories you review, give
          it the shortest expiry you can live with, and revoke it if this machine
          is shared or you suspect it is compromised.
        </p>
      </div>

      <h2>GitHub rate limit</h2>
      <RateLimit snapshot={rateLimit} />
    </main>
  );
}

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
