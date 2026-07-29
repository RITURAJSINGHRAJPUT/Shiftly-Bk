import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import { Menu, Search, Bell, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export default function Header({ collapsed, onToggle }) {
  const { user } = useAuth();
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    loadNotifCount();
    const interval = setInterval(loadNotifCount, 15000);
    return () => clearInterval(interval);
  }, []);

  const loadNotifCount = async () => {
    try {
      const data = await api.get('/notifications/count');
      setUnreadCount(data.count);
    } catch {}
  };

  const openNotifications = async () => {
    setNotifOpen(true);
    try {
      const data = await api.get('/notifications');
      setNotifications(data);
    } catch {}
  };

  const markRead = async (id) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch {}
  };

  const markAllRead = async () => {
    try {
      await api.put('/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {}
  };

  return (
    <>
      <header className={`header ${collapsed ? 'collapsed' : ''}`}>
        <div className="header-left">
          <button className="header-toggle" onClick={onToggle}>
            <Menu size={20} />
          </button>
          <div className="header-search">
            <Search className="search-icon" size={18} />
            <input type="text" placeholder="Search employees, shifts..." />
          </div>
        </div>
        <div className="header-right">
          <button className="header-btn" onClick={openNotifications}>
            <Bell size={20} />
            {unreadCount > 0 && <span className="badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
          </button>
        </div>
      </header>

      {/* Notification Panel */}
      <div className={`notification-panel ${notifOpen ? 'open' : ''}`}>
        <div className="modal-header">
          <h3 className="modal-title">Notifications</h3>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={markAllRead}>Mark all read</button>
            )}
            <button className="modal-close" onClick={() => setNotifOpen(false)}>
              <X size={20} />
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {notifications.length === 0 ? (
            <div className="empty-state">
              <Bell size={48} className="empty-icon" />
              <h3>No notifications</h3>
              <p>You're all caught up!</p>
            </div>
          ) : (
            notifications.map(notif => (
              <div
                key={notif.id}
                className={`notification-item ${!notif.isRead ? 'unread' : ''}`}
                onClick={() => markRead(notif.id)}
              >
                <div className="notif-title">{notif.title}</div>
                <div className="notif-message">{notif.message}</div>
                <div className="notif-time">
                  {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      {notifOpen && <div className="modal-overlay" style={{ background: 'transparent' }} onClick={() => setNotifOpen(false)} />}
    </>
  );
}
