import { api, ApiError } from './core/api.js';
import { hydrateIcons, icon } from './core/icons.js';
import { esc, dateTime, timeAgo, debounce } from './core/format.js';
import {
  qs, qsa, toast, toastError, hideOverlay, closeOverlays, setBusy,
} from './core/ui.js';
import {
  state, can, login, loadMe, loadMeta, logout, startStream, stopStream,
  loadNotifications, markAllRead, toggleTheme, currentTheme,
} from './core/store.js';
import { startRouter, navigate } from './core/router.js';

import * as overview from './views/overview.js';
import * as director from './views/director.js';
import * as ops from './views/ops.js';
import * as fraud from './views/fraud.js';
import * as balance from './views/balance.js';
import * as market from './views/market.js';
import * as lab from './views/lab.js';
import * as observability from './views/observability.js';
import * as liveops from './views/liveops.js';
import * as players from './views/players.js';
import * as governance from './views/governance.js';
import * as settings from './views/settings.js';

const VIEWS = {
  overview: { module: overview, title: 'Обзор', group: 'main' },
  director: { module: director, title: 'Директор', group: 'main' },
  ops: { module: ops, title: 'Ops', group: 'zones' },
  fraud: { module: fraud, title: 'Fraud', group: 'zones' },
  balance: { module: balance, title: 'Balance', group: 'zones' },
  market: { module: market, title: 'Market', group: 'zones' },
  lab: { module: lab, title: 'Lab', group: 'zones' },
  observability: { module: observability, title: 'Наблюдаемость', group: 'platform' },
  liveops: { module: liveops, title: 'LiveOps', group: 'platform' },
  players: { module: players, title: 'Игроки', group: 'platform' },
  governance: { module: governance, title: 'Управление', group: 'system' },
  settings: { module: settings, title: 'Настройки', group: 'system' },
};

const GROUP_LABELS = { main: 'Рабочее место', zones: 'Изолированные зоны', platform: 'Эксплуатация', system: 'Платформа' };

let routeToken = 0;
let currentRoute = { tab: 'overview', query: {} };
let pendingProposals = 0;

/* ============================ Boot ============================ */
document.addEventListener('DOMContentLoaded', () => {
  bindGlobalChrome();
  hydrateIcons();
  boot();
});

async function boot() {
  try {
    await loadMe();
    await enterApp();
  } catch (err) {
    if (!(err instanceof ApiError) || err.status === 401) {
      showLogin();
    } else {
      showLogin(err.message);
    }
  }
}

function showLogin(errorText = '') {
  qs('#app').classList.add('hidden');
  qs('#login-screen').classList.remove('hidden');
  const errBox = qs('#login-error');
  if (errorText) {
    errBox.textContent = errorText;
    errBox.classList.remove('hidden');
  } else {
    errBox.classList.add('hidden');
  }
  setTimeout(() => qs('#login-username')?.focus(), 60);
}

async function enterApp() {
  qs('#login-screen').classList.add('hidden');
  qs('#app').classList.remove('hidden');
  paintUser();
  buildNav();
  loadMeta().then((meta) => {
    if (meta) {
      const tag = qs('#env-tag');
      if (tag) tag.textContent = meta.environment === 'production' ? 'prod' : meta.environment || 'dev';
    }
  });
  startStream();
  loadNotifications().then(renderNotificationBadge).catch(() => {});
  startRouter(renderRoute);
}

function paintUser() {
  const user = state.user;
  if (!user) return;
  qs('#user-name').textContent = user.displayName || user.username;
  qs('#user-role').textContent = user.role;
  const initials = String(user.displayName || user.username)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || 'TS';
  qs('#user-avatar').textContent = initials;
}

/* ============================ Navigation ============================ */
function buildNav() {
  const nav = qs('#nav');
  const tabs = state.navigation?.length
    ? state.navigation
    : Object.entries(VIEWS)
        .filter(([id]) => canTab(id))
        .map(([id, meta]) => ({ id, label: meta.title, icon: null }));

  const groups = { main: [], zones: [], platform: [], system: [] };
  tabs.forEach((tab) => {
    const meta = VIEWS[tab.id];
    if (!meta) return;
    groups[meta.group].push(tab);
  });

  nav.innerHTML = Object.entries(groups)
    .filter(([, list]) => list.length)
    .map(([group, list]) => `
      <div class="nav-group-label">${GROUP_LABELS[group]}</div>
      ${list.map((tab) => {
        const meta = VIEWS[tab.id];
        return `<button type="button" class="nav-item" data-tab="${tab.id}">
            ${icon(tab.icon || iconFor(tab.id))}
            <span class="nav-label">${esc(tab.label || meta.title)}</span>
            <span class="nav-count hidden" data-badge="${tab.id}"></span>
          </button>`;
      }).join('')}
    `).join('');

  qsa('.nav-item', nav).forEach((btn) => {
    btn.addEventListener('click', () => {
      if (window.innerWidth <= 1024) closeSidebar();
      navigate(btn.dataset.tab);
    });
  });
  hydrateIcons(nav);
  paintNavBadges();
}

