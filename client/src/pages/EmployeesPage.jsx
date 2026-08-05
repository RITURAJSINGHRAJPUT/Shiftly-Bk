import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api/client';
import Modal from '../components/Modal';
import { useScope } from '../contexts/ScopeContext';
import { GLOBAL_SCOPE_ROLES, STATIONS, departmentHasStations } from '../constants';
import { Plus, Search, Filter, Edit, Trash2, Store, ShieldCheck, Users, KeyRound, Copy } from 'lucide-react';

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
    name: '', email: '', phone: '', role: 'STAFF', department: 'KITCHEN', outletId: '', skills: []
  });
  /**
   * The one-time password just issued, shown once and then gone.
   *
   * What is stored is a bcrypt hash, so this value cannot be looked up again —
   * a lost one needs a reset, which is why it is surfaced this deliberately.
   */
  const [issued, setIssued] = useState(null);

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
    if (!addMode) return;
    setEditingEmployee(null);
    setFormData(
      addMode === 'management'
        ? { name: '', email: '', phone: '', role: 'HR', department: '', outletId: '', skills: [] }
        // The card already chose the outlet, so the form does not ask again.
        : { name: '', email: '', phone: '', role: 'STAFF', department: 'KITCHEN', outletId: selectedGroupId, skills: [] }
    );
    setIssued(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (emp) => {
    setEditingEmployee(emp);
    setFormData({
      name: emp.name,
      email: emp.email || '',
      phone: emp.phone || '',
      role: emp.role,
      // Null for management accounts, and the selects need a string.
      department: emp.department || '',
      outletId: emp.outletId || '',
      skills: emp.skills || []
    });
    setIsModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (editingEmployee) {
        await api.put(`/employees/${editingEmployee.id}`, formData);
        setIsModalOpen(false);
      } else {
        const created = await api.post('/employees', formData);
        // The modal stays open on the reveal: closing it would throw away the
        // only copy of the password that will ever exist.
        setIssued({ name: created.name, email: created.email, password: created.temporaryPassword });
      }
      loadData();
    } catch (err) {
      alert(err.message || 'Failed to save');
    }
  };

  const handleResetPassword = async (emp) => {
    if (!window.confirm(
      `Issue a new one-time password for ${emp.name}? Their current password stops working immediately.`
    )) return;
    try {
      const res = await api.post(`/employees/${emp.id}/reset-password`);
      setEditingEmployee(null);
      setIssued({ name: res.name, email: res.email, password: res.temporaryPassword });
      setIsModalOpen(true);
    } catch (err) {
      alert(err.message || 'Failed to reset the password');
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

  /**
   * Stations offered by the form: the ones the employee's own brand runs, plus
   * any they already hold that are missing from it.
   *
   * That second part is not defensive padding. `Brand.stations` is editable and
   * `npm run seed` writes station names straight from the CSV, so a stored value
   * off the list is expected — and without it, opening someone's profile would
   * quietly untick a station and saving would drop it.
   */
  const stationOptions = useMemo(() => {
    const brandStations = outlets.find(o => o.id === formData.outletId)?.brand?.stations;
    const offered = brandStations?.length ? brandStations : STATIONS;
    const extras = formData.skills.filter(
      s => !offered.some(o => o.toLowerCase() === s)
    );
    // Stored lowercase, shown capitalised — the same shape the list column uses.
    return [...offered, ...extras.map(s => s.charAt(0).toUpperCase() + s.slice(1))];
  }, [outlets, formData.outletId, formData.skills]);

  /**
   * Stored lowercase because that is what the allocator compares against:
   * scoreEmployee tests `employee.skills.includes(slot.section.toLowerCase())`,
   * so a capitalised value would score zero and the preference would silently
   * never apply.
   */
  const toggleStation = (station) => {
    const value = station.toLowerCase();
    setFormData(prev => ({
      ...prev,
      skills: prev.skills.includes(value)
        ? prev.skills.filter(s => s !== value)
        : [...prev.skills, value],
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
   * Organisation-level accounts now carry no outletId at all, so the split falls
   * out of the data. It is still done by role rather than by "has no outlet",
   * because that is the actual rule — and it kept working through the period
   * when those accounts were pinned to a restaurant they had nothing to do with.
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
   * Which kind of account the Add button will create, taken from the selected
   * card. Management accounts belong to no restaurant, so the two forms differ
   * in more than presentation: one has an outlet, a department and stations,
   * the other has none of them.
   */
  const addMode = selected?.isManagement ? 'management' : selected ? 'staff' : null;

  /**
   * Which shape the open form takes, read from the role rather than from how the
   * modal was opened — so editing a management account shows the short form, and
   * changing the role inside the form switches it live.
   */
  const managementForm = GLOBAL_SCOPE_ROLES.includes(formData.role);

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
          <p className="page-subtitle">Manage profiles, departments, outlet assignments and kitchen stations</p>
        </div>
        {/* Disabled until a card is picked: without one there is no outlet to
            put someone in, and no way to know which of the two forms to show. */}
        <button
          className="btn btn-primary"
          onClick={handleOpenAdd}
          disabled={!addMode}
          title={addMode ? undefined : 'Pick Management or an outlet first'}
        >
          <Plus size={16} />
          <span>
            {addMode === 'management' ? 'Add Management User'
              : addMode === 'staff' ? `Add Employee to ${selected.name}`
              : 'Add Employee'}
          </span>
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
                        <th>Stations</th>
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
                            {/* Management accounts have none — a dash rather
                                than an empty badge. */}
                            {emp.department ? (
                              <span className={`badge ${emp.department === 'KITCHEN' ? 'badge-warn' : emp.department === 'SERVICE' ? 'badge-primary' : 'badge-accent'}`}>
                                {emp.department}
                              </span>
                            ) : (
                              <span className="text-xs text-muted">—</span>
                            )}
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
                                className="btn btn-ghost btn-icon btn-sm"
                                onClick={() => handleResetPassword(emp)}
                                aria-label={`Reset password for ${emp.name}`}
                                title="Issue a new one-time password"
                              >
                                <KeyRound size={14} />
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

      {/* Add / Edit Modal. Once a password has been issued the form is replaced
          by the reveal — there is nothing more to fill in, and the password is
          the only thing on screen that cannot be recovered. */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setIssued(null); }}
        title={
          issued ? `One-time password · ${issued.name}`
            : editingEmployee ? `Edit Profile: ${editingEmployee.name}`
            : addMode === 'management' ? 'Add Management User'
            : `Add Employee · ${selected?.name || ''}`
        }
      >
        {issued ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-secondary">
              Give this to <strong>{issued.name}</strong> along with their sign-in
              address, <strong>{issued.email}</strong>. They will be asked to choose
              their own password the first time they sign in.
            </p>

            <div className="temp-password">
              <code>{issued.password}</code>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => navigator.clipboard?.writeText(issued.password)}
              >
                <Copy size={14} />
                <span>Copy</span>
              </button>
            </div>

            <p className="text-xs" style={{ color: 'var(--ink-warn)' }}>
              This is shown once. Bookends Shiftly stores only a hash of it, so it cannot
              looked up again — if it is lost, issue a new one from the key icon on
              their row.
            </p>

            <div className="flex gap-2" style={{ marginLeft: 'auto' }}>
              <button
                className="btn btn-primary"
                onClick={() => { setIsModalOpen(false); setIssued(null); }}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
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
              <label className="form-label">Contact</label>
              <input
                type="text"
                className="form-input"
                value={formData.phone}
                onChange={e => setFormData(prev => ({ ...prev, phone: e.target.value }))}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Role</label>
            <select
              className="form-select"
              value={formData.role}
              onChange={e => {
                const role = e.target.value;
                const toManagement = GLOBAL_SCOPE_ROLES.includes(role);
                setFormData(prev => ({
                  ...prev,
                  role,
                  // The assignment moves with the role. Promoting someone clears
                  // the restaurant they no longer belong to; demoting them has to
                  // land somewhere, so it falls back to the group in view.
                  outletId: toManagement ? '' : (prev.outletId || selectedGroupId || outlets[0]?.id || ''),
                  department: toManagement ? '' : (prev.department || 'KITCHEN'),
                  skills: toManagement ? [] : prev.skills,
                }));
              }}
            >
              {(managementForm
                ? [['SUPER_ADMIN', 'Super Admin'], ['ADMIN', 'Admin'], ['HR', 'HR']]
                : [['MASTER_OF_HOUSE', 'Master of House'], ['HEAD_CHEF', 'Head Chef'], ['STAFF', 'Staff Member']]
              ).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              {/* The other family, so an account can still be promoted or demoted
                  while editing. The lists are split so that adding from an outlet
                  card cannot produce an HR, and vice versa. */}
              <optgroup label={managementForm ? 'Move to an outlet' : 'Move to management'}>
                {(managementForm
                  ? [['MASTER_OF_HOUSE', 'Master of House'], ['HEAD_CHEF', 'Head Chef'], ['STAFF', 'Staff Member']]
                  : [['SUPER_ADMIN', 'Super Admin'], ['ADMIN', 'Admin'], ['HR', 'HR']]
                ).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </optgroup>
            </select>
          </div>

          {managementForm ? (
            <p className="text-xs text-muted">
              Organisation-wide — this account belongs to no restaurant, works no
              department and has no stations.
            </p>
          ) : (
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Department</label>
              <select
                className="form-select"
                value={formData.department}
                onChange={e => setFormData(prev => ({
                  ...prev,
                  department: e.target.value,
                  // Cleared in the same update: leaving stations ticked on a
                  // hidden field would save them anyway.
                  skills: departmentHasStations(e.target.value) ? prev.skills : [],
                }))}
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
          )}

          {/* Kitchen only, like the pattern and shift forms: Service and House
              Keeping have no station to work. */}
          {!managementForm && departmentHasStations(formData.department) && (
            <fieldset className="form-group" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="form-label" style={{ padding: 0 }}>Stations they work</legend>
              <div className="outlet-picker">
                {stationOptions.map(station => (
                  <label key={station} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={formData.skills.includes(station.toLowerCase())}
                      onChange={() => toggleStation(station)}
                    />
                    <span className="truncate" title={station}>{station}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted mt-1">
                Auto-allocation prefers them for these stations. Leave all unticked if
                they work anywhere.
              </p>
            </fieldset>
          )}

          {!editingEmployee && (
            <p className="text-xs text-muted">
              A one-time password is generated when you save, and shown to you once.
              They will be asked to choose their own the first time they sign in.
            </p>
          )}

          <div className="modal-footer" style={{ padding: 0, marginTop: '16px' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setIsModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">
              {editingEmployee ? 'Save Profile' : 'Create and issue password'}
            </button>
          </div>
        </form>
        )}
      </Modal>
    </div>
  );
}
