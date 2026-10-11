/* =====================================================================
 *  SHOP — Economy, cosmetics, racket customization and monetization.
 *
 *  Currency:
 *    coins   — earned by playing matches (win: 50-150, loss: 20-40)
 *    gems    — premium currency (purchased or rare rewards)
 *
 *  Categories:
 *    RUBBER  — physics-affecting (tensor, tacky, long-pips, etc.)
 *    BLADE   — physics-affecting (speed/control/sweet-spot trade-off)
 *    ARENA   — cosmetic (visual theme of the hall)
 *    TRAIL   — cosmetic (ball trail color/pattern)
 *    EFFECT  — cosmetic (hit flash, particles)
 *    PREMIUM — pro subscription / battle pass
 * ===================================================================== */
'use strict';

const SHOP_ITEMS = {
  /* ---- BLADES ---- */
  blade_classic:   { cat: 'blade', name: 'Классика',       desc: 'Сбалансированная основа',           price: 0,    currency: 'coins', blade: { speed: 1.0, control: 1.0, sweetR: 0.055 } },
  blade_off:       { cat: 'blade', name: 'ОФФЕНЗИВ',       desc: '+15% скорость, sweet spot −15%',     price: 500,  currency: 'coins', blade: { speed: 1.15, control: 0.90, sweetR: 0.047 } },
  blade_def:       { cat: 'blade', name: 'ЗАЩИТНАЯ',       desc: '+20% контроль, sweet spot +18%',     price: 500,  currency: 'coins', blade: { speed: 0.88, control: 1.20, sweetR: 0.065 } },
  blade_carbon:    { cat: 'blade', name: 'КАРБОН',         desc: '+25% скорость, −10% контроль',       price: 1200, currency: 'coins', blade: { speed: 1.25, control: 0.90, sweetR: 0.050 } },
  blade_wood:      { cat: 'blade', name: 'ДЕРЕВЯННАЯ',     desc: '+5% контроль, классическое ощущение', price: 200, currency: 'coins', blade: { speed: 0.95, control: 1.05, sweetR: 0.058 } },
  blade_pro:       { cat: 'blade', name: 'ПРО МОДЕЛЬ',     desc: 'Подпись чемпиона',                   price: 50,   currency: 'gems',  blade: { speed: 1.10, control: 1.10, sweetR: 0.052 } },

  /* ---- RUBBERS ---- */
  rubber_classic:  { cat: 'rubber', name: 'Классика',      desc: 'Проверенная накладка',                price: 0,    currency: 'coins', profile: 'CLASSIC' },
  rubber_tensor:   { cat: 'rubber', name: 'ТЕНЗОР',        desc: '+19% catapult, вращение ↑',           price: 800,  currency: 'coins', profile: 'TENSOR' },
  rubber_tacky:    { cat: 'rubber', name: 'ЛИПКАЯ',        desc: '+22% захват, вращение ↑↑, скорость ↓', price: 800, currency: 'coins', profile: 'TACKY' },
  rubber_longpip:  { cat: 'rubber', name: 'ДЛИННЫЕ ШИПЫ',  desc: 'Инвертирует вращение, защита',        price: 1000, currency: 'coins', profile: 'LONGPIP' },
  rubber_anti:     { cat: 'rubber', name: 'АНТИСКРУТ',     desc: 'Убивает вращение соперника',          price: 1000, currency: 'coins', profile: 'ANTISPIN' },
  rubber_hard:     { cat: 'rubber', name: 'ЖЁСТКАЯ',       desc: 'Плоские удары, контроль',             price: 600,  currency: 'coins', profile: 'HARD' },
  rubber_gold:     { cat: 'rubber', name: 'ЗОЛОТАЯ',       desc: 'Эксклюзивная накладка чемпиона',      price: 100,  currency: 'gems',  profile: 'TENSOR' },

  /* ---- ARENAS (cosmetic) ---- */
  arena_dark:      { cat: 'arena', name: 'Тёмный зал',     desc: 'Стандартная арена',                   price: 0,    currency: 'coins', palette: 'default' },
  arena_neon:      { cat: 'arena', name: 'Неон-клуб',      desc: 'UV-подсветка, флуоресцентный мяч',   price: 1500, currency: 'coins', palette: 'neon' },
  arena_rooftop:   { cat: 'arena', name: 'Крыша',          desc: 'Открытое небо, городской пейзаж',     price: 2000, currency: 'coins', palette: 'rooftop' },
  arena_club:      { cat: 'arena', name: 'Спортклуб',      desc: 'Яркий свет, зрители',                 price: 1500, currency: 'coins', palette: 'club' },
  arena_vintage:   { cat: 'arena', name: 'Винтаж',         desc: 'Деревянный зал, ретро-стиль',         price: 1000, currency: 'coins', palette: 'vintage' },
  arena_gold:      { cat: 'arena', name: 'Золотая арена',  desc: 'Эксклюзивная чемпионская арена',       price: 200,  currency: 'gems',  palette: 'gold' },

  /* ---- TRAILS (cosmetic) ---- */
  trail_white:     { cat: 'trail', name: 'Белый',          desc: 'Стандартный след',                    price: 0,    currency: 'coins', color: '#ffffff' },
  trail_fire:      { cat: 'trail', name: 'Огненный',       desc: 'Красно-оранжевый след',               price: 300,  currency: 'coins', color: '#ff6a2f' },
  trail_ice:       { cat: 'trail', name: 'Ледяной',        desc: 'Голубой след с кристаллами',          price: 300,  currency: 'coins', color: '#44ccff' },
  trail_gold:      { cat: 'trail', name: 'Золотой',        desc: 'Мерцающий золотой след',              price: 800,  currency: 'coins', color: '#ffd700' },
  trail_rainbow:   { cat: 'trail', name: 'Радуга',         desc: 'Переливающийся след',                 price: 50,   currency: 'gems',  color: 'rainbow' },

  /* ---- EFFECTS (cosmetic) ---- */
  fx_default:      { cat: 'effect', name: 'Стандарт',      desc: 'Обычные частицы',                     price: 0,    currency: 'coins' },
  fx_sparks:       { cat: 'effect', name: 'Искры',         desc: 'Электрические разряды при ударе',     price: 600,  currency: 'coins' },
  fx_cherry:       { cat: 'effect', name: 'Сакура',        desc: 'Лепестки вишни при ударе',            price: 600,  currency: 'coins' },
  fx_fire:         { cat: 'effect', name: 'Пламя',         desc: 'Огненные частицы',                    price: 50,   currency: 'gems' },

  /* ---- PREMIUM ---- */
  pro_month:       { cat: 'premium', name: 'PRO подписка', desc: 'Все арены + 500 gems/мес + без рекламы', price: 299, currency: 'real', duration: 'month' },
  battle_pass:     { cat: 'premium', name: 'Battle Pass',  desc: '100 уровней наград + эксклюзивные предметы', price: 499, currency: 'real', duration: 'season' },
  starter_pack:    { cat: 'premium', name: 'Стартовый набор', desc: '2000 coins + 50 gems + карбон + тензор', price: 149, currency: 'real', once: true },
};

