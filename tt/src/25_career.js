/* =====================================================================
 *  CAREER — Roguelike tournament mode: basement to world championship.
 *
 *  12 tournaments, each harder than the last. Between matches you pick
 *  one of three perks that alter physics, assist or AI behaviour.
 *  A loss ends the run; a win advances to the next tournament.
 *  Every run is different because the perk pool is shuffled.
 * ===================================================================== */
'use strict';

/* ------------------------------------------------------------------ */
/*  PERK DEFINITIONS                                                   */
/* ------------------------------------------------------------------ */
const PERKS = [
  // --- GREEN (common, always available) ---
  { id: 'steady_hand',   name: 'Стальная рука',       desc: 'Помощь прицела +8%',         rarity: 'green',
    apply(g) { g.settings.assist = clamp(g.settings.assist + 0.08, 0, 1); } },
  { id: 'quick_feet',    name: 'Быстрые ноги',         desc: 'Помощь позиции +10%',        rarity: 'green',
    apply(g) { g.settings.posAssist = clamp(g.settings.posAssist + 0.10, 0, 1); } },
  { id: 'heavy_spin',    name: 'Тяжёлое вращение',     desc: 'Вращение +12% на всех ударах', rarity: 'green',
    apply(g) { g._careerSpinBoost = (g._careerSpinBoost || 1) * 1.12; } },
  { id: 'fast_arms',     name: 'Быстрые руки',         desc: 'Макс. скорость замаха +15%',  rarity: 'green',
    apply(g) { g._careerSpeedBoost = (g._careerSpeedBoost || 1) * 1.15; } },
  { id: 'iron_will',     name: 'Железная воля',        desc: 'Помощь +12% на решающих очках', rarity: 'green',
    apply(g) { g._careerDecisiveBoost = 0.12; } },
  { id: 'deep_breath',   name: 'Глубокий вдох',        desc: 'Усталость -30%',              rarity: 'green',
    apply(g) { g._careerFatigueReduce = 0.70; } },
  { id: 'sharp_eye',     name: 'Зоркий глаз',          desc: 'Кольцо удара сжимается на 15% медленнее', rarity: 'green',
    apply(g) { g._careerRingSlow = 0.85; } },
  { id: 'net_touch',     name: 'Чутьё сетки',          desc: 'У сетки мяч всегда перелетает', rarity: 'green',
    apply(g) { g._careerNetSafe = true; } },
  // --- BLUE (uncommon, unlock after tournament 3) ---
  { id: 'topspin_master',name: 'Мастер топспина',      desc: 'Топспин +25%, бэкспин -10%',  rarity: 'blue',
    apply(g) { g._careerTopspinBoost = 1.25; g._careerBackspinPenalty = 0.90; } },
  { id: 'smash_fury',    name: 'Ярость смеша',         desc: 'Смеш +30% скорости',          rarity: 'blue',
    apply(g) { g._careerSmashBoost = 1.30; } },
  { id: 'counter_punch', name: 'Контр-удар',           desc: 'Контр-топспин +40% вращения', rarity: 'blue',
    apply(g) { g._careerCounterBoost = 1.40; } },
  { id: 'chop_back',     name: 'Глубокая защита',      desc: 'Чоп +35% вращения, -20% скорость соперника', rarity: 'blue',
    apply(g) { g._careerChopBoost = 1.35; g._careerAISlowdown = 0.80; } },
  { id: 'deception',     name: 'Обманный удар',        desc: 'Боковое вращение +50%',       rarity: 'blue',
    apply(g) { g._careerSidespinBoost = 1.50; } },
  // --- GOLD (rare, unlock after tournament 7) ---
  { id: 'berserker',     name: 'Берсерк',              desc: 'Assist = 0, все удары +25% мощности', rarity: 'gold',
    apply(g) { g.settings.assist = 0; g._careerSpeedBoost = (g._careerSpeedBoost || 1) * 1.25; } },
  { id: 'glass_cannon',  name: 'Стеклянная пушка',     desc: 'Скорость +35%, точность -15%', rarity: 'gold',
    apply(g) { g._careerSpeedBoost = (g._careerSpeedBoost || 1) * 1.35; g.settings.assist = clamp(g.settings.assist - 0.15, 0, 1); } },
  { id: 'time_master',   name: 'Повелитель времени',   desc: 'Замедление 0.3x при smash > 80 км/ч', rarity: 'gold',
    apply(g) { g._careerSlowmoThreshold = 80; g._careerSlowmoScale = 0.3; } },
];

