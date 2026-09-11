/**
 * Drawing a Mermaid diagram, at the cost of one lazy chunk and nothing else.
 *
 * Mermaid is by a wide margin the largest thing this project depends on, and
 * "speed is the budget" is a product principle rather than a preference. So it
 * is never in the page's own bundle: the `import()` below is the only
 * reference to it anywhere, Vite splits it into its own chunk, and that chunk
 * is fetched from the extension's own package the first time a reviewer opens
 * a `.md` file with a diagram in it. A review that never touches one never
 * pays a byte. Mermaid then splits again internally, one chunk per diagram
 * type, so a flowchart does not load the Gantt renderer either.
 *
 * **The output goes into an `<img>`, not into the page.** That is the rule
 * `markdownHtml.ts` sets out at length: markup from a pull request — and a
 * diagram's source is exactly that — renders through `<img>`, where the
 * browser treats SVG as a secure static document that runs no script and
 * fetches nothing, and is never inlined into an origin holding a GitHub token.
 * §3.3 of the comparison spec made the same trade for `.svg` files. Inlining
 * Mermaid's output would be the first exception to it, for the sake of text
 * selection, which is not a good trade.
 *
 * A `data:` URL rather than a blob URL: no object to revoke, so a card that
 * scrolls out of view leaks nothing, and nothing crosses the network either
 * way.
 *
 * Two more settings are load-bearing:
 *
 * - `startOnLoad: false`. Mermaid's default is to scan the document and
 *   rewrite anything that looks like a diagram. On this page that would be a
 *   library reaching into a React tree it knows nothing about.
 * - `securityLevel: 'strict'`. Mermaid runs the labels through DOMPurify and
 *   refuses click bindings. Belt and braces given the `<img>` above, and the
 *   cheap half of the two.
 */

/**
 * The initialized renderer, loaded once.
 *
 * The promise is cached rather than the module, so ten diagrams on one card
 * share a single import and a single `initialize` instead of racing each
 * other. A failed load is cached too — see `render`, which turns it into a
 * refusal rather than letting it throw.
 */
let loading: Promise<typeof import('mermaid').default> | null = null;

/** Which palette to draw in, decided once per load. */
function themeName(): 'dark' | 'default' {
  return typeof matchMedia === 'function' &&
    matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'default';
}

function loadMermaid(): Promise<typeof import('mermaid').default> {
  if (loading === null) {
    loading = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: themeName(),
        // The page's own stack, so a diagram's labels do not arrive in a
        // typeface that appears nowhere else in the application.
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
      });
      return mermaid;
    });
  }
  return loading;
}

/** A diagram, drawn, or the reason there is no picture. */
export type MermaidResult =
  | { ok: true; svg: string; width: number | null; height: number | null }
  | { ok: false; reason: string };

/**
 * The intrinsic size Mermaid gave the drawing.
 *
 * An `<img>` needs one. Mermaid writes a `viewBox` on every diagram and a
 * `width`/`height` pair on most, and the `viewBox` is the reliable half —
 * `maxWidth: false` above leaves the others as absolute pixels rather than a
 * percentage, but "most" is not "all" and a missing size collapses the image
 * to nothing.
 */
function sizeOf(svg: string): { width: number | null; height: number | null } {
  const box = /viewBox="([\d.\-\s]+)"/.exec(svg);
  const parts = box?.[1]?.trim().split(/\s+/).map(Number) ?? [];
  const width = parts[2];
  const height = parts[3];
  return {
    width: typeof width === 'number' && Number.isFinite(width) ? width : null,
    height: typeof height === 'number' && Number.isFinite(height) ? height : null,
  };
}

/**
 * A unique element id for one render.
 *
 * Mermaid requires one and uses it inside the SVG — for clip paths, markers
 * and its own generated classes. Two diagrams sharing an id on the same page
 * would be two drawings referring to each other's definitions. Not derived
 * from the source, because the same diagram appearing twice is a thing a
 * document may legitimately do.
 */
let sequence = 0;

/**
 * Draw one diagram.
 *
 * Never throws and never rejects. Mermaid's parser reports a syntax error by
 * throwing, and a `.md` file in a pull request is perfectly entitled to
 * contain a diagram that does not parse — that is a thing to say in a sentence
 * under the source, not a reason for a card to disappear.
 *
 * It also leaves a detached element behind on a failed parse, which is
 * Mermaid's own documented advice to clean up.
 */
export async function renderMermaid(source: string): Promise<MermaidResult> {
  let mermaid: typeof import('mermaid').default;
  try {
    mermaid = await loadMermaid();
  } catch {
    // The chunk is in the extension's own package, so this is close to
    // unreachable — but a diagram that cannot be drawn must not take the
    // rendered document down with it.
    loading = null;
    return { ok: false, reason: 'The diagram renderer could not be loaded.' };
  }

  sequence += 1;
  const id = `md-mermaid-${sequence}`;

  try {
    const { svg } = await mermaid.render(id, source);
    return { ok: true, svg, ...sizeOf(svg) };
  } catch (error: unknown) {
    return {
      ok: false,
      reason: `This diagram could not be drawn: ${
        error instanceof Error ? error.message.split('\n')[0] : 'Mermaid refused it.'
      }`,
    };
  } finally {
    // `mermaid.render` leaves its scratch element in the document when the
    // parse throws. Left alone they accumulate, one per malformed diagram per
    // re-render.
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
}

/**
 * The drawing as something an `<img>` can load.
 *
 * Base64 rather than percent-encoding: an SVG is full of `#`, `<` and `"`,
 * every one of which has to be escaped in a `data:` URL, and getting that
 * wrong fails as a broken image rather than as an error. `encodeURIComponent`
 * plus `unescape` is the usual trick for the UTF-8 half and `unescape` is
 * long deprecated, so the bytes are taken through `TextEncoder` instead.
 */
export function svgDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}
