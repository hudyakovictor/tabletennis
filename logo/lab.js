(() => {
  'use strict';

  const VARIANTS = [
    { id: 'smash', n: '01', title: 'В экран', label: 'SMASH CAM', hit: .27, flash: .79,
      description: 'Твой исходный сюжет: круг заполняется белым, ракетка бьёт сзади. Мяч узнаёт, куда летит, кричит и закрывает собой экран. Одна белая вспышка открывает меню.' },
    { id: 'crown', n: '02', title: 'Корона хаоса', label: 'KING OF WTF', hit: .30, flash: .80,
      description: 'На 100% мяч на секунду становится королём. Ракетка сносит корону, она улетает отдельно, а оскорблённый мяч летит прямо в зрителя. Маленькая корона, большой скандал.' },
    { id: 'net', n: '03', title: 'Разрыв сетки', label: 'NET BREAKER', hit: .24, flash: .82,
      description: 'После загрузки мяч делает короткий спортивный перелёт, пробивает сетку и разгоняется в камеру. Две половины сетки расходятся, за мячом остаются жёлтые штрихи.' },
    { id: 'comic', n: '04', title: 'Комикс-стопкадр', label: 'FREEZE & SCREAM', hit: .30, flash: .81,
      description: 'Три панели, три выражения лица. На контакте короткий стопкадр с WTF?!, потом резкий диагональный вылет. Панели комикса разлетаются, белый кадр превращается в меню.' },
    { id: 'orbit', n: '05', title: 'Орбитальный разгон', label: 'TOPSPIN SLING', hit: .44, flash: .83,
      description: 'Мяч живёт на орбите кругового прогресса. В финале ракетка превращает орбиту в рогатку: один виток, спираль к зрителю, крик. Самый плавный и самый закрученный вариант.' },
    { id: 'stamp', n: '06', title: 'Штамп WTF', label: 'INK IMPACT', hit: .33, flash: .65,
      description: 'Мяч падает на ракетку, летит в экран и расплющивается в комиксный отпечаток. После белого контакта из жёлтых брызг вырастает логотип Table Tennis WTF. Меню начинается с бренда.' },
  ];
  const ASSETS = [
    ['ball-panic', 'Мяч 01 / паника'], ['ball-wobble', 'Мяч 02 / косой взгляд'],
    ['ball-scream', 'Мяч 03 / большой крик'], ['ball-shock', 'Мяч 04 / полный шок'],
    ['paddle-red', 'Красная ракетка'], ['paddle-comic', 'Ракетка с брызгами'],
    ['impact', 'Взрыв / контакт'], ['crown', 'Корона'], ['streak', 'Брызги'], ['speed', 'Линии скорости'],
    ['cry-aaa', 'Крик / AAAA!'], ['cry-ahh', 'Крик / AHH!'], ['logo-brush', 'Логотип / кисть'],
    ['logo-stamp', 'Логотип / эмблема'], ['net', 'Сетка'], ['court', 'Корт / настроение'],
  ];
  const $ = (id) => document.getElementById(id);
  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const mix = (a, b, t) => a + (b - a) * t;
  const segment = (p, from, to) => clamp((p - from) / (to - from));
  const out = (t) => 1 - (1 - clamp(t)) ** 3;
  const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
  const pulse = (p, center, width) => Math.max(0, 1 - Math.abs(p - center) / width);
  const path = (id) => `assets/${id}.png`;
  const stage = $('stage');
  const canvas = $('ink');
  const ctx = canvas.getContext('2d');
  const layers = Object.fromEntries(['ring', 'ball', 'paddle', 'streak', 'impact', 'crown', 'scream', 'scene-logo', 'net-left', 'net-right', 'comic-word'].map((id) => [id, $(id)]));
  const controls = Object.fromEntries(['ball-choice', 'paddle-choice', 'logo-choice', 'duration', 'mimic', 'particles', 'flash-choice', 'shake', 'sound', 'slow', 'reduced'].map((id) => [id, $(id)]));
  const reducedPreference = matchMedia('(prefers-reduced-motion: reduce)');
  const model = { variant: VARIANTS[0], phase: 'loading', progress: 0, p: 0, elapsed: 0, playing: false, mode: 'full', ready: false };
  const size = { width: 390, height: 570, unit: 1, dpr: 1 };
  const loadingMs = 2200;
  let raf = 0;
  let lastTime = 0;
  let hitSound = false;
  let audio = null;
  let toastTimer = 0;
  let cachedFace = '';
  let cachedCry = '';
  let settings;

  $('ideas').innerHTML = VARIANTS.map((v) => `<button class="idea" type="button" data-idea="${v.id}" aria-pressed="${v.id === model.variant.id}" aria-label="${v.n}: ${v.title}"><span class="idea-number-small">${v.n}</span><span class="idea-art" aria-hidden="true"><img class="mini-paddle" src="${path('paddle-red')}" alt=""><img class="mini-ball" src="${path(v.id === 'stamp' ? 'ball-shock' : 'ball-panic')}" alt="">${v.id === 'crown' ? `<img class="mini-crown" src="${path('crown')}" alt="">` : ''}</span><span class="idea-label"><b>${v.title}</b><small>${v.label}</small></span></button>`).join('');
  $('asset-grid').innerHTML = ASSETS.map(([id, title]) => `<button class="asset-card" type="button" data-asset="${id}" aria-label="Рассмотреть: ${title}"><span class="asset-thumb"><img src="${path(id)}" alt="" loading="lazy"></span><span>${title}<small>${id}.png</small></span></button>`).join('');

  function readSettings() {
    settings = {
      ball: controls['ball-choice'].value,
      paddle: controls['paddle-choice'].value,
      logo: controls['logo-choice'].value,
      duration: Number(controls.duration.value),
      mimic: controls.mimic.checked,
      particles: controls.particles.checked,
      flash: controls['flash-choice'].checked,
      shake: controls.shake.checked,
      sound: controls.sound.checked,
      slow: controls.slow.checked,
      reduced: controls.reduced.checked,
    };
    $('paddle').src = path(settings.paddle);
    $('scene-logo').src = $('menu-logo').src = path(settings.logo);
    controls.duration.disabled = settings.reduced;
    $('duration-output').textContent = settings.reduced ? 'Плавно / 0.22 с' : `${(settings.duration / 1000).toFixed(1)} с`;
  }
  const finalMs = () => settings.reduced ? 220 : settings.duration;

  function pose(id, x = 0, y = 0, scale = 1, angle = 0, opacity = 1, scaleY = scale, turn = 0) {
    const el = layers[id];
    el.style.transform = `translate(-50%, -50%) translate(${(x * size.unit).toFixed(2)}px, ${(y * size.unit).toFixed(2)}px) rotate(${angle.toFixed(2)}deg) scale(${scale.toFixed(3)}, ${scaleY.toFixed(3)}) perspective(600px) rotateY(${turn.toFixed(2)}deg)`;
    el.style.opacity = clamp(opacity).toFixed(3);
  }

  function faceAt(p, loading = false) {
    const cycle = [settings.ball, 'ball-wobble', 'ball-scream'];
    const id = settings.mimic && !settings.reduced ? cycle[Math.floor((loading ? model.elapsed / 230 : p * 9)) % cycle.length] : settings.ball;
    if (id !== cachedFace) { $('face').src = path(id); cachedFace = id; }
  }

  function phaseLabel(text) {
    if ($('phase-label').textContent !== text) $('phase-label').textContent = text;
  }

  function clearInk() {
    ctx.clearRect(0, 0, size.width, size.height);
  }

  function drawInk(p, { x = 0, y = 0, burst = 0, speed = 0, orbit = false, loading = false } = {}) {
    clearInk();
    if (!settings.particles || settings.reduced) return;
    const cx = size.width / 2 + x * size.unit;
    const cy = size.height * .43 + y * size.unit;
    ctx.save();
    ctx.lineCap = 'round';
    if (loading) {
      ctx.globalAlpha = .25;
      for (let i = 0; i < 20; i++) {
        const a = i * 2.39996;
        const r = (118 + (i * 19 % 83)) * size.unit;
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
        ctx.fillStyle = i % 5 ? '#f5ef22' : '#ffffff';
        ctx.fillRect(px, py, i % 4 + 1, i % 3 + 1);
      }
    }
    if (orbit) {
      ctx.strokeStyle = '#f4f240';
      for (let i = 0; i < 8; i++) {
        ctx.globalAlpha = (8 - i) / 12;
        ctx.lineWidth = (2 + i % 2) * size.unit;
        ctx.beginPath();
        ctx.arc(size.width / 2, size.height * .43, (94 + i * 3) * size.unit, p * 15 - 1.5 - i * .1, p * 15 - i * .1);
        ctx.stroke();
      }
    }
    if (speed > 0) {
      for (let i = 0; i < 38; i++) {
        const a = i * 2.39996 + p * .45;
        const inner = (85 + (i * 11 % 50)) * size.unit;
        const length = (35 + (i * 31 % 150)) * size.unit * speed;
        ctx.globalAlpha = speed * (i % 4 === 0 ? .8 : .45);
        ctx.strokeStyle = i % 5 === 0 ? '#ffffff' : '#f4f240';
        ctx.lineWidth = (1 + i % 3) * size.unit;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        ctx.lineTo(cx + Math.cos(a) * (inner + length), cy + Math.sin(a) * (inner + length)); ctx.stroke();
      }
    }
    if (burst > 0) {
      for (let i = 0; i < 42; i++) {
        const a = i * 2.39996;
        const r = (35 + (1 - burst) * 150 + i % 4 * 12) * size.unit;
        ctx.globalAlpha = burst;
        ctx.fillStyle = i % 7 === 0 ? '#fc2920' : i % 4 === 0 ? '#fff' : '#f4f240';
        ctx.save(); ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.rotate(a);
        ctx.fillRect(0, 0, (6 + i % 8) * size.unit, (2 + i % 3) * size.unit); ctx.restore();
      }
    }
    ctx.restore();
  }

  function baseFrame(progress) {
    const value = Math.round(clamp(progress, 0, 100));
    $('ring-progress').style.strokeDashoffset = (427.257 * (1 - value / 100)).toFixed(3);
    $('percentage').textContent = `${value}%`;
    $('load-slider').value = value;
    $('load-output').textContent = `${value}%`;
    $('load-accessible').setAttribute('aria-valuenow', value);
    $('load-accessible').hidden = model.phase !== 'loading';
    $('world').style.opacity = '1';
    $('world').style.transform = 'none';
    $('mock-menu').hidden = true;
    $('mock-menu').inert = true;
    $('mock-menu').style.opacity = '0';
    $('flash').style.opacity = '0';
    $('white-core').style.opacity = '0';
    $('face').style.opacity = '1';
    $('loader-copy').style.opacity = '1';
    $('loader-copy').style.transform = 'none';
    $('comic-panels').style.opacity = '0';
    $('comic-panels').style.transform = 'none';
    document.querySelector('.scene-subtitle').style.opacity = '1';
    pose('ring'); pose('ball', 28, -108, .40, -12, .9);
    pose('paddle', 98, -108, .65, 22, .85, .65, -25);
    pose('crown', -43, -102, 1, -13);
    pose('scene-logo');
    ['impact', 'streak', 'scream', 'net-left', 'net-right', 'comic-word'].forEach((id) => pose(id, 0, 0, 1, 0, 0));
  }

  function renderLoading(progress = model.progress) {
    model.phase = 'loading'; model.progress = clamp(progress, 0, 100); model.p = 0;
    stage.dataset.phase = 'loading';
    baseFrame(model.progress);
    const time = settings.reduced ? 0 : model.elapsed / 1000;
    const bob = Math.sin(time * 4) * 4;
    faceAt(0, true);
    const id = model.variant.id;
    if (id === 'crown') {
      pose('ball', 0, 0, .86, Math.sin(time * 4) * 4);
      pose('crown', -25, -98 + bob, 1.1, -12);
      pose('paddle', 99, -58, .65, 35, .65);
    } else if (id === 'orbit') {
      const a = time * 1.8 - 1.6;
      pose('ball', Math.cos(a) * 97, Math.sin(a) * 97, .42, a * 57.3 + 90);
      pose('paddle', -93, 76, .60, -80, .75);
      pose('crown', 0, 0, 1, 0, 0);
    } else if (id === 'net') {
      pose('ball', -50, -77 + bob, .5, -10);
      pose('paddle', -106, -100, .57, -28, .8);
      pose('net-left', 0, 55, 1, -5, .85); pose('net-right', 0, 55, 1, -5, .85);
      pose('crown', 0, 0, 1, 0, 0);
    } else if (id === 'comic') {
      $('comic-panels').style.opacity = '.26';
      pose('ball', 0, 0, .77, -7);
      pose('paddle', 104, -82, .59, 20, .8);
      pose('crown', -43, -103 + bob, .9, -15);
    } else if (id === 'stamp') {
      pose('scene-logo', 0, -size.height * .52 / size.unit, 1.5, -3);
      pose('ring', 0, 63);
      pose('ball', 0, -41 + bob, .5, 3);
      pose('paddle', 79, 113, .6, 122, .7);
      pose('crown', 0, 0, 1, 0, 0);
      $('loader-copy').style.transform = `translateY(${63 * size.unit}px)`;
    } else {
      pose('ball', 27, -108 + bob, .42, -10);
      pose('paddle', 95, -111, .65, 22 + bob, .8, .65, -25);
    }
    drawInk(time / 4, { orbit: id === 'orbit', loading: true });
    $('loading-caption').textContent = model.progress === 100 ? 'ГОТОВО. ТЕПЕРЬ УДАР.' : ['ЗАРЯЖАЕМ РАКЕТКУ', 'ПРОГРЕВАЕМ ХАОС', 'ДЕРЖИСЬ ЗА ЭКРАН'][Math.min(2, Math.floor(model.progress / 34))];
    phaseLabel(model.progress === 100 ? '100% / можно бить' : 'Загрузка / демонстрация');
    updateTimeline(0);
  }

  function renderFinal(p = model.p) {
    model.p = clamp(p); model.progress = 100; model.phase = p >= 1 ? 'menu' : 'final';
    stage.dataset.phase = model.phase;
    baseFrame(100);
    if (settings.reduced) {
      $('world').style.opacity = (1 - smooth(p)).toFixed(3);
      $('mock-menu').hidden = false; $('mock-menu').inert = p < 1; $('mock-menu').style.opacity = smooth(p).toFixed(3);
      clearInk(); phaseLabel(p >= 1 ? 'Меню / макет' : 'Плавный переход'); updateTimeline(p); return;
    }
    const v = model.variant;
    const contact = pulse(p, v.hit + .035, .12);
    const fly = out(segment(p, .43, .84));
    const depart = segment(p, .62, .9);
    let bx = 0, by = 0, bs = 1, ba = 0, sy = 1;
    let ringX = 0, ringY = 0, ringScale = 1, ringAngle = 0;
    let crownOpacity = 0, speed = 0;
    const reveal = smooth(segment(p, .13, .27));
    $('white-core').style.opacity = (smooth(segment(p, 0, .12)) * (1 - reveal)).toFixed(3);
    $('face').style.opacity = reveal.toFixed(3);
    faceAt(p);
    pose('paddle', mix(132, 41, out(segment(p, .04, v.hit))), mix(-142, -26, out(segment(p, .04, v.hit))), .8, mix(55, -52, out(segment(p, .04, v.hit))), 1 - segment(p, .42, .64), .8, mix(-45, 20, segment(p, .1, v.hit)));

    if (v.id === 'smash') {
      bs = mix(1, 11, fly); sy = bs * (1 - contact * .12); ba = mix(-6, 19, fly);
      bx = Math.sin(p * 8) * 14 * (1 - fly); by = mix(0, 12, fly);
      speed = segment(p, .30, .70) * (1 - segment(p, .88, 1));
    } else if (v.id === 'crown') {
      const rush = out(segment(p, .48, .85));
      bs = mix(1, 11.5, rush); sy = bs * (1 - contact * .18); ba = mix(-12, -32, rush);
      bx = Math.sin(p * 10) * 16 * (1 - rush); by = mix(0, 25, rush);
      const toss = out(segment(p, .27, .76));
      pose('crown', mix(-24, 185, toss), mix(-99, -260, toss) - Math.sin(toss * Math.PI) * 80, mix(1.15, 3.4, toss), mix(-12, 470, toss), 1 - segment(p, .78, .88));
      crownOpacity = 1; speed = segment(p, .34, .73);
    } else if (v.id === 'net') {
      const travel = segment(p, .20, .55), rush = out(segment(p, .55, .85));
      bx = mix(-96, 84, smooth(travel)) * (1 - rush); by = (13 - Math.sin(travel * Math.PI) * 76) * (1 - rush);
      bs = mix(.65 + travel * .18, 11, rush); sy = bs; ba = mix(-18, 35, p);
      pose('paddle', mix(-164, -96, out(segment(p, .03, .24))), -5, .75, mix(-55, 27, out(segment(p, .03, .24))), 1 - segment(p, .30, .51));
      const tear = out(segment(p, .46, .78));
      pose('net-left', -tear * 150, 50 + tear * 87, 1, -6 - tear * 31, 1 - tear * .85);
      pose('net-right', tear * 150, 50 + tear * 87, 1, -6 + tear * 31, 1 - tear * .85);
      speed = segment(p, .47, .75); ringX = -46; ringY = -36;
    } else if (v.id === 'comic') {
      const freezeP = p > .30 && p < .39 ? .30 : p < .39 ? p : p - .09;
      const rush = out(segment(freezeP, .40, .74));
      bx = mix(-18, 30, rush); by = mix(0, 32, rush); bs = mix(.95, 10.5, rush); sy = bs; ba = mix(-12, 38, rush);
      $('comic-panels').style.opacity = (1 - segment(p, .72, .91)).toFixed(3);
      $('comic-panels').style.transform = `scale(${1 + out(segment(p, .72, .94)) * 1.7}) rotate(${segment(p, .72, .94) * -8}deg)`;
      pose('comic-word', -25, -124, .65 + contact * .55, -9, pulse(p, .34, .16));
      speed = segment(p, .40, .74);
    } else if (v.id === 'orbit') {
      const spin = segment(p, .03, .57), rush = out(segment(p, .57, .86));
      const a = spin * Math.PI * 2.6 - Math.PI / 2;
      const radius = (95 - spin * 12) * (1 - rush);
      bx = Math.cos(a) * radius; by = Math.sin(a) * radius; bs = mix(.55 + spin * .25, 11.5, rush); sy = bs; ba = a * 57.3 + 90;
      pose('paddle', -102, mix(101, 9, out(segment(p, .25, .44))), .75, mix(-85, 35, out(segment(p, .25, .44))), 1 - segment(p, .51, .67));
      ringScale = 1 + spin * .15; ringAngle = spin * 180;
      speed = segment(p, .56, .81);
    } else if (v.id === 'stamp') {
      const drop = out(segment(p, 0, .33)), rush = out(segment(p, .36, .64));
      bx = mix(7, 0, rush); by = mix(-160, 48, drop) * (1 - rush); bs = mix(.72, 6.5, rush);
      sy = bs * (1 - pulse(p, .60, .12) * .6); ba = mix(-15, 7, drop);
      pose('paddle', mix(125, 23, out(segment(p, .03, .33))), mix(131, 68, out(segment(p, .03, .33))), .8, mix(135, 27, out(segment(p, .03, .33))), 1 - segment(p, .38, .60));
      ringY = 63;
      pose('scene-logo', 0, -size.height * .37 / size.unit, 2 + pulse(p, .77, .17) * .65, mix(-14, -3, smooth(segment(p, .67, .88))), smooth(segment(p, .67, .77)));
      speed = pulse(p, .52, .20);
    }
    const ballOpacity = v.id === 'stamp' ? 1 - segment(p, .62, .69) : 1 - segment(p, .86, .93);
    pose('ball', bx, by, bs, ba, ballOpacity, sy);
    pose('ring', ringX, ringY, ringScale * (1 - segment(p, .25, .48) * .25), ringAngle, 1 - segment(p, .27, .49));
    if (!crownOpacity) pose('crown', -44, -102, 1, -12, (v.id === 'smash' || v.id === 'comic') ? 1 - segment(p, .19, .37) : 0);
    pose('impact', v.id === 'net' ? bx : 0, v.id === 'stamp' ? 45 : 0, .7 + contact * .9, 14 + p * 15, contact);
    pose('streak', bx - 68, by + 14, 1 + fly, -26 + ba, speed * .65);
    const cry = segment(p, v.hit + .04, v.hit + .13) * (1 - segment(p, .71, .87));
    pose('scream', mix(75, -65, depart), -91, 1 + pulse(p, .52, .28) * .6, -14 + Math.sin(p * 80) * 3, cry);
    const cryAsset = v.id === 'comic' || v.id === 'stamp' ? 'cry-ahh' : 'cry-aaa';
    if (cachedCry !== cryAsset) { $('scream').src = path(cryAsset); cachedCry = cryAsset; }
    if (v.id !== 'stamp') pose('scene-logo', 0, 0, 1 + contact * .06, -contact * 3, 1 - segment(p, .42, .65));
    $('loader-copy').style.opacity = (1 - segment(p, .08, .26)).toFixed(3);
    document.querySelector('.scene-subtitle').style.opacity = (1 - segment(p, .12, .36)).toFixed(3);
    drawInk(p, { x: bx * .35, y: by * .35, burst: contact, speed, orbit: v.id === 'orbit' && p < .8 });

    const flashAlpha = settings.flash ? pulse(p, v.flash, .075) : 0;
    $('flash').style.opacity = flashAlpha.toFixed(3);
    if (settings.shake) {
      const shake = pulse(p, v.hit + .025, .07) * 8 * size.unit;
      $('world').style.transform = `translate(${Math.sin(p * 280) * shake}px, ${Math.cos(p * 240) * shake * .6}px)`;
    }
    const menuReveal = smooth(segment(p, v.id === 'stamp' ? .89 : v.flash + .025, 1));
    if (menuReveal > 0) {
      $('mock-menu').hidden = false; $('mock-menu').inert = p < 1; $('mock-menu').style.opacity = menuReveal.toFixed(3);
      $('world').style.opacity = (1 - menuReveal).toFixed(3);
    }
    if (p >= 1) { clearInk(); $('world').style.opacity = '0'; }
    phaseLabel(p >= 1 ? 'Меню / макет' : flashAlpha > .45 ? 'Одна белая вспышка' : p > v.hit ? 'Финал / мяч в камеру' : '100% / ракетка на замахе');
    updateTimeline(p);
  }

  function updateTimeline(p) {
    $('timeline').value = Math.round(p * 1000);
    $('timeline').setAttribute('aria-valuetext', `${(p * finalMs() / 1000).toFixed(2)} секунды`);
    $('time-output').textContent = `${(p * finalMs() / 1000).toFixed(1)} / ${(finalMs() / 1000).toFixed(1)} с${settings.slow && !settings.reduced ? ' · ×0.35' : ''}`;
  }

  function syncTransport() {
    $('pause').setAttribute('aria-label', model.playing ? 'Пауза' : 'Продолжить');
    $('pause').setAttribute('aria-pressed', String(!model.playing));
    $('pause').innerHTML = model.playing ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"></path></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z" fill="currentColor"></path></svg>';
    ['play-all', 'play-hit', 'pause'].forEach((id) => { $(id).disabled = !model.ready; });
    $('timeline').disabled = !model.ready;
  }

  function stop() {
    cancelAnimationFrame(raf); raf = 0; model.playing = false; syncTransport();
  }

  function unlockAudio() {
    if (!settings.sound) return;
    try {
      if (!audio || audio.state === 'closed') audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume().catch(() => {});
    } catch { controls.sound.checked = false; readSettings(); showToast('Браузер не поддерживает звук. Анимация работает без него.'); }
  }

  function playSound() {
    if (!settings.sound || !audio || audio.state !== 'running') return;
    const now = audio.currentTime;
    const gain = audio.createGain(); gain.connect(audio.destination);
    gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(.13, now + .012); gain.gain.exponentialRampToValueAtTime(.0001, now + .36);
    const hit = audio.createOscillator(); hit.type = 'triangle'; hit.frequency.setValueAtTime(220, now); hit.frequency.exponentialRampToValueAtTime(62, now + .12); hit.connect(gain); hit.start(now); hit.stop(now + .37);
    const squeakGain = audio.createGain(); squeakGain.connect(audio.destination);
    squeakGain.gain.setValueAtTime(.0001, now + .05); squeakGain.gain.exponentialRampToValueAtTime(.035, now + .13); squeakGain.gain.exponentialRampToValueAtTime(.0001, now + .56);
    const squeak = audio.createOscillator(); squeak.type = 'sine'; squeak.frequency.setValueAtTime(620, now + .05); squeak.frequency.exponentialRampToValueAtTime(1350, now + .2); squeak.frequency.exponentialRampToValueAtTime(280, now + .56); squeak.connect(squeakGain); squeak.start(now + .05); squeak.stop(now + .57);
    hit.onended = () => { hit.disconnect(); gain.disconnect(); };
    squeak.onended = () => { squeak.disconnect(); squeakGain.disconnect(); };
  }

  function tick(now) {
    if (!model.playing) return;
    const delta = lastTime ? now - lastTime : 0; lastTime = now;
    model.elapsed += delta * (settings.slow && !settings.reduced ? .35 : 1);
    const loading = model.mode === 'full' ? loadingMs : 0;
    if (model.elapsed < loading) {
      // The first 92% breathe; the final part represents the simulated ready gate.
      const t = model.elapsed / loading;
      renderLoading((t < .8 ? out(t / .8) * .92 : .92 + (t - .8) / .2 * .08) * 100);
    } else {
      const p = clamp((model.elapsed - loading) / finalMs());
      renderFinal(p);
      if (p >= model.variant.hit && !hitSound) { hitSound = true; playSound(); }
      if (p >= 1) { stop(); return; }
    }
    raf = requestAnimationFrame(tick);
  }

  function play(includeLoading = true) {
    if (!model.ready) return;
    stop(); unlockAudio(); clearTimeout(toastTimer); $('stage-toast').hidden = true;
    model.mode = includeLoading ? 'full' : 'final'; model.elapsed = 0; model.p = 0; model.progress = 0;
    hitSound = false; lastTime = 0; model.playing = true;
    if (includeLoading) renderLoading(0); else renderFinal(0);
    syncTransport(); raf = requestAnimationFrame(tick);
  }

  function togglePause() {
    if (model.playing) { stop(); return; }
    if (model.phase === 'menu' || !model.ready) { play(false); return; }
    unlockAudio(); lastTime = 0; model.playing = true; syncTransport(); raf = requestAnimationFrame(tick);
  }

  function scrub(p) {
    if (!model.ready) return;
    stop(); model.mode = 'final'; model.elapsed = clamp(p) * finalMs(); hitSound = p >= model.variant.hit;
    renderFinal(clamp(p));
  }

  function reset(progress = 48) {
    const value = clamp(progress / 100);
    const time = value < .92 ? .8 * (1 - Math.cbrt(1 - value / .92)) : .8 + (value - .92) / .08 * .2;
    stop(); model.mode = 'full'; model.elapsed = time * loadingMs; hitSound = false;
    renderLoading(progress);
  }

  function chooseVariant(id, autoplay = true) {
    const variant = VARIANTS.find((v) => v.id === id); if (!variant) return;
    model.variant = variant; stage.dataset.variant = id;
    $('idea-number').textContent = variant.n; $('idea-title').textContent = variant.title;
    $('idea-description').textContent = variant.description; $('frame-name').textContent = `${variant.n} / ${variant.title.toUpperCase()}`;
    document.querySelectorAll('[data-idea]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.idea === id)));
    if (autoplay && model.ready) play(false); else reset(48);
  }

  function showToast(text) {
    clearTimeout(toastTimer); $('stage-toast').textContent = text; $('stage-toast').hidden = false;
    toastTimer = setTimeout(() => { $('stage-toast').hidden = true; }, 3500);
  }

  $('ideas').addEventListener('click', (event) => { const button = event.target.closest('[data-idea]'); if (button) chooseVariant(button.dataset.idea); });
  $('play-all').addEventListener('click', () => play(true));
  $('play-hit').addEventListener('click', () => play(false));
  $('menu-replay').addEventListener('click', () => play(false));
  $('pause').addEventListener('click', togglePause);
  $('timeline').addEventListener('input', (event) => scrub(Number(event.target.value) / 1000));
  $('load-slider').addEventListener('input', (event) => reset(Number(event.target.value)));
  $('mock-play').addEventListener('click', () => showToast('Это макет меню. Игра не подключена: здесь выбираем только будущую заставку.'));
  $('fullscreen').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await stage.requestFullscreen(); }
    catch { showToast('Полноэкранный режим недоступен в этом браузере.'); }
  });
  Object.values(controls).forEach((control) => control.addEventListener('input', () => {
    const p = model.p, wasFinal = model.phase !== 'loading';
    readSettings();
    if (control === controls.sound && settings.sound) unlockAudio();
    if (wasFinal) { model.elapsed = (model.mode === 'full' ? loadingMs : 0) + p * finalMs(); renderFinal(p); }
    else renderLoading();
  }));
  $('asset-grid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-asset]'); if (!button) return;
    const asset = ASSETS.find(([id]) => id === button.dataset.asset); if (!asset) return;
    if (model.playing) stop();
    $('asset-dialog-title').textContent = asset[1]; $('asset-large-image').src = path(asset[0]); $('asset-large-image').alt = asset[1];
    $('asset-download').href = path(asset[0]); $('asset-download').download = `${asset[0]}.png`;
    $('asset-dialog').showModal();
  });
  $('asset-dialog').addEventListener('click', (event) => {
    if (event.target !== $('asset-dialog')) return;
    const box = $('asset-dialog').getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) $('asset-dialog').close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.target.closest('button, input, select, a, dialog') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Space') { event.preventDefault(); togglePause(); }
    if (event.code === 'KeyR') play(false);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && model.playing) stop(); });
  reducedPreference.addEventListener('change', (event) => {
    const p = model.p, wasFinal = model.phase !== 'loading';
    controls.reduced.checked = event.matches; readSettings();
    if (wasFinal) { model.elapsed = (model.mode === 'full' ? loadingMs : 0) + p * finalMs(); renderFinal(p); }
    else renderLoading();
  });

  function resize() {
    const rect = stage.getBoundingClientRect();
    size.width = rect.width; size.height = rect.height;
    size.unit = Math.min(rect.width / 390, rect.height / 570);
    size.dpr = Math.min(devicePixelRatio || 1, 2);
    stage.style.setProperty('--u', size.unit.toFixed(4));
    canvas.width = Math.round(rect.width * size.dpr); canvas.height = Math.round(rect.height * size.dpr);
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    if (model.phase === 'loading') renderLoading(); else renderFinal();
  }
  const observer = new ResizeObserver(resize); observer.observe(stage);
  window.addEventListener('pagehide', (event) => {
    stop(); clearTimeout(toastTimer);
    if (!event.persisted) observer.disconnect();
    if (audio) { const previous = audio; audio = null; previous.close().catch(() => {}); }
  });
  window.addEventListener('pageshow', (event) => { if (event.persisted) { resize(); syncTransport(); } });

  controls.reduced.checked = reducedPreference.matches;
  const params = new URLSearchParams(location.search);
  [['face', 'ball-choice'], ['logo', 'logo-choice'], ['paddle', 'paddle-choice']].forEach(([param, control]) => {
    const value = params.get(param); if ([...controls[control].options].some((option) => option.value === value)) controls[control].value = value;
  });
  const duration = Number(params.get('duration'));
  if (duration >= 1000 && duration <= 2000) controls.duration.value = Math.round(duration / 100) * 100;
  readSettings(); chooseVariant(VARIANTS.some((v) => v.id === params.get('v')) ? params.get('v') : 'smash', false); resize(); syncTransport();

  // A small, deterministic preview API also makes frame-by-frame browser checks possible.
  window.WTFLab = {
    variants: VARIANTS.map(({ id, n, title }) => ({ id, n, title })),
    play, finish: () => play(false), pause: stop, scrub, reset, select: chooseVariant,
    getState: () => ({ variant: model.variant.id, phase: model.phase, progress: model.progress, p: model.p, playing: model.playing, ready: model.ready, duration: finalMs(), settings: { ...settings } }),
  };

  Promise.all(ASSETS.map(([id]) => new Promise((resolve, reject) => {
    const image = new Image(); image.onload = resolve; image.onerror = () => reject(new Error(id)); image.src = path(id);
  }))).then(() => {
    model.ready = true; syncTransport();
    if (params.get('autoplay') === '0') reset(48); else play(true);
  }).catch((error) => {
    $('asset-error').hidden = false;
    $('asset-error').textContent = `Не удалось загрузить ${error.message}.png. Открой index.html вместе с папкой assets. Оригинальные коллажи не изменены.`;
    phaseLabel('Ошибка загрузки ассета');
  });
})();
