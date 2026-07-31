import { useState, useEffect } from 'react';
import api from '../api/client';
import { Building2, Tags, Store } from 'lucide-react';

export default function OrganizationsPage() {
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/organizations')
      .then(setOrganizations)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="page-content text-center text-muted">Loading organizations…</div>;
  }

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Organizations</h1>
          <p className="page-subtitle">The top of the hierarchy — brands and outlets sit beneath</p>
        </div>
      </div>

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
            <p>Run the seed script to populate the hierarchy.</p>
          </div>
        </div>
      )}
    </div>
  );
}
