import { api } from '../core/api.js';
import { esc, num, pct, money, compact, timeAgo, dateTime, statusLabel, truncate } from '../core/format.js';
import {
  qs, qsa, statusBadge, zoneBadge, kpi, card, sectionTitle, table, emptyState,
  openDrawer, openJson, confirmDialog, promptDialog, toast, toastError, run, skeleton,
  sparkline, donut, meter, bindRowClicks, riskBar,
} from '../core/ui.js';
import { icon } from '../core/icons.js';
import { can } from '../core/store.js';

const ZONES = [
  { id: 'ops', title: 'Ops', hint: 'FPS · RTT · краши' },
  { id: 'fraud', title: 'Fraud', hint: 'риск · кейсы' },
  { id: 'balance', title: 'Balance', hint: 'овал · 6 зон' },
  { id: 'market', title: 'Market', hint: 'каналы · LTV' },
  { id: 'lab', title: 'Lab', hint: 'A/B · стенды' },
];

export async function render(container, ctx) {
  if (!container.dataset.loaded) container.innerHTML = skeleton('page');
  const [data, proposals] = await Promise.all([
    api.get('/api/admin/overview'),
    api.get('/api/admin/proposals?status=pending&pageSize=6'),
  ]);
  if (ctx.isStale()) return;
  container.dataset.loaded = '1';
  stateFrom(data, proposals);

  const g = data.goldenSignals || {};
  const latency = g.latency || {};
  const traffic = g.traffic || {};
  const errors = g.errors || {};
  const readiness = data.readinessSummary || {};
  const openIncidents = data.openIncidents || [];
  const pending = proposals.items || [];
  const critical = (data.anomalies || []).filter((a) => a.severity === 'critical');

  container.innerHTML = `
    ${data.maintenance?.enabled ? maintenanceBanner(data.maintenance) : ''}
    <div class="page-head">
      <div>
        <h2>Добро пожаловать, ${esc((ctx.state.user?.displayName || '').split(' ')[0] || 'владелец')}</h2>
        <p>Сводный контур: состояние пяти изолированных зон, золотые сигналы SRE и очередь решений, требующих подтверждения человеком.</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-sm btn-outline" id="digest-btn">${icon('news')} Утренний дайджест</button>
        <button type="button" class="btn btn-sm btn-primary" id="refresh-all">${icon('refresh')} Обновить</button>
      </div>
    </div>

    <div class="grid grid-5 mb-16">
      ${kpi({
        label: 'Онлайн сейчас',
        value: num(traffic.ccu || 0),
        sub: `<span class="trend-flat">${num(traffic.activeWebSockets || 0)} WS · ${num(traffic.rps1m || 0)} RPS</span>`,
        spark: sparkline([...Array(12)].map((_, i) => (traffic.ccu || 0) * (0.82 + ((i * 7) % 5) * 0.04)), { color: 'var(--brand)' }),
      })}
      ${kpi({
        label: 'HTTP p95',
        value: `${Math.round(latency.httpP95Ms || 0)}<small>мс</small>`,
        sub: `p50 ${Math.round(latency.httpP50Ms || 0)} · p99 ${Math.round(latency.httpP99Ms || 0)} мс`,
      })}
      ${kpi({
        label: 'Открытые инциденты',
        value: num(openIncidents.length),
        sub: openIncidents.length
          ? `<span class="trend-down">${openIncidents.filter((i) => i.severity === 'critical').length} критических</span>`
          : '<span class="trend-up">все системы в норме</span>',
      })}
      ${kpi({
        label: 'Решения HITL',
        value: num(proposals.total ?? pending.length),
        sub: pending.length ? `<span class="trend-up">${pending.length} ждут подтверждения</span>` : 'очередь пуста',
      })}
      ${kpi({
        label: 'Готовность к запуску',
        value: `${Math.round(readiness.scorePct || 0)}<small>%</small>`,
        sub: `${num(readiness.passedCount || 0)} / ${num(readiness.totalCount || 0)} проверок`,
      })}
    </div>

    ${critical.length ? `<div class="alert alert-danger mb-16"><strong>Критические сигналы:</strong>&nbsp;${esc(critical.map((a) => a.message).join(' · '))}</div>` : ''}

    <div class="grid grid-12">
      <section class="card col-7">
        <div class="card-head">
          <div><h3>Пять изолированных зон</h3><div class="dim">Каждая зона — свой провайдер, ключ, схема и лимит токенов</div></div>
          <span class="badge badge-brand">изоляция включена</span>
        </div>
        <div class="card-body flush">
          <div class="zone-row dim" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.07em">
            <span>Зона</span><span>Статус</span><span>Последняя сводка</span><span>Токены</span><span></span>
          </div>
          ${ZONES.map((z) => zoneRow(z, data, ctx)).join('')}
        </div>
      </section>

      <section class="card col-5">
        <div class="card-head"><h3>Готовность платформы</h3>
          <button class="link-btn" type="button" id="open-readiness">Чек-лист →</button>
        </div>
        <div class="card-body">
          <div class="donut-wrap">
            ${donut([
              { value: readiness.passedCount || 0, color: 'var(--brand)' },
              { value: Math.max(0, (readiness.totalCount || 0) - (readiness.passedCount || 0)), color: 'var(--bg-4)' },
            ], { center: `${Math.round(readiness.scorePct || 0)}%`, centerSub: 'PASS' })}
            <div class="donut-legend">
              <span><span class="dot" style="background:var(--brand)"></span>Пройдено: <strong>${num(readiness.passedCount || 0)}</strong></span>
              <span><span class="dot" style="background:var(--bg-4)"></span>Всего проверок: <strong>${num(readiness.totalCount || 0)}</strong></span>
              <span class="dim">${readiness.readyForLaunch ? 'Платформа готова к запуску' : 'Есть незакрытые пункты'}</span>
            </div>
          </div>
          <div class="divider"></div>
          <div class="metric-inline">
            <div><span class="mv">${num(traffic.sessions7d || 0)}</span><span class="ml">сессий 7д</span></div>
            <div><span class="mv">${num(errors.http5xx5m || 0)}</span><span class="ml">5xx / 5м</span></div>
            <div><span class="mv">${num(errors.quarantinedAiOutputs || 0)}</span><span class="ml">карантин ИИ</span></div>
            <div><span class="mv">${num(data.openTicketsCount || 0)}</span><span class="ml">тикетов</span></div>
          </div>
        </div>
      </section>

      <section class="card col-8">
        <div class="card-head">
          <div><h3>Очередь решений (HITL)</h3><div class="dim">ИИ предлагает — человек подтверждает. Каждое решение попадает в неизменяемый аудит.</div></div>
          <span class="badge badge-neutral">${num(proposals.total ?? 0)}</span>
        </div>
        <div class="card-body flush" id="proposals-panel">
          ${proposalsTable(pending, ctx)}
        </div>
      </section>

      <section class="card col-4">
        <div class="card-head"><h3>Живой поток</h3><span class="live-chip ${ctx.state.live ? '' : 'off'}" id="feed-live"><span class="live-dot"></span><span class="live-label">${ctx.state.live ? 'live' : 'offline'}</span></span></div>
        <div class="feed" id="live-feed">${feedHtml(ctx.state.events)}</div>
      </section>

      <section class="card col-7">
        <div class="card-head">
          <div><h3>Аномалии и базовые линии</h3><div class="dim">Алерты на отклонения (2σ, +50% 5xx), а не на абсолютные пороги</div></div>
        </div>
        <div class="card-body flush">
          ${(data.anomalies || []).length
            ? (data.anomalies || []).map((a) => `
              <div class="list-row">
                <span class="status-dot ${a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'warning' : 'info'}"></span>
                <div class="list-main">
                  <span class="list-title">${esc(a.message)}</span>
                  <span class="list-sub">${esc(a.metric)} · текущее ${esc(String(a.current))} / порог ${esc(String(a.threshold))}</span>
                </div>
                ${statusBadge(a.severity)}
                <button class="btn btn-sm btn-ghost" data-runbook="${esc(a.runbookSlug || '')}">Runbook</button>
              </div>`).join('')
            : emptyState({ iconName: 'check', title: 'Аномалий нет', text: 'Все золотые сигналы в пределах базовых линий.' })}
        </div>
      </section>

      <section class="card col-5">
        <div class="card-head"><h3>Инциденты</h3><button class="link-btn" type="button" id="to-observability">Все →</button></div>
        <div class="card-body flush">
          ${openIncidents.length
            ? openIncidents.slice(0, 6).map((i) => `
              <div class="list-row">
                <span class="status-dot ${i.severity === 'critical' ? 'critical' : 'warning'}"></span>
                <div class="list-main">
                  <span class="list-title">${esc(i.title)}</span>
                  <span class="list-sub">${zoneBadge(i.zone)} ${esc(i.status)} · ${esc(timeAgo(i.created_at))}</span>
                </div>
                ${i.runbook_slug ? `<button class="btn btn-sm btn-ghost" data-runbook="${esc(i.runbook_slug)}">Runbook</button>` : ''}
              </div>`).join('')
            : emptyState({ iconName: 'shield', title: 'Инцидентов нет', text: 'Deploy в спокойном состоянии.' })}
        </div>
      </section>
    </div>
  `;

  bind(container, ctx, data);
}

