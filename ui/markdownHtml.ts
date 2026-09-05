/**
 * The last thing that happens to a rendered Markdown diff before the DOM.
 *
 * `lib/compare/markdown.ts` renders two versions of a `.md` file and marks the
 * difference between them. What comes back is HTML that a pull request wrote,
 * and a pull request can be opened by anyone. This page is an extension origin
 * holding a GitHub token in `chrome.storage.local`, so the difference between
 * "a rendered preview" and "an attacker running script with the token" is this
 * file and nothing else.
 *
 * **Why the sanitiser is here and not upstream.** Two reasons that happen to
 * agree, which is what makes the seam trustworthy rather than convenient.
 *
 * The security reason: sanitisation must be the *last* transformation before
 * insertion. Cleaning each side before diffing would look tidier and would be
 * unsound — the word diff afterwards splices `<ins>` and `<del>` into the token
 * stream at positions it chooses, which is new markup assembled out of markup
 * that had already been declared safe, with nothing left to check the join.
 *
 * The structural reason: DOMPurify parses into a real `Document`, so it needs a
 * DOM, and `lib/` is pure by contract — it names no DOM and runs in the `node`
 * half of the test suite. The boundary the project already had is the boundary
 * this feature needed.
 *
 * The allow-list below is DOMPurify's, narrowed. Every narrowing is a specific
 * capability this page must not hand to a `.md` file, and each is spelled out
 * where it is made, because a future reader loosening one to fix a rendering
 * complaint should have to read what it was for.
 */

import DOMPurify from 'dompurify';

/**
 * Elements removed on top of DOMPurify's defaults.
 *
 * `img` — an `<img src>` is a network request that needs no script. A `.md`
 * file in a pull request could point one at a server it controls and learn who
 * opened the review, when, and from which address, from inside this origin. The
 * renderer in `lib/` already turns Markdown images into text; this covers the
 * raw `<img>` tags that never pass through a renderer at all, which is the half
 * that matters. It also means the "never fetch" rule holds for this feature the
 * same way it holds for the rest of the page.
 *
 * The form controls — a rendered README has no use for an input box, and this
 * page is the one place on the internet where "your session expired, paste your
 * token" would look completely at home.
 *
 * `style` is the one entry here that does no work today: it is already outside
 * DOMPurify's default allow-list, and deleting this line changes nothing that
 * any test can see. It is kept because the reason it must stay out is specific
 * to this page and not obvious — the card body is light DOM rather than a
 * shadow root, so a `<style>` element from a pull request is a stylesheet for
 * the whole application, which is enough to hide the real controls and paint
 * convincing replacements over them with no script involved. Anyone who later
 * reaches for `ADD_TAGS` should have to delete this line first. `iframe`,
 * `object` and `embed` are excluded on the same default and are *not* listed,
 * because unlike `style` they have tests of their own above and nobody is
 * tempted to allow them.
 */
const FORBIDDEN_TAGS = [
  'img',
  'style',
  'form',
  'input',
  'textarea',
  'select',
  'option',
  'button',
];

/**
 * Attributes removed on top of DOMPurify's defaults.
 *
 * `style` — the same overlay attack as the `<style>` element, one element at a
 * time. DOMPurify does sanitise CSS, but `position: fixed` is not a CSS
 * injection, it is CSS working correctly.
 *
 * `id` — this page calls `document.getElementById` (`ViewSwitcher`, to move
 * focus between the view tabs). Content that can mint an id can decide where a
 * keystroke lands. DOMPurify's `SANITIZE_DOM` already blocks the ids that
 * clobber `document` properties; this covers the ones that merely collide with
 * ours.
 */
const FORBIDDEN_ATTRIBUTES = ['style', 'id'];

const PURIFY_CONFIG = {
  /**
   * HTML only — no SVG, no MathML.
   *
   * DOMPurify allows all three by default, and that default is wrong here.
   * §3.3 of the comparison spec already settled this question for the SVG
   * comparison mode: markup from a pull request renders through `<img>`, where
   * it is a secure static document, and is never inlined into a page in this
   * origin. Inline SVG and MathML are also where most of the parser-confusion
   * bypasses live, because they switch the HTML tokeniser into a foreign
   * content mode with different nesting rules.
   *
   * Naming the profile is what turns them off. There is a test for each.
   */
  USE_PROFILES: { html: true },
  FORBID_TAGS: FORBIDDEN_TAGS,
  FORBID_ATTR: FORBIDDEN_ATTRIBUTES,
  /**
   * No `data-*`.
   *
   * This page finds things by data attribute and then acts on what it finds:
   * `DiffColumn` locates a thread with `querySelectorAll('[data-thread]')`, and
   * `Shell` locates a reply box with `querySelector('[data-reply-for="…"]')`
   * and casts the result to a textarea. Either of those pointed at an element a
   * pull request supplied is a bug with no script in it anywhere, and a
   * rendered README has no legitimate use for one.
   */
  ALLOW_DATA_ATTR: false,
};

/**
 * The URL schemes are deliberately DOMPurify's own and not narrowed.
 *
 * The obvious tightening — a hand-written regex allowing only `https:` and
 * `mailto:` — was considered and rejected. `ALLOWED_URI_REGEXP` has to accept
 * relative URLs too, and the clause that does that is subtle enough that
 * writing a second version of it is more likely to introduce a hole than to
 * close one. The shipped default already refuses `javascript:` and `data:` in
 * an `href`, including through entity and whitespace obfuscation, and it is the
 * expression the project's tests are written against upstream. There is a test
 * here for each of those shapes so that a future upgrade that loosened it would
 * be caught rather than assumed.
 */

/**
 * One rendered, marked-up Markdown document, safe to insert.
 *
 * Returns a string rather than a node because that is what
 * `dangerouslySetInnerHTML` takes, and going through a fragment would mean
 * re-serializing — which is one more parse-and-print round trip than the
 * security argument can afford, since every one of those is a chance for the
 * two parsers to disagree.
 */
export function sanitizeMarkdownHtml(unsafeHtml: string): string {
  return DOMPurify.sanitize(unsafeHtml, PURIFY_CONFIG);
}
