/**
 * A word-level diff of two HTML strings, marked with `<ins>` and `<del>`.
 *
 * Vendored from `htmldiff-js` 1.0.5 (ISC, © 2017 Jordan Hitch), itself a port
 * of HtmlDiff.NET and of Nathan Herald's original Ruby `htmldiff`. The upstream
 * licence — all three layers of it — sits beside this file in `LICENSE`, and
 * the algorithm below is upstream's: split both documents into a stream of
 * words, tags and entities; find the longest matching runs with a fixed-block
 * index; and walk the gaps between the matches emitting insert, delete and
 * replace operations that wrap *text* without ever wrapping a tag.
 *
 * **Why this is a copy rather than a dependency.** Four reasons, in the order
 * they were found and any two of which would have been enough:
 *
 * - The published entry point is not the source above. `main` points at
 *   `dist/htmldiff.min.js`, a webpack-4 UMD bundle from 2022 with no `module`
 *   field, no `exports` map and no types. Depending on the package means
 *   shipping a minified ES5 blob that no reviewer of this repository can read,
 *   into an origin that holds a GitHub token.
 * - It has not been touched since 2022-05-05. That is not in itself
 *   disqualifying, but a dormant package with a live publish key is the exact
 *   shape this project already refused once, in the note about `toml` in the
 *   comparison spec. There is no upstream fix to miss, because there is no
 *   upstream.
 * - It is 9,565 bytes minified. At that size the argument for outsourcing
 *   trust is very weak.
 * - Reading it turned up several defects, listed under "what the port changed"
 *   below. Two of them change what a caller sees and were reproduced against
 *   the published bundle; the rest are branches that cannot execute, each
 *   unreachable through a typo the type checker will not accept. The published
 *   bundle contains all of them and has for four years, which is the practical
 *   difference between code someone maintains and code nobody has read.
 *
 * **What this deliberately does not do is sanitise.** It is handed HTML that a
 * pull request wrote and it hands back HTML with more tags in it. The
 * sanitiser runs afterwards, in `ui/`, on the finished string, immediately
 * before it reaches the DOM — because sanitising first would let this step
 * reintroduce structure into markup that had already been declared safe. There
 * is a test in this file pinning the fact that a `<script>` survives here, so
 * that the day somebody moves the sanitiser earlier the reason it was late is
 * not lost with it.
 *
 * Pure, like everything under `lib/`: no DOM, no parser, no `chrome.*`. It
 * never interprets the HTML it is given — every tag is an opaque token — which
 * is what lets it run in the `node` half of the test suite.
 *
 * **What the port changed.** Nothing about the algorithm; everything else is
 * listed here so a future reader can diff it against upstream.
 *
 * - *Block expressions are gone.* `addBlockExpression` let a caller pin
 *   regions that must not be split. Nothing here uses it, and the code
 *   implementing it references an undeclared `index` — a `ReferenceError` the
 *   moment it runs under a module's strict mode. Four years unnoticed, because
 *   the feature is opt-in and nobody opted in. Deleted rather than fixed: dead
 *   code in a file on this path is a liability, not an asset.
 * - *The special-case regex lost its `g` flag.* Upstream declares it once at
 *   module scope with `/…/ig` and calls `.test()` on it, and a global regex
 *   carries `lastIndex` between calls — so the same two documents diffed twice
 *   in a row give two different answers. There is a test.
 * - *A missing tag name no longer throws.* `< >` passes the "is this a tag"
 *   test and fails the "what is it called" one, so upstream indexes `null[0]`.
 * - *Three dead branches are gone*, each unreachable through a typo the type
 *   checker will not accept: `wordIndices.length` on a `Map`, `match.length`
 *   on a `Match`, and `options.IgnoreWhiteSpaceDifferences` against a field
 *   spelled `ignoreWhitespaceDifferences`. So are the two tuning options only
 *   those branches read.
 * - *`removeRepeatingWords` is gone.* It drops index entries appearing more
 *   than `newWords.length + repeatingWordsAccuracy` times — a threshold no
 *   word can reach, since a word cannot appear more often than there are
 *   words. Upstream's C# multiplies where this adds. It has never removed
 *   anything.
 * - *The orphan threshold is folded in.* Upstream compares a match's length in
 *   characters against the distance to its neighbours times
 *   `orphanMatchThreshold`, which is 0. Multiplying by zero made two `slice`
 *   and `reduce` passes over arbitrarily large gaps — inside a loop over every
 *   match, so quadratic in the document — decide nothing at all. What is left
 *   is the comparison against zero that survived. Restoring a real threshold
 *   means restoring those two passes with it.
 * - *The recursion is an explicit stack.* `findMatchingBlocks` recursed once
 *   per match found, and the input is a document from a pull request: a file
 *   contrived to produce tens of thousands of single-word matches would
 *   overflow the stack. The loop below cannot.
 * - *The splitter walks code points, not UTF-16 units*, so an emoji is one
 *   word rather than two broken halves.
 * - *The merged whitespace token is a string.* Upstream builds it as
 *   `[(w1 + w2).split()]`, an array inside an array. Cosmetic, and recorded
 *   only so nobody re-derives it as a bug: `join` stringifies the nested array
 *   to the same characters, and putting upstream's shape back changes no test
 *   here. The *merge itself* is upstream behaviour and is kept — deleting it
 *   changes 1,110 of 3,000 random pairs.
 *
 * **The equivalence was measured, not argued.** Against upstream with only the
 * `g` flag corrected, this file produces byte-identical output on **40,000
 * randomly generated document pairs** of headings, lists, tables, entities,
 * nested inline formatting and line breaks. The algorithm is upstream's; only
 * the defects moved. That harness lives outside the repository, because keeping
 * it would mean taking a dev dependency on the package this file exists to
 * avoid depending on — so the properties worth keeping are pinned as ordinary
 * tests beside this file, and the equivalence run is a thing to repeat by hand
 * if the algorithm is ever touched.
 *
 * **The cost is not linear and the ceiling is not a character count.** Measured
 * on this machine over rendered Markdown: a 37,000-character document with one
 * word changed per section takes 568 ms, the same document sharing no words
 * with its predecessor takes 1,586 ms, and the same again reversed takes
 * 3,074 ms. Those are survivable. But 40,000 characters of *one word repeated*
 * takes **10,952 ms** — nineteen times the first figure at the same size —
 * because every block index key collides, so each position on the old side
 * walks every position on the new side. Doubling that input to 80,000
 * characters takes 48 seconds, and 160,000 takes three and a half minutes.
 *
 * A character cap tight enough to bound that case would refuse an ordinary
 * README, so the cap is on the *work* instead, in the shape `ALIGN_BUDGET`
 * already uses for row alignment: `HTML_DIFF_BUDGET` counts the comparisons the
 * match finder is allowed and `diffHtml` returns null rather than a partial
 * answer when they run out. `MARKDOWN_LIMITS` in `../markdown.ts` bounds the
 * input on top of it, in the units a caller can measure before paying.
 */

