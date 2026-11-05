/* An isolated consumer of the shared physics, paddle sampler and WebGL scene.
 * The parent frame dispatcher owns time. Nothing here starts a game or a RAF. */
'use strict';

const TRAINING_PREVIEW_TEXT = {
  title: ['3D shot review', '3D-\u0440\u0430\u0437\u0431\u043e\u0440 \u0443\u0434\u0430\u0440\u0430'],
  close: ['Return to lesson', '\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f \u043a \u0443\u0440\u043e\u043a\u0443'],
  play: ['Play', '\u0412\u043e\u0441\u043f\u0440\u043e\u0438\u0437\u0432\u0435\u0441\u0442\u0438'], pause: ['Pause', '\u041f\u0430\u0443\u0437\u0430'],
  seek: ['Timeline', '\u0428\u043a\u0430\u043b\u0430 \u0432\u0440\u0435\u043c\u0435\u043d\u0438'], rate: ['Playback speed', '\u0421\u043a\u043e\u0440\u043e\u0441\u0442\u044c \u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440\u0430'],
  camera: ['Camera view', '\u0420\u0430\u043a\u0443\u0440\u0441'], player: ['Player view', '\u0412\u0438\u0434 \u0438\u0433\u0440\u043e\u043a\u0430'], side: ['Side', '\u0421\u0431\u043e\u043a\u0443'],
  top: ['Top', '\u0421\u0432\u0435\u0440\u0445\u0443'], contact: ['Contact frame', '\u041a\u0430\u0434\u0440 \u043a\u043e\u043d\u0442\u0430\u043a\u0442\u0430'],
  grip: ['Grip', '\u0425\u0432\u0430\u0442'], hand: ['Hand', '\u0420\u0443\u043a\u0430'],
  shakehand: ['Shakehand', '\u0415\u0432\u0440\u043e\u043f\u0435\u0439\u0441\u043a\u0438\u0439'], penhold: ['Penhold', '\u041f\u0435\u0440\u044c\u0435\u0432\u043e\u0439'],
  right: ['Right', '\u041f\u0440\u0430\u0432\u0430\u044f'], left: ['Left', '\u041b\u0435\u0432\u0430\u044f'],
  forehand: ['Forehand / backhand', '\u0421\u043f\u0440\u0430\u0432\u0430 / \u0441\u043b\u0435\u0432\u0430'],
  fh: ['Forehand', '\u0421\u043f\u0440\u0430\u0432\u0430'], bh: ['Backhand', '\u0421\u043b\u0435\u0432\u0430'],
  tableguide: ['Table guide', '\u0421\u0445\u0435\u043c\u0430 \u043d\u0430 \u0441\u0442\u043e\u043b\u0435'],
  gesture: ['Touch gesture', '\u0416\u0435\u0441\u0442 \u043f\u0430\u043b\u044c\u0446\u0430'],
  normal: ['Rubber normal', '\u041d\u043e\u0440\u043c\u0430\u043b\u044c \u043d\u0430\u043a\u043b\u0430\u0434\u043a\u0438'],
  head: ['Blade head', '\u0413\u043e\u043b\u043e\u0432\u0430 \u0440\u0430\u043a\u0435\u0442\u043a\u0438'],
  red: ['Red rubber', '\u041a\u0440\u0430\u0441\u043d\u0430\u044f \u043d\u0430\u043a\u043b\u0430\u0434\u043a\u0430'],
  black: ['Black rubber', '\u0427\u0451\u0440\u043d\u0430\u044f \u043d\u0430\u043a\u043b\u0430\u0434\u043a\u0430'],
  rps: ['rps', '\u043e\u0431/\u0441'], ready: ['Ready position', '\u0418\u0441\u0445\u043e\u0434\u043d\u043e\u0435 \u043f\u043e\u043b\u043e\u0436\u0435\u043d\u0438\u0435'],
  backswing: ['Backswing', '\u0417\u0430\u043c\u0430\u0445'], swing: ['Swing', '\u0423\u0434\u0430\u0440'],
  follow: ['Follow-through', '\u041f\u0440\u043e\u0432\u043e\u0434\u043a\u0430'], recover: ['Return to ready', '\u0412\u043e\u0437\u0432\u0440\u0430\u0442 \u0432 \u0433\u043e\u0442\u043e\u0432\u043d\u043e\u0441\u0442\u044c'],
  orbit: ['Drag to rotate. Pinch with two fingers or use the wheel to zoom.', '\u041f\u0435\u0440\u0435\u0442\u0430\u0441\u043a\u0438\u0432\u0430\u0439 \u0434\u043b\u044f \u043f\u043e\u0432\u043e\u0440\u043e\u0442\u0430. \u0421\u0432\u0435\u0434\u0438 \u0438\u043b\u0438 \u0440\u0430\u0437\u0432\u0435\u0434\u0438 \u0434\u0432\u0430 \u043f\u0430\u043b\u044c\u0446\u0430, \u043b\u0438\u0431\u043e \u043a\u0440\u0443\u0442\u0438 \u043a\u043e\u043b\u0435\u0441\u043e \u0434\u043b\u044f \u043c\u0430\u0441\u0448\u0442\u0430\u0431\u0430.'],
  isolated: ['Silent. No attempts or progress are recorded. The report is off duty.', '\u0411\u0435\u0437 \u0437\u0432\u0443\u043a\u0430. \u041f\u043e\u043f\u044b\u0442\u043a\u0438 \u0438 \u043f\u0440\u043e\u0433\u0440\u0435\u0441\u0441 \u043d\u0435 \u0437\u0430\u043f\u0438\u0441\u044b\u0432\u0430\u044e\u0442\u0441\u044f. \u041f\u0440\u043e\u0442\u043e\u043a\u043e\u043b \u043e\u0442\u0434\u044b\u0445\u0430\u0435\u0442.'],
  reduced: ['Reduced motion. Use the timeline to inspect the stroke.', '\u0414\u0432\u0438\u0436\u0435\u043d\u0438\u0435 \u043e\u0433\u0440\u0430\u043d\u0438\u0447\u0435\u043d\u043e. \u0420\u0430\u0437\u0431\u0438\u0440\u0430\u0439 \u0443\u0434\u0430\u0440 \u043f\u043e\u043b\u0437\u0443\u043d\u043a\u043e\u043c.'],
};

class TrainingPreview {
  constructor(game) {
    this.g = game;
    this.active = false;
    this.duration = 2.4;
    this.rate = .5;
    this.phase = 0;
    this.playing = false;
    this.tableguide = true;
    this.camera = 'player';
    this.orbit = { yaw: 0, pitch: .46, zoom: 1 };
    this.ball = { p: V3.new(), v: V3.new(), w: V3.new(), q: Q.new() };
    this.racket = createStrokeTemplateOutput();
    this._rig = new PaddleRig();
    this._cache = new Map();
    this._listeners = [];
    this._masks = [];
    this._pointers = new Map();
    this._cameraBuf = { vp: M4.create(), proj: M4.create(), view: M4.create() };
    this._insetBuf = { vp: M4.create(), proj: M4.create(), view: M4.create() };
    this._guideBuf = { vp: M4.create(), proj: M4.create(), view: M4.create() };
    this._cameraRig = { eye: V3.new(), look: V3.new(), fov: 44, shiftY: 0 };
    this._insetRig = { eye: V3.new(), look: V3.new(), fov: 35, shiftY: 0 };
    this._guideRig = { eye: V3.new(), look: V3.new(), fov: 44, shiftY: 0 };
    this._screen = {};
    this._a = V3.new(); this._b = V3.new(); this._scale = V3.new(1, 1, 1);
    this._q = Q.new(); this._matrix = M4.create();
    this._drawPaddle = { pos: this.racket.p, q: this.racket.q };
    this._cameraDirty = true;
    this._layoutDirty = true;
    this._restoreGL = { viewport: new Int32Array(4), scissor: new Int32Array(4), normal: new Float32Array(9) };
    this._guideMat = { color: [.56, .69, .77], unlit: true, blend: true, opacity: .23, doubleSided: true };
    this._gestureMat = { color: [.28, .87, .63], unlit: true, blend: true, opacity: .72, doubleSided: true };
    this._racketPathMat = { color: [.90, .66, .32], unlit: true, blend: true, opacity: .36, doubleSided: true };
    this._normalMat = { color: [1, .30, .31], unlit: true, doubleSided: true };
    this._headMat = { color: [.33, .72, 1], unlit: true, doubleSided: true };
    this._pointMat = { color: [1, .88, .48], unlit: true, doubleSided: true };
  }

