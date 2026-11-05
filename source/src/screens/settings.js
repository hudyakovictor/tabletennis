const MISS_SHOT_SIZES = [350, 300, 400, 100, 20];
const settingsText = (ru, en) => I18n.lang === 'ru' ? ru : en;
function calibrationLabel(entry, value) {
  if (!Number.isFinite(value)) return settingsText('Ожидание', 'Pending');
  const number = value.toFixed(Number.isInteger(entry.precision) ? Math.max(0, Math.min(3, entry.precision)) : 2);
  const unit = { deg: '°', ms: settingsText(' мс', ' ms'), 'm/s': settingsText(' м/с', ' m/s'), x: 'x', '%': '%' }[entry.unit] || '';
  return number + unit;
}
function refreshSettingsCalibration(w, message) {
  const list = w.querySelector('[data-cal-list]'), summary = w.querySelector('[data-cal-summary]'), reset = w.querySelector('[data-a=calReset]');
  const visible = new Set(['camHeight', 'camZoom', 'camSway', 'fingerTrail', 'ballSize', 'trailLen', 'tableGlow', 'hintRadius', 'hintGlow']);
  const registry = GameHost.calibrationRegistry.filter(entry => visible.has(entry.key)), state = GameHost.calibration;
  const ready = GameHost.ready && GameHost.calibrationReady && registry.length && state;
  reset.disabled = !ready;
  summary.textContent = registry.length ? t('set.calibOpen', { n: registry.length }) : settingsText('Калибровка ждёт движок', 'Calibration awaits the engine');
  const motion = w.querySelector('[data-motion-state]');
  motion.textContent = effectiveReducedMotion() ? settingsText('Меньше движения: распоряжение ОС или твоя настройка.', 'Reduced motion: ordered by your OS or your setting.') : '';
  const hint = w.querySelector('[data-hint-state]');
  hint.textContent = ready && state.hint && !state.hint.allowed ? settingsText('Матч живёт по регламенту. Твоя настройка помощи сохранена.', 'The match follows regulation. Your guidance setting is saved.') : '';
  if (!ready) {
    list.replaceChildren(); delete list.dataset.keys;
    const waiting = document.createElement('p'); waiting.className = 'dim'; waiting.setAttribute('role', 'status');
    waiting.textContent = settingsText('Движок ещё не подписал значения. Ждём подтверждения настроек.', 'Values await the engine signature. Waiting for settings confirmation.');
    list.appendChild(waiting); return;
  }
  if (list.dataset.keys !== registry.map(entry => entry.key).join('|')) {
    list.replaceChildren(); let group = '';
    for (const entry of registry) {
      if (entry.group !== group) {
        group = entry.group; const head = document.createElement('div'); head.className = 'cal-grp'; head.textContent = t('cal.g.' + group); list.appendChild(head);
      }
      const row = document.createElement('div'); row.className = 'calrow'; row.dataset.calrow = entry.key;
      row.innerHTML = '<div class="cal-t"><b></b><small data-cal-description></small><small data-cal-effective></small></div><div class="cal-c"><input type="range"><span class="cal-v num"></span></div>';
      row.querySelector('b').textContent = settingsText(entry.labelRu, entry.labelEn);
      row.querySelector('[data-cal-description]').textContent = settingsText(entry.descriptionRu, entry.descriptionEn);
      const input = row.querySelector('input'); input.min = entry.min; input.max = entry.max; input.step = entry.step; input.dataset.cal = entry.key;
      input.setAttribute('aria-label', settingsText(entry.labelRu, entry.labelEn));
      row.querySelector('.cal-v').style.whiteSpace = 'nowrap'; list.appendChild(row);
    }
    list.dataset.keys = registry.map(entry => entry.key).join('|');
  }
  for (const entry of registry) {
    const row = list.querySelector(`[data-calrow="${entry.key}"]`), input = row.querySelector('input'), note = row.querySelector('[data-cal-effective]');
    if (message && Number.isFinite(message.requestId) && message.requestId === GameHost.calibrationRequestId && +input.dataset.pending <= message.requestId) delete input.dataset.pending;
    const wanted = S.cal && S.cal[entry.key];
    const pending = !!input.dataset.pending || GameHost.calibrationRequestId > GameHost.calibrationAckId && Number.isFinite(wanted) && Math.abs(wanted - state.raw[entry.key]) > 1e-9;
    if (!input.dataset.pending) input.value = pending ? wanted : state.raw[entry.key];
    const reason = state.restrictions && state.restrictions[entry.key];
    input.disabled = reason === 'competitive';
    const requested = calibrationLabel(entry, state.values.requested[entry.key]), effective = calibrationLabel(entry, state.values.effective[entry.key]);
    row.querySelector('.cal-v').textContent = reason === 'competitive' && entry.competitiveLocked ? effective : requested;
    let text = '';
    if (pending) text = settingsText('Сохранено. Движок ещё согласовывает.', 'Saved. Engine approval pending.');
    else if (reason === 'competitive') text = entry.competitiveLocked
      ? settingsText(`По регламенту: ${effective}. Твои ${requested} сохранены.`, `Regulation value: ${effective}. Your ${requested} is saved.`)
      : entry.scope === 'inspector' ? settingsText(`Инспектор сюда не допущен. Сохранено ${requested}.`, `Inspector not admitted in this mode. ${requested} is saved.`)
        : settingsText(`Учебные подсказки сюда не допущены. Сохранено ${requested}.`, `Training hints not admitted in this mode. ${requested} is saved.`);
    else if (reason === 'training-only') text = settingsText('Только для обучения. Настройка сохранена, в матче не действует.', 'Training only. Setting saved, inactive in matches.');
    else if (reason === 'hint-off') text = settingsText('Подсказки выключены. Настройка осталась в памяти.', 'Hints off. The setting remains on file.');
    else if (reason === 'inspector-off') text = settingsText('Инспектор ждёт вызова. Включи отдельной кнопкой в игре.', 'Inspector on standby. Enable it with the in-game button.');
    else if (reason === 'reduced-motion') text = settingsText('Меньше движения: эффект выключен. Настройка сохранена.', 'Reduced motion: effect disabled. Setting saved.');
    else if (reason === 'trail-off') text = settingsText('Шлейф выключен. Мяч летит без подписи.', 'Trail off. The ball flies unsigned.');
    else if (requested !== effective) text = settingsText(`Действует: ${effective}. Сохранено: ${requested}.`, `Active: ${effective}. Saved: ${requested}.`);
    note.textContent = text; note.hidden = !text;
    input.setAttribute('aria-valuetext', text ? `${requested}. ${text}` : effective);
  }
}

