# Markdown Mode Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pressing a mode button on a `.md` card sets a preference that flips every other Markdown card at once and survives into the next pull request.

**Architecture:** A new `storage.local` key of its own — never a field on `Settings`, because two writers doing read-modify-write on one key will eventually lose an edit. `lib/settings.ts` owns the shape and the per-field parse; `lib/settings-store.ts` gets the three-call adapter; a `useModeMemory` hook mirrors `useSettings` exactly. Only the Markdown kind is remembered, and `lib/compare/modes.ts` says which kinds those are.

**Tech Stack:** TypeScript, React 19, WXT, `browser.storage.local`, vitest (node for `lib/`, jsdom for `ui/`).

**Design source:** `docs/superpowers/specs/2026-09-12-markdown-review-design.md` §8.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/compare/modes.ts` (modify) | `REMEMBERED_KINDS` and `isRememberedKind` — which kinds carry a preference |
| `lib/settings.ts` (modify) | `MODE_MEMORY_KEY`, `ModeMemory`, `EMPTY_MODE_MEMORY`, `parseModeMemory` |
| `lib/settings-store.ts` (modify) | `readModeMemory`, `writeModeMemory`, `onModeMemoryChanged` |
| `ui/useModeMemory.ts` (create) | The hook: current memory plus a `remember` callback that persists |
| `ui/DiffColumn.tsx` (modify) | Resolution order and the retroactive flip |
| `ui/ModeSwitcher.tsx` (modify) | Amend the comment that states the opposite rule |

---

### Task 1: Which kinds are remembered

**Files:**
- Modify: `lib/compare/modes.ts` (append near `ALL_MODE_IDS`, after `modesForFile`)
- Test: `lib/compare/modes.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/compare/modes.test.ts`:

```ts
describe('isRememberedKind', () => {
  it('remembers markdown', () => {
    expect(isRememberedKind('markdown')).toBe(true);
  });

  // The argument in ModeSwitcher.tsx is specific to these: two images in one
  // pull request are answering different questions, so a kind-wide preference
  // would make each choice undo the last.
  it.each(['image', 'svg', 'table', 'structured', 'notebook', 'none'] as const)(
    'does not remember %s',
    (kind) => {
      expect(isRememberedKind(kind)).toBe(false);
    },
  );
});
```

Add `isRememberedKind` to the existing import from `./modes` at the top of that file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/compare/modes.test.ts -t isRememberedKind`
Expected: FAIL — `isRememberedKind is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `lib/compare/modes.ts`:

```ts
/**
 * The kinds whose mode is a preference rather than a per-file choice.
 *
 * Markdown alone, and the narrowness is the point. `ui/ModeSwitcher.tsx`
 * argues for per-file modes with a case that is true of every other kind here:
 * two images in one pull request want different modes, because one was redrawn
 * and wants side by side while the next moved four pixels and wants the
 * difference blend. A kind-wide preference makes the second choice undo the
 * first.
 *
 * Markdown is the exception because the choice is a property of the reader
 * rather than of the change. There are two modes, some people read prose
 * changes as rendered documents and some read them as source, and nobody
 * changes their mind about that per file.
 */
const REMEMBERED_KINDS: ReadonlySet<ComparisonKind> = new Set<ComparisonKind>(['markdown']);

