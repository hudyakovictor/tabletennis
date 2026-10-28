import { api } from '../core/api.js';
import { esc, num, pct, timeAgo, dateTime, truncate } from '../core/format.js';
import {
  qs, qsa, kpi, card, table, statusBadge, skeleton, emptyState, openDrawer, openJson,
  toast, toastError, run, setBusy,
} from '../core/ui.js';
import { icon } from '../core/icons.js';

function runSummary(run) {
  try {
    const parsed = run.summary || JSON.parse(run.summary_json || '{}');
    const parts = Object.entries(parsed)
      .filter(([, v]) => typeof v !== 'object')
      .slice(0, 4)
      .map(([k, v]) => `${k}=${v}`);
    return parts.join(' · ') || '—';
  } catch {
    return '—';
  }
}

export async function render(container, ctx) {
  if (!container.dataset.loaded) container.innerHTML = skeleton('page');
  const data = await api.get('/api/admin/zones/lab');
  if (ctx.isStale()) return;
  container.dataset.loaded = '1';

  const t = data.totals || {};
  const runs = data.runs || [];
  const experiments = data.experiments || [];

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Lab · гипотезы и A/B</h2>
        <p>Read-only прогоны стендов физики, статистическая оценка экспериментов (z-score, двусторонний p-value) и предложения по следующим проверкам.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-sm btn-outline" data-bench="noise">${icon('activity')} Noise</button>
        <button class="btn btn-sm btn-outline" data-bench="calibrate">${icon('target')} Calibrate</button>
        <button class="btn btn-sm btn-primary" id="new-exp">${icon('plus')} Новая гипотеза</button>
      </div>
    </div>

    <div class="grid grid-4 mb-16">
      ${kpi({ label: 'Прогонов стендов', value: num(t.totalRuns || 0), sub: `${num(t.failedRuns || 0)} сбоев` })}
      ${kpi({ label: 'Активных A/B', value: num(t.runningExperiments || 0) })}
      ${kpi({ label: 'Значимых победителей', value: num(t.significantWinners || 0), sub: 'p < 0.05' })}
      ${kpi({ label: 'Ночной batch', value: '03:00', sub: 'UTC · жёсткий лимит токенов' })}
    </div>

    <div class="grid grid-12">
      <section class="card col-8">
        <div class="card-head">
          <div><h3>Эксперименты</h3><div class="dim">Промоут победителя выполняется только через HITL-подтверждение владельца</div></div>
        </div>
        <div class="card-body flush">
          ${experiments.length
            ? table({
                rows: experiments,
                rowKey: 'id',
                onRow: true,
                columns: [
                  { label: 'Гипотеза', render: (r) => `<div class="list-title">${esc(r.slug)}</div><div class="list-sub">${esc(truncate(r.hypothesis, 72))}</div>` },
                  { label: 'Сессии C/T', align: 'right', render: (r) => `<span class="tnum">${num(r.control_sessions)} / ${num(r.treatment_sessions)}</span>` },
                  { label: 'Contact C→T', align: 'right', render: (r) => `<span class="tnum">${pct(r.control_contact_rate)} → ${pct(r.treatment_contact_rate)}</span>` },
                  { label: 'Uplift', align: 'right', render: (r) => `<span class="${r.upliftContactPts > 0 ? 'trend-up' : 'trend-down'}">${r.upliftContactPts > 0 ? '+' : ''}${num(r.upliftContactPts, 2)} п.п.</span>` },
                  { label: 'p-value', align: 'right', render: (r) => `<span class="${r.statisticallySignificant ? 'trend-up' : 'dim'}">${num(r.computedPValue ?? r.p_value ?? 0, 3)}</span>` },
                  { label: 'Статус', render: (r) => statusBadge(r.status === 'running' ? 'info' : r.status, r.status === 'running' ? 'идёт' : undefined) },
                ],
              })
            : emptyState({ iconName: 'flask', title: 'Экспериментов нет', text: 'Создайте первую гипотезу — например, +8px ширина овала для touch.' })}
        </div>
      </section>

      <section class="card col-4">
        <div class="card-head"><h3>Стенды движка</h3><span class="dim">read-only</span></div>
        <div class="card-body stack">
          <p class="muted" style="font-size:12.5px">Запуск стендов не изменяет <code>source/</code>: результаты попадают в <code>lab_runs</code> и доступны зоне Lab.</p>
          <button class="btn btn-block" data-bench="noise">${icon('activity')} npm run noise</button>
          <button class="btn btn-block" data-bench="calibrate">${icon('target')} npm run calibrate</button>
          <div class="divider"></div>
          <div class="row-between"><span class="muted">Всего прогонов</span><strong>${num(runs.length)}</strong></div>
          <div class="row-between"><span class="muted">Сбоев</span><strong class="${t.failedRuns ? 'trend-down' : ''}">${num(t.failedRuns || 0)}</strong></div>
        </div>
      </section>

      <section class="card col-12">
        <div class="card-head"><h3>История прогонов</h3><span class="dim">последние ${num(runs.length)}</span></div>
        <div class="card-body flush">
          ${runs.length
            ? table({
                rows: runs.slice(0, 12),
                rowKey: 'id',
                onRow: true,
                columns: [
                  { label: 'Suite', render: (r) => `<span class="badge badge-neutral">${esc(r.suite)}</span>` },
                  { label: 'Ветка', render: (r) => `<code>${esc(r.git_branch)}</code>` },
                  { label: 'Статус', render: (r) => statusBadge(r.status) },
                  { label: 'Длительность', align: 'right', render: (r) => `${num(r.duration_ms)} мс` },
                  { label: 'Результат', align: 'right', render: (r) => `<span class="dim">${esc(runSummary(r))}</span>` },
                  { label: 'Когда', align: 'right', render: (r) => `<span class="dim">${esc(timeAgo(r.created_at))}</span>` },
                ],
              })
            : emptyState({ title: 'Прогонов нет', text: 'Запустите noise или calibrate.' })}
        </div>
      </section>
    </div>
  `;

  run(container, '[data-bench]', async (node) => {
    const suite = node.dataset.bench;
    node.disabled = true;
    node.innerHTML = `<span class="inline-spinner"></span> ${suite}…`;
    try {
      const res = await api.post('/api/admin/lab/run-suite', { suite }, { idempotencyKey: `lab-${suite}-${Date.now()}` });
      toast(`Стенд ${suite}: ${res.run?.status || 'выполнен'}`, {
        type: res.run?.status === 'failed' ? 'error' : 'success',
        text: `Длительность ${num(res.run?.durationMs || 0)} мс`,
      });
      ctx.refresh();
    } catch (err) {
      toastError(err);
      node.disabled = false;
      node.innerHTML = `${icon('play')} ${suite}`;
    }
  });

  run(container, 'tbody tr', async (node) => {
    const id = node.dataset.key;
    const exp = experiments.find((e) => e.id === id);
    const r = runs.find((x) => x.id === id);
    if (exp) {
      openDrawer({
        title: exp.slug,
        eyebrow: `A/B · ${exp.status}`,
        body: `<div class="stack">
            <p>${esc(exp.hypothesis)}</p>
            <div class="metric-inline">
              <div><span class="mv">${num(exp.zScore ?? 0, 2)}</span><span class="ml">z-score</span></div>
              <div><span class="mv">${num(exp.computedPValue ?? 0, 3)}</span><span class="ml">p-value</span></div>
              <div><span class="mv">${num(exp.upliftContactPts ?? 0, 2)}</span><span class="ml">п.п. contact</span></div>
            </div>
            <div class="${exp.statisticallySignificant ? 'alert alert-success' : 'alert alert-warn'}">
              ${exp.statisticallySignificant ? 'Различие статистически значимо при p < 0.05.' : 'Различие пока не значимо: нужно больше сессий или эффект отсутствует.'}
            </div>
            <div class="field-label">Патч правил</div>
            <pre class="code-block">${esc(JSON.stringify(exp.rulesPatch || {}, null, 2))}</pre>
          </div>`,
        actions: [{ label: 'Закрыть', variant: 'btn-ghost' }],
      });
    } else if (r) {
      let summary = r.summary || {};
      if (!summary || !Object.keys(summary).length) {
        try { summary = JSON.parse(r.summary_json || '{}'); } catch { summary = {}; }
      }
      openJson(`Прогон ${r.suite}`, summary, r.id);
    }
  });

  qs('#new-exp', container).addEventListener('click', () => {
    openDrawer({
      title: 'Новая гипотеза A/B',
      eyebrow: 'зона Lab',
      body: `<form class="stack" id="exp-form">
          <label class="field"><span class="field-label">Slug</span><input name="slug" required placeholder="oval_touch_plus8" /></label>
          <label class="field"><span class="field-label">Гипотеза</span><textarea name="hypothesis" required placeholder="Увеличение ширины овала для touch на 8px повысит contact rate"></textarea></label>
          <label class="field"><span class="field-label">Патч MATCH_RULES (JSON)</span>
            <textarea name="rulesPatch" placeholder='{"ovalSideTouchPx": 68}'></textarea>
            <span class="field-hint">Только существующие параметры; публикация — после подтверждения владельцем.</span></label>
        </form>`,
      actions: [
        { label: 'Отмена', variant: 'btn-ghost' },
        {
          label: 'Создать',
          variant: 'btn-primary',
          close: false,
          onClick: async ({ close }) => {
            const form = qs('#exp-form');
            const fd = new FormData(form);
            let rulesPatch = {};
            try {
              rulesPatch = fd.get('rulesPatch') ? JSON.parse(fd.get('rulesPatch')) : {};
            } catch {
              toast('Некорректный JSON патча', { type: 'error' });
              return;
            }
            try {
              await api.post('/api/admin/lab/experiments', {
                slug: fd.get('slug'),
                hypothesis: fd.get('hypothesis'),
                rulesPatch,
              }, { idempotencyKey: `exp-${fd.get('slug')}-${Date.now()}` });
              toast('Эксперимент создан', { type: 'success' });
              close();
              ctx.refresh();
            } catch (err) { toastError(err); }
          },
        },
      ],
    });
  });
}