/* The original gallery uses ttu-miss-shots. Display legacy and new records
 * with DOM text setters rather than interpreting stored data as markup. */
function missShotTime(ts) {
  const date = new Date(ts);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(I18n.lang) : '—';
}
function missShotSummary(s) {
  const kind = s.training ? t('miss.kind.training') : t(s.kind === 'serve' ? 'miss.kind.serve' : 'miss.kind.rally');
  const outcome = s.status === 'pending' ? t('miss.pending') : t('miss.noContact');
  const admit = typeof s.accepted === 'boolean' ? t(s.accepted ? 'miss.accepted' : 'miss.rejected') : '';
  const reason = s.reason || s.zoneReason;
  const reasonLabel = reason && /^POINT_/.test(reason) ? t('miss.pointEvent', { reason }) : reason ? t('miss.firstReason', { reason }) : '';
  return [kind, outcome, admit, reasonLabel,
    Number.isFinite(s.dx) && Number.isFinite(s.dy) ? `dx ${s.dx} px · dy ${s.dy} px` : '', missShotTime(s.t)].filter(Boolean).join(' · ');
}
function zoomMissShot(w, s, previousFocus) {
  if (!s) return;
  const ov = document.createElement('div'); ov.className = 'miss-zoom'; ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', t('set.missesTitle'));
  ov.innerHTML = `<div class="miss-zoom-body"><img alt="${t('set.missesTitle')}"><div class="mz-meta"></div>
    <p class="mz-legend">${t('set.missesZoom')}</p><a class="b3 green block" data-miss-download download>${t('set.missesDownload')}</a>
    <p class="mz-legend">${t('set.missesDownloadHint')}</p><button class="b3 dark block" data-miss-close>${t('set.missesClose')}</button></div>`;
  const url = 'data:image/jpeg;base64,' + s.img;
  ov.querySelector('img').src = url;
  ov.querySelector('.mz-meta').textContent = missShotSummary(s);
  const link = ov.querySelector('[data-miss-download]'); link.href = url;
  link.download = 'topspin-miss-' + (Number.isFinite(+s.t) ? +s.t : Date.now()) + '.jpg';
  const close = () => { ov.remove(); if (previousFocus && previousFocus.isConnected) previousFocus.focus({ preventScroll: true }); };
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-miss-close]')) close(); });
  ov.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  w.appendChild(ov); ov.querySelector('[data-miss-close]').focus({ preventScroll: true });
}

