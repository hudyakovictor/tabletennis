/* Calibration miss gallery. The key and legacy record format are the ones
 * used by the earlier gallery, so existing local screenshots remain visible.
 * A failed localStorage write must never make the in-memory list disappear. */
const MissShots = {
  KEY: 'ttu-miss-shots', MAX: 40, mem: null, storage: 'unknown', error: null, captureError: null,
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
  add(s) {
    if (!s || s.id == null || typeof s.img !== 'string' || s.img.length > 2000000 || !/^[a-zA-Z0-9+/=]+$/.test(s.img)) return false;
    const entries = this.all().filter(x => String(x.id) !== String(s.id));
    entries.push(s); this.mem = entries.slice(-this.MAX); this.captureError = null;
    this.persist(); return true;
  },
  result(id, outcome) {
    const entries = this.all(); const i = entries.findIndex(x => String(x.id) === String(id));
    if (i < 0) return false;
    if (outcome && outcome.contact) entries.splice(i, 1);
    else entries[i] = { ...entries[i], status: 'miss', reason: outcome && outcome.reason || null };
    this.mem = entries; this.persist(); return true;
  },
  // Compatibility with the earlier bridge should an older frame emit it.
  drop(id) { return this.result(id, { contact: true }); },
  clear() {
    this.mem = []; this.captureError = null;
    try { localStorage.removeItem(this.KEY); this.storage = 'saved'; this.error = null; return true; }
    catch (e) { this.storage = 'memory'; this.error = String(e && e.message || e); return false; }
  },
  get(id) { return this.all().find(s => String(s.id) === String(id)) || null; },
  misses() { return ZoneStats.all().filter(a => !a.contact && !a.training).length; }
};
