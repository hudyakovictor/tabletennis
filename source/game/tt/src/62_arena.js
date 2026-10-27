/* =====================================================================
 *  ARENA DRESSING — только стены зала с трибуной.
 *
 *  Спортивные баннеры, LED-борта по периметру и потолочные панели убраны:
 *  это были десятки лишних quads с additive-материалами и текстурами
 *  (плюс ~170 КБ JPEG в бандле), а игроку из камеры за столом они только
 *  мешали читать мяч.
 *
 *  Фото-текстура трибуны кладётся сборкой: tt/build.py инлайнит
 *  tt/assets/stands.jpg в window.__TT_ARENA. Без неё (тесты, TT_NO_ARENA)
 *  сцена рисует процедурный фолбэк ниже — стена не остаётся голой.
 * ===================================================================== */

/* Процедурные трибуны: тёмный зал и тысячи тусклых голов-точек,
 * без светильников и прожекторных лучей. Рисуется один раз в канвас 2048×256 —
 * того же размера, что и фото-текстура, чтобы свап был бесшовным. */
function texStandsFallback() {
  const W = 2048, H = 256, c = cv(W, H), g = c.getContext('2d');
  const lg = g.createLinearGradient(0, 0, 0, H);
  lg.addColorStop(0.00, '#04060a');
  lg.addColorStop(0.30, '#070b13');
  lg.addColorStop(0.75, '#0a1220');
  lg.addColorStop(1.00, '#05070c');
  g.fillStyle = lg; g.fillRect(0, 0, W, H);
  // толпа: тусклые точки-головы, плотнее к низу; верх темнее низа
  for (let i = 0; i < 24000; i++) {
    const y = H * 0.16 + Math.pow(Math.random(), 0.8) * H * 0.84;
    const fade = 0.35 + 0.65 * (y / H);
    const v = (6 + Math.random() * 26) * fade;
    g.fillStyle = `rgba(${v * 1.1 | 0},${v * 1.25 | 0},${v * 1.7 | 0},${0.5 + Math.random() * 0.5})`;
    g.fillRect(Math.random() * W, y, 1.6, 1.3);
  }
  return c;
}

/* Фото → текстура того же размера, что фолбэк: рисуем картинку в
 * канвас и отдаём в общий texFromCanvas (mips/aniso — как у всех). */
function arenaImageTex(R, dataUrl, w, h, cb) {
  if (!dataUrl || typeof Image === 'undefined') return;
  const img = new Image();
  img.onload = () => {
    try {
      const c = cv(w, h);
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(R.texFromCanvas(c, { wrap: 'repeat' }));
    } catch (e) { /* фолбэк остаётся — арена не голая */ }
  };
  img.src = dataUrl;
}
