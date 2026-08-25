import { NavLink } from 'react-router-dom';
import { LayoutDashboard, MapPin, CalendarClock, Inbox, User } from 'lucide-react';

/** Bottom tab bar, in the mockup's order. */
const MOBILE_TABS = [
  { path: '/', label: 'Home', icon: LayoutDashboard },
  // Attendance page not in use currently — kept for possible future use.
  // { path: '/attendance', label: 'Attendance', icon: MapPin },
  { path: '/shifts', label: 'Shifts', icon: CalendarClock },
  { path: '/leaves', label: 'Inbox', icon: Inbox },
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