function getAvailablePerks(career) {
  const t = career.currentTournament;
  return PERKS.filter(p => {
    if (p.rarity === 'blue' && t < 3) return false;
    if (p.rarity === 'gold' && t < 7) return false;
    if (career.perks.some(pk => pk.id === p.id)) return false;  // no duplicates
    return true;
});
}

function pickThreePerks(career) {
  const pool = getAvailablePerks(career);
  const shuffled = pool.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(3, shuffled.length));
}

/* ------------------------------------------------------------------ */
/*  TOURNAMENT DEFINITIONS                                             */
/* ------------------------------------------------------------------ */
const TOURNAMENTS = [
  { id: 0,  name: 'Подвальный пинг-понг',      place: 'Гараж',             eloMin: 600,  eloMax: 900,  rounds: 3, perkAfter: false, icon: '🏚️' },
  { id: 1,  name: 'Районный чемпионат',          place: 'Дом культуры',      eloMin: 900,  eloMax: 1100, rounds: 3, perkAfter: true,  icon: '🏫' },
  { id: 2,  name: 'Городская лига',              place: 'Спорткомплекс',     eloMin: 1100, eloMax: 1350, rounds: 3, perkAfter: true,  icon: '🏟️' },
  { id: 3,  name: 'Областной турнир',            place: 'Дворец спорта',     eloMin: 1300, eloMax: 1550, rounds: 4, perkAfter: true,  icon: '🏛️' },
  { id: 4,  name: 'Первенство региона',          place: 'Арена',             eloMin: 1500, eloMax: 1750, rounds: 4, perkAfter: true,  icon: '🏟️' },
  { id: 5,  name: 'Кубок Федерации',             place: 'Центральный зал',   eloMin: 1700, eloMax: 1950, rounds: 4, perkAfter: true,  icon: '🏆' },
  { id: 6,  name: 'Международный Гран-При',      place: 'Олимпийский зал',   eloMin: 1900, eloMax: 2150, rounds: 5, perkAfter: true,  icon: '🌍' },
  { id: 7,  name: 'Чемпионат Европы',            place: 'Европа Арена',      eloMin: 2100, eloMax: 2350, rounds: 5, perkAfter: true,  icon: '🇪🇺' },
  { id: 8,  name: 'Кубок Мира',                  place: 'Токио',             eloMin: 2300, eloMax: 2550, rounds: 5, perkAfter: true,  icon: '🌏' },
  { id: 9,  name: 'Суперсерия',                  place: 'Шанхай',            eloMin: 2500, eloMax: 2700, rounds: 5, perkAfter: true,  icon: '⭐' },
  { id: 10, name: 'Мировой Финал',               place: 'Дюссельдорф',       eloMin: 2700, eloMax: 2900, rounds: 6, perkAfter: true,  icon: '👑' },
  { id: 11, name: 'Зал Славы',                   place: 'Легендарный зал',   eloMin: 2900, eloMax: 3100, rounds: 1, perkAfter: false, icon: '🔮' },
];

/* ------------------------------------------------------------------ */
/*  OPPONENT NAME GENERATOR                                            */
/* ------------------------------------------------------------------ */
const OPP_FIRST = ['Алексей', 'Дмитрий', 'Сергей', 'Андрей', 'Михаил', 'Николай', 'Виктор', 'Игорь',
  'Олег', 'Павел', 'Евгений', 'Роман', 'Максим', 'Артём', 'Кирилл', 'Тимур',
  'Ван', 'Ли', 'Чжан', 'Линь', 'Чен', 'Ян', 'Хироши', 'Кэндзи', 'Юки',
  'Тим', 'Ян-Ове', 'Кристиан', 'Маттиас', 'Феликс', 'Йонас', 'Каль'];
const OPP_STYLE = ['Атакующий', 'Защитник', 'Универсал', 'Тактик', 'Агрессор', 'Стенка', 'Виртуоз', 'Пушер'];

