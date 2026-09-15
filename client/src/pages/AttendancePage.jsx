import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import {
  CheckCircle, LogIn, LogOut, RefreshCw, AlertTriangle, XCircle, Clock,
} from 'lucide-react';
import {
  format, subDays, subWeeks, subMonths, startOfWeek, startOfMonth, parseISO,
} from 'date-fns';
import Segmented from '../components/Segmented';
import {
  ATTENDANCE_VIEW_ALL_ROLES, ATTENDANCE_SYNC_ROLES,
  DEPARTMENT_APPROVERS, GLOBAL_SCOPE_ROLES, WORKDAY_MINUTES,
} from '../constants';

/** YYYY-MM-DD from local parts — never toISOString(), which shifts the day. */
const dayKey = (d) => format(d, 'yyyy-MM-dd');

/**
 * Daily is every punch as recorded; weekly and monthly are the same days added
 * up per person. The weekly bucket runs Monday-to-Sunday to line up with the
 * roster, which means a week can straddle a month end — so the two summaries
 * genuinely differ rather than one being a rounding of the other.
 */
const VIEWS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

/** How far back each view can reach, in its own unit. */
/** How far back each view reaches, in its own unit. Was a per-view picker; now fixed. */
const SPAN = { daily: 14, weekly: 8, monthly: 6 };

/** Minutes from first punch to last, or null while the day is still open. */
function workedMinutes(rec) {
  if (!rec.checkIn || !rec.checkOut) return null;
  return Math.floor((new Date(rec.checkOut) - new Date(rec.checkIn)) / 60000);
}

