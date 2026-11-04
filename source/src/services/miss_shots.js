/* Calibration miss gallery. The key and legacy record format are the ones
 * used by the earlier gallery, so existing local screenshots remain visible.
 * A failed localStorage write must never make the in-memory list disappear. */
const MissShots = {
  KEY: 'ttu-miss-shots', MAX: 40, mem: null, storage: 'unknown', error: null, captureError: null,
  MAX_OUTCOMES: 80, outcomes: new Map(), clearedAt: null,
  all() {
    if (this.mem !== null) return this.mem.slice();
    try {
      const raw = localStorage.getItem(this.KEY);
      const entries = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(entries)) throw new Error('Invalid gallery data');
      this.mem = entries.filter(s => s && s.id != null && typeof s.img === 'string' &&
        /^[a-zA-Z0-9+/=]+$/.test(s.img)).slice(-this.MAX);
      this.storage = 'saved'; this.error = null;
    } catch (e) {
      this.mem = []; this.storage = 'memory'; this.error = String(e && e.message || e);
    }
    return this.mem.slice();
  },
  persist() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.mem || [])); this.storage = 'saved'; this.error = null; return true; }
    catch (e) { this.storage = 'memory'; this.error = String(e && e.message || e); return false; }
  },
  rememberOutcome(id, outcome) {
    const key = String(id), previous = this.outcomes.get(key);
    const contact = !!(previous && previous.contact || outcome && outcome.contact);
    const result = { contact, reason: contact ? null : previous && previous.reason ||
      (outcome && typeof outcome.reason === 'string' ? outcome.reason.slice(0, 300) : null) };
    this.outcomes.delete(key); this.outcomes.set(key, result);
    while (this.outcomes.size > this.MAX_OUTCOMES) this.outcomes.delete(this.outcomes.keys().next().value);
    return result;
  },
  add(s) {
    if (!s || s.id == null || typeof s.img !== 'string' || s.img.length > 2000000 || !/^[a-zA-Z0-9+/=]+$/.test(s.img)) return false;
    this.captureError = null;
    const key = String(s.id), outcome = this.outcomes.get(key);
    // Outcomes can precede the render/JPEG. Keep terminal contacts around so
    // duplicate images or late miss results cannot resurrect a successful shot.
    if (outcome && outcome.contact) return true;
    if (this.clearedAt !== null && Number.isFinite(s.t) && s.t <= this.clearedAt) {
      this.rememberOutcome(key, { contact: true }); return true;
    }
    const entries = this.all();
    if (entries.some(x => String(x.id) === key)) return true;
    entries.push(outcome ? { ...s, status: 'miss', reason: outcome.reason } : s);
    this.mem = entries.slice(-this.MAX);
    this.persist(); return true;
  },
  result(id, outcome) {
    if (id == null) return false;
    const entries = this.all(); const i = entries.findIndex(x => String(x.id) === String(id));
    const result = this.rememberOutcome(id, outcome);
    if (i < 0) return true;
    if (result.contact) entries.splice(i, 1);
    else entries[i] = { ...entries[i], status: 'miss', reason: entries[i].reason || result.reason };
    this.mem = entries; this.persist(); return true;
  },
  // Compatibility with the earlier bridge should an older frame emit it.
  drop(id) { return this.result(id, { contact: true }); },
  clear() {
    this.clearedAt = Date.now();
    for (const s of this.all()) this.rememberOutcome(s.id, { contact: true });
    for (const [id] of this.outcomes) this.outcomes.set(id, { contact: true, reason: null });
    this.mem = []; this.captureError = null;
    try { localStorage.removeItem(this.KEY); this.storage = 'saved'; this.error = null; return true; }
    catch (e) { this.storage = 'memory'; this.error = String(e && e.message || e); return false; }
  },
  get(id) { return this.all().find(s => String(s.id) === String(id)) || null; },
  misses() { return ZoneStats.all().filter(a => !a.contact && !a.training).length; }
};