  _text(id) {
    const row = TRAINING_PREVIEW_TEXT[id];
    return row ? row[typeof ET !== 'undefined' && ET.lang() === 'ru' ? 1 : 0] : id;
  }

  _profile(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
    let step = options.lessonId ? TRAIN_STEPS.find(s => s.id === options.lessonId) : null;
    if (options.lessonId && !step) return null;
    if (options.skillId) {
      if (!TRAIN_SKILLS.some(s => s.id === options.skillId)) return null;
      step = step || TRAIN_STEPS.find(s => s.skills.includes(options.skillId));
    }
    const technique = options.technique || (step && (step.technique || step.stroke)) || options.strokeId;
    const guide = technique && TRAIN_GUIDES[technique];
    const id = options.strokeId || (guide && guide.stroke) || (step && step.stroke);
    if (!id || !PADDLE_TEMPLATES.strokes[id] || (guide && guide.stroke !== id) || (options.technique && !guide)) return null;
    if (!step) step = TRAIN_STEPS.find(s => (s.technique || s.stroke) === (technique || id) && s.check && s.check.strokes);
    const settings = this.g.settings || {};
    const grip = options.grip ?? settings.grip ?? 'shakehand', hand = options.hand ?? settings.hand ?? 'right';
    const forehand = options.forehand ?? (!(step && step.backhand) && PADDLE_TEMPLATES.strokes[id].hand === 'fh');
    const side = options.side ?? 1;
    if (!['shakehand', 'penhold'].includes(grip) || !['right', 'left'].includes(hand) ||
        typeof forehand !== 'boolean' || ![1, -1].includes(side)) return null;
    const gesture = step && step.stroke === id && (step.technique || id) === (technique || id)
      ? trainingLessonView(step).gesture : trainingGuideView(technique || id).gesture;
    const feed = id.startsWith('SERVE_') ? null : (step && typeof step.feed === 'object' && step.feed) || TRAIN_FEEDS.normal;
    const equipment = this.g.equip && typeof this.g.equip.forSide === 'function'
      ? { ...this.g.equip.forSide(forehand ? 1 : -1) } : {};
    return { lessonId: step ? step.id : null, skillId: options.skillId || null, strokeId: id,
      technique: technique || id, side, grip, hand, forehand, gesture, feed, equipment,
      target: step && step.target || (id === 'DROP' ? 'short' : 'center') };
  }

  // Store physical states once. Every step has the production collision rules,
  // including the spin added by a table bounce, and a full-axis ball quaternion.
  _flight(initial, maxT, finishBounces, postTime = 0) {
    const dt = PH.SIM_DT, stride = 14, states = new Float64Array((Math.ceil(maxT / dt) + 2) * stride);
    const b = { p: V3.clone(initial.p), v: V3.clone(initial.v), w: V3.clone(initial.w), q: Q.copy(Q.new(), initial.q || Q.new()) };
    const hit = V3.new(), net = V3.new(), bounces = [];
    let count = 0, t = 0, end = Infinity, hitNet = false;
    const store = () => {
      const k = count++ * stride;
      states[k] = t;
      states[k + 1] = b.p.x; states[k + 2] = b.p.y; states[k + 3] = b.p.z;
      states[k + 4] = b.v.x; states[k + 5] = b.v.y; states[k + 6] = b.v.z;
      states[k + 7] = b.w.x; states[k + 8] = b.w.y; states[k + 9] = b.w.z;
      states[k + 10] = b.q.x; states[k + 11] = b.q.y; states[k + 12] = b.q.z; states[k + 13] = b.q.w;
    };
    store();
    for (let i = 0; i < Math.ceil(maxT / dt); i++) {
      const x = b.p.x, y = b.p.y, z = b.p.z;
      integrateBall(b.p, b.v, b.w, dt); Q.integrate(b.q, b.q, b.w, dt); t = (i + 1) * dt;
      if (!saneV(b.p) || !saneV(b.v) || !saneV(b.w)) return null;
      if (netContactStep(x, y, z, b.p.x, b.p.y, b.p.z, net)) { hitNet = true; store(); break; }
      if (b.v.y < 0 && tableContact(x, y, z, b.p.x, b.p.y, b.p.z, hit)) {
        V3.copy(b.p, hit); b.p.y += 1e-5;
        bounces.push({ x: hit.x, y: hit.y, z: hit.z, t, index: count });
        bounceTable(b.p, b.v, b.w);
        if (bounces.length === finishBounces) end = t + postTime;
      }
      store();
      if (t + 1e-10 >= end || b.p.y < PH.R) break;
    }
    return { states, count, duration: t, bounces, hitNet, dt };
  }

  _sampleFlight(flight, time, out) {
    const s = flight.states, last = flight.count - 1;
    const at = clamp(time / flight.dt, 0, last), i = Math.floor(at), j = Math.min(i + 1, last), u = at - i;
    const a = i * 14, b = j * 14;
    V3.set(out.p, lerp(s[a + 1], s[b + 1], u), lerp(s[a + 2], s[b + 2], u), lerp(s[a + 3], s[b + 3], u));
    V3.set(out.v, lerp(s[a + 4], s[b + 4], u), lerp(s[a + 5], s[b + 5], u), lerp(s[a + 6], s[b + 6], u));
    V3.set(out.w, lerp(s[a + 7], s[b + 7], u), lerp(s[a + 8], s[b + 8], u), lerp(s[a + 9], s[b + 9], u));
    const sign = s[a + 10] * s[b + 10] + s[a + 11] * s[b + 11] + s[a + 12] * s[b + 12] + s[a + 13] * s[b + 13] < 0 ? -1 : 1;
    const q = out.q;
    q.x = lerp(s[a + 10], sign * s[b + 10], u); q.y = lerp(s[a + 11], sign * s[b + 11], u);
    q.z = lerp(s[a + 12], sign * s[b + 12], u); q.w = lerp(s[a + 13], sign * s[b + 13], u);
    const length = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    q.x /= length; q.y /= length; q.z /= length; q.w /= length;
    return out;
  }