function stateFrom(data, proposals) {
  if (typeof proposals.total === 'number') {
    window.dispatchEvent(new CustomEvent('crm:badges', { detail: { proposals: proposals.total, tickets: data.openTicketsCount } }));
  }
}

function maintenanceBanner(m) {
  return `<div class="maintenance-banner">
      <span class="status-dot warning"></span>
      <div class="grow"><strong>Режим технических работ включён.</strong> Новые матчи получают HTTP 503, активные партии доигрываются.
        ${m.bannerRu ? `Баннер: «${esc(m.bannerRu)}»` : ''}</div>
      <button class="btn btn-sm btn-outline" data-nav="liveops">Управление</button>
    </div>`;
}

function zoneRow(zone, data, ctx) {
  const status = data.zonesStatus?.find?.((z) => z.zone === zone.id);
  const summary = data.summaries?.[zone.id];
  const summaryText = summary?.summary || summary?.findings?.[0]?.issue || 'Сводка ещё не сформирована';
  const state = summary?.status || status?.latestStatus || 'ok';
  const used = Number(status?.usedTokens || 0);
  const limit = Number(status?.dailyTokenLimit || 1);
  return `<div class="zone-row">
      <div class="zone-name"><span class="dot" style="background:var(--${state === 'critical' ? 'danger' : state === 'warning' ? 'warn' : 'ok'})"></span>${esc(zone.title)}</div>
      <div>${statusBadge(state)}</div>
      <div class="truncate muted" title="${esc(summaryText)}">${esc(truncate(summaryText, 82))}</div>
      <div class="tnum dim" title="Использовано токенов за сутки">${compact(used)} / ${compact(limit)}</div>
      <div class="right">${can('zone:' + zone.id + ':run') || can('zones:run_all')
        ? `<button class="btn btn-sm btn-ghost" data-run-zone="${zone.id}">${icon('play')} Запуск</button>` : ''}</div>
    </div>`;
}

