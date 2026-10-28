import { api } from './api.js';
import { esc, fmt, date, toast, modal, badge, card, empty, table, jsonBlock, formData, download } from './ui.js';

export async function settings(ctx) {
  const tab = ctx.state.settingsTab;
  const d = await api.get('/api/settings');
  const s = d.settings;
  ctx.set(`<div class="tabs">${[['general', 'Общие'], ['rules', 'MATCH_RULES'], ['ai', 'ИИ и задания'], ['security', 'Безопасность и аудит']].map(([id, label]) => `<button class="tab ${tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div><div id="settings-content"></div>`);
  const root = document.getElementById('settings-content');
  if (tab === 'general') {
    root.innerHTML = `<div class="grid two">
      ${card('Feature flags клиента', `<form id="flags-form">${Object.entries(s.feature_flags || {}).map(([k, v]) => `<label class="check"><input type="checkbox" name="${esc(k)}" ${v ? 'checked' : ''}> ${esc(k)}</label>`).join('')}<button class="btn primary">Сохранить флаги</button></form>`, { subtitle: 'Попадают в публичный /api/client/config' })}
      ${card('Пороги алертов', `<form id="thresholds-form">${Object.entries(s.alert_thresholds || {}).map(([k, v]) => `<div class="field"><label>${esc(k)}</label><input name="${esc(k)}" type="number" step="any" min="0" value="${v}"></div>`).join('')}<button class="btn primary">Сохранить пороги</button></form>`)}
      </div>
      ${card('Релиз и кампании', `<form id="release-form"><div class="field-row"><div class="field"><label>Активная стабильная сборка</label><input name="active_build" value="${esc(s.active_build || '')}" placeholder="v2.4.1"></div><div class="field"><label>Приостановленные кампании (через запятую)</label><input name="paused_campaigns" value="${esc((s.paused_campaigns || []).join(', '))}"></div></div><button class="btn primary">Сохранить</button></form>`)}
      <div style="height:16px"></div>
      ${card('Резидентность данных', table([{ label: 'Регион', key: 'region' }, { label: 'Storage zone', key: 'zone' }], Object.entries(d.config.dataResidency || {}).map(([region, zone]) => ({ region, zone }))), { subtitle: 'Поле region есть во всех таблицах с ПДн. Сейчас единая БД.' })}`;
    document.getElementById('flags-form').onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target); const flags = {}; for (const k of Object.keys(s.feature_flags || {})) flags[k] = fd.has(k); await save({ feature_flags: flags }); };
    document.getElementById('thresholds-form').onsubmit = async e => { e.preventDefault(); const f = formData(e.target); for (const k of Object.keys(f)) f[k] = Number(f[k]); await save({ alert_thresholds: f }); };
    document.getElementById('release-form').onsubmit = async e => { e.preventDefault(); const f = formData(e.target); await save({ active_build: f.active_build, paused_campaigns: f.paused_campaigns.split(',').map(x => x.trim()).filter(Boolean) }); };
  } else if (tab === 'rules') {
    const rules = s.match_rules || {};
    root.innerHTML = `<div class="notice warn">Изменения применяются к конфигу, который читает игровой бэкенд. Это НЕ меняет исходники текущего демо-клиента. Каждое изменение попадает в аудит.</div>${card('Параметры MATCH_RULES', `<form id="rules-form"><div class="field-row three">${Object.entries(rules).map(([k, v]) => `<div class="field"><label class="mono">${esc(k)}</label>${k === 'zoneShape' ? `<select name="${k}"><option ${v === 'oval' ? 'selected' : ''}>oval</option><option ${v === 'circle' ? 'selected' : ''}>circle</option></select>` : `<input name="${esc(k)}" type="number" step="any" value="${v}">`}</div>`).join('')}</div><button class="btn primary">Сохранить правила</button></form>`, { subtitle: 'Белый список ключей и диапазонов проверяется на сервере' })}`;
    document.getElementById('rules-form').onsubmit = async e => { e.preventDefault(); const f = formData(e.target); for (const [k, v] of Object.entries(f)) if (k !== 'zoneShape') f[k] = Number(v); await save({ match_rules: f }); };
  } else if (tab === 'ai') {
    root.innerHTML = `${card('Провайдеры по зонам', table([
      { label: 'Зона', key: 'zone' }, { label: 'Модель', key: 'model' }, { label: 'Провайдер', key: 'provider' },
      { label: 'Ключ', html: true, value: z => badge(z.configured ? 'ok' : 'muted', z.configured ? 'настроен в env' : 'не задан — local') },
      { label: 'Дневной лимит', value: z => fmt(z.dailyTokens), num: true },
    ], d.config.aiZones), { subtitle: 'Секреты не отдаются в браузер. Меняются только в .env на сервере.' })}
    <div style="height:16px"></div><div class="grid two">
      ${card('Telegram-бот', jsonBlock({ enabled: d.bot?.enabled, updates: d.bot?.updates, lastUpdate: d.bot?.lastUpdate, lastError: d.bot?.lastError }), { subtitle: 'Только чтение, пуши и Ack алертов' })}
      ${card('Фоновые задания', jsonBlock(d.jobs || {}), { subtitle: 'Последние запуски планировщика' })}
    </div>`;
  } else {
    const audit = await api.get('/api/audit?limit=150');
    root.innerHTML = `<div class="grid two">
      ${card('Смена пароля', `<form id="password-form"><div class="field"><label>Текущий пароль</label><input name="old_password" type="password" required></div><div class="field"><label>Новый пароль (минимум 10 символов)</label><input name="new_password" type="password" minlength="10" required></div><button class="btn primary">Сменить пароль</button><p class="help" style="margin-top:9px">Все сессии будут завершены.</p></form>`)}
      ${card('Экспорт и retention', `<p class="small muted">Сырые логи ввода — 90 дней, телеметрия и AI-логи — 180 дней, чат директора — 365 дней. Очистка выполняется планировщиком.</p><div class="form-actions" style="justify-content:flex-start"><button class="btn" id="export-audit">Экспорт аудита CSV</button><button class="btn" id="export-ai">AI-запросы CSV</button></div>`)}
      </div><div style="height:16px"></div>
      ${card('Аудит действий', table([
        { label: 'Время', value: a => date(a.ts) }, { label: 'Actor', html: true, value: a => `${esc(a.actor)}<div class="tiny muted">${esc(a.actor_role)}</div>` },
        { label: 'Действие', html: true, value: a => `<code>${esc(a.action)}</code>` }, { label: 'Target', key: 'target' },
        { label: 'Payload', html: true, value: a => `<details><summary>Показать</summary>${jsonBlock(a.payload)}</details>` }, { label: 'Результат', html: true, value: a => badge(a.result) },
      ], audit), { subtitle: 'Кто, когда, что предложил и что применил' })}`;
    document.getElementById('password-form').onsubmit = async e => {
      e.preventDefault(); try { await api.post('/api/auth/password', formData(e.target)); toast('Пароль изменён. Войдите заново.'); location.reload(); } catch (err) { toast(err.message, 'error'); }
    };
    document.getElementById('export-audit').onclick = () => download('/api/export?entity=audit_log&format=csv');
    document.getElementById('export-ai').onclick = () => download('/api/export?entity=ai_requests&format=csv');
  }
  ctx.root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { ctx.state.settingsTab = b.dataset.tab; ctx.reload(); });
  async function save(body) { try { await api.patch('/api/settings', body); toast('Настройки сохранены'); ctx.reload(); } catch (e) { toast(e.message, 'error'); } }
}

