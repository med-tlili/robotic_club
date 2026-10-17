// API helper — attaches JWT to every request
// Dev: API lives on :4000. Production: server serves the client, so same origin.
export const BASE = import.meta.env.DEV ? 'http://localhost:4000' : '';
const API = `${BASE}/api`;

export function getToken() { return localStorage.getItem('token'); }

export async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
