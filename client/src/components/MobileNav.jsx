import { NavLink } from 'react-router-dom';
import { LayoutDashboard, CalendarClock, MapPin, TreePalm, User } from 'lucide-react';

const MOBILE_TABS = [
  { path: '/', label: 'Home', icon: LayoutDashboard },
  { path: '/shifts', label: 'Shifts', icon: CalendarClock },
  { path: '/attendance', label: 'Check In', icon: MapPin },
  { path: '/leaves', label: 'Leave', icon: TreePalm },
  { path: '/profile', label: 'Profile', icon: User },
];

export default function MobileNav() {
  return (
    <nav className="mobile-nav">
      {MOBILE_TABS.map(tab => (
        <NavLink
          key={tab.path}
          to={tab.path}
          end={tab.path === '/'}
          className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
        >
          <tab.icon className="nav-icon" size={22} />
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
