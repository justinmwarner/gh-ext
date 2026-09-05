/**
 * Comparing two images, four ways.
 *
 * The four are not variations on a theme; they answer different questions and
 * a reviewer moves between them within one file. Side by side says what the
 * image *is* now. Swipe says which regions were repainted. Onion skin catches a
 * shift of a few pixels that neither of the first two would show. Difference
 * turns everything unchanged black, so what remains is exactly what moved.
 *
 * Difference is *painted in one colour*, which it did not used to be.
 * `mix-blend-mode: difference` is per channel, so a red pixel that became blue
 * came out magenta and a green one that became blue came out cyan — colours
 * that look like information and carry none. The only thing the mode has to
 * say is "this pixel is not the same in both versions", and one colour says it
 * once. An SVG filter over the blended result sums the three channels into an
 * intensity, lifts the low end so a change of a few units is visible rather
 * than merely present, and ramps that from black to the red this page uses for
 * a deletion everywhere else.
 *
 * Both images are `<img>` tags pointed at object URLs made from bytes the
 * worker fetched. That indirection is the whole security story: this page never
 * calls `fetch`, an `<img>` pointed at github.com would be a request from a
 * context that must not make one, and an SVG loaded through `<img>` is in the
 * mode that runs no script and resolves no external references — which is the
 * only safe way to render markup that arrived from a pull request.
 *
 * The two sliding modes act on **both** layers, not just the top one. Fading
 * the new image in over the old, or clipping only the new one, looks correct
 * for opaque images — the top layer eventually covers the bottom, so nobody
 * notices the bottom is still there. Give either side an alpha channel and the
 * old version shows through at every setting including the last, and a swipe
 * reveals the new image composited *over* the old rather than instead of it.
 * So onion cross-fades and swipe clips complementary halves.
 *
 * The three overlay modes need the two images in one coordinate space. They are
 * rarely the same size — that is often the change — so the box is the larger of
 * the two in each axis and each image is sized as a percentage of it, top-left
 * aligned, which is where a diffing tool has to anchor because it is the only
 * corner both images certainly share.
 *
 * Dimensions come from the file's header, read the moment the bytes arrive,
 * and `onLoad` only corrects them. That order matters more than it looks: the
 * layers are absolutely positioned so they can share one coordinate space,
 * which means the stage has no height of its own — waiting for the browser to
 * decode left every image card **zero pixels tall until it was already on
 * screen**, and then inflating by the full height of the image. Underneath a
 * reviewer scrolling through a virtualized column that reads as the scroll
 * sticking and bouncing.
 *
 * `onLoad` stays as the correction and as the answer for formats the header
 * reader does not know. It is also invisible to jsdom, which lays nothing out
 * and reports every image as zero by zero; the browser test is what checks
 * this renders.
 */

import { useId, useState } from 'react';
import type { LoadedImage } from './fileSides';

export type ImageVariant = 'side-by-side' | 'swipe' | 'onion' | 'difference';

interface Measured {
  width: number;
  height: number;
}

export interface ImageCompareProps {
  variant: ImageVariant;
  path: string;
  before: LoadedImage | null;
  after: LoadedImage | null;
}

