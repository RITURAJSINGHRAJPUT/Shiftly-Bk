import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { MapPin, CheckCircle, AlertTriangle, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';

export default function AttendancePage() {
  const { user, isAdmin, isManager } = useAuth();
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [todayAttendance, setTodayAttendance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [coords, setCoords] = useState(null);
  const [geoResult, setGeoResult] = useState(null);

  useEffect(() => {
    loadData();
    getCurrentLocation();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      if (isAdmin || isManager) {
        const records = await api.get('/attendance');
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
  };

  const getCurrentLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setCoords({ lat, lng });

        // Fast client check against user's venue if present
        if (user?.venue) {
          const distance = calculateDistance(lat, lng, user.venue.latitude, user.venue.longitude);
          setGeoResult({
            withinRange: distance <= user.venue.radius,
            distance: Math.round(distance),
            radius: user.venue.radius
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
        // Employee Portal View
        <div className="card checkin-card flex flex-col items-center max-w-md mx-auto">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck size={20} style={{ color: 'var(--primary-400)' }} />
            <span className="text-xs font-semibold text-muted uppercase">Secure Geofenced Check In</span>
          </div>

          <div className="location-status mb-4">
            <div className={`location-dot ${geoResult?.withinRange ? 'in-range' : 'out-range'}`} />
            <span className="text-sm font-semibold">
              {geoResult
                ? `${geoResult.distance}m from ${user?.venue?.name} (Geofence: ${geoResult.radius}m)`
                : 'Acquiring GPS coordinates...'}
            </span>
          </div>

          {todayAttendance?.checkIn && (
            <div className="mb-4">
              <div className="text-sm text-secondary">Checked In At:</div>
              <div className="font-bold text-lg">{format(new Date(todayAttendance.checkIn), 'hh:mm a')}</div>
            </div>
          )}

          {todayAttendance?.checkOut && (
            <div className="mb-4">
              <div className="text-sm text-secondary">Checked Out At:</div>
              <div className="font-bold text-lg">{format(new Date(todayAttendance.checkOut), 'hh:mm a')}</div>
            </div>
          )}

          {!todayAttendance ? (
            <button
              className="checkin-btn check-in"
              onClick={handleCheckIn}
              disabled={checking}
            >
              <CheckCircle size={28} />
              <span>{checking ? 'Checking...' : 'Check In'}</span>
            </button>
          ) : !todayAttendance.checkOut ? (
            <button
              className="checkin-btn check-out"
              onClick={handleCheckOut}
              disabled={checking}
            >
              <MapPin size={28} />
              <span>{checking ? 'Checking...' : 'Check Out'}</span>
            </button>
          ) : (
            <div className="badge badge-accent mt-4 py-2 px-4 text-sm font-bold w-full justify-center">
              Today's Attendance Completed
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
                    <div className="font-semibold text-primary" style={{ color: 'var(--text-primary)' }}>{rec.employee.name}</div>
                    <div className="text-xs text-muted">{rec.employee.venue?.name} | {rec.employee.department}</div>
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
