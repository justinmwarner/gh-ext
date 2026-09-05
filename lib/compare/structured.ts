/**
 * Comparing two structured documents by structure rather than by line.
 *
 * JSON, YAML and TOML are three spellings of one thing — a tree of plain
 * values — and all three suffer the same failure under a text diff, so all
 * three arrive here. `lib/compare/syntax.ts` is the only part that knows which
 * spelling it was handed; from the parse onward this walks a plain value and
 * has no opinion about where it came from.
 *
 * A text diff of JSON is wrong in two directions at once. Re-indent a file and
 * every line changes while nothing does; insert one element at the head of an
 * array and every line after it changes while one thing does. Both are
 * ordinary events in a pull request — a formatter ran, a dependency was added
 * — and both leave the reviewer reading a wall of red and green to find the
 * two values that moved.
 *
 * So this walks the parsed documents instead, and reports the leaves that
 * differ, each named by its path. `server.port: 80 → 443` is the sentence the
 * text diff was trying to say.
 *
 * Arrays are aligned rather than indexed. Comparing `[0]` against `[0]` makes
 * an insertion at the front look like a rewrite of the whole list, which is the
 * same failure as the text diff one level up. `alignRows` over the elements'
 * canonical form fixes it, and an element that survived in a new position is
 * then recursed into rather than reported as a removal and an addition.
 *
 * Everything is bounded. A `package-lock.json` is hundreds of thousands of
 * leaves, and flattening it to discover that four versions moved is minutes of
 * main thread for an answer nobody is waiting for. Past the budget this
 * declines and says so, which sends the reviewer back to the raw diff with an
 * explanation rather than to a frozen tab.
 */

import { alignRows, pairRows } from './rows';
import { SYNTAX_NAMES, type StructuredSyntax, parseStructured } from './syntax';

export interface JsonLimits {
  /** Leaves flattened per side. */
  maxNodes: number;
  /** Changes listed before the list is cut short. */
  maxChanges: number;
}

/**
 * Twenty thousand leaves is a large configuration file and a small lockfile,
 * which is the line worth drawing: the mode is for documents a person wrote.
 */
export const JSON_LIMITS: JsonLimits = { maxNodes: 20_000, maxChanges: 2000 };

export type JsonChangeType = 'added' | 'removed' | 'changed';

export interface JsonChange {
  /** The path through the document, as `a.b[0].c`. */
  path: string;
  type: JsonChangeType;
  /** The scalar, rendered as JSON. Null on the side it is absent from. */
  before: string | null;
  after: string | null;
}

export interface JsonComparison {
  status: 'ok' | 'unparseable' | 'too-large';
  changes: JsonChange[];
  /** The change list hit its cap. There are more than are shown. */
  truncated: boolean;
  /** Why there is no comparison. Null when there is one. */
  reason: string | null;
}

/** A key that can be written as `.name` rather than as `["name"]`. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const join = (parent: string, key: string): string =>
  IDENTIFIER.test(key)
    ? parent === ''
      ? key
      : `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;

/**
 * Every leaf of one side of a document, as path → rendered value.
 *
 * Used for the subtrees that exist on only one side — a whole added key, a
 * removed array element — and for a value whose two sides are not the same
 * shape. Where both sides are objects or both are arrays, `walkTogether` keeps
 * them in step instead.
 *
 * An empty object or array is itself a leaf, so a value that *became* `{}` is
 * reported as changing to `{}` rather than merely losing its children.
 *
 * Returns false when the budget is exhausted, so the caller can decline the
 * whole comparison rather than show a partial one that looks complete.
 */
function flatten(
  value: unknown,
  path: string,
  into: Map<string, string>,
  budget: { left: number },
): boolean {
  if (budget.left <= 0) return false;

  if (Array.isArray(value)) {
    if (value.length === 0) {
      budget.left -= 1;
      into.set(path === '' ? '[]' : path, '[]');
      return true;
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!flatten(value[index], `${path}[${index}]`, into, budget)) return false;
    }
    return true;
  }

  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      budget.left -= 1;
      into.set(path === '' ? '{}' : path, '{}');
      return true;
    }
    for (const key of keys) {
      const next = (value as Record<string, unknown>)[key];
      if (!flatten(next, join(path, key), into, budget)) return false;
    }
    return true;
  }

  budget.left -= 1;
  // `null` renders as `null` rather than vanishing: `{"a": null}` and `{}` are
  // different documents and have to compare as such.
  into.set(path, JSON.stringify(value) ?? 'undefined');
  return true;
}

/**
 * Line up two arrays before recursing into them.
 *
 * The elements' canonical JSON is the identity: two objects that stringify the
 * same are the same element, wherever they moved to. Anything that pairs is
 * recursed into so an in-place edit is reported as one changed leaf rather than
 * a whole element removed and a whole element added.
 *
 * This is the only place the two documents are walked together; everywhere else
 * they are flattened independently and their leaf maps compared. Arrays need
 * the joint walk precisely because their keys — indices — are not stable.
 */
