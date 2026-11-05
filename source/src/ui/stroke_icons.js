/* Authored 32px silhouettes. Technique colour belongs to the supplied catalog. */
const StrokeIcons = (() => {
  const ball = (x, y, r = 3) => `<circle class="stroke-icon-ball" cx="${x}" cy="${y}" r="${r}" fill="var(--hud-ball,#f7fbff)" stroke="none"/>`;
  const toss = '<path class="stroke-icon-toss" d="M5 26V16m-2.5 3L5 16l2.5 3"/>';
  const drawings = Object.freeze({
    DRIVE: '<path d="M3 22h16q6 0 9-5M24 17h4v4M10 12q5-6 11-2m-4-3 4 3-4 1"/>' + ball(15, 17),
    LOOP: '<path d="M4 27C7 16 11 5 22 6m-4-3 4 3-3 4M13 14c5-4 11-1 11 4"/>' + ball(25, 22),
    COUNTER: '<path d="M3 10h19l-4-4m4 4-4 4M29 23H10l4-4m-4 4 4 4"/>' + ball(8, 16, 3.2),
    SMASH: '<path d="m8 4 15 16-8-3 9 11 4-9-5 1M4 10l7 8M3 17l4 4"/>' + ball(16, 10),
    SIDE: '<path d="M3 16h6m14 0h6M8 9C24 2 31 16 22 23m0-5v5h5M11 24l-5-1 2-5"/>' + ball(16, 16),
    HOOK: '<path d="M5 26V14C5 2 27 1 27 14c0 8-9 9-11 3m-3 3 3-3 4 2"/>' + ball(13, 10),
    FADE: '<path d="M27 27C22 24 29 10 19 6 9 2 2 12 8 18m-1-5 1 5 5-1M20 24l4 2"/>' + ball(19, 16),
    FLICK: '<path d="M4 25h8l4-8 5 3 6-12m-5 1 5-1 1 5M10 28l3-3"/>' + ball(13, 10),
    BANANA: '<path d="M25 8C9-3 0 16 10 25c7 6 18-1 15-9-2-5-8-4-9 0m-2-4 2 4 4-1"/>' + ball(21, 6, 2.8),
    PUSH: '<path d="M3 16h21l-4-3m4 3-4 3M9 23h17m-4-3 4 3-4 3"/>' + ball(12, 11),
    CHOP: '<path d="M6 4l19 22m-6-1 6 1-1-6M7 19l8 9M3 21l4 5"/>' + ball(20, 11, 3.2),
    CHOP_BLOCK: '<path d="M3 11h10M17 6l-3 12M14 18l11 8m-5 0h5v-5M7 24l7 4"/>' + ball(24, 13),
    BLOCK: '<path d="M3 10h12l-3-3m3 3-3 3M20 5v22M15 23H8l3-3m-3 3 3 3"/>' + ball(14, 17, 2.8),
    LOB: '<path d="M3 27C4-4 25-4 29 24m-4-3 4 3 1-5"/>' + ball(17, 7, 3.2),
    DROP: '<path d="M3 15q7-16 15-2t4 12m-3-4 3 4 4-3M13 20v9m-3-7h6"/>' + ball(26, 13, 2.8),
    SERVE_TOP: toss + '<path d="M11 23C12 9 23 5 28 12m-1-5 1 5-5-1M15 27q8 0 10-8"/>' + ball(5, 10, 2.5) + ball(21, 16),
    SERVE_BACK: toss + '<path d="M11 17q7 9 17 3m-5-1 5 1-2 4M13 27h10l-3-3"/>' + ball(5, 10, 2.5) + ball(21, 12),
    SERVE_SIDE: toss + '<path d="M12 11c17-7 24 14 6 14m3-4-3 4 5 2M13 18h4m8 0h4"/>' + ball(5, 10, 2.5) + ball(21, 17),
    SERVE_FAST: toss + '<path d="M11 22h18l-4-4m4 4-4 4M12 26h7M12 18h4"/>' + ball(5, 10, 2.5) + ball(21, 14, 2.8),
    SERVE_NO_SPIN: toss + '<path d="M12 25h4m5 0h7M12 7h3m11 0h3"/>' + ball(5, 10, 2.5) + ball(21, 16, 4.5)
  });
  const auxiliary = Object.freeze({
    energy: '<path d="m18 3-12 16h9l-1 10 12-17h-9Z"/>',
    whiff: '<path d="M10 20 5 27m5-7c-7-4-3-15 3-14 8 2 7 11 2 14ZM24 7l5 5m0-5-5 5M24 20h4"/>',
    net: '<path d="M4 8v18m24-18v18M4 11h24M4 23h24M10 11v12m6-12v12m6-12v12M4 17h24"/>',
    out: '<path d="M4 10v16h19M9 14v7h9M17 6l10 9m-5-1 5 1-1-5"/>' + ball(26, 24, 3),
    point: '<path d="m16 3 12 13-12 13L4 16ZM10 16l4 4 8-9"/>',
    matchPoint: '<path d="M7 29V5m0 1h16l-4 5 4 5H7m18-11 3-2m-2 8h4M12 20l3 2 3-2-1 4 3 2h-4l-1 3-1-3h-4l3-2Z"/>'
  });
  const motion = Object.freeze({
    DRIVE: ['translateX(-3px) scale(.97)', 'translateX(2px) scale(1.03)', 150],
    LOOP: ['translateY(3px) scale(.97)', 'translateY(-3px) scale(1.03)', 210],
    COUNTER: ['translateX(3px) scale(.97)', 'translateX(-3px) scale(1.03)', 140],
    SMASH: ['translateY(-3px) scale(1.03,.97)', 'translateY(3px) scale(.97,1.03)', 150],
    SIDE: ['translateX(-3px) scale(.97)', 'translateX(3px) scale(1.03)', 180],
    HOOK: ['translate(-2px,2px) rotate(-8deg) scale(.97)', 'translate(2px,-1px) rotate(4deg) scale(1.03)', 200],
    FADE: ['translate(2px,2px) rotate(8deg) scale(.97)', 'translate(-2px,-1px) rotate(-4deg) scale(1.03)', 200],
    FLICK: ['translateY(2px) rotate(-6deg) scale(.97)', 'translateY(-2px) rotate(3deg) scale(1.03)', 140],
    BANANA: ['translate(-2px,1px) rotate(-9deg) scale(.97)', 'translate(1px,-2px) rotate(5deg) scale(1.03)', 210],
    PUSH: ['translateX(-2px) scale(.97)', 'translateX(1px) scale(1.01)', 180],
    CHOP: ['translate(-2px,-3px) scale(.97)', 'translate(2px,2px) scale(1.03)', 180],
    CHOP_BLOCK: ['translateY(-1px) scale(.97)', 'translate(1px,2px) scale(1.01)', 160],
    BLOCK: ['translateX(1px) scale(.97)', 'translateX(-1px) scale(1.01)', 150],
    LOB: ['translateY(3px) scale(.97)', 'translateY(-3px) scale(1.02)', 220],
    DROP: ['translateY(-2px) scale(.97)', 'translateY(2px) scale(1.01)', 200],
    SERVE_TOP: ['translateY(2px) scale(.97)', 'translate(1px,-2px) rotate(3deg) scale(1.03)', 180],
    SERVE_BACK: ['translateY(-2px) scale(.97)', 'translate(1px,2px) rotate(-3deg) scale(1.02)', 180],
    SERVE_SIDE: ['translateY(1px) scale(.97)', 'translateX(3px) rotate(3deg) scale(1.03)', 180],
    SERVE_FAST: ['translateX(-3px) scale(.97)', 'translateX(3px) scale(1.03)', 140],
    SERVE_NO_SPIN: ['translateX(-2px) scale(.97)', 'translateX(2px) scale(1.01)', 170]
  });
  const fallback = '<path d="M3 16h4m18 0h4"/>' + ball(16, 16, 4);
  const make = (markup, id, doc) => {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 32 32');
    svg.setAttribute('width', '32'); svg.setAttribute('height', '32');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false'); svg.setAttribute('class', 'stroke-icon');
    svg.dataset.icon = id;
    svg.innerHTML = `<g class="stroke-icon-motion">${markup}</g>`;
    return svg;
  };
  return Object.freeze({
    ids: Object.freeze(Object.keys(drawings)), auxiliaryIds: Object.freeze(Object.keys(auxiliary)),
    create(id, doc = document) { const known = Object.hasOwn(drawings, id); return make(known ? drawings[id] : fallback, known ? id : 'UNKNOWN', doc); },
    auxiliary(id, doc = document) { const known = Object.hasOwn(auxiliary, id); return make(known ? auxiliary[id] : fallback, known ? id : 'UNKNOWN', doc); },
    motion(id) { const m = Object.hasOwn(motion, id) ? motion[id] : motion.BLOCK; return { frames: [{ transform: m[0] }, { transform: m[1], offset: .45 }, { transform: 'none' }], duration: m[2] }; }
  });
})();
globalThis.StrokeIcons = StrokeIcons;
