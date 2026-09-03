/**
 * Every review thread on the pull request, gathered under the file it is on.
 *
 * This is the only global index of threads in the application. A file's
 * unanchorable-thread section is rendered by `CodeView`'s custom header, so it
 * exists only once the column has drawn that file — and `files` is capped while
 * `reviewThreads` is followed separately, so some threads have no card at all.
 * Nothing is filtered out here for being unreachable; it is labelled
 * unreachable instead.
 *
 * Resolved threads are folded rather than dropped for the same reason. "All
 * resolved" is not "nothing to read", and for a thread on a file the column
 * never received this disclosure is the only way back to it.
 *
 * It lists rather than hosts. A thread is *read and replied to* in the diff,
 * where the code it is about is on screen — so this view carries the opening
 * comment and a way to get there, and deliberately does not render a second
 * reply box for a thread that already has one. Two boxes for one thread is two
 * places for a reviewer's half-typed reply to be, and only one of them survives
 * pressing the key that posts it.
 */

import { useMemo } from 'react';
import { useReviewSession } from './reviewSession';
import { type FileThreadGroup, type ThreadEntry, threadGroups } from './reviewThreads';
import { splitBody } from './suggestion';
import { formatTimestamp } from './timestamp';

export interface ConversationsViewProps {
  /** The paths the diff column has cards for, in the order it shows them. */
  paths: readonly string[];
  /** Show me this thread: switch to the diff and scroll to it. */
  onGoTo: (threadId: string, path: string) => void;
}

/**
 * The prose of the opening comment, and whether it proposed an edit.
 *
 * Bodies are Markdown drawn as plain text throughout this application, which
 * is a deliberate limitation — but a suggestion fence is content rather than
 * formatting, and left in it renders its backticks into the middle of the
 * excerpt. Pulled out, it becomes one chip.
 */
function readBody(body: string): { prose: string; suggests: boolean } {
  const parts = splitBody(body);
  return {
    prose: parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim(),
    suggests: parts.some((part) => part.kind === 'suggestion'),
  };
}

function Entry({
  entry,
  path,
  onGoTo,
}: {
  entry: ThreadEntry;
  path: string;
  onGoTo: ConversationsViewProps['onGoTo'];
}) {
  const session = useReviewSession();
  const { prose, suggests } = readBody(entry.body);
  const unposted = session.unpublished.has(entry.threadId);

  return (
    <article className="thread-entry" data-thread-entry={entry.threadId}>
      <div className="thread-entry-head">
        <span className="thread-entry-position">{entry.position}</span>
        {entry.isOutdated && <span className="thread-flag">Outdated</span>}
        {entry.isResolved && <span className="thread-flag">Resolved</span>}
        {unposted && (
          <span
            className="thread-flag thread-flag-unposted"
            title="This is part of your pending review. Nobody else can see it until you submit the review."
          >
            Not posted yet
          </span>
        )}
        {suggests && <span className="thread-flag">Suggests a change</span>}

        {/* In the head rather than on a row of its own, so it lands in the
            same place down a column of cards of different heights — and so a
            card is three lines tall instead of five. */}
        <button
          type="button"
          className="button thread-entry-goto"
          // The visible word is short; the name is not. `threadPosition`
          // returns fragments — "was on line 5", "Position unknown" — so a
          // label built from one reads as neither, and a column of buttons all
          // called "Go to" tells a screen reader nothing about which is which.
          aria-label={`Go to ${path}, ${entry.position}`}
          onClick={() => onGoTo(entry.threadId, path)}
        >
          Go to
        </button>
      </div>

      {(entry.author !== '' || entry.replies > 0) && (
        <p className="thread-entry-byline">
          {entry.author !== '' && (
            <span className="comment-author">{entry.author}</span>
          )}
          {entry.createdAt !== '' && (
            <time dateTime={entry.createdAt}>{formatTimestamp(entry.createdAt)}</time>
          )}
          {entry.replies > 0 && (
            <span className="thread-entry-replies">
              {`${entry.replies} more ${entry.replies === 1 ? 'reply' : 'replies'}`}
            </span>
          )}
        </p>
      )}

      {prose !== '' && <p className="thread-entry-body">{prose}</p>}
    </article>
  );
}

function Group({
  group,
  onGoTo,
}: {
  group: FileThreadGroup;
  onGoTo: ConversationsViewProps['onGoTo'];
}) {
  return (
    <section className="conversation-group">
      <h3 className="conversation-path" title={group.path}>
        {/* Isolated so the right-to-left truncation reverses where the text is
            cut without reversing the path itself. */}
        <span>{group.path}</span>
      </h3>

      {!group.inDiff && (
        // The column has no card to scroll to. Saying so is the whole reason
        // this group is here rather than dropped.
        <p className="conversation-absent" role="note">
          Not in this diff
        </p>
      )}

      {group.open.map((entry) => (
        <Entry key={entry.threadId} entry={entry} path={group.path} onGoTo={onGoTo} />
      ))}

      {group.resolved.length > 0 && (
        <details className="conversation-resolved">
          <summary>{`${group.resolved.length} resolved`}</summary>
          {group.resolved.map((entry) => (
            <Entry key={entry.threadId} entry={entry} path={group.path} onGoTo={onGoTo} />
          ))}
        </details>
      )}
    </section>
  );
}

export function ConversationsView({ paths, onGoTo }: ConversationsViewProps) {
  const session = useReviewSession();
  const groups = useMemo(
    () => threadGroups(session.threads, paths),
    [session.threads, paths],
  );

  if (groups.length === 0) {
    return (
      <div className="conversations">
        <p className="placeholder">No comments on this pull request yet.</p>
      </div>
    );
  }

  return (
    <div className="conversations">
      {groups.map((group) => (
        <Group key={group.path} group={group} onGoTo={onGoTo} />
      ))}
    </div>
  );
}
