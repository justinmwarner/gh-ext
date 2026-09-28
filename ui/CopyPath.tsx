/**
 * Copy a file's path, from the end of its name on the card's head row.
 *
 * The other half of making the name the fold control. A name inside a button
 * cannot be dragged over and copied any more, and sending somebody a path — or
 * pasting it into a terminal, an editor, a search — is something a reviewer
 * does often enough that it should not cost a trip anywhere. GitHub puts the
 * same button in the same place, which is the rule for every control here.
 *
 * **The path as GitHub has it**: relative to the repository, no leading slash,
 * no link wrapped round it, which is the one form that pastes correctly into
 * all of those. A renamed file gives where it is now.
 *
 * **It says whether it worked.** A tick for {@link COPIED_FOR}, and "Copied" to
 * a screen reader through a live region that is in the tree from the start —
 * one that arrives with its message already in it is one a screen reader does
 * not announce. A refusal is a cross that stays until the next press rather
 * than a notice that times out: the clipboard is still not holding what the
 * reviewer thinks it is, and they may well have looked away.
 *
 * It sits inside the fold control's stretched hit area, and the stylesheet
 * lifts it above that. Without the lift, a press here would fold the card.
 */

import { useEffect, useRef, useState } from 'react';
import { logWarn } from '@/lib/log';

/**
 * How long the tick stays after a copy, in milliseconds.
 *
 * Long enough to be caught by a glance back at the row; short enough that the
 * next copy from the same card starts from the icon it is expecting.
 */
export const COPIED_FOR = 2000;

/** What failed and what to do, in the tooltip and to a screen reader. */
const REFUSED = 'The browser refused the clipboard. Press again to retry.';

type CopyState = 'idle' | 'copied' | 'failed';

export function CopyPath({ path }: { path: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A card scrolled out of the column is unmounted, and its tick goes with it.
  useEffect(() => () => clearTimeout(settle.current), []);

  const copy = async (): Promise<void> => {
    // A second press restarts the tick rather than being cut short by the
    // first press's timer.
    clearTimeout(settle.current);
    try {
      await navigator.clipboard.writeText(path);
      setState('copied');
      settle.current = setTimeout(() => setState('idle'), COPIED_FOR);
    } catch (error) {
      // Refused for want of focus, usually, which a second press fixes.
      logWarn('could not write a path to the clipboard', error);
      setState('failed');
    }
  };

  const said = state === 'copied' ? 'Copied' : state === 'failed' ? REFUSED : '';

  return (
    <>
      <button
        type="button"
        className="copy-path"
        data-copy-state={state}
        aria-label={`Copy ${path}`}
        title={said === '' ? 'Copy path' : said}
        onClick={() => void copy()}
      >
        {state === 'copied' ? <CheckIcon /> : state === 'failed' ? <CrossIcon /> : <CopyIcon />}
      </button>
      {/* `aria-live` rather than `role="status"`, as in `NoticeCenter`: one
          empty status on every card would have every other query for a status
          on this page finding dozens. */}
      <span className="visually-hidden" aria-live="polite" aria-atomic="true">
        {said}
      </span>
    </>
  );
}

/*
 * GitHub's own glyphs — Octicons' `copy`, `check` and `x` at 16px — so the
 * button is the one a reviewer already knows from the pull request page. Drawn
 * rather than imported, like every other glyph here.
 */

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"
      />
      <path
        fill="currentColor"
        d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"
      />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"
      />
    </svg>
  );
}
