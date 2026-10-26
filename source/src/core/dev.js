/* ---------- dev-панель (только десктоп) ---------- */
const Dev = {
  list: [
    ['splash', 'Загрузка'], ['hub', 'Арена (хаб)'], ['mm', 'Поиск соперника'], ['vs', 'VS-экран'], ['match', 'Матч (играбельный)'], ['train', 'Обучение'],
    ['result', 'Победа'], ['result-lose', 'Поражение'], ['chest', 'Открытие сундука'], ['shop', 'Магазин'], ['pass', 'Сезонный пропуск'],
    ['ranks', 'Рейтинг'], ['profile', 'Профиль']
  ],
  build() {
    const l = $('#dpList'); if (!l) return;
    l.innerHTML = this.list.map(([id, t]) => `<button data-go="${id}">${t}</button>`).join('');
    l.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return; const id = b.dataset.go;
      if (id === 'result') Router.go('result', { data: Demo.result(true) });
      else if (id === 'result-lose') Router.go('result', { data: Demo.result(false) });
      else if (id === 'chest') Router.go('chest', { data: { kind: 'gold' } });
      else Router.go(id);
    });
    $$('[data-dev]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.dev; const dev = $('#device').getBoundingClientRect();
      const c = { x: dev.width / 2, y: dev.height / 2 };
      if (k === 'coins') Wallet.add('coins', 120, c);
      if (k === 'confetti') FX.confetti(c.x, dev.height * .3, 120);
      if (k === 'shake') FX.shake(16, 500);
      if (k === 'lvl') LevelUp.show(S.level + 1);
      if (k === 'train') Router.go('train', { data: { then: 'hub' } });
      if (k === 'zone') devZoneSheet();
      if (k === 'zstats') zoneStatsSheet();
    }));
    $$('#dpQuality button').forEach((b) => b.addEventListener('click', () => { setQuality(b.dataset.q); }));
    this.syncQ();
  },
  syncQ() { $$('#dpQuality button').forEach((b) => b.classList.toggle('on', b.dataset.q === S.quality)); },
  mark(id) { $$('#dpList button').forEach((b) => b.classList.toggle('on', b.dataset.go === id)); }
};

function setQuality(q) {
  S.quality = q; save();
  document.body.classList.toggle('q-low', q === 'low');
  BG.setQuality(q); FX.setQuality(q); Dev.syncQ();
  if (typeof GameHost !== 'undefined' && GameHost.frame) GameHost.send('quality', { q });
}
