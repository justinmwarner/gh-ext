import { describe, expect, it } from 'vitest';
import {
  type KeyEventLike,
  type Shortcut,
  type ShortcutAction,
  SEQUENCE_TIMEOUT_MS,
  SHORTCUTS,
  isTypingTarget,
  resolveMod,
  resolveShortcut,
  shortcutLabel,
  shortcutsByAction,
} from './keymap';

describe('resolveMod', () => {
  it('uses Ctrl off macOS', () => {
    expect(resolveMod('Win32')).toBe('Ctrl');
    expect(resolveMod('Linux x86_64')).toBe('Ctrl');
  });

  it('uses Meta on macOS', () => {
    expect(resolveMod('MacIntel')).toBe('Meta');
  });
});

const WINDOWS = 'Win32';
const MAC = 'MacIntel';

/** A keydown as the resolver sees it. Nothing here touches the DOM. */
function keydown(overrides: Partial<KeyEventLike> & { key: string }): KeyEventLike {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target: null,
    ...overrides,
  };
}

/** One keystroke against a fresh keymap, on the platform given. */
function press(
  event: Partial<KeyEventLike> & { key: string },
  platform = WINDOWS,
): ShortcutAction | null {
  return resolveShortcut(keydown(event), { platform, now: 0, pending: null }).action;
}

/** The chord for `Mod+key` on the platform given. */
const withMod = (key: string, platform: string, extra: Partial<KeyEventLike> = {}) =>
  keydown({
    key,
    ...(resolveMod(platform) === 'Meta' ? { metaKey: true } : { ctrlKey: true }),
    ...extra,
  });

describe('the shortcut table', () => {
  it('binds every action in the reference table exactly once', () => {
    // The map is the source of truth for the resolver *and* for the help
    // overlay, so a missing action is two bugs, not one.
    const actions: ShortcutAction[] = [
      'next-file',
      'previous-file',
      'next-hunk',
      'previous-hunk',
      'next-thread',
      'previous-thread',
      'next-unresolved-thread',
      'previous-unresolved-thread',
      'toggle-viewed',
      'comment-on-line',
      'reply-to-thread',
      'toggle-resolved',
      'file-jump',
      'submit-comment',
      'submit-review',
      'open-in-github',
      'search-in-diff',
      'shortcut-help',
    ];

    for (const action of actions) {
      expect(shortcutsByAction(action).length).toBeGreaterThan(0);
    }
    expect(new Set(SHORTCUTS.map((s) => s.action)).size).toBe(actions.length);
  });

  it('describes every binding, because the help overlay is generated from it', () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.description.length).toBeGreaterThan(0);
    }
  });
});

describe('single-key bindings', () => {
  const table: readonly [string, ShortcutAction][] = [
    ['j', 'next-file'],
    ['k', 'previous-file'],
    ['J', 'next-hunk'],
    ['K', 'previous-hunk'],
    ['n', 'next-thread'],
    ['p', 'previous-thread'],
    ['N', 'next-unresolved-thread'],
    ['P', 'previous-unresolved-thread'],
    ['v', 'toggle-viewed'],
    ['c', 'comment-on-line'],
    ['r', 'reply-to-thread'],
    ['e', 'toggle-resolved'],
    ['/', 'search-in-diff'],
    ['?', 'shortcut-help'],
  ];

  for (const [key, action] of table) {
    it(`resolves ${key} to ${action}`, () => {
      expect(press({ key })).toBe(action);
    });
  }

  it('reads the Shift variants as their own bindings, not as the lowercase one', () => {
    // The browser folds Shift into `key` for a printable character, so `J`
    // arrives as `J`. Matching case-insensitively would make `j` and `J` the
    // same shortcut and lose hunk navigation entirely.
    expect(press({ key: 'J', shiftKey: true })).toBe('next-hunk');
    expect(press({ key: 'K', shiftKey: true })).toBe('previous-hunk');
    expect(press({ key: 'N', shiftKey: true })).toBe('next-unresolved-thread');
    expect(press({ key: 'P', shiftKey: true })).toBe('previous-unresolved-thread');
  });

  it('ignores a bare key held with the platform modifier', () => {
    // Ctrl+J is a browser binding on Windows. Stealing it would be worse than
    // not having the shortcut.
    expect(resolveShortcut(withMod('j', WINDOWS), ctx(WINDOWS)).action).toBeNull();
    expect(resolveShortcut(withMod('j', MAC), ctx(MAC)).action).toBeNull();
  });

  it('ignores anything held with Alt', () => {
    expect(press({ key: 'j', altKey: true })).toBeNull();
  });

  it('does nothing for a key nobody bound', () => {
    expect(press({ key: 'z' })).toBeNull();
    expect(press({ key: 'ArrowDown' })).toBeNull();
  });

  it('does not treat a bare modifier keydown as a keystroke', () => {
    // Typing `?` fires a `Shift` keydown first. Treating it as an unmatched key
    // would cancel a `g` waiting for its second key.
    for (const key of ['Shift', 'Control', 'Alt', 'Meta']) {
      const held = resolveShortcut(keydown({ key, shiftKey: key === 'Shift' }), {
        platform: WINDOWS,
        now: 0,
        pending: { key: 'g', at: 0 },
      });
      expect(held.action).toBeNull();
      expect(held.pending).toEqual({ key: 'g', at: 0 });
    }
  });
});

