import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import Modal from '../components/Modal';
import { ScrollText, Search, ChevronLeft, ChevronRight, Filter, X } from 'lucide-react';
import { format } from 'date-fns';

const ACTION_COLORS = {
  LOGIN: 'info',
  LOGIN_FAILED: 'crit',
  PASSWORD_CHANGE: 'warn',
  EMPLOYEE_CREATE: 'good',
  EMPLOYEE_EDIT: 'info',
  EMPLOYEE_DELETE: 'crit',
  STAFF_WIPE: 'crit',
  SHIFT_CREATE: 'good',
  SHIFT_ALLOCATE: 'brand',
  SHIFT_DELETE: 'crit',
  LEAVE_APPROVE: 'good',
  LEAVE_REJECT: 'crit',
  OUTLET_CREATE: 'good',
  OUTLET_EDIT: 'info',
  BRAND_CREATE: 'good',
  BRAND_EDIT: 'info',
  PATTERN_CREATE: 'good',
  PATTERN_CLEAR: 'warn',
};

const ACTION_OPTIONS = [
  'LOGIN', 'LOGIN_FAILED', 'PASSWORD_CHANGE',
  'EMPLOYEE_CREATE', 'EMPLOYEE_EDIT', 'EMPLOYEE_DELETE', 'STAFF_WIPE',
  'SHIFT_CREATE', 'SHIFT_ALLOCATE', 'SHIFT_DELETE',
  'LEAVE_APPROVE', 'LEAVE_REJECT',
  'OUTLET_CREATE', 'OUTLET_EDIT',
  'BRAND_CREATE', 'BRAND_EDIT',
  'PATTERN_CREATE', 'PATTERN_CLEAR',
];

const ENTITY_OPTIONS = ['Employee', 'Shift', 'Leave', 'Outlet', 'Brand', 'ShiftTemplate', 'Auth'];

function summarise(log) {
  const d = log.details;
  if (!d) return '';
  if (typeof d === 'string') return d;
  if (d.employeeName) return d.employeeName;
  if (d.outletName) return d.outletName;
  if (d.brandName) return d.brandName;
  if (d.count !== undefined) return `${d.count} records`;
  if (d.email) return d.email;
  return '';
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [actorSearch, setActorSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 50 });
      if (actionFilter) params.set('action', actionFilter);
      if (entityFilter) params.set('entity', entityFilter);
      if (actorSearch.trim()) params.set('actor', actorSearch.trim());
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);

      const data = await api.get(`/audit-logs?${params}`);
      setLogs(data.logs || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, entityFilter, actorSearch, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const clearFilters = () => {
    setActionFilter('');
    setEntityFilter('');
    setActorSearch('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const hasFilters = actionFilter || entityFilter || actorSearch || dateFrom || dateTo;

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Logs</h1>
          <p className="page-subtitle">{total} entries</p>
        </div>
        <div className="flex gap-2">
          <button
            className={`btn btn-sm ${showFilters ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter size={16} />
            <span>Filters</span>
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="card mb-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="form-field" style={{ minWidth: 160 }}>
              <label className="form-label">Action</label>
              <select
                className="form-input"
                value={actionFilter}
                onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
              >
                <option value="">All actions</option>
                {ACTION_OPTIONS.map((a) => (
                  <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div className="form-field" style={{ minWidth: 140 }}>
              <label className="form-label">Entity</label>
              <select
                className="form-input"
                value={entityFilter}
                onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }}
              >
                <option value="">All entities</option>
                {ENTITY_OPTIONS.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
            </div>
            <div className="form-field" style={{ minWidth: 160 }}>
              <label className="form-label">Actor name</label>
              <div className="input-group">
                <Search size={14} className="input-icon" />
                <input
                  className="form-input"
                  type="text"
                  placeholder="Search..."
                  value={actorSearch}
                  onChange={(e) => { setActorSearch(e.target.value); setPage(1); }}
                />
              </div>
            </div>
            <div className="form-field" style={{ minWidth: 140 }}>
              <label className="form-label">From</label>
              <input
                className="form-input"
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              />
            </div>
            <div className="form-field" style={{ minWidth: 140 }}>
              <label className="form-label">To</label>
              <input
                className="form-input"
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              />
            </div>
            {hasFilters && (
              <button className="btn btn-ghost btn-sm" onClick={clearFilters}>
                <X size={14} />
                <span>Clear</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Entity</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {loading && logs.length === 0 ? (
                <tr><td colSpan={5} className="text-center text-muted py-4">Loading...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={5} className="text-center text-muted py-4">
                  <ScrollText size={32} className="icon-muted mb-2" style={{ display: 'inline-block' }} />
                  <div>No audit logs found</div>
                </td></tr>
              ) : (
                logs.map((log) => (
                  <tr
                    key={log.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelected(log)}
                    className="hoverable-row"
                  >
                    <td className="text-xs text-muted" style={{ whiteSpace: 'nowrap' }}>
                      {format(new Date(log.createdAt), 'dd MMM yy, HH:mm')}
                    </td>
                    <td>
                      <span className={`badge badge-${ACTION_COLORS[log.action] || 'ghost'}`}>
                        {log.action.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td>
                      <div className="text-sm font-semibold text-strong">{log.actorName || '—'}</div>
                      <div className="text-2xs text-muted">{log.actorRole || ''}</div>
                    </td>
                    <td className="text-sm">{log.entity || '—'}</td>
                    <td className="text-sm text-muted">{summarise(log)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between" style={{ padding: 'var(--card-pad)' }}>
            <span className="text-xs text-muted">
              Page {page} of {pages} ({total} entries)
            </span>
            <div className="flex gap-1">
              <button
                className="btn btn-ghost btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title="Audit Log Detail"
      >
        {selected && (
          <div className="flex flex-col gap-3">
            <div className="grid-2" style={{ gap: '1rem' }}>
              <div>
                <div className="text-2xs text-muted mb-1">Action</div>
                <span className={`badge badge-${ACTION_COLORS[selected.action] || 'ghost'}`}>
                  {selected.action.replace(/_/g, ' ')}
                </span>
              </div>
              <div>
                <div className="text-2xs text-muted mb-1">Time</div>
                <div className="text-sm">{format(new Date(selected.createdAt), 'dd MMM yyyy, HH:mm:ss')}</div>
              </div>
              <div>
                <div className="text-2xs text-muted mb-1">Actor</div>
                <div className="text-sm font-semibold">{selected.actorName || '—'}</div>
                <div className="text-2xs text-muted">{selected.actorRole || ''}</div>
              </div>
              <div>
                <div className="text-2xs text-muted mb-1">Entity</div>
                <div className="text-sm">{selected.entity || '—'}</div>
                {selected.entityId && (
                  <div className="text-2xs text-muted" style={{ wordBreak: 'break-all' }}>{selected.entityId}</div>
                )}
              </div>
            </div>
            {selected.details && (
              <div>
                <div className="text-2xs text-muted mb-1">Details</div>
                <pre
                  className="text-xs"
                  style={{
                    background: 'var(--bg-inset)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.75rem',
                    overflowX: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {JSON.stringify(selected.details, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
