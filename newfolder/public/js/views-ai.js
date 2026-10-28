import { api, qs } from './api.js';
import { esc, fmt, money, date, shortId, toast, modal, confirmDialog, badge, card, kpi, empty, table, bars, lineChart, jsonBlock, formData } from './ui.js';

export async function ai(ctx) {
  const d = await api.get(`/api/ai?range=${ctx.state.range}`);
  ctx.set(`<div class="kpis">${[
    { label: 'AI-запросы', value: d.totals.requests }, { label: 'Токены', value: d.totals.tokens },
    { label: 'Стоимость', value: d.totals.cost, unit: '$' }, { label: 'Карантин', value: d.totals.quarantined },
  ].map(kpi).join('')}</div>
    <div class="filters"><button class="btn primary" id="run-all">Запустить все зоны</button><span class="muted small">Без API-ключей работает локальный детерминированный анализ. Ключи задаются только в .env.</span></div>
    <div class="zone-grid">${d.zones.map(z => `<div class="zone-card"><h3>${esc(z.zone.toUpperCase())} ${badge(z.lastSummary?.status || 'empty')}</h3><p>${esc(d.zoneMeta[z.zone]?.description || '')}</p><p>Модель: <span class="mono">${esc(z.model)}</span></p><p>Провайдер: ${badge(z.configured ? 'info' : 'muted', z.provider)}</p><div class="tiny muted">Лимит сегодня: ${fmt(z.usedToday)} / ${fmt(z.dailyLimit)} токенов</div><div class="progress"><i style="width:${Math.min(100, z.usagePct)}%;${z.usagePct > 90 ? 'background:var(--bad)' : ''}"></i></div><p>Стоимость: ${money(z.cost, 4)} · запросов: ${z.requests}</p><button class="btn sm primary" data-run-zone="${z.zone}">Анализировать</button></div>`).join('')}</div>
    <div style="height:16px"></div>
    <div class="grid two">
      ${card('Последние AI-запросы', table([
        { label: 'Время', value: r => date(r.ts) }, { label: 'Зона', key: 'zone' }, { label: 'Провайдер', key: 'provider' },
        { label: 'Токены', value: r => fmt((r.prompt_tokens || 0) + (r.completion_tokens || 0)), num: true }, { label: 'Cost', value: r => money(r.cost_usd, 5), num: true },
        { label: 'Статус', html: true, value: r => badge(r.status) }, { label: 'ms', key: 'latency_ms', num: true },
      ], d.recentRequests))}
      ${card('Карантин ответов', d.quarantine.length ? `<div class="list">${d.quarantine.map(q => `<div class="list-item"><div class="body"><h4>${esc(q.zone)} · ${date(q.ts)} ${badge(q.resolved ? 'resolved' : 'quarantined')}</h4><p>${esc(q.reason)}</p><details><summary class="tiny muted">Сырой ответ (недоверенный)</summary>${jsonBlock(q.raw)}</details></div>${!q.resolved ? `<button class="btn sm" data-quarantine="${q.id}">Проверено</button>` : ''}</div>`).join('')}</div>` : empty('Карантин пуст'))}
    </div>`);
  const run = async (zone, button) => {
    button.disabled = true;
    try { const r = await api.post(`/api/ai/zones/${zone}/run`); toast(r.ok ? `${zone}: сводка ${r.summary.status}` : `${zone}: ответ в карантине`, r.ok ? 'ok' : 'error'); ctx.reload(); }
    catch (e) { toast(e.message, 'error'); button.disabled = false; }
  };
  ctx.root.querySelectorAll('[data-run-zone]').forEach(b => b.onclick = () => run(b.dataset.runZone, b));
  document.getElementById('run-all').onclick = async e => {
    e.target.disabled = true;
    try { const r = await api.post('/api/ai/zones/run-all'); const ok = Object.values(r).filter(x => x.ok).length; toast(`Готово: ${ok}/5 зон`); ctx.reload(); }
    catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
  };
  ctx.root.querySelectorAll('[data-quarantine]').forEach(b => b.onclick = async () => { try { await api.post(`/api/ai/quarantine/${b.dataset.quarantine}/resolve`); toast('Запись отмечена проверенной'); ctx.reload(); } catch (e) { toast(e.message, 'error'); } });
}

