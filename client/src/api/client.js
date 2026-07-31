const API_BASE = 'http://localhost:3001/api';

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('shiftly_token');
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('shiftly_token', token);
    } else {
      localStorage.removeItem('shiftly_token');
    }
  }

  async request(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token && { Authorization: `Bearer ${this.token}` }),
      ...options.headers,
    };

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    // Only 401 means the token is bad. A 403 is a normal RBAC denial and must
    // not destroy the session — it should surface as an error to the caller.
    //
    // The login endpoint is exempt: there a 401 means "wrong credentials", not
    // "session expired". Redirecting on it reloaded the page and wiped the error
    // message before it could render, so a failed sign-in appeared to do nothing
    // at all.
    const isLoginAttempt = path === '/auth/login';

    if (res.status === 401 && !isLoginAttempt) {
      this.setToken(null);
      window.location.href = '/login';
      throw new Error('Session expired');
    }

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  }

  get(path) { return this.request(path); }
  post(path, body) { return this.request(path, { method: 'POST', body: JSON.stringify(body) }); }
  put(path, body) { return this.request(path, { method: 'PUT', body: JSON.stringify(body) }); }
  delete(path) { return this.request(path, { method: 'DELETE' }); }
}

export const api = new ApiClient();
export default api;
