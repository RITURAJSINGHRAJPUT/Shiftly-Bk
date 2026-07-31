import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useScope } from '../contexts/ScopeContext';
import { MapPin, CheckCircle, ShieldCheck, LogIn, LogOut } from 'lucide-react';
import { format } from 'date-fns';

export default function AttendancePage() {
  const { user, isAdmin, isManager } = useAuth();
  const { withScope } = useScope();
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [todayAttendance, setTodayAttendance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [coords, setCoords] = useState(null);
  const [geoResult, setGeoResult] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (isAdmin || isManager) {
        const records = await api.get(withScope('/attendance'));
        setAttendanceRecords(records);
      } else {
        const att = await api.get('/attendance/today');
        setTodayAttendance(att.status !== 'NOT_CHECKED_IN' ? att : null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, isManager, withScope]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    getCurrentLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.outlet?.id]);

  const getCurrentLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setCoords({ lat, lng });

        // Fast client check against user's outlet if present
        if (user?.outlet) {
          const distance = calculateDistance(lat, lng, user.outlet.latitude, user.outlet.longitude);
          setGeoResult({
            withinRange: distance <= user.outlet.radius,
            distance: Math.round(distance),
            radius: user.outlet.radius
          });
        }
      },
      (error) => {
        console.error('Location error:', error);
      },
      { enableHighAccuracy: true }
    );
  };

  // Haversine fallback on client
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371000;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const handleCheckIn = async () => {
    if (!coords) return alert('Acquiring location coordinates. Please try again in a few seconds.');
    setChecking(true);
    try {
      const res = await api.post('/attendance/check-in', {
        latitude: coords.lat,
        longitude: coords.lng
      });
      setTodayAttendance(res.attendance);
      setGeoResult(res.geo);
      loadData();
    } catch (err) {
      alert(err.message || 'Check-in failed');
    } finally {
      setChecking(false);
    }
  };

  const handleCheckOut = async () => {
    if (!coords) return alert('Acquiring location coordinates...');
    setChecking(true);
    try {
      const res = await api.post('/attendance/check-out', {
        latitude: coords.lat,
        longitude: coords.lng
      });
      setTodayAttendance(res.attendance);
      setGeoResult(res.geo);
      loadData();
    } catch (err) {
      alert(err.message || 'Check-out failed');
    } finally {
      setChecking(false);
    }
  };

  if (loading) {
    return <div className="page-content text-center">Loading portal...</div>;
  }

  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Attendance Portal</h1>
          <p className="page-subtitle">Verify location metrics, clock-in, and log attendance logs</p>
        </div>
      </div>

      {!(isAdmin || isManager) ? (
        // Employee portal
        <div className="max-w-md mx-auto flex flex-col gap-4">
          <div className="card checkin-card">
            <div className="flex items-center justify-center gap-2 mb-2">
              <ShieldCheck size={18} className="icon-brand" />
              <span className="text-xs font-semibold text-muted uppercase">
                Geofenced check-in
              </span>
            </div>

            <div className="location-status mb-4">
              <div className={`location-dot ${geoResult?.withinRange ? 'in-range' : 'out-range'}`} />
              <span className="text-sm font-semibold">
                {geoResult
                  ? `${geoResult.distance}m from ${user?.outlet?.name} · geofence ${geoResult.radius}m`
                  : 'Acquiring GPS coordinates…'}
              </span>
            </div>

            {!todayAttendance ? (
              <button className="checkin-btn check-in" onClick={handleCheckIn} disabled={checking}>
                <CheckCircle size={28} />
                <span>{checking ? 'Checking…' : 'Check In'}</span>
              </button>
            ) : !todayAttendance.checkOut ? (
              <button className="checkin-btn check-out" onClick={handleCheckOut} disabled={checking}>
                <MapPin size={28} />
                <span>{checking ? 'Checking…' : 'Check Out'}</span>
              </button>
            ) : (
              <div className="badge badge-accent w-full justify-center py-2 mt-4">
                Today's attendance complete
              </div>
            )}
          </div>

          {/* Timeline of today's events. The mockup also shows break start/end;
              the Attendance model has no break fields, so only the two real
              events are listed rather than inventing two more. */}
          {todayAttendance && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Today</h3>
                <span className="badge badge-ghost">
                  {todayAttendance.status?.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="divided-list">
                <div className="flex items-center gap-3">
                  <LogIn size={15} className="icon-good" />
                  <span className="text-sm text-secondary">Check In</span>
                  <span className="text-sm font-semibold text-strong" style={{ marginLeft: 'auto' }}>
                    {todayAttendance.checkIn
                      ? format(new Date(todayAttendance.checkIn), 'hh:mm a')
                      : '--:--'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <LogOut size={15} className={todayAttendance.checkOut ? 'icon-crit' : 'icon-muted'} />
                  <span className="text-sm text-secondary">Check Out</span>
                  <span className="text-sm font-semibold text-strong" style={{ marginLeft: 'auto' }}>
                    {todayAttendance.checkOut
                      ? format(new Date(todayAttendance.checkOut), 'hh:mm a')
                      : '--:--'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <MapPin size={15} className={todayAttendance.withinRange ? 'icon-good' : 'icon-crit'} />
                  <span className="text-sm text-secondary">Location</span>
                  <span className="text-sm font-semibold text-strong" style={{ marginLeft: 'auto' }}>
                    {todayAttendance.withinRange ? 'Within geofence' : 'Out of range'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        // Admin Log View
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Date</th>
                <th>Check In</th>
                <th>Check Out</th>
                <th>Accuracy (Radius)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {attendanceRecords.map(rec => (
                <tr key={rec.id}>
                  <td>
                    <div className="font-semibold text-primary" style={{ color: 'var(--ink-strong)' }}>{rec.employee.name}</div>
                    <div className="text-xs text-muted">{rec.employee.outlet?.name} | {rec.employee.department}</div>
                  </td>
                  <td>{format(new Date(rec.date), 'MMM d, yyyy')}</td>
                  <td>{rec.checkIn ? format(new Date(rec.checkIn), 'hh:mm a') : '-'}</td>
                  <td>{rec.checkOut ? format(new Date(rec.checkOut), 'hh:mm a') : '-'}</td>
                  <td>
                    {rec.withinRange ? (
                      <span className="badge badge-accent">Within Geofence</span>
                    ) : (
                      <span className="badge badge-error">Out of Range</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${rec.status === 'CHECKED_OUT' || rec.status === 'CHECKED_IN' ? 'badge-accent' : rec.status === 'LATE' ? 'badge-warn' : 'badge-error'}`}>
                      {rec.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
