import { api, downloadFile } from '../core/api.js';
import { esc, num, pct, money, compact, dateTime } from '../core/format.js';
import {
  qs, qsa, kpi, card, table, statusBadge, barRows, skeleton, emptyState,
  openDrawer, meter, toast, toastError, run,
} from '../core/ui.js';
import { icon } from '../core/icons.js';

const SORT_COLUMNS = {
  spend_usd: 'Расход', installs: 'Установки', roasPct: 'ROAS', ltvD30Usd: 'LTV D30',
  payerConvPct: 'Конверсия', d1Pct: 'D1', cpiUsd: 'CPI',
};

export async function render(container, ctx) {
  const period = Number(ctx.query.period || 30);
  const sort = ctx.query.sort || 'spend_usd';
  const order = ctx.query.order || 'desc';
  container.innerHTML = skeleton('page');
  const data = await api.get(`/api/admin/zones/market?periodDays=${period}`);
  if (ctx.isStale()) return;

  const k = data.kpis || {};
  const campaigns = [...(data.campaigns || [])].sort((a, b) => {
    const av = Number(a[sort]) || 0;
    const bv = Number(b[sort]) || 0;
    return order === 'asc' ? av - bv : bv - av;
  });
  const economy = data.economy || {};

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Market · юнит-экономика</h2>
        <p>14 KPI, когорты по источникам, каналы и кампании с ROAS, а также баланс притока и вывода валют.</p>
      </div>
      <div class="page-actions">
        <div class="segmented" id="period-switch">
          ${[[7, '7 дней'], [30, '30 дней'], [90, '90 дней']].map(([v, l]) => `<button type="button" data-period="${v}" class="${period === v ? 'active' : ''}">${l}</button>`).join('')}
        </div>
        <button class="btn btn-sm btn-outline" id="export-csv">${icon('download')} CSV</button>
        <button class="btn btn-sm btn-primary" id="run-zone">${icon('play')} Пересчитать зону</button>
      </div>
    </div>

    <div class="grid grid-5 mb-16">
      ${kpi({ label: 'DAU / MAU', value: `${compact(k.dau || 0)}<small>/${compact(k.mau || 0)}</small>`, sub: `stickiness ${pct(k.stickinessPct || 0)}` })}
      ${kpi({ label: 'Выручка', value: money(k.totalRevenueUsd || 0), sub: `IAP ${money(k.iapRevenueUsd || 0)} · Ads ${money(k.adRevenueUsd || 0)}` })}
      ${kpi({ label: 'Blended ROAS', value: pct(k.blendedRoasPct || 0), sub: `spend ${money(k.totalSpendUsd || 0)}` })}
      ${kpi({ label: 'ARPU / ARPPU', value: `${money(k.arpuUsd || 0)}<small>/${money(k.arppuUsd || 0)}</small>`, sub: `ARPDAU ${money(k.arpdauUsd || 0)}` })}
      ${kpi({ label: 'CPI / CAC', value: `${money(k.blendedCpiUsd || 0)}<small>/${money(k.blendedCacUsd || 0)}</small>`, sub: `payer conv ${pct(k.payerConversionPct || 0)} · eCPM ${money(k.ecpmUsd || 0)}` })}
    </div>

    <div class="grid grid-12">
      <section class="card col-8">
        <div class="card-head">
          <div><h3>Кампании и креативы</h3><div class="dim">Сортировка по метрике; отрицательный ROAS — кандидат на остановку через HITL</div></div>
        </div>
        <div class="card-body flush">
          <div class="toolbar" style="padding:12px 14px 0;margin:0">
            <div class="segmented">
              ${Object.entries(SORT_COLUMNS).slice(0, 5).map(([v, l]) => `<button type="button" data-sort="${v}" class="${sort === v ? 'active' : ''}">${l}</button>`).join('')}
            </div>
          </div>
          ${table({
            rows: campaigns,
            rowKey: 'id',
            empty: 'Кампаний нет',
            onRow: true,
            columns: [
              { label: 'Источник / кампания', render: (r) => `<div class="list-title">${esc(r.campaign)}</div><div class="list-sub">${esc(r.source)} · ${esc(r.creative)}</div>` },
              { label: 'Spend', align: 'right', render: (r) => money(r.spend_usd) },
              { label: 'Installs', align: 'right', render: (r) => num(r.installs) },
              { label: 'D1 / D7', align: 'right', render: (r) => `<span class="tnum">${pct(r.d1Pct || 0, 0)} / ${pct(r.d7Pct || 0, 0)}</span>` },
              { label: 'LTV D30', align: 'right', render: (r) => money(r.ltvD30Usd) },
              { label: 'ROAS', align: 'right', render: (r) => `<span class="${r.roasPct < 0 ? 'trend-down' : r.roasPct > 100 ? 'trend-up' : ''}">${pct(r.roasPct)}</span>` },
              { label: 'Payer', align: 'right', render: (r) => pct(r.payerConvPct) },
            ],
          })}
        </div>
      </section>

      <section class="card col-4">
        <div class="card-head"><h3>Когорты по источникам</h3></div>
        <div class="card-body">
          ${(data.cohortsBySource || []).length
            ? barRows((data.cohortsBySource || []).map((c) => ({ label: c.install_source, value: c.cohort_users })), { formatter: (v) => num(v) })
            : emptyState({ title: 'Когорт нет' })}
          <div class="divider"></div>
          <div class="stack">
            ${(data.cohortsBySource || []).slice(0, 4).map((c) => `<div class="row-between" style="font-size:12px">
                <span class="muted">${esc(c.install_source)}</span>
                <span><span class="dim">IAP</span> ${money(c.cohort_iap_usd)}</span>
              </div>`).join('')}
          </div>
        </div>
      </section>

      <section class="card col-6">
        <div class="card-head"><h3>Экономика валют</h3><span class="badge badge-neutral">sink / source</span></div>
        <div class="card-body stack">
          ${meter('Монеты · приток', economy.coinsSource || 0, Math.max(economy.coinsSource || 0, economy.coinsSink || 0), { formatter: (v) => compact(v) })}
          ${meter('Монеты · вывод', economy.coinsSink || 0, Math.max(economy.coinsSource || 0, economy.coinsSink || 0), { formatter: (v) => compact(v) })}
          ${meter('Кристаллы · приток', economy.gemsSource || 0, Math.max(economy.gemsSource || 0, economy.gemsSink || 0), { formatter: (v) => compact(v) })}
          ${meter('Кристаллы · вывод', economy.gemsSink || 0, Math.max(economy.gemsSource || 0, economy.gemsSink || 0), { formatter: (v) => compact(v) })}
          <div class="divider"></div>
          <div class="row-between"><span class="muted">Sink ratio монет</span><strong>${num(economy.coinSinkRatio || 0, 2)}</strong></div>
          <div class="row-between"><span class="muted">Sink ratio кристаллов</span><strong>${num(economy.gemSinkRatio || 0, 2)}</strong></div>
        </div>
      </section>

      <section class="card col-6">
        <div class="card-head"><h3>Структура ledger</h3><span class="dim">причина · сумма</span></div>
        <div class="card-body flush">
          ${(economy.ledgerBreakdown || []).length
            ? table({
                rows: (economy.ledgerBreakdown || []).slice(0, 9),
                rowKey: (r) => `${r.currency}-${r.flow_type}-${r.reason}`,
                columns: [
                  { label: 'Валюта', render: (r) => `<span class="badge badge-neutral">${esc(r.currency)}</span>` },
                  { label: 'Поток', render: (r) => esc(r.flow_type) },
                  { label: 'Причина', render: (r) => esc(r.reason) },
                  { label: 'Сумма', align: 'right', render: (r) => compact(r.total_amount) },
                  { label: 'Событий', align: 'right', render: (r) => num(r.events_count) },
                ],
              })
            : emptyState({ title: 'Ledger пуст' })}
        </div>
      </section>
    </div>
  `;

  qsa('[data-period]', container).forEach((btn) => btn.addEventListener('click', () => {
    ctx.setQuery('period', btn.dataset.period);
    ctx.refresh();
  }));
  qsa('[data-sort]', container).forEach((btn) => btn.addEventListener('click', () => {
    if (sort === btn.dataset.sort) ctx.setQuery('order', order === 'desc' ? 'asc' : 'desc');
    else { ctx.setQuery('sort', btn.dataset.sort); ctx.setQuery('order', 'desc'); }
    ctx.refresh();
  }));
  qs('#export-csv', container).addEventListener('click', () => {
    downloadFile('/api/admin/exports/campaigns.csv', `topspin-campaigns-${new Date().toISOString().slice(0, 10)}.csv`);
  });
  qs('#run-zone', container).addEventListener('click', async () => {
    try {
      await api.post('/api/admin/zones/market/run', {});
      toast('Зона Market пересчитана', { type: 'success' });
      ctx.refresh();
    } catch (err) { toastError(err); }
  });

  run(container, 'tbody tr', async (node) => {
    const id = node.dataset.key;
    const c = campaigns.find((x) => x.id === id);
    if (!c) return;
    openDrawer({
      title: c.campaign,
      eyebrow: `${c.source} · ${c.creative}`,
      body: `<div class="stack">
          <div class="metric-inline">
            <div><span class="mv">${money(c.spend_usd)}</span><span class="ml">spend</span></div>
            <div><span class="mv">${money(c.revenue_d30_usd)}</span><span class="ml">revenue D30</span></div>
            <div><span class="mv">${pct(c.roasPct)}</span><span class="ml">ROAS</span></div>
            <div><span class="mv">${money(c.cpiUsd)}</span><span class="ml">CPI</span></div>
          </div>
          <div class="divider"></div>
          <dl class="kv">
            <dt>Показы / клики</dt><dd>${num(c.impressions)} / ${num(c.clicks)}</dd>
            <dt>CTR</dt><dd>${pct(c.impressions ? (c.clicks / c.impressions) * 100 : 0, 2)}</dd>
            <dt>Retention D1 / D7 / D30</dt><dd>${pct(c.d1Pct)} / ${pct(c.d7Pct)} / ${pct(c.d30Pct)}</dd>
            <dt>LTV D30 / CAC</dt><dd>${money(c.ltvD30Usd)} / ${money(c.cacUsd)}</dd>
            <dt>Payer conversion</dt><dd>${pct(c.payerConvPct)}</dd>
          </dl>
          ${c.roasPct < 0 ? `<div class="alert alert-danger">${icon('alert')} Кампания убыточна. Остановка выполняется через предложение зоны Market и подтверждение владельца.</div>` : ''}
        </div>`,
      actions: [{ label: 'Закрыть', variant: 'btn-ghost' }],
    });
  });
}
