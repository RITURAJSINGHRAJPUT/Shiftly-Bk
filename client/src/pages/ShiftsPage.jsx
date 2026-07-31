import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useScope } from '../contexts/ScopeContext';
import Modal from '../components/Modal';
import { format, startOfWeek, endOfWeek, addDays, isSameDay, isToday, parseISO } from 'date-fns';
import {
  Calendar, CalendarDays, Plus, RefreshCw, CheckCircle2, AlertTriangle,
  Layers, Users, Pencil, Trash2, Store, ChevronLeft, ChevronRight,
} from 'lucide-react';

const SECTIONS = ['Pizza', 'Pasta', 'Drinks', 'Sushi', 'Wok', 'Side', 'Pass'];
const DEPARTMENTS = ['KITCHEN', 'SERVICE', 'HOUSEKEEPING'];

const emptyPattern = {
  name: '',
  department: 'KITCHEN',
  section: '',
  startTime: '12:00',
  endTime: '21:00',
  headcount: 1,
};

/** YYYY-MM-DD from local parts — never toISOString(), which shifts the day. */
const dayKey = (d) => format(d, 'yyyy-MM-dd');

/** Sections are stored capitalised on patterns, lowercase on some shifts. */
const normSection = (s) => (s ? String(s).toLowerCase().trim() : 'general');

/** Identity of a staffing slot: same hours, same station, same department. */
const slotKey = (startTime, endTime, section, department) =>
  `${startTime}|${endTime}|${normSection(section)}|${department}`;

