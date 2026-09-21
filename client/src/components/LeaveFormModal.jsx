import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import api from '../api/client';
import Modal from './Modal';
import { AUTO_OFF_REASON } from '../constants';

const LEAVE_TYPES = [
  { value: 'CASUAL', label: 'Casual Leave' },
  { value: 'SICK', label: 'Sick Leave' },
  { value: 'EARNED', label: 'Earned Leave' },
  { value: 'UNPAID', label: 'Unpaid Leave' },
];

const toDay = (d) => format(new Date(d), 'yyyy-MM-dd');

/**
 * A manager's leave form, shared by the Leave page and the Leave Schedule card
 * on Shift Planning.
 *
 * Two modes. Given `leave`, it edits that leave and offers to cancel it — an
 * auto-assigned weekly off gets a single "day" field, since moving it is the
 * whole point. Without one, it records new leave for someone picked from
 * `employees`, approved on the spot.
 *
 * `onSaved` receives the server's response, which carries how many of the
 * person's shifts were handed to cover.
 */
export default function LeaveFormModal({ isOpen, onClose, onSaved, leave = null, employees = [], defaultDate }) {
  const editing = Boolean(leave);
  const isWeeklyOff = leave?.reason === AUTO_OFF_REASON;

  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (leave) {
      setForm({
        type: leave.type,
        startDate: toDay(leave.startDate),
        endDate: toDay(leave.endDate),
        reason: isWeeklyOff ? '' : (leave.reason || ''),
      });
    } else {
      const day = defaultDate || format(new Date(), 'yyyy-MM-dd');
      setForm({ employeeId: employees[0]?.id || '', type: 'CASUAL', startDate: day, endDate: day, reason: '' });
    }
    // Seeded once per opening; later changes to `employees` must not wipe what
    // the user has typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, leave]);

  if (!form) return null;

  const set = (patch) => setForm((p) => {
    const next = { ...p, ...patch };
    // Pushing the start past the end drags the end along rather than leaving a
    // range the server will refuse.
    if (patch.startDate && next.endDate < patch.startDate) next.endDate = patch.startDate;
    return next;
  });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = editing
        ? await api.put(`/leaves/${leave.id}`, isWeeklyOff
          ? { startDate: form.startDate, endDate: form.startDate }
          : { type: form.type, startDate: form.startDate, endDate: form.endDate, reason: form.reason })
        : await api.post('/leaves/manage', form);
      onSaved?.(res);
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save the leave');
    } finally {
      setBusy(false);
    }
  };

  const cancelLeave = async () => {
    const what = isWeeklyOff ? 'weekly off' : 'leave';
    if (!window.confirm(`Cancel ${leave.employee?.name}'s ${what}? They will be treated as available on those days.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post(`/leaves/${leave.id}/cancel`);
      onSaved?.(res);
      onClose();
    } catch (err) {
      setError(err.message || 'Could not cancel the leave');
    } finally {
      setBusy(false);
    }
  };

  const title = editing
    ? `${isWeeklyOff ? 'Move weekly off' : 'Edit leave'} · ${leave.employee?.name || ''}`
    : 'Add leave for staff';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {!editing && (
          <div className="form-group">
            <label className="form-label">Employee</label>
            <select
              className="form-select"
              value={form.employeeId}
              onChange={(e) => set({ employeeId: e.target.value })}
              required
            >
              {employees.length === 0 && <option value="">No staff you can manage</option>}
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name} ({emp.department})</option>
              ))}
            </select>
          </div>
        )}

        {isWeeklyOff ? (
          <div className="form-group">
            <label className="form-label">Day off</label>
            <input
              type="date"
              className="form-input"
              value={form.startDate}
              onChange={(e) => set({ startDate: e.target.value, endDate: e.target.value })}
              required
            />
            <p className="text-xs text-muted mt-1">
              Any shift they have on the new day is handed to someone from the same
              station. Re-running Auto-Allocate for the week sets a fresh weekly off.
            </p>
          </div>
        ) : (
          <>
            <div className="form-group">
              <label className="form-label">Leave Type</label>
              <select className="form-select" value={form.type} onChange={(e) => set({ type: e.target.value })}>
                {LEAVE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Start Date</label>
                <input type="date" className="form-input" value={form.startDate}
                  onChange={(e) => set({ startDate: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label">End Date</label>
                <input type="date" className="form-input" value={form.endDate} min={form.startDate}
                  onChange={(e) => set({ endDate: e.target.value })} required />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Reason</label>
              <textarea
                className="form-textarea"
                placeholder="Optional"
                value={form.reason}
                onChange={(e) => set({ reason: e.target.value })}
              />
            </div>

            {(!editing || leave.status === 'APPROVED') && (
              <p className="text-xs text-muted">
                {editing ? 'This leave is approved, so any' : 'Recorded as approved. Any'} shift
                they have in these dates is handed to someone from the same station.
              </p>
            )}
          </>
        )}

        {error && <p className="text-xs" style={{ color: 'var(--ink-crit)' }}>{error}</p>}

        <div className="modal-footer" style={{ padding: 0, marginTop: 'var(--space-2)' }}>
          {editing && (
            <button type="button" className="btn btn-ghost" style={{ color: 'var(--ink-crit)', marginRight: 'auto' }}
              onClick={cancelLeave} disabled={busy}>
              {isWeeklyOff ? 'Cancel weekly off' : 'Cancel leave'}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Close</button>
          <button type="submit" className="btn btn-primary" disabled={busy || (!editing && !form.employeeId)}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add leave'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
