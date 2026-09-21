import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useScope } from '../contexts/ScopeContext';
import { ALL_WEEKDAYS, STATIONS, departmentHasStations, departmentsFor, canManageLeaveOf } from '../constants';
import Modal from '../components/Modal';
import LeaveFormModal from '../components/LeaveFormModal';
import { format, startOfWeek, endOfWeek, addDays, isSameDay, isToday, parseISO } from 'date-fns';
import {
  Calendar, CalendarDays, Plus, RefreshCw, CheckCircle2, AlertTriangle,
  Layers, Store, ChevronLeft, ChevronRight, Eraser, Trash2,
} from 'lucide-react';


/** YYYY-MM-DD from local parts — never toISOString(), which shifts the day. */
const dayKey = (d) => format(d, 'yyyy-MM-dd');

/** Sections are stored capitalised on patterns, lowercase on some shifts. */
const normSection = (s) => (s ? String(s).toLowerCase().trim() : 'unassigned');

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

  const [weekLeaves, setWeekLeaves] = useState([]);
  const [allocating, setAllocating] = useState(false);
  const [allocationSummary, setAllocationSummary] = useState(null);

  const [isShiftModalOpen, setShiftModalOpen] = useState(false);
  const [shiftForm, setShiftForm] = useState(null);

  const [editingLeave, setEditingLeave] = useState(null);

  const [resetPreview, setResetPreview] = useState(null);
  const [isResetModalOpen, setResetModalOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState(null);
  const [resetResult, setResetResult] = useState(null);

  /**
   * Not `isManager`, which also covers HR, the Outlet Manager and the two
   * department heads — all of whom would see a button that 403s, since
   * SHIFT_RESET is ADMIN-floor with no exceptions. An Outlet Manager builds the
   * roster and cannot wipe it. The server enforces this independently; this
   * only decides what is worth showing.
   */
  const canReset = ['SUPER_ADMIN', 'ADMIN'].includes(user?.role);

  /** SHIFT_DELETE is ADMIN-floor too; an Outlet Manager edits but cannot erase. */
  const canDeleteShift = canReset;

  /** Whether this user can open `shift` for editing — its person has to be theirs to roster. */
  const canEditShift = (shift) => {
    if (!isManager) return false;
    const owned = departmentsFor(user?.role);
    return owned.length === 0 || owned.includes(shift.employee?.department);
  };

  /**
   * Who this user may actually roster.
   *
   * A Head Chef schedules Kitchen, a Master of House Service and Housekeeping.
   * The server refuses the rest either way — this only keeps the picker from
   * offering a choice that is going to come back a 403. `departmentsFor`
   * returns [] for every other role, which is why the length check, not the
   * role name, decides.
   */
  const rosterableEmployees = useMemo(() => {
    const owned = departmentsFor(user?.role);
    if (owned.length === 0) return employees;
    return employees.filter((e) => owned.includes(e.department));
  }, [employees, user?.role]);

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
      const [shifts, leaves] = await Promise.all([
        api.get(`/shifts?outlet=${selectedOutletId}&startDate=${start}&endDate=${end}`),
        api.get(`/leaves?status=APPROVED&startDate=${start}&endDate=${end}`),
      ]);
      setWeekShifts(shifts);
      setWeekLeaves(leaves);
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

  /**
   * What a reset would destroy, for the confirmation.
   *
   * Gated on canReset rather than only hiding the button, or every head chef
   * and staff member would fire a 403 on each restaurant switch. Failures are
   * swallowed to null: the preview is advisory, and a page that cannot count
   * the roster should hide the button rather than break.
   */
  const loadResetPreview = useCallback(async () => {
    if (!canReset || !selectedOutletId) { setResetPreview(null); return; }
    try {
      setResetPreview(await api.get(`/shifts/stats/reset-preview?outlet=${selectedOutletId}`));
    } catch (err) {
      console.error(err);
      setResetPreview(null);
    }
  }, [canReset, selectedOutletId]);

  useEffect(() => { loadOutletData(); }, [loadOutletData]);
  useEffect(() => { loadWeek(); }, [loadWeek]);
  useEffect(() => { loadDay(); }, [loadDay]);
  useEffect(() => { loadResetPreview(); }, [loadResetPreview]);

  // Switching restaurant invalidates both previous results.
  useEffect(() => {
    setAllocationSummary(null);
    setResetResult(null);
  }, [selectedOutletId]);

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
      let bucket = buckets.get(
        slotKey(s.startTime, s.endTime, s.section, s.employee?.department)
      );
      // A shift carries no department of its own — it is inferred from whoever
      // works it. That breaks for a department head covering outside the
      // section they personally work: a Master of House stored Service filling
      // a Housekeeping slot produced a key matching no bucket, so the row read
      // "0/2 unfilled" while the allocation banner above said it was filled.
      // Widened only for the departments their role owns, so two same-time
      // same-section patterns in different departments still cannot merge.
      if (!bucket) {
        for (const d of departmentsFor(s.employee?.role)) {
          bucket = buckets.get(slotKey(s.startTime, s.endTime, s.section, d));
          if (bucket) break;
        }
      }
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
      setResetResult(null);
      loadWeek();
      loadDay();
      // The roster just changed, so the reset count on screen is now wrong.
      loadResetPreview();
    } catch (err) {
      alert(err.message || 'Auto-allocation failed');
    } finally {
      setAllocating(false);
    }
  };

  const openResetModal = () => {
    setResetError(null);
    // Re-read rather than trusting whatever was fetched on the last restaurant
    // switch: the number in a confirmation should be as fresh as it can be.
    loadResetPreview();
    setResetModalOpen(true);
  };

  const handleReset = async () => {
    setResetting(true);
    setResetError(null);
    try {
      const res = await api.post('/shifts/reset', { outletId: selectedOutletId });
      setResetModalOpen(false);
      // From the server's response, never the preview — the two can disagree if
      // anything changed while the dialog was open.
      setResetResult(res);
      // "Created 42 of 42 slots" above an empty grid contradicts itself.
      setAllocationSummary(null);
      loadWeek();
      loadDay();
      loadResetPreview();
    } catch (err) {
      setResetError(err.message || 'Reset failed');
    } finally {
      setResetting(false);
    }
  };

  const openShiftModal = (dateObj) => {
    const first = rosterableEmployees[0];
    setShiftForm({
      id: null,
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

  /** The same form, filled from an existing shift, saving with PUT instead. */
  const openEditShift = (shift) => {
    setShiftForm({
      id: shift.id,
      date: dayKey(new Date(shift.date)),
      startTime: shift.startTime,
      endTime: shift.endTime,
      // Matched back to the list's capitalisation — some shifts store it lowercase,
      // which would otherwise select nothing.
      section: STATIONS.find((st) => st.toLowerCase() === normSection(shift.section)) || shift.section || '',
      employeeId: shift.employee?.id || shift.employeeId,
      outletId: selectedOutletId,
      originalName: shift.employee?.name,
    });
    setShiftModalOpen(true);
  };

  const refreshRoster = () => {
    loadWeek();
    loadDay();
    loadResetPreview();
  };

  const saveShift = async (e) => {
    e.preventDefault();
    const { id, originalName, ...body } = shiftForm;
    const send = (extra = {}) => (id
      ? api.put(`/shifts/${id}`, { ...body, ...extra })
      : api.post('/shifts', { ...body, ...extra }));
    try {
      try {
        await send();
      } catch (err) {
        // Approved leave or a weekly off is the one refusal a manager can
        // overrule: calling someone in takes that day off their leave.
        if (err.code !== 'ON_LEAVE') throw err;
        if (!window.confirm(`${err.message}.\n\nCall them in? That day will be taken off their leave, and they will be notified.`)) return;
        await send({ overrideLeave: true });
      }
      setShiftModalOpen(false);
      refreshRoster();
    } catch (err) {
      alert(err.message || (id ? 'Failed to update shift' : 'Failed to create shift'));
    }
  };

  const deleteShift = async () => {
    const who = shiftForm.originalName || 'this person';
    if (!window.confirm(`Delete ${who}'s shift on ${shiftForm.date}? This cannot be undone.`)) return;
    try {
      await api.delete(`/shifts/${shiftForm.id}`);
      setShiftModalOpen(false);
      refreshRoster();
    } catch (err) {
      alert(err.message || 'Failed to delete shift');
    }
  };

  /** Who the Add Shift modal is currently assigning to — their department decides
      whether a station applies. */
  const shiftEmployee = employees.find((e) => e.id === shiftForm?.employeeId) || null;

  const shiftsForDay = (day) => weekShifts.filter((s) => isSameDay(new Date(s.date), day));
  const getSection = (section) => (section ? section.toLowerCase() : 'unassigned');

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
            {/* Hidden when there is nothing to delete, the same way Shift
                Master hides its Clear all. btn-ghost with a red icon rather
                than btn-danger: on a phone these buttons go two-up, and a
                full-width red one directly under Add Shift invites the
                mis-tap it is meant to prevent. */}
            {canReset && resetPreview?.total > 0 && (
              <button className="btn btn-ghost icon-crit" onClick={openResetModal}>
                <Eraser size={16} />
                <span>Reset Shifts</span>
              </button>
            )}
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
          {outlet?.brand?.name && user?.role !== 'STAFF' && (
            <span className="badge badge-ghost">{outlet.brand.name}</span>
          )}
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

      {/* Counts come from the reset response, not from resetPreview — the
          preview is what we *expected* to delete, this is what went. */}
      {resetResult && (
        <div className="card mb-4 card--alert-warn">
          <div className="flex items-start gap-3">
            <Trash2 size={20} className="icon-crit" />
            <div style={{ minWidth: 0 }}>
              <h3 className="font-bold text-sm" style={{ color: 'var(--ink-warn)' }}>
                Cleared {resetResult.shifts} shift{resetResult.shifts === 1 ? '' : 's'} at {resetResult.outletName}
              </h3>
              <p className="text-xs text-secondary">
                {resetResult.autoLeaves} auto-assigned weekly off
                {resetResult.autoLeaves === 1 ? '' : 's'} and {resetResult.notifications} shift
                notification{resetResult.notifications === 1 ? '' : 's'} went with them.
                Run Auto-Allocate Week to rebuild the roster.
              </p>
            </div>
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
                        shifts.map((s) => canEditShift(s) ? (
                          <button key={s.id} type="button" className="badge badge-ghost name-button"
                            onClick={() => openEditShift(s)} title={`Edit ${s.employee?.name}'s shift`}>
                            {s.employee?.name}
                          </button>
                        ) : (
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
                  {coverage.unmatched.map((s) => canEditShift(s) ? (
                    <button key={s.id} type="button" className="badge badge-ghost name-button"
                      onClick={() => openEditShift(s)} title={`Edit ${s.employee?.name}'s shift`}>
                      {s.employee?.name} · {s.startTime}–{s.endTime}
                    </button>
                  ) : (
                    <span key={s.id} className="badge badge-ghost" title={`${s.employee?.department} · ${s.section || s.employee?.department || 'Unassigned'}`}>
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
                    {(() => {
                      const groups = new Map();
                      for (const s of dShifts) {
                        // Grouped by the slot itself, not by who is filling it —
                        // a head covering another department would otherwise
                        // split one slot into two blocks in the same cell.
                        const key = slotKey(s.startTime, s.endTime, s.section, '');
                        if (!groups.has(key)) {
                          groups.set(key, { section: s.section, startTime: s.startTime, endTime: s.endTime, shifts: [] });
                        }
                        groups.get(key).shifts.push(s);
                      }
                      return groups.size > 0 ? [...groups.values()].map((g) => (
                        <div
                          key={`${g.startTime}-${g.endTime}-${normSection(g.section)}`}
                          className="calendar-shift"
                          data-section={getSection(g.section)}
                          title={g.shifts.map((s) => s.employee?.name).join(', ')}
                        >
                          <div className="font-semibold truncate text-xs text-strong">
                            {g.section || g.shifts[0]?.employee?.department || 'Unassigned'}
                          </div>
                          <div className="text-2xs text-muted">
                            {g.startTime} – {g.endTime} · {g.shifts.length}
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {g.shifts.map((s) => canEditShift(s) ? (
                              <button
                                key={s.id}
                                type="button"
                                className="name-button text-2xs"
                                style={{ opacity: 0.85 }}
                                onClick={() => openEditShift(s)}
                                title={`Edit ${s.employee?.name}'s shift`}
                              >
                                {s.employee?.name}
                              </button>
                            ) : (
                              <span key={s.id} className="text-2xs" style={{ opacity: 0.85 }}>
                                {s.employee?.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )) : (
                        <div className="text-2xs text-muted text-center py-4">No shifts</div>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ============ 3 · LEAVE SCHEDULE ============ */}
      {weekLeaves.length > 0 && (
      <div className="card mb-4" data-section="leaves">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <Calendar size={17} className="icon-brand" />
            <h3 className="card-title">Leave Schedule</h3>
          </div>
          <span className="text-xs text-muted">{weekLeaves.length} approved this week</span>
        </div>
        <div className="shift-calendar">
          {weekDays.map((day) => {
            const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);
            const dayLeaves = weekLeaves.filter(l => {
              const ls = new Date(l.startDate);
              const le = new Date(l.endDate);
              return ls <= dayEnd && le >= dayStart;
            });

            const byStation = new Map();
            for (const l of dayLeaves) {
              const stations = l.employee?.skills?.length ? l.employee.skills : [l.employee?.department || 'Unassigned'];
              for (const st of stations) {
                const key = st.charAt(0).toUpperCase() + st.slice(1).toLowerCase();
                if (!byStation.has(key)) byStation.set(key, []);
                byStation.get(key).push(l);
              }
            }

            return (
              <div key={day.toISOString()} className="calendar-day">
                <div>
                  <span className="calendar-day-header">{format(day, 'eee')}</span>
                  <div className="calendar-day-number">{format(day, 'd')}</div>
                </div>
                <div className="text-2xs text-muted mb-1">
                  {dayLeaves.length} off
                </div>
                <div className="flex flex-col gap-1">
                  {byStation.size > 0 ? [...byStation.entries()].map(([station, leaves]) => (
                    <div key={station} className="calendar-shift" data-section={station.toLowerCase()} style={{ borderLeft: '3px solid var(--primary-400)' }}>
                      <div className="font-semibold truncate text-xs text-strong">{station}</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {leaves.map(l => canManageLeaveOf(user, l.employee) && user?.role !== 'OUTLET_MANAGER' ? (
                          <button
                            key={l.id}
                            type="button"
                            className="name-button text-2xs"
                            style={{ opacity: 0.85 }}
                            onClick={() => setEditingLeave(l)}
                            title={`Move or cancel ${l.employee?.name}'s leave`}
                          >
                            {l.employee?.name}{!l.approvedBy ? ' ✓' : ''}
                          </button>
                        ) : (
                          <span key={l.id} className="text-2xs" style={{ opacity: 0.85 }}>
                            {l.employee?.name}{!l.approvedBy ? ' ✓' : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  )) : (
                    <div className="text-2xs text-muted text-center py-2">—</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* ---- Add shift ---- */}
      <Modal
        isOpen={isShiftModalOpen}
        onClose={() => setShiftModalOpen(false)}
        title={`${shiftForm?.id ? 'Edit shift' : 'Add shift'} · ${outlet?.name || ''}`}
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
                {rosterableEmployees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name} ({e.department})</option>
                ))}
                {/* A shift can belong to someone no longer on the list — since
                    deactivated, say. Kept selectable so opening it for a time
                    change does not silently hand it to whoever is first. */}
                {shiftForm.id && !rosterableEmployees.some((e) => e.id === shiftForm.employeeId) && (
                  <option value={shiftForm.employeeId}>{shiftForm.originalName || 'Current assignee'}</option>
                )}
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
              {/* A warning, not a block: placing someone by hand is a deliberate
                  choice. Auto-allocation is what holds to the station rule. */}
              {shiftEmployee && shiftForm.section
                && departmentHasStations(shiftEmployee.department)
                && !(shiftEmployee.skills || []).includes(shiftForm.section.toLowerCase()) && (
                <p className="text-xs mt-1" style={{ color: 'var(--ink-warn)' }}>
                  {shiftForm.section} is not one of {shiftEmployee.name}'s stations
                  {shiftEmployee.skills?.length ? ` (${shiftEmployee.skills.join(', ')})` : ''}.
                </p>
              )}
            </div>

            <div className="modal-footer" style={{ padding: 0, marginTop: 'var(--space-4)' }}>
              {shiftForm.id && canDeleteShift && (
                <button type="button" className="btn btn-ghost" style={{ color: 'var(--ink-crit)', marginRight: 'auto' }}
                  onClick={deleteShift}>
                  <Trash2 size={16} />
                  <span>Delete</span>
                </button>
              )}
              <button type="button" className="btn btn-ghost" onClick={() => setShiftModalOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">{shiftForm.id ? 'Save changes' : 'Add Shift'}</button>
            </div>
          </form>
        )}
      </Modal>

      <LeaveFormModal
        isOpen={Boolean(editingLeave)}
        onClose={() => setEditingLeave(null)}
        onSaved={refreshRoster}
        leave={editingLeave}
      />

      <Modal
        isOpen={isResetModalOpen}
        onClose={() => setResetModalOpen(false)}
        title={`Reset shifts · ${outlet?.name || ''}`}
      >
        <p className="text-sm text-secondary">
          This deletes the whole roster at this restaurant — every shift, for all
          time, whatever its status. Shift patterns are kept, so Auto-Allocate
          Week can rebuild it.
        </p>

        <div className="divided-list mt-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-secondary">Shifts</span>
            <span className="font-semibold text-strong" style={{ marginLeft: 'auto' }}>
              {resetPreview?.total ?? '—'}
            </span>
          </div>
          {/* The confirmation has to name these too: they are approved leave that
              staff can see on the Leave Schedule card below, so deleting them
              silently under a button labelled "shifts" would not be truthful. */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-secondary">Auto-assigned weekly offs</span>
            <span className="font-semibold text-strong" style={{ marginLeft: 'auto' }}>
              {resetPreview?.autoLeaves ?? '—'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-secondary">Shift notifications</span>
            <span className="font-semibold text-strong" style={{ marginLeft: 'auto' }}>
              {resetPreview?.notifications ?? '—'}
            </span>
          </div>
          {resetPreview?.earliest && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-secondary">Covering</span>
              <span className="font-semibold text-strong" style={{ marginLeft: 'auto' }}>
                {format(parseISO(resetPreview.earliest), 'd MMM yyyy')}
                {' – '}
                {format(parseISO(resetPreview.latest), 'd MMM yyyy')}
              </span>
            </div>
          )}
        </div>

        {/* Re-allocation restores assigned shifts but never history, and the
            dashboard counts completed shifts for its attendance trend. */}
        {resetPreview?.completed > 0 && (
          <div className="card card--alert-warn mt-4">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="icon-warn" />
              <p className="text-xs" style={{ color: 'var(--ink-warn)' }}>
                {resetPreview.completed} of these are completed or missed shifts.
                Auto-allocation cannot bring those back, and the dashboard counts
                them for its attendance history — its trend for this restaurant
                will show gaps.
              </p>
            </div>
          </div>
        )}

        {resetError && <p className="text-xs mt-3" style={{ color: 'var(--ink-crit)' }}>{resetError}</p>}

        <div className="modal-footer" style={{ padding: 0, marginTop: 'var(--space-4)' }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setResetModalOpen(false)}
            disabled={resetting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleReset}
            disabled={resetting || !resetPreview?.total}
          >
            <Trash2 size={16} />
            <span>
              {resetting ? 'Resetting…' : `Delete ${resetPreview?.total ?? 0} shifts`}
            </span>
          </button>
        </div>
      </Modal>

    </div>
  );
}
