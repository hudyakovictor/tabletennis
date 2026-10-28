import { api } from '../core/api.js';
import { esc, num, pct, ms, timeAgo, compact, statusLabel } from '../core/format.js';
import {
  qs, qsa, kpi, table, statusBadge, barRows, skeleton,
  toast, toastError, run, emptyState, sparkline,
} from '../core/ui.js';
import { icon } from '../core/icons.js';
import { can } from '../core/store.js';

export async function render(container, ctx) {
  const period = Number(ctx.query.period || 7);
  container.innerHTML = skeleton('page');
  const [data, history] = await Promise.all([
    api.get(`/api/admin/zones/ops?periodDays=${period}`),
    api.get('/api/admin/zones/ops/summaries?limit=14').catch(() => ({ summaries: [] })),
  ]);
  if (ctx.isStale()) return;

  const t = data.totals || {};
  const buckets = data.rttBuckets || {};
  const corridorRows = [
    { label: '< 35 мс · отлично', value: buckets.excellent_lt35 || 0, tone: '' },
    { label: '35–65 мс · хорошо', value: buckets.good_35_65 || 0, tone: '' },
    { label: '65–100 мс · играбельно', value: buckets.playable_65_100 || 0, tone: 'warn' },
    { label: '100–150 мс · предупреждение', value: buckets.poor_100_150 || 0, tone: 'warn' },
    { label: '> 150 мс · неприемлемо', value: buckets.unacceptable_gt150 || 0, tone: 'danger' },
  ];
  const rejects = (data.rejectBreakdown || []).slice(0, 10).map((r) => ({ label: r.reject_code, value: r.cnt, tone: r.reject_code === 'OUTSIDE_ZONE' ? 'danger' : '' }));

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Ops · техническое состояние</h2>
        <p>Зона Ops работает почти в реальном времени: FPS, краши, потери WebGL, RTT-коридоры Telegram Mini App и распределение отказов ввода.</p>
      </div>
      <div class="page-actions">
        <div class="segmented" id="period-switch">
          ${[[7, '7 дней'], [14, '14 дней'], [30, '30 дней']].map(([v, l]) => `<button type="button" data-period="${v}" class="${period === v ? 'active' : ''}">${l}</button>`).join('')}
        </div>
        ${can('zone:ops:run') || can('zones:run_all') ? `<button class="btn btn-sm btn-primary" id="run-zone">${icon('play')} Пересчитать зону</button>` : ''}
      </div>
    </div>

    <div class="grid grid-5 mb-16">
      ${kpi({ label: 'Сессии', value: num(t.totalSessions || 0), sub: `${num(data.byPlatform?.length || 0)} платформы` })}
      ${kpi({ label: 'Средний FPS', value: num(t.meanFps || 0, 1), sub: `худший p5: ${num(t.worstP5Fps || 0, 1)}` })}
      ${kpi({ label: 'RTT p95', value: `${num(t.meanRttP95Ms || 0, 0)}<small>мс</small>`, sub: `p50 ${num(t.meanRttP50Ms || 0, 0)} мс` })}
      ${kpi({ label: 'Краш-рейт', value: pct(t.crashRatePct || 0, 2), sub: `${num(t.totalCrashes || 0)} крашей · WebGL ${num(t.webglLost || 0)}` })}
      ${kpi({ label: 'Отказы ввода', value: pct(t.rejectRatePct || 0), sub: `${num(t.errors5xx || 0)} ответов 5xx` })}
    </div>

    <div class="grid grid-12">
      <section class="card col-6">
        <div class="card-head"><div><h3>Коридоры RTT</h3><div class="dim">Порог предупреждения клиенту — 100 мс, PvP неприемлем выше 150 мс</div></div></div>
        <div class="card-body">
          ${barRows(corridorRows, { formatter: (v) => num(v) })}
          <div class="callout mt-16">${icon('wifi')} Стабильно ниже 50 мс в Mini App добиться сложно из-за прокси Telegram: клиенту нужны rollback, интерполяция и предсказание.</div>
        </div>
      </section>

      <section class="card col-6">
        <div class="card-head"><div><h3>Коды отказа ввода</h3><div class="dim">Все 10 канонических причин MATCH_RULES v4</div></div></div>
        <div class="card-body">
          ${rejects.length ? barRows(rejects, { formatter: (v) => num(v) }) : emptyState({ title: 'Отказов нет', text: 'Все свайпы приняты валидатором.' })}
          <div class="tag-list mt-12">
            ${Object.entries(data.allRejectCodes || {}).map(([code, count]) => `<span class="chip" title="${esc(code)}: ${num(count)}">${esc(code)} <span class="dim">${num(count)}</span></span>`).join('')}
          </div>
        </div>
      </section>

      <section class="card col-7">
        <div class="card-head"><h3>Платформы</h3><span class="dim">FPS и RTT по устройствам</span></div>
        <div class="card-body flush">
          ${table({
            rows: data.byPlatform || [],
            rowKey: 'platform',
            columns: [
              { label: 'Платформа', render: (r) => `<span class="badge badge-neutral">${esc(r.platform)}</span>` },
              { label: 'Сессии', align: 'right', render: (r) => num(r.sessions) },
              { label: 'Средний FPS', align: 'right', render: (r) => `<span class="tnum ${r.avg_fps < 45 ? 'trend-down' : ''}">${num(r.avg_fps, 1)}</span>` },
              { label: 'RTT p50', align: 'right', render: (r) => ms(r.rtt_p50_ms) },
              { label: 'RTT p95', align: 'right', render: (r) => ms(r.rtt_p95_ms) },
              { label: 'Краши', align: 'right', render: (r) => num(r.crashes) },
              { label: 'WebGL loss', align: 'right', render: (r) => num(r.webgl_lost) },
            ],
          })}
        </div>
      </section>

      <section class="card col-5">
        <div class="card-head"><h3>Региональные узлы</h3><span class="dim">сессии с RTT &gt; 100 мс</span></div>
        <div class="card-body flush">
          ${table({
            rows: data.byRegionRtt || [],
            rowKey: 'region',
            columns: [
              { label: 'Регион', render: (r) => esc(r.region) },
              { label: 'Сессии', align: 'right', render: (r) => num(r.sessions) },
              { label: 'p50', align: 'right', render: (r) => ms(r.avg_rtt_p50_ms) },
              { label: 'p95', align: 'right', render: (r) => ms(r.avg_rtt_p95_ms) },
              { label: '> 100 мс', align: 'right', render: (r) => `<span class="${r.warn_gt100_sessions ? 'trend-down' : 'dim'}">${num(r.warn_gt100_sessions)}</span>` },
            ],
          })}
        </div>
      </section>

      <section class="card col-7">
        <div class="card-head"><h3>История сводок зоны</h3><span class="dim">последние ${num((history.summaries || []).length)}</span></div>
        <div class="card-body">
          ${(history.summaries || []).length
            ? `<div style="height:52px">${sparkline((history.summaries || []).slice().reverse().map((s) => s.summary?.metrics?.errorRatePct ?? (s.status === 'critical' ? 3 : s.status === 'warning' ? 2 : 1)), { color: 'var(--accent-blue)' })}</div>
               <div class="timeline mt-16">${(history.summaries || []).slice(0, 6).map((s) => `
                 <div class="timeline-item">
                   <span class="timeline-dot ${s.status === 'critical' ? 'danger' : s.status === 'warning' ? 'warn' : 'ok'}"></span>
                   <div>
                     <div class="timeline-title">${esc(s.summary?.summary || 'Сводка без текста')}</div>
                     <div class="timeline-meta">${esc(timeAgo(s.createdAt))} ${statusBadge(s.status)}</div>
                   </div>
                 </div>`).join('')}</div>`
            : emptyState({ title: 'Сводок пока нет', text: 'Запустите зону или дождитесь планировщика (каждые 15 минут).' })}
        </div>
      </section>

      <section class="card col-5">
        <div class="card-head"><h3>Открытые инциденты</h3><button class="link-btn" type="button" data-nav="observability">Все →</button></div>
        <div class="card-body flush">
          ${(data.openIncidents || []).length
            ? (data.openIncidents || []).slice(0, 6).map((i) => `<div class="list-row">
                <span class="status-dot ${i.severity === 'critical' ? 'critical' : 'warning'}"></span>
                <div class="list-main"><span class="list-title">${esc(i.title)}</span>
                <span class="list-sub">${esc(statusLabel(i.status))} · ${esc(timeAgo(i.created_at))}</span></div>
                ${statusBadge(i.severity)}
              </div>`).join('')
            : emptyState({ iconName: 'shield', title: 'Инцидентов нет' })}
        </div>
      </section>
    </div>
  `;

  qsa('[data-period]', container).forEach((btn) => btn.addEventListener('click', () => {
    ctx.setQuery('period', btn.dataset.period);
    ctx.refresh();
  }));
  run(container, '[data-nav]', (node) => { location.hash = `#/${node.dataset.nav}`; });
  qs('#run-zone', container)?.addEventListener('click', async () => {
    try {
      await api.post('/api/admin/zones/ops/run', {});
      toast('Зона Ops пересчитана', { type: 'success' });
      ctx.refresh();
    } catch (err) { toastError(err); }
  });
}
