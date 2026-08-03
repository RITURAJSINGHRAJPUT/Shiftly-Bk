import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import Modal from '../components/Modal';
import { useAuth } from '../contexts/AuthContext';
import { Store, Users, MapPin, Settings, Tags, UserCheck, AlertTriangle, Plus, Edit } from 'lucide-react';

const MANAGER_LABEL = {
  MASTER_OF_HOUSE: 'Master of House',
  HEAD_CHEF: 'Head Chef',
};

const emptyForm = { name: '', brandId: '', address: '' };
const emptyBrandForm = { name: '', organizationId: '' };

/**
 * Brands and their outlets, on one page.
 *
 * These were two pages, but the outlet directory was already grouped by brand —
 * so the brand list was a second, flatter view of the same tree. Both are
 * managed here now: brands as the section headings, outlets as the cards under
 * them.
 *
 * Geofence coordinates stay on Settings rather than being duplicated here, so
 * there is one place that writes latitude/longitude/radius. A new outlet takes
 * the schema defaults and is geofenced there afterwards.
 */
export default function OutletsPage() {
  const { user } = useAuth();
  const [outlets, setOutlets] = useState([]);
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [organizations, setOrganizations] = useState([]);
  const [isBrandModalOpen, setBrandModalOpen] = useState(false);
  const [editingBrand, setEditingBrand] = useState(null);
  const [brandForm, setBrandForm] = useState(emptyBrandForm);
  const [savingBrand, setSavingBrand] = useState(false);
  const [brandError, setBrandError] = useState('');

  // Both creating an outlet and moving a geofence are ADMIN-guarded server-side.
  const canManage = ['SUPER_ADMIN', 'ADMIN'].includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Brands feed the outlet form's select and the section headings;
      // organizations feed the brand form's select.
      const [outletRes, brandRes, orgRes] = await Promise.all([
        api.get('/outlets'),
        api.get('/brands').catch(() => []),
        api.get('/organizations').catch(() => []),
      ]);
      setOutlets(outletRes);
      setBrands(brandRes);
      setOrganizations(orgRes);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openAddBrand = () => {
    setEditingBrand(null);
    setBrandForm({ ...emptyBrandForm, organizationId: organizations[0]?.id || '' });
    setBrandError('');
    setBrandModalOpen(true);
  };

  const openEditBrand = (brand) => {
    setEditingBrand(brand);
    setBrandForm({ name: brand.name, organizationId: brand.organization?.id || '' });
    setBrandError('');
    setBrandModalOpen(true);
  };

  const saveBrand = async (e) => {
    e.preventDefault();
    setSavingBrand(true);
    setBrandError('');
    try {
      if (editingBrand) await api.put(`/brands/${editingBrand.id}`, brandForm);
      else await api.post('/brands', brandForm);
      setBrandModalOpen(false);
      load();
    } catch (err) {
      setBrandError(err.message || 'Failed to save brand');
    } finally {
      setSavingBrand(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm({ ...emptyForm, brandId: brands[0]?.id || '' });
    setFormError('');
    setIsModalOpen(true);
  };

  const openEdit = (outlet) => {
    setEditing(outlet);
    setForm({
      name: outlet.name,
      brandId: outlet.brand?.id || '',
      address: outlet.address || '',
    });
    setFormError('');
    setIsModalOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      if (editing) await api.put(`/outlets/${editing.id}`, form);
      else await api.post('/outlets', form);
      setIsModalOpen(false);
      load();
    } catch (err) {
      setFormError(err.message || 'Failed to save outlet');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Sections come from the brand list, not from the outlets — so a brand with
   * nothing under it still appears. Deriving them from outlets is what made a
   * newly created, empty brand invisible on this page.
   *
   * Any outlet whose brand is missing from that list is collected into a
   * trailing group rather than dropped.
   */
  const sections = brands.map((brand) => ({
    brand,
    outlets: outlets.filter((o) => o.brand?.id === brand.id),
  }));
  const known = new Set(brands.map((b) => b.id));
  const orphans = outlets.filter((o) => !o.brand || !known.has(o.brand.id));

  if (loading) {
    return <div className="page-content text-center text-muted">Loading outlets…</div>;
  }

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Brands &amp; Outlets</h1>
          <p className="page-subtitle">
            {outlets.length} outlet{outlets.length === 1 ? '' : 's'} across{' '}
            {brands.length} brand{brands.length === 1 ? '' : 's'}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Link to="/settings" className="btn btn-ghost">
              <Settings size={16} />
              <span>Geofence Settings</span>
            </Link>
            <button className="btn btn-ghost" onClick={openAddBrand} disabled={organizations.length === 0}>
              <Tags size={16} />
              <span>Add Brand</span>
            </button>
            <button
              className="btn btn-primary"
              onClick={openAdd}
              disabled={brands.length === 0}
              title={brands.length === 0 ? 'Create a brand first — an outlet must belong to one' : undefined}
            >
              <Plus size={16} />
              <span>Add Outlet</span>
            </button>
          </div>
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

      {sections.map(({ brand, outlets: brandOutlets }) => (
        <div key={brand.id} className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Tags size={15} className="icon-brand" />
            <h2 className="card-title">{brand.name}</h2>
            <span className="badge badge-ghost">
              {brandOutlets.length} outlet{brandOutlets.length === 1 ? '' : 's'}
            </span>
            {brand.organization?.name && (
              <span className="text-xs text-muted">{brand.organization.name}</span>
            )}
            {canManage && (
              <button
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => openEditBrand(brand)}
                aria-label={`Edit brand ${brand.name}`}
              >
                <Edit size={13} />
              </button>
            )}
          </div>

          {brandOutlets.length === 0 && (
            <p className="text-sm text-muted mb-3">
              No outlets under this brand yet.
            </p>
          )}

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
                  {canManage && (
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      style={{ marginLeft: 'auto' }}
                      onClick={() => openEdit(outlet)}
                      aria-label={`Edit ${outlet.name}`}
                    >
                      <Edit size={14} />
                    </button>
                  )}
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

      {orphans.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Tags size={15} className="icon-muted" />
            <h2 className="card-title">Unassigned</h2>
            <span className="badge badge-ghost">{orphans.length}</span>
          </div>
          <div className="stats-grid">
            {orphans.map((outlet) => (
              <div key={outlet.id} className="card">
                <div className="card-title truncate">{outlet.name}</div>
                <div className="text-xs text-muted">Brand missing or inactive</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {outlets.length === 0 && !error && (
        <div className="card">
          <div className="empty-state">
            <Store size={48} className="empty-icon" />
            <h3>No outlets</h3>
            <p>
              {canManage
                ? brands.length === 0
                  ? 'Create a brand first — every outlet belongs to one.'
                  : 'Add your first outlet, or run the seed script to populate the hierarchy.'
                : 'Run the seed script to populate the hierarchy.'}
            </p>
          </div>
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'Add Outlet'}
      >
        <form onSubmit={save} className="flex flex-col gap-4">
          <div className="form-group">
            <label className="form-label" htmlFor="outlet-name">Name</label>
            <input
              id="outlet-name"
              className="form-input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Capiche Adajan"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="outlet-brand">Brand</label>
            <select
              id="outlet-brand"
              className="form-select"
              value={form.brandId}
              onChange={(e) => setForm((f) => ({ ...f, brandId: e.target.value }))}
              required
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="outlet-address">Address</label>
            <input
              id="outlet-address"
              className="form-input"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              placeholder="Optional"
            />
          </div>

          {/* Deliberately no latitude/longitude/radius here — Settings is the one
              place that writes them, so the geofence has a single owner. */}
          {!editing && (
            <p className="text-xs text-muted">
              A new outlet starts with the default geofence. Set its coordinates
              and radius on the <Link to="/settings">Settings</Link> page.
            </p>
          )}

          {formError && (
            <p className="text-sm" style={{ color: 'var(--ink-crit)' }}>{formError}</p>
          )}

          <div className="flex gap-2" style={{ marginLeft: 'auto' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setIsModalOpen(false)} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving || !form.name || !form.brandId}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create outlet'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isBrandModalOpen}
        onClose={() => setBrandModalOpen(false)}
        title={editingBrand ? `Edit ${editingBrand.name}` : 'Add Brand'}
      >
        <form onSubmit={saveBrand} className="flex flex-col gap-4">
          {brandError && <div className="login-error">{brandError}</div>}

          <div className="form-group">
            <label className="form-label" htmlFor="brand-name">Brand name</label>
            <input
              id="brand-name"
              className="form-input"
              value={brandForm.name}
              onChange={(e) => setBrandForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Capiche"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="brand-org">Organization</label>
            <select
              id="brand-org"
              className="form-select"
              value={brandForm.organizationId}
              onChange={(e) => setBrandForm((f) => ({ ...f, organizationId: e.target.value }))}
              required
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2" style={{ marginLeft: 'auto' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setBrandModalOpen(false)} disabled={savingBrand}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={savingBrand || !brandForm.name || !brandForm.organizationId}>
              {savingBrand ? 'Saving…' : editingBrand ? 'Save changes' : 'Create brand'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
