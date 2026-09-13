/**
 * Choosing how a file is compared, from inside the column.
 *
 * The pieces are tested apart from each other elsewhere — the registry in
 * `lib/compare/modes`, the engines beside it, the side loader in
 * `fileSides`. What is asserted here is the wiring, and specifically the four
 * promises the feature makes that no single piece can keep on its own:
 *
 * - raw is reachable from every file, and going back to it really does put the
 *   card back where it started
 * - the mode is per file for every kind but Markdown, so two images can be in
 *   different ones at once
 * - and for those kinds nothing survives a mount, as with the rest of the
 *   interface state on this page
 * - the switcher is operable from the keyboard
 *
 * Layout is not asserted anywhere in this file. jsdom performs none, an `<img>`
 * in it never loads and reports zero by zero forever, and the geometry of the
 * overlay modes is therefore checked in the browser test instead.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { ANCHOR_ATTRIBUTE } from '@/lib/compare/markdownAnchors';
import type { ReviewThread } from '@/lib/github/types';
import { BOTH_SIDES } from '@/lib/review/diffScope';
import { MODE_MEMORY_KEY } from '@/lib/settings';
import { DraftStore } from '@/lib/review/drafts';
import { DiffColumn } from './DiffColumn';
import { request } from './background';
import { NO_FILE } from './currentFile';
import { clearSideCache } from './fileSides';
import { memoryStore } from './memoryStore.fixture';
import { codeViewItems } from './diffItems';
import { diffHasRendered } from './pierreDom.fixture';
import { pullRequestNode, reviewThread } from './prPayload.fixture';
import type { ReviewFile } from './reviewFiles';
import { ReviewSessionProvider } from './reviewSession';

vi.mock('./background', () => ({ request: vi.fn() }));

const requestMock = request as unknown as Mock;

const PR_REF = { owner: 'acme', repo: 'widgets', number: 42 } as const;
const BLOBS = { pr: PR_REF, baseSha: 'a'.repeat(40), headSha: 'f'.repeat(40) };

const file = (overrides: Partial<ReviewFile> & { path: string }): ReviewFile => ({
  oldPath: overrides.path,
  isBinary: false,
  isRename: false,
  patchOmitted: false,
  patch: `diff --git a/${overrides.path} b/${overrides.path}\n@@ -1 +1 @@\n-a\n+b\n`,
  additions: 1,
  deletions: 1,
  changeType: 'MODIFIED',
  viewedState: 'UNVIEWED',
  noise: false,
  ...overrides,
});

/** Answer `get-blob` with per-side text and `get-blob-bytes` with three bytes. */
function answerWith(text: (ref: string, path: string) => string): void {
  requestMock.mockImplementation(
    (msg: { kind: string; ref: string; path: string }) => {
      if (msg.kind === 'get-blob') {
        return Promise.resolve({
          ok: true,
          data: { status: 'ok', text: text(msg.ref, msg.path) },
        });
      }
      if (msg.kind === 'get-blob-bytes') {
        return Promise.resolve({
          ok: true,
          data: { status: 'ok', base64: btoa('\u0000\u0001\u0002'), byteLength: 3 },
        });
      }
      return Promise.resolve({ ok: true, data: { data: {} } });
    },
  );
}

beforeEach(() => {
  requestMock.mockReset();
  answerWith(() => '');
  clearSideCache();
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = () => 'blob:stub';
    URL.revokeObjectURL = () => {};
  }
});

/**
 * The Markdown preference, which one press below writes and every later mount
 * would otherwise read.
 *
 * `ui/testSetup.ts` installs one fake storage area per test *file* rather than
 * per test, so pressing Raw on a `.md` card leaves every `.md` card after it
 * opening raw — including the two sanitiser tests at the bottom, which mount a
 * document expecting to find it rendered. The failure they produce says nothing
 * about sanitising and names the wrong test.
 */
afterEach(async () => {
  await browser.storage.local.remove(MODE_MEMORY_KEY);
});

