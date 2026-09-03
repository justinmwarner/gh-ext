/**
 * Every review thread on the pull request, gathered under the file it is on.
 *
 * This is the only global index of threads in the application. A file's
 * unanchorable-thread section is rendered by `CodeView`'s custom header, so it
 * exists only once the column has drawn that file — and `files` is capped while
 * `reviewThreads` is followed separately, so some threads have no card at all.
 * Nothing is filtered out here for being unreachable; it is labelled unreachable
 * instead.
 *
 * Resolved threads are folded rather than dropped for the same reason. "All
 * resolved" is not "nothing to read", and for a thread on a file the column
 * never received this disclosure is the only way back to it.
 */

import { useMemo } from 'react';
import { useReviewSession } from './reviewSession';
import { type ThreadEntry, threadGroups } from './reviewThreads';

export interface ConversationsPageProps {
  /** The paths the diff column has cards for, in the order it shows them. */
  paths: readonly string[];
  onJumpToThread: (threadId: string, path: string) => void;
}

function JumpList({
  entries,
  path,
  onJumpToThread,
}: {
  entries: readonly ThreadEntry[];
  path: string;
  onJumpToThread: ConversationsPageProps['onJumpToThread'];
}) {
  return (
    <ul className="jump-list">
      {entries.map((entry) => (
        <li key={entry.threadId}>
          <button
            type="button"
            className="jump-entry"
            onClick={() => onJumpToThread(entry.threadId, path)}
          >
            <span className="jump-position">{entry.position}</span>
            {entry.excerpt !== '' && <span className="jump-excerpt">{entry.excerpt}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ConversationsPage({ paths, onJumpToThread }: ConversationsPageProps) {
  const session = useReviewSession();
  const groups = useMemo(
    () => threadGroups(session.threads, paths),
    [session.threads, paths],
  );

  if (groups.length === 0) {
    return <p className="placeholder">No comments on this pull request yet.</p>;
  }

  return (
    <div className="conversations">
      {groups.map((group) => (
        <section className="conversation-group" key={group.path}>
          <h2 className="conversation-path" title={group.path}>
            {/* Isolated so the right-to-left truncation above reverses where
                the text is cut without reversing the path itself. */}
            <span>{group.path}</span>
          </h2>

          {!group.inDiff && (
            // The column has no card to scroll to. Saying so is the whole
            // reason this group is here rather than dropped.
            <p className="conversation-absent" role="note">
              Not in this diff
            </p>
          )}

          <JumpList entries={group.open} path={group.path} onJumpToThread={onJumpToThread} />

          {group.resolved.length > 0 && (
            <details className="conversation-resolved">
              <summary>
                {`${group.resolved.length} resolved`}
              </summary>
              <JumpList
                entries={group.resolved}
                path={group.path}
                onJumpToThread={onJumpToThread}
              />
            </details>
          )}
        </section>
      ))}
    </div>
  );
}
