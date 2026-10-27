/* =====================================================================
   META — магазин, сезонный пропуск, рейтинг, профиль
   ===================================================================== */
const ItemArt = {
  comet(size = 90, c = '#FFC93A') {
    const g = 'cm' + Math.random().toString(36).slice(2, 7);
    return `<svg viewBox="0 0 100 100" width="${size}" height="${size}"><defs><linearGradient id="${g}" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity="0"/><stop offset="1" stop-color="${c}"/></linearGradient></defs>
      <path d="M92 10L40 52a14 14 0 0 0 8 8z" fill="url(#${g})"/><path d="M80 14L36 46" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".6"/>
      <circle cx="38" cy="62" r="18" fill="#FFF8E8" stroke="${c}" stroke-width="4"/><circle cx="32" cy="56" r="5" fill="#fff"/></svg>`;
  },
  table(size = 90, c = '#2EE6FF') {
    return `<svg viewBox="0 0 100 100" width="${size}" height="${size}"><path d="M10 52L50 32l40 20-40 20z" fill="#1749B0" stroke="${c}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M10 52v6l40 20 40-20v-6L50 72z" fill="#0A1F57"/><path d="M50 32v40" stroke="#fff" stroke-width="1.5" opacity=".8"/><path d="M28 43l44 22" stroke="#fff" stroke-width="5" opacity=".85"/>
      <path d="M18 62v20M82 62v20M50 78v14" stroke="#0A0D1E" stroke-width="4"/></svg>`;
  },
  of(it, size, opt = {}) {
    const ill = (typeof ILL !== 'undefined') && ILL['shop_' + it.id.replace('-', '_')];
    if (ill) return `<i class="ilf" style="display:block;width:${size}px;height:${size}px;background-image:url('${ill}');background-size:contain;background-position:center;background-repeat:no-repeat;-webkit-mask:radial-gradient(closest-side,#000 72%,transparent 100%);mask:radial-gradient(closest-side,#000 72%,transparent 100%)"></i>`;
    return it.kind === 'trail' ? this.comet(size, it.col) : it.kind === 'table' ? this.table(size, it.col) : it.kind === 'rubber' ? Art.rubber(it.col, size, opt) : it.kind === 'blade' ? Art.blade(it.col, size, opt) : Art.paddle(it.col, size);
  }
};