export default function ShiftsPage() {
  const { user, isManager } = useAuth();
  const { outlets, outletId: scopeOutletId, locked } = useScope();

  /**
   * Planning happens for one restaurant at a time.
   *
   * Local state rather than the global scope: clicking a tab here should not
   * silently re-filter Employees, Attendance and Reports. The top bar still
   * seeds and updates it (one-way, below).
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

  const [isPatternModalOpen, setPatternModalOpen] = useState(false);
  const [editingPattern, setEditingPattern] = useState(null);
  const [patternForm, setPatternForm] = useState(emptyPattern);
  const [patternError, setPatternError] = useState('');
  const [savingPattern, setSavingPattern] = useState(false);

  const outlet = outlets.find((o) => o.id === selectedOutletId) || null;

  // Seed the selection, and follow the top bar when it changes.
  useEffect(() => {
    if (outlets.length === 0) return;
    const preferred =
      scopeOutletId ||
      (outlets.some((o) => o.id === user?.outletId) ? user.outletId : '') ||
      outlets[0].id;
    setSelectedOutletId((prev) => (prev && !scopeOutletId ? prev : preferred));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlets, scopeOutletId]);

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
  const slotsPerDay = activeTemplates.reduce((sum, t) => sum + t.headcount, 0);

  /**
   * Group the selected day's shifts under the pattern each one fills.
   *
   * Shifts matching no pattern are kept in their own bucket rather than dropped:
   * the seeder generated ad-hoc times that correspond to no pattern, so this is
   * real content, and it doubles as a view of scheduling outside the plan.
   */
  const coverage = useMemo(() => {
    const buckets = new Map();
    activeTemplates.forEach((t) => {
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
  }, [dayShifts, activeTemplates]);

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
    setShiftForm({
      date: dayKey(dateObj || selectedDay),
      startTime: '12:00',
      endTime: '21:00',
      section: 'Pizza',
      employeeId: employees[0]?.id || '',
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

  const openPatternModal = (pattern) => {
    setEditingPattern(pattern);
    setPatternForm(
      pattern
        ? {
            name: pattern.name,
            department: pattern.department,
            section: pattern.section || '',
            startTime: pattern.startTime,
            endTime: pattern.endTime,
            headcount: pattern.headcount,
          }
        : emptyPattern
    );
    setPatternError('');
    setPatternModalOpen(true);
  };

  const savePattern = async (e) => {
    e.preventDefault();
    setSavingPattern(true);
    setPatternError('');
    try {
      const body = {
        ...patternForm,
        outletId: selectedOutletId,
        headcount: Number(patternForm.headcount),
      };
      if (editingPattern) await api.put(`/shift-templates/${editingPattern.id}`, body);
      else await api.post('/shift-templates', body);
      setPatternModalOpen(false);
      loadOutletData();
    } catch (err) {
      setPatternError(err.message || 'Failed to save pattern');
    } finally {
      setSavingPattern(false);
    }
  };

  const deletePattern = async (pattern) => {
    if (!window.confirm(`Delete the "${pattern.name}" pattern? Existing shifts are kept.`)) return;
    try {
      await api.delete(`/shift-templates/${pattern.id}`);
      loadOutletData();
    } catch (err) {
      alert(err.message || 'Failed to delete pattern');
    }
  };

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
            Plan one restaurant at a time — patterns, then today, then the week
          </p>
        </div>
        {isManager && (
          <div className="flex gap-2">
            <button
              className="btn btn-accent"
              onClick={handleAutoAllocate}
              disabled={allocating || slotsPerDay === 0}
              title={slotsPerDay === 0 ? 'Define shift patterns for this outlet first' : undefined}
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
      {slotsPerDay === 0 && !loading && (
        <div className="card card--alert-crit mb-4">
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} className="icon-crit" />
            <p className="text-sm text-secondary">
              <strong>{outlet?.name}</strong> has no shift patterns, so auto-allocation
              has nothing to fill. Add one below.
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

      {/* ============ 1 · SHIFT PATTERNS ============ */}
      <div className="card mb-4" data-section="patterns">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <Layers size={17} className="icon-brand" />
            <h3 className="card-title">Shift Patterns</h3>
            <span className="badge badge-ghost">{outlet?.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">
              {activeTemplates.length} patterns · {slotsPerDay} slots/day · {employees.length} staff
            </span>
            {isManager && (
              <button className="btn btn-ghost btn-sm" onClick={() => openPatternModal(null)}>
                <Plus size={14} />
                <span>Add Pattern</span>
              </button>
            )}
          </div>
        </div>

        <p className="text-xs text-muted mb-3">
          Each pattern is a recurring requirement — station, hours and how many people
          it needs. Auto-allocation fills every slot for each day of the week.
        </p>

        {templates.length === 0 ? (
          <div className="empty-state py-6">
            <Layers size={40} className="empty-icon" />
            <h3>No patterns yet</h3>
            <p>Add the stations and shifts this restaurant runs.</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Pattern</th>
                  <th>Department</th>
                  <th>Station</th>
                  <th>Hours</th>
                  <th>Needed</th>
                  {isManager && <th />}
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} style={{ opacity: t.isActive ? 1 : 0.5 }}>
                    <td>
                      <span className="font-semibold text-strong">{t.name}</span>
                      {!t.isActive && <span className="badge badge-ghost ml-2">Inactive</span>}
                    </td>
                    <td>
                      <span className={`badge ${
                        t.department === 'KITCHEN' ? 'badge-warn'
                        : t.department === 'SERVICE' ? 'badge-primary' : 'badge-accent'
                      }`}>
                        {t.department}
                      </span>
                    </td>
                    <td>{t.section || <span className="text-muted">General</span>}</td>
                    <td>{t.startTime} – {t.endTime}</td>
                    <td>
                      <span className="flex items-center gap-1">
                        <Users size={13} className="icon-muted" />
                        <strong>{t.headcount}</strong>
                      </span>
                    </td>
                    {isManager && (
                      <td>
                        <div className="flex gap-1">
                          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openPatternModal(t)} aria-label={`Edit ${t.name}`}>
                            <Pencil size={13} />
                          </button>
                          <button className="btn btn-ghost btn-sm btn-icon" style={{ color: 'var(--ink-crit)' }} onClick={() => deletePattern(t)} aria-label={`Delete ${t.name}`}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ============ 2 · DAILY COVERAGE ============ */}
      <div className="card mb-4" data-section="daily">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <Calendar size={17} className="icon-brand" />
            <h3 className="card-title">{format(selectedDay, 'EEEE, d MMMM')}</h3>
            {isToday(selectedDay) && <span className="badge badge-primary">Today</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">
              {coverage.filled} of {slotsPerDay} slots filled · {dayShifts.length} shifts
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
            <p>Define shift patterns above to measure this day against them.</p>
          </div>
        ) : (
          <>
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

      {/* ============ 3 · WEEKLY ============ */}
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

                  <div className="text-2xs text-muted mb-1">
                    {dShifts.length}/{slotsPerDay}
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
                onChange={(e) => setShiftForm((p) => ({ ...p, employeeId: e.target.value }))}
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
              <select className="form-select" value={shiftForm.section}
                onChange={(e) => setShiftForm((p) => ({ ...p, section: e.target.value }))}>
                <option value="">General (Service / Housekeeping)</option>
                {SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div className="modal-footer" style={{ padding: 0, marginTop: 'var(--space-4)' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShiftModalOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Add Shift</button>
            </div>
          </form>
        )}
      </Modal>

      {/* ---- Add / edit pattern ---- */}
      <Modal
        isOpen={isPatternModalOpen}
        onClose={() => setPatternModalOpen(false)}
        title={`${editingPattern ? 'Edit' : 'Add'} pattern · ${outlet?.name || ''}`}
      >
        <form onSubmit={savePattern} className="flex flex-col gap-4">
          {patternError && <div className="login-error">{patternError}</div>}

          <div className="form-group">
            <label className="form-label">Pattern name</label>
            <input
              className="form-input"
              placeholder="e.g. Pizza Station"
              value={patternForm.name}
              onChange={(e) => setPatternForm((p) => ({ ...p, name: e.target.value }))}
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Department</label>
              <select className="form-select" value={patternForm.department}
                onChange={(e) => setPatternForm((p) => ({ ...p, department: e.target.value }))}>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Station</label>
              <select className="form-select" value={patternForm.section}
                onChange={(e) => setPatternForm((p) => ({ ...p, section: e.target.value }))}>
                <option value="">General</option>
                {SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Start</label>
              <input type="time" className="form-input" value={patternForm.startTime}
                onChange={(e) => setPatternForm((p) => ({ ...p, startTime: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label className="form-label">End</label>
              <input type="time" className="form-input" value={patternForm.endTime}
                onChange={(e) => setPatternForm((p) => ({ ...p, endTime: e.target.value }))} required />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">People needed per day</label>
            <input
              type="number"
              min="1"
              max="99"
              className="form-input"
              value={patternForm.headcount}
              onChange={(e) => setPatternForm((p) => ({ ...p, headcount: e.target.value }))}
              required
            />
            <p className="text-xs text-muted mt-1">
              Auto-allocation creates this many shifts for this pattern on each day.
            </p>
          </div>

          <div className="modal-footer" style={{ padding: 0, marginTop: 'var(--space-4)' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setPatternModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={savingPattern}>
              {savingPattern ? 'Saving…' : 'Save Pattern'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
