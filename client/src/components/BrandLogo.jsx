/**
 * Intrinsic image size, so the box is reserved before the bitmap decodes.
 * Generated alongside the image rather than written by hand — a stale value here
 * is a reflow on every page load that nothing would catch.
 */
import INTRINSIC from './brand-metrics.json';

/**
 * The Bookends Shiftly logo.
 *
 * One image, both tones. The artwork is a solid blue tile carrying a white mark,
 * so it brings its own background and reads correctly on the navy sidebar and on
 * a white card alike. The previous artwork was transparent dark lettering and
 * needed a lightness-inverted twin for dark surfaces; that pair is gone, and with
 * it the theme lookup this component used to do.
 *
 * The name is **text, not artwork**. The mark carries no lettering, and setting
 * the name live is what lets it read "Bookends Shiftly" — which a bitmap of the
 * old wordmark, saying only "SHIFTLY", never could. It also stays crisp at any
 * size and can be selected and translated.
 *
 * The image lives in `client/public/brand/`, served at `/brand/…`, and is
 * generated from `assets/image.png` — never edit it by hand.
 */

export const BRAND_NAME = 'Bookends Shiftly';

export default function BrandLogo({
  /** `mark` is the tile alone; `wordmark` is the tile beside the name. */
  variant = 'wordmark',
  /**
   * The surface behind this logo is dark whatever the theme — the sidebar is
   * navy in light mode too, so it cannot rely on the theme alone. Now that one
   * image serves both tones, this decides only the *text* colour.
   */
  onDark = false,
  /**
   * Defaults to the brand name. Pass "" where an ancestor already carries the
   * accessible name — a link with `aria-label`, or the sidebar's toggle button —
   * so screen readers do not announce it twice.
   */
  alt = BRAND_NAME,
  className = '',
}) {
  const mark = (
    <img
      src="/brand/mark.png"
      alt={variant === 'mark' ? alt : ''}
      className="brand-mark"
      {...INTRINSIC.mark}
      decoding="async"
      draggable={false}
    />
  );

  if (variant === 'mark') {
    return <span className={`brand-logo brand-logo--mark ${className}`.trim()}>{mark}</span>;
  }

  return (
    <span
      className={`brand-logo brand-logo--wordmark ${onDark ? 'is-on-dark' : ''} ${className}`.trim()}
    >
      {mark}
      {/* Hidden from screen readers when alt is empty: an ancestor is already
          naming this, and the visible text would otherwise be read twice. */}
      <span className="brand-name" aria-hidden={alt === '' ? 'true' : undefined}>
        {BRAND_NAME}
      </span>
    </span>
  );
}
