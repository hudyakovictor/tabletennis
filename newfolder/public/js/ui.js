/* DOM/HTML helpers. Любой пользовательский/серверный текст экранируется через esc. */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (v, digits = 0) => Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
export const money = (v, digits = 2) => `$${Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
export const date = (v, withTime = true) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return esc(v);
  return d.toLocaleString('ru-RU', withTime ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', year: 'numeric' });
};
export const shortId = (v) => String(v || '').slice(0, 8);
export const percent = (v) => `${fmt(v, 1)}%`;

export function toast(message, type = 'ok', timeout = 4500) {
  const root = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${type === 'error' ? '⚠' : type === 'ok' ? '✓' : 'ℹ'}</span><div>${esc(message)}</div><button aria-label="Закрыть">×</button>`;
  el.querySelector('button').onclick = () => el.remove();
  root.appendChild(el);
  setTimeout(() => el.remove(), timeout);
}

export function modal({ title, body, wide = false, onClose = null }) {
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h2>${esc(title)}</h2><button class="icon-btn close" aria-label="Закрыть">×</button></header>
    <div class="modal-body"></div></section>`;
  const bodyEl = wrap.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  const close = () => { wrap.remove(); document.removeEventListener('keydown', key); onClose?.(); };
  wrap.querySelector('.close').onclick = close;
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  const key = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  root.appendChild(wrap);
  return { el: wrap, body: bodyEl, close };
}

export function confirmDialog(title, text, { danger = false, confirmText = 'Подтвердить' } = {}) {
  return new Promise(resolve => {
    const m = modal({ title, body: `<p class="muted">${esc(text)}</p><div class="form-actions"><button class="btn ghost cancel">Отмена</button><button class="btn ${danger ? 'danger' : 'primary'} ok">${esc(confirmText)}</button></div>` });
    m.body.querySelector('.cancel').onclick = () => { m.close(); resolve(false); };
    m.body.querySelector('.ok').onclick = () => { m.close(); resolve(true); };
  });
}

export function badge(value, label = '') {
  const v = String(value || 'ok').toLowerCase();
  const map = { critical: 'bad', error: 'bad', fatal: 'bad', failed: 'bad', banned: 'bad', confirmed: 'bad', high: 'bad',
    warning: 'warn', pending: 'warn', draft: 'muted', new: 'info', open: 'warn', running: 'info', in_progress: 'info',
    ok: 'good', active: 'good', published: 'good', resolved: 'good', completed: 'good', approved: 'good', executed: 'good', paid: 'good', sent: 'good',
    false_positive: 'muted', archived: 'muted', closed: 'muted', rejected: 'bad', ack: 'info', quarantined: 'bad' };
  return `<span class="badge ${map[v] || 'muted'}">${esc(label || value || '—')}</span>`;
}

export function card(title, content, { subtitle = '', actions = '', className = '' } = {}) {
  return `<section class="card ${className}"><div class="card-head"><div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>${actions ? `<div class="card-actions">${actions}</div>` : ''}</div><div class="card-body">${content}</div></section>`;
}

export function kpi(item) {
  const delta = item.delta === null || item.delta === undefined ? '' : `<span class="delta ${item.delta > 0 ? 'up' : item.delta < 0 ? 'down' : ''}">${item.delta > 0 ? '+' : ''}${fmt(item.delta, 1)}%</span>`;
  const digits = item.digits ?? (item.unit === '%' ? 1 : (Number.isFinite(item.value) && !Number.isInteger(item.value) ? 2 : 0));
  const value = typeof item.value === 'string' ? esc(item.value) : item.unit === '$' ? money(item.value) : `${fmt(item.value, digits)}${item.unit === '%' ? '%' : ''}`;
  return `<div class="kpi"><div class="kpi-label">${esc(item.label)}</div><div class="kpi-value">${value}</div><div class="kpi-foot">${delta}<span>${esc(item.hint || '')}</span></div></div>`;
}

export function empty(text = 'Нет данных за выбранный период') {
  return `<div class="empty"><div>◌</div><p>${esc(text)}</p></div>`;
}

export function table(columns, rows, { emptyText = 'Нет данных' } = {}) {
  if (!rows?.length) return empty(emptyText);
  return `<div class="table-wrap"><table><thead><tr>${columns.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr data-id="${esc(row.id || '')}">${columns.map(c => {
    const raw = typeof c.value === 'function' ? c.value(row) : row[c.key];
    return `<td class="${c.num ? 'num' : ''} ${c.className || ''}">${c.html ? raw : esc(raw ?? '—')}</td>`;
  }).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function bars(rows, { label = 'label', value = 'value', color = '', max = null, suffix = '' } = {}) {
  if (!rows?.length) return empty();
  const peak = max ?? Math.max(1, ...rows.map(r => Number(r[value]) || 0));
  return `<div class="bars">${rows.map(r => `<div class="bar-row"><div class="bar-label" title="${esc(r[label])}">${esc(r[label])}</div><div class="bar-track"><i style="width:${Math.max(1, Math.min(100, (Number(r[value]) || 0) / peak * 100))}%;${color ? `background:${color}` : ''}"></i></div><div class="bar-value">${fmt(r[value], 1)}${esc(suffix)}</div></div>`).join('')}</div>`;
}

export function lineChart(id, series, { label = '', color = '#62e6b5', height = 180, suffix = '', fill = true } = {}) {
  const points = series?.map((x, i) => ({ x: x.day || x.label || i, y: Number(x.value ?? x.y) || 0 })) || [];
  return `<div class="chart" data-chart="${esc(id)}" data-color="${esc(color)}" data-suffix="${esc(suffix)}" data-fill="${fill}" data-points="${esc(JSON.stringify(points))}" style="height:${height}px"><canvas></canvas><div class="chart-tooltip"></div>${label ? `<span class="chart-label">${esc(label)}</span>` : ''}</div>`;
}

export function mountCharts(root = document) {
  root.querySelectorAll('.chart').forEach(el => {
    if (el.dataset.mounted) return;
    el.dataset.mounted = '1';
    const canvas = el.querySelector('canvas');
    let points = [];
    try { points = JSON.parse(el.dataset.points || '[]'); } catch { /* empty */ }
    const tooltip = el.querySelector('.chart-tooltip');
    const draw = (hover = -1) => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(20, rect.width), h = Math.max(20, rect.height);
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      const pad = { l: 8, r: 8, t: 16, b: 22 };
      const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
      ctx.strokeStyle = 'rgba(148,163,184,.10)'; ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) { const y = pad.t + ih * i / 3; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); }
      if (!points.length) {
        ctx.fillStyle = '#64748b'; ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('Нет данных', w / 2, h / 2); return;
      }
      const max = Math.max(1, ...points.map(p => p.y));
      const min = Math.min(0, ...points.map(p => p.y));
      const xy = points.map((p, i) => ({ ...p, label: p.x, x: pad.l + (points.length === 1 ? iw / 2 : iw * i / (points.length - 1)), y: pad.t + ih - (p.y - min) / Math.max(1e-9, max - min) * ih }));
      const color = el.dataset.color || '#62e6b5';
      if (el.dataset.fill !== 'false') {
        const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
        grad.addColorStop(0, `${color}44`); grad.addColorStop(1, `${color}00`);
        ctx.beginPath(); ctx.moveTo(xy[0].x, h - pad.b); xy.forEach(p => ctx.lineTo(p.x, p.y)); ctx.lineTo(xy.at(-1).x, h - pad.b); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
      }
      ctx.beginPath(); xy.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
      xy.forEach((p, i) => { if (i === hover || points.length <= 3) { ctx.beginPath(); ctx.arc(p.x, p.y, i === hover ? 4 : 3, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); } });
      ctx.fillStyle = '#64748b'; ctx.font = '10px system-ui'; ctx.textAlign = 'left';
      if (xy[0]) ctx.fillText(String(xy[0].label).slice(5), pad.l, h - 6);
      if (xy.length > 1) { ctx.textAlign = 'right'; ctx.fillText(String(xy.at(-1).label).slice(5), w - pad.r, h - 6); }
      el._xy = xy;
    };
    draw();
    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const xy = el._xy || [];
      let nearest = -1, dist = Infinity;
      xy.forEach((p, i) => { const d = Math.abs(p.x - x); if (d < dist) { dist = d; nearest = i; } });
      draw(nearest);
      const p = xy[nearest];
      if (p) { tooltip.style.display = 'block'; tooltip.style.left = `${Math.min(rect.width - 120, Math.max(4, p.x + 8))}px`; tooltip.style.top = `${Math.max(4, p.y - 30)}px`; tooltip.textContent = `${p.label}: ${fmt(p.y, 2)}${el.dataset.suffix || ''}`; }
    });
    canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; draw(); });
    if (window.ResizeObserver) new ResizeObserver(() => draw()).observe(el);
  });
}

export function heatmap(model) {
  if (!model?.cells) return empty();
  const { cells, max, size } = model;
  let html = '<div class="heatmap-wrap"><div class="heatmap" style="grid-template-columns:repeat(' + size + ',1fr)">';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = cells[y][x]; const alpha = v ? 0.18 + 0.82 * v / max : 0.025;
    html += `<i title="along ${Math.round(-100 + x * 200 / size)}…${Math.round(-100 + (x + 1) * 200 / size)}, across ${Math.round(-100 + y * 200 / size)}…: ${v}" style="background:rgba(255,92,122,${alpha})"></i>`;
  }
  html += '</div><div class="heat-axis"><span>along −100</span><span>along +100</span></div><p>Красным — отказы ввода по координатам along/across. Наведите на ячейку.</p></div>';
  return html;
}

export function jsonBlock(value) { return `<pre class="json">${esc(JSON.stringify(value, null, 2))}</pre>`; }
export function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
export function debounce(fn, ms = 300) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }
export function download(path) { const a = document.createElement('a'); a.href = path; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); }
