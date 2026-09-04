/**
 * The per-file control that chooses how a change is compared.
 *
 * Three properties, and each is a decision rather than a default.
 *
 * **Per file, not per type.** Two images in the same pull request can be in
 * different modes at once, because they are answering different questions: one
 * was redrawn and wants side-by-side, the next moved four pixels and wants the
 * difference blend. A single global mode would make the second reviewer action
 * undo the first.
 *
 * **It remembers nothing.** This page persists no interface state anywhere —
 * not the rail width, not which files are collapsed — and a mode that survived
 * a reload would be the one exception, silently deciding what the reviewer sees
 * on a file they have never opened.
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
