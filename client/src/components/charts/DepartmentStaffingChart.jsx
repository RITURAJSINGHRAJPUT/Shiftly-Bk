import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import useChart from '../../hooks/useChart';
import { DEPARTMENT_LABELS, TOOLTIP_STYLE } from '../../theme/chartPalette';

/**
 * Scheduled headcount by department, as a donut with the total in the centre.
 *
 * This is the honest version of the mockup's "AI Staffing Prediction" panel:
 * there is no forecasting engine, so it shows the shifts actually on the roster
 * for the day rather than a predicted requirement.
 */
export default function DepartmentStaffingChart({ byDepartment = [], total = 0 }) {
  const { departments, chrome } = useChart();

  if (total === 0) {
    return (
      <div className="empty-state" style={{ padding: 'var(--space-8) 0' }}>
        <p>No shifts scheduled for this day yet.</p>
      </div>
    );
  }

  const data = byDepartment.map((d) => ({
    name: DEPARTMENT_LABELS[d.department] || d.department,
    value: d.count,
    color: departments[d.department] || chrome.axis,
  }));

  return (
    <div className="grid-2" style={{ height: '100%', alignItems: 'center' }}>
      <div className="donut-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2}
              strokeWidth={2}
              stroke={chrome.surface}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(value, name) => [`${value} scheduled`, name]}
            />
          </PieChart>
        </ResponsiveContainer>

        <div className="donut-center">
          <span className="donut-center-label">Scheduled</span>
          <span className="donut-center-value">{total}</span>
        </div>
      </div>

      <div className="chart-legend">
        {data.map((d) => (
          <div key={d.name} className="chart-legend-row">
            <span className="chart-legend-swatch" style={{ background: d.color }} />
            <span>{d.name}</span>
            <span className="chart-legend-value">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
