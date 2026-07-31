import { useState, useEffect } from 'react';
import api from '../api/client';
import { MapPin, Save, Shield } from 'lucide-react';

export default function SettingsPage() {
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadOutlets();
  }, []);

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
    </div>
  );
}
