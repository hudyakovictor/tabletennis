import { api, downloadFile } from '../core/api.js';
import { esc, num, timeAgo, dateTime, truncate, statusLabel, countdown } from '../core/format.js';
import {
  qs, qsa, kpi, card, table, statusBadge, skeleton, emptyState, openDrawer,
  confirmDialog, toast, toastError, run,
} from '../core/ui.js';
import { icon } from '../core/icons.js';
import { can } from '../core/store.js';

const TABS = [
  ['tickets', 'Тикеты'],
  ['news', 'Новости'],
  ['pushes', 'Пуши'],
  ['maintenance', 'Техработы'],
  ['feedback', 'Фидбек'],
];

const TICKET_STATUSES = ['open', 'in_progress', 'answered', 'closed'];

export async function render(container, ctx) {
  const tab = ctx.query.tab || 'tickets';
  if (!container.dataset.loaded) container.innerHTML = skeleton('page');
  const data = await api.get('/api/admin/liveops');
  if (ctx.isStale()) return;
  container.dataset.loaded = '1';
  container._data = data;

  const maint = data.maintenance || {};
  const sla = data.ticketSla || {};
  const tickets = data.tickets || [];
  const news = data.news || [];
  const pushes = data.pushes || [];

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h2>LiveOps</h2>
        <p>Техработы с 503 и баннером в клиенте, пуши поверх ленты новостей, новости, тикеты со SLA и скриншотами, детекция шторма обращений.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-sm btn-outline" id="export-tickets">${icon('download')} CSV тикетов</button>
        ${can('liveops:maintenance') ? `<button class="btn btn-sm ${maint.enabled ? 'btn-danger' : 'btn-outline'}" id="toggle-maint">${icon('wrench')} ${maint.enabled ? 'Завершить техработы' : 'Включить техработы'}</button>` : ''}
      </div>
    </div>

    ${maint.enabled ? `<div class="maintenance-banner">
        <span class="status-dot warning"></span>
        <div class="grow"><strong>Техработы активны.</strong> Новые матчи получают HTTP 503 с <code>Retry-After</code>; активные партии доигрываются (${num(maint.allowActiveMatchesFinishGraceSec || 0)} с).
          ${maint.bannerRu ? `Баннер: «${esc(maint.bannerRu)}»` : ''}
          ${maint.etaIso ? `· ETA ${esc(dateTime(maint.etaIso))}` : ''}</div>
      </div>` : ''}

    ${sla.stormDetected ? `<div class="alert alert-danger mb-16">${icon('alert')}
        <div><strong>Шторм обращений:</strong> ${num(sla.recentCount)} тикетов за ${num(sla.stormWindowMinutes)} мин от ${num(sla.uniquePlayers)} игроков (порог ${num(sla.stormThreshold)}).
        Эскалация в Telegram отправляется автоматически — стоит проверить релиз и, если нужно, включить техработы.</div></div>` : ''}

    <div class="grid grid-4 mb-16">
      ${kpi({ label: 'Открытых тикетов', value: num(sla.open || 0), sub: `${num(sla.awaitingFirstResponse || 0)} без первого ответа` })}
      ${kpi({ label: 'Просрочено по SLA', value: num(sla.overdue || 0), sub: `цель ${num(sla.targetFirstResponseMin || 30)} мин / ${num(sla.targetResolutionHours || 24)} ч` })}
      ${kpi({ label: 'Средний первый ответ', value: `${num(sla.avgFirstResponseMin || 0, 0)}<small>мин</small>`, sub: `закрыто за сутки: ${num(sla.closedToday || 0)}` })}
      ${kpi({ label: 'Публикаций', value: num(news.length + pushes.length), sub: `${num(pushes.length)} пушей · ${num(news.length)} новостей` })}
    </div>

    <div class="tabs mb-16">
      ${TABS.map(([v, l]) => `<button type="button" class="tab ${tab === v ? 'active' : ''}" data-tab="${v}">${l}${v === 'tickets' && tickets.length ? ` · ${tickets.length}` : ''}</button>`).join('')}
    </div>
    <div id="tab-body">${renderTab(tab, data, sla)}</div>
  `;

  qsa('[data-tab]', container).forEach((btn) => btn.addEventListener('click', () => {
    ctx.setQuery('tab', btn.dataset.tab);
    ctx.refresh();
  }));

  qs('#export-tickets', container).addEventListener('click', () => {
    downloadFile('/api/admin/exports/tickets.csv', `topspin-tickets-${new Date().toISOString().slice(0, 10)}.csv`);
  });

  qs('#toggle-maint', container)?.addEventListener('click', async () => {
    if (maint.enabled) {
      const ok = await confirmDialog({ title: 'Завершить техработы?', text: 'Новые матчи снова будут приниматься, баннер в клиенте исчезнет.', confirmLabel: 'Завершить' });
      if (!ok) return;
      try {
        await api.post('/api/admin/maintenance', { enabled: false }, { idempotencyKey: `maint-off-${Date.now()}` });
        toast('Техработы завершены', { type: 'success' });
        ctx.refresh();
      } catch (err) { toastError(err); }
    } else {
      openMaintDialog(ctx);
    }
  });

  bindTab(container, ctx, data);
  if (ctx.query.ticket) openTicket(ctx.query.ticket, ctx);
}

function renderTab(tab, data, sla) {
  if (tab === 'news') return newsTab(data.news || []);
  if (tab === 'pushes') return pushesTab(data.pushes || []);
  if (tab === 'maintenance') return maintTab(data.maintenance || {}, data.calendar || []);
  if (tab === 'feedback') return feedbackTab(data.feedback || [], data.patches || []);
  return ticketsTab(data.tickets || [], sla);
}

function ticketRowStatus(t) {
  if (t.status === 'closed') return '<span class="dim">закрыт</span>';
  const due = t.sla_due_at ? new Date(t.sla_due_at).getTime() : null;
  if (due && due < Date.now()) return '<span class="badge badge-danger">просрочен</span>';
  if (t.first_response_at) return '<span class="badge badge-ok">ответ дан</span>';
  if (due) return `<span class="badge badge-warn">до ${esc(countdown(t.sla_due_at))}</span>`;
  return '<span class="badge badge-warn">ждёт ответа</span>';
}

function ticketsTab(tickets, sla) {
  return `<section class="card">
      <div class="card-head">
        <div><h3>Обращения</h3><div class="dim">Первый ответ — ${num(sla.targetFirstResponseMin || 30)} мин, решение — ${num(sla.targetResolutionHours || 24)} ч. Скриншот клиента приходит вместе с контекстом сессии.</div></div>
        <span class="badge badge-neutral">${num(tickets.length)}</span>
      </div>
      <div class="card-body flush">
        ${tickets.length ? table({
          rows: tickets,
          rowKey: 'id',
          onRow: true,
          columns: [
            { label: 'Тема', render: (r) => `<div class="list-title">${esc(truncate(r.subject, 70))}</div>
              <div class="list-sub">${esc(r.player_id)} · ${esc(r.category)} · ${esc(r.region)}${r.screenshot_meta_json ? ' · 📎' : ''}</div>` },
            { label: 'Приоритет', render: (r) => statusBadge(r.priority === 'critical' ? 'danger' : r.priority === 'high' ? 'warning' : 'neutral', r.priority) },
            { label: 'Статус', render: (r) => statusBadge(r.status === 'closed' ? 'neutral' : r.status === 'answered' ? 'ok' : 'info', statusLabel(r.status)) },
            { label: 'SLA', render: (r) => ticketRowStatus(r) },
            { label: 'Создан', align: 'right', render: (r) => `<span class="dim">${esc(timeAgo(r.created_at))}</span>` },
            { label: '', align: 'right', render: (r) => `<button class="btn btn-sm btn-outline" data-ticket="${esc(r.id)}">Открыть</button>` },
          ],
        }) : emptyState({ iconName: 'inbox', title: 'Обращений нет', text: 'Игроки ещё не писали в поддержку.' })}
      </div>
    </section>`;
}

function newsTab(news) {
  return `<section class="card">
      <div class="card-head"><div><h3>Новости</h3><div class="dim">Публикация видна в клиенте сразу после сохранения; ИИ не публикует сам</div></div>
        <button class="btn btn-sm btn-primary" data-new-news>${icon('plus')} Новая новость</button></div>
      <div class="card-body flush">
        ${news.length ? news.map((n) => `<div class="list-row">
            <span class="status-dot ${n.published ? 'ok' : 'info'}"></span>
            <div class="list-main">
              <span class="list-title">${esc(n.title_ru)}</span>
              <span class="list-sub">${esc(n.category)} · ${esc(n.published ? `опубликовано ${dateTime(n.created_at)}` : `черновик от ${dateTime(n.created_at)}`)} · <code>${esc(n.id)}</code></span>
            </div>
            ${n.published ? '<span class="badge badge-ok">в ленте</span>' : '<span class="badge badge-neutral">черновик</span>'}
            <button class="btn btn-sm btn-ghost" data-edit-news="${esc(n.id)}">Изменить</button>
          </div>`).join('') : emptyState({ iconName: 'news', title: 'Новостей нет', text: 'Опубликуйте первую новость для клиента.' })}
      </div>
    </section>`;
}

function pushesTab(pushes) {
  return `<section class="card">
      <div class="card-head"><div><h3>Пуши</h3><div class="dim">Пуш показывается выше ленты новостей; игрок может закрыть его навсегда</div></div>
        <button class="btn btn-sm btn-primary" data-new-push>${icon('zap')} Новый пуш</button></div>
      <div class="card-body flush">
        ${pushes.length ? pushes.map((p) => `<div class="list-row">
            <span class="status-dot ${p.priority === 'critical' ? 'critical' : 'ok'}"></span>
            <div class="list-main"><span class="list-title">${esc(p.title_ru)}</span>
              <span class="list-sub">${esc(truncate(p.body_ru, 94))} · ${esc(timeAgo(p.created_at))}</span></div>
            ${p.pinned ? '<span class="badge badge-brand">закреплён</span>' : ''}
            <span class="badge badge-neutral">${esc(p.segment)}</span>
            <span class="dim">${num(p.sent_count)} получателей</span>
          </div>`).join('') : emptyState({ iconName: 'zap', title: 'Пушей нет', text: 'Пуш помогает сообщить об акции или техработах.' })}
      </div>
    </section>`;
}

function maintTab(maint, calendar) {
  return `<div class="grid grid-12">
      <section class="card col-6">
        <div class="card-head"><h3>Текущее состояние</h3></div>
        <div class="card-body stack">
          <div class="row-between"><span class="muted">Режим</span>${statusBadge(maint.enabled ? 'warning' : 'ok', maint.enabled ? 'включён' : 'выключен')}</div>
          <div class="row-between"><span class="muted">Блокировка новых матчей</span><strong>${maint.blockNewMatchesHttp503 ? 'HTTP 503' : 'выключена'}</strong></div>
          <div class="row-between"><span class="muted">Доигрывание партий</span><strong>${num(maint.allowActiveMatchesFinishGraceSec || 0)} с</strong></div>
          <div class="row-between"><span class="muted">Баннер RU</span><span class="truncate" style="max-width:60%">${esc(maint.bannerRu || '—')}</span></div>
          <div class="row-between"><span class="muted">Баннер EN</span><span class="truncate" style="max-width:60%">${esc(maint.bannerEn || '—')}</span></div>
          <div class="row-between"><span class="muted">ETA</span><span>${esc(maint.etaIso ? dateTime(maint.etaIso) : '—')}</span></div>
          <div class="row-between"><span class="muted">Обновлено</span><span class="dim">${esc(timeAgo(maint.updatedAt))}</span></div>
          <div class="alert alert-info">${icon('clock')} Клиент получает признак maintenance в handshake и показывает баннер с ETA вместо экрана матча.</div>
        </div>
      </section>
      <section class="card col-6">
        <div class="card-head"><h3>Календарь LiveOps</h3><span class="dim">${num(calendar.length)} событий</span></div>
        <div class="card-body flush">
          ${calendar.length ? calendar.slice(0, 8).map((e) => `<div class="list-row">
              <span class="status-dot info"></span>
              <div class="list-main"><span class="list-title">${esc(e.title || e.name || e.kind || 'событие')}</span>
              <span class="list-sub">${esc(e.kind || e.type || '')} · ${esc(e.starts_at ? dateTime(e.starts_at) : '')}${e.ends_at ? ` → ${esc(dateTime(e.ends_at))}` : ''}</span></div>
            </div>`).join('') : emptyState({ title: 'Событий нет', text: 'Турниры и сезоны появятся здесь.' })}
        </div>
      </section>
    </div>`;
}

function feedbackTab(feedback, patches) {
  return `<div class="grid grid-12">
      <section class="card col-7">
        <div class="card-head"><div><h3>Фидбек игроков</h3><div class="dim">Голоса и приоритет — вход в план патчей, но не автоматическое действие</div></div></div>
        <div class="card-body flush">
          ${feedback.length ? feedback.map((f) => `<div class="list-row">
              <span class="badge badge-neutral">${num(f.votes)}</span>
              <div class="list-main"><span class="list-title">${esc(f.summary)}</span>
              <span class="list-sub">${esc(f.category)} · ${esc(f.stage)} · score ${num(f.priority_score)}</span></div>
              <span class="badge badge-brand">${esc(f.stage)}</span>
            </div>`).join('') : emptyState({ title: 'Фидбека нет' })}
        </div>
      </section>
      <section class="card col-5">
        <div class="card-head"><h3>Пайплайн патчей</h3></div>
        <div class="card-body flush">
          ${patches.length ? patches.map((p) => `<div class="list-row">
              <span class="status-dot ${p.status === 'released' ? 'ok' : p.status === 'blocked' ? 'critical' : 'warning'}"></span>
              <div class="list-main"><span class="list-title">${esc(p.title || p.version || p.id)}</span>
              <span class="list-sub">${esc(p.status)} · ${esc(p.channel || 'all')}</span></div>
            </div>`).join('') : emptyState({ title: 'Патчей нет' })}
        </div>
      </section>
    </div>`;
}

function openMaintDialog(ctx) {
  openDrawer({
    title: 'Включить техработы',
    eyebrow: 'HTTP 503 + баннер в клиенте',
    body: `<form class="stack" id="maint-form">
        <label class="field"><span class="field-label">Баннер для игроков (RU)</span>
          <textarea name="bannerRu" required placeholder="Обновляем серверы — вернёмся через 15 минут"></textarea></label>
        <label class="field"><span class="field-label">Баннер (EN)</span>
          <input name="bannerEn" placeholder="We are updating servers — back in 15 minutes" /></label>
        <label class="field"><span class="field-label">ETA</span><input name="eta" type="datetime-local" /></label>
        <label class="field"><span class="field-label">Доигрывание активных партий, сек</span><input name="grace" type="number" min="0" max="900" value="180" /></label>
        <div class="alert alert-warn">${icon('alert')} Новые матчи получат 503 с Retry-After. Действие фиксируется в аудите и уходит в Telegram.</div>
      </form>`,
    actions: [
      { label: 'Отмена', variant: 'btn-ghost' },
      {
        label: 'Включить',
        variant: 'btn-danger',
        close: false,
        onClick: async ({ close }) => {
          const fd = new FormData(qs('#maint-form'));
          if (!String(fd.get('bannerRu') || '').trim()) { toast('Баннер обязателен', { type: 'warn' }); return; }
          try {
            await api.post('/api/admin/maintenance', {
              enabled: true,
              bannerRu: fd.get('bannerRu'),
              bannerEn: fd.get('bannerEn'),
              etaIso: fd.get('eta') ? new Date(fd.get('eta')).toISOString() : null,
              allowActiveMatchesFinishGraceSec: Number(fd.get('grace')) || 180,
            }, { idempotencyKey: `maint-on-${Date.now()}` });
            toast('Техработы включены', { type: 'success' });
            close();
            ctx.refresh();
          } catch (err) { toastError(err); }
        },
      },
    ],
  });
}

function bindTab(container, ctx, data) {
  run(container, '[data-ticket]', (node) => openTicket(node.dataset.ticket, ctx));
  run(container, 'tbody tr[data-key]', (node) => openTicket(node.dataset.key, ctx));
  run(container, '[data-edit-news]', (node) => openNewsDialog(ctx, (data.news || []).find((n) => n.id === node.dataset.editNews)));

  qs('[data-new-news]', container)?.addEventListener('click', () => openNewsDialog(ctx));

  qs('[data-new-push]', container)?.addEventListener('click', () => {
    openDrawer({
      title: 'Новый пуш',
      eyebrow: 'выше ленты новостей',
      body: `<form class="stack" id="push-form">
          <label class="field"><span class="field-label">Заголовок (RU)</span><input name="titleRu" required maxlength="140" /></label>
          <label class="field"><span class="field-label">Текст (RU)</span><textarea name="bodyRu" required maxlength="1000"></textarea></label>
          <div class="field-row">
            <label class="field"><span class="field-label">Сегмент</span>
              <select name="segment"><option value="all">все</option><option value="new_players">новички</option><option value="payers">платящие</option><option value="churn_risk">риск оттока</option></select></label>
            <label class="field"><span class="field-label">Приоритет</span>
              <select name="priority"><option value="normal">обычный</option><option value="important" selected>важный</option><option value="critical">критический</option></select></label>
          </div>
          <label class="field row" style="gap:8px"><input type="checkbox" name="pinned" checked /> <span>Закрепить над лентой</span></label>
          <label class="field"><span class="field-label">Истекает</span><input type="datetime-local" name="expiresAt" /></label>
        </form>`,
      actions: [
        { label: 'Отмена', variant: 'btn-ghost' },
        {
          label: 'Опубликовать',
          variant: 'btn-primary',
          close: false,
          onClick: async ({ close }) => {
            const form = qs('#push-form');
            const fd = new FormData(form);
            try {
              await api.post('/api/admin/pushes', {
                titleRu: fd.get('titleRu'),
                bodyRu: fd.get('bodyRu'),
                segment: fd.get('segment'),
                priority: fd.get('priority'),
                pinned: fd.get('pinned') === 'on',
                expiresAt: fd.get('expiresAt') ? new Date(fd.get('expiresAt')).toISOString() : null,
              }, { idempotencyKey: `push-${Date.now()}` });
              toast('Пуш опубликован', { type: 'success' });
              close();
              ctx.refresh();
            } catch (err) { toastError(err); }
          },
        },
      ],
    });
  });
}

function openNewsDialog(ctx, news = null) {
  openDrawer({
    title: news ? 'Изменить новость' : 'Новая новость',
    eyebrow: 'публикация в клиенте',
    body: `<form class="stack" id="news-form">
        <label class="field"><span class="field-label">Заголовок (RU)</span><input name="titleRu" required maxlength="160" value="${esc(news?.title_ru || '')}" /></label>
        <label class="field"><span class="field-label">Текст (RU)</span><textarea name="bodyRu" required>${esc(news?.body_ru || '')}</textarea></label>
        <label class="field"><span class="field-label">Заголовок (EN)</span><input name="titleEn" value="${esc(news?.title_en || '')}" /></label>
        <label class="field"><span class="field-label">Текст (EN)</span><textarea name="bodyEn">${esc(news?.body_en || '')}</textarea></label>
        <div class="field-row">
          <label class="field"><span class="field-label">Категория</span>
            <select name="category">${['update', 'tournament', 'balance', 'maintenance', 'promo'].map((c) => `<option value="${c}" ${news?.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label class="field"><span class="field-label">Публикация</span>
            <select name="published"><option value="1" ${news?.published !== 0 ? 'selected' : ''}>опубликовать</option><option value="0" ${news?.published === 0 ? 'selected' : ''}>черновик</option></select></label>
        </div>
      </form>`,
    actions: [
      { label: 'Отмена', variant: 'btn-ghost' },
      {
        label: news ? 'Сохранить' : 'Опубликовать',
        variant: 'btn-primary',
        close: false,
        onClick: async ({ close }) => {
          const fd = new FormData(qs('#news-form'));
          const payload = {
            titleRu: fd.get('titleRu'), bodyRu: fd.get('bodyRu'),
            titleEn: fd.get('titleEn'), bodyEn: fd.get('bodyEn'),
            category: fd.get('category'), published: fd.get('published') === '1',
          };
          if (!String(payload.titleRu || '').trim()) { toast('Заголовок обязателен', { type: 'warn' }); return; }
          try {
            if (news) await api.patch(`/api/admin/news/${news.id}`, payload);
            else await api.post('/api/admin/news', payload, { idempotencyKey: `news-${Date.now()}` });
            toast(news ? 'Новость обновлена' : 'Новость опубликована', { type: 'success' });
            close();
            ctx.refresh();
          } catch (err) { toastError(err); }
        },
      },
    ],
  });
}

