import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import Modal from '../components/Modal';
import Switch from '../components/Switch';
import { useAuth } from '../contexts/AuthContext';
import { useScope } from '../contexts/ScopeContext';
import ShiftGrid, {
  templatesToCells, cellsToTemplates, incompleteRows, timeKey,
} from '../components/ShiftGrid';
import {
  WEEKDAYS, ALL_WEEKDAYS, formatDays, STATIONS, DEPARTMENTS, departmentHasStations,
  MIN_SHIFT_SLOTS, MAX_SHIFT_SLOTS, slotsUpTo, gridRows,
} from '../constants';
import {
  Layers, Plus, Pencil, Trash2, Store, Users, AlertTriangle, CalendarClock, Eraser,
  Save, CalendarRange, Copy, Settings2,
} from 'lucide-react';

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
  slot: 1,
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
  const { user, isManager, isAdmin } = useAuth();
  const { outlets, locked, refresh } = useScope();

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

  /**
   * The weekly sheet, in two halves: hours once per shift row, staff numbers per
   * day. Splitting them is what turns 21 inputs per row into 3.
   */
  const [times, setTimes] = useState({});
  const [counts, setCounts] = useState({});
  const [conflicts, setConflicts] = useState(new Set());
  /** Shift rows added by hand this session, over and above what the data needs. */
  const [addedSlots, setAddedSlots] = useState({});
  const [dirty, setDirty] = useState(false);
  const [gridSaving, setGridSaving] = useState(false);
  const [gridError, setGridError] = useState('');
  const [gridResult, setGridResult] = useState(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [stationsOpen, setStationsOpen] = useState(false);
  const [stationDraft, setStationDraft] = useState('');

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
      const rows = await api.get(`/shift-templates?outlet=${selectedOutletId}`);
      setTemplates(rows);
      // The sheet is redrawn from what was stored, not from what was typed — a
      // save that merged days differently than expected shows up immediately
      // rather than hiding behind stale local state.
      const sheet = templatesToCells(rows);
      setTimes(sheet.times);
      setCounts(sheet.counts);
      setConflicts(sheet.conflicts);
      setAddedSlots({});
      setDirty(false);
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

  /** This brand's stations, then the two department rows. */
  const rows = useMemo(() => gridRows(outlet?.brand?.stations ?? []), [outlet?.brand?.stations]);

  /**
   * How many shift rows a station shows: two by default, more if the stored
   * patterns use a higher slot or the user added one this session.
   *
   * Derived rather than stored, so a station that genuinely runs three shifts
   * comes back with three on every load without a second table to maintain.
   */
  const slotsFor = useCallback(
    (rowKey) => {
      let highest = MIN_SHIFT_SLOTS;
      for (const key of Object.keys(times)) {
        const [dept, section, slot] = key.split('|');
        if (`${dept}|${section}` === rowKey) highest = Math.max(highest, Number(slot));
      }
      return Math.min(MAX_SHIFT_SLOTS, Math.max(highest, addedSlots[rowKey] ?? 0));
    },
    [times, addedSlots]
  );

  /** Started but unusable — staff with no hours, hours with no staff, half a time. */
  const invalid = useMemo(
    () => incompleteRows(times, counts, rows, slotsFor),
    [times, counts, rows, slotsFor]
  );

  /** Sibling restaurants under the same brand, for "apply to all". */
  const brandSiblings = useMemo(
    () => writableOutlets.filter((o) => o.brand?.id === outlet?.brand?.id && o.id !== outlet?.id),
    [writableOutlets, outlet]
  );

  const inactiveCount = useMemo(() => templates.filter((t) => !t.isActive).length, [templates]);

  const touch = () => { setDirty(true); setGridResult(null); };
  const editTimes = (next) => { setTimes(next); touch(); };
  const editCounts = (next) => { setCounts(next); touch(); };

  const addSlot = (rowKey) =>
    setAddedSlots((prev) => ({
      ...prev,
      [rowKey]: Math.min(MAX_SHIFT_SLOTS, slotsFor(rowKey) + 1),
    }));

  // Back to whatever the data still needs — clearRow has already emptied the
  // row, so this cannot drop anything that was filled in.
  const removeSlot = (rowKey) =>
    setAddedSlots((prev) => ({ ...prev, [rowKey]: MIN_SHIFT_SLOTS }));

  /**
   * Stations offered by the pattern modal.
   *
   * The brand's own list, plus whatever the pattern being edited already holds.
   * Without that second part, opening a pattern whose station is not on the
   * brand's list shows an empty select and saving silently demotes it to
   * General — the list is editable, so a station can be retired out from under
   * patterns that still use it.
   */
  const stationOptions = useMemo(() => {
    const brandStations = outlet?.brand?.stations?.length ? outlet.brand.stations : STATIONS;
    return form.section && !brandStations.includes(form.section)
      ? [...brandStations, form.section]
      : brandStations;
  }, [outlet?.brand?.stations, form.section]);

  /**
   * Write the whole week in one request.
   *
   * The merge happens here rather than server-side because the grid's rows are
   * what decides which cells belong together, and those rows are a client
   * concept (the brand's station list plus the two departments).
   */
  const saveGrid = async (outletIds) => {
    if (invalid.length > 0) {
      // Named, not counted: "2 rows are incomplete" leaves you hunting a grid of
      // ninety cells for which two.
      setGridError(
        invalid.map((i) => `${i.label} ${i.why}`).join(' · ')
      );
      return;
    }
    setGridSaving(true);
    setGridError('');
    try {
      const res = await api.put('/shift-templates/grid', {
        outletIds,
        templates: cellsToTemplates(times, counts, rows, slotsFor),
      });
      setGridResult({ ...res, outletIds });
      setApplyOpen(false);
      load();
      loadClearPreview();
    } catch (err) {
      setGridError(err.message || 'Failed to save the grid');
    } finally {
      setGridSaving(false);
    }
  };

  const saveStations = async (list) => {
    try {
      await api.put(`/brands/${outlet.brand.id}`, { stations: list });
      setStationsOpen(false);
      // The station list rides on the outlet payload, so the directory has to
      // come back before the grid can draw its new rows.
      await refresh();
    } catch (err) {
      alert(err.message || 'Failed to save stations');
    }
  };

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
            slot: pattern.slot ?? 1,
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
                {isManager ? ' Fill the week below to start planning it.' : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ============ The weekly sheet ============ */}
      <div className="card mb-4" data-section="sheet">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <CalendarRange size={17} className="icon-brand" />
            <h3 className="card-title">Weekly Shift Sheet</h3>
            {outlet && <span className="badge badge-ghost">{outlet.name}</span>}
            {dirty && <span className="badge badge-warn">Unsaved</span>}
          </div>
          {isManager && (
            <div className="flex items-center gap-2">
              {isAdmin && (
                <button className="btn btn-ghost btn-sm" onClick={() => {
                  setStationDraft((outlet?.brand?.stations ?? []).join('\n'));
                  setStationsOpen(true);
                }}>
                  <Settings2 size={14} />
                  <span>Stations</span>
                </button>
              )}
              {brandSiblings.length > 0 && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setApplyOpen(true)}
                  disabled={gridSaving}
                  title={`Copy this sheet to the other ${outlet?.brand?.name} restaurants`}
                >
                  <Copy size={14} />
                  <span>Apply to all {outlet?.brand?.name}</span>
                </button>
              )}
              <button
                className="btn btn-primary btn-sm"
                onClick={() => saveGrid([selectedOutletId])}
                disabled={gridSaving || !dirty}
              >
                <Save size={14} />
                <span>{gridSaving ? 'Saving…' : 'Save sheet'}</span>
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-muted mb-3">
          Set a shift's hours once, then fill in how many people it needs on each day.
          Leave a day empty where the shift does not run, and use <strong>Add shift</strong>{' '}
          for a station that runs more than two. Days asking for the same number are
          stored as one pattern.
        </p>

        {gridError && <div className="login-error mb-3">{gridError}</div>}

        {gridResult && (
          <p className="text-sm mb-3" style={{ color: 'var(--ink-good)' }}>
            Saved {gridResult.created} pattern{gridResult.created === 1 ? '' : 's'} across{' '}
            {gridResult.outlets} outlet{gridResult.outlets === 1 ? '' : 's'}
            {gridResult.keptInactive > 0 &&
              ` · ${gridResult.keptInactive} inactive pattern${gridResult.keptInactive === 1 ? '' : 's'} kept`}.
          </p>
        )}

        {rows.length === 2 && (
          <div className="card card--alert-warn mb-3">
            <p className="text-sm">
              <strong>{outlet?.brand?.name}</strong> has no kitchen stations defined, so only
              Service and House Keeping are shown.
              {isAdmin ? ' Use Stations above to add them.' : ' An admin can add them.'}
            </p>
          </div>
        )}

        {loading ? (
          <div className="text-center py-8 text-muted">Loading the sheet…</div>
        ) : (
          <ShiftGrid
            rows={rows}
            times={times}
            counts={counts}
            conflicts={conflicts}
            invalid={invalid}
            slotsFor={slotsFor}
            onTimes={editTimes}
            onCounts={editCounts}
            onAddSlot={addSlot}
            onRemoveSlot={removeSlot}
            readOnly={!isManager}
          />
        )}
      </div>

      {/* The stored patterns behind the sheet: where Active is toggled, where a
          single row can be deleted, and the only place inactive ones appear. */}
      <div className="card" data-section="patterns">
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
                    <td>{t.section || <span className="text-muted">—</span>}</td>
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
                    section: p.section,
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
                onChange={(e) => setForm((p) => ({ ...p, section: e.target.value }))}
              >
                <option value="">— None —</option>
                {/* This brand's own stations, so the modal and the sheet above
                    cannot disagree about which rows exist. */}
                {stationOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
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
            <label className="form-label" htmlFor="pattern-slot">Shift</label>
            <select
              id="pattern-slot"
              className="form-select"
              value={form.slot}
              onChange={(e) => setForm((p) => ({ ...p, slot: Number(e.target.value) }))}
            >
              {slotsUpTo(MAX_SHIFT_SLOTS).map((s) => <option key={s} value={s}>Shift {s}</option>)}
            </select>
            <p className="text-xs text-muted mt-1">
              Which row of the weekly sheet this pattern sits on.
            </p>
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
        isOpen={applyOpen}
        onClose={() => setApplyOpen(false)}
        title={`Apply this sheet to all ${outlet?.brand?.name || ''} restaurants`}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-secondary">
            The week you have filled in for <strong>{outlet?.name}</strong> replaces the
            active patterns at{' '}
            <strong>{brandSiblings.length} other {outlet?.brand?.name} restaurant
            {brandSiblings.length === 1 ? '' : 's'}</strong>. Whatever they run now is
            overwritten.
          </p>
          <ul className="divided-list">
            {brandSiblings.map((o) => (
              <li key={o.id} className="text-sm py-1">{o.name}</li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            Other brands are untouched. Inactive patterns at each restaurant are kept.
          </p>
          <div className="flex gap-2" style={{ marginLeft: 'auto' }}>
            <button className="btn btn-ghost" onClick={() => setApplyOpen(false)} disabled={gridSaving}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => saveGrid([selectedOutletId, ...brandSiblings.map((o) => o.id)])}
              disabled={gridSaving}
            >
              {gridSaving ? 'Applying…' : `Apply to ${brandSiblings.length + 1} restaurants`}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={stationsOpen}
        onClose={() => setStationsOpen(false)}
        title={`Stations · ${outlet?.brand?.name || ''}`}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-secondary">
            The kitchen stations this brand runs, one per line, in the order they should
            appear on the sheet. Every {outlet?.brand?.name} restaurant uses this list.
          </p>
          <div className="form-group">
            <label className="form-label" htmlFor="brand-stations">Stations</label>
            <textarea
              id="brand-stations"
              className="form-textarea"
              rows={8}
              value={stationDraft}
              onChange={(e) => setStationDraft(e.target.value)}
              placeholder={'Pass\nPizza\nPasta\nDrinks'}
            />
            <p className="text-xs text-muted mt-1">
              Service and House Keeping are always shown and are not listed here — they are
              departments, not stations. Removing a station hides its row; patterns already
              saved for it stay in the list below until deleted.
            </p>
          </div>
          <div className="flex gap-2" style={{ marginLeft: 'auto' }}>
            <button className="btn btn-ghost" onClick={() => setStationsOpen(false)}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={() => saveStations(stationDraft.split('\n').map((s) => s.trim()).filter(Boolean))}
            >
              Save stations
            </button>
          </div>
        </div>
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
