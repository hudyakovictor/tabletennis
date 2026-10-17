/* =====================================================================
 *  UI ANIMATION SYSTEM — smooth, polished UI transitions
 *
 *  Provides:
 *   1. Animated number transitions (score, rating, etc.)
 *   2. Smooth element appearances (fade, slide, scale)
 *   3. Micro-interactions on buttons and controls
 *   4. HUD element animations
 *
 *  Adds polish and "delight" to UI — key for award-winning feel.
 * ===================================================================== */
'use strict';

/**
 * Animation utilities for UI elements.
 */
class UIAnimation {
  constructor() {
    this.animations = [];
    this._running = false;
    this._RAF = null;
  }

  /**
   * Animate a number in an element.
   * @param {HTMLElement} el
   * @param {number} from
   * @param {number} to
   * @param {object} opts
   *   - duration: ms (default 500)
   *   - decimals: number of decimals (default 0)
   *   - easing: easing function name ('easeOutCubic' etc)
   */
  animateNumber(el, from, to, opts = {}) {
    const duration = opts.duration || 500;
    const decimals = opts.decimals || 0;
    const easing = opts.easing || 'easeOutCubic';
    const startTime = performance.now();

    const anim = {
      type: 'number',
      el,
      from,
      to,
      startTime,
      duration,
      decimals,
      easing,
      done: false,
    };
    this.animations.push(anim);
    this._ensureRunning();
    return anim;
  }

  /**
   * Fade in an element.
   */
  fadeIn(el, opts = {}) {
    const duration = opts.duration || 300;
    const delay = opts.delay || 0;
    const startTime = performance.now() + delay;

    const anim = {
      type: 'fadeIn',
      el,
      startTime,
      duration,
      fromOpacity: parseFloat(el.style.opacity) || 0,
      done: false,
      delay,
    };
    el.style.opacity = '0';
    el.style.transition = 'none';
    el.style.pointerEvents = 'none';
    this.animations.push(anim);
    this._ensureRunning();
    return anim;
  }

  /**
   * Fade out an element.
   */
  fadeOut(el, opts = {}) {
    const duration = opts.duration || 300;
    const delay = opts.delay || 0;
    const startTime = performance.now() + delay;

    const anim = {
      type: 'fadeOut',
      el,
      startTime,
      duration,
      fromOpacity: parseFloat(el.style.opacity) || 1,
      done: false,
      delay,
      onComplete: opts.onComplete || null,
    };
    this.animations.push(anim);
    this._ensureRunning();
    return anim;
  }

  /**
   * Slide an element in from a direction.
   */
  slideIn(el, direction = 'up', opts = {}) {
    const duration = opts.duration || 400;
    const delay = opts.delay || 0;
    const startTime = performance.now() + delay;

    const fromPos = direction === 'up' ? '-20px' :
      direction === 'down' ? '20px' :
      direction === 'left' ? '-20px' : '20px';

    el.style.transform = `translate(${direction === 'left' ? fromPos : '0'}, ${direction === 'up' ? fromPos : '0'})`;
    el.style.opacity = '0';
    el.style.transition = 'none';

    const anim = {
      type: 'slideIn',
      el,
      direction,
      startTime,
      duration,
      fromPos,
      done: false,
      delay,
    };
    this.animations.push(anim);
    this._ensureRunning();
    return anim;
  }

  /**
   * Scale an element (pop effect).
   */
  pop(el, opts = {}) {
    const duration = opts.duration || 200;
    const scaleFrom = opts.scaleFrom || 0.8;
    const scaleTo = opts.scaleTo || 1.1;
    const endTime = performance.now() + duration;

    el.style.transform = `scale(${scaleFrom})`;
    el.style.transition = 'none';
    el.style.opacity = '0';

    const anim = {
      type: 'pop',
      el,
      startTime: performance.now(),
      duration,
      scaleFrom,
      scaleTo,
      endScale: 1.0,
      endTime,
      done: false,
    };
    this.animations.push(anim);
    this._ensureRunning();
    return anim;
  }

