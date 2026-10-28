import { esc, statusLabel, num } from './format.js';
import { icon } from './icons.js';

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function statusBadge(status, label) {
  const s = String(status || 'ok').toLowerCase();
  const cls = ['ok', 'warning', 'critical', 'failed', 'error', 'info'].includes(s) ? s : 'neutral';
  return `<span class="badge status-${esc(cls)}">${esc(label || statusLabel(s))}</span>`;
}

export function priorityBadge(priority) {
  const map = { critical: 'danger', high: 'warn', normal: 'neutral', low: 'neutral', important: 'warn' };
  return `<span class="badge badge-${map[priority] || 'neutral'}">${esc(priority || 'normal')}</span>`;
}

export function zoneBadge(zone) {
  const map = { ops: 'info', fraud: 'danger', balance: 'brand', market: 'violet', lab: 'neutral' };
  return `<span class="badge badge-${map[zone] || 'neutral'}">${esc(zone || '—')}</span>`;
}

export function riskBar(score) {
  const value = Math.max(0, Math.min(1, Number(score) || 0));
  const cls = value >= 0.75 ? 'risk-high' : value >= 0.45 ? '' : 'risk-low';
  return `<span class="risk-bar ${cls}" title="risk ${value.toFixed(2)}"><i style="width:${Math.round(value * 100)}%"></i></span>`;
}

/* ------------------------------- Toasts ------------------------------- */
const TOAST_ICONS = { success: 'check', error: 'alert', warn: 'alert', info: 'info' };

export function toast(title, { text = '', type = 'info', timeout = 4200 } = {}) {
  const stack = qs('#toast-stack');
  if (!stack) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.innerHTML = `
    <span class="toast-icon">${icon(TOAST_ICONS[type] || 'info')}</span>
    <div class="toast-body">
      <div class="toast-title">${esc(title)}</div>
      ${text ? `<div class="toast-text">${esc(text)}</div>` : ''}
    </div>`;
  stack.appendChild(node);
  const remove = () => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 220);
  };
  node.addEventListener('click', remove);
  if (timeout) setTimeout(remove, timeout);
}

export function toastError(err) {
  if (err?.name === 'AbortError') return;
  toast('Ошибка', { text: err?.message || String(err), type: 'error', timeout: 6500 });
}

/* ------------------------------- Overlays ------------------------------- */
let lastFocused = null;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapFocus(container) {
  const handler = (e) => {
    if (e.key !== 'Tab') return;
    const nodes = qsa(FOCUSABLE, container).filter((n) => n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}

function showOverlay(id, extraClass = '') {
  const overlay = qs(id);
  if (!overlay) return null;
  lastFocused = document.activeElement;
  overlay.className = `overlay ${extraClass}`;
  overlay.classList.remove('hidden');
  const untrap = trapFocus(overlay);
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      hideOverlay(id);
    }
  };
  overlay.addEventListener('keydown', onKey);
  overlay._cleanup = () => {
    untrap();
    overlay.removeEventListener('keydown', onKey);
  };
  return overlay;
}

export function hideOverlay(id) {
  const overlay = qs(id);
  if (!overlay || overlay.classList.contains('hidden')) return;
  overlay.classList.add('hidden');
  overlay._cleanup?.();
  if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
}

export function closeOverlays() {
  ['#modal-overlay', '#drawer-overlay', '#palette-overlay'].forEach(hideOverlay);
}

/**
 * @param {{title: string, body: string, actions?: Array<{label:string, variant?:string, onClick?:Function, close?:boolean}>, eyebrow?: string, width?: string}} cfg
 */
export function openModal({ title, body, actions = [], eyebrow = '', width = '' }) {
  qs('#modal-title').textContent = title;
  qs('#modal-body').innerHTML = (eyebrow ? `<div class="drawer-eyebrow">${esc(eyebrow)}</div>` : '') + body;
  const foot = qs('#modal-foot');
  foot.innerHTML = '';
  actions.forEach((action) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn ${action.variant || 'btn-outline'}`;
    btn.textContent = action.label;
    btn.addEventListener('click', async () => {
      if (action.onClick) {
        const keep = await action.onClick({ close: () => hideOverlay('#modal-overlay') });
        if (keep === false) return;
      }
      if (action.close !== false) hideOverlay('#modal-overlay');
    });
    foot.appendChild(btn);
  });
  const card = qs('#modal-card');
  card.style.width = width || '';
  showOverlay('#modal-overlay');
  setTimeout(() => {
    const first = qsa(FOCUSABLE, card).find((n) => n.offsetParent !== null);
    first?.focus();
  }, 40);
}

export function openDrawer({ title, eyebrow = '', body, actions = [], wide = false }) {
  const overlay = qs('#drawer-overlay');
  overlay.classList.toggle('drawer-wide', Boolean(wide));
  qs('#drawer-title').textContent = title;
  qs('#drawer-eyebrow').textContent = eyebrow;
  qs('#drawer-body').innerHTML = body;
  const foot = qs('#drawer-foot');
  foot.innerHTML = '';
  if (!actions.length) foot.classList.add('hidden');
  else foot.classList.remove('hidden');
  actions.forEach((action) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn ${action.variant || 'btn-outline'}`;
    btn.textContent = action.label;
    btn.addEventListener('click', async () => {
      if (action.onClick) {
        const keep = await action.onClick({ close: () => hideOverlay('#drawer-overlay') });
        if (keep === false) return;
      }
      if (action.close !== false) hideOverlay('#drawer-overlay');
    });
    foot.appendChild(btn);
  });
  showOverlay('#drawer-overlay', 'overlay-drawer');
}

