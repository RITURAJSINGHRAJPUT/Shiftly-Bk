import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useScope } from '../contexts/ScopeContext';
import { ALL_WEEKDAYS, STATIONS, departmentHasStations } from '../constants';
import Modal from '../components/Modal';
import { format, startOfWeek, endOfWeek, addDays, isSameDay, isToday, parseISO } from 'date-fns';
import {
  Calendar, CalendarDays, Plus, RefreshCw, CheckCircle2, AlertTriangle,
  Layers, Store, ChevronLeft, ChevronRight,
} from 'lucide-react';


/** YYYY-MM-DD from local parts — never toISOString(), which shifts the day. */
const dayKey = (d) => format(d, 'yyyy-MM-dd');

/** Sections are stored capitalised on patterns, lowercase on some shifts. */
const normSection = (s) => (s ? String(s).toLowerCase().trim() : 'general');

/** Identity of a staffing slot: same hours, same station, same department. */
const slotKey = (startTime, endTime, section, department) =>
  `${startTime}|${endTime}|${normSection(section)}|${department}`;

export default function ShiftsPage() {
  const { user, isManager } = useAuth();
  const { outlets, locked } = useScope();

  /**
   * Planning happens for one restaurant at a time, chosen by the tab strip
   * below. Seeded once from the user's own outlet, falling back to the first —
   * the top bar's outlet selector used to seed it, and that selector is gone.
   */
  const [selectedOutletId, setSelectedOutletId] = useState('');

  // The daily and weekly sections navigate independently, so each owns its date.
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());

  const [weekShifts, setWeekShifts] = useState([]);
  const [dayShifts, setDayShifts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dayLoading, setDayLoading] = useState(false);

  const [allocating, setAllocating] = useState(false);
  const [allocationSummary, setAllocationSummary] = useState(null);

  const [isShiftModalOpen, setShiftModalOpen] = useState(false);
  const [shiftForm, setShiftForm] = useState(null);


  const outlet = outlets.find((o) => o.id === selectedOutletId) || null;

  // Seed the selection, and follow the top bar when it changes.
  useEffect(() => {
    if (outlets.length === 0) return;
    const preferred =
      (outlets.some((o) => o.id === user?.outletId) ? user.outletId : '') || outlets[0].id;
    // `prev ||` so a tab the user picked is never clobbered by a re-render.
    setSelectedOutletId((prev) => prev || preferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlets]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(weekAnchor, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [weekAnchor]);

  const loadOutletData = useCallback(async () => {
    if (!selectedOutletId) return;
    setLoading(true);
    try {
      const [empRes, tplRes] = await Promise.all([
        api.get(`/employees?limit=500&outlet=${selectedOutletId}`),
        api.get(`/shift-templates?outlet=${selectedOutletId}`),
      ]);
      setEmployees(empRes.employees);
      setTemplates(tplRes);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedOutletId]);

  const loadWeek = useCallback(async () => {
    if (!selectedOutletId) return;
    try {
      const start = dayKey(startOfWeek(weekAnchor, { weekStartsOn: 1 }));
      const end = dayKey(endOfWeek(weekAnchor, { weekStartsOn: 1 }));
      // Explicit ?outlet= rather than the global scope, so the grid is always
      // exactly one restaurant.
      setWeekShifts(await api.get(`/shifts?outlet=${selectedOutletId}&startDate=${start}&endDate=${end}`));
    } catch (err) {
      console.error(err);
    }
  }, [selectedOutletId, weekAnchor]);

  /**
   * The day is fetched on its own rather than filtered out of the week: the two
   * navigations are independent, so the selected day can sit outside the week
   * currently shown below.
   */
  const loadDay = useCallback(async () => {
    if (!selectedOutletId) return;
    setDayLoading(true);
    try {
      setDayShifts(await api.get(`/shifts?outlet=${selectedOutletId}&date=${dayKey(selectedDay)}`));
    } catch (err) {
      console.error(err);
    } finally {
      setDayLoading(false);
    }
  }, [selectedOutletId, selectedDay]);

  useEffect(() => { loadOutletData(); }, [loadOutletData]);
  useEffect(() => { loadWeek(); }, [loadWeek]);
  useEffect(() => { loadDay(); }, [loadDay]);

  // Switching restaurant invalidates the previous allocation result.
  useEffect(() => { setAllocationSummary(null); }, [selectedOutletId]);

  const activeTemplates = useMemo(() => templates.filter((t) => t.isActive), [templates]);

  /**
   * The patterns that actually run on a given date, and the slots they ask for.
   *
   * Patterns carry a `daysOfWeek` list, so "slots per day" is no longer one
   * number — a Friday-only pattern must not count against a Tuesday, or every
   * Tuesday reads as understaffed for shifts nobody ever wanted.
   *
   * `date` is a real Date here (built by date-fns), so `getDay()` is safe; the
   * server takes the same care with its date-only strings via startOfLocalDay.
   */
  const templatesForDay = useCallback(
    (date) => activeTemplates.filter((t) => (t.daysOfWeek ?? ALL_WEEKDAYS).includes(date.getDay())),
    [activeTemplates]
  );
  const slotsForDay = useCallback(
    (date) => templatesForDay(date).reduce((sum, t) => sum + t.headcount, 0),
    [templatesForDay]
  );

  /** Anything to plan at all this week — what gates Auto-Allocate. */
  const slotsThisWeek = useMemo(
    () => weekDays.reduce((sum, d) => sum + slotsForDay(d), 0),
    [weekDays, slotsForDay]
  );

  const dayTemplates = useMemo(() => templatesForDay(selectedDay), [templatesForDay, selectedDay]);
  const slotsToday = dayTemplates.reduce((sum, t) => sum + t.headcount, 0);

  /**
   * Group the selected day's shifts under the pattern each one fills.
   *
   * Shifts matching no pattern are kept in their own bucket rather than dropped:
   * the seeder generated ad-hoc times that correspond to no pattern, so this is
   * real content, and it doubles as a view of scheduling outside the plan.
   */
  const coverage = useMemo(() => {
    const buckets = new Map();
    dayTemplates.forEach((t) => {
      buckets.set(slotKey(t.startTime, t.endTime, t.section, t.department), {
        template: t,
        shifts: [],
      });
    });

    const unmatched = [];
    for (const s of dayShifts) {
      const bucket = buckets.get(
        slotKey(s.startTime, s.endTime, s.section, s.employee?.department)
      );
      if (bucket) bucket.shifts.push(s);
      else unmatched.push(s);
    }

    const groups = [...buckets.values()];
    return {
      groups,
      unmatched,
      filled: groups.reduce((sum, g) => sum + Math.min(g.shifts.length, g.template.headcount), 0),
      assigned: groups.reduce((sum, g) => sum + g.shifts.length, 0),
    };
  }, [dayShifts, dayTemplates]);

  const handleAutoAllocate = async () => {
    setAllocating(true);
    setAllocationSummary(null);
    try {
      const start = dayKey(startOfWeek(weekAnchor, { weekStartsOn: 1 }));
      const end = dayKey(endOfWeek(weekAnchor, { weekStartsOn: 1 }));
      const res = await api.post('/shifts/auto-allocate', {
        outletId: selectedOutletId,
        startDate: start,
        endDate: end,
      });
      setAllocationSummary(res);
      loadWeek();
      loadDay();
    } catch (err) {
      alert(err.message || 'Auto-allocation failed');
    } finally {
      setAllocating(false);
    }
  };

  const openShiftModal = (dateObj) => {
    const first = employees[0];
    setShiftForm({
      date: dayKey(dateObj || selectedDay),
      startTime: '12:00',
      endTime: '21:00',
      // Seeded from whoever is preselected rather than a fixed 'Pizza', which
      // opened the form already contradicting itself for a service employee.
      section: departmentHasStations(first?.department) ? 'Pizza' : '',
      employeeId: first?.id || '',
      outletId: selectedOutletId,
    });
    setShiftModalOpen(true);
  };

  const saveShift = async (e) => {
    e.preventDefault();
    try {
      await api.post('/shifts', shiftForm);
      setShiftModalOpen(false);
      loadWeek();
      loadDay();
    } catch (err) {
      alert(err.message || 'Failed to create shift');
    }
  };

  /** Who the Add Shift modal is currently assigning to — their department decides
      whether a station applies. */
  const shiftEmployee = employees.find((e) => e.id === shiftForm?.employeeId) || null;

  const shiftsForDay = (day) => weekShifts.filter((s) => isSameDay(new Date(s.date), day));
  const getSection = (section) => (section ? section.toLowerCase() : 'general');

  if (outlets.length === 0) {
    return <div className="page-content text-center text-muted">Loading outlets…</div>;
  }

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Shift Planning</h1>
          <p className="page-subtitle">
            Plan one restaurant at a time — today, then the week
          </p>
        </div>
        {isManager && (
          <div className="flex gap-2">
            {/* The way back to where patterns are defined. Shift Master's header
                carries the mirror-image link, so the pair stays symmetric. */}
            <Link to="/shift-master" className="btn btn-ghost">
              <Layers size={16} />
              <span>Shift Master</span>
            </Link>
            {/* Gated on the whole week, not one day: a Fri–Sun pattern gives
                this week something to allocate even though Monday has none. */}
            <button
              className="btn btn-accent"
              onClick={handleAutoAllocate}
              disabled={allocating || slotsThisWeek === 0}
              title={slotsThisWeek === 0 ? 'Define shift patterns for this outlet first' : undefined}
            >
              <RefreshCw size={16} className={allocating ? 'animate-spin' : ''} />
              <span>{allocating ? 'Allocating…' : 'Auto-Allocate Week'}</span>
            </button>
            <button className="btn btn-primary" onClick={() => openShiftModal()}>
              <Plus size={16} />
              <span>Add Shift</span>
            </button>
          </div>
        )}
      </div>

      {/* One tab per restaurant. A single-outlet user gets a plain heading —
          a one-tab tab strip is just noise. */}
      {outlets.length > 1 && !locked ? (
        <div className="outlet-tabs" role="tablist" aria-label="Restaurant">
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
      ) : (
        <div className="flex items-center gap-2 mb-4">
          <Store size={16} className="icon-brand" />
          <h2 className="card-title">{outlet?.name}</h2>
          {outlet?.brand?.name && <span className="badge badge-ghost">{outlet.brand.name}</span>}
        </div>
      )}

      {/* Alerts stay near the top — transient feedback that must be seen. */}
      {slotsThisWeek === 0 && !loading && (
        <div className="card card--alert-crit mb-4">
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} className="icon-crit" />
            <p className="text-sm text-secondary">
              <strong>{outlet?.name}</strong> has no shift patterns, so auto-allocation
              has nothing to fill. Define them in Shift Master.
            </p>
          </div>
        </div>
      )}

      {allocationSummary && (
        <div
          className={`card mb-4 ${
            allocationSummary.count === 0 ? 'card--alert-crit' : 'card--alert-good'
          }`}
        >
          <div className="flex items-start gap-3">
            {allocationSummary.count === 0 ? (
              <AlertTriangle size={20} className="icon-crit" />
            ) : (
              <CheckCircle2 size={20} className="icon-good" />
            )}
            <div style={{ minWidth: 0 }}>
              <h3
                className="font-bold text-sm"
                style={{ color: allocationSummary.count === 0 ? 'var(--ink-crit)' : 'var(--ink-good)' }}
              >
                {allocationSummary.message
                  ? 'Nothing to allocate'
                  : `Created ${allocationSummary.count} of ${allocationSummary.requested} slots`}
              </h3>
              <p className="text-xs text-secondary">
                {allocationSummary.message ||
                  `${allocationSummary.outlet?.name} · rest periods, skills and workload balance respected.`}
              </p>

              {allocationSummary.shortfalls?.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs uppercase text-muted mb-1">
                    {allocationSummary.shortfalls.length} slot group(s) could not be filled
                  </div>
                  <div className="divided-list">
                    {allocationSummary.shortfalls.slice(0, 6).map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="text-secondary">
                          {format(parseISO(s.date), 'EEE d MMM')} · {s.template}
                        </span>
                        <span className="badge badge-warn" style={{ marginLeft: 'auto' }}>
                          {s.filled}/{s.needed}
                        </span>
                      </div>
                    ))}
                  </div>
                  {allocationSummary.shortfalls.length > 6 && (
                    <div className="text-xs text-muted mt-2">
                      and {allocationSummary.shortfalls.length - 6} more…
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* The read-only pattern list that used to sit here is gone: Shift Master
          owns patterns outright now, and this was the same data with fewer
          capabilities. The templates themselves are still fetched — the coverage
          rows and the week grid's per-day denominators are built from them. */}

      {/* ============ 1 · DAILY COVERAGE ============ */}
      <div className="card mb-4" data-section="daily">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <Calendar size={17} className="icon-brand" />
            <h3 className="card-title">{format(selectedDay, 'EEEE, d MMMM')}</h3>
            {isToday(selectedDay) && <span className="badge badge-primary">Today</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">
              {coverage.filled} of {slotsToday} slots filled · {dayShifts.length} shifts
            </span>
            <div className="flex gap-1">
              <button
                className="btn btn-ghost btn-sm btn-icon"
                onClick={() => setSelectedDay((d) => addDays(d, -1))}
                aria-label="Previous day"
              >
                <ChevronLeft size={14} />
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedDay(new Date())}>
                Today
              </button>
              <button
                className="btn btn-ghost btn-sm btn-icon"
                onClick={() => setSelectedDay((d) => addDays(d, 1))}
                aria-label="Next day"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>

        {dayLoading ? (
          <div className="text-center py-6 text-muted text-sm">Loading day…</div>
        ) : activeTemplates.length === 0 ? (
          <div className="empty-state py-6">
            <p>Define shift patterns in Shift Master to measure this day against them.</p>
          </div>
        ) : (
          <>
            {/* Patterns exist, but none of them runs today. Without this the
                coverage list is simply blank and reads like a loading bug. */}
            {dayTemplates.length === 0 && (
              <p className="text-sm text-muted py-4">
                No pattern runs on {format(selectedDay, 'EEEE')}s at {outlet?.name}.
                {' '}Nothing is scheduled to be filled on this day.
              </p>
            )}

            <div className="divided-list">
              {coverage.groups.map(({ template, shifts }) => {
                const short = shifts.length < template.headcount;
                const over = shifts.length > template.headcount;
                return (
                  <div key={template.id} className="coverage-row">
                    <div className="coverage-head">
                      <span className="font-semibold text-strong">{template.name}</span>
                      <span className="text-xs text-muted">
                        {template.startTime} – {template.endTime}
                      </span>
                    </div>

                    <span
                      className={`badge ${short ? 'badge-error' : over ? 'badge-info' : 'badge-accent'}`}
                      title={short ? 'Under-staffed' : over ? 'Over the planned headcount' : 'Fully staffed'}
                    >
                      {shifts.length}/{template.headcount}
                    </span>

                    <div className="coverage-people">
                      {shifts.length === 0 ? (
                        <span className="text-xs" style={{ color: 'var(--ink-crit)' }}>
                          Nobody assigned
                        </span>
                      ) : (
                        shifts.map((s) => (
                          <span key={s.id} className="badge badge-ghost">
                            {s.employee?.name}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Shifts outside the plan are shown, not dropped — most seeded
                shifts use ad-hoc times that match no pattern. */}
            {coverage.unmatched.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs uppercase text-muted">
                    Not covered by a pattern
                  </span>
                  <span className="badge badge-warn">{coverage.unmatched.length}</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {coverage.unmatched.map((s) => (
                    <span key={s.id} className="badge badge-ghost" title={`${s.employee?.department} · ${s.section || 'General'}`}>
                      {s.employee?.name} · {s.startTime}–{s.endTime}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ============ 2 · WEEKLY ============ */}
      <div className="card mb-4" data-section="weekly">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <CalendarDays size={17} className="icon-brand" />
            <h3 className="card-title">
              {format(weekDays[0], 'd MMM')} – {format(weekDays[6], 'd MMM yyyy')}
            </h3>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">{weekShifts.length} shifts this week</span>
            <div className="flex gap-1">
              <button className="btn btn-ghost btn-sm" onClick={() => setWeekAnchor(addDays(weekAnchor, -7))}>Prev</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setWeekAnchor(new Date())}>This week</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setWeekAnchor(addDays(weekAnchor, 7))}>Next</button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-muted">Loading schedule…</div>
        ) : (
          <div className="shift-calendar">
            {weekDays.map((day) => {
              const dShifts = shiftsForDay(day);
              const today = isSameDay(day, new Date());
              const isSelected = isSameDay(day, selectedDay);
              return (
                <div
                  key={day.toISOString()}
                  className={`calendar-day ${today ? 'today' : ''} ${isSelected ? 'is-selected' : ''}`}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="calendar-day-header">{format(day, 'eee')}</span>
                      <div className="calendar-day-number">{format(day, 'd')}</div>
                    </div>
                    {isManager && (
                      <button
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => openShiftModal(day)}
                        aria-label={`Add shift on ${format(day, 'EEEE d MMMM')}`}
                      >
                        <Plus size={12} />
                      </button>
                    )}
                  </div>

                  {/* This day's own denominator — a Fri–Sun pattern must not
                      make Monday read 0/12 when Monday needs nothing. */}
                  <div className="text-2xs text-muted mb-1">
                    {dShifts.length}/{slotsForDay(day)}
                  </div>

                  <div className="flex flex-col gap-1">
                    {dShifts.map((s) => (
                      <div
                        key={s.id}
                        className="calendar-shift"
                        data-section={getSection(s.section)}
                        title={`${s.employee?.name} · ${s.section || 'General'} · ${s.startTime}-${s.endTime}`}
                      >
                        <div className="font-semibold truncate text-xs text-strong">{s.employee?.name}</div>
                        <div className="text-2xs text-muted">{s.startTime} – {s.endTime}</div>
                        {s.section && <div className="text-2xs font-semibold" style={{ opacity: 0.8 }}>{s.section}</div>}
                      </div>
                    ))}
                    {dShifts.length === 0 && (
                      <div className="text-2xs text-muted text-center py-4">No shifts</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---- Add shift ---- */}
      <Modal
        isOpen={isShiftModalOpen}
        onClose={() => setShiftModalOpen(false)}
        title={`Add shift · ${outlet?.name || ''}`}
      >
        {shiftForm && (
          <form onSubmit={saveShift} className="flex flex-col gap-4">
            <div className="form-group">
              <label className="form-label">Employee</label>
              <select
                className="form-select"
                value={shiftForm.employeeId}
                onChange={(e) => {
                  // A shift has no department of its own — it inherits the one
                  // the person works in, so switching to a service employee
                  // drops any kitchen station already picked.
                  const picked = employees.find((emp) => emp.id === e.target.value);
                  setShiftForm((p) => ({
                    ...p,
                    employeeId: e.target.value,
                    section: departmentHasStations(picked?.department) ? p.section : '',
                  }));
                }}
                required
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name} ({e.department})</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Date</label>
              <input
                type="date"
                className="form-input"
                value={shiftForm.date}
                onChange={(e) => setShiftForm((p) => ({ ...p, date: e.target.value }))}
                required
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Start</label>
                <input type="time" className="form-input" value={shiftForm.startTime}
                  onChange={(e) => setShiftForm((p) => ({ ...p, startTime: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">End</label>
                <input type="time" className="form-input" value={shiftForm.endTime}
                  onChange={(e) => setShiftForm((p) => ({ ...p, endTime: e.target.value }))} required />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Station</label>
              <select
                className="form-select"
                value={shiftForm.section}
                disabled={!departmentHasStations(shiftEmployee?.department)}
                onChange={(e) => setShiftForm((p) => ({ ...p, section: e.target.value }))}
              >
                <option value="">General</option>
                {STATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {shiftEmployee && !departmentHasStations(shiftEmployee.department) && (
                <p className="text-xs text-muted mt-1">
                  {shiftEmployee.name} is {shiftEmployee.department} — stations apply to kitchen only.
                </p>
              )}
            </div>

            <div className="modal-footer" style={{ padding: 0, marginTop: 'var(--space-4)' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShiftModalOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Add Shift</button>
            </div>
          </form>
        )}
      </Modal>

    </div>
  );
}
