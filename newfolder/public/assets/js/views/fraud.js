import { api } from '../core/api.js';
import { esc, num, pct, timeAgo, dateTime, truncate, statusLabel, debounce } from '../core/format.js';
import {
  qs, qsa, kpi, card, table, statusBadge, zoneBadge, riskBar, barRows, skeleton,
  emptyState, openDrawer, promptDialog, toast, toastError, run, pager, bindPager, bindRowClicks,
} from '../core/ui.js';
import { icon } from '../core/icons.js';
import { can } from '../core/store.js';

export async function render(container, ctx) {
  const page = Number(ctx.query.page || 1);
  const status = ctx.query.status || 'all';
  const q = ctx.query.q || '';

  if (!container.dataset.loaded) container.innerHTML = skeleton('page');
  const [zone, cases] = await Promise.all([
    api.get('/api/admin/zones/fraud'),
    api.get(`/api/admin/fraud/cases?page=${page}&pageSize=12&status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`),
  ]);
  if (ctx.isStale()) return;
  container.dataset.loaded = '1';

  const counts = zone.counts || {};
  const items = cases.items || [];
  const statusCounts = cases.statusCounts || {};

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Fraud · очередь кейсов</h2>
        <p>Восемь детекторов формируют risk score. Автоматические баны архитектурно отключены: санкцию выставляет только человек, с записью в аудит.</p>
      </div>
      <div class="page-actions">
        <span class="badge badge-ok">${icon('shield')} автобаны: выключены</span>
        ${can('zone:fraud:run') || can('zones:run_all') ? `<button class="btn btn-sm btn-primary" id="run-zone">${icon('play')} Пересчитать зону</button>` : ''}
      </div>
    </div>

    <div class="grid grid-5 mb-16">
      ${kpi({ label: 'Всего кейсов', value: num(counts.totalCases || 0) })}
      ${kpi({ label: 'Открыто', value: num(counts.openCases || 0), sub: 'ожидают решения человека' })}
      ${kpi({ label: 'Высокий риск', value: num(counts.highRiskOpen || 0), sub: 'risk ≥ 0.75' })}
      ${kpi({ label: 'Подтверждён фрод', value: num(counts.confirmedFraud || 0) })}
      ${kpi({ label: 'Ложные срабатывания', value: num(counts.falsePositives || 0), sub: 'калибровка детекторов' })}
    </div>

    <div class="grid grid-12">
      <section class="card col-8">
        <div class="card-head">
          <div><h3>Кейсы</h3><div class="dim">Каждый кейс — сигналы, confidence и история разборов</div></div>
        </div>
        <div class="card-body flush">
          <div class="toolbar" style="padding:12px 14px 0;margin:0">
            <div class="segmented">
              ${[['all', 'Все'], ['open', 'Открытые'], ['confirmed_fraud', 'Подтверждённые'], ['false_positive', 'Ложные']]
                .map(([v, l]) => `<button type="button" data-status="${v}" class="${status === v ? 'active' : ''}">${l}${statusCounts[v] ? ` · ${statusCounts[v]}` : ''}</button>`)
                .join('')}
            </div>
            <input class="input-inline grow" id="case-search" type="search" placeholder="Поиск по игроку, типу, ID…" value="${esc(q)}" />
          </div>
          ${table({
            rows: items,
            rowKey: 'id',
            onRow: true,
            empty: 'Кейсов по фильтру нет',
            columns: [
              { label: 'Игрок', render: (r) => `<div class="list-title">${esc(r.player_alias || r.player_id || '—')}</div><div class="list-sub">${esc(r.region)} · ${esc(r.case_type)}</div>` },
              { label: 'Риск', render: (r) => `<span class="row">${riskBar(r.risk_score)}<span class="tnum dim">${Number(r.risk_score).toFixed(2)}</span></span>` },
              { label: 'Сигналы', render: (r) => `<span class="dim">${esc(truncate((r.signals?.signals || []).join(', '), 42) || '—')}</span>` },
              { label: 'Статус', render: (r) => statusBadge(r.status, statusLabel(r.status)) },
              { label: 'Создан', align: 'right', render: (r) => `<span class="dim">${esc(timeAgo(r.created_at))}</span>` },
              { label: '', align: 'right', render: (r) => `<button class="btn btn-sm btn-outline" data-open="${esc(r.id)}">Разобрать</button>` },
            ],
          })}
        </div>
        ${pager(cases)}
      </section>

      <div class="col-4 stack">
        <section class="card">
          <div class="card-head"><h3>Детекторы</h3><span class="badge badge-brand">${num((zone.detectorsActive || []).length)}</span></div>
          <div class="card-body">
            <div class="tag-list">${(zone.detectorsActive || []).map((d) => `<span class="chip">${esc(d)}</span>`).join('')}</div>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h3>Типы кейсов</h3></div>
          <div class="card-body">
            ${(zone.byType || []).length
              ? barRows((zone.byType || []).map((t) => ({ label: t.case_type, value: t.cnt, tone: Number(t.avg_risk) > 0.8 ? 'danger' : '' })), { formatter: (v) => num(v) })
              : emptyState({ title: 'Кейсов нет' })}
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h3>Как работает решение</h3></div>
          <div class="card-body stack" style="font-size:12.5px;color:var(--text-2)">
            <div class="row"><span class="status-dot info"></span><span>ИИ помечает подозрение и объясняет сигналы</span></div>
            <div class="row"><span class="status-dot warning"></span><span>Человек выбирает вердикт и действие по игроку</span></div>
            <div class="row"><span class="status-dot ok"></span><span>Каждое действие попадает в hash-chain аудит</span></div>
          </div>
        </section>
      </div>
    </div>
  `;

  qsa('[data-status]', container).forEach((btn) => btn.addEventListener('click', () => {
    ctx.setQuery('status', btn.dataset.status);
    ctx.setQuery('page', '');
    ctx.refresh();
  }));

  const search = qs('#case-search', container);
  search?.addEventListener('input', debounce(() => {
    ctx.setQuery('q', search.value);
    ctx.setQuery('page', '');
    ctx.refresh();
  }, 350));

  bindPager(container, (p) => { ctx.setQuery('page', p); ctx.refresh(); });
  bindRowClicks(container, (id) => openCase(id, ctx));
  run(container, '[data-open]', (node) => openCase(node.dataset.open, ctx));
  qs('#run-zone', container)?.addEventListener('click', async () => {
    try {
      await api.post('/api/admin/zones/fraud/run', {});
      toast('Зона Fraud пересчитана', { type: 'success' });
      ctx.refresh();
    } catch (err) { toastError(err); }
  });
}

async function openCase(id, ctx) {
  const list = await api.get(`/api/admin/fraud/cases?page=1&pageSize=200`);
  const item = (list.items || []).find((c) => c.id === id);
  if (!item) return;
  const canReview = can('fraud:review');

  openDrawer({
    title: `Кейс ${String(id).slice(0, 8)}`,
    eyebrow: `${item.case_type} · risk ${Number(item.risk_score).toFixed(2)}`,
    body: `<div class="stack">
        <div class="row wrap">${statusBadge(item.status, statusLabel(item.status))}
          <span class="badge badge-neutral">${esc(item.region)}</span>
          <span class="badge badge-neutral">${esc(item.player_status || '—')}</span>
          <span class="dim">создан ${esc(dateTime(item.created_at))}</span></div>
        <div>
          <div class="field-label mb-8">Сигналы</div>
          <div class="tag-list">${(item.signals?.signals || []).map((s) => `<span class="chip">${esc(s)}</span>`).join('') || '<span class="dim">—</span>'}</div>
        </div>
        <div class="split-even">
          <div class="metric-inline">
            <div><span class="mv">${pct((item.signals?.contact_rate || 0) * 100)}</span><span class="ml">contact rate</span></div>
            <div><span class="mv">${num(item.signals?.avg_reaction_ms, 0)}</span><span class="ml">реакция, мс</span></div>
            <div><span class="mv">${pct((item.signals?.sweet_spot_rate || 0) * 100)}</span><span class="ml">sweet spot</span></div>
          </div>
        </div>
        <div>
          <div class="field-label mb-8">История разборов</div>
          ${(item.reviews || []).length
            ? `<div class="timeline">${item.reviews.map((r) => `<div class="timeline-item">
                  <span class="timeline-dot ${r.verdict === 'confirmed_fraud' ? 'danger' : 'ok'}"></span>
                  <div><div class="timeline-title">${esc(r.verdict)} · ${esc(r.player_action)}</div>
                  <div class="timeline-meta">${esc(r.reviewer)} · ${esc(dateTime(r.created_at))}</div>
                  ${r.note ? `<div class="dim mt-4">${esc(r.note)}</div>` : ''}</div>
                </div>`).join('')}</div>`
            : '<div class="dim">разборов ещё не было</div>'}
        </div>
        ${canReview ? `<div class="divider"></div>
        <div class="field-row">
          <label class="field"><span class="field-label">Вердикт</span>
            <select id="fraud-verdict"><option value="confirmed_fraud">Фрод подтверждён</option><option value="false_positive">Ложное срабатывание</option></select>
          </label>
          <label class="field"><span class="field-label">Действие по игроку</span>
            <select id="fraud-action"><option value="none">Без санкции</option><option value="suspend">Заморозить</option><option value="ban">Заблокировать</option></select>
          </label>
        </div>
        <label class="field"><span class="field-label">Обоснование (в аудит)</span>
          <textarea id="fraud-note" placeholder="Что проверили и почему приняли такое решение"></textarea></label>` : ''}
      </div>`,
    actions: canReview
      ? [
          { label: 'Закрыть', variant: 'btn-ghost' },
          {
            label: 'Сохранить решение',
            variant: 'btn-primary',
            close: false,
            onClick: async ({ close }) => {
              const verdict = qs('#fraud-verdict').value;
              const playerAction = qs('#fraud-action').value;
              const note = qs('#fraud-note').value.trim();
              if (note.length < 5) { toast('Добавьте обоснование (мин. 5 символов)', { type: 'warn' }); return; }
              try {
                await api.post(`/api/admin/fraud/cases/${id}/review`, { verdict, playerAction, note }, { idempotencyKey: `fraud-${id}-${verdict}-${playerAction}` });
                toast('Решение сохранено', { type: 'success', text: 'Запись добавлена в аудит' });
                close();
                ctx.refresh();
              } catch (err) { toastError(err); }
            },
          },
        ]
      : [{ label: 'Закрыть', variant: 'btn-ghost' }],
  });
}