export function confirmDialog({ title = 'Подтверждение', text = '', confirmLabel = 'Подтвердить', danger = false, details = '', requireText = '' }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    openModal({
      title,
      eyebrow: danger ? 'необратимое действие' : '',
      body: `<p class="muted">${esc(text)}</p>${details}
        ${requireText ? `<label class="field"><span class="field-label">Введите <code>${esc(requireText)}</code> для подтверждения</span>
          <input id="confirm-guard" autocomplete="off" spellcheck="false" />
          <span class="field-hint alert alert-danger hidden" id="confirm-error">Текст не совпадает</span></label>` : ''}`,
      width: '480px',
      actions: [
        { label: 'Отмена', variant: 'btn-ghost', onClick: () => done(false) },
        {
          label: confirmLabel,
          variant: danger ? 'btn-danger' : 'btn-primary',
          onClick: () => {
            if (requireText) {
              const val = (qs('#confirm-guard')?.value || '').trim();
              if (val !== requireText) {
                const err = qs('#confirm-error');
                if (err) err.classList.remove('hidden');
                qs('#confirm-guard')?.focus();
                return false;
              }
            }
            done(true);
            return true;
          },
        },
      ],
    });
    qs('#modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') done(false);
    }, { once: true });
  });
}

/** Text prompt with optional mandatory reason (returns null on cancel). */
export function promptDialog({
  title = 'Комментарий',
  label = 'Комментарий',
  placeholder = '',
  required = false,
  minLength = 0,
  confirmLabel = 'Сохранить',
  danger = false,
  hint = '',
}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    openModal({
      title,
      body: `<label class="field">
          <span class="field-label">${esc(label)}</span>
          <textarea id="prompt-input" placeholder="${esc(placeholder)}"></textarea>
          ${hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}
          <span class="field-hint alert alert-danger hidden" id="prompt-error"></span>
        </label>`,
      width: '520px',
      actions: [
        { label: 'Отмена', variant: 'btn-ghost', onClick: () => done(null) },
        {
          label: confirmLabel,
          variant: danger ? 'btn-danger' : 'btn-primary',
          onClick: () => {
            const value = qs('#prompt-input').value.trim();
            if (required && value.length < Math.max(1, minLength)) {
              const err = qs('#prompt-error');
              err.textContent = `Введите не менее ${Math.max(1, minLength)} символов`;
              err.classList.remove('hidden');
              return false;
            }
            done(value);
            return true;
          },
        },
      ],
    });
    setTimeout(() => qs('#prompt-input')?.focus(), 50);
  });
}

export function openJson(title, data, eyebrow = 'JSON') {
  openModal({
    title,
    eyebrow,
    body: `<pre class="code-block">${esc(JSON.stringify(data, null, 2))}</pre>`,
    width: '720px',
    actions: [
      {
        label: 'Скопировать',
        variant: 'btn-outline',
        close: false,
        onClick: () => copyText(JSON.stringify(data, null, 2)),
      },
      { label: 'Закрыть', variant: 'btn-ghost' },
    ],
  });
}

export function copyText(text) {
  const done = () => toast('Скопировано', { type: 'success', timeout: 1800 });
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallback());
  } else fallback();
  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch { /* ignore */ }
    ta.remove();
  }
}

/* ------------------------------- States ------------------------------- */
export function skeleton(kind = 'page') {
  if (kind === 'cards') {
    return `<div class="grid grid-4">${Array.from({ length: 4 }).map(() => '<div class="kpi"><div class="skeleton sk-line" style="width:40%"></div><div class="skeleton" style="height:26px;width:60%;margin:10px 0"></div><div class="skeleton sk-line" style="width:70%"></div></div>').join('')}</div>`;
  }
  if (kind === 'table') {
    return `<div class="card"><div class="card-body">${Array.from({ length: 8 }).map((_, i) => `<div class="skeleton sk-line" style="width:${92 - (i % 3) * 12}%"></div>`).join('')}</div></div>`;
  }
  return `
    <div class="page-head"><div><div class="skeleton sk-title"></div><div class="skeleton sk-line" style="width:320px"></div></div></div>
    <div class="grid grid-4 mb-16">${Array.from({ length: 4 }).map(() => '<div class="skeleton sk-card"></div>').join('')}</div>
    <div class="grid grid-2"><div class="skeleton sk-chart"></div><div class="skeleton sk-chart"></div></div>`;
}

export function emptyState({ title = 'Пока нет данных', text = '', iconName = 'list', action = '' } = {}) {
  return `<div class="empty">
      <span class="empty-icon">${icon(iconName)}</span>
      <h4>${esc(title)}</h4>
      ${text ? `<p>${esc(text)}</p>` : ''}
      ${action}
    </div>`;
}

