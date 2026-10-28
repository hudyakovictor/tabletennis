import { api, qs } from './api.js';
import { esc, fmt, money, date, shortId, toast, modal, confirmDialog, badge, card, kpi, empty, table, bars, lineChart, heatmap, formData } from './ui.js';

export async function balance(ctx) {
  const filters = ctx.state.balanceFilters;
  const d = await api.get(`/api/balance${qs({ range: ctx.state.range, ...filters })}`);
  const opt = (key, values, labels = {}) => `<select name="${key}"><option value="">Все</option>${values.map(v => `<option value="${v}" ${filters[key] === String(v) ? 'selected' : ''}>${labels[v] || v}</option>`).join('')}</select>`;
  ctx.set(`
    <form class="filters" id="balance-filters"><div class="field"><label>Устройство</label>${opt('device_type', ['touch', 'mouse', 'pen'])}</div><div class="field"><label>Pointer</label>${opt('pointer_type', ['touch', 'mouse', 'pen', 'unknown'])}</div><div class="field"><label>Rules</label>${opt('rules_version', ['3', '4'])}</div><div class="field"><label>Сборка</label><input name="build_version" value="${esc(filters.build_version || '')}" placeholder="v2.5.0-rc1"></div><button class="btn primary">Применить</button><button class="btn ghost" type="button" id="balance-reset">Сбросить</button></form>
    <div class="kpis">${[
      { label: 'Попытки ввода', value: d.totals.attempts }, { label: 'Reject rate', value: d.totals.reject_rate, unit: '%' },
      { label: 'Success rate', value: d.totals.success_rate, unit: '%' }, { label: 'Средний |timing|', value: d.totals.timing_error_ms },
    ].map(kpi).join('')}</div>
    <div class="grid two">
      ${card('Reject rate по дням', lineChart('balance-rate', d.charts.reject_rate, { color: '#ff6b85', suffix: '%' }))}
      ${card('Теплокарта отказов', heatmap(d.heatmap), { subtitle: 'along / across, только отклонённые попытки' })}
    </div>
    <div class="grid two">
      ${card('Худшие сегменты', table([
        { label: 'Сегмент', html: true, value: s => `<b>${esc(s.device)} / ${esc(s.pointer)}</b><div class="tiny muted">rules ${esc(s.rules)} · hand ${esc(s.hand)}</div>` },
        { label: 'Попытки', key: 'n', num: true }, { label: 'Reject', html: true, value: s => badge(s.reject_rate > 40 ? 'critical' : s.reject_rate > 30 ? 'warning' : 'ok', `${s.reject_rate}%`) },
      ], d.worst), { subtitle: 'Сегменты с выборкой от 20 попыток' })}
      ${card('Коды отказов', bars(d.byCode.map(x => ({ label: `${x.code} (${x.share}%)`, value: x.n }))))}
    </div>
    <div class="grid two">
      ${card('Сборки', table([
        { label: 'Build', key: 'build' }, { label: 'Попытки', key: 'n', num: true }, { label: 'Reject rate', html: true, value: b => badge(b.reject_rate > 40 ? 'critical' : 'ok', `${b.reject_rate}%`) },
      ], d.byBuild))}
      ${card('Скорость мяча', table([
        { label: 'Скорость, м/с', value: b => `${b.speed_bucket}–${b.speed_bucket + 2}` }, { label: 'Попытки', key: 'n', num: true }, { label: 'Reject rate', value: b => `${b.reject_rate}%`, num: true },
      ], d.bySpeed))}
    </div>
    ${card('Последняя сводка Balance', d.summaries[0] ? `<div class="list">${d.summaries[0].findings.map(f => `<div class="list-item"><div class="body"><h4>${esc(f.issue)}</h4><p>${esc(f.recommended_action || '')}</p></div>${badge('info', `conf. ${f.confidence}`)}</div>`).join('')}</div>` : empty('Запустите анализ в разделе ИИ-зоны'))}`);
  document.getElementById('balance-filters').onsubmit = e => {
    e.preventDefault(); const f = formData(e.target);
    ctx.state.balanceFilters = Object.fromEntries(Object.entries(f).filter(([, v]) => v)); ctx.reload();
  };
  document.getElementById('balance-reset').onclick = () => { ctx.state.balanceFilters = {}; ctx.reload(); };
}

