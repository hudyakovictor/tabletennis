import { api } from '../core/api.js';
import { esc, num, pct, ms, timeAgo, dateTime, statusLabel } from '../core/format.js';
import {
  qs, qsa, kpi, card, table, statusBadge, zoneBadge, skeleton, emptyState, openDrawer,
  promptDialog, confirmDialog, toast, toastError, run, sparkline,
} from '../core/ui.js';
import { icon } from '../core/icons.js';
import { can } from '../core/store.js';

export async function render(container, ctx) {
  const tab = ctx.query.tab || 'signals';
  if (!container.dataset.loaded) container.innerHTML = skeleton('page');
  const data = await api.get('/api/admin/observability');
  if (ctx.isStale()) return;
  container.dataset.loaded = '1';
  container._data = data;

  const g = data.goldenSignals || {};
  const s = data.slo || {};
  const incidents = data.incidents || [];
  const apiErrors = data.topApiErrors || [];

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Observability</h2>
        <p>Четыре золотых сигнала, SLO с error budget, детекция аномалий, инциденты с runbook-ами и read-only Telegram-бот.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-sm btn-outline" id="verify-audit">${icon('shield')} Проверить аудит</button>
        <button class="btn btn-sm btn-primary" id="new-incident">${icon('plus')} Инцидент</button>
      </div>
    </div>

    <div class="grid grid-4 mb-16">
      ${kpi({ label: 'Latency p95', value: `${num(g.latency?.httpP95Ms || 0, 0)}<small>мс</small>`, sub: `p99 ${num(g.latency?.httpP99Ms || 0, 0)} · sse ${num(g.latency?.sseDeliveryP95Ms || 0, 0)} мс` })}
      ${kpi({ label: 'Traffic', value: `${num(g.traffic?.rps1m || 0)}<small> RPS</small>`, sub: `${num(g.traffic?.ccu || 0)} CCU · ${num(g.traffic?.activeWebSockets || 0)} WS` })}
      ${kpi({ label: 'Errors', value: pct(g.errors?.errorRatePct || 0, 2), sub: `${num(g.errors?.http5xx5m || 0)} 5xx / 5м` })}
      ${kpi({ label: 'Saturation', value: pct(g.saturation?.dbBusyPct || 0), sub: `AI бюджет ${pct(g.saturation?.aiBudgetUsedPct || 0)}` })}
    </div>

    <div class="tabs mb-16" id="tabs">
      ${[['signals', 'Сигналы'], ['slo', 'SLO и бюджет'], ['incidents', `Инциденты${incidents.length ? ` · ${incidents.length}` : ''}`], ['errors', 'Ошибки API'], ['runbooks', 'Runbooks'], ['silences', 'Silences']]
        .map(([v, l]) => `<button type="button" class="tab ${tab === v ? 'active' : ''}" data-tab="${v}">${l}</button>`).join('')}
    </div>

    <div id="tab-body">${renderTab(tab, { data, g, s, incidents, apiErrors })}</div>
  `;

  qsa('[data-tab]', container).forEach((btn) => btn.addEventListener('click', () => {
    ctx.setQuery('tab', btn.dataset.tab);
    ctx.refresh();
  }));

  qs('#verify-audit', container).addEventListener('click', async () => {
    try {
      const res = await api.get('/api/admin/audit/verify');
      (res.valid ? toast : toastError)(res.valid
        ? { message: `Аудит целостен: ${num(res.checked)} записей` }
        : { message: `Цепочка нарушена на записи ${res.brokenAt}` });
      if (!res.valid) {
        openDrawer({
          title: 'Нарушение целостности аудита',
          eyebrow: 'hash chain',
          body: `<pre class="code-block">${esc(JSON.stringify(res, null, 2))}</pre>`,
          actions: [{ label: 'Закрыть', variant: 'btn-ghost' }],
        });
      }
    } catch (err) { toastError(err); }
  });

  qs('#new-incident', container)?.addEventListener('click', async () => {
    const title = await promptDialog({
      title: 'Новый инцидент',
      label: 'Краткое описание',
      placeholder: 'Рост 5xx после релиза 2026.10.28',
      confirmLabel: 'Создать',
      hint: 'Инцидент создаётся вручную, если автоматика не поймала сигнал.',
    });
    if (!title) return;
    try {
      await api.post('/api/admin/incidents', { title, severity: 'warning', zone: 'ops' }, { idempotencyKey: `inc-${Date.now()}` });
      toast('Инцидент создан', { type: 'success' });
      ctx.refresh();
    } catch (err) { toastError(err); }
  });

  bindTabActions(container, ctx, data);
}

function renderTab(tab, bag) {
  if (tab === 'slo') return sloTab(bag.s);
  if (tab === 'incidents') return incidentsTab(bag.incidents);
  if (tab === 'errors') return errorsTab(bag.apiErrors, bag.data);
  if (tab === 'runbooks') return runbooksTab(bag.data.runbooks || []);
  if (tab === 'silences') return silencesTab(bag.data.silences || []);
  return signalsTab(bag.data, bag.g);
}

function signalsTab(data, g) {
  const series = (data.series || {});
  const anomalies = data.anomalies || [];
  return `
    <div class="grid grid-12">
      ${['latency', 'traffic', 'errors', 'saturation'].map((key) => {
        const labels = { latency: 'Latency', traffic: 'Traffic', errors: 'Errors', saturation: 'Saturation' };
        const metrics = Object.entries(g[key] || {}).filter(([, v]) => typeof v === 'number');
        return `<section class="card col-6">
            <div class="card-head"><h3>${labels[key]}</h3>${sparkline(series[key] || [], { color: key === 'errors' ? 'var(--danger)' : 'var(--brand)' })}</div>
            <div class="card-body">
              <div class="grid grid-2" style="gap:8px 18px">
                ${metrics.map(([mk, mv]) => `<div class="row-between" style="font-size:12px"><span class="muted">${esc(mk)}</span>
                  <span class="tnum">${Math.round(mv * 100) / 100}</span></div>`).join('')}
              </div>
            </div>
          </section>`;
      }).join('')}
      <section class="card col-12">
        <div class="card-head"><div><h3>Аномалии</h3><div class="dim">Пороги: 5xx +50% / 5 мин · p99 &gt; 2σ · DAU −20% / час · всплеск отказов · падение провайдера</div></div></div>
        <div class="card-body flush">
          ${anomalies.length ? anomalies.map((a) => `<div class="list-row">
              <span class="status-dot ${a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'warning' : 'info'}"></span>
              <div class="list-main"><span class="list-title">${esc(a.message)}</span>
                <span class="list-sub">${esc(a.metric)} · текущее ${esc(String(a.current))} · порог ${esc(String(a.threshold))}</span></div>
              ${statusBadge(a.severity)}
              ${a.runbookSlug ? `<button class="btn btn-sm btn-ghost" data-runbook="${esc(a.runbookSlug)}">Runbook</button>` : ''}
              <button class="btn btn-sm btn-ghost" data-silence="${esc(a.metric)}">Silence</button>
            </div>`).join('') : emptyState({ iconName: 'check', title: 'Аномалий нет', text: 'Все сигналы в пределах базовых линий.' })}
        </div>
      </section>
    </div>`;
}

function sloTab(s) {
  const targets = s.targets || [];
  return `<div class="grid grid-12">
      <section class="card col-8">
        <div class="card-head"><div><h3>SLO и error budget</h3><div class="dim">Бюджет расходуется при простоях; исчерпание блокирует релизы правил</div></div></div>
        <div class="card-body flush">
          ${targets.length ? table({
            rows: targets,
            rowKey: 'name',
            columns: [
              { label: 'SLO', render: (r) => `<div class="list-title">${esc(r.name)}</div><div class="list-sub">${esc(r.description || '')}</div>` },
              { label: 'Цель', align: 'right', render: (r) => pct(r.targetPct * 100, 1) },
              { label: 'Факт', align: 'right', render: (r) => `<span class="${r.currentPct < r.targetPct ? 'trend-down' : 'trend-up'}">${pct(r.currentPct * 100, 2)}</span>` },
              { label: 'Бюджет', align: 'right', render: (r) => `${num(r.budgetRemainingPct, 1)}%` },
              { label: 'Статус', render: (r) => statusBadge(r.breached ? 'critical' : 'ok', r.breached ? 'нарушен' : 'в норме') },
            ],
          }) : emptyState({ title: 'SLO не настроены' })}
        </div>
      </section>
      <section class="card col-4">
        <div class="card-head"><h3>Telegram-бот</h3><span class="badge badge-neutral">read-only</span></div>
        <div class="card-body stack">
          <p class="muted" style="font-size:12.5px">Бот получает алерты и дайджест 09:00 МСК. Команды на изменение состояния отключены архитектурно.</p>
          <div class="row-between"><span class="muted">Алерты</span><strong>${(s.telegram || {}).alertsEnabled ? 'вкл' : 'выкл'}</strong></div>
          <div class="row-between"><span class="muted">Дайджест</span><strong>${(s.telegram || {}).digestTime || '09:00'}</strong></div>
          <div class="row-between"><span class="muted">Получателей</span><strong>${num((s.telegram || {}).recipients || 0)}</strong></div>
        </div>
      </section>
    </div>`;
}

function incidentsTab(incidents) {
  return `<section class="card">
      <div class="card-head"><h3>Инциденты</h3><span class="dim">${num(incidents.length)}</span></div>
      <div class="card-body flush">
        ${incidents.length ? table({
          rows: incidents,
          rowKey: 'id',
          onRow: true,
          columns: [
            { label: 'Инцидент', render: (r) => `<div class="list-title">${esc(r.title)}</div><div class="list-sub">${esc(r.summary || '')}</div>` },
            { label: 'Зона', render: (r) => zoneBadge(r.zone) },
            { label: 'Severity', render: (r) => statusBadge(r.severity) },
            { label: 'Статус', render: (r) => statusBadge(r.status, statusLabel(r.status)) },
            { label: 'Runbook', render: (r) => r.runbook_slug ? `<button class="btn btn-sm btn-ghost" data-runbook="${esc(r.runbook_slug)}">${esc(r.runbook_slug)}</button>` : '<span class="dim">—</span>' },
            { label: 'Создан', align: 'right', render: (r) => `<span class="dim">${esc(timeAgo(r.created_at))}</span>` },
          ],
        }) : emptyState({ iconName: 'shield', title: 'Инцидентов нет' })}
      </div>
    </section>`;
}

function errorsTab(apiErrors, data) {
  return `<div class="grid grid-12">
      <section class="card col-7">
        <div class="card-head"><h3>Топ ошибок API</h3></div>
        <div class="card-body flush">
          ${apiErrors.length ? table({
            rows: apiErrors,
            rowKey: (r) => `${r.method}-${r.path}-${r.status}`,
            columns: [
              { label: 'Метод', render: (r) => `<span class="badge badge-neutral">${esc(r.method)}</span>` },
              { label: 'Путь', render: (r) => `<code>${esc(r.path)}</code>` },
              { label: 'Статус', align: 'right', render: (r) => statusBadge(r.status >= 500 ? 'critical' : 'warning', String(r.status)) },
              { label: 'Кол-во', align: 'right', render: (r) => num(r.cnt) },
            ],
          }) : emptyState({ title: 'Ошибок нет' })}
        </div>
      </section>
      <section class="card col-5">
        <div class="card-head"><h3>Карантин ИИ</h3></div>
        <div class="card-body">
          ${(data.quarantined || []).length
            ? (data.quarantined || []).slice(0, 8).map((q) => `<div class="list-row">
                <span class="status-dot critical"></span>
                <div class="list-main"><span class="list-title">${esc(q.zone)} · ${esc(q.reason)}</span>
                <span class="list-sub">${esc(timeAgo(q.created_at))}</span></div>
              </div>`).join('')
            : emptyState({ iconName: 'check', title: 'Карантин пуст', text: 'Все ответы ИИ прошли JSON Schema.' })}
        </div>
      </section>
    </div>`;
}

function runbooksTab(runbooks) {
  return `<section class="card">
      <div class="card-head"><div><h3>Runbook-и</h3><div class="dim">У каждого алерта есть воспроизводимый сценарий реакции</div></div></div>
      <div class="card-body flush">
        ${runbooks.length ? runbooks.map((r) => `<div class="list-row">
            <span class="badge badge-neutral">${esc(r.slug)}</span>
            <div class="list-main"><span class="list-title">${esc(r.title)}</span><span class="list-sub">${esc(r.summary || '')}</span></div>
            <button class="btn btn-sm btn-outline" data-runbook="${esc(r.slug)}">Открыть</button>
          </div>`).join('') : emptyState({ title: 'Runbook-ов нет' })}
      </div>
    </section>`;
}

function silencesTab(silences) {
  return `<section class="card">
      <div class="card-head"><div><h3>Silences</h3><div class="dim">Временная приостановка алертов с обязательной причиной и сроком</div></div></div>
      <div class="card-body flush">
        ${silences.length ? silences.map((s) => `<div class="list-row">
            <span class="status-dot info"></span>
            <div class="list-main"><span class="list-title">${esc(s.metric)}</span><span class="list-sub">${esc(s.reason)} · до ${esc(dateTime(s.expires_at))}</span></div>
            <button class="btn btn-sm btn-ghost" data-unsilence="${esc(s.id)}">Снять</button>
          </div>`).join('') : emptyState({ title: 'Активных silences нет' })}
      </div>
    </section>`;
}

function bindTabActions(container, ctx, data) {
  run(container, '[data-runbook]', async (node) => {
    try {
      const rb = await api.get(`/api/admin/runbooks/${encodeURIComponent(node.dataset.runbook)}`);
      openDrawer({
        title: rb.title || rb.slug,
        eyebrow: `runbook · ${rb.slug}`,
        body: `<div class="stack">${rb.summary ? `<p class="muted">${esc(rb.summary)}</p>` : ''}
          <pre class="code-block" style="max-height:60vh">${esc(rb.content || '')}</pre></div>`,
        actions: [{ label: 'Закрыть', variant: 'btn-ghost' }],
      });
    } catch (err) { toastError(err); }
  });

  run(container, '[data-silence]', async (node) => {
    if (!can('alerts:silence')) { toast('Недостаточно прав', { type: 'error' }); return; }
    const reason = await promptDialog({
      title: 'Приглушить алерт',
      label: `Причина для ${node.dataset.silence}`,
      placeholder: 'Плановые работы по шардированию БД',
      confirmLabel: 'Silence 2 ч',
      hint: 'Silence создаётся на 2 часа и фиксируется в аудите.',
    });
    if (!reason) return;
    try {
      await api.post('/api/admin/observability/silence', { metric: node.dataset.silence, reason }, { idempotencyKey: `sil-${node.dataset.silence}-${Date.now()}` });
      toast('Silence создан', { type: 'success' });
      ctx.refresh();
    } catch (err) { toastError(err); }
  });

  run(container, '[data-unsilence]', async (node) => {
    try {
      await api.delete(`/api/admin/observability/silence/${node.dataset.unsilence}`);
      toast('Silence снят', { type: 'success' });
      ctx.refresh();
    } catch (err) { toastError(err); }
  });

  run(container, 'tbody tr[data-key]', async (node) => {
    const id = node.dataset.key;
    const inc = (data.incidents || []).find((i) => i.id === id);
    if (!inc) return;
    openDrawer({
      title: inc.title,
      eyebrow: `incident · ${inc.severity}`,
      body: `<div class="stack">
          <div class="row">${statusBadge(inc.status, statusLabel(inc.status))}${statusBadge(inc.severity)}${zoneBadge(inc.zone)}</div>
          <p class="muted">${esc(inc.summary || '')}</p>
          <dl class="kv"><dt>Создан</dt><dd>${esc(dateTime(inc.created_at))}</dd>
            <dt>Подтверждён</dt><dd>${esc(inc.acknowledged_at ? dateTime(inc.acknowledged_at) : '—')}</dd>
            <dt>Закрыт</dt><dd>${esc(inc.resolved_at ? dateTime(inc.resolved_at) : '—')}</dd></dl>
        </div>`,
      actions: [{ label: 'Закрыть', variant: 'btn-ghost' }],
    });
  });
}
