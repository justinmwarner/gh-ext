/**
 * The options page.
 *
 * Two jobs on one screen: the reviewer's preferences, which save as they are
 * touched, and the token, which is a credential and behaves like one. They are
 * kept apart by ordering rather than by tabs — a new install has an empty vault
 * and gets the token section first, because nobody should have to read about
 * themes before step one. Once a token is stored it drops back to fifth, where
 * it belongs. Nothing is ever hidden; only reordered.
 *
 * Each section carries its own `aria-live` result line, so a confirmation
 * arrives beside the control that earned it rather than at the foot of a page
 * the reviewer is not looking at.
 */

import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import { passphraseProblem } from '@/lib/crypto/vault';
import { resolveMod } from '@/lib/keymap';
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
  type LineDiff,
  MAX_PATTERNS,
  MAX_PATTERN_LENGTH,
  type OpenIn,
  type Settings,
  autoOpenAvailable,
  isLineDiff,
} from '@/lib/settings';
import { followLoggingSetting, readSettings, writeSettings } from '@/lib/settings-store';
import { type DiscoveredRepo, toggleWatched } from '@/lib/dashboard/repos';
import { FETCH_WINDOW_DAYS } from '@/lib/dashboard/searches';
import { RepoPicker } from '@/ui/RepoPicker';
import { summarizeDiagnosis } from '@/ui/diagnosisSummary';
import { DiffPreview } from '@/ui/DiffPreview';
import { platformString } from '@/ui/platform';
import { ThemePicker } from '@/ui/ThemePicker';
import { browser } from 'wxt/browser';
import { applyChromeTheme } from '@/ui/chromeTheme';
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
const DESTINATIONS: readonly { value: OpenIn; label: string; hint: string }[] = [
  {
    value: 'new-tab',
    label: 'A new tab',
    hint: 'Beside the pull request, which stays open behind it.',
  },
  { value: 'new-window', label: 'A new window', hint: 'For a second monitor.' },
  { value: 'same-tab', label: 'This tab', hint: 'Replaces the pull request page.' },
];

/** Pierre's four, in the order they narrow. */
const LINE_DIFFS: readonly { value: LineDiff; label: string }[] = [
  { value: 'word-alt', label: 'By word' },
  { value: 'word', label: 'By word, alternate' },
  { value: 'char', label: 'By character' },
  { value: 'none', label: 'Whole line only' },
];

/**
 * The key the browser wants back, written the way this machine writes it.
 *
 * `resolveMod` owns the platform decision and is the only thing allowed to make
 * it; this is the label for the one binding the reviewer can hand over.
 */
const FIND_KEY = resolveMod(platformString()) === 'Meta' ? '⌘F' : 'Ctrl+F';

/** Said once, wherever a passphrase is being chosen rather than entered. */
const PASSPHRASE_HINT =
  'Never stored and never sent anywhere, so it cannot be recovered. A few ordinary words beat one short cryptic one.';

/**
 * Send a request and get its reply.
 *
 * The cast below is the one point where the protocol's types stop being
 * enforced — nothing at runtime proves the worker's reply matches `ResultOf<K>`
 * — so it is confined here and every caller above it stays type-safe.
 */
