import { useState, useEffect } from 'react';
import api from '../api/client';
import Modal from '../components/Modal';
import { Tags, Plus, Edit } from 'lucide-react';

export default function BrandsPage() {
  const [brands, setBrands] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', organizationId: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [brandRes, orgRes] = await Promise.all([
        api.get('/brands'),
        api.get('/organizations'),
      ]);
      setBrands(brandRes);
      setOrganizations(orgRes);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', organizationId: organizations[0]?.id || '' });
    setError('');
    setIsModalOpen(true);
  };

  const openEdit = (brand) => {
    setEditing(brand);
    setForm({ name: brand.name, organizationId: brand.organization.id });
    setError('');
    setIsModalOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await api.put(`/brands/${editing.id}`, form);
      } else {
        await api.post('/brands', form);
      }
      setIsModalOpen(false);
      load();
    } catch (err) {
      setError(err.message || 'Failed to save brand');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Brands</h1>
          <p className="page-subtitle">Each brand groups a set of outlets under an organization</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>
          <Plus size={16} />
          <span>Add Brand</span>
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted">Loading brands…</div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Brand</th>
                <th>Organization</th>
                <th>Outlets</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {brands.map((brand) => (
                <tr key={brand.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <Tags size={14} className="icon-brand" />
                      <span className="font-semibold text-strong">{brand.name}</span>
                    </div>
                  </td>
                  <td>{brand.organization?.name}</td>
                  <td>
                    <span className="badge badge-ghost">{brand._count.outlets}</span>
                  </td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      onClick={() => openEdit(brand)}
                      aria-label={`Edit ${brand.name}`}
                    >
                      <Edit size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editing ? 'Edit Brand' : 'Add Brand'}
      >
        <form onSubmit={save} className="flex flex-col gap-4">
          {error && <div className="login-error">{error}</div>}

          <div className="form-group">
            <label className="form-label">Brand Name</label>
            <input
              className="form-input"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Organization</label>
            <select
              className="form-select"
              value={form.organizationId}
              onChange={(e) => setForm((p) => ({ ...p, organizationId: e.target.value }))}
              required
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>

          <div className="modal-footer" style={{ padding: 0, marginTop: 'var(--space-4)' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setIsModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Brand'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
