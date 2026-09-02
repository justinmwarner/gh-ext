/**
 * The pull request description, as text.
 *
 * GitHub sends the body pre-rendered as `bodyHTML`. It is not injected here:
 * no `dangerouslySetInnerHTML`, no sanitizer dependency, no hand-rolled
 * allow-list. The markup is reduced to plain text and handed to React as a text
 * child, which escapes it — so nothing anybody can put in a description can
 * become a live element on this page.
 *
 * **Formatting is lost.** Headings, links, emphasis, tables and code fences all
 * come out as their words. That is the deliberate cost of not shipping a
 * renderer; the Overview links to GitHub for the formatted version.
 *
 * Two passes, and the order matters:
 *
 * 1. A string pass that deletes `<script>`/`<style>` bodies and turns block
 *    ends and `<br>` into newlines. `textContent` alone would run `<p>a</p>
 *    <p>b</p>` together into `ab`, and paragraph boundaries are most of what
 *    survives the reduction.
 * 2. `DOMParser`, purely to decode entities and drop tags. Parsing as
 *    `text/html` builds a document with no browsing context: scripts do not
 *    run, subresources are not fetched, and nothing is ever adopted into the
 *    live document — only its `textContent` is read.
 */

/** Bodies whose text is markup rather than prose. */
const DROPPED = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;

const LINE_BREAK = /<br\s*\/?>/gi;

/** Closing tags that end a visual block. Everything else is inline. */
const BLOCK_END =
  /<\/(p|div|li|ul|ol|h[1-6]|pre|blockquote|tr|table|section|article|details|summary)>/gi;

/** Three or more newlines is one blank line's worth of intent. */
const BLANK_RUN = /\n{3,}/g;

/**
 * The description as a list of paragraphs, ready to render one `<p>` each.
 *
 * Takes `unknown` because it is read straight off `PullRequestNode`, where
 * every field is `unknown` by design.
 */
export function htmlToParagraphs(html: unknown): string[] {
  if (typeof html !== 'string' || html.trim() === '') return [];

  const spaced = html
    .replace(DROPPED, '')
    .replace(LINE_BREAK, '\n')
    .replace(BLOCK_END, '\n')
    .replace(BLANK_RUN, '\n\n');

  const text = new DOMParser().parseFromString(spaced, 'text/html').body.textContent ?? '';

  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
