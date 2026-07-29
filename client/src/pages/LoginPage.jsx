import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { KeyRound, Mail, AlertCircle, ArrowRight } from 'lucide-react';

const DEMO_USERS = [
  { role: 'Super Admin', email: 'superadmin@shiftly.com', label: 'SA' },
  { role: 'Admin', email: 'admin@shiftly.com', label: 'AD' },
  { role: 'HR', email: 'hr@shiftly.com', label: 'HR' },
  { role: 'Head Chef', email: 'chef@shiftly.com', label: 'Chef' },
  { role: 'Master of House', email: 'moh@shiftly.com', label: 'MoH' },
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('admin123'); // Default password for management
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Failed to login');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = (demoEmail, isStaff = false) => {
    setEmail(demoEmail);
    setPassword(isStaff ? 'shiftly123' : 'admin123');
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="logo-icon">S</div>
          <h1>Shiftly</h1>
          <p>CRM & Intelligent Shift Management</p>
        </div>

        {error && (
          <div className="login-error flex items-center gap-2">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
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
              <KeyRound size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
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
                className="demo-btn"
                onClick={() => handleDemoLogin(demo.email)}
              >
                <span>{demo.role}</span>
                <span className="demo-role">{demo.email}</span>
              </button>
            ))}
            <button
              className="demo-btn"
              onClick={() => handleDemoLogin('pinky@capichepi.shiftly.com', true)}
            >
              <span>Kitchen Staff (Pinky)</span>
              <span className="demo-role" style={{ color: 'var(--accent-400)' }}>pinky@capichepi...</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
