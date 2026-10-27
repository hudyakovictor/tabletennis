/* ---------- Карьера: настоящая статистика из сыгранных матчей ----------
   Профиль раньше рисовал «Стиль игры» и достижения из заглушек. Теперь
   всё считается из матчей: удары, идеальные, смеши, вращение, приём,
   подачи и точность контакта (ZoneStats). Пока матчей мало, радар
   смешивается с нейтральными значениями, чтобы не скакать от одного матча. */
const ICON_FILL = new Set(['star', 'bolt', 'fire', 'crown']);   // у контурных иконок (мишень, часы) заливка превращает их в кляксу
const SPIN_STROKES = new Set(['LOOP', 'COUNTER', 'FLICK', 'PUSH', 'CHOP', 'HOOK', 'FADE', 'LOB']);
const ACH = [
  { id: 'first_win', tk: 'ach.first_win', dk: 'ach.first_winD', i: 'trophy' },
  { id: 'streak3', tk: 'ach.streak3', dk: 'ach.streak3D', i: 'fire' },
  { id: 'sniper', tk: 'ach.sniper', dk: 'ach.sniperD', i: 'target' },
  { id: 'marathon', tk: 'ach.marathon', dk: 'ach.marathonD', i: 'clock' },
  { id: 'jeweler', tk: 'ach.jeweler', dk: 'ach.jewelerD', i: 'star' },
  { id: 'spinner', tk: 'ach.spinner', dk: 'ach.spinnerD', i: 'bolt' }
];
const Career = {
  zero: () => ({ m: 0, w: 0, streak: 0, best: 0, hits: 0, perf: 0, smash: 0, spin: 0, oppHits: 0, rallyHits: 0, servePts: 0, serveWon: 0, att: 0, con: 0, maxRally: 0 }),
  get c() { if (!S.car) S.car = this.zero(); return S.car; },
  get got() { if (!S.ach) S.ach = {}; return S.ach; },
  /** st — счётчики экрана матча, coach — разбор матча. Возвращает новые достижения. */
  record(st, win, coach) {
    const c = this.c;
    c.m++; if (win) { c.w++; c.streak++; c.best = Math.max(c.best, c.streak); } else c.streak = 0;
    c.hits += st.hits; c.perf += st.perfect; c.smash += st.smash; c.spin += st.spin || 0;
    c.oppHits += st.oppHits || 0; c.rallyHits += st.rallyHits || 0;
    c.servePts += st.servePts || 0; c.serveWon += st.serveWon || 0;
    if (coach) { c.att += coach.n; c.con += coach.hit; }
    c.maxRally = Math.max(c.maxRally, st.maxRally || 0);
    const cond = {
      first_win: c.w >= 1, streak3: c.best >= 3,
      sniper: !!coach && coach.n >= 10 && coach.pct >= 80,
      marathon: (st.maxRally || 0) >= 15, jeweler: st.perfect >= 5, spinner: (st.spin || 0) >= 10
    };
    const fresh = ACH.filter((a) => cond[a.id] && !this.got[a.id]);
    fresh.forEach((a) => { this.got[a.id] = Date.now(); });
    save();
    return fresh;
  },
  radar() {
    const c = this.c, k = 2, n = c.m, mix = (prior, v) => clamp((prior * k + (v === null ? prior : v) * n) / (k + n), 0.15, 0.98);
    const r = (a, b, s = 1) => (b > 0 ? Math.min(1, a / b * s) : null);
    return [
      [t('radar.serve'), mix(0.55, r(c.serveWon, c.servePts))],
      [t('radar.attack'), mix(0.6, r(c.perf + c.smash, c.hits, 1.6))],
      [t('radar.defense'), mix(0.55, r(c.rallyHits, c.oppHits))],
      [t('radar.spin'), mix(0.5, r(c.spin, c.hits, 2))],
      [t('radar.reaction'), mix(0.6, r(c.con, c.att))]
    ];
  }
};

