import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import Switch from '../../components/Switch';
import { LogOut, ShieldAlert, Award, Moon, MapPin, Building2 } from 'lucide-react';
import { ROLES } from '../../constants';

export default function MobileProfile() {
  const { user, logout } = useAuth();
  const { isDark, toggle } = useTheme();

  const initials =
    user?.name?.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">My Profile</h1>
          <p className="page-subtitle">Personal info, skills and preferences</p>
        </div>
      </div>

      <div className="card flex flex-col items-center text-center mb-4">
        <div
          className="user-avatar mb-4"
          style={{ width: '76px', height: '76px', fontSize: '1.75rem' }}
        >
          {initials}
        </div>
        <h2 className="font-bold text-lg text-strong">{user?.name}</h2>
        <p className="text-sm text-muted">{user?.email}</p>
        <div className="badge badge-primary mt-2">{ROLES[user?.role] || user?.role}</div>
      </div>

      <div className="card mb-4">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <Building2 size={17} className="icon-brand" />
            <h3 className="card-title">Assignment</h3>
          </div>
        </div>
        <div className="divided-list">
          <div className="flex items-center gap-2 text-sm">
            <MapPin size={14} className="icon-muted" />
            <span className="text-secondary">Outlet</span>
            <span className="font-semibold text-strong" style={{ marginLeft: 'auto' }}>
              {user?.outlet?.name || '—'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-secondary" style={{ paddingLeft: 22 }}>Brand</span>
            <span className="font-semibold text-strong" style={{ marginLeft: 'auto' }}>
              {user?.outlet?.brand?.name || '—'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-secondary" style={{ paddingLeft: 22 }}>Department</span>
            <span className="font-semibold text-strong" style={{ marginLeft: 'auto' }}>
              {user?.department || '—'}
            </span>
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <Award size={17} className="icon-brand" />
            <h3 className="card-title">Station Skills</h3>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {user?.skills?.map((skill) => (
            <span
              key={skill}
              className="badge badge-ghost text-xs"
              style={{ textTransform: 'capitalize' }}
            >
              {skill}
            </span>
          ))}
          {(!user?.skills || user.skills.length === 0) && (
            <span className="text-xs text-muted">No station skills registered</span>
          )}
        </div>
      </div>

      {/* The sidebar's Dark Mode toggle is hidden below the mobile breakpoint,
          so without this there is no way to change theme on a phone. */}
      <div className="card mb-4">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <Moon size={17} className="icon-brand" />
            <h3 className="card-title">Appearance</h3>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-secondary flex-1">Dark mode</span>
          <Switch checked={isDark} onChange={toggle} label="Dark mode" />
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <ShieldAlert size={17} className="icon-crit" />
            <h3 className="card-title">Account</h3>
          </div>
        </div>
        <button className="btn btn-danger w-full justify-center" onClick={logout}>
          <LogOut size={16} />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );
}