function mount(files: readonly ReviewFile[], threads: readonly ReviewThread[] = []) {
  return render(
    <ReviewSessionProvider
      pullRequest={pullRequestNode()}
      prRef={PR_REF}
      threads={[...threads]}
      drafts={new DraftStore(memoryStore())}
    >
      <DiffColumn
        files={files}
        diff={{ source: 'unified', truncated: false }}
        sides={BOTH_SIDES}
        current={NO_FILE}
        onScrollTo={() => {}}
        blobs={BLOBS}
      />
    </ReviewSessionProvider>,
  );
}

const card = (path: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-file-card="${path}"]`);
  if (found == null) throw new Error(`no card rendered for ${path}`);
  return found;
};

/**
 * The measured half of a card: the comparison, its notices, its listed threads.
 *
 * A separate element from the header because `CodeView` measures an annotation
 * and does not measure a header — see `ui/FileBody.tsx`. Synchronous, because
 * every caller here is either inside a `waitFor` or after one.
 */
const body = (path: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-file-body="${path}"]`);
  if (found == null) throw new Error(`no body rendered for ${path}`);
  return found;
};

const switcher = (path: string): HTMLElement =>
  within(card(path)).getByRole('group', { name: new RegExp(`Compare ${path} as`) });

const modeButton = (path: string, label: string | RegExp) =>
  within(switcher(path)).getByRole('button', { name: label });

describe('the switcher itself', () => {
  it('offers an image every way of comparing it, ending in raw', () => {
    mount([file({ path: 'assets/logo.png', isBinary: true, patch: '' })]);

    const labels = within(switcher('assets/logo.png'))
      .getAllByRole('button')
      .map((button) => button.textContent);

    expect(labels).toEqual(['Side by side', 'Swipe', 'Onion skin', 'Difference', 'Raw']);
  });

  it('offers nothing at all for a file with only one way to read it', () => {
    // A single dead button would say there is something to switch to.
    mount([file({ path: 'src/app.ts' })]);

    expect(
      within(card('src/app.ts')).queryByRole('group', { name: /Compare/ }),
    ).toBeNull();
  });

  it('says which mode is on, in a way a screen reader can hear', () => {
    mount([file({ path: 'data/rows.csv' })]);

    expect(modeButton('data/rows.csv', 'Grid')).toHaveProperty('ariaPressed', 'true');
    expect(modeButton('data/rows.csv', 'Raw')).toHaveProperty('ariaPressed', 'false');
  });

  it('is reachable and operable from the keyboard alone', async () => {
    // Plain buttons, each its own tab stop. A roving-tabindex radio group would
    // be tidier to tab past and would hide the choice from anyone who navigates
    // that way.
    const user = userEvent.setup();
    mount([file({ path: 'assets/logo.png', isBinary: true, patch: '' })]);

    const raw = modeButton('assets/logo.png', 'Raw');
    raw.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(modeButton('assets/logo.png', 'Raw')).toHaveProperty('ariaPressed', 'true');
    });
  });
});

describe('raw as the escape hatch', () => {
  it('opens an image in its comparison and not in the binary sentence', async () => {
    mount([file({ path: 'assets/logo.png', isBinary: true, patch: '' })]);

    await waitFor(() => {
      expect(body('assets/logo.png').querySelector('.image-compare')).not.toBeNull();
    });
    expect(within(body('assets/logo.png')).queryByRole('note')).toBeNull();
  });

  it('puts the binary sentence back when the reviewer asks for raw', async () => {
    const user = userEvent.setup();
    mount([file({ path: 'assets/logo.png', isBinary: true, patch: '' })]);

    await user.click(modeButton('assets/logo.png', 'Raw'));

    expect(within(body('assets/logo.png')).getByRole('note').textContent).toMatch(
      /binary/i,
    );
    expect(body('assets/logo.png').querySelector('.image-compare')).toBeNull();
  });

  it('reads no blobs at all while a file is showing raw', async () => {
    // A lockfile opens raw, and a pull request that touches fifty JSON files
    // must not read a hundred blobs on the way past them.
    mount([file({ path: 'package-lock.json', noise: true })]);

    await waitFor(() => {
      expect(card('package-lock.json')).toBeTruthy();
    });
    const kinds = requestMock.mock.calls.map(
      (call) => (call[0] as { kind: string }).kind,
    );
    expect(kinds).not.toContain('get-blob');
    expect(kinds).not.toContain('get-blob-bytes');
  });
});

