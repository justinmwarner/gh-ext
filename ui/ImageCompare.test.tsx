/**
 * The image comparison's geometry, before anything has decoded.
 *
 * Everything visual here needs a browser, and the browser tests cover that.
 * What this file pins is the one thing that goes wrong without a layout engine
 * ever being involved: whether the stage knows how big it is *before* the
 * image loads.
 *
 * It did not, and the consequence was a scroll bug. The layers are absolutely
 * positioned so the overlay modes can share one coordinate space, so the stage
 * contributes no height of its own — it stayed zero pixels tall until `onLoad`
 * fired, then inflated by the full height of the image, after the card was
 * already on screen. In a virtualized column that reads as the scroll sticking
 * and bouncing.
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImageCompare } from './ImageCompare';
import type { LoadedImage } from './fileSides';

const image = (size: LoadedImage['size']): LoadedImage => ({
  url: 'blob:test',
  byteLength: 1024,
  size,
});

const stage = (container: HTMLElement) =>
  container.querySelector('.image-stage') as HTMLElement;

function mount(before: LoadedImage | null, after: LoadedImage | null) {
  return render(
    <ImageCompare variant="onion" path="assets/logo.png" before={before} after={after} />,
  );
}

describe('the stage, before anything has loaded', () => {
  it('reserves the image’s own shape from the header', () => {
    // No load event has fired. The aspect ratio has to be there anyway.
    const { container } = mount(
      image({ width: 1600, height: 1200 }),
      image({ width: 1600, height: 1200 }),
    );

    expect(stage(container).style.aspectRatio).toBe('1600 / 1200');
    expect(stage(container).getAttribute('data-sized')).toBe('true');
  });

  it('takes the larger of the two sides, which is the box both fit in', () => {
    const { container } = mount(
      image({ width: 200, height: 120 }),
      image({ width: 320, height: 180 }),
    );

    expect(stage(container).style.aspectRatio).toBe('320 / 180');
  });

  it('says it is unsized when the header could not be read', () => {
    // AVIF, ICO, anything `imageSize` declines. The stylesheet reserves a
    // default box off this attribute rather than leaving the card at zero.
    const { container } = mount(image(null), image(null));

    expect(stage(container).getAttribute('data-sized')).toBe('false');
    expect(stage(container).style.aspectRatio).toBe('');
  });

  it('sizes from whichever side it could read', () => {
    // An added or deleted file only has one side at all, and a pair of formats
    // where only one is recognised behaves the same way. The known side is a
    // far better box than the default, and the other one corrects it on load.
    const { container } = mount(image({ width: 200, height: 120 }), image(null));

    expect(stage(container).style.aspectRatio).toBe('200 / 120');
  });
});

describe('the plates, which are what side by side draws', () => {
  const plates = (before: LoadedImage | null, after: LoadedImage | null) =>
    render(
      <ImageCompare
        variant="side-by-side"
        path="assets/logo.png"
        before={before}
        after={after}
      />,
    ).container.querySelectorAll('img.image-plate-img');

  it('gives the browser the dimensions to reserve a box with', () => {
    // This is the default view and so the one most often scrolled past. An
    // `<img>` with no width and height reserves nothing: it is zero tall until
    // it decodes and then jumps to full height, which is the whole bug.
    const [before] = plates(image({ width: 1600, height: 1200 }), image(null));

    expect(before?.getAttribute('width')).toBe('1600');
    expect(before?.getAttribute('height')).toBe('1200');
  });

  it('leaves them off when the header could not be read', () => {
    // Half a pair is worse than none: a width without a height makes the
    // browser reserve a box of the wrong shape rather than no box.
    const [before] = plates(image(null), image(null));

    expect(before?.hasAttribute('width')).toBe(false);
    expect(before?.hasAttribute('height')).toBe(false);
  });
});