async function openTicket(id, ctx) {
  try {
    const t = await api.get(`/api/admin/tickets/${encodeURIComponent(id)}`);
    const messages = t.messages || [];
    const shot = t.screenshotMeta || {};
    const context = t.clientContext || {};

    openDrawer({
      title: t.subject,
      eyebrow: `${t.category} · ${t.priority} · ${t.status}`,
      wide: true,
      body: `<div class="stack">
          <div class="row wrap">
            ${statusBadge(t.status === 'closed' ? 'neutral' : t.status === 'answered' ? 'ok' : 'info', statusLabel(t.status))}
            ${statusBadge(t.priority === 'critical' ? 'danger' : t.priority === 'high' ? 'warning' : 'neutral', t.priority)}
            <span class="badge badge-neutral">${esc(t.player_id)}</span>
            <span class="badge badge-neutral">${esc(t.region)}</span>
            ${t.first_response_at ? `<span class="badge badge-ok">первый ответ за ${num(t.first_response_minutes)} мин</span>` : '<span class="badge badge-warn">ждёт первого ответа</span>'}
            <span class="dim">создан ${esc(dateTime(t.created_at))}</span>
          </div>
          <div class="kv-grid">
            <dl class="kv">
              <dt>Платформа</dt><dd>${esc(context.platform || '—')}</dd>
              <dt>RTT</dt><dd>${context.rttMs ? `${num(context.rttMs)} мс` : '—'}</dd>
              <dt>Хват / рука</dt><dd>${esc(context.grip || '—')} / ${esc(context.hand === 'left' ? 'левша' : context.hand || '—')}</dd>
            </dl>
            <dl class="kv">
              <dt>Сессия</dt><dd><code>${esc(t.session_id || '—')}</code></dd>
              <dt>Правила</dt><dd>v${esc(context.rulesVersion ?? '—')}</dd>
              <dt>Инцидент</dt><dd>${t.linked_incident_id ? `<code>${esc(t.linked_incident_id)}</code>` : '—'}</dd>
            </dl>
          </div>
          ${shot.previewDataUrl
            ? `<img src="${esc(shot.previewDataUrl)}" alt="Скриншот игрока" class="ticket-shot" />`
            : shot.name
              ? `<div class="callout">${icon('file')} Вложение: <code>${esc(shot.name)}</code> · ${num(shot.sizeChars)} симв.</div>`
              : ''}
          <div class="chat" style="border:1px solid var(--line);border-radius:14px">
            <div class="chat-scroll" style="max-height:300px">
              ${messages.length ? messages.map((m) => `<div class="msg ${m.sender_role === 'player' ? 'msg-player' : 'msg-owner'}">
                  <div class="msg-bubble">${esc(m.body)}</div>
                  <div class="msg-meta">${esc(m.sender_role === 'player' ? m.sender_name : 'Поддержка')} · ${esc(timeAgo(m.created_at))}</div>
                </div>`).join('') : '<div class="dim" style="padding:14px">Сообщений нет</div>'}
            </div>
          </div>
          <div class="field-row">
            <label class="field"><span class="field-label">Статус</span>
              <select id="ticket-status">${TICKET_STATUSES.map((s) => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}</select></label>
            <label class="field"><span class="field-label">Приоритет</span>
              <select id="ticket-priority">${['low', 'normal', 'high', 'critical'].map((s) => `<option value="${s}" ${t.priority === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          </div>
          <label class="field"><span class="field-label">Ответ игроку</span>
            <textarea id="ticket-reply" placeholder="Проверили матч — результат скорректирован, монеты начислены"></textarea>
            <span class="field-hint">Ответ уходит игроку в клиент, печатается от лица поддержки и обязательно фиксируется в истории тикета.</span></label>
          <div class="field-label">История статусов</div>
          <div class="timeline">${(t.statusHistory || []).map((h) => `<div class="timeline-item">
              <span class="timeline-dot"></span>
              <div><div class="timeline-title">${esc(statusLabel(h.to_status))}</div>
              <div class="timeline-meta">${esc(h.actor)} · ${esc(dateTime(h.created_at))}${h.note ? ` · ${esc(h.note)}` : ''}</div></div>
            </div>`).join('') || '<span class="dim">—</span>'}</div>
        </div>`,
      actions: [
        { label: 'Закрыть', variant: 'btn-ghost' },
        {
          label: 'Сменить статус',
          variant: 'btn-outline',
          close: false,
          onClick: async () => {
            const status = qs('#ticket-status').value;
            if (status === t.status) { toast('Статус не изменился', { type: 'warn' }); return; }
            try {
              await api.post(`/api/admin/tickets/${id}/status`, { status }, { idempotencyKey: `ticket-status-${id}-${status}` });
              toast('Статус обновлён', { type: 'success' });
              ctx.refresh();
            } catch (err) { toastError(err); }
          },
        },
        {
          label: 'Отправить ответ',
          variant: 'btn-primary',
          close: false,
          onClick: async ({ close }) => {
            const body = qs('#ticket-reply').value.trim();
            const status = qs('#ticket-status').value;
            if (body.length < 2) { toast('Введите текст ответа', { type: 'warn' }); return; }
            try {
              await api.post(`/api/admin/tickets/${id}/reply`, { body, status: status === 'open' ? 'answered' : status }, { idempotencyKey: `ticket-reply-${id}-${Date.now()}` });
              toast('Ответ отправлен', { type: 'success' });
              close();
              ctx.refresh();
            } catch (err) { toastError(err); }
          },
        },
      ],
    });
  } catch (err) { toastError(err); }
}
