import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useScope } from '../contexts/ScopeContext';
import {
  CheckCircle, LogIn, LogOut, RefreshCw, AlertTriangle, XCircle, Clock, Store,
  Search, ChevronLeft,
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

/** How far back each view reaches, in its own unit. */
const SPAN = { daily: 14, weekly: 8, monthly: 6 };

/** The start/end a view asks the server for. */
function rangeFor(view) {
  const end = new Date();
  const n = SPAN[view];
  const start = view === 'daily' ? subDays(end, n - 1)
    : view === 'weekly' ? startOfWeek(subWeeks(end, n - 1), { weekStartsOn: 1 })
    : startOfMonth(subMonths(end, n - 1));
  return { startDate: dayKey(start), endDate: dayKey(end) };
}

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

const initialsOf = (name) =>
  name?.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

/**
 * One person's days, as recorded.
 *
 * No Employee column: every caller already knows whose days these are, because
 * you reach this table by opening that person — or because they are your own.
 * The mixed log this replaced needed the column and nothing else does.
 */
function DailyTable({ records }) {
  if (records.length === 0) {
    return (
      <div className="card text-center text-muted">
        No attendance recorded in the last {SPAN.daily} days.
      </div>
    );
  }
  return (
    <div className="table-container mobile-cards">
      <table>
        <thead>
          <tr>
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
  );
}

/** The same days added up, one row per week or per month. */
function SummaryTable({ rows, view }) {
  if (rows.length === 0) {
    return (
      <div className="card text-center text-muted">
        Nothing recorded in the last {SPAN[view]} {view === 'weekly' ? 'weeks' : 'months'}.
      </div>
    );
  }
  return (
    <div className="table-container mobile-cards">
      <table>
        <thead>
          <tr>
            <th>{view === 'weekly' ? 'Week of' : 'Month'}</th>
            <th>Days</th>
            <th>Hours</th>
            <th>Overtime</th>
            <th>Awaiting</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.employee.id}-${row.period}`}>
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
  );
}

export default function AttendancePage() {
  const { user } = useAuth();
  // `locked` is true for every role the server already pins to one restaurant,
  // so the picker appears only for someone who genuinely has a choice.
  const { outlets, locked } = useScope();

  const canViewAll = ATTENDANCE_VIEW_ALL_ROLES.includes(user?.role);
  const canSync = ATTENDANCE_SYNC_ROLES.includes(user?.role);

  /**
   * Mirrors overtimeApprovalDenied() on the server: a global role acts on
   * anyone, a department head only on their own department — and nobody on
   * their own hours. An Outlet Manager acts on none of it; they are on this
   * page to see the hours their restaurant worked, not to sign them off. The
   * server enforces all of it; this only decides what to show.
   */
  const canDecide = useCallback((rec) => {
    if (rec.employee?.id === user?.id) return false;
    if (GLOBAL_SCOPE_ROLES.includes(user?.role)) return true;
    return DEPARTMENT_APPROVERS[rec.employee?.department] === user?.role;
  }, [user]);

  const [records, setRecords] = useState([]);
  const [roster, setRoster] = useState([]);
  const [summary, setSummary] = useState([]);
  const [queue, setQueue] = useState([]);
  const [todayAttendance, setTodayAttendance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  /** null while the grid is showing; an employee id once one is opened. */
  const [openId, setOpenId] = useState(null);
  const [search, setSearch] = useState('');

  /**
   * Which restaurant the page is showing, or '' for all of them.
   *
   * Only global roles ever see more than one, and for them the unfiltered view
   * was the only view — a log mixing every restaurant in the group, with no way
   * to look at one. The server has always accepted `?outlet=`; nothing on this
   * page sent it.
   */
  const [selectedOutletId, setSelectedOutletId] = useState('');

  const [view, setView] = useState('daily');

  /**
   * Two ranges, not one.
   *
   * The daily window is fixed and always fetched: it feeds both the cards'
   * totals and the Daily tab of whoever is open, so it cannot depend on which
   * tab that is. The wider window is only ever asked for when someone is open
   * on Weekly or Monthly. Computed once per mount — a date that drifted
   * mid-session would refetch everything on an unrelated render.
   */
  const dailyRange = useMemo(() => rangeFor('daily'), []);
  const summaryRange = useMemo(() => rangeFor(view), [view]);

  const scope = selectedOutletId ? `&outlet=${selectedOutletId}` : '';

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { startDate, endDate } = dailyRange;
      const qs = `startDate=${startDate}&endDate=${endDate}`;
      // outletScope() ignores this for a locked role, so it is safe to send
      // unconditionally — but only a global role can ever set it.
      const s = selectedOutletId ? `&outlet=${selectedOutletId}` : '';

      const [main, today, pending, people] = await Promise.all([
        api.get(`/attendance?${qs}${s}`),
        api.get('/attendance/today'),
        // Asked for by status rather than filtered out of the visible range:
        // an outstanding day just outside the window still needs deciding.
        // Follows the restaurant filter, so the queue never lists approvals for
        // a restaurant the rest of the page is not showing.
        api.get(`/attendance?overtimeStatus=PENDING${s}`),
        // The roster, so that someone with no punches at all still gets a card.
        // On an attendance page "nothing recorded" is the finding, and deriving
        // the list from the records alone would hide exactly those people.
        canViewAll
          ? api.get(`/employees?limit=500${s ? `&outlet=${selectedOutletId}` : ''}`)
          : Promise.resolve(null),
      ]);

      setRecords(Array.isArray(main) ? main : []);
      setTodayAttendance(today.status !== 'NOT_CHECKED_IN' ? today : null);
      setQueue(Array.isArray(pending) ? pending : []);
      // Administration roles never clock in, so they are absent from the
      // records and must be absent from the cards too, or every restaurant
      // gains a permanently empty row. Same rule as clockingEmployeeFilter().
      setRoster(
        (people?.employees || []).filter((e) => !GLOBAL_SCOPE_ROLES.includes(e.role))
      );
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [dailyRange, selectedOutletId, canViewAll]);

  useEffect(() => { loadData(); }, [loadData]);

  /**
   * Ask the server to catch up with the punch log, then reload if it did.
   *
   * After the first load rather than before it, so the page shows what it
   * already has instantly — a cold Neon compute can take several seconds, and a
   * spinner over data that was fine five minutes ago is worse than the data.
   * Once per visit: the server throttles anyway, so repeating it here would
   * only make requests that answer "fresh".
   */
  const [feed, setFeed] = useState({ status: 'checking' });
  useEffect(() => {
    let cancelled = false;
    api.post('/attendance/refresh', {})
      .then((res) => {
        if (cancelled) return;
        setFeed(res || { status: 'fresh' });
        if (res?.status === 'synced' && res.daysWritten > 0) loadData();
      })
      .catch(() => { if (!cancelled) setFeed({ status: 'error' }); });
    return () => { cancelled = true; };
    // loadData is deliberately left out: it changes with the outlet tab, and
    // switching tabs is not a reason to ask the punch log again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const feedLine = feed.status === 'checking' ? 'Updating from the punch log…'
    : feed.status === 'not-configured' ? 'The attendance feed isn’t connected — ask an admin'
    : feed.status === 'error' ? 'Couldn’t reach the punch log — showing the last import'
    : feed.lastSyncAt ? `Updated ${format(new Date(feed.lastSyncAt), 'h:mm a')}`
    : null;

  /**
   * The weekly and monthly rollups, for one person, on demand.
   *
   * Scoped to `employee` server-side rather than fetched for everyone and
   * filtered here — the whole reason /summary exists is that a month of one
   * restaurant is thousands of rows.
   */
  useEffect(() => {
    if (view === 'daily') { setSummary([]); return; }
    const target = openId || (canViewAll ? null : user?.id);
    if (canViewAll && !target) { setSummary([]); return; }

    let cancelled = false;
    const { startDate, endDate } = summaryRange;
    const who = target ? `&employee=${target}` : '';
    api
      .get(`/attendance/summary?period=${view === 'weekly' ? 'week' : 'month'}` +
        `&startDate=${startDate}&endDate=${endDate}${who}${scope}`)
      .then((res) => { if (!cancelled) setSummary(res?.rows || []); })
      .catch(() => { if (!cancelled) setSummary([]); });
    return () => { cancelled = true; };
  }, [view, openId, summaryRange, scope, canViewAll, user?.id]);

  /** Opening someone always lands on their days, not on last week's rollup. */
  const openPerson = (id) => { setOpenId(id); setView('daily'); };
  const closePerson = () => { setOpenId(null); setView('daily'); };

  const pendingOvertime = useMemo(
    () => queue.filter(canDecide),
    [queue, canDecide]
  );

  /** Each person's fortnight, added up from the records already on the page. */
  const totals = useMemo(() => {
    const map = new Map();
    for (const rec of records) {
      const e = rec.employee;
      if (!e) continue;
      let row = map.get(e.id);
      if (!row) {
        row = {
          employee: e, days: 0, minutes: 0, overtimeMinutes: 0,
          overtimePending: 0, missingPunchOut: 0, lastSeen: null,
        };
        map.set(e.id, row);
      }
      row.days += 1;
      const worked = workedMinutes(rec);
      if (worked != null) row.minutes += worked;
      if (missingPunchOut(rec)) row.missingPunchOut += 1;
      row.overtimeMinutes += rec.overtimeMinutes || 0;
      if (rec.overtimeStatus === 'PENDING') row.overtimePending += rec.overtimeMinutes || 0;
      const d = new Date(rec.date);
      if (!row.lastSeen || d > row.lastSeen) row.lastSeen = d;
    }
    return map;
  }, [records]);

  /**
   * One card per person: the roster, carrying whatever the records add up to.
   *
   * Anyone with records but no roster entry is kept as well. The two calls are
   * scoped separately, and dropping such a person would lose attendance that
   * has already been recorded — better a card with less on it than a silent
   * omission.
   */
  const people = useMemo(() => {
    const rows = [];
    const seen = new Set();
    for (const e of roster) {
      seen.add(e.id);
      rows.push(totals.get(e.id) || {
        employee: e, days: 0, minutes: 0, overtimeMinutes: 0,
        overtimePending: 0, missingPunchOut: 0, lastSeen: null,
      });
    }
    for (const [id, row] of totals) if (!seen.has(id)) rows.push(row);

    // Days before hours, so that "recorded at all" beats "recorded a lot" and
    // everyone with nothing sinks to the bottom together.
    return rows.sort(
      (a, b) => b.days - a.days || b.minutes - a.minutes
        || a.employee.name.localeCompare(b.employee.name)
    );
  }, [roster, totals]);

  const filteredPeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return people;
    return people.filter(({ employee: e }) =>
      e.name?.toLowerCase().includes(q)
      || e.employeeCode?.toLowerCase().includes(q)
      || e.department?.toLowerCase().includes(q)
    );
  }, [people, search]);

  const openRow = openId ? people.find((p) => p.employee.id === openId) : null;
  const openRecords = useMemo(
    () => (openId ? records.filter((r) => r.employee?.id === openId) : []),
    [records, openId]
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
        {canSync && !openRow && (
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={handleSync} disabled={syncing}>
              <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
              <span>{syncing ? 'Syncing…' : 'Sync now'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Everything above the list belongs to the overview. Once a person is
          open the page is about them, and your own day and your own approval
          queue would be two other people's business sitting on top of it. */}
      {openRow ? (
        <>
          <button className="btn btn-ghost btn-sm mb-4" onClick={closePerson}>
            <ChevronLeft size={16} />
            <span>All employees</span>
          </button>

          <div className="card mb-4">
            <div className="flex items-center gap-3">
              <div className="user-avatar">{initialsOf(openRow.employee.name)}</div>
              <div style={{ minWidth: 0 }}>
                <h3 className="card-title truncate">{openRow.employee.name}</h3>
                <div className="text-xs text-muted truncate">
                  {[openRow.employee.outlet?.name, openRow.employee.department,
                    openRow.employee.employeeCode].filter(Boolean).join(' · ')}
                </div>
              </div>
            </div>

            <div className="person-stats">
              <div className="person-stat">
                <span className="person-stat-value">{formatDuration(openRow.minutes)}</span>
                <span className="person-stat-label">worked</span>
              </div>
              <div className="person-stat">
                <span className="person-stat-value">{openRow.days}</span>
                <span className="person-stat-label">
                  {openRow.days === 1 ? 'day recorded' : 'days recorded'}
                </span>
              </div>
              <div className="person-stat">
                <span className="person-stat-value">
                  {openRow.overtimeMinutes > 0 ? `+${formatDuration(openRow.overtimeMinutes)}` : '—'}
                </span>
                <span className="person-stat-label">overtime</span>
              </div>
              {openRow.missingPunchOut > 0 && (
                <div className="person-stat">
                  <span className="person-stat-value" style={{ color: 'var(--ink-warn)' }}>
                    {openRow.missingPunchOut}
                  </span>
                  <span className="person-stat-label">no punch-out</span>
                </div>
              )}
            </div>
            <p className="text-xs text-muted mt-3">
              Totals cover the last {SPAN.daily} days.
              {openRow.lastSeen && ` Last recorded ${format(openRow.lastSeen, 'EEE d MMM')}.`}
            </p>
          </div>

          <div className="card-header">
            <h3 className="card-title">Attendance</h3>
            <Segmented ariaLabel="Attendance view" value={view} onChange={setView} options={VIEWS} />
          </div>

          {view === 'daily'
            ? <DailyTable records={openRecords} />
            : <SummaryTable rows={summary} view={view} />}
        </>
      ) : (
        <>
          {/* Only for a role that can reach more than one restaurant. Everyone else
              is pinned server-side, so a picker would be a control with one
              setting. "All" stays available because HR legitimately wants the
              group-wide view — it is the narrowing that was missing, not the
              breadth. */}
          {!locked && outlets.length > 1 && (
            <div className="outlet-tabs mb-4" role="tablist" aria-label="Restaurant">
              <button
                type="button"
                role="tab"
                aria-selected={selectedOutletId === ''}
                className={`outlet-tab ${selectedOutletId === '' ? 'active' : ''}`}
                onClick={() => setSelectedOutletId('')}
              >
                <span>All restaurants</span>
              </button>
              {outlets.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="tab"
                  aria-selected={o.id === selectedOutletId}
                  className={`outlet-tab ${o.id === selectedOutletId ? 'active' : ''}`}
                  onClick={() => setSelectedOutletId(o.id)}
                >
                  <Store size={14} />
                  <span>{o.name}</span>
                </button>
              ))}
            </div>
          )}

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

          {/* The approval queue, above the list — it is the only part that needs doing. */}
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

          {canViewAll ? (
            <>
              <div className="card-header">
                <div style={{ minWidth: 0 }}>
                  <h3 className="card-title">Employees</h3>
                  {feedLine && (
                    <div
                      className="text-xs flex items-center gap-2"
                      style={{
                        color: feed.status === 'not-configured' || feed.status === 'error'
                          ? 'var(--ink-warn)' : 'var(--ink-muted)',
                      }}
                    >
                      {feed.status === 'checking' && <RefreshCw size={12} className="animate-spin" />}
                      <span>{feedLine}</span>
                    </div>
                  )}
                </div>
                <div className="header-search" style={{ maxWidth: 280 }}>
                  <Search className="search-icon" size={16} />
                  <input
                    type="search"
                    placeholder="Search name, code or department…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Search employees"
                  />
                </div>
              </div>

              {filteredPeople.length === 0 ? (
                <div className="card text-center text-muted">
                  {people.length === 0
                    ? 'Nobody at this restaurant clocks in yet.'
                    : `Nobody matches “${search}”.`}
                </div>
              ) : (
                <div className="stats-grid">
                  {filteredPeople.map((row) => {
                    const e = row.employee;
                    return (
                      <button
                        key={e.id}
                        type="button"
                        className="card group-card"
                        onClick={() => openPerson(e.id)}
                        aria-label={`Open attendance for ${e.name}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="user-avatar">{initialsOf(e.name)}</div>
                          <div style={{ minWidth: 0 }}>
                            <div className="card-title truncate">{e.name}</div>
                            <div className="text-xs text-muted truncate">
                              {[e.department, e.employeeCode].filter(Boolean).join(' · ') || 'No department'}
                            </div>
                          </div>
                        </div>

                        {row.days === 0 ? (
                          <p className="text-xs text-muted mt-3">
                            No attendance in the last {SPAN.daily} days.
                          </p>
                        ) : (
                          <>
                            <div className="person-stats">
                              <div className="person-stat">
                                <span className="person-stat-value">{formatDuration(row.minutes)}</span>
                                <span className="person-stat-label">worked</span>
                              </div>
                              <div className="person-stat">
                                <span className="person-stat-value">{row.days}</span>
                                <span className="person-stat-label">
                                  {row.days === 1 ? 'day' : 'days'}
                                </span>
                              </div>
                              {row.missingPunchOut > 0 && (
                                <div className="person-stat">
                                  <span className="person-stat-value" style={{ color: 'var(--ink-warn)' }}>
                                    {row.missingPunchOut}
                                  </span>
                                  <span className="person-stat-label">open</span>
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-2 flex-wrap mt-3">
                              {row.overtimePending > 0 ? (
                                <span className="badge badge-warn">
                                  +{formatDuration(row.overtimePending)} · pending
                                </span>
                              ) : row.overtimeMinutes > 0 ? (
                                <span className="badge badge-ghost">
                                  +{formatDuration(row.overtimeMinutes)}
                                </span>
                              ) : null}
                              {row.lastSeen && (
                                <span className="text-xs text-muted" style={{ marginLeft: 'auto' }}>
                                  last seen {format(row.lastSeen, 'd MMM')}
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            /* One person's own page — there is no list to show them. */
            <>
              <div className="card-header">
                <h3 className="card-title">Your attendance</h3>
                <Segmented ariaLabel="Attendance view" value={view} onChange={setView} options={VIEWS} />
              </div>
              {view === 'daily'
                ? <DailyTable records={records} />
                : <SummaryTable rows={summary} view={view} />}
            </>
          )}
        </>
      )}
    </div>
  );
}