function iconFor(tab) {
  return {
    overview: 'grid', director: 'messages', ops: 'activity', fraud: 'shield',
    balance: 'target', market: 'trending', lab: 'flask', observability: 'pulse',
    liveops: 'rocket', players: 'users', governance: 'lock', settings: 'sliders',
  }[tab] || 'grid';
}

function canTab(tab) {
  const meta = VIEWS[tab];
  if (!meta) return false;
  const tabs = state.navigation?.map((t) => t.id);
  return !tabs || tabs.includes(tab);
}

export function paintNavBadges() {
  const badges = { overview: pendingProposals, liveops: state.openTickets || 0 };
  qsa('[data-badge]').forEach((node) => {
    const value = badges[node.dataset.badge] || 0;
    node.textContent = value > 29 ? '29+' : String(value);
    node.classList.toggle('hidden', !value);
  });
}

function setActiveNav(tab) {
  qsa('#nav .nav-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
  const meta = VIEWS[tab];
  qs('#page-title').textContent = meta ? meta.title : 'Обзор';
  qs('#crumbs').innerHTML = `<span>TOPSPIN ARENA</span><span>${esc(meta ? meta.title : '')}</span>`;
  document.title = `${meta ? meta.title : 'Обзор'} · TOPSPIN ARENA Admin`;
}

/* ============================ Rendering ============================ */
async function renderRoute(route) {
  currentRoute = route;
  let tab = route.tab;
  if (!VIEWS[tab] || !canTab(tab)) {
    const first = (state.navigation?.[0]?.id) || 'overview';
    if (tab !== first) {
      navigate(first, {}, { replace: true });
      return;
    }
    tab = first;
  }
  closeOverlays();
  setActiveNav(tab);
  state.activeTab = tab;

  const token = ++routeToken;
  const outlet = qs('#view');
  const module = VIEWS[tab].module;
  const ctx = {
    query: route.query,
    isStale: () => token !== routeToken,
    setQuery: (key, value) => {
      const params = new URLSearchParams(location.hash.split('?')[1] || '');
      if (value === undefined || value === null || value === '') params.delete(key);
      else params.set(key, String(value));
      const q = params.toString();
      history.replaceState(null, '', `#/${tab}${q ? `?${q}` : ''}`);
      currentRoute = { tab, query: Object.fromEntries(params.entries()) };
    },
    navigate: (nextTab, query) => navigate(nextTab, query),
    refresh: () => renderRoute(currentRoute),
    can,
    state,
  };

  try {
    await module.render(outlet, ctx);
  } catch (err) {
    if (err?.name === 'AbortError') return;
    if (token !== routeToken) return;
    console.error('[view]', tab, err);
    outlet.innerHTML = `<div class="error-panel" style="margin-top:24px">
        <h4>Не удалось загрузить раздел</h4>
        <p>${esc(err?.message || String(err))}</p>
        <button class="btn btn-sm btn-outline" type="button" id="route-retry">Повторить</button>
      </div>`;
    qs('#route-retry')?.addEventListener('click', () => renderRoute(currentRoute));
  }
}

export function requestRefresh() {
  renderRoute(currentRoute);
}

/* ============================ Global chrome ============================ */
function bindGlobalChrome() {
  qs('#reveal-password')?.addEventListener('click', () => {
    const input = qs('#login-password');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    qs('#reveal-password').textContent = show ? 'Скрыть' : 'Показать';
  });

  qs('#login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = qs('#login-submit');
    const errBox = qs('#login-error');
    errBox.classList.add('hidden');
    setBusy(btn, true);
    try {
      await login(qs('#login-username').value.trim(), qs('#login-password').value);
      await enterApp();
    } catch (err) {
      errBox.textContent = err.message || 'Не удалось войти';
      errBox.classList.remove('hidden');
    } finally {
      setBusy(btn, false);
    }
  });

  qs('#logout-btn').addEventListener('click', async () => {
    await logout();
    showLogin();
  });

  qs('#theme-btn').addEventListener('click', () => {
    toggleTheme();
    qs('#theme-btn').innerHTML = icon(currentTheme() === 'dark' ? 'theme' : 'theme');
  });

  qs('#refresh-btn').addEventListener('click', () => {
    const btn = qs('#refresh-btn');
    btn.style.transform = 'rotate(360deg)';
    setTimeout(() => { btn.style.transform = ''; }, 420);
    requestRefresh();
  });

  qs('#sidebar-collapse')?.addEventListener('click', () => qs('#app').classList.toggle('sidebar-collapsed'));
  qs('#sidebar-toggle')?.addEventListener('click', openSidebar);
  qs('#sidebar-scrim')?.addEventListener('click', closeSidebar);

  qs('#search-trigger').addEventListener('click', openPalette);
  qs('#palette-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'palette-overlay') hideOverlay('#palette-overlay');
  });
  qs('#palette-input').addEventListener('input', debounce((e) => searchPalette(e.target.value), 180));
  qs('#palette-input').addEventListener('keydown', onPaletteKey);

  qs('#modal-close').addEventListener('click', () => hideOverlay('#modal-overlay'));
  qs('#drawer-close').addEventListener('click', () => hideOverlay('#drawer-overlay'));
  qs('#modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') hideOverlay('#modal-overlay');
  });
  qs('#drawer-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'drawer-overlay') hideOverlay('#drawer-overlay');
  });

  qs('#notif-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const pop = qs('#notif-popover');
    const open = pop.classList.contains('hidden');
    pop.classList.toggle('hidden', !open);
    qs('#notif-btn').setAttribute('aria-expanded', String(open));
    if (open) {
      await loadNotifications();
      renderNotificationList();
    }
  });
  qs('#notif-read-all').addEventListener('click', async (e) => {
    e.stopPropagation();
    await markAllRead();
    renderNotificationList();
    renderNotificationBadge();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.notif-wrap')) qs('#notif-popover').classList.add('hidden');
  });

  window.addEventListener('crm:auth-expired', () => {
    stopStream();
    showLogin('Сессия истекла — войдите снова');
  });
  window.addEventListener('crm:live', (e) => {
    const chip = qs('#live-chip');
    chip.classList.toggle('off', !e.detail);
    chip.querySelector('.live-label').textContent = e.detail ? 'live' : 'offline';
  });
  window.addEventListener('crm:notifications', () => {
    renderNotificationBadge();
    if (!qs('#notif-popover').classList.contains('hidden')) renderNotificationList();
  });
  window.addEventListener('crm:badges', (e) => {
    if (typeof e.detail?.proposals === 'number') pendingProposals = e.detail.proposals;
    if (typeof e.detail?.tickets === 'number') state.openTickets = e.detail.tickets;
    paintNavBadges();
  });
  window.addEventListener('crm:event', (e) => {
    if (e.detail?.type === 'proposal') {
      pendingProposals = Math.max(0, pendingProposals + (e.detail.payload?.status === 'pending' ? 1 : -1));
      paintNavBadges();
    }
  });

  document.addEventListener('keydown', (e) => {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
      return;
    }
    if (e.key === 'Escape') closeOverlays();
    if (!inField && e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      requestRefresh();
    }
  });

  window.addEventListener('resize', debounce(() => {
    if (window.innerWidth > 1024) closeSidebar();
  }, 200));
}