function openSettings() {
  // Дефолт — только для нового сейва: раньше эта строка включала галерею
  // обратно при каждом открытии настроек, и выключить её было невозможно.
  if (S.missShots === undefined) S.missShots = false;
  S.missShotHalf = MISS_SHOT_SIZES.includes(+S.missShotHalf) ? +S.missShotHalf : 350;
  const row = (k, title, i, d, value = S[k]) => `<div class="srow"><span class="si">${Art.icon(i, { c: '#9BE8FF' })}</span><span class="st"><b>${title}</b><small>${d}</small></span><button class="tgl ${value ? 'on' : ''}" data-k="${k}" aria-label="${title}" aria-pressed="${!!value}"></button></div>`;
  S.cal = repairCalibrationPreferences(S.cal);
  const levels = repairAudioLevels(S.audioLevels, S.volume);
  const audioRows = [['master', 'Общая громкость', 'Master volume'], ['effects', 'Эффекты и интерфейс', 'Effects and interface'],
    ['music', 'Музыка', 'Music'], ['ambient', 'Окружение', 'Ambient']].map(([key, ru, en]) => {
    const value = levels[key] * 100, label = settingsText(ru, en);
    return `<div class="calrow"><div class="cal-t"><b>${label}</b></div><div class="cal-c"><input type="range" min="0" max="100" step="any" value="${value}" data-audio="${key}" aria-label="${label}"><span class="cal-v num" data-audiov="${key}">${+value.toFixed(1)}%</span></div></div>`;
  }).join('');
  if (!GameHost.frame) GameHost.ensure();
  Sheet.open(`<div class="h1" style="margin:4px 4px 14px">${t('set.title')}</div>
    <div class="settings-diff">
      <div class="settings-diff-head"><b>${t('set.diff')}</b><small>${t('set.diffHint')}</small></div>
      <div class="seg" id="dseg" role="group" aria-label="${t('set.diff')}"><span class="pill"></span>${DIFFS.map((d) => `<button data-v="${d.id}" class="${S.diff === d.id ? 'on' : ''}">${t(d.tk)}</button>`).join('')}</div>
      <div class="settings-diff-info" id="diffDescription">${t(diffOf(S.diff).sk)}</div>
    </div>
    <div class="pnl sgroup">${row('sfx', t('set.sfx'), 'sound', t('set.sfxD'))}${row('vibro', t('set.vibro'), 'vibe', t('set.vibroD'))}${row('hint', t('set.hint'), 'target', settingsText('Маркеры и ранний сигнал мяча. В соревновании помощь выдаётся по регламенту.', 'Markers and early ball cues. Competition rations guidance by regulation.'))}${row('rm', t('set.rm'), 'motion', t('set.rmD'))}</div>
    <p class="dim" data-motion-state style="font-size:11px;margin:6px 4px"></p><p class="dim" data-hint-state style="font-size:11px;margin:6px 4px"></p>
    <div class="cap" style="margin:18px 4px 8px">${settingsText('Уровни звука', 'Audio levels')}</div>
    <div class="pnl calib"><div class="cal-list" style="padding-top:14px" data-audio-list>${audioRows}<p class="dim" data-audio-state style="font-size:11px;margin:0"></p></div></div>
    <div class="cap" style="margin:18px 4px 8px">${t('set.quality')}</div>
    <div class="seg" id="qseg"><span class="pill"></span>${['high', 'mid', 'low'].map((q) => `<button data-v="${q}" class="${S.quality === q ? 'on' : ''}">${{ high: t('quality.high'), mid: t('quality.mid'), low: t('quality.low') }[q]}</button>`).join('')}</div>
    <div class="cap" style="margin:18px 4px 8px">${t('set.language')}</div>
    <div class="seg" id="langseg"><span class="pill"></span>${I18n.LANGS.map((L) => `<button data-v="${L.id}" class="${I18n.lang === L.id ? 'on' : ''}">${L.name}</button>`).join('')}</div>
    <div class="pnl sgroup" style="margin-top:10px"><div class="srow"><span class="si">${Art.icon('expand', { c: '#9BE8FF' })}</span><span class="st"><b>${t('set.fullscreen')}</b><small>${t('set.fullscreenD')}</small></span><button class="b3 dark sm" data-a="fs" style="margin-left:auto">${t('set.fullscreenBtn')}</button></div></div>
    <div class="cap" style="margin:18px 4px 8px">${t('set.calib')} <small class="dim" style="text-transform:none;font-weight:400;font-size:11px">${t('set.calibHint')}</small></div>
    <details class="pnl calib" data-calibration><summary class="cal-sum">${Art.icon('target', { c: '#9BE8FF' })} <span data-cal-summary></span></summary><div class="cal-list" data-cal-list></div><div class="cal-foot"><button class="b3 dark sm block" data-a="calReset" disabled>${t('set.calibReset')}</button></div></details>
    <div class="cap" style="margin:18px 4px 8px">${t('set.missesTitle')} <small class="dim" style="text-transform:none;font-weight:400;font-size:11px">${t('set.missesHint')}</small></div>
    <div class="pnl sgroup miss-gallery">
      ${row('debug', settingsText('Диагностическая запись', 'Diagnostic recording'), 'target', settingsText('Улики для разбора остаются на устройстве. По умолчанию запись выключена.', 'Evidence for review stays on this device. Recording is off by default.'), GameHost.debug)}
      ${row('missShots', t('set.missesSave'), 'target', t('set.missesSaveD'))}
      <div class="srow"><span class="st"><b>${t('set.missesSize')}</b></span>
        <select data-miss-size aria-label="${t('set.missesSize')}">${MISS_SHOT_SIZES.map(n => `<option value="${n}" ${S.missShotHalf === n ? 'selected' : ''}>${t('set.missesSize' + n)}</option>`).join('')}</select></div>
      <div class="srow"><span class="st"><b>${t('set.missesStat')}</b><small data-miss-stat></small></span></div>
      <p class="miss-note" data-miss-storage role="status"></p>
      <p class="miss-note miss-error" data-miss-error role="alert" hidden></p>
      <div class="miss-grid" aria-label="${t('set.missesTitle')}"></div>
      <div class="miss-actions"><button class="b3 dark sm" data-a="missClear">${t('set.missesClearShots')}</button></div>
    </div>
    <p class="dim" style="font-size:11.5px;margin:14px 4px 0;line-height:1.5">${t('set.version', { v: '2.0.0' })}</p>`, {
    onOpen: (w) => {
      let displayedShots = [], clearTimer = 0;
      const refreshAudio = () => {
        const values = repairAudioLevels(S.audioLevels, S.volume);
        w.querySelector('[data-audio-state]').textContent = S.sfx === false ? settingsText('Звук выключен. Уровни не пострадали.', 'Muted. Your levels survived.')
          : values.master === 0 ? settingsText('Общая громкость 0%. Тишина в полном составе.', 'Master volume 0%. Silence at full strength.')
          : values.effects === 0 ? settingsText('Эффекты и интерфейс выключены (0%). Без звуковых свидетелей.', 'Effects and interface sounds off (0%). No audible witnesses.') : '';
      };
      refreshAudio(); refreshSettingsCalibration(w);
      const off = GameHost.on(message => {
        if (['ready', 'calibrationPending', 'calibration', 'settings', 'slowmo', 'motionPreference', 'cameraCalibration'].includes(message.type)) refreshSettingsCalibration(w, message);
      });
      const refreshMisses = () => {
        const shots = displayedShots = MissShots.all(), grid = w.querySelector('.miss-grid');
        w.querySelector('[data-miss-stat]').textContent = t('set.missesStatD', { n: shots.length });
        w.querySelector('[data-miss-storage]').textContent = t(MissShots.storage === 'memory' ? 'set.missesMemory' : 'set.missesStorage');
        const error = w.querySelector('[data-miss-error]'); error.hidden = !MissShots.captureError;
        error.textContent = MissShots.captureError ? t('set.missesCaptureError', { error: MissShots.captureError }) : '';
        grid.replaceChildren();
        if (!shots.length) {
          const empty = document.createElement('p'); empty.className = 'miss-empty'; empty.textContent = t('set.missesEmpty'); grid.appendChild(empty);
        } else shots.map((s, i) => ({ s, i })).reverse().forEach(({ s, i }) => {
          // The legacy gallery reused numeric ids after iframe reloads. Use
          // the displayed index so old duplicate ids still open independently.
          const button = document.createElement('button'); button.type = 'button'; button.className = 'miss-thumb'; button.dataset.shotIndex = String(i);
          button.setAttribute('aria-label', missShotSummary(s));
          const img = document.createElement('img'); img.src = 'data:image/jpeg;base64,' + s.img; img.alt = '';
          const meta = document.createElement('small'); meta.textContent = s.status === 'pending' ? t('miss.pending') : t('miss.noContact');
          button.append(img, meta); grid.appendChild(button);
        });
      };
      refreshMisses();
      w.addEventListener('click', (e) => {
        const calReset = e.target.closest('[data-a=calReset]');
        if (calReset) {
          if (!GameHost.ready || !GameHost.calibrationReady) return;
          S.cal = Object.fromEntries(GameHost.calibrationRegistry.map(entry => [entry.key, entry.default]));
          GameHost.send('cal', { values: S.cal });
          w.querySelectorAll('input[data-cal]').forEach(input => { input.value = S.cal[input.dataset.cal]; input.dataset.pending = String(GameHost.calibrationRequestId); });
          refreshSettingsCalibration(w);
          save(); haptic('select'); Sfx.soft(); toast(t('set.calibResetDone'), 'target');
          return;
        }
        const thumb = e.target.closest('.miss-thumb');
        if (thumb) { zoomMissShot(w, displayedShots[+thumb.dataset.shotIndex], thumb); return; }
        const row = e.target.closest('.srow'); const toggle = e.target.closest('.tgl') || (row && row.querySelector('.tgl')); if (!toggle) return;
        const k = toggle.dataset.k;
        const value = k === 'debug' ? GameHost.setDebug(!GameHost.debug) : (S[k] = !S[k]);
        if (k !== 'debug') { save(); GameHost.syncSettings(); }
        toggle.classList.toggle('on', value); toggle.setAttribute('aria-pressed', String(!!value));
        Sfx.sync(); refreshAudio(); refreshSettingsCalibration(w);
        haptic('select'); Sfx.soft();
      });
      w.querySelector('[data-miss-size]').addEventListener('change', e => {
        const n = +e.target.value; S.missShotHalf = MISS_SHOT_SIZES.includes(n) ? n : 350; save();
        if (GameHost.ready) GameHost.send('missShots', { on: S.missShots, half: S.missShotHalf });
      });
      const clearButton = w.querySelector('[data-a=missClear]'); let clearArmed = false;
      clearButton.addEventListener('click', () => {
        if (!clearArmed) {
          clearArmed = true; clearButton.textContent = t('set.missesClearConfirm');
          clearTimeout(clearTimer); clearTimer = setTimeout(() => { clearArmed = false; clearButton.textContent = t('set.missesClearShots'); }, 5000);
          return;
        }
        clearTimeout(clearTimer); clearArmed = false; clearButton.textContent = t('set.missesClearShots');
        MissShots.clear(); Sfx.soft(); haptic('select'); refreshMisses();
      });
      w.addEventListener('input', (e) => {
        const audio = e.target.closest('input[data-audio]');
        if (audio) {
          const value = +audio.value; if (!Number.isFinite(value)) return;
          S.audioLevels = repairAudioLevels(S.audioLevels, S.volume); S.audioLevels[audio.dataset.audio] = clamp(value, 0, 100) / 100;
          if (audio.dataset.audio === 'master' && Object.prototype.hasOwnProperty.call(S, 'volume')) S.volume = S.audioLevels.master;
          save(); Sfx.sync(); GameHost.syncSettings(); refreshAudio();
          w.querySelector(`[data-audiov="${audio.dataset.audio}"]`).textContent = `${+(S.audioLevels[audio.dataset.audio] * 100).toFixed(1)}%`;
          return;
        }
        const r = e.target.closest('input[data-cal]'); if (!r) return;
        if (!GameHost.ready || !GameHost.calibrationReady || r.disabled) return;
        const entry = GameHost.calibrationRegistry.find(row => row.key === r.dataset.cal), value = +r.value;
        if (!entry || !Number.isFinite(value)) return;
        S.cal[r.dataset.cal] = clamp(value, entry.min, entry.max); save();
        GameHost.send('cal', { k: r.dataset.cal, v: S.cal[r.dataset.cal] });
        r.dataset.pending = String(GameHost.calibrationRequestId); refreshSettingsCalibration(w);
      });
      UI.seg($('#qseg', w), (v) => setQuality(v));
      /* Единственный выбор уровня бота: сохраняется в профиле и применяется
       * к следующему матчу. WTF отдельно предупреждает и вспыхивает. */
      UI.seg($('#dseg', w), (v) => {
        S.diff = clamp(+v, 0, DIFFS.length - 1); save();
        const D = diffOf(S.diff);
        w.querySelector('#diffDescription').textContent = t(D.sk);
        if (D.id === 3) { flash('#FF69D8', .3, 240); toast(t('diff.wtfWarn'), 'target'); }
        else toast(t('diff.changed', { name: t(D.tk) }), 'target');
      });
      UI.seg($('#langseg', w), (v) => I18n.setLang(v));
      const fsBtn = w.querySelector('[data-a=fs]');
      fsBtn && fsBtn.addEventListener('click', () => TGX.toggleFullscreen());
      return () => { off(); clearTimeout(clearTimer); };
    }
  });
}
