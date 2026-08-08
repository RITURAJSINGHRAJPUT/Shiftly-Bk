import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import Modal from '../components/Modal';
import { useAuth } from '../contexts/AuthContext';
import { Building2, Tags, Store, Plus, MapPin, Save, Shield } from 'lucide-react';

export default function OrganizationsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('organizations');

  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [outlets, setOutlets] = useState([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoSaving, setGeoSaving] = useState(false);

  const canCreate = ['SUPER_ADMIN', 'ADMIN'].includes(user?.role);

  const load = useCallback(() => {
    setLoading(true);
    return api
      .get('/organizations')
      .then(setOrganizations)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadOutlets = useCallback(async () => {
    setGeoLoading(true);
    try {
      const res = await api.get('/outlets');
      setOutlets(res);
    } catch (err) {
      console.error(err);
    } finally {
      setGeoLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'geofences') loadOutlets();
  }, [activeTab, loadOutlets]);

  const handleOutletChange = (index, field, value) => {
    setOutlets(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleSaveOutlet = async (index) => {
    const outlet = outlets[index];
    setGeoSaving(true);
    try {
      await api.put(`/outlets/${outlet.id}`, {
        name: outlet.name,
        latitude: parseFloat(outlet.latitude),
        longitude: parseFloat(outlet.longitude),
        radius: parseInt(outlet.radius),
        address: outlet.address,
      });
      alert('Outlet settings updated successfully!');
      loadOutlets();
    } catch (err) {
      alert(err.message || 'Failed to update outlet');
    } finally {
      setGeoSaving(false);
    }
  };

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await api.post('/organizations', { name });
      setIsOpen(false);
      setName('');
      load();
    } catch (err) {
      setFormError(err.message || 'Failed to create the organisation');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Organizations</h1>
          <p className="page-subtitle">Manage the organisational hierarchy and outlet geofences</p>
        </div>
        {canCreate && activeTab === 'organizations' && (
          <button className="btn btn-primary" onClick={() => { setName(''); setFormError(''); setIsOpen(true); }}>
            <Plus size={16} />
            <span>Add Organization</span>
          </button>
        )}
      </div>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'organizations' ? 'active' : ''}`}
          onClick={() => setActiveTab('organizations')}
        >
          Organizations
        </button>
        <button
          className={`tab ${activeTab === 'geofences' ? 'active' : ''}`}
          onClick={() => setActiveTab('geofences')}
        >
          Location Geofences
        </button>
      </div>

      {activeTab === 'organizations' && (
        <>
          {loading ? (
            <div className="text-center text-muted py-4">Loading organizations…</div>
          ) : (
            <>
              {error && <div className="login-error">{error}</div>}

              <div className="stats-grid">
                {organizations.map((org) => {
                  const outletCount = org.brands.reduce((sum, b) => sum + b._count.outlets, 0);
                  return (
                    <div key={org.id} className="card">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="stat-icon">
                          <Building2 size={16} />
                        </div>
                        <div>
                          <div className="card-title">{org.name}</div>
                          <div className="text-xs text-muted">
                            {org.brands.length} brand{org.brands.length === 1 ? '' : 's'} · {outletCount} outlet
                            {outletCount === 1 ? '' : 's'}
                          </div>
                        </div>
                      </div>

                      <div className="divided-list">
                        {org.brands.map((brand) => (
                          <div key={brand.id} className="flex items-center gap-2">
                            <Tags size={14} className="icon-muted" />
                            <span className="text-sm font-semibold">{brand.name}</span>
                            <span className="badge badge-ghost" style={{ marginLeft: 'auto' }}>
                              <Store size={11} />
                              {brand._count.outlets}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {organizations.length === 0 && !error && (
                <div className="card">
                  <div className="empty-state">
                    <Building2 size={48} className="empty-icon" />
                    <h3>No organizations</h3>
                    <p>
                      {canCreate
                        ? 'Create one to start — brands and outlets sit beneath it.'
                        : 'An administrator needs to create one before brands and outlets can exist.'}
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {activeTab === 'geofences' && (
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <Shield size={18} className="icon-brand" />
              <h3 className="card-title">Location Geofences</h3>
            </div>
            <span className="text-xs text-muted">
              Attendance check-in is validated against these coordinates
            </span>
          </div>

          {geoLoading ? (
            <div className="text-center text-muted py-4">Loading outlets…</div>
          ) : (
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
                      disabled={geoSaving}
                    >
                      <Save size={16} />
                      <span>Save Outlet</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Add Organization">
        <form onSubmit={create} className="flex flex-col gap-4">
          {formError && <div className="login-error">{formError}</div>}

          <div className="form-group">
            <label className="form-label" htmlFor="org-name">Name</label>
            <input
              id="org-name"
              className="form-input"
              placeholder="e.g. Bookends Hospitality"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
            <p className="text-xs text-muted mt-1">
              The company every brand belongs to. Most groups need only one.
            </p>
          </div>

          <div className="flex gap-2" style={{ marginLeft: 'auto' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setIsOpen(false)} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>
              {saving ? 'Creating…' : 'Create Organization'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
