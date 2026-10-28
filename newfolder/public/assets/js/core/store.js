import { api } from './api.js';
import { toast, toastError } from './ui.js';

export const state = {
  user: null,
  permissions: new Set(),
  navigation: [],
  unread: 0,
  notifications: [],
  live: false,
  events: [],
  activeTab: 'overview',
  meta: null,
};

export function can(permission) {
  if (!permission) return true;
  if (Array.isArray(permission)) return permission.some((p) => state.permissions.has(p));
  return state.permissions.has(permission);
}

export function canAny(permissions) {
  return !permissions?.length || permissions.some((p) => state.permissions.has(p));
}

export async function login(username, password) {
  const res = await api.post('/api/admin/auth/login', { username, password });
  applySession(res);
  if (res.expiresAt) scheduleSessionKeepAlive(res.expiresAt, res.sessionTtlSec);
  return res;
}

export function applySession(res) {
  if (!res?.user) return;
  state.user = res.user;
  state.permissions = new Set(res.user.permissions || []);
  state.navigation = res.user.navigation || [];
}

export async function loadMe() {
  const res = await api.get('/api/admin/auth/me');
  applySession(res);
  state.unread = res.unreadNotifications || 0;
  if (res.session?.expiresAt) scheduleSessionKeepAlive(res.session.expiresAt, res.session.ttlSec);
  return res;
}

/* ------------------------ Session keep-alive ------------------------ */
// A CRM session lives 12 hours. Without renewal the operator is thrown out
// mid-incident and loses the screen they were on; with silent renewal they are
// never interrupted, and the "expiring" banner only appears if renewal fails.
const keepAlive = {
  timer: null,
  warnTimer: null,
  expiresAt: null,
  lifetimeMs: 12 * 3600 * 1000,
  refreshing: false,
  visibilityBound: false,
};

export function sessionExpiresAt() {
  return keepAlive.expiresAt;
}

export function stopSessionKeepAlive() {
  clearTimeout(keepAlive.timer);
  clearInterval(keepAlive.warnTimer);
  keepAlive.timer = null;
  keepAlive.warnTimer = null;
  keepAlive.expiresAt = null;
  window.dispatchEvent(new CustomEvent('crm:session', { detail: { expiresAt: null, warning: false } }));
}

async function renewSession() {
  if (keepAlive.refreshing) return null;
  keepAlive.refreshing = true;
  try {
    const res = await api.post('/api/admin/auth/refresh', {});
    scheduleSessionKeepAlive(res.expiresAt, res.sessionTtlSec);
    applySession(res);
    window.dispatchEvent(new CustomEvent('crm:session', { detail: { expiresAt: keepAlive.expiresAt, warning: false, renewed: true } }));
    return res;
  } finally {
    keepAlive.refreshing = false;
  }
}

/**
 * Renames the session 25% before it expires and every time the tab comes back from
 * the background with less than half of its lifetime left (a sleeping laptop does
 * not fire timers, so the timer alone is not enough).
 */
export function scheduleSessionKeepAlive(expiresAt, ttlSec = 12 * 3600) {
  stopSessionKeepAlive();
  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : Date.now() + ttlSec * 1000;
  keepAlive.expiresAt = new Date(expiresMs).toISOString();
  const lifetime = Math.max(60_000, ttlSec * 1000);
  keepAlive.lifetimeMs = lifetime;
  const delay = Math.max(30_000, Math.min(lifetime * 0.75, expiresMs - Date.now() - 60_000));

  keepAlive.timer = setTimeout(() => {
    renewSession().catch(() => {
      // A failed renewal is not fatal: the next request will 401 and the shell
      // will ask for a password again. Do not spam the operator with toasts.
    });
  }, delay);

  keepAlive.warnTimer = setInterval(() => {
    const msLeft = expiresMs - Date.now();
    window.dispatchEvent(new CustomEvent('crm:session', {
      detail: { expiresAt: keepAlive.expiresAt, warning: msLeft < 10 * 60 * 1000, msLeft },
    }));
  }, 60_000);

  if (typeof document !== 'undefined') {
    if (!keepAlive.visibilityBound) {
      keepAlive.visibilityBound = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || !keepAlive.expiresAt) return;
        const msLeft = new Date(keepAlive.expiresAt).getTime() - Date.now();
        if (msLeft < keepAlive.lifetimeMs * 0.5) renewSession().catch(() => {});
      });
    }
  }
}

