import { api, downloadFile } from '../core/api.js';
import { esc, num, pct, money, timeAgo, dateTime, compact } from '../core/format.js';
import {
  qs, qsa, kpi, card, table, statusBadge, zoneBadge, skeleton, emptyState, openDrawer,
  openJson, toast, toastError, run,
} from '../core/ui.js';
import { icon } from '../core/icons.js';
import { can } from '../core/store.js';

export async function render(container, ctx) {
  const tab = ctx.query.tab || 'audit';
  if (!container.dataset.loaded) container.innerHTML = skeleton('page');
  const data = await api.get('/api/admin/governance');
  if (ctx.isStale()) return;
  container.dataset.loaded = '1';
  container._data = data;

  const audit = data.audit || {};
  container.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Governance</h2>
        <p>Аудит с hash-цепочкой, AI-политика, комплаенс 152-ФЗ и AGE_GATE, матрица ролей и готовность к запуску.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-sm btn-outline" id="verify-chain">${icon('shield')} Проверить цепочку</button>
      </div>
    </div>

    <div class="grid grid-4 mb-16">
      ${kpi({ label: 'Записей аудита', value: compact(audit.total || 0) })}
      ${kpi({ label: 'Целостность', value: audit.verified === false ? '<span class="trend-down">нарушена</span>' : '<span class="trend-up">OK</span>', sub: 'hash-chain sha256' })}
      ${kpi({ label: 'Ролей', value: num((data.roles || []).length) })}
      ${kpi({ label: 'Bootstrap админ', value: (data.policy?.bootstrapAdmin || {}).email || '—', sub: 'владелец' })}
    </div>

    <div class="tabs mb-16">
      ${[['audit', 'Аудит'], ['ai', 'AI-политика'], ['compliance', 'Комплаенс'], ['roles', 'Роли'], ['readiness', 'Готовность']]
        .map(([v, l]) => `<button type="button" class="tab ${tab === v ? 'active' : ''}" data-tab="${v}">${l}</button>`).join('')}
    </div>
    <div id="tab-body">${renderTab(tab, data)}</div>
  `;

  qsa('[data-tab]', container).forEach((btn) => btn.addEventListener('click', () => {
    ctx.setQuery('tab', btn.dataset.tab);
    ctx.refresh();
  }));

  qs('#verify-chain', container).addEventListener('click', async () => {
    try {
      const res = await api.get('/api/admin/audit/verify');
      toast(res.valid ? 'Цепочка целостна' : 'Цепочка нарушена', {
        type: res.valid ? 'success' : 'error',
        text: `Проверено записей: ${num(res.checked)}`,
      });
      if (!res.valid) openJson('Нарушение целостности', res, 'audit/verify');
    } catch (err) { toastError(err); }
  });

  bindTab(container, ctx);
}

function renderTab(tab, d) {
  if (tab === 'ai') return aiTab(d);
  if (tab === 'compliance') return complianceTab(d);
  if (tab === 'roles') return rolesTab(d);
  if (tab === 'readiness') return readinessTab(d);
  return auditTab(d);
}

function auditTab(d) {
  const log = d.recentAudit || [];
  return `<div class="grid grid-12">
      <section class="card col-8">
        <div class="card-head"><div><h3>Журнал аудита</h3><div class="dim">Каждая запись связана с предыдущей: изменение задним числом ломает цепочку</div></div>
          <button class="btn btn-sm btn-outline" data-csv="audit">${icon('download')} CSV</button></div>
        <div class="card-body flush">
          ${table({
            rows: log,
            rowKey: 'id',
            onRow: true,
            columns: [
              { label: 'Когда', render: (r) => `<span class="dim">${esc(dateTime(r.created_at))}</span>` },
              { label: 'Актор', render: (r) => `<div class="list-title">${esc(r.actor_email || r.actor_id || 'system')}</div><div class="list-sub">${esc(r.actor_role || '')}</div>` },
              { label: 'Действие', render: (r) => `<code>${esc(r.action)}</code>` },
              { label: 'Объект', render: (r) => `<span class="dim">${esc(r.entity_type || '')} ${esc(String(r.entity_id || '').slice(0, 8))}</span>` },
              { label: 'Hash', align: 'right', render: (r) => `<code class="dim">${esc(String(r.hash || '').slice(0, 10))}…</code>` },
            ],
          })}
        </div>
      </section>
      <section class="card col-4">
        <div class="card-head"><h3>Действия по типам</h3></div>
        <div class="card-body">
          ${(d.auditByAction || []).length ? barRowsLocal((d.auditByAction || []).map((a) => ({ label: a.action, value: a.cnt }))) : emptyState({ title: 'Нет данных' })}
          <div class="divider"></div>
          <div class="alert alert-info">${icon('shield')} Retention: 365 дней в горячей БД, дальше — архив с проверяемыми хешами.</div>
        </div>
      </section>
    </div>`;
}

function aiTab(d) {
  const p = d.policy || {};
  return `<div class="grid grid-12">
      <section class="card col-7">
        <div class="card-head"><h3>AI-политика</h3><span class="badge badge-brand">human-in-the-loop</span></div>
        <div class="card-body stack">
          <div class="kv-block">
            ${(p.rules || [
              'ИИ только предлагает: ни одно действие не применяется без подтверждения человека',
              'ИИ никогда не упоминается игрокам и не имеет канала связи с клиентом',
              'Пять зон изолированы: ключи, схемы, промпты и лимиты не пересекаются',
              'Промпт-инъекции отсекаются блоком DATA и валидацией JSON Schema',
              'Ответ, не прошедший схему, уходит в карантин, а не в чат директора',
            ]).map((r) => `<div class="list-row"><span class="status-dot ok"></span><div class="list-main"><span class="list-title">${esc(r)}</span></div></div>`).join('')}
          </div>
          <div class="field-label">Лимиты провайдеров в сутки</div>
          ${table({
            rows: (d.aiBudgets || []).map((b) => ({ id: b.zone, ...b })),
            rowKey: 'id',
            columns: [
              { label: 'Зона', render: (r) => zoneBadge(r.zone) },
              { label: 'Лимит', align: 'right', render: (r) => compact(r.limit) },
              { label: 'Использовано', align: 'right', render: (r) => compact(r.used) },
              { label: 'Осталось', align: 'right', render: (r) => compact(r.remaining) },
              { label: 'Стоимость', align: 'right', render: (r) => money(r.costUsd) },
            ],
          })}
        </div>
      </section>
      <section class="card col-5">
        <div class="card-head"><h3>Карантин и валидация</h3></div>
        <div class="card-body stack">
          <div class="row-between"><span class="muted">Ответов в карантине</span><strong>${num(p.quarantinedCount || 0)}</strong></div>
          <div class="row-between"><span class="muted">Схема</span><code>status|summary|findings[]|next_questions[]</code></div>
          <div class="row-between"><span class="muted">Окно истории директора</span><strong>${num(p.directorWindowHours || 72)} ч</strong></div>
          <div class="row-between"><span class="muted">Max AI-действий без человека</span><strong>0</strong></div>
          <div class="divider"></div>
          <div class="callout">${icon('alert')} Любая попытка зоны изменить <code>MATCH_RULES</code>, выдать бан или отправить пуш блокируется на уровне прав, а не промпта.</div>
        </div>
      </section>
    </div>`;
}

function complianceTab(d) {
  const c = d.compliance || {};
  return `<div class="grid grid-12">
      <section class="card col-6">
        <div class="card-head"><h3>Резидентность данных</h3></div>
        <div class="card-body flush">
          ${table({
            rows: (d.residency || []).map((r) => ({ id: r.region, ...r })),
            rowKey: 'id',
            columns: [
              { label: 'Регион', render: (r) => `<span class="badge badge-neutral">${esc(r.region)}</span>` },
              { label: 'Хранилище', render: (r) => esc(r.storage) },
              { label: 'Разрешено', render: (r) => statusBadge(r.allowed ? 'ok' : 'danger', r.allowed ? 'да' : 'нет') },
              { label: 'Примечание', render: (r) => `<span class="dim">${esc(r.note || '')}</span>` },
            ],
          })}
        </div>
      </section>
      <section class="card col-6">
        <div class="card-head"><h3>AGE_GATE и согласия</h3></div>
        <div class="card-body stack">
          <div class="row-between"><span class="muted">Минимальный возраст</span><strong>${num(c.minAge || 13)}</strong></div>
          <div class="row-between"><span class="muted">Требуется согласие опекуна</span><strong>${c.guardianUnder || 16} лет и младше</strong></div>
          <div class="row-between"><span class="muted">Хранение input-событий</span><strong>${num(c.retentionInputDays || 90)} дней</strong></div>
          <div class="row-between"><span class="muted">Хранение телеметрии / ИИ</span><strong>${num(c.retentionTelemetryDays || 180)} дней</strong></div>
          <div class="row-between"><span class="muted">Хранение переписки директора</span><strong>${num(c.retentionDirectorDays || 365)} дней</strong></div>
          <div class="divider"></div>
          <div class="alert alert-warn">${icon('alert')} При резиденции вне РФ запись матча блокируется, а игрок получает сообщение о недоступности региона.</div>
        </div>
      </section>
    </div>`;
}

function rolesTab(d) {
  const roles = d.roles || [];
  return `<div class="grid grid-12">
      <section class="card col-12">
        <div class="card-head"><div><h3>Матрица ролей</h3><div class="dim">Наименьшие привилегии: 8 ролей, ~45 прав, зональные права отдельно</div></div></div>
        <div class="card-body flush">
          ${table({
            rows: roles,
            rowKey: 'id',
            columns: [
              { label: 'Роль', render: (r) => `<div class="list-title">${esc(r.name || r.id)}</div><div class="list-sub">${esc(r.description || '')}</div>` },
              { label: 'ID', render: (r) => `<code>${esc(r.id)}</code>` },
              { label: 'Прав', align: 'right', render: (r) => num((r.permissions || []).length) },
              { label: 'Вкладки', align: 'right', render: (r) => num((r.tabs || []).length) },
              { label: 'Пользователей', align: 'right', render: (r) => num(r.users || 0) },
              { label: '', align: 'right', render: (r) => `<button class="btn btn-sm btn-ghost" data-role="${esc(r.id)}">Права</button>` },
            ],
          })}
        </div>
      </section>
    </div>`;
}

function readinessTab(d) {
  const r = d.readiness || {};
  const groups = d.groups || r.groups || [];
  return `<div class="grid grid-12">
      <section class="card col-4">
        <div class="card-head"><h3>Оценка готовности</h3></div>
        <div class="card-body">
          <div class="big-score ${r.scorePct >= 90 ? 'ok' : r.scorePct >= 70 ? 'warn' : 'danger'}">${Math.round(r.scorePct || 0)}<small>/100</small></div>
          <div class="dim center mb-16">${r.passedCount || 0} из ${r.totalCount || 0} проверок</div>
          <div class="alert ${r.readyForLaunch ? 'alert-success' : 'alert-warn'}">${icon(r.readyForLaunch ? 'check' : 'alert')}
            ${r.readyForLaunch ? 'Все блокирующие пункты закрыты.' : 'Есть блокирующие пункты — запуск не рекомендован.'}</div>
        </div>
      </section>
      <section class="card col-8">
        <div class="card-head"><h3>Чек-лист по доменам</h3></div>
        <div class="card-body flush">
          ${groups.map((g) => `<div class="check-group">
              <div class="check-group-head"><span>${esc(g.name)}</span><span class="dim">${g.passed}/${g.total}</span></div>
              ${(g.items || []).map((i) => `<div class="list-row">
                  <span class="status-dot ${i.passed ? 'ok' : 'warning'}"></span>
                  <div class="list-main"><span class="list-title">${esc(i.title)}</span>
                  <span class="list-sub">${esc(i.detail || '')}${i.id ? ` · ${esc(i.id)}` : ''}</span></div>
                  ${i.passed ? '' : '<span class="badge badge-warn">не закрыто</span>'}
                </div>`).join('')}
            </div>`).join('') || emptyState({ title: 'Чек-лист пуст' })}
        </div>
      </section>
    </div>`;
}

function barRowsLocal(items) {
  const max = Math.max(1, ...items.map((i) => Number(i.value) || 0));
  return `<div class="bars">${items.map((i) => `<div class="bar-row">
      <span class="bar-label">${esc(i.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${((Number(i.value) || 0) / max) * 100}%"></span></span>
      <span class="bar-value tnum">${num(i.value)}</span>
    </div>`).join('')}</div>`;
}

function bindTab(container, ctx) {
  run(container, '[data-csv]', (node) => {
    downloadFile(`/api/admin/exports/${node.dataset.csv}.csv`, `topspin-${node.dataset.csv}-${new Date().toISOString().slice(0, 10)}.csv`);
  });
  run(container, '[data-role]', (node) => {
    const data = container._data;
    const r = (data?.roles || []).find((x) => x.id === node.dataset.role);
    if (!r) return;
    openDrawer({
      title: r.name || r.id,
      eyebrow: `role · ${r.id}`,
      body: `<div class="stack">
          <p class="muted">${esc(r.description || '')}</p>
          <div class="field-label">Права (${(r.permissions || []).length})</div>
          <div class="tag-list">${(r.permissions || []).map((p) => `<span class="chip"><code>${esc(p)}</code></span>`).join('') || '<span class="dim">—</span>'}</div>
          <div class="field-label">Доступные вкладки</div>
          <div class="tag-list">${(r.tabs || []).map((t) => `<span class="chip">${esc(t)}</span>`).join('') || '<span class="dim">—</span>'}</div>
        </div>`,
      actions: [{ label: 'Закрыть', variant: 'btn-ghost' }],
    });
  });
}
