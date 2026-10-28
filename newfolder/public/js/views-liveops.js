import { api, qs } from './api.js';
import { esc, fmt, date, shortId, toast, modal, confirmDialog, badge, card, empty, table, formData } from './ui.js';

const NEWS_LABELS = { patch_notes: 'Patch notes', known_issues: 'Known issues', event: 'Ивент', announcement: 'Объявление' };
const TICKET_LABELS = { new: 'Новый', in_progress: 'В работе', resolved: 'Решён', closed: 'Закрыт' };

export async function liveops(ctx) {
  const [d, feed] = await Promise.all([api.get('/api/liveops'), api.get('/api/client/feed')]);
  const tab = ctx.state.liveopsTab;
  ctx.set(`<div class="tabs">${[['overview', 'Техработы и лента'], ['news', `Новости (${d.news.length})`], ['pushes', `Пуши (${d.pushes.length})`]].map(([id, label]) => `<button class="tab ${tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div><div id="liveops-content"></div>`);
  const root = document.getElementById('liveops-content');
  if (tab === 'overview') {
    root.innerHTML = `<div class="maintenance-banner"><div class="icon">🛠</div><div class="body"><h3>Режим техработ: ${d.maintenance.enabled ? '<span class="badge warn">ВКЛЮЧЁН</span>' : '<span class="badge good">выключен</span>'}</h3><p class="small muted">${esc(d.maintenance.text)} ${d.maintenance.eta ? `· ETA: ${esc(d.maintenance.eta)}` : ''}</p></div></div>
      <div class="grid two">
        ${card('Управление техработами', `<form id="maintenance-form"><label class="check"><input type="checkbox" name="enabled" ${d.maintenance.enabled ? 'checked' : ''}> Блокировать вход в матч (меню, профиль и новости доступны)</label><div class="field"><label>Текст баннера</label><textarea name="text" required>${esc(d.maintenance.text)}</textarea></div><div class="field"><label>ETA (опционально)</label><input name="eta" value="${esc(d.maintenance.eta)}" placeholder="20 минут"></div><button class="btn primary">Сохранить режим</button><p class="help" style="margin-top:10px">При смене статуса автоматически создаётся приоритетный пуш всем игрокам.</p></form>`)}
        ${card('Как видит клиент', `<h4>Приоритетная лента пушей</h4><div class="list">${feed.pushes.slice(0, 3).map(p => `<div class="list-item"><div class="body"><h4>⚠ ${esc(p.title)}</h4><p>${esc(p.body)}</p><div class="meta">${date(p.ts)} · важно · ${p.pinned ? 'закреплено' : 'история'}</div></div></div>`).join('') || '<p class="muted small">Пушей нет</p>'}</div><h4 style="margin-top:15px">Новости (отдельная лента)</h4><div class="list">${feed.news.slice(0, 3).map(n => `<div class="list-item"><div class="body"><h4>${esc(n.title)}</h4><p>${esc(NEWS_LABELS[n.category])} · ${date(n.published_at)}</p></div></div>`).join('') || '<p class="muted small">Новостей нет</p>'}</div>`, { subtitle: 'GET /api/client/feed' })}
      </div>`;
    document.getElementById('maintenance-form').onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.target);
      const enabled = f.has('enabled');
      if (!await confirmDialog(enabled ? 'Включить техработы' : 'Выключить техработы', `Статус изменится${enabled !== d.maintenance.enabled ? ' и будет автоматически отправлен пуш' : ''}.`, { danger: enabled })) return;
      try { await api.post('/api/maintenance', { enabled, text: f.get('text'), eta: f.get('eta') }); toast('Режим техработ сохранён'); ctx.reload(); } catch (err) { toast(err.message, 'error'); }
    };
  } else if (tab === 'news') {
    root.innerHTML = `<div class="filters"><button class="btn primary" id="new-news">+ Новая новость</button><span class="muted small">Пуши сюда не попадают. Публикация видна в клиентской ленте новостей.</span></div>${card('Новости', table([
      { label: 'Заголовок', html: true, value: n => `<b>${esc(n.title)}</b><div class="tiny muted">${esc(n.body.slice(0, 140))}</div>` },
      { label: 'Тип', value: n => NEWS_LABELS[n.category] || n.category }, { label: 'Статус', html: true, value: n => badge(n.status) },
      { label: 'Публикация', value: n => date(n.published_at) },
      { label: 'Действия', html: true, value: n => `<button class="btn sm" data-edit-news="${n.id}">Изменить</button> <button class="btn sm danger" data-delete-news="${n.id}">Удалить</button>` },
    ], d.news))}`;
    document.getElementById('new-news').onclick = () => newsForm();
    root.querySelectorAll('[data-edit-news]').forEach(b => b.onclick = () => newsForm(d.news.find(n => n.id === b.dataset.editNews)));
    root.querySelectorAll('[data-delete-news]').forEach(b => b.onclick = async () => { if (!await confirmDialog('Удалить новость', 'Запись исчезнет из клиентской ленты.', { danger: true })) return; try { await api.delete(`/api/news/${b.dataset.deleteNews}`); ctx.reload(); } catch (e) { toast(e.message, 'error'); } });
  } else {
    root.innerHTML = `<div class="notice warn">Пуши — только исключительные события. Они всегда важнее новостей, закрепляются сверху и остаются в истории после прочтения.</div><div class="filters"><button class="btn primary" id="new-push">+ Отправить пуш</button></div>${card('История пушей', table([
      { label: 'Важность', html: true, value: p => badge(p.level) }, { label: 'Сообщение', html: true, value: p => `<b>${esc(p.title)}</b><div class="tiny muted">${esc(p.body)}</div>` },
      { label: 'Сегмент', key: 'segment' }, { label: 'Каналы', value: p => p.channels.join(', ') }, { label: 'Тип', value: p => p.auto ? 'auto (maintenance)' : 'manual' },
      { label: 'Отправлен', value: p => date(p.sent_at) }, { label: 'Статус', html: true, value: p => badge(p.status) },
    ], d.pushes))}`;
    document.getElementById('new-push').onclick = () => pushForm();
  }
  ctx.root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { ctx.state.liveopsTab = b.dataset.tab; ctx.reload(); });

  function newsForm(n = {}) {
    const m = modal({ title: n.id ? 'Изменить новость' : 'Новая новость', body: `<form id="news-form"><div class="field"><label>Заголовок</label><input name="title" required value="${esc(n.title || '')}"></div><div class="field"><label>Текст</label><textarea name="body" rows="7" required>${esc(n.body || '')}</textarea></div><div class="field-row"><div class="field"><label>Категория</label><select name="category">${Object.entries(NEWS_LABELS).map(([k, v]) => `<option value="${k}" ${n.category === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="field"><label>Статус</label><select name="status"><option value="draft" ${n.status === 'draft' ? 'selected' : ''}>Черновик</option><option value="published" ${n.status === 'published' ? 'selected' : ''}>Опубликовано</option><option value="archived" ${n.status === 'archived' ? 'selected' : ''}>Архив</option></select></div></div><button class="btn primary">Сохранить</button></form>` });
    m.body.querySelector('form').onsubmit = async e => { e.preventDefault(); try { await (n.id ? api.patch(`/api/news/${n.id}`, formData(e.target)) : api.post('/api/news', formData(e.target))); m.close(); toast('Новость сохранена'); ctx.reload(); } catch (err) { toast(err.message, 'error'); } };
  }
  function pushForm() {
    const m = modal({ title: 'Отправить приоритетный пуш', body: `<form id="push-form"><div class="notice warn">Используйте только для аварий, восстановления работы и критичных объявлений.</div><div class="field"><label>Заголовок</label><input name="title" required></div><div class="field"><label>Текст</label><textarea name="body" required></textarea></div><div class="field-row"><div class="field"><label>Уровень</label><select name="level"><option value="critical">critical</option><option value="warning">warning</option><option value="info">info</option></select></div><div class="field"><label>Сегмент</label><select name="segment"><option value="all">Все игроки</option><option value="RU">RU</option><option value="EU">EU</option><option value="touch">Touch</option><option value="android">Android</option></select></div></div><label class="check"><input type="checkbox" checked disabled> In-app приоритетная лента</label><label class="check"><input type="checkbox" name="telegram" checked> Telegram-бот (если настроен)</label><button class="btn danger">Подтвердить отправку</button></form>` });
    m.body.querySelector('form').onsubmit = async e => { e.preventDefault(); const f = formData(e.target); try { await api.post('/api/pushes', { ...f, channels: ['in-app', ...(f.telegram ? ['telegram'] : [])] }); m.close(); toast('Пуш отправлен в приоритетную ленту'); ctx.reload(); } catch (err) { toast(err.message, 'error'); } };
  }
}

export async function tickets(ctx) {
  const status = ctx.state.ticketStatus || '';
  const d = await api.get(`/api/tickets${qs({ status })}`);
  ctx.set(`<div class="filters"><select id="ticket-status"><option value="">Все статусы</option>${Object.entries(TICKET_LABELS).map(([k, v]) => `<option value="${k}" ${status === k ? 'selected' : ''}>${v}</option>`).join('')}</select><button class="btn primary" id="new-ticket">+ Создать тикет</button><span class="muted small">Всплеск тикетов по теме создаёт сигнал Ops; ответы видны игроку.</span></div>
    ${card('Очередь поддержки', table([
      { label: 'ID', value: t => shortId(t.id) }, { label: 'Тема', html: true, value: t => `<b>${esc(t.subject)}</b><div class="tiny muted">${esc(t.body.slice(0, 130))}</div>` },
      { label: 'Игрок', value: t => t.player_id || '—' }, { label: 'Приоритет', html: true, value: t => badge(t.priority) },
      { label: 'Статус', html: true, value: t => badge(t.status, TICKET_LABELS[t.status]) }, { label: 'Обновлён', value: t => date(t.updated_at) },
      { label: '', html: true, value: t => `<button class="btn sm" data-ticket="${t.id}">Открыть (${t.messages})</button>` },
    ], d))}`);
  document.getElementById('ticket-status').onchange = e => { ctx.state.ticketStatus = e.target.value; ctx.reload(); };
  ctx.root.querySelectorAll('[data-ticket]').forEach(b => b.onclick = () => showTicket(b.dataset.ticket, ctx.reload));
  document.getElementById('new-ticket').onclick = () => {
    const m = modal({ title: 'Создать тикет', body: `<form><div class="field"><label>Player ID</label><input name="player_id"></div><div class="field"><label>Тема</label><input name="subject" required></div><div class="field"><label>Текст</label><textarea name="body" required></textarea></div><div class="field"><label>Приоритет</label><select name="priority"><option>normal</option><option>high</option><option>critical</option><option>low</option></select></div><button class="btn primary">Создать</button></form>` });
    m.body.querySelector('form').onsubmit = async e => { e.preventDefault(); try { await api.post('/api/tickets', formData(e.target)); m.close(); ctx.reload(); } catch (err) { toast(err.message, 'error'); } };
  };
}

async function showTicket(id, reload) {
  try {
    const t = await api.get(`/api/tickets/${id}`);
    const m = modal({ title: `${t.subject} · ${shortId(t.id)}`, wide: true, body: `<div class="notice">Игрок: <b>${esc(t.player_id || '—')}</b> · регион ${esc(t.region)} · build ${esc(t.build_version || '—')} · ${badge(t.status, TICKET_LABELS[t.status])}</div><div class="list">${t.messages.map(x => `<div class="list-item"><div class="body"><h4>${esc(x.author_role === 'support' ? 'Поддержка' : 'Игрок')} · ${esc(x.author || '')} ${!x.visible_to_player ? badge('draft', 'internal') : ''}</h4><p style="white-space:pre-wrap">${esc(x.body)}</p><div class="meta">${date(x.ts)}</div></div></div>`).join('')}</div><form id="ticket-reply" style="margin-top:18px"><div class="field-row"><div class="field"><label>Статус</label><select name="status">${Object.entries(TICKET_LABELS).map(([k, v]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="field"><label>Приоритет</label><select name="priority">${['low', 'normal', 'high', 'critical'].map(x => `<option ${t.priority === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div><div class="field"><label>Ответ игроку</label><textarea name="reply" placeholder="Текст ответа поддержки"></textarea></div><label class="check"><input type="checkbox" name="internal"> Внутренняя заметка (не показывать игроку)</label><button class="btn primary">Сохранить и ответить</button></form>` });
    m.body.querySelector('#ticket-reply').onsubmit = async e => { e.preventDefault(); const f = formData(e.target); try { await api.patch(`/api/tickets/${id}`, { ...f, internal: !!f.internal }); m.close(); toast('Тикет обновлён'); reload(); } catch (err) { toast(err.message, 'error'); } };
  } catch (e) { toast(e.message, 'error'); }
}

export async function content(ctx) {
  const d = await api.get('/api/content');
  const groups = ['idea', 'planned', 'in_progress', 'released', 'cancelled'];
  ctx.set(`<div class="filters"><button class="btn primary" id="new-content">+ Добавить элемент</button><span class="muted small">Ритм LiveOps: day-1 patch, week-1 hotfix, обновление контента каждые 4–6 недель.</span></div>
    ${card('Контент-план на 6–12 месяцев', table([
      { label: 'Элемент', html: true, value: x => `<b>${esc(x.title)}</b><div class="tiny muted">${esc(x.notes || '')}</div>` },
      { label: 'Тип', key: 'kind' }, { label: 'Статус', html: true, value: x => badge(x.status) },
      { label: 'Дата', key: 'target_date' }, { label: 'Owner', key: 'owner' },
      { label: 'Действия', html: true, value: x => `<button class="btn sm" data-edit="${x.id}">Изменить</button> <button class="btn sm danger" data-delete="${x.id}">×</button>` },
    ], d))}`);
  const form = (x = {}) => {
    const m = modal({ title: x.id ? 'Изменить элемент плана' : 'Новый элемент плана', body: `<form><div class="field"><label>Название</label><input name="title" required value="${esc(x.title || '')}"></div><div class="field-row"><div class="field"><label>Тип</label><select name="kind">${['patch', 'hotfix', 'content', 'event', 'feature', 'tech'].map(k => `<option ${x.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div><div class="field"><label>Статус</label><select name="status">${groups.map(s => `<option ${x.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div><div class="field"><label>Целевая дата</label><input name="target_date" type="date" value="${esc(x.target_date || '')}"></div><div class="field"><label>Заметки</label><textarea name="notes">${esc(x.notes || '')}</textarea></div><button class="btn primary">Сохранить</button></form>` });
    m.body.querySelector('form').onsubmit = async e => { e.preventDefault(); try { await (x.id ? api.patch(`/api/content/${x.id}`, formData(e.target)) : api.post('/api/content', formData(e.target))); m.close(); ctx.reload(); } catch (err) { toast(err.message, 'error'); } };
  };
  document.getElementById('new-content').onclick = () => form();
  ctx.root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => form(d.find(x => x.id === b.dataset.edit)));
  ctx.root.querySelectorAll('[data-delete]').forEach(b => b.onclick = async () => { if (!await confirmDialog('Удалить элемент', 'Удалить элемент контент-плана?', { danger: true })) return; try { await api.delete(`/api/content/${b.dataset.delete}`); ctx.reload(); } catch (e) { toast(e.message, 'error'); } });
}