function proposalsTable(rows, ctx) {
  if (!rows.length) {
    return emptyState({ iconName: 'check', title: 'Очередь пуста', text: 'Все предложения пяти зон уже рассмотрены.' });
  }
  return table({
    rows,
    rowKey: 'id',
    columns: [
      { label: 'Зона', render: (r) => zoneBadge(r.zone) },
      { label: 'Предложение', render: (r) => `<div class="list-title">${esc(r.title)}</div><div class="list-sub">${esc(truncate(r.rationale, 96))}</div>` },
      { label: 'Уверенность', align: 'right', render: (r) => `<span class="tnum">${pct((r.confidence || 0) * 100)}</span>` },
      { label: 'Создано', align: 'right', render: (r) => `<span class="dim">${esc(timeAgo(r.created_at))}</span>` },
      {
        label: '',
        align: 'right',
        render: (r) => `<span class="row" style="justify-content:flex-end">
            <button class="btn btn-sm btn-outline" data-proposal="${esc(r.id)}">Детали</button>
            <button class="btn btn-sm btn-primary" data-approve="${esc(r.id)}">Применить</button>
          </span>`,
      },
    ],
  });
}

function feedHtml(events) {
  if (!events?.length) {
    return `<div class="empty" style="padding:24px"><span class="empty-icon">${icon('pulse')}</span>
      <h4>Ожидание событий</h4><p>Здесь появляются запуски зон, инциденты, тикеты и решения в реальном времени.</p></div>`;
  }
  return events.slice(0, 12).map((e) => {
    const meta = describeEvent(e);
    return `<div class="feed-item">
        <span class="feed-icon">${icon(meta.icon)}</span>
        <div class="feed-body"><div class="feed-title">${esc(meta.title)}</div><div class="feed-meta">${esc(meta.sub)}</div></div>
        <span class="feed-meta">${esc(timeAgo(e.at))}</span>
      </div>`;
  }).join('');
}

