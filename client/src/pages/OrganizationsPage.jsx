import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import Modal from '../components/Modal';
import { useAuth } from '../contexts/AuthContext';
import { Building2, Tags, Store, Plus } from 'lucide-react';

export default function OrganizationsPage() {
  const { user } = useAuth();
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  /**
   * ADMIN and above, matching the ORGANIZATION_CREATE capability the API guards
   * with. The server enforces it independently; this only decides whether to
   * offer a button that would 403.
   */
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
        {canCreate && (
          <button className="btn btn-primary" onClick={() => { setName(''); setFormError(''); setIsOpen(true); }}>
            <Plus size={16} />
            <span>Add Organization</span>
          </button>
        )}
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
            {/* This used to say "run the seed script", which is no longer an
                answer: the seeder is gated and destructive, and this is the
                first thing a fresh deployment needs. */}
            <p>
              {canCreate
                ? 'Create one to start — brands and outlets sit beneath it.'
                : 'An administrator needs to create one before brands and outlets can exist.'}
            </p>
          </div>
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
