/**
 * Card shell for a chart: title, optional subtitle, a right-hand control slot
 * (usually a <Segmented>), and a fixed-height body.
 *
 * The explicit body height matters: Recharts' <ResponsiveContainer> measures its
 * parent, and an auto-height parent collapses it to zero. `min-width: 0` on the
 * same element stops the container fighting a flex parent for width.
 */
export default function ChartCard({
  title,
  subtitle,
  actions,
  height = 260,
  children,
  footer,
}) {
  return (
    <div className="card chart-card">
      <div className="card-header">
        <div>
          <h3 className="card-title">
            {title}
            {subtitle && <span className="card-subtitle"> ({subtitle})</span>}
          </h3>
        </div>
        {actions}
      </div>
      <div className="chart-card-body" style={{ height }}>
        {children}
      </div>
      {footer}
    </div>
  );
}
