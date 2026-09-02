/**
 * The list of shortcuts, generated from the shortcuts.
 *
 * Every row here is read off `SHORTCUTS` — the same table `resolveShortcut`
 * matches against — so a binding cannot be added without appearing here, and a
 * label cannot drift from the key it documents. A hand-written copy of a keymap
 * is wrong within a week, and a shortcut nobody can discover is barely a
 * shortcut at all.
 *
 * Actions with more than one binding are one row with both spellings, because
 * they are one thing the reviewer can do.
 */

import {
  SHORTCUTS,
  type ShortcutGroup,
  resolveMod,
  shortcutActions,
  shortcutLabel,
  shortcutsByAction,
} from '@/lib/keymap';
import { platformString } from './platform';

/** The order the groups read in. Derived from the table, not a second list. */
function groupsInOrder(): ShortcutGroup[] {
  const seen: ShortcutGroup[] = [];
  for (const shortcut of SHORTCUTS) {
    if (!seen.includes(shortcut.group)) seen.push(shortcut.group);
  }
  return seen;
}

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const mod = resolveMod(platformString());
  const actions = shortcutActions();

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div
        className="overlay shortcut-help"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        // The backdrop closes; a click on the panel itself must not travel up
        // to it and close the thing that was just clicked.
        onClick={(event) => event.stopPropagation()}
      >
        <header className="overlay-head">
          <h2>Keyboard shortcuts</h2>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </header>

        {groupsInOrder().map((group) => (
          <section className="shortcut-group" key={group}>
            <h3>{group}</h3>
            <dl className="shortcut-list">
              {actions
                .filter((action) => shortcutsByAction(action)[0]?.group === group)
                .map((action) => {
                  const bindings = shortcutsByAction(action);
                  const first = bindings[0];
                  if (first === undefined) return null;
                  return (
                    <div className="shortcut-row" key={action}>
                      <dt>
                        {bindings.map((binding, index) => (
                          <span key={shortcutLabel(binding, mod)}>
                            {index > 0 && <span className="shortcut-or"> or </span>}
                            <kbd>{shortcutLabel(binding, mod)}</kbd>
                          </span>
                        ))}
                      </dt>
                      <dd>{first.description}</dd>
                    </div>
                  );
                })}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
