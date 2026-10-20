// public/js/api.js — tiny fetch wrapper shared by the storefront and admin pages.
const API = {
  token() { return localStorage.getItem('sg_token') || ''; },
  setToken(t) { if (t) localStorage.setItem('sg_token', t); else localStorage.removeItem('sg_token'); },
  user() { try { return JSON.parse(localStorage.getItem('sg_user') || 'null'); } catch { return null; } },
  setUser(u) { if (u) localStorage.setItem('sg_user', JSON.stringify(u)); else localStorage.removeItem('sg_user'); },

  async request(method, path, body) {
    const isFormData = body instanceof FormData;
    const headers = {};
    if (!isFormData) headers['Content-Type'] = 'application/json';
    const token = this.token();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? (isFormData ? body : JSON.stringify(body)) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  patch(path, body) { return this.request('PATCH', path, body); },
  delete(path) { return this.request('DELETE', path); },

  // Logs out on the SERVER (deletes the session row so the token is truly
  // revoked, not just forgotten by this browser), then clears local storage.
  async logout() {
    try { await this.request('POST', '/api/auth/logout'); } catch { /* best-effort */ }
    this.setToken(null);
    this.setUser(null);
  },

  isLoggedIn() { return !!this.token() && !!this.user(); },
  isStaff() { const u = this.user(); return !!u && ['admin', 'manager', 'staff'].includes(u.role); },
};
