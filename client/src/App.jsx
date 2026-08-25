import { useState, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ScopeProvider } from './contexts/ScopeContext';
import useMediaQuery from './hooks/useMediaQuery';
import { MOBILE_BREAKPOINT, SIDEBAR_COLLAPSED_KEY } from './constants';

// Pages
import LoginPage from './pages/LoginPage';
import SetPasswordPage from './pages/SetPasswordPage';
import DashboardPage from './pages/DashboardPage';
import EmployeesPage from './pages/EmployeesPage';
import ShiftsPage from './pages/ShiftsPage';
import ShiftMasterPage from './pages/ShiftMasterPage';
// Attendance page not in use currently — kept for possible future use.
// import AttendancePage from './pages/AttendancePage';
import LeavesPage from './pages/LeavesPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import OrganizationsPage from './pages/OrganizationsPage';
import OutletsPage from './pages/OutletsPage';
import StubPage from './pages/StubPage';
import TransfersPage from './pages/TransfersPage';
import AuditLogsPage from './pages/AuditLogsPage';
import LandingPage from './pages/LandingPage';
import MobileProfile from './pages/mobile/MobileProfile';

// Components
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import MobileNav from './components/MobileNav';

function Layout() {
  const { user, loading, mustChangePassword } = useAuth();
  const { pathname } = useLocation();

  // Remembered, unlike the sidebar's open nav group. Wanting a narrow sidebar is
  // a durable preference; which group you last browsed is not, so that one
  // deliberately resets to closed on every load.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggleSidebar = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // Storage unavailable — the collapse still works for this session.
      }
      return next;
    });
  }, []);

  // matchMedia, not window.innerWidth: it matches the CSS breakpoint exactly and
  // updates on orientation change, which a one-time innerWidth read did not.
  const isMobile = useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT}px)`);

  // Wait for the /auth/me round-trip before deciding. Without this, `user` is
  // still null on a refresh and we redirect away from a valid session.
  if (loading) {
    return <div className="app-boot">Loading…</div>;
  }

  if (!user) {
    // The public root is the marketing page; any deeper path still goes to login.
    //
    // This lives here rather than as a separate <Route path="/"> because React
    // Router only resolves a descendant <Routes> when the parent path ends in a
    // splat — an exact "/" parent would leave Layout's own routes unmatched and
    // break the Dashboard. ScopeProvider above is unaffected: its effect starts
    // with `if (!user) return`, so no unauthenticated request fires.
    return pathname === '/' ? <LandingPage /> : <Navigate to="/login" replace />;
  }

  // Before the chrome, not as a route: this account's token is refused by every
  // ordinary endpoint, so rendering the app around it would only produce a
  // sidebar full of pages that 403.
  if (mustChangePassword) {
    return <SetPasswordPage />;
  }

  return (
    <div className="app-layout">
      {!isMobile && <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />}

      <div className={`main-content ${collapsed ? 'collapsed' : ''}`}>
        <Header collapsed={collapsed} onToggle={toggleSidebar} isMobile={isMobile} />
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/organizations" element={<OrganizationsPage />} />
          {/* Merged into the outlets page; kept so old links still land. */}
          <Route path="/brands" element={<Navigate to="/outlets" replace />} />
          <Route path="/outlets" element={<OutletsPage />} />
          <Route path="/employees" element={<EmployeesPage />} />
          {/* Attendance page not in use currently — kept for possible future use. */}
          {/* <Route path="/attendance" element={<AttendancePage />} /> */}
          <Route path="/leaves" element={<LeavesPage />} />
          <Route path="/shifts" element={<ShiftsPage />} />
          <Route path="/shift-master" element={<ShiftMasterPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/profile" element={<MobileProfile />} />

          {/* Designed in the mockup, no data behind them in this build. */}
          <Route
            path="/workforce-planner"
            element={
              <StubPage
                title="AI Workforce Planner"
                description="Forecast staffing demand and generate schedules"
                needs={[
                  'A demand-forecasting model over historical attendance and covers',
                  'Per-department target headcount configuration',
                  'Sales or footfall data to forecast against',
                ]}
              />
            }
          />
          <Route path="/transfers" element={<TransfersPage />} />
          <Route
            path="/analytics"
            element={
              <StubPage
                title="Analytics"
                description="Deeper trends across outlets, brands and departments"
                needs={[
                  'Labour cost data — no wage or hourly-rate field exists yet',
                  'A retained metrics history rather than live counts only',
                ]}
              />
            }
          />
          <Route path="/audit-logs" element={<AuditLogsPage />} />
          <Route
            path="/user-management"
            element={
              <StubPage
                title="User Management"
                description="Accounts, roles and permissions"
                needs={[
                  'Role assignment separated from the Employee record',
                  'Invitation and password-reset flows',
                ]}
              />
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>

      {isMobile && <MobileNav />}
    </div>
  );
}

export default function App() {
  return (
    // ThemeProvider outermost: the login screen and the boot screen both need
    // the theme, and it has no data dependencies.
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            {/* ScopeProvider sits inside the authenticated branch so the login
                page does not fire an unauthenticated /outlets request. */}
            <Route
              path="/*"
              element={
                <ScopeProvider>
                  <Layout />
                </ScopeProvider>
              }
            />
          </Routes>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}