function chatMessage(m) {
  if (m.role === 'user') return `<div class="message user"><div class="bubble">${esc(m.content)}</div><div class="avatar">Вы</div></div>`;
  let a;
  try { a = JSON.parse(m.content); } catch { a = { summary: m.content, status: 'ok', findings: [], next_questions: [] }; }
  return `<div class="message assistant"><div class="avatar">AI</div><div class="bubble"><div style="margin-bottom:6px">${badge(a.status)} <span class="tiny muted">${esc(m.meta?.provider || '')}</span></div><div>${esc(a.summary)}</div>${a.findings?.length ? `<ul class="findings">${a.findings.map(f => `<li><b>${esc(f.zone)}</b>: ${esc(f.issue)} <span class="muted">(${f.confidence})</span>${f.recommended_action ? `<div class="tiny muted">→ ${esc(f.recommended_action)}</div>` : ''}</li>`).join('')}</ul>` : ''}${a.next_questions?.length ? `<div class="next">${a.next_questions.map(q => `<button class="btn sm ghost" data-question="${esc(q)}">${esc(q)}</button>`).join('')}</div>` : ''}</div></div>`;
}

export async function director(ctx) {
  const d = await api.get('/api/director/chat');
  const p = d.context.persistent;
  ctx.set(`<div class="notice">Директор видит только сводки зон и контекст за ${d.context.window_hours} часов. Сырые логи, ПДн и ключи ему недоступны. Ответы проходят JSON Schema-валидацию.</div>
    <div class="chat-layout">
      <section class="card chat"><div class="card-head"><div><h3>Чат с директором</h3><p>Sliding window · решения принимает владелец</p></div><button class="btn sm ghost" id="archive-chat">Архивировать старое</button></div><div class="card-body" style="display:flex;flex-direction:column;flex:1;min-height:0"><div class="chat-messages" id="chat-messages">${d.messages.map(chatMessage).join('') || empty('Задайте первый вопрос')}</div><form class="chat-form" id="chat-form"><textarea name="question" placeholder="Например: какие зоны требуют внимания?" required></textarea><button class="btn primary">Отправить</button></form></div></section>
      <div>
        ${card('Постоянный блок состояния', `<h4>Открытые инциденты (${p.open_incidents.length})</h4><div class="list">${p.open_incidents.map(i => `<div class="list-item"><div class="body"><h4>${esc(i.title)}</h4><p>${esc(i.severity)} · ${esc(i.zone)}</p></div></div>`).join('') || '<p class="muted small">Нет</p>'}</div><h4 style="margin-top:14px">Активные A/B (${p.active_tests.length})</h4>${p.active_tests.map(t => `<p class="small">• ${esc(t.name)}</p>`).join('') || '<p class="muted small">Нет</p>'}<h4 style="margin-top:14px">Приоритеты <button class="btn sm ghost" id="edit-priorities">Изменить</button></h4>${(p.priorities || []).map(x => `<p class="small">• ${esc(x)}</p>`).join('') || '<p class="muted small">Не заданы</p>'}`, { subtitle: 'Обновляется отдельно от истории чата' })}
        <div style="height:16px"></div>
        ${card('Последние решения', `<div class="list">${p.recent_decisions.map(x => `<div class="list-item"><div class="body"><h4>${esc(x.summary)}</h4><p>${date(x.ts)} · ${esc(x.kind)}</p></div></div>`).join('') || '<p class="muted small">Пока нет решений</p>'}</div><button class="btn sm" id="add-decision">+ Зафиксировать решение</button>`)}
      </div>
    </div>`);
  const messages = document.getElementById('chat-messages'); messages.scrollTop = messages.scrollHeight;
  const ask = async (question) => {
    const form = document.getElementById('chat-form'); const button = form.querySelector('button');
    if (!question.trim()) return;
    button.disabled = true; button.textContent = 'Думаю…';
    try { const r = await api.post('/api/director/chat', { question }); toast(r.recovered ? 'Ответ провайдера в карантине; показан локальный анализ' : 'Ответ директора проверен', r.recovered ? 'info' : 'ok'); ctx.reload(); }
    catch (e) { toast(e.message, 'error'); button.disabled = false; button.textContent = 'Отправить'; }
  };
  document.getElementById('chat-form').onsubmit = e => { e.preventDefault(); ask(new FormData(e.target).get('question')); };
  ctx.root.querySelectorAll('[data-question]').forEach(b => b.onclick = () => ask(b.dataset.question));
  document.getElementById('archive-chat').onclick = async () => { const r = await api.post('/api/director/archive'); toast(`Архивировано: ${r.archived}`); ctx.reload(); };
  document.getElementById('edit-priorities').onclick = () => {
    const m = modal({ title: 'Приоритеты владельца', body: `<form id="priorities-form"><div class="field"><label>По одному приоритету на строку</label><textarea name="priorities" rows="6">${esc((p.priorities || []).join('\n'))}</textarea></div><button class="btn primary">Сохранить</button></form>` });
    m.body.querySelector('form').onsubmit = async e => { e.preventDefault(); try { await api.post('/api/director/state', { key: 'priorities', value: formData(e.target).priorities.split('\n').map(x => x.trim()).filter(Boolean) }); m.close(); ctx.reload(); } catch (err) { toast(err.message, 'error'); } };
  };
  document.getElementById('add-decision').onclick = () => {
    const m = modal({ title: 'Зафиксировать решение', body: `<form id="decision-form"><div class="field"><label>Тип</label><input name="kind" value="manual"></div><div class="field"><label>Решение</label><textarea name="summary" required></textarea></div><button class="btn primary">Сохранить</button></form>` });
    m.body.querySelector('form').onsubmit = async e => { e.preventDefault(); try { await api.post('/api/director/decisions', formData(e.target)); m.close(); toast('Решение сохранено'); ctx.reload(); } catch (err) { toast(err.message, 'error'); } };
  };
}

