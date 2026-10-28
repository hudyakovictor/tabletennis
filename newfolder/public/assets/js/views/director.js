import { api } from '../core/api.js';
import { esc, pct, timeAgo, dateTime, num, truncate, statusLabel } from '../core/format.js';
import {
  qs, qsa, statusBadge, zoneBadge, card, kpi, openDrawer, toast, toastError, setBusy,
  skeleton, emptyState, run,
} from '../core/ui.js';
import { icon } from '../core/icons.js';

export async function render(container, ctx) {
  const range = ctx.query.range || 'last_72h';
  container.innerHTML = skeleton('page');
  const data = await api.get(`/api/admin/director/context?time_range=${encodeURIComponent(range)}`);
  if (ctx.isStale()) return;

  const state = data.persistentState || {};
  const messages = data.activeMessages || [];
  const summaries = data.freshZoneSummaries || {};

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Слой директора</h2>
        <p>Директор не управляет зонами и не видит сырые логи: только свежие сводки, постоянный блок состояния и окно переписки ${data.slidingWindowHours || 72} ч.</p>
      </div>
      <div class="page-actions">
        <div class="segmented" id="range-switch">
          ${[['last_24h', '24ч'], ['last_48h', '48ч'], ['last_72h', '72ч']]
            .map(([v, l]) => `<button type="button" data-range="${v}" class="${range === v ? 'active' : ''}">${l}</button>`)
            .join('')}
        </div>
        <button type="button" class="btn btn-sm btn-outline" id="archive-btn">${icon('database')} Архив</button>
      </div>
    </div>

    <div class="grid grid-12">
      <section class="card col-8">
        <div class="card-head">
          <div><h3>Переписка с владельцем</h3>
            <div class="dim">Окно ${data.slidingWindowHours || 72} ч · старшие сообщения перенесены в отдельную архивную БД (${num(data.archivedMessagesCount || 0)})</div>
          </div>
          ${statusBadge(overallStatus(summaries), 'сводки зон')}
        </div>
        <div class="chat">
          <div class="chat-scroll" id="chat-scroll">
            ${messages.length ? messages.map(msgHtml).join('') : chatEmpty()}
          </div>
          <div class="suggestions" id="suggestions">${suggestions(messages)}</div>
          <form class="chat-compose" id="ask-form">
            <textarea name="question" id="ask-input" placeholder="Спросите директора: «какие зоны требуют внимания?»" rows="1"></textarea>
            <button type="submit" class="btn btn-primary" id="ask-submit">${icon('chevronRight')} Отправить</button>
          </form>
        </div>
      </section>

      <div class="col-4 stack">
        <section class="card">
          <div class="card-head"><h3>Постоянный блок состояния</h3><span class="badge badge-neutral">обновляется отдельно</span></div>
          <div class="card-body stack">
            <div class="row-between"><span class="muted">Приоритеты</span><span class="dim">${state.priorities?.length || 0}</span></div>
            <ul class="tag-list">
              ${(state.priorities || []).map((p) => `<li class="chip">${esc(p)}</li>`).join('') || '<li class="dim" style="font-size:12px">не заданы</li>'}
            </ul>
            <button class="btn btn-sm btn-outline" type="button" id="edit-priorities">Изменить приоритеты</button>
            <div class="divider"></div>
            <div class="row-between"><span class="muted">Открытые инциденты</span><strong>${num((state.openIncidents || []).length)}</strong></div>
            <div class="row-between"><span class="muted">Активные A/B</span><strong>${num((state.activeAbExperiments || []).length)}</strong></div>
            <div class="row-between"><span class="muted">Решения в очереди</span><strong>${num(state.pendingProposalsCount || 0)}</strong></div>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h3>Свежие сводки зон</h3></div>
          <div class="card-body flush">
            ${Object.entries(summaries).map(([zone, s]) => `
              <div class="list-row">
                ${zoneBadge(zone)}
                <div class="list-main">
                  <span class="list-title">${esc(truncate(s.findings?.[0]?.issue || 'Без находок', 46))}</span>
                  <span class="list-sub">${esc(timeAgo(s.timestamp))}</span>
                </div>
                ${statusBadge(s.status)}
              </div>`).join('')}
          </div>
        </section>
      </div>
    </div>
  `;

  qsa('[data-range]', container).forEach((btn) => {
    btn.addEventListener('click', () => {
      ctx.setQuery('range', btn.dataset.range);
      ctx.refresh();
    });
  });

  qs('#archive-btn', container).addEventListener('click', async () => {
    try {
      const res = await api.get('/api/admin/director/archive');
      openDrawer({
        title: 'Архивная БД переписки',
        eyebrow: 'director-archive.sqlite · 365 дней',
        body: (res.archivedMessages || []).length
          ? `<div class="timeline">${res.archivedMessages.map((m) => `<div class="timeline-item">
                <span class="timeline-dot"></span>
                <div><div class="timeline-title">${esc(m.role === 'owner' ? 'Владелец' : 'Директор')}</div>
                <div class="timeline-meta">${esc(dateTime(m.created_at))} · архивировано ${esc(timeAgo(m.archived_at || m.created_at))}</div>
                <p class="mt-4">${esc(truncate(m.content, 260))}</p></div>
              </div>`).join('')}</div>`
          : emptyState({ title: 'Архив пуст', text: `Сообщения старше ${data.slidingWindowHours || 72} ч будут перенесены сюда автоматически.` }),
        actions: [{ label: 'Закрыть', variant: 'btn-ghost' }],
      });
    } catch (err) { toastError(err); }
  });

  qs('#edit-priorities', container).addEventListener('click', async () => {
    const current = (state.priorities || []).join('\n');
    openDrawer({
      title: 'Приоритеты владельца',
      eyebrow: 'постоянный блок состояния',
      body: `<label class="field"><span class="field-label">По одному приоритету на строку</span>
          <textarea id="priorities-input" style="min-height:160px">${esc(current)}</textarea>
          <span class="field-hint">Директор видит эти приоритеты в каждом ответе и учитывает их в формулировках.</span></label>`,
      actions: [
        { label: 'Отмена', variant: 'btn-ghost' },
        {
          label: 'Сохранить',
          variant: 'btn-primary',
          close: false,
          onClick: async ({ close }) => {
            const priorities = qs('#priorities-input').value.split('\n').map((s) => s.trim()).filter(Boolean);
            try {
              await api.post('/api/admin/director/priorities', { priorities });
              toast('Приоритеты обновлены', { type: 'success' });
              close();
              ctx.refresh();
            } catch (err) { toastError(err); }
          },
        },
      ],
    });
  });

  const form = qs('#ask-form', container);
  const input = qs('#ask-input', container);
  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(120, input.scrollHeight)}px`;
  });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    const submit = qs('#ask-submit', container);
    appendPending(container, question);
    input.value = '';
    setBusy(submit, true);
    try {
      const res = await api.post('/api/admin/director/ask', { question, time_range: range }, { idempotencyKey: `ask-${Date.now()}` });
      if (res.quarantined) {
        toast('Ответ отправлен в карантин', { text: res.message || 'Невалидный JSON Schema ответ не попал в чат.', type: 'warn' });
      }
      ctx.refresh();
    } catch (err) {
      toastError(err);
      setBusy(submit, false);
      ctx.refresh();
    }
  });

  run(container, '[data-suggest]', async (node) => {
    input.value = node.dataset.suggest;
    form.requestSubmit();
  });

  const scroll = qs('#chat-scroll', container);
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
  bindLive(container, ctx);
}

