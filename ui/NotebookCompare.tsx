/**
 * A notebook, cell by cell.
 *
 * The alignment is done in `lib/compare/notebook.ts`; this is what it looks
 * like. Two decisions are worth stating.
 *
 * **Unchanged cells collapse.** A notebook's changed cells are a handful and
 * its unchanged ones are the rest, and the point of this view over the text
 * diff is that the rest goes away. They stay reachable — a `<details>` per cell
 * rather than nothing — because "was this cell here before" is a question a
 * reviewer asks, and because a cell whose *output* moved while its source held
 * still is marked in that summary line and is sometimes exactly what the pull
 * request is about.
 *
 * **A changed cell is a real diff.** The two sources go through the same
 * `MultiFileDiff` everything else on this page is rendered with, named for the
 * notebook's own language so the highlighting is Python rather than plain text.
 * That is bounded: each of those is a shadow root, this card is in a header
 * slot that `CodeView` does not virtualize, and a notebook with two hundred
 * changed cells would mount two hundred of them. Past the bound the sources are
 * plain text, which is worse to read and finite.
 */

import { MultiFileDiff } from '@pierre/diffs/react';
import type { FileDiffOptions } from '@pierre/diffs';
import type {
  ComparedNotebookCell,
  NotebookComparison,
  NotebookOutput,
} from '@/lib/compare/notebook';

/**
 * How many cells get a rendered diff before the rest fall back to text.
 *
 * Each one is a `<diffs-container>` with its own shadow root and its own
 * highlighting pass, mounted all at once because nothing virtualizes a card
 * header. Forty is a large notebook review and a small number of shadow roots.
 */
const MAX_RENDERED_DIFFS = 40;

const DIFF_OPTIONS: FileDiffOptions<undefined> = { diffStyle: 'unified' };

function OutputView({ output }: { output: NotebookOutput }) {
  if (output.kind === 'image' && output.image !== null) {
    return (
      <img
        className="cell-output-image"
        // A data URL rather than an object URL: these bytes came out of the
        // notebook JSON we already hold, so there is nothing to fetch and
        // nothing to revoke. Still not a network call, which is the rule.
        src={`data:${output.image.mediaType};base64,${output.image.base64}`}
        alt="Cell output"
      />
    );
  }

  return (
    <pre className={`cell-output cell-output-${output.kind}`}>{output.text}</pre>
  );
}

function Outputs({ cell }: { cell: ComparedNotebookCell }) {
  const outputs = (cell.after ?? cell.before)?.outputs ?? [];
  if (outputs.length === 0) return null;

  return (
    <div className="cell-outputs">
      {outputs.map((output, index) => (
        <OutputView key={index} output={output} />
      ))}
    </div>
  );
}

function CellSource({
  cell,
  name,
  rendered,
}: {
  cell: ComparedNotebookCell;
  name: string;
  /** Whether this cell is inside the budget for a real diff. */
  rendered: boolean;
}) {
  const before = cell.before?.source ?? null;
  const after = cell.after?.source ?? null;

  if (!rendered) {
    return <pre className="cell-source">{after ?? before ?? ''}</pre>;
  }

  if (before === null && after === null) return null;
  if (before === null) {
    return (
      <div className="embedded-diff">
        <MultiFileDiff
          oldFile={null}
          newFile={{ name, contents: after ?? '' }}
          options={DIFF_OPTIONS}
          disableWorkerPool
        />
      </div>
    );
  }
  if (after === null) {
    return (
      <div className="embedded-diff">
        <MultiFileDiff
          oldFile={{ name, contents: before }}
          newFile={null}
          options={DIFF_OPTIONS}
          disableWorkerPool
        />
      </div>
    );
  }

  return (
    <div className="embedded-diff">
      <MultiFileDiff
        oldFile={{ name, contents: before }}
        newFile={{ name, contents: after }}
        options={DIFF_OPTIONS}
        disableWorkerPool
      />
    </div>
  );
}

export interface NotebookCompareProps {
  comparison: NotebookComparison;
  /** Extension the notebook declares, so cells highlight as their language. */
  languageExtension: string;
  /** Draw each cell's output underneath it. */
  showOutputs: boolean;
}

export function NotebookCompare({
  comparison,
  languageExtension,
  showOutputs,
}: NotebookCompareProps) {
  if (comparison.status !== 'ok') {
    return (
      <p className="file-note" role="note">
        {comparison.reason}
      </p>
    );
  }

  const changed = comparison.cells.filter((cell) => cell.kind !== 'equal');
  const rerun = comparison.cells.filter((cell) => cell.outputsOnly).length;

  let budget = MAX_RENDERED_DIFFS;

  return (
    <div className="notebook-compare">
      {comparison.truncated && (
        <p className="file-note" role="note">
          This notebook has more cells than are compared here. Raw shows the
          whole file.
        </p>
      )}

      <ol className="cells">
        {comparison.cells.map((cell) => {
          const source = cell.after ?? cell.before;
          const extension =
            source?.type === 'markdown' ? 'md' : source?.type === 'raw' ? 'txt' : languageExtension;
          const name = `cell-${cell.number}.${extension}`;
          const key = `${cell.kind}:${cell.number}:${cell.before === null ? 'n' : 'o'}`;

          if (cell.kind === 'equal') {
            return (
              <li key={key} className="cell cell-equal">
                <details>
                  <summary>
                    <span className="cell-number">Cell {cell.number}</span>
                    <span className="cell-type">{source?.type ?? 'cell'}</span>
                    <span className="cell-state">
                      {cell.outputsOnly ? 'unchanged, new output' : 'unchanged'}
                    </span>
                  </summary>
                  <pre className="cell-source">{source?.source ?? ''}</pre>
                  {showOutputs && <Outputs cell={cell} />}
                </details>
              </li>
            );
          }

          const rendered = budget > 0;
          if (rendered) budget -= 1;

          return (
            <li key={key} className={`cell cell-${cell.kind}`}>
              <p className="cell-head">
                <span className="cell-number">Cell {cell.number}</span>
                <span className="cell-type">{source?.type ?? 'cell'}</span>
                <span className="cell-state">{cell.kind}</span>
              </p>
              <CellSource cell={cell} name={name} rendered={rendered} />
              {showOutputs && <Outputs cell={cell} />}
            </li>
          );
        })}
      </ol>

      <p className="compare-summary">
        {changed.length === 0
          ? rerun === 0
            ? 'No cells changed.'
            : `No cells changed. ${rerun} were re-run and produced different output.`
          : `${changed.length} of ${comparison.cells.length} cells changed` +
            (rerun === 0 ? '' : `, and ${rerun} more produced different output`)}
      </p>
    </div>
  );
}
