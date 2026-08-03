import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import { Menu, Search, Bell, X, ChevronDown, LogOut, User } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ROLES } from '../constants';

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initials =
    user?.name?.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

  return (
    <div className="user-chip-wrap" ref={ref}>
      <button
        type="button"
        className="user-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="user-avatar">{initials}</div>
        <div>
          <div className="user-name">{user?.name}</div>
          <div className="user-role">{ROLES[user?.role] || user?.role}</div>
        </div>
        <ChevronDown size={16} className="icon-muted" />
      </button>

      {open && (
        <div className="user-menu" role="menu">
          <div className="user-menu-head">
            <div className="user-name">{user?.name}</div>
            <div className="user-menu-email">{user?.email}</div>
          </div>
          <Link
            to="/profile"
            className="user-menu-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <User size={16} />
            <span>My Profile</span>
          </Link>
          {/* Sign out as an explicit menu item. It used to be the click handler
              for the entire name block in the sidebar, so clicking your own
              name signed you out. */}
          <button
            type="button"
            className="user-menu-item is-danger"
            role="menuitem"
            onClick={logout}
          >
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default function Header({ collapsed, onToggle }) {
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
      setNotifications(await api.get('/notifications'));
    } catch {}
  };

  const markRead = async (id) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {}
  };

  const markAllRead = async () => {
    try {
      await api.put('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {}
  };

  return (
    <>
      <header className={`header ${collapsed ? 'collapsed' : ''}`}>
        <div className="header-inner">
          <div className="header-left">
            <button className="header-btn" onClick={onToggle} aria-label="Toggle sidebar">
              <Menu size={20} />
            </button>
          </div>

          <div className="header-right">
            <div className="header-search">
              <Search className="search-icon" size={18} />
              <input type="text" placeholder="Search employees, shifts…" aria-label="Search" />
            </div>
            <button className="header-btn" onClick={openNotifications} aria-label="Notifications">
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
            </button>
            <UserMenu />
          </div>
        </div>
      </header>

      <div className={`notification-panel ${notifOpen ? 'open' : ''}`}>
        <div className="modal-header">
          <h3 className="modal-title">Notifications</h3>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={markAllRead}>Mark all read</button>
            )}
            <button className="modal-close" onClick={() => setNotifOpen(false)} aria-label="Close">
              <X size={20} />
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {notifications.length === 0 ? (
            <div className="empty-state">
              <Bell size={48} className="empty-icon" />
              <h3>No notifications</h3>
              <p>You're all caught up.</p>
            </div>
          ) : (
            notifications.map((notif) => (
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
      {notifOpen && (
        <div
          className="modal-overlay"
          style={{ background: 'transparent' }}
          onClick={() => setNotifOpen(false)}
        />
      )}
    </>
  );
}