function overallStatus(summaries) {
  const list = Object.values(summaries || {}).map((s) => s.status);
  if (list.includes('critical')) return 'critical';
  if (list.includes('warning')) return 'warning';
  return 'ok';
}

function chatEmpty() {
  return emptyState({
    iconName: 'messages',
    title: 'Переписка пуста',
    text: 'Задайте вопрос — директор ответит структурно: статус, вывод, находки с уверенностью и следующие вопросы.',
  });
}

function suggestions(messages) {
  const last = [...messages].reverse().find((m) => m.role === 'director');
  const next = last?.structured?.next_questions || [];
  const presets = [
    'какие зоны требуют внимания?',
    'что произошло за последние 24 часа?',
    'покажи теплокарту по Android',
  ];
  const items = (next.length ? next : presets).slice(0, 3);
  return items.map((q) => `<button type="button" class="chip" data-suggest="${esc(q)}" style="cursor:pointer">${esc(truncate(q, 64))}</button>`).join('');
}

function msgHtml(m) {
  const isOwner = m.role === 'owner';
  const s = m.structured || {};
  return `<div class="msg ${isOwner ? 'msg-owner' : 'msg-director'}">
      <div class="msg-bubble">
        ${esc(m.content)}
        ${!isOwner && s.findings?.length ? `<div class="msg-findings">${s.findings.map((f) => `
          <div class="finding"><div class="finding-head">${zoneBadge(f.zone)}<span class="finding-issue">${esc(f.issue)}</span>
            <span class="badge badge-neutral">${pct((f.confidence || 0) * 100)}</span></div>
            ${f.recommended_action ? `<div class="dim mt-4">${esc(f.recommended_action)}</div>` : ''}
          </div>`).join('')}</div>` : ''}
        ${!isOwner && s.status ? `<div class="mt-8">${statusBadge(s.status)}</div>` : ''}
      </div>
      <div class="msg-meta">${isOwner ? 'Вы' : 'Директор'} · ${esc(timeAgo(m.createdAt))}</div>
    </div>`;
}

function appendPending(container, question) {
  const scroll = qs('#chat-scroll', container);
  if (!scroll) return;
  scroll.insertAdjacentHTML('beforeend', `<div class="msg msg-owner">
      <div class="msg-bubble">${esc(question)}</div>
      <div class="msg-meta">Вы · только что</div>
    </div>
    <div class="msg msg-director" id="pending-msg">
      <div class="msg-bubble"><span class="inline-spinner"></span> Директор анализирует сводки зон…</div>
    </div>`);
  scroll.scrollTop = scroll.scrollHeight;
}

function bindLive(container, ctx) {
  if (ctx._liveBound) return;
  ctx._liveBound = true;
  const handler = (e) => {
    if (!document.contains(container)) {
      window.removeEventListener('crm:event', handler);
      return;
    }
    if (['zone', 'incident', 'proposal'].includes(e.detail?.type)) {
      clearTimeout(ctx._t);
      ctx._t = setTimeout(() => ctx.refresh(), 1800);
    }
  };
  window.addEventListener('crm:event', handler);
}
