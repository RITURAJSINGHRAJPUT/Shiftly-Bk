import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useScope } from '../contexts/ScopeContext';
import { Store, Users, MapPin, Settings, Tags, UserCheck, AlertTriangle } from 'lucide-react';

const MANAGER_LABEL = {
  MASTER_OF_HOUSE: 'Master of House',
  HEAD_CHEF: 'Head Chef',
};

/**
 * Outlet directory, grouped by brand.
 *
 * Geofence coordinates are edited on the Settings page rather than duplicated
 * here, so there is one place that writes latitude/longitude/radius.
 */
export default function OutletsPage() {
  const { user } = useAuth();
  const { withScope } = useScope();
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const canEditGeofence = ['SUPER_ADMIN', 'ADMIN'].includes(user?.role);

  useEffect(() => {
    setLoading(true);
    api
      .get(withScope('/outlets'))
      .then(setOutlets)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [withScope]);

  const byBrand = outlets.reduce((acc, outlet) => {
    const brand = outlet.brand?.name || 'Unassigned';
    (acc[brand] ||= []).push(outlet);
    return acc;
  }, {});

  if (loading) {
    return <div className="page-content text-center text-muted">Loading outlets…</div>;
  }

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Outlets</h1>
          <p className="page-subtitle">
            {outlets.length} outlet{outlets.length === 1 ? '' : 's'} across{' '}
            {Object.keys(byBrand).length} brand{Object.keys(byBrand).length === 1 ? '' : 's'}
          </p>
        </div>
        {canEditGeofence && (
          <Link to="/settings" className="btn btn-ghost">
            <Settings size={16} />
            <span>Geofence Settings</span>
          </Link>
        )}
      </div>

      {error && <div className="login-error">{error}</div>}

      {(() => {
        const gaps = outlets.filter((o) => (o.missingManagers?.length ?? 0) > 0);
        if (gaps.length === 0) return null;
        return (
          <div className="card card--alert-crit mb-4">
            <div className="flex items-center gap-3 flex-wrap">
              <AlertTriangle size={20} className="icon-crit" />
              <div>
                <h3 className="font-bold text-sm" style={{ color: 'var(--ink-crit)' }}>
                  {gaps.length} outlet{gaps.length === 1 ? '' : 's'} missing a required manager
                </h3>
                <p className="text-xs text-secondary">
                  Every restaurant should have a Master of House and a Head Chef —{' '}
                  {gaps.map((o) => o.name).join(', ')}. Run{' '}
                  <code>npm run managers</code> to create the missing accounts.
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {Object.entries(byBrand).map(([brandName, brandOutlets]) => (
        <div key={brandName} className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Tags size={15} className="icon-brand" />
            <h2 className="card-title">{brandName}</h2>
            <span className="badge badge-ghost">{brandOutlets.length}</span>
          </div>

          <div className="stats-grid">
            {brandOutlets.map((outlet) => (
              <div key={outlet.id} className="card">
                <div className="flex items-center gap-3 mb-3">
                  <div className="stat-icon">
                    <Store size={16} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="card-title truncate">{outlet.name}</div>
                    <div className="text-xs text-muted truncate">
                      {outlet.address || 'No address on file'}
                    </div>
                  </div>
                </div>

                <div className="divided-list">
                  <div className="flex items-center gap-2 text-sm">
                    <Users size={14} className="icon-muted" />
                    <span className="text-secondary">Employees</span>
                    <span className="font-semibold text-strong" style={{ marginLeft: 'auto' }}>
                      {outlet._count?.employees ?? 0}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin size={14} className="icon-muted" />
                    <span className="text-secondary">Geofence</span>
                    <span className="font-semibold text-strong" style={{ marginLeft: 'auto' }}>
                      {outlet.radius}m
                    </span>
                  </div>

                  {/* Every restaurant is expected to have a Master of House and
                      a Head Chef. Surfaced rather than enforced, so a partly
                      set-up outlet is visible instead of being rejected. */}
                  {['MASTER_OF_HOUSE', 'HEAD_CHEF'].map((role) => {
                    const person = outlet.managers?.[role];
                    return (
                      <div key={role} className="flex items-center gap-2 text-sm">
                        {person ? (
                          <UserCheck size={14} className="icon-good" />
                        ) : (
                          <AlertTriangle size={14} className="icon-crit" />
                        )}
                        <span className="text-secondary">{MANAGER_LABEL[role]}</span>
                        <span
                          className="font-semibold truncate"
                          style={{
                            marginLeft: 'auto',
                            maxWidth: '55%',
                            color: person ? 'var(--ink-strong)' : 'var(--ink-crit)',
                          }}
                          title={person?.email}
                        >
                          {person ? person.name.replace(/\s—\s.*$/, '') : 'Not assigned'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {outlets.length === 0 && !error && (
        <div className="card">
          <div className="empty-state">
            <Store size={48} className="empty-icon" />
            <h3>No outlets</h3>
            <p>Run the seed script to populate the hierarchy.</p>
          </div>
        </div>
      )}
    </div>
  );
}
