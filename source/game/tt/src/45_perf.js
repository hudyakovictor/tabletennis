/* =====================================================================
 *  PERF MONITOR — сколько стоит кадр и из чего он складывается.
 *
 *  Две задачи:
 *   1) показать цену кадра по подсистемам (update / render / ui) и длинные
 *      задачи — включается на ?perf или при включённой диагностике, чтобы
 *      на слабом телефоне было видно, что именно жрёт процессор;
 *   2) держать частоту кадров на слабом железе: если кадры стабильно
 *      длиннее порога, внутреннее разрешение рендера понижается (quality
 *      остаётся выбором игрока — мы меняем только масштаб за кадром).
 *
 *  Всё, что считается всегда, — две-три суммы на кадр: сам монитор не должен
 *  стать причиной тормозов, которые он измеряет.
 * ===================================================================== */
'use strict';

/* Границы внутреннего масштаба: ниже 0.6 картинка мылится, выше 1 мы не
 * апскейлим — это потолок качества, а не буст. */
const PERF_SCALE_MIN = 0.60, PERF_SCALE_MAX = 1;

/* Пороги решения. 21 мс — это ниже 48 fps, 12 мс — уверенные 60+ (на 120-герцевом
 * экране кадр 8.3 мс тоже считается «быстрым», и масштаб возвращается).
 * Окно 1.5 с: короткие всплески (старт матча, компиляция шейдеров) не должны
 * ронять разрешение, а устойчивая просадка — должна. */
const PERF_SLOW_MS = 21, PERF_FAST_MS = 12, PERF_WINDOW_S = 1.5;
const PERF_STEP_DOWN = 0.12, PERF_STEP_UP = 0.06;

/** Одно решение по масштабу. Чистая функция: тесты гоняют её без canvas.
 *  `avg` — средний кадр за окно, `ms` — сколько окно длилось. Возвращает
 *  новый масштаб; равенство входа и выхода означает «ничего не меняем». */
function perfScaleStep(scale, avg, ms = PERF_WINDOW_S * 1000) {
  const s = Number.isFinite(scale) ? clamp(scale, PERF_SCALE_MIN, PERF_SCALE_MAX) : PERF_SCALE_MAX;
  if (!Number.isFinite(avg) || !Number.isFinite(ms) || ms < PERF_WINDOW_S * 1000 * 0.6) return s;
  if (avg > PERF_SLOW_MS && s > PERF_SCALE_MIN) return Math.max(PERF_SCALE_MIN, s - PERF_STEP_DOWN);
  // Возврат медленнее, чем спуск: иначе картинка «дышит» на границе порога.
  if (avg < PERF_FAST_MS && s < PERF_SCALE_MAX) return Math.min(PERF_SCALE_MAX, s + PERF_STEP_UP);
  return s;
}

class PerfMonitor {
  /** opts.overlay — рисовать панель; opts.onScale — применить новый масштаб. */
  constructor(opts = {}) {
    this.onScale = opts.onScale || null;
    this.overlay = !!opts.overlay;
    this.scale = PERF_SCALE_MAX;
    this.fps = 0; this.avg = 0;
    this.sec = { update: 0, render: 0, ui: 0 };
    this._n = 0; this._sum = 0; this._winMs = 0;
    this._sec = { update: 0, render: 0, ui: 0 };
    this.long = [];   // {t, ms} последних длинных задач
    this.el = null; this._paintAt = 0;
    this._observe();
  }

  /* Long tasks — единственный способ увидеть работу, которую мы не зовём сами
   * (сборка мусора, layout, сторонний код страницы). */
  _observe() {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      this._po = new PerformanceObserver((list) => {
        list.getEntries().forEach((e) => {
          this.long.push({ t: Math.round(e.startTime), ms: Math.round(e.duration) });
          if (this.long.length > 40) this.long.shift();
        });
      });
      this._po.observe({ type: 'longtask', buffered: true });
    } catch (e) { /* Safari без longtask — панель просто без него */ }
  }

  /** Вызывается каждый кадр: длительность кадра и цена его частей, мс. */
  frame(dtMs, parts) {
    // Вкладка была свёрнута или браузер задушил rAF — это не стоимость кадра,
    // и по такому сэмплу нельзя понижать разрешение.
    if (!Number.isFinite(dtMs) || dtMs > 120) return;
    const d = Math.max(0, dtMs);
    this._n++; this._sum += d; this._winMs += d;
    if (parts) {
      this._sec.update += parts[0] || 0;
      this._sec.render += parts[1] || 0;
      this._sec.ui += parts[2] || 0;
    }
    if (this._winMs >= PERF_WINDOW_S * 1000) {
      this.avg = this._sum / Math.max(1, this._n);
      this.fps = this._n / (this._winMs / 1000);
      const k = 1 / Math.max(1, this._n);
      this.sec = { update: this._sec.update * k, render: this._sec.render * k, ui: this._sec.ui * k };
      this._n = 0; this._sum = 0; this._winMs = 0;
      this._sec = { update: 0, render: 0, ui: 0 };
      const next = perfScaleStep(this.scale, this.avg, PERF_WINDOW_S * 1000);
      if (next !== this.scale) {
        this.scale = next;
        // Держим одинаковый шаг и в отчёте, и в реальном рендере.
        if (this.onScale) { try { this.onScale(next); } catch (e) { /* рендер уже не спасти */ } }
      }
    }
    if (this.overlay) this.paint();
  }

  /** Панель в углу: цифры обновляются 4 раза в секунду, чтобы не мигать. */
  paint() {
    if (!this.overlay || typeof document === 'undefined') return;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (now - this._paintAt < 250) return;
    this._paintAt = now;
    if (!this.el) {
      const el = document.createElement('div');
      el.id = 'perfHud';
      // Левый край под счётом: в бою там пустой тёмный фон, а не кнопки
      // (пауза — нижний левый угол, замедление — нижний правый).
      el.style.cssText = 'position:fixed;left:8px;top:112px;z-index:99999;pointer-events:none;' +
        'font:11px/1.35 ui-monospace,Menlo,monospace;color:#CFEFFF;background:rgba(4,6,16,.82);' +
        'padding:6px 8px;border-radius:8px;white-space:pre;text-shadow:0 1px 2px #000';
      document.body.appendChild(el);
      this.el = el;
    }
    const m = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
    const long = this.long.length ? `long ${Math.round(this.long.reduce((a, b) => a + b.ms, 0))}ms/${this.long.length}` : 'long —';
    this.el.textContent = `fps ${Math.round(this.fps)} · frame ${m(this.avg)}ms\n` +
      `update ${m(this.sec.update)} · render ${m(this.sec.render)} · ui ${m(this.sec.ui)}\n` +
      `scale ${this.scale.toFixed(2)} · ${long}`;
  }

  /** Снимок для diagnosticReport: попадает в локальный отчёт, а не в UI. */
  snapshot() {
    const r = (v) => (Number.isFinite(v) ? +v.toFixed(1) : null);
    return { fps: r(this.fps), frame: r(this.avg),
      update: r(this.sec.update), render: r(this.sec.render), ui: r(this.sec.ui),
      scale: +this.scale.toFixed(2), long: this.long.slice(-10) };
  }
}
