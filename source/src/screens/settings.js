const CAL = [
  { k: 'camHeight', tk: 'cal.camHeight', dk: 'cal.camHeightD', min: 0, max: 100, def: 50 },
  { k: 'camZoom', tk: 'cal.camZoom', dk: 'cal.camZoomD', min: 0, max: 100, def: 50 },
  { k: 'camSway', tk: 'cal.camSway', dk: 'cal.camSwayD', min: 0, max: 100, def: 40 },
  { k: 'padSpeed', tk: 'cal.padSpeed', dk: 'cal.padSpeedD', min: 0, max: 100, def: 55 },
  { k: 'padSmooth', tk: 'cal.padSmooth', dk: 'cal.padSmoothD', min: 0, max: 100, def: 35 },
  { k: 'ballSize', tk: 'cal.ballSize', dk: 'cal.ballSizeD', min: 0, max: 100, def: 50 },
  { k: 'trailLen', tk: 'cal.trailLen', dk: 'cal.trailLenD', min: 0, max: 100, def: 45 },
  { k: 'tableGlow', tk: 'cal.tableGlow', dk: 'cal.tableGlowD', min: 0, max: 100, def: 50 },
  { k: 'flytime', tk: 'cal.flytime', dk: 'cal.flytimeD', min: 0, max: 100, def: 50 },
  { k: 'hintRadius', tk: 'cal.hintRadius', dk: 'cal.hintRadiusD', min: 0, max: 100, def: 60 },
  { k: 'spinGain', tk: 'cal.spinGain', dk: 'cal.spinGainD', min: 0, max: 100, def: 45 },
  { k: 'arcSens', tk: 'cal.arcSens', dk: 'cal.arcSensD', min: 0, max: 100, def: 33 }
];
function openSettings() {
  const row = (k, t, i, d) => `<div class="srow"><span class="si">${Art.icon(i, { c: '#9BE8FF' })}</span><span class="st"><b>${t}</b><small>${d}</small></span><button class="tgl ${S[k] ? 'on' : ''}" data-k="${k}" aria-label="${t}"></button></div>`;
  S.cal = S.cal || {};
  const cal = CAL.map((c) => { const v = S.cal[c.k] !== undefined ? S.cal[c.k] : c.def; return `<div class="calrow"><div class="cal-t"><b>${t(c.tk)}</b><small>${t(c.dk)}</small></div><div class="cal-c"><input type="range" min="${c.min}" max="${c.max}" value="${v}" data-cal="${c.k}" aria-label="${t(c.tk)}"><span class="cal-v num" data-calv="${c.k}">${v}</span></div></div>`; }).join('');
  Sheet.open(`<div class="h1" style="margin:4px 4px 14px">${t('set.title')}</div>
    <div class="pnl sgroup">${row('sfx', t('set.sfx'), 'sound', t('set.sfxD'))}${row('vibro', t('set.vibro'), 'vibe', t('set.vibroD'))}${row('hint', t('set.hint'), 'target', t('set.hintD'))}${row('rm', t('set.rm'), 'motion', t('set.rmD'))}</div>
    <div class="cap" style="margin:18px 4px 8px">${t('set.quality')}</div>
    <div class="seg" id="qseg"><span class="pill"></span>${['high', 'mid', 'low'].map((q) => `<button data-v="${q}" class="${S.quality === q ? 'on' : ''}">${{ high: t('quality.high'), mid: t('quality.mid'), low: t('quality.low') }[q]}</button>`).join('')}</div>
    <div class="cap" style="margin:18px 4px 8px">${t('set.language')}</div>
    <div class="seg" id="langseg"><span class="pill"></span>${I18n.LANGS.map((L) => `<button data-v="${L.id}" class="${I18n.lang === L.id ? 'on' : ''}">${L.name}</button>`).join('')}</div>
    <div class="pnl sgroup" style="margin-top:10px"><div class="srow"><span class="si">${Art.icon('expand', { c: '#9BE8FF' })}</span><span class="st"><b>${t('set.fullscreen')}</b><small>${t('set.fullscreenD')}</small></span><button class="b3 dark sm" data-a="fs" style="margin-left:auto">${t('set.fullscreenBtn')}</button></div></div>
    <div class="cap" style="margin:18px 4px 8px">${t('set.calib')} <small class="dim" style="text-transform:none;font-weight:400;font-size:11px">${t('set.calibHint')}</small></div>
    <details class="pnl calib"><summary class="cal-sum">${Art.icon('target', { c: '#9BE8FF' })} ${t('set.calibOpen', { n: CAL.length })}</summary><div class="cal-list">${cal}</div></details>
    <p class="dim" style="font-size:11.5px;margin:14px 4px 0;line-height:1.5">${t('set.version', { v: '2.0.0' })}</p>`, {
    onOpen: (w) => {
      w.addEventListener('click', (e) => { const row = e.target.closest('.srow'); const t = e.target.closest('.tgl') || (row && row.querySelector('.tgl')); if (!t) return; const k = t.dataset.k; S[k] = !S[k]; save(); t.classList.toggle('on', S[k]); haptic('select'); Sfx.soft(); if (k === 'rm') { document.body.classList.toggle('rm', S.rm); GameHost.ready && GameHost.send('rm', { on: S.rm }); } });
      w.addEventListener('input', (e) => {
        const r = e.target.closest('input[data-cal]'); if (!r) return;
        S.cal[r.dataset.cal] = +r.value; save();
        const v = w.querySelector(`[data-calv="${r.dataset.cal}"]`); if (v) v.textContent = r.value;
        GameHost.ready && GameHost.send('cal', { k: r.dataset.cal, v: +r.value });
      });
      UI.seg($('#qseg', w), (v) => setQuality(v));
      UI.seg($('#langseg', w), (v) => I18n.setLang(v));
      const fsBtn = w.querySelector('[data-a=fs]');
      fsBtn && fsBtn.addEventListener('click', () => TGX.toggleFullscreen());
    }
  });
}
