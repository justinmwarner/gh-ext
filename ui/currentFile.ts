/**
 * Which file the reviewer is on — and, just as important, which side moved it.
 *
 * The tree and the diff column drive the same value in opposite directions:
 * picking a file in the tree scrolls the diff to it, and scrolling the diff
 * selects it in the tree. Each of those actions makes the other surface report
 * back, so without a rule about who moved last the two chase each other for as
 * long as the page is open.
 *
 * Two rules break the loop, and both are here rather than in either component,
 * because a feedback loop is a property of the pair:
 *
 * 1. **Only the far side acts.** A change that came from the tree scrolls the
 *    diff and does not re-select in the tree. A change that came from the
 *    scroll selects in the tree and does not re-scroll the diff.
 * 2. **An echo is identity.** Being told about the file we are already on
 *    returns the *same object*, so React bails out of the re-render entirely
 *    and no effect re-runs. This is what makes the first rule terminate rather
 *    than merely alternate.
 */

/**
 * Which surface moved the current file.
 *
 * Three, not two, because "neither of them" is a real answer. `j`, the jump
 * panel and a thread link all move it without the tree or the column having
 * acted, and both of those far surfaces need to follow. Reusing `tree` for
 * those meant telling the tree to stand still for a move it did not make.
 */
export type FileOrigin = 'tree' | 'scroll' | 'command';

export interface CurrentFile {
  path: string | null;
  /** Which surface last moved it. Null before either has. */
  origin: FileOrigin | null;
}

export const NO_FILE: CurrentFile = { path: null, origin: null };

const moveTo = (
  state: CurrentFile,
  path: string,
  origin: FileOrigin,
): CurrentFile => (state.path === path ? state : { path, origin });

/** The reviewer picked, or arrow-keyed onto, a file in the tree. */
export function fromTree(state: CurrentFile, path: string): CurrentFile {
  return moveTo(state, path, 'tree');
}

/**
 * A keyboard shortcut, the jump panel or a thread link moved it.
 *
 * Neither surface knows yet, so both act.
 */
export function fromCommand(state: CurrentFile, path: string): CurrentFile {
  return moveTo(state, path, 'command');
}

/** The diff column scrolled and a different file reached the top. */
export function fromScroll(state: CurrentFile, path: string): CurrentFile {
  return moveTo(state, path, 'scroll');
}

export function shouldScrollDiff(state: CurrentFile): boolean {
  return state.origin === 'tree' || state.origin === 'command';
}

export function shouldSelectInTree(state: CurrentFile): boolean {
  return state.origin === 'scroll' || state.origin === 'command';
}

/** One mounted file card, and where its header sits relative to the viewport. */
export interface CardTop {
  path: string;
  /** Offset from the top of the scroll region. Negative once scrolled past. */
  top: number;
}

/**
 * How far below the top of the scrollport a header may sit and still be the
 * file the reviewer is on.
 *
 * Not slack, and not a guess. Two things put a header below the top even when
 * its file is the one being read: an exact `<= 0` flickers between two files
 * while a header sits on the seam, and — the larger of the two — the gap
 * between one file's last line and the next one's header belongs to the file
 * *below* it, so scrolling the column to a file lands on top of that gap
 * rather than on the header. Measured at 26px.
 *
 * Under it, clicking a file in the tree reported the file above the one that
 * was clicked, which drove the tree to select *that* one — so the row the
 * reviewer had just clicked came back deselected.
 *
 * It is bounded on the other side by how close two headers can get, which is
 * two collapsed cards and a gap: comfortably more than this.
 *
 * Coupled to `--diffs-gap-block` in the stylesheet. Change the space between
 * files and this has to be measured again.
 */
export const REACHED = 36;

/**
 * Which file the reviewer is looking at, given where the cards are.
 *
 * The answer is the last card whose header has passed the top of the viewport.
 * When none has — the column is scrolled to the very top, or virtualization has
 * momentarily left the topmost mounted header below the fold — it is the first
 * card, because reporting nothing would clear the tree's selection instead.
 */
export function topmostFile(tops: readonly CardTop[]): string | null {
  if (tops.length === 0) return null;

  const ordered = [...tops].sort((a, b) => a.top - b.top);

  let reached: CardTop | undefined;
  for (const card of ordered) {
    if (card.top > REACHED) break;
    reached = card;
  }

  return (reached ?? ordered[0])?.path ?? null;
}
