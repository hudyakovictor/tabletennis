const STAMINA_CONFIG = Object.freeze({
  energyMax: 100,
  fatigueMax: 45,
  fatiguePerWork: .07,
  regenPerSecond: 4,
  regenDelay: .55,
  pointRecovery: 12,
  tapCost: 2,
  lowEnter: 25,
  lowExit: 30,
  intensity: Object.freeze({ base: .5, effortSquared: .5 }),
  curve: Object.freeze({ fatigueLoss: .12, energyFloor: .60, lowRatio: .15, fullRatio: .60 }),
  costs: Object.freeze({
    DRIVE: 8, LOOP: 12, COUNTER: 10, SMASH: 17,
    SIDE: 8, HOOK: 10, FADE: 10, FLICK: 8, BANANA: 10,
    PUSH: 4, CHOP: 7, CHOP_BLOCK: 4, BLOCK: 3, LOB: 6, DROP: 4,
    SERVE_TOP: 6, SERVE_BACK: 6, SERVE_SIDE: 7, SERVE_FAST: 9, SERVE_NO_SPIN: 4,
  }),
});

const Stamina = (() => {
  const cfg = STAMINA_CONFIG;
  const bounded = (value, min, max, fallback = min) =>
    Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  // Accumulated floating-point dt error must not flip the latch at exactly 25/30.
  const lowAt = (energy, previous) => energy < cfg.lowEnter - 1e-9
    || (energy <= cfg.lowExit + 1e-9 && previous === true);
  const capacity = state => cfg.energyMax - bounded(state?.fatigue, 0, cfg.fatigueMax, cfg.fatigueMax);
  // Runtime bad numbers fail depleted, never by silently creating a fresh player.
  const normalized = state => {
    const fatigue = bounded(state?.fatigue, 0, cfg.fatigueMax, cfg.fatigueMax);
    const energy = bounded(state?.energy, 0, cfg.energyMax - fatigue);
    return {
      energy, fatigue,
      regenDelayRemaining: bounded(state?.regenDelayRemaining, 0, cfg.regenDelay, cfg.regenDelay),
      low: lowAt(energy, state?.low),
    };
  };
  const effortScale = state => {
    const current = normalized(state);
    const curve = cfg.curve;
    const ratio = current.energy / capacity(current);
    const t = bounded((ratio - curve.lowRatio) / (curve.fullRatio - curve.lowRatio), 0, 1);
    return (1 - curve.fatigueLoss * current.fatigue / cfg.fatigueMax)
      * (curve.energyFloor + (1 - curve.energyFloor) * t * t * (3 - 2 * t));
  };

  return Object.freeze({
    fresh() {
      return { energy: cfg.energyMax, fatigue: 0, regenDelayRemaining: 0, low: false };
    },
    capacity,
    cost(request) {
      if (request?.kind === 'tap') return cfg.tapCost;
      const effort = bounded(request?.effort, 0, 1);
      const base = Object.prototype.hasOwnProperty.call(cfg.costs, request?.strokeId)
        ? cfg.costs[request.strokeId] : cfg.costs.DRIVE;
      return base * (cfg.intensity.base + cfg.intensity.effortSquared * effort * effort);
    },
    charge(state, positiveWork) {
      const next = normalized(state);
      if (!Number.isFinite(positiveWork) || positiveWork <= 0) return next;
      // Work, not the energy actually removed, also fatigues an exhausted player.
      next.fatigue = Math.min(cfg.fatigueMax, next.fatigue + cfg.fatiguePerWork * positiveWork);
      next.energy = Math.max(0, Math.min(capacity(next), next.energy - positiveWork));
      next.regenDelayRemaining = cfg.regenDelay;
      next.low = lowAt(next.energy, next.low);
      return next;
    },
    advance(state, simDt) {
      const next = normalized(state);
      if (!Number.isFinite(simDt) || simDt <= 0) return next;
      // Only the part after the old delay regenerates, even across a large step.
      const activeDt = Math.max(0, simDt - next.regenDelayRemaining);
      next.regenDelayRemaining = Math.max(0, next.regenDelayRemaining - simDt);
      next.energy = Math.min(capacity(next), next.energy + cfg.regenPerSecond * activeDt);
      next.low = lowAt(next.energy, next.low);
      return next;
    },
    effortScale,
    deriveEffortBudget(state, request) {
      const requestedVmag = bounded(request?.requestedVmag, 0, Number.MAX_VALUE);
      const freshVmagCap = bounded(request?.freshVmagCap, 0, Number.MAX_VALUE);
      const scale = effortScale(state);
      // The solver attenuates the request once and keeps this ceiling while refining.
      const vmagCap = freshVmagCap * scale;
      return Object.freeze({
        actionId: typeof request?.actionId === 'string' || Number.isFinite(request?.actionId) ? request.actionId : null,
        side: request?.side === 1 || request?.side === -1 ? request.side : null,
        requestedVmag, freshVmagCap, effortScale: scale, vmagCap,
        limited: scale < 1 && requestedVmag > 0 && freshVmagCap > 0,
      });
    },
    validateRestore(raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const { energy, fatigue, regenDelayRemaining, low } = raw;
      if (!Number.isFinite(energy) || !Number.isFinite(fatigue) || !Number.isFinite(regenDelayRemaining)
        || typeof low !== 'boolean' || fatigue < 0 || fatigue > cfg.fatigueMax
        || energy < 0 || energy > cfg.energyMax - fatigue
        || regenDelayRemaining < 0 || regenDelayRemaining > cfg.regenDelay
        || low !== lowAt(energy, low)) return null;
      return { energy, fatigue, regenDelayRemaining, low };
    },
  });
})();