const kb = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024).toLocaleString()} KB`;

const dimensions = (size: Measured | null): string =>
  size === null ? '' : `${size.width} × ${size.height}`;

/** One image, with whatever is known about it underneath. */
function Plate({
  label,
  image,
  size,
  onMeasure,
  alt,
}: {
  label: string;
  image: LoadedImage | null;
  size: Measured | null;
  onMeasure: (size: Measured) => void;
  alt: string;
}) {
  return (
    <figure className="image-plate">
      <figcaption className="image-caption">
        <span className="image-side">{label}</span>
        {image === null ? (
          <span className="image-absent">none</span>
        ) : (
          <span className="image-facts">
            {dimensions(size)}
            {size !== null && ' · '}
            {kb(image.byteLength)}
          </span>
        )}
      </figcaption>
      {image === null ? (
        <div className="image-empty">This version of the file does not exist.</div>
      ) : (
        <img
          className="image-plate-img"
          src={image.url}
          alt={alt}
          // The attributes, not just the CSS. With `max-width: 100%` and
          // `height: auto` beside them the browser reserves the right box from
          // the header before a single byte is decoded — which is the whole
          // difference between a card that is the right size on its first paint
          // and one that grows once it is already on screen.
          width={size?.width}
          height={size?.height}
          onLoad={(event) =>
            onMeasure({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
        />
      )}
    </figure>
  );
}

/**
 * What turns a channel-wise blend into one colour.
 *
 * Three steps over the already-blended result. The first sums red, green and
 * blue into a single intensity, so "differs in any channel" becomes one
 * number and the magenta-and-cyan artefacts of a raw difference blend go away.
 * The second lifts the low end — a four-unit change is a real change and at
 * 4/255 it is invisible — and the third ramps that intensity from black to the
 * red this page uses for a deletion everywhere else.
 *
 * `sRGB` rather than the default `linearRGB`: the input is already sRGB pixels
 * and converting them twice would change which differences read as large.
 *
 * Rendered per card with an id of its own rather than once for the page: a
 * `filter: url(#…)` that does not resolve makes the element **not render at
 * all**, so a shared definition living somewhere else is a blank card waiting
 * to happen.
 */
function DifferenceFilter({ id }: { id: string }) {
  return (
    <svg className="image-filter" aria-hidden="true" focusable="false">
      <filter id={id} colorInterpolationFilters="sRGB">
        <feColorMatrix
          type="matrix"
          values="1 1 1 0 0
                  1 1 1 0 0
                  1 1 1 0 0
                  0 0 0 0 1"
        />
        <feComponentTransfer>
          <feFuncR type="gamma" exponent={0.45} />
          <feFuncG type="gamma" exponent={0.45} />
          <feFuncB type="gamma" exponent={0.45} />
        </feComponentTransfer>
        <feColorMatrix
          type="matrix"
          values="0.973 0 0 0 0
                  0.318 0 0 0 0
                  0.286 0 0 0 0
                  0     0 0 0 1"
        />
      </filter>
    </svg>
  );
}

export function ImageCompare({ variant, path, before, after }: ImageCompareProps) {
  // What the browser eventually reported, which is authoritative but late.
  const [beforeLoaded, setBeforeSize] = useState<Measured | null>(null);
  const [afterLoaded, setAfterSize] = useState<Measured | null>(null);

  // The header's answer until then, so the stage is the right size on its very
  // first paint rather than growing once the bytes have decoded.
  const beforeSize = beforeLoaded ?? before?.size ?? null;
  const afterSize = afterLoaded ?? after?.size ?? null;
  /** Where the swipe divider sits, and how much of the new image shows. */
  const [position, setPosition] = useState(50);
  // Per card. Two images in one pull request are two cards on one page, and a
  // shared id means the second card quietly uses the first card's filter.
  // React's ids contain colons, which a CSS `url(#…)` fragment cannot carry.
  const filterId = `image-difference-${useId().replaceAll(':', '')}`;

  if (variant === 'side-by-side' || before === null || after === null) {
    return (
      <div className="image-compare" data-variant="side-by-side">
        <Plate
          label="Before"
          image={before}
          size={beforeSize}
          onMeasure={setBeforeSize}
          alt={`${path} before this change`}
        />
        <Plate
          label="After"
          image={after}
          size={afterSize}
          onMeasure={setAfterSize}
          alt={`${path} after this change`}
        />
      </div>
    );
  }

  // The box both images are drawn into. Zero until at least one has loaded,
  // which is also what jsdom reports forever — hence the fallback to letting
  // the images size themselves rather than to a zero-height box that would
  // render as nothing.
  const width = Math.max(beforeSize?.width ?? 0, afterSize?.width ?? 0);
  const height = Math.max(beforeSize?.height ?? 0, afterSize?.height ?? 0);
  const measured = width > 0 && height > 0;

  const scale = (size: Measured | null): { width: string } | undefined =>
    measured && size !== null
      ? { width: `${(size.width / width) * 100}%` }
      : undefined;

  const stage = measured
    ? { maxWidth: `${width}px`, aspectRatio: `${width} / ${height}` }
    : undefined;

  return (
    <div className="image-compare" data-variant={variant}>
      {/* `data-sized` is what the stylesheet reads to reserve a default box.
          An AVIF or an ICO has no header reader here, so it arrives unsized and
          would otherwise be zero pixels tall until it decoded. */}
      <div className="image-stage" data-sized={measured} style={stage}>
        {/* The filter goes on this, not on the stage: it applies to everything
            the element draws, and the stage's 1px grey border summed to full
            intensity is a red box drawn around every difference view. */}
        <div
          className="image-canvas"
          style={variant === 'difference' ? { filter: `url(#${filterId})` } : undefined}
        >
          <img
            className="image-layer"
            src={before.url}
            alt={`${path} before this change`}
            style={{
              ...scale(beforeSize),
              // The old image has to get out of the way, not just be covered up.
              ...(variant === 'onion' ? { opacity: 1 - position / 100 } : {}),
              ...(variant === 'swipe'
                ? { clipPath: `inset(0 ${100 - position}% 0 0)` }
                : {}),
            }}
            onLoad={(event) =>
              setBeforeSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
          <img
            className="image-layer image-layer-top"
            src={after.url}
            alt={`${path} after this change`}
            style={{
              ...scale(afterSize),
              // Swipe clips rather than fades, so both halves stay at full
              // fidelity and the seam is exactly where the reviewer put it. The
              // other half of this inset is on the layer below.
              ...(variant === 'swipe'
                ? { clipPath: `inset(0 0 0 ${position}%)` }
                : {}),
              ...(variant === 'onion' ? { opacity: position / 100 } : {}),
            }}
            onLoad={(event) =>
              setAfterSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
        </div>
      </div>

      {variant === 'difference' && <DifferenceFilter id={filterId} />}

      {variant === 'difference' ? (
        <p className="image-hint">
          Anything identical in both versions is black. Everything that changed
          is picked out in red, however it changed.
        </p>
      ) : (
        // A range input rather than a draggable divider: it is the control the
        // browser already makes operable from the keyboard, and dragging a
        // divider inside a virtualized scroll region fights the scroller.
        <label className="image-slider">
          <span>{variant === 'swipe' ? 'Reveal' : 'Blend'}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={position}
            aria-label={
              variant === 'swipe'
                ? `How much of the new ${path} to reveal`
                : `How much of the new ${path} to fade in`
            }
            onChange={(event) => setPosition(Number(event.target.value))}
          />
          <output>{position}%</output>
        </label>
      )}
    </div>
  );
}
