/**
 * Which repositories the dashboard is allowed to read.
 *
 * This is the control that makes the list cheap. Nothing is fetched until
 * something here is ticked, so an account with nineteen repositories of
 * scratch work costs one query that names them rather than four that read
 * every pull request in them.
 *
 * Presentational, and shared by two surfaces: a panel at the top of the
 * dashboard and a section on the options page. One component rather than two,
 * because a picker that disagreed with itself about what is ticked would be
 * worse than either.
 *
 * Rows, and real checkboxes. DESIGN.md asks for rows over a card grid, and a
 * checkbox is the control a reviewer already knows means "include this" — a
 * pair of pill buttons would be a new shape for a settled idea.
 */

import type { DiscoveredRepo } from '@/lib/dashboard/repos';
import './RepoPicker.css';

export interface RepoPickerProps {
  discovered: readonly DiscoveredRepo[];
  watched: readonly string[];
  discovering: boolean;
  /** Whether discovery has been asked for. False means offer, not report. */
  asked: boolean;
  onToggle: (nameWithOwner: string) => void;
  onDiscover: () => void;
}

/**
 * Watched first, then the rest, each half alphabetical.
 *
 * The ticked ones are what the dashboard actually reads, so they are what the
 * reviewer is checking when they open this. Sorting them up also means the
 * list does not reorder under the cursor on a tick — the row moves once, to
 * the top, which reads as a consequence rather than as a jump.
 */
function ordered(
  discovered: readonly DiscoveredRepo[],
  watched: readonly string[],
): DiscoveredRepo[] {
  const wanted = new Set(watched);
  return [...discovered].sort((a, b) => {
    const mine = Number(wanted.has(b.nameWithOwner)) - Number(wanted.has(a.nameWithOwner));
    return mine !== 0 ? mine : a.nameWithOwner.localeCompare(b.nameWithOwner);
  });
}

export function RepoPicker({
  discovered,
  watched,
  discovering,
  asked,
  onToggle,
  onDiscover,
}: RepoPickerProps) {
  if (!asked) {
    return (
      <div className="repos">
        <p className="repos-note">
          The dashboard reads only the repositories you pick. Nothing is fetched until
          you pick one.
        </p>
        <button type="button" className="button" onClick={onDiscover}>
          Find my repositories
        </button>
      </div>
    );
  }

  if (discovering) {
    return (
      <div className="repos">
        <p className="repos-note">Looking for repositories you have opened a pull request in.</p>
      </div>
    );
  }

  if (discovered.length === 0) {
    return (
      <div className="repos">
        <p className="repos-note">
          No repositories came back. Either this account has not opened a pull request
          anywhere, or the token cannot see the ones it has.
        </p>
        <button type="button" className="button" onClick={onDiscover}>
          Look again
        </button>
      </div>
    );
  }

  const wanted = new Set(watched);

  return (
    <div className="repos">
      <ul className="repos-list">
        {ordered(discovered, watched).map((repo) => {
          const on = wanted.has(repo.nameWithOwner);
          return (
            <li key={repo.nameWithOwner} className="repos-row">
              <label className="repos-label">
                <input
                  type="checkbox"
                  value={repo.nameWithOwner}
                  checked={on}
                  onChange={() => onToggle(repo.nameWithOwner)}
                />
                <span className="repos-name">{repo.nameWithOwner}</span>
                {repo.isPrivate && <span className="repos-tag">Private</span>}
                {/* Only when it is being watched. An unreachable repository
                    nobody asked for is not a shortfall — it is a row they have
                    not ticked, and saying otherwise would make a settings
                    screen nag about a choice they did not make. */}
                {on && !repo.reachable && (
                  <span className="repos-refused">This token cannot reach it</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      <button type="button" className="button repos-again" onClick={onDiscover}>
        Look again
      </button>
    </div>
  );
}
