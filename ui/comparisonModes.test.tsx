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
 * - the mode is per file, so two images can be in different ones at once
 * - nothing is remembered across a mount, which is what every other piece of
 *   interface state on this page does
 * - the switcher is operable from the keyboard
 *
 * Layout is not asserted anywhere in this file. jsdom performs none, an `<img>`
 * in it never loads and reports zero by zero forever, and the geometry of the
 * overlay modes is therefore checked in the browser test instead.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOTH_SIDES } from '@/lib/review/diffScope';
import { DraftStore } from '@/lib/review/drafts';
import { DiffColumn } from './DiffColumn';
import { request } from './background';
import { NO_FILE } from './currentFile';
import { clearSideCache } from './fileSides';
import { memoryStore } from './memoryStore.fixture';
import { diffHasRendered } from './pierreDom.fixture';
import { pullRequestNode } from './prPayload.fixture';
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

function mount(files: readonly ReviewFile[]) {
  return render(
    <ReviewSessionProvider
      pullRequest={pullRequestNode()}
      prRef={PR_REF}
      threads={[]}
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
      expect(card('assets/logo.png').querySelector('.image-compare')).not.toBeNull();
    });
    expect(within(card('assets/logo.png')).queryByRole('note')).toBeNull();
  });

  it('puts the binary sentence back when the reviewer asks for raw', async () => {
    const user = userEvent.setup();
    mount([file({ path: 'assets/logo.png', isBinary: true, patch: '' })]);

    await user.click(modeButton('assets/logo.png', 'Raw'));

    expect(within(card('assets/logo.png')).getByRole('note').textContent).toMatch(
      /binary/i,
    );
    expect(card('assets/logo.png').querySelector('.image-compare')).toBeNull();
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

describe('the mode is per file', () => {
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

  it('remembers nothing across a mount, like every other control here', async () => {
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
      expect(card('data/rows.csv').querySelector('.grid')).not.toBeNull();
    });

    const changed = card('data/rows.csv').querySelectorAll('.grid-cell-changed');
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
      expect(card('data/rows.csv').querySelector('.grid')).not.toBeNull();
    });
    expect(card('data/rows.csv').querySelectorAll('.grid-row')).toHaveLength(2);

    await user.click(modeButton('data/rows.csv', 'Changed rows'));

    await waitFor(() => {
      expect(card('data/rows.csv').querySelectorAll('.grid-row')).toHaveLength(1);
    });
  });

  it('lists the key paths of a JSON change rather than its lines', async () => {
    answerWith((ref) =>
      ref === BLOBS.baseSha ? '{"server":{"port":80}}' : '{\n "server": {\n  "port": 443\n }\n}',
    );
    mount([file({ path: 'config.json' })]);

    await waitFor(() => {
      expect(card('config.json').querySelector('.key-paths')).not.toBeNull();
    });

    const paths = [...card('config.json').querySelectorAll('.key-path')].map(
      (node) => node.textContent,
    );
    expect(paths).toEqual(['server.port']);
  });

  it('says nothing changed when only the formatting did', async () => {
    answerWith((ref) => (ref === BLOBS.baseSha ? '{"a":1}' : '{\n  "a": 1\n}'));
    mount([file({ path: 'config.json' })]);

    await waitFor(() => {
      expect(within(card('config.json')).getByRole('note').textContent).toMatch(
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
      expect(card('k8s/deploy.yaml').querySelector('.key-paths')).not.toBeNull();
    });

    const paths = [...card('k8s/deploy.yaml').querySelectorAll('.key-path')].map(
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
      expect(card('Cargo.toml').querySelector('.key-paths')).not.toBeNull();
    });

    const paths = [...card('Cargo.toml').querySelectorAll('.key-path')].map(
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
      expect(card('tsconfig.json').querySelector('.key-paths')).not.toBeNull();
    });

    const paths = [...card('tsconfig.json').querySelectorAll('.key-path')].map(
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
      expect(card('analysis.ipynb').querySelector('.cells')).not.toBeNull();
    });

    expect(card('analysis.ipynb').querySelectorAll('.cell-changed')).toHaveLength(1);
    const unchanged = card('analysis.ipynb').querySelector('.cell-equal');
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
      expect(card('analysis.ipynb').querySelector('.cells')).not.toBeNull();
    });
    expect(card('analysis.ipynb').textContent).not.toContain('RESULT-TEXT');

    await user.click(modeButton('analysis.ipynb', 'Cells and outputs'));

    await waitFor(() => {
      expect(card('analysis.ipynb').textContent).toContain('RESULT-TEXT');
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
      expect(within(card('data/rows.csv')).getByRole('alert').textContent).toMatch(
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

  it('takes the text diff away when a comparison replaces it, and back', async () => {
    // The item is collapsed for exactly this reason. Left expanded, a CSV in
    // its grid would carry Pierre's line-by-line diff of the same file below
    // it — the view the reviewer just chose not to look at, at the cost of
    // rendering it anyway. Driven raw-first so the diff is known to have
    // rendered before its absence is asserted.
    const user = userEvent.setup();
    answerWith(() => 'a,b\n1,2\n');
    mount([file({ path: 'data/rows.csv' })]);

    await user.click(modeButton('data/rows.csv', 'Raw'));
    await waitFor(() => {
      expect(diffHasRendered('data/rows.csv')).toBe(true);
    });

    await user.click(modeButton('data/rows.csv', 'Grid'));
    await waitFor(() => {
      expect(diffHasRendered('data/rows.csv')).toBe(false);
    });
  });

  it('does not offer to collapse a card whose body is a comparison', () => {
    mount([file({ path: 'data/rows.csv' })]);

    expect(
      within(card('data/rows.csv')).queryByRole('button', { name: /Collapse|Expand/ }),
    ).toBeNull();
  });

  it('offers the collapse toggle back once the card is showing raw', async () => {
    const user = userEvent.setup();
    mount([file({ path: 'data/rows.csv' })]);

    await user.click(modeButton('data/rows.csv', 'Raw'));

    expect(
      within(card('data/rows.csv')).getByRole('button', { name: /Collapse/ }),
    ).toBeTruthy();
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
