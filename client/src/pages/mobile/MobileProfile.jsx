import { useAuth } from '../../contexts/AuthContext';
import { User, LogOut, ShieldAlert, Award } from 'lucide-react';

export default function MobileProfile() {
  const { user, logout } = useAuth();
  const initials = user?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">My Profile</h1>
          <p className="page-subtitle">Personal info, credentials, and settings</p>
        </div>
      </div>

      <div className="card flex flex-col items-center text-center mb-4">
        <div
          className="user-avatar"
          style={{ width: '80px', height: '80px', fontSize: '2rem', marginBottom: '16px', background: 'linear-gradient(135deg, var(--primary-500), var(--accent-500))' }}
        >
          {initials}
        </div>
        <h2 className="font-bold text-lg">{user?.name}</h2>
        <p className="text-sm text-secondary">{user?.email}</p>
        <div className="badge badge-primary mt-2">
          {user?.role?.replace(/_/g, ' ')}
        </div>
      </div>

      <div className="card mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Award size={18} style={{ color: 'var(--primary-400)' }} />
          <h3 className="font-semibold text-sm">Station Skills</h3>
        </div>
        <div className="flex gap-2 flex-wrap">
          {user?.skills?.map(skill => (
            <span key={skill} className="badge badge-ghost text-sm" style={{ textTransform: 'capitalize' }}>
              {skill}
            </span>
          ))}
          {(!user?.skills || user?.skills.length === 0) && (
            <span className="text-xs text-muted">No station skills registered</span>
          )}
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert size={18} style={{ color: 'var(--error-400)' }} />
          <h3 className="font-semibold text-sm">Account Operations</h3>
        </div>
        <button className="btn btn-danger w-full justify-center" onClick={logout}>
          <LogOut size={16} />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );
}