export async function market(ctx) {
  const d = await api.get(`/api/market?range=${ctx.state.range}`);
  const totals = [
    { label: 'Расход', value: d.totals.spend, unit: '$' }, { label: 'Выручка', value: d.totals.revenue, unit: '$' },
    { label: 'ROAS', value: d.totals.roas }, { label: 'DAU / MAU', value: `${d.totals.dau} / ${d.totals.mau}` },
    { label: 'ARPU', value: d.totals.arpu, unit: '$' }, { label: 'ARPPU', value: d.totals.arppu, unit: '$' },
    { label: 'Payer conversion', value: d.totals.payer_conversion, unit: '%' }, { label: 'eCPM', value: d.totals.ecpm, unit: '$' },
  ];
  ctx.set(`<div class="kpis">${totals.map(kpi).join('')}</div>
    <div class="notice">DAU / MAU: <b>${esc(totals[3].value)}</b> · stickiness ${d.totals.sticky}% · ARPDAU $${d.totals.arpdau} · LTV $${d.totals.ltv} · D1/D7/D30: ${d.retention.overall.d1}% / ${d.retention.overall.d7}% / ${d.retention.overall.d30}%</div>
    <div class="grid two">${card('DAU', lineChart('market-dau', d.charts.dau, { color: '#62e6b5' }))}${card('Выручка', lineChart('market-revenue', d.charts.revenue, { color: '#a78bfa', suffix: ' $' }))}</div>
    ${card('Каналы и кампании', table([
      { label: 'Канал', html: true, value: c => `<b>${esc(c.channel)}</b><div class="tiny muted">${esc(c.campaign)}</div>` },
      { label: 'Игроки', key: 'players', num: true }, { label: 'Расход', value: c => money(c.spend), num: true },
      { label: 'CPI', value: c => money(c.cpi, 3), num: true }, { label: 'CAC', value: c => money(c.cac, 3), num: true },
      { label: 'LTV', value: c => money(c.ltv, 3), num: true }, { label: 'ROAS', html: true, value: c => badge(c.roas < 0.8 ? 'warning' : 'ok', c.roas), num: true },
      { label: 'Payers', value: c => `${c.payers} (${c.conversion}%)`, num: true }, { label: 'eCPM', value: c => money(c.ecpm), num: true },
    ], d.channels))}
    <div style="height:16px"></div>
    <div class="grid two">
      ${card('Retention по когортам', table([
        { label: 'Когорта', key: 'cohort' }, { label: 'Размер', key: 'size', num: true },
        { label: 'D1', value: c => `${c.d1_pct}%`, num: true }, { label: 'D7', value: c => `${c.d7_pct}%`, num: true }, { label: 'D30', value: c => `${c.d30_pct}%`, num: true },
      ], d.retention.cohorts))}
      ${card('Креативы', table([
        { label: 'Креатив', key: 'creative' }, { label: 'Канал', key: 'channel' }, { label: 'Игроки', key: 'players', num: true }, { label: 'Выручка', value: c => money(c.revenue), num: true },
      ], d.creatives))}
    </div>`);
}

export async function economy(ctx) {
  const d = await api.get(`/api/economy?range=${ctx.state.range}`);
  ctx.set(`<div class="kpis">${[
    { label: 'Выручка', value: d.totals.revenue, unit: '$' }, { label: 'Платежи', value: d.totals.payments },
    { label: 'Платящие', value: d.totals.payers }, { label: 'Возвраты', value: d.totals.refunds },
  ].map(kpi).join('')}</div>
    <div class="grid two">${card('Выручка по дням', lineChart('economy-revenue', d.charts.revenue, { color: '#a78bfa', suffix: ' $' }))}${card('Количество платежей', lineChart('economy-count', d.charts.payments, { color: '#6aa8ff' }))}</div>
    <div class="grid two">
      ${card('Продукты', table([
        { label: 'Продукт', html: true, value: p => `<b>${esc(p.product_id)}</b><div class="tiny muted">${esc(p.product_kind)}</div>` },
        { label: 'Продажи', key: 'n', num: true }, { label: 'Выручка', value: p => money(p.revenue), num: true },
      ], d.products))}
      ${card('Регионы', table([
        { label: 'Регион', key: 'region' }, { label: 'Платежи', key: 'n', num: true }, { label: 'Выручка', value: r => money(r.revenue), num: true },
      ], d.byRegion))}
    </div>
    ${card('Sink / source валюты', table([
      { label: 'Валюта', key: 'currency' }, { label: 'Тип', html: true, value: f => badge(f.kind === 'source' ? 'ok' : 'info', f.kind) },
      { label: 'Операции', key: 'n', num: true }, { label: 'Сумма', value: f => fmt(f.amount, 0), num: true },
    ], d.flows), { subtitle: 'Источники и стоки виртуальной валюты для контроля инфляции' })}`);
}