function generateOpponent(eloMin, eloMax) {
  const elo = Math.round(eloMin + Math.random() * (eloMax - eloMin));
  const name = OPP_FIRST[Math.floor(Math.random() * OPP_FIRST.length)];
  const style = OPP_STYLE[Math.floor(Math.random() * OPP_STYLE.length)];
  // map ELO to AI level (0-4) approximately
  let level = 0;
  if (elo >= 2500) level = 4; else if (elo >= 2000) level = 3;
  else if (elo >= 1400) level = 2; else if (elo >= 1000) level = 1;
  return { name, elo, style, level, id: Math.random().toString(36).slice(2, 8) };
}

/* ------------------------------------------------------------------ */
/*  CAREER CLASS                                                       */
/* ------------------------------------------------------------------ */
class Career {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.currentTournament = 0;
    this.currentRound = 0;
    this.totalWins = 0;
    this.totalLosses = 0;
    this.perks = [];
    this.matchHistory = [];
    this.opponents = [];        // current tournament bracket
    this.pendingPerks = null;   // three perks to choose from
    this.state = 'IDLE';        // IDLE TOURNAMENT_INTRO OPPONENT_SELECT PERK_SELECT MATCH MATCH_END TOURNAMENT_END RUN_END
    this.runStats = { totalPoints: 0, totalRallies: 0, longestRally: 0, maxSpeed: 0 };
    this._perkDelta = { assist: 0, posAssist: 0 };   // what the perks changed
  }

  start() {
    this.active = true;
    this.currentTournament = 0;
    this.currentRound = 0;
    this.totalWins = 0;
    this.totalLosses = 0;
    this.perks = [];
    this.matchHistory = [];
    this.pendingPerks = null;
    this.runStats = { totalPoints: 0, totalRallies: 0, longestRally: 0, maxSpeed: 0 };
    /* Undo the sliders the previous run's perks wrote into, BEFORE the new
     * run starts: they used to leak, and the next run began with an assist
     * the player had never chosen (measured: 0.580 -> 0.580 across two
     * runs). The multiplier reset (_resetCareerBoosts) was not enough —
     * the perk had written into the player's own settings. */
    this._undoPerkSettings();
    this._resetCareerBoosts();
    this.enterTournament();
  }

  /* The perks that write into the live settings are tracked so they can be
   * taken back out again, exactly and only as far as they went in. */
  _applyPerk(perk) {
    const s = this.game.settings;
    const a0 = s.assist, p0 = s.posAssist;
    perk.apply(this.game);
    this._perkDelta.assist += s.assist - a0;
    this._perkDelta.posAssist += s.posAssist - p0;
  }

  _undoPerkSettings() {
    const s = this.game.settings;
    s.assist = clamp(s.assist - this._perkDelta.assist, 0, 1);
    s.posAssist = clamp(s.posAssist - this._perkDelta.posAssist, 0, 1);
    this._perkDelta.assist = 0;
    this._perkDelta.posAssist = 0;
  }

  _resetCareerBoosts() {
    const g = this.game;
    g._careerSpinBoost = 1; g._careerSpeedBoost = 1; g._careerTopspinBoost = 1;
    g._careerBackspinPenalty = 1; g._careerSmashBoost = 1; g._careerCounterBoost = 1;
    g._careerChopBoost = 1; g._careerSidespinBoost = 1; g._careerDecisiveBoost = 0;
    g._careerFatigueReduce = 1; g._careerRingSlow = 1; g._careerNetSafe = false;
    g._careerAISlowdown = 1; g._careerSlowmoThreshold = 999; g._careerSlowmoScale = 0.42;
  }

  enterTournament() {
    const t = TOURNAMENTS[this.currentTournament];
    if (!t) { this.state = 'RUN_END'; return; }
    this.currentRound = 0;
    // generate bracket
    this.opponents = [];
    for (let i = 0; i < t.rounds; i++) {
      this.opponents.push(generateOpponent(t.eloMin, t.eloMax));
    }
    this.state = 'TOURNAMENT_INTRO';
  }

  /** Called by UI when the player dismisses the intro screen */
  readyForOpponentSelect() {
    this.state = 'OPPONENT_SELECT';
  }

  /** Called when the player selects an opponent to play */
  selectOpponent(idx) {
    if (idx < 0 || idx >= this.opponents.length) return;
    this.selectedOpponent = this.opponents[idx];
    const g = this.game;
    // apply opponent
    g.settings.difficulty = this.selectedOpponent.level;
    g.ai.setLevel(this.selectedOpponent.level);
    g.ai.reset();
    // reset career decisive boost flag
    if (g._careerDecisiveBoost) g._careerDecisiveActive = false;
    this.state = 'MATCH';
    g.startMatch(this.selectedOpponent.level);
  }

  /** Called by Game when a match ends */
  onMatchEnd(winner) {
    const won = winner === 1;
    if (won) {
      this.totalWins++;
      this.currentRound++;
      // remove beaten opponent
      const idx = this.opponents.indexOf(this.selectedOpponent);
      if (idx >= 0) this.opponents.splice(idx, 1);
    } else {
      this.totalLosses++;
    }
    this.matchHistory.push({
      tournament: this.currentTournament, round: this.currentRound,
      opponent: { ...this.selectedOpponent }, won,
      score: [...this.game.score],
    });
    this.runStats.totalPoints += this.game.score[0];
    this.runStats.maxSpeed = Math.max(this.runStats.maxSpeed, this.game.stats.maxSpeed);

    if (!won) {
      this.state = 'RUN_END';
      return;
    }
    // check tournament complete
    if (this.currentRound >= TOURNAMENTS[this.currentTournament].rounds) {
      this.state = 'TOURNAMENT_END';
      return;
    }
    // offer perks if applicable
    const t = TOURNAMENTS[this.currentTournament];
    if (t.perkAfter && this.currentRound === Math.ceil(t.rounds / 2)) {
      this.pendingPerks = pickThreePerks(this);
      if (this.pendingPerks.length > 0) {
        this.state = 'PERK_SELECT';
        return;
      }
    }
    this.state = 'OPPONENT_SELECT';
  }

  /** Called when the player picks a perk */
  selectPerk(idx) {
    if (!this.pendingPerks || idx < 0 || idx >= this.pendingPerks.length) return;
    const perk = this.pendingPerks[idx];
    this.perks.push(perk);
    this._applyPerk(perk);
    this.pendingPerks = null;
    this.state = 'OPPONENT_SELECT';
  }

  /** Advance to next tournament */
  advanceTournament() {
    this.currentTournament++;
    if (this.currentTournament >= TOURNAMENTS.length) {
      this.state = 'RUN_END';
      return;
    }
    this.enterTournament();
  }

  /** Tournament name for display */
  get currentTournamentInfo() {
    return TOURNAMENTS[this.currentTournament] || TOURNAMENTS[TOURNAMENTS.length - 1];
  }

  get isRunActive() {
    return this.active && this.state !== 'RUN_END' && this.state !== 'IDLE';
  }

  /** Serialize for localStorage */
  save() {
    const data = {
      currentTournament: this.currentTournament,
      currentRound: this.currentRound,
      totalWins: this.totalWins,
      totalLosses: this.totalLosses,
      perks: this.perks.map(p => p.id),
      matchHistory: this.matchHistory.slice(-20),
      runStats: this.runStats,
    };
    try { localStorage.setItem('topspin_career', JSON.stringify(data)); } catch(e) {}
  }

  load() {
    try {
      const raw = localStorage.getItem('topspin_career');
      if (!raw) return false;
      const data = JSON.parse(raw);
      this.currentTournament = data.currentTournament || 0;
      this.currentRound = data.currentRound || 0;
      this.totalWins = data.totalWins || 0;
      this.totalLosses = data.totalLosses || 0;
      this.matchHistory = data.matchHistory || [];
      this.runStats = data.runStats || this.runStats;
        this.perks = (data.perks || []).map(id => PERKS.find(p => p.id === id)).filter(Boolean);
        this.active = true;
        this._resetCareerBoosts();
        this._perkDelta = { assist: 0, posAssist: 0 };
        this.perks.forEach(p => this._applyPerk(p));
      this.enterTournament();
      return true;
    } catch(e) { return false; }
  }
}