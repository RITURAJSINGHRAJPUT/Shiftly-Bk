import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { useScope } from '../contexts/ScopeContext';
import StatTile from '../components/StatTile';
import ChartCard from '../components/ChartCard';
import Segmented from '../components/Segmented';
import AttendanceTrendChart from '../components/charts/AttendanceTrendChart';
import BrandPerformanceChart from '../components/charts/BrandPerformanceChart';
import useChart from '../hooks/useChart';
import { DEPARTMENT_LABELS } from '../theme/chartPalette';
import { TrendingUp, Users, CalendarDays, AlertTriangle } from 'lucide-react';

const RANGES = [
  { value: 7, label: '7 Days' },
  { value: 14, label: '14 Days' },
  { value: 30, label: '30 Days' },
];

export default function ReportsPage() {
  const { withScope } = useScope();
  const { departments } = useChart();

  const [stats, setStats] = useState(null);
  const [trend, setTrend] = useState(null);
  const [brandRows, setBrandRows] = useState([]);
  const [deptRows, setDeptRows] = useState([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsData, trendData, brandData, deptData] = await Promise.all([
        api.get(withScope('/dashboard/stats')),
        api.get(withScope(`/dashboard/attendance-trend?days=${days}`)),
        api.get('/dashboard/brand-performance'),
        api.get(withScope('/employees/stats/overview')),
      ]);
      setStats(statsData);
      setTrend(trendData);
      setBrandRows(brandData);
      setDeptRows(deptData.byDepartment || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [withScope, days]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !stats) {
    return <div className="page-content text-center text-muted">Loading analytics…</div>;
  }

  // Real headcount split. This replaced three hardcoded bars at 60/30/10.
  const deptTotal = deptRows.reduce((sum, d) => sum + d._count, 0);

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Operational Reports</h1>
          <p className="page-subtitle">Staffing levels, attendance metrics and shift coverage</p>
        </div>
        <Segmented options={RANGES} value={days} onChange={setDays} ariaLabel="Report range" />
      </div>

      <div className="stats-grid">
        <StatTile
          label="Attendance Rate Today"
          value={`${stats?.attendanceRate ?? 0}%`}
          icon={TrendingUp}
          tone="good"
          deltaNote={`${stats?.todayAttendance ?? 0} of ${stats?.todayShifts ?? 0} shifts`}
        />
        <StatTile
          label="Monitored Employees"
          value={stats?.totalEmployees ?? 0}
          icon={Users}
          tone="brand"
          deltaNote={`Across ${stats?.totalOutlets ?? 0} outlets`}
        />
        <StatTile
          label="Shifts This Week"
          value={stats?.weekShifts ?? 0}
          icon={CalendarDays}
          tone="warn"
          deltaNote="Assigned"
        />
        <StatTile
          label="Active Emergencies"
          value={stats?.emergencyLeaves ?? 0}
          icon={AlertTriangle}
          tone="crit"
          deltaNote="Awaiting cover"
        />
      </div>

      <div className="grid-2 mb-4">
        <ChartCard title="Attendance Trend" subtitle={`last ${days} days`}>
          <AttendanceTrendChart series={trend?.series || []} target={trend?.target ?? 95} />
        </ChartCard>

        <ChartCard title="Brand Performance" subtitle="attendance %, this week">
          <BrandPerformanceChart rows={brandRows} />
        </ChartCard>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Department Headcount</h3>
            <span className="text-xs text-muted">{deptTotal} staff</span>
          </div>
          {deptRows.length === 0 ? (
            <div className="empty-state py-4"><p>No employees in scope.</p></div>
          ) : (
            <div className="flex flex-col gap-4">
              {deptRows.map((d) => {
                const pct = deptTotal > 0 ? Math.round((d._count / deptTotal) * 100) : 0;
                return (
                  <div key={d.department}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-secondary">
                        {DEPARTMENT_LABELS[d.department] || d.department}
                      </span>
                      <span className="font-semibold text-strong">{d._count} · {pct}%</span>
                    </div>
                    <div className="meter">
                      <div
                        className="meter-fill"
                        style={{
                          width: `${pct}%`,
                          background: departments[d.department] || 'var(--primary-500)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Coverage Summary</h3>
          </div>
          <div className="divided-list">
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Shifts scheduled today</span>
              <span className="font-semibold text-strong">{stats?.todayShifts ?? 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Attended today</span>
              <span className="font-semibold text-strong">{stats?.todayAttendance ?? 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Shifts this week</span>
              <span className="font-semibold text-strong">{stats?.weekShifts ?? 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Leave requests pending</span>
              <span className="font-semibold text-strong">{stats?.pendingLeaves ?? 0}</span>
            </div>
          </div>
          <p className="text-xs text-muted mt-4">
            Labour cost and coverage forecasting are not available in this build —
            there is no wage data or forecasting model behind them yet.
          </p>
        </div>
      </div>
    </div>
  );
}