const ctx = (platform: string, pending = null, now = 0) => ({ platform, now, pending });

describe('Mod chords, on both platforms', () => {
  it('resolves Mod+K to the file jump', () => {
    expect(resolveShortcut(withMod('k', WINDOWS), ctx(WINDOWS)).action).toBe('file-jump');
    expect(resolveShortcut(withMod('k', MAC), ctx(MAC)).action).toBe('file-jump');
  });

  it('resolves Mod+Enter to submitting the comment', () => {
    expect(resolveShortcut(withMod('Enter', WINDOWS), ctx(WINDOWS)).action).toBe(
      'submit-comment',
    );
    expect(resolveShortcut(withMod('Enter', MAC), ctx(MAC)).action).toBe(
      'submit-comment',
    );
  });

  it('resolves Shift+Mod+Enter to submitting the review', () => {
    const shifted = { shiftKey: true };
    expect(
      resolveShortcut(withMod('Enter', WINDOWS, shifted), ctx(WINDOWS)).action,
    ).toBe('submit-review');
    expect(resolveShortcut(withMod('Enter', MAC, shifted), ctx(MAC)).action).toBe(
      'submit-review',
    );
  });

  it('keeps the two Enter chords apart', () => {
    // `Enter` is the one bound key whose value is identical shifted and
    // unshifted, so these two can only be told apart by `shiftKey`.
    expect(resolveShortcut(withMod('Enter', WINDOWS), ctx(WINDOWS)).action).not.toBe(
      'submit-review',
    );
  });

  it('wants Ctrl on Windows and Cmd on macOS, and not the other one', () => {
    // Windows is the primary target: Ctrl is the binding that has to work.
    expect(
      resolveShortcut(keydown({ key: 'k', ctrlKey: true }), ctx(WINDOWS)).action,
    ).toBe('file-jump');
    expect(
      resolveShortcut(keydown({ key: 'k', metaKey: true }), ctx(WINDOWS)).action,
    ).toBeNull();

    expect(
      resolveShortcut(keydown({ key: 'k', metaKey: true }), ctx(MAC)).action,
    ).toBe('file-jump');
    expect(
      resolveShortcut(keydown({ key: 'k', ctrlKey: true }), ctx(MAC)).action,
    ).toBeNull();
  });

  it('takes Mod+F for the diff search, so the browser find does not open', () => {
    const windows = resolveShortcut(withMod('f', WINDOWS), ctx(WINDOWS));
    expect(windows.action).toBe('search-in-diff');
    expect(windows.handled).toBe(true);
    expect(resolveShortcut(withMod('f', MAC), ctx(MAC)).action).toBe('search-in-diff');
  });
});

describe('never while the reviewer is typing', () => {
  const fields: readonly [string, KeyEventLike['target']][] = [
    ['an input', { tagName: 'INPUT', isContentEditable: false }],
    ['a textarea', { tagName: 'TEXTAREA', isContentEditable: false }],
    ['a contenteditable', { tagName: 'DIV', isContentEditable: true }],
  ];

  for (const [name, target] of fields) {
    it(`fires no single-key shortcut inside ${name}`, () => {
      // A `j` in a comment composer must insert a `j`. Every unmodified
      // binding in the table is checked, so a new one cannot be added without
      // this rule being applied to it.
      const singles = SHORTCUTS.filter((s) => !s.mod);

      for (const shortcut of singles) {
        for (const key of shortcut.keys) {
          const result = resolveShortcut(
            keydown({ key, shiftKey: shortcut.shift === 'held', target }),
            ctx(WINDOWS),
          );
          expect([shortcut.action, key, result.action]).toEqual([
            shortcut.action,
            key,
            null,
          ]);
          expect(result.handled).toBe(false);
        }
      }
    });
  }

  it('leaves j, /, ? and g alone in a textarea by name', () => {
    const target = { tagName: 'TEXTAREA', isContentEditable: false };
    for (const key of ['j', 'k', 'J', 'n', 'v', 'c', 'r', 'e', '/', '?', 'g']) {
      const result = resolveShortcut(keydown({ key, target }), ctx(WINDOWS));
      expect(result.action).toBeNull();
      expect(result.pending).toBeNull();
      expect(result.handled).toBe(false);
    }
  });

  it('still submits with Mod+Enter from inside the composer, which is the point', () => {
    // The one deliberate exception, and it only covers chords that hold the
    // platform modifier: those cannot be typed into a field by accident.
    const target = { tagName: 'TEXTAREA', isContentEditable: false };
    expect(
      resolveShortcut(withMod('Enter', WINDOWS, { target }), ctx(WINDOWS)).action,
    ).toBe('submit-comment');
    expect(
      resolveShortcut(withMod('Enter', WINDOWS, { target, shiftKey: true }), ctx(WINDOWS))
        .action,
    ).toBe('submit-review');
    expect(resolveShortcut(withMod('k', WINDOWS, { target }), ctx(WINDOWS)).action).toBe(
      'file-jump',
    );
  });

  it('recognizes a typing target from tag name or contenteditable alone', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'textarea' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });
});