export async function refreshSessionNow() {
  return renewSession();
}

export async function logout() {
  try {
    await api.post('/api/admin/auth/logout', {});
  } catch {
    /* logout must be local-first */
  }
  stopStream();
  state.user = null;
  state.permissions = new Set();
  state.navigation = [];
}

export async function loadMeta() {
  try {
    state.meta = await api.get('/api/admin/system/meta');
    return state.meta;
  } catch {
    return null;
  }
}

/* --------------------------- Theme --------------------------- */
export function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function setTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('topspin_theme', next); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent('crm:theme', { detail: next }));
}

export function toggleTheme() {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

/* --------------------------- Notifications --------------------------- */
export async function loadNotifications() {
  try {
    const res = await api.get('/api/admin/notifications?limit=40');
    state.notifications = res.items || [];
    state.unread = res.unread || 0;
    return res;
  } catch {
    return { items: [], unread: 0 };
  }
}

export async function markAllRead() {
  await api.post('/api/admin/notifications/read-all', {});
  state.unread = 0;
  state.notifications = state.notifications.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() }));
}

/* --------------------------- Live stream (SSE) --------------------------- */
let source = null;
let retryTimer = null;
let heartbeat = null;

const IMPORTANT_EVENTS = [
  'notification',
  'incident',
  'proposal',
  'zone',
  'maintenance',
  'job',
  'ticket',
  'push',
  'news',
  'fraud',
  'player',
  'privacy',
  'ai_config',
  'session',
];

function emit(event) {
  state.events.unshift(event);
  state.events = state.events.slice(0, 80);
  window.dispatchEvent(new CustomEvent('crm:event', { detail: event }));
  if (event.type === 'notification' && event.payload) {
    state.unread = Math.min(999, state.unread + 1);
    const severity = event.payload.severity || 'info';
    if (severity === 'critical' || severity === 'warning') {
      toast(event.payload.title || 'Новое уведомление', {
        type: severity === 'critical' ? 'error' : 'warn',
        text: event.payload.body || '',
      });
    }
    window.dispatchEvent(new CustomEvent('crm:notifications'));
  }
}

export function startStream() {
  if (source) return;
  if (typeof EventSource === 'undefined') {
    setLive(false);
    return;
  }
  source = new EventSource('/api/admin/stream');
  source.addEventListener('open', () => setLive(true));
  source.addEventListener('hello', () => setLive(true));
  source.addEventListener('error', () => setLive(false));
  IMPORTANT_EVENTS.forEach((type) => {
    source.addEventListener(type, (raw) => {
      try {
        emit(JSON.parse(raw.data));
      } catch {
        /* ignore malformed frame */
      }
    });
  });
  // The browser auto-reconnects EventSource, but a hung network needs a nudge.
  clearInterval(heartbeat);
  heartbeat = setInterval(() => {
    if (source && source.readyState === EventSource.CLOSED) {
      stopStream();
      retryTimer = setTimeout(startStream, 4000);
    }
  }, 15000);
}

export function stopStream() {
  source?.close();
  source = null;
  clearInterval(heartbeat);
  clearTimeout(retryTimer);
  setLive(false);
}

function setLive(value) {
  if (state.live === value) return;
  state.live = value;
  window.dispatchEvent(new CustomEvent('crm:live', { detail: value }));
}

export function refreshNotificationsSoon() {
  loadNotifications().catch(() => {});
}
