/* Shared, shot-relative 32px motion diagrams. */
const StrokeIcons = (() => {
  // All diagrams use one coordinate system: the outgoing horizontal direction
  // points right, vertical is up, and the spin components use the same
  // shot-relative convention as measureShotSpin in the engine.
  const ball = (x, y, r = 3) => `<circle class="stroke-icon-ball" cx="${x}" cy="${y}" r="${r}" fill="var(--hud-ball,#f7fbff)" stroke="none"/>`;
  const ids = Object.freeze(['DRIVE','LOOP','COUNTER','SMASH','SIDE','HOOK','FADE','FLICK','BANANA','PUSH',
    'CHOP','CHOP_BLOCK','BLOCK','LOB','DROP','SERVE_TOP','SERVE_BACK','SERVE_SIDE','SERVE_FAST','SERVE_NO_SPIN']);
  // Catalog examples, not a claim about every contact. Unknown spin remains
  // distinct from a measured zero; SIDE and SERVE_SIDE show one example sign.
  const profiles = Object.freeze({
    DRIVE:['top',1,'level'], COUNTER:['top',1,'level'], LOOP:['top',1,'up'], FLICK:['top',1,'up'],
    SMASH:['unknown',0,'down'], SIDE:['side',1,'level'], HOOK:['side',1,'level'], FADE:['side',-1,'level'],
    BANANA:['mixed',1,'up'], PUSH:['top',-1,'level'], CHOP:['top',-1,'level'], CHOP_BLOCK:['top',-1,'level'],
    BLOCK:['unknown',0,'level'], LOB:['top',1,'up'], DROP:['unknown',0,'level'],
    SERVE_TOP:['top',1,'level'], SERVE_BACK:['top',-1,'level'], SERVE_SIDE:['side',1,'level'],
    SERVE_FAST:['unknown',0,'level'], SERVE_NO_SPIN:['none',0,'level']
  });
  const vec = v => v && [v.x, v.y, v.z].every(Number.isFinite);
  function profile(id, contact) {
    const base = Object.hasOwn(profiles, id) ? profiles[id] : ['unknown', 0, 'unknown'];
    let [plane, direction, flight] = base, source = 'static';
    // Components in shot coordinates: longitudinal, vertical, topspin axis.
    let axis = plane === 'top' ? [0, 0, 1] : plane === 'side' ? [0, 1, 0] :
      plane === 'mixed' ? [0, Math.SQRT1_2, Math.SQRT1_2] : null;
    if (contact && vec(contact.velocity)) {
      const v = contact.velocity, horizontal = Math.hypot(v.x, v.z);
      flight = horizontal < 1e-8 && Math.abs(v.y) < 1e-8 ? 'unknown' :
        v.y > horizontal * .18 ? 'up' : v.y < -horizontal * .18 ? 'down' : 'level';
      source = 'measured';
      if (vec(contact.angularVelocity) && Math.hypot(contact.angularVelocity.x, contact.angularVelocity.y, contact.angularVelocity.z) < 1e-8) {
        plane = 'none'; direction = 0; axis = null;
      } else if (vec(contact.angularVelocity) && horizontal > 1e-8) {
        const w = contact.angularVelocity, fx = v.x / horizontal, fz = v.z / horizontal;
        const top = w.x * fz - w.z * fx, side = w.y, cork = w.x * fx + w.z * fz;
        const total = Math.hypot(top, side, cork);
        const reference = Math.abs(top) > 1e-8 ? top : Math.abs(side) > 1e-8 ? side : cork;
        direction = Math.sign(reference);
        axis = [cork, side, top].map(n => n * direction / total);
        const significant = axis.map(n => Math.abs(n) > .15);
        plane = significant.filter(Boolean).length > 1 ? 'mixed' : significant[0] ? 'cork' : significant[1] ? 'side' : 'top';
      } else { plane = 'unknown'; direction = 0; axis = null; }
    }
    return { plane, direction, flight, axis, source };
  }
  function spinArc(p) {
    // Orthographic view of the same 3D plane for every shot. A small, fixed
    // depth projection keeps a vertical/longitudinal axis visible edge-on.
    // The complete angular-velocity vector determines the plane; reversing it
    // reverses only the arrow. A positive topspin is clockwise in this view.
    const n = [p.axis[0], p.axis[1], -p.axis[2]];
    const reference = Math.abs(n[0]) < .9 ? [1, 0, 0] : [0, 1, 0];
    const dot = reference[0]*n[0] + reference[1]*n[1] + reference[2]*n[2];
    const u = reference.map((v, i) => v - dot * n[i]), len = Math.hypot(...u);
    for (let i = 0; i < 3; i++) u[i] /= len;
    const v = [n[1]*u[2] - n[2]*u[1], n[2]*u[0] - n[0]*u[2], n[0]*u[1] - n[1]*u[0]];
    const project = angle => {
      const a = Math.cos(angle), b = Math.sin(angle);
      const x = u[0]*a + v[0]*b, y = u[1]*a + v[1]*b, z = u[2]*a + v[2]*b;
      return [9 + 6.6 * (x + .3*z), 16 + 6.6 * (-y + .3*z)];
    };
    const points = Array.from({ length: 25 }, (_, i) => project(p.direction * (-2.15 + 4.3 * i / 24)));
    const end = points.at(-1), before = points.at(-2), dx = end[0] - before[0], dy = end[1] - before[1];
    const length = Math.hypot(dx, dy) || 1, ux = dx / length, uy = dy / length;
    const left = [end[0] - 2.8*ux + 1.6*uy, end[1] - 2.8*uy - 1.6*ux];
    const right = [end[0] - 2.8*ux - 1.6*uy, end[1] - 2.8*uy + 1.6*ux];
    const fmt = point => point.map(n => n.toFixed(2)).join(' ');
    return points.map((point, i) => `${i ? 'L' : 'M'}${fmt(point)}`).join(' ') +
      ` M${fmt(left)} L${fmt(end)} L${fmt(right)}`;
  }
  function diagram(p) {
    const ballMarkup = '<circle class="stroke-icon-ball" cx="9" cy="16" r="5" fill="#FFFFFF" stroke="#17212b" stroke-width=".7"/>';
    const spin = p.axis ? `<path class="stroke-icon-spin" data-plane="${p.plane}" data-direction="${p.direction}" d="${spinArc(p)}" stroke="#F6B64B"/>` : '';
    const d = p.flight === 'up' ? 'M20 17 L29 10 M25 10 L29 10 L28 14' :
      p.flight === 'down' ? 'M20 15 L29 22 M25 22 L29 22 L28 18' :
      p.flight === 'level' ? 'M20 16 H29 M26 13 L29 16 L26 19' : '';
    const flight = d ? `<path class="stroke-icon-flight" data-flight="${p.flight}" d="${d}" stroke="#69CFFA"/>` : '';
    return ballMarkup + spin + flight;
  }
  const auxiliary = Object.freeze({
    energy: '<path d="m18 3-12 16h9l-1 10 12-17h-9Z"/>',
    whiff: '<path d="M10 20 5 27m5-7c-7-4-3-15 3-14 8 2 7 11 2 14ZM24 7l5 5m0-5-5 5M24 20h4"/>',
    net: '<path d="M4 8v18m24-18v18M4 11h24M4 23h24M10 11v12m6-12v12m6-12v12M4 17h24"/>',
    out: '<path d="M4 10v16h19M9 14v7h9M17 6l10 9m-5-1 5 1-1-5"/>' + ball(26, 24, 3),
    point: '<path d="m16 3 12 13-12 13L4 16ZM10 16l4 4 8-9"/>',
    matchPoint: '<path d="M7 29V5m0 1h16l-4 5 4 5H7m18-11 3-2m-2 8h4M12 20l3 2 3-2-1 4 3 2h-4l-1 3-1-3h-4l3-2Z"/>'
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
    ids, auxiliaryIds: Object.freeze(Object.keys(auxiliary)), profile,
    create(id, doc = document, contact = null) {
      const known = Object.hasOwn(profiles, id), p = profile(id, contact);
      const svg = make(diagram(p), known ? id : 'UNKNOWN', doc);
      svg.dataset.spin = p.plane; svg.dataset.direction = String(p.direction);
      svg.dataset.flight = p.flight; svg.dataset.source = p.source;
      return svg;
    },
    auxiliary(id, doc = document) { const known = Object.hasOwn(auxiliary, id); return make(known ? auxiliary[id] : fallback, known ? id : 'UNKNOWN', doc); },
    motion() { return { frames: [{ opacity: .55 }, { opacity: 1 }], duration: 150 }; }
  });
})();
globalThis.StrokeIcons = StrokeIcons;
