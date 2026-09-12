import {
  LayoutDashboard, Building2, Store, Users, TreePalm,
  CalendarClock, Layers, BrainCircuit, ArrowLeftRight, BarChart3, LineChart,
  Settings, ScrollText, UserCog,
} from 'lucide-react';

/**
 * The app's navigation, in one place.
 *
 * Lives here rather than inside <Sidebar> because the phone needs the same
 * list: the sidebar is not rendered below the mobile breakpoint, so the bottom
 * tab bar's four destinations were the *only* reachable routes on a phone and
 * Employees, Outlets, Reports and Settings could not be opened at all. The
 * "More" list on the mobile profile reads from this, so a page added to the
 * sidebar reaches the phone too instead of being quietly desktop-only.
 */

/**
 * Dashboard sits above the groups with no header of its own — a collapsible
 * group wrapping a single item is a tap for no gain, and this is the one
 * destination that should never be hidden behind one.
 */
export const PRIMARY_ITEM = {
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
export const NAV_SECTIONS = [
  {
    title: 'Organisation',
    items: [
      { path: '/organizations', label: 'Organizations', icon: Building2, roles: ['SUPER_ADMIN', 'ADMIN'] },
      // Brands and outlets are one page: the outlet directory was already
      // grouped by brand, so a separate brand list was a flatter view of the
      // same tree. Brand writes stay ADMIN-only inside the page.
      { path: '/outlets', label: 'Brands & Outlets', icon: Store, roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'OUTLET_MANAGER'] },
    ],
  },
  {
    title: 'People',
    items: [
      { path: '/employees', label: 'Employees', icon: Users, roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'OUTLET_MANAGER'] },
      // Attendance page not in use currently — kept for possible future use.
      // { path: '/attendance', label: 'Attendance', icon: MapPin, roles: 'all' },
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
        roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'OUTLET_MANAGER', 'MASTER_OF_HOUSE', 'HEAD_CHEF'] },
      // Short labels: these rows also carry a "Soon" badge, which leaves roughly
      // 80px for text. The full names live on the destination pages in App.jsx.
      { path: '/workforce-planner', label: 'AI Planner', icon: BrainCircuit, roles: ['SUPER_ADMIN', 'ADMIN', 'HR'], stub: true },
      { path: '/transfers', label: 'Transfers', icon: ArrowLeftRight, roles: 'all' },
    ],
  },
  {
    title: 'Insights',
    items: [
      { path: '/reports', label: 'Reports', icon: BarChart3, roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'OUTLET_MANAGER', 'MASTER_OF_HOUSE'] },
      { path: '/analytics', label: 'Analytics', icon: LineChart, roles: ['SUPER_ADMIN', 'ADMIN', 'HR'], stub: true },
    ],
  },
  {
    title: 'System',
    items: [
      { path: '/settings', label: 'Settings', icon: Settings, roles: ['SUPER_ADMIN', 'ADMIN'] },
      { path: '/audit-logs', label: 'Audit Logs', icon: ScrollText, roles: ['SUPER_ADMIN', 'ADMIN'] },
      { path: '/user-management', label: 'Users', icon: UserCog, roles: ['SUPER_ADMIN'], stub: true },
    ],
  },
];

/** Shared by the sidebar and the phone's More list. */
export const canSeeNavItem = (item, role) =>
  item.roles === 'all' || item.roles.includes(role);

/**
 * The sections a role may see, with empty ones dropped so no header is left
 * standing over nothing.
 */
export function visibleSections(role) {
  return NAV_SECTIONS
    .map((section) => ({ ...section, items: section.items.filter((i) => canSeeNavItem(i, role)) }))
    .filter((section) => section.items.length > 0);
}
