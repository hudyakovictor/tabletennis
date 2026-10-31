/* One raw registry for storage/wire/UI; Game keeps requested values normalized. */
'use strict';

const CALIBRATION_REGISTRY = Object.freeze([
  { key: 'camHeight', default: 50, neutral: 0, group: 'camera', scope: 'visual', unit: 'deg', precision: 1,
    labelRu: 'Высота камеры', labelEn: 'Camera height',
    descriptionRu: 'Наклон относительно безопасной игровой камеры; 0 градусов сохраняет исходный вид.',
    descriptionEn: 'Pitch trim relative to the safe playing camera; 0 degrees keeps the original view.' },
  { key: 'camZoom', default: 50, group: 'camera', scope: 'visual', unit: 'x', precision: 2,
    labelRu: 'Приближение камеры', labelEn: 'Camera zoom',
    descriptionRu: '1.00x сохраняет исходный вид. Конечное приближение ограничено видимостью игрового объёма.',
    descriptionEn: '1.00x keeps the original view. Final zoom is limited by the visible playing volume.' },
  { key: 'camSway', default: 0, group: 'camera', scope: 'visual', unit: '%', precision: 0, requiresMotion: true,
    labelRu: 'Слежение камеры за мячом', labelEn: 'Camera ball tracking',
    descriptionRu: 'Небольшое боковое слежение за живым мячом; 0 выключает слежение.',
    descriptionEn: 'Subtle lateral tracking of the live ball; 0 disables it.' },
  { key: 'padSpeed', default: 100 * (1 - .84) / .36, neutral: 1, group: 'racket', scope: 'input', unit: 'x', precision: 2,
    labelRu: 'Чувствительность ракетки', labelEn: 'Racket sensitivity',
    descriptionRu: 'Перемещение ракетки на движение пальца; 1.00x соответствует базовой чувствительности, не скорости мяча.',
    descriptionEn: 'Racket travel per finger movement; 1.00x is the base sensitivity, not ball speed.' },
  { key: 'padSmooth', default: 40.625, neutral: 1000 / 55, group: 'racket', scope: 'input', unit: 'ms', precision: 2,
    labelRu: 'Отклик ракетки', labelEn: 'Racket response',
    descriptionRu: 'Базовый отклик 55/с, около 18.18 мс. Даже минимум не означает мгновенное перемещение.',
    descriptionEn: 'Base response is 55/s, about 18.18 ms. Even the minimum is not instantaneous movement.' },
  { key: 'fingerTrail', default: 55, group: 'racket', scope: 'visual', unit: 'x', precision: 2, requiresMotion: true,
    labelRu: 'Белый след пальца', labelEn: 'White finger trail',
    descriptionRu: 'Толщина и яркость нейтрального белого следа; минимум оставляет едва заметный штрих.',
    descriptionEn: 'Thickness and brightness of the neutral white trail; the minimum leaves a faint stroke.' },
  { key: 'spinGain', default: 100 * (1 - .5) / 1.1, neutral: 1, group: 'strike', scope: 'input', unit: 'x', precision: 2,
    labelRu: 'Сила закрутки', labelEn: 'Spin strength',
    descriptionRu: 'Коэффициент вращения от жеста; 1.00x соответствует базовому, физические свойства мяча и стола неизменны.',
    descriptionEn: 'Gesture spin gain; 1.00x is the base value. Ball and table physics stay unchanged.' },
  { key: 'arcSens', default: 100 * (1 - .6) / 1.2, neutral: 1, group: 'strike', scope: 'input', unit: 'x', precision: 2,
    labelRu: 'Чувствительность дуги', labelEn: 'Arc sensitivity',
    descriptionRu: 'Чувствительность распознавания дуги свайпа; 1.00x соответствует базовой.',
    descriptionEn: 'Swipe-arc recognition sensitivity; 1.00x is the base value.' },
  { key: 'tossHeight', default: 45, group: 'strike', scope: 'gameplay', unit: 'm/s', precision: 2,
    labelRu: 'Подброс подачи', labelEn: 'Serve toss',
    descriptionRu: 'Начальная вертикальная скорость законного подброса. Выше: больше времени на замах.',
    descriptionEn: 'Initial vertical speed of the legal toss. Higher gives more time for the swing.' },
  { key: 'ballSize', default: 50, group: 'ball', scope: 'visual', unit: 'x', precision: 2,
    labelRu: 'Видимый размер мяча', labelEn: 'Visible ball size',
    descriptionRu: 'Только изображение мяча; физический радиус и законность контакта не меняются.',
    descriptionEn: 'Ball appearance only; the physical radius and contact legality do not change.' },
  { key: 'trailLen', default: 33, group: 'ball', scope: 'visual', unit: 'ms', precision: 0, requiresMotion: true,
    labelRu: 'Длительность шлейфа мяча', labelEn: 'Ball trail duration',
    descriptionRu: 'Короткий след во времени, не скорость мяча; 0 полностью выключает шлейф.',
    descriptionEn: 'A short time-based trail, not ball speed; 0 disables the trail completely.' },
  { key: 'flytime', default: 50, neutral: 1, group: 'ball', scope: 'gameplay', unit: 'x', precision: 2, competitiveLocked: true,
    labelRu: 'Темп симуляции', labelEn: 'Simulation pace',
    descriptionRu: '0.35x / 1.00x / 1.25x. Меняется время, не импульсы мяча; в соревновании и проверке действует 1.00x.',
    descriptionEn: '0.35x / 1.00x / 1.25x. Changes time, not ball impulses; competition and checks use 1.00x.' },
  { key: 'tableGlow', default: 0, group: 'ball', scope: 'visual', unit: '%', precision: 0,
    labelRu: 'Дополнительное свечение стола', labelEn: 'Extra table glow',
    descriptionRu: 'Дополнительная эмиссия без изменения фактуры; 0 сохраняет исходный стол.',
    descriptionEn: 'Extra emission without changing the texture; 0 keeps the original table.' },
  { key: 'hintRadius', default: 60, neutral: 1, group: 'help', scope: 'training', unit: 'x', precision: 2,
    labelRu: 'Размер учебного маркера', labelEn: 'Training marker size',
    descriptionRu: 'Только учебная подсказка, не физический радиус захвата мяча.',
    descriptionEn: 'Training guidance only, not the physical ball capture radius.' },
  { key: 'captureK', default: 50, neutral: 1, group: 'help', scope: 'gameplay', unit: 'x', precision: 2, competitiveLocked: true,
    labelRu: 'Помощь захвату мяча', labelEn: 'Ball capture assistance',
    descriptionRu: '0.85x-1.30x от базового радиуса; в соревновании и проверке действует регламентное 1.00x.',
    descriptionEn: '0.85x–1.30x of the base radius; competition and checks use the regulation 1.00x.' },
  { key: 'hintGlow', default: 65, group: 'help', scope: 'training', unit: 'x', precision: 2,
    labelRu: 'Яркость учебной подсказки', labelEn: 'Training hint brightness',
    descriptionRu: 'Яркость учебного маркера при включённых подсказках; не расширяет окно контакта.',
    descriptionEn: 'Training marker brightness when hints are enabled; does not widen the contact window.' },
  { key: 'slowmoDepth', default: 100 * (.55 - .30) / .43, neutral: .30, group: 'help', scope: 'inspector', unit: 'x', precision: 2,
    labelRu: 'Темп инспектора', labelEn: 'Inspector pace',
    descriptionRu: 'Абсолютный временный темп разбора; не перемножается с личным темпом. Инспектор включается отдельно.',
    descriptionEn: 'Absolute temporary inspection pace, never multiplied by personal pace. Enable the inspector separately.' },
].map(entry => Object.freeze({ min: 0, max: 100, step: 'any', ...entry })));

