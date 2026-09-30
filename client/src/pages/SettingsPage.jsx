import { useState, useEffect } from 'react';
import api from '../api/client';
import Modal from '../components/Modal';
import PasswordInput from '../components/PasswordInput';
import { useAuth } from '../contexts/AuthContext';
import { Save, AlertTriangle, Trash2, KeyRound } from 'lucide-react';

/** Typed verbatim before the wipe will run. */
const WIPE_CONFIRMATION = 'DELETE SELECTED DATA';

/**
 * The tick boxes, in the order shown. Mirrors WIPE_ROLES in
 * server/src/routes/employee.routes.js, which is what enforces them — Super
 * Admin, Admin and HR are in none, and the caller is never deleted.
 */
const WIPE_CHOICES = [
  {
    key: 'staff', label: 'Staff', unit: 'account',
    hint: 'With their shifts, attendance, leave and notifications.',
  },
  {
    key: 'heads', label: 'Heads — Head Chefs and Masters of House', unit: 'account',
    hint: 'With their shifts, attendance, leave and notifications.',
  },
  {
    key: 'managers', label: 'Outlet Managers', unit: 'account',
    hint: 'With their shifts, attendance, leave and notifications.',
  },
  {
    key: 'shifts', label: 'All shifts', unit: 'shift',
    hint: 'Every shift at every restaurant, including completed ones, and the auto weekly offs. '
      + 'Shift patterns are kept, so Auto-Allocate can rebuild the roster.',
  },
];

const plural = (n, unit) => `${n.toLocaleString()} ${unit}${n === 1 ? '' : 's'}`;

