/**
 * The review keyboard, as data plus one pure resolver.
 *
 * Everything here is a value: the bindings are a table, and `resolveShortcut`
 * turns a keystroke and a little context into an action or nothing at all. No
 * DOM, no listeners, no timers — which is what lets the whole map be tested in
 * the `lib` node project, where an accidental `document` reference fails loudly.
 *
 * Three rules run through it, and each exists because of a specific way a
 * keymap like this goes wrong:
 *
 * - **The platform check lives in `resolveMod` and nowhere else.** Ctrl on
 *   Windows and Linux, Cmd on macOS. Windows is the primary target, so Ctrl is
 *   the binding that has to work; the wrong modifier is also rejected, because
 *   Ctrl+K on macOS is "delete to end of line" and stealing it is worse than
 *   having no shortcut.
 * - **Nothing unmodified fires while the reviewer is typing.** A `j` in a
 *   comment composer must insert a `j`. The single deliberate exception is a
 *   chord that holds the platform modifier — `Mod+Enter` exists precisely to
 *   submit from inside the box, and no modifier chord can be typed by accident.
 * - **`g h` is a sequence, not a chord.** The first key arms a short-lived
 *   prefix and is *not* consumed; anything that is not the second key drops the
 *   prefix and is then resolved on its own merits, so `g` followed by `j` still
 *   moves to the next file.
 *
 * The help overlay is generated from `SHORTCUTS` through `shortcutLabel`. A
 * hand-maintained second copy would drift, and a shortcut nobody can discover
 * is barely a shortcut.
 */

export type ModKey = 'Ctrl' | 'Meta';

/** Platform string is injected rather than read from navigator so this stays pure. */
export function resolveMod(platform: string): ModKey {
  return /^Mac/i.test(platform) ? 'Meta' : 'Ctrl';
}

export type ShortcutAction =
  | 'next-file'
  | 'previous-file'
  | 'next-hunk'
  | 'previous-hunk'
  | 'next-thread'
  | 'previous-thread'
  | 'next-unresolved-thread'
  | 'previous-unresolved-thread'
  | 'toggle-viewed'
  | 'comment-on-line'
  | 'reply-to-thread'
  | 'toggle-resolved'
  | 'file-jump'
  | 'submit-comment'
  | 'submit-review'
  | 'open-in-github'
  | 'search-in-diff'
  | 'shortcut-help';

/**
 * What Shift has to be doing for a binding to match.
 *
 * `'from-key'` is the common case and is not a shrug. For a printable key the
 * browser has already folded Shift into `event.key`: Shift+j arrives as `J`, so
 * the case of the key *is* the Shift test. Checking `shiftKey` as well would
 * reject `/` on the layouts where it is a shifted key, and `?` on the ones
 * where it is not. `Enter` is the one bound key whose value is identical either
 * way, so the two Enter chords say what they need explicitly.
 */
export type ShiftRule = 'from-key' | 'held' | 'not-held';

/** Which part of the review a binding belongs to, for the help overlay. */
export type ShortcutGroup = 'Moving around' | 'Reviewing' | 'Finding things';

export interface Shortcut {
  action: ShortcutAction;
  /** One key, or two for a sequence. Compared against `KeyboardEvent.key`. */
  keys: readonly string[];
  /** The platform modifier must be held — and only that one. */
  mod: boolean;
  shift: ShiftRule;
  /** What the help overlay says this does. */
  description: string;
  group: ShortcutGroup;
}

/**
 * How long a sequence prefix stays armed.
 *
 * Long enough for `g h` typed at a human pace, short enough that a `g` pressed
 * by mistake is forgotten before the next real keystroke arrives.
 */
export const SEQUENCE_TIMEOUT_MS = 1000;