export function isRememberedKind(kind: ComparisonKind): boolean {
  return REMEMBERED_KINDS.has(kind);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/compare/modes.test.ts -t isRememberedKind`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add lib/compare/modes.ts lib/compare/modes.test.ts
git commit -m "feat: name the kinds whose mode is a preference"
```

---

### Task 2: The stored shape and its parse

**Files:**
- Modify: `lib/settings.ts` (add beside `CARD_COLLAPSED_KEY`, and the parse beside `parseSettings`)
- Test: `lib/settings.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/settings.test.ts`:

```ts
describe('parseModeMemory', () => {
  it('reads a remembered markdown mode', () => {
    expect(parseModeMemory({ markdown: 'raw' })).toEqual({ markdown: 'raw' });
  });

  it.each([null, undefined, 'raw', 42, []])('falls back on %p', (raw) => {
    expect(parseModeMemory(raw)).toEqual({});
  });

  // A kind this build does not remember, written by a later one.
  it('drops a kind that is not remembered', () => {
    expect(parseModeMemory({ image: 'image:swipe' })).toEqual({});
  });

  // A mode id from a later build, or one that has since been withdrawn.
  it('drops an unknown mode id', () => {
    expect(parseModeMemory({ markdown: 'markdown:side-by-side' })).toEqual({});
  });

  // A real mode, but not one this kind offers. Storing it would put a control
  // on the card that the file cannot answer.
  it('drops a mode belonging to another kind', () => {
    expect(parseModeMemory({ markdown: 'image:swipe' })).toEqual({});
  });

  // Per field, like parseSettings: one bad entry must not discard a good one.
  it('keeps a good entry beside a bad one', () => {
    expect(parseModeMemory({ markdown: 'raw', image: 'nonsense' })).toEqual({
      markdown: 'raw',
    });
  });
});
```

Add `parseModeMemory` to the existing import from `./settings`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/settings.test.ts -t parseModeMemory`
Expected: FAIL — `parseModeMemory is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to the imports at the top of `lib/settings.ts`:

```ts
import {
  type ComparisonKind,
  isRememberedKind,
  modesFor,
} from './compare/modes';
```

Add beside `CARD_COLLAPSED_KEY`:

```ts
/**
 * `storage.local` key holding the mode each remembered kind opens in.
 *
 * Its own key rather than a field on {@link Settings}, and for the same reason
 * {@link CARD_COLLAPSED_KEY} is: the review page writes this on every press
 * while the options page writes the settings object, and two writers doing
 * read-modify-write on one key will eventually lose one of the two edits.
 */
export const MODE_MEMORY_KEY = 'mode-memory';

/** Which mode each remembered kind opens in. Absent means "the kind's default". */
export type ModeMemory = Readonly<Partial<Record<ComparisonKind, string>>>;

export const EMPTY_MODE_MEMORY: ModeMemory = {};
```

Add beside `parseSettings`:

```ts
/**
 * Read a stored mode memory, dropping per entry.
 *
 * Three things can make an entry unusable, and all three are ordinary rather
 * than exceptional: a build that remembers more kinds than this one wrote it, a
 * mode id has since been withdrawn, or the id belongs to a different kind
 * entirely. Each would put a control on a card that the file cannot answer, so
 * each is dropped — and dropped one at a time, like {@link parseSettings}, so
 * one bad entry does not discard a neighbouring good one.
 */
export function parseModeMemory(raw: unknown): ModeMemory {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return EMPTY_MODE_MEMORY;
  }

  const stored = raw as Record<string, unknown>;
  const memory: Partial<Record<ComparisonKind, string>> = {};

  for (const [kind, mode] of Object.entries(stored)) {
    if (typeof mode !== 'string') continue;
    if (!isRememberedKind(kind as ComparisonKind)) continue;
    // Asked of the kind rather than of a file: this is read before any file
    // list exists, and `resolveModeForFile` narrows it again per file.
    const offered = modesFor(kind as ComparisonKind, 'both');
    if (!offered.some((candidate) => candidate.id === mode)) continue;
    memory[kind as ComparisonKind] = mode;
  }

  return memory;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/settings.test.ts -t parseModeMemory`
Expected: PASS, 10 tests

- [ ] **Step 5: Check the whole lib suite still passes**

Run: `npx vitest run --project lib`
Expected: PASS. If `lib/settings.ts` importing `./compare/modes` creates a cycle, the run will say so — it does not today, because `modes.ts` imports only from `../github/types` and `./syntax`.

- [ ] **Step 6: Commit**

```bash
git add lib/settings.ts lib/settings.test.ts
git commit -m "feat: give the remembered mode a stored shape and a strict parse"
```

---

### Task 3: The storage adapter

**Files:**
- Modify: `lib/settings-store.ts`

No test. That file is deliberately untested — its own comment says so, and the parse it wraps is covered by Task 2.

- [ ] **Step 1: Extend the import**

In `lib/settings-store.ts`, change the import from `./settings` to include the new names:

```ts
import {
  CARD_COLLAPSED_KEY,
  EMPTY_MODE_MEMORY,
  MODE_MEMORY_KEY,
  type ModeMemory,
  SETTINGS_KEY,
  type Settings,
  parseModeMemory,
  parseSettings,
} from './settings';
```

- [ ] **Step 2: Add the three calls**

Append to `lib/settings-store.ts`:

```ts
export async function readModeMemory(): Promise<ModeMemory> {
  const stored = await browser.storage.local.get(MODE_MEMORY_KEY);
  return parseModeMemory(stored[MODE_MEMORY_KEY]);
}

export async function writeModeMemory(memory: ModeMemory): Promise<void> {
  await browser.storage.local.set({ [MODE_MEMORY_KEY]: memory });
}

/**
 * Call back whenever the remembered mode changes, in any extension context.
 *
 * The same reason `onSettingsChanged` exists, one step smaller: two review tabs
 * open on two pull requests should not disagree about how Markdown is drawn
 * after the reviewer presses Raw in one of them.
 */
export function onModeMemoryChanged(onChange: (memory: ModeMemory) => void): () => void {
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string,
  ): void => {
    if (areaName !== 'local') return;
    const change = changes[MODE_MEMORY_KEY];
    if (change === undefined) return;
    onChange(parseModeMemory(change.newValue));
  };

  browser.storage.onChanged.addListener(listener);
  return () => {
    browser.storage.onChanged.removeListener(listener);
  };
}
```

Note `EMPTY_MODE_MEMORY` is imported for the hook in Task 4; if the linter objects to it being unused here, drop it from this import and add it in Task 4 instead.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/settings-store.ts
git commit -m "feat: read and write the remembered mode"
```

---

### Task 4: The hook

**Files:**
- Create: `ui/useModeMemory.ts`
- Test: `ui/useModeMemory.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `ui/useModeMemory.test.tsx`. **Read `ui/useSettings.test.tsx` first and mirror it exactly** — it is the same hook one size smaller, and its approach is deliberate: it does *not* mock `lib/settings-store`, it drives the real store against the fake `browser` that `ui/testSetup.ts` installs, swapping in a working `onChanged` for the duration and restoring the original afterwards. A `vi.mock` of the store here would assert that mocks were called rather than that the hook works, and this project does not write that kind of test. Use a probe component and `render`, not `renderHook`.

```tsx
/**
 * The remembered comparison mode reaching an open review, and staying current.
 *
 * The same two halves as `useSettings`, failing the same two ways: without the
 * read a preference does nothing until reload, and without the listener a
 * second review tab and this one disagree about how Markdown is drawn.
 *
 * The shared stub in `testSetup` answers reads but has an inert `onChanged`, so
 * this file installs a working one for the duration and puts the original back.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MODE_MEMORY_KEY, type ModeMemory } from '@/lib/settings';
import { useModeMemory } from './useModeMemory';

type Listener = (
  changes: Record<string, { newValue?: unknown }>,
  areaName: string,
) => void;

let listeners: Listener[] = [];
let original: unknown;

beforeEach(async () => {
  listeners = [];
  original = browser.storage.onChanged;
  Object.defineProperty(browser.storage, 'onChanged', {
    value: {
      addListener: (fn: Listener) => listeners.push(fn),
      removeListener: (fn: Listener) => {
        listeners = listeners.filter((held) => held !== fn);
      },
    },
    writable: true,
    configurable: true,
  });
  await browser.storage.local.remove(MODE_MEMORY_KEY);
});

afterEach(() => {
  Object.defineProperty(browser.storage, 'onChanged', {
    value: original,
    writable: true,
    configurable: true,
  });
});

/** What another review tab does when the reviewer presses a mode in it. */
const announce = (memory: ModeMemory): void => {
  act(() => {
    for (const listener of [...listeners]) {
      listener({ [MODE_MEMORY_KEY]: { newValue: memory } }, 'local');
    }
  });
};

let remember: (kind: 'markdown', mode: string) => void = () => {};

function Probe() {
  const [memory, set] = useModeMemory();
  remember = set;
  return <output>{memory.markdown ?? 'unset'}</output>;
}

const shown = (): string => screen.getByRole('status').textContent ?? '';

describe('useModeMemory', () => {
  it('renders unset before storage has answered', () => {
    render(<Probe />);
    expect(shown()).toBe('unset');
  });

  it('picks up what was stored', async () => {
    await browser.storage.local.set({ [MODE_MEMORY_KEY]: { markdown: 'raw' } });

    render(<Probe />);

    await waitFor(() => {
      expect(shown()).toBe('raw');
    });
  });

  it('remembering shows at once and is written through', async () => {
    render(<Probe />);
    await waitFor(() => {
      expect(shown()).toBe('unset');
    });

    act(() => {
      remember('markdown', 'raw');
    });

    expect(shown()).toBe('raw');
    await waitFor(async () => {
      const stored = await browser.storage.local.get(MODE_MEMORY_KEY);
      expect(stored[MODE_MEMORY_KEY]).toEqual({ markdown: 'raw' });
    });
  });

  it('follows a press made in another review tab', async () => {
    render(<Probe />);
    await waitFor(() => {
      expect(shown()).toBe('unset');
    });

    announce({ markdown: 'raw' });

    expect(shown()).toBe('raw');
  });

  it('ignores a write to a different area', async () => {
    render(<Probe />);
    await waitFor(() => {
      expect(shown()).toBe('unset');
    });

    act(() => {
      for (const listener of [...listeners]) {
        listener({ [MODE_MEMORY_KEY]: { newValue: { markdown: 'raw' } } }, 'sync');
      }
    });

    expect(shown()).toBe('unset');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run ui/useModeMemory.test.tsx`
Expected: FAIL — cannot resolve `./useModeMemory`

- [ ] **Step 3: Write minimal implementation**

Create `ui/useModeMemory.ts`:

```ts
/**
 * Which mode each remembered kind opens in, kept current while the page is open.
 *
 * Modelled on {@link useSettings} down to the ordering, because it has the same
 * two hazards: a second review tab can change the preference while this one is
 * reading, and a write landing between the listener going on and the opening
 * read resolving would otherwise be lost. Listener first, then read, and a flag
 * saying the read has been superseded.
 *
 * Returns the memory and the way to add to it, because the only caller does
 * both and a separate writer would be a second copy of the current value to
 * keep in step.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComparisonKind } from '@/lib/compare/modes';
import { EMPTY_MODE_MEMORY, type ModeMemory } from '@/lib/settings';
import { onModeMemoryChanged, readModeMemory, writeModeMemory } from '@/lib/settings-store';

export type RememberMode = (kind: ComparisonKind, mode: string) => void;

export function useModeMemory(): [ModeMemory, RememberMode] {
  const [memory, setMemory] = useState<ModeMemory>(EMPTY_MODE_MEMORY);

  /**
   * The current value, for `remember` to build on.
   *
   * A ref rather than reading `memory` through the closure, so `remember` keeps
   * one identity for the life of the page — it is handed to every card, and a
   * callback that changed on each press would re-render the whole column.
   */
  const current = useRef<ModeMemory>(EMPTY_MODE_MEMORY);

  const apply = useCallback((next: ModeMemory) => {
    current.current = next;
    setMemory(next);
  }, []);

  useEffect(() => {
    let live = true;
    let changed = false;

    const stop = onModeMemoryChanged((next) => {
      if (!live) return;
      changed = true;
      apply(next);
    });

    void readModeMemory()
      .then((stored) => {
        if (live && !changed) apply(stored);
      })
      // Storage that cannot be read leaves every kind on its default, which is
      // what the page would draw anyway.
      .catch(() => {});

    return () => {
      live = false;
      stop();
    };
  }, [apply]);

  const remember = useCallback<RememberMode>(
    (kind, mode) => {
      const next = { ...current.current, [kind]: mode };
      apply(next);
      // Not awaited. The page has already moved; a storage write that fails
      // costs the preference at the next reload and nothing on screen now.
      void writeModeMemory(next).catch(() => {});
    },
    [apply],
  );

  return [memory, remember];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run ui/useModeMemory.test.tsx`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add ui/useModeMemory.ts ui/useModeMemory.test.tsx
git commit -m "feat: keep the remembered mode current while a review is open"
```

---

### Task 5: Wire it into the column

**Files:**
- Modify: `ui/DiffColumn.tsx` — the `chosenModes` state (~line 419), the `modes` memo (~line 862) and `changeMode` (~line 869)
- Test: `ui/DiffColumn.test.tsx`

This file already has the helpers this test needs: `file({ path, ...overrides })` builds a `ReviewFile`, `mount(files)` renders the column inside a `ReviewSessionProvider`, and `card(path)` returns the `[data-file-card]` element whose header holds the mode buttons.

**Storage leaks between tests in this file.** `ui/testSetup.ts` installs one Map-backed fake `browser.storage.local` on `globalThis` per test *file*, so a test that remembers a mode leaves it remembered for every test after it in the same file. Add the teardown in Step 1 or the failures will look like unrelated tests breaking.

- [ ] **Step 1: Write the failing test**

Append to `ui/DiffColumn.test.tsx`:

```tsx
describe('remembering how markdown is compared', () => {
  // The fake storage area in ui/testSetup.ts lives on globalThis for the whole
  // file. Without this, the first test here decides what every later test in
  // the file sees, and the failure names the wrong test.
  afterEach(async () => {
    await browser.storage.local.remove(MODE_MEMORY_KEY);
  });

  it('pressing a mode on one markdown card flips the others', async () => {
    mount([
      file({ path: 'docs/a.md' }),
      file({ path: 'docs/b.md' }),
      file({ path: 'assets/logo.png', isBinary: true }),
    ]);

    fireEvent.click(within(card('docs/a.md')).getByRole('button', { name: 'Raw' }));

    for (const path of ['docs/a.md', 'docs/b.md']) {
      await waitFor(() => {
        expect(within(card(path)).getByRole('button', { name: 'Raw' })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
      });
    }

    // The rule is Markdown-only. An image in the same column must not move.
    expect(
      within(card('assets/logo.png')).getByRole('button', { name: 'Side by side' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('a per-file choice on an unremembered kind still stands alone', async () => {
    mount([
      file({ path: 'assets/a.png', isBinary: true }),
      file({ path: 'assets/b.png', isBinary: true }),
    ]);

    fireEvent.click(within(card('assets/a.png')).getByRole('button', { name: 'Onion skin' }));

    expect(
      within(card('assets/b.png')).getByRole('button', { name: 'Side by side' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('a remembered mode decides how the next review opens', async () => {
    await browser.storage.local.set({ [MODE_MEMORY_KEY]: { markdown: 'raw' } });
    mount([file({ path: 'docs/a.md' })]);

    await waitFor(() => {
      expect(
        within(card('docs/a.md')).getByRole('button', { name: 'Raw' }),
      ).toHaveAttribute('aria-pressed', 'true');
    });
  });
});
```

**Imports that file is missing.** `waitFor`, `within`, `fireEvent`, `describe`, `expect`, `it` and `beforeEach` are already imported. You must add:

- `afterEach` to the existing `vitest` import
- `browser` from `wxt/browser`
- `MODE_MEMORY_KEY` from `@/lib/settings`

Do **not** reach for `@testing-library/user-event`. It is a dependency of this project, but `ui/DiffColumn.test.tsx` drives every interaction with `fireEvent` and mixing the two in one file is how a test file stops having one convention.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run ui/DiffColumn.test.tsx -t "flips the others"`
Expected: FAIL — `docs/b.md` is still on the rendered diff

- [ ] **Step 3: Implement**

In `ui/DiffColumn.tsx`, add to the imports:

```ts
import { RAW, comparisonKind, isRememberedKind, resolveModeForFile } from '@/lib/compare/modes';
import { useModeMemory } from './useModeMemory';
```

Add beside the other hooks in the component:

```ts
const [modeMemory, rememberMode] = useModeMemory();
```

Amend the `chosenModes` comment (it currently states the per-file rule as absolute) and replace the `modes` memo body:

```ts
const modes = useMemo(() => {
  const built = new Map<string, string>();
  for (const file of files) {
    // Per-file first, then the remembered preference for the kind, then the
    // file's own default. A remembered mode the file cannot offer — a one-sided
    // `.md`, where `markdown:rendered` is `needsBothSides` — falls back inside
    // `resolveModeForFile` rather than here.
    const chosen = chosenModes.get(file.path) ?? modeMemory[comparisonKind(file)];
    built.set(file.path, resolveModeForFile(file, chosen));
  }
  return built;
}, [files, chosenModes, modeMemory]);
```

Replace `changeMode`:

```ts
const changeMode = useCallback(
  (path: string, mode: string) => {
    const pressed = files.find((file) => file.path === path);
    const kind = pressed === undefined ? 'none' : comparisonKind(pressed);

    if (isRememberedKind(kind)) {
      // The press is a preference rather than a choice about this one file, so
      // the per-file entries for the kind are forgotten: left in place they
      // would outrank the preference and the other cards would not move.
      setChosenModes((previous) => {
        const next = new Map(previous);
        for (const file of files) {
          if (comparisonKind(file) === kind) next.delete(file.path);
        }
        return next;
      });
      rememberMode(kind, mode);
      return;
    }

    setChosenModes((previous) => {
      const next = new Map(previous);
      next.set(path, mode);
      return next;
    });
  },
  [files, rememberMode],
);
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run ui/DiffColumn.test.tsx`
Expected: PASS, including the two new tests and every existing one. If an existing test asserted that a mode press affects only one card and that card was Markdown, it is now asserting the old rule — update it and say so in the commit.

- [ ] **Step 5: Commit**

```bash
git add ui/DiffColumn.tsx ui/DiffColumn.test.tsx
git commit -m "feat: let a markdown mode press speak for every markdown file"
```

---

### Task 6: Amend the comment that says the opposite

**Files:**
- Modify: `ui/ModeSwitcher.tsx` — the file comment, second and third bullets

The file currently states "**It remembers nothing.**" as a principle. That is now false for one kind, and a comment that contradicts the code is worse than no comment.

- [ ] **Step 1: Rewrite the two bullets**

Replace the "Per file, not per type" and "It remembers nothing" bullets with:

```
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
```

- [ ] **Step 2: Verify nothing else claims the old rule**

Run: `grep -rn "remembers nothing\|persists no interface state\|Nothing is remembered" --include="*.ts" --include="*.tsx" --include="*.md" . | grep -v node_modules`

Expected: hits in `docs/superpowers/specs/2026-09-04-rich-diff-types-comparison.md` §2, which is a historical record and must **not** be edited, and nothing else in source. If a source file still claims it, fix that too.

- [ ] **Step 3: Commit**

```bash
git add ui/ModeSwitcher.tsx
git commit -m "docs: say which mode rule survived and why"
```

---

### Task 7: Prove it across a reload

**Files:**
- Modify: `e2e/review.spec.ts`

Read `e2e/review.spec.ts` and `e2e/fixture.ts` first. The suite drives the real production build with GitHub mocked at the service worker, and it is the only honest check for anything touching the built extension.

- [ ] **Step 1: Write the failing test**

Add a spec that opens a review whose file list contains at least one `.md`, presses Raw on it, reloads the page, and asserts the card comes back on Raw:

`e2e/fixture.ts` already exports `MARKDOWN_FILE` (`'docs/readme.md'`) and its two sides as `MARKDOWN_TEXT`, and `e2e/review.spec.ts` already has `openReview(page, extensionId)`. No fixture changes are needed.

```ts
test('the markdown mode outlives the page', async ({ context, extensionId, api }) => {
  const page = await context.newPage();
  await openReview(page, extensionId);

  const card = page.locator(`[data-file-card="${MARKDOWN_FILE}"]`);
  await expect(card.getByRole('button', { name: 'Raw' })).toBeVisible();
  await card.getByRole('button', { name: 'Raw' }).click();
  await expect(card.getByRole('button', { name: 'Raw' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.reload();

  const reloaded = page.locator(`[data-file-card="${MARKDOWN_FILE}"]`);
  await expect(reloaded.getByRole('button', { name: 'Raw' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
```

Match the surrounding tests' fixture signature — several take `{ context, extensionId, api }` and open their own page. Copy the shape of the test nearest to where you add this rather than the sketch above if the two disagree.

Import `MARKDOWN_FILE` from `./fixture`.

- [ ] **Step 2: Run it**

Run: `npm run test:e2e -- -g "survives a reload"`
Expected: PASS. This builds first, so it is slow; that is the point of it.

- [ ] **Step 3: Commit**

```bash
git add e2e/
git commit -m "test: prove the markdown mode outlives the page"
```

---

### Task 8: Full verification

- [ ] **Step 1: The whole suite**

```bash
npm test
npm run typecheck
npm run test:e2e
```

Expected: all pass. Report the actual output; do not claim success without it.

- [ ] **Step 2: Update the README's known limits if needed**

`README.md` has a "Known limits" section. Nothing there claims modes are forgotten, so most likely no change — but check, and if something does, fix it.

- [ ] **Step 3: Commit anything outstanding**

```bash
git status --short
```

Expected: clean.