  /**
   * Update all animations.
   * Call this in requestAnimationFrame loop.
   */
  update(now) {
    for (let i = this.animations.length - 1; i >= 0; i--) {
      const anim = this.animations[i];
      const elapsed = now - anim.startTime;

      if (anim.delay !== undefined) {
        if (elapsed < anim.delay) continue;
      }

      const progress = Math.min(1, elapsed / anim.duration);

      switch (anim.type) {
        case 'number':
          const eased = this._ease(progress, anim.easing);
          const value = anim.from + (anim.to - anim.from) * eased;
          anim.el.textContent = value.toFixed(anim.decimals);
          if (progress >= 1) anim.done = true;
          break;

        case 'fadeIn':
          const fadeInOpacity = Math.min(1, progress);
          anim.el.style.opacity = fadeInOpacity.toString();
          anim.el.style.pointerEvents = fadeInOpacity >= 1 ? 'auto' : 'none';
          if (progress >= 1) {
            anim.el.style.opacity = '1';
            anim.el.style.pointerEvents = 'auto';
            anim.done = true;
          }
          break;

        case 'fadeOut':
          const fadeOutOpacity = 1 - progress;
          anim.el.style.opacity = fadeOutOpacity.toString();
          if (progress >= 1) {
            anim.el.style.opacity = '0';
            anim.el.style.pointerEvents = 'none';
            anim.done = true;
            if (anim.onComplete) anim.onComplete();
          }
          break;

        case 'slideIn':
          const slideProgress = Math.min(1, progress);
          const slideEased = this._ease(slideProgress, 'easeOutCubic');
          const from = anim.fromPos;
          const to = '0';
          const x = anim.direction === 'left' ? (1 - slideEased) * parseFloat(from) : 0;
          const y = anim.direction === 'up' ? (1 - slideEased) * parseFloat(from) : 0;
          anim.el.style.transform = `translate(${x}px, ${y}px)`;
          anim.el.style.opacity = slideEased.toString();
          if (slideProgress >= 1) {
            anim.el.style.transform = '';
            anim.el.style.opacity = '1';
            anim.done = true;
          }
          break;

        case 'pop':
          const popProgress = Math.min(1, (now - anim.startTime) / anim.duration);
          const popEased = this._ease(popProgress, 'easeOutBack');
          const scale = anim.scaleFrom + (anim.scaleTo - anim.scaleFrom) * popEased;
          anim.el.style.transform = `scale(${scale})`;
          anim.el.style.opacity = '1';
          if (popProgress >= 1) {
            anim.el.style.transform = `scale(${anim.endScale})`;
            anim.done = true;
          }
          break;
      }

      if (anim.done) {
        this.animations.splice(i, 1);
      }
    }

    if (this.animations.length === 0) {
      this._stopRunning();
    }
  }

  /**
   * Ensure animation loop is running.
   */
  _ensureRunning() {
    if (this._running) return;
    this._running = true;
    const loop = () => {
      if (this.animations.length === 0) {
        this._running = false;
        return;
      }
      this.update(performance.now());
      this._RAF = requestAnimationFrame(loop);
    };
    this._RAF = requestAnimationFrame(loop);
  }

  /**
   * Stop animation loop.
   */
  _stopRunning() {
    this._running = false;
    if (this._RAF) {
      cancelAnimationFrame(this._RAF);
      this._RAF = null;
    }
  }

  /**
   * Easing functions.
   */
  _ease(t, type) {
    switch (type) {
      case 'linear':
        return t;
      case 'easeInQuad':
        return t * t;
      case 'easeOutQuad':
        return t * (2 - t);
      case 'easeInOutQuad':
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      case 'easeInCubic':
        return t * t * t;
      case 'easeOutCubic':
        return 1 - Math.pow(1 - t, 3);
      case 'easeInOutCubic':
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      case 'easeOutBack':
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      case 'easeOutElastic':
        const c5 = 2 * Math.PI / 3;
        return t === 0 ? 0 : t === 1 ? 1 :
          Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c5) + 1;
      default:
        return this._ease(t, 'easeOutCubic');
    }
  }

  /**
   * Clear all animations.
   */
  clear() {
    this.animations = [];
    this._stopRunning();
  }
}

/**
 * HUD-specific animations.
 */
class HUDAnimation {
  constructor(ui) {
    this.ui = ui;
    this.anim = new UIAnimation();
    this._scoreElements = {};
    this._shotIndicators = [];
  }

  /**
   * Setup score display with animated numbers.
   */
  setupScoreDisplay() {
    if (!this.ui || !this.ui.game) return;

    const game = this.ui.game;
    if (!game) return;

    // Animate score changes
    const updateScore = () => {
      if (!game.score) return;
      // Score display updates handled by UI
    };

    // Watch for score changes
    this._scoreObserver = new MutationObserver(() => {
      // Score changed — animate
    });
  }

  /**
   * Show shot feedback with animation.
   */
  showShotFeedback(feedback) {
    if (!this.ui || !this.ui.fxg) return;

    const ctx = this.ui.fxg;
    const now = performance.now();

    // Draw animated shot indicator
    const startTime = now;
    const duration = 600;

    const animId = setInterval(() => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);

      if (progress >= 1) {
        clearInterval(animId);
        return;
      }

      // Draw feedback visualization
      this._drawShotFeedback(ctx, feedback, progress);
    }, 16);
  }

  /**
   * Draw shot feedback visualization.
   */
  _drawShotFeedback(ctx, feedback, progress) {
    const centerX = ctx.canvas.width / 2;
    const centerY = ctx.canvas.height / 2;

    // Shrinking ring
    const radius = 30 * (1 - progress);
    const opacity = 1 - progress;

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = feedback.color || '#9fe0ff';
    ctx.lineWidth = 3 * (1 - progress * 0.5);
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Update all HUD animations.
   */
  update(now) {
    this.anim.update(now);
  }
}