/** What the splitter is in the middle of reading. */
type Mode = 'character' | 'tag' | 'whitespace' | 'entity';

/** What happened between two matching runs. */
type Action = 'equal' | 'delete' | 'insert' | 'none' | 'replace';

/** A run of words present in both documents, at possibly different offsets. */
interface Match {
  startInOld: number;
  startInNew: number;
  size: number;
}

interface Operation {
  action: Action;
  startInOld: number;
  endInOld: number;
  startInNew: number;
  endInNew: number;
}

const endInOld = (match: Match): number => match.startInOld + match.size;
const endInNew = (match: Match): number => match.startInNew + match.size;

/**
 * How many words a block index key spans, at most.
 *
 * Upstream's comment: the higher it is the faster it works and the more memory
 * it consumes. `findMatch` tries every size from this down to one, so raising
 * it costs a whole extra index pass per range.
 */
const MAX_MATCH_GRANULARITY = 4;

/**
 * How many word comparisons the match finder may make before giving up.
 *
 * The same idea as `ALIGN_BUDGET` in `../rows.ts` and for the same reason: the
 * expensive path here is quadratic in the number of *colliding* words rather
 * than in the size of the document, so no measurement of the input predicts it.
 *
 * Two million is where the measurements put it. What real documents need, by
 * bisecting on this number until the diff completes: this repository's own
 * README, 6,894 characters of rendered HTML, needs 21,829 and takes 11 ms. The
 * comparison spec next to it, 40,838 characters and dense with tables, needs
 * 92,840 and takes 37 ms. Seventy-five kilobytes of varied prose — ten times
 * the README, larger than any document this is likely to meet — needs
 * 1,945,059 and takes 366 ms. And the shapes that motivated a budget at all
 * give up inside it: the repeated-word document abandons after 186 ms at 40,000
 * characters and 500 ms at 500,000, where finishing would have taken eleven
 * seconds and several minutes respectively.
 *
 * So the bound sits above every honest document measured and below every
 * dishonest one, and the cost of discovering which it was handed is half a
 * second at worst.
 *
 * Unlike row alignment there is no coarser answer to fall back to — half a
 * marked-up document is a wrong one, not an approximate one — so past this the
 * mode declines and says so, and Raw is one press away.
 */