export const SHORTCUTS: readonly Shortcut[] = [
  {
    action: 'next-file',
    keys: ['j'],
    mod: false,
    shift: 'from-key',
    description: 'Next file',
    group: 'Moving around',
  },
  {
    action: 'previous-file',
    keys: ['k'],
    mod: false,
    shift: 'from-key',
    description: 'Previous file',
    group: 'Moving around',
  },
  {
    action: 'next-hunk',
    keys: ['J'],
    mod: false,
    shift: 'from-key',
    description: 'Next hunk',
    group: 'Moving around',
  },
  {
    action: 'previous-hunk',
    keys: ['K'],
    mod: false,
    shift: 'from-key',
    description: 'Previous hunk',
    group: 'Moving around',
  },
  {
    action: 'next-thread',
    keys: ['n'],
    mod: false,
    shift: 'from-key',
    description: 'Next comment thread',
    group: 'Moving around',
  },
  {
    action: 'previous-thread',
    keys: ['p'],
    mod: false,
    shift: 'from-key',
    description: 'Previous comment thread',
    group: 'Moving around',
  },
  {
    action: 'next-unresolved-thread',
    keys: ['N'],
    mod: false,
    shift: 'from-key',
    description: 'Next unresolved thread',
    group: 'Moving around',
  },
  {
    action: 'previous-unresolved-thread',
    keys: ['P'],
    mod: false,
    shift: 'from-key',
    description: 'Previous unresolved thread',
    group: 'Moving around',
  },
  {
    action: 'toggle-viewed',
    keys: ['v'],
    mod: false,
    shift: 'from-key',
    description: 'Mark the current file viewed, or take the mark back',
    group: 'Reviewing',
  },
  {
    action: 'comment-on-line',
    keys: ['c'],
    mod: false,
    shift: 'from-key',
    description: 'Comment on the selected line',
    group: 'Reviewing',
  },
  {
    action: 'reply-to-thread',
    keys: ['r'],
    mod: false,
    shift: 'from-key',
    description: 'Reply to the focused thread',
    group: 'Reviewing',
  },
  {
    action: 'toggle-resolved',
    keys: ['e'],
    mod: false,
    shift: 'from-key',
    description: 'Resolve or unresolve the focused thread',
    group: 'Reviewing',
  },
  {
    action: 'file-jump',
    keys: ['k'],
    mod: true,
    shift: 'not-held',
    description: 'Jump to a file by name',
    group: 'Finding things',
  },
  {
    action: 'submit-comment',
    keys: ['Enter'],
    mod: true,
    shift: 'not-held',
    description: 'Post the comment being written',
    group: 'Reviewing',
  },
  {
    action: 'submit-review',
    keys: ['Enter'],
    mod: true,
    shift: 'held',
    description: 'Submit the pending review',
    group: 'Reviewing',
  },
  {
    action: 'open-in-github',
    keys: ['g', 'h'],
    mod: false,
    shift: 'from-key',
    description: 'Open this pull request on GitHub',
    group: 'Moving around',
  },
  {
    action: 'search-in-diff',
    keys: ['/'],
    mod: false,
    shift: 'from-key',
    description: 'Search the diff',
    group: 'Finding things',
  },
  {
    // An alias, not a second feature. `/` is the binding the table asks for,
    // but on Windows and Linux `/` is not what opens a find bar — Ctrl+F is —
    // and "override the browser's own find" is only true if that one is taken
    // too. Both are listed in the help, so neither can go undocumented.
    action: 'search-in-diff',
    keys: ['f'],
    mod: true,
    shift: 'not-held',
    description: 'Search the diff',
    group: 'Finding things',
  },
  {
    action: 'shortcut-help',
    keys: ['?'],
    mod: false,
    shift: 'from-key',
    description: 'Show this list',
    group: 'Finding things',
  },
];

export function shortcutsByAction(action: ShortcutAction): Shortcut[] {
  return SHORTCUTS.filter((shortcut) => shortcut.action === action);
}

/** Every action once, in the order the table declares it. For the help overlay. */
export function shortcutActions(): ShortcutAction[] {
  const seen: ShortcutAction[] = [];
  for (const shortcut of SHORTCUTS) {
    if (!seen.includes(shortcut.action)) seen.push(shortcut.action);
  }
  return seen;
}

/**
 * A `KeyboardEvent`, as much of one as the resolver reads.
 *
 * Structural rather than the DOM type, so `lib/` names no DOM and a test can
 * hand in a plain object.
 */
export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** Whatever the event was aimed at. `EventTarget` is not an element. */
  target?: unknown;
}

/** The first key of a sequence, and when it was pressed. */
export interface PendingSequence {
  key: string;
  /** Epoch milliseconds, supplied by the caller. Nothing here reads a clock. */
  at: number;
}

export interface KeymapContext {
  /** `navigator.platform`, injected. Read only through `resolveMod`. */
  platform: string;
  /** Epoch milliseconds for this keystroke. */
  now: number;
  /** The sequence prefix still waiting for its second key, or null. */
  pending: PendingSequence | null;
}

export interface KeymapResolution {
  /** What to do, or null when this keystroke means nothing here. */
  action: ShortcutAction | null;
  /** The prefix now waiting for a second key. The caller carries it forward. */
  pending: PendingSequence | null;
  /**
   * Whether the keystroke was consumed, and so should be prevented.
   *
   * False for the first key of a sequence: arming `g h` must not swallow a
   * lone `g`.
   */
  handled: boolean;
}

const NOTHING: KeymapResolution = { action: null, pending: null, handled: false };

/**
 * Keys that are only ever held, never pressed for their own sake.
 *
 * Typing `?` fires a `Shift` keydown first. Treating that as an unmatched key
 * would cancel a sequence prefix that is legitimately still waiting.
 */
const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'AltGraph',
]);