export async function proposals(ctx) {
  const status = ctx.state.proposalStatus || '';
  const d = await api.get(`/api/proposals${qs({ status })}`);
  ctx.set(`<div class="filters"><select id="proposal-status"><option value="">Все статусы</option>${['pending', 'approved', 'executed', 'rejected'].map(s => `<option ${status === s ? 'selected' : ''}>${s}</option>`).join('')}</select><span class="muted small">Approve и Execute — два отдельных подтверждения владельца. Fraud-кейсы исполняются только через ручной разбор.</span></div>
    <div class="grid two">${d.length ? d.map(p => `<section class="card"><div class="card-head"><div><h3>${esc(p.title)}</h3><p>${esc(p.zone)} · ${esc(p.kind)} · ${date(p.ts)}</p></div>${badge(p.status)}</div><div class="card-body"><p class="small">${esc(p.rationale || '')}</p><div class="tiny muted" style="margin:10px 0">Confidence: <b>${p.confidence}</b> · источник: ${esc(p.source)}</div><details><summary class="tiny muted">Payload</summary>${jsonBlock(p.payload)}</details>${p.review_note ? `<p class="notice small" style="margin-top:10px">${esc(p.review_note)}</p>` : ''}<div class="form-actions">${p.status === 'pending' ? `<button class="btn danger" data-review="reject" data-id="${p.id}">Отклонить</button><button class="btn primary" data-review="approve" data-id="${p.id}">Одобрить</button>` : ''}${p.status === 'approved' ? `<button class="btn primary" data-execute="${p.id}">Подтвердить и исполнить</button>` : ''}</div></div></section>`).join('') : empty('Нет предложений с таким статусом')}</div>`);
  document.getElementById('proposal-status').onchange = e => { ctx.state.proposalStatus = e.target.value; ctx.reload(); };
  ctx.root.querySelectorAll('[data-review]').forEach(b => b.onclick = () => {
    const decision = b.dataset.review;
    const m = modal({ title: decision === 'approve' ? 'Одобрить предложение' : 'Отклонить предложение', body: `<form><div class="field"><label>Комментарий владельца</label><textarea name="note" placeholder="Почему принято это решение?"></textarea></div><button class="btn ${decision === 'approve' ? 'primary' : 'danger'}">${decision === 'approve' ? 'Одобрить' : 'Отклонить'}</button></form>` });
    m.body.querySelector('form').onsubmit = async e => { e.preventDefault(); try { await api.post(`/api/proposals/${b.dataset.id}/review`, { decision, ...formData(e.target) }); m.close(); toast('Решение сохранено'); ctx.reload(); } catch (err) { toast(err.message, 'error'); } };
  });
  ctx.root.querySelectorAll('[data-execute]').forEach(b => b.onclick = async () => {
    if (!await confirmDialog('Исполнить предложение', 'Будет выполнено только разрешённое действие из whitelist. Операция попадёт в аудит.', { confirmText: 'Исполнить' })) return;
    try { await api.post(`/api/proposals/${b.dataset.execute}/execute`); toast('Действие исполнено и записано в аудит'); ctx.reload(); }
    catch (e) { toast(e.message, 'error', 7000); }
  });
}