/* Достижение открыто: золотая плашка с ударом, по очереди для каждого */
async function achievementPops(list, alive = () => true) {
  for (const a of list) {
    if (!alive()) return;
    const el = document.createElement('div'); el.className = 'ach-pop';
    el.innerHTML = `<div class="ap-card"><span class="ap-ic">${Art.icon(a.i, { c: '#3A1A00', sw: 2.4, fill: ICON_FILL.has(a.i) ? '#3A1A00' : 'transparent' })}</span><div><span class="cap">${t('ach.unlocked')}</span><b>${t(a.tk)}</b><small>${t(a.dk)}</small></div></div>`;
    document.body.appendChild(el);
    await sleep(60); el.classList.add('on');
    const p = FX.pt(el.querySelector('.ap-ic'));
    setTimeout(() => { FX.burst(p.x, p.y, { c: ['#FFC93A', '#FFF6C8', '#FF8A00'], count: 30, speed: 10, size: 1 }); FX.twinkles && FX.twinkles(p.x, p.y, 40, 6); Sfx.impact(); haptic('heavy'); }, 260);
    await Promise.race([sleep(2300), new Promise((res) => el.addEventListener('click', res, { once: true }))]);
    el.classList.remove('on'); el.classList.add('off'); setTimeout(() => el.remove(), 450);
    await sleep(250);
  }
}

/* ---------------- Задания дня: живые миссии вместо заглушки ----------------
 * Три миссии выбираются детерминированно по дате, прогресс идёт из реальных
 * итогов матчей (победы / идеальные / удары / смеши / лучший розыгрыш /
 * точность контакта), награды забираются в хабе и платятся в Wallet.
 * Всё локально: S.daily = { d, ids, p, got } + save(); сброс — на новую дату. */
const MISSION_POOL = [
  { id: 'win1',   tk: 'mission.win1',           m: 1,  r: 90,  k: 'coins', ev: 'win' },
  { id: 'win2',   tk: 'mission.win2',        m: 2,  r: 160, k: 'coins', ev: 'win' },
  { id: 'perf5',  tk: 'mission.perf5',     m: 5,  r: 5,   k: 'gems',  ev: 'perfect' },
  { id: 'perf10', tk: 'mission.perf10',    m: 10, r: 11,  k: 'gems',  ev: 'perfect' },
  { id: 'rally8', tk: 'mission.rally8',  m: 8,  r: 100, k: 'coins', ev: 'maxRally', max: true },
  { id: 'hits40', tk: 'mission.hits40',       m: 40, r: 90,  k: 'coins', ev: 'hits' },
  { id: 'smash3', tk: 'mission.smash3',         m: 3,  r: 70,  k: 'coins', ev: 'smash' },
  { id: 'acc75',  tk: 'mission.acc75',  m: 75, r: 8,   k: 'gems',  ev: 'accMax', max: true },
];
const Daily = {
  key() { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0'); },
  get st() {
    if (!S.daily || S.daily.d !== this.key()) {
      /* детерминированный выбор по дате: три разные миссии из пула */
      let h = 0; for (const ch of this.key()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const ids = [];
      for (let i = 0; i < 3 && ids.length < 3; i++) {
        const cand = MISSION_POOL[(h + i * 3) % MISSION_POOL.length].id;
        if (!ids.includes(cand)) ids.push(cand);
      }
      while (ids.length < 3) { for (const q of MISSION_POOL) if (!ids.includes(q.id)) { ids.push(q.id); break; } break; }
      S.daily = { d: this.key(), ids, p: {}, got: {} };
      save();
    }
    return S.daily;
  },
  items() {
    const st = this.st;
    return st.ids.map((id) => {
      const q = MISSION_POOL.find((m) => m.id === id);
      const p = st.p[id] || 0;
      return { id: q.id, t: t(q.tk), p: Math.min(p, q.m), m: q.m, r: q.r, k: q.k, done: p >= q.m, claimed: !!st.got[id] };
    });
  },
  ready() { const g = this.st.got; return this.items().filter((q) => q.done && !g[q.id]).length; },
  msLeftToday() { const n = new Date(); return (24 * 3600 - (n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds())) * 1000; },
  /** res — итог матча (scr_battle.finish). Возвращает миссии, закрытые ЭТИМ матчем. */
  tick(res, win) {
    const day = this.st;
    const before = new Set(this.items().filter((q) => q.done).map((q) => q.id));
    const bump = (ev, v, isMax) => {
      for (const q of MISSION_POOL) if (q.ev === ev && day.ids.includes(q.id))
        day.p[q.id] = isMax ? Math.max(day.p[q.id] || 0, v) : (day.p[q.id] || 0) + v;
    };
    if (win) bump('win', 1);
    bump('perfect', res.stats.perfect || 0);
    bump('hits', res.stats.hits || 0);
    bump('smash', res.stats.smash || 0);
    bump('maxRally', res.stats.maxRally || 0, true);
    bump('accMax', res.stats.acc || 0, true);
    save();
    return this.items().filter((q) => q.done && !before.has(q.id));
  },
  claim(id) {
    const q = this.items().find((x) => x.id === id);
    if (!q || !q.done || q.claimed) return null;
    this.st.got[id] = Date.now(); save();
    return q;
  },
};
