/* Shared stroke tuning. Loaded before every consumer; no math/physics dependencies.
 * Archetype/contact/motion angles are degrees; solver/azimuth/wrist angles are
 * radians. Velocities m/s, spin rad/s, times seconds (snapFrames uses 60 Hz).
 * Keep this mutable: consumers read current values, not copies of tuning scalars. */
'use strict';

const STROKE_CONFIG = {
  archetypes: {
    LOOP: { elev: 58, contact: 63, speed: 1.00, lat: 0.50, back: false },
    COUNTER: { elev: 46, contact: 56, speed: 1.06, lat: 0.50, back: false },
    DRIVE: { elev: 24, contact: 33, speed: 1.00, lat: 0.60, back: false },
    SIDE: { elev: 22, contact: 33, speed: 0.55, lat: 1.00, back: false, attackLean: false },
    SMASH: { elev: -5, contact: 22, speed: 1.10, lat: 0.45, back: false },
    FLICK: { elev: 50, contact: 58, speed: 0.90, lat: 0.60, back: false },
    PUSH: { elev: -28, contact: 64, speed: 0.56, lat: 0.45, back: true, soft: 0.84 },
    CHOP: { elev: -50, contact: 68, speed: 0.66, lat: 0.40, back: true },
    BLOCK: { elev: 11, contact: 26, speed: 0.30, lat: 0.35, back: false, soft: 0.62, absorb: 0.26 },
    LOB: { elev: 66, contact: 50, speed: 0.60, lat: 0.35, back: false },
    HOOK: { elev: 28, contact: 56, speed: 1.00, lat: 1.70, back: false },
    FADE: { elev: 28, contact: 56, speed: 1.00, lat: 1.70, back: false },
    DROP: { elev: -10, contact: 58, speed: 0.34, lat: 0.30, back: true, soft: 0.55, absorb: 0.30 },
    SERVE_TOP: { elev: 46, contact: 58, speed: 0.80, lat: 0.60, back: false },
    SERVE_BACK: { elev: -34, contact: 64, speed: 0.95, lat: 0.50, back: true },
    SERVE_SIDE: { elev: 0, contact: 62, speed: 0.85, lat: 2.00, back: false },
    SERVE_FAST: { elev: -13, contact: 24, speed: 1.12, lat: 0.60, back: false },
  },
  classification: {
    serveSideLatThreshold: 0.35, serveCurlThreshold: 0.38,
    serveHorizontalUMax: 0.12, serveFastDistMin: 0.25,
    serveFastSpeedThreshold: 0.92, serveFastUMax: 0.45, serveBackUMin: -0.18,
    fastSpeedThreshold: 0.60, veryFastSpeedThreshold: 0.92, slowSpeedThreshold: 0.30,
    defaultBallHeight: 0.18, defaultBallDepth: 1.2, defaultIncomingSpeed: 6,
    overTableMargin: 0.02, touchDistMax: 0.050, touchSpeedMax: 0.45,
    blockIncomingSpeed: 7, blockIncomingTop: 220, dropHeightMax: 0.34,
    arcSensRange: [0.6, 1.8], arcCurlThreshold: 0.55, arcDistMin: 0.028,
    arcBendMin: 1.15, arcStraightnessMax: 0.74, arcStrongCurlThreshold: 0.90,
    smashHeightMin: 0.14, smashSpeedMin: 0.52, smashUMax: 0.52,
    backUMin: -0.28, chopDepthMargin: 0.40, chopDistMin: 0.20,
    dropSpeedMax: 0.22, dropTableHeightMax: 0.35,
    /* horizontalUMax — окно «чисто бокового» свайпа в розыгрыше, ~±10°.
     * Расширять нельзя: замер обучающих жестов даёт у DRIVE и SMASH |u| = 0.196,
     * то есть при 0.30 плоская атака целиком переклассифицировалась бы в SIDE
     * и игрок терял и смэш, и драйв. Боковой канал в розыгрысе спасает не окно,
     * а закон щётки (sideBrush*): раньше горизонтальный SIDE вылетал с 70 об/с
     * верха при 35 об/с бока, теперь — 6 об/с верха при 35 об/с бока. */
    sideLatThreshold: 0.50, sideCurlThreshold: 0.30, horizontalUMax: 0.18,
    liftUMin: 0.70, lobHeightMax: 0.55,
    fastBlockIncomingSpeed: 8, fastBlockDistMax: 0.18, fastBlockSpeedMax: 0.62,
    flickDistMax: 0.13, flickHeightMax: 0.30, counterIncomingTop: 170,
    loopUMin: 0.30, counterStrongIncomingTop: 260,
    minGesture: {
      serve: { path: 0.019, dist: 0.014, speed: 0.12 },
      rally: { path: 0.046, dist: 0.034, speed: 0.30 },
      arc: { path: 0.09, curl: 0.8 },
    },
  },
  spin: {
    spinIntentWeights: { u: 0.78, dist: 1.6, curl: 0.08 },
    verticalExponent: 1.25, distanceIntentMax: 0.35, intentRange: [0, 1.15],
    contactIntentRange: [20, 74], contactWeights: [0.62, 0.46],
    contactHeightK: 42, contactHeightRange: [-16, 10], contactAngleRange: [14, 80],
    contactClampByArchetype: { SERVE_SIDE: [10, 22] },
    spinGainRange: [0.5, 1.6], spinGainContactK: 8,
    biasContactK: 9, biasSpeedK: 0.08,
    faceGestureK: 0.34, faceCurlK: 0.10,
    lateralGestureMin: 0.25, lateralCurlScale: 1.5, nonSideCurlK: 0.45,
    lateralArchetypeBase: 0.60, lateralArchetypeSpan: 1.40, lateralIntentK: 1.35,
    /* ЧИСТО боковой жест в розыгрысе (архетип SIDE): замах остаётся ПОЧТИ по
     * линии, щётка берётся разворотом грани поперёк него. Прежняя модель кидала
     * плечо на 41° вбок, и перебор «азимут × подъём × темп» (306 клеток,
     * temp/rally-side-space.cjs) давал 2 легальные клетки — мяч улетал за
     * боковую, ни один ассист его не спасал. HOOK/FADE не трогаем: там боковой
     * полёт и есть смысл удара, латеральный азимут оставляем как был. */
    sideAzSwingDamp: 1.6, sideFaceChordDamp: 2.5,
    /* Потолок замаха для чистого бокового свайпа: касание скользящее, и при
     * 11+ м/с тот жест давал 89 км/ч с 24 об/с бока — мяч улетал за стол, и
     * лестница ассиста (0.85 → 1.0 → смягчение темпа) не оставляла его в игре
     * (замер temp/side-browser-probe.cjs, режим burst). 6.5 м/с = ~50 км/ч. */
    sideVmax: 6.5,
    /* lateralTurnK — разворот грани ПОПЁК замаха, единственный канал, который
     * даёт ω вокруг вертикали. Розыгрыш оставлен как был (0.62): при большем
     * значении HOOK/FADE с lat=1.7 уходят в почти скользящий контакт и мяч
     * умирает (замер: 53 → 23 → 5 km/h). Подача — отдельная ручка: там latMix=1,
     * жест боковой по смыслу и скорости не хватает; 1.9 даёт 30 об/с бока при
     * 1 об/с верха вместо прежних 4 об/с бока при 10 об/с верха. */
    lateralTurnK: 0.62, lateralTurnKServe: 1.9, lateralGainWeights: [0.72, 0.28], verticalContactLateralK: 0.58,
    sideBrushVerticalK: 1, sideBrushLateralExp: 1.2,
    rubberSoftWeights: [0.5, 0.5], rubberGainWeights: [0.75, 0.25], cap: 1080,
  },
  serve: {
    sideK: 1,                 // lateral classification sensitivity, not a spin multiplier
    sideBrushVerticalK: 1,    // remove unrequested vertical brush on lateral serves
    sideBrushLateralExp: 1.2, // how much of that brush survives a diagonal swipe
    tossMinRise: 0.16, captureRadius: 0.55, qualityRadiusK: 0.40,
    vmin: 1.2, vmax: 12.5, ballMax: 17.5, contactAngleRange: [14, 80], azSwingK: 0.30,
    toss: {
      height: 0.14, lateralOffset: 0, paddleZOffset: 0.04, endLineMargin: 0.04, farZ: 2.0,
      speed: 2.10, speedSpan: 0.75, speedJitter: 0.20, lateralJitter: 0.03,
      calibrationDefault: 0.45, queuedWindow: 0.60, timeout: 3.4,
      readyHeight: 0.17, readyEndMargin: 0.20, readyXJitter: 0.26,
      aiReadyDelay: [0.7, 1.3], aiServeXJitter: 0.34, aiReadyXMax: 0.42,
      aiEndMargin: 0.16, aiApproachRate: 6, aiPositionXMax: 0.60, aiZMin: 1.02,
      aiPaddleHeight: 0.25, aiPaddleZOffset: 0.05, aiFarMargin: 0.30, aiNearZ: 1.05,
      aiSpeed: 3.1, aiLateralJitter: 0.05, aiContactHeight: 0.36,
      aiContactDelay: 0.10, aiSwingDelay: 0.42, aiTimeout: 0.60,
    },
    tracking: { weights: [0.55, 0.45], zOffset: 0.02, underBall: 0.04 },
    glance: { bandMul: 1.36, liftMs: [1.55, 2.6], speedMs: [1.3, 3.0],
      counterAim: 0.9, sideK: 1.30, fwdK: 1.15, steps: 5, coarseDt: 1 / 120, courtMargin: 0.01 },
    curlRecoveryThreshold: 0.55, curlRecoveryK: 0.30,
    solver: {
      coarseDt: 1 / 170, maxT: 2.2, flightBudget: 70,
      paceWeights: [0.85, 0.17], spinWeight: 7, minPastNet: 0.70,
      depthSpan: 0.50, deadZoneWeight: 5, paceScaleRange: [0.16, 4.5],
      ownBounce: { lateralK: 0.35, depth: 0.78, aimDepthK: 0.16 },
      warmGrid: 0.09, warmErrorMax: 0.16, warmLimit: 96,
      depthFactors: [1.0, 0.92, 0.84], damping: [1, 0.58],
      azimuthIndices: [-3, 3], azimuthStep: 0.26, initialScale: 0.65,
      elevationIndices: [-6, 4], elevationStep: 0.15, scales: [0.45, 0.75, 1.10, 1.45],
      shortAimMax: 0.80, shortElevations: [-0.45, -0.30, -0.20, -0.05],
      shortScales: [0.30, 0.37, 0.45, 0.55], scaleMultipliers: [0.8, 0.9, 1.0, 1.1, 1.25, 1.5],
      polishPasses: 3, polishSteps: [0.05, 0.10, 0.10], minScale: 0.16,
      recoveryScaleRange: [0.10, 2.10], recoveryPasses: 9, recoveryScaleTolerance: 0.02,
      recoveryAzimuths: [0, -0.12, 0.12, -0.26, 0.26, -0.42, 0.42],
      recoveryElevations: [0.10, 0.20, 0.32], maxScaleWeights: [1.6, 2.6],
      boostedScales: [1.6, 2.2, 3.0, 4.0, 5.2],
      fallbackFaceAnglesRad: [-0.26, -0.10, 0.06, 0.22], fallbackScales: [1.0, 1.5, 2.2, 3.2],
      depthBoostScales: [1.3, 1.7, 2.2, 2.9, 3.8],
      safeOwnDepth: 0.55, safeAimDepth: 1.00,
      safeElevations: [-1.25, -1.05, -0.9, -0.75, -0.6, -0.3, 0, 0.3],
      safeAzimuths: [0, -0.3, 0.3], safeScales: [0.7, 0.4, 0.55, 0.95, 1.25],
      assistWeights: [0.45, 0.55],
      score: {
        forwardMin: 0.30, back: 60, fast: 7, fastK: 0.6,
        noBounce: 40, netTouch: 4, wrongSide: 26,
        net: 12, netOwnK: 0.3, netHeightK: 10,
        long: 6, longMissK: 0.6, longOwnK: 0.15, missingLanding: 1.2,
        doubleOwn: 9, out: 5.5, outMissK: 2, edgeRadiusK: 0.5, ownK: 0.22,
      },
    },
  },
  racket: {
    vmin: 0.8, vmax: 19.5,
    speed: { floor: 2.2, span: 15.3, exponent: 0.82, peakK: 0.78, inputScale: 4.2, powerMax: 1.45, fallback: 4 },
    gestureElev: 66, elevWeights: [0.52, 0.62], elevRange: [-72, 80],
    azSwingK: 0.72, azSwingRange: [-1.35, 1.35], azFaceRange: [-0.80, 0.80],
    lateralFaceRange: [-1.25, 1.25], faceElevRangeRad: [-1.35, 1.35],
    moveYawRange: [-0.6, 0.6], moveYawK: 0.85, movePitchRange: [-0.55, 0.55],
    attackLeanRad: [0.18, 0.10],
    frameElevRangeRad: [-1.30, 1.40], frameSwingRangeRad: [-1.40, 1.40], frameFaceRangeRad: [-1.35, 1.35],
    rubber: { e: 0.800, eSpeed: 0.0060, mu: 1.05, et: 0.52, damp: 1 },
    impact: {
      restitutionQuality: [0.55, 0.45], frictionQuality: [0.6, 0.4], tangentialQuality: [0.5, 0.5],
      restitutionRange: [0.18, 0.92], minRestitution: 0.05,
    },
    snapDistance: 0.06, snapAssist: [0.35, 0.25], snapFrames: 1.5, // contact hold in reference 60 Hz frames
    trackingLag: 1 / 55, trackingLagRange: [1 / 68, 1 / 36], resetTrackingLag: 1 / 32, depthTrackingK: 0.7,
    launchSeparation: 1.05,
    validation: { coarseDt: 1 / 160, maxT: 2.2 },
    contact: {
      timingThresholds: [0.93, 0.80, 0.62], timingQuality: [1.08, 1.0, 0.90, 0.74], timingMin: 0.35, speedBonus: 1.05,
      sweetWeights: [0.60, 0.40], timingWeights: [0.70, 0.30], qualityRange: [0.25, 1],
      missSpeedK: 0.18, missAzimuthK: 0.23, missElevationK: 8, missElevationRange: [-70, 78],
      fallbackQualityMax: 0.85, readyBlendTime: 0.045,
      /* Лестница «честного смягчения»: если ни один ассист не нашёл легального
       * полёта, темп приглушается, но грань обязана подняться — медленный мяч
       * с закрытым лицом уходит в сетку. Пары: [добавленный подъём, рад;
       * целевая скорость ракетки, м/с], первая законная берётся. */
      softening: [[0.30, 4.2], [0.45, 4.8], [0.62, 5.6], [0.18, 3.6]],
    },
    placement: {
      deadZone: 0.14, gestureK: 0.50, widthK: 0.86, netMargin: 0.16, endMargin: 0.07,
      depth: { DROP: [0.13, 0], PUSH: [0.46, 0.30], FLICK: [0.55, 0], BLOCK: [0.45, 0.30], LOB: [0.90, 0], SMASH: [0.72, 0], CHOP: [0.58, 0] },
      defaultDepth: [0.34, 0.44, 0.26], depthRange: [0.2, 0.96],
    },
    quality: { base: 0.46, smooth: 0.24, straightness: 0.16, samples: 0.14, sampleCount: 12, curlK: 0.10, curlStart: 1.4, curlMax: 1.6, range: [0.2, 1] },
    netClear: { LOB: 0.50, DROP: 0.035, PUSH: 0.115, CHOP: 0.115, SMASH: 0.040, default: 0.055 },
  },
  motion: {
    SERVE: { ready: 15, prepare: -20, contact: 0, follow: 25, roll: 0.20,
      followTime: 0.12, recoverTime: 0.20, range: [-45, 45], hold: 0.025 },
  },
};
