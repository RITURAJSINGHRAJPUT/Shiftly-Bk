import { useState, useEffect } from 'react';
import api from '../api/client';
import Modal from '../components/Modal';
import { Plus, Search, Filter, Edit, Trash2, X, PlusCircle } from 'lucide-react';

export default function EmployeesPage() {
  const [employees, setEmployees] = useState([]);
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterVenue, setFilterVenue] = useState('');
  const [filterDept, setFilterDept] = useState('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', role: 'STAFF', department: 'KITCHEN', venueId: '', skills: [], password: ''
  });
  const [newSkill, setNewSkill] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [empRes, venueRes] = await Promise.all([
        api.get('/employees'),
        api.get('/notifications/venues')
      ]);
      setEmployees(empRes.employees);
      setVenues(venueRes);
      if (venueRes.length > 0 && !formData.venueId) {
        setFormData(prev => ({ ...prev, venueId: venueRes[0].id }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingEmployee(null);
    setFormData({
      name: '', email: '', phone: '', role: 'STAFF', department: 'KITCHEN', venueId: venues[0]?.id || '', skills: [], password: 'shiftly123'
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
      venueId: emp.venueId,
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
    const matchesVenue = !filterVenue || emp.venueId === filterVenue;
    const matchesDept = !filterDept || emp.department === filterDept;
    return matchesSearch && matchesVenue && matchesDept;
  });

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Employee Directory</h1>
          <p className="page-subtitle">Manage profiles, departments, venue assignments, and specialized culinary skills</p>
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
            <Filter size={16} style={{ color: 'var(--text-muted)' }} />
            <select
              className="form-select"
              style={{ width: 'auto', padding: '6px 12px' }}
              value={filterVenue}
              onChange={e => setFilterVenue(e.target.value)}
            >
              <option value="">All Venues</option>
              {venues.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>

            <select
              className="form-select"
              style={{ width: 'auto', padding: '6px 12px' }}
              value={filterDept}
              onChange={e => setFilterDept(e.target.value)}
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
        <div className="text-center py-8">Loading employees data...</div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Department</th>
                <th>Venue</th>
                <th>Role</th>
                <th>Skills & Specialties</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(emp => (
                <tr key={emp.id}>
                  <td>
                    <div className="font-semibold text-primary" style={{ color: 'var(--text-primary)' }}>{emp.name}</div>
                    <div className="text-xs text-muted">{emp.email}</div>
                  </td>
                  <td>
                    <span className={`badge ${emp.department === 'KITCHEN' ? 'badge-warn' : emp.department === 'SERVICE' ? 'badge-primary' : 'badge-accent'}`}>
                      {emp.department}
                    </span>
                  </td>
                  <td>{emp.venue?.name}</td>
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
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleOpenEdit(emp)}>
                        <Edit size={14} />
                      </button>
                      <button className="btn btn-ghost btn-icon btn-sm" style={{ color: 'var(--error-400)' }} onClick={() => handleDelete(emp.id)}>
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
              <label className="form-label">Venue</label>
              <select
                className="form-select"
                value={formData.venueId}
                onChange={e => setFormData(prev => ({ ...prev, venueId: e.target.value }))}
              >
                {venues.map(v => (
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
