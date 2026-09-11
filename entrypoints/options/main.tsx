/**
 * The options page.
 *
 * It stores the token — encrypted under a passphrase if the reviewer asked for
 * that, plainly if they did not — and asks the background worker to check it. The page never calls GitHub itself — the
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
import { logWarn } from '@/lib/log';
import { ChromeTokenProvider, type VaultState } from '@/lib/github/token-provider';
import {
  type MessageKind,
  type MessageOf,
  type Ok,
  type ProtocolError,
  type RateLimitSnapshot,
  type ResponseOf,
  isErr,
  message,
} from '@/lib/messages';
import {
  DEFAULT_SETTINGS,
  type OpenIn,
  type Settings,
  autoOpenAvailable,
} from '@/lib/settings';
import {
  ACCESSIBLE_THEMES,
  DARK_THEMES,
  LIGHT_THEMES,
  THEME_FOLLOWS_PAGE,
} from '@/lib/compare/themes';
import { followLoggingSetting, readSettings, writeSettings } from '@/lib/settings-store';
import { summarizeDiagnosis } from '@/ui/diagnosisSummary';
import { browser } from 'wxt/browser';
// Before the stylesheet, not after: everything in it refers to these by name.
import '@/ui/tokens.css';
import './style.css';

/**
 * A refused token check, in the line under the button.
 *
 * It used to be `${kind}: ${message}`, which answered an expired token with
 * `unknown: GitHub request failed: 404` — a sentence that names neither the
 * problem nor the remedy, and reads as a bug in the extension rather than a
 * fact about the token.
 *
 * GitHub's own words are kept on the end whenever they add something the
 * summary does not already say, because they are the only part specific to
 * what actually happened.
 */
function explainRefusal(error: ProtocolError): string {
  const summary = error.diagnosis ? summarizeDiagnosis(error.diagnosis) : null;
  if (summary === null) return error.message;
  const said = error.diagnosis?.observed.find((line) => line.startsWith('GitHub said'));
  return said === undefined ? summary : `${summary} ${said}`;
}

const tokens = new ChromeTokenProvider();

/** In the order they are offered, most useful first. */
const DESTINATIONS: { value: OpenIn; label: string; hint: string }[] = [
  {
    value: 'new-tab',
    label: 'A new tab',
    hint: 'Beside the pull request it came from, which stays open behind it.',
  },
  {
    value: 'new-window',
    label: 'A new window',
    hint: 'For a second monitor, or beside the pull request rather than over it.',
  },
  {
    value: 'same-tab',
    label: 'This tab',
    hint: 'The review replaces the pull request page.',
  },
];

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

/**
 * Every preference this extension has, in two sections.
 *
 * Saved on change rather than behind a Save button. These are preferences, not
 * a credential: there is nothing to validate, nothing to get half-typed, and
 * the effect of getting one wrong is one tab in the wrong place.
 *
 * One component for both sections because they are one stored object, and a
 * second copy of the read-modify-write below is how two of them start
 * overwriting each other's fields.
 */
