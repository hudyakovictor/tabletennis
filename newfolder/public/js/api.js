let csrfToken = '';
export function setCsrf(value) { csrfToken = value || ''; }

export class ApiError extends Error {
  constructor(message, status, payload) { super(message); this.status = status; this.payload = payload; }
}

async function request(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const options = {
    method, credentials: 'same-origin',
    headers: { Accept: 'application/json', ...headers },
  };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  if (!['GET', 'HEAD'].includes(method) && csrfToken) options.headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(path, options);
  if (raw) return response;
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { error: text.slice(0, 300) || 'Некорректный ответ сервера' }; }
  if (!response.ok) {
    if (response.status === 401 && !path.includes('/auth/login')) window.dispatchEvent(new CustomEvent('crm:unauthorized'));
    throw new ApiError(data.error || `HTTP ${response.status}`, response.status, data);
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body = {}) => request(path, { method: 'POST', body }),
  patch: (path, body = {}) => request(path, { method: 'PATCH', body }),
  delete: (path, body = {}) => request(path, { method: 'DELETE', body }),
  raw: (path, options) => request(path, { ...options, raw: true }),
};

export function qs(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}
