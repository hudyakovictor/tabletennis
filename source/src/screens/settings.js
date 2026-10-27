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
/* ---------- история промахов (калибровка) ----------
 * Скриншоты области клика ±100 px: красный крест — где был клик, зелёное
 * кольцо — зона удара (мяч при нажатии), белая точка — центр зоны.
 * Визуально: клик далеко от кольца — калибруй положение пальца; кольцо
 * на месте, но удар не прошёл — проблема  timing/ракетки, не калибровки. */
const MISS_REASON = {
  OUTSIDE_ZONE: t('miss.reason.OUTSIDE_ZONE'), TIMING_LATE: t('miss.reason.TIMING_LATE'),
  TIMING_EARLY: t('miss.reason.TIMING_EARLY'), NO_FRESH_SWIPE: t('miss.reason.NO_FRESH_SWIPE'),
  STATIC_CLICK: t('miss.reason.STATIC_CLICK'), DEPTH_FAIL: t('miss.reason.DEPTH_FAIL'),
  CONSUMED: t('miss.reason.CONSUMED'), SERVE_TOSS_LOW: t('miss.reason.SERVE_TOSS_LOW'),
  WRONG_DIRECTION: t('miss.reason.WRONG_DIRECTION'), BOUNCE_ILLEGAL: t('miss.reason.BOUNCE_ILLEGAL'),
  POINT_WON: t('miss.reason.POINT_WON'), POINT_LOST: t('miss.reason.POINT_LOST'),
  none: t('miss.reason.none'),
};
const reasonText = (s) => MISS_REASON[s.reason || 'none'] || s.reason || '';
const fmtTime = (ts) => { const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()); };
const zoomShot = (id) => {
  const s = MissShots.all().find((x) => x.id === id); if (!s) return;
  const ov = document.createElement('div'); ov.className = 'miss-zoom';
  ov.innerHTML = `<img src="data:image/jpeg;base64,${s.img}" alt=""><div class="mz-meta">${reasonText(s)} · ${fmtTime(s.t)} · ${s.kind === 'serve' ? t('miss.kind.serve') : t('miss.kind.rally')}</div><div class="mz-legend">${t('set.missesZoom')}</div><button class="b3 dark sm">${t('set.missesClose')}</button>`;
  $('#sheets').appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('button')) ov.remove(); });
};
function openSettings() {
  const row = (k, t, i, d) => `<div class="srow"><span class="si">${Art.icon(i, { c: '#9BE8FF' })}</span><span class="st"><b>${t}</b><small>${d}</small></span><button class="tgl ${S[k] ? 'on' : ''}" data-k="${k}" aria-label="${t}"></button></div>`;
  S.cal = S.cal || {};
  const cal = CAL.map((c) => { const v = S.cal[c.k] !== undefined ? S.cal[c.k] : c.def; return `<div class="calrow"><div class="cal-t"><b>${t(c.tk)}</b><small>${t(c.dk)}</small></div><div class="cal-c"><input type="range" min="${c.min}" max="${c.max}" value="${v}" data-cal="${c.k}" aria-label="${t(c.tk)}"><span class="cal-v num" data-calv="${c.k}">${v}</span></div></div>`; }).join('');
  const shots = MissShots.all();
  const misses = MissShots.misses();
  const thumbsHtml = () => {
    const list = MissShots.all();
    if (!list.length) return `<p class="dim" style="font-size:11.5px;padding:10px 4px">${t('set.missesEmpty')}</p>`;
    return list.slice().reverse().map((s) => `<div class="miss-thumb" data-shot="${s.id}"><img src="data:image/jpeg;base64,${s.img}" alt=""><small>${reasonText(s)}<br>${fmtTime(s.t)}</small></div>`).join('');
  };
  Sheet.open(`<div class="h1" style="margin:4px 4px 14px">${t('set.title')}</div>
    <div class="pnl sgroup">${row('sfx', t('set.sfx'), 'sound', t('set.sfxD'))}${row('vibro', t('set.vibro'), 'vibe', t('set.vibroD'))}${row('hint', t('set.hint'), 'target', t('set.hintD'))}${row('rm', t('set.rm'), 'motion', t('set.rmD'))}</div>
    <div class="cap" style="margin:18px 4px 8px">${t('set.quality')}</div>
    <div class="seg" id="qseg"><span class="pill"></span>${['high', 'mid', 'low'].map((q) => `<button data-v="${q}" class="${S.quality === q ? 'on' : ''}">${{ high: t('quality.high'), mid: t('quality.mid'), low: t('quality.low') }[q]}</button>`).join('')}</div>
    <div class="cap" style="margin:18px 4px 8px">${t('set.language')}</div>
    <div class="seg" id="langseg"><span class="pill"></span>${I18n.LANGS.map((L) => `<button data-v="${L.id}" class="${I18n.lang === L.id ? 'on' : ''}">${L.name}</button>`).join('')}</div>
    <div class="pnl sgroup" style="margin-top:10px"><div class="srow"><span class="si">${Art.icon('expand', { c: '#9BE8FF' })}</span><span class="st"><b>${t('set.fullscreen')}</b><small>${t('set.fullscreenD')}</small></span><button class="b3 dark sm" data-a="fs" style="margin-left:auto">${t('set.fullscreenBtn')}</button></div></div>
    <div class="cap" style="margin:18px 4px 8px">${t('set.calib')} <small class="dim" style="text-transform:none;font-weight:400;font-size:11px">${t('set.calibHint')}</small></div>
    <details class="pnl calib"><summary class="cal-sum">${Art.icon('target', { c: '#9BE8FF' })} ${t('set.calibOpen', { n: CAL.length })}</summary><div class="cal-list">${cal}</div></details>
    <div class="cap" style="margin:18px 4px 8px">${t('set.missesTitle')} <small class="dim" style="text-transform:none;font-weight:400;font-size:11px">${t('set.missesHint')}</small></div>
    <div class="pnl sgroup">
      ${row('missShots', t('set.missesSave'), 'target', t('set.missesSaveD'))}
      <div class="srow"><span class="si">${Art.icon('chart', { c: '#9BE8FF' })}</span><span class="st"><b>${t('set.missesStat')}</b><small id="missStatD">${t('set.missesStatD', { n: shots.length, m: misses })}</small></span></div>
      <div class="miss-grid">${thumbsHtml()}</div>
      <div class="miss-actions">
        <button class="b3 dark sm" data-a="missClear">${t('set.missesClearShots')}</button>
        <button class="b3 dark sm" data-a="missClearStats">${t('set.missesClearStats')}</button>
      </div>
    </div>
    <p class="dim" style="font-size:11.5px;margin:14px 4px 0;line-height:1.5">${t('set.version', { v: '2.0.0' })}</p>`, {
    onOpen: (w) => {
      w.addEventListener('click', (e) => {
        const th = e.target.closest('.miss-thumb');
        if (th) { zoomShot(+th.dataset.shot); return; }
        const row = e.target.closest('.srow'); const t = e.target.closest('.tgl') || (row && row.querySelector('.tgl')); if (!t) return; const k = t.dataset.k; S[k] = !S[k]; save(); t.classList.toggle('on', S[k]); haptic('select'); Sfx.soft();
        if (k === 'rm') { document.body.classList.toggle('rm', S.rm); GameHost.ready && GameHost.send('rm', { on: S.rm }); }
        if (k === 'missShots') GameHost.ready && GameHost.send('missShots', { on: S[k] });
      });
      w.querySelectorAll('[data-a=missClear], [data-a=missClearStats]').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.a === 'missClear') MissShots.clear();
        else { MissShots.clear(); ZoneStats.clear(); }
        Sfx.soft(); haptic('select');
        const grid = w.querySelector('.miss-grid'); if (grid) grid.innerHTML = thumbsHtml();
        const stat = w.querySelector('#missStatD');
        if (stat) stat.textContent = t('set.missesStatD', { n: MissShots.all().length, m: MissShots.misses() });
      }));
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
