/**
 * The three ways a reviewer writes the same tree.
 *
 * `lib/compare/structured.ts` never cared that its input was JSON. It walks a
 * tree of plain values and reports the leaves that moved, and JSON was only
 * ever the syntax that arrived. YAML and TOML are the same tree written
 * differently, and both suffer exactly the failure that made the structural
 * view worth building: reindent a block, promote a key to a table header,
 * reorder two entries, and every line changes while nothing does.
 *
 * So the parser is the seam, and it is the whole of the seam. Three syntaxes
 * in, one plain value out, and the walker downstream is untouched.
 *
 * Two properties matter more than the parsing:
 *
 * - **A parser that recovers must not be believed.** `jsonc-parser` is built
 *   for an editor, where reporting a value for a half-typed document is the
 *   right behaviour; handed `{ not json` it returns `{}` and a list of errors.
 *   Reading the value and ignoring the errors would tell a reviewer that every
 *   key in the file was deleted. The error list is authoritative here.
 * - **Formatting must not lose what it did not write.** The formatted view
 *   exists so that a pure reformatting shows as no change. A formatter that
 *   dropped comments would make a comment-only change show as no change too,
 *   which is not a smaller claim than the text diff's — it is a wrong one.
 *   JSON and YAML both have comment-preserving formatters and both are used.
 *   TOML does not, which is why TOML is not offered the mode at all.
 *
 * Pure, like everything under `lib/`. Bounded by its callers: the 1 MB text
 * cap decides what reaches a parser, and `JSON_LIMITS` decides how much of the
 * result is walked.
 */

import {
  type ParseError,
  applyEdits,
  format as formatJsonc,
  parse as parseJsonc,
} from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import { parseDocument as parseYamlDocument } from 'yaml';

/**
 * The syntaxes that answer to the structural walker.
 *
 * `json` means JSON as it is actually committed — with comments and trailing
 * commas — because `tsconfig.json` and everything under `.vscode/` are JSONC
 * wearing a `.json` extension, and a parser that refuses them is refusing the
 * most-edited configuration file in a TypeScript repository.
 */
export type StructuredSyntax = 'json' | 'yaml' | 'toml';

export type ParsedDocument =
  | { ok: true; value: unknown }
  /** What the parser said, for a message that names a line rather than shrugging. */
  | { ok: false; detail: string };

/** What each syntax is called in a sentence written for a person. */
export const SYNTAX_NAMES: Record<StructuredSyntax, string> = {
  json: 'JSON',
  yaml: 'YAML',
  toml: 'TOML',
};

/**
 * The syntaxes whose formatter keeps the comments.
 *
 * TOML is absent, and that absence is what removes the formatted mode from a
 * `.toml` file rather than shipping one that quietly deletes every `#` line.
 */
export const FORMATTABLE: readonly StructuredSyntax[] = ['json', 'yaml'];

/** Trailing commas are as ordinary as comments in the files this meets. */
const JSONC_OPTIONS = { allowTrailingComma: true, allowEmptyContent: false };

const firstLine = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0]?.trim() ?? 'the parser gave no reason';
};

export function parseStructured(text: string, syntax: StructuredSyntax): ParsedDocument {
  if (syntax === 'json') {
    const errors: ParseError[] = [];
    const value = parseJsonc(text, errors, JSONC_OPTIONS) as unknown;
    // The errors, not the value. See the note at the top: this parser recovers
    // on purpose and its recovery is indistinguishable from a real document.
    if (errors.length > 0) {
      const at = errors[0]?.offset ?? 0;
      return { ok: false, detail: `the parser stopped at character ${at}` };
    }
    return { ok: true, value };
  }

  try {
    if (syntax === 'toml') return { ok: true, value: parseToml(text) };

    // `parseDocument` rather than `parse`: it reports errors instead of only
    // throwing on the first one, and it is the same call the formatter makes.
    const doc = parseYamlDocument(text);
    const failure = doc.errors[0];
    if (failure !== undefined) return { ok: false, detail: firstLine(failure) };
    return { ok: true, value: doc.toJS() as unknown };
  } catch (error) {
    return { ok: false, detail: firstLine(error) };
  }
}

/**
 * The same document, indented the way this syntax indents.
 *
 * Whitespace only, and never a re-serialization from the parsed value: round
 * tripping through a plain object is what loses the comments, and for YAML it
 * would also lose anchors, block scalar style and quoting — all of which a
 * reviewer chose deliberately and none of which this mode was asked to change.
 *
 * `null` for a document that cannot be read, which is the same answer the
 * caller already handles for unparseable JSON.
 */
export function formatStructured(text: string, syntax: StructuredSyntax): string | null {
  const parsed = parseStructured(text, syntax);
  if (!parsed.ok) return null;

  if (syntax === 'json') {
    return applyEdits(text, formatJsonc(text, undefined, { tabSize: 2, insertSpaces: true }));
  }
  if (syntax === 'yaml') return parseYamlDocument(text).toString();
  // TOML has no comment-preserving formatter, so it is not offered the mode.
  // Reaching here means the mode list and this function have drifted apart.
  return null;
}
