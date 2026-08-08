import { useState, useEffect } from 'react';
import api from '../api/client';
import Modal from '../components/Modal';
import { useAuth } from '../contexts/AuthContext';
import { Save, AlertTriangle, Trash2, KeyRound } from 'lucide-react';

/** Typed verbatim before the wipe will run. */
const WIPE_CONFIRMATION = 'DELETE ALL STAFF';

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

  const [preview, setPreview] = useState(null);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [wiping, setWiping] = useState(false);
  const [wipeError, setWipeError] = useState('');
  const [wipeResult, setWipeResult] = useState(null);

  useEffect(() => {
    if (!isSuperAdmin) return;
    api.get('/employees/stats/wipe-preview').then(setPreview).catch(() => setPreview(null));
  }, [isSuperAdmin]);

  const handleWipe = async () => {
    setWiping(true);
    setWipeError('');
    try {
      const res = await api.post('/employees/wipe-staff', { confirm: WIPE_CONFIRMATION });
      setWipeResult(res);
      setWipeOpen(false);
      setTyped('');
      api.get('/employees/stats/wipe-preview').then(setPreview).catch(() => {});
    } catch (err) {
      setWipeError(err.message || 'Failed to delete staff data');
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
            <input
              id="pw-current" type="password" className="form-input"
              value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)}
              autoComplete="current-password" required
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="pw-new">New password</label>
            <input
              id="pw-new" type="password" className="form-input"
              value={pwNew} onChange={(e) => setPwNew(e.target.value)}
              autoComplete="new-password" required
            />
            <p className="text-xs text-muted mt-1">At least 10 characters.</p>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="pw-confirm">Confirm new password</label>
            <input
              id="pw-confirm" type="password" className="form-input"
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
            Permanently delete every staff account and the shifts, attendance,
            leave and notifications attached to them. Management accounts are
            kept, so all logins keep working and every outlet keeps its Master of
            House and Head Chef.
          </p>

          {preview && (
            <div className="divided-list mb-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-secondary">Will be deleted</span>
                <span className="font-semibold text-strong" style={{ marginLeft: 'auto' }}>
                  {preview.employees} staff · {preview.shifts} shifts ·{' '}
                  {preview.attendance} attendance · {preview.leaves} leave ·{' '}
                  {preview.notifications} notifications
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-secondary">Will be kept</span>
                <span className="font-semibold text-strong" style={{ marginLeft: 'auto' }}>
                  {preview.keeping} management accounts, including yours
                </span>
              </div>
            </div>
          )}

          {wipeResult && (
            <p className="text-sm mb-3" style={{ color: 'var(--ink-good)' }}>
              Deleted {wipeResult.employees} staff accounts and {wipeResult.shifts} shifts.
              Restore them with <code>npm run seed:staff</code> or <code>npm run seed</code>.
            </p>
          )}

          <button
            className="btn btn-danger"
            onClick={() => { setWipeOpen(true); setWipeError(''); setWipeResult(null); }}
            disabled={!preview || preview.employees === 0}
          >
            <Trash2 size={16} />
            <span>
              {preview?.employees === 0 ? 'No staff data to delete' : 'Delete all staff data'}
            </span>
          </button>
        </div>
      )}

      <Modal
        isOpen={wipeOpen}
        onClose={() => { setWipeOpen(false); setTyped(''); setWipeError(''); }}
        title="Delete all staff data"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-secondary">
            This removes <strong>{preview?.employees ?? 0} staff accounts</strong> and{' '}
            <strong>{preview?.shifts ?? 0} shifts</strong>. It cannot be undone.
          </p>

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
              {wiping ? 'Deleting…' : `Delete ${preview?.employees ?? 0} staff accounts`}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