function describeEvent(e) {
  const p = e.payload || {};
  switch (e.type) {
    case 'notification': return { icon: 'bell', title: p.title || 'Уведомление', sub: p.body || '' };
    case 'zone': return { icon: 'activity', title: `Сводка зоны ${String(p.zone || '').toUpperCase()}`, sub: `статус ${statusLabel(p.status)} · находок ${p.findings ?? 0}` };
    case 'proposal': return { icon: 'layers', title: `Решение HITL: ${p.title || ''}`, sub: statusLabel(p.status) };
    case 'incident': return { icon: 'alert', title: p.title ? `Инцидент: ${p.title}` : `Инцидент ${p.id || ''}`, sub: statusLabel(p.status) };
    case 'ticket': return { icon: 'ticket', title: 'Обращение в поддержку', sub: statusLabel(p.status) };
    case 'job': return { icon: 'cpu', title: `Задача ${p.job}`, sub: p.status === 'failed' ? `ошибка: ${p.error || ''}` : statusLabel(p.status) };
    case 'maintenance': return { icon: 'clock', title: p.enabled ? 'Включены техработы' : 'Техработы завершены', sub: p.bannerRu || '' };
    case 'push': return { icon: 'zap', title: 'Отправлен пуш', sub: p.title || '' };
    case 'news': return { icon: 'news', title: 'Новость обновлена', sub: p.title || '' };
    case 'fraud': return { icon: 'shield', title: 'Разбор фрод-кейса', sub: statusLabel(p.verdict) };
    default: return { icon: 'pulse', title: e.type, sub: '' };
  }
}

