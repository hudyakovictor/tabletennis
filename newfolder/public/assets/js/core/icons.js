// Inline SVG icon set (stroke-based, 24x24). No external icon font/CDN.
const P = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
  messages: '<path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 0 1 11 4h2a8 8 0 0 1 8 8Z"/><path d="M8.5 11h7M8.5 14.5h4.5"/>',
  activity: '<path d="M3 12h3.5l2.5-7 4 14 2.5-7H21"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.6 3 7.9 7 9.5 4-1.6 7-4.9 7-9.5V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  trending: '<path d="m3 17 6-6 4 4 7-8"/><path d="M15 7h5v5"/>',
  flask: '<path d="M9 3h6M10 3v5.2L5.4 17A2.5 2.5 0 0 0 7.6 21h8.8a2.5 2.5 0 0 0 2.2-4L14 8.2V3"/><path d="M7.4 15h9.2"/>',
  pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  rocket: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M14.5 4.5C17 3 21 3 21 3s0 4-1.5 6.5L14 15l-5-5 5.5-5.5Z"/><circle cx="16" cy="8" r="1.4"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M2.8 20c.4-3.2 3-5.2 6.2-5.2s5.8 2 6.2 5.2"/><path d="M16.5 5.4a3 3 0 0 1 0 5.8M18.5 14.8c2 .6 3.3 2.3 3.5 4.4"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2.4"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/><path d="M12 14.5v2.5"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/>',
  bell: '<path d="M18 15V10a6 6 0 1 0-12 0v5l-1.6 3h15.2L18 15Z"/><path d="M10 21h4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.4 6.4"/><path d="M20 4v7h-7"/>',
  theme: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  collapse: '<path d="M15 5v14M19 12h-9M7 9l-3 3 3 3"/>',
  logout: '<path d="M15 5h3.5A1.5 1.5 0 0 1 20 6.5v11A1.5 1.5 0 0 1 18.5 19H15"/><path d="M11 12H4M7.5 8.5 4 12l3.5 3.5"/>',
  chevronRight: '<path d="m9 5 7 7-7 7"/>',
  chevronLeft: '<path d="m15 5-7 7 7 7"/>',
  chevronDown: '<path d="m5 9 7 7 7-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m4 12.5 5 5L20 6.5"/>',
  alert: '<path d="M12 4 2.8 20h18.4L12 4Z"/><path d="M12 9.5v5M12 17.5v.5"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.5M12 7.6v.6"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  download: '<path d="M12 3v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4 19h16"/>',
  external: '<path d="M14 4h6v6"/><path d="m20 4-9 9"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.5V12l3.2 2"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.5M7 16.5h.5"/>',
  database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
  ticket: '<path d="M4 8.5V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.5a3.5 3.5 0 0 0 0 7V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.5a3.5 3.5 0 0 0 0-7Z"/><path d="M13 8v8"/>',
  news: '<path d="M4 5h12a2 2 0 0 1 2 2v12H6a2 2 0 0 1-2-2V5Z"/><path d="M18 8h2v9a2 2 0 0 1-2 2"/><path d="M8 9h5M8 13h5M8 16h3"/>',
  zap: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2.5"/><path d="M10 2v3M14 2v3M10 19v3M14 19v3M2 10h3M2 14h3M19 10h3M19 14h3"/>',
  dollar: '<path d="M12 3v18"/><path d="M16.5 7.5c0-1.9-2-3-4.5-3s-4.5 1.1-4.5 3S9.5 11 12 11s4.5 1.1 4.5 3-2 3-4.5 3-4.5-1.1-4.5-3"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  filter: '<path d="M4 5h16l-6 7.5V19l-4 2v-8.5L4 5Z"/>',
  more: '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5A1.5 1.5 0 0 0 5.5 15"/>',
  key: '<circle cx="8" cy="12" r="4"/><path d="m12 12 9 0M17 12v3M20 12v2.5"/>',
  file: '<path d="M6 3h7l5 5v13H6V3Z"/><path d="M13 3v5h5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M4.5 20c.6-3.5 3.5-5.6 7.5-5.6s6.9 2.1 7.5 5.6"/>',
  globe: '<circle cx="12" cy="12" r="8.6"/><path d="M3.6 9h16.8M3.6 15h16.8"/><path d="M12 3.4c2 2.4 3 5.4 3 8.6s-1 6.2-3 8.6c-2-2.4-3-5.4-3-8.6s1-6.2 3-8.6Z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7L13.5 18.5"/>',
  arrowUpRight: '<path d="M7 17 17 7M9 7h8v8"/>',
  clockRing: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7v5l3 2"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2.4"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  beaker: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3"/>',
  wifi: '<path d="M4 9a13 13 0 0 1 16 0M6.5 12.5a9 9 0 0 1 11 0M9.5 16a4.5 4.5 0 0 1 5 0"/><circle cx="12" cy="19.5" r="1"/>',
  flag: '<path d="M5 21V4h10l-1.5 3.5L15 11H5"/><path d="M5 11h11l-1.5 4L16 19H5"/>',
  scale: '<path d="M12 3v18M6 21h12"/><path d="m5 8 3.5-3L12 8M12 8l3.5-3L19 8"/><path d="M2.5 14a3 3 0 0 0 5 0L5 8l-2.5 6ZM16.5 14a3 3 0 0 0 5 0L19 8l-2.5 6Z"/>',
};

export function icon(name, cls = '') {
  const path = P[name] || P.info;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((node) => {
    const name = node.getAttribute('data-icon');
    if (!name) return;
    node.innerHTML = icon(name);
    node.removeAttribute('data-icon');
  });
}

export const iconNames = Object.keys(P);
