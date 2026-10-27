const SEASON = { n: 4, days: 26 };   // единая правда о сезоне; остаток времени — season.left в словаре
const PASS = [...Array(20)].map((_, i) => {
  const l = i + 1;
  const f = l % 5 === 0 ? { k: 'chest', kind: 'silver', n: 1 } : l % 2 ? { k: 'coins', n: 50 + l * 10 } : { k: 'gems', n: 2 + (l >> 1) };
  const p = l % 5 === 0 ? { k: 'chest', kind: l % 10 === 0 ? 'epic' : 'gold', n: 1 } : l % 3 === 0 ? { k: 'card', n: 1, col: ['#FF4B3E', '#9F6BFF', '#2EC9FF'][l % 3] } : { k: 'gems', n: 5 + l };
  return { l, f, p };
});