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
  return res;
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
