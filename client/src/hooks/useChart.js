import { useTheme } from '../contexts/ThemeContext';
import {
  CHART_SERIES,
  CHART_CHROME,
  DEPARTMENT_COLORS,
} from '../theme/chartPalette';

/**
 * Chart colours for the active theme.
 *
 * Because this derives from ThemeContext state, every chart re-renders when the
 * theme toggles — no getComputedStyle, no MutationObserver, no timing race.
 */
export default function useChart() {
  const { theme } = useTheme();
  const key = theme === 'dark' ? 'dark' : 'light';

  return {
    series: CHART_SERIES[key],
    chrome: CHART_CHROME[key],
    departments: DEPARTMENT_COLORS[key],
  };
}
