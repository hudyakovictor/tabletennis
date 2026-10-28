import { api } from '../core/api.js';
import { esc, num, timeAgo, dateTime, compact, statusLabel } from '../core/format.js';
import {
  qs, qsa, kpi, card, table, statusBadge, zoneBadge, skeleton, emptyState, openDrawer,
  toast, toastError, run, confirmDialog, meter, setBusy, promptDialog,
} from '../core/ui.js';
import { icon } from '../core/icons.js';
import { can } from '../core/store.js';

const TABS = [
  ['system', 'Система'],
  ['scheduler', 'Планировщик'],
  ['users', 'Пользователи'],
  ['sessions', 'Сессии'],
  ['providers', 'AI-провайдеры'],
  ['backups', 'Бэкапы и хранение'],
];

export async function render(container, ctx) {
  const tab = TABS.some(([t]) => t === ctx.query.tab) ? ctx.query.tab : 'system';
  if (!container.dataset.loaded) container.innerHTML = skeleton('page');
  const [data, meta, backups, retention] = await Promise.all([
    api.get('/api/admin/settings'),
    api.get('/api/admin/system/meta').catch(() => ({})),
    // Only the tab that shows them pays for them; the dry run is cheap but must
    // always reflect the current data, so it is evaluated on every open.
    tab === 'backups' ? api.get('/api/admin/system/backups').catch(() => null) : Promise.resolve(null),
    tab === 'backups' ? api.get('/api/admin/system/retention/preview').catch(() => null) : Promise.resolve(null),
  ]);
  if (ctx.isStale()) return;
  container.dataset.loaded = '1';
  container._data = data;
  container._backups = backups;
  container._retention = retention;

  const jobs = data.jobs || data.scheduler?.jobs || [];
  const sessions = data.sessions || [];
  const users = data.users || [];
  const zones = data.providers || data.zones || [];

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Настройки и платформа</h2>
        <p>Планировщик, операторы CRM, активные сессии, ключи AI-провайдеров и диагностика. Секреты не показываются — только признак наличия ключа.</p>
      </div>
      <div class="page-actions">
        ${can('system:read') ? `<button class="btn btn-sm btn-outline" id="diagnostics">${icon('activity')} Диагностика</button>` : ''}
        ${can('users:manage') ? `<button class="btn btn-sm btn-primary" id="new-user">${icon('plus')} Пользователь</button>` : ''}
      </div>
    </div>

    <div class="grid grid-4 mb-16">
      ${kpi({ label: 'Версия', value: esc(meta.version || '3.0.0'), sub: `окружение ${esc(meta.environment || 'development')}` })}
      ${kpi({ label: 'Регион', value: esc(meta.region || 'RU'), sub: `WS ${esc(meta.wsGateway || '/ws/client')}` })}
      ${kpi({ label: 'Задач в планировщике', value: num(jobs.length), sub: `${num(jobs.filter((j) => j.enabled).length)} активно` })}
      ${kpi({ label: 'Активных сессий', value: num(sessions.filter((s) => !s.revoked_at).length) })}
    </div>

    <div class="tabs mb-16">
      ${TABS.map(([v, l]) => `<button type="button" class="tab ${tab === v ? 'active' : ''}" data-tab="${v}">${l}</button>`).join('')}
    </div>
    <div id="tab-body">${renderTab(tab, data, meta, jobs, sessions, users, zones, { backups, retention })}</div>
  `;

  qsa('[data-tab]', container).forEach((btn) => btn.addEventListener('click', () => {
    ctx.setQuery('tab', btn.dataset.tab);
    ctx.refresh();
  }));

  qs('#diagnostics', container)?.addEventListener('click', async () => {
    try {
      const d = await api.get('/api/admin/system/diagnostics');
      openDrawer({
        title: 'Диагностика платформы',
        eyebrow: 'read-only снимок',
        wide: true,
        body: `<div class="stack">
            <div class="metric-inline">
              <div><span class="mv">${num(d.db?.sizeMb || 0, 2)}</span><span class="ml">БД, МБ</span></div>
              <div><span class="mv">${num(d.db?.tables || 0)}</span><span class="ml">таблиц</span></div>
              <div><span class="mv">${num(d.memoryMb || 0, 0)}</span><span class="ml">RSS, МБ</span></div>
              <div><span class="mv">${num(d.pendingJobs || 0)}</span><span class="ml">задач к запуску</span></div>
              <div><span class="mv">${d.auditChain?.valid ? 'OK' : 'FAIL'}</span><span class="ml">аудит-цепочка</span></div>
            </div>
            <div class="callout">${icon('shield')} Проверено записей аудита: ${num(d.auditChain?.checked || 0)} · миграций: ${num((d.migrations || []).length)}</div>
            <div class="field-label">Счётчики таблиц</div>
            <div class="tag-list">${Object.entries(d.db?.counts || {}).map(([k, v]) => `<span class="chip">${esc(k)} <span class="dim">${num(v)}</span></span>`).join('')}</div>
            <pre class="code-block" style="max-height:34vh">${esc(JSON.stringify(d, null, 2))}</pre>
          </div>`,
        actions: [{ label: 'Закрыть', variant: 'btn-ghost' }],
      });
    } catch (err) { toastError(err); }
  });

  qs('#new-user', container)?.addEventListener('click', () => openUserDialog(ctx, null, data.roles || []));
  bindTab(container, ctx, data, zones);
}

function renderTab(tab, d, meta, jobs, sessions, users, zones, extra = {}) {
  if (tab === 'backups') return backupsTab(extra.backups, extra.retention);
  if (tab === 'scheduler') return schedulerTab(jobs, d.scheduler);
  if (tab === 'users') return usersTab(users, d.roles || []);
  if (tab === 'sessions') return sessionsTab(sessions);
  if (tab === 'providers') return providersTab(zones, meta);
  return systemTab(d, meta, jobs, sessions, users);
}

function systemTab(d, meta, jobs, sessions, users) {
  const env = d.envFacts || {};
  return `<div class="grid grid-12">
      <section class="card col-6">
        <div class="card-head"><h3>Платформа</h3></div>
        <div class="card-body">
          <dl class="kv">
            <dt>Версия CRM</dt><dd><code>${esc(meta.version || '3.0.0')}</code></dd>
            <dt>Окружение</dt><dd><span class="badge badge-neutral">${esc(meta.environment || 'development')}</span></dd>
            <dt>Регион</dt><dd>${esc(meta.region || 'RU')}</dd>
            <dt>SSE-поток</dt><dd><code>${esc(meta.streamEndpoint || '/api/admin/stream')}</code></dd>
            <dt>WebSocket клиента</dt><dd><code>${esc(meta.wsGateway || '/ws/client')}</code></dd>
            <dt>Возможности</dt><dd class="tag-list">${Object.entries(meta.features || {}).filter(([, v]) => v).map(([k]) => `<span class="chip">${esc(k)}</span>`).join('')}</dd>
            <dt>Ретеншн</dt><dd>input ${num(meta.retentionDays?.inputLogs || 0)} д · telemetry ${num(meta.retentionDays?.telemetry || 0)} д · директор ${num(meta.retentionDays?.directorChat || 0)} д</dd>
          </dl>
        </div>
      </section>
      <section class="card col-6">
        <div class="card-head"><h3>Конфигурация окружения</h3></div>
        <div class="card-body flush">
          ${table({
            rows: Object.entries(env).map(([k, v]) => ({ k, v })),
            rowKey: 'k',
            empty: 'Переменные не заданы',
            columns: [
              { label: 'Переменная', render: (r) => `<code>${esc(r.k)}</code>` },
              { label: 'Значение', align: 'right', render: (r) => (r.v === true
                ? '<span class="badge badge-ok">включено</span>'
                : r.v === false
                  ? '<span class="badge badge-neutral">выключено</span>'
                  : `<span class="tnum truncate" style="max-width:240px;display:inline-block">${esc(String(r.v))}</span>`) },
            ],
          })}
        </div>
      </section>
      <section class="card col-6">
        <div class="card-head"><h3>Нагрузка</h3></div>
        <div class="card-body stack">
          ${meter('AI-бюджет всех зон за сутки', d.aiUsedToday || 0, Math.max(1, d.aiBudgetToday || 1), { formatter: (v) => compact(v) })}
          <div class="row-between"><span class="muted">Пользователей CRM</span><strong>${num(users.length)}</strong></div>
          <div class="row-between"><span class="muted">Активных сессий</span><strong>${num(sessions.filter((s) => !s.revoked_at).length)}</strong></div>
          <div class="row-between"><span class="muted">Открытых тикетов</span><strong>${num(d.openTickets || 0)}</strong></div>
          <div class="row-between"><span class="muted">Задач планировщика</span><strong>${num(jobs.length)}</strong></div>
        </div>
      </section>
      <section class="card col-6">
        <div class="card-head"><h3>Быстрые переходы</h3></div>
        <div class="card-body stack">
          <button class="btn btn-block btn-outline" data-nav="observability">${icon('pulse')} Золотые сигналы и SLO</button>
          <button class="btn btn-block btn-outline" data-nav="governance?tab=readiness">${icon('check')} Готовность к запуску</button>
          <button class="btn btn-block btn-outline" data-nav="governance?tab=roles">${icon('users')} Матрица ролей</button>
          <button class="btn btn-block btn-outline" data-nav="governance?tab=audit">${icon('lock')} Журнал аудита</button>
          <div class="alert alert-info">${icon('shield')} Мутации требуют CSRF-токен и идемпотентны по <code>Idempotency-Key</code>.</div>
        </div>
      </section>
    </div>`;
}

function schedulerTab(jobs, scheduler) {
  const enabled = scheduler?.enabled ?? scheduler?.schedulerEnabled ?? true;
  return `<section class="card">
      <div class="card-head">
        <div><h3>Планировщик</h3><div class="dim">Ops 15 мин · Fraud 30 мин · Balance 6 ч · Market 08:00 UTC · Lab 03:00 UTC · аномалии 5 мин · SLA тикетов 10 мин</div></div>
        <span class="badge badge-${enabled ? 'ok' : 'neutral'}">${enabled ? 'работает' : 'остановлен'}</span>
      </div>
      <div class="card-body flush">
        ${jobs.length ? jobs.map((j) => `<div class="list-row">
            <span class="status-dot ${!j.enabled ? 'info' : j.last_status === 'failed' ? 'critical' : j.last_status === 'ok' ? 'ok' : 'warning'}"></span>
            <div class="list-main">
              <span class="list-title">${esc(j.job_name || j.name)} <span class="dim">· ${esc(j.cadence_human || '')}</span></span>
              <span class="list-sub">${esc(j.description || '')} · последний запуск: ${j.last_run_at ? esc(timeAgo(j.last_run_at)) : 'не было'}${j.last_error ? ` · ошибка: ${esc(j.last_error)}` : ''}</span>
            </div>
            ${j.last_status ? statusBadge(j.last_status === 'failed' ? 'danger' : j.last_status === 'ok' ? 'ok' : 'warning', j.last_status) : ''}
            ${j.consecutive_failures ? `<span class="badge badge-danger">${num(j.consecutive_failures)} подряд</span>` : ''}
            <div class="row">
              <button class="btn btn-sm btn-ghost" data-run-job="${esc(j.job_name || j.name)}">${icon('play')} Запустить</button>
              <button class="btn btn-sm btn-ghost" data-toggle-job="${esc(j.job_name || j.name)}" data-enabled="${j.enabled}">${j.enabled ? 'Выключить' : 'Включить'}</button>
            </div>
          </div>`).join('') : emptyState({ title: 'Задач нет', text: 'Планировщик выключен через CRM_SCHEDULER_DISABLED=1.' })}
      </div>
    </section>`;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024 * 1024) return `${num(value / (1024 ** 3), 2)} ГБ`;
  if (value >= 1024 * 1024) return `${num(value / (1024 ** 2), 1)} МБ`;
  if (value >= 1024) return `${num(value / 1024, 0)} КБ`;
  return `${num(value)} Б`;
}

function backupsTab(backups, retention) {
  const list = (backups && backups.items) || [];
  const latestVerified = (backups && backups.latestVerified) || null;
  const preview = (retention && retention.preview) || null;
  const latest = list[0] || null;
  const totalBytes = (backups && backups.totalBytes) || 0;
  const canBackup = can('system:backup');
  const canRetain = can('system:retention');

  return `<div class="grid grid-4 mb-16">
      ${kpi({ label: 'Снимков БД', value: num(list.length), sub: backups?.backupDir || 'data/backups' })}
      ${kpi({ label: 'Объём', value: formatBytes(totalBytes), sub: 'все снимки' })}
      ${kpi({ label: 'Последний', value: latest ? timeAgo(latest.createdAt) : '—', sub: latest ? formatBytes(latest.sizeBytes) : 'бэкапов нет', tone: latest ? '' : 'warn' })}
      ${kpi({ label: 'К удалению по ретеншену', value: num(preview?.totalRowsAffected || 0), sub: 'строк по политике 90/180/365' })}
    </div>

    <div class="grid grid-12">
      <section class="card col-8">
        <div class="card-head">
          <div><h3>Горячие бэкапы</h3><div class="dim">VACUUM INTO + integrity_check + сверка head_hash аудита. Хранятся 14 последних и по одному за каждый месяц</div></div>
          <div class="row">
            ${canBackup ? `<button class="btn btn-sm btn-outline" id="backup-verify-latest">${icon('shield')} Проверить последний</button>
            <button class="btn btn-sm btn-primary" id="backup-now">${icon('download')} Сделать бэкап</button>` : ''}
          </div>
        </div>
        <div class="card-body flush">
          ${list.length ? table({
            rows: list,
            rowKey: 'file',
            columns: [
              { label: 'Файл', render: (r) => `<code class="truncate" style="display:inline-block;max-width:280px">${esc(r.file)}</code>` },
              { label: 'Создан', render: (r) => `<span class="dim">${esc(dateTime(r.createdAt))}</span>` },
              { label: 'Размер', align: 'right', render: (r) => formatBytes(r.sizeBytes) },
              { label: '', align: 'right', render: (r) => (canBackup ? `<button class="btn btn-sm btn-ghost" data-verify-backup="${esc(r.file)}">Проверить</button>` : '') },
            ],
          }) : emptyState({ iconName: 'database', title: 'Бэкапов нет', text: 'Ночная задача db_backup создаёт снимок в 02:00 UTC; можно сделать вручную.' })}
        </div>
      </section>

      <section class="card col-4">
        <div class="card-head"><div><h3>Проверка восстановления</h3><div class="dim">Снимок открывается read-only</div></div></div>
        <div class="card-body stack">
          <p class="muted">Проверка отвечает на вопрос «из этого файла действительно можно поднять CRM»: целостность страниц, число таблиц, совпадение вершины hash-цепочки аудита.</p>
          ${latestVerified
            ? `<div class="row-between"><span class="muted">Последний снимок на момент загрузки</span>
                 <span class="badge ${latestVerified.ok ? 'badge-ok' : 'badge-danger'}">${latestVerified.ok ? 'пригоден' : 'непригоден'}</span></div>
               <div class="row-between"><span class="muted">integrity_check</span><strong>${esc(latestVerified.integrity || '—')}</strong></div>
               <div class="row-between"><span class="muted">head_hash аудита</span><strong>${latestVerified.matchesHead === false ? 'расходится' : 'совпадает'}</strong></div>`
            : `<div class="alert alert-warn">${icon('alert')} Проверка восстановления не выполнялась в этой сессии. «Проверить» открывает файл read-only — это единственный способ узнать, что из него можно поднять CRM.</div>`}
          <div class="alert alert-info">${icon('shield')} Полный регламент восстановления — <code>runbooks/rb-dr-backup-restore.md</code>.</div>
        </div>
      </section>

      <section class="card col-12">
        <div class="card-head">
          <div><h3>Политика хранения</h3><div class="dim">Ничего не удаляется без предварительного подсчёта — dry-run выполняется всегда перед применением</div></div>
          <div class="row">
            ${canRetain ? `<button class="btn btn-sm btn-outline" id="retention-preview">${icon('refresh')} Пересчитать</button>
            <button class="btn btn-sm btn-danger" id="retention-run">Применить политику</button>` : ''}
          </div>
        </div>
        <div class="card-body flush">
          ${preview ? `<div class="list">${(preview.rules || []).map((r) => `<div class="list-row">
              <span class="status-dot ${r.rowsAffected > 0 ? 'warning' : 'ok'}"></span>
              <div class="list-main">
                <span class="list-title"><code>${esc(r.table)}</code> · старше ${num(r.retentionDays)} дн.</span>
                <span class="list-sub">отсечка ${esc(dateTime(r.cutoffIso))}</span>
              </div>
              <span class="badge ${r.rowsAffected > 0 ? 'badge-warn' : 'badge-neutral'}">${num(r.rowsAffected)} строк</span>
            </div>`).join('')}
            <div class="list-row">
              <span class="status-dot info"></span>
              <div class="list-main"><span class="list-title">Архивация чата Директора</span><span class="list-sub">перенос в отдельную архивную БД, затем очистка по ${num(preview.policy?.directorChatDays || 365)} дн.</span></div>
              <span class="badge badge-neutral">${num(preview.archivedDirectorChat || 0)} сообщений</span>
            </div></div>
            <div class="card-body row-between" style="border-top:1px solid var(--border)">
              <span class="muted">Итого будет затронуто строк</span>
              <strong class="tnum">${num(preview.totalRowsAffected || 0)}</strong>
            </div>` : emptyState({ title: 'Нет данных предпросмотра' })}
        </div>
      </section>
    </div>`;
}

function usersTab(users, roles) {
  return `<section class="card">
      <div class="card-head"><div><h3>Операторы CRM</h3><div class="dim">Восемь ролей из матрицы прав: владелец и семь изолированных сервисных ролей</div></div></div>
      <div class="card-body flush">
        ${users.length ? table({
          rows: users,
          rowKey: 'id',
          columns: [
            { label: 'Пользователь', render: (r) => `<div class="list-title">${esc(r.email || r.username)}</div><div class="list-sub">${esc(r.name || r.display_name || '—')}</div>` },
            { label: 'Роль', render: (r) => `<span class="badge badge-brand">${esc(r.role)}</span>` },
            {
              label: 'Доступ',
              render: (r) => (Number(r.is_active ?? 1) === 1
                ? '<span class="badge badge-ok">активен</span>'
                : `<span class="badge badge-danger">отключён</span> <span class="dim">${esc(r.disabled_at ? timeAgo(r.disabled_at) : '')}</span>`),
            },
            { label: 'Прав', align: 'right', render: (r) => num((roles.find((x) => x.id === r.role)?.permissions || []).length) },
            { label: 'Последний вход', align: 'right', render: (r) => `<span class="dim">${r.last_login_at ? esc(timeAgo(r.last_login_at)) : 'никогда'}</span>` },
            { label: 'Создан', align: 'right', render: (r) => `<span class="dim">${esc(dateTime(r.created_at))}</span>` },
            { label: '', align: 'right', render: (r) => (can('users:manage') ? `<button class="btn btn-sm btn-ghost" data-user="${esc(r.id)}">Изменить</button>` : '') },
          ],
        }) : emptyState({ title: 'Пользователей нет' })}
      </div>
    </section>`;
}

function sessionsTab(sessions) {
  return `<section class="card">
      <div class="card-head"><div><h3>Активные сессии</h3><div class="dim">Серверный реестр: JWT нельзя отозвать, сессию — можно. Cookie HttpOnly + CSRF double-submit.</div></div></div>
      <div class="card-body flush">
        ${sessions.length ? sessions.map((s) => `<div class="list-row">
            <span class="status-dot ${s.revoked_at ? 'critical' : 'ok'}"></span>
            <div class="list-main"><span class="list-title">${esc(s.email || s.actor_id)} <span class="dim">· ${esc(s.role || '')}</span></span>
            <span class="list-sub">создана ${esc(timeAgo(s.created_at))} · активность ${esc(timeAgo(s.last_seen_at))}${s.revoked_at ? ` · отозвана ${esc(timeAgo(s.revoked_at))}` : ''}</span></div>
            <span class="dim">до ${esc(dateTime(s.expires_at))}</span>
            ${s.current ? '<span class="badge badge-brand">текущая</span>' : s.revoked_at ? '<span class="badge badge-neutral">отозвана</span>' : `<button class="btn btn-sm btn-ghost" data-revoke="${esc(s.id)}">Отозвать</button>`}
          </div>`).join('') : emptyState({ title: 'Сессий нет' })}
      </div>
    </section>`;
}

function providersTab(zones, meta) {
  return `<div class="grid grid-12">
      <section class="card col-8">
        <div class="card-head"><div><h3>AI-провайдеры по зонам</h3><div class="dim">Ключ шифруется на сервере; в интерфейсе — источник, маска и отпечаток</div></div></div>
        <div class="card-body flush">
          ${table({
            rows: zones,
            rowKey: 'zone',
            columns: [
              { label: 'Зона', render: (r) => zoneBadge(r.zone) },
              { label: 'Провайдер', render: (r) => `<code>${esc(r.provider || '—')}</code>` },
              { label: 'Модель', render: (r) => `<span class="dim truncate" style="display:inline-block;max-width:220px">${esc(r.model || '—')}</span>` },
              {
                label: 'Ключ',
                render: (r) => {
                  if (!r.hasApiKey) return '<span class="badge badge-warn">fallback</span>';
                  const source = r.keySource === 'env' ? 'env' : 'vault';
                  return `<span class="badge badge-ok">${source}</span> <code class="dim">${esc(r.keyMasked || '')}</code>`;
                },
              },
              { label: 'Лимит/сутки', align: 'right', render: (r) => compact(r.dailyTokenLimit || 0) },
              { label: 'Использовано', align: 'right', render: (r) => `${compact(r.usedTokens || 0)} <span class="dim">(${num(r.utilizationPct || 0, 1)}%)</span>` },
              { label: '', align: 'right', render: (r) => (can('ai:configure') ? `<button class="btn btn-sm btn-ghost" data-provider="${esc(r.zone)}">Ключ</button>` : '') },
            ],
          })}
        </div>
      </section>
      <section class="card col-4">
        <div class="card-head"><h3>Политика провайдеров</h3></div>
        <div class="card-body stack" style="font-size:12.5px;color:var(--text-2)">
          <p class="muted">Провайдеры выбираются с учётом санкционных рисков и доступности оплаты. Отказ провайдера переводит зону в fallback-режим, а не на чужой ключ.</p>
          <div class="row-between"><span class="muted">Zero retention</span><strong>обязательно</strong></div>
          <div class="row-between"><span class="muted">Batch-скидка Lab</span><strong>−50%</strong></div>
          <div class="row-between"><span class="muted">Смена ключа</span><strong>только владелец</strong></div>
          <div class="row-between"><span class="muted">Карантин ответов</span><strong>${num(meta.retentionDays ? 180 : 180)} д</strong></div>
        </div>
      </section>
    </div>`;
}

function bindTab(container, ctx, data, zones) {
  qs('#backup-now', container)?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    setBusy(btn, true);
    try {
      const res = await api.post('/api/admin/system/backup', {}, { idempotencyKey: `backup-${Date.now()}` });
      if (res.ok) {
        toast('Бэкап создан и проверен', {
          type: 'success',
          text: `${res.backupFile} · ${formatBytes(res.sizeBytes)} · head_hash ${res.matchesHead ? 'совпадает' : 'НЕ совпадает'}`,
        });
      } else {
        toast('Бэкап не прошёл проверку', { type: 'error', text: `integrity: ${res.integrity}` });
      }
      ctx.refresh();
    } catch (err) { toastError(err); } finally { setBusy(btn, false); }
  });

  async function verifyBackup(file) {
    // Verification is read-only and must reflect the file *now*: caching the
    // response under an idempotency key would replay an old "цел" verdict.
    try {
      const res = await api.post(`/api/admin/system/backups/${encodeURIComponent(file)}/verify`, {});
      showVerification(res, file);
    } catch (err) { toastError(err); }
  }

  function showVerification(res, file) {
    openDrawer({
      title: res.ok ? 'Снимок пригоден для восстановления' : 'Снимок повреждён',
      eyebrow: file,
      body: `<div class="stack">
          <div class="metric-inline">
            <div><span class="mv">${esc(res.integrity || '—')}</span><span class="ml">integrity_check</span></div>
            <div><span class="mv">${num(res.tables || 0)}</span><span class="ml">таблиц</span></div>
            <div><span class="mv">${num(res.players || 0)}</span><span class="ml">игроков</span></div>
            <div><span class="mv">${res.matchesHead ? 'OK' : '—'}</span><span class="ml">head_hash аудита</span></div>
          </div>
          <dl class="kv">
            <dt>Ожидаемый head</dt><dd><code>${esc(String(res.expectedHeadHash || '—').slice(0, 24))}…</code></dd>
            <dt>В снимке</dt><dd><code>${esc(String(res.headHash || '—').slice(0, 24))}…</code></dd>
          </dl>
          ${res.ok ? '' : '<div class="alert alert-danger">Восстанавливать из этого файла нельзя — сделайте новый снимок.</div>'}
        </div>`,
      actions: [{ label: 'Закрыть', variant: 'btn-ghost' }],
    });
  }

  qs('#backup-verify-latest', container)?.addEventListener('click', () => {
    const latest = ((container._backups || {}).items || [])[0];
    if (!latest) { toast('Бэкапов нет', { type: 'warn' }); return; }
    verifyBackup(latest.file);
  });

  run(container, '[data-verify-backup]', (node) => verifyBackup(node.dataset.verifyBackup));

  qs('#retention-preview', container)?.addEventListener('click', () => ctx.refresh());

  qs('#retention-run', container)?.addEventListener('click', async () => {
    const preview = (container._retention || {}).preview || {};
    const ok = await confirmDialog({
      title: 'Применить политику хранения?',
      text: 'Будут безвозвратно удалены данные старше установленных сроков. Платёжные записи и аудит не затрагиваются.',
      confirmLabel: 'Удалить',
      danger: true,
      details: `<dl class="kv"><dt>Input-события</dt><dd>${num((preview.rules || []).find((r) => r.table === 'input_events')?.rowsAffected || 0)}</dd>
        <dt>Телеметрия</dt><dd>${num((preview.rules || []).find((r) => r.table === 'telemetry_metrics')?.rowsAffected || 0)}</dd>
        <dt>Сессии</dt><dd>${num((preview.rules || []).find((r) => r.table === 'sessions')?.rowsAffected || 0)}</dd>
        <dt>Всего</dt><dd><strong>${num(preview.totalRowsAffected || 0)}</strong></dd></dl>`,
      requireText: 'УДАЛИТЬ',
    });
    if (!ok) return;
    try {
      const res = await api.post('/api/admin/system/retention', {}, { idempotencyKey: `retention-${Date.now()}` });
      toast('Политика применена', {
        type: 'success',
        text: `удалено строк: ${num(res.cleanup?.totalRowsAffected || 0)}`,
      });
      ctx.refresh();
    } catch (err) { toastError(err); }
  });

  run(container, '[data-run-job]', async (node) => {
    node.disabled = true;
    try {
      await api.post(`/api/admin/scheduler/${encodeURIComponent(node.dataset.runJob)}/run`, {}, { idempotencyKey: `job-${node.dataset.runJob}-${Date.now()}` });
      toast(`Задача ${node.dataset.runJob} запущена`, { type: 'success' });
      ctx.refresh();
    } catch (err) { toastError(err); node.disabled = false; }
  });

  run(container, '[data-toggle-job]', async (node) => {
    const enabled = node.dataset.enabled !== 'true';
    try {
      await api.post(`/api/admin/scheduler/${encodeURIComponent(node.dataset.toggleJob)}/toggle`, { enabled }, { idempotencyKey: `jobtoggle-${node.dataset.toggleJob}-${enabled}` });
      toast(enabled ? 'Задача включена' : 'Задача выключена', { type: 'success' });
      ctx.refresh();
    } catch (err) { toastError(err); }
  });

  run(container, '[data-revoke]', async (node) => {
    const ok = await confirmDialog({ title: 'Отозвать сессию?', text: 'Пользователь будет разлогинен на этом устройстве.', confirmLabel: 'Отозвать', danger: true });
    if (!ok) return;
    try {
      await api.post('/api/admin/auth/sessions/revoke', { sessionId: node.dataset.revoke }, { idempotencyKey: `revoke-${node.dataset.revoke}` });
      toast('Сессия отозвана', { type: 'success' });
      ctx.refresh();
    } catch (err) { toastError(err); }
  });

  run(container, '[data-provider]', (node) => {
    const zone = node.dataset.provider;
    const row = (zones || []).find((z) => z.zone === zone) || {};
    const envManaged = row.keySource === 'env';
    openDrawer({
      title: `Ключ провайдера · ${zone}`,
      eyebrow: envManaged ? 'источник: переменная окружения' : row.hasApiKey ? 'источник: зашифрованное хранилище' : 'ключ не задан',
      body: `<div class="stack">
          <dl class="kv">
            <dt>Провайдер / модель</dt><dd><code>${esc(row.provider || '—')}</code> · ${esc(row.model || '—')}</dd>
            <dt>Текущий ключ</dt><dd>${row.hasApiKey ? `<code>${esc(row.keyMasked || '—')}</code> <span class="dim">отпечаток ${esc(row.keyFingerprint || '—')}</span>` : 'не задан'}</dd>
            <dt>Обновлён</dt><dd>${row.keyUpdatedAt ? `${esc(dateTime(row.keyUpdatedAt))} · ${esc(row.keyUpdatedBy || '—')}` : '—'}</dd>
          </dl>
          ${envManaged
            ? `<div class="alert alert-warn">${icon('alert')} Ключ задан переменной <code>ZONE_${zone.toUpperCase()}_API_KEY</code> и имеет приоритет над хранилищем: ротация через интерфейс не изменит поведение, пока переменная не удалена в окружении.</div>`
            : `<label class="field"><span class="field-label">Новый API-ключ</span>
                <input id="api-key" type="password" autocomplete="off" placeholder="вставьте ключ" />
                <span class="field-hint">Ключ шифруется AES-256-GCM и никогда не возвращается в API. Пустое поле — ключ не меняется.</span></label>
              <label class="row" style="gap:8px"><input type="checkbox" id="api-key-clear" ${row.hasApiKey ? '' : 'disabled'} />
                <span class="dim">Удалить сохранённый ключ (зона уйдёт в fallback)</span></label>`}
          <div class="alert">${icon('lock')} Смена ключа влияет только на свою зону — изоляция ключей обязательна по ТЗ.</div>
        </div>`,
      actions: envManaged
        ? [{ label: 'Закрыть', variant: 'btn-ghost' }]
        : [
            { label: 'Отмена', variant: 'btn-ghost' },
            {
              label: 'Сохранить',
              variant: 'btn-primary',
              close: false,
              onClick: async ({ close }) => {
                const apiKey = (qs('#api-key')?.value || '').trim();
                const clearApiKey = Boolean(qs('#api-key-clear')?.checked);
                if (!apiKey && !clearApiKey) { toast('Введите ключ или отметьте удаление', { type: 'warn' }); return; }
                try {
                  await api.post(
                    `/api/admin/ai/zones/${zone}/config`,
                    clearApiKey ? { clearApiKey: true } : { apiKey },
                    { idempotencyKey: `key-${zone}-${Date.now()}` }
                  );
                  toast(clearApiKey ? 'Ключ удалён' : 'Ключ сохранён', { type: 'success' });
                  close();
                  ctx.refresh();
                } catch (err) {
                  if (err && (err.status === 422 || err.code)) toast(err.message || 'Ключ отклонён', { type: 'error' });
                  else toastError(err);
                }
              },
            },
          ],
    });
  });

  run(container, '[data-user]', (node) => openUserDialog(ctx, (data.users || []).find((u) => u.id === node.dataset.user), data.roles || []));
  run(container, '[data-nav]', (node) => { location.hash = `#/${node.dataset.nav}`; });
}

