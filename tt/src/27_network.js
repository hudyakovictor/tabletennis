/* =====================================================================
 *  NETWORK — Online multiplayer with opponent racket visibility.
 *
 *  Architecture: WebSocket relay server. One player hosts (simulates
 *  physics), the other is a guest (receives ball+racket state).
 *  Both see each other's racket in real-time.
 *
 *  Protocol:
 *    Client → Server:  { type: 'join', room? }
 *    Server → Client:  { type: 'assigned', side, room, peerId }
 *    Host → Server:    { type: 'state', ball:{p,v,w}, racket:{pos,normal,anim}, score, rally }
 *    Server → Guest:   { type: 'state', ... }  (relayed from host)
 *    Guest → Server:   { type: 'input', racket:{pos,normal,anim} }
 *    Server → Host:    { type: 'input', ... }  (relayed from guest)
 *    Either → Server:  { type: 'point', who, reason }
 *    Server → Both:    { type: 'point', who, reason }
 * ===================================================================== */
'use strict';

const NET_SERVER_URL = 'wss://topspin-relay.fly.dev';  // configurable
const NET_TICK_RATE = 20;        // Hz — state updates per second
const NET_INPUT_RATE = 30;       // Hz — input updates per second
const NET_INTERP_MS = 80;        // interpolation buffer in ms

class NetworkManager {
  constructor(game) {
    this.game = game;
    this.ws = null;
    this.connected = false;
    this.room = null;
    this.side = 0;              // +1 = host (near), -1 = guest (far)
    this.peerId = null;
    this.isHost = false;
    this.state = 'OFFLINE';     // OFFLINE CONNECTING LOBBY WAITING IN_MATCH DISCONNECTED
    this.latency = 0;
    this._pingT = 0;
    this._lastStateT = 0;
    this._lastInputT = 0;
    this._interpBuf = [];       // ring buffer for interpolation
    this._interpIdx = 0;
    this._opponentRacket = {
      pos: V3.new(0, PH.TABLE_Y + 0.25, -1.45),
      normal: V3.new(0, 0, 1),
      anim: { swing: 0, windup: 0, lean: 0 },
    };
    this._opponentScore = 0;
    this._lastServerBall = null;
    this._callbacks = {};
  }

  on(event, cb) { this._callbacks[event] = cb; }
  _emit(event, data) { if (this._callbacks[event]) this._callbacks[event](data); }

  connect(url) {
    if (this.ws) this.disconnect();
    this.state = 'CONNECTING';
    // the relay is not part of the bundle: it is chosen per page load
    // (?net=wss://your.host) or falls back to the default deployment
    let target = url;
    if (!target) {
      try {
        const q = new URLSearchParams(location.search).get('net');
        if (q) target = q;
      } catch (e) { /* no query string available */ }
    }
    try {
      this.ws = new WebSocket(target || NET_SERVER_URL);
    } catch(e) {
      this.state = 'DISCONNECTED';
      this._emit('error', 'Не удалось подключиться');
      return;
    }
    const socket = this.ws;
    this.ws.onopen = () => {
      if (this.ws !== socket) return;
      this.connected = true;
      this.state = 'LOBBY';
      this._emit('connected', {});
      this._startPing();
    };
    this.ws.onmessage = (ev) => {
      if (this.ws !== socket) return;
      try { this._handle(JSON.parse(ev.data)); } catch(e) {}
    };
    this.ws.onclose = () => {
      if (this.ws !== socket) return;
      this._stopPing();
      this.ws = null;
      this._resetSession();
      this.connected = false;
      if (this.state === 'IN_MATCH') this.state = 'DISCONNECTED';
      else this.state = 'OFFLINE';
      this._emit('disconnected', {});
    };
    this.ws.onerror = () => {
      if (this.ws !== socket) return;
      this.state = 'DISCONNECTED';
      this._emit('error', 'Ошибка соединения');
    };
  }

  disconnect() {
    this._stopPing();
    const socket = this.ws;
    this.ws = null;
    if (socket) socket.close();
    this._resetSession();
    this.connected = false;
    this.state = 'OFFLINE';
    this.room = null;
    this.side = 0;
  }

  _resetSession() {
    this.room = null; this.side = 0; this.peerId = null; this.isHost = false;
    this._interpBuf.length = 0;
    this._lastServerBall = null;
    this._lastStateT = this._lastInputT = 0;
  }

  joinRoom(roomId) {
    if (!this.connected) return;
    this.state = 'WAITING';
    this._send({ type: 'join', room: roomId || undefined });
  }

  leaveRoom() {
    this._send({ type: 'leave' });
    this._resetSession();
    this.state = this.connected ? 'LOBBY' : 'OFFLINE';
  }

