import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import BrandLogo, { BRAND_NAME } from '../components/BrandLogo';
import PasswordInput from '../components/PasswordInput';
import { KeyRound, AlertCircle, ArrowRight, ShieldCheck } from 'lucide-react';

/** Kept in step with MIN_PASSWORD_LENGTH in server/src/lib/passwords.js. */
const MIN_LENGTH = 10;

/**
 * Shown to an account still holding the one-time password it was created with.
 *
 * This is a courtesy, not the control: the server issues such accounts a token
 * scoped to the change-password route and refuses it everywhere else, so
 * skipping this screen gets you an app that 403s on every request rather than
 * one you have snuck into.
 */
export default function SetPasswordPage() {
  const { user, changePassword, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Checked here only to save a round trip; the server applies the real rule.
  const tooShort = newPassword.length > 0 && newPassword.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && newPassword !== confirm;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) return setError('The two passwords do not match');
    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      // No navigate: clearing the flag swaps this screen for the app.
    } catch (err) {
      setError(err.message || 'Could not set your password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-lockup">
        <div className="login-badge">
          <BrandLogo variant="mark" alt="" />
        </div>
        <h1>{BRAND_NAME}</h1>
      </div>

      <div className="login-card">
        <div className="login-heading">
          <h2>Choose Your Password</h2>
        </div>

        <div className="card card--alert-warn mb-4">
          <div className="flex items-start gap-2">
            <ShieldCheck size={18} className="icon-warn" style={{ flexShrink: 0, marginTop: 2 }} />
            <p className="text-sm">
              {user?.name ? <><strong>{user.name}</strong>, your</> : 'Your'} account was created with a
              one-time password. Choose your own to finish signing in — the temporary
              one stops working straight away.
            </p>
          </div>
        </div>

        {error && (
          <div className="login-error">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          </div>
        )}

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="form-group">
            <label className="form-label" htmlFor="current-password">Temporary password</label>
            <PasswordInput
              id="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="new-password">New password</label>
            <PasswordInput
              icon={KeyRound}
              id="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <p className="text-xs mt-1" style={{ color: tooShort ? 'var(--ink-crit)' : 'var(--ink-muted)' }}>
              At least {MIN_LENGTH} characters. A short phrase you will remember beats a
              short jumble you will not.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="confirm-password">Confirm new password</label>
            <PasswordInput
              id="confirm-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
            {mismatch && (
              <p className="text-xs mt-1" style={{ color: 'var(--ink-crit)' }}>
                These do not match yet.
              </p>
            )}
          </div>

          <button
            type="submit"
            className="btn btn-primary-soft w-full justify-between"
            disabled={saving || tooShort || mismatch || !currentPassword || !newPassword}
          >
            <span>{saving ? 'Saving…' : 'Set password and continue'}</span>
            <ArrowRight size={16} />
          </button>
        </form>

        <p className="login-footnote">
          Wrong account?{' '}
          <button type="button" className="btn-link" onClick={logout}>Sign out</button>
        </p>
      </div>
    </div>
  );
}
