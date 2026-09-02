/**
 * Suggestion blocks, read and written.
 *
 * GitHub's suggestion is an ordinary fenced code block whose info string is the
 * word `suggestion`; the fence is the entire protocol. Writing one is
 * formatting. Reading one matters more: the proposed replacement is the point
 * of the comment, and left as literal fenced text it reads as punctuation
 * rather than as the change being asked for.
 *
 * Comment bodies are Markdown and are rendered here as plain text — this
 * project has no Markdown renderer and will not grow a dependency for one. The
 * suggestion fence is the single exception, because the difference between
 * "here is some text" and "here is the code I want instead" is not decoration.
 */

export type BodyPart =
  | { kind: 'text'; text: string }
  | { kind: 'suggestion'; code: string };

/** A fence long enough to survive whatever backticks the selection contains. */
function fenceFor(content: string): string {
  let longest = 0;
  for (const run of content.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * The selected lines, fenced as a suggestion.
 *
 * A trailing newline is included so that whatever the reviewer types next
 * starts on its own line rather than inside the closing fence.
 */
export function suggestionBlock(lines: readonly string[]): string {
  const content = lines.join('\n');
  const fence = fenceFor(content);
  return `${fence}suggestion\n${content}\n${fence}\n`;
}

const OPENING_FENCE = /^(`{3,})suggestion[ \t]*$/;

const closes = (line: string, fence: string): boolean =>
  new RegExp(`^\`{${fence.length},}[ \\t]*$`).test(line);

/**
 * A comment body split into prose and the suggestions embedded in it.
 *
 * Deliberately line-oriented rather than a Markdown parse: the only construct
 * that has to be recognized is the fence, and a real parser is a dependency
 * this project does not take. The known limit is that a `suggestion` fence
 * nested inside another fenced block is read as a suggestion; GitHub's own
 * renderer treats that case the same way often enough that it is not worth a
 * parser to improve on.
 */
export function splitBody(body: string): BodyPart[] {
  const lines = body.split('\n');
  const parts: BodyPart[] = [];
  let text: string[] = [];

  const flushText = (): void => {
    const joined = text.join('\n').trim();
    if (joined !== '') parts.push({ kind: 'text', text: joined });
    text = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const opening = OPENING_FENCE.exec(line);

    if (opening === null) {
      text.push(line);
      index += 1;
      continue;
    }

    const fence = opening[1] ?? '```';
    let end = index + 1;
    while (end < lines.length && !closes(lines[end] ?? '', fence)) end += 1;

    // An unterminated fence is not a suggestion — GitHub would not render it as
    // one either. Everything from here on is text.
    if (end >= lines.length) {
      text.push(...lines.slice(index));
      break;
    }

    flushText();
    parts.push({ kind: 'suggestion', code: lines.slice(index + 1, end).join('\n') });
    index = end + 1;
  }

  flushText();
  return parts;
}