function calibrationNumber(value, fallback) {
  const n = typeof value === 'number' || typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCalibrations(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const result = {};
  for (const entry of CALIBRATION_REGISTRY) {
    const value = Object.prototype.hasOwnProperty.call(source, entry.key) ? source[entry.key] : undefined;
    result[entry.key] = Math.max(entry.min, Math.min(entry.max, calibrationNumber(value, entry.default))) / 100;
  }
  return result;
}

function calibrationPace(valueNormalized) {
  const n = Math.max(0, Math.min(1, calibrationNumber(valueNormalized, .5)));
  return n <= .5 ? .35 + 1.3 * n : 1 + .5 * (n - .5);
}

function calibrationSessionKind(g) {
  if (g && g.training && g.training.stage === 'check') return 'check';
  if (g && g.network && g.network.isInMatch) return 'online';
  if (g && g.career && g.career.active) return 'career';
  return g && ['free', 'practice', 'ranked', 'career', 'check', 'online'].includes(g.sessionKind)
    ? g.sessionKind : g && g.training ? 'practice' : 'free';
}

function gameplayCalibrationLocked(g) {
  return ['online', 'ranked', 'career', 'check'].includes(calibrationSessionKind(g));
}

function calibrationValue(entry, n) {
  // Fractional defaults must land on the exact neutral coefficient, not a rounded raw slider value.
  if (n === entry.default / 100 && Number.isFinite(entry.neutral)) return entry.neutral;
  const camera = typeof CAM_ADJUST === 'undefined' ? null : CAM_ADJUST;
  switch (entry.key) {
    case 'camHeight': return n <= .5 ? (camera ? camera.pitchMin : -16) * (1 - n * 2) : (camera ? camera.pitchMax : 16) * (n * 2 - 1);
    case 'camZoom': return n <= .5 ? (camera ? camera.zoomMin : .6) + (1 - (camera ? camera.zoomMin : .6)) * n * 2 : 1 + ((camera ? camera.zoomMax : 1.8) - 1) * (n - .5) * 2;
    case 'padSpeed': return .84 + .36 * n;
    case 'padSmooth': {
      const range = typeof STROKE_CONFIG !== 'undefined' && STROKE_CONFIG.racket && STROKE_CONFIG.racket.trackingLagRange;
      const fast = range ? 1 / range[0] : 68, slow = range ? 1 / range[1] : 36;
      return 1000 / (fast + (slow - fast) * n);
    }
    case 'fingerTrail': return .35 + .9 * n;
    case 'spinGain': return .5 + 1.1 * n;
    case 'arcSens': return .6 + 1.2 * n;
    case 'tossHeight': {
      const toss = typeof STROKE_CONFIG !== 'undefined' && STROKE_CONFIG.serve && STROKE_CONFIG.serve.toss;
      return (toss ? toss.speed : 2.1) + (toss ? toss.speedSpan : .75) * n;
    }
    case 'ballSize': return .8 + .5 * n;
    case 'trailLen': return n * 32 / 60 * 1000;
    case 'flytime': return calibrationPace(n);
    case 'hintRadius': return .25 + 1.25 * n;
    case 'captureK': return n <= .5 ? .85 + .3 * n : 1 + .6 * (n - .5);
    case 'hintGlow': return .30 + .85 * n;
    case 'slowmoDepth': return .55 - .43 * n;
    default: return n * 100;
  }
}

function trimBallTrail(g, durationMs, reducedMotion = g && g.reducedMotion) {
  const ball = g && g.ball;
  if (!ball || !Array.isArray(ball.hist)) return;
  const settings = g.settings || {};
  const duration = !reducedMotion && settings.showTrail !== false && Number.isFinite(durationMs) ? durationMs / 1000 : 0;
  const h = ball.hist, times = ball.histTimes;
  if (!duration) { h.length = 0; if (times) times.length = 0; if (g.scene && g.scene.mesh && g.scene.mesh.trail) g.scene.mesh.trail.count = 0; return; }
  if (Array.isArray(times) && times.length * 3 === h.length && times.length > 0) {
    const cutoff = (g.time || 0) - duration;
    while (times.length > 1 && times[1] <= cutoff) { times.shift(); h.splice(0, 3); }
    if (times.length > 1 && times[0] < cutoff) {
      const k = (cutoff - times[0]) / (times[1] - times[0]);
      for (let axis = 0; axis < 3; axis++) h[axis] += (h[axis + 3] - h[axis]) * k;
      times[0] = cutoff;
    }
    if (times.length === 1 && times[0] < cutoff) { h.length = 0; times.length = 0; }
    return;
  }
  // Backward compatibility with frame-count based trail tests
  const points = Math.round(durationMs / 32);
  if (points <= 0) { h.length = 0; if (times) times.length = 0; if (g.scene && g.scene.mesh && g.scene.mesh.trail) g.scene.mesh.trail.count = 0; return; }
  const max = points * 3;
  if (h.length > max) h.splice(0, h.length - max);
  if (times) times.length = 0;
  const particles = g.particles;
  if (particles && particles.trail) for (let i = 0; i < particles.n; i++) {
    if (!particles.trail[i] || particles.life[i] <= 0) continue;
    const age = particles.maxLife[i] - particles.life[i];
    particles.maxLife[i] = duration; particles.life[i] = Math.max(0, duration - age);
  }
}

function calibrationState(g) {
  const requested = {}, effective = {}, raw = {}, values = { requested: {}, effective: {} }, active = {}, restrictions = {};
  const locked = gameplayCalibrationLocked(g);
  const reducedMotion = !!(g && (g.motionOff || g.motionQuery && g.motionQuery.matches || g.motionOff === undefined && g.reducedMotion));
  const inspectorAllowed = !locked && !(g && g.slowmo && g.slowmo.allowed === false);
  const inspectorOn = inspectorAllowed && !!(g && g.inspectSlowmo);
  const hintRequested = !!g && (typeof g.hintRequested === 'boolean' ? g.hintRequested : g.settings && typeof g.settings.hint === 'boolean' ? g.settings.hint : g.hintContact !== false);
  const hintOn = hintRequested && !locked && !(g && g.hintContact === false);
  for (const entry of CALIBRATION_REGISTRY) {
    const saved = g && g._cal && Object.prototype.hasOwnProperty.call(g._cal, entry.key) ? g._cal[entry.key] : undefined;
    const n = Math.max(0, Math.min(1, calibrationNumber(saved, entry.default / 100)));
    requested[entry.key] = n;
    effective[entry.key] = locked && entry.competitiveLocked ? entry.default / 100 : n;
    raw[entry.key] = n === entry.default / 100 ? entry.default : n * 100;
    values.requested[entry.key] = calibrationValue(entry, n);
    values.effective[entry.key] = calibrationValue(entry, effective[entry.key]);
    let reason = '';
    if (locked && (entry.competitiveLocked || entry.scope === 'inspector')) reason = 'competitive';
    else if (entry.scope === 'training' && !(g && g.training)) reason = 'training-only';
    else if (entry.scope === 'training' && !hintOn) reason = locked ? 'competitive' : 'hint-off';
    else if (entry.scope === 'inspector' && !inspectorOn) reason = 'inspector-off';
    else if (entry.requiresMotion && reducedMotion) reason = 'reduced-motion';
    else if (entry.key === 'trailLen' && g && g.settings && g.settings.showTrail === false) reason = 'trail-off';
    active[entry.key] = !reason || reason === 'competitive' && entry.competitiveLocked === true;
    restrictions[entry.key] = reason;
  }
  // Camera setters quantize trims; report the actually accepted values as well as the request.
  if (g && g._calEffective && g.settings) {
    if (g._calEffective.camHeight === effective.camHeight && Number.isFinite(g.settings.camPitch)) values.effective.camHeight = g.settings.camPitch;
    if (g._calEffective.camZoom === effective.camZoom && Number.isFinite(g.settings.camZoom)) values.effective.camZoom = g.settings.camZoom;
  }
  const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
  const rules = typeof MATCH_RULES === 'undefined' ? null : MATCH_RULES;
  const forgiveness = typeof getCaptureForgiveness === 'function' ? finite(getCaptureForgiveness(), 1) : 1;
  const personal = typeof getCaptureCalibration === 'function' ? finite(getCaptureCalibration(), values.effective.captureK) : values.effective.captureK;
  const envelope = typeof getCaptureEnvelope === 'function' ? finite(getCaptureEnvelope(), forgiveness * personal) : forgiveness * personal;
  const capture = { radius: rules ? finite(rules.captureRadius * envelope, null) : null,
    depth: rules ? finite(rules.depthTolerance * envelope, null) : null,
    serveRadius: rules ? finite(rules.serveCaptureRadius * forgiveness, null) : null, forgiveness, personal };
  return { requested, effective, raw, values, active, restrictions, sessionKind: calibrationSessionKind(g), locked,
    pace: calibrationPace(effective.flytime), requestedPace: calibrationPace(requested.flytime), reducedMotion, capture,
    hint: { requested: hintRequested, allowed: !locked, effective: hintOn },
    inspector: { requested: !!g && (typeof g.inspectSlowmoRequested === 'boolean' ? g.inspectSlowmoRequested : !!g.inspectSlowmo),
      allowed: inspectorAllowed, effective: inspectorOn, depth: values.effective.slowmoDepth },
    time: { real: finite(g && g.time), simulation: finite(g && g.strokeTime), timeScale: finite(g && g.timeScale, 1) } };
}

function refreshGameCalibrationPolicy(g, changedKey) {
  if (!g || typeof g !== 'object') return calibrationState(null);
  const state = calibrationState(g);
  const previousTrail = g._calEffective && g._calEffective.trailLen;
  g._calEffective = state.effective;
  g._calValues = {};
  g.settings = g.settings || {};
  for (const entry of CALIBRATION_REGISTRY) {
    const value = g._calValues[entry.key] = calibrationValue(entry, state.effective[entry.key]);
    if (changedKey && changedKey !== entry.key) continue;
    if (entry.key === 'camHeight') {
      if (typeof g.setCamPitch === 'function') g.setCamPitch(value); else g.settings.camPitch = value;
    } else if (entry.key === 'camZoom') {
      if (typeof g.setCamZoom === 'function') g.setCamZoom(value); else g.settings.camZoom = value;
    } else if (entry.key === 'spinGain' || entry.key === 'arcSens') g.settings[entry.key] = value;
    else if (entry.key === 'tableGlow' && g.scene && g.scene.mat && g.scene.mat.table) {
      g.scene.mat.table = { ...g.scene.mat.table, emissive: [.018 * state.effective.tableGlow, .042 * state.effective.tableGlow, .10 * state.effective.tableGlow] };
    } else if (entry.key === 'trailLen' && g.ball && Array.isArray(g.ball.hist)) {
      const ms = value;
      const points = Math.round(ms / 32);
      if ((!points || previousTrail !== state.effective.trailLen || changedKey === 'trailLen') && g.ball.hist.length > points * 3) {
        g.ball.hist.splice(0, g.ball.hist.length - points * 3);
      }
      if (!points) { g.ball.hist.length = 0; if (g.ball.histTimes) g.ball.histTimes.length = 0; }
      if (!points && g.scene && g.scene.mesh && g.scene.mesh.trail) g.scene.mesh.trail.count = 0;
    }
  }
  g._swayCal = state.reducedMotion ? 0 : state.effective.camSway;
  if (g._capCalK !== g._calValues.captureK || typeof getCaptureCalibration === 'function' && getCaptureCalibration() !== g._calValues.captureK) {
    g._capCalK = g._calValues.captureK;
    if (typeof setCaptureCalibration === 'function') setCaptureCalibration(g._capCalK);
  }
  if (typeof g.hintRequested !== 'boolean') g.hintRequested = state.hint.requested;
  g.hintContact = g.hintRequested && state.hint.allowed;
  g.settings.hint = g.hintContact;
  if (typeof g.inspectSlowmoRequested !== 'boolean') g.inspectSlowmoRequested = state.inspector.requested;
  g.inspectSlowmo = g.inspectSlowmoRequested && state.inspector.allowed;
  if (state.locked && g.slowmo) { g.slowmo.on = false; g.slowmo.active = false; }
  return calibrationState(g);
}

function applyGameCalibration(g, key, rawValue) {
  const entry = CALIBRATION_REGISTRY.find(row => row.key === key);
  if (!entry || !g || typeof g !== 'object') return calibrationState(g);
  const initialized = !!g._calEffective;
  g._cal = calibrationState(g).requested;
  g._cal[key] = Math.max(entry.min, Math.min(entry.max, calibrationNumber(rawValue, entry.default))) / 100;
  return refreshGameCalibrationPolicy(g, initialized ? key : undefined);
}

function applyGameCalibrations(g, rawValues) {
  if (!g || typeof g !== 'object') return calibrationState(null);
  g._cal = normalizeCalibrations(rawValues);
  return refreshGameCalibrationPolicy(g);
}
