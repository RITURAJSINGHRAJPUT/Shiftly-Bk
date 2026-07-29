import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import { format, startOfWeek, endOfWeek, addDays, isSameDay } from 'date-fns';
import { Calendar, Plus, RefreshCw, Layers, CheckCircle2 } from 'lucide-react';

const SECTIONS = ['Pizza', 'Pasta', 'Drinks', 'Sushi', 'Wok', 'Side', 'Pass'];

export default function ShiftsPage() {
  const { user, isManager } = useAuth();
  const [shifts, setShifts] = useState([]);
  const [venues, setVenues] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [filterVenue, setFilterVenue] = useState('');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [loading, setLoading] = useState(true);

  // Auto Allocate State
  const [allocating, setAllocating] = useState(false);
  const [allocationSummary, setAllocationSummary] = useState(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    startTime: '12:00',
    endTime: '21:00',
    section: 'Pizza',
    employeeId: '',
    venueId: '',
  });

  useEffect(() => {
    loadInitial();
  }, []);

  useEffect(() => {
    if (filterVenue) {
      loadShifts();
    }
  }, [filterVenue, currentDate]);

  const loadInitial = async () => {
    setLoading(true);
    try {
      const venuesRes = await api.get('/notifications/venues');
      setVenues(venuesRes);
      const selectedVenue = user?.venueId || venuesRes[0]?.id || '';
      setFilterVenue(selectedVenue);

      const empRes = await api.get('/employees');
      setEmployees(empRes.employees);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadShifts = async () => {
    try {
      const start = format(startOfWeek(currentDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const end = format(endOfWeek(currentDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const res = await api.get(`/shifts?venue=${filterVenue}&startDate=${start}&endDate=${end}`);
      setShifts(res);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAutoAllocate = async () => {
    setAllocating(true);
    setAllocationSummary(null);
    try {
      const start = format(startOfWeek(currentDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const end = format(endOfWeek(currentDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const res = await api.post('/shifts/auto-allocate', {
        venueId: filterVenue,
        startDate: start,
        endDate: end
      });
      setAllocationSummary(res);
      loadShifts();
    } catch (err) {
      alert(err.message || 'Auto-allocation failed');
    } finally {
      setAllocating(false);
    }
  };

  const handleOpenAdd = (dateObj) => {
    setFormData({
      date: format(dateObj || new Date(), 'yyyy-MM-dd'),
      startTime: '12:00',
      endTime: '21:00',
      section: 'Pizza',
      employeeId: employees[0]?.id || '',
      venueId: filterVenue,
    });
    setIsModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      await api.post('/shifts', formData);
      setIsModalOpen(false);
      loadShifts();
    } catch (err) {
      alert(err.message || 'Failed to create shift');
    }
  };

  // Get days of the current week (Mon - Sun)
  const getWeekDays = () => {
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  };

  const weekDays = getWeekDays();

  const getShiftsForDay = (day) => {
    return shifts.filter(s => isSameDay(new Date(s.date), day));
  };

  const getSectionClass = (section) => {
    if (!section) return 'general';
    return section.toLowerCase();
  };

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Weekly Roster</h1>
          <p className="page-subtitle">Schedule shifts, run automated algorithms, and manage culinary stations</p>
        </div>
        <div className="flex gap-2">
          {isManager && (
            <>
              <button className="btn btn-accent" onClick={handleAutoAllocate} disabled={allocating}>
                <RefreshCw size={16} className={allocating ? 'animate-spin' : ''} />
                <span>{allocating ? 'Allocating...' : 'Auto-Allocate'}</span>
              </button>
              <button className="btn btn-primary" onClick={() => handleOpenAdd()}>
                <Plus size={16} />
                <span>Add Shift</span>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="card mb-4">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <div className="flex gap-2 items-center">
            <Calendar size={18} style={{ color: 'var(--text-secondary)' }} />
            <span className="font-bold">
              Week of {format(weekDays[0], 'MMMM d, yyyy')} - {format(weekDays[6], 'MMMM d, yyyy')}
            </span>
          </div>

          <div className="flex gap-2">
            <button className="btn btn-ghost btn-sm" onClick={() => setCurrentDate(addDays(currentDate, -7))}>Prev Week</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setCurrentDate(new Date())}>Today</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setCurrentDate(addDays(currentDate, 7))}>Next Week</button>

            <select
              className="form-select"
              style={{ width: 'auto', padding: '6px 12px' }}
              value={filterVenue}
              onChange={e => setFilterVenue(e.target.value)}
            >
              {venues.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {allocationSummary && (
        <div className="card mb-4" style={{ borderColor: 'var(--accent-500)', background: 'rgba(16, 185, 129, 0.05)' }}>
          <div className="flex items-center gap-3">
            <CheckCircle2 size={24} style={{ color: 'var(--accent-400)' }} />
            <div>
              <h3 className="font-bold text-sm" style={{ color: 'var(--accent-400)' }}>Automated Scheduling Complete</h3>
              <p className="text-xs text-secondary">
                Successfully allocated <strong>{allocationSummary.count}</strong> shifts for {venues.find(v => v.id === filterVenue)?.name}. Algorithm optimized for rest periods, skills, and workload balance.
              </p>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8">Loading schedule...</div>
      ) : (
        <div className="shift-calendar">
          {weekDays.map(day => {
            const dayShifts = getShiftsForDay(day);
            const isToday = isSameDay(day, new Date());
            return (
              <div key={day.toISOString()} className={`calendar-day ${isToday ? 'today' : ''}`}>
                <div className="flex justify-between items-center">
                  <div>
                    <span className="calendar-day-header">{format(day, 'eee')}</span>
                    <div className="calendar-day-number">{format(day, 'd')}</div>
                  </div>
                  {isManager && (
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleOpenAdd(day)}>
                      <Plus size={12} />
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-1 mt-2">
                  {dayShifts.map(s => (
                    <div key={s.id} className={`calendar-shift ${getSectionClass(s.section)}`} title={`${s.employee?.name} (${s.section || 'General'})`}>
                      <div className="font-semibold truncate text-xs" style={{ color: 'var(--text-primary)' }}>{s.employee?.name}</div>
                      <div className="text-xs text-muted">{s.startTime} - {s.endTime}</div>
                      {s.section && (
                        <div className="text-xs font-semibold" style={{ opacity: 0.8, fontSize: '0.65rem' }}>{s.section}</div>
                      )}
                    </div>
                  ))}
                  {dayShifts.length === 0 && (
                    <div className="text-xs text-muted text-center py-4">No shifts</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Shift Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Schedule Shift manually"
      >
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div className="form-group">
            <label className="form-label">Employee</label>
            <select
              className="form-select"
              value={formData.employeeId}
              onChange={e => setFormData(prev => ({ ...prev, employeeId: e.target.value }))}
              required
            >
              {employees.filter(e => e.venueId === filterVenue).map(e => (
                <option key={e.id} value={e.id}>{e.name} ({e.department})</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Date</label>
            <input
              type="date"
              className="form-input"
              value={formData.date}
              onChange={e => setFormData(prev => ({ ...prev, date: e.target.value }))}
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Start Time</label>
              <input
                type="time"
                className="form-input"
                value={formData.startTime}
                onChange={e => setFormData(prev => ({ ...prev, startTime: e.target.value }))}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">End Time</label>
              <input
                type="time"
                className="form-input"
                value={formData.endTime}
                onChange={e => setFormData(prev => ({ ...prev, endTime: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Culinary Section / Station</label>
            <select
              className="form-select"
              value={formData.section}
              onChange={e => setFormData(prev => ({ ...prev, section: e.target.value }))}
            >
              <option value="">General Section (Service/HK)</option>
              {SECTIONS.map(sec => (
                <option key={sec} value={sec}>{sec}</option>
              ))}
            </select>
          </div>

          <div className="modal-footer" style={{ padding: 0, marginTop: '16px' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setIsModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Schedule Shift</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
