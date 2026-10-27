/* =====================================================================
   ART — процедурная векторная графика: валюты, эмблемы лиг, сундуки,
   ракетки, иконки. Всё в SVG, без внешних файлов, масштабируется.
   ===================================================================== */
const Art = (() => {
  let uid = 0; const id = (p) => p + (++uid);

  function coin(size = 36) {
    const g = id('cg'), r = id('cr'), s = id('cs');
    return `<svg viewBox="0 0 40 40" width="${size}" height="${size}"><defs>
      <linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF4B0"/><stop offset=".45" stop-color="#FFC93A"/><stop offset="1" stop-color="#E07B00"/></linearGradient>
      <linearGradient id="${r}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C46A00"/><stop offset="1" stop-color="#7A3A00"/></linearGradient>
      <radialGradient id="${s}" cx=".35" cy=".3" r=".7"><stop offset="0" stop-color="#FFE680"/><stop offset="1" stop-color="#FFA41B"/></radialGradient></defs>
      <ellipse cx="20" cy="22.5" rx="17" ry="16" fill="url(#${r})"/>
      <circle cx="20" cy="19.5" r="17" fill="url(#${g})"/>
      <circle cx="20" cy="19.5" r="12.5" fill="url(#${s})" stroke="#D88200" stroke-width="1.6"/>
      <path d="M20 11.5l2.3 4.9 5.3.6-3.9 3.6 1.1 5.2L20 23.2l-4.8 2.6 1.1-5.2-3.9-3.6 5.3-.6z" fill="#FFF6C8" stroke="#C46A00" stroke-width="1.1" stroke-linejoin="round"/>
      <path d="M8 13a14 14 0 0 1 9-8" stroke="#fff" stroke-width="2.2" stroke-linecap="round" fill="none" opacity=".85"/></svg>`;
  }
  function gem(size = 36) {
    const a = id('ga'), b = id('gb');
    return `<svg viewBox="0 0 40 40" width="${size}" height="${size}"><defs>
      <linearGradient id="${a}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C9FBFF"/><stop offset=".5" stop-color="#2EE6FF"/><stop offset="1" stop-color="#1A6CF0"/></linearGradient>
      <linearGradient id="${b}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7DF3FF"/><stop offset="1" stop-color="#0A4FC2"/></linearGradient></defs>
      <path d="M11 8h18l8 10-17 18L3 18z" fill="#0A3F8A" transform="translate(0 2)"/>
      <path d="M11 8h18l8 10-17 18L3 18z" fill="url(#${a})" stroke="#0A4FC2" stroke-width="1.2" stroke-linejoin="round"/>
      <path d="M3 18h34M11 8l4 10 5 18 5-18 4-10M15 18l5-10 5 10" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.1" stroke-linejoin="round"/>
      <path d="M20 36L3 18h12z" fill="url(#${b})" opacity=".55"/>
      <path d="M12.5 10.5l-3.8 5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  }
  function star(size = 40, on = true) {
    const a = id('sa');
    return `<svg viewBox="0 0 48 48" width="${size}" height="${size}"><defs><linearGradient id="${a}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${on ? '#FFF6C0' : '#4A5280'}"/><stop offset=".5" stop-color="${on ? '#FFC93A' : '#2C3264'}"/><stop offset="1" stop-color="${on ? '#FF8A00' : '#1A1F48'}"/></linearGradient></defs>
      <path d="M24 4.5l6 12.4 13.6 1.9-9.9 9.5 2.4 13.5L24 35.4l-12.1 6.4 2.4-13.5-9.9-9.5L18 16.9z" fill="${on ? '#A85300' : '#0A0D26'}" transform="translate(0 2.5)"/>
      <path d="M24 4.5l6 12.4 13.6 1.9-9.9 9.5 2.4 13.5L24 35.4l-12.1 6.4 2.4-13.5-9.9-9.5L18 16.9z" fill="url(#${a})" stroke="${on ? '#FFF2B0' : '#5A6296'}" stroke-width="1.4" stroke-linejoin="round"/>
      ${on ? '<path d="M17 18.5l4-1" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>' : ''}</svg>`;
  }
  function trophy(size = 40) {
    const a = id('ta');
    return `<svg viewBox="0 0 48 48" width="${size}" height="${size}"><defs><linearGradient id="${a}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF6C0"/><stop offset=".5" stop-color="#FFC93A"/><stop offset="1" stop-color="#E07B00"/></linearGradient></defs>
      <path d="M14 7h20v10a10 10 0 0 1-20 0z" fill="url(#${a})" stroke="#A85300" stroke-width="1.6"/>
      <path d="M14 10H8v3a7 7 0 0 0 7 7M34 10h6v3a7 7 0 0 1-7 7" fill="none" stroke="#E0A000" stroke-width="3"/>
      <path d="M21 27h6v6h-6z" fill="#E0A000"/><rect x="14" y="33" width="20" height="7" rx="2" fill="url(#${a})" stroke="#A85300" stroke-width="1.6"/>
      <path d="M18 10v6" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".8"/></svg>`;
  }

  /* эмблема лиги: щит + крылья + камень */
  function badge(L, size = 40) {
    const a = id('ba'), b = id('bb'), c = id('bc');
    const [c1, c2] = L.c; const tier = LEAGUES.indexOf(L);
    const wings = tier >= 3 ? `<path d="M10 22c-6-1-8-6-8-10 3 3 6 4 9 4-2 2-2 4-1 6zM54 22c6-1 8-6 8-10-3 3-6 4-9 4 2 2 2 4 1 6z" fill="url(#${b})" stroke="${c2}" stroke-width="1"/>` : '';
    const crown = tier >= 4 ? `<path d="M22 6l4 4 6-6 6 6 4-4-2 8H24z" fill="#FFD54A" stroke="#A85300" stroke-width="1"/>` : '';
    return `<svg viewBox="0 0 64 64" width="${size}" height="${size}"><defs>
      <linearGradient id="${a}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
      <linearGradient id="${b}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="${c1}"/></linearGradient>
      <radialGradient id="${c}" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient></defs>
      ${wings}
      <path d="M32 9l19 7v15c0 12-8 20-19 25-11-5-19-13-19-25V16z" fill="${c2}" transform="translate(0 2.5)" opacity=".9"/>
      <path d="M32 9l19 7v15c0 12-8 20-19 25-11-5-19-13-19-25V16z" fill="url(#${a})" stroke="#fff" stroke-opacity=".55" stroke-width="1.5"/>
      <path d="M32 14l14 5v12c0 9-6 15-14 19-8-4-14-10-14-19V19z" fill="rgba(0,0,0,.18)"/>
      <path d="M32 21l9 9-9 12-9-12z" fill="url(#${c})" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>
      <path d="M28 27l3-3" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
      ${crown}</svg>`;
  }

  /* сундук: отдельные группы крышки/корпуса для анимации */
  const CHEST = {
    wood: { a: '#C98A4B', b: '#7A4520', band: '#9AA6C8', gem: '#7DF3FF', nk: 'chest.wood', rar: '' },
    silver: { a: '#DDE6FF', b: '#7B8BB0', band: '#4A5A86', gem: '#2EE6FF', nk: 'chest.silver', rar: 'rare' },
    gold: { a: '#FFE680', b: '#D08A00', band: '#8A4A00', gem: '#FF4B3E', nk: 'chest.gold', rar: 'leg' },
    epic: { a: '#D3B5FF', b: '#6A2FE0', band: '#2A0F70', gem: '#FFC93A', nk: 'chest.epic', rar: 'epic' }
  };
  function chest(kind = 'gold', size = 120, { open = false } = {}) {
    const C = CHEST[kind] || CHEST.gold; const a = id('ca'), b = id('cb'), l = id('cl'), gl = id('cgl');
    return `<svg class="chest-svg" viewBox="0 0 120 120" width="${size}" height="${size}" style="overflow:visible"><defs>
      <linearGradient id="${a}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.a}"/><stop offset="1" stop-color="${C.b}"/></linearGradient>
      <linearGradient id="${l}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".25" stop-color="${C.a}"/><stop offset="1" stop-color="${C.b}"/></linearGradient>
      <linearGradient id="${b}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.band}"/><stop offset=".5" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="${C.band}"/></linearGradient>
      <radialGradient id="${gl}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFF6C8"/><stop offset=".4" stop-color="${C.gem}" stop-opacity=".8"/><stop offset="1" stop-color="${C.gem}" stop-opacity="0"/></radialGradient></defs>
      <ellipse cx="60" cy="108" rx="44" ry="8" fill="#000" opacity=".45"/>
      <g class="ch-glow" opacity="${open ? 1 : 0}"><ellipse cx="60" cy="56" rx="44" ry="26" fill="url(#${gl})"/></g>
      <g class="ch-body">
        <path d="M18 56h84v38a8 8 0 0 1-8 8H26a8 8 0 0 1-8-8z" fill="url(#${a})" stroke="rgba(0,0,0,.35)" stroke-width="2"/>
        <path d="M18 56h84v8H18z" fill="rgba(0,0,0,.25)"/>
        <rect x="30" y="56" width="10" height="46" fill="url(#${b})"/><rect x="80" y="56" width="10" height="46" fill="url(#${b})"/>
        <path d="M24 92h72" stroke="rgba(255,255,255,.25)" stroke-width="2"/>
        <rect x="50" y="58" width="20" height="22" rx="4" fill="${C.band}" stroke="rgba(0,0,0,.4)" stroke-width="1.5"/>
        <path d="M60 63l5 6-5 6-5-6z" fill="${C.gem}" stroke="#fff" stroke-width="1"/>
      </g>
      <g class="ch-lid" style="transform-origin:60px 56px;transform-box:view-box">
        <path d="M16 56V40c0-14 12-22 44-22s44 8 44 22v16z" fill="url(#${l})" stroke="rgba(0,0,0,.35)" stroke-width="2"/>
        <path d="M28 21.5c-1 10-1 22 0 34.5h12c-1-13-1-25 0-36.5zM92 21.5c1 10 1 22 0 34.5H80c1-13 1-25 0-36.5z" fill="url(#${b})"/>
        <path d="M26 30c8-5 22-7 34-7" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".7"/>
        <rect x="52" y="48" width="16" height="12" rx="3" fill="${C.band}" stroke="rgba(0,0,0,.4)" stroke-width="1.5"/>
      </g></svg>`;
  }

  /* ---- ракетка, накладка, основание ----
   * Общая геометрия настоящего основания (голова ~150×157 мм, горло, «анатомическая»
   * ручка FL ~100 мм) в боксе 100×100: голова y 6..62, ручка 60..96.
   * Без радиального блика: резина матовая, свет — мягкий линейный градиент сверху-слева. */
  const HEAD = 'M50 6C65.5 6 76.5 17 76.5 32.5C76.5 46.5 68.5 56 57.5 60L56.5 63.5H43.5L42.5 60C31.5 56 23.5 46.5 23.5 32.5C23.5 17 34.5 6 50 6Z';
  const SHEET = 'M50 7.7C64.6 7.7 74.8 18 74.8 32.5C74.8 45.5 67.5 54.3 57.2 58.2C52.4 59.4 47.6 59.4 42.8 58.2C32.5 54.3 25.2 45.5 25.2 32.5C25.2 18 35.4 7.7 50 7.7Z';
  const HANDLE = 'M43.2 59.5H56.8C56.4 68 55.6 76 56.9 84.5C57.6 89.5 57.4 94.6 54.6 96.2H45.4C42.6 94.6 42.4 89.5 43.1 84.5C44.4 76 43.6 68 43.2 59.5Z';
  const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const t = k < 0 ? 0 : 255, p = Math.abs(k); r = Math.round(r + (t - r) * p); g = Math.round(g + (t - g) * p); b = Math.round(b + (t - b) * p);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1); };
  /* ручка: цилиндрическая светотень, накладки-щёчки, медальон */
  function handleSvg(col, ids) {
    return `<linearGradient id="${ids}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${shade(col, -.45)}"/><stop offset=".38" stop-color="${shade(col, .22)}"/><stop offset=".62" stop-color="${col}"/><stop offset="1" stop-color="${shade(col, -.5)}"/></linearGradient>`;
  }
  function handleBody(col, gid) {
    return `<path d="${HANDLE}" fill="url(#${gid})" stroke="${shade(col, -.6)}" stroke-width=".8"/>
      <path d="M46.6 62v32.6M53.4 62v32.6" stroke="${shade(col, -.55)}" stroke-width=".55" opacity=".7"/>
      <ellipse cx="50" cy="76" rx="3.1" ry="4.6" fill="#E9D9A6" stroke="#8E7A3E" stroke-width=".7"/><path d="M48.6 74.3l1.4 3.4 1.4-3.4" stroke="#8E7A3E" stroke-width=".7" fill="none"/>`;
  }
  /* собранная ракетка: основание + накладка (цвет), вид спереди */
  function paddle(rubber = '#E8202A', size = 80, { handle = '#C98A4B', rot = -28 } = {}) {
    const g = id('pg'), h = id('ph'), w = id('pw'), d = id('pd');
    return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" style="overflow:visible"><defs>
      <linearGradient id="${g}" x1=".15" y1="0" x2=".85" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient>
      <linearGradient id="${w}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F1D3A0"/><stop offset="1" stop-color="#C08A4E"/></linearGradient>
      <pattern id="${d}" width="2.4" height="2.4" patternUnits="userSpaceOnUse"><circle cx="1.2" cy="1.2" r=".42" fill="#000" opacity=".09"/></pattern>
      ${handleSvg(handle, h)}</defs>
      <g transform="rotate(${rot} 50 50)">
        <ellipse cx="52" cy="97" rx="12" ry="2.2" fill="#000" opacity=".22"/>
        <path d="${HEAD}" transform="translate(1.3 1.6)" fill="#7A4E26"/>
        <path d="${HEAD}" fill="url(#${w})" stroke="#6E431E" stroke-width=".7"/>
        ${handleBody(handle, h)}
        <path d="${SHEET}" fill="${rubber}"/>
        <path d="${SHEET}" fill="url(#${d})"/>
        <path d="${SHEET}" fill="url(#${g})" stroke="rgba(0,0,0,.35)" stroke-width=".6"/>
        <path d="M44.5 52.6h11" stroke="#fff" stroke-width="2.6" stroke-linecap="round" opacity=".28"/>
        <path d="M46 52.6c1.2-1 2.4 1 3.6 0s2.4 1 3.6 0" stroke="${shade(rubber, -.55)}" stroke-width=".8" fill="none" opacity=".8"/>
      </g></svg>`;
  }
  /* накладка как товар: лист по форме головы, видна губка (торец и отогнутый угол) */
  function rubber(col = '#E8202A', size = 80, { back = false, rot = -20 } = {}) {
    const g = id('rg'), s = id('rs'), p = id('rp'), d = id('rd'), c = id('rc');
    const SP = '#F2C35A';
    const sponge = `<pattern id="${p}" width="3" height="3" patternUnits="userSpaceOnUse"><circle cx=".8" cy=".9" r=".55" fill="#9A6A12" opacity=".35"/><circle cx="2.2" cy="2.3" r=".4" fill="#9A6A12" opacity=".28"/></pattern>`;
    if (back) return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" style="overflow:visible"><defs>${sponge}
      <linearGradient id="${s}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE29A"/><stop offset="1" stop-color="#D79A2E"/></linearGradient></defs>
      <g transform="rotate(${-rot} 50 50) translate(0 10)">
        <path d="${SHEET}" transform="translate(1.6 2)" fill="${shade(col, -.35)}"/>
        <path d="${SHEET}" fill="url(#${s})" stroke="#A8721C" stroke-width=".7"/><path d="${SHEET}" fill="url(#${p})"/>
        <path d="M36 50h28" stroke="#A8721C" stroke-width="1" stroke-dasharray="2 1.6" opacity=".6"/>
      </g></svg>`;
    return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" style="overflow:visible"><defs>${sponge}
      <linearGradient id="${g}" x1=".1" y1="0" x2=".9" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>
      <pattern id="${d}" width="2.4" height="2.4" patternUnits="userSpaceOnUse"><circle cx="1.2" cy="1.2" r=".42" fill="#000" opacity=".09"/></pattern>
      <clipPath id="${c}"><path clip-rule="evenodd" d="M-60 -60H220V160H-60ZM60.6 3.6L83.4 30.4L59.4 30.6Z"/></clipPath>
      <linearGradient id="${s}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE7A8"/><stop offset="1" stop-color="#C98A22"/></linearGradient></defs>
      <g transform="rotate(${rot} 50 50) translate(0 10)">
        <ellipse cx="52" cy="62" rx="27" ry="3.2" fill="#000" opacity=".25"/>
        <g clip-path="url(#${c})">
          <path d="${SHEET}" transform="translate(1.8 2.6)" fill="${SP}"/><path d="${SHEET}" transform="translate(1.8 2.6)" fill="url(#${p})"/>
          <path d="${SHEET}" transform="translate(.9 1.3)" fill="${shade(col, -.45)}"/>
          <path d="${SHEET}" fill="${col}"/><path d="${SHEET}" fill="url(#${d})"/>
          <path d="${SHEET}" fill="url(#${g})" stroke="rgba(0,0,0,.35)" stroke-width=".6"/>
        </g>
        <path class="peel" d="M60.6 4.6L83.4 29.4C77 27 70 26 64.5 21.5C61 18 59.6 11 60.6 4.6Z" fill="${col}" stroke="#A8721C" stroke-width=".6"/>
        <path d="M60.6 4.6L83.4 29.4C77 27 70 26 64.5 21.5C61 18 59.6 11 60.6 4.6Z" transform="translate(0 0.9)" fill="url(#${s})"/>
        <path d="M60.6 4.6L83.4 29.4C77 27 70 26 64.5 21.5C61 18 59.6 11 60.6 4.6Z" transform="translate(0 0.9)" fill="url(#${p})"/>
        <path d="M60.6 4.6L83.4 29.4" stroke="#000" stroke-width="1.6" opacity=".18"/>
        <rect x="41" y="49.6" width="18" height="5.4" rx="1.4" fill="#000" opacity=".22"/>
        <path d="M44 52.3c1.6-1.4 3.2 1.4 4.8 0s3.2 1.4 4.8 0" stroke="#fff" stroke-width="1" fill="none" opacity=".85"/>
        <circle cx="56.6" cy="52.3" r=".9" fill="#fff" opacity=".85"/>
      </g></svg>`;
  }
  /* основание без накладок: шпон, слои на торце (средний слой — цвет модели), цветная ручка */
  function blade(col = '#3A4390', size = 80, { rot = -28 } = {}) {
    const w = id('bw'), h = id('bh'), e = id('be');
    return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" style="overflow:visible"><defs>
      <linearGradient id="${w}" x1=".1" y1="0" x2=".9" y2="1"><stop offset="0" stop-color="#F6DDB0"/><stop offset=".55" stop-color="#E5BF85"/><stop offset="1" stop-color="#C9955A"/></linearGradient>
      <clipPath id="${e}"><path d="${HEAD}"/></clipPath>
      ${handleSvg(col, h)}</defs>
      <g transform="rotate(${rot} 50 50)">
        <ellipse cx="52" cy="97" rx="12" ry="2.2" fill="#000" opacity=".22"/>
        <path d="${HEAD}" transform="translate(2.4 2.8)" fill="#8B5A2B"/>
        <path d="${HEAD}" transform="translate(1.6 1.9)" fill="${col}"/>
        <path d="${HEAD}" transform="translate(.8 .95)" fill="#B9844A"/>
        <path d="${HEAD}" fill="url(#${w})" stroke="#8B5A2B" stroke-width=".7"/>
        <g clip-path="url(#${e})" fill="none" stroke="#9A6634" stroke-width=".6" opacity=".45">
          <path d="M33 8c-4 16-3 34 4 54M40 6c-3 18-2 36 3 58M47 5c-2 18-1 38 1 59M54 5c2 18 2 38 0 59M61 6c3 18 2 36-3 58M68 9c4 16 3 34-4 52"/>
          <path d="M44 22c2 3 2 7 0 10M57 36c-2 2-2 6 0 8" stroke-width=".5"/></g>
        ${handleBody(col, h)}
      </g></svg>`;
  }

  /* аватар: генеративный портрет + рамка лиги */
  function avatar(key, size = 48, { ring = null, round = true } = {}) {
    const src = AVATARS[key] || AVATARS.me;
    const r = round ? '50%' : Math.round(size * .28) + 'px';
    const border = ring ? `box-shadow:0 0 0 2px ${ring},0 0 14px ${ring}66;` : '';
    return `<span class="avatar" style="display:block;width:${size}px;height:${size}px;border-radius:${r};background:#111 url(${src}) center/cover;${border}"></span>`;
  }

  /* duotone-иконки: обводка + мягкая заливка, читаются на любом фоне */
  const P = {
    star: '<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
    bolt: '<path d="M13.5 2.5L5 13.5h6l-1 8 8.5-11h-6z"/>',
    fire: '<path d="M12 2.5s5.5 4.2 5.5 10a5.5 5.5 0 0 1-11 0c0-2.3 1.2-4 2.3-5 .3 2 1.3 3 2.4 3 1.4 0 1.8-1.6.8-8z"/>',
    check: '<path d="M4.5 12.5l5 5 10-11" fill="none"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none"/>',
    gift: '<rect x="3.5" y="9" width="17" height="11.5" rx="2.5"/><path d="M3.5 13h17M12 9v11.5M12 9S10.5 4 8 4a2.2 2.2 0 0 0 0 5zM12 9s1.5-5 4-5a2.2 2.2 0 0 1 0 5z" fill="none"/>',
    gear: '<circle cx="12" cy="12" r="3.2" fill="none"/><path d="M12 2.8l1.6 2.3 2.8-.6.6 2.8 2.3 1.6-1.2 2.6 1.2 2.6-2.3 1.6-.6 2.8-2.8-.6L12 21.2l-1.6-2.3-2.8.6-.6-2.8-2.3-1.6L5.9 12 4.7 9.4 7 7.8l.6-2.8 2.8.6z"/>',
    users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20a6.4 6.4 0 0 1 12.4 0z"/><path d="M16 5a3.4 3.4 0 0 1 0 6.6M17.6 14.4c2.2.6 3.7 2.4 3.9 5.6" fill="none"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.2" fill="none"/><circle cx="12" cy="12" r="1.2"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2" fill="none"/>',
    crown: '<path d="M3.5 8.5L7 12l5-6.5 5 6.5 3.5-3.5-1.6 10.5H5.1z"/>',
    chart: '<path d="M4 19.5V5M4 19.5h16" fill="none"/><path d="M8 16v-4M12.5 16V8M17 16v-6" fill="none"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none"/>',
    plus: '<path d="M12 5v14M5 12h14" fill="none"/>',
    play: '<path d="M7.5 4.5L19.5 12 7.5 19.5z"/>',
    pause: '<path d="M8.5 5v14M15.5 5v14" fill="none"/>',
    sound: '<path d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none"/>',
    music: '<circle cx="7" cy="17.5" r="2.7"/><circle cx="17.5" cy="15.5" r="2.7"/><path d="M9.7 17.5V7.5l10.5-2v10" fill="none"/>',
    vibe: '<rect x="7.5" y="3.5" width="9" height="17" rx="2.5"/><path d="M3.5 9v6M20.5 9v6" fill="none"/>',
    eye: '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.6" fill="none"/>',
    motion: '<path d="M3 12h4l3-7 4 14 3-7h4" fill="none"/>',
    back: '<path d="M14.5 5.5L8 12l6.5 6.5" fill="none"/>',
    share: '<circle cx="18" cy="5.5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="18.5" r="2.6"/><path d="M8.3 10.8l7.4-4M8.3 13.2l7.4 4" fill="none"/>',
    quest: '<rect x="4.5" y="3.5" width="15" height="17" rx="3"/><path d="M8.5 9l1.5 1.5L13 7.5M8.5 15h7" fill="none"/>',
    cal: '<rect x="3.5" y="5.5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3.5V7M16 3.5V7" fill="none"/>',
    shield: '<path d="M12 3l7.5 3v6c0 4.5-3.2 7.5-7.5 9-4.3-1.5-7.5-4.5-7.5-9V6z"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.4" fill="none"/>',
    swords: '<path d="M4 4l9 9M4 4h4l9 9-2 2-9-9zM20 4l-9 9M20 4h-4l-3 3M6 17l-2 3M18 17l2 3M5 15l4 4M19 15l-4 4" fill="none"/>',
    paddle: '<g transform="rotate(-38 12 12)"><path d="M12 2.3c3.7 0 6.3 2.6 6.3 6.2 0 2.9-1.8 5-4.3 5.9l-.3 1.1h-3.4l-.3-1.1C7.5 13.5 5.7 11.4 5.7 8.5c0-3.6 2.6-6.2 6.3-6.2z"/><path d="M10.4 15.6h3.2c-.2 1.9-.2 3.6.2 5.2.1.6-.3 1-.8 1h-2c-.5 0-.9-.4-.8-1 .4-1.6.4-3.3.2-5.2z"/></g>',
    hand: '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V12m0-1a1.5 1.5 0 0 1 3 0v4.5c0 3-2 5.5-5.5 5.5h-1c-2 0-3.2-1-4.3-2.6L5 15.4a1.5 1.5 0 0 1 2.4-1.8L9 15.5"/>',
    pads: '<g transform="rotate(-40 8.5 10)"><path d="M8.5 3.5c2 0 3.4 1.4 3.4 3.3 0 1.6-1 2.7-2.3 3.2l-.16.6h-1.82l-.16-.6c-1.34-.5-2.32-1.66-2.32-3.2 0-1.9 1.42-3.3 3.38-3.3z"/><path d="M7.65 10.6h1.7c-.1 1-.1 1.9.1 2.8q.15.9-.4 1t-.9-1c-.2-.9-.2-1.8-.1-2.8z"/></g><g transform="rotate(40 15.5 10)"><path d="M15.5 3.5c2 0 3.4 1.4 3.4 3.3 0 1.6-1 2.7-2.3 3.2l-.16.6h-1.82l-.16-.6c-1.34-.5-2.32-1.66-2.32-3.2 0-1.9 1.42-3.3 3.38-3.3z"/><path d="M14.65 10.6h1.7c-.1 1-.1 1.9.1 2.8q.15.9-.4 1t-.9-1c-.2-.9-.2-1.8-.1-2.8z"/></g>',
    ball: '<circle cx="12" cy="12" r="7.5"/><path d="M8 6c2.5 3 4.5 7.5 4.5 12" fill="none"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9" fill="none"/><path d="M20 4v4.5h-4.5" fill="none"/>',
    tg: '<path d="M21 4.5L2.8 11.6c-1 .4-1 1.6 0 1.9l4.6 1.5 1.8 5.5c.2.7 1.1.9 1.6.4l2.6-2.4 4.7 3.5c.6.4 1.4.1 1.6-.6L22.6 5.7c.2-.9-.7-1.6-1.6-1.2z"/><path d="M7.4 15l9.6-7-6.5 8.2" fill="none"/>',
    tstar: '<path d="M12 2.5l2.4 6.6 7 .3-5.5 4.4 1.9 6.8L12 16.7l-5.8 3.9 1.9-6.8-5.5-4.4 7-.3z"/>',
    expand: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" fill="none"/>'
  };
  function icon(name, { c = 'currentColor', fill = null, sw = 1.9 } = {}) {
    if (name === 'coin') return coin(24); if (name === 'gem') return gem(24); if (name === 'trophy') return trophy(26);
    if (name === 'starG') return star(26);
    const p = P[name] || P.star;
    const f = fill || (name === 'paddle' ? c : null) || 'color-mix(in srgb, ' + c + ' 26%, transparent)';
    return `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="${f}" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  }

  /* Две скрещенные ракетки — заменили мечи на кнопке «В бой» */
  function paddlePair(size = 28, c = '#3A1A00') {
    return `<span style="display:inline-block;width:${size}px;height:${size}px">${icon('pads', { c, sw: 1.7, fill: c })}</span>`;
  }

  /* иконки вкладок — «объёмные» цветные */
  function navIcon(k) {
    const g = id('ng');
    const grad = (a, b) => `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`;
    if (k === 'navShop') return `<svg viewBox="0 0 40 40" width="100%" height="100%">${grad('#7DFFB0', '#10B45A')}
      <path d="M8 15h24l-2 18a3 3 0 0 1-3 2.6H13A3 3 0 0 1 10 33z" fill="#07603A" transform="translate(0 2)"/>
      <path d="M8 15h24l-2 18a3 3 0 0 1-3 2.6H13A3 3 0 0 1 10 33z" fill="url(#${g})" stroke="#fff" stroke-opacity=".5" stroke-width="1.2"/>
      <path d="M14 15v-3a6 6 0 0 1 12 0v3" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
      <circle cx="20" cy="25" r="4.5" fill="#FFD54A" stroke="#A85300" stroke-width="1.2"/></svg>`;
    if (k === 'navPass') return `<svg viewBox="0 0 40 40" width="100%" height="100%">${grad('#D3B5FF', '#7337F0')}
      <path d="M6 12a3 3 0 0 1 3-3h22a3 3 0 0 1 3 3v3a3 3 0 0 0 0 6v3a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-3a3 3 0 0 0 0-6z" fill="#3B158C" transform="translate(0 2.5)"/>
      <path d="M6 12a3 3 0 0 1 3-3h22a3 3 0 0 1 3 3v3a3 3 0 0 0 0 6v3a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-3a3 3 0 0 0 0-6z" fill="url(#${g})" stroke="#fff" stroke-opacity=".5" stroke-width="1.2"/>
      <path d="M20 12.5l2 4 4.4.6-3.2 3 .8 4.4-4-2.1-4 2.1.8-4.4-3.2-3 4.4-.6z" fill="#FFD54A" stroke="#A85300" stroke-width="1"/></svg>`;
    if (k === 'navArena') return `<svg viewBox="0 0 40 40" width="100%" height="100%">${grad('#FF9A6B', '#E01E36')}
      <g transform="translate(0 2)" fill="#7E0A1A"><ellipse cx="14" cy="15" rx="8" ry="8.5" transform="rotate(-30 14 15)"/><ellipse cx="26" cy="15" rx="8" ry="8.5" transform="rotate(30 26 15)"/></g>
      <rect x="18.5" y="20" width="4" height="12" rx="2" fill="#C98A4B" transform="rotate(35 20 26)"/><rect x="17.5" y="20" width="4" height="12" rx="2" fill="#C98A4B" transform="rotate(-35 20 26)"/>
      <ellipse cx="14" cy="15" rx="8" ry="8.5" transform="rotate(-30 14 15)" fill="url(#${g})" stroke="#fff" stroke-opacity=".55" stroke-width="1.2"/>
      <ellipse cx="26" cy="15" rx="8" ry="8.5" transform="rotate(30 26 15)" fill="#2EC9FF" stroke="#fff" stroke-opacity=".55" stroke-width="1.2"/>
      <circle cx="20" cy="7" r="3.6" fill="#fff" stroke="#C9D2F5" stroke-width="1"/></svg>`;
    if (k === 'navRank') return `<svg viewBox="0 0 40 40" width="100%" height="100%">${grad('#FFF0A0', '#FF9500')}
      <path d="M12 7h16v8a8 8 0 0 1-16 0z" fill="#A85300" transform="translate(0 2)"/>
      <path d="M12 7h16v8a8 8 0 0 1-16 0z" fill="url(#${g})" stroke="#fff" stroke-opacity=".6" stroke-width="1.2"/>
      <path d="M12 9H7v2.5a5.5 5.5 0 0 0 5.5 5.5M28 9h5v2.5a5.5 5.5 0 0 1-5.5 5.5" fill="none" stroke="#FFC93A" stroke-width="2.4"/>
      <rect x="17.5" y="22" width="5" height="6" fill="#E0A000"/><rect x="12" y="28" width="16" height="6" rx="2" fill="url(#${g})" stroke="#A85300" stroke-width="1"/></svg>`;
    if (k === 'navGear') return `<svg viewBox="0 0 40 40" width="100%" height="100%">${grad('#BFD3FF', '#4A6BD8')}
      <g transform="translate(0 1.5)" fill="#24356E"><path d="M20 5.5l2.6 3.6 4.4-1 1 4.4 3.6 2.6-1.9 4.1 1.9 4.1-3.6 2.6-1 4.4-4.4-1L20 34.9l-2.6-3.6-4.4 1-1-4.4-3.6-2.6 1.9-4.1L8.4 17l3.6-2.6 1-4.4 4.4 1z"/><circle cx="20" cy="20" r="8"/></g>
      <path d="M20 5.5l2.6 3.6 4.4-1 1 4.4 3.6 2.6-1.9 4.1 1.9 4.1-3.6 2.6-1 4.4-4.4-1L20 34.9l-2.6-3.6-4.4 1-1-4.4-3.6-2.6 1.9-4.1 1.9-4.1-3.6-2.6 1-4.4 4.4 1z" fill="url(#${g})" stroke="#fff" stroke-opacity=".5" stroke-width="1.2" stroke-linejoin="round"/>
      <circle cx="20" cy="20" r="5" fill="#0E1638" stroke="#fff" stroke-opacity=".7" stroke-width="1.6"/></svg>`;
    return `<svg viewBox="0 0 40 40" width="100%" height="100%">${grad('#9BF6FF', '#1A86F0')}
      <circle cx="20" cy="15" r="7" fill="#0A3F8A" transform="translate(0 2)"/><path d="M7 34a13 13 0 0 1 26 0z" fill="#0A3F8A" transform="translate(0 2)"/>
      <circle cx="20" cy="15" r="7" fill="url(#${g})" stroke="#fff" stroke-opacity=".55" stroke-width="1.2"/>
      <path d="M7 34a13 13 0 0 1 26 0z" fill="url(#${g})" stroke="#fff" stroke-opacity=".55" stroke-width="1.2"/>
      <path d="M16 12a4 4 0 0 1 4-2" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`;
  }

  return { coin, gem, star, trophy, badge, chest, chestName: (kind) => t((CHEST[kind] || CHEST.gold).nk), CHEST, paddle, paddlePair, rubber, blade, avatar, icon, navIcon };
})();
