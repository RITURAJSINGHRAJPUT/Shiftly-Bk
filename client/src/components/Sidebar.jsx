import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard, Users, CalendarClock, MapPin, TreePalm,
  BarChart3, Settings, LogOut, ChevronLeft, ChevronRight
} from 'lucide-react';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, roles: 'all' },
  { path: '/employees', label: 'Employees', icon: Users, roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
  { path: '/shifts', label: 'Shifts', icon: CalendarClock, roles: 'all' },
  { path: '/attendance', label: 'Attendance', icon: MapPin, roles: 'all' },
  { path: '/leaves', label: 'Leaves', icon: TreePalm, roles: 'all' },
  { path: '/reports', label: 'Reports', icon: BarChart3, roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'MASTER_OF_HOUSE'] },
  { path: '/settings', label: 'Settings', icon: Settings, roles: ['SUPER_ADMIN', 'ADMIN'] },
];

export default function Sidebar({ collapsed, onToggle }) {
  const { user, logout } = useAuth();
  const location = useLocation();

  const visibleItems = NAV_ITEMS.filter(item =>
    item.roles === 'all' || item.roles.includes(user?.role)
  );

  const initials = user?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  const roleLabel = user?.role?.replace(/_/g, ' ') || '';

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-logo">
        <div className="logo-icon">S</div>
        <span className="logo-text">Shiftly</span>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-title">Main Menu</div>
        {visibleItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <item.icon className="nav-icon" size={20} />
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user" onClick={logout} title="Click to logout">
          <div className="user-avatar">{initials}</div>
          <div className="user-info">
            <div className="user-name">{user?.name}</div>
            <div className="user-role">{roleLabel}</div>
          </div>
          <LogOut size={16} style={{ marginLeft: 'auto', opacity: 0.5, flexShrink: 0 }} />
        </div>
      </div>
    </aside>
  );
}
