import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../api/client';
import Modal from '../components/Modal';
import DirectoryPicker from '../components/DirectoryPicker';
import { useScope } from '../contexts/ScopeContext';
import { useAuth } from '../contexts/AuthContext';
import { GLOBAL_SCOPE_ROLES, STATIONS, DEPARTMENTS as ALL_DEPARTMENTS, departmentHasStations, departmentsFor } from '../constants';
import { Plus, Search, Filter, Edit, Trash2, Store, ShieldCheck, Users, KeyRound, Copy, Check, Hash } from 'lucide-react';

/**
 * Role options for the Add/Edit modal, split by which "side" of the
 * management/outlet line they sit on. HR gets the full OUTLET_ROLES list; what
 * HR cannot assign is the management roles. There was a third, narrower list
 * for Outlet Managers; they no longer write employee records at all, so the
 * only way to reach this modal is as HR or above, or as a department head
 * enrolling Staff.
 */
const OUTLET_ROLES = [
  ['OUTLET_MANAGER', 'Outlet Manager'], ['MASTER_OF_HOUSE', 'Master of House'],
  ['HEAD_CHEF', 'Head Chef'], ['STAFF', 'Staff Member'],
];
const MANAGEMENT_ROLES = [['SUPER_ADMIN', 'Super Admin'], ['ADMIN', 'Admin'], ['HR', 'HR']];

