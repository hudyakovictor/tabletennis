import { parseQuery } from './format.js';

const listeners = new Set();
let current = { tab: 'overview', query: {} };

export function parseHash(hash = location.hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const [tabPart, queryPart] = raw.split('?');
  const tab = (tabPart || 'overview').split('/')[0] || 'overview';
  return { tab, query: parseQuery(queryPart) };
}

export function startRouter(onChange) {
  listeners.add(onChange);
  const handle = () => {
    current = parseHash();
    listeners.forEach((fn) => fn(current));
  };
  window.addEventListener('hashchange', handle);
  if (!location.hash) {
    // Preserve the first screen without polluting history with a duplicate entry.
    history.replaceState(null, '', '#/overview');
  }
  handle();
  return () => window.removeEventListener('hashchange', handle);
}

export function navigate(tab, query = null, { replace = false } = {}) {
  const params = new URLSearchParams();
  const merged = query === null ? {} : query;
  Object.entries(merged).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  });
  const qs = params.toString();
  const next = `#/${tab}${qs ? `?${qs}` : ''}`;
  if (replace) history.replaceState(null, '', next);
  else location.hash = next;
  if (replace) {
    current = parseHash(next);
    listeners.forEach((fn) => fn(current));
  }
}

export function currentRoute() {
  return current;
}

/** Merge a single query param into the current route (used by filters/tabs). */
export function setQueryParam(key, value, { replace = true } = {}) {
  const route = parseHash();
  const query = { ...route.query };
  if (value === undefined || value === null || value === '') delete query[key];
  else query[key] = value;
  navigate(route.tab, query, { replace });
}

export function navigateTab(tab) {
  navigate(tab, {});
}

export function onRouteChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function back() {
  history.length > 1 ? history.back() : navigate('overview');
}
