/* =====================================================================
 *  CAREER — Roguelike tournament mode: basement to world championship.
 *
 *  12 tournaments, each harder than the last. Between matches you pick
 *  up to three perks that alter physics or AI behaviour, never capture/aim assistance.
 *  A loss ends the run; a win advances to the next tournament.
 *  Every run is different because the perk pool is shuffled.
 * ===================================================================== */
'use strict';

/* ------------------------------------------------------------------ */
/*  PERK DEFINITIONS                                                   */
/* ------------------------------------------------------------------ */
// Retired assistance IDs (steady_hand, quick_feet, sharp_eye, net_touch,
// berserker, glass_cannon) are deliberately absent. Legacy career loading
// already drops unknown IDs; they cannot silently restore private rules.
const PERKS = [
  // --- GREEN (common, always available) ---
  { id: 'heavy_spin',    name: 'Тяжёлое вращение',     desc: 'Вращение +12% на всех ударах', rarity: 'green',
    apply(g) { g._careerSpinBoost = (g._careerSpinBoost || 1) * 1.12; } },
  { id: 'fast_arms',     name: 'Быстрые руки',         desc: 'Макс. скорость замаха +15%',  rarity: 'green',
    apply(g) { g._careerSpeedBoost = (g._careerSpeedBoost || 1) * 1.15; } },
  { id: 'iron_will',     name: 'Железная воля',        desc: 'Мощность +12% на решающих очках', rarity: 'green',
    apply(g) { g._careerDecisiveBoost = 0.12; } },
  { id: 'deep_breath',   name: 'Глубокий вдох',        desc: 'Усталость -30%',              rarity: 'green',
    apply(g) { g._careerFatigueReduce = 0.70; } },
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
  { id: 0,  name: 'Подвальный пинг-понг',      place: 'Гараж',             eloMin: 600,  eloMax: 900,  rounds: 3, perkAfter: false },
  { id: 1,  name: 'Районный чемпионат',          place: 'Дом культуры',      eloMin: 900,  eloMax: 1100, rounds: 3, perkAfter: true },
  { id: 2,  name: 'Городская лига',              place: 'Спорткомплекс',     eloMin: 1100, eloMax: 1350, rounds: 3, perkAfter: true },
  { id: 3,  name: 'Областной турнир',            place: 'Дворец спорта',     eloMin: 1300, eloMax: 1550, rounds: 4, perkAfter: true },
  { id: 4,  name: 'Первенство региона',          place: 'Арена',             eloMin: 1500, eloMax: 1750, rounds: 4, perkAfter: true },
  { id: 5,  name: 'Кубок Федерации',             place: 'Центральный зал',   eloMin: 1700, eloMax: 1950, rounds: 4, perkAfter: true },
  { id: 6,  name: 'Международный Гран-При',      place: 'Олимпийский зал',   eloMin: 1900, eloMax: 2150, rounds: 5, perkAfter: true },
  { id: 7,  name: 'Чемпионат Европы',            place: 'Европа Арена',      eloMin: 2100, eloMax: 2350, rounds: 5, perkAfter: true },
  { id: 8,  name: 'Кубок Мира',                  place: 'Токио',             eloMin: 2300, eloMax: 2550, rounds: 5, perkAfter: true },
  { id: 9,  name: 'Суперсерия',                  place: 'Шанхай',            eloMin: 2500, eloMax: 2700, rounds: 5, perkAfter: true },
  { id: 10, name: 'Мировой Финал',               place: 'Дюссельдорф',       eloMin: 2700, eloMax: 2900, rounds: 6, perkAfter: true },
  { id: 11, name: 'Зал Славы',                   place: 'Легендарный зал',   eloMin: 2900, eloMax: 3100, rounds: 1, perkAfter: false },
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
  }

  start() {
    this.stop();
    this._baseSettings = { difficulty: this.game.settings.difficulty };
    this.active = true;
    this.currentTournament = 0;
    this.currentRound = 0;
    this.totalWins = 0;
    this.totalLosses = 0;
    this.perks = [];
    this.matchHistory = [];
    this.pendingPerks = null;
    this.runStats = { totalPoints: 0, totalRallies: 0, longestRally: 0, maxSpeed: 0 };
    this._resetCareerBoosts();
    this.enterTournament();
    this.save();
  }

  stop() {
    if (this._baseSettings) Object.assign(this.game.settings, this._baseSettings);
    this._baseSettings = null;
    this.active = false;
    this._resetCareerBoosts();
  }

  _resetCareerBoosts() {
    const g = this.game;
    g._careerDecisiveActive = false;
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
    if (this.state !== 'TOURNAMENT_INTRO') return;
    this.state = 'OPPONENT_SELECT';
    this.save();
  }

  /** Called when the player selects an opponent to play */
  selectOpponent(idx) {
    if (this.state !== 'OPPONENT_SELECT' || !Number.isInteger(idx) || idx < 0 || idx >= this.opponents.length) return;
    this.selectedOpponent = this.opponents[idx];
    const g = this.game;
    // apply opponent
    g.settings.difficulty = this.selectedOpponent.level;
    g.ai.setLevel(this.selectedOpponent.level);
    g.ai.reset();
    // reset career decisive boost flag
    if (g._careerDecisiveBoost) g._careerDecisiveActive = false;
    this.state = 'MATCH';
    this.save();
    g.startMatch(this.selectedOpponent.level);
  }

  /** Called by Game when a match ends */
  onMatchEnd(winner) {
    if (this.state !== 'MATCH') return;
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
    if (this.state !== 'PERK_SELECT' || !this.pendingPerks || !Number.isInteger(idx) || idx < 0 || idx >= this.pendingPerks.length) return;
    const perk = this.pendingPerks[idx];
    this.perks.push(perk);
    perk.apply(this.game);
    this.pendingPerks = null;
    this.state = 'OPPONENT_SELECT';
    this.save();
  }

  /** Advance to next tournament */
  advanceTournament() {
    if (this.state !== 'TOURNAMENT_END') return;
    this.currentTournament++;
    if (this.currentTournament >= TOURNAMENTS.length) {
      this.state = 'RUN_END';
      this.save();
      return;
    }
    this.enterTournament();
    this.save();
  }

  /** Tournament name for display */
  get currentTournamentInfo() {
    return TOURNAMENTS[this.currentTournament] || TOURNAMENTS[TOURNAMENTS.length - 1];
  }

  get isRunActive() {
    return this.active && this.state !== 'RUN_END' && this.state !== 'IDLE';
  }

  /** Save a checkpoint, not just the counters: bracket and perk choice matter. */
  save() {
    try {
      if (this.state === 'RUN_END') {
        localStorage.removeItem('topspin_career');
        return;
      }
      if (!this.active) return; // a suspended checkpoint must survive pagehide
      localStorage.setItem('topspin_career', JSON.stringify({
        v: 2, state: this.state,
        currentTournament: this.currentTournament, currentRound: this.currentRound,
        totalWins: this.totalWins, totalLosses: this.totalLosses,
        perks: this.perks.map(p => p.id), pendingPerks: this.pendingPerks && this.pendingPerks.map(p => p.id),
        opponents: this.opponents, matchHistory: this.matchHistory.slice(-20), runStats: this.runStats,
      }));
    } catch(e) { /* storage may be unavailable */ }
  }

  load() {
    let data;
    try {
      data = JSON.parse(localStorage.getItem('topspin_career'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
      if (!Number.isInteger(data.currentTournament) || !TOURNAMENTS[data.currentTournament] ||
          data.state === 'RUN_END' || data.totalLosses > 0) return false;
      const rounds = TOURNAMENTS[data.currentTournament].rounds;
      if (!Number.isInteger(data.currentRound) || data.currentRound < 0 || data.currentRound > rounds) return false;
      if (data.v === 2 && (!Array.isArray(data.opponents) || data.opponents.length !== rounds - data.currentRound ||
          !data.opponents.every(o => o && typeof o.name === 'string' && o.name.length < 80 &&
            typeof o.style === 'string' && o.style.length < 80 && Number.isFinite(o.elo) &&
            Number.isInteger(o.level) && o.level >= 0 && o.level <= 4))) return false;
    } catch(e) { return false; }
    this.stop();
    this._baseSettings = { difficulty: this.game.settings.difficulty };
    this.active = true;
    this.currentTournament = data.currentTournament;
    this.enterTournament();
    this.currentRound = data.currentRound;
    this.opponents = data.v === 2 ? data.opponents : this.opponents.slice(this.currentRound);
    const count = v => Number.isInteger(v) && v >= 0 && v <= 10000 ? v : 0;
    this.totalWins = count(data.totalWins);
    this.totalLosses = 0;
    this.matchHistory = Array.isArray(data.matchHistory) ? data.matchHistory.slice(-20) : [];
    for (const k of Object.keys(this.runStats)) {
      const v = data.runStats && data.runStats[k];
      this.runStats[k] = Number.isFinite(v) && v >= 0 ? Math.min(v, 1e9) : 0;
    }
    const ids = Array.isArray(data.perks) ? [...new Set(data.perks)] : [];
    this.perks = ids.map(id => PERKS.find(p => p.id === id)).filter(Boolean);
    this._resetCareerBoosts();
    this.perks.forEach(p => p.apply(this.game));
    this.pendingPerks = Array.isArray(data.pendingPerks) ? [...new Set(data.pendingPerks)]
      .map(id => PERKS.find(p => p.id === id && !ids.includes(id))).filter(Boolean).slice(0, 3) : null;
    this.state = this.currentRound === this.currentTournamentInfo.rounds ? 'TOURNAMENT_END'
      : data.state === 'PERK_SELECT' && this.pendingPerks && this.pendingPerks.length ? 'PERK_SELECT'
      : 'TOURNAMENT_INTRO';
    return true;
  }
}