export default function EmployeesPage() {
  // Only for the Add/Edit modal's Outlet field — this page has no outlet filter.
  // The list is scoped server-side from the caller's role.
  const { outlets } = useScope();
  const { user } = useAuth();
  // HR and Outlet Manager both administer outlet-level accounts only — neither
  // can see/assign SUPER_ADMIN/ADMIN/HR/OUTLET_MANAGER accounts.
  const isOutletScopedAdmin = ['HR', 'OUTLET_MANAGER'].includes(user?.role);

  /**
   * A department head enrolling into their own patch.
   *
   * The narrowest tier: their own restaurant, the departments their role owns,
   * Staff only, and a clock-in-only record with no sign-in. Mirrors
   * EMPLOYEE_ENROL and assignmentDenied() on the server, which enforce all of
   * it regardless — this decides what is worth putting on screen.
   */
  const isDepartmentHead = ['MASTER_OF_HOUSE', 'HEAD_CHEF'].includes(user?.role);

  /**
   * Whether this page is a directory or a workbench.
   *
   * An Outlet Manager reads it and writes nothing: every write on it —
   * EMPLOYEE_ENROL, EMPLOYEE_EDIT, EMPLOYEE_RESET_PW, EMPLOYEE_DEACTIVATE — is
   * now closed to them server-side. App.jsx mounts routes with no role guard of
   * its own, so what a page chooses to render is the only thing standing
   * between a role and a screen full of buttons that 403.
   */
  const canWrite = user?.role !== 'OUTLET_MANAGER';

  /**
   * Which departments a given target role may be put in.
   *
   * A two-level fallback, not an intersection. A role that owns departments is
   * constrained by that and nothing else — a Master of House works Service or
   * Housekeeping, never Kitchen. Everything else (Staff, mainly) falls back to
   * what the *actor* owns, so a Head Chef enrolling staff sees only Kitchen.
   *
   * Intersecting the two would produce an empty list: a department head's role
   * select is locked to Staff, and Staff owns no departments at all.
   */
  const ownedDepartments = departmentsFor(user?.role);

  const departmentOptionsFor = useCallback((targetRole) => {
    const targetOwned = departmentsFor(targetRole);
    if (targetOwned.length) return targetOwned;
    return isDepartmentHead ? ownedDepartments : ALL_DEPARTMENTS;
  }, [isDepartmentHead, ownedDepartments]);

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
  // Opened from the key on a clock-in-only row: focus the email field and say
  // what saving it will do.
  const [grantingLogin, setGrantingLogin] = useState(false);
  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', role: 'STAFF', department: 'KITCHEN', outletId: '', skills: [], employeeCode: ''
  });
  /**
   * The one-time password just issued, shown once and then gone.
   *
   * What is stored is a bcrypt hash, so this value cannot be looked up again —
   * a lost one needs a reset, which is why it is surfaced this deliberately.
   */
  const [issued, setIssued] = useState(null);

  /**
   * Bulk employee-code assignment.
   *
   * Attendance punches find their way to a person by employee code, so a roster
   * with none imports nothing. Setting them one modal at a time is the only way
   * there was, which does not survive a restaurant's worth of staff.
   */
  const [codesOpen, setCodesOpen] = useState(false);
  const [codeDrafts, setCodeDrafts] = useState({});
  const [savingCodes, setSavingCodes] = useState(false);
  const [codeResult, setCodeResult] = useState(null);

  /**
   * What the punch log knows about the code being typed.
   *
   * Debounced rather than fired per keystroke: a code is 4-6 characters, so
   * without it every enrolment would make half a dozen round trips. The result
   * is advisory — the server refuses a duplicate regardless — but it turns a
   * blind entry into a confirmation.
   */
  const [codeLookup, setCodeLookup] = useState(null);

  useEffect(() => {
    const code = formData.employeeCode?.trim();
    // Editing someone keeps their own code, which would always report "belongs
    // to" themselves.
    if (!code || code === editingEmployee?.employeeCode) {
      setCodeLookup(null);
      return;
    }
    let cancelled = false;
    setCodeLookup({ loading: true });
    const t = setTimeout(async () => {
      try {
        const res = await api.get(`/employees/lookup?code=${encodeURIComponent(code)}`);
        if (cancelled) return;
        setCodeLookup(res);
        // Fill the name rather than offering a button for it: the code is
        // typed precisely so the person does not have to be identified twice,
        // and a free code with a known name has exactly one sensible answer.
        // Only into an empty field — anything already typed was deliberate and
        // is never overwritten.
        if (res?.suggestedName && !res.takenBy) {
          setFormData((prev) => (prev.name?.trim() ? prev : { ...prev, name: res.suggestedName }));
        }
      } catch (err) {
        // Say so rather than going quiet. Rendering nothing made a broken
        // directory indistinguishable from a working one with no match, which
        // is how an unmigrated database went unnoticed: every keystroke 500'd
        // and the form simply never offered a name. The field still works
        // either way — this only explains why no name arrived.
        if (!cancelled) setCodeLookup({ failed: true, reason: err?.message });
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [formData.employeeCode, editingEmployee]);

  // "Copied" feedback for the one-time-password reveal's Copy button.
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef(null);

  // Reset feedback whenever a new password is issued or the reveal is
  // dismissed, so re-issuing never shows stale "Copied" state.
  useEffect(() => {
    setCopied(false);
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, [issued]);

  const handleCopyPassword = useCallback(() => {
    if (!issued) return;
    navigator.clipboard?.writeText(issued.password);
    setCopied(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 1800);
  }, [issued]);

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
    // Otherwise a sign-in grant opened earlier would still mark email required.
    setGrantingLogin(false);
    setEditingEmployee(null);
    setFormData(
      addMode === 'management'
        ? { name: '', email: '', phone: '', role: 'HR', department: '', outletId: '', skills: [], employeeCode: '' }
        // The card already chose the outlet, so the form does not ask again.
        // The department a department head actually owns, not a hard-coded
        // KITCHEN. A Master of House is offered Service and Housekeeping only,
        // so defaulting to KITCHEN left the select showing "Service" while the
        // form still held KITCHEN — and the save came back 403 contradicting
        // what was on screen.
        : {
          name: '', email: '', phone: '', role: 'STAFF',
          department: ownedDepartments[0] || 'KITCHEN',
          outletId: selectedGroupId, skills: [], employeeCode: '',
        }
    );
    setIssued(null);
    setIsModalOpen(true);
  };

  /** Keeps a department within what the role may hold; '' for roles with none. */
  const normaliseDepartment = useCallback((role, department) => {
    if (GLOBAL_SCOPE_ROLES.includes(role) || role === 'OUTLET_MANAGER') return '';
    const options = departmentOptionsFor(role);
    return options.includes(department) ? department : (options[0] || '');
  }, [departmentOptionsFor]);

  const handleOpenEdit = (emp, { grantLogin = false } = {}) => {
    setGrantingLogin(grantLogin);
    setEditingEmployee(emp);
    setFormData({
      name: emp.name,
      email: emp.email || '',
      phone: emp.phone || '',
      role: emp.role,
      // Null for management accounts, and the selects need a string.
      //
      // Normalised to something the role can actually hold: a Master of House
      // saved as Kitchen (which an older default allowed) would otherwise open
      // with a select whose value matches no option — the browser shows
      // "Service" while the form still holds KITCHEN, and saving is refused
      // with a message about a value nobody chose. Opening and saving such a
      // record is what repairs it.
      department: normaliseDepartment(emp.role, emp.department),
      outletId: emp.outletId || '',
      skills: emp.skills || [],
      employeeCode: emp.employeeCode || ''
    });
    setIsModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (editingEmployee) {
        const updated = await api.put(`/employees/${editingEmployee.id}`, formData);
        // Giving a clock-in-only person an email turns them into an account, and
        // the server issues their first password in that same write. It is shown
        // once, so the modal has to stay open on it.
        if (updated.temporaryPassword) {
          setEditingEmployee(null);
          setIssued({ name: updated.name, email: updated.email, password: updated.temporaryPassword });
        } else {
          setIsModalOpen(false);
        }
      } else {
        const created = await api.post('/employees', formData);
        if (created.temporaryPassword) {
          // The modal stays open on the reveal: closing it would throw away the
          // only copy of the password that will ever exist.
          setIssued({ name: created.name, email: created.email, password: created.temporaryPassword });
        } else {
          // A clock-in-only record has no sign-in, so there is nothing to
          // reveal — showing the panel anyway printed "undefined" as both the
          // address and the password, and copied that to the clipboard.
          setIsModalOpen(false);
        }
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
    if (!window.confirm('Deactivate this employee? They will no longer be able to sign in, but their shift, attendance and leave history is kept.')) return;
    try {
      await api.delete(`/employees/${id}`);
      loadData();
    } catch (err) {
      alert(err.message || 'Failed to deactivate');
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
    const q = searchTerm.toLowerCase();
    const matchesSearch = emp.name.toLowerCase().includes(q) ||
      (emp.email && emp.email.toLowerCase().includes(q)) ||
      // Their code is the identifier a clock-in-only record actually has, and
      // it is what the attendance import reports when it cannot match someone.
      (emp.employeeCode && emp.employeeCode.toLowerCase().includes(q));
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
      ...(!isOutletScopedAdmin && !isDepartmentHead ? [{ id: '__management__', name: 'Management', brand: null, isManagement: true, people: management }] : []),
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
  }, [outlets, filtered, isOutletScopedAdmin]);

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

  const openCodes = () => {
    setCodeResult(null);
    setCodeDrafts(Object.fromEntries(
      (selected?.people || []).map((e) => [e.id, e.employeeCode || ''])
    ));
    setCodesOpen(true);
  };

  const saveCodes = async () => {
    setSavingCodes(true);
    setCodeResult(null);
    try {
      // Only what actually changed — resending an unchanged code would collide
      // with itself on the unique constraint and report a false conflict.
      const assignments = Object.entries(codeDrafts)
        .filter(([id, code]) => {
          const current = selected.people.find((p) => p.id === id)?.employeeCode || '';
          return code.trim() !== current;
        })
        .map(([id, employeeCode]) => ({ id, employeeCode }));

      if (assignments.length === 0) {
        setCodeResult({ updated: 0, conflicts: [], nothing: true });
        return;
      }

      const res = await api.put('/employees/codes', { assignments });
      setCodeResult(res);
      loadData();
    } catch (err) {
      setCodeResult({ error: err.message || 'Could not save codes' });
    } finally {
      setSavingCodes(false);
    }
  };

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Employee Directory</h1>
          <p className="page-subtitle">
            {canWrite
              ? 'Manage profiles, departments, outlet assignments and kitchen stations'
              : 'Who works where, in which department, and on which stations'}
          </p>
        </div>
        {canWrite && (
        <div className="flex gap-2">
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
          {selected?.people?.length > 0 && (
            <button className="btn btn-ghost" onClick={openCodes}>
              <Hash size={16} />
              <span>Assign Codes</span>
            </button>
          )}
        </div>
        )}
      </div>

      <div className="card mb-4">
        <div className="flex gap-4 items-center flex-wrap">
          <div className="header-search" style={{ flex: 1, minWidth: '240px' }}>
            <Search className="search-icon" size={18} />
            <input
              type="text"
              placeholder="Search by name, email or code..."
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
                        <th>Code</th>
                        <th>Department</th>
                        <th>Role</th>
                        <th>Stations</th>
                        {canWrite && <th>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {selected.people.map(emp => (
                        <tr key={emp.id}>
                          <td>
                            <div className="font-semibold" style={{ color: 'var(--ink-strong)' }}>{emp.name}</div>
                            <div className="text-xs text-muted">
                              {emp.email || (emp.employeeCode ? 'Clock-in only' : '—')}
                            </div>
                          </td>
                          <td>
                            {/* Visible because attendance will not reach anyone
                                without it, and a missing one is invisible
                                otherwise until their hours never appear. */}
                            {emp.employeeCode
                              ? <span className="badge badge-ghost">{emp.employeeCode}</span>
                              : <span className="text-xs text-muted">— not set</span>}
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
                          {canWrite && (
                          <td>
                            <div className="flex gap-2">
                              <button
                                className="btn btn-ghost btn-icon btn-sm"
                                onClick={() => handleOpenEdit(emp)}
                                aria-label={`Edit ${emp.name}`}
                              >
                                <Edit size={14} />
                              </button>
                              {/* Both are HR-and-above actions, so for a
                                  department head they would 403 on click. A
                                  head can correct their own staff; taking over
                                  or locking out an account is not theirs. */}
                              {!isDepartmentHead && (
                              <>
                              {/* A clock-in-only record has no sign-in address,
                                  so there is no password to reissue — the server
                                  refuses it. Give them an email on the edit form
                                  and one is issued in that same save. */}
                              <button
                                className="btn btn-ghost btn-icon btn-sm"
                                // For a clock-in-only record this opens the edit
                                // form on the email field instead of sitting
                                // disabled. Adding an email is how they get a
                                // sign-in, and a greyed-out key with the route
                                // hidden in a tooltip left HR with no way through.
                                onClick={() => (emp.email ? handleResetPassword(emp) : handleOpenEdit(emp, { grantLogin: true }))}
                                aria-label={emp.email ? `Reset password for ${emp.name}` : `Give ${emp.name} a sign-in`}
                                title={emp.email
                                  ? 'Issue a new one-time password'
                                  : 'Give them a sign-in — add an email and a one-time password is issued'}
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
                              </>
                              )}
                            </div>
                          </td>
                          )}
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
                className={`btn btn-ghost btn-sm${copied ? ' btn-copied' : ''}`}
                onClick={handleCopyPassword}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
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
            {!isDepartmentHead && (
            <div className="form-group">
              <label className="form-label">
                Email {formData.employeeCode?.trim() && <span className="text-muted">(optional)</span>}
              </label>
              <input
                type="email"
                className="form-input"
                value={formData.email}
                onChange={e => setFormData(prev => ({ ...prev, email: e.target.value }))}
                /* One identifier is enough: an email to sign in with, or a code
                   for the punch log to find them by. */
                required={grantingLogin || !formData.employeeCode?.trim()}
                autoFocus={grantingLogin}
              />
              {editingEmployee && !editingEmployee.email && (
                <p className="text-xs text-muted mt-1">
                  Clock-in only today. Add an email to give {editingEmployee.name} a sign-in —
                  a one-time password is shown when you save.
                </p>
              )}
            </div>
            )}
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
            <label className="form-label">
              Employee Code {isDepartmentHead ? '' : '(optional)'}
            </label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. DP443"
              value={formData.employeeCode}
              onChange={e => setFormData(prev => ({ ...prev, employeeCode: e.target.value }))}
              required={isDepartmentHead}
            />
            {/* What the punch log says this code belongs to, looked up as it is
                typed. A mistyped code is the failure with teeth: the import
                drops that person's hours and reports the id to somebody else,
                so confirming the name here is the whole point. */}
            {codeLookup?.loading && <p className="text-xs text-muted mt-1">Checking…</p>}
            {codeLookup?.failed && (
              <p className="text-xs mt-1" style={{ color: 'var(--ink-warn)' }}>
                Couldn't check the staff directory. Type the name yourself — the code still saves.
              </p>
            )}
            {/* A code the punch log has never seen. Worth saying: it usually
                means a typo, and a typo'd code silently loses that person's
                hours at the next attendance import. */}
            {codeLookup && !codeLookup.loading && !codeLookup.failed
              && !codeLookup.suggestedName && !codeLookup.takenBy && (
              <p className="text-xs text-muted mt-1">
                Not in the punch directory yet. Check the code, or type the name to continue.
              </p>
            )}
            {codeLookup?.elsewhere && (
              <p className="text-xs mt-1" style={{ color: 'var(--ink-crit)' }}>
                Already used at another restaurant — ask HR.
              </p>
            )}
            {codeLookup?.takenBy?.name && (
              <p className="text-xs mt-1" style={{ color: 'var(--ink-crit)' }}>
                Belongs to {codeLookup.takenBy.name}
                {codeLookup.takenBy.isActive ? '' : ' (deactivated)'}.
              </p>
            )}
            {codeLookup?.suggestedName && !codeLookup.takenBy && (
              <p className="text-xs mt-1" style={{ color: 'var(--ink-good)' }}>
                {/* Kept visible after the auto-fill so the name in the field is
                    never a mystery — and so a wrong code is obvious from the
                    name being wrong, which is the whole safeguard here. */}
                Punch log says <strong>{codeLookup.suggestedName}</strong>
                {codeLookup.punchCount ? ` · ${codeLookup.punchCount} punches` : ''}
                {formData.name?.trim() === codeLookup.suggestedName ? ' · filled in' : ''}
              </p>
            )}
            <p className="text-xs text-muted mt-1">
              {isDepartmentHead
                ? 'How the attendance system identifies them. Matched exactly, so the case matters.'
                : 'Links this person to their id in an external attendance system, if any.'}
            </p>
            {/* For whoever knows the person but not their code, which is the
                usual way round for a department head. */}
            {!editingEmployee && (
              <DirectoryPicker
                onPick={({ userid, name }) =>
                  setFormData((prev) => ({
                    ...prev,
                    employeeCode: userid,
                    // The picked entry is the authority on the name, but a name
                    // already typed stays — same rule as the auto-fill above.
                    name: prev.name?.trim() ? prev.name : (name || prev.name),
                  }))
                }
              />
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Role</label>
            <select
              className="form-select"
              value={formData.role}
              onChange={e => {
                const role = e.target.value;
                const toManagement = GLOBAL_SCOPE_ROLES.includes(role);
                // An Outlet Manager needs an outlet but no single department —
                // they oversee the whole restaurant, not one section of it.
                const toOutletManager = role === 'OUTLET_MANAGER';
                setFormData(prev => {
                  // Normalised against the *new* role, so switching to Master of
                  // House cannot leave Kitchen behind in the form.
                  const department = (toManagement || toOutletManager)
                    ? ''
                    : normaliseDepartment(role, prev.department || departmentOptionsFor(role)[0]);
                  return {
                    ...prev,
                    role,
                    // The assignment moves with the role. Promoting someone clears
                    // the restaurant they no longer belong to; demoting them has to
                    // land somewhere, so it falls back to the group in view.
                    outletId: toManagement ? '' : (prev.outletId || selectedGroupId || outlets[0]?.id || ''),
                    department,
                    // Stations are a kitchen concept. Promoting a Kitchen staffer
                    // would otherwise leave the boxes ticked against a department
                    // that has none, and post them.
                    skills: departmentHasStations(department) ? prev.skills : [],
                  };
                });
              }}
            >
              {(isDepartmentHead
                ? [['STAFF', 'Staff Member']]
                : managementForm
                  ? MANAGEMENT_ROLES
                  : OUTLET_ROLES
              ).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              {!isOutletScopedAdmin && !isDepartmentHead && (
              <optgroup label={managementForm ? 'Move to an outlet' : 'Move to management'}>
                {(managementForm ? OUTLET_ROLES : MANAGEMENT_ROLES)
                  .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </optgroup>
              )}
            </select>
          </div>

          {managementForm ? (
            <p className="text-xs text-muted">
              Organisation-wide — this account belongs to no restaurant, works no
              department and has no stations.
            </p>
          ) : (
          <div className="form-row">
            {formData.role !== 'OUTLET_MANAGER' && (
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
                {/* Keyed on the role being assigned, not on who is filling the
                    form in. A Master of House works Service or Housekeeping and
                    never Kitchen — which the old actor-keyed version happily
                    offered, and the server happily stored. */}
                {departmentOptionsFor(formData.role).map(d => (
                  <option key={d} value={d}>{d.charAt(0) + d.slice(1).toLowerCase()}</option>
                ))}
              </select>
            </div>
            )}
            {/* Not offered to a department head: the server pins the record to
                their own restaurant whatever is sent, so a select here could
                only mislead. */}
            {!isDepartmentHead && (
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
            )}
          </div>
          )}

          {!managementForm && formData.role === 'OUTLET_MANAGER' && (
            <p className="text-xs text-muted">
              Oversees the whole restaurant — no single department, and no
              stations of their own.
            </p>
          )}

          {/* Kitchen only, like the pattern and shift forms: Service and House
              Keeping have no station to work. */}
          {!managementForm && formData.role !== 'OUTLET_MANAGER' && departmentHasStations(formData.department) && (
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

      <Modal
        isOpen={codesOpen}
        onClose={() => setCodesOpen(false)}
        title={`Employee codes · ${selected?.name || ''}`}
        wide
      >
        <p className="text-sm text-secondary">
          The id each person has in the attendance system. Punches are matched on
          this, so anyone without one records no hours. Blank clears it.
        </p>

        {codeResult && (
          <div className={`card mt-3 ${codeResult.error || codeResult.conflicts?.length ? 'card--alert-warn' : 'card--alert-good'}`}>
            <p className="text-sm font-semibold" style={{ color: codeResult.error ? 'var(--ink-crit)' : 'var(--ink-strong)' }}>
              {codeResult.error
                || (codeResult.nothing ? 'Nothing changed.' : `${codeResult.updated} code(s) saved.`)}
            </p>
            {/* Named per row: a batch that reports only "a code is in use"
                leaves you guessing which of forty it was. */}
            {codeResult.conflicts?.length > 0 && (
              <div className="divided-list mt-2">
                {codeResult.conflicts.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-strong">
                      {selected?.people?.find((p) => p.id === c.id)?.name || c.id}
                    </span>
                    <span className="badge badge-ghost">{c.employeeCode || '—'}</span>
                    <span className="text-secondary" style={{ marginLeft: 'auto' }}>{c.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="divided-list mt-3" style={{ maxHeight: '46vh', overflowY: 'auto' }}>
          {(selected?.people || []).map((emp) => (
            <div key={emp.id} className="flex items-center gap-3">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="text-sm font-semibold text-strong">{emp.name}</div>
                <div className="text-xs text-muted">{emp.department || emp.role.replace(/_/g, ' ')}</div>
              </div>
              <input
                type="text"
                className="form-input"
                style={{ maxWidth: 160 }}
                placeholder="e.g. DP443"
                value={codeDrafts[emp.id] ?? ''}
                onChange={(e) => setCodeDrafts((prev) => ({ ...prev, [emp.id]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        <div className="modal-footer" style={{ padding: 0, marginTop: '16px' }}>
          <button type="button" className="btn btn-ghost" onClick={() => setCodesOpen(false)} disabled={savingCodes}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={saveCodes} disabled={savingCodes}>
            {savingCodes ? 'Saving…' : 'Save codes'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