describe('the g h sequence', () => {
  it('opens GitHub when h follows g', () => {
    const first = resolveShortcut(keydown({ key: 'g' }), ctx(WINDOWS));
    expect(first.action).toBeNull();
    expect(first.pending).toEqual({ key: 'g', at: 0 });

    const second = resolveShortcut(keydown({ key: 'h' }), {
      platform: WINDOWS,
      now: 100,
      pending: first.pending,
    });
    expect(second.action).toBe('open-in-github');
    expect(second.pending).toBeNull();
  });

  it('forgets the g once the sequence times out', () => {
    const second = resolveShortcut(keydown({ key: 'h' }), {
      platform: WINDOWS,
      now: SEQUENCE_TIMEOUT_MS + 1,
      pending: { key: 'g', at: 0 },
    });
    expect(second.action).toBeNull();
    expect(second.pending).toBeNull();
  });

  it('still completes right on the deadline', () => {
    const second = resolveShortcut(keydown({ key: 'h' }), {
      platform: WINDOWS,
      now: SEQUENCE_TIMEOUT_MS,
      pending: { key: 'g', at: 0 },
    });
    expect(second.action).toBe('open-in-github');
  });

  it('does not swallow a lone g', () => {
    // `g` is not consumed by arming the sequence: nothing is prevented, and
    // anything else the page does with a `g` still happens.
    const armed = resolveShortcut(keydown({ key: 'g' }), ctx(WINDOWS));
    expect(armed.handled).toBe(false);
    expect(armed.action).toBeNull();
  });

  it('does not swallow the key that follows a g', () => {
    // `g` then `j` is a mistyped sequence, and the `j` still moves to the next
    // file rather than being eaten by the abandoned prefix.
    const after = resolveShortcut(keydown({ key: 'j' }), {
      platform: WINDOWS,
      now: 50,
      pending: { key: 'g', at: 0 },
    });
    expect(after.action).toBe('next-file');
    expect(after.pending).toBeNull();
  });

  it('does not arm the sequence from inside a text field', () => {
    const armed = resolveShortcut(
      keydown({ key: 'g', target: { tagName: 'INPUT', isContentEditable: false } }),
      ctx(WINDOWS),
    );
    expect(armed.pending).toBeNull();
    expect(armed.handled).toBe(false);
  });

  it('does not fire on h alone', () => {
    expect(press({ key: 'h' })).toBeNull();
  });
});

describe('shortcutLabel', () => {
  const of = (action: ShortcutAction): Shortcut => {
    const found = shortcutsByAction(action)[0];
    if (found === undefined) throw new Error(`no binding for ${action}`);
    return found;
  };

  it('writes a bare key as itself', () => {
    expect(shortcutLabel(of('next-file'), 'Ctrl')).toBe('j');
    expect(shortcutLabel(of('next-hunk'), 'Ctrl')).toBe('J');
  });

  it('names the modifier the way the platform does', () => {
    expect(shortcutLabel(of('file-jump'), 'Ctrl')).toBe('Ctrl+K');
    expect(shortcutLabel(of('file-jump'), 'Meta')).toBe('⌘+K');
  });

  it('spells out a Shift chord that the key value cannot show', () => {
    expect(shortcutLabel(of('submit-review'), 'Ctrl')).toBe('Ctrl+Shift+Enter');
    expect(shortcutLabel(of('submit-comment'), 'Ctrl')).toBe('Ctrl+Enter');
  });

  it('writes a sequence as two keys in a row', () => {
    expect(shortcutLabel(of('open-in-github'), 'Ctrl')).toBe('g h');
  });
});