export const HTML_DIFF_BUDGET = 2_000_000;

/** What is left of the budget. Mutable, threaded down, checked on the way out. */
interface Budget {
  left: number;
}

/** A whole token that is a tag, rather than one that merely contains a `<`. */
const TAG = /^\s*<\/?[^>]+>\s*$/;
/** The tag's name and nothing after it, for comparing tags with moved attributes. */
const TAG_NAME = /<[^\s>]+/;
const WHITESPACE = /^(\s|&nbsp;)+$/;
const WORD = /[\w#@]+/;

/**
 * Tags treated as words rather than as structure.
 *
 * An image is content: two documents that differ only in which image they show
 * differ, and a tag the diff skips over cannot say so.
 */
const WORD_TAGS = ['<img'];

/**
 * Inline formatting whose opening tag is worth marking as changed on its own.
 *
 * The list is upstream's. No `g` flag — see the note at the top; with one, the
 * `lastIndex` this leaves behind makes the next call answer a different
 * question about a different string.
 */
const INLINE_OPENING = /<((strong)|(b)|(i)|(em)|(big)|(small)|(u)|(sub)|(sup)|(strike)|(s))[>\s]+/i;

const INLINE_CLOSING = new Set([
  '</strong>', '</em>', '</b>', '</i>', '</big>',
  '</small>', '</u>', '</sub>', '</strike>', '</s>',
]);

const isWhitespace = (value: string): boolean => WHITESPACE.test(value);
const isWord = (value: string): boolean => WORD.test(value);

const isTag = (item: string): boolean => {
  if (WORD_TAGS.some((prefix) => item.startsWith(prefix))) return false;
  return TAG.test(item);
};

/**
 * A tag reduced to its name, so that `<a href="x">` and `<a href="y">` index
 * alike.
 *
 * Attribute changes are invisible to this diff by design — upstream's own
 * comment says "not supported (yet)" — and for rendered Markdown that is the
 * right trade: an `href` that moved shows up as the link text around it moving,
 * and a link whose text is unchanged is a change a prose diff was never going
 * to show anyway.
 *
 * The null branch is the fix described at the top. `< >` reaches `isTag` as a
 * tag and leaves `TAG_NAME` with nothing to return.
 */
function stripAttributes(word: string): string {
  if (!isTag(word)) return word;

  const name = TAG_NAME.exec(word)?.[0];
  if (name === undefined) return word;

  return name + (word.endsWith('/>') ? '/>' : '>');
}

/**
 * One document as a stream of words, tags, entities and runs of whitespace.
 *
 * Every token is at least one character long, and concatenating them all
 * reproduces the input exactly. Both properties are relied on downstream: the
 * first by the orphan test, the second by the fact that an unchanged document
 * comes back byte for byte.
 */
function toWords(text: string): string[] {
  const words: string[] = [];
  let current: string[] = [];
  let mode: Mode = 'character';

  /**
   * Close the pending token and start a new one, returning the mode to be in.
   *
   * Returns the mode rather than assigning it so that every change to `mode` is
   * visible at the call site. Assigning from in here compiles to the same
   * thing and type-checks to something worse: the narrowing that decides which
   * `case` labels are reachable cannot see through a closure, so half the
   * switch below became unreachable code as far as the compiler was concerned.
   */
  const restart = (character: string, next: Mode): Mode => {
    if (current.length !== 0) words.push(current.join(''));
    current = [character];
    return next;
  };

  // Code points rather than UTF-16 units, so an astral character is one token.
  for (const character of text) {
    switch (mode) {
      case 'character':
        if (character === '<') {
          mode = restart('<', 'tag');
        } else if (character === '&') {
          mode = restart(character, 'entity');
        } else if (isWhitespace(character)) {
          mode = restart(character, 'whitespace');
        } else if (isWord(character) && isWord(current.at(-1) ?? '')) {
          // Letters join the word in progress. Anything else — punctuation, a
          // bracket — is its own token, so that editing one word in a sentence
          // does not repaint the comma after it.
          current.push(character);
        } else if (isWord(character) && current.length === 0) {
          current.push(character);
        } else {
          mode = restart(character, 'character');
        }
        break;

      case 'tag':
        current.push(character);
        if (character === '>') {
          words.push(current.join(''));
          current = [];
          mode = 'character';
        }
        break;

      case 'whitespace':
        if (character === '<') {
          mode = restart(character, 'tag');
        } else if (character === '&') {
          mode = restart(character, 'entity');
        } else if (isWhitespace(character)) {
          current.push(character);
        } else {
          mode = restart(character, 'character');
        }
        break;

      case 'entity':
        if (character === '<') {
          mode = restart(character, 'tag');
        } else if (isWhitespace(character)) {
          mode = restart(character, 'whitespace');
        } else if (character === ';') {
          mode = 'character';
          if (current.length !== 0) {
            current.push(character);
            words.push(current.join(''));
            current = [];

            // `&nbsp;` immediately after real whitespace is still whitespace,
            // and reading it as a word would let a line-wrapping change look
            // like an edit. Upstream rebuilds the merged token as
            // `[(w1 + w2).split()]` — an array inside an array, which only
            // survives because `join` stringifies whatever it is handed.
            const last = words.at(-1);
            const previous = words.at(-2);
            if (
              words.length > 2 &&
              last !== undefined &&
              previous !== undefined &&
              isWhitespace(previous) &&
              isWhitespace(last)
            ) {
              words.splice(words.length - 2, 2);
              current = [previous + last];
              mode = 'whitespace';
            }
          }
        } else if (isWord(character)) {
          current.push(character);
        } else {
          mode = restart(character, 'character');
        }
        break;
    }
  }

  if (current.length !== 0) words.push(current.join(''));
  return words;
}

/**
 * Slide a fixed-size window over the word stream and return its contents as an
 * index key, or null until the window is full.
 */
function slideBlock(block: string[], word: string, blockSize: number): string | null {
  block.push(word);
  if (block.length > blockSize) block.shift();
  if (block.length !== blockSize) return null;
  return block.join('');
}

/**
 * The longest run of `blockSize`-word blocks common to both ranges.
 *
 * Indexes the new side, then walks the old side extending every run that the
 * index says could continue. Linear in the two ranges, times however many
 * places each block key occurs on the new side.
 */
function findBlockMatch(
  oldWords: readonly string[],
  newWords: readonly string[],
  startInOld: number,
  stopInOld: number,
  startInNew: number,
  stopInNew: number,
  blockSize: number,
  budget: Budget,
): Match | null {
  const wordIndices = new Map<string, number[]>();
  const indexBlock: string[] = [];

  // Indexing is linear and charged for, so that a document large enough to be
  // slow purely in the index cannot slip past a budget that only watches the
  // scan below.
  budget.left -= stopInNew - startInNew;

  for (let i = startInNew; i < stopInNew; i += 1) {
    const key = slideBlock(indexBlock, stripAttributes(newWords[i] ?? ''), blockSize);
    if (key === null) continue;

    const at = wordIndices.get(key);
    if (at === undefined) wordIndices.set(key, [i]);
    else at.push(i);
  }

  let bestInOld = startInOld;
  let bestInNew = startInNew;
  let bestSize = 0;

  let runLengths = new Map<number, number>();
  const scanBlock: string[] = [];

  for (let indexInOld = startInOld; indexInOld < stopInOld; indexInOld += 1) {
    const key = slideBlock(scanBlock, stripAttributes(oldWords[indexInOld] ?? ''), blockSize);
    if (key === null) continue;

    const nextRunLengths = new Map<number, number>();
    const occurrences = wordIndices.get(key);
    if (occurrences === undefined) {
      runLengths = nextRunLengths;
      continue;
    }

    // This is the quadratic term, and the only one: a word repeated `n` times
    // puts `n` entries in `occurrences` for each of `n` positions on the old
    // side. Charging here is what makes the budget mean anything.
    budget.left -= occurrences.length;
    if (budget.left <= 0) return null;

    for (const indexInNew of occurrences) {
      const runLength = (runLengths.get(indexInNew - 1) ?? 0) + 1;
      nextRunLengths.set(indexInNew, runLength);

      if (runLength > bestSize) {
        bestInOld = indexInOld - runLength - blockSize + 2;
        bestInNew = indexInNew - runLength - blockSize + 2;
        bestSize = runLength;
      }
    }

    runLengths = nextRunLengths;
  }

  if (bestSize === 0) return null;
  return { startInOld: bestInOld, startInNew: bestInNew, size: bestSize + blockSize - 1 };
}

/** The best match in a range, trying the coarsest block size that finds one. */
function findMatch(
  oldWords: readonly string[],
  newWords: readonly string[],
  startInOld: number,
  stopInOld: number,
  startInNew: number,
  stopInNew: number,
  granularity: number,
  budget: Budget,
): Match | null {
  for (let blockSize = granularity; blockSize > 0; blockSize -= 1) {
    const match = findBlockMatch(
      oldWords, newWords, startInOld, stopInOld, startInNew, stopInNew, blockSize, budget,
    );
    if (match !== null) return match;
    if (budget.left <= 0) return null;
  }
  return null;
}

/** A range still to be searched, or a match already found and waiting its turn. */
type Task =
  | { kind: 'range'; startInOld: number; stopInOld: number; startInNew: number; stopInNew: number }
  | { kind: 'emit'; match: Match };

/**
 * Every matching run, in document order.
 *
 * Divide and conquer: the best match in a range splits it, and the halves
 * either side are searched the same way. Upstream recursed; this keeps the
 * stack explicit because the depth is one frame per match and the number of
 * matches is chosen by whoever wrote the file.
 */
function matchingBlocks(
  oldWords: readonly string[],
  newWords: readonly string[],
  granularity: number,
  budget: Budget,
): Match[] | null {
  const found: Match[] = [];
  const stack: Task[] = [
    {
      kind: 'range',
      startInOld: 0,
      stopInOld: oldWords.length,
      startInNew: 0,
      stopInNew: newWords.length,
    },
  ];

  while (stack.length > 0) {
    const task = stack.pop();
    if (task === undefined) break;

    if (task.kind === 'emit') {
      found.push(task.match);
      continue;
    }

    const { startInOld, stopInOld, startInNew, stopInNew } = task;
    const match = findMatch(
      oldWords, newWords, startInOld, stopInOld, startInNew, stopInNew, granularity, budget,
    );
    // Out of budget is not the same answer as no match: one means these two
    // ranges have nothing in common, the other means we stopped looking. Only
    // the second invalidates every match found so far.
    if (budget.left <= 0) return null;
    if (match === null) continue;

    // Pushed back to front, so they pop as left, match, right — which is the
    // in-order walk the recursion produced.
    if (endInOld(match) < stopInOld && endInNew(match) < stopInNew) {
      stack.push({
        kind: 'range',
        startInOld: endInOld(match),
        stopInOld,
        startInNew: endInNew(match),
        stopInNew,
      });
    }
    stack.push({ kind: 'emit', match });
    if (startInOld < match.startInOld && startInNew < match.startInNew) {
      stack.push({
        kind: 'range',
        startInOld,
        stopInOld: match.startInOld,
        startInNew,
        stopInNew: match.startInNew,
      });
    }
  }

  return found;
}

/**
 * Drop matches that connect to nothing on either side and carry no text.
 *
 * A match adjacent to its neighbour is structural and always kept. One
 * stranded between two gaps is kept only if it has characters in it — which,
 * since every token is at least one character, is every match except the
 * zero-length sentinel `operations` appends. See the note at the top about the
 * threshold this used to multiply by.
 */
function removeOrphans(matches: readonly Match[], newWords: readonly string[]): Match[] {
  const kept: Match[] = [];
  let previous: Match = { startInOld: 0, startInNew: 0, size: 0 };
  let current: Match | null = null;

  for (const next of matches) {
    if (current === null) {
      current = next;
      continue;
    }

    const joinsBack =
      endInOld(previous) === current.startInOld && endInNew(previous) === current.startInNew;
    const joinsForward =
      endInOld(current) === next.startInOld && endInNew(current) === next.startInNew;

    if (joinsBack || joinsForward) {
      kept.push(current);
    } else {
      let characters = 0;
      for (let i = current.startInNew; i < endInNew(current); i += 1) {
        characters += newWords[i]?.length ?? 0;
      }
      if (characters > 0) kept.push(current);
    }

    previous = current;
    current = next;
  }

  if (current !== null) kept.push(current);
  return kept;
}

/** The gaps between the matches, named by what happened in them. */
function operations(
  oldWords: readonly string[],
  newWords: readonly string[],
  granularity: number,
  budget: Budget,
): Operation[] | null {
  const matches = matchingBlocks(oldWords, newWords, granularity, budget);
  if (matches === null) return null;

  // The sentinel: a zero-length match at the end of both documents, so the
  // final gap is walked like any other.
  matches.push({ startInOld: oldWords.length, startInNew: newWords.length, size: 0 });

  const result: Operation[] = [];
  let positionInOld = 0;
  let positionInNew = 0;

  for (const match of removeOrphans(matches, newWords)) {
    const heldInOld = positionInOld === match.startInOld;
    const heldInNew = positionInNew === match.startInNew;

    const action: Action =
      !heldInOld && !heldInNew
        ? 'replace'
        : heldInOld && !heldInNew
          ? 'insert'
          : !heldInOld
            ? 'delete'
            : 'none';

    if (action !== 'none') {
      result.push({
        action,
        startInOld: positionInOld,
        endInOld: match.startInOld,
        startInNew: positionInNew,
        endInNew: match.startInNew,
      });
    }

    if (match.size !== 0) {
      result.push({
        action: 'equal',
        startInOld: match.startInOld,
        endInOld: endInOld(match),
        startInNew: match.startInNew,
        endInNew: endInNew(match),
      });
    }

    positionInOld = endInOld(match);
    positionInNew = endInNew(match);
  }

  return result;
}

/**
 * Take words off the front of `words` for as long as they satisfy `condition`.
 *
 * Mutates `words`, which is what makes the loop in `mark` terminate. Returning
 * nothing and consuming nothing when the very first word fails is deliberate
 * and load-bearing: it is how `mark` learns to switch to its tag branch.
 */
function takeWhile(words: string[], condition: (word: string) => boolean): string[] {
  let firstFailure: number | null = null;

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? '';
    // A leading space would collapse against the tag about to be written
    // before it, moving text that did not move.
    if (i === 0 && word === ' ') words[i] = '&nbsp;';

    if (!condition(words[i] ?? '')) {
      firstFailure = i;
      break;
    }
  }

  if (firstFailure === null) return words.splice(0, words.length);
  return words.splice(0, firstFailure);
}