function alignArrays(
  before: unknown,
  after: unknown,
  path: string,
  onto: { before: Map<string, string>; after: Map<string, string> },
  budget: { left: number },
): boolean {
  if (!Array.isArray(before) || !Array.isArray(after)) {
    return (
      flatten(before, path, onto.before, budget) && flatten(after, path, onto.after, budget)
    );
  }

  const canonical = (value: unknown): string => JSON.stringify(value) ?? 'undefined';
  const { ops } = alignRows(before.map(canonical), after.map(canonical));

  for (const pair of pairRows(ops)) {
    if (budget.left <= 0) return false;

    if (pair.kind === 'added') {
      if (!flatten(after[pair.newIndex], `${path}[${pair.newIndex}]`, onto.after, budget)) {
        return false;
      }
      continue;
    }
    if (pair.kind === 'removed') {
      if (!flatten(before[pair.oldIndex], `${path}[${pair.oldIndex}]`, onto.before, budget)) {
        return false;
      }
      continue;
    }

    // Equal and changed alike are recursed into under the *new* index, so the
    // two sides land on the same key and the leaf comparison can see them as a
    // pair. An element that only moved therefore reports nothing, which is the
    // point of aligning in the first place.
    //
    // Back through `walkTogether` rather than straight back here, because the
    // element is usually an object and a nested array inside it needs aligning
    // exactly as much as this one did.
    const at = `${path}[${pair.newIndex}]`;
    if (
      !walkTogether(before[pair.oldIndex], after[pair.newIndex], at, onto, budget)
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Walk two documents together, so arrays can be aligned at every depth.
 *
 * Objects are walked key by key rather than flattened wholesale for the same
 * reason: an array three levels down still needs its two sides in hand.
 */
function walkTogether(
  before: unknown,
  after: unknown,
  path: string,
  onto: { before: Map<string, string>; after: Map<string, string> },
  budget: { left: number },
): boolean {
  if (Array.isArray(before) && Array.isArray(after)) {
    return alignArrays(before, after, path, onto, budget);
  }

  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

  if (isObject(before) && isObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    if (keys.size === 0) {
      return (
        flatten(before, path, onto.before, budget) &&
        flatten(after, path, onto.after, budget)
      );
    }
    for (const key of keys) {
      const at = join(path, key);
      const hasBefore = Object.prototype.hasOwnProperty.call(before, key);
      const hasAfter = Object.prototype.hasOwnProperty.call(after, key);
      if (!hasBefore) {
        if (!flatten(after[key], at, onto.after, budget)) return false;
      } else if (!hasAfter) {
        if (!flatten(before[key], at, onto.before, budget)) return false;
      } else if (!walkTogether(before[key], after[key], at, onto, budget)) {
        return false;
      }
    }
    return true;
  }

  return (
    flatten(before, path, onto.before, budget) && flatten(after, path, onto.after, budget)
  );
}

// A missing side is an addition or a deletion, not a parse failure: there is
// no document to read and `undefined` is what the flattener expects.
const parseSide = (text: string | null, syntax: StructuredSyntax) =>
  text === null ? ({ ok: true, value: undefined } as const) : parseStructured(text, syntax);

/**
 * Compare two documents.
 *
 * `null` for a side means the file did not exist there — an addition or a
 * deletion — which is different from an empty document and is reported as
 * every leaf on the other side arriving or leaving.
 */
export function compareStructured(
  beforeText: string | null,
  afterText: string | null,
  syntax: StructuredSyntax,
  limits: JsonLimits = JSON_LIMITS,
): JsonComparison {
  const before = parseSide(beforeText, syntax);
  const after = parseSide(afterText, syntax);

  if (!before.ok || !after.ok) {
    const which = !before.ok && !after.ok ? 'Neither side' : !after.ok ? 'The new side' : 'The old side';
    // The parser's own words, because "not valid YAML" about a four-hundred
    // line manifest is a shrug. All three know where they gave up, and passing
    // that through is the difference between a reviewer fixing it and a
    // reviewer hunting for it.
    const detail = !after.ok ? after.detail : !before.ok ? before.detail : '';
    return {
      status: 'unparseable',
      changes: [],
      truncated: false,
      reason:
        `${which} of this file is not valid ${SYNTAX_NAMES[syntax]} — ` +
        `${detail}. Raw shows the change.`,
    };
  }

  const onto = { before: new Map<string, string>(), after: new Map<string, string>() };
  const budget = { left: limits.maxNodes };
  const complete =
    beforeText === null
      ? flatten(after.value, '', onto.after, budget)
      : afterText === null
        ? flatten(before.value, '', onto.before, budget)
        : walkTogether(before.value, after.value, '', onto, budget);

  if (!complete) {
    return {
      status: 'too-large',
      changes: [],
      truncated: true,
      reason:
        'This document has more values than the structural view will walk. ' +
        'The raw diff is the honest view of a file this size.',
    };
  }

  const changes: JsonChange[] = [];
  let truncated = false;

  const push = (change: JsonChange): void => {
    if (changes.length >= limits.maxChanges) {
      truncated = true;
      return;
    }
    changes.push(change);
  };

  // Removals and changes in old-document order, then additions in new-document
  // order. Reading order matters more than sorting here: a reviewer scanning
  // the list is looking for a key they know, and both documents' own orders are
  // the ones they know it from.
  for (const [path, value] of onto.before) {
    const now = onto.after.get(path);
    if (now === undefined) push({ path, type: 'removed', before: value, after: null });
    else if (now !== value) push({ path, type: 'changed', before: value, after: now });
  }
  for (const [path, value] of onto.after) {
    if (!onto.before.has(path)) {
      push({ path, type: 'added', before: null, after: value });
    }
  }

  return { status: 'ok', changes, truncated, reason: null };
}