function openUserDialog(ctx, user = null, roles = []) {
  const roleOptions = roles.length ? roles : [{ id: 'admin', name: 'Администратор' }];
  const active = user ? Number(user.is_active ?? 1) === 1 : true;
  openDrawer({
    title: user ? `Пользователь ${user.email || user.username}` : 'Новый пользователь',
    eyebrow: user ? `${user.role}${active ? '' : ' · доступ отключён'}` : 'наименьшие привилегии',
    body: `<form class="stack" id="user-form">
        <label class="field"><span class="field-label">Email</span><input name="email" type="email" required value="${esc(user?.email || user?.username || '')}" ${user ? 'readonly' : ''} /></label>
        <label class="field"><span class="field-label">Имя</span><input name="name" value="${esc(user?.name || user?.display_name || '')}" /></label>
        <label class="field"><span class="field-label">Роль</span>
          <select name="role">${roleOptions.map((r) => `<option value="${r.id}" ${user?.role === r.id ? 'selected' : ''}>${esc(r.name || r.id)}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">${user ? 'Новый пароль (необязательно)' : 'Пароль'}</span>
          <input name="password" type="password" minlength="12" ${user ? '' : 'required'} />
          <span class="field-hint">Минимум 12 символов; хэш — scrypt с солью и timing-safe сравнением. Смена пароля отзывает все сессии.</span></label>
        ${user ? `<label class="row" style="gap:8px"><input type="checkbox" id="user-disabled" ${active ? '' : 'checked'} />
            <span class="dim">Доступ отключён: вход и активные сессии блокируются немедленно</span></label>` : ''}
      </form>`,
    actions: [
      { label: 'Отмена', variant: 'btn-ghost' },
      {
        label: user ? 'Сохранить' : 'Создать',
        variant: 'btn-primary',
        close: false,
        onClick: async ({ close }) => {
          const fd = new FormData(qs('#user-form'));
          const payload = { name: fd.get('name'), role: fd.get('role') };
          if (fd.get('password')) payload.password = fd.get('password');
          if (user) payload.isActive = !qs('#user-disabled')?.checked;
          try {
            if (user) await api.patch(`/api/admin/users/${user.id}`, payload);
            else await api.post('/api/admin/users', { ...payload, email: fd.get('email'), username: fd.get('email') });
            toast(user ? 'Пользователь обновлён' : 'Пользователь создан', { type: 'success' });
            close();
            ctx.refresh();
          } catch (err) { toastError(err); }
        },
      },
    ],
  });
}