function bind(container, ctx, data) {
  qs('#refresh-all', container)?.addEventListener('click', () => ctx.refresh());
  qs('#digest-btn', container)?.addEventListener('click', async () => {
    try {
      const digest = await api.get('/api/admin/digest/morning');
      openDrawer({
        title: 'Утренний дайджест',
        eyebrow: 'ежедневно 09:00 МСК',
        body: `<div class="stack">
            <div class="row">${statusBadge(digest.status || 'ok')}<span class="dim">${esc(dateTime(digest.generatedAt || new Date().toISOString()))}</span></div>
            <p>${esc(digest.summary || digest.headline || '')}</p>
            <pre class="code-block">${esc(JSON.stringify(digest, null, 2))}</pre>
          </div>`,
        actions: [{ label: 'Закрыть', variant: 'btn-ghost' }],
      });
    } catch (err) { toastError(err); }
  });

  qs('#open-readiness', container)?.addEventListener('click', () => {
    location.hash = '#/governance?tab=readiness';
  });
  qs('#to-observability', container)?.addEventListener('click', () => { location.hash = '#/observability'; });
  run(container, '[data-nav]', (node) => { location.hash = `#/${node.dataset.nav}`; });
  run(container, '[data-runbook]', async (node) => {
    if (!node.dataset.runbook) return;
    try {
      const rb = await api.get(`/api/admin/runbooks/${encodeURIComponent(node.dataset.runbook)}`);
      openDrawer({
        title: rb.title || rb.slug,
        eyebrow: `runbook · ${rb.slug}`,
        body: `<pre class="code-block" style="max-height:60vh">${esc(rb.content || '')}</pre>`,
        actions: [{ label: 'Закрыть', variant: 'btn-ghost' }],
      });
    } catch (err) { toastError(err); }
  });

  run(container, '[data-run-zone]', async (node) => {
    node.disabled = true;
    node.innerHTML = `<span class="inline-spinner"></span> Расчёт…`;
    try {
      const res = await api.post(`/api/admin/zones/${node.dataset.runZone}/run`, {});
      toast(`Зона ${node.dataset.runZone.toUpperCase()} обновлена`, {
        type: res?.summary?.status === 'critical' ? 'warn' : 'success',
        text: res?.summary?.summary || '',
      });
      ctx.refresh();
    } catch (err) {
      toastError(err);
      node.disabled = false;
      node.innerHTML = `${icon('play')} Запуск`;
    }
  });

  run(container, '[data-proposal]', async (node) => {
    const row = (data.proposals || []).find((p) => p.id === node.dataset.proposal);
    if (!row) return;
    openDrawer({
      title: row.title,
      eyebrow: `зона ${row.zone} · уверенность ${pct((row.confidence || 0) * 100)}`,
      body: `<div class="stack">
          <p class="muted">${esc(row.rationale)}</p>
          <div class="divider"></div>
          <div class="row"><span class="dim">Действие</span><span class="badge badge-neutral">${esc(row.action_type)}</span></div>
          <pre class="code-block">${esc(JSON.stringify(row.payload || {}, null, 2))}</pre>
        </div>`,
      actions: [
        { label: 'Отклонить', variant: 'btn-outline', onClick: async ({ close }) => { close(); await decide(row, 'rejected', ctx); } },
        { label: 'Применить', variant: 'btn-primary', onClick: async ({ close }) => { close(); await decide(row, 'approved', ctx); } },
      ],
    });
  });

  run(container, '[data-approve]', async (node) => {
    const row = (data.proposals || []).find((p) => p.id === node.dataset.approve);
    if (row) await decide(row, 'approved', ctx);
  });

  bindRowClicks(container, () => {});
  bindLive(ctx, container);
}

async function decide(row, decision, ctx) {
  const comment = await promptDialog({
    title: decision === 'approved' ? 'Подтвердить решение' : 'Отклонить решение',
    label: 'Комментарий к решению (в аудит)',
    placeholder: decision === 'approved' ? 'Проверено на тестовом контуре, применяем' : 'Причина отклонения',
    confirmLabel: decision === 'approved' ? 'Применить' : 'Отклонить',
    danger: decision === 'rejected',
    hint: 'Комментарий и результат попадут в неизменяемый журнал аудита с hash-цепочкой.',
  });
  if (comment === null) return;
  try {
    await api.post(`/api/admin/proposals/${row.id}/decide`, { decision, comment }, { idempotencyKey: `prop-${row.id}-${decision}` });
    toast(decision === 'approved' ? 'Решение применено' : 'Решение отклонено', { type: 'success' });
    ctx.refresh();
  } catch (err) { toastError(err); }
}

function bindLive(ctx, container) {
  if (ctx._liveBound) return;
  ctx._liveBound = true;
  const handler = (e) => {
    if (!document.contains(container)) {
      window.removeEventListener('crm:event', handler);
      return;
    }
    const feed = qs('#live-feed', container);
    if (feed) feed.innerHTML = feedHtml(ctx.state.events);
    const chip = qs('#feed-live', container);
    if (chip) chip.classList.toggle('off', !ctx.state.live);
    if (['notification', 'incident', 'proposal', 'zone'].includes(e.detail?.type)) {
      clearTimeout(ctx._refreshT);
      ctx._refreshT = setTimeout(() => ctx.refresh(), 1400);
    }
  };
  window.addEventListener('crm:event', handler);
}
