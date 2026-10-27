/* =====================================================================
 *  ARENA DRESSING — трибуны и LED-борта.
 *
 *  Конструкция (mobile-first, ноль лишней геометрии):
 *   - зал — существующие 4 стены, но с текстурой трибун вместо градиента:
 *     тёмная картинка как MeshBasicMaterial (unlit-путь шейдера нам не
 *     подходит — он не умножает текстуру на цвет, поэтому трибуны идут
 *     обычным lit-материалом с подавленным tint ~0x30 и туманом сцены);
 *   - ограждение — 4 низких блока (коробка + светящаяся плоскость внутрь)
 *     с баннерами брендов; нижний край трибун прячется за бортами;
 *  Фото-текстуры кладёт сборка: tt/build.py инлайнит tt/assets/*.jpg
 *  в window.__TT_ARENA. Без них (тесты, TT_NO_ARENA) сцена рисует
 *  процедурные фолбэки ниже — арена никогда не остаётся голой.
 * ===================================================================== */

/* Бренды бортов: id = ключ в __TT_ARENA и имя файла banner-<id>.jpg.
 * Порядок важен: Scene раскладывает их по сторонам [дальняя, ближняя,
 * левая, правая]. font/fg/bg — только для процедурного фолбэка. */
const ARENA_BRANDS = [
  { id: 'roflex', text: 'Roflex', bg: '#043a20', fg: '#e9c95c', font: '700 150px Georgia, "Times New Roman", serif' },
  { id: 'pumba', text: 'Pumba', bg: '#c01030', fg: '#ffffff', font: '800 152px Arial, Helvetica, sans-serif' },
  { id: 'abibos', text: 'Abibos', bg: '#0a0a0c', fg: '#ffffff', font: '800 152px Arial, Helvetica, sans-serif' },
  { id: 'NUKE', text: 'NUKE', bg: '#0a0a0c', fg: '#ffffff', font: '900 italic 160px Arial, Helvetica, sans-serif' },
];

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

/* Процедурный LED-борт одного бренда: фон, сетка диодов и имя —
 * повторяет характер листа-исходника, пока не подгрузилось фото. */
function texBrandFallback(brand) {
  const W = 1024, H = 256, c = cv(W, H), g = c.getContext('2d');
  g.fillStyle = brand.bg; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,0.16)';
  for (let y = 4; y < H; y += 8) for (let x = 4; x < W; x += 8) g.fillRect(x, y, 2.4, 2.4);
  g.font = brand.font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = brand.fg;
  g.fillText(brand.text, W / 2, H / 2 + 8);
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
