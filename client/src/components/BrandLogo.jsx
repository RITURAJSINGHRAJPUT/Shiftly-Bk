import { useTheme } from '../contexts/ThemeContext';
/**
 * Intrinsic image sizes, so each box is reserved before the bitmap decodes.
 * Generated alongside the images rather than written by hand — the wordmark's
 * aspect ratio moves whenever the artwork is redrawn (it went from 2.35:1 to
 * 3.26:1 on the last swap), and a stale pair here is a reflow on every load
 * that nothing would catch.
 */
import INTRINSIC from './brand-metrics.json';

/**
 * The Shiftly logo, in the tone that suits the surface behind it.
 *
 * The artwork is near-black navy with cream highlights: perfect on white, all
 * but invisible on the navy sidebar or a dark-mode card. `scripts/
 * build-brand-assets.py` derives a lightness-inverted copy of each asset for
 * those surfaces, and this component picks between them so no caller has to.
 *
 * Files live in `client/public/brand/`, served at `/brand/…`, and are generated
 * from `assets/newshiftly.png` — never edit them by hand.
 */

/** `light` here describes the artwork's own tone, i.e. the one for dark surfaces. */
const SOURCES = {
  wordmark: { dark: '/brand/wordmark.png', light: '/brand/wordmark-light.png' },
  mark: { dark: '/brand/mark.png', light: '/brand/mark-light.png' },
};

export default function BrandLogo({
  variant = 'wordmark',
  /**
   * The surface behind this logo is dark whatever the theme — the sidebar is
   * navy in light mode too, so it cannot rely on `isDark` alone.
   */
  onDark = false,
  /**
   * Defaults to the brand name. Pass "" where an ancestor already carries the
   * accessible name — a link with `aria-label`, or the sidebar's toggle button —
   * so screen readers do not announce "Shiftly" twice.
   */
  alt = 'Shiftly',
  className = '',
}) {
  // ThemeProvider seeds its state from `document.documentElement.dataset.theme`,
  // which the inline script in index.html stamps before first paint. So the very
  // first render already knows the theme and the logo never flashes in the wrong
  // tone the way a useEffect-based read would.
  const { isDark } = useTheme();
  const tone = onDark || isDark ? 'light' : 'dark';

  return (
    <img
      src={SOURCES[variant][tone]}
      alt={alt}
      className={`brand-logo brand-logo--${variant} ${className}`.trim()}
      {...INTRINSIC[variant]}
      decoding="async"
      draggable={false}
    />
  );
}
