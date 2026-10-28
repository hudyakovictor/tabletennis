import { api } from './api.js';
import { esc, fmt, money, date, shortId, toast, modal, confirmDialog, badge, card, kpi, empty, table, bars, lineChart, jsonBlock, formData } from './ui.js';

const J = (v, d = {}) => { try { return JSON.parse(v); } catch { return d; } };
const range = (ctx) => ctx.state.range;

export async function overview(ctx) {
  const d = await api.get(`/api/overview?range=${range(ctx)}`);
  const zones = ['ops', 'fraud', 'balance', 'market', 'lab'].map(z => d.zoneStatus.find(x => x.zone === z) || { zone: z, status: 'empty', findings: '[]', metrics: '{}' });
  ctx.set(`
    ${d.openIncidents.length ? `<div class="notice danger"><b>Открытые инциденты:</b> ${d.openIncidents.map(i => esc(i.title)).join(' · ')}</div>` : ''}
    <div class="kpis">${d.kpis.map(kpi).join('')}</div>
    <div class="grid two">
      ${card('Активность', lineChart('dau', d.charts.dau, { color: '#62e6b5', suffix: ' игроков' }), { subtitle: 'Уникальные игроки по дням' })}
      ${card('Сессии', lineChart('sessions', d.charts.sessions, { color: '#6aa8ff' }), { subtitle: 'Игровые сессии' })}
      ${card('Выручка', lineChart('revenue', d.charts.revenue, { color: '#a78bfa', suffix: ' $' }), { subtitle: 'Оплачено, без возвратов' })}
      ${card('Качество ввода', lineChart('reject', d.charts.reject_rate, { color: '#ff7d95', suffix: '%' }), { subtitle: 'Доля отклонённых попыток' })}
    </div>
    <h3 style="margin:20px 0 10px">Состояние зон</h3>
    <div class="zone-grid">${zones.map(z => {
      const findings = J(z.findings, []); const metrics = J(z.metrics, {});
      return `<div class="zone-card"><h3>${esc(z.zone.toUpperCase())} ${badge(z.status)}</h3><p>${findings[0] ? esc(findings[0].issue) : 'Сводок пока нет'}</p><div class="zone-metrics">${Object.entries(metrics).slice(0, 2).map(([k, v]) => `${esc(k)}: <b>${fmt(v, 2)}</b>`).join('<br>')}</div><div class="tiny muted" style="margin-top:8px">${date(z.ts)}</div></div>`;
    }).join('')}</div>
    <div class="grid sidebar-layout" style="margin-top:16px">
      ${card('Приоритетные алерты', table([
        { label: 'Уровень', html: true, value: a => badge(a.level) },
        { label: 'Зона', key: 'zone' }, { label: 'Алерт', html: true, value: a => `<b>${esc(a.title)}</b><div class="tiny muted">${esc(a.message)}</div>` },
        { label: 'Время', value: a => date(a.ts) },
      ], d.alerts), { actions: '<a class="btn sm ghost" href="#/alerts">Все алерты →</a>' })}
      ${card('Требуют решения', `<div class="list"><div class="list-item"><div class="body"><h4>${d.pendingProposals} предложений от зон</h4><p>Ничего не исполняется без вашего подтверждения.</p></div><a class="btn sm" href="#/proposals">Открыть</a></div><div class="list-item"><div class="body"><h4>${d.openTickets} обращений в поддержку</h4><p>Новые и находящиеся в работе тикеты.</p></div><a class="btn sm" href="#/tickets">Очередь</a></div></div>`, { subtitle: 'Human-in-the-loop' })}
    </div>`);
}

export async function ops(ctx) {
  const d = await api.get(`/api/ops?range=${range(ctx)}`);
  const golden = [
    { label: 'Latency p50 / p95 / p99', value: `${d.golden.latency.p50} / ${d.golden.latency.p95} / ${d.golden.latency.p99} мс` },
    { label: 'Traffic', value: `${fmt(d.golden.traffic.requests)} req · ${fmt(d.golden.traffic.sessions)} sess` },
    { label: 'Errors', value: `${d.golden.errors.rate_5xx}% 5xx · crash ${d.golden.errors.crash_rate}%` },
    { label: 'Saturation', value: `${d.golden.saturation.avg_frame_ms} мс frame · ping ${d.golden.saturation.avg_ping_ms}` },
  ];
  ctx.set(`
    <div class="grid four">${golden.map(g => `<div class="kpi"><div class="kpi-label">${esc(g.label)}</div><div style="font-size:17px;font-weight:650;margin-top:12px">${esc(g.value)}</div></div>`).join('')}</div>
    <div class="grid three">
      ${card('Запросы', lineChart('requests', d.charts.requests, { color: '#6aa8ff' }))}
      ${card('Ошибки 5xx', lineChart('errors5xx', d.charts.errors, { color: '#ff6b85' }))}
      ${card('Средняя latency', lineChart('latency', d.charts.latency, { color: '#f6c760', suffix: ' мс' }))}
    </div>
    <div class="grid two">
      ${card('Коды отказов ввода', bars(d.rejects.map(x => ({ label: x.code, value: x.n }))), { subtitle: 'accepted — успешные попытки' })}
      ${card('Производительность', table([
        { label: 'Метрика', key: 'label' }, { label: 'Значение', key: 'value', num: true },
      ], Object.entries(d.perf).map(([k, v]) => ({ label: k, value: fmt(v, 2) }))))}
    </div>
    <div class="grid two">
      ${card('Сборки', table([
        { label: 'Build', key: 'build' }, { label: 'Сессии', key: 'sessions', num: true },
        { label: 'Крэши', key: 'crashes', num: true }, { label: 'Crash rate', html: true, value: b => badge(b.crashes / Math.max(1, b.sessions) * 100 > 3 ? 'critical' : 'ok', `${fmt(b.crashes / Math.max(1, b.sessions) * 100, 1)}%`) },
      ], d.builds))}
      ${card('Устройства', table([
        { label: 'Тип', key: 'device' }, { label: 'Сессии', key: 'n', num: true }, { label: 'FPS', value: x => fmt(x.fps, 1), num: true },
      ], d.devices))}
    </div>
    <div class="grid two">
      ${card('Последние ошибки', table([
        { label: 'Код', html: true, value: e => `<code>${esc(e.code)}</code>` }, { label: 'Уровень', html: true, value: e => badge(e.level) }, { label: 'Повторы', key: 'n', num: true },
      ], d.errors), { subtitle: 'Группировка по stack hash' })}
      ${card('Пинг регионов', table([
        { label: 'Регион', key: 'region' }, { label: 'Средний ping', html: true, value: p => `<b class="${p.ping_ms > 100 ? 'bad' : ''}">${fmt(p.ping_ms, 1)} мс</b>` },
        { label: 'Замеры', key: 'samples', num: true }, { label: 'Обновлено', value: p => date(p.last_ts) },
      ], d.pings), { subtitle: 'Предупреждение при ping > 100 мс' })}
    </div>`);
}

