/* Shared shell/standalone HUD. The owner supplies snapshots, names and language. */
const MatchHUD = (() => {
  // Presentation only: bounded contact IDs and aggregates, never a profile or journal.
  function createSummary() {
    const ids = new Set(globalThis.StrokeIcons?.ids || []), seen = new Set();
    const metric = () => ({ n: 0, sum: 0, max: null });
    const players = [1, -1].map(side => ({ side, hits: 0, byStroke: Object.create(null), speed: metric(), spin: metric() }));
    const count = n => Number.isSafeInteger(n) && n >= 0 ? n : null;
    const value = n => Number.isFinite(n) && n >= 0 ? n : null;
    let matchId = null, seq = -1, eventId = 0, retiredId = 0, started = false, partial = false, recovered = false, bestRally = null, frozen = null;
    function accept(snapshot) {
      if (frozen || snapshot?.schema !== 1 || !snapshot.matchId || typeof snapshot.matchId !== 'string' ||
          count(snapshot.seq) === null || count(snapshot.rallyId) === null || snapshot.phase === 'REPLAY' ||
          matchId && matchId !== snapshot.matchId || snapshot.seq <= seq) return false;
      const event = snapshot.event, nextId = count(event?.id);
      if (!matchId) {
        matchId = snapshot.matchId;
        started = snapshot.seq === 1 && nextId === 1 && event.type === 'serve' &&
          snapshot.score?.length === 2 && snapshot.score.every(n => n === 0) && !snapshot.contacts?.some(Boolean);
      }
      seq = snapshot.seq;
      if (nextId === null || nextId < eventId || nextId > eventId + 1) partial = true;
      eventId = Math.max(eventId, nextId || 0);
      if (count(snapshot.rally) !== null) bestRally = Math.max(bestRally || 0, snapshot.rally);
      const contacts = (snapshot.contacts || []).filter((c, i) => c && c.matchId === matchId && c.rallyId === snapshot.rallyId &&
        c.side === (i ? -1 : 1) && count(c.eventId) !== null && c.eventId > 0 && (nextId === null || c.eventId <= nextId))
        .sort((a, b) => a.eventId - b.eventId);
      if (['hit', 'contact'].includes(event?.type) && !contacts.some(c => c.eventId === nextId && c.side === event.side)) partial = true;
      for (const c of contacts) {
        if (c.eventId <= retiredId || seen.has(c.eventId)) continue;
        seen.add(c.eventId);
        if (seen.size > 256) { retiredId = Math.max(retiredId, Math.min(...seen)); seen.delete(retiredId); }
        const p = players[c.side === 1 ? 0 : 1];
        if (p.hits >= 1000000) { partial = true; continue; }
        p.hits++;
        const stroke = ids.has(c.stroke) ? c.stroke : 'UNKNOWN';
        p.byStroke[stroke] = (p.byStroke[stroke] || 0) + 1;
        for (const [key, n] of [['speed', c.kmh], ['spin', c.rps]]) {
          const m = p[key];
          if (value(n) !== null && Number.isFinite(m.sum + n)) { m.n++; m.sum += n; m.max = Math.max(m.max || 0, n); }
        }
      }
      return true;
    }
    function freeze(end = {}) {
      if (frozen) return frozen;
      const totals = [end.stats, end.ai];
      const complete = started && !partial && !recovered && players.every((p, i) => (count(totals[i]?.shots) ?? 0) <= p.hits);
      const summarize = (p, i) => {
        const engine = totals[i], engineHits = count(engine?.shots);
        const hits = complete ? p.hits : (p.hits || engineHits !== null) ? Math.max(p.hits, engineHits || 0) : null;
        const byStroke = { ...p.byStroke };
        if (!p.hits && engine?.byStroke && typeof engine.byStroke === 'object') {
          for (const [id, n] of Object.entries(engine.byStroke).slice(0, 100)) {
            if (count(n) === null || !n) continue;
            const key = ids.has(id) ? id : 'UNKNOWN';
            byStroke[key] = Math.min(1000000, (byStroke[key] || 0) + n);
          }
        }
        const measure = key => {
          const m = p[key];
          let avg = m.n ? m.sum / m.n : null, max = m.max;
          if (!m.n && hits > 0) {
            if (key === 'speed') {
              const maximum = value(i ? engine?.maxOut : engine?.maxSpeed);
              // Player maxSpeed is already km/h; AI maxOut is recorded in m/s.
              max = maximum === null ? null : value(maximum * (i ? 3.6 : 1));
            } else if (!i) max = value(engine?.maxSpin);
          }
          return Object.freeze({ avg, max, samples: m.n,
            coverage: avg === null && max === null ? 'missing' : complete && m.n === p.hits ? 'complete' : 'partial' });
        };
        return Object.freeze({ side: p.side, hits, observedHits: p.hits,
          coverage: hits === null ? 'missing' : complete ? 'complete' : 'partial',
          byStroke: Object.freeze(byStroke), strokeCoverage: complete && !byStroke.UNKNOWN ? 'complete' : Object.keys(byStroke).length ? 'partial' : 'missing',
          speed: measure('speed'), spin: measure('spin') });
      };
      const summaryPlayers = players.map(summarize), engineRally = count(end.bestRally);
      const rally = engineRally === null ? bestRally : Math.max(bestRally || 0, engineRally);
      const hasData = !!matchId || rally !== null || summaryPlayers.some(p => p.hits !== null || Object.keys(p.byStroke).length);
      frozen = Object.freeze({ schema: 1, matchId, recovered, coverage: complete ? 'complete' : hasData ? 'partial' : 'missing',
        bestRally: rally, bestRallyCoverage: rally === null ? 'missing' : complete ? 'complete' : 'partial', players: Object.freeze(summaryPlayers) });
      return frozen;
    }
    return Object.freeze({ accept, recover() { if (!frozen) { recovered = true; partial = true; } }, freeze });
  }

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
    const meta = make('div', 'match-hud-meta'); head.insertBefore(meta, players[1].el);
    const target = make('span', 'match-hud-target', meta);
    const rally = make('span', 'match-hud-rally', meta);
    const marker = make('span', 'match-hud-marker', meta);
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
    const resultEl = make('div', 'match-hud-result', meta); resultEl.hidden = true;
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
    function setIcon(holder, id, auxiliary = false, contact = null) {
      const key = (auxiliary ? 'aux:' : 'stroke:') + id + (auxiliary ? '' : JSON.stringify(icons.profile(id, contact)));
      if (holder.dataset.drawing === key) return;
      if (holder.firstChild) cancel(holder.firstChild.querySelector('.stroke-icon-motion'));
      holder.replaceChildren(auxiliary ? icons.auxiliary(id, doc) : icons.create(id, doc, contact));
      holder.dataset.drawing = key;
    }
    function clearExchange() {
      active = -1; result = null; cancel(resultEl);
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
        const available = enabled && Number.isFinite(data?.capacity) && Number.isFinite(data?.energy);
        const capacity = bounded(data?.capacity ?? 100), energy = bounded(data?.energy, capacity);
        text(p.playerName, name(i)); attr(p.playerName, 'title', name(i));
        text(p.serve, ''); attr(p.serve, 'aria-label', tr('hud.announceServe', { name: name(i) }));
        attr(p.serve, 'title', tr('hud.serve')); p.serve.hidden = snapshot.server !== (i ? -1 : 1);
        text(p.score, Number.isSafeInteger(snapshot.score?.[i]) && snapshot.score[i] >= 0 ? snapshot.score[i] : tr('hud.missing'));
        p.recess.hidden = !!snapshot.free;
        p.energy.hidden = !available; p.unlimited.hidden = available; text(p.unlimited, tr(enabled ? 'hud.missing' : 'hud.unlimited'));
        if (available) attr(p.meter, 'role', 'meter'); else p.meter.removeAttribute('role');
        attr(p.meter, 'aria-label', tr('hud.energy', { name: name(i) }));
        attr(p.meter, 'aria-valuenow', Math.round(energy * 10) / 10);
        attr(p.meter, 'aria-valuetext', tr('hud.energyValue', { energy: Math.round(energy), capacity: Math.round(capacity) }));
        text(p.value, Math.round(energy)); text(p.lowText, tr('hud.low'));
        p.low.hidden = !available || !p.lowOn; p.el.classList.toggle('is-low', available && p.lowOn);
        p.el.classList.toggle('is-limited', !!data?.limited && available);
        if (energy !== p.lastEnergy) p.meter.classList.toggle('is-recovering', p.lastEnergy == null || energy >= p.lastEnergy);
        const scale = `scaleX(${energy / 100})`, blocked = `scaleX(${(100 - capacity) / 100})`;
        if (p.fill.style.transform !== scale) { p.fill.style.transform = scale; p.trail.style.transform = scale; }
        if (p.fatigue.style.transform !== blocked) p.fatigue.style.transform = blocked;
        p.lastEnergy = energy;
        const contact = p.contact, known = contact && icons.ids.includes(contact.stroke);
        const entry = known && options.strokeCatalog?.find(item => item.id === contact.stroke);
        const color = entry?.col || 'var(--hud-neutral)';
        if (p.cell.style.getPropertyValue('--stroke') !== color) p.cell.style.setProperty('--stroke', color);
        setIcon(p.icon, contact ? contact.stroke : 'UNKNOWN', false, contact);
        const iconProfile = icons.profile(contact ? contact.stroke : 'UNKNOWN', contact);
        const spinUnknown = iconProfile.plane === 'unknown' ||
          !!contact && iconProfile.plane === 'none' && iconProfile.source === 'static';
        attr(p.icon, 'title', tr(spinUnknown ? 'hud.noSpinData' : iconProfile.plane === 'none' ? 'hud.noSpin' :
          iconProfile.source === 'static' ? 'hud.staticSpin' : 'hud.motionLegend'));
        text(p.stroke, contact ? tr(known ? 'hud.stroke.' + contact.stroke : 'hud.unknown') : tr('hud.missing'));
        attr(p.stroke, 'title', p.stroke.textContent);
        text(p.speed, tr('hud.kmh', { n: contact && Number.isFinite(contact.kmh) && contact.kmh >= 0 ? Math.round(contact.kmh) : tr('hud.missing') }));
        text(p.spin, contact && spinUnknown ? tr('hud.noSpinDataShort') :
          contact && iconProfile.plane === 'none' ? tr('hud.noSpin') :
          tr('hud.rps', { n: contact && Number.isFinite(contact.rps) && contact.rps >= 0 ? Math.round(contact.rps) : tr('hud.missing') }));
        const spinLabel = spinUnknown ? tr('hud.noSpinData') :
          iconProfile.plane === 'none' ? tr('hud.noSpin') :
          iconProfile.source === 'static' ? tr('hud.staticSpin') : tr('hud.motionLegend');
        attr(p.cell, 'aria-label', tr('hud.lastContact', { name: name(i), stroke: p.stroke.textContent, speed: p.speed.textContent, spin: p.spin.textContent }) + '. ' + spinLabel);
        p.cell.classList.toggle('is-active', active === i);
        p.cell.classList.toggle('is-empty', !contact);
        p.cell.dataset.eventId = contact ? String(contact.eventId) : '';
        text(p.whiffText, tr('hud.whiff')); p.whiff.hidden = !p.missed;
        attr(p.whiff, 'aria-label', tr('hud.whiff'));
      });
      text(target, snapshot.free ? tr('hud.free') : tr('hud.target', { n: Number.isSafeInteger(snapshot.target) && snapshot.target > 0 ? snapshot.target : tr('hud.missing') }));
      attr(target, 'title', target.textContent);
      text(rally, tr('hud.rallyShort', { n: Math.max(0, Math.floor(number(snapshot.rally))) }));
      attr(rally, 'aria-label', tr('hud.rally', { n: Math.max(0, Math.floor(number(snapshot.rally))) }));
      target.hidden = rally.hidden = !!snapshot.paused || !!snapshot.matchPoint || !!result;
      if (!Number.isFinite(snapshot.rally)) rally.hidden = true;
      const markerKey = snapshot.paused ? 'hud.paused' : 'hud.matchPoint';
      marker.hidden = !snapshot.paused && (!snapshot.matchPoint || !!result);
      marker.classList.toggle('is-paused', !!snapshot.paused);
      marker.dataset.side = String(snapshot.matchPoint || 0); text(markerText, tr(markerKey));
      resultEl.hidden = !result || !!snapshot.paused;
      if (result) {
        resultEl.dataset.id = String(result.id); resultEl.dataset.side = String(result.who);
        text(resultTitle, tr(result.who === 0 ? 'hud.letShort' : result.winner ? 'hud.ended' : 'hud.pointShort'));
        const reason = typeof options.reason === 'function' ? options.reason(result.who, result.reason) ?? '' : '';
        attr(resultEl, 'title', reason);
        attr(resultEl, 'aria-label', tr(result.who === 0 ? 'hud.let' : result.winner ? 'hud.winner' : 'hud.point',
          { name: name((result.winner || result.who) === -1 ? 1 : 0) }) + (reason ? '. ' + reason : ''));
        const why = String(result.reason || '');
        text(resultReason, /net|\u0441\u0435\u0442\u043a/i.test(why) ? tr('hud.net') : /out|\u0430\u0443\u0442/i.test(why) ? tr('hud.out') : '');
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
          if (!atServe) { p.contact = { ...contact,
            velocity: contact.velocity && { ...contact.velocity },
            angularVelocity: contact.angularVelocity && { ...contact.angularVelocity } };
            p.missed = false; hits.push(i); }
        } else if (!contact) p.contact = null;
        if (whiff && newer(whiff.id, p.whiffId)) {
          p.whiffId = whiff.id;
          if (!atServe && (!p.contact || p.contact.swingId !== whiff.swingId) && (!hits.includes(i) || (typeof whiff.id === 'number' && whiff.id > p.contact.eventId))) {
            p.missed = true; misses.push(i);
          }
        } else if (!whiff) p.missed = false;
        const state = snapshot.players.find(item => item.side === side);
        const energy = bounded(state?.energy, bounded(state?.capacity ?? 100));
        const low = !!snapshot.staminaEnabled && !snapshot.free && Number.isFinite(state?.energy) && Number.isFinite(state?.capacity) &&
          (energy < 25 || (p.lowOn && energy <= 30));
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
        players.forEach(p => {
          p.missed = false; cancel(p.whiff);
          if (p.icon.firstChild) cancel(p.icon.firstChild.querySelector('.stroke-icon-motion'));
        });
      }
      const announce = [];
      if (!snapshot.free && snapshot.score.length === 2 && snapshot.score.every(n => Number.isSafeInteger(n) && n >= 0) &&
          (newMatch || snapshot.score.some((n, i) => n !== previous.score[i]))) announce.push({ kind: 'score', a: snapshot.score[0], b: snapshot.score[1] });
      const newServe = !result && serving(snapshot.phase) && [1, -1].includes(snapshot.server) && (clear || snapshot.server !== previous.server);
      if (newServe) announce.push({ kind: 'serve', side: snapshot.server });
      lows.forEach(i => announce.push({ kind: 'low', side: i ? -1 : 1 }));
      if (announce.length) { speech = announce; announceNow = true; }
      render();
      if (root.hidden || snapshot.paused) { stopMotion(); return; }
      if (!entered) { entered = true; animate(root, [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], 220); }
      if (!result && !reduced) {
        hits.forEach(i => { const m = icons.motion(players[i].contact.stroke); animate(players[i].icon.firstChild.querySelector('.stroke-icon-motion'), m.frames, m.duration); });
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
  return Object.freeze({ mount, createSummary });
})();
globalThis.MatchHUD = MatchHUD;
