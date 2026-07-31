import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import BrandLogo from '../components/BrandLogo';
import { KeyRound, Mail, AlertCircle, ArrowRight } from 'lucide-react';

/**
 * Demo accounts, with the script that creates each one.
 *
 * These are hardcoded and can therefore drift from the database — which is
 * exactly what happened when the staff wipe deleted the account this list used
 * to point at, leaving a button that failed with a bare "Invalid credentials".
 * `seededBy` is what turns that into a message that says how to fix it.
 */
const DEMO_USERS = [
  { role: 'Super Admin', email: 'superadmin@shiftly.com', password: 'admin123', seededBy: 'npm run seed' },
  { role: 'Admin', email: 'admin@shiftly.com', password: 'admin123', seededBy: 'npm run seed' },
  { role: 'HR', email: 'hr@shiftly.com', password: 'admin123', seededBy: 'npm run seed' },
  { role: 'Head Chef', email: 'chef@shiftly.com', password: 'admin123', seededBy: 'npm run managers' },
  { role: 'Master of House', email: 'moh@shiftly.com', password: 'admin123', seededBy: 'npm run managers' },
  { role: 'Kitchen Staff', email: 'kitchen1@capichep.shiftly.com', password: 'shiftly123', seededBy: 'npm run seed:staff' },
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('admin123'); // Default password for management
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(false);
  // Which demo account filled the form, so a failure can name its seed script.
  const [pickedDemo, setPickedDemo] = useState(null);
  const { login, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // An already-authenticated user has no business on the login screen.
  if (!authLoading && user) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setHint('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Failed to login');

      // A demo account that does not exist looks identical to a wrong password.
      // Say which script creates it rather than leaving that to be worked out.
      if (pickedDemo && pickedDemo.email === email) {
        setHint(
          `This demo account may not exist in your database yet. ` +
            `Create it with \`${pickedDemo.seededBy}\`.`
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = (demo) => {
    setEmail(demo.email);
    setPassword(demo.password);
    setPickedDemo(demo);
    setError('');
    setHint('');
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          {/* The wordmark replaces the old chip + <h1>Shiftly</h1> pair. It stays
              inside the h1 so the card keeps its heading, with alt carrying the
              text the heading used to hold. */}
          <h1>
            <BrandLogo variant="wordmark" />
          </h1>
          <p>CRM & Intelligent Shift Management</p>
        </div>

        {error && (
          <div className="login-error">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
            {hint && (
              <p className="login-hint">
                {hint.split('`').map((part, i) =>
                  i % 2 ? <code key={i}>{part}</code> : <span key={i}>{part}</span>
                )}
              </p>
            )}
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
            <div style={{ position: 'relative' }}>
              <KeyRound size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)' }} />
              <input
                type="password"
                className="form-input"
                style={{ paddingLeft: '40px' }}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <button type="submit" className="btn btn-primary w-full justify-between" disabled={loading}>
            <span>{loading ? 'Logging in...' : 'Sign In'}</span>
            <ArrowRight size={16} />
          </button>
        </form>

        <div className="demo-accounts">
          <h3>Quick Demo Login</h3>
          <div className="flex flex-col gap-2">
            {DEMO_USERS.map(demo => (
              <button
                key={demo.role}
                type="button"
                className="demo-btn"
                onClick={() => handleDemoLogin(demo)}
              >
                <span>{demo.role}</span>
                <span className="demo-role">{demo.email}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