export function renderError(container, err, retry) {
  container.innerHTML = `<div class="error-panel">
      <h4>Не удалось загрузить раздел</h4>
      <p>${esc(err?.message || String(err))}</p>
      <button type="button" class="btn btn-sm btn-outline" id="retry-load">Повторить</button>
    </div>`;
  qs('#retry-load', container)?.addEventListener('click', () => retry());
}

/* ------------------------------- Building blocks ------------------------------- */
export function kpi({ label, value, sub = '', spark = '', tone = '', suffix = '' }) {
  return `<div class="kpi ${tone}">
      <div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value">${value}${suffix ? `<small>${esc(suffix)}</small>` : ''}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
      ${spark ? `<div class="kpi-spark">${spark}</div>` : ''}
    </div>`;
}

export function sectionTitle(title, sub = '', action = '') {
  return `<div class="section-title"><div><h3>${esc(title)}</h3>${sub ? `<div class="dim">${esc(sub)}</div>` : ''}</div>${action}</div>`;
}

export function card({ title = '', sub = '', body = '', actions = '', flush = false, className = '' }) {
  return `<section class="card ${className}">
      ${title ? `<div class="card-head"><div><h3>${esc(title)}</h3>${sub ? `<div class="dim">${esc(sub)}</div>` : ''}</div><div class="row">${actions}</div></div>` : ''}
      <div class="card-body ${flush ? 'flush' : ''}">${body}</div>
    </section>`;
}

export function kv(rows) {
  return `<dl class="kv">${rows
    .filter(Boolean)
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v ?? '—'}</dd>`)
    .join('')}</dl>`;
}

export function meter(label, value, max, { formatter = (v) => num(v), tone = '' } = {}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const cls = tone || (ratio >= 0.9 ? 'danger' : ratio >= 0.7 ? 'warn' : '');
  return `<div class="meter">
      <div class="meter-head"><span>${esc(label)}</span><strong>${formatter(value)}${max ? ` / ${formatter(max)}` : ''}</strong></div>
      <div class="meter-track"><div class="meter-fill ${cls}" style="width:${(ratio * 100).toFixed(1)}%"></div></div>
    </div>`;
}

export function table({ columns, rows, empty = 'Нет записей', rowKey = 'id', onRow = false, caption = '' }) {
  if (!rows?.length) return `<div class="table-empty">${esc(empty)}</div>`;
  const head = columns
    .map((c) => `<th class="${c.align === 'right' ? 'num' : ''} ${c.sortable ? 'sortable' : ''}" ${c.width ? `style="width:${c.width}"` : ''}>${esc(c.label)}</th>`)
    .join('');
  const body = rows
    .map((row) => {
      const cells = columns
        .map((c) => `<td class="${c.align === 'right' ? 'num' : ''}">${c.render ? c.render(row) : esc(row[c.key] ?? '—')}</td>`)
        .join('');
      const key = typeof rowKey === 'function' ? rowKey(row) : row[rowKey];
      return `<tr ${onRow ? `class="clickable" data-key="${esc(key)}"` : ''}>${cells}</tr>`;
    })
    .join('');
  return `<div class="table-wrap"><table class="table">
      ${caption ? `<caption>${esc(caption)}</caption>` : ''}
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

export function bindRowClicks(root, handler) {
  qsa('tbody tr[data-key]', root).forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input, select')) return;
      handler(tr.dataset.key);
    });
  });
}

export function pager({ page, pageSize, total, totalPages }, { label = 'записей' } = {}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return `<div class="pager">
      <span>${num(from)}–${num(to)} из ${num(total)} ${esc(label)}</span>
      <span class="pager-btns">
        <button type="button" class="btn btn-sm btn-icon" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Предыдущая страница">${icon('chevronLeft')}</button>
        <span class="dim">${page} / ${totalPages}</span>
        <button type="button" class="btn btn-sm btn-icon" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''} aria-label="Следующая страница">${icon('chevronRight')}</button>
      </span>
    </div>`;
}

export function bindPager(root, onPage) {
  qsa('[data-page]', root).forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = Number(btn.dataset.page);
      if (Number.isFinite(p) && p > 0) onPage(p);
    });
  });
}

export function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle('loading', busy);
}

/* Delegated click helper: `run(root, '[data-action="x"]', handler)`. */
export function run(root, selector, handler) {
  qsa(selector, root).forEach((node) => {
    node.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await handler(node, e);
      } catch (err) {
        toastError(err);
      }
    });
  });
}

export function formValues(form) {
  const out = {};
  Array.from(form.elements).forEach((field) => {
    if (!field.name) return;
    if (field.type === 'checkbox') out[field.name] = field.checked;
    else if (field.type === 'number') out[field.name] = field.value === '' ? null : Number(field.value);
    else out[field.name] = field.value;
  });
  return out;
}

/* ------------------------------- Charts ------------------------------- */
export { sparkline, donut, barRows, drawHeatmap } from './charts.js';
