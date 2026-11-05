/* Shared shell/standalone HUD. The owner supplies snapshots, names and language. */
const MatchHUD = (() => {
  function mount(parent, initialOptions = {}) {
    const doc = parent.ownerDocument, win = doc.defaultView;
    const icons = globalThis.StrokeIcons;
    const make = (tag, className, into) => {
      const node = doc.createElement(tag); node.className = className;
      if (into) into.append(node); return node;
    };
    const text = (node, value) => { const s = String(value); if (node.textContent !== s) node.textContent = s; };
    const attr = (node, key, value) => { const s = String(value); if (node.getAttribute(key) !== s) node.setAttribute(key, s); };
    const number = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
    const bounded = (value, max = 100) => Math.max(0, Math.min(max, number(value)));
    const newer = (id, seen) => id != null && (seen == null || (id !== seen && (typeof id !== 'number' || typeof seen !== 'number' || id > seen)));
    const serving = (phase) => /^SERVE/i.test(String(phase));
    let options = { ...initialOptions }, snapshot = null, disposed = false, reduced = false;
    let active = -1, eventId = null, resultId = null, result = null, entered = false, speech = [], announceNow = false;
    const retiredMatches = new Set(), animations = new Map();
    const media = win.matchMedia('(prefers-reduced-motion: reduce)');
    const tr = (key, params) => String((typeof options.t === 'function' ? options.t(key, params) : key) ?? key);
    const name = (i) => String(options.names?.[i] ?? tr(i === 0 ? 'hud.near' : 'hud.far'));
    const root = make('section', 'match-hud', parent); root.hidden = true;
    const head = make('div', 'match-hud-head', root);
    const players = [1, -1].map((side) => {
      const el = make('div', 'match-hud-player', head); el.dataset.side = String(side);
      const identity = make('div', 'match-hud-identity', el);
      const playerName = make('b', 'match-hud-name', identity);
      const serve = make('span', 'match-hud-serve', identity);
      const body = make('div', 'match-hud-player-body', el);
      const energy = make('div', 'match-hud-energy', body);
      const caption = make('div', 'match-hud-energy-caption', energy);
      caption.append(icons.auxiliary('energy', doc));
      const value = make('b', 'match-hud-energy-value', caption);
      const low = make('span', 'match-hud-low', caption); low.hidden = true;
      const lowText = make('span', 'match-hud-low-text', low);
      const meter = make('div', 'match-hud-meter', energy);
      attr(meter, 'aria-valuemin', 0); attr(meter, 'aria-valuemax', 100);
      const trail = make('i', 'match-hud-energy-trail', meter);
      const fill = make('i', 'match-hud-energy-fill', meter);
      const fatigue = make('i', 'match-hud-energy-fatigue', meter);
      const unlimited = make('span', 'match-hud-unlimited', body);
      const recess = make('div', 'match-hud-score-window', body);
      const score = make('b', 'match-hud-score', recess);
      return { el, identity, playerName, serve, energy, value, low, lowText, meter, trail, fill, fatigue, unlimited, recess, score,
        lowOn: false, lastEnergy: null, contact: null, contactId: null, whiffId: null, missed: false };
    });
    const meta = make('div', 'match-hud-meta', root);
    const target = make('span', 'match-hud-target', meta);
    const level = make('span', 'match-hud-level', meta);
    const rally = make('span', 'match-hud-rally', meta);
    const marker = make('span', 'match-hud-marker', meta);
    marker.append(icons.auxiliary('matchPoint', doc));
    const markerText = make('span', 'match-hud-marker-text', marker);
    const lower = make('div', 'match-hud-lower', root);
    const exchange = make('div', 'match-hud-exchange', lower);
    players.forEach((p, i) => {
      const cell = p.cell = make('div', 'match-hud-contact', exchange); cell.dataset.side = String(i ? -1 : 1);
      p.icon = make('span', 'match-hud-technique-icon', cell);
      const copy = make('div', 'match-hud-contact-copy', cell);
      p.stroke = make('b', 'match-hud-technique', copy);
      p.metrics = make('div', 'match-hud-metrics', copy);
      p.speed = make('span', 'match-hud-speed', p.metrics);
      p.spin = make('span', 'match-hud-spin', p.metrics);
      p.whiff = make('span', 'match-hud-whiff', p.identity);
      p.whiff.append(icons.auxiliary('whiff', doc));
      p.whiffText = make('span', 'match-hud-whiff-text', p.whiff); p.whiff.hidden = true;
    });
    const link = make('span', 'match-hud-link'); link.append(icons.auxiliary('net', doc));
    exchange.insertBefore(link, players[1].cell);
    const resultEl = make('div', 'match-hud-result', lower); resultEl.hidden = true;
    const resultIcon = make('span', 'match-hud-result-icon', resultEl);
    const resultCopy = make('div', 'match-hud-result-copy', resultEl);
    const resultTitle = make('b', 'match-hud-result-title', resultCopy);
    const resultReason = make('span', 'match-hud-result-reason', resultCopy);
    const live = make('div', 'match-hud-sr', root);
    attr(live, 'role', 'status'); attr(live, 'aria-live', 'polite'); attr(live, 'aria-atomic', 'true');

    function cancel(node) {
      const animation = animations.get(node);
      if (animation) { animations.delete(node); animation.cancel(); }
    }
    function stopMotion() {
      animations.forEach(a => a.cancel()); animations.clear();
      root.getAnimations?.({ subtree: true }).forEach(a => a.cancel());
    }
    function animate(node, frames, duration) {
      cancel(node);
      if (disposed || root.hidden || snapshot?.paused || typeof node.animate !== 'function') return;
      const animation = node.animate(reduced ? [{ opacity: .65 }, { opacity: 1 }] : frames,
        { duration: reduced ? 80 : duration, easing: 'cubic-bezier(.2,.75,.3,1)' });
      animations.set(node, animation);
      const release = () => { if (animations.get(node) === animation) animations.delete(node); };
      animation.onfinish = release; animation.oncancel = release;
    }
    function syncMotion() {
      const next = !!options.reducedMotion || media.matches;
      if (next !== reduced) { reduced = next; root.classList.toggle('is-reduced', reduced); stopMotion(); }
    }
    function setIcon(holder, id, auxiliary = false) {
      const key = (auxiliary ? 'aux:' : 'stroke:') + id;
      if (holder.dataset.drawing === key) return;
      if (holder.firstChild) cancel(holder.firstChild.querySelector('.stroke-icon-motion'));
      holder.replaceChildren(auxiliary ? icons.auxiliary(id, doc) : icons.create(id, doc));
      holder.dataset.drawing = key;
    }
    function clearExchange() {
      active = -1; result = null; cancel(resultEl); cancel(link);
      players.forEach(p => {
        if (p.icon.firstChild) cancel(p.icon.firstChild.querySelector('.stroke-icon-motion'));
        p.contact = null; p.missed = false; cancel(p.whiff);
      });
    }
    function render() {
      syncMotion(); attr(root, 'aria-label', tr('hud.label'));
      if (!snapshot) return;
      const enabled = !!snapshot.staminaEnabled && !snapshot.free;
      root.hidden = !snapshot.visible;
      root.classList.toggle('is-free', !!snapshot.free);
      root.classList.toggle('is-paused', !!snapshot.paused);
      root.classList.toggle('has-contact', active !== -1);
      root.dataset.matchId = snapshot.matchId; root.dataset.rallyId = String(snapshot.rallyId);
      root.dataset.phase = String(snapshot.phase);
      root.dataset.activeSide = active === -1 ? '0' : String(active ? -1 : 1);
      players.forEach((p, i) => {
        const data = snapshot.players?.find(item => item?.side === (i ? -1 : 1));
        const capacity = bounded(data?.capacity ?? 100), energy = bounded(data?.energy, capacity);
        text(p.playerName, name(i)); attr(p.playerName, 'title', name(i));
        text(p.serve, tr('hud.serve')); p.serve.hidden = snapshot.server !== (i ? -1 : 1);
        text(p.score, Math.max(0, Math.floor(number(snapshot.score?.[i])))); p.recess.hidden = !!snapshot.free;
        p.energy.hidden = !enabled; p.unlimited.hidden = enabled; text(p.unlimited, tr('hud.unlimited'));
        if (enabled) attr(p.meter, 'role', 'meter'); else p.meter.removeAttribute('role');
        attr(p.meter, 'aria-label', tr('hud.energy', { name: name(i) }));
        attr(p.meter, 'aria-valuenow', Math.round(energy * 10) / 10);
        attr(p.meter, 'aria-valuetext', tr('hud.energyValue', { energy: Math.round(energy), capacity: Math.round(capacity) }));
        text(p.value, Math.round(energy)); text(p.lowText, tr('hud.low'));
        p.low.hidden = !p.lowOn; p.el.classList.toggle('is-low', p.lowOn);
        p.el.classList.toggle('is-limited', !!data?.limited && enabled);
        if (energy !== p.lastEnergy) p.meter.classList.toggle('is-recovering', p.lastEnergy == null || energy >= p.lastEnergy);
        const scale = `scaleX(${energy / 100})`, blocked = `scaleX(${(100 - capacity) / 100})`;
        if (p.fill.style.transform !== scale) { p.fill.style.transform = scale; p.trail.style.transform = scale; }
        if (p.fatigue.style.transform !== blocked) p.fatigue.style.transform = blocked;
        p.lastEnergy = energy;
        const contact = p.contact, known = contact && icons.ids.includes(contact.stroke);
        const entry = known && options.strokeCatalog?.find(item => item.id === contact.stroke);
        const color = entry?.col || 'var(--hud-neutral)';
        if (p.cell.style.getPropertyValue('--stroke') !== color) p.cell.style.setProperty('--stroke', color);
        setIcon(p.icon, contact ? contact.stroke : 'UNKNOWN');
        text(p.stroke, contact ? tr(known ? 'hud.stroke.' + contact.stroke : 'hud.unknown') : tr(snapshot.server === (i ? -1 : 1) ? 'hud.serve' : 'hud.receive'));
        attr(p.stroke, 'title', p.stroke.textContent);
        p.metrics.hidden = !contact;
        text(p.speed, contact && Number.isFinite(contact.kmh) ? tr('hud.kmh', { n: Math.round(contact.kmh) }) : '');
        text(p.spin, contact && Number.isFinite(contact.rps) ? tr('hud.rps', { n: Math.round(Math.abs(contact.rps)) }) : '');
        p.cell.classList.toggle('is-active', active === i);
        p.cell.classList.toggle('is-empty', !contact);
        p.cell.dataset.eventId = contact ? String(contact.eventId) : '';
        text(p.whiffText, tr('hud.whiff')); p.whiff.hidden = !p.missed;
        attr(p.whiff, 'aria-label', tr('hud.whiff'));
      });
      text(target, tr('hud.target', { n: Math.max(1, Math.floor(number(snapshot.target, 1))) })); target.hidden = !!snapshot.free;
      text(level, options.botLevel || ''); level.hidden = !options.botLevel; attr(level, 'title', options.botLevel || '');
      text(rally, tr('hud.rally', { n: Math.max(0, Math.floor(number(snapshot.rally))) }));
      const markerKey = snapshot.paused ? 'hud.paused' : 'hud.matchPoint';
      marker.hidden = !snapshot.paused && !snapshot.matchPoint;
      marker.classList.toggle('is-paused', !!snapshot.paused);
      marker.dataset.side = String(snapshot.matchPoint || 0); text(markerText, tr(markerKey));
      resultEl.hidden = !result; exchange.hidden = !!result;
      if (result) {
        resultEl.dataset.id = String(result.id); resultEl.dataset.side = String(result.who);
        const winner = result.winner === 1 || result.winner === -1 ? result.winner : result.who;
        text(resultTitle, tr(result.who === 0 ? 'hud.let' : result.winner ? 'hud.winner' : 'hud.point', { name: name((result.winner ? winner : result.who) === -1 ? 1 : 0) }));
        text(resultReason, typeof options.reason === 'function' ? options.reason(result.who, result.reason) ?? '' : '');
        attr(resultReason, 'title', resultReason.textContent);
        const why = String(result.reason || '');
        const kind = /net|\u0441\u0435\u0442\u043a/i.test(why) ? 'net' : /out|\u0430\u0443\u0442/i.test(why) ? 'out' : result.winner ? 'matchPoint' : 'point';
        setIcon(resultIcon, kind, true);
      } else { delete resultEl.dataset.id; text(resultTitle, ''); text(resultReason, ''); }
      const message = speech.map(item => {
        if (item.kind === 'score') return tr('hud.announceScore', { near: name(0), far: name(1), a: item.a, b: item.b });
        return tr(item.kind === 'serve' ? 'hud.announceServe' : 'hud.announceLow', { name: name(item.side === -1 ? 1 : 0) });
      }).join(' ');
      if (announceNow) { live.textContent = message; announceNow = false; } else text(live, message);
    }
    function update(incoming, nextOptions) {
      if (disposed) return;
      if (nextOptions) options = { ...options, ...nextOptions };
      const valid = incoming?.schema === 1 && typeof incoming.matchId === 'string' && Number.isFinite(incoming.seq);
      const newMatch = valid && (!snapshot || snapshot.matchId !== incoming.matchId);
      const fresh = valid && !retiredMatches.has(incoming.matchId) && (newMatch || incoming.seq > snapshot.seq);
      if (!fresh) { render(); return; }
      const previous = snapshot;
      if (newMatch) {
        if (previous) retiredMatches.add(previous.matchId);
        stopMotion(); clearExchange(); entered = false; speech = []; eventId = null; resultId = null;
        players.forEach(p => { p.contactId = null; p.whiffId = null; p.lowOn = false; p.lastEnergy = null; });
      }
      // Copy the small payload: standalone callers may reuse and mutate their arrays.
      snapshot = { ...incoming, score: [...(incoming.score || [])], players: (incoming.players || []).map(p => ({ ...p })) };
      const event = incoming.event, newEvent = event && newer(event.id, eventId);
      const serveEvent = newEvent && String(event.type).toLowerCase() === 'serve';
      const clear = newMatch || previous.rallyId !== snapshot.rallyId || serveEvent || (serving(snapshot.phase) && !serving(previous.phase));
      if (clear) clearExchange();
      if (newEvent) eventId = event.id;
      const atServe = serving(snapshot.phase) || serveEvent;
      // A restored serve may carry cached records. Consume their IDs without reviving them.
      if (atServe && incoming.result && newer(incoming.result.id, resultId)) resultId = incoming.result.id;
      const hits = [], misses = [], lows = [], scores = [];
      players.forEach((p, i) => {
        const side = i ? -1 : 1, contact = incoming.contacts?.[i], whiff = incoming.whiffs?.[i];
        if (contact && contact.matchId === snapshot.matchId && contact.rallyId === snapshot.rallyId && contact.side === side && newer(contact.eventId, p.contactId)) {
          p.contactId = contact.eventId;
          if (!atServe) { p.contact = { ...contact }; p.missed = false; hits.push(i); }
        } else if (!contact) p.contact = null;
        if (whiff && newer(whiff.id, p.whiffId)) {
          p.whiffId = whiff.id;
          if (!atServe && (!p.contact || p.contact.swingId !== whiff.swingId) && (!hits.includes(i) || (typeof whiff.id === 'number' && whiff.id > p.contact.eventId))) {
            p.missed = true; misses.push(i);
          }
        } else if (!whiff) p.missed = false;
        const state = snapshot.players.find(item => item.side === side);
        const energy = bounded(state?.energy, bounded(state?.capacity ?? 100));
        const low = !!snapshot.staminaEnabled && !snapshot.free && (energy < 25 || (p.lowOn && energy <= 30));
        if (low && !p.lowOn) lows.push(i); p.lowOn = low;
        if (!newMatch && !snapshot.free && snapshot.score[i] > previous.score[i]) scores.push(i);
      });
      const contacts = players.map(p => p.contact);
      if (contacts[0] && contacts[1]) {
        if (typeof contacts[0].eventId === 'number' && typeof contacts[1].eventId === 'number') active = contacts[0].eventId > contacts[1].eventId ? 0 : 1;
        else if (hits.length) active = newEvent && event.side === 1 ? 0 : hits[hits.length - 1];
      } else active = contacts[0] ? 0 : contacts[1] ? 1 : -1;
      let newResult = false;
      if (!atServe && incoming.result && newer(incoming.result.id, resultId)) {
        result = { ...incoming.result }; resultId = result.id; newResult = true;
        cancel(link);
        players.forEach(p => {
          p.missed = false; cancel(p.whiff);
          if (p.icon.firstChild) cancel(p.icon.firstChild.querySelector('.stroke-icon-motion'));
        });
      }
      const announce = [];
      if (!snapshot.free && (newMatch || snapshot.score.some((n, i) => n !== previous.score[i]))) announce.push({ kind: 'score', a: snapshot.score[0], b: snapshot.score[1] });
      const newServe = !result && serving(snapshot.phase) && (clear || snapshot.server !== previous.server);
      if (newServe) announce.push({ kind: 'serve', side: snapshot.server });
      lows.forEach(i => announce.push({ kind: 'low', side: i ? -1 : 1 }));
      if (announce.length) { speech = announce; announceNow = true; }
      render();
      if (root.hidden || snapshot.paused) { stopMotion(); return; }
      if (!entered) { entered = true; animate(root, [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], 220); }
      if (!result) {
        hits.forEach(i => { const m = icons.motion(players[i].contact.stroke); animate(players[i].icon.firstChild.querySelector('.stroke-icon-motion'), m.frames, m.duration); });
        if (hits.length) animate(link, [{ opacity: .5 }, { opacity: 1, offset: .4 }, { opacity: .5 }], 150);
      }
      misses.forEach(i => animate(players[i].whiff, [{ opacity: .4, transform: 'translateY(-2px)' }, { opacity: 1, transform: 'none' }], 160));
      lows.forEach(i => animate(players[i].low, [{ opacity: .5, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], 180));
      scores.forEach(i => animate(players[i].score, [{ opacity: .5, transform: 'translateY(-7px)' }, { opacity: 1, transform: 'none' }], 220));
      if (newResult) animate(resultEl, [{ opacity: .3, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], 200);
      if (newServe) animate(players[snapshot.server === -1 ? 1 : 0].serve, [{ opacity: .5, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], 180);
      if (snapshot.matchPoint && snapshot.matchPoint !== previous?.matchPoint) animate(marker, [{ opacity: .5, transform: 'translateY(2px)' }, { opacity: 1, transform: 'none' }], 180);
    }
    media.addEventListener('change', syncMotion); syncMotion();
    return { element: root, update, dispose() {
      if (disposed) return; disposed = true;
      media.removeEventListener('change', syncMotion); stopMotion(); root.remove();
      snapshot = null; result = null; speech = []; options = {}; retiredMatches.clear();
      players.forEach(p => { p.contact = null; });
    } };
  }
  return Object.freeze({ mount });
})();
globalThis.MatchHUD = MatchHUD;