/**
 * Both claims below are about the kinds whose mode is a per-file choice, which
 * is every kind but Markdown — `lib/compare/modes.ts` names the exception and
 * `ui/DiffColumn.test.tsx` asserts it, beside the storage it is held in.
 *
 * Images are what the rule was written for, so they are what it is checked on:
 * one was redrawn and wants side by side, the next moved four pixels and wants
 * the difference blend, and neither reviewer press may undo the other.
 */
describe('the mode is per file, for every kind but Markdown', () => {
  it('leaves one image alone when another is switched', async () => {
    const user = userEvent.setup();
    mount([
      file({ path: 'a.png', isBinary: true, patch: '' }),
      file({ path: 'b.png', isBinary: true, patch: '' }),
    ]);

    await user.click(modeButton('a.png', 'Difference'));

    expect(modeButton('a.png', 'Difference')).toHaveProperty('ariaPressed', 'true');
    expect(modeButton('b.png', 'Side by side')).toHaveProperty('ariaPressed', 'true');
  });

  it('puts an image back to its default at the next mount', async () => {
    const user = userEvent.setup();
    const first = mount([file({ path: 'a.png', isBinary: true, patch: '' })]);
    await user.click(modeButton('a.png', 'Raw'));
    first.unmount();

    mount([file({ path: 'a.png', isBinary: true, patch: '' })]);

    expect(modeButton('a.png', 'Side by side')).toHaveProperty('ariaPressed', 'true');
  });
});

