import { api, downloadFile, downloadJson } from '../core/api.js';
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
  const [data, legal] = await Promise.all([
    api.get('/api/admin/governance'),
    // Legal/DSAR data is a second aggregate: loaded only for the tab that needs it,
    // so opening the audit log does not pay for the consent statistics.
    tab === 'legal' ? api.get('/api/admin/legal') : Promise.resolve(null),
  ]);
  if (ctx.isStale()) return;
  container.dataset.loaded = '1';
  container._data = data;
  container._legal = legal;

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
      ${[['audit', 'Аудит'], ['legal', 'Право и приватность'], ['ai', 'AI-политика'], ['compliance', 'Комплаенс'], ['roles', 'Роли'], ['readiness', 'Готовность']]
        .map(([v, l]) => `<button type="button" class="tab ${tab === v ? 'active' : ''}" data-tab="${v}">${l}</button>`).join('')}
    </div>
    <div id="tab-body">${renderTab(tab, data, legal)}</div>
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

function renderTab(tab, d, legal) {
  if (tab === 'legal') return legalTab(legal || {}, d);
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

/* ------------------------------ ПРАВО / DSAR ------------------------------ */

const DOC_LABELS = {
  tos: 'Условия использования',
  privacy_policy: 'Политика конфиденциальности',
  eula: 'Лицензионное соглашение',
  cookie_policy: 'Cookie Policy',
};
const REQUEST_LABELS = { export: 'Доступ (экспорт)', erasure: 'Удаление' };
const SOURCE_LABELS = { operator: 'оператор', player_client: 'из клиента' };

/** Deadline bar: green → amber → red as the 30-day statutory clock runs out. */
function slaBar(request) {
  const requested = new Date(request.requested_at).getTime();
  const due = new Date(request.due_at).getTime();
  const now = Date.now();
  const elapsedPct = Math.min(100, Math.max(0, ((now - requested) / Math.max(1, due - requested)) * 100));
  const tone = request.isOverdue ? 'danger' : request.daysLeft <= 5 ? 'warn' : 'ok';
  const label = request.isOverdue
    ? `просрочен на ${Math.max(1, Math.ceil((now - due) / 86400000))} дн.`
    : `${request.daysLeft} дн. до срока`;
  const hints = {
    ok: 'Срок соблюдается',
    warn: 'Срок подходит к концу',
    danger: 'Срок 152-ФЗ / GDPR нарушен',
  };
  return `<div class="sla" title="${esc(hints[tone])}">
      <span class="sla-track"><span class="sla-fill ${tone}" style="width:${elapsedPct.toFixed(1)}%"></span></span>
      <span class="sla-label ${tone}">${esc(label)}</span>
    </div>`;
}

function legalTab(legal, d) {
  const queue = legal.privacyQueue || {};
  const requests = legal.privacyRequests || [];
  const openRequests = requests.filter((r) => r.isOpen);
  const docs = legal.documents || [];
  const dpa = legal.dpaRegistry || [];
  const ageGates = legal.ageGateRules || {};
  const consents = legal.consentStats || [];
  const retention = legal.retention || d.compliance || {};
  const canHandle = can('players:erase');
  const canIntake = can('players:read');

  const regionRows = consents.map((c, i) => ({ id: `${c.region}-${i}`, ...c }));
  const gateRows = Object.entries(ageGates).map(([region, rule]) => ({
    id: region,
    region,
    minAge: rule.minAgeWithoutParentalConsent,
    law: rule.law,
  }));

  return `<div class="grid grid-4 mb-16">
      ${kpi({ label: 'Открытых запросов', value: num(queue.open || 0), sub: `срок ${num(queue.slaDays || 30)} дн.`, tone: (queue.open || 0) > 0 ? 'warn' : '' })}
      ${kpi({ label: 'Просрочено', value: num(queue.overdue || 0), sub: 'нарушение срока', tone: (queue.overdue || 0) > 0 ? 'danger' : '' })}
      ${kpi({ label: 'Истекают ≤ 5 дней', value: num(queue.dueSoon || 0), sub: 'требуют внимания' })}
      ${kpi({ label: 'Обработано', value: num((queue.completed || 0) + (queue.rejected || 0)), sub: `отклонено: ${num(queue.rejected || 0)}` })}
    </div>

    <div class="grid grid-12">
      <section class="card col-8">
        <div class="card-head">
          <div><h3>Запросы субъектов ПДн</h3><div class="dim">Право на доступ и право на удаление: 30 дней по 152-ФЗ и GDPR Art. 12(3)</div></div>
          ${canIntake ? `<button class="btn btn-sm btn-primary" id="new-dsar">${icon('plus')} Запрос</button>` : ''}
        </div>
        <div class="card-body flush">
          ${openRequests.length
            ? `<div class="list">${openRequests.map((r) => `<div class="list-row dsar-row">
                <span class="status-dot ${r.isOverdue ? 'critical' : r.daysLeft <= 5 ? 'warning' : 'ok'}"></span>
                <div class="list-main">
                  <span class="list-title">${esc(REQUEST_LABELS[r.request_type] || r.request_type)} · <code>${esc(r.player_id)}</code></span>
                  <span class="list-sub">${esc(r.region)} · ${esc(SOURCE_LABELS[r.source] || r.source || 'оператор')} · создан ${esc(dateTime(r.requested_at))} · статус ${esc(r.status)}</span>
                  ${slaBar(r)}
                </div>
                <div class="row">
                  ${canHandle ? `<button class="btn btn-sm btn-ghost" data-dsar-start="${esc(r.id)}">В работу</button>
                  <button class="btn btn-sm btn-outline" data-dsar-fulfil="${esc(r.id)}" data-dsar-type="${esc(r.request_type)}">
                    ${r.request_type === 'export' ? 'Выгрузить' : 'Удалить ПДн'}</button>
                  <button class="btn btn-sm btn-ghost" data-dsar-reject="${esc(r.id)}">Отклонить</button>` : '<span class="dim">только просмотр</span>'}
                </div>
              </div>`).join('')}</div>`
            : emptyState({ iconName: 'check', title: 'Открытых запросов нет', text: 'Поступают из клиента и вручную от оператора; срок начинает идти с момента создания.' })}
        </div>
      </section>

      <section class="card col-4">
        <div class="card-head"><h3>Документы</h3></div>
        <div class="card-body flush">
          ${docs.length ? docs.map((doc) => `<div class="list-row">
              <div class="list-main">
                <span class="list-title">${esc(DOC_LABELS[doc.doc_type] || doc.doc_type)}</span>
                <span class="list-sub">${esc(doc.lang.toUpperCase())} · v${esc(doc.version)} · ${esc(dateTime(doc.published_at))}${doc.requires_reconsent ? ' · требует пере-согласия' : ''}</span>
              </div>
              <button class="btn btn-sm btn-ghost" data-doc="${esc(doc.id)}">Открыть</button>
            </div>`).join('') : emptyState({ title: 'Документов нет' })}
        </div>
      </section>

      <section class="card col-6">
        <div class="card-head"><div><h3>Возрастные гейты и сроки хранения</h3><div class="dim">Порог согласия опекуна зависит от региона игрока</div></div></div>
        <div class="card-body flush">
          ${table({
            rows: gateRows,
            rowKey: 'id',
            columns: [
              { label: 'Регион', render: (r) => `<span class="badge badge-neutral">${esc(r.region)}</span>` },
              { label: 'Без согласия опекуна', align: 'right', render: (r) => `${num(r.minAge)} лет` },
              { label: 'Правовая база', render: (r) => `<span class="dim">${esc(r.law || '—')}</span>` },
            ],
          })}
          <div class="card-body stack" style="border-top:1px solid var(--border)">
            <div class="row-between"><span class="muted">Input-события</span><strong>${num(retention.inputEventsDays || 90)} дн.</strong></div>
            <div class="row-between"><span class="muted">Телеметрия и ИИ</span><strong>${num(retention.telemetryDays || retention.retentionTelemetryDays || 180)} дн.</strong></div>
            <div class="row-between"><span class="muted">Чат директора</span><strong>${num(retention.directorChatDays || retention.retentionDirectorDays || 365)} дн.</strong></div>
            <div class="row-between"><span class="muted">Срок ответа на запрос</span><strong>${num(retention.deletionSlaDays || queue.slaDays || 30)} дн.</strong></div>
          </div>
        </div>
      </section>

      <section class="card col-6">
        <div class="card-head"><div><h3>Статистика согласий</h3><div class="dim">По регионам: сколько согласий, несовершеннолетних с опекуном, opt-in</div></div></div>
        <div class="card-body flush">
          ${regionRows.length ? table({
            rows: regionRows,
            rowKey: 'id',
            columns: [
              { label: 'Регион', render: (r) => `<span class="badge badge-neutral">${esc(r.region)}</span>` },
              { label: 'Согласий', align: 'right', render: (r) => num(r.consents_count) },
              { label: 'Несоверш. с опекуном', align: 'right', render: (r) => num(r.minors_with_parental_consent) },
              { label: 'Аналитика', align: 'right', render: (r) => pct(((r.analytics_opt_in_count || 0) / Math.max(1, r.consents_count)) * 100, 0) },
              { label: 'Маркетинг', align: 'right', render: (r) => pct(((r.marketing_opt_in_count || 0) / Math.max(1, r.consents_count)) * 100, 0) },
            ],
          }) : emptyState({ title: 'Согласий нет' })}
        </div>
      </section>

      <section class="card col-12">
        <div class="card-head"><div><h3>Реестр DPA с провайдерами</h3><div class="dim">Без подписанного DPA и zero-retention ПДн в модель не отправляются</div></div></div>
        <div class="card-body flush">
          ${dpa.length ? table({
            rows: dpa.map((r) => ({ id: r.provider, ...r })),
            rowKey: 'id',
            columns: [
              { label: 'Провайдер', render: (r) => `<code>${esc(r.provider)}</code>` },
              { label: 'Страна', render: (r) => esc(r.country) },
              { label: 'DPA', render: (r) => statusBadge(r.dpa_status === 'signed' ? 'ok' : 'warning', r.dpa_status) },
              { label: 'Zero retention', render: (r) => (r.zero_data_retention ? statusBadge('ok', 'да') : statusBadge('danger', 'нет')) },
              { label: 'ПДн разрешены', render: (r) => (r.pii_allowed ? statusBadge('warn', 'да') : statusBadge('ok', 'нет')) },
              { label: 'Примечание', render: (r) => `<span class="dim">${esc(r.notes || '')}</span>` },
            ],
          }) : emptyState({ title: 'Реестр пуст' })}
        </div>
      </section>
    </div>`;
}

function openDsarIntakeDialog(ctx) {
  openDrawer({
    title: 'Новый запрос субъекта ПДн',
    eyebrow: '30 дней с момента регистрации',
    body: `<form class="stack" id="dsar-form">
        <label class="field"><span class="field-label">ID игрока</span>
          <input name="playerId" required placeholder="plr_0091" autocomplete="off" /></label>
        <label class="field"><span class="field-label">Тип запроса</span>
          <select name="requestType">
            <option value="export">Доступ — выдать копию данных</option>
            <option value="erasure">Удаление — стереть ПДн</option>
          </select></label>
        <label class="field"><span class="field-label">Основание / канал поступления</span>
          <textarea name="reason" placeholder="Письмо на privacy@, тикет поддержки, запрос из клиента"></textarea></label>
        <div class="alert">${icon('clock')} Срок 30 дней. Запрос появится в очереди и попадёт в аудит; удаление выполняет человек.</div>
      </form>`,
    actions: [
      { label: 'Отмена', variant: 'btn-ghost' },
      {
        label: 'Зарегистрировать',
        variant: 'btn-primary',
        close: false,
        onClick: async ({ close }) => {
          const fd = new FormData(qs('#dsar-form'));
          const playerId = String(fd.get('playerId') || '').trim();
          if (!playerId) { toast('Укажите ID игрока', { type: 'warn' }); return; }
          try {
            await api.post('/api/admin/privacy/requests', {
              playerId,
              requestType: fd.get('requestType'),
              reason: fd.get('reason'),
            }, { idempotencyKey: `dsar-${playerId}-${fd.get('requestType')}-${Date.now()}` });
            toast('Запрос зарегистрирован', { type: 'success' });
            close();
            ctx.refresh();
          } catch (err) { toastError(err); }
        },
      },
    ],
  });
}

function openLegalDocument(container, docId) {
  const doc = ((container._legal || {}).documents || []).find((d) => d.id === docId);
  if (!doc) return;
  openDrawer({
    title: DOC_LABELS[doc.doc_type] || doc.doc_type,
    eyebrow: `${doc.lang.toUpperCase()} · v${doc.version} · ${dateTime(doc.published_at)}`,
    wide: true,
    body: `<div class="stack">
        ${doc.requires_reconsent ? `<div class="alert alert-warn">${icon('alert')} Публикация этой версии требует повторного согласия игроков.</div>` : ''}
        <pre class="code-block" style="max-height:60vh;white-space:pre-wrap">${esc(doc.content_md || '')}</pre>
      </div>`,
    actions: [{ label: 'Закрыть', variant: 'btn-ghost' }],
  });
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
  const legal = container._legal || {};

  qs('#new-dsar', container)?.addEventListener('click', () => openDsarIntakeDialog(ctx));

  run(container, '[data-doc]', (node) => openLegalDocument(container, node.dataset.doc));

  run(container, '[data-dsar-start]', async (node) => {
    try {
      await api.post(`/api/admin/privacy/requests/${node.dataset.dsarStart}/start`, {}, {
        idempotencyKey: `dsar-start-${node.dataset.dsarStart}`,
      });
      toast('Запрос взят в работу', { type: 'success' });
      ctx.refresh();
    } catch (err) { toastError(err); }
  });

  run(container, '[data-dsar-fulfil]', async (node) => {
    const id = node.dataset.dsarFulfil;
    const isErase = node.dataset.dsarType === 'erasure';
    const request = (legal.privacyRequests || []).find((r) => r.id === id) || {};
    const ok = await confirmDialog({
      title: isErase ? 'Удалить персональные данные?' : 'Выдать копию данных игроку?',
      text: isErase
        ? 'ПДн будут стёрты в основной и архивной БД. Платёжные записи сохранятся обезличенными — этого требует налоговый учёт. Действие необратимо.'
        : 'Будет сформирован полный пакет данных субъекта (ст. 15 GDPR / 152-ФЗ) и зафиксирован факт выдачи.',
      confirmLabel: isErase ? 'Удалить ПДн' : 'Выгрузить',
      danger: isErase,
      details: `<dl class="kv"><dt>Игрок</dt><dd><code>${esc(request.player_id || '')}</code></dd>
        <dt>Срок</dt><dd>${esc(request.due_at ? dateTime(request.due_at) : '—')}</dd></dl>`,
      requireText: isErase ? 'УДАЛИТЬ' : '',
    });
    if (!ok) return;
    try {
      const res = await api.post(`/api/admin/privacy/requests/${id}/fulfil`, {}, {
        idempotencyKey: `dsar-fulfil-${id}`,
      });
      if (res.dataPackage) {
        downloadJson(res.dataPackage, `dsar-${request.player_id || id}.json`);
        toast('Пакет данных сформирован и скачан', { type: 'success' });
      } else {
        toast('ПДн удалены, запрос закрыт', { type: 'success' });
      }
      ctx.refresh();
    } catch (err) { toastError(err); }
  });

  run(container, '[data-dsar-reject]', async (node) => {
    const reason = await promptDialog({
      title: 'Отклонить запрос',
      label: 'Правовое основание отказа',
      placeholder: 'Например: запрос не идентифицирован, документ не подтверждает личность',
      confirmLabel: 'Отклонить',
      danger: true,
      required: true,
      minLength: 5,
      hint: 'Отказ фиксируется в аудите и доступен при проверке регулятора.',
    });
    if (!reason) return;
    try {
      await api.post(`/api/admin/privacy/requests/${node.dataset.dsarReject}/reject`, { reason }, {
        idempotencyKey: `dsar-reject-${node.dataset.dsarReject}`,
      });
      toast('Запрос отклонён', { type: 'success' });
      ctx.refresh();
    } catch (err) { toastError(err); }
  });

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
