import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

/**
 * KPI tile: label + tinted icon square on top, large value, optional delta row.
 *
 * `tone` drives a data-tone attribute that CSS maps to the tint/ink pair, which
 * is what lets the icon square theme itself instead of carrying an inline
 * rgba() background at every call site.
 *
 * Pass `delta` only when there is a real figure to show. A tile with no
 * comparison data simply omits the row rather than displaying a fabricated one.
 */
export default function StatTile({
  label,
  value,
  icon: Icon,
  tone = 'brand',
  delta,
  deltaNote,
}) {
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta);
  const isUp = hasDelta && delta >= 0;

  return (
    <div className="stat-card" data-tone={tone}>
      <div className="stat-top">
        <div className="stat-label">{label}</div>
        {Icon && (
          <div className="stat-icon">
            <Icon size={16} />
          </div>
        )}
      </div>

      <div className="stat-value">{value}</div>

      {hasDelta && (
        <div className={`stat-change ${isUp ? 'positive' : 'negative'}`}>
          {isUp ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
          <span>{Math.abs(delta)}%</span>
          {deltaNote && <span className="stat-change-note">{deltaNote}</span>}
        </div>
      )}

      {!hasDelta && deltaNote && (
        <div className="stat-change">
          <span className="stat-change-note">{deltaNote}</span>
        </div>
      )}
    </div>
  );
}
