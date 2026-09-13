/**
 * The threads this file's diff cannot show, listed where they cannot be missed.
 *
 * This section is the safety net, not a nicety. Pierre resolves an annotation
 * by line number against the rows it drew; a line inside collapsed context, or
 * on a file with no patch at all, has no row, so the annotation is assigned to
 * no slot and the browser draws nothing. No error is raised anywhere. A thread
 * that is neither anchored in the diff nor listed here is simply invisible, and
 * the reviewer is never told a comment exists.
 *
 * Collapsed by default, because these are usually settled or stale, and open on
 * demand with the count on the summary so the reviewer can decide.
 */

import type { ListedReason, ListedThread } from './reviewThreads';
import { ThreadCard } from './ThreadCard';

const REASONS: Record<ListedReason, string> = {
  outdated: 'The line this was written on has changed since.',
  'file-level': 'Left on the file as a whole rather than on a line.',
  'no-line': 'GitHub sent no line number for this thread.',
  'out-of-hunk': 'Its line is outside the part of the file this diff shows.',
  // Not "not shown" but "cannot be placed". This comment's line number is a
  // position in the pull request's own diff, and the diff on screen is between
  // two other commits, so the line it names is a line of a different file.
  // Drawing it anyway would put the comment on whatever text happened to be
  // there, which is why it is here instead.
  'other-commit':
    'Written against the whole pull request, which is not the diff on screen. ' +
    'Show all commits to see it in place.',
  // Says what the rendered view is rather than what it failed at: a document
  // is blocks of prose, and the lines between them — a blank separator, raw
  // HTML passed through untouched — are not part of any of them. The line is
  // perfectly good, so the sentence names the view that can show it rather
  // than telling the reviewer something is wrong with their comment.
  'no-block':
    'Nothing in the rendered document stands on the line this was written on. ' +
    'Raw shows it on its line.',
  // Named by the reviewer's own action rather than by "not shown", because it
  // is the one reason in this list they turned on themselves and can turn off.
  'whitespace-only':
    'Nothing but whitespace changed where this was written, and diffs are set ' +
    'to hide that. Turn off “hide changes where only the whitespace moved” on ' +
    'the options page to see it in place.',
};

export function UnanchoredThreads({
  path,
  threads,
}: {
  path: string;
  threads: readonly ListedThread[];
}) {
  if (threads.length === 0) return null;

  return (
    <details className="unanchored" data-unanchored={path}>
      <summary>
        {`${threads.length} ${threads.length === 1 ? 'comment' : 'comments'} not shown in the diff`}
      </summary>
      <ul className="unanchored-list">
        {threads.map(({ thread, reason }) => (
          <li key={thread.id} data-listed-reason={reason}>
            <p className="unanchored-reason">{REASONS[reason]}</p>
            <ThreadCard threadId={thread.id} />
          </li>
        ))}
      </ul>
    </details>
  );
}