/* ------------------------------------------------------------------ */
/*  ECONOMY                                                            */
/* ------------------------------------------------------------------ */
class Economy {
  constructor() {
    this.coins = 0;
    this.gems = 0;
    this.owned = ['blade_classic', 'rubber_classic', 'arena_dark', 'trail_white', 'fx_default'];  // starter items
    this.equipped = { blade: 'blade_classic', rubber: 'rubber_classic', arena: 'arena_dark', trail: 'trail_white', effect: 'fx_default' };
    this.stats = { matchesPlayed: 0, totalCoinsEarned: 0, totalGemsEarned: 0, purchases: 0 };
    this.load();
  }

  earn(won, rallyLen, maxSpeed, difficulty) {
    // base reward
    let coins = won ? 50 : 20;
    // bonus for performance
    coins += Math.min(rallyLen * 2, 40);          // long rallies = more
    coins += Math.min(Math.round(maxSpeed / 10), 30);  // fast shots = more
    coins += difficulty * 15;                      // harder opponent = more
    if (won) coins += difficulty * 25;             // win bonus scales with difficulty
    coins = Math.round(coins);
    this.coins += coins;
    this.stats.matchesPlayed++;
    this.stats.totalCoinsEarned += coins;
    // rare gem drop (5% chance on win) — single roll for both award and display
    let gemsEarned = 0;
    if (won && Math.random() < 0.05) { gemsEarned = 2; this.gems += 2; this.stats.totalGemsEarned += 2; }
    this.save();
    return { coins, gems: gemsEarned };
  }

  canAfford(itemId) {
    const item = SHOP_ITEMS[itemId]; if (!item) return false;
    if (item.currency === 'real') return false; // handled externally
    return this[item.currency] >= item.price;
  }

  buy(itemId) {
    const item = SHOP_ITEMS[itemId]; if (!item) return false;
    if (item.currency === 'real') return false;
    if (this.owned.includes(itemId)) return false;
    if (!this.canAfford(itemId)) return false;
    this[item.currency] -= item.price;
    this.owned.push(itemId);
    this.stats.purchases++;
    this.save();
    return true;
  }

  equip(itemId) {
    const item = SHOP_ITEMS[itemId]; if (!item) return false;
    if (!this.owned.includes(itemId)) return false;
    this.equipped[item.cat] = itemId;
    this.save();
    return true;
  }

  getEquipped(cat) { return SHOP_ITEMS[this.equipped[cat]] || null; }
  getEquippedId(cat) { return this.equipped[cat]; }

  /** Apply equipped items to game settings */
  applyToGame(game) {
    const blade = this.getEquipped('blade');
    const rubber = this.getEquipped('rubber');
    if (blade && blade.blade) {
      game._bladeSpeed = blade.blade.speed;
      game._bladeControl = blade.blade.control;
      game._bladeSweetR = blade.blade.sweetR;
    }
    if (rubber && rubber.profile) {
      game._equippedRubberProfile = rubber.profile;
    }
    const trail = this.getEquipped('trail');
    if (trail && trail.color) game._trailColor = trail.color;
    game._equippedEffect = this.equipped.effect || 'fx_default';
  }

  save() {
    try {
      localStorage.setItem('topspin_economy', JSON.stringify({
        coins: this.coins, gems: this.gems, owned: this.owned,
        equipped: this.equipped, stats: this.stats,
      }));
    } catch(e) {}
  }

  load() {
    try {
      const raw = localStorage.getItem('topspin_economy');
      if (!raw) return;
      const d = JSON.parse(raw);
      this.coins = d.coins || 0;
      this.gems = d.gems || 0;
      this.owned = d.owned || this.owned;
      this.equipped = Object.assign(this.equipped, d.equipped || {});
      this.stats = Object.assign(this.stats, d.stats || {});
    } catch(e) {}
  }
}