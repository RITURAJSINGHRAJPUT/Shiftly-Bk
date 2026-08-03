import { useState, useMemo, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import BrandLogo from './BrandLogo';
import {
  LayoutDashboard, Building2, Store, Users, MapPin, TreePalm,
  CalendarClock, Layers, BrainCircuit, ArrowLeftRight, BarChart3, LineChart,
  Settings, ScrollText, UserCog, Moon, Sun, ChevronRight,
} from 'lucide-react';

/**
 * Dashboard sits above the groups with no header of its own — a collapsible
 * group wrapping a single item is a tap for no gain, and this is the one
 * destination that should never be hidden behind one.
 */
const PRIMARY_ITEM = {
  path: '/',
  label: 'Dashboard',
  icon: LayoutDashboard,
  roles: 'all',
};

/**
 * Collapsible nav groups.
 *
 * `roles: 'all'` means every signed-in role; otherwise the item is filtered to
 * the listed roles so the sidebar never offers something the API will refuse.
 *
 * `stub: true` marks a feature with no backing data yet. Those still render —
 * the mockup shows all fifteen — but they route to a page that states plainly
 * that the feature is not built, rather than to a dead link or a blank screen.
 */
const NAV_SECTIONS = [
  {
    title: 'Organisation',
    items: [
      { path: '/organizations', label: 'Organizations', icon: Building2, roles: ['SUPER_ADMIN', 'ADMIN'] },
      // Brands and outlets are one page: the outlet directory was already
      // grouped by brand, so a separate brand list was a flatter view of the
      // same tree. Brand writes stay ADMIN-only inside the page.
      { path: '/outlets', label: 'Brands & Outlets', icon: Store, roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
    ],
  },
  {
    title: 'People',
    items: [
      { path: '/employees', label: 'Employees', icon: Users, roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
      { path: '/attendance', label: 'Attendance', icon: MapPin, roles: 'all' },
      { path: '/leaves', label: 'Leaves', icon: TreePalm, roles: 'all' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { path: '/shifts', label: 'Shift Planning', icon: CalendarClock, roles: 'all' },
      // Everyone except STAFF, mirroring the API's requireMinRole('HEAD_CHEF') —
      // the sidebar should never offer a page whose every write returns 403.
      { path: '/shift-master', label: 'Shift Master', icon: Layers,
        roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'MASTER_OF_HOUSE', 'HEAD_CHEF'] },
      // Short labels: these rows also carry a "Soon" badge, which leaves roughly
      // 80px for text. The full names live on the destination pages in App.jsx.
      { path: '/workforce-planner', label: 'AI Planner', icon: BrainCircuit, roles: ['SUPER_ADMIN', 'ADMIN', 'HR'], stub: true },
      { path: '/transfers', label: 'Transfers', icon: ArrowLeftRight, roles: ['SUPER_ADMIN', 'ADMIN', 'HR'], stub: true },
    ],
  },
  {
    title: 'Insights',
    items: [
      { path: '/reports', label: 'Reports', icon: BarChart3, roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'MASTER_OF_HOUSE'] },
      { path: '/analytics', label: 'Analytics', icon: LineChart, roles: ['SUPER_ADMIN', 'ADMIN', 'HR'], stub: true },
    ],
  },
  {
    title: 'System',
    items: [
      { path: '/settings', label: 'Settings', icon: Settings, roles: ['SUPER_ADMIN', 'ADMIN'] },
      { path: '/audit-logs', label: 'Audit Logs', icon: ScrollText, roles: ['SUPER_ADMIN'], stub: true },
      { path: '/user-management', label: 'Users', icon: UserCog, roles: ['SUPER_ADMIN'], stub: true },
    ],
  },
];

function NavItem({ item, collapsed }) {
  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      /* Always, not just in the rail: an expanded label can now ellipsise too,
         and the tooltip is the only way back to the full text. */
      title={item.label}
      className={({ isActive }) =>
        `nav-item ${isActive ? 'active' : ''} ${item.stub ? 'is-stub' : ''}`
      }
    >
      <item.icon className="nav-icon" size={20} />
      <span className="nav-label">{item.label}</span>
      {item.stub && <span className="nav-badge is-soon">Soon</span>}
    </NavLink>
  );
}

export default function Sidebar({ collapsed, onToggle }) {
  const { user } = useAuth();
  const { isDark, toggle } = useTheme();
  const { pathname } = useLocation();

  const canSee = useCallback(
    (item) => item.roles === 'all' || item.roles.includes(user?.role),
    [user?.role]
  );

  const sections = useMemo(
    () =>
      NAV_SECTIONS
        .map((section) => ({ ...section, items: section.items.filter(canSee) }))
        .filter((section) => section.items.length > 0),
    [canSee]
  );

  /**
   * Title of the group that owns the current route, if any.
   *
   * This marks the group's header rather than expanding it — the sidebar starts
   * with everything closed, so without a marker there would be nothing at all
   * to show which part of the app you are in after a reload.
   */
  const activeGroup = useMemo(
    () => sections.find((s) => s.items.some((i) => i.path === pathname))?.title ?? null,
    [sections, pathname]
  );

  /**
   * Which group is expanded, or null for none.
   *
   * Session-only and starting at null, so every load begins fully closed.
   * Nothing reopens a group behind the user's back: no persisted value, no
   * first-group fallback, and no auto-expand on navigation.
   */
  const [openGroup, setOpenGroup] = useState(null);

  // One value, so "one open at a time" falls out of the data shape rather than
  // out of logic that has to remember to close the siblings.
  const toggleGroup = (title) =>
    setOpenGroup((prev) => (prev === title ? null : title));

  /* In the 72px rail there is no room for headers or labels, so grouping is
     dropped entirely and every permitted item becomes an icon with a tooltip.
     A separate branch rather than CSS gymnastics over the accordion markup. */
  const railItems = collapsed
    ? [PRIMARY_ITEM, ...sections.flatMap((s) => s.items)]
    : [];

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Expanded, the wordmark is the whole logo — it already opens on a large
          fork-S, so a separate S chip beside it just said the same thing twice.
          The 72px rail has no room for the wordmark, so there the mark stands in
          and keeps the tap-to-expand target. Either way the top bar's hamburger
          toggles the sidebar too. */}
      <div className="sidebar-logo">
        {collapsed ? (
          <button
            type="button"
            className="logo-icon"
            onClick={onToggle}
            aria-label="Expand sidebar"
            aria-expanded={false}
            title="Expand sidebar"
          >
            {/* alt="" — the button's aria-label is the accessible name here. */}
            <BrandLogo variant="mark" onDark alt="" />
          </button>
        ) : (
          <button
            type="button"
            className="logo-brand"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            aria-expanded
            title="Collapse sidebar"
          >
            {/* onDark unconditionally: the sidebar is navy in light mode too. */}
            <BrandLogo variant="wordmark" onDark className="logo-text" />
            <span className="logo-tagline">Staffing &amp; Scheduling</span>
          </button>
        )}
      </div>

      <nav className="sidebar-nav">
        {collapsed ? (
          railItems.map((item) => (
            <NavItem key={item.path} item={item} collapsed />
          ))
        ) : (
          <>
            <NavItem item={PRIMARY_ITEM} collapsed={false} />

            {sections.map((section) => {
              const isOpen = openGroup === section.title;
              const panelId = `nav-group-${section.title.toLowerCase()}`;

              return (
                <div className="nav-group" key={section.title}>
                  <button
                    type="button"
                    className="nav-group-toggle"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    data-has-active={activeGroup === section.title}
                    onClick={() => toggleGroup(section.title)}
                  >
                    <span>{section.title}</span>
                    {/* Before the chevron, which keeps margin-left:auto — so the
                        dot sits beside the title rather than drifting right.
                        The dot is decorative, so the same fact is given to
                        screen readers as text instead. */}
                    {activeGroup === section.title && (
                      <>
                        <span className="sr-only">(contains current page)</span>
                        <span className="nav-group-dot" aria-hidden="true" />
                      </>
                    )}
                    <ChevronRight size={14} className="nav-group-chevron" aria-hidden="true" />
                  </button>

                  {/* Conditionally rendered rather than hidden with CSS: a
                      height transition would need the grid 0fr→1fr trick or the
                      inert attribute to keep collapsed links out of the tab
                      order, both of which add failure modes for a 3-item list.
                      The rotating chevron carries the affordance. */}
                  {isOpen && (
                    <div className="nav-group-items" id={panelId} role="group">
                      {section.items.map((item) => (
                        <NavItem key={item.path} item={item} collapsed={false} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        {/* The whole row is the switch — one interactive element, so the label
            is clickable and the semantics stay valid. The span is decorative. */}
        <button
          type="button"
          className="theme-toggle"
          role="switch"
          aria-checked={isDark}
          aria-label="Dark mode"
          title={collapsed ? (isDark ? 'Switch to light mode' : 'Switch to dark mode') : undefined}
          onClick={toggle}
        >
          {/* The icon swaps so state stays readable in the collapsed rail, where
              the switch itself is hidden for want of room. */}
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
          <span className="theme-toggle-label">Dark Mode</span>
          <span className="switch" aria-hidden="true" data-checked={isDark} />
        </button>
      </div>
    </aside>
  );
}
