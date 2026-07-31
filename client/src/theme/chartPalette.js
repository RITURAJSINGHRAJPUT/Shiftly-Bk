/**
 * SOURCE OF TRUTH for Recharts series colours.
 *
 * Why JS and not CSS variables: Recharts maps `stroke`/`fill` props onto SVG
 * presentation *attributes*, where `var(--x)` does not resolve. A CSS-only
 * approach can repaint the marks (a CSS rule beats an attribute) but Recharts
 * also reads those prop values in JavaScript and forwards them into the legend
 * swatch and tooltip dot — which would then render the literal string
 * "var(--series-1)" and come out black.
 *
 * So: series colours live here, chart chrome (grid/axis/tick) is passed from
 * here too, and everything else (fonts, tooltip surface, legend text) is styled
 * in index.css where var() works normally.
 *
 * These values are mirrored as --series-1..8 in index.css for the
 * shift-calendar chips, which are plain CSS and not drawn by Recharts. Keep the
 * two lists in step.
 */
export const CHART_SERIES = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7', '#008300', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#22a022', '#e66767'],
};

export const CHART_CHROME = {
  light: { grid: '#e2e5ee', axis: '#cbd2e0', tick: '#64748b', surface: '#ffffff' },
  dark: { grid: '#262842', axis: '#363a58', tick: '#94a3b8', surface: '#16172c' },
};

/** Stable colour per department, so the donut and any legend agree. */
export const DEPARTMENT_COLORS = {
  light: { KITCHEN: '#eda100', SERVICE: '#2a78d6', HOUSEKEEPING: '#1baf7a' },
  dark: { KITCHEN: '#c98500', SERVICE: '#3987e5', HOUSEKEEPING: '#199e70' },
};

export const DEPARTMENT_LABELS = {
  KITCHEN: 'Kitchen',
  SERVICE: 'Service',
  HOUSEKEEPING: 'Housekeeping',
};

/** Shared tooltip styling. Inline styles, so var() *does* resolve. */
export const TOOLTIP_STYLE = {
  contentStyle: {
    background: 'var(--surface-raised)',
    border: '1px solid var(--line-default)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-md)',
    fontSize: 'var(--text-xs)',
    padding: '8px 10px',
  },
  labelStyle: { color: 'var(--ink-muted)', marginBottom: 4 },
  itemStyle: { color: 'var(--ink-base)', padding: 0 },
};