  _prepare(profile) {
    const key = JSON.stringify([profile.strokeId, profile.technique, profile.side, profile.hand, profile.grip,
      profile.forehand, profile.feed, profile.gesture, profile.equipment, profile.target]);
    if (this._cache.has(key)) return this._cache.get(key);
    const c = compileStrokeTemplate(profile.strokeId, { side: profile.side, hand: profile.hand,
      grip: profile.grip, forehand: profile.forehand, duration: this.duration });
    const serve = profile.strokeId.startsWith('SERVE_'), side = profile.side;
    const nearX = c.contact.ballP.x * side;
    let initial;
    if (serve) {
      const toss = STROKE_CONFIG.serve.toss;
      initial = { p: V3.new(nearX, PH.TABLE_Y + toss.height, PH.T_HALF_LEN + toss.readyEndMargin),
        v: V3.new(0, toss.aiSpeed, 0), w: V3.new() };
    } else {
      initial = trainingFeedBall(profile.feed, 0, false, false, Math.sign(nearX) || (profile.forehand ? 1 : -1));
    }
    if (!initial) return null;
    if (side < 0) for (const v of [initial.p, initial.v, initial.w]) { v.x = -v.x; v.z = -v.z; }
    const incoming = this._flight(initial, serve ? 1.6 : 3, serve ? 0 : 2);
    if (!incoming || incoming.hitNet || (!serve && !incoming.bounces.length)) return null;
    const s = incoming.states, desiredY = serve ? PH.TABLE_Y + STROKE_CONFIG.serve.toss.aiContactHeight
      : clamp(c.contact.ballP.y, PH.TABLE_Y + .14, PH.TABLE_Y + .55);
    const candidates = [];
    for (let i = serve ? 1 : incoming.bounces[0].index + 1; i < incoming.count; i++) {
      const k = i * 14, y = s[k + 2], z = s[k + 3] * side;
      if (y < PH.TABLE_Y + PH.R + .025 || y > PH.TABLE_Y + .85 || z < .30 || z > 2.5) continue;
      if (serve && (s[k + 5] >= -.25 || y < PH.TABLE_Y + .24)) continue;
      if (!serve && incoming.bounces[1] && i >= incoming.bounces[1].index) continue;
      if (['BANANA', 'CHOP_BLOCK', 'FLICK', 'DROP'].includes(profile.strokeId) &&
          (z > PH.T_HALF_LEN - .025 || Math.abs(s[k + 1]) > PH.T_HALF_WID - .025 || y > PH.TABLE_Y + .28)) continue;
      if (profile.strokeId === 'CHOP_BLOCK' && (Math.hypot(s[k + 4], s[k + 5], s[k + 6]) < 7 || s[k + 7] * side <= 220)) continue;
      if (profile.strokeId === 'SMASH' && y < PH.TABLE_Y + .38) continue;
      const score = Math.abs(y - desiredY) * 3 + Math.abs(z - Math.abs(c.contact.ballP.z)) * .28 + (s[k + 5] > 0 ? .015 : 0);
      candidates.push({ index: i, score });
    }
    candidates.sort((a, b) => a.score - b.score);
    if (!candidates.length) return null;
    const rising = candidates.find(candidate => s[candidate.index * 14 + 5] >= 0);
    const zone = trainingTarget(profile.target, 0) || trainingTarget('center');
    const aim = { x: (zone.x0 + zone.x1) * .5 * side, z: (zone.z0 + zone.z1) * .5 * side };
    const vmag = profile.strokeId === 'SMASH' || profile.strokeId === 'SERVE_FAST' ? 10 : profile.strokeId === 'LOB' ? 3.5 : 6;
    let clip = null;
    for (let attempt = 0; attempt < 3 && !clip; attempt++) {
      const choice = ['LOOP', 'LOB'].includes(profile.strokeId) && attempt === 0 && rising ? rising
        : attempt === 1 && rising ? rising : candidates[Math.min(attempt * 12, candidates.length - 1)];
      const index = choice.index;
      const ball = { p: V3.new(), v: V3.new(), w: V3.new(), q: Q.new() };
      this._sampleFlight(incoming, index * PH.SIM_DT, ball);
      let rk = racketForStroke(profile.strokeId, { side, ball: ball.p, ballVelocity: ball.v, ballSpin: ball.w,
        ballSpeed: V3.len(ball.v), grip: profile.grip, hand: profile.hand, forehand: profile.forehand, equip: profile.equipment },
      { vmag: vmag * [1, .8, 1.15][attempt], quality: .9, aim,
        direction: (profile.hand === 'left' ? -1 : 1) * side, verticalBrush: profile.gesture.verticalBrush || 0 });
      rk.preview = true; // The serve solver must not read or warm the match cache.
      rk.netClear = profile.strokeId === 'LOB' ? .65 : profile.strokeId === 'DROP' ? .035 : .12;
      rk = refineRacket(ball.p, ball.v, ball.w, rk, 1, .9);
      if (!rk || rk.valid === false || rk.stroke.id !== profile.strokeId) continue;
      const launch = resolveRacketLaunch(ball, rk, {});
      if (!launch || !strokeIdentityMatches(rk, launch)) continue;
      const verdict = predict(launch.p, launch.v, launch.w, { dt: PH.SIM_DT, maxT: 3, stopAfterBounces: serve ? 2 : 1 });
      if (verdict.hitNet || verdict.diverged || !verdict.landed || (serve
        ? verdict.landed.z * side <= 0 || !verdict.b2 || verdict.b2.z * side >= 0 : verdict.landed.z * side >= 0)) continue;
      const pose = paddleContactPose(ball.p, rk, profile);
      if (!pose) continue;
      const physicalDuration = clamp(V3.len(c.contact.vR) * c.duration / Math.max(.5, V3.len(rk.vR)), .18, .65);
      const motion = retargetStrokeTemplate(c, { point: pose.point, q: pose.q, normal: rk.normal,
        localPoint: pose.localPoint, vR: rk.vR, duration: physicalDuration });
      const outbound = this._flight({ ...launch, q: ball.q }, 3, serve ? 2 : 1, .16);
      if (!outbound || outbound.hitNet) continue;
      const inbound = { ...incoming, count: index + 1, duration: index * PH.SIM_DT,
        bounces: incoming.bounces.filter(b => b.index <= index) };
      clip = { compiled: c, motion, inbound, outbound, ball, racket: rk, pose, launch,
        spin: measureShotSpin(launch.w, launch.v), verdict, physicalDuration, profile, path: [], safety: { ready: 0, back: 0, follow: 0 } };
      const sample = createStrokeTemplateOutput();
      // Retargeting a deep authored backswing to a short ball can put it through
      // the table. Fit a C1 vertical clearance envelope, zero at the contact and
      // its derivative. Rendering and the reference path use the same envelope.
      sampleStrokeTemplate(motion, 0, sample);
      clip.safety.ready = Math.max(0, .002 - paddleTableClearance(sample.p, sample.n, 0, PH.TABLE_Y, PH.T_HALF_WID, PH.T_HALF_LEN, sample.q));
      for (let frame = 0; frame <= 240; frame++) {
        const phase = frame / 240;
        sampleStrokeTemplate(motion, phase, sample);
        const clearance = paddleTableClearance(sample.p, sample.n, 0, PH.TABLE_Y, PH.T_HALF_WID, PH.T_HALF_LEN, sample.q);
        if (clearance >= 0) continue;
        const span = phase < c.contactPhase ? c.contactPhase : 1 - c.contactPhase;
        const u = phase < c.contactPhase ? phase / span : (phase - c.contactPhase) / span;
        const baseline = clip.safety.ready * (phase < c.contactPhase ? Math.cos(Math.PI * u / 2) ** 2 : Math.sin(Math.PI * u / 2) ** 2);
        if (.002 - clearance <= baseline) continue;
        const weight = Math.sin(Math.PI * u) ** 2;
        if (weight < 1e-7) { clip = null; break; }
        const key = phase < c.contactPhase ? 'back' : 'follow';
        clip.safety[key] = Math.max(clip.safety[key], (.002 - clearance - baseline) / weight * 1.04);
      }
      if (!clip) continue;
      for (let frame = 0; frame <= 120; frame++) {
        this._samplePaddle(clip, frame / 120, sample);
        clip.path.push(V3.clone(sample.p));
      }
      clip.pathLines = []; clip.pathLinesLow = [];
      for (let i = 4; i < clip.path.length; i += 4) {
        const line = this._lineMatrix(clip.path[i - 4], clip.path[i], .0028); if (line) clip.pathLines.push(line);
      }
      for (let i = 8; i < clip.path.length; i += 8) {
        const line = this._lineMatrix(clip.path[i - 8], clip.path[i], .0028); if (line) clip.pathLinesLow.push(line);
      }
      clip.normalLines = this._arrowMatrices(pose.point, rk.normal, .19);
      clip.headLines = this._arrowMatrices(pose.pos, motion.contact.up, .17);
      clip.normalMat = { ...this._normalMat, color: pose.activeFace > 0 ? [1, .30, .31] : [.80, .83, .89] };
      clip.drawPaddle = { pos: pose.pos, q: pose.q };
      clip.contactBounds = [pose.pos, ball.p, V3.addScaled(V3.new(), pose.pos, motion.contact.up, -.19),
        V3.addScaled(V3.new(), pose.point, rk.normal, .22)];
      const insetDirection = V3.norm(V3.new(), V3.addScaled(V3.new(), rk.normal, motion.contact.up, .28));
      clip.insetEye = V3.addScaled(V3.new(), pose.point, insetDirection, .63);
      this._frameBox(clip);
    }
    if (clip) {
      if (this._cache.size >= 8) this._cache.delete(this._cache.keys().next().value);
      this._cache.set(key, clip);
    }
    return clip;
  }

