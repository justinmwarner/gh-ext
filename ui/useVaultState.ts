/**
 * Which of the vault's four states the review page is looking at.
 *
 * The worker reports a missing token and a locked one identically, as
 * `kind: 'auth'` — it cannot tell them apart, because from where it stands
 * both are "no token". The difference matters to the reviewer, though: one
 * needs a token created, the other needs a passphrase typed. So the page asks
 * storage directly rather than trying to read it out of an error message.
 *
 * Kept beside `useTokenChange` so both listen to the same events: unlocking
 * refreshes this *and* retries the load, and the locked screen is replaced by
 * the pull request without a reload.
 */

import { useCallback, useEffect, useState } from 'react';
import { ChromeTokenProvider, type VaultState } from '@/lib/github/token-provider';
import { useTokenChange } from './useTokenChange';

const tokens = new ChromeTokenProvider();

/** null until the first read resolves, which is a tick after mount. */
export function useVaultState(): VaultState | null {
  const [state, setState] = useState<VaultState | null>(null);

  const refresh = useCallback(() => {
    void tokens.state().then(setState);
  }, []);

  useEffect(refresh, [refresh]);
  useTokenChange(refresh);

  return state;
}

/**
 * Exported as a bare function so `LockedState` stays presentational and can be
 * tested against a fake.
 */
export const unlockVault = (passphrase: string): Promise<void> => tokens.unlock(passphrase);