describe('the comparisons themselves', () => {
  it('draws a table from both whole sides, marking the cell that moved', async () => {
    answerWith((ref) =>
      ref === BLOBS.baseSha ? 'name,qty\nbolt,4\n' : 'name,qty\nbolt,5\n',
    );
    mount([file({ path: 'data/rows.csv' })]);

    await waitFor(() => {
      expect(body('data/rows.csv').querySelector('.grid')).not.toBeNull();
    });

    const changed = body('data/rows.csv').querySelectorAll('.grid-cell-changed');
    expect(changed).toHaveLength(1);
    expect(changed[0]?.textContent).toContain('5');
  });

  it('drops the rows that held still when asked for changed rows only', async () => {
    const user = userEvent.setup();
    answerWith((ref) =>
      ref === BLOBS.baseSha ? 'h\nkept\nold\n' : 'h\nkept\nnew\n',
    );
    mount([file({ path: 'data/rows.csv' })]);

    await waitFor(() => {
      expect(body('data/rows.csv').querySelector('.grid')).not.toBeNull();
    });
    expect(body('data/rows.csv').querySelectorAll('.grid-row')).toHaveLength(2);

    await user.click(modeButton('data/rows.csv', 'Changed rows'));

    await waitFor(() => {
      expect(body('data/rows.csv').querySelectorAll('.grid-row')).toHaveLength(1);
    });
  });

  it('lists the key paths of a JSON change rather than its lines', async () => {
    answerWith((ref) =>
      ref === BLOBS.baseSha ? '{"server":{"port":80}}' : '{\n "server": {\n  "port": 443\n }\n}',
    );
    mount([file({ path: 'config.json' })]);

    await waitFor(() => {
      expect(body('config.json').querySelector('.key-paths')).not.toBeNull();
    });

    const paths = [...body('config.json').querySelectorAll('.key-path')].map(
      (node) => node.textContent,
    );
    expect(paths).toEqual(['server.port']);
  });

  it('says nothing changed when only the formatting did', async () => {
    answerWith((ref) => (ref === BLOBS.baseSha ? '{"a":1}' : '{\n  "a": 1\n}'));
    mount([file({ path: 'config.json' })]);

    await waitFor(() => {
      expect(within(body('config.json')).getByRole('note').textContent).toMatch(
        /no values changed/i,
      );
    });
  });

  it('lists the key paths of a YAML change, indentation and all', async () => {
    // YAML is the format the text diff serves worst, because its indentation
    // is semantic: reindent a block and every line repaints while nothing
    // moved. This is the whole of decision 2.
    answerWith((ref) =>
      ref === BLOBS.baseSha
        ? 'server:\n  port: 80\n  hosts:\n    - a\n'
        : 'server:\n    port: 443\n    hosts:\n        - a\n',
    );
    mount([file({ path: 'k8s/deploy.yaml' })]);

    await waitFor(() => {
      expect(body('k8s/deploy.yaml').querySelector('.key-paths')).not.toBeNull();
    });

    const paths = [...body('k8s/deploy.yaml').querySelectorAll('.key-path')].map(
      (node) => node.textContent,
    );
    expect(paths).toEqual(['server.port']);
  });

  it('lists the key paths of a TOML change too', async () => {
    // Inline table promoted to a section header: every line of it changes, and
    // one version is the only thing that moved.
    answerWith((ref) =>
      ref === BLOBS.baseSha
        ? 'name = "x"\ndeps = { serde = "1.0" }\n'
        : 'name = "x"\n\n[deps]\nserde = "1.1"\n',
    );
    mount([file({ path: 'Cargo.toml' })]);

    await waitFor(() => {
      expect(body('Cargo.toml').querySelector('.key-paths')).not.toBeNull();
    });

    const paths = [...body('Cargo.toml').querySelectorAll('.key-path')].map(
      (node) => node.textContent,
    );
    expect(paths).toEqual(['deps.serde']);
  });

  it('reads a tsconfig with comments in it instead of refusing the file', async () => {
    // The visible wart decision 3 removes. `JSON.parse` refuses JSONC, so this
    // used to answer "not valid JSON" about a file the reviewer can see is
    // perfectly fine — which reads as a defect in this page.
    answerWith((ref) =>
      ref === BLOBS.baseSha
        ? '{\n  // the target we ship\n  "target": "es2020",\n}'
        : '{\n  // the target we ship\n  "target": "es2022",\n}',
    );
    mount([file({ path: 'tsconfig.json' })]);

    await waitFor(() => {
      expect(body('tsconfig.json').querySelector('.key-paths')).not.toBeNull();
    });

    const paths = [...body('tsconfig.json').querySelectorAll('.key-path')].map(
      (node) => node.textContent,
    );
    expect(paths).toEqual(['target']);
  });

  it('offers TOML no formatted mode, having no formatter that keeps comments', async () => {
    // Re-serializing TOML from the parsed value eats every `#` line, which
    // would make a comment-only change show as no change at all. A control
    // that would lie is not offered, the same as one that would do nothing.
    answerWith(() => 'a = 1\n');
    mount([file({ path: 'Cargo.toml' }), file({ path: 'deploy.yaml' })]);

    await waitFor(() => expect(card('Cargo.toml')).toBeTruthy());

    const labels = (path: string) =>
      within(switcher(path))
        .getAllByRole('button')
        .map((button) => button.textContent);

    expect(labels('Cargo.toml')).toEqual(['Key paths', 'Raw']);
    expect(labels('deploy.yaml')).toEqual(['Key paths', 'Formatted', 'Raw']);
  });

  it('compares a notebook by cell, with the re-run ones marked as unchanged', async () => {
    const cell = (source: string, out: string) => ({
      cell_type: 'code',
      source,
      outputs: [{ output_type: 'stream', text: out }],
    });
    // The first cell is the case the mode exists for: the source held still and
    // only the output moved, which is what re-running a notebook does to every
    // cell in it.
    const book = (firstOut: string, source: string, out: string) =>
      JSON.stringify({
        nbformat: 4,
        metadata: { language_info: { name: 'python', file_extension: '.py' } },
        cells: [cell('import os', firstOut), cell(source, out)],
      });

    answerWith((ref) =>
      ref === BLOBS.baseSha ? book('0.1', 'x = 1', '0.5') : book('0.2', 'x = 2', '0.9'),
    );
    mount([file({ path: 'analysis.ipynb' })]);

    await waitFor(() => {
      expect(body('analysis.ipynb').querySelector('.cells')).not.toBeNull();
    });

    expect(body('analysis.ipynb').querySelectorAll('.cell-changed')).toHaveLength(1);
    const unchanged = body('analysis.ipynb').querySelector('.cell-equal');
    expect(unchanged?.textContent).toMatch(/new output/i);
  });

  it('hides the outputs until the reviewer asks for them', async () => {
    const user = userEvent.setup();
    const book = JSON.stringify({
      nbformat: 4,
      cells: [
        {
          cell_type: 'code',
          source: 'plot()',
          outputs: [{ output_type: 'stream', text: 'RESULT-TEXT' }],
        },
      ],
    });
    answerWith(() => book);
    mount([file({ path: 'analysis.ipynb' })]);

    await waitFor(() => {
      expect(body('analysis.ipynb').querySelector('.cells')).not.toBeNull();
    });
    expect(body('analysis.ipynb').textContent).not.toContain('RESULT-TEXT');

    await user.click(modeButton('analysis.ipynb', 'Cells and outputs'));

    await waitFor(() => {
      expect(body('analysis.ipynb').textContent).toContain('RESULT-TEXT');
    });
  });

  it('says why, rather than showing nothing, when a side cannot be read', async () => {
    requestMock.mockImplementation((msg: { kind: string }) =>
      msg.kind === 'get-blob'
        ? Promise.resolve({ ok: true, data: { status: 'too-large' } })
        : Promise.resolve({ ok: true, data: { data: {} } }),
    );
    mount([file({ path: 'data/rows.csv' })]);

    await waitFor(() => {
      expect(within(body('data/rows.csv')).getByRole('alert').textContent).toMatch(
        /too large/i,
      );
    });
  });
});

