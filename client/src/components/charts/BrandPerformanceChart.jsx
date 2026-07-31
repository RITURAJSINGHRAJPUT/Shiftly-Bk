import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import useChart from '../../hooks/useChart';
import { TOOLTIP_STYLE } from '../../theme/chartPalette';

/**
 * Attendance rate by brand — horizontal bars, one colour per brand.
 *
 * No legend: the category name is already the axis label, so a legend would
 * repeat it.
 */
export default function BrandPerformanceChart({ rows = [] }) {
  const { chrome, series: colors } = useChart();

  if (rows.length === 0) {
    return (
      <div className="empty-state" style={{ padding: 'var(--space-8) 0' }}>
        <p>No brand data available.</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={rows}
        layout="vertical"
        margin={{ top: 4, right: 40, bottom: 0, left: 4 }}
        barCategoryGap="30%"
      >
        <CartesianGrid horizontal={false} stroke={chrome.grid} />
        <XAxis
          type="number"
          domain={[0, 100]}
          ticks={[0, 50, 100]}
          axisLine={false}
          tickLine={false}
          tick={{ fill: chrome.tick, fontSize: 11 }}
          tickFormatter={(v) => `${v}%`}
        />
        <YAxis
          type="category"
          dataKey="brand"
          axisLine={false}
          tickLine={false}
          tick={{ fill: chrome.tick, fontSize: 11 }}
          width={72}
        />
        <Tooltip
          {...TOOLTIP_STYLE}
          formatter={(value, _n, entry) => [
            `${value}%  (${entry.payload.present}/${entry.payload.scheduled} shifts)`,
            'Attendance',
          ]}
          cursor={{ fill: 'var(--surface-sunken)' }}
        />
        <Bar dataKey="attendance" radius={[0, 4, 4, 0]} maxBarSize={18}>
          {rows.map((row, i) => (
            <Cell key={row.brand} fill={colors[i % colors.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