/** Elements that consume ordinary keystrokes as text. */
const TYPING_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA']);

/**
 * Is this keystroke aimed at somewhere the reviewer is writing?
 *
 * Duck-typed rather than `instanceof HTMLElement`, because `lib/` names no DOM
 * — and because the answer has to be the same for a real event target and for
 * the plain object a test hands in.
 */
export function isTypingTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const node = target as { tagName?: unknown; isContentEditable?: unknown };
  if (node.isContentEditable === true) return true;
  return (
    typeof node.tagName === 'string' && TYPING_TAGS.has(node.tagName.toUpperCase())
  );
}

const shiftMatches = (rule: ShiftRule, shiftKey: boolean): boolean =>
  rule === 'from-key' ? true : rule === 'held' ? shiftKey : !shiftKey;

/** Does `key` — at position `index` of the binding — match this keystroke? */
function keyMatches(
  shortcut: Shortcut,
  index: number,
  event: KeyEventLike,
  modHeld: boolean,
): boolean {
  return (
    shortcut.keys[index] === event.key &&
    shortcut.mod === modHeld &&
    shiftMatches(shortcut.shift, event.shiftKey)
  );
}

/** The prefix, if it has not aged out. */
function livePrefix(context: KeymapContext): PendingSequence | null {
  const { pending, now } = context;
  if (pending === null) return null;
  return now - pending.at <= SEQUENCE_TIMEOUT_MS ? pending : null;
}

/**
 * One keystroke, resolved.
 *
 * Total and side-effect free: the caller owns the pending prefix and hands it
 * back in, so two windows — or a test — never share a hidden timer.
 */
export function resolveShortcut(
  event: KeyEventLike,
  context: KeymapContext,
): KeymapResolution {
  // A modifier held on its own is not a keystroke. Leave the prefix exactly as
  // it was rather than treating this as a miss.
  if (MODIFIER_KEYS.has(event.key)) {
    return { action: null, pending: context.pending, handled: false };
  }

  const mod = resolveMod(context.platform);
  const modHeld = mod === 'Meta' ? event.metaKey : event.ctrlKey;
  const wrongMod = mod === 'Meta' ? event.ctrlKey : event.metaKey;

  // Alt, or the modifier this platform does not use, means the keystroke
  // belongs to the browser or the OS.
  if (event.altKey || wrongMod) return NOTHING;

  const typing = isTypingTarget(event.target);

  const prefix = livePrefix(context);
  if (prefix !== null) {
    const completed = SHORTCUTS.find(
      (shortcut) =>
        shortcut.keys.length === 2 &&
        shortcut.keys[0] === prefix.key &&
        keyMatches(shortcut, 1, event, modHeld),
    );
    // A sequence can only have been armed outside a text field, so completing
    // one needs no typing check of its own.
    if (completed !== undefined) {
      return { action: completed.action, pending: null, handled: true };
    }
    // Not the second key. The prefix is dropped and this keystroke is resolved
    // on its own merits below, so `g` then `j` still moves to the next file.
  }

  const single = SHORTCUTS.find(
    (shortcut) => shortcut.keys.length === 1 && keyMatches(shortcut, 0, event, modHeld),
  );
  if (single !== undefined) {
    // The rule and its one exception. A chord that holds the platform modifier
    // cannot be typed into a field by accident, and `Mod+Enter` exists to
    // submit from inside the composer.
    if (typing && !single.mod) return NOTHING;
    return { action: single.action, pending: null, handled: true };
  }

  const arms =
    !typing &&
    !modHeld &&
    SHORTCUTS.some(
      (shortcut) => shortcut.keys.length === 2 && shortcut.keys[0] === event.key,
    );
  // `handled: false` on purpose: arming must not swallow a lone `g`.
  if (arms) return { action: null, pending: { key: event.key, at: context.now }, handled: false };

  return NOTHING;
}

/** How the platform modifier is written. */
const MOD_LABEL: Record<ModKey, string> = { Ctrl: 'Ctrl', Meta: '⌘' };

/**
 * One binding, as the help overlay prints it.
 *
 * Derived from the table rather than stored beside it. A capital `J` is left to
 * speak for itself — that is how the key arrives and how every other review
 * tool writes it — while a `Shift` that the key value cannot show is spelled
 * out. A sequence is its keys in a row, which is how it is typed.
 */
export function shortcutLabel(shortcut: Shortcut, mod: ModKey): string {
  const parts: string[] = [];
  if (shortcut.mod) parts.push(MOD_LABEL[mod]);
  if (shortcut.shift === 'held') parts.push('Shift');
  parts.push(
    shortcut.keys
      .map((key) => (shortcut.mod && key.length === 1 ? key.toUpperCase() : key))
      .join(' '),
  );
  return parts.join('+');
}