const wrap = (text: string, tag: string, cssClass: string): string =>
  `<${tag} class="${cssClass}">${text}</${tag}>`;

/**
 * Emit one run of words wrapped in `<ins>` or `<del>`, tag by tag.
 *
 * The rule that makes the output well-formed enough to sanitise: text is
 * wrapped and tags are not. Wrapping `<li>foo</li>` whole would put a block
 * element inside an `<ins>` spanning list items; wrapping only `foo` leaves the
 * list intact and marks its contents.
 */
function mark(
  content: string[],
  inlineStack: string[],
  tag: 'ins' | 'del',
  cssClass: string,
  words: string[],
): void {
  while (words.length > 0) {
    const text = takeWhile(words, (word) => !isTag(word));

    if (text.length !== 0) {
      content.push(wrap(text.join(''), tag, cssClass));
      continue;
    }

    // Nothing but tags at the front. Opening and closing inline formatting is
    // itself a change worth showing — bolding a word that was not bold before
    // is an edit — so those two get a mark of their own.
    const first = words[0] ?? '';
    let injection = '';
    let injectionFirst = false;

    if (INLINE_OPENING.test(first)) {
      inlineStack.push(first);
      injection = '<ins class="mod">';
      if (tag === 'del') {
        words.shift();
        while (words.length > 0 && INLINE_OPENING.test(words[0] ?? '')) words.shift();
      }
    } else if (INLINE_CLOSING.has(first)) {
      const opening = inlineStack.pop() ?? null;
      if (opening !== null && opening === first.replace(/\//g, '')) {
        injection = '</ins>';
        injectionFirst = true;
      }
      if (tag === 'del') {
        words.shift();
        while (words.length > 0 && INLINE_CLOSING.has(words[0] ?? '')) words.shift();
      }
    }

    if (words.length === 0 && injection.length === 0) break;

    const tags = takeWhile(words, isTag).join('');
    content.push(injectionFirst ? injection + tags : tags + injection);
  }
}

const slice = (words: readonly string[], from: number, to: number): string[] =>
  words.slice(Math.max(0, from), Math.max(0, to));

/**
 * Two HTML documents, returned as one with the differences marked inline.
 *
 * The classes are upstream's and the stylesheet keys on them: `diffins` for an
 * addition, `diffdel` for a removal, `diffmod` on both halves of a replacement
 * so the two can be shown as one edit.
 *
 * The output is *not* guaranteed to be well-formed — nothing here parses, so a
 * pathological input can produce overlapping marks — and it is emphatically
 * not safe. Both are the sanitiser's problem, and it is downstream for a
 * reason.
 *
 * **Null when the budget runs out.** Not a partial answer: a document with only
 * some of its changes marked reads exactly like a document with only those
 * changes, which is the one failure a reviewer cannot detect.
 */
export function diffHtml(
  before: string,
  after: string,
  budgetLimit: number = HTML_DIFF_BUDGET,
): string | null {
  if (before === after) return after;

  const oldWords = toWords(before);
  const newWords = toWords(after);
  const granularity = Math.min(MAX_MATCH_GRANULARITY, oldWords.length, newWords.length);
  const budget: Budget = { left: budgetLimit };

  const plan = operations(oldWords, newWords, granularity, budget);
  if (plan === null) return null;

  const content: string[] = [];
  // Which inline formatting tags are currently open inside a mark, so that the
  // `</ins>` that closes one is emitted against the `<ins class="mod">` that
  // opened it rather than against whichever came last.
  const inlineStack: string[] = [];

  for (const operation of plan) {
    switch (operation.action) {
      case 'equal':
        content.push(slice(newWords, operation.startInNew, operation.endInNew).join(''));
        break;
      case 'insert':
        mark(content, inlineStack, 'ins', 'diffins',
          slice(newWords, operation.startInNew, operation.endInNew));
        break;
      case 'delete':
        mark(content, inlineStack, 'del', 'diffdel',
          slice(oldWords, operation.startInOld, operation.endInOld));
        break;
      case 'replace':
        // Both halves carry the same class, which is what lets the stylesheet
        // show a replacement as one edit rather than as an unrelated removal
        // followed by an unrelated addition.
        mark(content, inlineStack, 'del', 'diffmod',
          slice(oldWords, operation.startInOld, operation.endInOld));
        mark(content, inlineStack, 'ins', 'diffmod',
          slice(newWords, operation.startInNew, operation.endInNew));
        break;
      case 'none':
        break;
    }
  }

  return content.join('');
}
