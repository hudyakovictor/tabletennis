const MISS_SHOT_SIZES = [350, 300, 400, 100, 20];
/* Калибровка сгруппирована по смыслу: длинный плоский список из 16 ползунков
   не читается. Почти всё читается движком напрямую из g._cal, поэтому
   значение применяется на лету — перезапускать матч не нужно. */
const CAL = [
  { g: 'camera', k: 'camHeight', tk: 'cal.camHeight', dk: 'cal.camHeightD', min: 0, max: 100, def: 50 },
  { g: 'camera', k: 'camZoom', tk: 'cal.camZoom', dk: 'cal.camZoomD', min: 0, max: 100, def: 50 },
  { g: 'camera', k: 'camSway', tk: 'cal.camSway', dk: 'cal.camSwayD', min: 0, max: 100, def: 40 },
  { g: 'racket', k: 'padSpeed', tk: 'cal.padSpeed', dk: 'cal.padSpeedD', min: 0, max: 100, def: 55 },
  { g: 'racket', k: 'padSmooth', tk: 'cal.padSmooth', dk: 'cal.padSmoothD', min: 0, max: 100, def: 35 },
  { g: 'racket', k: 'fingerTrail', tk: 'cal.fingerTrail', dk: 'cal.fingerTrailD', min: 0, max: 100, def: 55 },
  { g: 'strike', k: 'spinGain', tk: 'cal.spinGain', dk: 'cal.spinGainD', min: 0, max: 100, def: 45 },
  { g: 'strike', k: 'arcSens', tk: 'cal.arcSens', dk: 'cal.arcSensD', min: 0, max: 100, def: 33 },
  { g: 'strike', k: 'tossHeight', tk: 'cal.tossHeight', dk: 'cal.tossHeightD', min: 0, max: 100, def: 45 },
  { g: 'ball', k: 'ballSize', tk: 'cal.ballSize', dk: 'cal.ballSizeD', min: 0, max: 100, def: 50 },
  { g: 'ball', k: 'trailLen', tk: 'cal.trailLen', dk: 'cal.trailLenD', min: 0, max: 100, def: 45 },
  { g: 'ball', k: 'flytime', tk: 'cal.flytime', dk: 'cal.flytimeD', min: 0, max: 100, def: 50 },
  { g: 'ball', k: 'tableGlow', tk: 'cal.tableGlow', dk: 'cal.tableGlowD', min: 0, max: 100, def: 50 },
  { g: 'help', k: 'hintRadius', tk: 'cal.hintRadius', dk: 'cal.hintRadiusD', min: 0, max: 100, def: 60 },
  { g: 'help', k: 'hintGlow', tk: 'cal.hintGlow', dk: 'cal.hintGlowD', min: 0, max: 100, def: 65 },
  { g: 'help', k: 'slowmoDepth', tk: 'cal.slowmoDepth', dk: 'cal.slowmoDepthD', min: 0, max: 100, def: 60 }
];

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
  if (S.missShots === undefined) S.missShots = true;
  S.missShotHalf = MISS_SHOT_SIZES.includes(+S.missShotHalf) ? +S.missShotHalf : 350;
  const row = (k, t, i, d) => `<div class="srow"><span class="si">${Art.icon(i, { c: '#9BE8FF' })}</span><span class="st"><b>${t}</b><small>${d}</small></span><button class="tgl ${S[k] ? 'on' : ''}" data-k="${k}" aria-label="${t}" aria-pressed="${!!S[k]}"></button></div>`;
  S.cal = S.cal || {};
  let lastCalGroup = null;
  const cal = CAL.map((c) => {
    const v = S.cal[c.k] !== undefined ? S.cal[c.k] : c.def;
    const head = c.g !== lastCalGroup ? (lastCalGroup = c.g, `<div class="cal-grp">${t('cal.g.' + c.g)}</div>`) : '';
    return `${head}<div class="calrow"><div class="cal-t"><b>${t(c.tk)}</b><small>${t(c.dk)}</small></div><div class="cal-c"><input type="range" min="${c.min}" max="${c.max}" value="${v}" data-cal="${c.k}" aria-label="${t(c.tk)}"><span class="cal-v num" data-calv="${c.k}">${v}</span></div></div>`;
  }).join('');
  Sheet.open(`<div class="h1" style="margin:4px 4px 14px">${t('set.title')}</div>
    <div class="settings-diff">
      <div class="settings-diff-head"><b>${t('set.diff')}</b><small>${t('set.diffHint')}</small></div>
      <div class="seg" id="dseg" role="group" aria-label="${t('set.diff')}"><span class="pill"></span>${DIFFS.map((d) => `<button data-v="${d.id}" class="${S.diff === d.id ? 'on' : ''}">${t(d.tk)}</button>`).join('')}</div>
      <div class="settings-diff-info" id="diffDescription">${t(diffOf(S.diff).sk)}</div>
    </div>
    <div class="pnl sgroup">${row('sfx', t('set.sfx'), 'sound', t('set.sfxD'))}${row('vibro', t('set.vibro'), 'vibe', t('set.vibroD'))}${row('hint', t('set.hint'), 'target', t('set.hintD'))}${row('rm', t('set.rm'), 'motion', t('set.rmD'))}</div>
    <div class="cap" style="margin:18px 4px 8px">${t('set.quality')}</div>
    <div class="seg" id="qseg"><span class="pill"></span>${['high', 'mid', 'low'].map((q) => `<button data-v="${q}" class="${S.quality === q ? 'on' : ''}">${{ high: t('quality.high'), mid: t('quality.mid'), low: t('quality.low') }[q]}</button>`).join('')}</div>
    <div class="cap" style="margin:18px 4px 8px">${t('set.language')}</div>
    <div class="seg" id="langseg"><span class="pill"></span>${I18n.LANGS.map((L) => `<button data-v="${L.id}" class="${I18n.lang === L.id ? 'on' : ''}">${L.name}</button>`).join('')}</div>
    <div class="pnl sgroup" style="margin-top:10px"><div class="srow"><span class="si">${Art.icon('expand', { c: '#9BE8FF' })}</span><span class="st"><b>${t('set.fullscreen')}</b><small>${t('set.fullscreenD')}</small></span><button class="b3 dark sm" data-a="fs" style="margin-left:auto">${t('set.fullscreenBtn')}</button></div></div>
    <div class="cap" style="margin:18px 4px 8px">${t('set.calib')} <small class="dim" style="text-transform:none;font-weight:400;font-size:11px">${t('set.calibHint')}</small></div>
    <details class="pnl calib"><summary class="cal-sum">${Art.icon('target', { c: '#9BE8FF' })} ${t('set.calibOpen', { n: CAL.length })}</summary><div class="cal-list">${cal}</div><div class="cal-foot"><button class="b3 dark sm block" data-a="calReset">${t('set.calibReset')}</button></div></details>
    <div class="cap" style="margin:18px 4px 8px">${t('set.missesTitle')} <small class="dim" style="text-transform:none;font-weight:400;font-size:11px">${t('set.missesHint')}</small></div>
    <div class="pnl sgroup miss-gallery">
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
      let displayedShots = [];
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
          CAL.forEach((c) => {
            S.cal[c.k] = c.def;
            const r = w.querySelector(`[data-cal="${c.k}"]`); if (r) r.value = c.def;
            const v = w.querySelector(`[data-calv="${c.k}"]`); if (v) v.textContent = c.def;
            GameHost.ready && GameHost.send('cal', { k: c.k, v: c.def });
          });
          save(); haptic('select'); Sfx.soft(); toast(t('set.calibResetDone'), 'target');
          return;
        }
        const thumb = e.target.closest('.miss-thumb');
        if (thumb) { zoomMissShot(w, displayedShots[+thumb.dataset.shotIndex], thumb); return; }
        const row = e.target.closest('.srow'); const toggle = e.target.closest('.tgl') || (row && row.querySelector('.tgl')); if (!toggle) return;
        const k = toggle.dataset.k; S[k] = !S[k]; save(); toggle.classList.toggle('on', S[k]); toggle.setAttribute('aria-pressed', String(!!S[k]));
        haptic('select'); Sfx.soft();
        if (k === 'sfx' && GameHost.ready) GameHost.send('mute', { on: !S.sfx });
        if (k === 'vibro' && GameHost.ready) GameHost.send('haptics', { on: !!S.vibro });
        if (k === 'hint' && GameHost.ready) GameHost.send('hint', { on: !!S.hint });
        if (k === 'rm') { document.body.classList.toggle('rm', S.rm); GameHost.ready && GameHost.send('rm', { on: S.rm }); }
        if (k === 'missShots' && GameHost.ready) GameHost.send('missShots', { on: S.missShots, half: S.missShotHalf });
      });
      w.querySelector('[data-miss-size]').addEventListener('change', e => {
        const n = +e.target.value; S.missShotHalf = MISS_SHOT_SIZES.includes(n) ? n : 350; save();
        if (GameHost.ready) GameHost.send('missShots', { on: S.missShots, half: S.missShotHalf });
      });
      const clearButton = w.querySelector('[data-a=missClear]'); let clearArmed = false, clearTimer = 0;
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
        const r = e.target.closest('input[data-cal]'); if (!r) return;
        S.cal[r.dataset.cal] = +r.value; save();
        const v = w.querySelector(`[data-calv="${r.dataset.cal}"]`); if (v) v.textContent = r.value;
        GameHost.ready && GameHost.send('cal', { k: r.dataset.cal, v: +r.value });
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
    }
  });
}
