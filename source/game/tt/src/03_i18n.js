/* =====================================================================
 *  ENGINE TEXTS — i18n каркас движка.
 *  Хост (оболочка) присылает язык: window.__TT_LOCALE при старте и
 *  postMessage {type:'locale', lang} при смене. Дефолт — 'ru'.
 *  Добавить язык = добавить словарь сюда (и в оболочку свой).
 *  Ключи, видимые игроку В МАТЧЕ/тренировке, живут здесь; меню и мета
 *  автономной страницы (80_ui) — следующий транш локализации.
 * ===================================================================== */
const ET = (() => {
  let lang = 'ru';
  const D = {
    ru: {
      'hud.you': 'Ты', 'hud.opponent': 'Соперник', 'hud.serve': 'Подача', 'hud.score': 'Счёт матча',
      'boot.webglTitle': 'WebGL недоступен',
      'boot.webglBody': 'Этой демке нужен WebGL. Включите аппаратное ускорение в браузере и перезагрузите страницу.',
      'drill.serve.title': 'ПОДАЧА', 'drill.serve.goal': 'Подай: центр → лево → право',
      'drill.serve.tip': 'Тап — подброс, вверх в зону', 'drill.serve.mouseTip': 'ЛКМ — подброс, вверх в зону',
      'drill.hit.title': 'УДАР', 'drill.hit.goal': 'Отбей мяч на стол соперника',
      'drill.hit.tip': 'Палец под кольцо — и вверх через него', 'drill.hit.mouseTip': 'ЛКМ под кольцом — и вверх',
      'drill.hit.fail': 'Начни свайп под кольцом',
      'drill.aim.title': 'НАПРАВЛЕНИЕ', 'drill.aim.goal': 'Попади в светлую половину',
      'drill.aim.tip': 'Свайп по диагонали — туда и полетит', 'drill.aim.mouseTip': 'ЛКМ и по диагонали к цели',
      'drill.aim.fail': 'Диагональ — в сторону цели',
      'drill.topspin.title': 'ТОПСПИН', 'drill.topspin.goal': 'Верхнее вращение на стол',
      'drill.topspin.tip': 'Длинный быстрый свайп вверх', 'drill.topspin.mouseTip': 'ЛКМ + длинно и быстро вверх',
      'drill.topspin.fail': 'Длиннее и быстрее вверх',
      'drill.push.title': 'ПОДРЕЗКА', 'drill.push.goal': 'Нижнее вращение на стол',
      'drill.push.tip': 'Мягкий свайп вниз-вперёд', 'drill.push.mouseTip': 'ЛКМ + мягко вниз-вперёд',
      'drill.push.fail': 'Веди вниз, без рывка',
      'drill.rally.title': 'ЗАКРЕПЛЕНИЕ', 'drill.rally.goal': 'Отбей 3 мяча без подсказок',
      'drill.rally.tip': 'Как в матче: под мяч и вверх', 'drill.rally.mouseTip': 'Как в матче: ЛКМ под мяч и вверх',
      'drill.rally.fail': 'Под мяч — и вверх',
      /* тренер: короткие реплики. NB: причины очков из awardPoint ('АУТ',
       * 'В СЕТКУ', ...) — внутренние КОДЫ движка, не тексты; маппинг
       * код→текст делается в Trainer.onFault и покрыт этими ключами. */
      'train.done': 'Готово', 'train.counted': 'Зачтено',
      'train.serveDone': 'Готово — подача везде!', 'train.serveNext': 'Отлично! Теперь — {name}.',
      'target.center': 'по центру', 'target.left': 'в ЛЕВУЮ зону', 'target.right': 'в ПРАВУЮ зону',
      'train.out': 'Аут.', 'train.net': 'Сетка.', 'train.serveFault': 'Ошибка подачи.',
      'train.throughServe': 'Смахни вверх сквозь мяч.', 'train.through': 'Веди до конца — сквозь мяч.',
      'train.repeat': 'Повтори жест.',
      'ui.tapRetry': 'Коснись — повторить сразу',
      'ui.lessonFirst': 'Урок 1 из {total}', 'ui.lessonNew': 'НОВЫЙ УДАР · урок {n} из {total}', 'ui.lesson': 'Урок {n} из {total}',
      'ui.tapContinue': 'Коснись экрана — продолжить', 'ui.tapBallTouch': 'Коснись экрана — мяч подлетит', 'ui.tapBallMouse': 'Клик ЛКМ — мяч подлетит'
    },
    en: {
      'hud.you': 'You', 'hud.opponent': 'Opponent', 'hud.serve': 'Serve', 'hud.score': 'Match score',
      'boot.webglTitle': 'WebGL unavailable',
      'boot.webglBody': 'This game needs WebGL. Enable hardware acceleration in your browser and reload the page.',
      'drill.serve.title': 'SERVE', 'drill.serve.goal': 'Serve: center → left → right',
      'drill.serve.tip': 'Tap — toss, swipe up into the zone', 'drill.serve.mouseTip': 'LMB — toss, swipe up into the zone',
      'drill.hit.title': 'HIT', 'drill.hit.goal': 'Return the ball onto their side',
      'drill.hit.tip': 'Finger under the ring — up through it', 'drill.hit.mouseTip': 'LMB under the ring — swipe up',
      'drill.hit.fail': 'Start the swipe under the ring',
      'drill.aim.title': 'AIM', 'drill.aim.goal': 'Hit the lit half',
      'drill.aim.tip': 'Swipe diagonally — it flies that way', 'drill.aim.mouseTip': 'LMB diagonally toward the target',
      'drill.aim.fail': 'Diagonal — toward the target',
      'drill.topspin.title': 'TOPSPIN', 'drill.topspin.goal': 'Topspin onto the table',
      'drill.topspin.tip': 'Long fast swipe up', 'drill.topspin.mouseTip': 'LMB + long and fast up',
      'drill.topspin.fail': 'Longer and faster up',
      'drill.push.title': 'PUSH', 'drill.push.goal': 'Backspin onto the table',
      'drill.push.tip': 'Soft swipe down-forward', 'drill.push.mouseTip': 'LMB + soft down-forward',
      'drill.push.fail': 'Guide it down, no jerk',
      'drill.rally.title': 'RECAP', 'drill.rally.goal': 'Return 3 balls, no hints',
      'drill.rally.tip': 'Like a match: under the ball, up', 'drill.rally.mouseTip': 'Like a match: LMB under the ball, up',
      'drill.rally.fail': 'Under the ball — and up',
      'train.done': 'Done', 'train.counted': 'Counted',
      'train.serveDone': 'Done — serves everywhere!', 'train.serveNext': 'Great! Now — {name}.',
      'target.center': 'to the center', 'target.left': 'to the LEFT zone', 'target.right': 'to the RIGHT zone',
      'train.out': 'Out.', 'train.net': 'Net.', 'train.serveFault': 'Serve fault.',
      'train.throughServe': 'Swipe up through the ball.', 'train.through': 'Follow through the ball.',
      'train.repeat': 'Repeat the gesture.',
      'ui.tapRetry': 'Tap — retry right away',
      'ui.lessonFirst': 'Lesson 1 of {total}', 'ui.lessonNew': 'NEW STROKE · lesson {n} of {total}', 'ui.lesson': 'Lesson {n} of {total}',
      'ui.tapContinue': 'Tap the screen to continue', 'ui.tapBallTouch': 'Tap the screen — the ball will fly', 'ui.tapBallMouse': 'Left-click — the ball will fly'
    }
  };
  function ET(key, vars) {
    let s = (D[lang] && D[lang][key]) ?? D.ru[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? vars[n] : m));
    return s;
  }
  ET.set = (l) => { if (l && D[l]) lang = l; };
  ET.lang = () => lang;
  ET.dicts = D;
  return ET;
})();
