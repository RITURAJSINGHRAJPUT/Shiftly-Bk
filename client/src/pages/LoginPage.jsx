import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import BrandLogo, { BRAND_NAME } from '../components/BrandLogo';
import PasswordInput from '../components/PasswordInput';
import { KeyRound, Mail, AlertCircle, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // An already-authenticated user has no business on the login screen.
  if (!authLoading && user) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // A first sign-in with a one-time password lands on the set-password
      // screen; App decides that from mustChangePassword, so both paths go here.
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Failed to login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-lockup">
        <div className="login-badge">
          <BrandLogo variant="mark" alt="" />
        </div>
        {/* Live text, not an image with alt, so it stays selectable/translatable. */}
        <h1>{BRAND_NAME}</h1>
      </div>

      <div className="login-card">
        <div className="login-heading">
          <h2>Welcome Back</h2>
          <p>Sign in to manage your shifts</p>
        </div>

        {error && (
          <div className="login-error">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)' }} />
              <input
                type="email"
                className="form-input"
                style={{ paddingLeft: '40px' }}
                placeholder="you@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <PasswordInput
              icon={KeyRound}
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn btn-primary-soft w-full justify-between" disabled={loading}>
            <span>{loading ? 'Logging in...' : 'Sign In'}</span>
            <ArrowRight size={16} />
          </button>
        </form>

        <p className="login-footnote">
          Accounts are created by your administrator. If you have not been given
          one, or have lost your password, ask them to issue a new one.
        </p>
      </div>
    </div>
  );
}
