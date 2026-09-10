/**
 * Everything this page cannot vouch for, behind one control in the top bar.
 *
 * Four of these five used to be banners, stacked between the top bar and the
 * diff. Each one was written to be impossible to miss, and together they were a
 * strip that pushed the review down the screen for as long as the tab was open
 * — for facts that are read once and then have to be lived with. A pull request
 * that arrived incomplete is incomplete for the rest of the session; a banner
 * saying so is only news for the first second of it.
 *
 * So the strip is gone and its contents are here, behind a control that names
 * the worst of them and counts the rest. The trade is deliberate: a reviewer
 * now has to click to read the detail, and in exchange the caveat stays on
 * screen — one line, in a bar that is always visible — instead of being
 * dismissed or scrolled past and forgotten.
 *
 * Three things had to survive that trade, and they are most of this file:
 *
 * - **Nothing goes quiet.** {@link pageNotices} is the single answer to "what
 *   is wrong with this page", and both the button and the panel read it. A
 *   notice that exists cannot fail to be counted.
 * - **A screen reader is still told.** A `role="status"` inside a closed panel
 *   announces nothing, so the live region is out here, in the bar, and it is
 *   mounted whether or not there is anything to say — a region that appears at
 *   the same moment as its text is a region some readers never announce.
 * - **The keyboard can leave.** Escape, a click elsewhere, and focus handed
 *   back to the button, for the same reason `MenuButton` does all three.
 */

import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import type { PrPayload } from '@/lib/messages';
import { DeniedNotice } from './DeniedNotice';
import { HeadMovedNotice } from './HeadMovedNotice';
import { ReadOnlyNotice } from './ReadOnlyNotice';
import { TokenRejectedNotice } from './TokenRejectedNotice';
import { TruncationNotice } from './TruncationNotice';
import { prPermalink, prViewerPermission } from './prNode';

export type NoticeId =
  | 'token-rejected'
  | 'read-only'
  | 'denied'
  | 'truncated'
  | 'head-moved';

/**
 * How bad it is, in three steps rather than five.
 *
 * `blocked` is the only one that stops the reviewer doing something: the token
 * has been refused, so nothing can be posted. `incomplete` means the page is
 * missing a part of the pull request and cannot tell you which lines. `moved`
 * is not a fault at all — the world went on while the page was being read —
 * and it is coloured and ranked accordingly.
 */
export type NoticeTone = 'blocked' | 'incomplete' | 'moved';

export interface NoticeSummary {
  id: NoticeId;
  tone: NoticeTone;
  /**
   * Names the problem in four words or fewer.
   *
   * It is the panel's heading and, for whichever is worst, the button's whole
   * label — so it has to say what is wrong on its own, without the sentence
   * underneath it. "Token rejected" does; "Something went wrong" does not.
   */
  title: string;
}

export interface NoticeInput {
  payload: PrPayload;
  /** GitHub has started refusing this token. See `TokenRejectedNotice`. */
  tokenRejected: boolean;
  /** The commit the pull request is on now, if it is no longer the loaded one. */
  movedTo: string | null;
}

/**
 * Whether this account may write to this repository at all.
 *
 * `READ` is the only value that means no. Everything else — the four roles
 * above it, and the field being missing from a payload an older build cached —
 * is treated as yes, because the cost of the two mistakes is not symmetric: a
 * notice that fails to appear leaves a reviewer confused about one greyed-out
 * button, while one that appears wrongly tells a reviewer with full access
 * that their token is broken.
 */
const readOnly = (payload: PrPayload): boolean =>
  prViewerPermission(payload.pullRequest) === 'READ';

/**
 * What is wrong with this page, worst first.
 *
 * The order is the ranking, and both surfaces obey it: the panel lists in it,
 * and the button names `[0]`. Head-moved is last because it is the only one
 * that is not a fault — the page is complete and correct, it is just describing
 * a commit that has been superseded.
 */
export function pageNotices({
  payload,
  tokenRejected,
  movedTo,
}: NoticeInput): NoticeSummary[] {
  const notices: NoticeSummary[] = [];

  if (tokenRejected) {
    notices.push({ id: 'token-rejected', tone: 'blocked', title: 'Token rejected' });
  }
  // Under a rejected token rather than beside it. Both stop the reviewer
  // writing, but a rejected token stops them writing *anywhere* and is the one
  // to fix first — and while it is showing, this one adds nothing they can act
  // on.
  if (!tokenRejected && readOnly(payload)) {
    notices.push({ id: 'read-only', tone: 'blocked', title: 'Read-only' });
  }
  if (payload.denied.length > 0) {
    notices.push({ id: 'denied', tone: 'incomplete', title: 'Partly hidden' });
  }
  if (payload.truncated.files || payload.truncated.threads) {
    notices.push({ id: 'truncated', tone: 'incomplete', title: 'List cut short' });
  }
  if (movedTo !== null) {
    notices.push({ id: 'head-moved', tone: 'moved', title: 'New commits' });
  }

  return notices;
}

