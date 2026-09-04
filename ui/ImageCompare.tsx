/**
 * Comparing two images, four ways.
 *
 * The four are not variations on a theme; they answer different questions and
 * a reviewer moves between them within one file. Side by side says what the
 * image *is* now. Swipe says which regions were repainted. Onion skin catches a
 * shift of a few pixels that neither of the first two would show. Difference
 * turns everything unchanged black, so what remains is exactly what moved.
 *
 * Both images are `<img>` tags pointed at object URLs made from bytes the
 * worker fetched. That indirection is the whole security story: this page never
 * calls `fetch`, an `<img>` pointed at github.com would be a request from a
 * context that must not make one, and an SVG loaded through `<img>` is in the
 * mode that runs no script and resolves no external references — which is the
 * only safe way to render markup that arrived from a pull request.
 *
 * The three overlay modes need the two images in one coordinate space. They are
 * rarely the same size — that is often the change — so the box is the larger of
 * the two in each axis and each image is sized as a percentage of it, top-left
 * aligned, which is where a diffing tool has to anchor because it is the only
 * corner both images certainly share.
 *
 * Natural dimensions come from `onLoad`, so everything geometric here is
 * invisible to jsdom, which lays nothing out and reports every image as zero by
 * zero. The browser test is what checks this renders.
 */

import { useState } from 'react';
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

export function ImageCompare({ variant, path, before, after }: ImageCompareProps) {
  const [beforeSize, setBeforeSize] = useState<Measured | null>(null);
  const [afterSize, setAfterSize] = useState<Measured | null>(null);
  /** Where the swipe divider sits, and how much of the new image shows. */
  const [position, setPosition] = useState(50);

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
      <div className="image-stage" style={stage}>
        <img
          className="image-layer"
          src={before.url}
          alt={`${path} before this change`}
          style={scale(beforeSize)}
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
            // Swipe clips rather than fades, so the two halves stay at full
            // fidelity and the seam is exactly where the reviewer put it.
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

      {variant === 'difference' ? (
        <p className="image-hint">
          Anything identical in both versions is black. What you can see is what
          changed.
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
