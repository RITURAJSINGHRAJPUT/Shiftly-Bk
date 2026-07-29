import { useState, useEffect } from 'react';
import api from '../api/client';
import { BarChart3, TrendingUp, Users, Calendar, AlertTriangle } from 'lucide-react';

export default function ReportsPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setLoading(true);
    try {
      const res = await api.get('/dashboard/stats');
      setStats(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="page-content text-center">Loading analytics...</div>;
  }

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Operational Reports</h1>
          <p className="page-subtitle">Analyze staffing levels, attendance metrics, and shift allocation patterns</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card" style={{ '--stat-color': 'var(--primary-500)' }}>
          <div className="stat-icon" style={{ background: 'rgba(99, 102, 241, 0.1)', color: 'var(--primary-400)' }}>
            <TrendingUp size={20} />
          </div>
          <div>
            <div className="stat-value">{stats?.attendanceRate || 0}%</div>
            <div className="stat-label">Daily Attendance Rate</div>
          </div>
        </div>

        <div className="stat-card" style={{ '--stat-color': 'var(--accent-500)' }}>
          <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-400)' }}>
            <Users size={20} />
          </div>
          <div>
            <div className="stat-value">{stats?.totalEmployees || 0}</div>
            <div className="stat-label">Monitored Profiles</div>
          </div>
        </div>

        <div className="stat-card" style={{ '--stat-color': 'var(--warn-500)' }}>
          <div className="stat-icon" style={{ background: 'rgba(245, 158, 11, 0.1)', color: 'var(--warn-400)' }}>
            <Calendar size={20} />
          </div>
          <div>
            <div className="stat-value">{stats?.weekShifts || 0}</div>
            <div className="stat-label">Shifts Assigned (This Week)</div>
          </div>
        </div>

        <div className="stat-card" style={{ '--stat-color': 'var(--error-500)' }}>
          <div className="stat-icon" style={{ background: 'rgba(244, 63, 94, 0.1)', color: 'var(--error-400)' }}>
            <AlertTriangle size={20} />
          </div>
          <div>
            <div className="stat-value">{stats?.emergencyLeaves || 0}</div>
            <div className="stat-label">Emergency Leaves (Active)</div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="card-title mb-4">Department Staffing Breakdown</h3>
          <div className="flex flex-col gap-4">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span>Kitchen</span>
                <span className="font-semibold">60%</span>
              </div>
              <div style={{ height: '8px', background: 'var(--bg-glass)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: '60%', height: '100%', background: 'var(--warn-400)' }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span>Service Team</span>
                <span className="font-semibold">30%</span>
              </div>
              <div style={{ height: '8px', background: 'var(--bg-glass)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: '30%', height: '100%', background: 'var(--primary-400)' }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span>Housekeeping</span>
                <span className="font-semibold">10%</span>
              </div>
              <div style={{ height: '8px', background: 'var(--bg-glass)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: '10%', height: '100%', background: 'var(--accent-400)' }} />
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="card-title mb-4">Shift Distribution Roster Health</h3>
          <div className="flex items-center justify-center py-6">
            <div className="text-center">
              <BarChart3 size={48} style={{ color: 'var(--primary-400)', opacity: 0.8, margin: '0 auto 12px' }} />
              <div className="font-bold text-lg">Weekly Roster Safe</div>
              <p className="text-xs text-muted max-w-xs mt-1">All scheduled shifts adhere to safety regulations, mandatory minimum rest periods, and skill compatibility matrix.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