  /* ---- message handler ---- */
  _handle(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    switch (msg.type) {
      case 'assigned':
        this.room = msg.room;
        this.side = msg.side;
        this.peerId = msg.peerId;
        this.isHost = msg.side === 1;
        this._emit('assigned', msg);
        break;
      case 'ready':
        this.state = 'IN_MATCH';
        this._emit('matchStart', { side: this.side });
        break;
      case 'state':
        // received from host (we are guest)
        if (!this.isHost) this._applyRemoteState(msg);
        break;
      case 'input':
        // received from guest (we are host)
        if (this.isHost) this._applyRemoteInput(msg);
        break;
      case 'point':
        this._emit('point', msg);
        break;
      case 'peer_left':
        if (msg.roomClosed) this._resetSession();
        this.state = 'LOBBY';
        this._emit('peerLeft', {});
        break;
      case 'pong':
        this.latency = Date.now() - this._pingT;
        break;
      case 'error':
        if (this.state === 'WAITING') this.state = 'LOBBY';
        this._emit('error', msg.message || 'Server error');
        break;
    }
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  _startPing() {
    this._stopPing();
    this._pingInterval = setInterval(() => {
      if (this.connected) {
        this._pingT = Date.now();
        this._send({ type: 'ping' });
      } else {
        this._stopPing();
      }
    }, 2000);
  }
  _stopPing() {
    if (this._pingInterval) { clearInterval(this._pingInterval); this._pingInterval = null; }
  }

  /* ---- host: send game state to server ---- */
  sendGameState() {
    if (!this.isHost || this.state !== 'IN_MATCH') return;
    const now = Date.now();
    if (now - this._lastStateT < 1000 / NET_TICK_RATE) return;
    this._lastStateT = now;
    const g = this.game;
    const b = g.ball;
    const pad = g.player;
    this._send({
      type: 'state',
      t: g.time,
      ball: b.live ? { p: [b.p.x, b.p.y, b.p.z], v: [b.v.x, b.v.y, b.v.z], w: [b.w.x, b.w.y, b.w.z] } : null,
      racket: { pos: [pad.pos.x, pad.pos.y, pad.pos.z], n: [pad.normal.x, pad.normal.y, pad.normal.z], sw: pad.swing },
      score: g.score.slice(),
      rally: g.rally,
      shotId: g.shotId,
    });
  }

  /* ---- guest: send input (racket position + normal) to server ---- */
  sendInput() {
    if (this.isHost || this.state !== 'IN_MATCH') return;
    const now = Date.now();
    if (now - this._lastInputT < 1000 / NET_INPUT_RATE) return;
    this._lastInputT = now;
    const pad = this.game.player;
    this._send({
      type: 'input',
      pos: [pad.pos.x, pad.pos.y, pad.pos.z],
      n: [pad.normal.x, pad.normal.y, pad.normal.z],
      sw: pad.swing,
    });
  }

  /* ---- guest: apply host state (interpolated) ---- */
  _applyRemoteState(msg) {
    if (!this._validState(msg)) return;
    this._interpBuf.push({ ...msg, receivedAt: Date.now() });
    if (this._interpBuf.length > 30) this._interpBuf.shift();
    // apply ball immediately (prediction handles smoothing)
    if (msg.ball) {
      const b = this.game.ball;
      const bp = msg.ball.p, bv = msg.ball.v, bw = msg.ball.w;
      // smooth lerp toward server state (corrects drift)
      const k = 0.35;
      if (b.live) {
        b.p.x = lerp(b.p.x, bp[0], k); b.p.y = lerp(b.p.y, bp[1], k); b.p.z = lerp(b.p.z, bp[2], k);
        b.v.x = lerp(b.v.x, bv[0], k); b.v.y = lerp(b.v.y, bv[1], k); b.v.z = lerp(b.v.z, bv[2], k);
      } else {
        V3.set(b.p, bp[0], bp[1], bp[2]); V3.set(b.v, bv[0], bv[1], bv[2]);
        V3.set(b.w, bw[0], bw[1], bw[2]);
        b.live = true;
      }
      V3.set(b.w, bw[0], bw[1], bw[2]);
    } else {
      this.game.ball.live = false;
    }
    // apply opponent racket (for rendering)
    if (msg.racket) {
      const op = this._opponentRacket;
      const rp = msg.racket.pos, rn = msg.racket.n;
      V3.set(op.pos, rp[0], rp[1], rp[2]);
      V3.set(op.normal, rn[0], rn[1], rn[2]);
      op.anim.swing = msg.racket.sw || 0;
    }
    // sync score
    if (msg.score) this.game.score = msg.score.slice();
  }

  /* ---- host: apply guest input ---- */
  _applyRemoteInput(msg) {
    if ((msg.pos && !this._vector(msg.pos)) || (msg.n && !this._vector(msg.n)) ||
        (msg.sw !== undefined && (!Number.isFinite(msg.sw) || Math.abs(msg.sw) > 10))) return;
    const op = this._opponentRacket;
    if (msg.pos) V3.set(op.pos, msg.pos[0], msg.pos[1], msg.pos[2]);
    if (msg.n) V3.set(op.normal, msg.n[0], msg.n[1], msg.n[2]);
    if (msg.sw !== undefined) op.anim.swing = msg.sw;
  }

  _vector(v) {
    return Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) <= 10000);
  }
  _validState(msg) {
    if (msg.ball && ![msg.ball.p, msg.ball.v, msg.ball.w].every(v => this._vector(v))) return false;
    if (msg.racket && (!this._vector(msg.racket.pos) || !this._vector(msg.racket.n) ||
        (msg.racket.sw !== undefined && !Number.isFinite(msg.racket.sw)))) return false;
    if (msg.score && (!Array.isArray(msg.score) || msg.score.length !== 2 ||
        !msg.score.every(n => Number.isInteger(n) && n >= 0 && n < 100000))) return false;
    return true;
  }

  get opponentRacket() { return this._opponentRacket; }
  get isConnected() { return this.connected; }
  get isInMatch() { return this.state === 'IN_MATCH'; }
}