export async function players(ctx) {
  const f = ctx.state.players;
  const d = await api.get(`/api/players${qs({ ...f, limit: 50 })}`);
  ctx.set(`<form class="filters" id="player-filters"><div class="field grow"><label>Поиск</label><input name="search" value="${esc(f.search)}" placeholder="ID, имя или Telegram ID"></div><div class="field"><label>Регион</label><select name="region"><option value="">Все</option>${['RU', 'CIS', 'EU', 'IN', 'BR', 'US', 'OTHER'].map(r => `<option ${f.region === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div><div class="field"><label>Статус</label><select name="status"><option value="">Все</option>${['active', 'banned', 'deleted'].map(s => `<option ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div><button class="btn primary">Найти</button><button class="btn" type="button" id="export-players">CSV</button></form>
    <div class="notice">Найдено: <b>${d.total}</b>. Откройте игрока для сессий, платежей, согласий и ручных действий.</div>
    ${card('Игроки', table([
      { label: 'ID / имя', html: true, value: p => `<b>${esc(p.display_name || 'Без имени')}</b><div class="tiny muted mono">${esc(p.id)}</div>` },
      { label: 'Регион', key: 'region' }, { label: 'Канал', html: true, value: p => `${esc(p.channel || '—')}<div class="tiny muted">${esc(p.campaign || '')}</div>` },
      { label: 'Установка', value: p => date(p.install_at) }, { label: 'LTV', value: p => money(p.ltv_usd), num: true },
      { label: 'Risk', html: true, value: p => `<span class="risk"><i style="width:${Math.min(100, p.risk_score * 100)}%"></i></span>${fmt(p.risk_score, 2)}` },
      { label: 'Статус', html: true, value: p => badge(p.status) },
    ], d.rows))}
    <div class="pagination"><button class="btn sm" id="prev" ${f.offset <= 0 ? 'disabled' : ''}>← Назад</button><span>${f.offset + 1}–${Math.min(f.offset + 50, d.total)} из ${d.total}</span><button class="btn sm" id="next" ${f.offset + 50 >= d.total ? 'disabled' : ''}>Вперёд →</button></div>`);
  document.getElementById('player-filters').onsubmit = e => { e.preventDefault(); ctx.state.players = { ...ctx.state.players, ...formData(e.target), offset: 0 }; ctx.reload(); };
  document.getElementById('prev').onclick = () => { ctx.state.players.offset = Math.max(0, f.offset - 50); ctx.reload(); };
  document.getElementById('next').onclick = () => { ctx.state.players.offset = f.offset + 50; ctx.reload(); };
  document.getElementById('export-players').onclick = () => { location.href = '/api/export?entity=players&format=csv'; };
  ctx.root.querySelectorAll('tbody tr[data-id]').forEach(row => { row.classList.add('clickable'); row.onclick = () => showPlayer(row.dataset.id, ctx.reload); });
}

async function showPlayer(id, reload) {
  try {
    const d = await api.get(`/api/players/${encodeURIComponent(id)}`);
    const p = d.player;
    const m = modal({ title: `${p.display_name || 'Игрок'} · ${p.id}`, wide: true, body: `
      <div class="kpis">${[
        { label: 'LTV', value: p.ltv_usd, unit: '$' }, { label: 'Risk score', value: p.risk_score },
        { label: 'Попытки ввода', value: d.input.attempts }, { label: 'Reject rate', value: d.input.reject_rate, unit: '%' },
      ].map(kpi).join('')}</div>
      <div class="notice">Регион: <b>${esc(p.region)}</b> · канал: ${esc(p.channel)} / ${esc(p.campaign)} · статус: ${badge(p.status)} · установка: ${date(p.install_at)}</div>
      <div class="form-actions" style="justify-content:flex-start;margin:0 0 16px"><button class="btn ${p.status === 'banned' ? '' : 'danger'}" id="player-status">${p.status === 'banned' ? 'Разблокировать' : 'Заблокировать вручную'}</button><button class="btn" id="player-score">Пересчитать fraud score</button><button class="btn danger" id="player-delete">Удалить / анонимизировать ПДн</button></div>
      <div class="grid two">
        ${card('Сессии', table([{ label: 'Начало', value: s => date(s.started_at) }, { label: 'Устройство', key: 'device_type' }, { label: 'FPS', value: s => fmt(s.fps_avg, 1), num: true }, { label: 'Crash', html: true, value: s => badge(s.crash ? 'critical' : 'ok', s.crash ? 'crash' : 'ok') }], d.sessions))}
        ${card('Платежи', table([{ label: 'Дата', value: x => date(x.ts) }, { label: 'Продукт', key: 'product_id' }, { label: 'Сумма', value: x => money(x.amount_usd), num: true }, { label: 'Статус', html: true, value: x => badge(x.status) }], d.payments))}
      </div>
      <div class="grid two">
        ${card('Согласия', `<form id="consent-form">${[['consent_telemetry', 'Телеметрия'], ['consent_ai_analysis', 'ИИ-анализ'], ['consent_marketing', 'Маркетинг']].map(([k, label]) => `<label class="check"><input type="checkbox" name="${k}" ${p[k] ? 'checked' : ''}>${label}</label>`).join('')}<button class="btn primary sm">Сохранить согласия</button></form>`)}
        ${card('Fraud-кейсы и тикеты', `<div class="list">${d.fraud.map(c => `<div class="list-item"><div class="body"><h4>Risk ${c.risk_score} · ${esc(c.status)}</h4><p>${date(c.ts)}</p></div></div>`).join('')}${d.tickets.map(t => `<div class="list-item"><div class="body"><h4>${esc(t.subject)}</h4><p>${esc(t.status)} · ${date(t.ts)}</p></div></div>`).join('') || '<p class="muted">Нет записей</p>'}</div>`)}
      </div>` });
    m.body.querySelector('#player-status').onclick = async () => {
      const next = p.status === 'banned' ? 'active' : 'banned';
      if (!await confirmDialog(next === 'banned' ? 'Ручная блокировка' : 'Разблокировка', next === 'banned' ? 'Это решение владельца. ИИ не участвует в блокировке.' : 'Вернуть игроку активный статус?', { danger: next === 'banned' })) return;
      try { await api.post(`/api/players/${id}/status`, { status: next, reason: 'Ручное решение владельца из CRM' }); toast('Статус игрока обновлён'); m.close(); reload(); } catch (e) { toast(e.message, 'error'); }
    };
    m.body.querySelector('#player-score').onclick = async () => {
      try { const r = await api.post(`/api/fraud/score/${id}`, { create_case: true }); toast(`Risk score: ${r.score?.risk ?? r.score?.score?.risk ?? 'готово'}${r.created ? ', кейс создан' : ''}`); } catch (e) { toast(e.message, 'error'); }
    };
    m.body.querySelector('#consent-form').onsubmit = async e => {
      e.preventDefault(); const fd = new FormData(e.target);
      const body = {}; for (const k of ['consent_telemetry', 'consent_ai_analysis', 'consent_marketing']) body[k] = fd.has(k);
      try { await api.post(`/api/players/${id}/consents`, body); toast('Согласия сохранены'); } catch (err) { toast(err.message, 'error'); }
    };
    m.body.querySelector('#player-delete').onclick = async () => {
      if (!await confirmDialog('Удаление персональных данных', 'Email hash, fingerprint, Telegram ID и связанные логи будут удалены/анонимизированы. Действие необратимо.', { danger: true, confirmText: 'Удалить ПДн' })) return;
      try { await api.post(`/api/players/${id}/delete-data`, { confirm: id }); toast('Персональные данные удалены'); m.close(); reload(); } catch (e) { toast(e.message, 'error'); }
    };
  } catch (e) { toast(e.message, 'error'); }
}
