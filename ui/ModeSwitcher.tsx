/**
 * The per-file control that chooses how a change is compared.
 *
 * Three properties, and each is a decision rather than a default.
 *
 * **Per file for most kinds, per kind for Markdown.** Two images in the same
 * pull request can be in different modes at once, because they are answering
 * different questions: one was redrawn and wants side-by-side, the next moved
 * four pixels and wants the difference blend. A single global mode would make
 * the second reviewer action undo the first.
 *
 * Markdown is the exception, and the exception is narrow because the argument
 * above does not reach it. There are two modes, and which one a reviewer wants
 * is a fact about the reviewer rather than about the change — some people read
 * prose changes as rendered documents and some read them as source. So a press
 * on a `.md` card sets a preference for every `.md` card and persists it.
 * `lib/compare/modes.ts` names the kinds this is true of.
 *
 * **What it remembers is a view, never a concealment.** The page persists no
 * other interface state — not the rail width, not a fold made by hand — and
 * the objection to persisting any of it was that a preference set last Tuesday
 * would silently decide what a reviewer sees on a file they have never opened.
 * That objection is answered here rather than ignored: both Markdown modes show
 * the whole change, Raw is always present and always last, and it is one press
 * away on the card already on screen. Contrast `ignoreWhitespace` in
 * `lib/settings.ts`, which *hides lines* and therefore needed an options-page
 * home under a sentence saying what it hides. This does not, and must not grow
 * into something that does.
 *
 * A file marked viewed does open folded across a reload, and that is still not
 * a counter-example: nothing about it is stored here. It is read off GitHub's
 * own viewed state, the same state the checkbox beside this draws itself from,
 * which is also why unticking the box on github.com unfolds it here.
 *
 * **Plain buttons, each its own tab stop.** A roving-tabindex radio group would
 * be one stop per file rather than one per mode, which is tidier to tab
 * through and hides the choice from anyone scanning the page with a keyboard.
 * There are at most five of these per card and their labels say what they do.
 */

import type { ComparisonMode } from '@/lib/compare/modes';

export interface ModeSwitcherProps {
  path: string;
  modes: readonly ComparisonMode[];
  current: string;
  onChange: (path: string, mode: string) => void;
}

export function ModeSwitcher({ path, modes, current, onChange }: ModeSwitcherProps) {
  // One mode is no choice. Drawing a single dead button would say there is
  // something to switch to when there is not.
  if (modes.length < 2) return null;

  return (
    <div className="mode-switch" role="group" aria-label={`Compare ${path} as`}>
      {modes.map((mode) => (
        <button
          key={mode.id}
          type="button"
          className="mode-button"
          data-mode={mode.id}
          // `aria-pressed` rather than a `.selected` class alone: the visual
          // state of a toggle is invisible to a screen reader, and this is the
          // control that decides what the whole card shows.
          aria-pressed={mode.id === current}
          title={mode.hint}
          onClick={() => onChange(path, mode.id)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