async function request<K extends MessageKind>(msg: MessageOf<K>): Promise<ResponseOf<K>> {
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

/**
 * One section's report, in mono under the controls it belongs to.
 *
 * Mounted whether or not there is anything in it, because a live region that
 * arrives at the same instant as its text is one some readers never announce.
 * Empty it has no height, so an always-present one costs no space.
 */
function ResultLine({ result }: { result: Result }) {
  return (
    <p
      className={result === null ? 'result' : `result ${result.tone}`}
      aria-live="polite"
      aria-atomic="true"
    >
      {result?.text ?? ''}
    </p>
  );
}

/**
 * One setting: a box, what it does, and what happens if you tick it.
 *
 * `children` is the disclosure some settings carry — a textarea that only
 * exists while the box above it is ticked — kept inside the same row so it
 * reads as part of the setting rather than as the next one.
 */
function Check({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
  children,
}: {
  label: string;
  hint: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="setting">
      <label className="check">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          {label}
          <span className="hint">{hint}</span>
        </span>
      </label>
      {children}
    </div>
  );
}

function RateLimit({ snapshot }: { snapshot: RateLimitSnapshot | null }) {
  if (snapshot === null) {
    return (
      <p className="hint">
        Unknown until the next GitHub request. Validate the token to find out.
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

/* ------------------------------------------------------------- preferences */

type SectionId = 'reviewing' | 'diff' | 'appearance' | 'keyboard' | 'diagnostics';

/**
 * Which section reports the save for each field.
 *
 * Typed as a total record so adding a setting without deciding where its
 * confirmation appears is a compile error rather than a silent report in the
 * wrong place.
 */
const SECTION_OF: Record<keyof Settings, SectionId> = {
  openIn: 'reviewing',
  openInBackground: 'reviewing',
  autoOpen: 'reviewing',
  // The two dashboard settings. Here because the question they answer — which
  // pull requests you are shown — is a reviewing question rather than a diff
  // one. Neither has a control on this page yet: `stalenessDays` is honoured
  // from its default and `watchedRepos` feeds a repository picker that is not
  // built. They are in this record because it is total, which is exactly the
  // check that will make somebody decide where their controls go rather than
  // adding them wherever there is room.
  stalenessDays: 'reviewing',
  watchedRepos: 'reviewing',
  splitView: 'diff',
  lineDiff: 'diff',
  collapseTree: 'diff',
  hideGenerated: 'diff',
  generatedPatterns: 'diff',
  ignoreWhitespace: 'diff',
  diffTheme: 'appearance',
  releaseFindKey: 'keyboard',
  debugLogging: 'diagnostics',
};

/** How long a confirmation stays before the page goes quiet again. */
const SAVED_FOR = 2_000;

interface Preferences {
  settings: Settings | null;
  update: (patch: Partial<Settings>) => void;
  resultFor: (section: SectionId) => Result;
}

/**
 * The stored preferences, and what happens when one of them is written.
 *
 * Saved on change rather than behind a Save button — these are preferences, not
 * a credential — but not *silently* on change, which is what this used to do. A
 * write that fails put the page in a state where the control said one thing and
 * storage held another, with nothing anywhere to say so. So a success reports
 * `Saved` for two seconds, and a failure reports the reason and puts the
 * control back to the value that is actually stored.
 */
function usePreferences(): Preferences {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<{ section: SectionId; result: Result } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void readSettings()
      .then(setSettings)
      // A settings area that cannot be read is not a reason to show nothing.
      // The defaults are what the worker would use anyway.
      .catch(() => setSettings({ ...DEFAULT_SETTINGS }));
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  /**
   * Wear the chosen theme on this page too, as soon as it is chosen.
   *
   * Two things, one line. The first is consistency: PRODUCT.md's fifth
   * principle says the card, the review page and this page are one thing and a
   * reviewer arriving here from a dark review page should not notice a seam.
   *
   * The second is that it makes the picker its own preview at full size. The
   * swatch beside each name says what a theme is; the page turning under the
   * cursor says what it is like to sit in.
   */
  useEffect(() => {
    if (settings === null) return;
    applyChromeTheme(document.documentElement, settings.diffTheme);
  }, [settings?.diffTheme]);

  const report = useCallback((section: SectionId, result: Result, fades: boolean) => {
    if (timer.current !== null) clearTimeout(timer.current);
    setSaved({ section, result });
    if (!fades) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setSaved(null);
    }, SAVED_FOR);
  }, []);

  const update = useCallback(
    (patch: Partial<Settings>) => {
      if (settings === null) return;
      const previous = settings;
      const next: Settings = { ...settings, ...patch };
      // Moving to the same tab takes auto-open down with it. Leaving the stored
      // flag set would mean switching back to a new tab silently re-enabled
      // something the reviewer last saw greyed out.
      if (!autoOpenAvailable(next.openIn)) next.autoOpen = false;

      // Every patch this page makes names one field, which is what makes the
      // section it belongs to knowable. `reviewing` is the first section, and
      // is where an empty patch would report if one ever arrived.
      const field = Object.keys(patch)[0] as keyof Settings | undefined;
      const section = field === undefined ? 'reviewing' : SECTION_OF[field];

      setSettings(next);
      void writeSettings(next).then(
        () => report(section, { tone: 'good', text: 'Saved' }, true),
        (error: unknown) => {
          logWarn('could not save settings', error);
          // Back to what is stored. A control left showing the value that
          // failed to save is the page lying about the extension's behaviour.
          setSettings(previous);
          report(
            section,
            {
              tone: 'bad',
              text:
                error instanceof Error ? error.message : 'That setting was not saved.',
            },
            false,
          );
        },
      );
    },
    [settings, report],
  );

  const resultFor = useCallback(
    (section: SectionId): Result => (saved?.section === section ? saved.result : null),
    [saved],
  );

  return { settings, update, resultFor };
}

interface SectionProps {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  result: Result;
}

function Reviewing({ settings, update, result }: SectionProps) {
  const available = autoOpenAvailable(settings.openIn);

  return (
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

      <Check
        label="Open it without switching to it"
        hint={
          available
            ? 'For queueing up several reviews at once.'
            : 'Not available when reviews open in this tab.'
        }
        checked={settings.openInBackground}
        disabled={!available}
        onChange={(on) => update({ openInBackground: on })}
      />

      <Check
        label="Open a review automatically on a pull request"
        hint={
          available
            ? 'Opened in the background, so nothing moves while you are reading.'
            : 'Not available when reviews open in this tab — it would replace the pull request as you arrived.'
        }
        checked={settings.autoOpen}
        disabled={!available}
        onChange={(on) => update({ autoOpen: on })}
      />

      <ResultLine result={result} />
    </section>
  );
}

/**
 * The reviewer's own list of generated paths, on top of the built-in one.
 *
 * Saved when the box is left rather than on every keystroke: a glob is typed a
 * character at a time and each character is not a decision. The bound is
 * `lib/settings.ts`'s, checked here so the reviewer is told which line is the
 * problem rather than finding a pattern silently dropped on the next read.
 */
function GeneratedPatterns({
  value,
  onChange,
}: {
  value: readonly string[];
  onChange: (patterns: string[]) => void;
}) {
  const [draft, setDraft] = useState(() => value.join('\n'));
  const id = useId();

  const globs = draft
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  const problem =
    globs.length > MAX_PATTERNS
      ? `More than ${MAX_PATTERNS} patterns. Remove some lines.`
      : globs.some((glob) => glob.length > MAX_PATTERN_LENGTH)
        ? `One pattern is longer than ${MAX_PATTERN_LENGTH} characters. Shorten it.`
        : null;

  return (
    <div className="reveal">
      <label className="field" htmlFor={id}>
        Also treat these paths as generated
        <textarea
          id={id}
          rows={4}
          spellCheck={false}
          value={draft}
          aria-describedby={problem === null ? undefined : `${id}-problem`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (problem !== null) return;
            // Deduplicated on the way out, because the reader deduplicates on
            // the way in and storage that reads back differently is a control
            // showing something that was not saved.
            const next = [...new Set(globs)];
            if (next.join('\n') === value.join('\n')) return;
            onChange(next);
          }}
        />
        <span className="hint">
          One glob per line. <code>**</code>, <code>*</code> and <code>?</code>. A
          repository&rsquo;s own <code>.gitattributes</code> still wins.
        </span>
      </label>
      <p className="result bad" id={`${id}-problem`} aria-live="polite">
        {problem ?? ''}
      </p>
    </div>
  );
}

/**
 * Which repositories the pull request list reads.
 *
 * The same picker the dashboard carries, on the page a reviewer goes to when
 * they are changing how this extension behaves rather than working. One
 * component behind both, because a picker that disagreed with itself about
 * what is ticked would be worse than either surface alone.
 *
 * Discovery runs when this section first draws. It is a query that names
 * repositories, not one that reads pull requests out of them — the whole point
 * of the opt-in is that the expensive read waits for a tick.
 */
function PullRequestList({ settings, update, result }: SectionProps) {
  const [discovered, setDiscovered] = useState<DiscoveredRepo[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [asked, setAsked] = useState(false);

  const discover = useCallback(() => {
    setAsked(true);
    setDiscovering(true);
    void (async () => {
      const reply = await request(message('discover-repos', {}));
      setDiscovering(false);
      if (isErr(reply)) {
        logWarn('could not discover repositories', reply.error);
        return;
      }
      setDiscovered(reply.data.repos);
    })();
  }, []);

  useEffect(() => {
    discover();
  }, [discover]);

  return (
    <section className="settings">
      <h2>Pull request list</h2>
      <p className="hint">
        The list reads only these repositories, and only the last {FETCH_WINDOW_DAYS} days.
        Its search box reaches past both, including pull requests that have closed.
      </p>

      <RepoPicker
        discovered={discovered}
        watched={settings.watchedRepos}
        discovering={discovering}
        asked={asked}
        onToggle={(nameWithOwner) =>
          update({ watchedRepos: toggleWatched(settings.watchedRepos, nameWithOwner) })
        }
        onDiscover={discover}
      />

      <ResultLine result={result} />
    </section>
  );
}

function ReadingADiff({ settings, update, result }: SectionProps) {
  const lineDiffId = useId();

  return (
    <section className="settings">
      <h2>Reading a diff</h2>

      {/* Three of the four controls below are claims about what a diff will
          look like, and two of them — the intra-line highlight, and which
          lines whitespace hiding removes — are differences of a few pixels
          that no sentence renders faithfully. So the sentence is kept and the
          picture put above it. */}
      <DiffPreview
        settings={settings}
        caption="An example, drawn with the settings below."
      />

      <Check
        label="Show the old and new file side by side"
        hint="Two columns instead of one."
        checked={settings.splitView}
        onChange={(on) => update({ splitView: on })}
      />

      <div className="setting">
        <label className="field" htmlFor={lineDiffId}>
          Highlight inside a changed line
          <select
            id={lineDiffId}
            value={settings.lineDiff}
            onChange={(event) => {
              if (isLineDiff(event.target.value)) update({ lineDiff: event.target.value });
            }}
          >
            {LINE_DIFFS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="hint">
            By character reads better for prose, and for a rename inside a line.
          </span>
        </label>
      </div>

      <Check
        label="Start the file tree collapsed"
        hint="For large pull requests across a deep tree."
        checked={settings.collapseTree}
        onChange={(on) => update({ collapseTree: on })}
      />

      <Check
        label="Fold away the diffs of generated files"
        hint="Lockfiles, minified bundles, snapshots and vendored trees. Each stays in the list with its counts and opens with one press."
        checked={settings.hideGenerated}
        onChange={(on) => update({ hideGenerated: on })}
      >
        {settings.hideGenerated && (
          <GeneratedPatterns
            value={settings.generatedPatterns}
            onChange={(patterns) => update({ generatedPatterns: patterns })}
          />
        )}
      </Check>

      <Check
        label="Hide changes where only the whitespace moved"
        hint={
          <>
            <strong>The one setting here that removes lines from the diff.</strong> Every
            file it shortens says so above its body, and a comment left on a moved line is
            listed rather than dropped.
          </>
        }
        checked={settings.ignoreWhitespace}
        onChange={(on) => update({ ignoreWhitespace: on })}
      />

      <ResultLine result={result} />
    </section>
  );
}

function Appearance({ settings, update, result }: SectionProps) {
  return (
    <section className="settings">
      <h2>Appearance</h2>

      {/* A second copy rather than one shared with the section above, because
          the two are answering different questions and a reviewer choosing
          among seventy-six themes should not have to scroll to another heading
          to see what one does. The swatch beside each row is four colours; this
          is those colours doing their job. */}
      <DiffPreview
        settings={settings}
        caption="An example, drawn in the theme chosen below."
      />

      <div className="setting">
        <ThemePicker
          value={settings.diffTheme}
          onChange={(diffTheme) => update({ diffTheme })}
        />
        <p className="hint">
          Applies to the diff and to the extension around it, this page included.{' '}
          <strong>Match the page</strong> is the only option whose contrast has been
          measured throughout — every other theme is drawn as its author wrote it.
        </p>
      </div>

      <ResultLine result={result} />
    </section>
  );
}

function Keyboard({ settings, update, result }: SectionProps) {
  return (
    <section className="settings">
      <h2>Keyboard</h2>

      <Check
        label={`Let the browser keep ${FIND_KEY}`}
        hint={
          <>
            The review&rsquo;s own search over changed lines stays on <code>/</code>.
          </>
        }
        checked={settings.releaseFindKey}
        onChange={(on) => update({ releaseFindKey: on })}
      />

      <ResultLine result={result} />
    </section>
  );
}

function Diagnostics({
  settings,
  update,
  result,
  rateLimit,
}: SectionProps & { rateLimit: RateLimitSnapshot | null }) {
  return (
    <section className="settings">
      <h2>Diagnostics</h2>

      <Check
        label="Write diagnostics to the browser console"
        hint="Turn this on before reporting a bug, then turn it back off."
        checked={settings.debugLogging}
        onChange={(on) => update({ debugLogging: on })}
      />

      <div className="setting">
        <p className="field-label">GitHub rate limit</p>
        <RateLimit snapshot={rateLimit} />
      </div>

      <ResultLine result={result} />
    </section>
  );
}

/* ------------------------------------------------------------------ vault */

/** Which destructive action is waiting to be confirmed. */
type Confirming = 'clear' | 'decrypt' | null;

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
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [rateLimit, setRateLimit] = useState<RateLimitSnapshot | null>(null);
  const confirmId = useId();

  const { settings, update, resultFor } = usePreferences();

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

  // A question about a token that has since changed is not a question worth
  // leaving open.
  useEffect(() => {
    setConfirming(null);
  }, [vault]);

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
   * The previous message is left standing while the next one is fetched. It
   * used to be blanked the instant a button was pressed, which took the reason
   * for the failure off the screen at the moment the reviewer pressed the
   * button that was meant to answer it.
   *
   * The operation returns its own success line, which is what lets validating
   * the token come through here too rather than keeping a second copy of the
   * busy, report and refresh handling for the one case with a name in it.
   *
   * `consumes` is what keeps that sharing honest. Saving, encrypting and
   * unlocking all *spend* what was typed, and holding a passphrase in component
   * state after it has been used is a secret kept for no reason. Validating
   * spends nothing — it asks GitHub who the stored token belongs to — so
   * clearing the fields there would throw away a half-typed passphrase to
   * report something that had no bearing on it.
   */
  const run = useCallback(
    async (operation: () => Promise<string>, consumes = true) => {
      setBusy(true);
      try {
        const text = await operation();
        setResult({ tone: 'good', text });
        if (consumes) forgetInputs();
      } catch (error) {
        setResult({
          tone: 'bad',
          text: error instanceof Error ? error.message : 'That did not work.',
        });
      } finally {
        await refreshVault();
        setConfirming(null);
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
      await run(async () => {
        await tokens.save(token);
        return 'Token saved.';
      });
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
    await run(async () => {
      await tokens.save(token, passphrase);
      return 'Token encrypted and saved.';
    });
  }, [usePassphrase, passphraseIssue, run, token, passphrase]);

  const encrypt = useCallback(async () => {
    const problem = passphraseIssue();
    if (problem !== null) {
      setResult({ tone: 'bad', text: problem });
      return;
    }
    await run(async () => {
      await tokens.encrypt(passphrase);
      return 'Token encrypted. The unencrypted copy has been deleted.';
    });
  }, [passphraseIssue, run, passphrase]);

  const decrypt = useCallback(
    () =>
      run(async () => {
        await tokens.decrypt();
        return 'Passphrase removed. The token is stored unencrypted from now on.';
      }),
    [run],
  );

  const unlock = useCallback(
    () =>
      run(async () => {
        await tokens.unlock(passphrase);
        return 'Unlocked for this browser session.';
      }),
    [run, passphrase],
  );

  const lock = useCallback(
    () =>
      run(async () => {
        await tokens.lock();
        return 'Locked. The passphrase is needed again to review.';
      }),
    [run],
  );

  const clear = useCallback(
    () =>
      run(async () => {
        await tokens.clear();
        return 'Token deleted from this machine.';
      }),
    [run],
  );

  /**
   * Validate what is stored, not what is typed, so the answer describes the
   * token the worker will actually use.
   *
   * Through `run` like every other operation, so a refusal reports the same
   * way and the vault state is re-read afterwards — on its own it did neither,
   * which is invisible until the moment it is not.
   *
   * Not as a consumer of what was typed, though. This is the one operation
   * here that reads rather than writes, and a reviewer part-way through adding
   * a passphrase may well press it first to check the token is still good.
   */
  const validate = useCallback(
    () =>
      run(async () => {
        const response = await request(message('validate-token', {}));
        // Before the refusal is thrown: a refused request still moved the rate
        // limit, and that is a number worth having when something is wrong.
        await refreshRateLimit();
        if (!response.ok) throw new Error(explainRefusal(response.error));
        return `Authenticated as ${response.data.login}.`;
      }, false),
    [run, refreshRateLimit],
  );

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (busy) return;
      if (vault === 'empty') void save();
      else if (vault === 'plain') void encrypt();
      else if (vault === 'locked') void unlock();
    },
    [busy, vault, save, encrypt, unlock],
  );

  const ask = (kind: Exclude<Confirming, null>) =>
    setConfirming((open) => (open === kind ? null : kind));

  const forgetting = vault === 'locked';
  const confirmation =
    confirming === null ? null : (
      <div className="confirm" id={confirmId}>
        <p>
          {confirming === 'decrypt'
            ? 'Remove the passphrase? The token is stored unencrypted from then on.'
            : forgetting
              ? 'Forget this token? An encrypted token that is deleted cannot be brought back.'
              : 'Delete this token? You will need to paste a new one to review again.'}
        </p>
        <button
          type="button"
          className="button danger"
          disabled={busy}
          onClick={() => void (confirming === 'decrypt' ? decrypt() : clear())}
        >
          {confirming === 'decrypt'
            ? 'Remove passphrase'
            : forgetting
              ? 'Forget this token'
              : 'Delete token'}
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => setConfirming(null)}
        >
          Cancel
        </button>
      </div>
    );

  const passphraseFields = (existing: boolean) => (
    <>
      <div className="setting">
        <label htmlFor="passphrase">Passphrase</label>
        <input
          id="passphrase"
          type="password"
          value={passphrase}
          autoComplete={existing ? 'current-password' : 'new-password'}
          spellCheck={false}
          onChange={(event) => setPassphrase(event.target.value)}
        />
      </div>
      {!existing && (
        <div className="setting">
          <label htmlFor="confirm">Passphrase again</label>
          <input
            id="confirm"
            type="password"
            value={confirm}
            autoComplete="new-password"
            spellCheck={false}
            onChange={(event) => setConfirm(event.target.value)}
          />
          <p className="hint">{PASSPHRASE_HINT}</p>
        </div>
      )}
    </>
  );

  /**
   * Nothing at all until the vault has answered.
   *
   * Its answer decides where this section sits, and a section that draws fifth
   * and then jumps to first is worse than one that arrives a frame late — the
   * reviewer it jumps for is the one meeting the page for the first time.
   */
  const tokenSection =
    vault === null ? null : (
      <section className="settings">
        <h2>GitHub token</h2>

        {vault === 'empty' && (
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
            <li>Name it, and set an expiry.</li>
            <li>
              Under <strong>Repository access</strong>, pick the repositories you review.
            </li>
            <li>
              Under <strong>Permissions &rarr; Repository permissions</strong>, set these
              five and leave the rest at <em>No access</em>:
              {/* Transcription rather than prose: this is the other site's own
                  wording, in the order that site lists it, and it is read with
                  one eye on each screen. */}
              <table className="perms">
                <thead>
                  <tr>
                    <th scope="col">Permission</th>
                    <th scope="col">Access</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Pull requests</td>
                    <td>
                      <strong>Read and write</strong>
                    </td>
                  </tr>
                  <tr>
                    <td>Contents</td>
                    <td>Read-only</td>
                  </tr>
                  <tr>
                    <td>Commit statuses</td>
                    <td>Read-only</td>
                  </tr>
                  <tr>
                    <td>Checks</td>
                    <td>Read-only</td>
                  </tr>
                  <tr>
                    <td>Metadata</td>
                    <td>Read-only</td>
                  </tr>
                </tbody>
              </table>
            </li>
            <li>Generate the token, copy it, and paste it below.</li>
          </ol>
        )}

        {/* A form, so Enter submits in every field rather than only in the one
            that had a key handler bolted to it. */}
        <form onSubmit={onSubmit}>
          {vault === 'empty' && (
            <>
              <div className="setting">
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
              </div>

              <p className="notice">
                If your repositories belong to an organisation, an owner may have to
                approve the token before it works. Until they do, this extension reports
                the pull request as out of reach.
              </p>

              <Check
                label="Protect it with a passphrase"
                hint="Optional. You enter it once per browser session."
                checked={usePassphrase}
                onChange={setUsePassphrase}
              />

              {usePassphrase && passphraseFields(false)}

              <div className="actions">
                <button type="submit" className="button primary" disabled={busy}>
                  Save token
                </button>
              </div>
            </>
          )}

          {vault === 'plain' && (
            <>
              <p className="state">A token is saved on this machine, unencrypted.</p>

              <div className="actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => void validate()}
                  disabled={busy}
                >
                  Validate saved token
                </button>
                <button
                  type="button"
                  className="button danger"
                  onClick={() => ask('clear')}
                  disabled={busy}
                  aria-expanded={confirming === 'clear'}
                  aria-controls={confirming === null ? undefined : confirmId}
                >
                  Delete token
                </button>
              </div>

              {confirmation}

              {passphraseFields(false)}

              <div className="actions">
                <button type="submit" className="button primary" disabled={busy}>
                  Encrypt this token
                </button>
              </div>
            </>
          )}

          {vault === 'locked' && (
            <>
              <p className="state">An encrypted token is on this machine.</p>

              {passphraseFields(true)}

              <div className="actions">
                <button type="submit" className="button primary" disabled={busy}>
                  Unlock
                </button>
                <button
                  type="button"
                  className="button danger"
                  onClick={() => ask('clear')}
                  disabled={busy}
                  aria-expanded={confirming === 'clear'}
                  aria-controls={confirming === null ? undefined : confirmId}
                >
                  Forget this token
                </button>
              </div>

              {confirmation}
            </>
          )}

          {vault === 'unlocked' && (
            <>
              <p className="state">Unlocked for this browser session.</p>

              <div className="actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => void validate()}
                  disabled={busy}
                >
                  Validate saved token
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => void lock()}
                  disabled={busy}
                >
                  Lock now
                </button>
                {/* Danger-coloured, though it deletes nothing. What it removes
                    is a protection, and the only signal separating it from
                    `Lock now` beside it — which sounds far more drastic and is
                    entirely reversible — is that colour. */}
                <button
                  type="button"
                  className="button danger"
                  onClick={() => ask('decrypt')}
                  disabled={busy}
                  aria-expanded={confirming === 'decrypt'}
                  aria-controls={confirming === null ? undefined : confirmId}
                >
                  Remove passphrase
                </button>
                <button
                  type="button"
                  className="button danger"
                  onClick={() => ask('clear')}
                  disabled={busy}
                  aria-expanded={confirming === 'clear'}
                  aria-controls={confirming === null ? undefined : confirmId}
                >
                  Delete token
                </button>
              </div>

              {confirmation}
            </>
          )}
        </form>

        <ResultLine result={result} />

        {/* Neutral, and in every vault state. Red was the wrong tone for a
            standing fact about what a credential can do — a panel that is
            always alarming is one nobody reads twice — and the write scope is
            the part that decides how the token should be scoped, so it goes
            first. */}
        <div className="notice">
          <p>
            <strong>
              This token can post comments, resolve threads and submit approvals as you.
            </strong>{' '}
            Use a fine-grained token limited to the repositories you review, with the
            shortest expiry you can live with.
          </p>
          <p>
            A passphrase encrypts the token on this machine, so it cannot be read off
            disk. It does not protect against this extension, which has to decrypt the
            token to use it — that is true of every extension that holds a credential.
          </p>
        </div>
      </section>
    );

  const tokenFirst = vault === 'empty';

  return (
    <main>
      <h1>A Better Reviewer</h1>

      {tokenFirst && tokenSection}

      {settings !== null && (
        <>
          <Reviewing
            settings={settings}
            update={update}
            result={resultFor('reviewing')}
          />
          <PullRequestList
            settings={settings}
            update={update}
            result={resultFor('reviewing')}
          />
          <ReadingADiff settings={settings} update={update} result={resultFor('diff')} />
          <Appearance
            settings={settings}
            update={update}
            result={resultFor('appearance')}
          />
          <Keyboard settings={settings} update={update} result={resultFor('keyboard')} />
        </>
      )}

      {!tokenFirst && tokenSection}

      {settings !== null && (
        <Diagnostics
          settings={settings}
          update={update}
          result={resultFor('diagnostics')}
          rateLimit={rateLimit}
        />
      )}
    </main>
  );
}

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
