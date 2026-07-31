import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import useChart from '../../hooks/useChart';
import { TOOLTIP_STYLE } from '../../theme/chartPalette';

/**
 * Attendance rate over time against target.
 *
 * Target is a straight ReferenceLine rather than a second data series — it is a
 * constant, and drawing it as a line series implies it varies day to day.
 *
 * Days with nothing scheduled arrive as `attendance: null`; `connectNulls` is
 * left off so the line breaks there instead of implying 0% attendance on a day
 * with no shifts.
 */
export default function AttendanceTrendChart({ series = [], target = 95 }) {
  const { chrome, series: colors } = useChart();

  const data = series.map((d) => ({
    ...d,
    label: format(parseISO(d.date), 'd MMM'),
  }));

  const hasData = data.some((d) => d.attendance !== null);

  if (!hasData) {
    return (
      <div className="empty-state" style={{ padding: 'var(--space-8) 0' }}>
        <p>No shifts scheduled in this period.</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      {/* No negative left margin: it pulled the Y axis outside the plot area and
          clipped the leading digit off "25%" / "100%". */}
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={chrome.grid} />
        <XAxis
          dataKey="label"
          stroke={chrome.axis}
          tickLine={false}
          tick={{ fill: chrome.tick, fontSize: 11 }}
        />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          axisLine={false}
          tickLine={false}
          tick={{ fill: chrome.tick, fontSize: 11 }}
          tickFormatter={(v) => `${v}%`}
          width={48}
        />
        <Tooltip
          {...TOOLTIP_STYLE}
          formatter={(value, name) => [`${value}%`, name]}
          cursor={{ stroke: chrome.axis, strokeWidth: 1 }}
        />
        <Legend iconType="plainline" iconSize={14} wrapperStyle={{ fontSize: 11 }} />
        <ReferenceLine
          y={target}
          stroke={colors[2]}
          strokeDasharray="4 4"
          label={{
            value: `Target ${target}%`,
            position: 'insideTopRight',
            fill: chrome.tick,
            fontSize: 10,
          }}
        />
        <Line
          type="monotone"
          dataKey="attendance"
          name="Attendance %"
          stroke={colors[0]}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: chrome.surface }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