export async function fraud(ctx) {
  const d = await api.get(`/api/fraud?range=${ctx.state.range}`);
  ctx.set(`<div class="kpis">${[
    { label: 'Открытые кейсы', value: d.totals.open }, { label: 'Подтверждено', value: d.totals.confirmed },
    { label: 'Ложные срабатывания', value: d.totals.false_positive }, { label: 'Игроки risk ≥ 0.7', value: d.totals.players_high_risk },
  ].map(kpi).join('')}</div>
    <div class="notice warn"><b>ИИ не банит игроков.</b> Сканер лишь рассчитывает риск и создаёт кейс. Блокировка доступна только после ручной проверки доказательств.</div>
    <div class="filters"><button class="btn primary" id="fraud-scan">Сканировать активных игроков</button><span class="muted small">Детерминированные сигналы: точность, тайминг, ночная активность, повторы маршрутов, скорость платежей, общие устройства.</span></div>
    ${card('Очередь кейсов', table([
      { label: 'Кейс / игрок', html: true, value: c => `<b class="mono">${shortId(c.id)}</b><div class="tiny muted">${esc(c.player_id)} · ${esc(c.display_name || '')}</div>` },
      { label: 'Risk', html: true, value: c => `<span class="risk"><i style="width:${c.risk_score * 100}%"></i></span><b>${c.risk_score}</b>` },
      { label: 'Причины', html: true, value: c => esc(c.reasons[0] || 'Требуется проверка') },
      { label: 'Статус', html: true, value: c => badge(c.status) }, { label: 'Создан', value: c => date(c.ts) },
      { label: '', html: true, value: c => `<button class="btn sm" data-case="${c.id}">Разобрать</button>` },
    ], d.cases))}
    <div style="height:16px"></div>
    ${card('Сигналы детектора', table([{ label: 'Сигнал', key: 'signal' }, { label: 'Записи', key: 'n', num: true }, { label: 'Среднее', value: s => fmt(s.avg_value, 3), num: true }], d.signals))}`);
  document.getElementById('fraud-scan').onclick = async e => { e.target.disabled = true; try { const r = await api.post('/api/fraud/scan'); toast(`Проверено: ${r.scanned}, создано кейсов: ${r.created}`); ctx.reload(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; } };
  ctx.root.querySelectorAll('[data-case]').forEach(b => b.onclick = () => showCase(b.dataset.case, ctx.reload));
}

async function showCase(id, reload) {
  try {
    const c = await api.get(`/api/fraud/cases/${id}`);
    const m = modal({ title: `Fraud-кейс ${shortId(c.id)} · risk ${c.risk_score}`, wide: true, body: `
      <div class="notice ${c.risk_score >= .7 ? 'danger' : 'warn'}">Игрок: <b>${esc(c.player_id)}</b> · регион ${esc(c.region)} · статус ${badge(c.status)}. Автоматических действий не выполнялось.</div>
      <div class="grid two">${card('Причины', `<ul class="docs">${c.reasons.map(r => `<li>${esc(r)}</li>`).join('') || '<li>Нет текстовых причин</li>'}</ul>${card('Сигналы', table([{ label: 'Сигнал', key: 'signal' }, { label: 'Значение', value: s => fmt(s.value, 3), num: true }], c.signals))}`)}${card('Последний ввод', table([{ label: 'Время', value: x => date(x.ts) }, { label: 'along', value: x => fmt(x.along, 1), num: true }, { label: 'across', value: x => fmt(x.across, 1), num: true }, { label: 'Δt', value: x => fmt(x.timing_error_ms, 1), num: true }, { label: 'Код', key: 'reject_code' }], c.recentInputs))}</div>
      <form id="review-case"><div class="field-row"><div class="field"><label>Решение</label><select name="status"><option value="open">Оставить открытым</option><option value="confirmed">Подтвердить фрод</option><option value="false_positive">Ложное срабатывание</option></select></div><div class="field"><label>Комментарий</label><input name="note" required placeholder="Проверены траектории и платежи"></div></div><label class="check"><input type="checkbox" name="ban"> Заблокировать игрока (только при «Подтвердить фрод»)</label><div class="form-actions"><button class="btn primary">Сохранить решение владельца</button></div></form>` });
    m.body.querySelector('#review-case').onsubmit = async e => {
      e.preventDefault(); const f = formData(e.target); const body = { status: f.status, note: f.note, ban: !!f.ban };
      if (body.ban && !await confirmDialog('Подтвердить блокировку', 'Игрок будет заблокирован по вашему ручному решению.', { danger: true })) return;
      try { await api.post(`/api/fraud/cases/${id}/review`, body); toast('Решение по кейсу сохранено'); m.close(); reload(); } catch (err) { toast(err.message, 'error'); }
    };
  } catch (e) { toast(e.message, 'error'); }
}

export async function lab(ctx) {
  const d = await api.get(`/api/lab?range=${ctx.state.range}`);
  const tab = ctx.state.labTab;
  ctx.set(`<div class="tabs">${[['tests', 'A/B-тесты'], ['runs', 'Прогоны calibrate / noise'], ['reports', 'Отчёты']].map(([id, label]) => `<button class="tab ${tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div><div id="lab-content"></div>`);
  const root = document.getElementById('lab-content');
  if (tab === 'tests') {
    root.innerHTML = `<div class="filters"><button class="btn primary" id="new-test">+ Новый A/B-тест</button><span class="muted small">Варианты MATCH_RULES фиксируются заранее. ИИ только анализирует результаты.</span></div>${card('Эксперименты', table([
      { label: 'Тест', html: true, value: t => `<b>${esc(t.name)}</b><div class="tiny muted">${esc(t.hypothesis)}</div>` },
      { label: 'Варианты', html: true, value: t => t.variants.map(v => badge('info', v.name)).join(' ') },
      { label: 'Статус', html: true, value: t => badge(t.status) }, { label: 'Победитель', key: 'winner' },
      { label: 'Старт', value: t => date(t.started_at) },
      { label: 'Действия', html: true, value: t => `<button class="btn sm" data-results="${t.id}">Результаты</button> <button class="btn sm" data-edit-test="${t.id}">Изменить</button>` },
    ], d.tests))}`;
    document.getElementById('new-test').onclick = () => testForm();
    root.querySelectorAll('[data-edit-test]').forEach(b => b.onclick = () => testForm(d.tests.find(t => t.id === b.dataset.editTest)));
    root.querySelectorAll('[data-results]').forEach(b => b.onclick = () => resultsModal(d.tests.find(t => t.id === b.dataset.results)));
  } else if (tab === 'runs') {
    root.innerHTML = card('Результаты тестовых прогонов', table([
      { label: 'Время', value: r => date(r.ts) }, { label: 'Тип', key: 'kind' }, { label: 'Источник', key: 'source' },
      { label: 'Результат', html: true, value: r => `<details><summary>Показать JSON</summary>${jsonBlock(r.payload)}</details>` },
    ], d.runs), { subtitle: 'Данные поступают через событие test_result из игрового CI/бэкенда' });
  } else {
    root.innerHTML = `<div class="filters"><button class="btn primary" id="new-report">+ Добавить отчёт</button></div><div class="grid two">${d.reports.map(r => card(r.title, `<p class="small">${esc(r.summary)}</p><div class="tiny muted" style="margin:10px 0">${esc(r.kind)} · ${esc(r.source)} · ${date(r.ts)}</div>${jsonBlock(r.payload)}`)).join('') || empty()}</div>`;
    document.getElementById('new-report').onclick = () => {
      const m = modal({ title: 'Новый Lab-отчёт', body: `<form id="report-form"><div class="field"><label>Название</label><input name="title" required></div><div class="field-row"><div class="field"><label>Тип</label><input name="kind" value="calibration"></div><div class="field"><label>Источник</label><input name="source" value="manual"></div></div><div class="field"><label>Вывод</label><textarea name="summary" required></textarea></div><button class="btn primary">Сохранить</button></form>` });
      m.body.querySelector('form').onsubmit = async e => { e.preventDefault(); try { await api.post('/api/lab/reports', formData(e.target)); m.close(); ctx.reload(); } catch (err) { toast(err.message, 'error'); } };
    };
  }
  ctx.root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { ctx.state.labTab = b.dataset.tab; ctx.reload(); });

  function testForm(t = {}) {
    const m = modal({ title: t.id ? 'Настроить A/B-тест' : 'Новый A/B-тест', body: `<form id="test-form"><div class="field"><label>Название</label><input name="name" required value="${esc(t.name || '')}"></div><div class="field"><label>Гипотеза</label><textarea name="hypothesis">${esc(t.hypothesis || '')}</textarea></div><div class="field"><label>Варианты через запятую</label><input name="variants" value="${esc((t.variants || []).map(v => v.name).join(', ') || 'A: control, B: variant')}"><span class="help">Правила вариантов задаются в игровом бэкенде; здесь фиксируется эксперимент.</span></div><div class="field-row"><div class="field"><label>Статус</label><select name="status">${['draft', 'running', 'paused', 'completed', 'cancelled'].map(s => `<option ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div><div class="field"><label>Победитель</label><input name="winner" value="${esc(t.winner || '')}" placeholder="A / B"></div></div><button class="btn primary">Сохранить</button></form>` });
    m.body.querySelector('form').onsubmit = async e => {
      e.preventDefault(); const f = formData(e.target);
      const body = { ...f, variants: f.variants.split(',').map((name, i) => ({ id: String.fromCharCode(65 + i), name: name.trim() })).filter(v => v.name) };
      try { await (t.id ? api.patch(`/api/lab/tests/${t.id}`, body) : api.post('/api/lab/tests', body)); m.close(); toast('Тест сохранён'); ctx.reload(); } catch (err) { toast(err.message, 'error'); }
    };
  }
  function resultsModal(t) {
    const rows = d.results.filter(r => r.test_id === t.id);
    const m = modal({ title: `Результаты: ${t.name}`, wide: true, body: `${table([{ label: 'Вариант', key: 'variant' }, { label: 'Метрика', key: 'metric' }, { label: 'Значение', value: r => fmt(r.value, 3), num: true }, { label: 'Сэмплы', key: 'sample_size', num: true }, { label: 'Время', value: r => date(r.ts) }], rows)}<form id="result-form" style="margin-top:18px"><h3>Добавить замер</h3><div class="field-row three"><div class="field"><label>Вариант</label><input name="variant" required value="A"></div><div class="field"><label>Метрика</label><input name="metric" required value="success_rate"></div><div class="field"><label>Значение</label><input name="value" type="number" step="any" required></div></div><div class="field"><label>Размер выборки</label><input name="sample_size" type="number" value="0"></div><button class="btn primary">Добавить</button></form>` });
    m.body.querySelector('#result-form').onsubmit = async e => { e.preventDefault(); try { await api.post('/api/lab/results', { ...formData(e.target), test_id: t.id }); m.close(); toast('Замер добавлен'); ctx.reload(); } catch (err) { toast(err.message, 'error'); } };
  }
}