  _frameBox(clip) {
    const min = V3.new(-PH.T_HALF_WID, .06, -PH.T_HALF_LEN), max = V3.new(PH.T_HALF_WID, PH.NET_TOP, PH.T_HALF_LEN);
    const add = (x, y, z, r) => {
      min.x = Math.min(min.x, x - r); min.y = Math.min(min.y, y - r); min.z = Math.min(min.z, z - r);
      max.x = Math.max(max.x, x + r); max.y = Math.max(max.y, y + r); max.z = Math.max(max.z, z + r);
    };
    for (const f of [clip.inbound, clip.outbound]) for (let i = 0; i < f.count; i++) {
      const k = i * 14; add(f.states[k + 1], f.states[k + 2], f.states[k + 3], PH.R);
    }
    for (const p of clip.path) add(p.x, p.y, p.z, .18);
    clip.center = V3.lerp(V3.new(), min, max, .5); clip.bounds = [];
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) clip.bounds.push(V3.new(x, y, z));
  }

  open(options = {}) {
    const profile = this._profile(options);
    if (!profile) return false;
    let clip;
    try { clip = this._prepare(profile); } catch (error) { this.error = error.message; return false; }
    if (!clip) { this.error = 'No physical reference for this profile'; return false; }
    if (!this.active) {
      const a = this.g.audio;
      this._saved = { paused: this.g.paused, quiet: a && a.quiet, muted: a && a.muted,
        levels: a && a.levels && { ...a.levels }, volume: a && a.volume };
      this.g.paused = true;
      if (a && a.setQuiet) a.setQuiet(true);
      this.active = true;
      this._mount();
    }
    this.profile = profile; this.clip = clip; this.error = null;
    this.reducedMotion = this._motionOff();
    this.phase = this.reducedMotion ? clip.compiled.contactPhase : 0;
    this.rate = Number.isFinite(options.rate) ? clamp(options.rate, .25, 1) : .5;
    this.playing = !this.reducedMotion && options.play !== false;
    this.tableguide = options.tableguide !== false;
    this._setView(['player', 'side', 'top', 'contact'].includes(options.camera) ? options.camera : 'player');
    this._cameraDirty = this._layoutDirty = true;
    this._sample(); this.localize();
    return true;
  }

  close(restore = true) {
    if (!this.active) return false;
    this.active = false; this.playing = false;
    for (const [target, type, fn, options] of this._listeners) target.removeEventListener(type, fn, options);
    this._listeners.length = 0;
    if (this._observer) this._observer.disconnect(); this._observer = null;
    this._releasePointers();
    if (this.root) this.root.remove(); this.root = null; this.controls = null;
    this._stage = this._motionQuery = this._gesturePoints = null;
    for (const m of this._masks) {
      m.el.inert = m.inert;
      if (m.aria === null) m.el.removeAttribute('aria-hidden'); else m.el.setAttribute('aria-hidden', m.aria);
      m.el.style.visibility = m.visibility; m.el.style.pointerEvents = m.pointerEvents;
    }
    this._masks.length = 0;
    const a = this.g.audio, old = this._saved;
    if (restore && old) {
      this.g.paused = old.paused;
      if (a) {
        if (old.levels && a.setLevels) a.setLevels(old.levels);
        else if (Number.isFinite(old.volume) && a.setVolume) a.setVolume(old.volume);
        if (typeof old.muted === 'boolean' && a.setMuted) a.setMuted(old.muted);
        if (a.setQuiet) a.setQuiet(old.quiet === true);
      }
    } else if (a && a.setQuiet) a.setQuiet(true);
    if (restore && this._focus && this._focus.isConnected && typeof this._focus.focus === 'function') this._focus.focus({ preventScroll: true });
    this._focus = this._saved = null;
    this.clip = this.profile = null; this._cache.clear(); this._worldGuide = null; this._grid = null; this._labels = null;
    this._gridMatrices = this._gestureMatrices = this._axisMatrices = null;
    return true;
  }

  _motionOff() {
    return !!(this.g.motionOff || this.g.reducedMotion || this._motionQuery && this._motionQuery.matches);
  }

  update(dtReal) {
    if (!this.active) return;
    const reduced = this._motionOff();
    if (reduced !== this.reducedMotion) {
      this.reducedMotion = reduced;
      if (reduced) this.playing = false;
      this.localize();
    }
    if (this.playing && Number.isFinite(dtReal) && dtReal > 0) {
      // A background gap pauses the reference rather than skipping the contact.
      if (dtReal > .5) this.playing = false;
      else this.phase = (this.phase + dtReal * this.rate / this.duration) % 1;
    }
    this._sample(); this._syncControls();
  }

  _sample() {
    const c = this.clip, tc = c.compiled.contactPhase;
    this._samplePaddle(c, this.phase, this.racket);
    if (this.phase <= tc) this._sampleFlight(c.inbound, this.phase / tc * c.inbound.duration, this.ball);
    else this._sampleFlight(c.outbound, (this.phase - tc) / (1 - tc) * c.outbound.duration, this.ball);
  }

  _samplePaddle(clip, phase, out) {
    sampleStrokeTemplate(clip.motion, phase, out);
    const tc = clip.compiled.contactPhase;
    if (Math.abs(phase - tc) < 1e-10) return out;
    const before = phase < tc, span = before ? tc : 1 - tc, amplitude = clip.safety[before ? 'back' : 'follow'];
    const u = before ? phase / span : (phase - tc) / span;
    const baseline = clip.safety.ready * (before ? Math.cos(Math.PI * u / 2) ** 2 : Math.sin(Math.PI * u / 2) ** 2);
    const lift = baseline + amplitude * Math.sin(Math.PI * u) ** 2;
    const velocity = (amplitude * Math.PI * Math.sin(2 * Math.PI * u) +
      (before ? -1 : 1) * clip.safety.ready * Math.PI / 2 * Math.sin(Math.PI * u)) / span / clip.physicalDuration;
    out.p.y += lift; out.point.y += lift; out.v.y += velocity; out.vR.y += velocity;
    return out;
  }

  _setView(view) {
    this.camera = view;
    const baseYaw = this.profile && this.profile.side < 0 ? Math.PI : 0;
    this.orbit.yaw = baseYaw + (view === 'side' ? Math.PI / 2 : 0);
    this.orbit.pitch = view === 'top' ? 1.47 : view === 'contact' ? .32 : .46;
    if (view === 'contact' && this.clip) {
      const normal = this.clip.racket.normal, up = this.clip.motion.contact.up;
      const x = normal.x + up.x * .28, y = normal.y + up.y * .28, z = normal.z + up.z * .28;
      this.orbit.yaw = Math.atan2(x, z);
      this.orbit.pitch = clamp(Math.atan2(y, Math.hypot(x, z)), .15, 1.35);
    }
    this.orbit.zoom = 1; this._cameraDirty = true;
  }

  command(action, data) {
    if (action === 'start') return this.open(data || {});
    if (action === 'close') return this.close(!(data && data.restore === false));
    if (!this.active) return false;
    const value = data && typeof data === 'object' ? data[action] ?? data.value : data;
    if (action === 'play') { if (this.reducedMotion) return false; this.playing = true; }
    else if (action === 'pause') this.playing = false;
    else if (action === 'seek') {
      const phase = data && typeof data === 'object' ? data.phase ?? data.value : data;
      if (!Number.isFinite(phase)) return false;
      this.phase = clamp(phase, 0, 1); this.playing = false;
    } else if (action === 'rate') {
      if (!Number.isFinite(value)) return false; this.rate = clamp(value, .25, 1);
    } else if (action === 'camera') {
      if (typeof value === 'string') {
        if (!['player', 'side', 'top', 'contact'].includes(value)) return false;
        this._setView(value);
      } else if (data && typeof data === 'object' && ['yaw', 'pitch', 'zoom'].some(k => Number.isFinite(data[k]))) {
        if (Number.isFinite(data.yaw)) this.orbit.yaw = data.yaw;
        if (Number.isFinite(data.pitch)) this.orbit.pitch = clamp(data.pitch, .10, 1.48);
        if (Number.isFinite(data.zoom)) this.orbit.zoom = clamp(data.zoom, .65, 2);
        this._cameraDirty = true;
      } else return false;
    } else if (action === 'contact') { this.phase = this.clip.compiled.contactPhase; this.playing = false; }
    else if (action === 'tableguide') this.tableguide = typeof value === 'boolean' ? value : !this.tableguide;
    else if (['grip', 'hand', 'forehand'].includes(action)) {
      const next = action === 'forehand' && value === 'fh' ? true : action === 'forehand' && value === 'bh' ? false : value;
      const profile = this._profile({ ...this.profile, [action]: next });
      if (!profile) return false;
      let clip;
      try { clip = this._prepare(profile); } catch (error) { this.error = error.message; return false; }
      if (!clip) return false;
      this.profile = profile; this.clip = clip; this._cameraDirty = this._layoutDirty = true;
      this.localize();
    } else return false;
    this._sample(); this._syncControls(); return true;
  }

  snapshot() {
    const c = this.clip, p = this.profile;
    const vec = v => ({ x: v.x, y: v.y, z: v.z });
    return { active: this.active, lessonId: p && p.lessonId, skillId: p && p.skillId, strokeId: p && p.strokeId,
      technique: p && p.technique, playing: this.playing, phase: this.phase, stage: this.racket.stage,
      duration: this.duration, rate: this.rate, camera: this.camera, orbit: { ...this.orbit },
      grip: p && p.grip, hand: p && p.hand, forehand: p && p.forehand, side: p && p.side,
      tableguide: this.tableguide, reducedMotion: !!this.reducedMotion, error: this.error || null,
      contactPhase: c && c.compiled.contactPhase,
      contact: c ? { point: vec(c.pose.point), ballP: vec(c.ball.p), bladeP: vec(c.pose.pos), q: { ...c.pose.q },
        normal: vec(c.racket.normal), localPoint: vec(c.pose.localPoint), activeFace: c.pose.activeFace,
        vR: vec(c.racket.vR), incoming: { v: vec(c.ball.v), w: vec(c.ball.w) },
        launch: { p: vec(c.launch.p), v: vec(c.launch.v), w: vec(c.launch.w) }, spin: { ...c.spin } } : null,
      physics: c ? { dt: PH.SIM_DT, physicalDuration: c.physicalDuration,
        inboundFrames: c.inbound.count, outboundFrames: c.outbound.count,
        inboundTime: c.inbound.duration, outboundTime: c.outbound.duration,
        bounces: c.outbound.bounces.map(b => ({ x: b.x, y: b.y, z: b.z, t: b.t })),
        identity: strokeIdentityMatches(c.racket, c.launch) } : null,
      gesture: c ? { kind: p.gesture.kind, contactIndex: p.gesture.contactIndex, contactPhase: p.gesture.contactPhase,
        duration: p.gesture.duration, points: p.gesture.points.map(point => point.slice()),
        world: this._worldGuide ? this._worldGuide.map(point => point && vec(point)) : [],
        clipped: this._worldGuide ? this._worldGuide.some(point => !point) : false } : null };
  }

  _listen(target, type, fn, options) {
    if (!target || !target.addEventListener) return;
    target.addEventListener(type, fn, options); this._listeners.push([target, type, fn, options]);
  }

  _mount() {
    if (typeof document === 'undefined') return;
    const parent = this.g.canvas && this.g.canvas.parentElement || document.getElementById('app') || document.body;
    this._focus = document.activeElement;
    const root = document.createElement('section'); this.root = root;
    root.id = 'ttPreview'; root.className = 'tt-preview'; root.tabIndex = -1;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'ttPreviewTitle');
    const select = (id, values) => `<label><span data-preview-text="${id}"></span><select data-preview="${id}">${values.map(v =>
      `<option value="${v}" data-preview-text="${v}"></option>`).join('')}</select></label>`;
    root.innerHTML = `<header class="tt-preview-header"><div><small data-preview-text="title"></small><h2 id="ttPreviewTitle"></h2></div>
      <button type="button" class="tbt" data-preview="close" data-preview-text="close"></button></header>
      <div class="tt-preview-stage" data-preview-orbit><span class="tt-preview-orbit" data-preview-text="orbit"></span>
        <div class="tt-preview-labels" aria-hidden="true"></div><div class="tt-preview-contact-label"></div></div>
      <aside class="tt-preview-details"><div class="tt-preview-inset" aria-label="${this._text('contact')}"><b data-preview-text="contact"></b>
        <div class="tt-preview-inset-window"></div><span class="tt-preview-face"></span>
        <small><i class="tt-preview-normal-key"></i><span data-preview-text="normal"></span> / <i class="tt-preview-head-key"></i><span data-preview-text="head"></span></small></div>
        <div class="tt-preview-gesture"><b data-preview-text="gesture"></b><svg viewBox="0 0 240 132" role="img">
          <defs><marker id="ttPreviewArrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="currentColor"/></marker></defs>
          <path class="tt-preview-swipe" marker-end="url(#ttPreviewArrow)"/><circle class="tt-preview-touch-start" r="6"/>
          <circle class="tt-preview-touch-window" r="13"/><circle class="tt-preview-touch-contact" r="3"/>
          <circle class="tt-preview-touch-cursor" r="8"/></svg><p class="tt-preview-instruction"></p></div></aside>
      <footer class="tt-preview-footer"><div class="tt-preview-transport"><button type="button" class="tbt" data-preview="play"></button>
        <label class="tt-preview-timeline"><span data-preview-text="seek"></span><input data-preview="seek" type="range" min="0" max="1" step="0.001"/></label>
        <output class="tt-preview-phase"></output><button type="button" class="tbt" data-preview="contact" data-preview-text="contact"></button>
        <label><span data-preview-text="rate"></span><select data-preview="rate"><option value="0.25">0.25x</option><option value="0.5">0.50x</option><option value="0.75">0.75x</option><option value="1">1.00x</option></select></label></div>
        <div class="tt-preview-settings">${select('camera', ['player', 'side', 'top', 'contact'])}${select('grip', ['shakehand', 'penhold'])}
          ${select('hand', ['right', 'left'])}${select('forehand', ['fh', 'bh'])}<label class="tt-preview-toggle"><input type="checkbox" data-preview="tableguide" checked/><span data-preview-text="tableguide"></span></label></div>
        <small class="tt-preview-status"></small></footer>`;
    parent.appendChild(root);
    this.controls = Object.fromEntries(Array.from(root.querySelectorAll('[data-preview]')).map(el => [el.dataset.preview, el]));
    this._stage = root.querySelector('[data-preview-orbit]');
    for (const el of Array.from(parent.children)) {
      if (el === root || /^(SCRIPT|STYLE|LINK)$/.test(el.tagName)) continue;
      this._masks.push({ el, inert: el.inert, aria: el.getAttribute('aria-hidden'), visibility: el.style.visibility, pointerEvents: el.style.pointerEvents });
      el.inert = true; el.setAttribute('aria-hidden', 'true'); el.style.pointerEvents = 'none';
      if (el !== this.g.canvas) el.style.visibility = 'hidden';
    }
    const win = document.defaultView || (typeof window !== 'undefined' ? window : null);
    this._motionQuery = win && win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this._listen(win, 'keydown', e => this._key(e), true);
    for (const type of ['keyup', 'keypress']) this._listen(win, type, e => { if (this.active) e.stopImmediatePropagation(); }, true);
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) this._listen(win, type, e => {
      if (!this.active) return;
      if (root.contains(e.target) && !this._stage.contains(e.target)) { e.stopImmediatePropagation(); return; }
      e.preventDefault(); e.stopImmediatePropagation(); this._pointer(type, e);
    }, { capture: true, passive: false });
    this._listen(win, 'wheel', e => {
      if (!this.active) return;
      if (root.contains(e.target) && !this._stage.contains(e.target)) { e.stopImmediatePropagation(); return; }
      e.preventDefault(); e.stopImmediatePropagation(); this.orbit.zoom = clamp(this.orbit.zoom * Math.exp(-e.deltaY * .0015), .65, 2); this._cameraDirty = true;
    }, { capture: true, passive: false });
    this._listen(root, 'click', e => {
      e.stopPropagation();
      const el = e.target.closest('[data-preview]'); if (!el || el.tagName !== 'BUTTON') return;
      this.command(el.dataset.preview === 'play' && this.playing ? 'pause' : el.dataset.preview);
    });
    const change = e => {
      e.stopPropagation();
      const el = e.target, action = el.dataset.preview;
      if (!action) return;
      this.command(action, el.type === 'checkbox' ? el.checked : ['rate', 'seek'].includes(action) ? Number(el.value) : el.value);
    };
    this._listen(root, 'input', e => { e.stopPropagation(); if (e.target.tagName !== 'SELECT') change(e); });
    this._listen(root, 'change', e => { e.stopPropagation(); if (e.target.tagName === 'SELECT') change(e); });
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel', 'contextmenu'])
      this._listen(root, type, e => { e.stopPropagation(); if (type === 'contextmenu') e.preventDefault(); });
    this._listen(win, 'resize', () => { this._layoutDirty = true; });
    this._listen(root, 'scroll', () => { this._layoutDirty = true; }, true);
    this._listen(win, 'blur', () => { this.playing = false; this._releasePointers(); });
    this._listen(document, 'visibilitychange', () => { if (document.hidden) { this.playing = false; this._releasePointers(); } });
    this._listen(this.g.canvas, 'webglcontextlost', () => this.close(false));
    if (win && win.ResizeObserver) {
      this._observer = new win.ResizeObserver(() => { this._layoutDirty = true; }); this._observer.observe(root);
    }
    this.controls.close.focus({ preventScroll: true });
  }

  _key(e) {
    if (!this.active) return;
    e.stopImmediatePropagation();
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
    if (e.key === 'Tab' && this.root) {
      const items = Array.from(this.root.querySelectorAll('button:not(:disabled),select,input'));
      const at = items.indexOf(document.activeElement);
      if (at < 0 || e.shiftKey && at === 0 || !e.shiftKey && at === items.length - 1) {
        e.preventDefault(); items[e.shiftKey ? items.length - 1 : 0].focus();
      }
      return;
    }
    if (e.target && (/^(INPUT|SELECT)$/.test(e.target.tagName) || e.target.tagName === 'BUTTON' && e.key === ' ')) return;
    if ([' ', 'p', 'P'].includes(e.key)) { e.preventDefault(); this.command(this.playing ? 'pause' : 'play'); }
    else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); this.command('seek', e.key === 'Home' ? 0 : e.key === 'End' ? 1 : this.phase + (e.key === 'ArrowRight' ? 1 : -1) / 120);
    } else if (/^[1-4]$/.test(e.key)) { e.preventDefault(); this.command('camera', ['player', 'side', 'top', 'contact'][Number(e.key) - 1]); }
  }

  _releasePointers() {
    if (this._stage && this._stage.releasePointerCapture) for (const id of this._pointers.keys()) {
      try { if (this._stage.hasPointerCapture(id)) this._stage.releasePointerCapture(id); } catch (error) {}
    }
    this._pointers.clear(); this._pinch = 0;
  }

  _pointer(type, e) {
    if (type === 'pointerdown') {
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._stage && this._stage.setPointerCapture) { try { this._stage.setPointerCapture(e.pointerId); } catch (error) {} }
      this._pinch = 0;
      if (this._pointers.size >= 2) {
        const points = this._pointers.values(), a = points.next().value, b = points.next().value;
        this._pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    } else if (type === 'pointerup' || type === 'pointercancel') {
      if (this._stage && this._stage.releasePointerCapture) {
        try { if (this._stage.hasPointerCapture(e.pointerId)) this._stage.releasePointerCapture(e.pointerId); } catch (error) {}
      }
      this._pointers.delete(e.pointerId); this._pinch = 0;
    } else {
      const point = this._pointers.get(e.pointerId); if (!point) return;
      const dx = e.clientX - point.x, dy = e.clientY - point.y; point.x = e.clientX; point.y = e.clientY;
      if (this._pointers.size === 1) {
        this.orbit.yaw -= dx / Math.max(200, this._width || 390) * TAU;
        this.orbit.pitch = clamp(this.orbit.pitch + dy / Math.max(200, this._height || 600) * Math.PI, .10, 1.48);
      } else {
        const points = this._pointers.values(), a = points.next().value, b = points.next().value;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (this._pinch > 0) this.orbit.zoom = clamp(this.orbit.zoom * distance / this._pinch, .65, 2);
        this._pinch = distance;
      }
      this._cameraDirty = true;
    }
  }

  localize() {
    if (!this.active || !this.root || !this.profile) return;
    for (const el of this.root.querySelectorAll('[data-preview-text]')) el.textContent = this._text(el.dataset.previewText);
    const p = this.profile, step = TRAIN_STEPS.find(s => s.id === p.lessonId);
    const view = step ? trainingLessonView(step) : trainingGuideView(p.technique);
    this.root.querySelector('#ttPreviewTitle').textContent = view.title;
    this.root.querySelector('.tt-preview-instruction').textContent = view.brief[this.g.ui && this.g.ui.inputMode === 'mouse' ? 'mouse' : 'touch'];
    this.root.querySelector('.tt-preview-face').textContent = this._text(p.forehand ? 'red' : 'black');
    this.root.querySelector('.tt-preview-inset').setAttribute('aria-label', this._text('contact'));
    this.root.querySelector('.tt-preview-status').textContent = this._text(this.reducedMotion ? 'reduced' : 'isolated');
    const family = ET(TRAIN_GUIDES[p.technique].title);
    this.root.querySelector('.tt-preview-contact-label').textContent = family + ' ' + Math.round(this.clip.spin.totalRps) + ' ' + this._text('rps');
    this.root.querySelector('.tt-preview-gesture svg').setAttribute('aria-label', view.controls.touch);
    this.root.toggleAttribute('data-preview-reduced', this.reducedMotion);
    this._syncControls();
  }

  _syncControls() {
    if (!this.controls || !this.profile) return;
    const p = this.profile, c = this.controls;
    c.play.textContent = this._text(this.playing ? 'pause' : 'play'); c.play.disabled = this.reducedMotion;
    c.play.setAttribute('aria-pressed', String(this.playing));
    c.seek.value = String(this.phase); c.seek.setAttribute('aria-label', this._text('seek'));
    c.seek.setAttribute('aria-valuetext', this._text(this.racket.stage) + ' ' + Math.round(this.phase * 100) + '%');
    const rate = String(this.rate); c.rate.value = rate;
    if (c.rate.value !== rate) {
      const old = c.rate.querySelector('[data-preview-custom-rate]'); if (old) old.remove();
      const option = document.createElement('option'); option.value = rate; option.textContent = this.rate.toFixed(2) + 'x';
      option.setAttribute('data-preview-custom-rate', ''); c.rate.appendChild(option); c.rate.value = rate;
    }
    c.camera.value = this.camera; c.grip.value = p.grip;
    c.hand.value = p.hand; c.forehand.value = p.forehand ? 'fh' : 'bh'; c.tableguide.checked = this.tableguide;
    this.root.querySelector('.tt-preview-phase').textContent = this._text(this.racket.stage);
  }

  _fit(rig, buf, points, look, yaw, pitch, aspect, zoom = 1) {
    V3.copy(rig.look, look);
    const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
    let lo = .25, hi = 30;
    for (let pass = 0; pass < 22; pass++) {
      const d = (lo + hi) * .5;
      V3.set(rig.eye, look.x + sy * cp * d, look.y + sp * d, look.z + cy * cp * d);
      const vp = rigViewProj(rig, aspect, buf);
      let fits = true;
      for (const p of points) {
        const s = projectPoint(vp, p, this._screen);
        if (!s.ok || s.x < .075 || s.x > .925 || s.y < .085 || s.y > .915) { fits = false; break; }
      }
      if (fits) hi = d; else lo = d;
    }
    const d = hi / zoom;
    V3.set(rig.eye, look.x + sy * cp * d, look.y + sp * d, look.z + cy * cp * d);
    rigViewProj(rig, aspect, buf);
  }

  _layout() {
    const R = this.g.R, canvas = this.g.canvas;
    const rect = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: R._w, height: R._h };
    this._width = rect.width || R._w; this._height = rect.height || R._h;
    const stage = this._stage ? this._stage.getBoundingClientRect() : rect;
    this._viewport = { x: (stage.left - rect.left) / this._width, y: (stage.top - rect.top) / this._height,
      w: (stage.width || this._width) / this._width, h: (stage.height || this._height) / this._height };
    const inset = this.root && this.root.querySelector('.tt-preview-inset-window').getBoundingClientRect();
    const panel = this.root && this.root.querySelector('.tt-preview-details').getBoundingClientRect();
    this._inset = inset && inset.width > 0 ? { x: (inset.left - rect.left) / this._width, y: (inset.top - rect.top) / this._height,
      w: inset.width / this._width, h: inset.height / this._height } : null;
    this._insetClip = null;
    if (this._inset) {
      const left = Math.max(inset.left, panel.left, rect.left), right = Math.min(inset.right, panel.right, rect.left + this._width);
      const top = Math.max(inset.top, panel.top, rect.top), bottom = Math.min(inset.bottom, panel.bottom, rect.top + this._height);
      if (right <= left || bottom <= top) this._inset = null;
      else this._insetClip = { x: (left - rect.left) / this._width, y: (top - rect.top) / this._height,
        w: (right - left) / this._width, h: (bottom - top) / this._height };
    }
    this._aspect = Math.max(.2, this._viewport.w * this._width / Math.max(1, this._viewport.h * this._height));
    this._fit(this._guideRig, this._guideBuf, this.clip.bounds, this.clip.center, this.profile.side < 0 ? Math.PI : 0, .62, this._aspect);
    this._buildGuide(); this._cameraDirty = true; this._layoutDirty = false;
  }

  // Unlike unprojectToPlane (Z=constant), this ray hits the TABLE's Y plane.
  // Invalid intersections stay gaps; neither orbit nor clipping moves the recipe.
  _tableRay(px, py, out) {
    const rig = this._guideRig, b = rigBasis(rig, {}), aspect = this._aspect;
    const half = Math.tan(lensFovDeg(rig.fov, aspect) * DEG / 2), x = (px * 2 - 1) * half * aspect;
    const y = (1 - py * 2 + 2 * (rig.shiftY || 0)) * half;
    const dx = b.fx + b.rx * x + b.ux * y, dy = b.fy + b.ry * x + b.uy * y, dz = b.fz + b.rz * x + b.uz * y;
    if (Math.abs(dy) < 1e-7) return null;
    const t = (PH.TABLE_Y + .003 - rig.eye.y) / dy;
    if (t <= 0) return null;
    V3.set(out, rig.eye.x + dx * t, PH.TABLE_Y + .003, rig.eye.z + dz * t);
    return Math.abs(out.x) <= PH.T_HALF_WID && Math.abs(out.z) <= PH.T_HALF_LEN ? out : null;
  }

  _buildGuide() {
    const p = this.profile, model = p.gesture, ballP = this.clip.ball.p;
    const anchor = projectPoint(this._guideBuf.vp, { x: ballP.x, y: PH.TABLE_Y + .003, z: ballP.z }, {});
    const mirror = p.hand === 'left' ? -1 : 1;
    this._worldGuide = model.points.map(point => this._tableRay(anchor.x + point[0] * mirror, anchor.y + point[1], V3.new()));
    this._grid = []; this._labels = [];
    if (this.root) this.root.querySelector('.tt-preview-labels').replaceChildren();
    const line = (a, b) => this._grid.push([a, b]);
    const y = PH.TABLE_Y + .003;
    for (let x = -.75; x <= .751; x += .25) line(V3.new(x, y, -PH.T_HALF_LEN), V3.new(x, y, PH.T_HALF_LEN));
    for (let z = -1.25; z <= 1.251; z += .25) line(V3.new(-PH.T_HALF_WID, y, z), V3.new(PH.T_HALF_WID, y, z));
    this._gridMatrices = this._grid.map(line => this._lineMatrix(line[0], line[1], .0025));
    this._gestureMatrices = [];
    for (let i = 1; i < this._worldGuide.length; i++) if (this._worldGuide[i - 1] && this._worldGuide[i]) {
      const line = this._lineMatrix(this._worldGuide[i - 1], this._worldGuide[i], .006);
      if (line) this._gestureMatrices.push(line);
    }
    const last = this._worldGuide.at(-1), previous = this._worldGuide.at(-2);
    if (last && previous && V3.dist(last, previous) > 1e-6) {
      const direction = V3.norm(V3.new(), V3.sub(V3.new(), last, previous));
      this._gestureMatrices.push(...this._arrowMatrices(last, direction, .045));
    }
    this._axisMatrices = this._arrowMatrices(V3.new(0, y, .18), V3.new(1, 0, 0), .5)
      .concat(this._arrowMatrices(V3.new(-.5, y, .3), V3.new(0, 0, 1), .7));
    for (const [text, point] of [['X (m)', V3.new(.58, y, .35)], ['Z (m)', V3.new(-.50, y, 1.12)],
      ['0.5 m', V3.new(.5, y, .08)], ['1.0 m', V3.new(-.08, y, 1)]]) {
      const el = this.root && document.createElement('span');
      if (el) { el.textContent = text; this.root.querySelector('.tt-preview-labels').appendChild(el); }
      this._labels.push({ text, point, el });
    }
    if (this.root) {
      const xs = model.points.map(point => point[0] * mirror), ys = model.points.map(point => point[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const scale = Math.min(280, 204 / Math.max(.01, maxX - minX), 96 / Math.max(.01, maxY - minY));
      const ox = 120 - (minX + maxX) * .5 * scale, oy = 66 - (minY + maxY) * .5 * scale;
      const svg = this.root.querySelector('.tt-preview-gesture svg'), pts = model.points.map(point => [ox + point[0] * mirror * scale, oy + point[1] * scale]);
      svg.querySelector('.tt-preview-swipe').setAttribute('d', pts.map((point, i) => (i ? 'L' : 'M') + point.join(' ')).join(' '));
      for (const [selector, at] of [['.tt-preview-touch-start', 0], ['.tt-preview-touch-window', model.contactIndex], ['.tt-preview-touch-contact', model.contactIndex]]) {
        svg.querySelector(selector).setAttribute('cx', pts[at][0]); svg.querySelector(selector).setAttribute('cy', pts[at][1]);
      }
      this._gesturePoints = pts;
    }
  }

  _lineMatrix(a, b, width) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, length = Math.hypot(dx, dy, dz);
    if (length < 1e-7) return;
    V3.set(this._a, (a.x + b.x) * .5, (a.y + b.y) * .5, (a.z + b.z) * .5);
    V3.set(this._b, dx / length, dy / length, dz / length);
    const reference = Math.abs(this._b.y) > .95 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    Q.lookRotation(this._q, this._b, reference);
    return M4.compose(M4.create(), this._a, this._q, V3.set(this._scale, width, width, length));
  }

  _dot(point, radius, mat) {
    M4.compose(this._matrix, point, Q.identity(this._q), V3.set(this._scale, radius, radius, radius));
    this.g.R.draw(this.g.scene.mesh.sphere, this._matrix, mat);
  }

  _arrowMatrices(point, direction, length) {
    const tip = V3.addScaled(V3.new(), point, direction, length);
    const side = V3.norm(V3.new(), V3.cross(V3.new(), direction, Math.abs(direction.y) > .9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }));
    const a = V3.addScaled(V3.new(), tip, direction, -.035), b = V3.clone(a);
    V3.addScaled(a, a, side, .017); V3.addScaled(b, b, side, -.017);
    return [this._lineMatrix(point, tip, .004), this._lineMatrix(tip, a, .004), this._lineMatrix(tip, b, .004)];
  }

  _drawContact() {
    const c = this.clip, R = this.g.R, S = this.g.scene;
    this._rig.draw(R, S, c.drawPaddle);
    M4.compose(this._matrix, c.ball.p, c.ball.q, V3.set(this._scale, 1, 1, 1)); R.draw(S.mesh.ball, this._matrix, S.mat.ball);
    this._drawContactGlyphs();
  }

  _drawContactGlyphs() {
    const c = this.clip, R = this.g.R, S = this.g.scene;
    for (const line of c.normalLines) R.draw(S.mesh.box, line, c.normalMat);
    for (const line of c.headLines) R.draw(S.mesh.box, line, this._headMat);
    this._dot(c.pose.point, .005, this._pointMat);
  }

  _useCamera(rig, buf) {
    const R = this.g.R, gl = R.gl, u = R.progMain.u;
    R.viewProj = buf.vp; R.proj = buf.proj; R.view = buf.view; R.camPos = rig.eye;
    gl.useProgram(R.progMain.p);
    gl.uniformMatrix4fv(u.uViewProj, false, buf.vp); gl.uniform3f(u.uCam, rig.eye.x, rig.eye.y, rig.eye.z);
  }

  _glRect(rect) {
    const R = this.g.R;
    return [Math.round(rect.x * R._w), Math.round((1 - rect.y - rect.h) * R._h),
      Math.max(1, Math.round(rect.w * R._w)), Math.max(1, Math.round(rect.h * R._h))];
  }

  render() {
    if (!this.active || !this.clip || !this.g.R || !this.g.scene) return;
    const R = this.g.R, gl = R.gl;
    if (gl.isContextLost && gl.isContextLost()) { this.close(false); return; }
    if (this._layoutDirty || this._rw !== R._w || this._rh !== R._h) { this._rw = R._w; this._rh = R._h; this._layout(); }
    if (this._cameraDirty) {
      const c = this.clip, contact = this.camera === 'contact';
      const points = contact ? c.contactBounds : c.bounds;
      this._fit(this._cameraRig, this._cameraBuf, points, contact ? c.pose.point : c.center,
        this.orbit.yaw, this.orbit.pitch, this._aspect, this.orbit.zoom);
      this._cameraDirty = false;
    }
    const old = { vp: R.viewProj, proj: R.proj, view: R.view, cam: R.camPos }, state = this._restoreGL;
    state.viewport.set(gl.getParameter(gl.VIEWPORT)); state.scissor.set(gl.getParameter(gl.SCISSOR_BOX));
    state.scissorOn = gl.isEnabled(gl.SCISSOR_TEST); state.depthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
    state.framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING); state.program = gl.getParameter(gl.CURRENT_PROGRAM);
    state.drawCalls = R.drawCalls; state.tris = R.tris;
    if (R.nrmMat) state.normal.set(R.nrmMat);
    try {
      gl.disable(gl.SCISSOR_TEST);
      R.viewProj = this._cameraBuf.vp; R.proj = this._cameraBuf.proj; R.view = this._cameraBuf.view; R.camPos = this._cameraRig.eye;
      R.beginScene([.018, .022, .032]);
      const viewport = this._glRect(this._viewport);
      gl.viewport(...viewport); gl.scissor(...viewport); gl.enable(gl.SCISSOR_TEST);
      this._useCamera(this._cameraRig, this._cameraBuf);
      gl.uniform1f(R.progMain.u.uShadowOn, 0);
      this.g.scene.drawStatic(R, false);
      M4.compose(this._matrix, this.ball.p, this.ball.q, V3.set(this._scale, 1, 1, 1));
      R.draw(this.g.scene.mesh.ball, this._matrix, this.g.scene.mat.ball);
      this._rig.draw(R, this.g.scene, this._drawPaddle);
      this.g.scene.drawNet(R);
      if (this.camera === 'contact') this._drawContactGlyphs();
      else {
        if (this.tableguide) {
          for (const line of this._gridMatrices) R.draw(this.g.scene.mesh.box, line, this._guideMat);
          for (const line of this._gestureMatrices) R.draw(this.g.scene.mesh.box, line, this._gestureMat);
          if (this._worldGuide[0]) this._dot(this._worldGuide[0], .012, this._gestureMat);
          const window = this._worldGuide[this.profile.gesture.contactIndex];
          if (window) this._dot(window, .017, this._gestureMat);
          for (const line of this._axisMatrices) R.draw(this.g.scene.mesh.box, line, this._guideMat);
        }
        for (const line of R.quality === 'low' ? this.clip.pathLinesLow : this.clip.pathLines)
          R.draw(this.g.scene.mesh.box, line, this._racketPathMat);
      }
      if (this._inset) {
        const c = this.clip, rig = this._insetRig;
        V3.copy(rig.look, c.pose.point);
        V3.copy(rig.eye, c.insetEye);
        const inset = this._glRect(this._inset);
        rigViewProj(rig, inset[2] / inset[3], this._insetBuf);
        gl.viewport(...inset); gl.scissor(...this._glRect(this._insetClip || this._inset)); gl.depthMask(true);
        gl.clear(gl.DEPTH_BUFFER_BIT); this._useCamera(rig, this._insetBuf); this._drawContact();
      }
      gl.disable(gl.SCISSOR_TEST);
      this._useCamera(this._cameraRig, this._cameraBuf);
      R.present(this.reducedMotion ? 0 : this.phase * this.duration);
      this._overlay();
    } finally {
      R.viewProj = old.vp; R.proj = old.proj; R.view = old.view; R.camPos = old.cam;
      R.drawCalls = state.drawCalls; R.tris = state.tris;
      if (R.nrmMat) R.nrmMat.set(state.normal);
      gl.useProgram(R.progMain.p); gl.uniformMatrix4fv(R.progMain.u.uViewProj, false, old.vp);
      gl.uniform3f(R.progMain.u.uCam, old.cam.x, old.cam.y, old.cam.z);
      gl.useProgram(state.program); gl.bindFramebuffer(gl.FRAMEBUFFER, state.framebuffer);
      gl.viewport(...state.viewport); gl.scissor(...state.scissor);
      if (state.scissorOn) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST);
      gl.depthMask(state.depthMask);
    }
  }

  _overlay() {
    if (!this.root) return;
    const vp = this._cameraBuf.vp;
    for (const label of this._labels) {
      const s = projectPoint(vp, label.point, this._screen);
      label.el.hidden = !this.tableguide || this.camera === 'contact' || !s.ok || s.x < 0 || s.x > 1 || s.y < 0 || s.y > 1;
      label.el.style.left = s.x * 100 + '%'; label.el.style.top = s.y * 100 + '%';
    }
    const contact = projectPoint(vp, this.clip.pose.point, this._screen), el = this.root.querySelector('.tt-preview-contact-label');
    el.hidden = !contact.ok || contact.x < .02 || contact.x > .98 || contact.y < .02 || contact.y > .98;
    el.style.left = clamp(contact.x, .12, .88) * 100 + '%'; el.style.top = clamp(contact.y - .085, .07, .92) * 100 + '%';
    const model = this.profile.gesture, tc = this.clip.compiled.contactPhase, lo = this.clip.compiled.backPhase, hi = this.clip.compiled.finishPhase;
    const progress = this.phase <= tc ? clamp((this.phase - lo) / (tc - lo), 0, 1) * model.contactPhase
      : model.contactPhase + clamp((this.phase - tc) / (hi - tc), 0, 1) * (1 - model.contactPhase);
    const points = this._gesturePoints;
    let total = 0; for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    let distance = progress * total, x = points[0][0], y = points[0][1];
    for (let i = 1; i < points.length; i++) {
      const length = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      if (distance <= length) { const t = distance / Math.max(length, 1e-9); x = lerp(points[i - 1][0], points[i][0], t); y = lerp(points[i - 1][1], points[i][1], t); break; }
      distance -= length; x = points[i][0]; y = points[i][1];
    }
    const cursor = this.root.querySelector('.tt-preview-touch-cursor');
    cursor.setAttribute('cx', x); cursor.setAttribute('cy', y); cursor.toggleAttribute('hidden', this.reducedMotion);
    this.root.querySelector('.tt-preview-touch-window').toggleAttribute('data-preview-window-active', Math.abs(this.phase - tc) < .035);
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = TrainingPreview;
