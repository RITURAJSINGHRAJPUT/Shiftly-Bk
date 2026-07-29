import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('shiftly_token');
    if (token) {
      api.setToken(token);
      api.get('/auth/me')
        .then(data => setUser(data))
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
    return data.user;
  };

  const logout = () => {
    api.setToken(null);
    setUser(null);
  };

  const isAdmin = user && ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user.role);
  const isManager = user && ['SUPER_ADMIN', 'ADMIN', 'HR', 'MASTER_OF_HOUSE', 'HEAD_CHEF'].includes(user.role);

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, isAdmin, isManager }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
