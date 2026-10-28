'use strict';

/**
 * TOPSPIN ARENA — Admin CRM v2.0 Frontend Application
 * Strictly external JS (`CSP: script-src 'self'`), zero external CDN dependencies.
 */

(function () {
  const state = {
    token: localStorage.getItem('topspin_crm_token') || '',
    user: null,
    activeTab: 'overview',
    periodDays: 30,
    directorTimeRange: 'last_72h',
    marketSortCol: 'spend_usd',
    marketSortAsc: false,
    editingNewsId: null,
  };

  const TAB_META = {
    overview: ['Сводный контур владельца (Executive Overview)', 'Светофор 5 изолированных зон, утренний дайджест 09:00, аномалии 2σ и решения HITL'],
    director: ['Чат с Директором ИИ (03-director-chat.md)', 'Скользящее окно 48–72ч + отдельная архивная БД director-archive.sqlite + 4-блочный промпт без ПДн'],
    ops: ['Зона 1 · Ops & Сетевые задержки TMA', 'FPS, краши, потери WebGL, 5 коридоров RTT (<35 / 35-65 / 65-100 / 100-150 / >150 мс) и 10 кодов отказа'],
    fraud: ['Зона 2 · Fraud (8 детекторов, нулевой автобан)', 'Sweet-spot, реакция, линейность, 24/7 марафон, повторы маршрутов, мультиаккаунты и платёжный риск'],
    balance: ['Зона 3 · Balance, Овал ввода & 6 зон стола', 'Теплокарта along/across, матрица сложности short/deep × BH/MID/FH и все 35 параметров MATCH_RULES v4'],
    market: ['Зона 4 · Market, Когорты & Инфляция валют', '14 KPI юнит-экономики (CPI, CAC, LTV, ROAS, eCPM), сортируемые кампании и баланс sink/source'],
    lab: ['Зона 5 · Lab, Стенды движка & Статистические A/B', 'Read-only запуск noise/calibrate, браузерные прогоны и z-score / p-value значимость'],
    observability: ['Наблюдаемость SRE, Runbooks, Post-Mortems & Telegram-бот', '4 золотых сигнала (p50/p95/p99, RPS/CCU, 4xx/5xx, Saturation), Runbooks и Read-Only бот с Ack'],
    liveops: ['LiveOps: Техработы, Пуши, CRUD Новостей, Тикеты, Фидбек & Патчи', 'Режим 503 техработ, закреплённые пуши, редактор новостей, тикеты со скриншотами, патчи и календарь 6–12 мес.'],
    players: ['Игроки, 152-ФЗ / GDPR, Возрастной фильтр & Реестр DPA', '4 документа RU/EN (ToS, Privacy, EULA, Cookie), COPPA/GDPR-K/152-ФЗ, JSON экспорт и удаление ПДн <=30д'],
    governance: ['ИИ-квоты, JSON Schema контракты, Чек-лист запуска & DR Бэкап', 'Лимиты токенов, кэш промптов, Batch 50%, карантин, 26 проверок готовности, VACUUM INTO и неизменяемый аудит'],
  };

  function esc(val) {
    return String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function badge(status, customLabel) {
    const s = String(status || 'ok').toLowerCase();
    return `<span class="status-pill status-${esc(s)}">${esc(customLabel || status)}</span>`;
  }

  function showToast(msg) {
    const bar = document.getElementById('toast-bar');
    bar.textContent = msg;
    bar.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => bar.classList.add('hidden'), 4200);
  }

  function openModal(title, content) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').textContent =
      typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    document.getElementById('modal-backdrop').classList.remove('hidden');
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && typeof options.body === 'object') {
      headers['Content-Type'] = 'application/json';
    }
    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
    }
    const res = await fetch(path, {
      method: options.method || 'GET',
      headers,
      body: options.body && typeof options.body === 'object' ? JSON.stringify(options.body) : options.body,
      credentials: 'same-origin',
    });
    if (res.status === 401 && path !== '/api/admin/auth/login') {
      state.token = '';
      localStorage.removeItem('topspin_crm_token');
      showLoginScreen();
      throw new Error('Требуется повторный вход');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  function showLoginScreen() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('crm-shell').classList.add('hidden');
  }

  function showCrmShell() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('crm-shell').classList.remove('hidden');
    if (state.user) {
      document.getElementById('current-user-label').textContent = state.user.username;
    }
  }

  async function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('#sidebar-nav .nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    const meta = TAB_META[tab] || TAB_META.overview;
    document.getElementById('page-title').textContent = meta[0];
    document.getElementById('page-subtitle').textContent = meta[1];
    await renderActiveTab();
  }

  async function renderActiveTab() {
    const container = document.getElementById('tab-container');
    try {
      if (state.activeTab === 'overview') await renderOverview(container);
      else if (state.activeTab === 'director') await renderDirector(container);
      else if (state.activeTab === 'ops') await renderOps(container);
      else if (state.activeTab === 'fraud') await renderFraud(container);
      else if (state.activeTab === 'balance') await renderBalance(container);
      else if (state.activeTab === 'market') await renderMarket(container);
      else if (state.activeTab === 'lab') await renderLab(container);
      else if (state.activeTab === 'observability') await renderObservability(container);
      else if (state.activeTab === 'liveops') await renderLiveops(container);
      else if (state.activeTab === 'players') await renderPlayers(container);
      else if (state.activeTab === 'governance') await renderGovernance(container);
    } catch (err) {
      container.innerHTML = `<div class="alert-error">Ошибка загрузки раздела: ${esc(err.message)}</div>`;
    }
  }

  // ==========================================================================
  // 1. OVERVIEW + MORNING DIGEST + HITL LOOP
  // ==========================================================================
  async function renderOverview(el) {
    const [ov, digest] = await Promise.all([
      api('/api/admin/overview'),
      api('/api/admin/digest/morning'),
    ]);

    const maintPill = document.getElementById('maint-pill');
    maintPill.textContent = ov.maintenance.enabled ? '⚙️ Техработы ВКЛ (503)' : '🟢 Серверы открыты';
    maintPill.className = `status-pill ${ov.maintenance.enabled ? 'status-critical' : 'status-ok'}`;

    const zoneCards = ['ops', 'fraud', 'balance', 'market', 'lab']
      .map((z) => {
        const s = ov.summaries[z];
        const zStat = ov.zonesStatus.find((x) => x.zone === z) || {};
        const topFinding = s?.findings?.[0]?.issue || 'Сводка актуальна';
        return `
          <div class="card">
            <div class="card-header">
              <strong>${esc(z.toUpperCase())}</strong>
              ${badge(s?.status || 'ok')}
            </div>
            <div class="muted" style="min-height:48px">${esc(topFinding)}</div>
            <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center">
              <span class="muted">${esc(zStat.usedTokens || 0)}/${esc(zStat.dailyTokenLimit || 0)} ток.</span>
              <button type="button" class="btn btn-ghost btn-sm js-run-zone" data-zone="${esc(z)}">↻ Пересчитать</button>
            </div>
          </div>
        `;
      })
      .join('');

    const pendingProposals = ov.proposals.filter((p) => p.status === 'pending');

    el.innerHTML = `
      <div class="grid-5">${zoneCards}</div>

      <div class="grid-4">
        <div class="card">
          <div class="kpi-label">HTTP p50 / p95 / p99</div>
          <div class="kpi-value">${ov.goldenSignals.latency.httpP50Ms} / ${ov.goldenSignals.latency.httpP95Ms} / ${ov.goldenSignals.latency.httpP99Ms} мс</div>
          <div class="muted">Клиентский TMA RTT p50: ${ov.goldenSignals.latency.clientRttP50Ms} мс</div>
        </div>
        <div class="card">
          <div class="kpi-label">Трафик (CCU / RPS)</div>
          <div class="kpi-value">${ov.goldenSignals.traffic.ccu} CCU</div>
          <div class="muted">WebSockets: ${ov.goldenSignals.traffic.activeWebSockets} · Сессий (7д): ${ov.goldenSignals.traffic.sessions7d}</div>
        </div>
        <div class="card">
          <div class="kpi-label">Готовность к релизу (10-checklist.md)</div>
          <div class="kpi-value">${ov.readinessSummary.passedCount} / ${ov.readinessSummary.totalCount} (${ov.readinessSummary.scorePct}%)</div>
          <div class="muted">${ov.readinessSummary.readyForLaunch ? 'Все 5 контуров зелёные' : 'Требуется проверка'}</div>
        </div>
        <div class="card">
          <div class="kpi-label">Открытые тикеты / Инциденты</div>
          <div class="kpi-value">${ov.openTicketsCount} / ${ov.openIncidents.length}</div>
          <div class="muted">Аномалий 2σ: ${ov.anomalies.length}</div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Подтверждение решений человеком (4-шаговый цикл HITL)</h3>
            ${badge(pendingProposals.length ? 'warning' : 'ok', `Ожидают: ${pendingProposals.length}`)}
          </div>
          ${
            pendingProposals.length === 0
              ? '<div class="muted">Все предложения ИИ-зон рассмотрены владельцем.</div>'
              : pendingProposals
                  .map(
                    (p) => `
                  <div style="border-top:1px solid var(--border);padding:10px 0">
                    <div style="display:flex;justify-content:space-between;gap:8px">
                      <strong>[${esc(p.zone.toUpperCase())}] ${esc(p.title)}</strong>
                      ${badge('pending', `conf ${(p.confidence * 100).toFixed(0)}%`)}
                    </div>
                    <div class="muted" style="margin:4px 0 8px">${esc(p.rationale)}</div>
                    <div class="btn-row">
                      <button type="button" class="btn btn-primary btn-sm js-decide-prop" data-id="${esc(p.id)}" data-decision="approved">✓ Подтвердить и применить</button>
                      <button type="button" class="btn btn-danger btn-sm js-decide-prop" data-id="${esc(p.id)}" data-decision="rejected">✕ Отклонить</button>
                    </div>
                  </div>
                `
                  )
                  .join('')
          }
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">☀️ Утренний дайджест владельца (09:00) &amp; Детектор 2σ</h3>
            <span class="muted">15-liveops-content-plan.md</span>
          </div>
          <pre style="background:var(--bg-0);padding:10px;border-radius:8px;white-space:pre-wrap;font-size:12px;margin:0 0 10px">${esc(digest.text)}</pre>
          ${ov.anomalies
            .map(
              (a) =>
                `<div class="muted" style="margin-top:4px">• ${badge(a.severity)} ${esc(a.message)} (<code>${esc(a.runbookSlug)}</code>)</div>`
            )
            .join('')}
        </div>
      </div>
    `;

    el.querySelectorAll('.js-run-zone').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const z = btn.dataset.zone;
        await api(`/api/admin/zones/${z}/run`, { method: 'POST' });
        showToast(`Сводка зоны ${z.toUpperCase()} пересчитана изолированным воркером`);
        await renderOverview(el);
      });
    });

    el.querySelectorAll('.js-decide-prop').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const res = await api(`/api/admin/proposals/${btn.dataset.id}/decide`, {
          method: 'POST',
          body: { decision: btn.dataset.decision, comment: 'Решение владельца из панели Обзор' },
        });
        showToast(`Решение HITL сохранено (${res.status}) и записано в неизменяемый аудит`);
        await renderOverview(el);
      });
    });
  }

  // ==========================================================================
  // 2. DIRECTOR CHAT (48–72h Window + Separate Archive DB + Clickable Questions)
  // ==========================================================================
  async function renderDirector(el) {
    const ctx = await api(`/api/admin/director/context?time_range=${encodeURIComponent(state.directorTimeRange)}`);
    const lastDirectorMsg = [...ctx.activeMessages].reverse().find((m) => m.role === 'director' && m.structured);
    const nextQuestions = lastDirectorMsg?.structured?.next_questions || [
      'Какие зоны требуют срочного внимания прямо сейчас?',
      'Покажи сводку по балансу овала нажатий и 6 зонам стола',
      'Сколько антифрод-кейсов ждут ручной проверки?',
    ];

    el.innerHTML = `
      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Диалог с Директором (скользящее окно ${ctx.slidingWindowHours}ч)</h3>
            <div class="form-inline">
              <select id="director-range-select" style="width:auto">
                <option value="last_24h" ${state.directorTimeRange === 'last_24h' ? 'selected' : ''}>Окно: 24 часа</option>
                <option value="last_48h" ${state.directorTimeRange === 'last_48h' ? 'selected' : ''}>Окно: 48 часов</option>
                <option value="last_72h" ${state.directorTimeRange === 'last_72h' ? 'selected' : ''}>Окно: 72 часа</option>
              </select>
              <button id="view-director-archive-btn" type="button" class="btn btn-ghost btn-sm">🗄 Архивная БД (${ctx.archivedMessagesCount})</button>
            </div>
          </div>

          <div id="director-chat-box" class="chat-box">
            ${ctx.activeMessages
              .map(
                (m) => `
                <div class="chat-msg ${esc(m.role)}">
                  <div style="font-size:11px;color:var(--muted);margin-bottom:4px">
                    ${m.role === 'owner' ? '👤 Владелец' : '🧠 Директор ИИ'} · ${esc(m.createdAt.slice(0, 19).replace('T', ' '))}
                    ${m.structured ? badge(m.structured.status) : ''}
                  </div>
                  <div>${esc(m.content)}</div>
                  ${
                    m.structured?.findings?.length
                      ? `<div style="margin-top:8px;font-size:12px" class="muted">` +
                        m.structured.findings
                          .map((f) => `• [${esc(f.zone.toUpperCase())}] ${esc(f.issue)} → <em>${esc(f.recommended_action || '')}</em>`)
                          .join('<br/>') +
                        `</div>`
                      : ''
                  }
                </div>
              `
              )
              .join('')}
          </div>

          <div style="margin-top:10px" class="btn-row">
            ${nextQuestions.map((q) => `<button type="button" class="chip-btn js-quick-q">${esc(q)}</button>`).join('')}
          </div>

          <form id="director-ask-form" style="margin-top:10px;display:flex;gap:8px">
            <input id="director-q-input" placeholder="Спросите Директора о балансе, антифроде, маркетинге или инцидентах..." required />
            <button type="submit" class="btn btn-primary" style="white-space:nowrap">Отправить</button>
          </form>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Блок постоянного состояния (Persistent State)</h3>
            ${badge('ok', 'Отдельно от истории чата')}
          </div>
          <p class="muted">
            Хранится отдельно от ленты сообщений (<code>director_state</code>) и не вытесняется 72-часовым окном: приоритеты владельца, открытые инциденты и активные A/B-тесты.
          </p>
          <form id="priorities-form" class="form-stack">
            <label>
              <span>Текущие приоритеты владельца (по одному на строку)</span>
              <textarea id="priorities-textarea" rows="4">${esc(ctx.persistentState.priorities.join('\n'))}</textarea>
            </label>
            <button type="submit" class="btn btn-secondary btn-sm">Сохранить приоритеты</button>
          </form>

          <div style="margin-top:14px">
            <strong>Активные A/B эксперименты (${ctx.persistentState.activeAbExperiments.length}):</strong>
            ${ctx.persistentState.activeAbExperiments
              .map(
                (e) =>
                  `<div class="muted" style="margin-top:4px">• <code>${esc(e.slug)}</code>: ${esc(e.hypothesis)} (p=${esc(e.p_value)})</div>`
              )
              .join('')}
          </div>
          <div style="margin-top:12px">
            <strong>Последние решения HITL (${ctx.persistentState.recentOwnerDecisions.length}):</strong>
            ${
              ctx.persistentState.recentOwnerDecisions.length === 0
                ? '<div class="muted">Пока нет завершённых решений.</div>'
                : ctx.persistentState.recentOwnerDecisions
                    .map((d) => `<div class="muted">• [${esc(d.zone)}] ${esc(d.title)} — ${badge(d.status)}</div>`)
                    .join('')
            }
          </div>
        </div>
      </div>
    `;

    document.getElementById('director-range-select').addEventListener('change', async (e) => {
      state.directorTimeRange = e.target.value;
      await renderDirector(el);
    });

    document.getElementById('view-director-archive-btn').addEventListener('click', async () => {
      const arch = await api('/api/admin/director/archive');
      openModal('Отдельная архивная БД (data/director-archive.sqlite — сообщения старше 72ч)', arch.archivedMessages);
    });

    el.querySelectorAll('.js-quick-q').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('director-q-input').value = btn.textContent;
        document.getElementById('director-ask-form').requestSubmit();
      });
    });

    document.getElementById('director-ask-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('director-q-input');
      const q = input.value.trim();
      if (!q) return;
      input.disabled = true;
      await api('/api/admin/director/ask', {
        method: 'POST',
        body: { question: q, time_range: state.directorTimeRange },
      });
      await renderDirector(el);
    });

    document.getElementById('priorities-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const lines = document
        .getElementById('priorities-textarea')
        .value.split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      await api('/api/admin/director/priorities', { method: 'POST', body: { priorities: lines } });
      showToast('Приоритеты блока Persistent State обновлены');
      await renderDirector(el);
    });
  }

  // ==========================================================================
  // 3. ZONE 1: OPS & TMA RTT TIERS
  // ==========================================================================
  async function renderOps(el) {
    const dash = await api(`/api/admin/zones/ops?periodDays=${state.periodDays}`);
    const b = dash.rttBuckets;

    el.innerHTML = `
      <div class="card">
        <div class="form-inline" style="justify-content:space-between">
          <div class="btn-row">
            <span class="muted">Период анализа:</span>
            ${[1, 7, 30]
              .map(
                (d) =>
                  `<button type="button" class="btn btn-sm ${state.periodDays === d ? 'btn-primary' : 'btn-ghost'} js-period" data-d="${d}">${d} дн.</button>`
              )
              .join('')}
          </div>
          <button id="run-ops-btn" type="button" class="btn btn-secondary btn-sm">⚡ Запустить ИИ-анализ Ops</button>
        </div>
      </div>

      <div class="grid-4">
        <div class="card"><div class="kpi-label">Средний FPS / Худший p5</div><div class="kpi-value">${dash.totals.meanFps} / ${dash.totals.worstP5Fps}</div><div class="muted">Сессий за период: ${dash.totals.totalSessions}</div></div>
        <div class="card"><div class="kpi-label">TMA RTT p50 / p95</div><div class="kpi-value">${dash.totals.meanRttP50Ms} / ${dash.totals.meanRttP95Ms} мс</div><div class="muted">Порог предупреждения клиента: &gt;100 мс</div></div>
        <div class="card"><div class="kpi-label">Краши / WebGL Context Loss</div><div class="kpi-value">${dash.totals.totalCrashes} (${dash.totals.crashRatePct}%)</div><div class="muted">Потерь WebGL: ${dash.totals.webglLost}</div></div>
        <div class="card"><div class="kpi-label">Отказы ввода / HTTP 5xx</div><div class="kpi-value">${dash.totals.rejectRatePct}% / ${dash.totals.errors5xx}</div><div class="muted">Собственных сводок в памяти зоны: ${dash.ownSummaryHistoryCount}</div></div>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3 class="card-title">5 коридоров задержки RTT в Telegram Mini App (13-telegram-miniapp-latency.md)</h3>
          <div class="table-wrap" style="margin-top:10px">
            <table>
              <thead><tr><th>Коридор RTT</th><th>Оценка</th><th>Сессий</th></tr></thead>
              <tbody>
                <tr><td><code>&lt; 35 мс</code></td><td>${badge('ok', 'Отлично (LAN-отклик)')}</td><td>${b.excellent_lt35}</td></tr>
                <tr><td><code>35–65 мс</code></td><td>${badge('ok', 'Хорошо (целевой TMA)')}</td><td>${b.good_35_65}</td></tr>
                <tr><td><code>65–100 мс</code></td><td>${badge('warning', 'Играбельно (rollback-буфер)')}</td><td>${b.playable_65_100}</td></tr>
                <tr><td><code>100–150 мс</code></td><td>${badge('warning', 'Плохо (баннер >100 мс)')}</td><td>${b.poor_100_150}</td></tr>
                <tr><td><code>&gt; 150 мс</code></td><td>${badge('critical', 'Неприемлемо для PvP')}</td><td>${b.unacceptable_gt150}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h3 class="card-title">10 канонических кодов отказа движка (12_match_rules.js)</h3>
          <div class="table-wrap" style="margin-top:10px">
            <table>
              <thead><tr><th>Код отказа PRESS_REJECTION_REASONS</th><th>Количество</th></tr></thead>
              <tbody>
                ${Object.entries(dash.allRejectCodes)
                  .map(([code, cnt]) => `<tr><td><code>${esc(code)}</code></td><td><strong>${cnt}</strong></td></tr>`)
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Стабильность по платформам Telegram Mini App / Web</h3>
        <div class="table-wrap" style="margin-top:10px">
          <table>
            <thead><tr><th>Платформа</th><th>Сессий</th><th>Средний FPS</th><th>RTT p50 (мс)</th><th>RTT p95 (мс)</th><th>Краши</th><th>WebGL Loss</th></tr></thead>
            <tbody>
              ${dash.byPlatform
                .map(
                  (p) =>
                    `<tr><td><code>${esc(p.platform)}</code></td><td>${p.sessions}</td><td>${p.avg_fps}</td><td>${p.rtt_p50_ms}</td><td>${p.rtt_p95_ms}</td><td>${p.crashes}</td><td>${p.webgl_lost}</td></tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    el.querySelectorAll('.js-period').forEach((bEl) => {
      bEl.addEventListener('click', async () => {
        state.periodDays = Number(bEl.dataset.d);
        await renderOps(el);
      });
    });
    document.getElementById('run-ops-btn').addEventListener('click', async () => {
      await api('/api/admin/zones/ops/run', { method: 'POST' });
      showToast('ИИ-воркер Ops обновил сводку');
      await renderOps(el);
    });
  }

  // ==========================================================================
  // 4. ZONE 2: FRAUD (ALL 8 DETECTORS + ZERO AUTO-BAN)
  // ==========================================================================
  async function renderFraud(el) {
    const dash = await api('/api/admin/zones/fraud');

    el.innerHTML = `
      <div class="grid-4">
        <div class="card"><div class="kpi-label">Режим автобанов ИИ</div><div class="kpi-value" style="color:var(--ok)">ВЫКЛЮЧЕН</div><div class="muted">Архитектурный запрет 02-ai-zones.md</div></div>
        <div class="card"><div class="kpi-label">Открытых кейсов</div><div class="kpi-value">${dash.counts.openCases}</div><div class="muted">Высокий риск (&ge;0.80): ${dash.counts.highRiskOpen}</div></div>
        <div class="card"><div class="kpi-label">Подтверждённый фрод</div><div class="kpi-value">${dash.counts.confirmedFraud}</div><div class="muted">Ложных срабатываний: ${dash.counts.falsePositives}</div></div>
        <div class="card"><div class="kpi-label">Активных детекторов</div><div class="kpi-value">${dash.detectorsActive.length} / 8</div><div class="muted">Чтение только через v_fraud_players</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Сводка по типам антифрод-сигналов</h3>
          <button id="run-fraud-btn" type="button" class="btn btn-secondary btn-sm">🛡️ Пересчитать Fraud-зону</button>
        </div>
        <div class="btn-row" style="margin-bottom:10px">
          ${dash.byType.map((t) => `${badge('warning', `${t.case_type}: ${t.cnt} (avg ${t.avg_risk})`)}`).join('')}
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Кейс / Псевдоним</th><th>Регион</th><th>Тип детектора</th><th>Риск</th><th>Сигналы</th><th>Статус / Ручной вердикт администратора</th></tr>
            </thead>
            <tbody>
              ${dash.cases
                .map(
                  (c) => `
                  <tr>
                    <td><code>${esc(c.player_alias || c.player_id)}</code><div class="muted">${esc(c.id.slice(0, 8))}</div></td>
                    <td>${esc(c.region)}</td>
                    <td><code>${esc(c.case_type)}</code></td>
                    <td><strong>${c.risk_score}</strong></td>
                    <td class="muted">${esc((c.signals.signals || []).join('; ') || JSON.stringify(c.signals).slice(0, 140))}</td>
                    <td>
                      ${
                        c.status === 'open'
                          ? `<div class="btn-row">
                              <button type="button" class="btn btn-danger btn-sm js-fraud-verdict" data-id="${esc(c.id)}" data-verdict="confirmed_fraud" data-action="ban">Бан (человек)</button>
                              <button type="button" class="btn btn-secondary btn-sm js-fraud-verdict" data-id="${esc(c.id)}" data-verdict="confirmed_fraud" data-action="suspend">Заморозка</button>
                              <button type="button" class="btn btn-ghost btn-sm js-fraud-verdict" data-id="${esc(c.id)}" data-verdict="false_positive" data-action="none">Ложный</button>
                            </div>`
                          : `${badge(c.status)} <span class="muted">${esc(c.reviewed_by || '')}</span>`
                      }
                    </td>
                  </tr>
                `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('run-fraud-btn').addEventListener('click', async () => {
      await api('/api/admin/zones/fraud/run', { method: 'POST' });
      showToast('Антифрод-детекторы и сводка Fraud обновлены');
      await renderFraud(el);
    });

    el.querySelectorAll('.js-fraud-verdict').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await api(`/api/admin/fraud/cases/${btn.dataset.id}/review`, {
          method: 'POST',
          body: {
            verdict: btn.dataset.verdict,
            playerAction: btn.dataset.action,
            note: 'Ручной вердикт администратора в CRM',
          },
        });
        showToast('Ручной вердикт сохранён и зафиксирован в аудите');
        await renderFraud(el);
      });
    });
  }

  // ==========================================================================
  // 5. ZONE 3: BALANCE (OVAL HEATMAP + 6-ZONE TABLE MATRIX + 35 MATCH_RULES)
  // ==========================================================================
  function drawOvalHeatmap(canvas, bins, rules) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;

    // Grid axes
    ctx.strokeStyle = '#1e2b45';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.stroke();

    // Draw binned points
    for (const b of bins) {
      const x = cx + Number(b.bin_along) * 1.25;
      const y = cy + Number(b.bin_across) * 1.05;
      const rejRatio = b.total > 0 ? b.rejected_cnt / b.total : 0;
      const alpha = Math.min(0.9, 0.22 + b.total / 45);
      ctx.fillStyle = rejRatio > 0.45 ? `rgba(239,68,68,${alpha})` : `rgba(34,197,94,${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, Math.min(13, 4 + Math.sqrt(b.total)), 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw touch oval boundary
    const rx = Number(rules.ovalForwardMaxPx || 120) * 1.25;
    const ry = Number(rules.contactSideTouchPx || 64) * 1.05;
    ctx.strokeStyle = '#2dd4bf';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  async function renderBalance(el) {
    const dash = await api(`/api/admin/zones/balance?periodDays=${state.periodDays}`);
    const zoneOrder = ['deep_bh', 'deep_mid', 'deep_fh', 'short_bh', 'short_mid', 'short_fh'];
    const zMap = Object.fromEntries(dash.tableZoneDifficulty.map((z) => [z.table_zone, z]));

    el.innerHTML = `
      <div class="grid-4">
        <div class="card"><div class="kpi-label">Активная ревизия правил</div><div class="kpi-value">v${dash.activeVersion} (${dash.rulesFieldCount} полей)</div><div class="muted">Единые честные правила без Pay-to-Win</div></div>
        <div class="card"><div class="kpi-label">Принято нажатий / Контакт</div><div class="kpi-value">${dash.totals.acceptRatePct}% / ${dash.totals.contactRatePct}%</div><div class="muted">Всего свайпов: ${dash.totals.totalPresses}</div></div>
        <div class="card"><div class="kpi-label">Без свежего свайпа</div><div class="kpi-value">${dash.totals.missingFreshSwipes}</div><div class="muted">Grace-спасений на краю: ${dash.totals.graceHits}</div></div>
        <div class="card"><div class="kpi-label">Средняя скорость / Вращение</div><div class="kpi-value">${dash.totals.avgBallSpeedMs} м/с</div><div class="muted">Spin: ${dash.totals.avgSpinRadS} рад/с · Реакция: ${dash.totals.avgReactionMs} мс</div></div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Теплокарта овала нажатий (along × across)</h3>
            <button id="run-balance-btn" type="button" class="btn btn-secondary btn-sm">🎯 Пересчитать Balance</button>
          </div>
          <canvas id="balance-heatmap" class="heatmap-canvas" width="520" height="300"></canvas>
          <div class="muted" style="margin-top:6px">Зелёные точки — принятые удары внутри овала; красные — отказы (<code>OUTSIDE_ZONE</code> / <code>NO_FRESH_SWIPE</code>); пунктир — текущий touch-овал.</div>
        </div>

        <div class="card">
          <h3 class="card-title">Матрица сложности по 6 зонам стола (02-ai-zones.md)</h3>
          <p class="muted">Показывает процент контакта, индекс сложности и главный код отказа для коротких/глубоких мячей под BH / Центр / FH.</p>
          <div class="court-grid">
            ${zoneOrder
              .slice(0, 3)
              .map((zk) => {
                const z = zMap[zk] || {};
                return `<div class="court-cell">
                  <strong>${esc(zk.toUpperCase())}</strong>
                  <div style="font-size:18px;font-weight:800;margin:4px 0">${z.contact_rate_pct ?? 0}% контакт</div>
                  <div class="muted">Сложность: ${z.difficulty_index ?? 0}% (${z.total_shots ?? 0} уд.)</div>
                  <div class="muted">Отказ: <code>${esc(z.top_reject_code || '—')}</code></div>
                </div>`;
              })
              .join('')}
            <div class="court-net">СЕТКА СТОЛА TOPSPIN ARENA</div>
            ${zoneOrder
              .slice(3)
              .map((zk) => {
                const z = zMap[zk] || {};
                return `<div class="court-cell">
                  <strong>${esc(zk.toUpperCase())}</strong>
                  <div style="font-size:18px;font-weight:800;margin:4px 0">${z.contact_rate_pct ?? 0}% контакт</div>
                  <div class="muted">Сложность: ${z.difficulty_index ?? 0}% (${z.total_shots ?? 0} уд.)</div>
                  <div class="muted">Отказ: <code>${esc(z.top_reject_code || '—')}</code></div>
                </div>`;
              })
              .join('')}
          </div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3 class="card-title">Сегменты устройств, хвата (shakehand/penhold) и руки (right/left)</h3>
          <div class="table-wrap" style="margin-top:8px">
            <table>
              <thead><tr><th>Устройство</th><th>Хват</th><th>Рука</th><th>Ударов</th><th>Принято %</th><th>Контакт %</th><th>OUTSIDE_ZONE %</th></tr></thead>
              <tbody>
                ${dash.bySegment
                  .map(
                    (s) =>
                      `<tr><td><code>${esc(s.pointer_type)}</code></td><td>${esc(s.grip)}</td><td>${esc(s.hand)}</td><td>${s.presses}</td><td>${s.accept_rate_pct}%</td><td>${s.contact_rate_pct}%</td><td>${s.outside_zone_pct}%</td></tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Публикация новой ревизии MATCH_RULES (подтверждение владельца)</h3>
            <button id="inspect-all-rules-btn" type="button" class="btn btn-ghost btn-sm">Все ${dash.rulesFieldCount} полей JSON</button>
          </div>
          <form id="publish-rules-form" class="form-stack">
            <div class="grid-3">
              <label><span>ovalForwardMaxPx</span><input name="ovalForwardMaxPx" type="number" step="1" value="${esc(dash.activeRules.ovalForwardMaxPx)}" /></label>
              <label><span>contactSideTouchPx</span><input name="contactSideTouchPx" type="number" step="1" value="${esc(dash.activeRules.contactSideTouchPx)}" /></label>
              <label><span>ovalSideMousePx</span><input name="ovalSideMousePx" type="number" step="1" value="${esc(dash.activeRules.ovalSideMousePx)}" /></label>
              <label><span>pressRadiusPx</span><input name="pressRadiusPx" type="number" step="1" value="${esc(dash.activeRules.pressRadiusPx)}" /></label>
              <label><span>serveCaptureRadius</span><input name="serveCaptureRadius" type="number" step="0.01" value="${esc(dash.activeRules.serveCaptureRadius)}" /></label>
              <label><span>sweetRadius</span><input name="sweetRadius" type="number" step="0.001" value="${esc(dash.activeRules.sweetRadius)}" /></label>
            </div>
            <label><span>Комментарий к релизу правил</span><input name="comment" value="Калибровка мобильного овала по данным Balance и Lab" required /></label>
            <button type="submit" class="btn btn-primary">Опубликовать глобальную ревизию MATCH_RULES v${dash.activeVersion + 1}</button>
          </form>
        </div>
      </div>
    `;

    drawOvalHeatmap(document.getElementById('balance-heatmap'), dash.heatmapBins, dash.activeRules);

    document.getElementById('inspect-all-rules-btn').addEventListener('click', () => {
      openModal(`Полный профиль MATCH_RULES v${dash.activeVersion} (12_match_rules.js)`, dash.activeRules);
    });

    document.getElementById('run-balance-btn').addEventListener('click', async () => {
      await api('/api/admin/zones/balance/run', { method: 'POST' });
      showToast('Сводка зоны Balance пересчитана');
      await renderBalance(el);
    });

    document.getElementById('publish-rules-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const patch = {};
      for (const [k, v] of fd.entries()) {
        if (k !== 'comment') patch[k] = Number(v);
      }
      const res = await api('/api/admin/balance/rules', {
        method: 'POST',
        body: { rulesPatch: patch, comment: fd.get('comment') },
      });
      showToast(`Опубликована новая глобальная версия MATCH_RULES v${res.version}`);
      await renderBalance(el);
    });
  }

  // ==========================================================================
  // 6. ZONE 4: MARKET (14 KPIS + SORTABLE CAMPAIGNS + SINK/SOURCE ECONOMY)
  // ==========================================================================
  async function renderMarket(el) {
    const dash = await api(`/api/admin/zones/market?periodDays=${state.periodDays}`);
    const k = dash.kpis;

    const sortedCampaigns = [...dash.campaigns].sort((a, b) => {
      const av = Number(a[state.marketSortCol] ?? 0);
      const bv = Number(b[state.marketSortCol] ?? 0);
      return state.marketSortAsc ? av - bv : bv - av;
    });

    el.innerHTML = `
      <div class="grid-4">
        <div class="card"><div class="kpi-label">DAU / MAU (Stickiness)</div><div class="kpi-value">${k.dau} / ${k.mau} (${k.stickinessPct}%)</div><div class="muted">Конверсия в платящих: ${k.payerConversionPct}%</div></div>
        <div class="card"><div class="kpi-label">Выручка (IAP + Ads)</div><div class="kpi-value">$${k.totalRevenueUsd}</div><div class="muted">IAP $${k.iapRevenueUsd} · Ads $${k.adRevenueUsd} (eCPM $${k.ecpmUsd})</div></div>
        <div class="card"><div class="kpi-label">ARPU / ARPPU / ARPDAU</div><div class="kpi-value">$${k.arpuUsd} / $${k.arppuUsd} / $${k.arpdauUsd}</div><div class="muted">Blended CPI $${k.blendedCpiUsd} · CAC $${k.blendedCacUsd}</div></div>
        <div class="card"><div class="kpi-label">Blended ROAS / Инфляция монет</div><div class="kpi-value">${k.blendedRoasPct}%</div><div class="muted">Coins sink/source: ${dash.economy.coinSinkRatio} · Gems: ${dash.economy.gemSinkRatio}</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Кампании, креативы и удержание D1 / D7 / D30 (клик по заголовку сортирует)</h3>
          <button id="run-market-btn" type="button" class="btn btn-secondary btn-sm">📈 Пересчитать Market</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Канал / Кампания</th>
                <th>Креатив</th>
                <th class="sortable js-sort" data-col="spend_usd">Расход $ ⇅</th>
                <th class="sortable js-sort" data-col="installs">Установки ⇅</th>
                <th class="sortable js-sort" data-col="cpiUsd">CPI $ ⇅</th>
                <th class="sortable js-sort" data-col="d1Pct">D1 % ⇅</th>
                <th class="sortable js-sort" data-col="d7Pct">D7 % ⇅</th>
                <th class="sortable js-sort" data-col="d30Pct">D30 % ⇅</th>
                <th class="sortable js-sort" data-col="ltvD30Usd">LTV D30 ⇅</th>
                <th class="sortable js-sort" data-col="roasPct">ROAS % ⇅</th>
              </tr>
            </thead>
            <tbody>
              ${sortedCampaigns
                .map(
                  (c) => `
                  <tr>
                    <td><strong>${esc(c.source)}</strong><div class="muted">${esc(c.campaign)}</div></td>
                    <td><code>${esc(c.creative)}</code></td>
                    <td>$${c.spend_usd}</td>
                    <td>${c.installs}</td>
                    <td>$${c.cpiUsd}</td>
                    <td>${c.d1Pct}%</td>
                    <td>${c.d7Pct}%</td>
                    <td>${c.d30Pct}%</td>
                    <td>$${c.ltvD30Usd}</td>
                    <td>${c.roasPct !== null ? badge(c.roasPct < 80 ? 'critical' : 'ok', `${c.roasPct}%`) : 'Organic'}</td>
                  </tr>
                `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3 class="card-title">Когорты по источнику установки (v_market_players)</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Источник</th><th>Игроков когорты</th><th>Платящих</th><th>IAP выручка $</th></tr></thead>
              <tbody>
                ${dash.cohortsBySource
                  .map(
                    (c) =>
                      `<tr><td><code>${esc(c.install_source)}</code></td><td>${c.cohort_users}</td><td>${c.cohort_payers}</td><td>$${c.cohort_iap_usd}</td></tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h3 class="card-title">Баланс внутриигровой экономики (Sink / Source)</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Валюта</th><th>Поток</th><th>Причина</th><th>Объём</th></tr></thead>
              <tbody>
                ${dash.economy.ledgerBreakdown
                  .map(
                    (r) =>
                      `<tr><td><code>${esc(r.currency)}</code></td><td>${badge(r.flow_type === 'sink' ? 'ok' : 'warning', r.flow_type)}</td><td>${esc(r.reason)}</td><td>${r.total_amount}</td></tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    el.querySelectorAll('.js-sort').forEach((th) => {
      th.addEventListener('click', async () => {
        const col = th.dataset.col;
        if (state.marketSortCol === col) state.marketSortAsc = !state.marketSortAsc;
        else {
          state.marketSortCol = col;
          state.marketSortAsc = false;
        }
        await renderMarket(el);
      });
    });

    document.getElementById('run-market-btn').addEventListener('click', async () => {
      await api('/api/admin/zones/market/run', { method: 'POST' });
      showToast('Сводка Market обновлена');
      await renderMarket(el);
    });
  }

  // ==========================================================================
  // 7. ZONE 5: LAB (READ-ONLY BENCH RUNNER + STATISTICAL A/B)
  // ==========================================================================
  async function renderLab(el) {
    const dash = await api('/api/admin/zones/lab');

    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Автоматические стенды физического движка (Read-Only режим без касания source/)</h3>
          <div class="btn-row">
            <button type="button" class="btn btn-primary btn-sm js-bench" data-suite="noise">▶ Прогнать стенд noise</button>
            <button type="button" class="btn btn-secondary btn-sm js-bench" data-suite="calibrate">▶ Прогнать стенд calibrate</button>
            <button id="run-lab-ai-btn" type="button" class="btn btn-ghost btn-sm">🧪 ИИ-анализ Lab (Batch -50%)</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Стенд</th><th>Ветка</th><th>Статус</th><th>Время</th><th>Сводка</th><th>Дата</th></tr></thead>
            <tbody>
              ${dash.runs
                .map(
                  (r) =>
                    `<tr><td><code>${esc(r.suite)}</code></td><td><code>${esc(r.git_branch)}</code></td><td>${badge(r.status)}</td><td>${r.duration_ms} мс</td><td class="muted">${esc(JSON.stringify(r.summary).slice(0, 140))}</td><td class="muted">${esc(r.created_at.slice(0, 19))}</td></tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3 class="card-title">Статистические A/B эксперименты MATCH_RULES</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Эксперимент</th><th>Выборка C/T</th><th>Контакт C/T</th><th>z-score / p-value</th><th>Статус</th></tr></thead>
              <tbody>
                ${dash.experiments
                  .map(
                    (e) => `
                    <tr>
                      <td><strong>${esc(e.slug)}</strong><div class="muted">${esc(e.hypothesis)}</div></td>
                      <td>${e.control_sessions} / ${e.treatment_sessions}</td>
                      <td>${e.control_contact_rate}% → <strong>${e.treatment_contact_rate}%</strong> (${e.upliftContactPts > 0 ? '+' : ''}${e.upliftContactPts} п.п.)</td>
                      <td>z=${e.zScore}, p=${e.computedPValue} ${e.statisticallySignificant ? badge('ok', 'Значимо p<0.05') : badge('warning', 'Набор выборки')}</td>
                      <td>${badge(e.status)}</td>
                    </tr>
                  `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h3 class="card-title">Запустить новую A/B гипотезу</h3>
          <form id="new-ab-form" class="form-stack">
            <label><span>Slug эксперимента</span><input name="slug" placeholder="oval_touch_q4_v2" required /></label>
            <label><span>Гипотеза</span><input name="hypothesis" placeholder="Увеличение contactForwardPx со 150 до 158 улучшит приём топспинов" required /></label>
            <label><span>JSON-патч MATCH_RULES</span><input name="patch" value='{"contactForwardPx": 158}' required /></label>
            <button type="submit" class="btn btn-primary btn-sm">Создать A/B эксперимент</button>
          </form>
        </div>
      </div>
    `;

    el.querySelectorAll('.js-bench').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const res = await api('/api/admin/lab/run-suite', { method: 'POST', body: { suite: btn.dataset.suite } });
        showToast(`Стенд ${res.run.suite} завершён со статусом ${res.run.status} (${res.run.durationMs} мс)`);
        await renderLab(el);
      });
    });

    document.getElementById('run-lab-ai-btn').addEventListener('click', async () => {
      await api('/api/admin/zones/lab/run', { method: 'POST' });
      showToast('Batch-анализ зоны Lab завершён');
      await renderLab(el);
    });

    document.getElementById('new-ab-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const rulesPatch = JSON.parse(fd.get('patch'));
      await api('/api/admin/lab/experiments', {
        method: 'POST',
        body: { slug: fd.get('slug'), hypothesis: fd.get('hypothesis'), rulesPatch },
      });
      showToast('Новый A/B эксперимент зарегистрирован');
      await renderLab(el);
    });
  }

  // ==========================================================================
  // 8. OBSERVABILITY, RUNBOOKS, POST-MORTEMS & READ-ONLY TELEGRAM BOT
  // ==========================================================================
  async function renderObservability(el) {
    const obs = await api('/api/admin/observability');
    const gs = obs.goldenSignals;

    el.innerHTML = `
      <div class="grid-4">
        <div class="card"><div class="kpi-label">1. Latency (HTTP p50/p95/p99)</div><div class="kpi-value">${gs.latency.httpP50Ms}/${gs.latency.httpP95Ms}/${gs.latency.httpP99Ms} мс</div><div class="muted">Client RTT p95: ${gs.latency.clientRttP95Ms} мс</div></div>
        <div class="card"><div class="kpi-label">2. Traffic (CCU &amp; RPS)</div><div class="kpi-value">${gs.traffic.ccu} CCU · ${gs.traffic.rps1m} rps</div><div class="muted">Активных WS /ws/client: ${gs.traffic.activeWebSockets}</div></div>
        <div class="card"><div class="kpi-label">3. Errors (4xx / 5xx / Timeouts)</div><div class="kpi-value">${gs.errors.http4xx5m} / ${gs.errors.http5xx5m} / ${gs.errors.wsTimeouts24h}</div><div class="muted">Карантин ИИ (7д): ${gs.errors.quarantinedAiOutputs}</div></div>
        <div class="card"><div class="kpi-label">4. Saturation (CPU / RSS / SQLite)</div><div class="kpi-value">${gs.saturation.cpuUtilizationPct}% · ${gs.saturation.rssMemoryMb} МБ</div><div class="muted">БД: ${gs.saturation.sqliteSizeMb} МБ · WS pool: ${gs.saturation.wsConnectionPoolPct}%</div></div>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3 class="card-title">Инциденты и маршрутизация (Info / Warning / Critical)</h3>
          <div class="table-wrap" style="margin-top:8px">
            <table>
              <thead><tr><th>Уровень</th><th>Зона / Заголовок</th><th>Канал</th><th>Runbook</th><th>Действие</th></tr></thead>
              <tbody>
                ${obs.incidents
                  .map(
                    (i) => `
                    <tr>
                      <td>${badge(i.severity)}</td>
                      <td><strong>[${esc(i.zone)}]</strong> ${esc(i.title)}<div class="muted">${esc(i.status)} ${i.ack_by ? `(${esc(i.ack_by)})` : ''}</div></td>
                      <td><code>${esc(i.routingChannel)}</code></td>
                      <td>${i.runbook_slug ? `<button type="button" class="btn btn-ghost btn-sm js-open-rb" data-slug="${esc(i.runbook_slug)}">📖 ${esc(i.runbook_slug)}</button>` : '—'}</td>
                      <td>
                        ${
                          i.status !== 'resolved'
                            ? `<div class="btn-row">
                                <button type="button" class="btn btn-secondary btn-sm js-inc-act" data-id="${esc(i.id)}" data-act="ack">Ack</button>
                                <button type="button" class="btn btn-primary btn-sm js-inc-act" data-id="${esc(i.id)}" data-act="resolve">Закрыть</button>
                              </div>`
                            : badge('ok', 'Закрыт')
                        }
                      </td>
                    </tr>
                  `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>

          <h4 style="margin:14px 0 6px">Операционные Runbooks (${obs.runbooks.length})</h4>
          <div class="btn-row">
            ${obs.runbooks.map((rb) => `<button type="button" class="btn btn-ghost btn-sm js-open-rb" data-slug="${esc(rb.slug)}">📘 ${esc(rb.slug)}</button>`).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Read-Only Telegram Ops Bot + Callback Ack</h3>
            ${badge('ok', 'Мутации запрещены')}
          </div>
          <p class="muted">Проверьте все 8 разрешённых pull-команд, попытку опасной команды (<code>/ban</code>) или инлайн-кнопку <code>[Принял / В работе]</code>:</p>
          <div class="btn-row" style="margin-bottom:10px">
            ${['/status', '/ping', '/errors', '/players', '/revenue', '/ai', '/fraud', '/help', '/ban_player_1']
              .map((cmd) => `<button type="button" class="btn btn-secondary btn-sm js-bot-cmd" data-cmd="${cmd}">${cmd}</button>`)
              .join('')}
            ${
              obs.incidents[0]
                ? `<button type="button" class="btn btn-primary btn-sm" id="sim-tg-ack-btn" data-id="${esc(obs.incidents[0].id)}">📲 Inline Ack (${esc(obs.incidents[0].id.slice(0, 8))})</button>`
                : ''
            }
          </div>
          <pre id="bot-output-pre" style="background:var(--bg-0);padding:12px;border-radius:8px;min-height:140px;white-space:pre-wrap;font-size:12px">Нажмите любую команду выше для проверки Read-Only контура Telegram-бота...</pre>

          <h4 style="margin:14px 0 6px">9 Региональных узлов Telegram Mini App</h4>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Регион</th><th>Узел</th><th>Целевой RTT</th><th>Статус</th></tr></thead>
              <tbody>
                ${Object.entries(obs.regionEndpoints)
                  .map(
                    ([reg, ep]) =>
                      `<tr><td><strong>${esc(reg)}</strong></td><td><code>${esc(ep.nodeId)}</code></td><td>${ep.targetRttMs ? `${ep.targetRttMs} мс` : '—'}</td><td>${badge(ep.active ? 'ok' : 'warning', ep.rollout)}</td></tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Blameless Post-Mortems (Разборы инцидентов без поиска виноватых)</h3>
        ${obs.postmortems
          .map(
            (pm) => `
            <div style="border-top:1px solid var(--border);padding-top:10px;margin-top:10px">
              <strong>${esc(pm.incident_title || pm.incident_id)}</strong> ${badge(pm.incident_severity || 'warning')}
              <div class="muted" style="margin:4px 0">${esc(pm.blameless_summary)}</div>
              <div class="muted"><strong>Root cause:</strong> ${esc(pm.root_cause)} · <strong>Fix:</strong> ${esc(pm.fix_applied)}</div>
            </div>
          `
          )
          .join('')}
      </div>
    `;

    el.querySelectorAll('.js-open-rb').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const rb = await api(`/api/admin/runbooks/${btn.dataset.slug}`);
        openModal(rb.title, rb.content);
      });
    });

    el.querySelectorAll('.js-inc-act').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await api(`/api/admin/incidents/${btn.dataset.id}/status`, {
          method: 'POST',
          body: { action: btn.dataset.act },
        });
        showToast(`Статус инцидента обновлён (${btn.dataset.act})`);
        await renderObservability(el);
      });
    });

    el.querySelectorAll('.js-bot-cmd').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const res = await api('/api/admin/telegram/command', {
          method: 'POST',
          body: { command: btn.dataset.cmd },
        });
        document.getElementById('bot-output-pre').textContent = res.reply;
      });
    });

    const tgAckBtn = document.getElementById('sim-tg-ack-btn');
    if (tgAckBtn) {
      tgAckBtn.addEventListener('click', async () => {
        const res = await api('/api/admin/telegram/callback', {
          method: 'POST',
          body: { callbackData: `ack:${tgAckBtn.dataset.id}` },
        });
        document.getElementById('bot-output-pre').textContent = res.reply;
        await renderObservability(el);
      });
    }
  }

  // ==========================================================================
  // 9. LIVEOPS: MAINTENANCE, PUSHES, FULL NEWS CRUD, TICKETS, FEEDBACK & PATCHES
  // ==========================================================================
  async function renderLiveops(el) {
    const lo = await api('/api/admin/liveops');
    const editingPost = state.editingNewsId ? lo.news.find((n) => n.id === state.editingNewsId) : null;

    el.innerHTML = `
      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Режим технических работ (Maintenance Mode + HTTP 503 + Автопуши)</h3>
            ${badge(lo.maintenance.enabled ? 'critical' : 'ok', lo.maintenance.enabled ? 'ВКЛЮЧЕН' : 'ВЫКЛЮЧЕН')}
          </div>
          <form id="maint-form" class="form-stack">
            <label><span>Баннер RU</span><input name="bannerRu" value="${esc(lo.maintenance.bannerRu || 'Плановое обновление серверов TOPSPIN ARENA (15 минут). Активные матчи завершатся штатно.')}" /></label>
            <label><span>ETA завершения (ISO)</span><input name="etaIso" value="${esc(lo.maintenance.etaIso || new Date(Date.now() + 1800000).toISOString())}" /></label>
            <div class="btn-row">
              <button type="submit" data-enable="1" class="btn btn-danger btn-sm">Включить техработы (503 для новых партий)</button>
              <button type="submit" data-enable="0" class="btn btn-primary btn-sm">Открыть серверы</button>
            </div>
          </form>
        </div>

        <div class="card">
          <h3 class="card-title">Приоритетные админ-пуши (отдельно от ленты новостей)</h3>
          <form id="push-form" class="form-stack">
            <div class="grid-2">
              <label><span>Приоритет</span>
                <select name="priority">
                  <option value="important">Important (Важно)</option>
                  <option value="critical">Critical (Экстренно)</option>
                  <option value="normal">Normal</option>
                </select>
              </label>
              <label><span>Сегмент</span><input name="segment" value="all" /></label>
            </div>
            <label><span>Заголовок RU</span><input name="titleRu" placeholder="⚡ Турнир выходного дня открыт!" required /></label>
            <label><span>Текст RU</span><input name="bodyRu" placeholder="Подключайтесь к серии матчей до 11 очков." required /></label>
            <button type="submit" class="btn btn-primary btn-sm">Отправить закреплённый пуш</button>
          </form>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">${editingPost ? '✏️ Редактирование новости (PUT)' : '📰 Публикация новости (полный CRUD RU/EN)'}</h3>
            ${editingPost ? `<button id="cancel-edit-news-btn" type="button" class="btn btn-ghost btn-sm">Отменить редактирование</button>` : ''}
          </div>
          <form id="news-form" class="form-stack">
            <label><span>Категория</span>
              <select name="category">
                ${['update', 'tournament', 'balance', 'maintenance', 'promo']
                  .map((c) => `<option value="${c}" ${editingPost?.category === c ? 'selected' : ''}>${c}</option>`)
                  .join('')}
              </select>
            </label>
            <label><span>Заголовок RU</span><input name="titleRu" value="${esc(editingPost?.title_ru || '')}" required /></label>
            <label><span>Текст RU</span><textarea name="bodyRu" rows="2" required>${esc(editingPost?.body_ru || '')}</textarea></label>
            <label><span>Заголовок EN</span><input name="titleEn" value="${esc(editingPost?.title_en || '')}" /></label>
            <button type="submit" class="btn btn-primary btn-sm">${editingPost ? 'Сохранить изменения (PUT)' : 'Опубликовать новость'}</button>
          </form>

          <div class="table-wrap" style="margin-top:12px">
            <table>
              <thead><tr><th>Категория</th><th>Заголовок RU</th><th>Обновлено</th><th>Действия</th></tr></thead>
              <tbody>
                ${lo.news
                  .map(
                    (n) => `
                    <tr>
                      <td><code>${esc(n.category)}</code></td>
                      <td><strong>${esc(n.title_ru)}</strong></td>
                      <td class="muted">${esc((n.updated_at || n.created_at).slice(0, 16))}</td>
                      <td class="btn-row">
                        <button type="button" class="btn btn-secondary btn-sm js-edit-news" data-id="${esc(n.id)}">✎ Изменить</button>
                        <button type="button" class="btn btn-danger btn-sm js-del-news" data-id="${esc(n.id)}">✕</button>
                      </td>
                    </tr>
                  `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h3 class="card-title">Тикеты поддержки игроков (Скриншоты + История статусов + Автопривязка)</h3>
          ${lo.tickets
            .map(
              (t) => `
              <div style="border-top:1px solid var(--border);padding:10px 0">
                <div style="display:flex;justify-content:space-between;gap:8px">
                  <strong>[${esc(t.category)}] ${esc(t.subject)}</strong>
                  <span>${badge(t.priority)} ${badge(t.status)}</span>
                </div>
                <div class="muted">
                  Игрок: <code>${esc(t.player_id || 'anon')}</code> · Регион: ${esc(t.region)}
                  ${t.linked_incident_id ? ` · Привязан к инциденту <code>${esc(t.linked_incident_id.slice(0, 12))}</code>` : ''}
                  ${t.screenshotMeta ? ` · 📎 Скриншот: <code>${esc(t.screenshotMeta.name)}</code>` : ''}
                </div>
                <div style="margin:6px 0;font-size:12.5px">
                  ${t.messages.map((m) => `<div><strong>${esc(m.sender_role)}:</strong> ${esc(m.body)}</div>`).join('')}
                </div>
                <div class="muted" style="font-size:11px;margin-bottom:6px">
                  История статусов: ${t.statusHistory.map((h) => `${h.from_status || 'new'}→${h.to_status} (${h.actor})`).join(' · ')}
                </div>
                ${
                  t.status !== 'closed'
                    ? `<form class="js-ticket-reply-form" data-id="${esc(t.id)}" style="display:flex;gap:6px">
                        <input name="body" placeholder="Ответ службы поддержки..." required />
                        <select name="status" style="width:130px">
                          <option value="answered">answered</option>
                          <option value="in_progress">in_progress</option>
                          <option value="closed">closed</option>
                        </select>
                        <button type="submit" class="btn btn-primary btn-sm">Ответить</button>
                      </form>`
                    : ''
                }
              </div>
            `
            )
            .join('')}
        </div>
      </div>

      <div class="grid-3">
        <div class="card">
          <h3 class="card-title">Цикл фидбека (Collect → Sort → Prioritize → Respond)</h3>
          ${lo.feedback
            .map(
              (f) => `
              <div style="border-top:1px solid var(--border);padding:8px 0">
                <div style="display:flex;justify-content:space-between">${badge(f.stage === 'responded' ? 'ok' : 'warning', f.stage)} <strong>Score ${f.priority_score} (${f.votes} гол.)</strong></div>
                <div>${esc(f.summary)}</div>
                ${f.public_response ? `<div class="muted">↳ Ответ: ${esc(f.public_response)}</div>` : ''}
              </div>
            `
            )
            .join('')}
        </div>

        <div class="card">
          <h3 class="card-title">Конвейер патчей (Day-1 / Week-1 / Bi-weekly / Beta)</h3>
          ${lo.patches
            .map(
              (p) => `
              <div style="border-top:1px solid var(--border);padding:8px 0">
                <div style="display:flex;justify-content:space-between"><code>${esc(p.version)}</code> ${badge(p.status, `${p.track} · ${p.status}`)}</div>
                <div class="muted">${esc(p.changelog_ru)} (${esc(p.target_date)})</div>
              </div>
            `
            )
            .join('')}
        </div>

        <div class="card">
          <h3 class="card-title">Контент-календарь LiveOps на 6–12 месяцев</h3>
          ${lo.calendar
            .map(
              (ev) => `
              <div style="border-top:1px solid var(--border);padding:8px 0">
                <div style="display:flex;justify-content:space-between"><strong>${esc(ev.title)}</strong> ${badge(ev.status)}</div>
                <div class="muted">${esc(ev.event_type)} · ${esc(ev.starts_at.slice(0, 10))} → ${esc(ev.ends_at.slice(0, 10))}</div>
              </div>
            `
            )
            .join('')}
        </div>
      </div>
    `;

    let maintEnableFlag = true;
    el.querySelectorAll('#maint-form button[type="submit"]').forEach((b) => {
      b.addEventListener('click', () => {
        maintEnableFlag = b.dataset.enable === '1';
      });
    });
    document.getElementById('maint-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api('/api/admin/maintenance', {
        method: 'POST',
        body: { enabled: maintEnableFlag, bannerRu: fd.get('bannerRu'), etaIso: fd.get('etaIso') },
      });
      showToast(maintEnableFlag ? 'Техработы включены + отправлен автопуш' : 'Серверы открыты + отправлен автопуш');
      await renderLiveops(el);
    });

    document.getElementById('push-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api('/api/admin/pushes', {
        method: 'POST',
        body: {
          priority: fd.get('priority'),
          pinned: true,
          segment: fd.get('segment'),
          titleRu: fd.get('titleRu'),
          bodyRu: fd.get('bodyRu'),
        },
      });
      showToast('Приоритетный пуш отправлен игрокам');
      await renderLiveops(el);
    });

    document.getElementById('news-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        category: fd.get('category'),
        titleRu: fd.get('titleRu'),
        bodyRu: fd.get('bodyRu'),
        titleEn: fd.get('titleEn'),
      };
      if (state.editingNewsId) {
        await api(`/api/admin/news/${state.editingNewsId}`, { method: 'PUT', body: payload });
        state.editingNewsId = null;
        showToast('Новость отредактирована (PUT)');
      } else {
        await api('/api/admin/news', { method: 'POST', body: payload });
        showToast('Новость опубликована');
      }
      await renderLiveops(el);
    });

    const cancelEditBtn = document.getElementById('cancel-edit-news-btn');
    if (cancelEditBtn) {
      cancelEditBtn.addEventListener('click', async () => {
        state.editingNewsId = null;
        await renderLiveops(el);
      });
    }

    el.querySelectorAll('.js-edit-news').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.editingNewsId = btn.dataset.id;
        await renderLiveops(el);
      });
    });

    el.querySelectorAll('.js-del-news').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await api(`/api/admin/news/${btn.dataset.id}`, { method: 'DELETE' });
        showToast('Новость удалена');
        await renderLiveops(el);
      });
    });

    el.querySelectorAll('.js-ticket-reply-form').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        await api(`/api/admin/tickets/${form.dataset.id}/reply`, {
          method: 'POST',
          body: { body: fd.get('body'), status: fd.get('status') },
        });
        showToast('Ответ отправлен и записан в историю статусов тикета');
        await renderLiveops(el);
      });
    });
  }

  // ==========================================================================
  // 10. PLAYERS, 152-ФЗ / GDPR, REGIONAL AGE GATE & DPA REGISTRY
  // ==========================================================================
  async function renderPlayers(el, query = '') {
    const [pData, legal] = await Promise.all([
      api(`/api/admin/players?q=${encodeURIComponent(query)}`),
      api('/api/admin/legal'),
    ]);

    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Реестр игроков, выгрузка ПДн (Art. 15) и полное удаление &le;30д (152-ФЗ / GDPR Art. 17)</h3>
          <form id="player-search-form" class="form-inline">
            <input id="player-q-input" placeholder="Поиск по ID / нику / кампании..." value="${esc(query)}" style="width:240px" />
            <button type="submit" class="btn btn-secondary btn-sm">Найти</button>
          </form>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>ID игрока</th><th>Ник</th><th>Регион</th><th>Канал / Кампания</th><th>Сессий / IAP $</th><th>Статус</th><th>Права субъекта ПДн</th></tr></thead>
            <tbody>
              ${pData.players
                .slice(0, 25)
                .map(
                  (p) => `
                  <tr>
                    <td><code>${esc(p.id)}</code></td>
                    <td>${esc(p.display_name)}</td>
                    <td><strong>${esc(p.region)}</strong></td>
                    <td>${esc(p.install_source)}<div class="muted">${esc(p.install_campaign || '')}</div></td>
                    <td>${p.sessions_count} / $${p.total_iap_usd}</td>
                    <td>${badge(p.status)}</td>
                    <td class="btn-row">
                      <button type="button" class="btn btn-ghost btn-sm js-exp-plr" data-id="${esc(p.id)}">⬇ JSON ПДн</button>
                      ${
                        p.status !== 'deleted'
                          ? `<button type="button" class="btn btn-danger btn-sm js-erase-plr" data-id="${esc(p.id)}">🗑 Удалить ПДн</button>`
                          : ''
                      }
                    </td>
                  </tr>
                `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3 class="card-title">4 Юридических документа RU/EN &amp; Региональный возрастной порог</h3>
          <div class="muted" style="margin-bottom:8px">
            Возрастные пороги без согласия родителей:
            <strong>RU: ${legal.ageGateRules.RU.minAgeWithoutParentalConsent}+ (${legal.ageGateRules.RU.law})</strong> ·
            <strong>EU: ${legal.ageGateRules.EU.minAgeWithoutParentalConsent}+ (${legal.ageGateRules.EU.law})</strong> ·
            <strong>US: ${legal.ageGateRules.US.minAgeWithoutParentalConsent}+ (${legal.ageGateRules.US.law})</strong> ·
            <strong>CN без ICP: Заблокирован (HTTP 451)</strong>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Документ</th><th>Язык</th><th>Версия</th><th>Заголовок</th></tr></thead>
              <tbody>
                ${legal.documents
                  .map(
                    (d) =>
                      `<tr><td><code>${esc(d.doc_type)}</code></td><td>${esc(d.lang.toUpperCase())}</td><td>v${esc(d.version)}</td><td><button type="button" class="btn btn-ghost btn-sm js-doc-view" data-title="${esc(d.title)}" data-md="${esc(d.content_md)}">${esc(d.title)}</button></td></tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h3 class="card-title">Реестр DPA и Zero-Data-Retention по провайдерам (05-legal &amp; 16-legal)</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Провайдер</th><th>Юрисдикция</th><th>DPA</th><th>Zero-Retention</th><th>ПДн разрешены?</th></tr></thead>
              <tbody>
                ${legal.dpaRegistry
                  .map(
                    (r) =>
                      `<tr><td><code>${esc(r.provider)}</code></td><td>${esc(r.country)}</td><td>${badge(r.dpa_status)}</td><td>${r.zero_data_retention ? '✅ Да' : 'Нет'}</td><td>${r.pii_allowed ? 'Первичный ЦОД РФ' : '🔒 Запрещено (0 ПДн)'}</td></tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    document.getElementById('player-search-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await renderPlayers(el, document.getElementById('player-q-input').value.trim());
    });

    el.querySelectorAll('.js-exp-plr').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const pkg = await api(`/api/admin/players/${btn.dataset.id}/export`);
        openModal(`Выгрузка данных субъекта ПДн (${btn.dataset.id})`, pkg);
      });
    });

    el.querySelectorAll('.js-erase-plr').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const res = await api(`/api/admin/players/${btn.dataset.id}/erase`, { method: 'POST', body: {} });
        showToast(`ПДн игрока ${res.playerId} полностью стёрты (включая архив чата); платежи обезличены`);
        await renderPlayers(el, query);
      });
    });

    el.querySelectorAll('.js-doc-view').forEach((btn) => {
      btn.addEventListener('click', () => openModal(btn.dataset.title, btn.dataset.md));
    });
  }

  // ==========================================================================
  // 11. AI GOVERNANCE, JSON SCHEMAS, 26-POINT READINESS CHECKLIST, DR BACKUP & AUDIT
  // ==========================================================================
  async function renderGovernance(el) {
    const [aiData, readiness, audit] = await Promise.all([
      api('/api/admin/ai/zones'),
      api('/api/admin/system/readiness'),
      api('/api/admin/audit'),
    ]);

    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">ИИ-квоты зон, Failover-цепочки, Кэш промптов и Batch-скидка 50% (07-ai-providers.md)</h3>
          <div class="btn-row">
            <button id="view-schemas-btn" type="button" class="btn btn-ghost btn-sm">📜 JSON Schema контракты</button>
            <button id="view-isolation-btn" type="button" class="btn btn-ghost btn-sm">🧱 Матрица изоляции БД</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Зона / Роль</th><th>Провайдер → Резерв</th><th>Модель</th><th>Использовано / Лимит</th><th>Кэш / Режимы</th><th>Расход $</th></tr></thead>
            <tbody>
              ${aiData.zones
                .map(
                  (z) => `
                  <tr>
                    <td><strong>${esc(z.zone)}</strong><div class="muted"><code>${esc(z.role)}</code></div></td>
                    <td><code>${esc(z.provider)}</code> → <code>${esc(z.fallbackProvider)}</code></td>
                    <td><code>${esc(z.model)}</code></td>
                    <td>${z.usedTokens} / ${z.dailyTokenLimit} (${z.utilizationPct}%)</td>
                    <td>Кэш: ${z.cachedTokensToday} ток. ${z.batchMode ? badge('ok', 'Batch -50%') : ''} ${z.zeroRetention ? badge('ok', 'Zero-Ret') : ''}</td>
                    <td>$${z.costUsdToday}</td>
                  </tr>
                `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Живой чек-лист готовности к запуску (${readiness.passedCount}/${readiness.totalCount} — ${readiness.scorePct}%)</h3>
            <div class="btn-row">
              <button id="hot-backup-btn" type="button" class="btn btn-primary btn-sm">💾 Снять горячий DR-бэкап (VACUUM INTO)</button>
              <button id="retention-btn" type="button" class="btn btn-secondary btn-sm">🧹 Очистка сроков хранения</button>
            </div>
          </div>
          <div class="table-wrap" style="max-height:360px;overflow-y:auto">
            <table>
              <thead><tr><th>Код</th><th>Проверка (10-checklist.md)</th><th>Статус</th></tr></thead>
              <tbody>
                ${readiness.checks
                  .map(
                    (c) =>
                      `<tr><td><code>${esc(c.id)}</code></td><td>${esc(c.title)}<div class="muted">${esc(c.detail)}</div></td><td>${badge(c.passed ? 'ok' : 'critical', c.passed ? 'PASS' : 'FAIL')}</td></tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Неизменяемый журнал аудита (04-security.md)</h3>
            <a href="/api/admin/audit?format=csv" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration:none">⬇ Экспорт CSV</a>
          </div>
          <div class="table-wrap" style="max-height:360px;overflow-y:auto">
            <table>
              <thead><tr><th>Время</th><th>Роль / Актор</th><th>Действие</th><th>Цель / Токены</th></tr></thead>
              <tbody>
                ${audit.logs
                  .slice(0, 40)
                  .map(
                    (l) => `
                    <tr>
                      <td class="muted">${esc(l.created_at.slice(11, 19))}</td>
                      <td><code>${esc(l.actor_role)}</code><div class="muted">${esc(l.actor_id)}</div></td>
                      <td><strong>${esc(l.action)}</strong><div class="muted">${esc(l.provider || '')}</div></td>
                      <td><code>${esc(l.target_type || '')}:${esc((l.target_id || '').slice(0, 10))}</code> ${l.tokens_used ? `<span class="muted">(${l.tokens_used} ток.)</span>` : ''}</td>
                    </tr>
                  `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    document.getElementById('view-schemas-btn').addEventListener('click', () => {
      openModal('Формальные JSON Schema контракты (09-api-contracts.md)', aiData.schemas);
    });

    document.getElementById('view-isolation-btn').addEventListener('click', () => {
      openModal('Матрица строгой изоляции схем и обезличенных SQL Views (01-architecture.md)', aiData.isolationMatrix);
    });

    document.getElementById('hot-backup-btn').addEventListener('click', async () => {
      const b = await api('/api/admin/system/backup', { method: 'POST' });
      showToast(`Горячий бэкап создан: ${b.backupFile} (${b.sizeBytes} байт, integrity=${b.integrity})`);
      await renderGovernance(el);
    });

    document.getElementById('retention-btn').addEventListener('click', async () => {
      const r = await api('/api/admin/system/retention', { method: 'POST' });
      showToast(`Очистка сроков хранения (90/180/365д) выполнена; в архив чата перенесено: ${r.cleanup.archivedDirectorChat}`);
      await renderGovernance(el);
    });
  }

  // ==========================================================================
  // BOOTSTRAP & EVENT WIRING
  // ==========================================================================
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('login-error');
    errBox.classList.add('hidden');
    try {
      const res = await api('/api/admin/auth/login', {
        method: 'POST',
        body: {
          username: document.getElementById('login-username').value.trim(),
          password: document.getElementById('login-password').value,
        },
      });
      state.token = res.token;
      state.user = res.user;
      localStorage.setItem('topspin_crm_token', res.token);
      showCrmShell();
      await switchTab('overview');
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    }
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/admin/auth/logout', { method: 'POST' }).catch(() => {});
    state.token = '';
    state.user = null;
    localStorage.removeItem('topspin_crm_token');
    showLoginScreen();
  });

  document.querySelectorAll('#sidebar-nav .nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('refresh-current-btn').addEventListener('click', () => renderActiveTab());

  document.getElementById('modal-close-btn').addEventListener('click', () => {
    document.getElementById('modal-backdrop').classList.add('hidden');
  });
  document.getElementById('modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') {
      document.getElementById('modal-backdrop').classList.add('hidden');
    }
  });

  (async function init() {
    if (!state.token) {
      showLoginScreen();
      return;
    }
    try {
      const me = await api('/api/admin/auth/me');
      state.user = me.user;
      showCrmShell();
      await switchTab('overview');
    } catch {
      showLoginScreen();
    }
  })();
})();