function openSidebar() {
  qs('#app').classList.add('sidebar-open');
  qs('#sidebar-scrim').hidden = false;
}
function closeSidebar() {
  qs('#app').classList.remove('sidebar-open');
  qs('#sidebar-scrim').hidden = true;
}

/* ============================ Notifications ============================ */
function renderNotificationBadge() {
  const badge = qs('#notif-count');
  badge.textContent = state.unread > 99 ? '99+' : String(state.unread);
  badge.classList.toggle('hidden', !state.unread);
}

function renderNotificationList() {
  const list = qs('#notif-list');
  if (!state.notifications.length) {
    list.innerHTML = '<div class="empty" style="padding:24px"><h4>Уведомлений нет</h4><p>Критические события появятся здесь.</p></div>';
    return;
  }
  list.innerHTML = state.notifications
    .map((n) => `<button type="button" class="notif-item ${n.read_at ? '' : 'unread'}" data-notif="${esc(n.id)}" data-link="${esc(n.link || '')}"
        style="width:100%;text-align:left;background:transparent;border:0;border-bottom:1px solid var(--line);color:inherit;cursor:pointer">
        <span class="status-dot ${n.severity === 'critical' ? 'critical' : n.severity === 'warning' ? 'warning' : 'info'}" style="margin-top:6px"></span>
        <span class="grow">
          <span class="notif-title" style="display:block">${esc(n.title)}</span>
          ${n.body ? `<span class="notif-text" style="display:block">${esc(n.body)}</span>` : ''}
          <span class="notif-time">${esc(timeAgo(n.created_at))}</span>
        </span>
      </button>`)
    .join('');

  qsa('[data-notif]', list).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.notif;
      const link = btn.dataset.link;
      btn.classList.remove('unread');
      try {
        await api.post('/api/admin/notifications/read', { ids: [id] });
        state.unread = Math.max(0, state.unread - 1);
        renderNotificationBadge();
      } catch { /* non-critical */ }
      qs('#notif-popover').classList.add('hidden');
      if (link) {
        const hash = link.replace(/^#/, '');
        location.hash = hash;
      }
    });
  });
}

