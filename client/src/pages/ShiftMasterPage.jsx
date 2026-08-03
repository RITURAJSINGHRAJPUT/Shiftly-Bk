import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import Modal from '../components/Modal';
import Switch from '../components/Switch';
import { useAuth } from '../contexts/AuthContext';
import { useScope } from '../contexts/ScopeContext';
import {
  WEEKDAYS, ALL_WEEKDAYS, formatDays, STATIONS, DEPARTMENTS, departmentHasStations,
} from '../constants';
import { Layers, Plus, Pencil, Trash2, Store, Users, AlertTriangle, CalendarClock, Eraser } from 'lucide-react';

/** Typed verbatim before a whole restaurant's patterns are cleared. */
const CLEAR_CONFIRMATION = 'CLEAR PATTERNS';

const emptyPattern = {
  name: '',
  department: 'KITCHEN',
  section: '',
  startTime: '12:00',
  endTime: '21:00',
  headcount: 1,
  isActive: true,
  daysOfWeek: ALL_WEEKDAYS,
};

/** Slots this pattern asks for across a week — headcount on each day it runs. */
const weeklySlots = (t) => t.headcount * (t.daysOfWeek?.length ?? 7);

/**
 * Where shift patterns are defined. Shift Planning consumes them read-only.
 *
 * A pattern is a recurring daily requirement — station, hours, how many people —
 * and it is the only input auto-allocation has. The allocator queries
 * `{ outletId, isActive: true }`, so deactivating one here removes it from
 * planning without deleting the definition or the shifts already generated.
 *
 * One outlet at a time, matching Shift Planning's tab strip, so the two pages
 * agree on which restaurant you are looking at.
 */
