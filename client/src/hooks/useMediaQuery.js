import { useState, useEffect } from 'react';

/**
 * Subscribe to a CSS media query.
 *
 * Uses matchMedia rather than reading window.innerWidth, so the value matches
 * the stylesheet's breakpoint exactly and updates on orientation change — the
 * previous innerWidth read happened once at mount and could go stale.
 */
export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);

    const onChange = (e) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