function formatDuration(minutes) {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/**
 * A past day that was opened and never closed.
 *
 * Worth its own label: rendered as a dash it reads exactly like "still at
 * work". Nothing will ever close it on its own — the day is past, so no further
 * punch will arrive for it — which means someone has to notice.
 */
function missingPunchOut(rec) {
  if (rec.checkOut || !rec.checkIn) return false;
  return dayKey(new Date(rec.date)) < dayKey(new Date());
}

export default function AttendancePage() {
  const { user } = useAuth();

  const canViewAll = ATTENDANCE_VIEW_ALL_ROLES.includes(user?.role);
  const canSync = ATTENDANCE_SYNC_ROLES.includes(user?.role);

  /**
   * Mirrors overtimeApprovalDenied() on the server: a global role acts on
   * anyone, an outlet manager on any department at their restaurant, a
   * department head only on their own — and nobody on their own hours. The
   * server enforces all of it; this only decides what to show.
   */
  const canDecide = useCallback((rec) => {
    if (rec.employee?.id === user?.id) return false;
    if (GLOBAL_SCOPE_ROLES.includes(user?.role)) return true;
    if (user?.role === 'OUTLET_MANAGER') return true;
    return DEPARTMENT_APPROVERS[rec.employee?.department] === user?.role;
  }, [user]);

  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState([]);
  const [queue, setQueue] = useState([]);
  const [todayAttendance, setTodayAttendance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const [view, setView] = useState('daily');
  const range = useMemo(() => {
    const end = new Date();
    const n = SPAN[view];
    const start = view === 'daily' ? subDays(end, n - 1)
      : view === 'weekly' ? startOfWeek(subWeeks(end, n - 1), { weekStartsOn: 1 })
      : startOfMonth(subMonths(end, n - 1));
    return { startDate: dayKey(start), endDate: dayKey(end) };
  }, [view]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { startDate, endDate } = range;
      const qs = `startDate=${startDate}&endDate=${endDate}`;

      const [main, today, pending] = await Promise.all([
        view === 'daily'
          ? api.get(`/attendance?${qs}`)
          : api.get(`/attendance/summary?period=${view === 'weekly' ? 'week' : 'month'}&${qs}`),
        api.get('/attendance/today'),
        // Asked for by status rather than filtered out of the visible range:
        // an outstanding day just outside the window still needs deciding.
        api.get('/attendance?overtimeStatus=PENDING'),
      ]);

      if (view === 'daily') {
        setRecords(Array.isArray(main) ? main : []);
        setSummary([]);
      } else {
        setSummary(main?.rows || []);
        setRecords([]);
      }
      setTodayAttendance(today.status !== 'NOT_CHECKED_IN' ? today : null);
      setQueue(Array.isArray(pending) ? pending : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [range, view]);

  useEffect(() => { loadData(); }, [loadData]);

  const pendingOvertime = useMemo(
    () => queue.filter(canDecide),
    [queue, canDecide]
  );

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      setSyncResult(await api.post('/attendance/sync', {}));
      loadData();
    } catch (err) {
      setSyncResult({ error: err.message || 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  };

  const decide = async (rec, verdict) => {
    try {
      await api.post(`/attendance/${rec.id}/overtime/${verdict}`);
      loadData();
    } catch (err) {
      alert(err.message || 'Could not record that decision');
    }
  };

  if (loading) {
    return <div className="page-content text-center text-muted">Loading attendance…</div>;
  }

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Attendance</h1>
          <p className="page-subtitle">
            Hours worked against a {WORKDAY_MINUTES / 60}-hour day — anything beyond it is overtime
          </p>
        </div>
        {canSync && (
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={handleSync} disabled={syncing}>
              <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
              <span>{syncing ? 'Syncing…' : 'Sync now'}</span>
            </button>
          </div>
        )}
      </div>

      {syncResult && (
        <div className={`card mb-4 ${syncResult.error ? 'card--alert-crit' : 'card--alert-good'}`}>
          <div className="flex items-start gap-3">
            {syncResult.error
              ? <AlertTriangle size={20} className="icon-crit" />
              : <CheckCircle size={20} className="icon-good" />}
            <div style={{ minWidth: 0 }}>
              <h3 className="font-bold text-sm" style={{ color: syncResult.error ? 'var(--ink-crit)' : 'var(--ink-good)' }}>
                {syncResult.error || `${syncResult.daysWritten} day(s) updated from ${syncResult.processed} punches`}
              </h3>
              {/* The names matter: this list is how a punch with no matching
                  employee code gets connected to a person. */}
              {syncResult.unmatched?.length > 0 && (
                <>
                  <p className="text-xs text-secondary mt-1">
                    {syncResult.unmatched.length} id(s) in the punch log match nobody in Shiftly.
                    Set the Employee Code on their profile to pick them up next run.
                  </p>
                  <div className="divided-list mt-2">
                    {syncResult.unmatched.slice(0, 8).map((u) => (
                      <div key={u.userid} className="flex items-center gap-2 text-xs">
                        <span className="badge badge-ghost">{u.userid}</span>
                        <span className="text-secondary">{u.name || 'no name in feed'}</span>
                        <span className="text-muted" style={{ marginLeft: 'auto' }}>{u.punchCount} punches</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Your own day, for everyone — a head chef is recorded the same as anyone.
          Read-only: attendance is whatever the punch log says, so there is
          nothing here to press. */}
      <div className="mb-4">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Today</h3>
            {todayAttendance && (
              <span className="badge badge-ghost">{todayAttendance.status?.replace(/_/g, ' ')}</span>
            )}
          </div>
          {todayAttendance ? (
            <div className="divided-list">
              <div className="flex items-center gap-3">
                <LogIn size={15} className="icon-good" />
                <span className="text-sm text-secondary">First punch</span>
                <span className="text-sm font-semibold text-strong" style={{ marginLeft: 'auto' }}>
                  {todayAttendance.checkIn ? format(new Date(todayAttendance.checkIn), 'hh:mm a') : '--:--'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <LogOut size={15} className={todayAttendance.checkOut ? 'icon-crit' : 'icon-muted'} />
                <span className="text-sm text-secondary">Last punch</span>
                <span className="text-sm font-semibold text-strong" style={{ marginLeft: 'auto' }}>
                  {todayAttendance.checkOut ? format(new Date(todayAttendance.checkOut), 'hh:mm a') : '--:--'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Clock size={15} className="icon-brand" />
                <span className="text-sm text-secondary">Hours</span>
                <span className="text-sm font-semibold text-strong" style={{ marginLeft: 'auto' }}>
                  {formatDuration(workedMinutes(todayAttendance))}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">
              No punches recorded for you today yet.
            </p>
          )}
        </div>
      </div>

      {/* The approval queue, above the log — it is the only part that needs doing. */}
      {pendingOvertime.length > 0 && (
        <div className="card mb-4">
          <div className="card-header">
            <h3 className="card-title">Overtime awaiting your approval</h3>
            <span className="badge badge-warn">{pendingOvertime.length}</span>
          </div>
          <div className="divided-list">
            {pendingOvertime.map((rec) => (
              <div key={rec.id} className="flex items-center gap-3 flex-wrap">
                <div style={{ minWidth: 0 }}>
                  <div className="font-semibold text-strong">{rec.employee.name}</div>
                  <div className="text-xs text-muted">
                    {format(new Date(rec.date), 'EEE d MMM')} · {rec.employee.department} ·
                    {' '}worked {formatDuration(workedMinutes(rec))}
                  </div>
                </div>
                <span className="badge badge-warn" style={{ marginLeft: 'auto' }}>
                  +{formatDuration(rec.overtimeMinutes)}
                </span>
                <div className="flex gap-2">
                  <button
                    className="btn btn-ghost btn-sm btn-icon"
                    style={{ color: 'var(--accent-400)' }}
                    title="Approve"
                    onClick={() => decide(rec, 'approve')}
                  >
                    <CheckCircle size={15} />
                  </button>
                  <button
                    className="btn btn-ghost btn-sm btn-icon"
                    style={{ color: 'var(--error-400)' }}
                    title="Reject"
                    onClick={() => decide(rec, 'reject')}
                  >
                    <XCircle size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card-header">
        <h3 className="card-title">{canViewAll ? 'Attendance log' : 'Your attendance'}</h3>
        <div className="flex gap-2 flex-wrap">
          <Segmented
            ariaLabel="Attendance view"
            value={view}
            onChange={setView}
            options={VIEWS}
          />
        </div>
      </div>

      {view !== 'daily' ? (
        summary.length === 0 ? (
          <div className="card text-center text-muted">
            Nothing recorded in the last {SPAN[view]} {view === 'weekly' ? 'weeks' : 'months'}.
          </div>
        ) : (
          <div className="table-container mobile-cards">
            <table>
              <thead>
                <tr>
                  {canViewAll && <th>Employee</th>}
                  <th>{view === 'weekly' ? 'Week of' : 'Month'}</th>
                  <th>Days</th>
                  <th>Hours</th>
                  <th>Overtime</th>
                  <th>Awaiting</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr key={`${row.employee.id}-${row.period}`}>
                    {canViewAll && (
                      <td data-label="Employee">
                        <div className="font-semibold" style={{ color: 'var(--ink-strong)' }}>
                          {row.employee.name}
                        </div>
                        <div className="text-xs text-muted">
                          {row.employee.outlet?.name} · {row.employee.department}
                        </div>
                      </td>
                    )}
                    <td data-label={view === 'weekly' ? 'Week of' : 'Month'}>
                      {format(parseISO(row.period), view === 'weekly' ? 'd MMM yyyy' : 'MMMM yyyy')}
                    </td>
                    <td data-label="Days">
                      {row.days}
                      {/* A day nobody closed contributes no hours, so the two
                          numbers would otherwise silently disagree. */}
                      {row.missingPunchOut > 0 && (
                        <span className="badge badge-warn ml-2" title="Days with no closing punch">
                          {row.missingPunchOut} open
                        </span>
                      )}
                    </td>
                    <td data-label="Hours">
                      <span className="font-semibold text-strong">{formatDuration(row.minutes)}</span>
                    </td>
                    <td data-label="Overtime">
                      {row.overtimeMinutes > 0 ? (
                        <span className="badge badge-ghost">+{formatDuration(row.overtimeMinutes)}</span>
                      ) : '—'}
                    </td>
                    <td data-label="Awaiting">
                      {row.overtimePending > 0
                        ? <span className="badge badge-warn">{formatDuration(row.overtimePending)}</span>
                        : row.overtimeApproved > 0
                          ? <span className="badge badge-accent">{formatDuration(row.overtimeApproved)} approved</span>
                          : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : records.length === 0 ? (
        <div className="card text-center text-muted">
          No attendance recorded in the last {SPAN.daily} days.
        </div>
      ) : (
        <div className="table-container mobile-cards">
          <table>
            <thead>
              <tr>
                {canViewAll && <th>Employee</th>}
                <th>Date</th>
                <th>First</th>
                <th>Last</th>
                <th>Hours</th>
                <th>Overtime</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map((rec) => {
                const worked = workedMinutes(rec);
                const open = missingPunchOut(rec);
                return (
                  <tr key={rec.id}>
                    {canViewAll && (
                      <td data-label="Employee">
                        <div className="font-semibold" style={{ color: 'var(--ink-strong)' }}>
                          {rec.employee.name}
                        </div>
                        <div className="text-xs text-muted">
                          {rec.employee.outlet?.name} · {rec.employee.department}
                        </div>
                      </td>
                    )}
                    <td data-label="Date">{format(new Date(rec.date), 'EEE d MMM')}</td>
                    <td data-label="First">{rec.checkIn ? format(new Date(rec.checkIn), 'hh:mm a') : '—'}</td>
                    <td data-label="Last">
                      {rec.checkOut
                        ? format(new Date(rec.checkOut), 'hh:mm a')
                        : open
                          ? <span className="badge badge-warn">Missing</span>
                          : '—'}
                    </td>
                    <td data-label="Hours">
                      {worked == null ? '—' : (
                        <span className={worked > WORKDAY_MINUTES ? 'font-semibold text-strong' : ''}>
                          {formatDuration(worked)}
                        </span>
                      )}
                    </td>
                    <td data-label="Overtime">
                      {rec.overtimeMinutes > 0 ? (
                        <span
                          className={`badge ${
                            rec.overtimeStatus === 'APPROVED' ? 'badge-accent'
                              : rec.overtimeStatus === 'REJECTED' ? 'badge-error'
                              : rec.overtimeStatus === 'PENDING' ? 'badge-warn'
                              : 'badge-ghost'
                          }`}
                          // No status with minutes on the clock means the span was
                          // too long to be a shift and wants a human eye.
                          title={rec.overtimeStatus || 'Needs review'}
                        >
                          +{formatDuration(rec.overtimeMinutes)}
                          {rec.overtimeStatus ? ` · ${rec.overtimeStatus.toLowerCase()}` : ' · review'}
                        </span>
                      ) : '—'}
                    </td>
                    <td data-label="Status">
                      <span className={`badge ${
                        rec.status === 'CHECKED_OUT' || rec.status === 'CHECKED_IN' ? 'badge-accent'
                          : rec.status === 'LATE' ? 'badge-warn' : 'badge-error'
                      }`}>
                        {rec.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