function Preferences() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    void readSettings()
      .then(setSettings)
      // A settings area that cannot be read is not a reason to show nothing.
      // The defaults are what the worker would use anyway.
      .catch(() => setSettings({ ...DEFAULT_SETTINGS }));
  }, []);

  const update = useCallback(
    (patch: Partial<Settings>) => {
      if (!settings) return;
      const next: Settings = { ...settings, ...patch };
      // Moving to the same tab takes auto-open down with it. Leaving the stored
      // flag set would mean switching back to a new tab silently re-enabled
      // something the reviewer last saw greyed out.
      if (!autoOpenAvailable(next.openIn)) next.autoOpen = false;

      setSettings(next);
      void writeSettings(next).catch((error: unknown) => {
        logWarn('could not save settings', error);
      });
    },
    [settings],
  );

  if (!settings) return null;

  const autoAvailable = autoOpenAvailable(settings.openIn);

  return (
    <>
      <section className="settings">
        <h2>Reviewing</h2>

        <fieldset className="choices">
          <legend>Open reviews in</legend>
          {DESTINATIONS.map((destination) => (
            <label key={destination.value}>
              <input
                type="radio"
                name="openIn"
                value={destination.value}
                checked={settings.openIn === destination.value}
                onChange={() => update({ openIn: destination.value })}
              />
              <span>
                {destination.label}
                <span className="hint">{destination.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="check">
          <input
            type="checkbox"
            checked={settings.autoOpen}
            disabled={!autoAvailable}
            onChange={(event) => update({ autoOpen: event.target.checked })}
          />
          <span>
            Open a review automatically when I land on a pull request
            <span className="hint">
              {autoAvailable
                ? 'Opened in the background and left there, so nothing moves while you are reading. The card is still on the page if you close it and want it back.'
                : 'Not available when reviews open in this tab: it would replace the pull request the moment you arrived, and going back would immediately do it again.'}
            </span>
          </span>
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={settings.debugLogging}
            onChange={(event) => update({ debugLogging: event.target.checked })}
          />
          <span>
            Write diagnostics to the browser console
            <span className="hint">
              Off by default, and off is the right setting unless you are
              investigating something. This extension runs on every github.com
              page, so anything it logs lands in a console you are probably
              using for your own work. Turn it on before reporting a bug, then
              turn it back off.
            </span>
          </span>
        </label>
      </section>

      {/* Its own section rather than two more checkboxes above. Everything up
          there answers "what happens when I open a review"; these two answer
          "what does a diff look like once it is open", and they are the only
          settings on this page that change what the reviewer is looking at
          rather than what the extension does. */}
      <section className="settings">
        <h2>Reading a diff</h2>

        <label className="check">
          <input
            type="checkbox"
            checked={settings.splitView}
            onChange={(event) => update({ splitView: event.target.checked })}
          />
          <span>
            Show the old and new file side by side
            <span className="hint">
              Two columns instead of one, on every file of every pull request.
              Nothing is hidden either way — it is the same changes, arranged
              differently.
            </span>
          </span>
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={settings.hideGenerated}
            onChange={(event) => update({ hideGenerated: event.target.checked })}
          />
          <span>
            Fold away the diffs of generated files
            <span className="hint">
              Lockfiles, minified bundles, protobuf stubs, snapshots and vendored
              trees. Each one stays in the list with its name and its counts, says
              on its own row that it was folded, and opens with one press —
              nothing becomes unknowable, it just stops sitting between the files
              somebody wrote. A repository that marks its own files{' '}
              <code>linguist-generated</code> in <code>.gitattributes</code> is
              obeyed in preference to any of that, in both directions.
            </span>
          </span>
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={settings.ignoreWhitespace}
            onChange={(event) => update({ ignoreWhitespace: event.target.checked })}
          />
          <span>
            Hide changes where only the whitespace moved
            <span className="hint">
              Reindented and rewrapped lines stop counting as changes, which is
              what makes a reformat readable. This is the one setting here that{' '}
              <strong>removes lines from the diff</strong>, so every file it
              shortens says so above its body, and a comment left on a line that
              only moved is listed rather than quietly dropped.
            </span>
          </span>
        </label>

        {/* A select rather than a radio set: seventy-five options is a list to
            be searched, not a set to be compared, and a native select is the
            one control that already types-to-find and scrolls on every
            platform. Grouped by the mode each theme was built for, with the
            four that answer colour vision deficiency first — they are the
            reason this setting exists rather than a curiosity in it. */}
        <label className="field" htmlFor="diffTheme">
          Syntax colours
          <select
            id="diffTheme"
            value={settings.diffTheme}
            onChange={(event) => update({ diffTheme: event.target.value })}
          >
            <option value={THEME_FOLLOWS_PAGE}>
              Match the page (default)
            </option>
            <optgroup label="Made for colour vision deficiency">
              {ACCESSIBLE_THEMES.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Light">
              {LIGHT_THEMES.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Dark">
              {DARK_THEMES.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.label}
                </option>
              ))}
            </optgroup>
          </select>
          <span className="hint">
            Only the code inside a diff, not the page around it. Left on{' '}
            <strong>Match the page</strong> the diff follows your system between
            light and dark; choosing a theme means that one theme in both.
            {' '}Every theme is already in the extension, so picking one costs no
            download.
            <br />
            Worth changing if the default is hard to read: its dimmest token
            measures 2.14:1 against a white page, where text wants 4.5:1. The
            two <strong>high contrast</strong> entries go the other way, and the
            group at the top redraws additions and deletions so they do not rely
            on telling red from green.
          </span>
        </label>
      </section>
    </>
  );
}

function App() {
  const [vault, setVault] = useState<VaultState | null>(null);
  const [token, setToken] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  // Unchecked by default. Encryption is worth offering and not worth forcing:
  // a setup step nobody asked for is where people give up.
  const [usePassphrase, setUsePassphrase] = useState(false);
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
    void followLoggingSetting();
  }, [refreshRateLimit, refreshVault]);

  /** Wipe the secrets held in component state once they have been used. */
  const forgetInputs = useCallback(() => {
    setToken('');
    setPassphrase('');
    setConfirm('');
    setUsePassphrase(false);
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
    if (!usePassphrase) {
      await run(() => tokens.save(token), 'Token saved.');
      return;
    }
    const problem = passphraseIssue();
    if (problem !== null) {
      setResult({ tone: 'bad', text: problem });
      return;
    }
    // A token that cannot be sent is refused inside `save`, where the reviewer
    // can still see what they pasted, rather than stored and left to fail as an
    // unrecognizable TypeError on the first request.
    await run(() => tokens.save(token, passphrase), 'Token encrypted and saved.');
  }, [usePassphrase, passphraseIssue, run, token, passphrase]);

  const encrypt = useCallback(async () => {
    const problem = passphraseIssue();
    if (problem !== null) {
      setResult({ tone: 'bad', text: problem });
      return;
    }
    await run(
      () => tokens.encrypt(passphrase),
      'Token encrypted. The unencrypted copy has been deleted.',
    );
  }, [passphraseIssue, run, passphrase]);

  const decrypt = useCallback(
    () =>
      run(
        () => tokens.decrypt(),
        'Passphrase removed. The token is stored unencrypted from now on.',
      ),
    [run],
  );

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
          : { tone: 'bad', text: explainRefusal(response.error) },
      );
      await refreshRateLimit();
    } finally {
      setBusy(false);
    }
  }, [refreshRateLimit]);

  return (
    <main>
      <h1>A Better Reviewer</h1>

      <Preferences />

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
          Paste it below and press <strong>Save token</strong>. That is the
          whole setup — a passphrase is offered on the same screen and is
          entirely optional.
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

      <label className="check">
        <input
          type="checkbox"
          checked={usePassphrase}
          onChange={(event) => setUsePassphrase(event.target.checked)}
        />
        <span>
          Protect it with a passphrase
          <span className="hint">
            Optional. Without one the token is stored as it stands, which is
            what browser extensions normally do. With one it is encrypted on
            this machine, and you enter the passphrase once per browser
            session.
          </span>
        </span>
      </label>

      {usePassphrase && (
        <>
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
            Never stored and never sent anywhere, so it cannot be recovered — if
            you forget it, delete the token and paste a new one. A few ordinary
            words beat one short cryptic one.
          </p>
        </>
      )}

      <div className="actions">
        <button type="button" onClick={() => void save()} disabled={busy}>
          Save token
        </button>
      </div>
        </>
      )}

      {vault === 'plain' && (
        <>
          <p>
            A token is saved on this machine. It is not encrypted, which is the
            default and is how browser extensions normally hold a credential.
          </p>

          <div className="actions">
            <button type="button" onClick={() => void validate()} disabled={busy}>
              Validate saved token
            </button>
            <button type="button" onClick={() => void clear()} disabled={busy}>
              Delete token
            </button>
          </div>

          <h2>Add a passphrase</h2>
          <p className="hint">
            Encrypts the token on this machine so it cannot be read off disk.
            You will not need to re-enter the token, and you can remove the
            passphrase again later.
          </p>

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
            <button type="button" onClick={() => void encrypt()} disabled={busy}>
              Encrypt this token
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
            <button type="button" onClick={() => void decrypt()} disabled={busy}>
              Remove passphrase
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

      {/* Every vault operation reports here, and until this carried `aria-live`
          none of them reported to a screen reader at all — including the
          failures, which are the ones with something to say.

          Mounted whether or not there is anything in it, because a live region
          that arrives at the same instant as its text is one some readers never
          announce. Empty it has no height, and its top margin collapses with
          the warning panel's, so an always-present one costs no space.

          The element itself rather than a visually-hidden twin: a second copy
          of the text would be read once and found twice, by `getByText` and by
          anyone reading the DOM. */}
      <p
        className={result === null ? 'result' : `result ${result.tone}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {result?.text ?? ''}
      </p>

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
