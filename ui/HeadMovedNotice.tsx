/**
 * The notice for a pull request that moved while it was being read.
 *
 * Everything on the page below is a photograph of one commit, and once the head
 * moves that photograph is of a diff that no longer exists. The consequence is
 * not cosmetic: a line comment is addressed by `line` and `side` against the
 * pull request's current patch, so one written here and queued against a
 * superseded commit can be re-anchored somewhere else or come back marked
 * outdated the moment the review is submitted. The reviewer cannot see any of
 * that happening, which is why it has to be said.
 *
 * Said in the top bar's notice panel rather than in a banner over the diff. The
 * button that opens it names this — "New commits" — so the fact is on screen
 * whether or not the panel is open; see `NoticeCenter`.
 *
 * What it deliberately does not do is fix it. Reloading rebuilds the file list,
 * so doing it on the reviewer's behalf would take the diff out from under
 * somebody midway through a sentence about it — a worse outcome than the
 * staleness, and one they did not ask for. It states the fact, prices the
 * remedy, and leaves the decision where it belongs.
 *
 * Pricing the remedy is the part that has to be exactly right, because a
 * reviewer follows this advice. A reload unmounts the shell, and what that
 * costs depends on whether a review is open:
 *
 * - **The queued comments survive.** They are not held here; they are on a
 *   PENDING review on GitHub, and `initialPendingReview` finds it again from
 *   `viewerPendingReview` on the reloaded node.
 * - **Knowing how many there are does not.** A resumed review reports
 *   `countIsComplete: false`, so the footer goes from a count to a floor.
 * - **The review summary does not.** It is `useState` in `ReviewFooter`, never
 *   written anywhere, and the footer unmounts with the shell.
 * - **Comment drafts do.** `DraftStore` puts them in extension storage under
 *   the pull request and the line, and a reopened composer loads its own back.
 *
 * So the losable thing is the summary, and it is only mentioned when there is a
 * review for it to belong to. A warning that appears every time is one that is
 * read no times.
 */

/** GitHub's own abbreviation, and what `abbreviatedOid` falls back to. */
const short = (sha: string): string => sha.slice(0, 7);

export interface HeadMovedNoticeProps {
  /** The head commit the payload on screen was read at. */
  loaded: string;
  /** The head commit the pull request is on now. */
  movedTo: string;
  /** Whether the reviewer has a review open with comments queued on it. */
  reviewPending: boolean;
  onReload: () => void;
  /** Keep reading the commit already on screen. */
  onDismiss: () => void;
}

export function HeadMovedNotice({
  loaded,
  movedTo,
  reviewPending,
  onReload,
  onDismiss,
}: HeadMovedNoticeProps) {
  return (
    // `status` rather than `alert`, which is the one place this banner differs
    // from the two above it. Those describe a page that arrived incomplete and
    // have nothing to interrupt. This one is most likely to appear while the
    // reviewer is typing a comment — that is precisely when they were last
    // somewhere else — and an assertive live region would read itself out over
    // the top of them. Polite still announces; it just waits its turn.
    <aside className="notice-body" role="status">
      <p>
        New commits have been pushed to this pull request. It is now at{' '}
        <code>{short(movedTo)}</code>, and everything below was read at{' '}
        <code>{short(loaded)}</code> — including the line numbers a new comment
        would be attached to.
      </p>
      <p>
        {reviewPending
          ? 'Your queued comments are safe: they are held in a pending review on GitHub, and reloading finds them again — though it can no longer say how many there are. The summary typed into the review bar is not saved anywhere, so reloading loses it.'
          : 'Reloading costs you your place in the diff and any context you expanded to reach it. Comment drafts are saved and come back on their own.'}
      </p>
      <div className="notice-actions">
        <button type="button" className="button primary" onClick={onReload}>
          Reload at {short(movedTo)}
        </button>
        <button type="button" className="button" onClick={onDismiss}>
          Keep reading {short(loaded)}
        </button>
      </div>
    </aside>
  );
}