export default function SettingsPage() {
  const { user, changePassword } = useAuth();

  // The sidebar lets ADMIN reach this page too, so the danger zone is gated
  // here rather than relying on navigation to keep them out. The server
  // enforces it independently with requireRole('SUPER_ADMIN').
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwDone, setPwDone] = useState(false);

  const submitPassword = async (e) => {
    e.preventDefault();
    setPwError('');
    setPwDone(false);
    setPwSaving(true);
    try {
      await changePassword(pwCurrent, pwNew);
      setPwCurrent(''); setPwNew(''); setPwConfirm('');
      setPwDone(true);
    } catch (err) {
      setPwError(err.message || 'Could not change your password');
    } finally {
      setPwSaving(false);
    }
  };

  // What is ticked, what that would delete, and how big each box is — kept
  // apart from the preview so the sizes stay shown with nothing ticked.
  const [include, setInclude] = useState(['staff']);
  const [preview, setPreview] = useState(null);
  const [sizes, setSizes] = useState(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [wiping, setWiping] = useState(false);
  const [wipeError, setWipeError] = useState('');
  const [wipeResult, setWipeResult] = useState(null);

  useEffect(() => {
    if (!isSuperAdmin || include.length === 0) {
      setPreview(null);
      return undefined;
    }
    // Ticking quickly can land replies out of order; only the latest counts.
    let stale = false;
    api.get(`/employees/stats/wipe-preview?include=${include.join(',')}`)
      .then((p) => { if (!stale) { setPreview(p); setSizes(p.byChoice); } })
      .catch(() => { if (!stale) setPreview(null); });
    return () => { stale = true; };
  }, [isSuperAdmin, include, previewKey]);

  const toggleChoice = (key) => {
    setWipeResult(null);
    setInclude((prev) => WIPE_CHOICES
      .map((c) => c.key)
      .filter((k) => (k === key ? !prev.includes(k) : prev.includes(k))));
  };

  const deletesSomething = !!preview
    && (preview.employees + preview.shifts + preview.attendance + preview.leaves + preview.notifications) > 0;

  /** "42 accounts and 1,456 shifts" — what the button and dialog promise. */
  const wipeSummary = preview
    ? `${plural(preview.employees, 'account')} and ${plural(preview.shifts, 'shift')}`
    : '';

  const handleWipe = async () => {
    setWiping(true);
    setWipeError('');
    try {
      const res = await api.post('/employees/wipe-staff', { confirm: WIPE_CONFIRMATION, include });
      setWipeResult(res);
      setWipeOpen(false);
      setTyped('');
      setPreviewKey((k) => k + 1);
    } catch (err) {
      setWipeError(err.message || 'Failed to delete the selected data');
    } finally {
      setWiping(false);
    }
  };

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">System Settings</h1>
          <p className="page-subtitle">Your password and system preferences</p>
        </div>
      </div>

      <div className="card mb-4" data-section="password">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <KeyRound size={18} className="icon-brand" />
            <h3 className="card-title">Your Password</h3>
          </div>
        </div>

        {pwDone && (
          <p className="text-sm mb-3" style={{ color: 'var(--ink-good)' }}>
            Password changed. It applies the next time you sign in anywhere else.
          </p>
        )}
        {pwError && <div className="login-error mb-3">{pwError}</div>}

        <form onSubmit={submitPassword} className="flex flex-col gap-3" style={{ maxWidth: 420 }}>
          <div className="form-group">
            <label className="form-label" htmlFor="pw-current">Current password</label>
            <PasswordInput
              id="pw-current"
              value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)}
              autoComplete="current-password" required
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="pw-new">New password</label>
            <PasswordInput
              id="pw-new"
              value={pwNew} onChange={(e) => setPwNew(e.target.value)}
              autoComplete="new-password" required
            />
            <p className="text-xs text-muted mt-1">At least 10 characters.</p>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="pw-confirm">Confirm new password</label>
            <PasswordInput
              id="pw-confirm"
              value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)}
              autoComplete="new-password" required
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ marginRight: 'auto' }}
            disabled={pwSaving || !pwCurrent || pwNew.length < 10 || pwNew !== pwConfirm}
          >
            <Save size={16} />
            <span>{pwSaving ? 'Changing…' : 'Change password'}</span>
          </button>
        </form>
      </div>

      {isSuperAdmin && (
        <div className="card card--alert-crit">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="icon-crit" />
              <h3 className="card-title">Danger Zone</h3>
            </div>
          </div>

          <p className="text-sm text-secondary mb-3">
            Permanently delete what you tick below, from every restaurant.
            Super Admin, Admin and HR accounts are never deleted, and neither is
            yours, so you can always sign in and enrol people again.
          </p>

          <div className="flex flex-col gap-3 mb-3">
            {WIPE_CHOICES.map((c) => (
              <label key={c.key} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={include.includes(c.key)}
                  onChange={() => toggleChoice(c.key)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <strong>{c.label}</strong>
                  {sizes && <span className="text-muted"> · {plural(sizes[c.key] ?? 0, c.unit)}</span>}
                  <span className="text-xs text-muted" style={{ display: 'block' }}>{c.hint}</span>
                </span>
              </label>
            ))}
          </div>

          {include.includes('heads') && (
            <div className="card card--alert-warn mb-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="icon-warn" />
                <p className="text-xs" style={{ color: 'var(--ink-warn)' }}>
                  Every restaurant will be left without the people who approve its
                  leave and overtime, run its roster and send staff to ODC — until
                  you enrol new heads.
                </p>
              </div>
            </div>
          )}

          {preview && (
            <div className="divided-list mb-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-secondary">Will be deleted</span>
                <span className="font-semibold text-strong" style={{ marginLeft: 'auto' }}>
                  {plural(preview.employees, 'account')} · {plural(preview.shifts, 'shift')} ·{' '}
                  {preview.attendance.toLocaleString()} attendance · {preview.leaves.toLocaleString()} leave ·{' '}
                  {plural(preview.notifications, 'notification')}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-secondary">Will be kept</span>
                <span className="font-semibold text-strong" style={{ marginLeft: 'auto' }}>
                  {plural(preview.keeping, 'account')}, including yours
                </span>
              </div>
            </div>
          )}

          {wipeResult && (
            <p className="text-sm mb-3" style={{ color: 'var(--ink-good)' }}>
              Deleted {plural(wipeResult.employees, 'account')}, {plural(wipeResult.shifts, 'shift')},{' '}
              {wipeResult.attendance.toLocaleString()} attendance records,{' '}
              {wipeResult.leaves.toLocaleString()} leave records and {plural(wipeResult.notifications, 'notification')}.
            </p>
          )}

          <button
            className="btn btn-danger"
            onClick={() => { setWipeOpen(true); setWipeError(''); setWipeResult(null); }}
            disabled={!deletesSomething}
          >
            <Trash2 size={16} />
            <span>
              {include.length === 0 ? 'Tick what to delete'
                : preview && !deletesSomething ? 'Nothing to delete'
                  : 'Delete selected'}
            </span>
          </button>
        </div>
      )}

      <Modal
        isOpen={wipeOpen}
        onClose={() => { setWipeOpen(false); setTyped(''); setWipeError(''); }}
        title="Delete selected data"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-secondary">
            This removes <strong>{wipeSummary}</strong> from every restaurant
            {preview ? `, with ${preview.attendance.toLocaleString()} attendance records, `
              + `${preview.leaves.toLocaleString()} leave records and ${plural(preview.notifications, 'notification')}` : ''}.
            It cannot be undone.
          </p>
          <ul className="text-sm" style={{ margin: 0, paddingLeft: 'var(--space-5)' }}>
            {WIPE_CHOICES.filter((c) => include.includes(c.key)).map((c) => (
              <li key={c.key}>{c.label}</li>
            ))}
          </ul>

          <div className="form-group">
            <label className="form-label" htmlFor="wipe-confirm">
              Type <code>{WIPE_CONFIRMATION}</code> to continue
            </label>
            <input
              id="wipe-confirm"
              className="form-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={WIPE_CONFIRMATION}
              autoComplete="off"
            />
          </div>

          {wipeError && (
            <p className="text-sm" style={{ color: 'var(--ink-crit)' }}>{wipeError}</p>
          )}

          <div className="flex gap-2" style={{ marginLeft: 'auto' }}>
            <button
              className="btn btn-ghost"
              onClick={() => { setWipeOpen(false); setTyped(''); }}
              disabled={wiping}
            >
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={handleWipe}
              disabled={typed !== WIPE_CONFIRMATION || wiping}
            >
              {wiping ? 'Deleting…' : `Delete ${wipeSummary}`}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