describe('the file the reviewer is on', () => {
  it('keeps the switcher out of the shortcut path', () => {
    // Every mode button is a real button, so a keystroke aimed at the page
    // reaches the page. Asserted because the file tree's own search does the
    // opposite and swallowed the whole single-letter keymap.
    mount([file({ path: 'a.png', isBinary: true, patch: '' })]);

    const button = modeButton('a.png', 'Raw');
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('tabindex')).toBeNull();
  });

  it('gives a comparison nothing of the text diff to sit on top of', async () => {
    // A CSV in its grid must not also carry Pierre's line-by-line diff of the
    // same file, which is the view the reviewer just chose not to look at.
    // Collapsing the item used to be what prevented it; the comparison is now
    // an annotation and only an expanded item has one, so the emptiness comes
    // from the item's contents instead. Driven raw-first, so the diff is known
    // to have rendered before the switch.
    //
    // That the rows actually leave the screen is a browser claim, and it is
    // made there: jsdom performs no layout, so the viewer's window never moves
    // and a released row can sit on in a recycled element with nothing to make
    // it repaint. `e2e/compare.spec.ts` asserts the visible transition.
    const user = userEvent.setup();
    answerWith(() => 'a,b\n1,2\n');
    mount([file({ path: 'data/rows.csv' })]);

    await user.click(modeButton('data/rows.csv', 'Raw'));
    await waitFor(() => {
      expect(diffHasRendered('data/rows.csv')).toBe(true);
    });

    await user.click(modeButton('data/rows.csv', 'Grid'));

    await waitFor(() => {
      expect(body('data/rows.csv').querySelector('.grid')).not.toBeNull();
    });
    const item = codeViewItems(
      [file({ path: 'data/rows.csv' })],
      new Set(),
      new Map(),
      new Map([['data/rows.csv', 'table:grid']]),
    )[0];
    if (item?.type !== 'diff') throw new Error('expected a diff item');
    expect(item.fileDiff.hunks).toHaveLength(0);
  });

  it('offers to collapse a card whose body is a comparison', () => {
    // It did not, once, and the reasoning was sound at the time: the
    // comparison was in the card's header, where folding could not reach it,
    // so the toggle would have pointed at nothing. The comparison is a
    // measured annotation now and folding takes it away like any other body —
    // which it has to, because marking a file viewed folds it and a
    // spreadsheet is a file like the rest of them.
    mount([file({ path: 'data/rows.csv' })]);

    expect(
      within(card('data/rows.csv')).getByRole('button', { name: /Collapse/ }),
    ).toBeTruthy();
  });

  it('offers the collapse toggle on a card showing raw too', async () => {
    const user = userEvent.setup();
    mount([file({ path: 'data/rows.csv' })]);

    await user.click(modeButton('data/rows.csv', 'Raw'));

    expect(
      within(card('data/rows.csv')).getByRole('button', { name: /Collapse/ }),
    ).toBeTruthy();
  });

  it('folds the switcher away with the body it changes', async () => {
    // The switcher used to stay up on a folded card, on the reasoning that a
    // folded card still has to offer it. It does not: the choice is about
    // what the body shows, and with most of a finished review folded the page
    // would carry a row of dead buttons under every file.
    const user = userEvent.setup();
    mount([file({ path: 'data/rows.csv' })]);
    expect(switcher('data/rows.csv')).toBeTruthy();

    await user.click(
      within(card('data/rows.csv')).getByRole('button', { name: /Collapse/ }),
    );

    expect(document.querySelector('[aria-label="Compare data/rows.csv as"]')).toBeNull();

    // And it comes back with the body, on the press that asked for it.
    await user.click(
      within(card('data/rows.csv')).getByRole('button', { name: /Expand/ }),
    );
    expect(switcher('data/rows.csv')).toBeTruthy();
  });
});

