import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useScope } from '../contexts/ScopeContext';
import { GLOBAL_SCOPE_ROLES } from '../constants';
import api from '../api/client';
import StatTile from '../components/StatTile';
import ChartCard from '../components/ChartCard';
import Segmented from '../components/Segmented';
import AttendanceTrendChart from '../components/charts/AttendanceTrendChart';
import BrandPerformanceChart from '../components/charts/BrandPerformanceChart';
import DepartmentStaffingChart from '../components/charts/DepartmentStaffingChart';
import Modal from '../components/Modal';
import {
  Users, Tags, Store, TrendingUp, CalendarDays, AlertTriangle,
  ArrowRight, MapPin, RefreshCw, Clock, Plus, Upload,
} from 'lucide-react';
import { format } from 'date-fns';

const TREND_RANGES = [
  { value: 7, label: '7 Days' },
  { value: 14, label: '14 Days' },
  { value: 30, label: '30 Days' },
];

function ManagementDashboard() {
  const { user } = useAuth();
  const { outlets } = useScope();

  // Mirrors Sidebar.jsx's role gating for the same destinations, so Quick
  // Actions never link to a page the sidebar itself would hide.
  const canManageEmployees = GLOBAL_SCOPE_ROLES.includes(user?.role);
  const canManageOutlets = GLOBAL_SCOPE_ROLES.includes(user?.role);
  const canViewReports = [...GLOBAL_SCOPE_ROLES, 'MASTER_OF_HOUSE'].includes(user?.role);

  const [stats, setStats] = useState(null);
  const [trend, setTrend] = useState(null);
  const [brandRows, setBrandRows] = useState([]);
  const [staffing, setStaffing] = useState(null);
  const [emergencies, setEmergencies] = useState([]);
  const [todayShifts, setTodayShifts] = useState([]);
  const [selectedOutlet, setSelectedOutlet] = useState(null);
  const [trendDays, setTrendDays] = useState(7);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      const [statsData, trendData, brandData, staffingData, emergencyData, shiftsData] = await Promise.all([
        api.get('/dashboard/stats'),
        api.get(`/dashboard/attendance-trend?days=${trendDays}`),
        api.get('/dashboard/brand-performance'),
        api.get('/dashboard/department-staffing'),
        api.get('/leaves/emergency/pending'),
        api.get(`/shifts?date=${today}`),
      ]);
      setStats(statsData);
      setTrend(trendData);
      setBrandRows(brandData);
      setStaffing(staffingData);
      setEmergencies(Array.isArray(emergencyData) ? emergencyData : []);
      setTodayShifts(Array.isArray(shiftsData) ? shiftsData : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [trendDays]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !stats) {
    return <div className="page-content text-center text-muted">Loading dashboard…</div>;
  }

  /**
   * What this dashboard covers.
   *
   * Role-aware rather than a flat "Across all outlets": the server pins every
   * role outside GLOBAL_SCOPE_ROLES to its own outlet, so that string would be
   * plainly wrong for a Master of House or Head Chef.
   */
  const scopeLabel = GLOBAL_SCOPE_ROLES.includes(user?.role)
    ? 'Across all outlets'
    : user?.outlet?.name || 'Your outlet';

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Welcome back, {user?.name}</h1>
          <p className="page-subtitle">{scopeLabel} · {format(new Date(), 'EEEE, d MMMM yyyy')}</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          <span>Reload</span>
        </button>
      </div>

      {emergencies.length > 0 && (
        <div className="card card--alert-crit mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <AlertTriangle size={22} className="icon-crit" />
            <div>
              <h3 className="font-bold text-sm" style={{ color: 'var(--ink-crit)' }}>
                Active emergency leave requests
              </h3>
              <p className="text-xs text-secondary">
                {emergencies.length} staff member{emergencies.length === 1 ? '' : 's'} awaiting shift
                cover.
              </p>
            </div>
            <Link to="/leaves" className="btn btn-danger btn-sm" style={{ marginLeft: 'auto' }}>
              Manage
            </Link>
          </div>
        </div>
      )}

      {/* Five tiles, not the mockup's seven: Transfer Requests and Labour Cost
          have no backing model or wage data, so they are omitted rather than
          filled with invented numbers. */}
      <div className="stats-grid stats-grid--kpi">
        <StatTile
          label="Total Employees"
          value={stats?.totalEmployees ?? 0}
          icon={Users}
          tone="brand"
          deltaNote="Active staff"
        />
        <StatTile
          label="Total Brands"
          value={stats?.totalBrands ?? 0}
          icon={Tags}
          tone="info"
          deltaNote={brandRows.map((b) => b.brand).join(', ') || '—'}
        />
        <StatTile
          label="Total Outlets"
          value={stats?.totalOutlets ?? 0}
          icon={Store}
          tone="brand"
          deltaNote="All active"
        />
        <StatTile
          label="Today's Attendance"
          value={`${stats?.attendanceRate ?? 0}%`}
          icon={TrendingUp}
          tone="good"
          deltaNote={`${stats?.todayAttendance ?? 0} of ${stats?.todayShifts ?? 0} shifts`}
        />
        <StatTile
          label="Shifts Today"
          value={stats?.todayShifts ?? 0}
          icon={CalendarDays}
          tone="warn"
          deltaNote={`${stats?.weekShifts ?? 0} this week`}
        />
        <StatTile
          label="Leave Requests"
          value={stats?.pendingLeaves ?? 0}
          icon={Clock}
          tone="crit"
          deltaNote="Pending approval"
        />
      </div>

      {outlets.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-4">
          {outlets.map((outlet) => {
            const count = todayShifts.filter((s) => s.outletId === outlet.id).length;
            return (
              <div
                key={outlet.id}
                className="card"
                style={{ cursor: 'pointer', flex: '1 1 200px', maxWidth: '300px' }}
                onClick={() => setSelectedOutlet(outlet.id)}
              >
                <div className="card-header">
                  <Store size={17} className="icon-brand" />
                  <h3 className="card-title" style={{ flex: 1 }}>{outlet.name}</h3>
                  <span className="badge badge-primary">{count}</span>
                </div>
                <div className="text-2xs text-muted" style={{ padding: '0 var(--card-pad) var(--card-pad)' }}>
                  {outlet.brand?.name || '—'}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={!!selectedOutlet}
        onClose={() => setSelectedOutlet(null)}
        title={`${outlets.find((o) => o.id === selectedOutlet)?.name || 'Outlet'} — Today's Shifts`}
      >
        {(() => {
          const shifts = todayShifts.filter((s) => s.outletId === selectedOutlet);
          if (shifts.length === 0) {
            return <div className="text-center text-muted py-4">No shifts today</div>;
          }
          const bySection = new Map();
          for (const s of shifts) {
            const key = `${s.section || s.employee?.department || 'Unassigned'}|${s.startTime}|${s.endTime}`;
            if (!bySection.has(key)) {
              bySection.set(key, {
                section: s.section || s.employee?.department || 'Unassigned',
                startTime: s.startTime,
                endTime: s.endTime,
                employees: [],
              });
            }
            bySection.get(key).employees.push(s.employee?.name || 'Unknown');
          }
          return (
            <div className="divided-list">
              {[...bySection.values()].map((g) => (
                <div key={`${g.section}-${g.startTime}-${g.endTime}`} className="py-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm text-strong">{g.section}</span>
                    <span className="text-2xs text-muted">{g.startTime} – {g.endTime}</span>
                    <span className="badge badge-ghost text-2xs">{g.employees.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {g.employees.map((name, i) => (
                      <span key={i} className="badge badge-ghost text-2xs">{name}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </Modal>

      <div className="grid-2 mb-4">
        <ChartCard
          title="Attendance Trend"
          actions={
            <Segmented
              options={TREND_RANGES}
              value={trendDays}
              onChange={setTrendDays}
              ariaLabel="Trend range"
            />
          }
        >
          <AttendanceTrendChart series={trend?.series || []} target={trend?.target ?? 95} />
        </ChartCard>

        <ChartCard title="Brand Performance" subtitle="attendance %, this week">
          <BrandPerformanceChart rows={brandRows} />
        </ChartCard>
      </div>

      <div className="grid-2">
        <ChartCard
          title="Department Staffing"
          subtitle={
            staffing?.date ? `scheduled ${format(new Date(staffing.date), 'EEE d MMM')}` : 'tomorrow'
          }
        >
          <DepartmentStaffingChart
            byDepartment={staffing?.byDepartment || []}
            total={staffing?.total || 0}
          />
        </ChartCard>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Quick Actions</h3>
          </div>
          <div className="flex flex-col gap-2">
            <Link to="/shifts" className="btn btn-primary w-full justify-between">
              <span>Run Auto-Allocation</span>
              <ArrowRight size={16} />
            </Link>
            {canManageEmployees && (
              <Link to="/employees" className="btn btn-info w-full justify-between">
                <span>Add Employee</span>
                <Plus size={16} />
              </Link>
            )}
            {canManageOutlets && (
              <Link to="/outlets" className="btn btn-accent w-full justify-between">
                <span>Manage Outlets</span>
                <Store size={16} />
              </Link>
            )}
            {/* Attendance page not in use currently — kept for possible future use. */}
            {/* <Link to="/attendance" className="btn btn-ghost w-full justify-between">
              <span>Attendance &amp; Geofences</span>
              <MapPin size={16} />
            </Link> */}
            {canViewReports && (
              <Link to="/reports" className="btn btn-ghost w-full justify-between">
                <span>View Reports</span>
                <Upload size={16} />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StaffDashboard() {
  const { user } = useAuth();
  const [upcomingShifts, setUpcomingShifts] = useState([]);
  const [attendanceToday, setAttendanceToday] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/shifts/my/upcoming'), api.get('/attendance/today')])
      .then(([shifts, attendance]) => {
        setUpcomingShifts(shifts);
        setAttendanceToday(attendance?.status === 'NOT_CHECKED_IN' ? null : attendance);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="page-content text-center text-muted">Loading…</div>;
  }

  const nextShift = upcomingShifts[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">{greeting}, {user?.name?.split(' ')[0]}</h1>
          <p className="page-subtitle">{user?.outlet?.name}</p>
        </div>
        <span className="badge badge-primary">{user?.department}</span>
      </div>

      <div className="flex flex-col gap-4">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Today's Shift</h3>
            <Clock size={16} className="icon-muted" />
          </div>
          {nextShift ? (
            <>
              <div className="text-lg font-bold">{nextShift.section || 'Unassigned'} Shift</div>
              <div className="text-sm text-secondary">
                {nextShift.startTime} – {nextShift.endTime}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted mt-1">
                <MapPin size={12} />
                <span>{nextShift.outlet?.name || user?.outlet?.name}</span>
              </div>
            </>
          ) : (
            <>
              <div className="text-lg font-bold">No shift scheduled</div>
              <p className="text-sm text-secondary">Check back later or contact your manager.</p>
            </>
          )}
          {/* Attendance page not in use currently — kept for possible future use. */}
          {/* <Link to="/attendance" className="btn btn-accent w-full justify-center mt-4">
            <MapPin size={16} />
            <span>{attendanceToday?.checkIn ? 'View Attendance' : 'Check In'}</span>
          </Link> */}
        </div>

        <div className="grid-2">
          <div className="card">
            <div className="stat-label">Attendance Status</div>
            <div className="stat-value" style={{ fontSize: 'var(--text-xl)' }}>
              {attendanceToday?.status?.replace(/_/g, ' ') || 'Not checked in'}
            </div>
          </div>
          <div className="card">
            <div className="stat-label">Upcoming Shifts</div>
            <div className="stat-value" style={{ fontSize: 'var(--text-xl)' }}>
              {upcomingShifts.length}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">My Upcoming Shifts</h3>
          </div>
          {upcomingShifts.length === 0 ? (
            <div className="empty-state py-4">
              <p>No upcoming shifts.</p>
            </div>
          ) : (
            <div className="divided-list">
              {upcomingShifts.map((s) => (
                <div key={s.id} className="flex justify-between items-center">
                  <div>
                    <div className="text-sm font-semibold text-strong">
                      {format(new Date(s.date), 'EEE, d MMM')}
                    </div>
                    <div className="text-xs text-muted">{s.section || 'Unassigned'}</div>
                  </div>
                  <span className="badge badge-primary">
                    {s.startTime} – {s.endTime}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { isAdmin, isManager } = useAuth();
  return isAdmin || isManager ? <ManagementDashboard /> : <StaffDashboard />;
}
