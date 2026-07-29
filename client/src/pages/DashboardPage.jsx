import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import {
  Users, Calendar, Clock, AlertTriangle, ArrowRight,
  TrendingUp, MapPin, ClipboardList, RefreshCw
} from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';

export default function DashboardPage() {
  const { user, isAdmin, isManager } = useAuth();
  const [stats, setStats] = useState(null);
  const [upcomingShifts, setUpcomingShifts] = useState([]);
  const [attendanceToday, setAttendanceToday] = useState(null);
  const [emergencyLeaves, setEmergencyLeaves] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, [user]);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      if (isAdmin || isManager) {
        const [statsData, emergencyData] = await Promise.all([
          api.get('/notifications/stats/overview').catch(() => null), // fallback if not exist
          api.get('/dashboard/stats'),
          api.get('/leaves/emergency/pending')
        ]);
        setStats(statsData || emergencyData); // unify stats
        setEmergencyLeaves(emergencyData);
      } else {
        const [shiftsData, attendanceData, emergencyData] = await Promise.all([
          api.get('/shifts/my/upcoming'),
          api.get('/attendance/today'),
          api.get('/leaves/emergency/pending')
        ]);
        setUpcomingShifts(shiftsData);
        setAttendanceToday(attendanceData);
        setEmergencyLeaves(emergencyData);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="page-content text-center">Loading dashboard...</div>;
  }

  // Management View
  if (isAdmin || isManager) {
    return (
      <div className="page-content animate-in">
        <div className="page-header">
          <div>
            <h1 className="page-title">Welcome back, {user?.name}</h1>
            <p className="page-subtitle">{user?.venue?.name || 'All Venues'} Overview</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={loadDashboardData}>
            <RefreshCw size={16} />
            <span>Reload</span>
          </button>
        </div>

        {emergencyLeaves.length > 0 && (
          <div className="card mb-4" style={{ borderColor: 'var(--error-500)', background: 'rgba(244, 63, 94, 0.05)' }}>
            <div className="flex items-center gap-3">
              <AlertTriangle size={24} style={{ color: 'var(--error-400)' }} />
              <div>
                <h3 className="font-bold text-sm" style={{ color: 'var(--error-400)' }}>🚨 Active Emergency Leave Requests</h3>
                <p className="text-xs text-secondary">{emergencyLeaves.length} staff member(s) have requested emergency leave. Volunteers are being sourced.</p>
              </div>
              <Link to="/leaves" className="btn btn-danger btn-sm" style={{ marginLeft: 'auto' }}>Manage</Link>
            </div>
          </div>
        )}

        <div className="stats-grid">
          <div className="stat-card" style={{ '--stat-color': 'var(--primary-500)' }}>
            <div className="stat-icon" style={{ background: 'rgba(99, 102, 241, 0.1)', color: 'var(--primary-400)' }}>
              <Users size={20} />
            </div>
            <div>
              <div className="stat-value">{stats?.totalEmployees || 0}</div>
              <div className="stat-label">Active Staff</div>
            </div>
          </div>

          <div className="stat-card" style={{ '--stat-color': 'var(--accent-500)' }}>
            <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-400)' }}>
              <TrendingUp size={20} />
            </div>
            <div>
              <div className="stat-value">{stats?.attendanceRate || 0}%</div>
              <div className="stat-label">Attendance Today</div>
            </div>
          </div>

          <div className="stat-card" style={{ '--stat-color': 'var(--warn-500)' }}>
            <div className="stat-icon" style={{ background: 'rgba(245, 158, 11, 0.1)', color: 'var(--warn-400)' }}>
              <Calendar size={20} />
            </div>
            <div>
              <div className="stat-value">{stats?.todayShifts || 0}</div>
              <div className="stat-label">Shifts Scheduled Today</div>
            </div>
          </div>

          <div className="stat-card" style={{ '--stat-color': 'var(--error-500)' }}>
            <div className="stat-icon" style={{ background: 'rgba(244, 63, 94, 0.1)', color: 'var(--error-400)' }}>
              <AlertTriangle size={20} />
            </div>
            <div>
              <div className="stat-value">{stats?.pendingLeaves || 0}</div>
              <div className="stat-label">Pending Leaves</div>
            </div>
          </div>
        </div>

        <div className="grid-2">
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Recent Activity</h3>
              <ClipboardList size={16} style={{ color: 'var(--text-muted)' }} />
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 py-2 border-b border-subtle">
                <span className="badge badge-accent">Geo Match</span>
                <div>
                  <div className="text-sm font-semibold">Pinky checked in at Capiche Piplod</div>
                  <div className="text-xs text-muted">Within 15 meters of location</div>
                </div>
              </div>
              <div className="flex items-center gap-3 py-2 border-b border-subtle">
                <span className="badge badge-primary">Auto Allocate</span>
                <div>
                  <div className="text-sm font-semibold">Weekly schedule auto-allocated</div>
                  <div className="text-xs text-muted">Optimal coverage achieved based on prediction rules</div>
                </div>
              </div>
              <div className="flex items-center gap-3 py-2">
                <span className="badge badge-warn">Leave Request</span>
                <div>
                  <div className="text-sm font-semibold">Dhiraj requested Emergency Leave</div>
                  <div className="text-xs text-muted">Shift starting in 4 hours</div>
                </div>
              </div>
            </div>
          </div>

          <div className="card flex flex-col justify-between">
            <div>
              <h3 className="card-title mb-4">Quick Management Actions</h3>
              <div className="flex flex-col gap-2">
                <Link to="/shifts" className="btn btn-ghost w-full justify-between">
                  <span>Run Intelligent Auto-Allocation</span>
                  <ArrowRight size={16} />
                </Link>
                <Link to="/employees" className="btn btn-ghost w-full justify-between">
                  <span>Add New Employee Profile</span>
                  <ArrowRight size={16} />
                </Link>
                <Link to="/attendance" className="btn btn-ghost w-full justify-between">
                  <span>View Attendance Log & Geo-Fences</span>
                  <ArrowRight size={16} />
                </Link>
              </div>
            </div>
            <div className="text-xs text-muted text-center mt-4">
              Shiftly Intelligent System v1.0.0
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Staff View (Mobile PWA & Staff Dashboard)
  const nextShift = upcomingShifts[0];

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Hello, {user?.name}</h1>
          <p className="page-subtitle">{user?.venue?.name}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {/* Next Shift Card */}
        <div className="card checkin-card flex flex-col items-center">
          <Clock size={32} style={{ color: 'var(--primary-400)' }} />
          {nextShift ? (
            <div className="mt-2">
              <h3 className="font-bold text-lg">Next Shift: {nextShift.section || 'General'}</h3>
              <p className="text-sm text-secondary">
                {format(new Date(nextShift.date), 'EEEE, MMMM d')} | {nextShift.startTime} - {nextShift.endTime}
              </p>
            </div>
          ) : (
            <div className="mt-2">
              <h3 className="font-bold text-lg">No Shifts Scheduled</h3>
              <p className="text-sm text-secondary">Check back later or contact HR.</p>
            </div>
          )}
          <Link to="/attendance" className="btn btn-primary mt-4 w-full justify-center">
            <MapPin size={16} />
            <span>Go to Check In Portal</span>
          </Link>
        </div>

        {/* Upcoming Shifts List */}
        <div className="card">
          <h3 className="card-title mb-4">My Upcoming Shifts</h3>
          {upcomingShifts.length === 0 ? (
            <div className="empty-state py-4">No upcoming shifts.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {upcomingShifts.map(s => (
                <div key={s.id} className="flex justify-between items-center py-2 border-b border-subtle last:border-0">
                  <div>
                    <div className="text-sm font-semibold">{format(new Date(s.date), 'EEE, MMM d')}</div>
                    <div className="text-xs text-muted">{s.section || 'General Section'}</div>
                  </div>
                  <div className="badge badge-primary">{s.startTime} - {s.endTime}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