/** One glyph per tone, so the button is not colour alone. */
const ICONS: Record<NoticeTone, ReactNode> = {
  blocked: (
    <path d="M8 1.2a6.8 6.8 0 1 0 0 13.6A6.8 6.8 0 0 0 8 1.2Zm0 3.1a.9.9 0 0 1 .9.9v3.3a.9.9 0 0 1-1.8 0V5.2a.9.9 0 0 1 .9-.9Zm0 6.1a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
  ),
  incomplete: (
    <path d="M7.1 1.9a1 1 0 0 1 1.8 0l6.1 11.2a1 1 0 0 1-.9 1.5H1.9a1 1 0 0 1-.9-1.5ZM8 5.2a.9.9 0 0 0-.9.9v3a.9.9 0 0 0 1.8 0v-3a.9.9 0 0 0-.9-.9Zm0 5.9a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
  ),
  moved: (
    <path d="M8 1.2a6.8 6.8 0 1 0 0 13.6A6.8 6.8 0 0 0 8 1.2Zm.6 3.4 2.7 2.7a.85.85 0 0 1-1.2 1.2L8.85 7.25V11.2a.85.85 0 0 1-1.7 0V7.25L5.9 8.5a.85.85 0 0 1-1.2-1.2l2.7-2.7a.85.85 0 0 1 1.2 0Z" />
  ),
};

function ToneIcon({ tone }: { tone: NoticeTone }) {
  return (
    <svg
      className="notice-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[tone]}
    </svg>
  );
}

/** What a screen reader is told the moment the set of notices changes. */
export function announce(notices: readonly NoticeSummary[]): string {
  if (notices.length === 0) return '';
  const titles = notices.map((notice) => notice.title.toLowerCase()).join(', ');
  const count = notices.length === 1 ? 'One notice' : `${notices.length} notices`;
  return `${count} about this pull request: ${titles}. Open them from the top bar.`;
}

export interface NoticeCenterProps {
  payload: PrPayload;
  tokenRejected: boolean;
  /** The commit the pull request is on now, if it has moved. */
  movedTo: string | null;
  /** Whether a review is open with comments queued on it. */
  reviewPending: boolean;
  /** Ask the worker for this pull request again. */
  onReload: () => void;
  /** Keep reading the commit already on screen. */
  onDismissMoved: () => void;
}

export function NoticeCenter({
  payload,
  tokenRejected,
  movedTo,
  reviewPending,
  onReload,
  onDismissMoved,
}: NoticeCenterProps) {
  const notices = pageNotices({ payload, tokenRejected, movedTo });
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Dismissing the last notice takes the button with it. Without this the panel
  // would be left hanging under a bar with nothing in it to have opened it.
  const count = notices.length;
  useEffect(() => {
    if (count === 0) setOpen(false);
  }, [count]);

  // Pointerdown rather than click, for the reason `MenuButton` gives: a panel
  // still on screen while something under it is being pressed is how a stray
  // second activation happens.
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (trigger.current?.contains(target) === true) return;
      if (panel.current?.contains(target) === true) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  // The pointer is not required to read this. Focus lands on the panel itself
  // rather than on its first button, because the first thing here is a sentence
  // and skipping straight to "Reload" would skip what it is offering to do.
  //
  // The page's own `:focus-visible` rule then draws the ring or does not, which
  // is the whole reason there is no `outline: none` on it: a reviewer who
  // pressed Enter gets told where their keyboard went, and one who clicked does
  // not get a ring traced round something they were already looking at.
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  const shut = (): void => {
    setOpen(false);
    trigger.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') return;
    // Stopped here rather than allowed to bubble: this page has one global
    // keydown listener and a diff underneath that would take the key next.
    event.stopPropagation();
    event.preventDefault();
    shut();
  };

  const worst = notices[0];
  const href = prPermalink(payload.pullRequest);

  return (
    <>
      {/* Mounted whether or not there is anything in it. A live region that
          arrives at the same instant as its text is one some screen readers
          never announce at all.

          `aria-live` rather than `role="status"`, which is the same politeness
          by another name. The role is a *queryable* thing, and an always-mounted
          empty one turns every `getByRole('status')` on this page — the scope
          bar's note, the search panel's "no matches" — into a query that finds
          two elements. The announcement is identical either way. */}
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announce(notices)}
      </p>

      {worst !== undefined && (
        <button
          type="button"
          className="notice-trigger"
          data-tone={worst.tone}
          ref={trigger}
          aria-haspopup="dialog"
          aria-expanded={open}
          // Only while there is something to point at. A control naming an id
          // that is not in the document is a promise the page is not keeping.
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((was) => !was)}
        >
          <ToneIcon tone={worst.tone} />
          {worst.title}
          {/* Only when there is more behind it. A "1" beside a label that
              already names the one thing is a number with nothing to say. */}
          {notices.length > 1 && (
            <span className="notice-count">{notices.length}</span>
          )}
        </button>
      )}

      {open && (
        <div
          className="notice-panel"
          id={panelId}
          role="dialog"
          aria-label="What this page cannot show"
          ref={panel}
          tabIndex={-1}
          onKeyDown={onKeyDown}
        >
          {notices.map((notice) => (
            <section key={notice.id} className="notice-item" data-tone={notice.tone}>
              <h2 className="notice-item-title">
                <ToneIcon tone={notice.tone} />
                {notice.title}
              </h2>

              {notice.id === 'token-rejected' && <TokenRejectedNotice retry={onReload} />}
              {notice.id === 'read-only' && <ReadOnlyNotice href={href} />}
              {notice.id === 'denied' && (
                <DeniedNotice denied={payload.denied} pr={payload.ref} href={href} />
              )}
              {notice.id === 'truncated' && (
                <TruncationNotice
                  truncated={payload.truncated}
                  pr={payload.ref}
                  href={href}
                />
              )}
              {notice.id === 'head-moved' && movedTo !== null && (
                <HeadMovedNotice
                  loaded={payload.headSha}
                  movedTo={movedTo}
                  reviewPending={reviewPending}
                  onReload={onReload}
                  onDismiss={onDismissMoved}
                />
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