describe('screen reader wiring', () => {
  it('gives the switcher a name that says which file it belongs to', () => {
    // There is one of these per card in a column of five hundred, so "Compare
    // as" alone would be five hundred identically named groups.
    mount([file({ path: 'data/rows.csv' })]);

    expect(screen.getByRole('group', { name: 'Compare data/rows.csv as' })).toBeTruthy();
  });
});

describe('the rendered Markdown diff', () => {
  const rendered = (path: string): HTMLElement | null =>
    document.querySelector<HTMLElement>(
      `[data-file-body="${path}"] .markdown-rendered`,
    );

  it('shows the new document formatted, with the changed words marked in it', async () => {
    answerWith((ref) =>
      ref === BLOBS.baseSha
        ? '# Guide\n\nThe quick brown fox jumps.\n'
        : '# Guide\n\nThe quick red fox jumps.\n',
    );
    mount([file({ path: 'README.md' })]);

    await waitFor(() => expect(rendered('README.md')).not.toBeNull());
    const view = rendered('README.md');

    // Formatted, not source: a real heading element rather than a `#`.
    expect(view?.querySelector('h1')?.textContent).toBe('Guide');
    // And the marks, inside the prose rather than beside it.
    expect(view?.querySelector('del')?.textContent).toBe('brown');
    expect(view?.querySelector('ins')?.textContent).toBe('red');
    // The words that did not move are not marked.
    expect(view?.textContent).toContain('jumps');
  });

  it('opens on the rendered diff and can be put back to raw', async () => {
    const user = userEvent.setup();
    answerWith((ref) => (ref === BLOBS.baseSha ? 'a\n' : 'b\n'));
    mount([file({ path: 'docs/notes.md' })]);

    const labels = within(switcher('docs/notes.md'))
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(labels).toEqual(['Rendered diff', 'Raw']);

    await waitFor(() => expect(rendered('docs/notes.md')).not.toBeNull());
    await user.click(modeButton('docs/notes.md', 'Raw'));
    expect(rendered('docs/notes.md')).toBeNull();
  });

  it('offers a newly added document nothing but raw', () => {
    // There is no what-changed on a file with one side, and a control that can
    // only render a preview is the mode this feature exists instead of.
    mount([
      file({
        path: 'docs/new.md',
        changeType: 'ADDED',
        patch: 'diff --git a/docs/new.md b/docs/new.md\nnew file mode 100644\n@@ -0,0 +1 @@\n+hi\n',
      }),
    ]);

    expect(
      within(card('docs/new.md')).queryByRole('group', { name: /Compare/ }),
    ).toBeNull();
  });
});

