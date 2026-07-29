import { useState, useEffect } from 'react';
import api from '../api/client';
import { MapPin, Save, Shield } from 'lucide-react';

export default function SettingsPage() {
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadVenues();
  }, []);

  const loadVenues = async () => {
    setLoading(true);
    try {
      const res = await api.get('/notifications/venues');
      setVenues(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleVenueChange = (index, field, value) => {
    setVenues(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleSaveVenue = async (index) => {
    const venue = venues[index];
    setSaving(true);
    try {
      await api.put(`/notifications/venues/${venue.id}`, {
        name: venue.name,
        latitude: parseFloat(venue.latitude),
        longitude: parseFloat(venue.longitude),
        radius: parseInt(venue.radius),
        address: venue.address
      });
      alert('Venue settings updated successfully!');
      loadVenues();
    } catch (err) {
      alert(err.message || 'Failed to update venue');
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
        <div className="flex items-center gap-2 mb-4">
          <Shield size={20} style={{ color: 'var(--primary-400)' }} />
          <h3 className="font-bold text-sm">Location Geofences</h3>
        </div>

        <div className="flex flex-col gap-6">
          {venues.map((venue, index) => (
            <div key={venue.id} className="py-4 border-b border-subtle last:border-0">
              <h4 className="font-bold text-sm mb-3 flex items-center gap-2">
                <MapPin size={16} style={{ color: 'var(--primary-400)' }} />
                <span>{venue.name}</span>
              </h4>

              <div className="grid-3 mb-3">
                <div className="form-group">
                  <label className="form-label">Latitude</label>
                  <input
                    type="number"
                    step="0.000001"
                    className="form-input"
                    value={venue.latitude}
                    onChange={e => handleVenueChange(index, 'latitude', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Longitude</label>
                  <input
                    type="number"
                    step="0.000001"
                    className="form-input"
                    value={venue.longitude}
                    onChange={e => handleVenueChange(index, 'longitude', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Geofence Radius (meters)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={venue.radius}
                    onChange={e => handleVenueChange(index, 'radius', e.target.value)}
                  />
                </div>
              </div>

              <div className="flex justify-between items-end gap-4">
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">Address Reference</label>
                  <input
                    type="text"
                    className="form-input"
                    value={venue.address || ''}
                    onChange={e => handleVenueChange(index, 'address', e.target.value)}
                    placeholder="Enter physical address reference"
                  />
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => handleSaveVenue(index)}
                  disabled={saving}
                >
                  <Save size={16} />
                  <span>Save Venue</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
