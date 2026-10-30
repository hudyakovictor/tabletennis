Router.def('train', {
  full: true, mood: 'battle', game: true,
  render() {
    return `<div class="academy">
      <div class="academy-menu">
        <header class="academy-head safe-top"><div><span class="cap">${t('academy.optional')}</span><h1 class="h-display">${t('academy.title')}</h1></div>
          <button class="ib" data-act="exit" aria-label="${t('common.exit')}">${Art.icon('x', { c: '#fff' })}</button></header>
        <div class="academy-scroll scroll">
          <p class="academy-intro">${t('academy.intro')}</p>
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
          <p class="tc-feedback" role="status" aria-live="polite"></p><p class="tc-result"></p>
        </section>
        <div class="academy-tools pe">
          <button class="ib academy-tool" data-act="pause" aria-label="${t('match.pause')}">${Art.icon('pause')}<span>${t('match.pause')}</span></button>
          <button class="ib academy-tool" data-act="reference">${Art.icon('target')}<span>${t('train.reference')}</span></button>
        </div>
        <div class="academy-session-tools pe">
          <button class="ib academy-tool" data-act="retry" hidden>${Art.icon('play')}<span>${t('train.retry')}</span></button>
          <button class="ib academy-tool" data-act="restart">${Art.icon('refresh')}<span>${t('train.restartLesson')}</span></button>
          <button class="ib academy-tool" data-act="academy">${Art.icon('home')}<span>${t('academy.title')}</span></button>
        </div>
        <div class="academy-debug pe">
          <button class="ib m-diag-open" data-act="diagnostics">${t('debug.title')}</button>
          <button class="ib m-diag-shot" data-act="diag-mark" ${GameHost.debug ? '' : 'hidden'} aria-label="${t('debug.mark')}"><span aria-hidden="true">&#9679;</span> ${t('debug.mark')}</button>
          ${devBtn()}
        </div>
      </div>
      <div class="academy-overlay" hidden><section class="pnl academy-dialog" role="dialog" aria-modal="true" aria-labelledby="academy-dialog-title" tabindex="-1"></section></div>
    </div>`;
  },
  mount(el) {
    this.el = el; this.alive = true; this.active = null; this.last = {}; this.summary = null; this.overlay = null; this.referenceBack = null;
    this.sessionId = null; this.retired = new Set(); this.phaseKey = ''; this.answerPending = false;
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
  updateMenu() {
    if (this.active) return;
    const sc = this.el.querySelector('.academy-scroll'), top = sc.scrollTop;
    this.el.querySelectorAll('[data-mode]').forEach((b) => { const on = b.dataset.mode === this.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    const host = this.el.querySelector('.academy-content'), C = this.catalog;
    if (!C) { host.innerHTML = `<p class="academy-loading" role="status">${t('academy.loading')}</p>`; return; }
    const selected = this.selected(); if (!selected) return;
    this.selection[this.mode] = selected.id;
    const progress = S.training && S.training.lessons || {}, mastered = C.lessons.filter((l) => progress[l.id] && progress[l.id].mastered).length;
    let body;
    if (this.mode === 'course') {
      const status = progress[selected.id] || {};
      body = `<div class="pnl academy-course-progress"><div><b>${t('academy.progress', { done: mastered, total: C.lessons.length })}</b><small>${t('academy.saved')}</small></div>
        <progress max="${Math.max(1, C.lessons.length)}" value="${mastered}" aria-label="${t('academy.course')}"></progress></div>
        <article class="pnl academy-selection"><span class="cap">${status.mastered ? t('academy.mastered') : S.training && S.training.lastLesson === selected.id ? t('academy.resume') : t('academy.course')}</span><h2>${this.esc(selected.title)}</h2><p>${this.esc(selected.goal)}</p>
          <div class="academy-actions"><button class="b3 green block" data-act="open">${Art.icon('play')}${t('academy.openLesson')}</button><button class="b3 dark sm block" data-act="guide">${t('academy.guide')}</button></div></article>
        <h2 class="h2 academy-section-title">${t('academy.chapters')}</h2><p class="academy-note">${t('academy.selectLesson')}</p>
        <div class="academy-chapters">${C.modules.map((module) => {
          const lessons = C.lessons.filter((l) => l.module === module.id), count = lessons.filter((l) => progress[l.id] && progress[l.id].mastered).length;
          return `<section class="pnl academy-chapter"><header><h3>${this.esc(module.title)}</h3><span class="num">${count}/${lessons.length}</span></header><p>${this.esc(module.description)}</p>
            <div class="academy-lessons">${lessons.map((lesson) => {
              const saved = progress[lesson.id] || {}, state = saved.mastered ? 'mastered' : saved.practiced ? 'practiced' : 'new';
              return `<button class="academy-lesson ${state} ${lesson.id === selected.id ? 'on' : ''}" data-choice="${this.esc(lesson.id)}" aria-pressed="${lesson.id === selected.id}">
                <span class="academy-lesson-number num">${C.lessons.indexOf(lesson) + 1}</span><span><b>${this.esc(lesson.title)}</b><small>${saved.mastered ? t('academy.mastered') : saved.practiced ? t('academy.practiced') : t('academy.notStarted')}</small></span>${Art.icon(saved.mastered ? 'check' : 'play')}</button>`;
            }).join('')}</div></section>`;
        }).join('')}</div>`;
    } else {
      const stroke = this.mode === 'stroke', items = stroke ? C.strokes : C.targets;
      body = `<p class="academy-note">${stroke ? t('academy.strokeIntro') : t('academy.accuracyIntro')}</p>
        <div class="academy-picks ${stroke ? 'strokes' : 'targets'}" role="group" aria-label="${stroke ? t('academy.selectStroke') : t('academy.selectTarget')}">
          ${items.map((item) => `<button class="academy-pick ${item.id === selected.id ? 'on' : ''}" data-choice="${this.esc(item.id)}" aria-pressed="${item.id === selected.id}">${stroke ? `<small>${this.esc(item.id)}</small>` : Art.icon('target')}<b>${this.esc(item.title)}</b></button>`).join('')}</div>
        <article class="pnl academy-selection"><span class="cap">${stroke ? t('academy.stroke') : t('academy.target')}</span><h2>${this.esc(selected.title)}</h2>
          <div class="academy-actions"><button class="b3 green block" data-act="open">${Art.icon('play')}${t('academy.openPractice')}</button></div>
          ${stroke ? this.guideHTML(selected) : `<p>${t('academy.accuracyIntro')}</p>`}</article>`;
    }
    host.innerHTML = body; sc.scrollTop = top;
  },
  guideHTML(lesson = {}, state = {}) {
    const feedback = state.feedback, example = feedback && this.catalog && this.catalog.strokes.find(s => s.id === feedback.expected.id);
    if (example && !(lesson.gesture && lesson.gesture.kind === 'tap')) lesson = { ...lesson, ...example };
    const controls = lesson.controls || {}, input = state.inputMode || this.inputMode;
    const fields = [[t('train.feature'), lesson.feature], [t('train.advantage'), lesson.advantage], [t('train.when'), lesson.when], [t('train.risk'), lesson.risk], [t('train.counter'), lesson.counter]];
    const accuracy = state.mode === 'accuracy' || feedback && feedback.code === 'outside';
    return `<div class="academy-guide">
      ${feedback ? `<p class="academy-correction">${this.esc(feedback.correction)}</p>` : ''}
      ${accuracy ? this.landingHTML(state.target, feedback && feedback.landing) : this.gestureHTML(feedback ? feedback.expected.gesture : lesson.gesture, input, feedback && feedback.actual.gesture)}
      ${accuracy ? '' : `<div class="academy-inputs">${[['touch', t('train.touchControls')], ['mouse', t('train.mouseControls')]].map(([mode, title]) =>
        `<div class="academy-input ${mode === input ? 'on' : ''}" data-input="${mode}"><b>${title}</b><p>${this.esc(lesson.brief && lesson.brief[mode] || '')}</p></div>`).join('')}</div>`}
      <details class="academy-details"><summary>${t('train.details')}</summary><div class="academy-guide-details">
        ${lesson.context ? `<p>${this.esc(lesson.context)}</p>` : ''}
        <section><h3>${t('train.controls')}</h3>${[['touch', t('train.touchControls')], ['mouse', t('train.mouseControls')]].map(([mode, title]) =>
          `<p><b>${title}:</b> ${this.esc(controls[mode] || '')}</p>`).join('')}</section>
        ${fields.filter(([, value]) => typeof value === 'string' && value).map(([label, value]) => `<section><h3>${label}</h3><p>${this.esc(value)}</p></section>`).join('')}
        ${this.diagramHTML(state.diagram, state)}</div></details></div>`;
  },
  refreshInput() {
    this.el.querySelectorAll('[data-input]').forEach((card) => card.classList.toggle('on', card.dataset.input === this.inputMode));
    this.el.querySelectorAll('.academy-gesture .academy-demo-ball').forEach((cursor) => cursor.setAttribute('r', this.inputMode === 'touch' ? 8 : 5));
  },
  gestureHTML(gesture, input, actual) {
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
    return `<figure class="academy-gesture ${played.length ? 'comparison' : ''}"><svg viewBox="0 0 300 184" role="img" aria-label="${this.esc(t('train.motionGuide'))}" data-demo-view="gesture" data-demo-duration="${Number(gesture.duration) || 750}">
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
      <p class="academy-correction">${this.esc(feedback.correction)}</p>
      ${comparison ? feedback.code === 'outside' ? this.landingHTML(feedback.target, feedback.landing) : this.gestureHTML(feedback.expected.gesture, this.inputMode, feedback.actual.gesture) : ''}
      ${neutral ? '' : `<div class="academy-checks">${[[feedback.contact, t('train.contact')], [feedback.legal, t('train.legal')], [feedback.code === 'counted', t('train.objective')]].map(([ok, label]) => `<span class="${ok ? 'ok' : 'miss'}">${Art.icon(ok ? 'check' : 'x')}${label}</span>`).join('')}</div>`}
      ${comparison && feedback.contact ? `<p class="academy-attempt-name">${t('train.playedStroke')}: <b>${this.esc(feedback.actual.title)}</b></p>` : ''}</div>`;
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
    if (b.dataset.mode) { this.mode = b.dataset.mode; this.updateMenu(); return; }
    if (b.dataset.choice) { this.selection[this.mode] = b.dataset.choice; if (this.mode === 'course') this.openSession(); else this.updateMenu(); return; }
    if (b.dataset.answer) {
      if (this.answerPending || this.last.phase !== 'question') return;
      this.answerPending = true;
      this.dialog.querySelectorAll('[data-answer]').forEach((button) => { button.disabled = true; });
      this.dialog.querySelector('.academy-answer-status').textContent = t('train.answerPending');
      GameHost.send('pause'); GameHost.send('trainAction', { action: 'answer', answer: b.dataset.answer }); return;
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
      // A pause dialog stays underneath diagnostics. Closing or replacing a
      // sheet never implicitly restarts the feeder.
      if (this.active && !this.overlay) this.pause();
      GameHost.send('pause');
      if (act === 'dev') devZoneSheet(); else diagnosticsSheet({ focusScreenshot: act === 'screenshot' });
    }
  },
  openSession() {
    const item = this.selected(); if (!item) return;
    const data = { mode: this.mode, progress: S.training };
    if (this.mode === 'course') data.lessonId = item.id;
    if (this.mode === 'stroke') data.stroke = item.id;
    if (this.mode === 'accuracy') data.target = item.id;
    this.active = data; this.last = {}; this.summary = null; this.sessionId = null; this.phaseKey = ''; this.awaitingIntro = true;
    this.closePanel(); this.menu.hidden = true; this.live.hidden = false; TGX.guard(true);
    GameHost.show(true); GameHost.send('mute', { on: !S.sfx }); GameHost.send('quiet', { on: false });
    this.showPanel('loading', false); GameHost.send('train', data);
  },
  action(action) {
    if (!this.active || this.summary) return;
    this.closePanel(); GameHost.send('trainAction', { action }); GameHost.send('resume');
  },
  restart() {
    if (!this.active) return;
    this.summary = null; this.phaseKey = ''; this.answerPending = false; this.awaitingIntro = true;
    this.closePanel(); this.showPanel('loading'); GameHost.send('trainAction', { action: 'restart' });
  },
  onMsg(m) {
    if (!this.alive) return;
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
      this.summary = m; this.showPanel('summary'); return;
    }
    if (m.type !== 'train' || this.summary || m.mode !== this.active.mode || this.retired.has(m.sessionId)) return;
    if (this.sessionId && m.sessionId !== this.sessionId && !(this.awaitingIntro && m.phase === 'intro')) return;
    if (this.awaitingIntro && m.phase !== 'intro') return;
    this.sessionId = m.sessionId; this.awaitingIntro = false;
    if (m.inputMode === 'mouse' || m.inputMode === 'touch') { this.inputMode = m.inputMode; this.refreshInput(); }
    this.last = m;
    if (m.mode === 'course' && m.lesson) this.selection.course = m.lesson.id;
    this.updateLive(m);
    const panel = this.requiredPanel(), quiz = m.quiz || {};
    const key = [m.sessionId, m.id, m.stage, m.phase, quiz.prompt, quiz.explanation, m.phase === 'review' || m.phase === 'question' ? m.msg : ''].join('|');
    if (key !== this.phaseKey || this.answerPending && m.phase === 'question') {
      this.phaseKey = key; this.answerPending = false;
      if (panel && this.overlay !== 'reference' && this.overlay !== 'pause') this.showPanel(panel);
    }
  },
  updateLive(m) {
    const q = (selector) => this.live.querySelector(selector), stats = m.stats || {};
    q('.tc-step').textContent = m.mode === 'course' && Number.isFinite(m.step) ? `${m.step + 1}/${m.total}` : '';
    q('.tc-title').textContent = m.title || (m.lesson && m.lesson.title) || t('train.title');
    q('.tc-stage').textContent = m.stage === 'check' ? t('train.checkStage') : t('train.practiceStage');
    q('.tc-text').textContent = m.goal || '';
    const need = Math.max(1, Number(m.need) || 1), done = Math.max(0, Number(m.done) || 0);
    const attempts = Math.max(0, Number(m.attempts) || 0);
    q('.tc-progress').hidden = m.mode !== 'course'; q('.tc-progress').max = need;
    q('.tc-progress').value = Math.min(m.stage === 'check' ? attempts : done, need);
    q('.tc-count').textContent = m.mode !== 'course' ? t('train.practiceCount', { n: done }) : m.stage === 'check' ? t('train.checkProgress', { done, attempts, total: need }) : t('train.sessionProgress', { done, need });
    this.live.querySelectorAll('[data-stat]').forEach((value) => { value.textContent = value.dataset.stat === 'rate' ? Math.round((stats.success || 0) / Math.max(1, stats.attempts || 0) * 100) + '%' : fmt(Math.max(0, Number(stats[value.dataset.stat]) || 0)); });
    const feedback = q('.tc-feedback'); feedback.className = 'tc-feedback ' + (m.phase === 'ok' ? 'ok' : m.phase === 'fail' ? 'fail' : '');
    feedback.textContent = m.feedback && m.feedback.title || m.msg || m.text || '';
    q('.tc-result').textContent = m.feedback && m.phase === 'fail' ? m.feedback.correction : '';
    q('[data-act=retry]').hidden = m.phase !== 'fail';
  },
  requiredPanel() {
    if (this.last.phase === 'fail' && this.last.stage !== 'check') return 'feedback';
    return { intro: 'intro', question: 'question', review: 'review', done: 'finishing' }[this.last.phase] || null;
  },
  panelHTML(kind) {
    const m = this.last, lesson = m.lesson || (this.active ? {} : this.selected()) || {}, quiz = m.quiz || lesson.quiz || {};
    let title = m.title || lesson.title || t('train.title'), body = '', actions = '';
    const btn = (act, label, color = 'dark') => `<button class="b3 ${color} block" data-act="${act}">${label}</button>`;
    const guide = () => this.guideHTML(lesson, m);
    const demo = () => lesson.gesture && m.mode !== 'accuracy' ? `<div class="academy-demo-controls"><button class="b3 dark sm" data-act="demo">${Art.icon('refresh')}${t('train.showMotion')}</button><button class="b3 dark sm" data-act="demo-live">${t('train.realPace')}</button><p data-demo-status role="status"></p></div>` : '';
    if (kind === 'loading' || kind === 'finishing') {
      title = kind === 'loading' ? t('train.loadingLesson') : t('train.finishPending'); body = `<p role="status">${title}</p>`; actions = btn('academy', t('academy.title'));
    }
    if (kind === 'intro' || kind === 'reference') {
      body = `${m.goal || lesson.goal ? `<p class="academy-goal">${this.esc(m.goal || lesson.goal)}</p>` : ''}
        ${guide()}${demo()}
        ${kind === 'intro' ? `<p class="academy-note">${m.stage === 'check' ? t('train.checkIntro') : t('train.practiceIntro')}</p>` : ''}`;
      actions = kind === 'intro' ? btn('start', m.stage === 'check' ? t('train.startCheck') : t('train.startPractice'), 'green') + btn('academy', t('academy.title')) + (this.active.mode === 'course' ? btn('skip', t('train.skipMenu')) : '') : btn('reference-back', this.active ? t('train.returnLesson') : t('common.back'), 'green');
    }
    if (kind === 'question') {
      title = t('train.quizTitle');
      body = `<p class="academy-goal">${this.esc(quiz.prompt)}</p><div class="academy-answers">${(quiz.options || []).map((option) => `<button class="b3 dark block" data-answer="${this.esc(option.id)}" ${this.answerPending ? 'disabled' : ''}>${this.esc(option.text)}</button>`).join('')}</div><p class="academy-answer-status" role="status">${this.answerPending ? t('train.answerPending') : this.esc(m.msg || '')}</p>`;
      actions = btn('reference', t('train.reference')) + btn('academy', t('academy.title'));
    }
    if (kind === 'review') {
      title = t('train.reviewTitle');
      body = `<p class="academy-goal">${this.esc(m.msg || m.text || '')}</p>${!m.checkPassed && m.feedback ? this.feedbackHTML(m.feedback) : ''}<details class="academy-details"><summary>${t('train.statistics')}</summary><dl class="academy-summary-stats">${this.metricsHTML(m.stats)}</dl></details>`;
      const failed = m.stage === 'check' && m.checkPassed === false;
      actions = (failed ? btn('retry', t('train.retryCheck'), 'green') + btn('continue', t('train.repeatPractice')) : btn('continue', t('train.continue'), 'green')) + btn('reference', t('train.reference')) + btn('restart', t('train.restartLesson')) + btn('academy', t('academy.title'));
    }
    if (kind === 'feedback') {
      title = m.feedback && m.feedback.title || m.msg || t('train.tryAgain');
      body = this.feedbackHTML(m.feedback) + demo();
      actions = btn('retry', t('train.retry'), 'green') + btn('reference', t('train.details')) + btn('academy', t('academy.title'));
    }
    if (kind === 'pause') {
      title = t('match.pause'); body = `<p>${t('train.pauseHint')}</p>${m.goal ? `<p class="academy-goal">${this.esc(m.goal)}</p>` : ''}`;
      actions = btn('resume', t('common.resume'), 'green') + btn('reference', t('train.reference')) + btn('restart', t('train.restartLesson')) + btn('screenshot', t('debug.screenshot')) + btn('diagnostics', t('debug.title'));
      if (this.active.mode === 'course') actions += `<p class="academy-note">${t('train.skipNote')}</p>` + btn('skip', t('train.skipMenu'));
      actions += btn('academy', t('academy.title'));
    }
    if (kind === 'summary') {
      const s = this.summary, course = s.mode === 'course';
      title = course ? (s.courseComplete ? t('train.courseComplete') : t('train.coursePartial')) : t('train.practiceComplete');
      body = `<p class="academy-goal">${course ? t('train.courseSummary', { mastered: Math.max(0, Number(s.mastered) || 0), total: Math.max(0, Number(s.total) || 0) }) : t('train.practiceSummary')}</p>
        ${course && !s.courseComplete ? `<p>${t('train.partialSummary')}</p>` : ''}<dl class="academy-summary-stats">${this.metricsHTML(m.stats)}</dl>
        ${Number.isFinite(s.coverage) ? `<p class="academy-coverage"><b>${t('train.coverage')}</b><span class="num">${Math.round(clamp(s.coverage, 0, 100))}%</span></p>` : ''}
        ${s.rewarded ? `<p class="academy-reward">${Art.icon('coin')}${t('train.rewardGranted')}</p>` : ''}`;
      actions = btn('academy', t('academy.title'), 'green') + btn('reference', t('train.reference')) + btn('restart', t('train.restartLesson')) + btn('battle', t('train.toBattle'));
    }
    return `<header class="academy-dialog-head"><span class="cap">${this.active ? (m.stage === 'check' ? t('train.checkStage') : t('train.practiceStage')) : t('academy.title')}</span><h2 id="academy-dialog-title">${this.esc(title)}</h2></header>
      <div class="academy-dialog-scroll">${body}</div><footer class="academy-dialog-actions">${actions}</footer>`;
  },
  showPanel(kind, pause = true) {
    this.stopDemo();
    if (!this.overlay) this.focusFrom = document.activeElement;
    this.overlay = kind;
    if (pause && this.active) GameHost.send('pause');
    this.dialog.innerHTML = this.panelHTML(kind); this.cover.hidden = false;
    this.menu.inert = true; this.live.inert = true;
    this.dialog.focus({ preventScroll: true });
    if (['intro', 'feedback', 'reference'].includes(kind)) this.playDemo();
  },
  closePanel() {
    this.stopDemo(); this.overlay = null; this.cover.hidden = true; this.dialog.innerHTML = '';
    this.menu.inert = false; this.live.inert = false;
    if (this.alive && this.focusFrom && this.focusFrom.isConnected && this.focusFrom.focus) this.focusFrom.focus({ preventScroll: true });
    this.focusFrom = null;
  },
  reference() { this.referenceBack = this.overlay; this.showPanel('reference'); },
  returnReference() {
    const back = this.referenceBack; this.referenceBack = null;
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
    const status = this.dialog.querySelector('[data-demo-status]'); if (!status) return;
    const views = [...this.dialog.querySelectorAll('svg[data-demo-view]')].map((svg) => ({
      ball: svg.querySelector('.academy-demo-ball'),
      duration: svg.dataset.demoView === 'gesture' ? realPace ? Number(svg.dataset.demoDuration) || 180 : Math.max(900, (Number(svg.dataset.demoDuration) || 180) * 6) : 2400,
      paths: ['incoming', 'recommended', 'gesture'].map((leg) => svg.querySelector(`[data-demo-leg="${leg}"]`)).filter(Boolean)
    })).filter((view) => view.ball && view.paths.length && !view.ball.closest('details:not([open])') && view.ball.closest('svg').getBoundingClientRect().height > 0);
    if (!views.length) return;
    const position = (view, progress) => {
      progress = Math.max(0, Math.min(1, progress));
      const part = Math.min(view.paths.length - 1, Math.floor(progress * view.paths.length)), path = view.paths[part];
      const p = path.getPointAtLength(path.getTotalLength() * Math.min(1, progress * view.paths.length - part));
      view.ball.setAttribute('cx', p.x); view.ball.setAttribute('cy', p.y); view.ball.style.opacity = '1';
    };
    const reduced = () => S.rm || (this.motionQuery && this.motionQuery.matches);
    if (reduced()) { views.forEach((view) => position(view, 1)); status.textContent = t('train.demoReduced'); return; }
    status.textContent = t(realPace ? 'train.demoLive' : 'train.demoSlow'); const start = performance.now(), duration = Math.max(...views.map((view) => view.duration));
    const frame = (now) => {
      if (!this.alive || !this.overlay || !status.isConnected) { this.demoRAF = null; return; }
      const progress = reduced() ? 1 : Math.min(1, (now - start) / duration);
      views.forEach((view) => position(view, reduced() ? 1 : Math.min(1, (now - start) / view.duration)));
      if (progress < 1) this.demoRAF = requestAnimationFrame(frame);
      else { this.demoRAF = null; status.textContent = reduced() ? t('train.demoReduced') : t('train.demoFinished'); }
    };
    this.demoRAF = requestAnimationFrame(frame);
  },
  stopDemo() { if (this.demoRAF != null) cancelAnimationFrame(this.demoRAF); this.demoRAF = null; },
  cancel() {
    if (this.sessionId) this.retired.add(this.sessionId);
    this.active = null; this.sessionId = null; this.summary = null;
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
    const buttons = [...this.dialog.querySelectorAll('button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]')];
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
  onBack() { if (this.active) this.toMenu(); else this.exit(); }
});