describe('a Markdown file written by an attacker', () => {
  /**
   * The end-to-end version of `markdownHtml.test.tsx`.
   *
   * That file proves the sanitiser is correct in isolation. This one proves it
   * is actually *reached* — that the wiring from the blob loader through the
   * renderer and the word diff and into the card really does put the string
   * through it, and that nothing between them inserts anything of its own. A
   * correct sanitiser nobody calls is the failure mode worth a second test.
   */
  const MALICIOUS = [
    '# Notes',
    '',
    '<img src=x onerror="globalThis.__pwned = true">',
    '<script>globalThis.__pwned = true</script>',
    '<iframe src="https://evil.test/"></iframe>',
    '[click me](javascript:globalThis.__pwned=true)',
    '<svg onload="globalThis.__pwned = true"></svg>',
    '<p onmouseover="globalThis.__pwned = true">hover</p>',
    '<style>.file-card { display: none }</style>',
    '<form action="https://evil.test/"><input name="token"></form>',
    '<p data-reply-for="1" data-thread="1" id="root">clobber</p>',
  ].join('\n');

  it('comes out inert', async () => {
    answerWith((ref) => (ref === BLOBS.baseSha ? '# Notes\n' : `${MALICIOUS}\n`));
    mount([file({ path: 'README.md' })]);

    await waitFor(() =>
      expect(body('README.md').querySelector('.markdown-rendered')).not.toBeNull(),
    );
    const view = body('README.md').querySelector<HTMLElement>('.markdown-rendered');
    if (view === null) throw new Error('no rendered markdown');

    for (const tag of ['script', 'img', 'iframe', 'svg', 'style', 'form', 'input']) {
      expect(view.querySelectorAll(tag)).toHaveLength(0);
    }

    for (const element of [view, ...view.querySelectorAll('*')]) {
      for (const attribute of element.attributes) {
        expect(attribute.name).not.toMatch(/^on/i);
        // One data attribute is admitted by name — the source anchor the
        // rendered mode writes on every block — so the sweep exempts that one
        // and nothing else. `data-thread` and `data-reply-for` are both in the
        // document above and both still have to go, which is the half of this
        // assertion that was ever protecting anything.
        if (attribute.name !== ANCHOR_ATTRIBUTE) {
          expect(attribute.name).not.toMatch(/^data-/);
        }
        expect(attribute.name).not.toBe('id');
        expect(attribute.name).not.toBe('style');
      }
    }

    for (const anchor of view.querySelectorAll('a')) {
      expect((anchor.getAttribute('href') ?? '').toLowerCase()).not.toContain('javascript');
    }

    // No *live* handler either, which is a different question from the
    // attribute sweep above: jsdom compiles `onmouseover="…"` into a callable
    // property on the element, so this is the DOM's own opinion about whether
    // something would run rather than ours about what the string said.
    //
    // Note what this environment cannot show. jsdom loads no resources, so an
    // `<img onerror>` never fires; and `innerHTML` never executes a `<script>`
    // in any engine, by specification. So "did the payload run" is not
    // observable here in either case, and asserting on a global the attack
    // tried to set would be a test that cannot fail. What is asserted is what
    // reached the document, which is the thing the sanitiser controls.
    //
    // Over the sanitised markup rather than the whole card, and the narrowing
    // is forced rather than chosen: React 19 assigns a no-op `onclick` to a
    // host element carrying `onClick` and to its parent — `trapClickOnNon-
    // InteractiveElement` — so the comment button on every block would fail
    // this sweep while saying nothing about the sanitiser. `.markdown-block-
    // content` is exactly the markup the pull request wrote.
    const authored = [...view.querySelectorAll('.markdown-block-content')].flatMap(
      (content) => [content, ...content.querySelectorAll('*')],
    );
    expect(authored.length).toBeGreaterThan(0);
    for (const element of authored) {
      for (const property of ['onerror', 'onload', 'onmouseover', 'onclick', 'ontoggle']) {
        expect((element as unknown as Record<string, unknown>)[property]).toBeFalsy();
      }
    }

    // And the document is still readable, which is the other half: a sanitiser
    // that returned the empty string would pass everything above.
    expect(view.textContent).toContain('Notes');
  });

  it('leaves the rest of the page alone', async () => {
    // The card body is light DOM, so a surviving `<style>` would be a
    // stylesheet for the whole application rather than for one card.
    answerWith((ref) => (ref === BLOBS.baseSha ? '# Notes\n' : `${MALICIOUS}\n`));
    mount([file({ path: 'README.md' })]);

    await waitFor(() =>
      expect(body('README.md').querySelector('.markdown-rendered')).not.toBeNull(),
    );

    expect(document.querySelectorAll('[data-reply-for]')).toHaveLength(0);
    expect(document.getElementById('root')).toBeNull();
    expect(document.querySelector('.markdown-rendered style')).toBeNull();
  });
});

