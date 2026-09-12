/**
 * Segmented period picker — "7 Days", "This Week", "By Attendance".
 *
 * options: [{ value, label, shortLabel? }]
 *
 * `shortLabel` is swapped in on narrow screens by CSS rather than by a
 * media-query hook, so the control can shrink without the page re-rendering
 * on resize. Options without one just show the same label at both sizes.
 */
export default function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`segmented-btn ${opt.value === value ? 'active' : ''}`}
          aria-pressed={opt.value === value}
          onClick={() => onChange(opt.value)}
        >
          <span className="segmented-label">{opt.label}</span>
          {opt.shortLabel && (
            <span className="segmented-label-short" aria-hidden="true">{opt.shortLabel}</span>
          )}
        </button>
      ))}
    </div>
  );
}
