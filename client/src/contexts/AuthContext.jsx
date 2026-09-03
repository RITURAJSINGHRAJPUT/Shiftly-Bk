import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  /**
   * This account holds a one-time password and must choose its own.
   *
   * Kept as state rather than read from the token, because the server is the
   * one enforcing it: the token carries a `pwreset` claim and every ordinary
   * endpoint refuses it. This flag only decides which screen to draw.
   */
  const [mustChangePassword, setMustChangePassword] = useState(false);

  // A restricted token can still reach /auth/me, so a page reload mid-way
  // through setting a password lands back on the same screen rather than an
  // empty app that 403s on everything.
  useEffect(() => {
    api.onPasswordResetRequired = () => setMustChangePassword(true);
    const token = localStorage.getItem('shiftly_token');
    if (token) {
      api.setToken(token);
      api.get('/auth/me')
        .then((data) => {
          setUser(data);
          if (data.mustChangePassword) setMustChangePassword(true);
        })
        .catch(() => { api.setToken(null); })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    api.setToken(data.token);
    setUser(data.user);
    setMustChangePassword(!!data.mustChangePassword);
    return data;
  };

  /**
   * Set a new password and, on success, take the unrestricted token the server
   * returns — so choosing a password signs you straight in rather than bouncing
   * back to the login form.
   */
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const data = await api.post('/auth/change-password', { currentPassword, newPassword });
    api.setToken(data.token);
    setMustChangePassword(false);
    const me = await api.get('/auth/me');
    setUser(me);
    return me;
  }, []);

  const logout = () => {
    api.setToken(null);
    setUser(null);
    setMustChangePassword(false);
  };

  const isAdmin = user && ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user.role);
  const isManager = user && ['SUPER_ADMIN', 'ADMIN', 'HR', 'OUTLET_MANAGER', 'MASTER_OF_HOUSE', 'HEAD_CHEF'].includes(user.role);

  return (
    <AuthContext.Provider
      value={{ user, login, logout, loading, isAdmin, isManager, mustChangePassword, changePassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
