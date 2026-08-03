import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api/client';
import Modal from '../components/Modal';
import { useScope } from '../contexts/ScopeContext';
import { GLOBAL_SCOPE_ROLES } from '../constants';
import { Plus, Search, Filter, Edit, Trash2, X, PlusCircle, Store, ShieldCheck, Users } from 'lucide-react';

export default function EmployeesPage() {
  // Only for the Add/Edit modal's Outlet field — this page has no outlet filter.
  // The list is scoped server-side from the caller's role.
  const { outlets } = useScope();

  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDept, setFilterDept] = useState('');
  // Nothing selected on load — the employee list below stays empty until a card
  // is picked.
  const [selectedGroupId, setSelectedGroupId] = useState(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', role: 'STAFF', department: 'KITCHEN', outletId: '', skills: [], password: ''
  });
  const [newSkill, setNewSkill] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const empRes = await api.get('/employees?limit=500');
      setEmployees(empRes.employees);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenAdd = () => {
    setEditingEmployee(null);
    setFormData({
      name: '', email: '', phone: '', role: 'STAFF', department: 'KITCHEN', outletId: outlets[0]?.id || '', skills: [], password: 'shiftly123'
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (emp) => {
    setEditingEmployee(emp);
    setFormData({
      name: emp.name,
      email: emp.email || '',
      phone: emp.phone || '',
      role: emp.role,
      department: emp.department,
      outletId: emp.outletId,
      skills: emp.skills || []
    });
    setIsModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (editingEmployee) {
        await api.put(`/employees/${editingEmployee.id}`, formData);
      } else {
        await api.post('/employees', formData);
      }
      setIsModalOpen(false);
      loadData();
    } catch (err) {
      alert(err.message || 'Failed to save');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to deactivate this employee profile?')) return;
    try {
      await api.delete(`/employees/${id}`);
      loadData();
    } catch (err) {
      alert(err.message || 'Failed to delete');
    }
  };

  const handleAddSkill = () => {
    if (newSkill.trim() && !formData.skills.includes(newSkill.trim().toLowerCase())) {
      setFormData(prev => ({
        ...prev,
        skills: [...prev.skills, newSkill.trim().toLowerCase()]
      }));
      setNewSkill('');
    }
  };

  const handleRemoveSkill = (skill) => {
    setFormData(prev => ({
      ...prev,
      skills: prev.skills.filter(s => s !== skill)
    }));
  };

  const filtered = employees.filter(emp => {
    const matchesSearch = emp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (emp.email && emp.email.toLowerCase().includes(searchTerm.toLowerCase()));
    // Outlet scoping happens server-side, from the caller's role.
    const matchesDept = !filterDept || emp.department === filterDept;
    return matchesSearch && matchesDept;
  });

  /**
   * Management first, then one group per outlet.
   *
   * Organization-level accounts still carry an outletId in the database — every
   * one of them happens to point at the first outlet — so grouping purely by
   * outlet filed the Super Admin, Admin and HR under Capiche PIPLOD and inflated
   * its headcount. They are org-wide, so they get their own group and are
   * removed from the outlet counts.
   *
   * The outlet groups are driven by the outlet list rather than by the employee
   * rows, so an outlet with nobody assigned still appears with a count of zero.
   * That absence is worth seeing.
   */
  const groups = useMemo(() => {
    const management = filtered.filter(e => GLOBAL_SCOPE_ROLES.includes(e.role));
    const outletStaff = filtered.filter(e => !GLOBAL_SCOPE_ROLES.includes(e.role));

    const byOutlet = new Map(outlets.map(o => [o.id, []]));
    const orphans = [];
    for (const emp of outletStaff) {
      if (byOutlet.has(emp.outletId)) byOutlet.get(emp.outletId).push(emp);
      else orphans.push(emp);
    }

    const rows = [
      { id: '__management__', name: 'Management', brand: null, isManagement: true, people: management },
      ...outlets.map(o => ({
        id: o.id,
        name: o.name,
        brand: o.brand?.name,
        people: byOutlet.get(o.id),
      })),
    ];
    // Only if the API ever returns someone outside the visible outlet list.
    if (orphans.length) rows.push({ id: '__other__', name: 'Other', brand: null, people: orphans });
    return rows;
  }, [outlets, filtered]);

  const isFiltering = searchTerm.trim() !== '' || filterDept !== '';

  /**
   * The cards above are the selector; the list below is the detail pane. Null
   * until something is picked, so the page opens as an overview of where people
   * are rather than a wall of names.
   */
  const selected = groups.find(g => g.id === selectedGroupId) || null;

  /**
   * A filter that matched someone in an unselected group would otherwise show
   * nothing at all, so move the selection to the first group that has matches.
   * The card counts already reflect the filter, so it stays obvious where the
   * results are.
   */
  useEffect(() => {
    if (!isFiltering) return;
    const current = groups.find(g => g.id === selectedGroupId);
    if (current && current.people.length > 0) return;
    const firstHit = groups.find(g => g.people.length > 0);
    if (firstHit) setSelectedGroupId(firstHit.id);
  }, [isFiltering, groups, selectedGroupId]);

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Employee Directory</h1>
          <p className="page-subtitle">Manage profiles, departments, outlet assignments, and specialized culinary skills</p>
        </div>
        <button className="btn btn-primary" onClick={handleOpenAdd}>
          <Plus size={16} />
          <span>Add Employee</span>
        </button>
      </div>

      <div className="card mb-4">
        <div className="flex gap-4 items-center flex-wrap">
          <div className="header-search" style={{ flex: 1, minWidth: '240px' }}>
            <Search className="search-icon" size={18} />
            <input
              type="text"
              placeholder="Search by name or email..."
              style={{ width: '100%' }}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex gap-2 items-center flex-wrap">
            <Filter size={16} className="icon-muted" />
            <select
              className="form-select"
              style={{ width: 'auto' }}
              value={filterDept}
              onChange={e => setFilterDept(e.target.value)}
              aria-label="Department"
            >
              <option value="">All Departments</option>
              <option value="KITCHEN">Kitchen</option>
              <option value="SERVICE">Service</option>
              <option value="HOUSEKEEPING">Housekeeping</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8">Loading employees data…</div>
      ) : (
        <>
          {/* Selector: one card per group, showing where people actually are. */}
          <div className="stats-grid mb-4">
            {groups.map(group => {
              const active = group.id === selectedGroupId;
              return (
                <button
                  key={group.id}
                  type="button"
                  className={`card group-card ${active ? 'is-active' : ''}`}
                  onClick={() => setSelectedGroupId(active ? null : group.id)}
                  aria-pressed={active}
                >
                  <div className="flex items-center gap-3">
                    <div className="stat-icon">
                      {group.isManagement ? <ShieldCheck size={16} /> : <Store size={16} />}
                    </div>
                    <div style={{ minWidth: 0, textAlign: 'left' }}>
                      <div className="card-title truncate">{group.name}</div>
                      <div className="text-xs text-muted truncate">
                        {group.brand || (group.isManagement ? 'Organization-wide' : 'No brand')}
                      </div>
                    </div>
                    <div className="group-card-count">{group.people.length}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detail: empty until a card is chosen. */}
          {!selected ? (
            <div className="card">
              <div className="empty-state">
                <Users size={48} className="empty-icon" />
                <h3>Select a group above</h3>
                <p>Pick an outlet or Management to see the people in it.</p>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="card-header">
                <div className="flex items-center gap-2">
                  {selected.isManagement
                    ? <ShieldCheck size={17} className="icon-good" />
                    : <Store size={17} className="icon-brand" />}
                  <h3 className="card-title">{selected.name}</h3>
                  {selected.brand && <span className="badge badge-ghost">{selected.brand}</span>}
                  <span className="text-sm text-muted" style={{ marginLeft: 'auto' }}>
                    {selected.people.length} {selected.people.length === 1 ? 'person' : 'people'}
                  </span>
                </div>
              </div>

              {selected.people.length === 0 ? (
                <p className="text-sm text-muted">
                  {isFiltering
                    ? 'No one here matches the filters.'
                    : selected.isManagement
                      ? 'No organization-level accounts.'
                      : 'No employees assigned to this outlet.'}
                </p>
              ) : (
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Department</th>
                        <th>Role</th>
                        <th>Skills &amp; Specialties</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.people.map(emp => (
                        <tr key={emp.id}>
                          <td>
                            <div className="font-semibold" style={{ color: 'var(--ink-strong)' }}>{emp.name}</div>
                            <div className="text-xs text-muted">{emp.email}</div>
                          </td>
                          <td>
                            <span className={`badge ${emp.department === 'KITCHEN' ? 'badge-warn' : emp.department === 'SERVICE' ? 'badge-primary' : 'badge-accent'}`}>
                              {emp.department}
                            </span>
                          </td>
                          <td>{emp.role.replace(/_/g, ' ')}</td>
                          <td>
                            <div className="flex gap-1 flex-wrap">
                              {emp.skills?.map(skill => (
                                <span key={skill} className="badge badge-ghost text-xs" style={{ textTransform: 'capitalize' }}>
                                  {skill}
                                </span>
                              ))}
                              {(!emp.skills || emp.skills.length === 0) && (
                                <span className="text-xs text-muted">-</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className="flex gap-2">
                              <button
                                className="btn btn-ghost btn-icon btn-sm"
                                onClick={() => handleOpenEdit(emp)}
                                aria-label={`Edit ${emp.name}`}
                              >
                                <Edit size={14} />
                              </button>
                              <button
                                className="btn btn-ghost btn-icon btn-sm icon-crit"
                                onClick={() => handleDelete(emp.id)}
                                aria-label={`Deactivate ${emp.name}`}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Add / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingEmployee ? `Edit Profile: ${editingEmployee.name}` : 'Add Employee Profile'}
      >
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div className="form-group">
            <label className="form-label">Name</label>
            <input
              type="text"
              className="form-input"
              value={formData.name}
              onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-input"
                value={formData.email}
                onChange={e => setFormData(prev => ({ ...prev, email: e.target.value }))}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input
                type="text"
                className="form-input"
                value={formData.phone}
                onChange={e => setFormData(prev => ({ ...prev, phone: e.target.value }))}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Department</label>
              <select
                className="form-select"
                value={formData.department}
                onChange={e => setFormData(prev => ({ ...prev, department: e.target.value }))}
              >
                <option value="KITCHEN">Kitchen</option>
                <option value="SERVICE">Service</option>
                <option value="HOUSEKEEPING">Housekeeping</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Outlet</label>
              <select
                className="form-select"
                value={formData.outletId}
                onChange={e => setFormData(prev => ({ ...prev, outletId: e.target.value }))}
              >
                {outlets.map(v => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Role</label>
            <select
              className="form-select"
              value={formData.role}
              onChange={e => setFormData(prev => ({ ...prev, role: e.target.value }))}
            >
              <option value="SUPER_ADMIN">Super Admin</option>
              <option value="ADMIN">Admin</option>
              <option value="HR">HR</option>
              <option value="MASTER_OF_HOUSE">Master of House</option>
              <option value="HEAD_CHEF">Head Chef</option>
              <option value="STAFF">Staff Member</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Skills & Specialties (e.g. Pizza, Pasta, Sushi, Wok)</label>
            <div className="flex gap-2">
              <input
                type="text"
                className="form-input"
                placeholder="Type skill and click add"
                value={newSkill}
                onChange={e => setNewSkill(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddSkill())}
              />
              <button type="button" className="btn btn-ghost" onClick={handleAddSkill}>
                <PlusCircle size={18} />
              </button>
            </div>
            <div className="flex gap-1 flex-wrap mt-2">
              {formData.skills.map(skill => (
                <span key={skill} className="badge badge-primary gap-2">
                  <span style={{ textTransform: 'capitalize' }}>{skill}</span>
                  <X size={10} style={{ cursor: 'pointer' }} onClick={() => handleRemoveSkill(skill)} />
                </span>
              ))}
            </div>
          </div>

          {!editingEmployee && (
            <div className="form-group">
              <label className="form-label">Temporary Password</label>
              <input
                type="text"
                className="form-input"
                value={formData.password}
                onChange={e => setFormData(prev => ({ ...prev, password: e.target.value }))}
                required
              />
            </div>
          )}

          <div className="modal-footer" style={{ padding: 0, marginTop: '16px' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setIsModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save Profile</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
