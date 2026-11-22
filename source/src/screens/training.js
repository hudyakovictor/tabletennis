Router.def('train', {
  full: true, mood: 'battle', game: true,
  render() {
    return `<div class="academy">
      <div class="academy-menu">
        <header class="academy-head safe-top"><div><span class="cap">${t('academy.optional')}</span><h1 class="h-display">${t('academy.title')}</h1></div>
          <button class="ib" data-act="exit" aria-label="${t('common.exit')}">${Art.icon('x', { c: '#fff' })}</button></header>
        <div class="academy-scroll scroll">
          <div class="academy-tabs" role="group" aria-label="${t('hub.chooseMode')}">
            <button data-mode="course" aria-pressed="true">${Art.icon('cup')}${t('academy.course')}</button>
            <button data-mode="stroke" aria-pressed="false">${Art.icon('paddle')}${t('academy.stroke')}</button>
            <button data-mode="accuracy" aria-pressed="false">${Art.icon('target')}${t('academy.accuracy')}</button>
          </div>
          <div class="academy-content"><p class="academy-loading" role="status">${t('academy.loading')}</p></div>
        </div>
      </div>
      <div class="mx tx live academy-live" hidden>
        <section class="tc" aria-label="${t('train.title')}">
          <div class="tc-h"><span class="tc-step num"></span><b class="tc-title"></b></div>
          <span class="tc-stage"></span><p class="tc-text"></p>
          <progress class="tc-progress" max="1" value="0" aria-label="${t('train.success')}"></progress><span class="tc-count num"></span>
          <p class="tc-feedback" role="status" aria-live="polite"></p>
        </section>
        <div class="academy-tools pe">
          <button class="ib academy-tool" data-act="pause" aria-label="${t('match.pause')}">${Art.icon('pause')}<span>${t('match.pause')}</span></button>
          <button class="ib academy-tool" data-act="menu" aria-label="${t('academy.menu')}">${Art.icon('home')}<span>${t('academy.menu')}</span></button>
        </div>
      </div>
      <div class="academy-overlay" hidden><section class="pnl academy-dialog" role="dialog" aria-modal="true" aria-labelledby="academy-dialog-title" tabindex="-1"></section></div>
    </div>`;
  },
  mount(el) {
    this.el = el; this.alive = true; this.active = null; this.last = {}; this.summary = null; this.overlay = null; this.referenceBack = null;
    this.requestId = null; this.sessionId = null; this.retired = new Set(); this.phaseKey = ''; this.answerPending = false;
    this.pendingAction = null; this.actionNotice = ''; this.recoveryNotice = false; this.startOnIntro = false;
    this.previewing = false; this.previewRequestId = null; this.previewBack = null; this.previewNotice = '';
    this.options = this.options || { pacing: 'coach', setSize: 10, adaptive: true, variation: true };
    this.mode = 'course'; this.selection = { course: S.training && S.training.lastLesson, stroke: 'DRIVE', accuracy: 'center' };
    this.catalog = GameHost.trainingCatalog || null;
    this.menu = el.querySelector('.academy-menu'); this.live = el.querySelector('.academy-live');
    this.cover = el.querySelector('.academy-overlay'); this.dialog = el.querySelector('.academy-dialog');
    try { this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)'); this.inputMode = matchMedia('(pointer:coarse)').matches ? 'touch' : 'mouse'; }
    catch (e) { this.motionQuery = null; this.inputMode = 'mouse'; }
    this.click = (e) => this.onClick(e); this.keydown = (e) => this.onKeydown(e);
    this.pointerdown = (e) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'mouse') return;
      this.inputMode = e.pointerType; this.refreshInput();
      GameHost.send('inputMode', { pointerType: e.pointerType });
    };
    el.addEventListener('click', this.click); el.addEventListener('keydown', this.keydown); el.addEventListener('pointerdown', this.pointerdown, { passive: true });
    this.off = GameHost.on((m) => this.onMsg(m));
    TGX.fullscreen(true); TGX.guard(false);
    GameHost.ensure(); GameHost.show(false); GameHost.send('quiet', { on: true });
    this.updateMenu();
  },
  esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  },
  metricsHTML(stats = {}) {
    return [['attempts', t('train.attempts')], ['hits', t('train.hits')], ['success', t('train.success')], ['streak', t('train.streak')], ['bestStreak', t('train.bestStreak')], ['rate', t('train.successRate')]]
      .map(([key, label]) => `<div><dt>${label}</dt><dd class="num" data-stat="${key}">${key === 'rate' ? Math.round((stats.success || 0) / Math.max(1, stats.attempts || 0) * 100) + '%' : fmt(Math.max(0, Number(stats[key]) || 0))}</dd></div>`).join('');
  },
  selected() {
    if (!this.catalog) return null;
    const items = this.mode === 'course' ? this.catalog.lessons : this.mode === 'stroke' ? this.catalog.strokes : this.catalog.targets;
    return items.find((x) => x.id === this.selection[this.mode]) || items[0] || null;
  },
  updateMenu(reset = false) {
    if (this.active) return;
    const sc = this.el.querySelector('.academy-scroll'), top = reset ? 0 : sc.scrollTop;
    const expanded = new Set([...this.el.querySelectorAll('[data-chapter][open]')].map(d => d.dataset.chapter));
    const optionsOpen = this.menu.querySelector('.academy-options')?.open, referenceOpen = this.menu.querySelector('.academy-menu-reference')?.open;
    this.el.querySelectorAll('[data-mode]').forEach((b) => { const on = b.dataset.mode === this.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    const host = this.el.querySelector('.academy-content'), C = this.catalog;
    if (!C) { host.innerHTML = `<p class="academy-loading" role="status">${t('academy.loading')}</p>`; return; }
    const selected = this.selected(); if (!selected) return;
    this.selection[this.mode] = selected.id;
    const progress = S.training && S.training.lessons || {}, mastered = C.lessons.filter((l) => progress[l.id] && progress[l.id].mastered).length;
    const status = this.mode === 'course' && progress[selected.id] || {};
    let body = `<article class="pnl academy-selection"><span class="cap">${status.mastered ? t('academy.mastered') : status.practiced ? t('academy.resume') : t('academy.' + this.mode)}</span>
      <h2>${this.esc(selected.title)}</h2><p class="academy-goal">${this.esc(selected.goal || selected.title)}</p>
      ${this.guideHTML(selected, { mode: this.mode }, true)}
      ${this.mode !== 'course' ? this.sizeHTML() : ''}
      <div class="academy-actions"><button class="b3 green block" data-act="open">${Art.icon('play')}${status.practiced && !status.mastered ? t('academy.resume') : t('academy.start')}</button>
        ${this.mode !== 'accuracy' ? `<button class="b3 dark sm block" data-act="example">${t('academy.show')}</button>` : ''}</div>
      <p class="academy-preview-status" data-demo-status role="status">${this.previewNotice ? t('train.previewUnavailable') : ''}</p></article>
      ${this.optionsHTML()}
      <details class="academy-details academy-menu-reference"><summary>${t('train.reference')}</summary>${this.guideHTML(selected, { mode: this.mode })}</details>`;
    if (this.mode === 'course') {
      body += `<div class="pnl academy-course-progress"><div><b>${t('academy.progress', { done: mastered, total: C.lessons.length })}</b><small>${t('academy.saved')}</small></div>
        <progress max="${Math.max(1, C.lessons.length)}" value="${mastered}" aria-label="${t('academy.course')}"></progress></div>
        <h2 class="h2 academy-section-title">${t('academy.chapters')}</h2><p class="academy-note">${t('academy.selectLesson')}</p>
        <div class="academy-chapters">${C.modules.map((module) => {
          const lessons = C.lessons.filter((l) => l.module === module.id), count = lessons.filter((l) => progress[l.id] && progress[l.id].mastered).length;
          return `<details class="pnl academy-chapter" data-chapter="${this.esc(module.id)}" ${expanded.has(module.id) ? 'open' : ''}><summary><h3>${this.esc(module.title)}</h3><span class="num">${count}/${lessons.length}</span></summary><p>${this.esc(module.description)}</p>
            <div class="academy-lessons">${lessons.map((lesson) => {
              const saved = progress[lesson.id] || {}, state = saved.mastered ? 'mastered' : saved.practiced ? 'practiced' : 'new';
              return `<button class="academy-lesson ${state} ${lesson.id === selected.id ? 'on' : ''}" data-choice="${this.esc(lesson.id)}" aria-pressed="${lesson.id === selected.id}">
                <span class="academy-lesson-number num">${C.lessons.indexOf(lesson) + 1}</span><span><b>${this.esc(lesson.title)}</b><small>${saved.mastered ? t('academy.mastered') : saved.practiced ? t('academy.practiced') : t('academy.notStarted')}</small></span>${Art.icon(saved.mastered ? 'check' : 'play')}</button>`;
            }).join('')}</div></details>`;
        }).join('')}</div>`;
    } else {
      const stroke = this.mode === 'stroke', items = stroke ? C.strokes : C.targets;
      body += `<p class="academy-note">${stroke ? t('academy.strokeIntro') : t('academy.accuracyIntro')}</p>
        ${stroke && globalThis.StrokeIcons ? `<section class="academy-spin-legend"><p>${t('hud.motionLegend')}</p><div>${[['DRIVE','hud.spinTop'],['PUSH','hud.spinBack'],['SIDE','hud.spinSide'],['SERVE_NO_SPIN','hud.noSpin']].map(([id, label]) => `<span>${StrokeIcons.create(id).outerHTML}<small>${t(label)}</small></span>`).join('')}</div></section>` : ''}
        <div class="academy-picks ${stroke ? 'strokes' : 'targets'}" role="group" aria-label="${stroke ? t('academy.selectStroke') : t('academy.selectTarget')}">
           ${items.map((item) => `<button class="academy-pick ${item.id === selected.id ? 'on' : ''}" data-choice="${this.esc(item.id)}" aria-pressed="${item.id === selected.id}">${stroke ? `<small>${this.esc(item.id)}</small>` : Art.icon('target')}<b>${this.esc(item.title)}</b></button>`).join('')}</div>`;
    }
    host.innerHTML = body;
    host.querySelector('.academy-options').open = !!optionsOpen; host.querySelector('.academy-menu-reference').open = !!referenceOpen;
    sc.scrollTop = top;
  },
  sizeHTML() {
    return `<fieldset class="academy-option"><legend>${t('academy.setSize')}</legend><div class="academy-segment">${[[10, '10'], [20, '20'], [null, t('academy.unlimited')]].map(([size, label]) =>
      `<button data-set-size="${size === null ? 'unlimited' : size}" aria-pressed="${this.options.setSize === size}">${label}</button>`).join('')}</div></fieldset>`;
  },
  optionsHTML(paused = false) {
    const pacing = this.active ? this.active.pacing : this.options.pacing;
    return `<details class="academy-details academy-options" ${paused ? 'open' : ''}><summary>${t('academy.sessionOptions')}</summary>
      <fieldset class="academy-option"><legend>${t('academy.pacing')}</legend><div class="academy-segment">${['coach', 'flow'].map(value =>
        `<button data-pacing="${value}" aria-pressed="${pacing === value}" ${this.pendingAction ? 'disabled' : ''}>${t('academy.pacing.' + value)}</button>`).join('')}</div><p>${t('academy.pacing.' + pacing + 'Hint')}</p></fieldset>
      ${paused ? '' : ['adaptive', 'variation'].map(key => `<button class="academy-option-toggle" data-option="${key}" aria-pressed="${this.options[key]}"><span>${t('academy.' + key)}</span><b>${t(this.options[key] ? 'common.on' : 'common.off')}</b></button>`).join('')}</details>`;
  },
  guideHTML(lesson = {}, state = {}, compact = false) {
    const feedback = this.checkLocked(state) ? null : state.feedback || state.latestFeedback, example = feedback && feedback.expected && this.catalog && this.catalog.strokes.find(s => s.id === feedback.expected.id);
    if (example && !(lesson.gesture && lesson.gesture.kind === 'tap')) lesson = { ...lesson, ...example };
    const controls = lesson.controls || {}, input = state.inputMode || this.inputMode;
    const fields = [[t('train.feature'), lesson.feature], [t('train.advantage'), lesson.advantage], [t('train.when'), lesson.when], [t('train.risk'), lesson.risk], [t('train.counter'), lesson.counter]];
    const accuracy = state.mode === 'accuracy' || feedback && feedback.code === 'outside';
    return `<div class="academy-guide ${compact ? 'compact' : ''}">
      ${accuracy ? `<p class="academy-accuracy-instruction">${t('academy.aimInstruction')}</p>${this.landingHTML(state.target, feedback && feedback.landing)}` :
        `<div class="academy-inputs"><div class="academy-input on" data-instruction="${this.esc(lesson.id || '')}"><b>${t(input === 'touch' ? 'train.touchControls' : 'train.mouseControls')}</b><p>${this.esc(lesson.brief && lesson.brief[input] || '')}</p></div></div>
        ${this.gestureHTML(feedback && feedback.expected ? feedback.expected.gesture : lesson.gesture, input, feedback && feedback.actual && feedback.actual.gesture, compact)}`}
      ${compact ? '' : `<details class="academy-details"><summary>${t('train.details')}</summary><div class="academy-guide-details">
        ${lesson.context ? `<p>${this.esc(lesson.context)}</p>` : ''}
        <section><h3>${t('train.controls')}</h3>${[['touch', t('train.touchControls')], ['mouse', t('train.mouseControls')]].map(([mode, title]) =>
          `<p><b>${title}:</b> ${this.esc(controls[mode] || '')}</p>`).join('')}</section>
        ${fields.filter(([, value]) => typeof value === 'string' && value).map(([label, value]) => `<section><h3>${label}</h3><p>${this.esc(value)}</p></section>`).join('')}
        ${this.diagramHTML(state.diagram, state)}</div></details>`}</div>`;
  },
  refreshInput() {
    this.el.querySelectorAll('[data-instruction]').forEach((card) => {
      const items = this.catalog ? [...this.catalog.lessons, ...this.catalog.strokes] : [];
      const lesson = items.find(item => item.id === card.dataset.instruction) || this.last.lesson || {};
      card.querySelector('b').textContent = t(this.inputMode === 'touch' ? 'train.touchControls' : 'train.mouseControls');
      card.querySelector('p').textContent = lesson.brief && lesson.brief[this.inputMode] || '';
    });
    this.el.querySelectorAll('.academy-gesture .academy-demo-ball').forEach((cursor) => cursor.setAttribute('r', this.inputMode === 'touch' ? 8 : 5));
  },
  gestureHTML(gesture, input, actual, compact = false) {
    if (!gesture || !Array.isArray(gesture.points)) return '';
    const lengths = { short: t('train.gestureShort'), medium: t('train.gestureMediumLength'), long: t('train.gestureLong') }, paces = { soft: t('train.gestureSoft'), medium: t('train.gestureMedium'), fast: t('train.gestureFast') };
    const valid = points => (Array.isArray(points) ? points : []).filter(p => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite));
    const expected = valid(gesture.points), played = valid(actual && actual.points); if (!expected.length) return '';
    const viewport = actual && actual.viewport, ratio = viewport && viewport[0] > 0 && viewport[1] > 0 ? viewport[1] / viewport[0] : 1;
    const points = [...expected, ...played, [0, 0]], xMax = Math.max(.18, ...points.map(p => Math.abs(p[0]))), yMax = Math.max(.16, ...points.map(p => Math.abs(p[1]) * ratio));
    const scale = Math.min(128 / xMax, 68 / yMax, 400), project = p => [150 + p[0] * scale, 92 + p[1] * ratio * scale];
    const path = ps => ps.map((p, i) => `${i ? 'L' : 'M'}${project(p).join(' ')}`).join(' ');
    const start = project(expected[0]), end = project(expected.at(-1)), before = project(expected.at(-2) || expected[0]);
    const angle = Math.atan2(end[1] - before[1], end[0] - before[0]);
    const arrow = [end, [end[0] - Math.cos(angle - .5) * 10, end[1] - Math.sin(angle - .5) * 10], [end[0] - Math.cos(angle + .5) * 10, end[1] - Math.sin(angle + .5) * 10]];
    const label = gesture.kind === 'tap' ? t('train.gestureTap') : `${lengths[gesture.length]} / ${paces[gesture.pace]}`;
    return `<figure class="academy-gesture ${played.length ? 'comparison' : ''} ${compact ? 'compact' : ''}"><svg viewBox="0 0 300 184" role="img" aria-label="${this.esc(t('train.motionGuide'))}" data-demo-view="gesture" data-demo-duration="${Number(gesture.duration) || 750}">
      <rect x="1" y="1" width="298" height="182" rx="14" fill="#080f21" stroke="#34466b"/>
      <text x="12" y="19" class="academy-motion-label">${t('train.screenMotion')}</text>
      <path d="${path(expected)}" class="academy-gesture-path" data-demo-leg="gesture" fill="none" stroke="#9cffd0" stroke-width="4" stroke-linecap="round"/>
      ${gesture.kind === 'tap' ? '<circle cx="150" cy="92" r="18" fill="none" stroke="#9cffd0" stroke-width="3"/>' : `<polygon points="${arrow.map(p => p.join(',')).join(' ')}" fill="#9cffd0"/>`}
      ${played.length ? `<path d="${path(played)}" data-motion="actual" fill="none" stroke="#ffb3a6" stroke-width="3" stroke-dasharray="5 4"/><circle cx="${project(played[0])[0]}" cy="${project(played[0])[1]}" r="5" fill="#ffb3a6"/>` : ''}
      <circle cx="150" cy="92" r="6" fill="#fff" stroke="#080f21" stroke-width="2"/><text x="160" y="96" class="academy-motion-label">${t('train.ball')}</text>
      ${gesture.kind === 'tap' ? '' : `<circle cx="${start[0]}" cy="${start[1]}" r="11" fill="#9cffd0"/><text x="${start[0]}" y="${start[1] + 4}" text-anchor="middle" class="academy-motion-number">1</text><text x="${end[0]}" y="${end[1] < 92 ? end[1] - 12 : end[1] + 20}" text-anchor="middle" class="academy-motion-label">2</text>`}
      ${played.length === 1 ? `<circle cx="${project(played[0])[0]}" cy="${project(played[0])[1]}" r="15" fill="none" stroke="#ffb3a6" stroke-width="3"/><text x="${project(played[0])[0] > 230 ? project(played[0])[0] - 40 : project(played[0])[0] + 21}" y="${project(played[0])[1] + 4}" class="academy-motion-label" style="fill:#ffb3a6">${t('train.actualTap')}</text>` : ''}
      <circle class="academy-demo-ball" cx="${start[0]}" cy="${start[1]}" r="${input === 'touch' ? 8 : 5}" fill="#ffd54a" stroke="#080f21" stroke-width="2"/></svg>
      <figcaption><b>${gesture.kind === 'tap' ? t('train.tapSteps') : t('train.motionSteps')}</b><span>${this.esc(label)}</span></figcaption>
      ${played.length ? `<div class="academy-motion-legend"><span class="expected">${t('train.expectedMotion')}</span><span class="actual">${t('train.actualMotion')}</span></div>` : ''}</figure>`;
  },
  landingHTML(target, landing) {
    if (!target) return '';
    const x = n => 120 + n / .7625 * 49, y = n => 105 + n / 1.37 * 88;
    return `<figure class="academy-placement"><svg viewBox="0 0 240 210" role="img" aria-label="${t('train.targetZone')}">
      <rect x="71" y="17" width="98" height="176" rx="3" fill="#102747" stroke="#8fb1d3"/>
      <path d="M67 105 H173 M120 17 V193" stroke="#c6dcf4"/>
      <rect x="${x(target.x0)}" y="${y(target.z0)}" width="${x(target.x1) - x(target.x0)}" height="${y(target.z1) - y(target.z0)}" fill="#9cffd0" fill-opacity=".25" stroke="#9cffd0"/>
      ${landing && Number.isFinite(landing.x) && Number.isFinite(landing.z) ? `<circle cx="${x(landing.x)}" cy="${y(landing.z)}" r="5" fill="#ffb3a6" stroke="#080f21" stroke-width="2"/><text x="${x(landing.x) + 9}" y="${y(landing.z) + 4}" class="academy-motion-label">${t('train.actualLanding')}</text>` : ''}
      <text x="120" y="12" text-anchor="middle" class="academy-motion-label">${t('train.opponent')}</text><text x="120" y="207" text-anchor="middle" class="academy-motion-label">${t('train.you')}</text></svg>
      <figcaption>${t('train.greenTarget')}</figcaption></figure>`;
  },
  feedbackHTML(feedback, comparison = true) {
    if (!feedback) return '';
    const neutral = ['let', 'feeder'].includes(feedback.code);
    return `<div class="academy-feedback" data-feedback="${this.esc(feedback.code)}">
      <p class="academy-reason"><small>${t('train.reason')}</small>${this.esc(feedback.title)}</p>
      <p class="academy-correction"><small>${t('train.correction')}</small>${this.esc(feedback.correction)}</p>
      ${comparison ? feedback.code === 'outside' ? this.landingHTML(feedback.target, feedback.landing) : this.gestureHTML(feedback.expected && feedback.expected.gesture, this.inputMode, feedback.actual && feedback.actual.gesture) : ''}
      ${neutral ? '' : `<div class="academy-checks">${[[feedback.contact, t('train.contact')], [feedback.legal, t('train.legal')], [feedback.code === 'counted', t('train.objective')]].map(([ok, label]) => `<span class="${ok ? 'ok' : 'miss'}">${Art.icon(ok ? 'check' : 'x')}${label}</span>`).join('')}</div>`}
      ${comparison && feedback.contact ? `<p class="academy-attempt-name">${t('train.playedStroke')}: <b>${this.esc(feedback.actual && feedback.actual.title)}</b></p>` : ''}</div>`;
  },
  diagramHTML(diagram, state = {}) {
    if (!diagram) return '';
    const series = [['recommended', t('train.recommended'), '#9cffd0'], ['actual', t('train.actual'), '#ffb3a6']]
      .map(([key, label, color]) => ({ key, label, color, points: (Array.isArray(diagram[key]) ? diagram[key] : []).filter((p) => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every(Number.isFinite)).slice(0, 400) }));
    const points = series.flatMap((s) => s.points), target = diagram.target;
    const hasTarget = target && ['x0', 'x1', 'z0', 'z1'].every((k) => Number.isFinite(target[k]));
    if (!points.length && !hasTarget) return '';
    const xMax = Math.max(1, ...points.map((p) => Math.abs(p[0]))), zMax = Math.max(1.65, ...points.map((p) => Math.abs(p[2])));
    const topScale = Math.min(268 / (xMax * 2), 224 / (zMax * 2));
    const yMin = Math.min(0, ...points.map((p) => p[1])), yMax = Math.max(1.6, ...points.map((p) => p[1]));
    const sideScale = Math.min(268 / (zMax * 2), 174 / (yMax - yMin));
    const top = (p) => [160 + p[0] * topScale, 136 + p[2] * topScale], side = (p) => [160 - p[2] * sideScale, 196 - (p[1] - yMin) * sideScale];
    const n = (x) => Math.round(x * 100) / 100;
    const lines = (project) => series.filter((s) => s.points.length > 1).map((s) => {
      const ps = s.points.map(project), end = ps[ps.length - 1], before = ps[ps.length - 2], angle = Math.atan2(end[1] - before[1], end[0] - before[0]);
      const arrow = [end, [end[0] - Math.cos(angle - .5) * 8, end[1] - Math.sin(angle - .5) * 8], [end[0] - Math.cos(angle + .5) * 8, end[1] - Math.sin(angle + .5) * 8]];
      return `<path d="${ps.map((p, i) => `${i ? 'L' : 'M'}${n(p[0])} ${n(p[1])}`).join(' ')}" data-demo-leg="${s.key}" fill="none" stroke="${s.color}" stroke-width="2.5" ${s.key === 'recommended' ? '' : 'stroke-dasharray="5 4"'}/>
        <polygon points="${arrow.map((p) => p.map(n).join(',')).join(' ')}" fill="${s.color}"/>`;
    }).join('');
    const tx = top([-.7625, .76, -1.37]), tableSide = side([0, .76, 1.37]), tableEnd = side([0, .76, -1.37]), net = side([0, .9125, 0]);
    const topTarget = hasTarget ? (() => { const a = top([Math.min(target.x0, target.x1), .76, Math.min(target.z0, target.z1)]); return `<rect x="${n(a[0])}" y="${n(a[1])}" width="${n(Math.abs(target.x1 - target.x0) * topScale)}" height="${n(Math.abs(target.z1 - target.z0) * topScale)}" fill="#ffd54a" fill-opacity=".22" stroke="#ffd54a" stroke-dasharray="3 3"/>`; })() : '';
    const sideTarget = hasTarget ? `<rect x="${n(side([0, .76, Math.max(target.z0, target.z1)])[0])}" y="${n(tableSide[1] - 4)}" width="${n(Math.abs(target.z1 - target.z0) * sideScale)}" height="8" fill="#ffd54a" fill-opacity=".55"/>` : '';
    const feature = state.lesson && state.lesson.feature;
    const spin = diagram.spin, spinText = spin ? [['topRps', spin.topRps > 0 ? t('train.topspin') : spin.topRps < 0 ? t('train.backspin') : t('train.topBackSpin')], ['sideRps', t('train.sidespin')]]
      .filter(([key]) => Number.isFinite(spin[key])).map(([key, label]) => `${label}: ${Math.round(spin[key] * 10) / 10} ${t('train.spinUnit')}`).join(' / ') : '';
    return `<figure class="academy-diagram"><div class="academy-views">
      <div><b>${t('train.topView')}</b><svg viewBox="0 0 320 272" role="img" aria-label="${t('train.topView')}" data-demo-view="top">
        <rect x="${n(tx[0])}" y="${n(tx[1])}" width="${n(1.525 * topScale)}" height="${n(2.74 * topScale)}" rx="3" fill="#102747" stroke="#8fb1d3"/>
        <path d="M160 ${n(tx[1])} V${n(tx[1] + 2.74 * topScale)} M${n(tx[0] - 4)} 136 H${n(tx[0] + 1.525 * topScale + 4)}" stroke="#c6dcf4" stroke-width="1.5"/>
        ${topTarget}${lines(top)}<circle class="academy-demo-ball" r="4.5" fill="#fff" stroke="#10182b"/>
        <text x="160" y="14" text-anchor="middle">${t('train.opponent')}</text><text x="160" y="263" text-anchor="middle">${t('train.you')}</text></svg></div>
      <div><b>${t('train.sideView')}</b><svg viewBox="0 0 320 222" role="img" aria-label="${t('train.sideView')}" data-demo-view="side">
        <path d="M${n(tableSide[0])} ${n(tableSide[1])} H${n(tableEnd[0])} M${n(side([0, .76, -1])[0])} ${n(tableSide[1])} V${n(side([0, 0, -1])[1])} M${n(side([0, .76, 1])[0])} ${n(tableSide[1])} V${n(side([0, 0, 1])[1])}" stroke="#8fb1d3" stroke-width="3"/>
        <path d="M160 ${n(tableSide[1])} V${n(net[1])}" stroke="#c6dcf4" stroke-width="3"/>
        ${sideTarget}${lines(side)}<circle class="academy-demo-ball" r="4.5" fill="#fff" stroke="#10182b"/>
        <text x="160" y="${n(net[1] - 7)}" text-anchor="middle">${t('train.net')}</text><text x="22" y="215">${t('train.you')}</text><text x="298" y="215" text-anchor="end">${t('train.opponent')}</text></svg></div></div>
      <div class="academy-legend">${series.filter((s) => s.points.length).map((s) => `<span><i style="--line:${s.color}" class="${s.key}"></i>${s.label}</span>`).join('')}${hasTarget ? `<span><i class="target"></i>${t('train.targetZone')}</span>` : ''}</div>
      ${spinText || feature ? `<p class="academy-spin"><b>${t('train.spinFlight')}</b> ${this.esc(spinText || feature)}</p>` : ''}
      <figcaption>${this.esc(diagram.caption || t('train.diagramHint'))}</figcaption></figure>`;
  },
  onClick(e) {
    const b = e.target.closest('button'); if (!b || !this.el.contains(b) || b.disabled) return;
    if (Sheet.cur) return;
    e.stopPropagation();
    if (b.dataset.mode && !this.active) { this.mode = b.dataset.mode; this.updateMenu(true); return; }
    if (b.dataset.choice && !this.active) { this.selection[this.mode] = b.dataset.choice; this.updateMenu(true); return; }
    if (b.dataset.setSize && !this.active) {
      const sizes = { '10': 10, '20': 20, unlimited: null };
      if (Object.hasOwn(sizes, b.dataset.setSize)) { this.options.setSize = sizes[b.dataset.setSize]; this.updateMenu(); }
      return;
    }
    if (b.dataset.pacing) {
      const value = b.dataset.pacing; if (!['coach', 'flow'].includes(value)) return;
      if (this.active) this.action('pacing', { value }); else { this.options.pacing = value; this.updateMenu(); }
      return;
    }
    if (b.dataset.option && !this.active && ['adaptive', 'variation'].includes(b.dataset.option)) {
      this.options[b.dataset.option] = !this.options[b.dataset.option]; this.updateMenu(); return;
    }
    if (b.dataset.answer) {
      if (this.pendingAction || this.last.phase !== 'question') return;
      this.action('answer', { answer: b.dataset.answer }); return;
    }
    const act = b.dataset.act;
    if (act === 'open') this.openSession();
    if (act === 'guide' || act === 'reference') this.reference();
    if (act === 'reference-back') this.returnReference();
    if (act === 'example' || act === 'demo') this.playDemo('example');
    if (act === 'attempt') this.playDemo('attempt');
    if (act === 'demo-live') this.playDemo('example', true);
    if (act === 'feedback' && !this.checkLocked()) this.showPanel('feedback');
    if (act === 'start' || act === 'continue' || act === 'retry') this.action(act);
    if (act === 'pause') this.pause();
    if (act === 'menu') this.showPanel('menu');
    if (act === 'resume') this.resume();
    if (act === 'restart') this.restart();
    if (act === 'academy') this.toMenu();
    if (act === 'skip') this.action('skip');
    if (act === 'exit') this.exit();
    if (act === 'battle') { this.cancel(); Router.go('mm'); }
    if (act === 'diag-mark') diagnosticMarkFrame();
    if (act === 'diagnostics' || act === 'screenshot' || act === 'dev') {
      // A pause dialog stays underneath diagnostics. Closing or replacing a
      // sheet never implicitly restarts the feeder.
      if (this.active && !this.overlay) this.pause();
      GameHost.send('pause');
      if (act === 'dev') devZoneSheet(); else diagnosticsSheet({ focusScreenshot: act === 'screenshot' });
    }
  },
  openSession(autoStart = true) {
    const item = this.selected(); if (!item) return;
    const data = { mode: this.mode, progress: S.training, ...this.options, setSize: this.mode === 'course' ? null : this.options.setSize };
    if (this.mode === 'course') data.lessonId = item.id;
    if (this.mode === 'stroke') data.stroke = item.id;
    if (this.mode === 'accuracy') data.target = item.id;
    if (this.sessionId) this.retired.add(`${this.requestId}:${this.sessionId}`);
    this.stopDemo(); this.pendingAction = null; this.answerPending = false; this.actionNotice = ''; this.previewNotice = ''; this.recoveryNotice = false;
    this.active = data; this.last = {}; this.summary = null; this.requestId = null; this.sessionId = null; this.phaseKey = ''; this.awaitingIntro = true; this.startOnIntro = autoStart;
    this.closePanel(); this.menu.hidden = true; this.live.hidden = false; TGX.guard(true);
    GameHost.show(true); GameHost.send('mute', { on: !S.sfx }); GameHost.send('quiet', { on: false });
    this.showPanel('loading', false); this.requestId = GameHost.send('train', data);
  },
  action(action, data = {}) {
    if (!this.active || this.summary || this.pendingAction || this.previewing || !this.sessionId || !Number.isSafeInteger(this.requestId)) return;
    this.actionNotice = '';
    const pending = this.pendingAction = { action, ...data, requestId: this.requestId, sessionId: this.sessionId, phaseKey: this.phaseKey };
    this.answerPending = action === 'answer';
    pending.actionId = GameHost.send(action === 'skip' ? 'skipStep' : 'trainAction', action === 'skip' ? {} : { action, ...data });
    if (!Number.isSafeInteger(pending.actionId)) { this.pendingAction = null; this.answerPending = false; this.actionNotice = 'unavailable'; }
    this.showPanel(this.overlay || this.requiredPanel() || 'pause', false);
  },
  actionAck(m) {
    const pending = this.pendingAction;
    if (!pending || m.actionId !== pending.actionId || m.requestId !== this.requestId || m.requestId !== pending.requestId ||
        m.sessionId !== this.sessionId || m.sessionId !== pending.sessionId || typeof m.accepted !== 'boolean') return;
    this.pendingAction = null; this.answerPending = false;
    if (m.accepted !== true) {
      this.actionNotice = 'rejected'; this.showPanel(this.overlay || this.requiredPanel() || 'pause', false); return;
    }
    this.actionNotice = '';
    if (pending.action === 'skip') { this.toMenu(); return; }
    if (pending.action === 'pacing') {
      this.options.pacing = this.active.pacing = this.last.pacing = pending.value;
      this.showPanel(this.overlay || 'pause', false); return;
    }
    this.recoveryNotice = false;
    const changed = this.phaseKey !== pending.phaseKey;
    this.closePanel();
    if (changed && this.requiredPanel()) this.showPanel(this.requiredPanel(), false);
  },
  restart() {
    if (!this.active) return;
    if (this.active.mode === 'course') this.selection.course = this.last.id || this.active.lessonId;
    this.mode = this.active.mode; this.openSession(false);
  },
  onMsg(m) {
    if (!this.alive) return;
    if (m.type === 'preview' && this.previewing) {
      if (m.requestId !== this.previewRequestId) return;
      if (m.active) return;
      const back = this.previewBack; this.previewing = false; this.previewBack = null; this.previewRequestId = null;
      this.previewNotice = m.opened === false || m.error ? 'unavailable' : '';
      this.menu.hidden = !!this.active; this.live.hidden = !this.active;
      if (back) this.showPanel(back, false); else { this.closePanel(); this.updateMenu(); }
      return;
    }
    const catalog = m.type === 'ready' ? m.trainingCatalog : m.type === 'trainingCatalog' ? m.catalog : null;
    if (catalog) { this.catalog = catalog; this.updateMenu(); }
    if (m.type === 'trainingProgress') this.updateMenu();
    if (!this.active) return;
    if (m.type === 'ready') {
      const intent = GameHost.trainingIntent;
      if (!intent || !Number.isSafeInteger(intent.requestId)) return;
      if (intent.requestId === this.requestId && !this.sessionId && !(m.recovery && m.recovery.type === 'train')) return;
      this.recoveryKind = this.last.stage === 'check' ? 'check' : this.active.mode === 'course' ? 'lesson' : 'set';
      // GPU reloads reset the engine's session counter, but not the host request ID.
      if (this.sessionId) this.retired.add(`${this.requestId}:${this.sessionId}`);
      this.stopDemo(); this.pendingAction = null; this.answerPending = false; this.previewNotice = ''; this.actionNotice = '';
      this.requestId = intent.requestId; this.sessionId = null; this.awaitingIntro = true; this.phaseKey = ''; this.summary = null; this.last = {}; this.startOnIntro = false;
      if (m.recovery && m.recovery.type === 'train' && m.recovery.requestId === intent.requestId) {
        this.recoveryNotice = true; this.active = { ...this.active, ...intent.data };
      }
      this.showPanel('loading', false);
      return;
    }
    if (m.type === 'trainActionAck') { this.actionAck(m); return; }
    if (m.type === 'paused' && m.v && !m.host && !Sheet.cur && !this.overlay && !this.summary) this.pause();
    if (m.type === 'trainDone') {
      if (this.summary || this.awaitingIntro || m.requestId !== this.requestId || m.mode !== this.active.mode || m.sessionId !== this.sessionId || this.retired.has(`${m.requestId}:${m.sessionId}`)) return;
      this.pendingAction = null; this.answerPending = false; this.summary = m; this.showPanel('summary'); return;
    }
    if (m.type !== 'train' || this.summary && m.phase !== 'done' || m.requestId !== this.requestId || m.mode !== this.active.mode || typeof m.sessionId !== 'string' || !m.sessionId || this.retired.has(`${m.requestId}:${m.sessionId}`)) return;
    if (this.sessionId && m.sessionId !== this.sessionId) return;
    if (this.awaitingIntro && m.phase !== 'intro') return;
    const first = this.awaitingIntro; this.sessionId = m.sessionId; this.awaitingIntro = false;
    if (m.inputMode === 'mouse' || m.inputMode === 'touch') { this.inputMode = m.inputMode; this.refreshInput(); }
    const previous = this.last; this.last = m;
    if (this.summary) {
      if (m.mode !== 'course' && m.practiceSet) this.summary = { ...this.summary, practiceSet: m.practiceSet };
      this.updateLive(m); if (this.overlay && !this.previewing) this.showPanel(this.overlay, false); return;
    }
    if (['coach', 'flow'].includes(m.pacing)) this.active.pacing = m.pacing;
    if (m.mode === 'course' && m.lesson) this.selection.course = m.lesson.id;
    this.updateLive(m);
    const panel = this.requiredPanel(), quiz = m.quiz || {};
    const key = [m.sessionId, m.id, m.stage, m.phase, quiz.prompt, quiz.explanation, ['review', 'question', 'fail'].includes(m.phase) ? m.msg : ''].join('|');
    const changed = key !== this.phaseKey; this.phaseKey = key;
    if (first && this.startOnIntro) {
      this.startOnIntro = false; this.showPanel('intro', false); this.action('start'); return;
    }
    if (!this.pendingAction && !this.previewing && !['reference', 'pause', 'menu'].includes(this.overlay)) {
      if (panel && changed) this.showPanel(panel);
      else if (!panel && changed && ['loading', 'intro', 'question', 'review', 'finishing'].includes(this.overlay)) this.closePanel();
    } else if (!this.pendingAction && !this.previewing && this.overlay && (previous.title !== m.title || previous.goal !== m.goal)) {
      this.showPanel(this.overlay, false);
    }
  },
  updateLive(m) {
    const q = (selector) => this.live.querySelector(selector), stats = m.stats || {};
    q('.tc-step').textContent = m.mode === 'course' && Number.isFinite(m.step) ? `${m.step + 1}/${m.total}` : '';
    q('.tc-title').textContent = m.title || (m.lesson && m.lesson.title) || t('train.title');
    q('.tc-stage').textContent = m.stage === 'check' ? t('train.checkStage') : [t('train.practiceStage'), ['guided', 'ring', 'independent'].includes(m.helpLevel) ? t('train.help.' + m.helpLevel) : ''].filter(Boolean).join(' / ');
    q('.tc-text').textContent = m.goal || '';
    const need = Math.max(1, Number(m.need) || 1), done = Math.max(0, Number(m.done) || 0);
    const attempts = Math.max(0, Number(m.attempts) || 0);
    const set = m.practiceSet;
    q('.tc-progress').hidden = m.mode !== 'course' && !set; q('.tc-progress').max = set ? set.size : need;
    q('.tc-progress').value = set ? set.attempted : Math.min(m.stage === 'check' ? attempts : done, need);
    q('.tc-count').textContent = set ? t('train.setProgress', { attempted: set.attempted, size: set.size, successful: set.successful }) : m.mode !== 'course' ? t('train.practiceCount', { n: done }) : m.stage === 'check' ? t('train.checkProgress', { done, attempts, total: need }) : t('train.sessionProgress', { done, need });
    this.live.querySelectorAll('[data-stat]').forEach((value) => { value.textContent = value.dataset.stat === 'rate' ? Math.round((stats.success || 0) / Math.max(1, stats.attempts || 0) * 100) + '%' : fmt(Math.max(0, Number(stats[value.dataset.stat]) || 0)); });
    const feedback = q('.tc-feedback'); feedback.className = 'tc-feedback ' + (m.phase === 'ok' ? 'ok' : m.phase === 'fail' ? 'fail' : '');
    feedback.textContent = ['ok', 'fail'].includes(m.phase) ? m.feedback && m.feedback.title || m.msg || '' : '';
  },
  checkLocked(state = this.last) { return state.stage === 'check' && !(state.attempts === 4 && ['review', 'done'].includes(state.phase)); },
  requiredPanel() {
    const m = this.last, feedback = m.feedback || m.latestFeedback;
    if (m.phase === 'fail' && m.stage !== 'check' && (m.pacing || this.active && this.active.pacing) === 'coach' &&
        feedback && !feedback.neutral && !['let', 'feeder'].includes(feedback.code) && !(m.result && m.result.neutral)) return 'feedback';
    return { intro: 'intro', question: 'question', review: 'review', done: 'finishing' }[this.last.phase] || null;
  },
  canPreview(source) {
    if (!['attempt', 'example'].includes(source) || this.pendingAction || this.checkLocked()) return false;
    if (source !== 'attempt') return true;
    const replay = this.last.attemptReplay;
    return !!(this.active && replay && replay.available === true && Number.isSafeInteger(replay.attemptId) && replay.attemptId > 0 &&
      ['ok', 'fail', 'question', 'review', 'done'].includes(this.last.phase));
  },
  previewHTML() {
    if (this.checkLocked()) return `<p class="academy-note">${t('train.checkNoPreview')}</p>`;
    const actual = this.canPreview('attempt'), replay = this.last.attemptReplay;
    return `<div class="academy-demo-controls">${this.active ? `<button class="b3 dark sm" data-act="attempt" ${actual ? '' : 'disabled'}>${t('train.actualAttempt')}</button>` : ''}
      <button class="b3 dark sm" data-act="example" ${this.pendingAction ? 'disabled' : ''}>${t('train.example')}</button>
      <p data-demo-status role="status">${this.previewNotice ? t('train.previewUnavailable') : this.active && !actual ? t('train.replayUnavailable') : ''}</p>
      ${replay && replay.truncated ? `<p class="academy-replay-notice">${t('train.replayTruncated')}</p>` : ''}</div><p class="academy-example-note">${t('train.exampleIllustration')}</p>`;
  },
  panelHTML(kind) {
    const m = this.last, lesson = m.lesson || (this.active ? {} : this.selected()) || {}, quiz = m.quiz || lesson.quiz || {};
    let title = m.title || lesson.title || t('train.title'), body = '', actions = '';
    const btn = (act, label, color = 'dark') => `<button class="b3 ${color} block" data-act="${act}" ${this.pendingAction && !['academy', 'exit', 'battle'].includes(act) ? 'disabled' : ''}>${label}</button>`;
    const repeat = t(this.active && this.active.mode !== 'course' ? 'train.repeatSet' : 'train.restartLesson');
    const guide = () => this.guideHTML(lesson, m);
    if (kind === 'loading' || kind === 'finishing') {
      title = kind === 'loading' ? t('train.loadingLesson') : t('train.finishPending'); body = `<p role="status">${title}</p>`; actions = btn('academy', t('academy.title'));
    }
    if (kind === 'intro' || kind === 'reference') {
      body = `${m.goal || lesson.goal ? `<p class="academy-goal">${this.esc(m.goal || lesson.goal)}</p>` : ''}
        ${kind === 'intro' ? this.guideHTML(lesson, m, true) : guide()}
        ${kind === 'intro' && m.stage === 'check' ? `<p class="academy-note">${t('train.checkIntro')}</p>` : ''}
        ${kind === 'intro' ? `<p class="academy-preview-status" data-demo-status role="status">${this.previewNotice ? t('train.previewUnavailable') : ''}</p>` : ''}
        ${kind === 'reference' ? this.previewHTML() + `<p class="academy-note">${t('train.referencePaused')}</p>` : ''}`;
      actions = kind === 'intro' ? btn('start', m.stage === 'check' ? t('train.startCheck') : t('academy.start'), 'green') +
        (this.checkLocked() ? '' : btn('example', t('academy.show'))) + btn('reference', t('train.reference')) + btn('academy', t('academy.menu')) : btn('reference-back', this.active ? t('train.returnLesson') : t('common.back'), 'green');
    }
    if (kind === 'question') {
      title = t('train.quizTitle');
      body = `<p class="academy-goal">${this.esc(quiz.prompt)}</p><div class="academy-answers">${(quiz.options || []).map((option) => `<button class="b3 dark block" data-answer="${this.esc(option.id)}" ${this.answerPending ? 'disabled' : ''}>${this.esc(option.text)}</button>`).join('')}</div><p class="academy-answer-status" role="status">${this.answerPending ? t('train.answerPending') : this.esc(m.msg || '')}</p>`;
      actions = btn('reference', t('train.reference')) + btn('academy', t('academy.title'));
    }
    if (kind === 'review') {
      title = t('train.reviewTitle');
      body = `<p class="academy-goal">${this.esc(m.msg || m.text || '')}</p>${!m.checkPassed ? this.feedbackHTML(m.feedback || m.latestFeedback) : ''}${this.previewHTML()}<details class="academy-details"><summary>${t('train.statistics')}</summary><dl class="academy-summary-stats">${this.metricsHTML(m.stats)}</dl></details>`;
      const failed = m.stage === 'check' && m.checkPassed === false;
      actions = (failed ? btn('retry', t('train.retryCheck'), 'green') + btn('continue', t('train.repeatPractice')) : btn('continue', t('train.continue'), 'green')) + btn('reference', t('train.reference')) + btn('restart', repeat) + btn('academy', t('academy.title'));
    }
    if (kind === 'feedback') {
      title = t('train.attemptReview');
      body = this.feedbackHTML(m.feedback || m.latestFeedback) + this.previewHTML();
      actions = (['ok', 'fail'].includes(m.phase) ? btn('retry', t('train.retry'), 'green') : btn('resume', t('train.returnLesson'), 'green')) + btn('reference', t('train.details')) + btn('menu', t('academy.menu'));
    }
    if (kind === 'pause' || kind === 'menu') {
      title = kind === 'pause' ? t('match.pause') : t('academy.menu');
      body = `<p>${t('train.pauseHint')}</p>${m.goal ? `<p class="academy-goal">${this.esc(m.goal)}</p>` : ''}${this.optionsHTML(true)}
        <details class="academy-details"><summary>${t('debug.title')}</summary><div class="academy-diagnostics">${btn('screenshot', t('debug.screenshot'))}${btn('diagnostics', t('debug.title'))}
          <button class="b3 dark sm" data-act="diag-mark" ${GameHost.debug ? '' : 'hidden'}>${t('debug.mark')}</button>${devBtn()}</div></details>`;
      actions = btn('resume', this.requiredPanel() ? t('train.returnLesson') : t('common.resume'), 'green') + btn('reference', t('train.reference')) + btn('restart', repeat);
      if ((m.feedback || m.latestFeedback) && !this.checkLocked()) actions += btn('feedback', t('train.attemptReview'));
      if (this.active.mode === 'course') actions += btn('skip', t('train.skipMenu'));
      actions += btn('academy', t('academy.title'));
    }
    if (kind === 'summary') {
      const s = this.summary, course = s.mode === 'course', set = !course && s.practiceSet;
      title = course ? (s.courseComplete ? t('train.courseComplete') : t('train.coursePartial')) : t('train.practiceComplete');
      body = `<p class="academy-goal">${course ? t('train.courseSummary', { mastered: Math.max(0, Number(s.mastered) || 0), total: Math.max(0, Number(s.total) || 0) }) : t('train.practiceSummary')}</p>
        ${course && !s.courseComplete ? `<p>${t('train.partialSummary')}</p>` : ''}`;
      if (set) {
        const rate = Math.round(set.successful / Math.max(1, set.attempted) * 100);
        const error = (Array.isArray(set.errors) ? set.errors : []).reduce((best, item) => !best || item.count > best.count ? item : best, null);
        body += `<dl class="academy-summary-stats academy-set-stats">${[[t('train.attempts'), `${set.attempted}/${set.size}`], [t('train.success'), set.successful], [t('train.successRate'), rate + '%'], [t('train.bestStreak'), set.bestStreak]].map(([label, value]) => `<div><dt>${label}</dt><dd class="num">${this.esc(value)}</dd></div>`).join('')}</dl>
          <p class="academy-correction"><small>${t('train.frequentCorrection')}</small>${this.esc(error ? error.correction : t('train.setClean'))}</p>`;
      } else body += `<dl class="academy-summary-stats">${this.metricsHTML(m.stats)}</dl>`;
      body += `${course && Number.isFinite(s.coverage) ? `<p class="academy-coverage"><b>${t('train.coverage')}</b><span class="num">${Math.round(clamp(s.coverage, 0, 100))}%</span></p>` : ''}
        ${course && s.rewarded ? `<p class="academy-reward">${Art.icon('coin')}${t('train.rewardGranted')}</p>` : ''}${this.previewHTML()}`;
      actions = (course ? btn('academy', t('academy.title'), 'green') + btn('restart', repeat) : btn('restart', repeat, 'green') + btn('academy', t('academy.title'))) + btn('reference', t('train.reference')) + btn('battle', t('train.toBattle'));
    }
    return `<header class="academy-dialog-head"><span class="cap">${this.active ? (m.stage === 'check' ? t('train.checkStage') : t('train.practiceStage')) : t('academy.title')}</span><h2 id="academy-dialog-title">${this.esc(title)}</h2></header>
      <div class="academy-dialog-scroll">${this.recoveryNotice ? `<p class="academy-recovery-notice" role="status">${t('train.recovery.' + this.recoveryKind)}</p>` : ''}${body}</div>
      <p class="academy-action-status" role="status">${this.pendingAction ? t('train.actionPending') : this.actionNotice ? t(this.actionNotice === 'rejected' ? 'train.actionRejected' : 'train.actionUnavailable') : ''}</p><footer class="academy-dialog-actions">${actions}</footer>`;
  },
  showPanel(kind, pause = true) {
    this.stopDemo();
    const top = this.overlay === kind ? this.dialog.querySelector('.academy-dialog-scroll')?.scrollTop || 0 : 0;
    if (!this.overlay) this.focusFrom = document.activeElement;
    this.overlay = kind;
    if (pause && this.active) GameHost.send('pause');
    this.dialog.innerHTML = this.panelHTML(kind); this.cover.hidden = false; this.cover.dataset.panel = kind;
    this.dialog.querySelector('.academy-dialog-scroll').scrollTop = top;
    this.menu.hidden = !!this.active; this.live.hidden = !this.active;
    this.menu.inert = true; this.live.inert = true;
    this.dialog.focus({ preventScroll: true });
  },
  closePanel() {
    this.stopDemo(); this.overlay = null; this.cover.hidden = true; this.dialog.innerHTML = ''; delete this.cover.dataset.panel;
    this.menu.inert = false; this.live.inert = false;
    if (this.alive && this.focusFrom && this.focusFrom.isConnected && this.focusFrom.focus) this.focusFrom.focus({ preventScroll: true });
    this.focusFrom = null;
  },
  reference() { if (this.overlay === 'reference') return; this.referenceBack = this.overlay || (this.active ? 'pause' : null); this.showPanel('reference'); },
  returnReference() {
    const back = this.referenceBack; this.referenceBack = null;
    if (this.summary) this.showPanel('summary');
    else if (back) this.showPanel(back, false);
    else if (this.requiredPanel()) this.showPanel(this.requiredPanel());
    else if (this.active) this.showPanel('pause', false);
    else this.closePanel();
  },
  pause() { if (this.active && !this.summary) this.showPanel('pause'); },
  resume() {
    if (this.requiredPanel()) this.showPanel(this.requiredPanel());
    else { GameHost.send('mute', { on: !S.sfx }); this.action('resume'); }
  },
  playDemo(source = 'example', realPace = true) {
    if (!this.canPreview(source)) return;
    this.stopDemo();
    const status = this.el.querySelector(this.overlay ? '.academy-dialog [data-demo-status]' : '.academy-selection [data-demo-status]');
    const item = this.active ? this.last.lesson || {} : this.selected(); if (!item) return;
    const options = { source, rate: realPace ? 1 : .25, play: !effectiveReducedMotion() };
    if (source === 'attempt') options.attemptId = this.last.attemptReplay.attemptId;
    else if (this.active ? this.active.mode === 'course' : this.mode === 'course') options.lessonId = this.last.id || item.id;
    else { options.technique = item.technique || this.active && this.active.stroke || item.id; options.strokeId = item.stroke; }
    this.previewBack = this.overlay; this.previewing = true;
    this.cover.hidden = this.menu.hidden = this.live.hidden = true;
    if (GameHost.openPreview(options)) this.previewRequestId = GameHost.previewRequestId;
    else {
      this.previewing = false; this.previewBack = null;
      this.cover.hidden = !this.overlay; this.previewNotice = 'unavailable';
      this.menu.hidden = !!this.active; this.live.hidden = !this.active; if (status) status.textContent = t('train.previewUnavailable');
    }
  },
  stopDemo() {
    if (this.previewing) { this.previewing = false; this.previewBack = null; this.previewRequestId = null; GameHost.closePreview(); }
  },
  refreshLocale() {
    if (!this.alive) return;
    I18n.localizeDOM(this.el, this.render());
    this.updateMenu(); if (this.active) this.updateLive(this.last);
    if (this.overlay && !this.previewing) {
      const scroll = this.dialog.querySelector('.academy-dialog-scroll'), top = scroll && scroll.scrollTop || 0;
      const focus = document.activeElement && document.activeElement.dataset;
      this.dialog.innerHTML = this.panelHTML(this.overlay);
      this.dialog.querySelector('.academy-dialog-scroll').scrollTop = top;
      const button = focus && (focus.act ? this.dialog.querySelector(`[data-act="${focus.act}"]`) : focus.answer ? this.dialog.querySelector(`[data-answer="${focus.answer}"]`) : null);
      if (button) button.focus({ preventScroll: true });
    }
  },
  cancel() {
    if (this.sessionId) this.retired.add(`${this.requestId}:${this.sessionId}`);
    this.active = null; this.requestId = null; this.sessionId = null; this.summary = null; this.pendingAction = null; this.answerPending = false; this.startOnIntro = false;
    this.closePanel(); GameHost.send('quit'); GameHost.show(false); TGX.guard(false);
  },
  toMenu() {
    if (Sheet.cur) Sheet.close(true);
    this.cancel(); this.last = {}; this.live.hidden = true; this.menu.hidden = false;
    GameHost.send('quiet', { on: true }); this.updateMenu();
    this.menu.querySelector(`[data-mode="${this.mode}"]`).focus({ preventScroll: true });
  },
  exit() { this.cancel(); Router.go('hub'); },
  onKeydown(e) {
    if (Sheet.cur) return;
    if (e.key === 'Escape') { e.preventDefault(); this.onBack(); return; }
    if (e.key !== 'Tab' || !this.overlay) return;
    const buttons = [...this.dialog.querySelectorAll('button:not(:disabled),summary,a[href],input,select,textarea,[tabindex="0"]')]
      .filter(button => !button.closest('[hidden],[inert]') && button.getClientRects().length && getComputedStyle(button).visibility !== 'hidden');
    if (!buttons.length) { e.preventDefault(); return; }
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === this.dialog)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || document.activeElement === this.dialog)) { e.preventDefault(); first.focus(); }
  },
  leave() {
    this.alive = false; this.off && this.off(); this.off = null;
    this.el.removeEventListener('click', this.click); this.el.removeEventListener('keydown', this.keydown); this.el.removeEventListener('pointerdown', this.pointerdown);
    this.cancel();
  },
  onBack() {
    if (this.previewing) { GameHost.closePreview(); return; }
    if (this.overlay === 'reference') { this.returnReference(); return; }
    if (this.active) this.toMenu(); else this.exit();
  }
});
