import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'shiftly_theme';
const ThemeContext = createContext(null);

/** Keep the address-bar / task-switcher colour in step with the active theme. */
function syncThemeColorMeta(theme) {
  const color = theme === 'dark' ? '#0d0e1c' : '#f6f7fb';
  document.querySelectorAll('meta[name="theme-color"]').forEach((el) => {
    el.setAttribute('content', color);
  });
}

export function ThemeProvider({ children }) {
  // Initialise from the DOM, not from localStorage. The inline script in
  // index.html has already resolved the theme and stamped data-theme before
  // first paint; reading it back here guarantees React's first render agrees
  // with what the user is already looking at.
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || 'light'
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    syncThemeColorMeta(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Private browsing / storage disabled — the theme still applies for this
      // session, it just will not be remembered.
    }
  }, [theme]);

  const toggle = useCallback(
    () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    []
  );

  return (
    <ThemeContext.Provider value={{ theme, isDark: theme === 'dark', setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