/**
 * The threads a rendered document has nowhere to put, which is the one way
 * this feature can lose a comment outright.
 *
 * The rendered view draws blocks, and a block carries the range of source
 * lines it was built from. A thread whose line falls *between* two of those
 * ranges — the blank line separating two paragraphs is the ordinary case —
 * belongs to no block, so nothing in the document draws it. Nor does the
 * per-file list catch it: `layoutThreads` is given GitHub's real patch, where
 * that line is inside a hunk, so it makes an annotation — and the card is
 * handed a diff with no rows, so Pierre drops that annotation in silence.
 * Drawn nowhere, listed nowhere, and no error anywhere.
 *
 * Matching such a thread to the nearest block above it was considered and
 * refused: that draws a reviewer's comment beside prose it was not written
 * about, which is the same misattribution the `outdated` verdict already
 * refuses to make. It falls through to the drawer instead, which is where
 * every thread this application cannot place already goes.
 *
 * Driven through the whole column rather than through `MarkdownCompare` alone,
 * because the defect is in the join: both halves are individually correct and
 * neither can see the gap between them.
 */
describe('a comment the rendered document has no block for', () => {
  const README = 'README.md';

  /** One hunk covering the whole of a three-line document. */
  const patchFor = (before: string, after: string): string =>
    [
      `diff --git a/${README} b/${README}`,
      '@@ -1,3 +1,3 @@',
      ' # Title',
      ' ',
      `-${before}`,
      `+${after}`,
      '',
    ].join('\n');

  const sides = (before: string, after: string) => (ref: string): string =>
    `# Title\n\n${ref === BLOBS.baseSha ? before : after}\n`;

  const listed = (): Element | null => body(README).querySelector('.unanchored [data-thread]');

  /**
   * The drawer is one commit behind the document, deliberately.
   *
   * Only the rendered view knows which lines its blocks covered, so it reports
   * what it could not place from an effect and the card lists it on the render
   * after that. Waiting for the document and then asserting on the drawer in
   * the same tick is a race that passes on an idle machine and fails on a busy
   * one — which is exactly what it did.
   */
  const untilListed = async () => {
    await waitFor(() => expect(listed()).not.toBeNull());
  };

  it('lists a thread on the blank line between two paragraphs', async () => {
    // Line 2 is the separator. It is inside the hunk, so it is a line GitHub
    // would take a comment on and a line `layoutThreads` anchors — and there
    // is no block on it, because a blank line renders as nothing at all.
    answerWith(sides('Alpha.', 'Beta.'));
    mount(
      [file({ path: README, patch: patchFor('Alpha.', 'Beta.') })],
      [reviewThread({ path: README, line: 2 })],
    );

    await untilListed();
    // Once, and in the drawer. Drawn in the document as well would be the same
    // comment read twice, beside prose it was not written about.
    expect(body(README).querySelectorAll('[data-thread]')).toHaveLength(1);
    expect(
      body(README).querySelector('[data-listed-reason="no-block"]'),
    ).not.toBeNull();
  });

  it('lists a thread inside raw HTML the renderer passes through', async () => {
    // `markdown-it` returns an `html_block` verbatim, so the anchor attribute
    // never reaches the output and the block has no line at all — §5.1 of the
    // design spec. Same hole, a different way in.
    const before = '<table><tr><td>raw</td></tr></table>';
    const after = '<table><tr><td>new</td></tr></table>';
    answerWith(sides(before, after));
    mount(
      [file({ path: README, patch: patchFor(before, after) })],
      [reviewThread({ path: README, line: 3 })],
    );

    await untilListed();
    expect(body(README).querySelectorAll('[data-thread]')).toHaveLength(1);
  });

  it('leaves a thread the document can place where the document put it', async () => {
    // The other half, and the one that makes the fix worth having rather than
    // merely safe: a thread with a block of its own is still drawn beside the
    // paragraph it was written about, and is not also listed below.
    answerWith(sides('Alpha.', 'Beta.'));
    mount(
      [file({ path: README, patch: patchFor('Alpha.', 'Beta.') })],
      [reviewThread({ path: README, line: 3 })],
    );

    await waitFor(() =>
      expect(body(README).querySelector('.markdown-block [data-thread]')).not.toBeNull(),
    );
    expect(body(README).querySelectorAll('[data-thread]')).toHaveLength(1);
    expect(listed()).toBeNull();
  });
});
