import { api, downloadFile } from '../core/api.js';
import { esc, num, pct, money, timeAgo, dateTime, debounce, statusLabel, ms, compact } from '../core/format.js';
import {
  qs, qsa, kpi, card, table, statusBadge, skeleton, emptyState, openDrawer, pager,
  bindPager, bindRowClicks, promptDialog, confirmDialog, toast, toastError, run,
} from '../core/ui.js';
import { icon } from '../core/icons.js';
import { can } from '../core/store.js';

const STATUSES = [
  ['all', 'Все'], ['active', 'Активные'], ['suspended', 'Заморожены'],
  ['banned', 'Забанены'], ['deleted', 'Удалены'],
];

const SOURCE_LABELS = {
  organic_tma: 'органика TMA', telegram_ads: 'Telegram Ads', referral: 'реферал', influencer: 'инфлюенсер',
};

export async function render(container, ctx) {
  const page = Number(ctx.query.page || 1);
  const status = ctx.query.status || 'all';
  const q = ctx.query.q || '';
  const sort = ctx.query.sort || 'created_at';
  const region = ctx.query.region || '';

  if (!container.dataset.loaded) container.innerHTML = skeleton('page');
  const url = `/api/admin/players?page=${page}&pageSize=20&status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}&sort=${encodeURIComponent(sort)}${region ? `&region=${encodeURIComponent(region)}` : ''}`;
  const data = await api.get(url);
  if (ctx.isStale()) return;
  container.dataset.loaded = '1';
  container._data = data;

  const counts = data.statusCounts || {};
  const items = data.items || data.players || [];
  const privacy = data.privacyRequests || [];
  const total = Object.values(counts).reduce((a, b) => a + Number(b || 0), 0);

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Игроки</h2>
        <p>Единый экран 360°: техническая телеметрия, платежи, согласия и возрастной гейт, тикеты и фрод-кейсы. Удаление — по 152-ФЗ, без восстановления.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-sm btn-outline" id="export-players">${icon('download')} CSV</button>
        <button class="btn btn-sm btn-outline" id="by-id">${icon('search')} Найти по ID</button>
      </div>
    </div>

    <div class="grid grid-5 mb-16">
      ${kpi({ label: 'Всего игроков', value: compact(total || data.total || 0) })}
      ${kpi({ label: 'Активные', value: num(counts.active || 0) })}
      ${kpi({ label: 'Заморожены', value: num(counts.suspended || 0), sub: 'санкция без бана' })}
      ${kpi({ label: 'Забанены', value: num(counts.banned || 0) })}
      ${kpi({ label: 'Удалены', value: num(counts.deleted || 0), sub: 'PII анонимизирована' })}
    </div>

    <div class="grid grid-12">
      <section class="card col-9">
        <div class="card-head">
          <div class="segmented">
            ${STATUSES.map(([v, l]) => `<button type="button" data-status="${v}" class="${status === v ? 'active' : ''}">${l}${v !== 'all' && counts[v] ? ` · ${counts[v]}` : ''}</button>`).join('')}
          </div>
          <div class="row">
            <select class="input-inline" id="region-select">
              <option value="">все регионы</option>
              ${['RU', 'EU', 'TR', 'IN', 'SG', 'US', 'BR', 'CN'].map((r) => `<option value="${r}" ${region === r ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
            <select class="input-inline" id="sort-select">
              <option value="created_at" ${sort === 'created_at' ? 'selected' : ''}>по регистрации</option>
              <option value="last_seen_at" ${sort === 'last_seen_at' ? 'selected' : ''}>по активности</option>
              <option value="status" ${sort === 'status' ? 'selected' : ''}>по статусу</option>
              <option value="region" ${sort === 'region' ? 'selected' : ''}>по региону</option>
            </select>
            <input class="input-inline" id="player-search" type="search" placeholder="Ник, ID, кампания…" value="${esc(q)}" />
          </div>
        </div>
        <div class="card-body flush">
          ${items.length ? table({
            rows: items,
            rowKey: 'id',
            onRow: true,
            columns: [
              { label: 'Игрок', render: (r) => `<div class="row" style="gap:10px">
                  <span class="avatar-sm">${esc((r.display_name || '?').replace(/^Player_/, '').slice(0, 1))}</span>
                  <span><span class="list-title">${esc(r.display_name)}</span>
                  <span class="list-sub"><code>${esc(r.id)}</code> · ${esc(r.region)} · ${esc(SOURCE_LABELS[r.install_source] || r.install_source)}</span></span></div>` },
              { label: 'Статус', render: (r) => statusBadge(r.status, statusLabel(r.status)) },
              { label: 'Сессии', align: 'right', render: (r) => num(r.sessions_count) },
              { label: 'LTV', align: 'right', render: (r) => money(r.total_iap_usd) },
              { label: 'Кампания', render: (r) => `<span class="dim">${esc(r.install_campaign || '—')}</span>` },
              { label: 'Активность', align: 'right', render: (r) => `<span class="dim">${esc(timeAgo(r.last_seen_at))}</span>` },
            ],
          }) : emptyState({ iconName: 'users', title: 'Не найдено', text: 'Измените фильтры или поисковый запрос.' })}
        </div>
        ${items.length ? pager(data) : ''}
      </section>

      <section class="card col-3">
        <div class="card-head"><h3>Запросы субъектов ПДн</h3><span class="badge badge-neutral">${num(privacy.length)}</span></div>
        <div class="card-body flush">
          ${privacy.length
            ? privacy.slice(0, 8).map((p) => `<div class="list-row">
                <span class="status-dot ${p.status === 'completed' ? 'ok' : 'warning'}"></span>
                <div class="list-main">
                  <span class="list-title">${esc(p.request_type || p.type || 'запрос')}</span>
                  <span class="list-sub"><code>${esc(String(p.player_id || '').slice(0, 12))}</code> · ${esc(timeAgo(p.requested_at || p.created_at))}</span>
                </div>
              </div>`).join('')
            : emptyState({ iconName: 'shield', title: 'Запросов нет', text: 'Удаление и выгрузка данных оформляются в карточке игрока.' })}
          <div class="card-foot">
            <span class="dim">SLA удаления — 30 дней</span>
            <button class="link-btn" data-nav="governance?tab=compliance">Комплаенс →</button>
          </div>
        </div>
      </section>
    </div>
  `;

  qsa('[data-status]', container).forEach((btn) => btn.addEventListener('click', () => {
    ctx.setQuery('status', btn.dataset.status === 'all' ? '' : btn.dataset.status);
    ctx.setQuery('page', '');
    ctx.refresh();
  }));
  qs('#sort-select', container)?.addEventListener('change', (e) => { ctx.setQuery('sort', e.target.value); ctx.refresh(); });
  qs('#region-select', container)?.addEventListener('change', (e) => { ctx.setQuery('region', e.target.value); ctx.setQuery('page', ''); ctx.refresh(); });
  const search = qs('#player-search', container);
  search?.addEventListener('input', debounce(() => {
    ctx.setQuery('q', search.value);
    ctx.setQuery('page', '');
    ctx.refresh();
  }, 350));

  bindPager(container, (p) => { ctx.setQuery('page', p); ctx.refresh(); });
  bindRowClicks(container, (id) => openPlayer(id, ctx));
  run(container, '[data-nav]', (node) => { location.hash = `#/${node.dataset.nav}`; });

  qs('#export-players', container).addEventListener('click', () => {
    downloadFile('/api/admin/exports/players.csv', `topspin-players-${new Date().toISOString().slice(0, 10)}.csv`);
  });
  qs('#by-id', container).addEventListener('click', async () => {
    const id = await promptDialog({ title: 'Открыть игрока', label: 'ID игрока', placeholder: 'plr_0091', confirmLabel: 'Открыть' });
    if (id) openPlayer(id.trim(), ctx);
  });

  if (ctx.query.player) openPlayer(ctx.query.player, ctx);
}

function consentSummary(consents) {
  const latest = (consents || [])[0] || null;
  if (!latest) return { latest: null, pdConsent: false, marketing: false, analytics: false, minor: false, age: null };
  return {
    latest,
    pdConsent: true,
    marketing: Boolean(latest.marketing_opt_in),
    analytics: Boolean(latest.analytics_opt_in),
    minor: Boolean(latest.is_minor),
    age: latest.declared_age,
  };
}

async function openPlayer(id, ctx) {
  try {
    const d = await api.get(`/api/admin/players/${encodeURIComponent(id)}`);
    const p = d.player || {};
    const m = d.metrics || {};
    const consents = consentSummary(d.consents);
    const canSanction = can('players:sanction');
    const canErase = can('players:erase');
    const canExport = can('players:export');
    const banned = p.status === 'banned' || p.status === 'suspended';

    openDrawer({
      title: p.display_name || id,
      eyebrow: `${p.region} · ${SOURCE_LABELS[p.install_source] || p.install_source} · ${p.status}`,
      wide: true,
      body: `<div class="stack">
          <div class="row wrap">
            ${statusBadge(p.status, statusLabel(p.status))}
            <span class="badge badge-neutral">сессий: ${num(m.sessions)}</span>
            <span class="badge badge-neutral">LTV ${money(m.lifetimeUsd)}</span>
            <span class="badge badge-neutral">FPS ${num(m.avgFps, 1)}</span>
            <span class="dim">с ${esc(dateTime(p.created_at))} · был(а) ${esc(timeAgo(p.last_seen_at))}</span>
            ${p.ban_reason ? `<span class="badge badge-danger">${esc(p.ban_reason)}</span>` : ''}
          </div>
          ${consents.minor ? `<div class="alert alert-warn">${icon('alert')} Игрок несовершеннолетний: реклама и платные механики требуют согласия опекуна.</div>` : ''}

          <div class="split-even">
            <div>
              <div class="field-label mb-8">Согласия и возраст</div>
              <dl class="kv">
                <dt>Согласие на обработку</dt><dd>${consents.pdConsent ? '<span class="badge badge-ok">есть</span>' : '<span class="badge badge-danger">нет</span>'}</dd>
                <dt>Документ</dt><dd>${consents.latest ? `<code>${esc(consents.latest.doc_type)} v${esc(consents.latest.doc_version)}</code>` : '—'}</dd>
                <dt>Аналитика / реклама</dt><dd>${consents.analytics ? 'вкл' : 'выкл'} / ${consents.marketing ? 'вкл' : 'выкл'}</dd>
                <dt>Заявленный возраст</dt><dd>${consents.age != null ? num(consents.age) : '—'} ${consents.minor ? '<span class="badge badge-warn">minor</span>' : ''}</dd>
                <dt>Опекун</dt><dd>${consents.latest?.parental_consent ? '<span class="badge badge-ok">подтверждён</span>' : '<span class="badge badge-neutral">не требуется</span>'}</dd>
              </dl>
            </div>
            <div>
              <div class="field-label mb-8">Привлечение</div>
              <dl class="kv">
                <dt>Источник</dt><dd>${esc(SOURCE_LABELS[p.install_source] || p.install_source)}</dd>
                <dt>Кампания</dt><dd>${esc(p.install_campaign || '—')}</dd>
                <dt>Креатив</dt><dd>${esc(p.install_creative || '—')}</dd>
                <dt>Платежи</dt><dd>${num((d.payments || []).length)} · ${money((d.payments || []).reduce((s, x) => s + Number(x.amount_usd || 0), 0))}</dd>
                <dt>Тикеты</dt><dd>${num((d.tickets || []).length)} · фрод-кейсов ${num((d.fraudCases || []).length)}</dd>
              </dl>
            </div>
          </div>

          <div>
            <div class="field-label mb-8">Сессии</div>
            ${(d.sessions || []).length ? table({
              rows: (d.sessions || []).slice(0, 6),
              rowKey: 'id',
              columns: [
                { label: 'Платформа', render: (r) => `<span class="badge badge-neutral">${esc(r.platform)}</span>` },
                { label: 'FPS', align: 'right', render: (r) => num(r.avg_fps, 1) },
                { label: 'p5 FPS', align: 'right', render: (r) => `<span class="${r.p5_fps < 30 ? 'trend-down' : ''}">${num(r.p5_fps, 1)}</span>` },
                { label: 'RTT p50/p95', align: 'right', render: (r) => `${ms(r.rtt_p50_ms)} / ${ms(r.rtt_p95_ms)}` },
                { label: 'Сбои', align: 'right', render: (r) => `${r.crashed ? '<span class="badge badge-danger">краш</span>' : ''}${r.webgl_lost ? ' WebGL' : ''}${!r.crashed && !r.webgl_lost ? '<span class="dim">—</span>' : ''}` },
                { label: 'Начало', align: 'right', render: (r) => `<span class="dim">${esc(timeAgo(r.started_at))}</span>` },
              ],
            }) : '<div class="dim">сессий нет</div>'}
          </div>

          ${(d.payments || []).length ? `<div>
            <div class="field-label mb-8">Платежи</div>
            ${table({
              rows: (d.payments || []).slice(0, 5),
              rowKey: 'id',
              columns: [
                { label: 'SKU', render: (r) => `<code>${esc(r.item_sku)}</code>` },
                { label: 'Провайдер', render: (r) => esc(r.provider) },
                { label: 'Сумма', align: 'right', render: (r) => money(r.amount_usd) },
                { label: 'Статус', render: (r) => statusBadge(r.status === 'succeeded' ? 'ok' : 'warning', r.status) },
                { label: 'Когда', align: 'right', render: (r) => `<span class="dim">${esc(timeAgo(r.created_at))}</span>` },
              ],
            })}
          </div>` : ''}

          ${(d.fraudCases || []).length ? `<div>
            <div class="field-label mb-8">Фрод-кейсы</div>
            ${d.fraudCases.map((c) => `<div class="list-row">
                <span class="status-dot ${c.risk_score >= 0.75 ? 'critical' : 'warning'}"></span>
                <div class="list-main"><span class="list-title">${esc(c.case_type)}</span>
                <span class="list-sub">риск ${num(c.risk_score, 2)} · ${esc(statusLabel(c.status))}</span></div>
              </div>`).join('')}
          </div>` : ''}

          ${(d.tickets || []).length ? `<div>
            <div class="field-label mb-8">Обращения</div>
            ${d.tickets.map((t) => `<div class="list-row">
                <span class="status-dot info"></span>
                <div class="list-main"><span class="list-title">${esc(t.subject)}</span>
                <span class="list-sub">${esc(t.category)} · ${esc(statusLabel(t.status))} · ${esc(timeAgo(t.created_at))}</span></div>
              </div>`).join('')}
          </div>` : ''}

          ${canSanction ? `<div class="divider"></div>
          <div class="field-row">
            <label class="field"><span class="field-label">Санкция</span>
              <select id="player-status">
                ${['active', 'suspended', 'banned'].map((s) => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}
              </select></label>
            <label class="field"><span class="field-label">Причина (в аудит)</span>
              <input id="player-reason" placeholder="Например: подтверждён фрод по кейсу" /></label>
          </div>
          <div class="callout">${icon('shield')} Автоматических банов нет: санкцию выставляет человек, действие попадает в hash-chain аудит и уведомляет Ops.</div>` : ''}
        </div>`,
      actions: [
        { label: 'Закрыть', variant: 'btn-ghost' },
        ...(canExport ? [{
          label: 'Выгрузка данных',
          variant: 'btn-outline',
          close: false,
          onClick: async () => {
            try {
              const pkg = await api.get(`/api/admin/players/${id}/export`);
              openDrawer({
                title: 'Пакет данных субъекта',
                eyebrow: '152-ФЗ / GDPR Art. 15',
                body: `<pre class="code-block" style="max-height:60vh">${esc(JSON.stringify(pkg, null, 2))}</pre>`,
                actions: [{ label: 'Закрыть', variant: 'btn-ghost' }],
              });
            } catch (err) { toastError(err); }
          },
        }] : []),
        ...(canErase && p.status !== 'deleted' ? [{
          label: 'Удалить (152-ФЗ)',
          variant: 'btn-danger',
          close: false,
          onClick: async () => {
            const ok = await confirmDialog({
              title: 'Удалить персональные данные?',
              text: 'PII будет анонимизирована, аккаунт помечен удалённым, восстановление невозможно. Платёжные записи сохраняются для налогового учёта без привязки к личности.',
              confirmLabel: 'Удалить',
              danger: true,
              requireText: 'УДАЛИТЬ',
            });
            if (!ok) return;
            try {
              await api.post(`/api/admin/players/${id}/erase`, { reason: 'Запрос субъекта данных (152-ФЗ)' }, { idempotencyKey: `gdpr-${id}` });
              toast('Данные игрока удалены', { type: 'success' });
              ctx.refresh();
            } catch (err) { toastError(err); }
          },
        }] : []),
        ...(canSanction ? [{
          label: 'Применить санкцию',
          variant: 'btn-primary',
          close: false,
          onClick: async ({ close }) => {
            const status = qs('#player-status').value;
            const reason = qs('#player-reason').value.trim();
            if (status === p.status) { toast('Статус не изменился', { type: 'warn' }); return; }
            if (reason.length < 5) { toast('Укажите причину (мин. 5 символов)', { type: 'warn' }); return; }
            try {
              await api.post(`/api/admin/players/${id}/status`, { status, reason }, { idempotencyKey: `player-${id}-${status}-${Date.now()}` });
              toast('Статус обновлён', { type: 'success', text: 'Запись добавлена в аудит' });
              close();
              ctx.refresh();
            } catch (err) { toastError(err); }
          },
        }] : []),
      ],
    });
  } catch (err) { toastError(err); }
}