/* ============================ Command palette ============================ */
let paletteIndex = 0;
let paletteItems = [];

function paletteCommands(query) {
  const navCommands = (state.navigation || Object.keys(VIEWS).map((id) => ({ id, label: VIEWS[id].title })))
    .filter((t) => VIEWS[t.id])
    .map((t) => ({
      group: 'Разделы',
      title: t.label || VIEWS[t.id].title,
      sub: '',
      icon: iconFor(t.id),
      run: () => navigate(t.id),
    }));
  const actions = [
    { group: 'Действия', title: 'Обновить текущий раздел', sub: 'R', icon: 'refresh', run: () => requestRefresh() },
    { group: 'Действия', title: 'Сменить тему', sub: '', icon: 'theme', run: () => toggleTheme() },
  ];
  const q = query.trim().toLowerCase();
  const local = [...navCommands, ...actions].filter((c) => !q || c.title.toLowerCase().includes(q));
  return local;
}

async function openPalette() {
  const overlay = qs('#palette-overlay');
  if (!overlay.classList.contains('hidden')) {
    qs('#palette-input').focus();
    return;
  }
  qs('#palette-input').value = '';
  renderPalette(paletteCommands(''), false);
  hideOverlay('#palette-overlay');
  overlay.classList.remove('hidden');
  overlay.className = 'overlay overlay-palette';
  qs('#palette-input').focus();
  overlay.addEventListener('click', (e) => {
    if (e.target.id === 'palette-overlay') hideOverlay('#palette-overlay');
  }, { once: true });
}

function renderPalette(items, remote) {
  paletteItems = items;
  paletteIndex = 0;
  const body = qs('#palette-body');
  if (!items.length) {
    body.innerHTML = `<div class="palette-empty">${remote ? 'Ничего не найдено' : 'Начните вводить запрос'}</div>`;
    return;
  }
  const groups = items.reduce((acc, item) => {
    (acc[item.group] = acc[item.group] || []).push(item);
    return acc;
  }, {});
  let flat = 0;
  body.innerHTML = Object.entries(groups)
    .map(([group, list]) => `<div class="palette-group-label">${esc(group)}</div>${list
      .map((item) => {
        const idx = flat++;
        return `<button type="button" class="palette-item" data-idx="${idx}">
            <span class="pi-icon">${icon(item.icon || 'search')}</span>
            <span class="grow truncate">${esc(item.title)}</span>
            ${item.sub ? `<span class="pi-sub">${esc(item.sub)}</span>` : ''}
          </button>`;
      })
      .join('')}`)
    .join('');
  qsa('.palette-item', body).forEach((btn) => {
    btn.addEventListener('click', () => activatePalette(Number(btn.dataset.idx)));
    btn.addEventListener('mouseenter', () => highlightPalette(Number(btn.dataset.idx)));
  });
  highlightPalette(0);
}

function highlightPalette(idx) {
  paletteIndex = idx;
  qsa('.palette-item').forEach((n) => n.classList.toggle('active', Number(n.dataset.idx) === idx));
}

function activatePalette(idx) {
  const item = paletteItems[idx];
  if (!item) return;
  hideOverlay('#palette-overlay');
  item.run();
}

function onPaletteKey(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (paletteItems.length) highlightPalette((paletteIndex + 1) % paletteItems.length);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (paletteItems.length) highlightPalette((paletteIndex - 1 + paletteItems.length) % paletteItems.length);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    activatePalette(paletteIndex);
  }
}

const searchPalette = debounce(async (value) => {
  const q = value.trim();
  const local = paletteCommands(q);
  if (q.length < 2) {
    renderPalette(local, false);
    return;
  }
  try {
    const res = await api.get(`/api/admin/search?q=${encodeURIComponent(q)}`);
    const remote = (res.groups || []).flatMap((g) =>
      g.items.map((item) => ({
        group: g.label,
        title: item.title,
        sub: item.subtitle || '',
        icon: g.type === 'player' ? 'user' : g.type === 'ticket' ? 'ticket' : g.type === 'incident' ? 'alert' : g.type === 'news' ? 'news' : 'layers',
        run: () => { location.hash = item.link.replace(/^#/, ''); },
      }))
    );
    renderPalette([...local.slice(0, 3), ...remote, ...local.slice(3)], true);
  } catch {
    renderPalette(local, false);
  }
}, 180);

export { state, can };