export default function ShiftMasterPage() {
  const { user, isManager } = useAuth();
  const { outlets, locked } = useScope();

  const [selectedOutletId, setSelectedOutletId] = useState('');
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [isModalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyPattern);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

  const [clearOpen, setClearOpen] = useState(false);
  const [clearPreview, setClearPreview] = useState(null);
  const [clearShifts, setClearShifts] = useState(false);
  const [typed, setTyped] = useState('');
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState('');
  const [clearResult, setClearResult] = useState(null);

  /** Outlet ids the create form will write to. Reset each time it opens. */
  const [targetOutletIds, setTargetOutletIds] = useState([]);
  const [saveResult, setSaveResult] = useState(null);

  const outlet = outlets.find((o) => o.id === selectedOutletId) || null;

  /**
   * Outlets this user may actually write to.
   *
   * GET /outlets applies no scope, so a locked role's browser holds the whole
   * directory — offering all seven here would just produce a 403 on save.
   */
  const writableOutlets = useMemo(
    () => (locked ? outlets.filter((o) => o.id === user?.outletId) : outlets),
    [outlets, locked, user?.outletId]
  );

  // Seed from the user's own outlet, falling back to the first.
  useEffect(() => {
    if (outlets.length === 0) return;
    const preferred =
      (outlets.some((o) => o.id === user?.outletId) ? user.outletId : '') || outlets[0].id;
    setSelectedOutletId((prev) => prev || preferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlets]);

  const load = useCallback(async () => {
    if (!selectedOutletId) return;
    setLoading(true);
    setError('');
    try {
      setTemplates(await api.get(`/shift-templates?outlet=${selectedOutletId}`));
    } catch (err) {
      setError(err.message || 'Failed to load patterns');
    } finally {
      setLoading(false);
    }
  }, [selectedOutletId]);

  /**
   * How much a clear would destroy at this outlet.
   *
   * Separate from `load` because it is manager-only — the endpoint is guarded at
   * HEAD_CHEF, so a staff view calling it would just collect a 403 — and because
   * the shift count is not derivable from anything already on the page.
   */
  const loadClearPreview = useCallback(async () => {
    if (!selectedOutletId || !isManager) return setClearPreview(null);
    try {
      setClearPreview(await api.get(`/shift-templates/clear-preview?outlet=${selectedOutletId}`));
    } catch {
      // Non-fatal: the button simply stays disabled rather than the page failing.
      setClearPreview(null);
    }
  }, [selectedOutletId, isManager]);

  useEffect(() => { load(); }, [load]);
  // Also reset the banner: a result reading "cleared 8 patterns" would otherwise
  // follow you to the next restaurant, which never had them.
  useEffect(() => { loadClearPreview(); setClearResult(null); }, [loadClearPreview]);

  const activeTemplates = useMemo(() => templates.filter((t) => t.isActive), [templates]);
  // Weekly, not daily: with patterns that run on different days, a single
  // per-day figure describes no actual day.
  const slotsPerWeek = activeTemplates.reduce((sum, t) => sum + weeklySlots(t), 0);

  const openModal = (pattern) => {
    setEditing(pattern);
    setForm(
      pattern
        ? {
            name: pattern.name,
            department: pattern.department,
            section: pattern.section || '',
            startTime: pattern.startTime,
            endTime: pattern.endTime,
            headcount: pattern.headcount,
            isActive: pattern.isActive,
            // Rows written before daysOfWeek existed carry the field by default,
            // but a stale cached response would not.
            daysOfWeek: pattern.daysOfWeek ?? ALL_WEEKDAYS,
          }
        : emptyPattern
    );
    // A new pattern defaults to every outlet you can write to — the common case
    // is one standard applied across the group. Editing writes to one row only.
    setTargetOutletIds(writableOutlets.map((o) => o.id));
    setFormError('');
    setSaveResult(null);
    setModalOpen(true);
  };

  const toggleDay = (value) =>
    setForm((p) => ({
      ...p,
      daysOfWeek: p.daysOfWeek.includes(value)
        ? p.daysOfWeek.filter((d) => d !== value)
        : [...p.daysOfWeek, value],
    }));

  const toggleTargetOutlet = (id) =>
    setTargetOutletIds((prev) => (prev.includes(id) ? prev.filter((o) => o !== id) : [...prev, id]));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const body = { ...form, headcount: Number(form.headcount) };

      if (editing) {
        await api.put(`/shift-templates/${editing.id}`, body);
        setSaveResult(null);
      } else {
        // Always the bulk endpoint, even for one outlet: a single code path
        // means the one-outlet case cannot drift from the many-outlet one.
        const res = await api.post('/shift-templates/bulk', { ...body, outletIds: targetOutletIds });
        setSaveResult(res);
        // Follow the pattern to where it landed, so a save at an outlet you were
        // not looking at is not silently invisible.
        if (res.created.length > 0 && !res.created.some((t) => t.outletId === selectedOutletId)) {
          setSelectedOutletId(res.created[0].outletId);
        }
      }

      setModalOpen(false);
      load();
      loadClearPreview();
    } catch (err) {
      setFormError(err.message || 'Failed to save pattern');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (pattern) => {
    if (!window.confirm(`Delete the "${pattern.name}" pattern? Shifts already created are kept.`)) return;
    try {
      await api.delete(`/shift-templates/${pattern.id}`);
      load();
      loadClearPreview();
    } catch (err) {
      alert(err.message || 'Failed to delete pattern');
    }
  };

  const openClear = () => {
    setTyped('');
    setClearShifts(false);
    setClearError('');
    setClearResult(null);
    loadClearPreview();
    setClearOpen(true);
  };

  /**
   * Wipe this outlet's patterns, and optionally the shifts allocated from them.
   *
   * Shifts are opt-in: a shift stores its own times and section, so it survives
   * the pattern it came from — but it then matches nothing, and Shift Planning
   * files it under "not covered by a pattern". Clearing both is the clean slate;
   * clearing patterns alone keeps a published roster intact while it is redrawn.
   */
  const clearPatterns = async () => {
    setClearing(true);
    setClearError('');
    try {
      const res = await api.post('/shift-templates/clear', {
        outletId: selectedOutletId,
        confirm: CLEAR_CONFIRMATION,
        includeShifts: clearShifts,
      });
      setClearResult(res);
      setClearOpen(false);
      setTyped('');
      load();
      loadClearPreview();
    } catch (err) {
      setClearError(err.message || 'Failed to clear patterns');
    } finally {
      setClearing(false);
    }
  };

  /**
   * Deactivating takes a pattern out of allocation without destroying it — the
   * allocator filters on isActive, so this is the reversible alternative to
   * deleting. PUT is partial, so only the flag is sent.
   */
  const toggleActive = async (pattern) => {
    setTogglingId(pattern.id);
    try {
      await api.put(`/shift-templates/${pattern.id}`, { isActive: !pattern.isActive });
      setTemplates((prev) =>
        prev.map((t) => (t.id === pattern.id ? { ...t, isActive: !t.isActive } : t))
      );
    } catch (err) {
      alert(err.message || 'Failed to update pattern');
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Shift Master</h1>
          <p className="page-subtitle">
            Define the stations, hours and headcount each restaurant runs — auto-allocation plans against these
          </p>
        </div>
        <Link to="/shifts" className="btn btn-ghost">
          <CalendarClock size={16} />
          <span>Shift Planning</span>
        </Link>
      </div>

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

      {error && <div className="login-error">{error}</div>}

      {/* An outlet with no active patterns cannot be planned at all, and that is
          otherwise invisible until someone runs allocation and gets nothing. */}
      {!loading && slotsPerWeek === 0 && (
        <div className="card card--alert-crit mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <AlertTriangle size={20} className="icon-crit" />
            <div>
              <h3 className="font-bold text-sm" style={{ color: 'var(--ink-crit)' }}>
                {outlet?.name} has no active shift patterns
              </h3>
              <p className="text-xs text-secondary">
                Auto-allocation has nothing to fill for this restaurant.
                {isManager ? ' Add a pattern below to start planning it.' : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <Layers size={17} className="icon-brand" />
            <h3 className="card-title">Shift Patterns</h3>
            {outlet && <span className="badge badge-ghost">{outlet.name}</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">
              {activeTemplates.length} active · {slotsPerWeek} slots/week
            </span>
            {/* Only offered when there is something to clear, so the danger
                button is absent on a restaurant that is already empty. */}
            {isManager && clearPreview?.patterns > 0 && (
              <button
                className="btn btn-ghost btn-sm icon-crit"
                onClick={openClear}
                title={`Delete every pattern at ${outlet?.name || 'this restaurant'}`}
              >
                <Eraser size={14} />
                <span>Clear all</span>
              </button>
            )}
            {isManager && (
              <button className="btn btn-primary btn-sm" onClick={() => openModal(null)}>
                <Plus size={14} />
                <span>Add Pattern</span>
              </button>
            )}
          </div>
        </div>

        {clearResult && (
          <p className="text-sm mb-3" style={{ color: 'var(--ink-good)' }}>
            Cleared {clearResult.patterns} pattern{clearResult.patterns === 1 ? '' : 's'}
            {clearResult.shifts > 0 && ` and ${clearResult.shifts} shift${clearResult.shifts === 1 ? '' : 's'}`}
            {' '}at {outlet?.name}.
          </p>
        )}

        {/* A fan-out that skipped restaurants has to say so — otherwise "applied
            to all outlets" quietly means "applied to four of them". */}
        {saveResult && (
          <p className="text-sm mb-3" style={{ color: saveResult.created.length ? 'var(--ink-good)' : 'var(--ink-warn)' }}>
            {saveResult.created.length > 0
              ? `Created at ${saveResult.created.length} outlet${saveResult.created.length === 1 ? '' : 's'}`
              : 'Nothing created'}
            {saveResult.skipped.length > 0 && (
              <> · skipped {saveResult.skipped.map((s) => s.name).join(', ')} — {saveResult.skipped[0].reason}</>
            )}
          </p>
        )}

        {loading ? (
          <div className="text-center py-8 text-muted">Loading patterns…</div>
        ) : templates.length === 0 ? (
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
                  <th>Runs on</th>
                  <th>Needed</th>
                  <th>Active</th>
                  {isManager && <th />}
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} style={{ opacity: t.isActive ? 1 : 0.55 }}>
                    <td><span className="font-semibold text-strong">{t.name}</span></td>
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
                      <span className={t.daysOfWeek?.length === 7 ? 'text-muted' : 'font-semibold text-strong'}>
                        {formatDays(t.daysOfWeek)}
                      </span>
                    </td>
                    <td>
                      <span className="flex items-center gap-1">
                        <Users size={13} className="icon-muted" />
                        <strong>{t.headcount}</strong>
                        <span className="text-2xs text-muted">/day</span>
                      </span>
                    </td>
                    <td>
                      {isManager ? (
                        <Switch
                          checked={t.isActive}
                          onChange={() => toggleActive(t)}
                          label={`${t.isActive ? 'Deactivate' : 'Activate'} ${t.name}`}
                        />
                      ) : (
                        <span className="badge badge-ghost">{t.isActive ? 'Active' : 'Inactive'}</span>
                      )}
                    </td>
                    {isManager && (
                      <td>
                        <div className="flex gap-1">
                          <button
                            className="btn btn-ghost btn-sm btn-icon"
                            onClick={() => openModal(t)}
                            aria-label={`Edit ${t.name}`}
                            disabled={togglingId === t.id}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            className="btn btn-ghost btn-sm btn-icon icon-crit"
                            onClick={() => remove(t)}
                            aria-label={`Delete ${t.name}`}
                            disabled={togglingId === t.id}
                          >
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

      <Modal
        isOpen={isModalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit pattern · ${outlet?.name || ''}` : 'Add pattern'}
      >
        <form onSubmit={save} className="flex flex-col gap-4">
          {formError && <div className="login-error">{formError}</div>}

          <div className="form-group">
            <label className="form-label" htmlFor="pattern-name">Pattern name</label>
            <input
              id="pattern-name"
              className="form-input"
              placeholder="e.g. Pizza Station"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="pattern-dept">Department</label>
              <select
                id="pattern-dept"
                className="form-select"
                value={form.department}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    department: e.target.value,
                    // Cleared in the same update, not just disabled: a greyed-out
                    // select still holding "Wok" would save it.
                    section: departmentHasStations(e.target.value) ? p.section : '',
                  }))
                }
              >
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="pattern-section">Station</label>
              <select
                id="pattern-section"
                className="form-select"
                value={form.section}
                disabled={!departmentHasStations(form.department)}
                onChange={(e) => setForm((p) => ({ ...p, section: e.target.value }))}
              >
                <option value="">General</option>
                {STATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {!departmentHasStations(form.department) && (
                <p className="text-xs text-muted mt-1">Stations apply to kitchen patterns only.</p>
              )}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="pattern-start">Start</label>
              <input
                id="pattern-start"
                type="time"
                className="form-input"
                value={form.startTime}
                onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="pattern-end">End</label>
              <input
                id="pattern-end"
                type="time"
                className="form-input"
                value={form.endTime}
                onChange={(e) => setForm((p) => ({ ...p, endTime: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="pattern-headcount">People needed per day</label>
            <input
              id="pattern-headcount"
              type="number"
              min="1"
              max="99"
              className="form-input"
              value={form.headcount}
              onChange={(e) => setForm((p) => ({ ...p, headcount: e.target.value }))}
              required
            />
            <p className="text-xs text-muted mt-1">
              Auto-allocation creates this many shifts on each day the pattern runs.
            </p>
          </div>

          {/* To staff a station differently on a Friday, make it two patterns —
              "Pizza Weekday" Mon–Thu and "Pizza Weekend" Fri–Sun — rather than
              one pattern carrying seven headcounts. */}
          <fieldset className="form-group" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="form-label" style={{ padding: 0 }}>Runs on</legend>
            <div className="day-picker" role="group" aria-label="Days this pattern runs">
              {WEEKDAYS.map((d) => {
                const on = form.daysOfWeek.includes(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    className={`day-chip ${on ? 'is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() => toggleDay(d.value)}
                    title={d.label}
                  >
                    <span aria-hidden="true">{d.letter}</span>
                    <span className="sr-only">{d.label}</span>
                  </button>
                );
              })}
              <div className="flex gap-2" style={{ marginLeft: 'auto' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setForm((p) => ({ ...p, daysOfWeek: ALL_WEEKDAYS }))}
                >
                  Every day
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setForm((p) => ({ ...p, daysOfWeek: [1, 2, 3, 4] }))}
                >
                  Mon–Thu
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setForm((p) => ({ ...p, daysOfWeek: [5, 6, 0] }))}
                >
                  Fri–Sun
                </button>
              </div>
            </div>
            <p className="text-xs text-muted mt-1">
              {form.daysOfWeek.length === 0
                ? 'Pick at least one day.'
                : `${formatDays(form.daysOfWeek)} · ${Number(form.headcount) * form.daysOfWeek.length || 0} shifts a week per outlet`}
            </p>
          </fieldset>

          {/* Create only: editing targets one existing row, and relocating a
              pattern is not what this form is for. Hidden entirely when there is
              nothing to choose between, which is every locked role's view. */}
          {!editing && writableOutlets.length > 1 && (
            <fieldset className="form-group" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="form-label" style={{ padding: 0 }}>Create at</legend>

              <label className="flex items-center gap-2 text-sm mb-2">
                <input
                  type="checkbox"
                  checked={targetOutletIds.length === writableOutlets.length}
                  ref={(el) => {
                    if (el) el.indeterminate = targetOutletIds.length > 0
                      && targetOutletIds.length < writableOutlets.length;
                  }}
                  onChange={(e) =>
                    setTargetOutletIds(e.target.checked ? writableOutlets.map((o) => o.id) : [])
                  }
                />
                <strong>All outlets</strong>
              </label>

              <div className="outlet-picker">
                {writableOutlets.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={targetOutletIds.includes(o.id)}
                      onChange={() => toggleTargetOutlet(o.id)}
                    />
                    <span className="truncate" title={o.name}>{o.name}</span>
                  </label>
                ))}
              </div>

              <p className="text-xs text-muted mt-1">
                {targetOutletIds.length === 0
                  ? 'Pick at least one outlet.'
                  : `${targetOutletIds.length} pattern${targetOutletIds.length === 1 ? '' : 's'} will be created.` +
                    ' Outlets that already have a pattern with this name are skipped.'}
              </p>
            </fieldset>
          )}

          <div className="flex items-center gap-3">
            <span className="text-sm text-secondary flex-1">
              Active — inactive patterns are skipped by auto-allocation
            </span>
            <Switch
              checked={form.isActive}
              onChange={(v) => setForm((p) => ({ ...p, isActive: v }))}
              label="Pattern is active"
            />
          </div>

          <div className="flex gap-2" style={{ marginLeft: 'auto' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || form.daysOfWeek.length === 0 || (!editing && targetOutletIds.length === 0)}
            >
              {saving
                ? 'Saving…'
                : editing
                  ? 'Save Pattern'
                  : `Create at ${targetOutletIds.length} outlet${targetOutletIds.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={clearOpen}
        onClose={() => { setClearOpen(false); setTyped(''); setClearError(''); }}
        title={`Clear all patterns · ${outlet?.name || ''}`}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-secondary">
            This deletes{' '}
            <strong>
              {clearPreview?.patterns ?? 0} shift pattern{clearPreview?.patterns === 1 ? '' : 's'}
            </strong>{' '}
            at <strong>{outlet?.name}</strong>. Other restaurants are untouched. It cannot be undone.
          </p>

          {/* Opt-in, and only offered when there is a roster to lose. */}
          {clearPreview?.shifts > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={clearShifts}
                onChange={(e) => setClearShifts(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                Also delete the <strong>{clearPreview.shifts} shift{clearPreview.shifts === 1 ? '' : 's'}</strong>{' '}
                already planned here.
                <span className="text-muted">
                  {' '}Left in place they keep their own times, but match no pattern, so Shift
                  Planning lists them as uncovered.
                </span>
              </span>
            </label>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="clear-confirm">
              Type <code>{CLEAR_CONFIRMATION}</code> to continue
            </label>
            <input
              id="clear-confirm"
              className="form-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={CLEAR_CONFIRMATION}
              autoComplete="off"
            />
          </div>

          {clearError && (
            <p className="text-sm" style={{ color: 'var(--ink-crit)' }}>{clearError}</p>
          )}

          <div className="flex gap-2" style={{ marginLeft: 'auto' }}>
            <button
              className="btn btn-ghost"
              onClick={() => { setClearOpen(false); setTyped(''); }}
              disabled={clearing}
            >
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={clearPatterns}
              disabled={typed !== CLEAR_CONFIRMATION || clearing}
            >
              {clearing
                ? 'Clearing…'
                : `Delete ${clearPreview?.patterns ?? 0} pattern${clearPreview?.patterns === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
