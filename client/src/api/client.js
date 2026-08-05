/**
 * Relative, so it resolves against whatever host serves the page.
 *
 * An absolute http://localhost:3001 works only on the machine running the API —
 * through a tunnel or any deployment it points at the *visitor's* own computer.
 * In development Vite proxies /api to the API server (see vite.config.js).
 */
const API_BASE = '/api';

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

    // The one 403 that is not an RBAC denial: this account holds a temporary
    // password and its token is scoped to setting a new one. The session is
    // valid, so the token is kept — the app just has nowhere to go but the
    // set-password screen, and every other request will keep getting this.
    if (res.status === 403 && data.code === 'PASSWORD_RESET_REQUIRED') {
      const err = new Error(data.error || 'Set your own password before using Bookends Shiftly');
      err.code = data.code;
      this.onPasswordResetRequired?.();
      throw err;
    }

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
