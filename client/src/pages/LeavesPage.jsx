import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import CountdownTimer from '../components/CountdownTimer';
import { format } from 'date-fns';
import { PlaneTakeoff, Plus, CheckCircle, XCircle, AlertTriangle, Users } from 'lucide-react';
import { GLOBAL_SCOPE_ROLES } from '../constants';

// Mirrors DEPARTMENT_APPROVERS in server/src/routes/leave.routes.js — a
// locked manager only acts on their own department's leaves; HR/ADMIN/
// SUPER_ADMIN act on any of them.
const DEPARTMENT_APPROVERS = { KITCHEN: 'HEAD_CHEF', SERVICE: 'MASTER_OF_HOUSE', HOUSEKEEPING: 'MASTER_OF_HOUSE' };

export default function LeavesPage() {
  const { user, isManager } = useAuth();
  const canActOn = (leave) =>
    GLOBAL_SCOPE_ROLES.includes(user?.role) || DEPARTMENT_APPROVERS[leave.employee.department] === user?.role;
  const [leaves, setLeaves] = useState([]);
  const [pendingEmergencies, setPendingEmergencies] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    type: 'CASUAL',
    startDate: format(new Date(), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'),
    reason: '',
  });

  // Emergency Leave Modal
  const [isEmergencyModalOpen, setIsEmergencyModalOpen] = useState(false);
  const [emergencyReason, setEmergencyReason] = useState('');

  useEffect(() => {
    loadLeaves();
    const interval = setInterval(loadLeaves, 15000);
    return () => clearInterval(interval);
  }, []);

  const loadLeaves = async () => {
    try {
      const [leavesRes, emergencyRes] = await Promise.all([
        api.get('/leaves'),
        api.get('/leaves/emergency/pending')
      ]);
      setLeaves(leavesRes);
      setPendingEmergencies(emergencyRes);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAdd = () => {
    setFormData({
      type: 'CASUAL',
      startDate: format(new Date(), 'yyyy-MM-dd'),
      endDate: format(new Date(), 'yyyy-MM-dd'),
      reason: '',
    });
    setIsModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      await api.post('/leaves', formData);
      setIsModalOpen(false);
      loadLeaves();
    } catch (err) {
      alert(err.message || 'Failed to submit leave request');
    }
  };

  const handleEmergencyRequest = async (e) => {
    e.preventDefault();
    try {
      await api.post('/leaves/emergency', { reason: emergencyReason });
      setIsEmergencyModalOpen(false);
      setEmergencyReason('');
      loadLeaves();
      alert('Emergency leave requested! A coverage notification has been broadcast to team members.');
    } catch (err) {
      alert(err.message || 'Emergency request failed');
    }
  };

  const handleApprove = async (id) => {
    try {
      await api.post(`/leaves/${id}/approve`);
      loadLeaves();
    } catch (err) {
      alert(err.message || 'Approval failed');
    }
  };

  const handleReject = async (id) => {
    const reason = window.prompt('Enter rejection reason:');
    if (reason === null) return;
    try {
      await api.post(`/leaves/${id}/reject`, { reason });
      loadLeaves();
    } catch (err) {
      alert(err.message || 'Rejection failed');
    }
  };

  const handleAcceptCover = async (leaveId) => {
    if (!window.confirm('Do you agree to cover this shift? Your schedule will be updated.')) return;
    try {
      await api.post(`/leaves/emergency/${leaveId}/accept`);
      loadLeaves();
      alert('You have successfully accepted coverage for this shift.');
    } catch (err) {
      alert(err.message || 'Failed to accept coverage');
    }
  };

  const handleAutoAssign = async (leaveId) => {
    try {
      await api.post(`/leaves/emergency/${leaveId}/auto-assign`);
      loadLeaves();
    } catch (err) {
      alert(err.message || 'Auto-assignment failed');
    }
  };

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Leave Management</h1>
          <p className="page-subtitle">Submit leave requests, cover emergency shifts, and approve team requests</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-danger" onClick={() => setIsEmergencyModalOpen(true)}>
            <AlertTriangle size={16} />
            <span>Emergency Leave</span>
          </button>
          <button className="btn btn-primary" onClick={handleOpenAdd}>
            <Plus size={16} />
            <span>Apply Leave</span>
          </button>
        </div>
      </div>

      {pendingEmergencies.length > 0 && (
        <div className="card card--alert-crit mb-4">
          <h3 className="font-bold text-sm mb-3" style={{ color: 'var(--ink-crit)' }}>
            Active emergency coverage requests
          </h3>
          <div className="divided-list">
            {pendingEmergencies.map(el => {
              const isOwn = el.employeeId === user?.id;
              return (
                <div key={el.id} className="flex justify-between items-center flex-wrap gap-2">
                  <div>
                    <span className="font-semibold">{el.employee.name}</span>
                    <span className="text-xs text-muted"> ({el.employee.outlet?.name} | {el.employee.department})</span>
                    <div className="text-xs text-secondary mt-1">Reason: "{el.reason}"</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <CountdownTimer expiresAt={el.expiresAt} onExpire={loadLeaves} />
                    {!isOwn && (
                      <button className="btn btn-accent btn-sm" onClick={() => handleAcceptCover(el.id)}>
                        Volunteer Cover
                      </button>
                    )}
                    {isManager && (
                      <button className="btn btn-ghost btn-sm" onClick={() => handleAutoAssign(el.id)}>
                        Auto Assign Now
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8">Loading leaves log...</div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Leave Type</th>
                <th>Duration</th>
                <th>Reason</th>
                <th>Covered By</th>
                <th>Status</th>
                {isManager && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {leaves.map(l => (
                <tr key={l.id}>
                  <td>
                    <div className="font-semibold text-primary" style={{ color: 'var(--ink-strong)' }}>{l.employee.name}</div>
                    <div className="text-xs text-muted">{l.employee.department}</div>
                  </td>
                  <td>
                    <span className={`badge ${l.isEmergency ? 'badge-error' : 'badge-primary'}`}>
                      {l.type} {l.isEmergency && '(EMERGENCY)'}
                    </span>
                  </td>
                  <td>
                    {format(new Date(l.startDate), 'MMM d, yyyy')} - {format(new Date(l.endDate), 'MMM d, yyyy')}
                  </td>
                  <td>{l.reason || '-'}</td>
                  <td>{l.coveredById ? 'Assigned' : 'None'}</td>
                  <td>
                    <span className={`badge ${l.status === 'APPROVED' ? 'badge-accent' : l.status === 'PENDING' || l.status === 'COVERAGE_PENDING' ? 'badge-warn' : 'badge-error'}`}>
                      {l.status.replace(/_/g, ' ')}
                    </span>
                    {l.status === 'APPROVED' && !l.approvedBy && (
                      <span className="badge badge-ghost ml-1" style={{ fontSize: '0.65rem' }}>Auto</span>
                    )}
                  </td>
                  {isManager && (
                    <td>
                      {(l.status === 'PENDING' || l.status === 'COVERAGE_PENDING') && canActOn(l) && (
                        <div className="flex gap-2">
                          <button className="btn btn-ghost btn-sm btn-icon" style={{ color: 'var(--accent-400)' }} onClick={() => handleApprove(l.id)}>
                            <CheckCircle size={14} />
                          </button>
                          <button className="btn btn-ghost btn-sm btn-icon" style={{ color: 'var(--error-400)' }} onClick={() => handleReject(l.id)}>
                            <XCircle size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Leave Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Apply for Leave"
      >
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div className="form-group">
            <label className="form-label">Leave Type</label>
            <select
              className="form-select"
              value={formData.type}
              onChange={e => setFormData(prev => ({ ...prev, type: e.target.value }))}
            >
              <option value="CASUAL">Casual Leave</option>
              <option value="SICK">Sick Leave</option>
              <option value="EARNED">Earned Leave</option>
              <option value="UNPAID">Unpaid Leave</option>
            </select>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Start Date</label>
              <input
                type="date"
                className="form-input"
                value={formData.startDate}
                onChange={e => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">End Date</label>
              <input
                type="date"
                className="form-input"
                value={formData.endDate}
                onChange={e => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Reason</label>
            <textarea
              className="form-textarea"
              placeholder="Provide reason for leave"
              value={formData.reason}
              onChange={e => setFormData(prev => ({ ...prev, reason: e.target.value }))}
            />
          </div>

          <div className="modal-footer" style={{ padding: 0, marginTop: '16px' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setIsModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Submit Request</button>
          </div>
        </form>
      </Modal>

      {/* Emergency Leave Modal */}
      <Modal
        isOpen={isEmergencyModalOpen}
        onClose={() => setIsEmergencyModalOpen(false)}
        title="Request Emergency Leave (Start within 2 hrs)"
      >
        <form onSubmit={handleEmergencyRequest} className="flex flex-col gap-4">
          <div className="card" style={{ borderColor: 'var(--error-500)', background: 'rgba(244, 63, 94, 0.05)' }}>
            <p className="text-xs text-secondary" style={{ color: 'var(--error-400)' }}>
              <strong>Important Constraint:</strong> Emergency leaves are only valid if requested at least 2 hours before your shift starts. The system will broadcast a cover request for 30 minutes, after which it will auto-assign the shift to keep operations running.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Describe your Emergency</label>
            <textarea
              className="form-textarea"
              placeholder="What is the emergency?"
              value={emergencyReason}
              onChange={e => setEmergencyReason(e.target.value)}
              required
            />
          </div>

          <div className="modal-footer" style={{ padding: 0, marginTop: '16px' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setIsEmergencyModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-danger">Broadcast Request</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
