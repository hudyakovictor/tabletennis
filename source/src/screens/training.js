/* =====================================================================
   TRAINING / ACADEMY — глобальная переработка структуры.
   Фокус: чёткая иерархия контента, убрано всё лишнее, нет отладочного мусора.
   CSS — в последнюю очередь.
   ===================================================================== */

Router.def('train', {
  full: true, mood: 'battle', game: true,
  render() {
    return `${UI.topHud({ back: true, title: t('academy.title') })}
    <div class="academy">
      <!-- Главное меню обучения: выбор курса / удара / цели -->
      <div class="academy-menu">
        <div class="academy-scroll scroll">
          <p class="academy-intro body-sm mb-5">${t('academy.intro')}</p>

          <!-- Три основных режима обучения -->
          <div class="academy-modes flex gap-3" role="group" aria-label="${t('hub.chooseMode')}">
            <button class="btn btn-ghost flex items-center gap-4 p-4" data-mode="course" aria-pressed="true">
              <span class="flex-none" style="width:48px;height:48px;display:grid;place-items:center">${Art.icon('cup', { c: '#fff', sw: 2.5 })}</span>
              <div class="flex-1 min-w-0">
                <div class="body">${t('academy.course')}</div>
                <div class="caption">${t('academy.courseSub')}</div>
              </div>
            </button>
            <button class="btn btn-ghost flex items-center gap-4 p-4" data-mode="stroke" aria-pressed="false">
              <span class="flex-none" style="width:48px;height:48px;display:grid;place-items:center">${Art.icon('paddle', { c: '#fff', sw: 2.5 })}</span>
              <div class="flex-1 min-w-0">
                <div class="body">${t('academy.stroke')}</div>
                <div class="caption">${t('academy.strokeSub')}</div>
              </div>
            </button>
            <button class="btn btn-ghost flex items-center gap-4 p-4" data-mode="accuracy" aria-pressed="false">
              <span class="flex-none" style="width:48px;height:48px;display:grid;place-items:center">${Art.icon('target', { c: '#fff', sw: 2.5 })}</span>
              <div class="flex-1 min-w-0">
                <div class="body">${t('academy.accuracy')}</div>
                <div class="caption">${t('academy.accuracySub')}</div>
              </div>
            </button>
          </div>

          <!-- Контент выбранного режима (заполняется в updateMenu) -->
          <div class="academy-content mt-6"></div>
        </div>
      </div>

      <!-- Живая сессия обучения (над игровой сценой) -->
      <div class="academy-live hidden">
        <section class="academy-objective">
          <div class="academy-step flex items-center gap-3 mb-2">
            <span class="academy-step-num caption"></span>
            <b class="academy-step-title body-lg"></b>
          </div>
          <span class="academy-stage caption mb-3"></span>
          <p class="academy-goal body mb-4"></p>
          <div class="academy-progress mt-3">
            <div class="progress-bar"><i style="--p:0"></i></div>
            <span class="academy-progress-text caption"></span>
          </div>
          <p class="academy-feedback body-sm mt-4" role="status" aria-live="polite"></p>
          <p class="academy-result body-sm mt-2"></p>
        </section>

        <!-- Инструменты сессии -->
        <div class="academy-session-tools mt-4 flex gap-3">
          <button class="btn btn-icon btn-ghost" data-act="pause" aria-label="${t('match.pause')}">${Art.icon('pause', { c: '#fff', sw: 2.5 })}</button>
          <button class="btn btn-icon btn-ghost" data-act="reference" aria-label="${t('train.reference')}">${Art.icon('target', { c: '#fff', sw: 2.5 })}</button>
        </div>

        <!-- Действия сессии (повтор, перезапуск, выход) -->
        <div class="academy-session-actions mt-4 flex gap-3">
          <button class="btn btn-ghost btn-block" data-act="retry" hidden>${Art.icon('play', { c: '#fff', sw: 2.5 })}<span>${t('train.retry')}</span></button>
          <button class="btn btn-ghost btn-block" data-act="restart">${Art.icon('refresh', { c: '#fff', sw: 2.5 })}<span>${t('train.restartLesson')}</span></button>
          <button class="btn btn-ghost btn-block" data-act="academy">${Art.icon('home', { c: '#fff', sw: 2.5 })}<span>${t('academy.title')}</span></button>
        </div>
      </div>

      <!-- Модальный диалог (квизи, обратная связь, пауза, итог) -->
      <div class="academy-overlay hidden">
        <section class="academy-dialog" role="dialog" aria-modal="true" aria-labelledby="academy-dialog-title" tabindex="-1"></section>
      </div>
    </div>`;
  },
  mount(el) {
    this.el = el; this.alive = true; this.active = null; this.last = {}; this.summary = null;
    this.overlay = null; this.referenceBack = null; this.sessionId = null;
    this.retired = new Set(); this.phaseKey = ''; this.answerPending = false;
    this.mode = 'course';
    this.selection = { course: S.training && S.training.lastLesson, stroke: 'DRIVE', accuracy: 'center' };
    this.catalog = GameHost.trainingCatalog || null;

    this.menu = el.querySelector('.academy-menu');
    this.live = el.querySelector('.academy-live');
    this.cover = el.querySelector('.academy-overlay');
    this.dialog = el.querySelector('.academy-dialog');

    try {
      this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
      this.inputMode = matchMedia('(pointer:coarse)').matches ? 'touch' : 'mouse';
    } catch (e) {
      this.motionQuery = null; this.inputMode = 'mouse';
    }

    this.click = (e) => this.onClick(e);
    this.keydown = (e) => this.onKeydown(e);
    this.pointerdown = (e) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'mouse') return;
      this.inputMode = e.pointerType;
      this.refreshInput();
      GameHost.send('inputMode', { pointerType: e.pointerType });
    };

    el.addEventListener('click', this.click);
    el.addEventListener('keydown', this.keydown);
    el.addEventListener('pointerdown', this.pointerdown, { passive: true });

    this.off = GameHost.on((m) => this.onMsg(m));

    TGX.fullscreen(true); TGX.guard(false);
    GameHost.ensure(); GameHost.show(false); GameHost.send('quiet', { on: true });
    this.updateMenu();
  },

  esc(value) {
    return String(value == null ? '' : value).replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  },

  metricsHTML(stats = {}) {
    return [
      ['attempts', t('train.attempts')],
      ['hits', t('train.hits')],
      ['success', t('train.success')],
      ['streak', t('train.streak')],
      ['bestStreak', t('train.bestStreak')],
      ['rate', t('train.successRate')]
    ].map(([key, label]) => `
      <div class="academy-stat-row flex items-center gap-3 mb-2">
        <span class="caption">${label}</span>
        <span class="flex-1"></span>
        <span class="num" data-stat="${key}">${key === 'rate'
          ? Math.round((stats.success || 0) / Math.max(1, stats.attempts || 0) * 100) + '%'
          : fmt(Math.max(0, Number(stats[key]) || 0))
        }</span>
      </div>
    `).join('');
  },

  selected() {
    if (!this.catalog) return null;
    const items = this.mode === 'course' ? this.catalog.lessons
      : this.mode === 'stroke' ? this.catalog.strokes : this.catalog.targets;
    return items.find((x) => x.id === this.selection[this.mode]) || items[0] || null;
  },

  updateMenu() {
    if (this.active) return;
    const sc = this.el.querySelector('.academy-scroll');
    const top = sc.scrollTop;

    this.el.querySelectorAll('[data-mode]').forEach((b) => {
      const on = b.dataset.mode === this.mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });

    const host = this.el.querySelector('.academy-content');
    const C = this.catalog;
    if (!C) {
      host.innerHTML = `<p class="academy-loading body-sm mt-3" role="status">${t('academy.loading')}</p>`;
      return;
    }

    const selected = this.selected();
    if (!selected) return;
    this.selection[this.mode] = selected.id;

    const progress = S.training && S.training.lessons || {};
    const mastered = C.lessons.filter((l) => progress[l.id] && progress[l.id].mastered).length;

    let body;
    if (this.mode === 'course') {
      const status = progress[selected.id] || {};
      body = `
        <div class="academy-course-header pnl mb-5">
          <div><b class="body">${t('academy.progress', { done: mastered, total: C.lessons.length })}</b><small class="caption">${t('academy.saved')}</small></div>
          <div class="progress-bar mt-2"><i style="--p:${mastered / Math.max(1, C.lessons.length)}"></i></div>
        </div>
        <article class="pnl academy-selection mb-5">
          <span class="caption">${status.mastered ? t('academy.mastered') : S.training && S.training.lastLesson === selected.id ? t('academy.resume') : t('academy.course')}</span>
          <h2 class="body-lg mb-2">${this.esc(selected.title)}</h2>
          <p class="body-sm mb-4">${this.esc(selected.goal)}</p>
          <div class="academy-actions flex gap-3">
            <button class="btn btn-success btn-block" data-act="open">${Art.icon('play', { c: '#0A0E1E', sw: 2.5 })}<span>${t('academy.openLesson')}</span></button>
            <button class="btn btn-ghost btn-block sm" data-act="guide">${t('academy.guide')}</button>
          </div>
        </article>
        <h2 class="h3 mb-3">${t('academy.chapters')}</h2>
        <p class="caption mb-3">${t('academy.selectLesson')}</p>
        <div class="academy-chapters">
          ${C.modules.map((module) => {
            const lessons = C.lessons.filter((l) => l.module === module.id);
            const count = lessons.filter((l) => progress[l.id] && progress[l.id].mastered).length;
            return `
              <section class="pnl academy-chapter mb-4">
                <header class="flex items-center gap-3 mb-2">
                  <h3 class="body">${this.esc(module.title)}</h3>
                  <span class="caption num">${count}/${lessons.length}</span>
                </header>
                <p class="body-sm mb-3">${this.esc(module.description)}</p>
                <div class="academy-lessons flex flex-col gap-2">
                  ${lessons.map((lesson) => {
                    const saved = progress[lesson.id] || {};
                    const state = saved.mastered ? 'mastered' : saved.practiced ? 'practiced' : 'new';
                    return `
                      <button class="academy-lesson ${state} ${lesson.id === selected.id ? 'on' : ''}" data-choice="${this.esc(lesson.id)}" aria-pressed="${lesson.id === selected.id}">
                        <span class="academy-lesson-num caption">${C.lessons.indexOf(lesson) + 1}</span>
                        <div class="flex-1 min-w-0">
                          <b class="body">${this.esc(lesson.title)}</b>
                          <small class="caption">${saved.mastered ? t('academy.mastered') : saved.practiced ? t('academy.practiced') : t('academy.notStarted')}</small>
                        </div>
                        <span class="flex-none">${Art.icon(saved.mastered ? 'check' : 'play', { c: '#fff', sw: 2.5 })}</span>
                      </button>
                    `;
                  }).join('')}
                </div>
              </section>
            `;
          }).join('')}
        </div>
      `;
    } else {
      const stroke = this.mode === 'stroke';
      const items = stroke ? C.strokes : C.targets;
      body = `
        <p class="body-sm mb-4">${stroke ? t('academy.strokeIntro') : t('academy.accuracyIntro')}</p>
        ${stroke && globalThis.StrokeIcons
          ? `<section class="pnl academy-spin-legend mb-5"><p class="caption mb-2">${t('hud.motionLegend')}</p><div class="flex gap-4">
              ${[['DRIVE', 'hud.spinTop'], ['PUSH', 'hud.spinBack'], ['SIDE', 'hud.spinSide'], ['SERVE_NO_SPIN', 'hud.noSpin']].map(([id, label]) => `
                <span class="flex items-center gap-2">${StrokeIcons.create(id).outerHTML}<span class="body-sm">${t(label)}</span></span>
              `).join('')}
            </div></section>`
          : ''
        }
        <div class="academy-picks grid2 gap-3" role="group" aria-label="${stroke ? t('academy.selectStroke') : t('academy.selectTarget')}">
          ${items.map((item) => `
            <button class="academy-pick ${item.id === selected.id ? 'on' : ''}" data-choice="${this.esc(item.id)}" aria-pressed="${item.id === selected.id}">
              ${stroke ? `<small class="caption">${this.esc(item.id)}</small>` : Art.icon('target', { c: '#fff', sw: 2.5 })}
              <b class="body">${this.esc(item.title)}</b>
            </button>
          `).join('')}
        </div>
        <article class="pnl academy-selection mt-5">
          <span class="caption">${stroke ? t('academy.stroke') : t('academy.target')}</span>
          <h2 class="body-lg mb-2">${this.esc(selected.title)}</h2>
          <div class="academy-actions flex gap-3">
            <button class="btn btn-success btn-block" data-act="open">${Art.icon('play', { c: '#0A0E1E', sw: 2.5 })}<span>${t('academy.openPractice')}</span></button>
          </div>
          ${stroke ? this.guideHTML(selected) : `<p class="body-sm mt-3">${t('academy.accuracyIntro')}</p>`}
        </article>
      `;
    }
    host.innerHTML = body;
    sc.scrollTop = top;
  },

  // ----- Справочник удара (в модальном диалоге) -----
  guideHTML(lesson = {}, state = {}) {
    const feedback = state.feedback || state.latestFeedback;
    const example = feedback && this.catalog && this.catalog.strokes.find((s) => s.id === feedback.expected?.id);
    if (example && !(lesson.gesture && lesson.gesture.kind === 'tap')) {
      lesson = { ...lesson, ...example };
    }
    const controls = lesson.controls || {};
    const input = state.inputMode || this.inputMode;
    const fields = [
      [t('train.feature'), lesson.feature],
      [t('train.advantage'), lesson.advantage],
      [t('train.when'), lesson.when],
      [t('train.risk'), lesson.risk],
      [t('train.counter'), lesson.counter]
    ];
    const accuracy = state.mode === 'accuracy' || (feedback && feedback.code === 'outside');

    return `
      <div class="academy-guide mt-4">
        ${feedback ? `<p class="academy-correction body-sm mb-3">${this.esc(feedback.correction)}</p>` : ''}
        ${accuracy ? this.landingHTML(state.target, feedback && feedback.landing) : this.gestureHTML(feedback ? feedback.expected.gesture : lesson.gesture, input, feedback && feedback.actual.gesture)}
        ${accuracy ? '' : `
          <div class="academy-inputs mt-4">
            ${[['touch', t('train.touchControls')], ['mouse', t('train.mouseControls')]].map(([mode, title]) => `
              <div class="academy-input ${mode === input ? 'on' : ''}" data-input="${mode}">
                <b class="caption">${title}</b>
                <p class="body-sm">${this.esc(lesson.brief && lesson.brief[mode] || '')}</p>
              </div>
            `).join('')}
          </div>
        `}
        <details class="academy-details mt-4">
          <summary class="caption">${t('train.details')}</summary>
          <div class="academy-guide-details mt-2">
            ${lesson.context ? `<p class="body-sm mb-3">${this.esc(lesson.context)}</p>` : ''}
            <section class="mb-3">
              <h3 class="caption mb-1">${t('train.controls')}</h3>
              ${[['touch', t('train.touchControls')], ['mouse', t('train.mouseControls')]].map(([mode, title]) => `
                <p class="body-sm mb-1"><b class="caption">${title}:</b> ${this.esc(controls[mode] || '')}</p>
              `).join('')}
            </section>
            ${fields.filter(([, value]) => typeof value === 'string' && value).map(([label, value]) => `
              <section class="mb-3">
                <h3 class="caption mb-1">${label}</h3>
                <p class="body-sm">${this.esc(value)}</p>
              </section>
            `).join('')}
            ${this.diagramHTML(state.diagram, state)}
          </div>
        </details>
      </div>
    `;
  },

  refreshInput() {
    this.el.querySelectorAll('[data-input]').forEach((card) => {
      card.classList.toggle('on', card.dataset.input === this.inputMode);
    });
    this.el.querySelectorAll('.academy-gesture .academy-demo-ball').forEach((cursor) => {
      cursor.setAttribute('r', this.inputMode === 'touch' ? 8 : 5);
    });
  },

  // ----- SVG-диаграмма жеста -----
  gestureHTML(gesture, input, actual) {
    if (!gesture || !Array.isArray(gesture.points)) return '';
    const lengths = { short: t('train.gestureShort'), medium: t('train.gestureMediumLength'), long: t('train.gestureLong') };
    const paces = { soft: t('train.gestureSoft'), medium: t('train.gestureMedium'), fast: t('train.gestureFast') };
    const valid = (points) => (Array.isArray(points) ? points : []).filter((p) => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite));
    const expected = valid(gesture.points);
    const played = valid(actual && actual.points);
    if (!expected.length) return '';

    const viewport = actual && actual.viewport;
    const ratio = viewport && viewport[0] > 0 && viewport[1] > 0 ? viewport[1] / viewport[0] : 1;
    const points = [...expected, ...played, [0, 0]];
    const xMax = Math.max(.18, ...points.map((p) => Math.abs(p[0])));
    const yMax = Math.max(.16, ...points.map((p) => Math.abs(p[1]) * ratio));
    const scale = Math.min(128 / xMax, 68 / yMax, 400);
    const project = (p) => [150 + p[0] * scale, 92 + p[1] * ratio * scale];
    const path = (ps) => ps.map((p, i) => `${i ? 'L' : 'M'}${project(p).join(' ')}`).join(' ');
    const start = project(expected[0]);
    const end = project(expected.at(-1));
    const before = project(expected.at(-2) || expected[0]);
    const angle = Math.atan2(end[1] - before[1], end[0] - before[0]);
    const arrow = [end, [end[0] - Math.cos(angle - .5) * 10, end[1] - Math.sin(angle - .5) * 10], [end[0] - Math.cos(angle + .5) * 10, end[1] - Math.sin(angle + .5) * 10]];
    const label = gesture.kind === 'tap' ? t('train.gestureTap') : `${lengths[gesture.length]} / ${paces[gesture.pace]}`;

    return `
      <figure class="academy-gesture ${played.length ? 'comparison' : ''} mt-4">
        <svg viewBox="0 0 300 184" role="img" aria-label="${this.esc(t('train.motionGuide'))}" data-demo-view="gesture" data-demo-duration="${Number(gesture.duration) || 750}">
          <rect x="1" y="1" width="298" height="182" rx="14" fill="#080f21" stroke="#34466b"/>
          <text x="12" y="19" class="academy-motion-label caption">${t('train.screenMotion')}</text>
          <path d="${path(expected)}" class="academy-gesture-path" data-demo-leg="gesture" fill="none" stroke="#9cffd0" stroke-width="4" stroke-linecap="round"/>
          ${gesture.kind === 'tap'
            ? '<circle cx="150" cy="92" r="18" fill="none" stroke="#9cffd0" stroke-width="3"/>'
            : `<polygon points="${arrow.map((p) => p.join(',')).join(' ')}" fill="#9cffd0"/>`
          }
          ${played.length
            ? `<path d="${path(played)}" data-motion="actual" fill="none" stroke="#ffb3a6" stroke-width="3" stroke-dasharray="5 4"/><circle cx="${project(played[0])[0]}" cy="${project(played[0])[1]}" r="5" fill="#ffb3a6"/>`
            : ''
          }
          <circle cx="150" cy="92" r="6" fill="#fff" stroke="#080f21" stroke-width="2"/>
          <text x="160" y="96" class="academy-motion-label caption">${t('train.ball')}</text>
          ${gesture.kind === 'tap' ? '' : `
            <circle cx="${start[0]}" cy="${start[1]}" r="11" fill="#9cffd0"/>
            <text x="${start[0]}" y="${start[1] + 4}" text-anchor="middle" class="academy-motion-number caption">1</text>
            <text x="${end[0]}" y="${end[1] < 92 ? end[1] - 12 : end[1] + 20}" text-anchor="middle" class="academy-motion-label caption">2</text>
          `}
          ${played.length === 1 ? `
            <circle cx="${project(played[0])[0]}" cy="${project(played[0])[1]}" r="15" fill="none" stroke="#ffb3a6" stroke-width="3"/>
            <text x="${project(played[0])[0] > 230 ? project(played[0])[0] - 40 : project(played[0])[0] + 21}" y="${project(played[0])[1] + 4}" class="academy-motion-label caption" style="fill:#ffb3a6">${t('train.actualTap')}</text>
          ` : ''}
          <circle class="academy-demo-ball" cx="${start[0]}" cy="${start[1]}" r="${input === 'touch' ? 8 : 5}" fill="#ffd54a" stroke="#080f21" stroke-width="2"/>
        </svg>
        <figcaption class="caption mt-2"><b>${gesture.kind === 'tap' ? t('train.tapSteps') : t('train.motionSteps')}</b><span>${this.esc(label)}</span></figcaption>
        ${played.length ? `<div class="academy-motion-legend mt-2"><span class="expected">${t('train.expectedMotion')}</span><span class="actual">${t('train.actualMotion')}</span></div>` : ''}
      </figure>
    `;
  },

  // ----- SVG-диаграмма placement (цель удара) -----
  landingHTML(target, landing) {
    if (!target) return '';
    const x = (n) => 120 + n / .7625 * 49;
    const y = (n) => 105 + n / 1.37 * 88;
    return `
      <figure class="academy-placement mt-4">
        <svg viewBox="0 0 240 210" role="img" aria-label="${t('train.targetZone')}">
          <rect x="71" y="17" width="98" height="176" rx="3" fill="#102747" stroke="#8fb1d3"/>
          <path d="M67 105 H173 M120 17 V193" stroke="#c6dcf4"/>
          <rect x="${x(target.x0)}" y="${y(target.z0)}" width="${x(target.x1) - x(target.x0)}" height="${y(target.z1) - y(target.z0)}" fill="#9cffd0" fill-opacity=".25" stroke="#9cffd0"/>
          ${landing && Number.isFinite(landing.x) && Number.isFinite(landing.z)
            ? `<circle cx="${x(landing.x)}" cy="${y(landing.z)}" r="5" fill="#ffb3a6" stroke="#080f21" stroke-width="2"/><text x="${x(landing.x) + 9}" y="${y(landing.z) + 4}" class="academy-motion-label caption">${t('train.actualLanding')}</text>`
            : ''
          }
          <text x="120" y="12" text-anchor="middle" class="academy-motion-label caption">${t('train.opponent')}</text>
          <text x="120" y="207" text-anchor="middle" class="academy-motion-label caption">${t('train.you')}</text>
        </svg>
        <figcaption class="caption mt-2">${t('train.greenTarget')}</figcaption>
      </figure>
    `;
  },

  // ----- Обратная связь после удара -----
  feedbackHTML(feedback, comparison = true) {
    if (!feedback) return '';
    const neutral = ['let', 'feeder'].includes(feedback.code);
    return `
      <div class="academy-feedback mt-4">
        <p class="academy-correction body-sm mb-3">${this.esc(feedback.correction)}</p>
        ${comparison ? (feedback.code === 'outside' ? this.landingHTML(feedback.target, feedback.landing) : this.gestureHTML(feedback.expected.gesture, this.inputMode, feedback.actual.gesture)) : ''}
        ${neutral ? '' : `
          <div class="academy-checks mt-3">
            ${[[feedback.contact, t('train.contact')], [feedback.legal, t('train.legal')], [feedback.code === 'counted', t('train.objective')]].map(([ok, label]) => `
              <span class="academy-check ${ok ? 'ok' : 'miss'}">${Art.icon(ok ? 'check' : 'x', { c: '#fff', sw: 2.5 })}<span class="caption">${label}</span></span>
            `).join('')}
          </div>
        `}
        ${comparison && feedback.contact ? `<p class="academy-attempt-name body-sm mt-3">${t('train.playedStroke')}: <b class="body">${this.esc(feedback.actual.title)}</b></p>` : ''}
      </div>
    `;
  },

  // ----- Схема траектории мяча -----
  diagramHTML(diagram, state = {}) {
    if (!diagram) return '';
    const series = [['recommended', t('train.recommended'), '#9cffd0'], ['actual', t('train.actual'), '#ffb3a6']]
      .map(([key, label, color]) => ({
        key, label, color,
        points: (Array.isArray(diagram[key]) ? diagram[key] : [])
          .filter((p) => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every(Number.isFinite))
          .slice(0, 400)
      }));
    const points = series.flatMap((s) => s.points);
    const target = diagram.target;
    const hasTarget = target && ['x0', 'x1', 'z0', 'z1'].every((k) => Number.isFinite(target[k]));
    if (!points.length && !hasTarget) return '';

    const xMax = Math.max(1, ...points.map((p) => Math.abs(p[0])));
    const zMax = Math.max(1.65, ...points.map((p) => Math.abs(p[2])));
    const topScale = Math.min(268 / (xMax * 2), 224 / (zMax * 2));
    const yMin = Math.min(0, ...points.map((p) => p[1]));
    const yMax = Math.max(1.6, ...points.map((p) => p[1]));
    const sideScale = Math.min(268 / (zMax * 2), 174 / (yMax - yMin));
    const top = (p) => [160 + p[0] * topScale, 136 + p[2] * topScale];
    const side = (p) => [160 - p[2] * sideScale, 196 - (p[1] - yMin) * sideScale];
    const n = (x) => Math.round(x * 100) / 100;
    const lines = (project) => series.filter((s) => s.points.length > 1).map((s) => {
      const ps = s.points.map(project);
      const end = ps[ps.length - 1];
      const before = ps[ps.length - 2];
      const angle = Math.atan2(end[1] - before[1], end[0] - before[0]);
      const arrow = [end, [end[0] - Math.cos(angle - .5) * 8, end[1] - Math.sin(angle - .5) * 8], [end[0] - Math.cos(angle + .5) * 8, end[1] - Math.sin(angle + .5) * 8]];
      return `<path d="${ps.map((p, i) => `${i ? 'L' : 'M'}${n(p[0])} ${n(p[1])}`).join(' ')}" data-demo-leg="${s.key}" fill="none" stroke="${s.color}" stroke-width="2.5" ${s.key === 'recommended' ? '' : 'stroke-dasharray="5 4"'}/><polygon points="${arrow.map((p) => p.map(n).join(',')).join(' ')}" fill="${s.color}"/>`;
    }).join('');

    const tx = top([-.7625, .76, -1.37]);
    const tableSide = side([0, .76, 1.37]);
    const tableEnd = side([0, .76, -1.37]);
    const net = side([0, .9125, 0]);

    const topTarget = hasTarget ? (() => {
      const a = top([Math.min(target.x0, target.x1), .76, Math.min(target.z0, target.z1)]);
      return `<rect x="${n(a[0])}" y="${n(a[1])}" width="${n(Math.abs(target.x1 - target.x0) * topScale)}" height="${n(Math.abs(target.z1 - target.z0) * topScale)}" fill="#ffd54a" fill-opacity=".22" stroke="#ffd54a" stroke-dasharray="3 3"/>`;
    })() : '';
    const sideTarget = hasTarget ? `<rect x="${n(side([0, .76, Math.max(target.z0, target.z1)])[0])}" y="${n(tableSide[1] - 4)}" width="${n(Math.abs(target.z1 - target.z0) * sideScale)}" height="8" fill="#ffd54a" fill-opacity=".55"/>` : '';

    const feature = state.lesson && state.lesson.feature;
    const spin = diagram.spin;
    const spinText = spin ? [
      ['topRps', spin.topRps > 0 ? t('train.topspin') : spin.topRps < 0 ? t('train.backspin') : t('train.topBackSpin')],
      ['sideRps', t('train.sidespin')]
    ].filter(([key]) => Number.isFinite(spin[key])).map(([key, label]) => `${label}: ${Math.round(spin[key] * 10) / 10} ${t('train.spinUnit')}`).join(' / ') : '';

    return `
      <figure class="academy-diagram mt-4">
        <div class="academy-views flex gap-4">
          <div>
            <b class="caption block mb-1">${t('train.topView')}</b>
            <svg viewBox="0 0 320 272" role="img" aria-label="${t('train.topView')}" data-demo-view="top">
              <rect x="${n(tx[0])}" y="${n(tx[1])}" width="${n(1.525 * topScale)}" height="${n(2.74 * topScale)}" rx="3" fill="#102747" stroke="#8fb1d3"/>
              <path d="M160 ${n(tx[1])} V${n(tx[1] + 2.74 * topScale)} M${n(tx[0] - 4)} 136 H${n(tx[0] + 1.525 * topScale + 4)}" stroke="#c6dcf4" stroke-width="1.5"/>
              ${topTarget}${lines(top)}<circle class="academy-demo-ball" r="4.5" fill="#fff" stroke="#10182b"/>
              <text x="160" y="14" text-anchor="middle" class="caption">${t('train.opponent')}</text>
              <text x="160" y="263" text-anchor="middle" class="caption">${t('train.you')}</text>
            </svg>
          </div>
          <div>
            <b class="caption block mb-1">${t('train.sideView')}</b>
            <svg viewBox="0 0 320 222" role="img" aria-label="${t('train.sideView')}" data-demo-view="side">
              <path d="M${n(tableSide[0])} ${n(tableSide[1])} H${n(tableEnd[0])} M${n(side([0, .76, -1])[0])} ${n(tableSide[1])} V${n(side([0, 0, -1])[1])} M${n(side([0, .76, 1])[0])} ${n(tableSide[1])} V${n(side([0, 0, 1])[1])}" stroke="#8fb1d3" stroke-width="3"/>
              <path d="M160 ${n(tableSide[1])} V${n(net[1])}" stroke="#c6dcf4" stroke-width="3"/>
              ${sideTarget}${lines(side)}<circle class="academy-demo-ball" r="4.5" fill="#fff" stroke="#10182b"/>
              <text x="160" y="${n(net[1] - 7)}" text-anchor="middle" class="caption">${t('train.net')}</text>
              <text x="22" y="215" class="caption">${t('train.you')}</text>
              <text x="298" y="215" text-anchor="end" class="caption">${t('train.opponent')}</text>
            </svg>
          </div>
        </div>
        <div class="academy-legend mt-3 flex gap-4 flex-wrap">
          ${series.filter((s) => s.points.length).map((s) => `<span class="flex items-center gap-2"><i class="academy-line" style="--line:${s.color}"></i><span class="caption">${s.label}</span></span>`).join('')}
          ${hasTarget ? `<span class="flex items-center gap-2"><i class="academy-target"></i><span class="caption">${t('train.targetZone')}</span></span>` : ''}
        </div>
        ${spinText || feature ? `<p class="academy-spin body-sm mt-3"><b class="caption">${t('train.spinFlight')}</b> ${this.esc(spinText || feature)}</p>` : ''}
        <figcaption class="caption mt-2">${this.esc(diagram.caption || t('train.diagramHint'))}</figcaption>
      </figure>
    `;
  },

  // ----- Обработка кликов -----
  onClick(e) {
    const b = e.target.closest('button');
    if (!b || !this.el.contains(b) || b.disabled) return;
    if (Sheet.cur) return;
    e.stopPropagation();

    if (b.dataset.mode) {
      this.mode = b.dataset.mode;
      this.updateMenu();
      return;
    }
    if (b.dataset.choice) {
      this.selection[this.mode] = b.dataset.choice;
      if (this.mode === 'course') this.openSession();
      else this.updateMenu();
      return;
    }
    if (b.dataset.answer) {
      if (this.answerPending || this.last.phase !== 'question') return;
      this.answerPending = true;
      this.dialog.querySelectorAll('[data-answer]').forEach((button) => { button.disabled = true; });
      this.dialog.querySelector('.academy-answer-status').textContent = t('train.answerPending');
      GameHost.send('pause');
      GameHost.send('trainAction', { action: 'answer', answer: b.dataset.answer });
      return;
    }

    const act = b.dataset.act;
    if (act === 'open') this.openSession();
    if (act === 'guide' || act === 'reference') this.reference();
    if (act === 'reference-back') this.returnReference();
    if (act === 'demo') this.playDemo();
    if (act === 'demo-live') this.playDemo(true);
    if (act === 'start' || act === 'continue' || act === 'retry') this.action(act);
    if (act === 'pause') this.pause();
    if (act === 'resume') this.resume();
    if (act === 'restart') this.restart();
    if (act === 'academy') this.toMenu();
    if (act === 'skip') { GameHost.send('skipStep'); this.toMenu(); }
    if (act === 'exit') this.exit();
    if (act === 'battle') { this.cancel(); Router.go('mm'); }
    if (act === 'diag-mark') diagnosticMarkFrame();
    if (act === 'diagnostics' || act === 'screenshot' || act === 'dev') {
      if (this.active && !this.overlay) this.pause();
      GameHost.send('pause');
      if (act === 'dev') devZoneSheet(); else diagnosticsSheet({ focusScreenshot: act === 'screenshot' });
    }
  },

  openSession() {
    const item = this.selected();
    if (!item) return;
    const data = { mode: this.mode, progress: S.training };
    if (this.mode === 'course') data.lessonId = item.id;
    if (this.mode === 'stroke') data.stroke = item.id;
    if (this.mode === 'accuracy') data.target = item.id;
    this.active = data; this.last = {}; this.summary = null;
    this.sessionId = null; this.phaseKey = ''; this.awaitingIntro = true;
    this.closePanel();
    this.menu.hidden = true;
    this.live.hidden = false;
    TGX.guard(true);
    GameHost.show(true);
    GameHost.send('mute', { on: !S.sfx });
    GameHost.send('quiet', { on: false });
    this.showPanel('loading', false);
    GameHost.send('train', data);
  },

  action(action) {
    if (!this.active || this.summary) return;
    this.closePanel();
    GameHost.send('trainAction', { action });
    GameHost.send('resume');
  },

  restart() {
    if (!this.active) return;
    this.summary = null; this.phaseKey = ''; this.answerPending = false; this.awaitingIntro = true;
    this.closePanel();
    this.showPanel('loading');
    GameHost.send('trainAction', { action: 'restart' });
  },

  onMsg(m) {
    if (!this.alive) return;
    if (m.type === 'preview' && this.previewing) {
      if (m.active) return;
      const back = this.previewBack || 'reference';
      this.previewing = false; this.previewBack = null;
      this.menu.hidden = !!this.active;
      this.live.hidden = !this.active;
      this.showPanel(back, false);
      if (m.opened === false || m.error) {
        const status = this.dialog.querySelector('[data-demo-status]');
        if (status) status.textContent = t('train.previewUnavailable');
      }
      return;
    }
    const catalog = m.type === 'ready' ? m.trainingCatalog : m.type === 'trainingCatalog' ? m.catalog : null;
    if (catalog) { this.catalog = catalog; this.updateMenu(); }
    if (m.type === 'trainingProgress') this.updateMenu();
    if (!this.active) return;
    if (m.type === 'ready') {
      this.retired.clear();
      this.sessionId = null; this.awaitingIntro = true; this.phaseKey = ''; this.summary = null;
      this.showPanel('loading', false);
    }
    if (m.type === 'paused' && m.v && !m.host && !Sheet.cur && !this.overlay && !this.summary) this.pause();
    if (m.type === 'trainDone') {
      if (this.summary || this.awaitingIntro || m.mode !== this.active.mode || (m.sessionId && (this.retired.has(m.sessionId) || this.sessionId && m.sessionId !== this.sessionId))) return;
      this.summary = m;
      this.showPanel('summary');
      return;
    }
    if (m.type !== 'train' || this.summary || m.mode !== this.active.mode || this.retired.has(m.sessionId)) return;
    if (this.sessionId && m.sessionId !== this.sessionId && !(this.awaitingIntro && m.phase === 'intro')) return;
    if (this.awaitingIntro && m.phase !== 'intro') return;
    this.sessionId = m.sessionId;
    this.awaitingIntro = false;
    if (m.inputMode === 'mouse' || m.inputMode === 'touch') {
      this.inputMode = m.inputMode;
      this.refreshInput();
    }
    this.last = m;
    if (m.mode === 'course' && m.lesson) this.selection.course = m.lesson.id;
    this.updateLive(m);

    const panel = this.requiredPanel();
    const quiz = m.quiz || {};
    const key = [m.sessionId, m.id, m.stage, m.phase, quiz.prompt, quiz.explanation, m.phase === 'review' || m.phase === 'question' ? m.msg : ''].join('|');
    if (key !== this.phaseKey || this.answerPending && m.phase === 'question') {
      this.phaseKey = key;
      this.answerPending = false;
      if (panel && !this.previewing && this.overlay !== 'reference' && this.overlay !== 'pause') this.showPanel(panel);
    }
  },

  updateLive(m) {
    const q = (selector) => this.live.querySelector(selector);
    const stats = m.stats || {};
    q('.academy-step-num').textContent = m.mode === 'course' && Number.isFinite(m.step) ? `${m.step + 1}/${m.total}` : '';
    q('.academy-step-title').textContent = m.title || (m.lesson && m.lesson.title) || t('train.title');
    q('.academy-stage').textContent = m.stage === 'check' ? t('train.checkStage') : t('train.practiceStage');
    q('.academy-goal').textContent = m.goal || '';
    const need = Math.max(1, Number(m.need) || 1);
    const done = Math.max(0, Number(m.done) || 0);
    const attempts = Math.max(0, Number(m.attempts) || 0);
    q('.academy-progress').hidden = m.mode !== 'course';
    q('.academy-progress > i').style.setProperty('--p', Math.min(m.stage === 'check' ? attempts : done, need) / need);
    q('.academy-progress-text').textContent = m.mode !== 'course' ? t('train.practiceCount', { n: done })
      : m.stage === 'check' ? t('train.checkProgress', { done, attempts, total: need }) : t('train.sessionProgress', { done, need });

    this.live.querySelectorAll('[data-stat]').forEach((value) => {
      value.textContent = value.dataset.stat === 'rate'
        ? Math.round((stats.success || 0) / Math.max(1, stats.attempts || 0) * 100) + '%'
        : fmt(Math.max(0, Number(stats[value.dataset.stat]) || 0));
    });

    const feedback = q('.academy-feedback');
    feedback.className = 'academy-feedback body-sm' + (m.phase === 'ok' ? ' ok' : m.phase === 'fail' ? ' fail' : '');
    feedback.textContent = m.feedback && m.feedback.title || m.msg || m.text || '';
    q('.academy-result').textContent = m.feedback && m.phase === 'fail' ? m.feedback.correction : '';
    q('[data-act=retry]').hidden = m.phase !== 'fail';
  },

  requiredPanel() {
    return { intro: 'intro', question: 'question', review: 'review', done: 'finishing' }[this.last.phase] || null;
  },

  panelHTML(kind) {
    const m = this.last;
    const lesson = m.lesson || (this.active ? {} : this.selected()) || {};
    const quiz = m.quiz || lesson.quiz || {};
    let title = m.title || lesson.title || t('train.title');
    let body = '';
    let actions = '';

    const btn = (act, label, color = 'dark') => `<button class="btn btn-${color} btn-block" data-act="${act}">${label}</button>`;
    const guide = () => this.guideHTML(lesson, m);
    const demo = () => lesson.gesture && m.mode !== 'accuracy'
      ? `<div class="academy-demo-controls mt-3 flex gap-3"><button class="btn btn-ghost btn-sm" data-act="demo">${Art.icon('refresh', { c: '#fff', sw: 2.5 })}<span>${t('train.showMotion')}</span></button><button class="btn btn-ghost btn-sm" data-act="demo-live"><span>${t('train.realPace')}</span></button><p data-demo-status class="caption" role="status"></p></div>`
      : '';

    if (kind === 'loading' || kind === 'finishing') {
      title = kind === 'loading' ? t('train.loadingLesson') : t('train.finishPending');
      body = `<p class="body-sm" role="status">${title}</p>`;
      actions = btn('academy', t('academy.title'));
    }
    if (kind === 'intro' || kind === 'reference') {
      body = `${m.goal || lesson.goal ? `<p class="academy-goal body-sm mb-3">${this.esc(m.goal || lesson.goal)}</p>` : ''}${guide()}${demo()}${kind === 'intro' ? `<p class="caption mb-3">${m.stage === 'check' ? t('train.checkIntro') : t('train.practiceIntro')}</p>` : ''}`;
      actions = kind === 'intro'
        ? btn('start', m.stage === 'check' ? t('train.startCheck') : t('train.startPractice'), 'success') + btn('academy', t('academy.title')) + (this.active.mode === 'course' ? btn('skip', t('train.skipMenu')) : '')
        : btn('reference-back', this.active ? t('train.returnLesson') : t('common.back'), 'success');
    }
    if (kind === 'question') {
      title = t('train.quizTitle');
      body = `<p class="academy-goal body-sm mb-3">${this.esc(quiz.prompt)}</p><div class="academy-answers flex flex-col gap-2 mb-3">${(quiz.options || []).map((option) => `<button class="btn btn-ghost btn-block" data-answer="${this.esc(option.id)}" ${this.answerPending ? 'disabled' : ''}>${this.esc(option.text)}</button>`).join('')}</div><p class="academy-answer-status caption" role="status">${this.answerPending ? t('train.answerPending') : this.esc(m.msg || '')}</p>`;
      actions = btn('reference', t('train.reference')) + btn('academy', t('academy.title'));
    }
    if (kind === 'review') {
      title = t('train.reviewTitle');
      body = `<p class="academy-goal body-sm mb-3">${this.esc(m.msg || m.text || '')}</p>${!m.checkPassed && m.feedback ? this.feedbackHTML(m.feedback) : ''}<details class="academy-details mt-3"><summary class="caption mb-1">${t('train.statistics')}</summary><dl class="academy-summary-stats mt-2">${this.metricsHTML(m.stats)}</dl></details>`;
      const failed = m.stage === 'check' && m.checkPassed === false;
      actions = (failed ? btn('retry', t('train.retryCheck'), 'success') + btn('continue', t('train.repeatPractice')) : btn('continue', t('train.continue'), 'success')) + btn('reference', t('train.reference')) + btn('restart', t('train.restartLesson')) + btn('academy', t('academy.title'));
    }
    if (kind === 'feedback') {
      title = m.feedback && m.feedback.title || m.msg || t('train.tryAgain');
      body = this.feedbackHTML(m.feedback || m.latestFeedback) + demo();
      actions = btn('retry', t('train.retry'), 'success') + btn('reference', t('train.details')) + btn('academy', t('academy.title'));
    }
    if (kind === 'pause') {
      title = t('match.pause');
      body = `<p class="body-sm mb-3">${t('train.pauseHint')}</p>${m.goal ? `<p class="academy-goal body-sm mb-3">${this.esc(m.goal)}</p>` : ''}`;
      actions = btn('resume', t('common.resume'), 'success') + btn('reference', t('train.reference')) + btn('restart', t('train.restartLesson'));
      if (this.active.mode === 'course') actions += `<p class="caption mb-2">${t('train.skipNote')}</p>` + btn('skip', t('train.skipMenu'));
      actions += btn('academy', t('academy.title'));
    }
    if (kind === 'summary') {
      const s = this.summary;
      const course = s.mode === 'course';
      title = course ? (s.courseComplete ? t('train.courseComplete') : t('train.coursePartial')) : t('train.practiceComplete');
      body = `<p class="academy-goal body-sm mb-3">${course ? t('train.courseSummary', { mastered: Math.max(0, Number(s.mastered) || 0), total: Math.max(0, Number(s.total) || 0) }) : t('train.practiceSummary')}</p>${course && !s.courseComplete ? `<p class="body-sm mb-3">${t('train.partialSummary')}</p>` : ''}<dl class="academy-summary-stats mt-3">${this.metricsHTML(m.stats)}</dl>${Number.isFinite(s.coverage) ? `<p class="academy-coverage mt-3"><b class="caption">${t('train.coverage')}</b><span class="num">${Math.round(clamp(s.coverage, 0, 100))}%</span></p>` : ''}${s.rewarded ? `<p class="academy-reward mt-3">${Art.icon('coin')}${t('train.rewardGranted')}</p>` : ''}`;
      actions = btn('academy', t('academy.title'), 'success') + btn('reference', t('train.reference')) + btn('restart', t('train.restartLesson')) + btn('battle', t('train.toBattle'));
    }
    return `<header class="academy-dialog-head"><span class="caption">${this.active ? (m.stage === 'check' ? t('train.checkStage') : t('train.practiceStage')) : t('academy.title')}</span><h2 id="academy-dialog-title" class="body-lg mb-0">${this.esc(title)}</h2></header><div class="academy-dialog-scroll">${body}</div><footer class="academy-dialog-actions">${actions}</footer>`;
  },

  showPanel(kind, pause = true) {
    this.stopDemo();
    if (!this.overlay) this.focusFrom = document.activeElement;
    this.overlay = kind;
    if (pause && this.active) GameHost.send('pause');
    this.dialog.innerHTML = this.panelHTML(kind);
    this.cover.hidden = false;
    this.menu.inert = true;
    this.live.inert = true;
    this.dialog.focus({ preventScroll: true });
  },

  closePanel() {
    this.stopDemo();
    this.overlay = null;
    this.cover.hidden = true;
    this.dialog.innerHTML = '';
    this.menu.inert = false;
    this.live.inert = false;
    if (this.alive && this.focusFrom && this.focusFrom.isConnected && this.focusFrom.focus) this.focusFrom.focus({ preventScroll: true });
    this.focusFrom = null;
  },

  reference() { this.referenceBack = this.overlay; this.showPanel('reference'); },
  returnReference() {
    const back = this.referenceBack;
    this.referenceBack = null;
    if (this.summary) this.showPanel('summary');
    else if (back === 'pause') this.showPanel('pause');
    else if (this.requiredPanel()) this.showPanel(this.requiredPanel());
    else { this.closePanel(); if (this.active) GameHost.send('resume'); }
  },
  pause() { if (this.active && !this.summary) this.showPanel('pause'); },
  resume() {
    if (this.requiredPanel()) this.showPanel(this.requiredPanel());
    else { this.closePanel(); GameHost.send('mute', { on: !S.sfx }); GameHost.send('resume'); }
  },
  playDemo(realPace = false) {
    this.stopDemo();
    const status = this.dialog.querySelector('[data-demo-status]');
    if (!status) return;
    const item = this.active ? this.last.lesson || {} : this.selected();
    if (!item) return;
    const options = { rate: realPace ? 1 : .25 };
    if (this.active ? this.active.mode === 'course' : this.mode === 'course') options.lessonId = this.last.id || item.id;
    else { options.technique = this.active && this.active.stroke || item.id; options.strokeId = item.stroke; }
    this.previewBack = this.overlay;
    this.previewing = true;
    this.cover.hidden = this.menu.hidden = this.live.hidden = true;
    if (!GameHost.openPreview(options)) {
      this.previewing = false;
      this.previewBack = null;
      this.cover.hidden = false;
      this.menu.hidden = !!this.active;
      this.live.hidden = !this.active;
      status.textContent = t('train.previewUnavailable');
    }
  },
  stopDemo() {
    if (this.previewing) {
      this.previewing = false;
      this.previewBack = null;
      GameHost.closePreview();
    }
  },
  refreshLocale() {
    if (!this.alive) return;
    I18n.localizeDOM(this.el, this.render());
    this.updateMenu();
    if (this.active) this.updateLive(this.last);
    if (this.overlay && !this.previewing) {
      const scroll = this.dialog.querySelector('.academy-dialog-scroll');
      const top = scroll && scroll.scrollTop || 0;
      const focus = document.activeElement && document.activeElement.dataset;
      this.dialog.innerHTML = this.panelHTML(this.overlay);
      this.dialog.querySelector('.academy-dialog-scroll').scrollTop = top;
      const button = focus && (focus.act ? this.dialog.querySelector(`[data-act="${focus.act}"]`) : focus.answer ? this.dialog.querySelector(`[data-answer="${focus.answer}"]`) : null);
      if (button) button.focus({ preventScroll: true });
    }
  },
  cancel() {
    if (this.sessionId) this.retired.add(this.sessionId);
    this.active = null;
    this.sessionId = null;
    this.summary = null;
    this.closePanel();
    GameHost.send('quit');
    GameHost.show(false);
    TGX.guard(false);
  },
  toMenu() {
    if (Sheet.cur) Sheet.close(true);
    this.cancel();
    this.last = {};
    this.live.hidden = true;
    this.menu.hidden = false;
    GameHost.send('quiet', { on: true });
    this.updateMenu();
    this.menu.querySelector(`[data-mode="${this.mode}"]`).focus({ preventScroll: true });
  },
  exit() { this.cancel(); Router.go('hub'); },
  onKeydown(e) {
    if (Sheet.cur) return;
    if (e.key === 'Escape') { e.preventDefault(); this.onBack(); return; }
    if (e.key !== 'Tab' || !this.overlay) return;
    const buttons = [...this.dialog.querySelectorAll('button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]')];
    if (!buttons.length) { e.preventDefault(); return; }
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === this.dialog)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || document.activeElement === this.dialog)) { e.preventDefault(); first.focus(); }
  },
  leave() {
    this.alive = false;
    this.off && this.off();
    this.off = null;
    this.el.removeEventListener('click', this.click);
    this.el.removeEventListener('keydown', this.keydown);
    this.el.removeEventListener('pointerdown', this.pointerdown);
    this.cancel();
  },
  onBack() {
    if (this.previewing) { GameHost.closePreview(); return; }
    if (this.overlay === 'reference') { this.returnReference(); return; }
    if (this.active) this.toMenu(); else this.exit();
  }
});
