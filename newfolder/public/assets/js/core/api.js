// HTTP client: cookie session + CSRF double-submit, typed errors, safe retries.
export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', payload = null, retryAfterSec = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
    this.retryAfterSec = retryAfterSec;
  }
}

function readCookie(name) {
  return document.cookie
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const idx = part.indexOf('=');
      if (idx > 0 && part.slice(0, idx) === name) acc = decodeURIComponent(part.slice(idx + 1));
      return acc;
    }, '');
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function parseBody(res) {
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) return res.json().catch(() => ({}));
  return { raw: await res.text() };
}

/**
 * @param {string} path
 * @param {{method?: string, body?: any, signal?: AbortSignal, retry?: number, idempotencyKey?: string}} opts
 */
export async function request(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const headers = { Accept: 'application/json', ...(opts.headers || {}) };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (MUTATING.has(method)) {
    const csrf = readCookie('topspin_csrf');
    if (csrf) headers['X-CSRF-Token'] = csrf;
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  }

  const attempts = method === 'GET' ? Math.max(1, opts.retry ?? 2) : 1;
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const res = await fetch(path, {
        method,
        headers,
        credentials: 'include',
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      });
      const payload = await parseBody(res);

      if (res.ok) return payload;

      if (res.status === 401 && !path.startsWith('/api/admin/auth/login')) {
        window.dispatchEvent(new CustomEvent('crm:auth-expired'));
      }

      throw new ApiError(payload.message || payload.error || `HTTP ${res.status}`, {
        status: res.status,
        code: payload.error || `HTTP_${res.status}`,
        payload,
        retryAfterSec: Number(res.headers.get('retry-after') || payload.retryAfterSec || 0) || null,
      });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err.name === 'AbortError') throw err;
      lastError = new ApiError('Нет связи с сервером CRM', { status: 0, code: 'NETWORK_ERROR' });
      if (attempt + 1 < attempts) await sleep(320 * (attempt + 1));
    }
  }
  throw lastError || new ApiError('Неизвестная ошибка сети');
}

export const api = {
  get: (path, opts = {}) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts = {}) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts = {}) => request(path, { ...opts, method: 'PUT', body }),
  patch: (path, body, opts = {}) => request(path, { ...opts, method: 'PATCH', body }),
  del: (path, body, opts = {}) => request(path, { ...opts, method: 'DELETE', body }),
};

export function newIdempotencyKey(prefix = 'ui') {
  const rand = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${prefix}-${rand}`;
}

/**
 * Saves an in-memory JSON payload (e.g. a DSAR export) as a file.
 * `downloadFile` streams from a URL; this one is for data the server already
 * returned inside a JSON envelope, so the operator does not have to make a
 * second, differently-authenticated request for the same artefact.
 */
export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'export.json';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Authenticated file download that keeps the httpOnly cookie out of javascript. */
export function downloadFile(path, filename) {
  const a = document.createElement('a');
  a.href = path;
  a.download = filename || '';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
