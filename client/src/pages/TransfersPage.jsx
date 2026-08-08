import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useScope } from '../contexts/ScopeContext';
import Modal from '../components/Modal';
import { ArrowLeftRight, Plus, CheckCircle, XCircle, Clock, Ban } from 'lucide-react';

const STATUS_STYLE = {
  PENDING: { cls: 'badge-warn', icon: Clock },
  APPROVED: { cls: 'badge-good', icon: CheckCircle },
  REJECTED: { cls: 'badge-crit', icon: XCircle },
  CANCELLED: { cls: 'badge-ghost', icon: Ban },
};

const DEPARTMENTS = ['KITCHEN', 'SERVICE', 'HOUSEKEEPING'];

const ROSTERABLE_ROLES = ['STAFF', 'HEAD_CHEF', 'MASTER_OF_HOUSE'];

export default function TransfersPage() {
  const { user, isManager } = useAuth();
  const { outlets } = useScope();

  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const [form, setForm] = useState({
    type: 'OUTLET',
    targetOutletId: '',
    targetDepartment: '',
    targetSkills: [],
    reason: '',
  });

  const [rejectId, setRejectId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const canRequest = ROSTERABLE_ROLES.includes(user?.role);
  const isKitchen = user?.department === 'KITCHEN';

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterType) params.set('type', filterType);
      const qs = params.toString();
      const data = await api.get(`/transfers${qs ? `?${qs}` : ''}`);
      setTransfers(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterType]);

  useEffect(() => { load(); }, [load]);

  const currentOutlet = outlets.find(o => o.id === user?.outletId);
  const otherOutlets = outlets.filter(o => o.id !== user?.outletId);

  const selectedTargetOutlet = outlets.find(o => o.id === form.targetOutletId);
  const targetStations = selectedTargetOutlet?.brand?.stations || [];
  const ownStations = currentOutlet?.brand?.stations || [];

  const openRequestModal = () => {
    setForm({
      type: isKitchen ? 'OUTLET' : 'OUTLET',
      targetOutletId: otherOutlets[0]?.id || '',
      targetDepartment: user?.department || 'SERVICE',
      targetSkills: [],
      reason: '',
    });
    setFormError('');
    setIsModalOpen(true);
  };

  const toggleSkill = (skill) => {
    setForm(f => ({
      ...f,
      targetSkills: f.targetSkills.includes(skill)
        ? f.targetSkills.filter(s => s !== skill)
        : [...f.targetSkills, skill],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError('');
    try {
      await api.post('/transfers', form);
      setIsModalOpen(false);
      load();
    } catch (err) {
      setFormError(err.message || 'Failed to submit transfer request');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (id) => {
    if (!confirm('Approve this transfer? The employee will be moved immediately.')) return;
    try {
      await api.post(`/transfers/${id}/approve`);
      load();
    } catch (err) {
      alert(err.message || 'Failed to approve');
    }
  };

  const handleReject = async () => {
    if (!rejectId) return;
    try {
      await api.post(`/transfers/${rejectId}/reject`, { reason: rejectReason });
      setRejectId(null);
      setRejectReason('');
      load();
    } catch (err) {
      alert(err.message || 'Failed to reject');
    }
  };

  const handleCancel = async (id) => {
    if (!confirm('Cancel this transfer request?')) return;
    try {
      await api.post(`/transfers/${id}/cancel`);
      load();
    } catch (err) {
      alert(err.message || 'Failed to cancel');
    }
  };

  const stationsDisplay = (skills) => {
    if (!skills || skills.length === 0) return '—';
    return skills.join(', ');
  };

  if (loading) {
    return <div className="page-content text-center text-muted">Loading transfers…</div>;
  }

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Transfers</h1>
          <p className="page-subtitle">
            {canRequest ? 'Request a transfer or view your history' : 'Manage transfer requests'}
          </p>
        </div>
        {canRequest && (
          <button className="btn btn-primary" onClick={openRequestModal}>
            <Plus size={16} />
            <span>Request Transfer</span>
          </button>
        )}
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <select
          className="form-select"
          style={{ width: 'auto', minWidth: 140 }}
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <select
          className="form-select"
          style={{ width: 'auto', minWidth: 140 }}
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
        >
          <option value="">All Types</option>
          <option value="OUTLET">Outlet</option>
          <option value="STATION">Station</option>
        </select>
      </div>

      {transfers.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <ArrowLeftRight size={48} className="empty-icon" />
            <h3>No transfer requests</h3>
            <p>
              {canRequest
                ? 'Request a transfer to a different outlet or station.'
                : 'Transfer requests from staff will appear here.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                {isManager && <th>Employee</th>}
                <th>Type</th>
                <th>From</th>
                <th>To</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map(t => {
                const st = STATUS_STYLE[t.status] || STATUS_STYLE.PENDING;
                const Icon = st.icon;
                const isOwn = t.employeeId === user?.id;

                return (
                  <tr key={t.id}>
                    {isManager && (
                      <td>
                        <div className="font-semibold">{t.employee?.name}</div>
                        <div className="text-xs text-muted">
                          {t.employee?.department} · {t.employee?.outlet?.name}
                        </div>
                      </td>
                    )}
                    <td>
                      <span className={`badge ${t.type === 'OUTLET' ? 'badge-info' : 'badge-brand'}`}>
                        {t.type}
                      </span>
                    </td>
                    <td>
                      <div>{t.type === 'OUTLET' ? (t.employee?.outlet?.name || '—') : stationsDisplay(t.fromSkills)}</div>
                      {t.type === 'OUTLET' && t.fromDepartment && (
                        <div className="text-xs text-muted">{t.fromDepartment}</div>
                      )}
                    </td>
                    <td>
                      <div>{t.type === 'OUTLET' ? (t.targetOutlet?.name || '—') : stationsDisplay(t.targetSkills)}</div>
                      {t.type === 'OUTLET' && t.targetDepartment && (
                        <div className="text-xs text-muted">{t.targetDepartment}</div>
                      )}
                    </td>
                    <td>
                      <span className="text-sm">{t.reason || '—'}</span>
                    </td>
                    <td>
                      <span className={`badge ${st.cls}`}>
                        <Icon size={12} />
                        {t.status}
                      </span>
                      {t.rejectionReason && (
                        <div className="text-xs text-muted mt-1">{t.rejectionReason}</div>
                      )}
                    </td>
                    <td className="text-sm text-muted">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                    <td>
                      <div className="flex gap-1">
                        {t.status === 'PENDING' && isManager && !isOwn && (
                          <>
                            <button
                              className="btn btn-sm btn-good"
                              onClick={() => handleApprove(t.id)}
                              title="Approve"
                            >
                              <CheckCircle size={14} />
                            </button>
                            <button
                              className="btn btn-sm btn-crit"
                              onClick={() => { setRejectId(t.id); setRejectReason(''); }}
                              title="Reject"
                            >
                              <XCircle size={14} />
                            </button>
                          </>
                        )}
                        {t.status === 'PENDING' && isOwn && (
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => handleCancel(t.id)}
                            title="Cancel request"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Request Transfer Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Request Transfer">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {!isKitchen && form.type === 'STATION' ? null : (
            <div className="form-group">
              <label className="form-label">Transfer Type</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`btn ${form.type === 'OUTLET' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setForm(f => ({ ...f, type: 'OUTLET', targetSkills: [] }))}
                >
                  Outlet Transfer
                </button>
                {isKitchen && (
                  <button
                    type="button"
                    className={`btn ${form.type === 'STATION' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setForm(f => ({ ...f, type: 'STATION', targetOutletId: '', targetDepartment: '', targetSkills: [] }))}
                  >
                    Station Transfer
                  </button>
                )}
              </div>
            </div>
          )}

          {form.type === 'OUTLET' && (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor="target-outlet">Target Outlet</label>
                <select
                  id="target-outlet"
                  className="form-select"
                  value={form.targetOutletId}
                  onChange={e => setForm(f => ({ ...f, targetOutletId: e.target.value, targetSkills: [] }))}
                  required
                >
                  <option value="">Select outlet…</option>
                  {otherOutlets.map(o => (
                    <option key={o.id} value={o.id}>{o.name} ({o.brand?.name})</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="target-dept">Department</label>
                <select
                  id="target-dept"
                  className="form-select"
                  value={form.targetDepartment}
                  onChange={e => setForm(f => ({ ...f, targetDepartment: e.target.value, targetSkills: [] }))}
                  required
                >
                  {DEPARTMENTS.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              {form.targetDepartment === 'KITCHEN' && targetStations.length > 0 && (
                <div className="form-group">
                  <label className="form-label">Stations</label>
                  <div className="flex gap-2 flex-wrap">
                    {targetStations.map(s => (
                      <label key={s} className="flex items-center gap-1 text-sm" style={{ cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={form.targetSkills.includes(s.toLowerCase())}
                          onChange={() => toggleSkill(s.toLowerCase())}
                        />
                        {s}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {form.type === 'STATION' && (
            <div className="form-group">
              <label className="form-label">Target Stations</label>
              {ownStations.length > 0 ? (
                <div className="flex gap-2 flex-wrap">
                  {ownStations.map(s => (
                    <label key={s} className="flex items-center gap-1 text-sm" style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={form.targetSkills.includes(s.toLowerCase())}
                        onChange={() => toggleSkill(s.toLowerCase())}
                      />
                      {s}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">No stations configured for your outlet's brand.</p>
              )}
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="transfer-reason">Reason (optional)</label>
            <textarea
              id="transfer-reason"
              className="form-input"
              rows={3}
              value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              placeholder="Why are you requesting this transfer?"
            />
          </div>

          {formError && (
            <p className="text-sm" style={{ color: 'var(--ink-crit)' }}>{formError}</p>
          )}

          <div className="flex gap-2" style={{ marginLeft: 'auto' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setIsModalOpen(false)} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Reject Reason Modal */}
      <Modal isOpen={!!rejectId} onClose={() => setRejectId(null)} title="Reject Transfer">
        <form onSubmit={e => { e.preventDefault(); handleReject(); }} className="flex flex-col gap-4">
          <div className="form-group">
            <label className="form-label" htmlFor="reject-reason">Reason for rejection</label>
            <textarea
              id="reject-reason"
              className="form-input"
              rows={3}
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Optional — explain why this transfer was denied"
            />
          </div>
          <div className="flex gap-2" style={{ marginLeft: 'auto' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setRejectId(null)}>Cancel</button>
            <button type="submit" className="btn btn-crit">Reject</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
