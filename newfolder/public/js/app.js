import { api, setCsrf } from './api.js';
import { esc, toast, mountCharts } from './ui.js';
import { views, routeMeta } from './views.js';

const app = document.getElementById('app');
const state = {
  user: null, config: null, csrf: '', route: 'overview',
  range: localStorage.getItem('crm-range') || '7d',
  players: { search: '', region: '', status: '', offset: 0 },
  balanceFilters: {}, liveopsTab: 'overview', labTab: 'tests', settingsTab: 'general',
};
let rendering = 0;

const NAV = [
  ['Мониторинг', [
    ['overview', '⌂', 'Обзор'], ['ops', '◉', 'Ops'], ['alerts', '⚠', 'Алерты и инциденты'],
  ]],
  ['Аналитика', [
    ['balance', '⌁', 'Balance и ввод'], ['market', '↗', 'Маркетинг'], ['economy', '◈', 'Экономика'], ['players', '♙', 'Игроки'],
  ]],
  ['Решения и ИИ', [
    ['director', '✦', 'Директор'], ['ai', '◫', 'ИИ-зоны'], ['proposals', '✓', 'Предложения'], ['fraud', '⛨', 'Fraud'], ['lab', '⚗', 'Lab и A/B'],
  ]],
  ['LiveOps', [
    ['liveops', '▣', 'Техработы и новости'], ['tickets', '✉', 'Поддержка'], ['content', '▤', 'Контент-план'],
  ]],
  ['Система', [
    ['integration', '⇄', 'Подключение'], ['settings', '⚙', 'Настройки и аудит'],
  ]],
];

function navHtml() {
  return NAV.map(([section, items]) => `<div class="nav-section">${esc(section)}</div>${items.map(([route, icon, label]) => `<a class="nav-item" data-route="${route}" href="#/${route}"><span class="nav-icon">${icon}</span><span>${esc(label)}</span></a>`).join('')}`).join('');
}

function shell() {
  app.innerHTML = `<div class="layout">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><div class="brand-mark">TT</div><div><strong>TOPSPIN ARENA</strong><small>ADMIN CRM</small></div></div>
      <nav>${navHtml()}</nav>
      <div class="sidebar-foot"><div class="env"><i class="dot"></i><span>${esc(state.config?.env || 'production')} · v${esc(state.config?.version || '')}</span></div>
      <div>${esc(state.user?.username || '')} · admin</div><button class="btn ghost sm" id="logout" style="margin-top:9px">Выйти</button></div>
    </aside><div class="mobile-overlay" id="mobile-overlay"></div>
    <main class="main"><header class="topbar"><button class="btn ghost sm menu-toggle" id="menu-toggle">☰</button>
      <div class="title"><h1 id="page-title">CRM</h1><p id="page-subtitle"></p></div>
      <div class="top-actions"><select id="range" aria-label="Период"><option value="24h">24 часа</option><option value="7d">7 дней</option><option value="14d">14 дней</option><option value="30d">30 дней</option><option value="90d">90 дней</option></select>
      <button class="btn ghost" id="refresh" title="Обновить">↻ <span>Обновить</span></button></div></header>
      <div class="content" id="content"></div></main></div>`;
  document.getElementById('range').value = state.range;
  document.getElementById('range').onchange = e => { state.range = e.target.value; localStorage.setItem('crm-range', state.range); renderRoute(); };
  document.getElementById('refresh').onclick = () => renderRoute(true);
  document.getElementById('logout').onclick = async () => { try { await api.post('/api/auth/logout'); } catch { /* session may be gone */ } showLogin(); };
  const toggle = () => { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('mobile-overlay').classList.toggle('show'); };
  document.getElementById('menu-toggle').onclick = toggle;
  document.getElementById('mobile-overlay').onclick = toggle;
  document.querySelectorAll('.nav-item').forEach(a => a.addEventListener('click', () => { if (window.innerWidth <= 900) toggle(); }));
}

function currentRoute() {
  const route = location.hash.replace(/^#\//, '').split('?')[0].split('/')[0];
  return views[route] ? route : 'overview';
}

async function renderRoute(manual = false) {
  if (!state.user) return;
  const token = ++rendering;
  state.route = currentRoute();
  const root = document.getElementById('content');
  if (!root) return;
  document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.route === state.route));
  const meta = routeMeta[state.route] || {};
  document.getElementById('page-title').textContent = meta.title || state.route;
  document.getElementById('page-subtitle').textContent = meta.subtitle || '';
  document.getElementById('range').style.visibility = meta.noRange ? 'hidden' : 'visible';
  root.innerHTML = '<div class="empty"><div>◌</div><p>Загрузка данных…</p></div>';
  const ctx = {
    root, state, api, route: state.route,
    reload: () => renderRoute(),
    navigate: (route) => { location.hash = `#/${route}`; },
    set(html) { if (token !== rendering) return; root.innerHTML = html; mountCharts(root); },
  };
  try {
    await views[state.route](ctx);
    if (token === rendering) mountCharts(root);
    if (manual) toast('Данные обновлены');
  } catch (e) {
    if (token !== rendering) return;
    console.error(e);
    root.innerHTML = `<div class="card"><div class="empty"><div>⚠</div><p>${esc(e.message || 'Ошибка загрузки')}</p><button class="btn" id="retry">Повторить</button></div></div>`;
    document.getElementById('retry').onclick = () => renderRoute();
  }
}

function showLogin() {
  state.user = null; setCsrf('');
  app.innerHTML = `<div class="login-page"><section class="login-hero"><div class="brand-mark large">TT</div><h1>Данные вместо<br>ручного разбора логов.</h1><p>CRM TOPSPIN ARENA: телеметрия, баланс ввода, маркетинг, антифрод и пять изолированных аналитических зон. Все решения остаются за владельцем.</p><div class="login-features"><div><b>5</b>изолированных зон</div><div><b>100%</b>действий с подтверждением</div><div><b>0</b>секретов в клиенте игры</div></div></section>
  <section class="login-panel"><form class="login-form" id="login-form"><h2>Вход в CRM</h2><p>Только для владельца и администраторов проекта.</p><div class="field"><label>Логин</label><input name="username" autocomplete="username" required autofocus value="owner"></div><div class="field"><label>Пароль</label><input name="password" type="password" autocomplete="current-password" required></div><button class="btn primary" type="submit">Войти</button><div class="login-error" id="login-error"></div></form></section></div>`;
  document.getElementById('login-form').onsubmit = async e => {
    e.preventDefault();
    const button = e.target.querySelector('button'); button.disabled = true;
    const data = Object.fromEntries(new FormData(e.target));
    try {
      const result = await api.post('/api/auth/login', data);
      setCsrf(result.csrf); state.csrf = result.csrf; state.user = result.user;
      const me = await api.get('/api/auth/me'); state.config = me.config; setCsrf(me.csrf);
      shell(); renderRoute();
    } catch (err) {
      document.getElementById('login-error').textContent = err.message;
      button.disabled = false;
    }
  };
}

async function boot() {
  try {
    const me = await api.get('/api/auth/me');
    state.user = me.user; state.config = me.config; state.csrf = me.csrf; setCsrf(me.csrf);
    shell(); renderRoute();
  } catch (e) {
    if (e.status !== 401) toast(e.message, 'error');
    showLogin();
  }
}

window.addEventListener('hashchange', () => renderRoute());
window.addEventListener('crm:unauthorized', showLogin);
boot();