export async function integration(ctx) {
  const d = await api.get('/api/integration');
  const origin = location.origin;
  const curl = `TIMESTAMP=$(date +%s)\nBODY='{"events":[{"type":"session_start","ts":"2026-10-28T09:00:00.000Z","region":"RU","player_id":"player-123","session_id":"session-123","data":{"device_type":"touch","rules_version":"4"}}]}'\nSIGNATURE=$(node -e "const c=require('crypto');process.stdout.write(c.createHmac('sha256',process.env.INGEST_SECRET).update(process.env.TIMESTAMP+'.'+process.env.BODY).digest('hex'))")\ncurl -X POST '${origin}/api/ingest/events' \\\n  -H 'Content-Type: application/json' \\\n  -H 'x-tt-key: ${d.ingest.keyIds[0] || 'YOUR_KEY_ID'}' \\\n  -H "x-tt-timestamp: $TIMESTAMP" \\\n  -H "x-tt-signature: $SIGNATURE" \\\n  --data-raw "$BODY"`;
  ctx.set(`<div class="notice">Подключение выполняется через игровой бэкенд. Секрет подписи нельзя встраивать в Mini App: браузер и DevTools считаются недоверенной средой.</div>
    <div class="grid two">
      ${card('1. Ingestion телеметрии', `<div class="docs"><p><b>POST ${esc(origin)}/api/ingest/events</b></p><p>Алгоритм: ${esc(d.ingest.algorithm)} · максимум ${d.ingest.maxBatch} событий в батче.</p><p>Подпись: <code>hex(HMAC(secret, timestamp + "." + rawBody))</code></p><p>Key IDs (секреты на сервере не показываются): ${d.ingest.keyIds.map(esc).join(', ') || 'не настроены'}</p><h4>Заголовки</h4><ul><li>x-tt-key</li><li>x-tt-timestamp — unix seconds</li><li>x-tt-signature — hex HMAC</li><li>x-tt-nonce — защита от replay</li></ul></div>`)}
      ${card('2. Клиентские API', `<div class="docs"><h4>Публичные, без ПДн</h4>${d.client.public.map(x => `<p><code>GET ${esc(x)}</code></p>`).join('')}<h4>Подписываются игровым бэкендом</h4>${d.client.signed.map(x => `<p><code>${esc(x)}</code></p>`).join('')}<p>Mini App обращается к своему бэкенду, а бэкенд подписывает запрос к CRM. Прямого доступа игрока к админским API нет.</p></div>`)}
    </div>
    ${card('3. Пример подписанного запроса', `<pre class="code-block">${esc(curl)}</pre><p class="small muted" style="margin-top:10px">Готовый пример: <code>node tools/ingest-example.js</code>. Полная инструкция — INTEGRATION.ru.md.</p>`)}
    <div style="height:16px"></div>
    <div class="grid two">
      ${card('4. Схема событий', table([{ label: 'Тип', key: 'type' }, { label: 'Поля data', html: true, value: x => `<code>${esc(x.fields.join(', '))}</code>` }], Object.entries(d.schema.fields).map(([type, fields]) => ({ type, fields }))), { subtitle: 'Коды отказов совпадают с MATCH_RULES v4' })}
      ${card('5. Состояние данных', table([{ label: 'Таблица', key: 'table' }, { label: 'Строк', key: 'n', num: true }], Object.entries(d.tables).map(([table, n]) => ({ table, n }))), { subtitle: 'Текущая БД CRM', actions: '<button class="btn sm" id="test-client">Проверить client config</button>' })}
    </div>
    <div id="client-test" style="margin-top:16px"></div>`);
  document.getElementById('test-client').onclick = async () => {
    const el = document.getElementById('client-test'); el.innerHTML = '<div class="empty">Проверка…</div>';
    try { const r = await api.get('/api/client/config'); el.innerHTML = card('Ответ /api/client/config', jsonBlock(r)); }
    catch (e) { el.innerHTML = `<div class="notice danger">${esc(e.message)}</div>`; }
  };
}