export async function alerts(ctx) {
  const [alertsData, incidents] = await Promise.all([api.get('/api/alerts'), api.get('/api/incidents')]);
  ctx.set(`
    <div class="filters"><button class="btn primary" id="evaluate">Запустить детекторы</button><button class="btn" id="new-incident">+ Открыть инцидент</button><span class="muted small">Детекторы также работают по расписанию. Алерты не изменяют игру.</span></div>
    ${card('Алерты', table([
      { label: 'Уровень', html: true, value: a => badge(a.level) }, { label: 'Зона', key: 'zone' }, { label: 'Код', html: true, value: a => `<code>${esc(a.code)}</code>` },
      { label: 'Сообщение', html: true, value: a => `<b>${esc(a.title)}</b><div class="tiny muted">${esc(a.message)}</div>` },
      { label: 'Статус', html: true, value: a => badge(a.status) }, { label: 'Время', value: a => date(a.ts) },
      { label: 'Действия', html: true, value: a => `<div class="card-actions"><button class="btn sm ghost" data-runbook="${esc(a.runbook || '')}">Runbook</button>${a.status === 'open' ? `<button class="btn sm" data-ack="${a.id}">Ack</button>` : ''}${a.status !== 'resolved' ? `<button class="btn sm" data-resolve="${a.id}">Решён</button>` : ''}</div>` },
    ], alertsData))}
    <div style="height:16px"></div>
    ${card('Инциденты', table([
      { label: 'Название', key: 'title' }, { label: 'Severity', html: true, value: i => badge(i.severity) }, { label: 'Зона', key: 'zone' },
      { label: 'Статус', html: true, value: i => badge(i.status) }, { label: 'Описание', key: 'summary' }, { label: 'Создан', value: i => date(i.ts) },
      { label: '', html: true, value: i => `<button class="btn sm" data-incident="${i.id}">Изменить</button>` },
    ], incidents))}`);
  const reload = ctx.reload;
  document.getElementById('evaluate').onclick = async e => {
    e.target.disabled = true;
    try { const r = await api.post('/api/alerts/evaluate'); toast(`Детекторы выполнены: создано ${r.count} алертов`); reload(); }
    catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
  };
  ctx.root.querySelectorAll('[data-ack],[data-resolve]').forEach(b => b.onclick = async () => {
    try { await api.post(`/api/alerts/${b.dataset.ack || b.dataset.resolve}/status`, { status: b.dataset.ack ? 'ack' : 'resolved' }); toast('Статус алерта обновлён'); reload(); }
    catch (e) { toast(e.message, 'error'); }
  });
  ctx.root.querySelectorAll('[data-runbook]').forEach(b => b.onclick = async () => {
    try { const r = await api.get(`/api/runbooks/${encodeURIComponent(b.dataset.runbook)}`); modal({ title: `Runbook: ${r.name}`, body: `<div class="docs"><pre class="code-block">${esc(r.content)}</pre></div>`, wide: true }); }
    catch (e) { toast(e.message, 'error'); }
  });
  const incidentForm = (incident = {}) => {
    const m = modal({ title: incident.id ? 'Изменить инцидент' : 'Открыть инцидент', body: `<form id="incident-form"><div class="field"><label>Название</label><input name="title" required value="${esc(incident.title || '')}"></div><div class="field-row"><div class="field"><label>Severity</label><select name="severity">${['info', 'warning', 'critical'].map(x => `<option ${incident.severity === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="field"><label>Статус</label><select name="status">${['open', 'mitigated', 'resolved'].map(x => `<option ${incident.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div><div class="field"><label>Зона</label><select name="zone">${['ops', 'fraud', 'balance', 'market', 'lab'].map(x => `<option ${incident.zone === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="field"><label>Описание / post-mortem</label><textarea name="summary">${esc(incident.summary || '')}</textarea></div><div class="form-actions"><button class="btn primary">Сохранить</button></div></form>` });
    m.body.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      try { await (incident.id ? api.patch(`/api/incidents/${incident.id}`, formData(e.target)) : api.post('/api/incidents', formData(e.target))); m.close(); toast('Инцидент сохранён'); reload(); }
      catch (err) { toast(err.message, 'error'); }
    };
  };
  document.getElementById('new-incident').onclick = () => incidentForm();
  ctx.root.querySelectorAll('[data-incident]').forEach(b => b.onclick = () => incidentForm(incidents.find(i => i.id === b.dataset.incident)));
}
