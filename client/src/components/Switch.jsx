/**
 * Accessible on/off switch.
 *
 * A real <button role="switch"> rather than a styled checkbox, so it is
 * keyboard-operable and announces its state.
 */
export default function Switch({ checked, onChange, label, id }) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
    />
  );
}
