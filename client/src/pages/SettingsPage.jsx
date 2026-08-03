import { useState, useEffect } from 'react';
import api from '../api/client';
import Modal from '../components/Modal';
import { useAuth } from '../contexts/AuthContext';
import { MapPin, Save, Shield, AlertTriangle, Trash2 } from 'lucide-react';

/** Typed verbatim before the wipe will run. */
const WIPE_CONFIRMATION = 'DELETE ALL STAFF';

export default function SettingsPage() {
  const { user } = useAuth();
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // The sidebar lets ADMIN reach this page too, so the danger zone is gated
  // here rather than relying on navigation to keep them out. The server
  // enforces it independently with requireRole('SUPER_ADMIN').
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const [preview, setPreview] = useState(null);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [wiping, setWiping] = useState(false);
  const [wipeError, setWipeError] = useState('');
  const [wipeResult, setWipeResult] = useState(null);

  useEffect(() => {
    loadOutlets();
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) return;
    api.get('/employees/stats/wipe-preview').then(setPreview).catch(() => setPreview(null));
  }, [isSuperAdmin]);

  const handleWipe = async () => {
    setWiping(true);
    setWipeError('');
    try {
      const res = await api.post('/employees/wipe-staff', { confirm: WIPE_CONFIRMATION });
      setWipeResult(res);
      setWipeOpen(false);
      setTyped('');
      // Refresh the preview so the card shows the new (zero) state.
      api.get('/employees/stats/wipe-preview').then(setPreview).catch(() => {});
    } catch (err) {
      setWipeError(err.message || 'Failed to delete staff data');
    } finally {
      setWiping(false);
    }
  };

  const loadOutlets = async () => {
    setLoading(true);
    try {
      const res = await api.get('/outlets');
      setOutlets(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleOutletChange = (index, field, value) => {
    setOutlets(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleSaveOutlet = async (index) => {
    const outlet = outlets[index];
    setSaving(true);
    try {
      await api.put(`/outlets/${outlet.id}`, {
        name: outlet.name,
        latitude: parseFloat(outlet.latitude),
        longitude: parseFloat(outlet.longitude),
        radius: parseInt(outlet.radius),
        address: outlet.address
      });
      alert('Outlet settings updated successfully!');
      loadOutlets();
    } catch (err) {
      alert(err.message || 'Failed to update outlet');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="page-content text-center">Loading settings...</div>;
  }

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">System Settings</h1>
          <p className="page-subtitle">Configure GPS coordinates, allowed radius boundaries, and system preferences</p>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <Shield size={18} className="icon-brand" />
            <h3 className="card-title">Location Geofences</h3>
          </div>
          <span className="text-xs text-muted">
            Attendance check-in is validated against these coordinates
          </span>
        </div>

        <div className="divided-list">
          {outlets.map((outlet, index) => (
            <div key={outlet.id}>
              <h4 className="font-bold text-sm mb-3 flex items-center gap-2">
                <MapPin size={16} className="icon-brand" />
                <span className="text-strong">{outlet.name}</span>
                {outlet.brand?.name && (
                  <span className="badge badge-ghost">{outlet.brand.name}</span>
                )}
              </h4>

              <div className="grid-3 mb-3">
                <div className="form-group">
                  <label className="form-label">Latitude</label>
                  <input
                    type="number"
                    step="0.000001"
                    className="form-input"
                    value={outlet.latitude}
                    onChange={e => handleOutletChange(index, 'latitude', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Longitude</label>
                  <input
                    type="number"
                    step="0.000001"
                    className="form-input"
                    value={outlet.longitude}
                    onChange={e => handleOutletChange(index, 'longitude', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Geofence Radius (meters)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={outlet.radius}
                    onChange={e => handleOutletChange(index, 'radius', e.target.value)}
                  />
                </div>
              </div>

              <div className="flex justify-between items-end gap-4">
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">Address Reference</label>
                  <input
                    type="text"
                    className="form-input"
                    value={outlet.address || ''}
                    onChange={e => handleOutletChange(index, 'address', e.target.value)}
                    placeholder="Enter physical address reference"
                  />
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => handleSaveOutlet(index)}
                  disabled={saving}
                >
                  <Save size={16} />
                  <span>Save Outlet</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {isSuperAdmin && (
        <div className="card card--alert-crit">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="icon-crit" />
              <h3 className="card-title">Danger Zone</h3>
            </div>
          </div>

          <p className="text-sm text-secondary mb-3">
            Permanently delete every staff account and the shifts, attendance,
            leave and notifications attached to them. Management accounts are
            kept, so all logins keep working and every outlet keeps its Master of
            House and Head Chef.
          </p>

          {preview && (
            <div className="divided-list mb-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-secondary">Will be deleted</span>
                <span className="font-semibold text-strong" style={{ marginLeft: 'auto' }}>
                  {preview.employees} staff · {preview.shifts} shifts ·{' '}
                  {preview.attendance} attendance · {preview.leaves} leave ·{' '}
                  {preview.notifications} notifications
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-secondary">Will be kept</span>
                <span className="font-semibold text-strong" style={{ marginLeft: 'auto' }}>
                  {preview.keeping} management accounts, including yours
                </span>
              </div>
            </div>
          )}

          {wipeResult && (
            <p className="text-sm mb-3" style={{ color: 'var(--ink-good)' }}>
              Deleted {wipeResult.employees} staff accounts and {wipeResult.shifts} shifts.
              Restore them with <code>npm run seed:staff</code> or <code>npm run seed</code>.
            </p>
          )}

          <button
            className="btn btn-danger"
            onClick={() => { setWipeOpen(true); setWipeError(''); setWipeResult(null); }}
            disabled={!preview || preview.employees === 0}
          >
            <Trash2 size={16} />
            <span>
              {preview?.employees === 0 ? 'No staff data to delete' : 'Delete all staff data'}
            </span>
          </button>
        </div>
      )}

      <Modal
        isOpen={wipeOpen}
        onClose={() => { setWipeOpen(false); setTyped(''); setWipeError(''); }}
        title="Delete all staff data"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-secondary">
            This removes <strong>{preview?.employees ?? 0} staff accounts</strong> and{' '}
            <strong>{preview?.shifts ?? 0} shifts</strong>. It cannot be undone.
          </p>

          <div className="form-group">
            {/* Typed confirmation rather than window.confirm: a single OK click is
                too small a gesture for an irreversible bulk delete. */}
            <label className="form-label" htmlFor="wipe-confirm">
              Type <code>{WIPE_CONFIRMATION}</code> to continue
            </label>
            <input
              id="wipe-confirm"
              className="form-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={WIPE_CONFIRMATION}
              autoComplete="off"
            />
          </div>

          {wipeError && (
            <p className="text-sm" style={{ color: 'var(--ink-crit)' }}>{wipeError}</p>
          )}

          <div className="flex gap-2" style={{ marginLeft: 'auto' }}>
            <button
              className="btn btn-ghost"
              onClick={() => { setWipeOpen(false); setTyped(''); }}
              disabled={wiping}
            >
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={handleWipe}
              disabled={typed !== WIPE_CONFIRMATION || wiping}
            >
              {wiping ? 'Deleting…' : `Delete ${preview?.employees ?? 0} staff accounts`}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
