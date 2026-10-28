import { api } from '../core/api.js';
import { esc, num, pct, timeAgo, dateTime } from '../core/format.js';
import {
  qs, qsa, kpi, card, table, statusBadge, barRows, skeleton, emptyState, drawHeatmap,
  openDrawer, openJson, promptDialog, toast, toastError, run, meter,
} from '../core/ui.js';
import { icon } from '../core/icons.js';
import { can } from '../core/store.js';

const ZONE_LABELS = {
  deep_fh: 'DEEP · FH', deep_mid: 'DEEP · MID', deep_bh: 'DEEP · BH',
  short_fh: 'SHORT · FH', short_mid: 'SHORT · MID', short_bh: 'SHORT · BH',
};

export async function render(container, ctx) {
  const period = Number(ctx.query.period || 30);
  container.innerHTML = skeleton('page');
  const [data, history] = await Promise.all([
    api.get(`/api/admin/zones/balance?periodDays=${period}`),
    api.get('/api/admin/zones/balance/summaries?limit=8').catch(() => ({ summaries: [] })),
  ]);
  if (ctx.isStale()) return;

  const t = data.totals || {};
  const rules = data.activeRules || {};
  const zones = data.tableZoneDifficulty || [];

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Balance · овал ввода и зоны стола</h2>
        <p>Теплокарта контакта along × across, сложность шести зон стола, срезы по типу ввода/хвату/руке и управляемая публикация MATCH_RULES.</p>
      </div>
      <div class="page-actions">
        <div class="segmented" id="period-switch">
          ${[[7, '7 дней'], [30, '30 дней'], [90, '90 дней']].map(([v, l]) => `<button type="button" data-period="${v}" class="${period === v ? 'active' : ''}">${l}</button>`).join('')}
        </div>
        ${can('rules:publish') ? `<button class="btn btn-sm btn-primary" id="publish-rules">${icon('sliders')} Опубликовать правила</button>` : ''}
      </div>
    </div>

    <div class="grid grid-5 mb-16">
      ${kpi({ label: 'Нажатий', value: num(t.totalPresses || 0), sub: `v${num(data.activeVersion || 4)} активна` })}
      ${kpi({ label: 'Accept rate', value: pct(t.acceptRatePct || 0), sub: `${num(t.graceHits || 0)} grace-хитов` })}
      ${kpi({ label: 'Contact rate', value: pct(t.contactRatePct || 0) })}
      ${kpi({ label: 'Скорость мяча', value: `${num(t.avgBallSpeedMs || 0, 1)}<small>м/с</small>`, sub: `вращение ${num(t.avgSpinRadS || 0, 0)} рад/с` })}
      ${kpi({ label: 'Реакция', value: `${num(t.avgReactionMs || 0, 0)}<small>мс</small>`, sub: `${num(t.missingFreshSwipes || 0)} без свежего свайпа` })}
    </div>

    <div class="grid grid-12">
      <section class="card col-7">
        <div class="card-head">
          <div><h3>Теплокарта контакта</h3><div class="dim">Плотность нажатий в плоскости ракетки; контур — овал зоны приёма</div></div>
          <button class="link-btn" type="button" id="heat-help">как читать →</button>
        </div>
        <div class="card-body">
          <div class="heatmap-wrap" style="grid-template-columns:minmax(0,1fr)">
            <div>
              <canvas id="heatmap" class="heatmap-canvas" aria-label="Теплокарта контакта"></canvas>
              <div class="heat-legend"><span>редко</span><span class="scale"></span><span>часто</span></div>
            </div>
          </div>
          <div class="callout mt-12">${icon('target')} Центр — sweet spot (r = ${esc(String(rules.sweetRadius))}), пунктир — граница овала. Смещение облака вправо/вверх означает системный перекос ввода.</div>
        </div>
      </section>

      <section class="card col-5">
        <div class="card-head"><h3>Сложность зон стола</h3><span class="dim">difficulty index</span></div>
        <div class="card-body stack">
          ${zones.length
            ? zones.map((z) => `
              <div class="zone-diff">
                <div class="meter">
                  <div class="meter-head">
                    <span>${esc(ZONE_LABELS[z.table_zone] || z.table_zone)}</span>
                    <strong>${num(z.difficulty_index, 1)}</strong>
                  </div>
                  <div class="meter-track"><div class="meter-fill ${z.difficulty_index > 45 ? 'danger' : z.difficulty_index > 28 ? 'warn' : ''}" style="width:${Math.min(100, Number(z.difficulty_index) || 0)}%"></div></div>
                  <div class="row-between dim" style="font-size:11px">
                    <span>accept ${pct(z.accept_rate_pct)}</span>
                    <span>contact ${pct(z.contact_rate_pct)}</span>
                    <span>${num(z.total_shots)} ударов</span>
                  </div>
                </div>
              </div>`).join('')
            : emptyState({ title: 'Нет данных по зонам' })}
        </div>
      </section>

      <section class="card col-7">
        <div class="card-head"><h3>Срезы ввода</h3><span class="dim">тип · хват · рука</span></div>
        <div class="card-body flush">
          ${table({
            rows: data.bySegment || [],
            rowKey: (r) => `${r.pointer_type}-${r.grip}-${r.hand}`,
            columns: [
              { label: 'Тип', render: (r) => `<span class="badge badge-neutral">${esc(r.pointer_type)}</span>` },
              { label: 'Хват', render: (r) => esc(r.grip) },
              { label: 'Рука', render: (r) => esc(r.hand === 'left' ? 'левша' : 'правша') },
              { label: 'Нажатий', align: 'right', render: (r) => num(r.presses) },
              { label: 'Accept', align: 'right', render: (r) => pct(r.accept_rate_pct) },
              { label: 'Outside', align: 'right', render: (r) => `<span class="${r.outside_zone_pct > 25 ? 'trend-down' : ''}">${pct(r.outside_zone_pct)}</span>` },
              { label: 'Без свайпа', align: 'right', render: (r) => pct(r.no_fresh_swipe_pct) },
            ],
          })}
        </div>
      </section>

      <section class="card col-5">
        <div class="card-head"><h3>Отказы</h3><span class="dim">10 канонических кодов</span></div>
        <div class="card-body">
          ${(data.rejectDistribution || []).length
            ? barRows((data.rejectDistribution || []).slice(0, 8).map((r) => ({ label: r.reject_code, value: r.count, tone: r.reject_code === 'OUTSIDE_ZONE' ? 'danger' : '' })), { formatter: (v) => num(v) })
            : emptyState({ title: 'Отказов нет' })}
        </div>
      </section>

      <section class="card col-7">
        <div class="card-head">
          <div><h3>MATCH_RULES v${num(data.activeVersion || 4)}</h3><div class="dim">${num(data.rulesFieldCount || 35)} параметров · версия управляется только человеком</div></div>
          <div class="row">
            <button class="btn btn-sm btn-ghost" id="all-rules">${icon('file')} Все параметры</button>
            <button class="btn btn-sm btn-ghost" data-nav="lab">${icon('flask')} В A/B</button>
          </div>
        </div>
        <div class="card-body flush">
          ${table({
            rows: Object.entries(rules).slice(0, 12).map(([k, v]) => ({ k, v })),
            rowKey: 'k',
            columns: [
              { label: 'Параметр', render: (r) => `<code>${esc(r.k)}</code>` },
              { label: 'Значение', align: 'right', render: (r) => `<span class="tnum">${esc(String(r.v))}</span>` },
            ],
          })}
          <div class="card-foot">
            <span>Каждая публикация создаёт новую версию и запись в аудите</span>
            <span class="badge badge-brand">без Pay-to-Win</span>
          </div>
        </div>
      </section>

      <section class="card col-5">
        <div class="card-head"><h3>История версий</h3></div>
        <div class="card-body flush">
          ${(data.rulesHistory || []).length
            ? (data.rulesHistory || []).map((h) => `<div class="list-row">
                <span class="badge ${h.is_active ? 'badge-ok' : 'badge-neutral'}">v${num(h.version)}</span>
                <div class="list-main"><span class="list-title">${esc(h.comment || '—')}</span>
                <span class="list-sub">${esc(h.created_by)} · ${esc(dateTime(h.created_at))}</span></div>
                <button class="btn btn-sm btn-ghost" data-rules-json='${esc(h.rules_json)}'>JSON</button>
              </div>`).join('')
            : emptyState({ title: 'История пуста' })}
        </div>
      </section>

      <section class="card col-12">
        <div class="card-head"><h3>Сводки зоны Balance</h3><span class="dim">${num((history.summaries || []).length)} последних</span></div>
        <div class="card-body">
          ${(history.summaries || []).length
            ? `<div class="grid grid-3">${(history.summaries || []).slice(0, 6).map((s) => `<div class="finding">
                <div class="finding-head">${statusBadge(s.status)}<span class="dim">${esc(timeAgo(s.createdAt))}</span></div>
                <div class="mt-8">${esc(s.summary?.summary || '—')}</div>
                ${(s.summary?.findings || []).slice(0, 2).map((f) => `<div class="dim mt-4">• ${esc(f.issue)} (${pct((f.confidence || 0) * 100)})</div>`).join('')}
              </div>`).join('')}</div>`
            : emptyState({ title: 'Сводок нет', text: 'Зона Balance запускается раз в сутки или после релиза.' })}
        </div>
      </section>
    </div>
  `;

  const canvas = qs('#heatmap', container);
  requestAnimationFrame(() => drawHeatmap(canvas, data.heatmapBins || [], rules));
  window.addEventListener('resize', () => drawHeatmap(canvas, data.heatmapBins || [], rules), { once: true });

  qsa('[data-period]', container).forEach((btn) => btn.addEventListener('click', () => {
    ctx.setQuery('period', btn.dataset.period);
    ctx.refresh();
  }));
  run(container, '[data-nav]', (node) => { location.hash = `#/${node.dataset.nav}`; });
  run(container, '[data-rules-json]', (node) => openJson('MATCH_RULES · JSON', JSON.parse(node.dataset.rulesJson || '{}'), 'rules_json'));
  qs('#all-rules', container)?.addEventListener('click', () => openJson('Все параметры MATCH_RULES', rules, `v${data.activeVersion}`));
  qs('#heat-help', container)?.addEventListener('click', () => {
    openDrawer({
      title: 'Как читать теплокарту',
      eyebrow: 'along × across',
      body: `<div class="stack"><p class="muted">Ось <code>along</code> — глубина контакта относительно тела, <code>across</code> — поперечное смещение (BH слева, FH справа).</p>
        <ul class="stack" style="font-size:13px;color:var(--text-2);padding-left:16px;list-style:disc">
          <li>Горячая зона в центре овала — корректный контакт.</li>
          <li>Горячая зона за пунктиром — <code>OUTSIDE_ZONE</code>: игроки систематически не попадают в зону.</li>
          <li>Асимметрия BH/FH — кандидат на правку <code>ovalSideTouchPx</code> или <code>contactSideTouchPx</code>.</li>
        </ul></div>`,
      actions: [{ label: 'Понятно', variant: 'btn-ghost' }],
    });
  });

  qs('#publish-rules', container)?.addEventListener('click', async () => {
    const patch = {};
    const fields = ['pressRadiusPx', 'ovalSideTouchPx', 'contactSideTouchPx', 'sweetRadius'];
    const body = `<div class="stack">
        <p class="muted">Публикация создаёт новую версию MATCH_RULES для всех новых сессий. Изменения доступны только для полей из белого списка.</p>
        <div class="field-row">${fields.map((f) => `<label class="field"><span class="field-label">${f}</span>
          <input type="number" step="0.0001" id="rule-${f}" value="${esc(String(rules[f] ?? 0))}" /></label>`).join('')}</div>
        <label class="field"><span class="field-label">Комментарий</span><input id="rule-comment" type="text" placeholder="Например: +8px ширина овала для touch" /></label>
        <div class="alert alert-warn">${icon('alert')} Изменение затронет всех игроков. Рекомендуется сначала проверить в A/B (зона Lab).</div>
      </div>`;
    openDrawer({
      title: 'Публикация MATCH_RULES',
      eyebrow: `текущая v${num(data.activeVersion || 4)}`,
      body,
      actions: [
        { label: 'Отмена', variant: 'btn-ghost' },
        {
          label: 'Опубликовать',
          variant: 'btn-primary',
          close: false,
          onClick: async ({ close }) => {
            fields.forEach((f) => {
              const val = Number(qs(`#rule-${f}`).value);
              if (Number.isFinite(val) && val !== Number(rules[f])) patch[f] = val;
            });
            if (!Object.keys(patch).length) { toast('Нет изменений', { type: 'warn' }); return; }
            const comment = qs('#rule-comment').value.trim() || 'Ручное обновление владельцем';
            try {
              const res = await api.post('/api/admin/balance/rules', { rulesPatch: patch, comment }, { idempotencyKey: `rules-${JSON.stringify(patch)}` });
              toast(`Опубликована версия v${res.version}`, { type: 'success' });
              close();
              ctx.refresh();
            } catch (err) { toastError(err); }
          },
        },
      ],
    });
  });
}
