import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useScope } from '../contexts/ScopeContext';
import api from '../api/client';
import StatTile from '../components/StatTile';
import ChartCard from '../components/ChartCard';
import Segmented from '../components/Segmented';
import AttendanceTrendChart from '../components/charts/AttendanceTrendChart';
import BrandPerformanceChart from '../components/charts/BrandPerformanceChart';
import DepartmentStaffingChart from '../components/charts/DepartmentStaffingChart';
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
  const { withScope, query } = useScope();

  const [stats, setStats] = useState(null);
  const [trend, setTrend] = useState(null);
  const [brandRows, setBrandRows] = useState([]);
  const [staffing, setStaffing] = useState(null);
  const [emergencies, setEmergencies] = useState([]);
  const [trendDays, setTrendDays] = useState(7);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsData, trendData, brandData, staffingData, emergencyData] = await Promise.all([
        api.get(withScope('/dashboard/stats')),
        api.get(withScope(`/dashboard/attendance-trend?days=${trendDays}`)),
        api.get('/dashboard/brand-performance'),
        api.get(withScope('/dashboard/department-staffing')),
        api.get(withScope('/leaves/emergency/pending')),
      ]);
      setStats(statsData);
      setTrend(trendData);
      setBrandRows(brandData);
      setStaffing(staffingData);
      setEmergencies(Array.isArray(emergencyData) ? emergencyData : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [withScope, trendDays]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !stats) {
    return <div className="page-content text-center text-muted">Loading dashboard…</div>;
  }

  const scopeLabel = query ? 'Filtered view' : 'Across all outlets';

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
            <Link to="/employees" className="btn btn-info w-full justify-between">
              <span>Add Employee</span>
              <Plus size={16} />
            </Link>
            <Link to="/outlets" className="btn btn-accent w-full justify-between">
              <span>Manage Outlets</span>
              <Store size={16} />
            </Link>
            <Link to="/attendance" className="btn btn-ghost w-full justify-between">
              <span>Attendance &amp; Geofences</span>
              <MapPin size={16} />
            </Link>
            <Link to="/reports" className="btn btn-ghost w-full justify-between">
              <span>View Reports</span>
              <Upload size={16} />
            </Link>
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
              <div className="text-lg font-bold">{nextShift.section || 'General'} Shift</div>
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
          <Link to="/attendance" className="btn btn-accent w-full justify-center mt-4">
            <MapPin size={16} />
            <span>{attendanceToday?.checkIn ? 'View Attendance' : 'Check In'}</span>
          </Link>
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
                    <div className="text-xs text-muted">{s.section || 'General'}</div>
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
