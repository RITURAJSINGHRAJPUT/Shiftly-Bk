import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

/**
 * KPI tile: tinted icon chip on the left, label / value / note stacked beside
 * it.
 *
 * Icon-left rather than the icon-above-value it used to be, because the
 * stacked version spent its height on chrome — a 143px tile for a 32px
 * number — which two of these side by side on a phone cannot afford.
 *
 * `tone` drives a data-tone attribute that CSS maps to the tint/ink pair,
 * which is what lets the tint theme itself instead of carrying an inline
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
      {Icon && (
        <div className="stat-icon">
          <Icon size={18} />
        </div>
      )}

      <div className="stat-body">
        <div className="stat-label">{label}</div>
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
    </div>
  );
}
