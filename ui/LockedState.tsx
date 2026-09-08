/**
 * A token that exists but is encrypted, waiting for its passphrase.
 *
 * Distinct from `SetupState`: there is nothing to set up here, and telling
 * someone who already has a token to go and create one is the kind of wrong
 * that makes people think the extension lost their credentials.
 *
 * The passphrase is taken here rather than on the options page. Locking
 * happens on every browser restart, so a trip to another tab to undo it would
 * be the most repeated interaction in the extension.
 *
 * Presentational on purpose — `onUnlock` is passed in so this file names no
 * storage API and can be tested against a real DOM.
 */

import { useCallback, useState } from 'react';
import type { PrRef } from '@/lib/messages';
import { FullPage } from './FullPage';
import { OpenInGitHub } from './OpenInGitHub';
import { openOptions } from './openOptions';

export function LockedState({
  pr,
  onUnlock,
}: {
  pr: PrRef | null;
  onUnlock: (passphrase: string) => Promise<void>;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    // An empty box is someone pressing the button to see what it does, not an
    // attempt worth a round trip through the key derivation.
    if (passphrase === '' || busy) return;

    setBusy(true);
    setProblem(null);
    try {
      await onUnlock(passphrase);
      // No success branch: unlocking changes the vault state and this whole
      // screen is replaced by the pull request.
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : 'That passphrase did not work.',
      );
    } finally {
      setBusy(false);
    }
  }, [passphrase, busy, onUnlock]);

  return (
    <FullPage
      title="Unlock your token"
      actions={
        <>
          <button
            type="button"
            className="button primary"
            onClick={() => void submit()}
            disabled={busy}
          >
            Unlock
          </button>
          {pr !== null && <OpenInGitHub pr={pr} />}
          <button type="button" className="button" onClick={openOptions}>
            Open options
          </button>
        </>
      }
    >
      <p>
        Your GitHub token is encrypted on this machine. Enter the passphrase to
        unlock it for this browser session.
      </p>

      <label htmlFor="passphrase">Passphrase</label>
      <input
        id="passphrase"
        type="password"
        value={passphrase}
        autoComplete="current-password"
        spellCheck={false}
        autoFocus
        disabled={busy}
        onChange={(event) => setPassphrase(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void submit();
        }}
      />

      {problem !== null && <p className="problem">{problem}</p>}
    </FullPage>
  );
}
