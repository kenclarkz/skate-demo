// Multiplayer networking: WebRTC data channels for peer-to-peer state sync,
// with a WebSocket signaling server for session discovery and WebRTC handshake.
//
// The server never sees game traffic — once the data channel is open, all
// gameplay state flows peer-to-peer. State is sent at a fixed rate (20 Hz)
// and the renderer interpolates between snapshots on the receiving end.

const DEFAULT_SIGNAL_URL = `ws://${location.hostname}:8081`;
const SYNC_RATE = 20;           // state updates per second
const SYNC_INTERVAL = 1000 / SYNC_RATE;
const MAX_PEERS = 7;            // max remote players per session
const STALE_TIMEOUT = 5000;     // ms before a silent peer is considered gone

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * Encoded player state — kept flat for minimal serialization cost.
 * All values are finite numbers; the receiver never needs to guard.
 *
 * Layout (Float32Array):
 *  0  x         position
 *  1  y
 *  2  z
 *  3  yaw       heading
 *  4  lean       board lean
 *  5  speed      scalar ground speed
 *  6  mode       GROUND=0 AIR=1 GRIND=2 BAIL=3
 *  7  flags      bitfield: 0=pushing 1=sliding 2=manual 3=charging
 *  8  flip       board flip rotation (radians)
 *  9  shuv       board shuv rotation (radians)
 * 10  pitch      board pitch rotation (radians)
 * 11  crouch     crouch depth (0..1)
 * 12  balance    balance meter
 * 13  airHeight  height above ground
 * 14  score      combo / session score
 * 15  reserved
 */
const STATE_FLOATS = 16;

/** Build a Float32Array snapshot from the local ride state. */
export function encodeState(ride) {
  const buf = new Float32Array(STATE_FLOATS);
  buf[0] = ride.pos.x;
  buf[1] = ride.pos.y;
  buf[2] = ride.pos.z;
  buf[3] = ride.yaw;
  buf[4] = ride.lean;
  buf[5] = ride.speed;
  buf[6] = ride.mode;
  let flags = 0;
  if (ride.push >= 0) flags |= 1;
  if (ride.sliding) flags |= 2;
  if (ride.manual) flags |= 4;
  if (ride.charge > 0) flags |= 8;
  buf[7] = flags;
  buf[8] = ride.state ? ride.state.flip : 0;
  buf[9] = ride.state ? ride.state.shuv : 0;
  buf[10] = ride.state ? ride.state.pitch : 0;
  buf[11] = ride.charge;
  buf[12] = ride.balance;
  buf[13] = ride.airHeight;
  buf[14] = 0; // score placeholder
  buf[15] = 0;
  return buf;
}

/** Decode a Float32Array snapshot into a plain object for interpolation. */
export function decodeState(buf) {
  return {
    x: buf[0], y: buf[1], z: buf[2],
    yaw: buf[3], lean: buf[4], speed: buf[5],
    mode: buf[6], flags: buf[7],
    flip: buf[8], shuv: buf[9], pitch: buf[10],
    crouch: buf[11], balance: buf[12], airHeight: buf[13],
    score: buf[14],
  };
}

/**
 * Interpolate two decoded states. `t` is 0..1 between `a` (past) and `b`
 * (future). Angles are interpolated via shortest path.
 */
export function lerpState(a, b, t) {
  const s = {};
  s.x = a.x + (b.x - a.x) * t;
  s.y = a.y + (b.y - a.y) * t;
  s.z = a.z + (b.z - a.z) * t;
  // Shortest-path yaw interpolation.
  let dy = b.yaw - a.yaw;
  if (dy > Math.PI) dy -= Math.PI * 2;
  if (dy < -Math.PI) dy += Math.PI * 2;
  s.yaw = a.yaw + dy * t;
  s.lean = a.lean + (b.lean - a.lean) * t;
  s.speed = a.speed + (b.speed - a.speed) * t;
  s.mode = b.mode; // discrete — snap to latest
  s.flags = b.flags;
  s.flip = a.flip + (b.flip - a.flip) * t;
  s.shuv = a.shuv + (b.shuv - a.shuv) * t;
  s.pitch = a.pitch + (b.pitch - a.pitch) * t;
  s.crouch = a.crouch + (b.crouch - a.crouch) * t;
  s.balance = a.balance + (b.balance - a.balance) * t;
  s.airHeight = a.airHeight + (b.airHeight - a.airHeight) * t;
  s.score = b.score;
  return s;
}

// --- remote peer state -----------------------------------------------------
/** @typedef {{ state: decodedState, ts: number, name: string, look: object }} RemotePeer */

export class Multiplayer {
  constructor() {
    /** @type {WebSocket|null} */
    this.ws = null;
    /** @type {string} */
    this.peerId = '';
    /** @type {string} */
    this.sessionId = '';
    /** @type {string} */
    this.friendCode = '';
    /** @type {'disconnected'|'connecting'|'connected'|'in-session'} */
    this.status = 'disconnected';
    /** @type {string} */
    this.parkId = 'home';
    /** @type {Map<string, RTCPeerConnection>} */
    this.connections = new Map();
    /** @type {Map<string, RTCDataChannel>} */
    this.channels = new Map();
    /** @type {Map<string, RemotePeer>} */
    this.peers = new Map();
    /** @type {function|null} */
    this.onStatusChange = null;
    /** @type {function|null} */
    this.onPeersChange = null;
    /** @type {function|null} */
    this.onParkChange = null;
    /** @type {function|null} */
    this.onChat = null;
    /** @type {number} */
    this._syncTimer = 0;
    /** @type {ArrayBuffer|null} encoded state cached between syncs */
    this._cachedState = null;
    /** @type {string} player name for display */
    this.playerName = 'Skater';
    /** @type {object} player look data */
    this.playerLook = null;
    /** @type {function|null} called when a peer sends chat */
    this.onPeerChat = null;
  }

  _setStatus(s) {
    this.status = s;
    this.onStatusChange?.(s);
  }

  _notifyPeers() {
    const list = [];
    for (const [id, p] of this.peers) {
      list.push({ id, name: p.name, look: p.look, state: p.state });
    }
    this.onPeersChange?.(list);
  }

  // --- signaling connection ------------------------------------------------
  connect(url = DEFAULT_SIGNAL_URL) {
    if (this.ws) return;
    this._setStatus('connecting');
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this._setStatus('connected');
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this._handleSignal(msg);
    };

    ws.onclose = () => {
      this.ws = null;
      this._cleanup();
      this._setStatus('disconnected');
    };

    ws.onerror = () => {
      this.ws = null;
      this._cleanup();
      this._setStatus('disconnected');
    };
  }

  disconnect() {
    if (this.ws) {
      this.send({ type: 'leave' });
      this.ws.close();
    }
    this._cleanup();
  }

  _cleanup() {
    for (const [, pc] of this.connections) pc.close();
    this.connections.clear();
    this.channels.clear();
    this.peers.clear();
    this.sessionId = '';
    this.friendCode = '';
    this._cachedState = null;
    this._notifyPeers();
  }

  // --- session management --------------------------------------------------
  createSession(parkId = 'home') {
    this.parkId = parkId;
    this.send({ type: 'create', parkId });
  }

  joinSession(sessionId) {
    this.send({ type: 'join', sessionId });
  }

  joinByFriendCode(code) {
    this.send({ type: 'join', friendCode: code.toUpperCase() });
  }

  findRandomMatch(parkId = 'home') {
    this.parkId = parkId;
    this.send({ type: 'match', parkId });
  }

  leaveSession() {
    this.send({ type: 'leave' });
    this._cleanup();
    this._setStatus('connected');
  }

  setPark(parkId) {
    this.parkId = parkId;
    this.send({ type: 'set-park', parkId });
  }

  listSessions() {
    this.send({ type: 'list-sessions' });
  }

  setPlayerInfo(name, look) {
    this.playerName = name;
    this.playerLook = look;
  }

  sendChat(text) {
    if (!text || !text.trim()) return;
    const msg = JSON.stringify({ type: 'chat', text: text.slice(0, 200) });
    for (const [, ch] of this.channels) {
      if (ch.readyState === 'open') ch.send(msg);
    }
  }

  // --- signaling handler ---------------------------------------------------
  _handleSignal(msg) {
    switch (msg.type) {
      case 'created':
      case 'joined':
      case 'matched':
      case 'queued':
        this.peerId = msg.peerId;
        this.sessionId = msg.sessionId;
        this.friendCode = msg.friendCode;
        this.parkId = msg.parkId;
        this._setStatus('in-session');
        // Initiate connections to all existing peers.
        if (msg.peers) {
          for (const pid of msg.peers) {
            this._createOffer(pid);
          }
        }
        this._notifyPeers();
        break;

      case 'peer-joined':
        // A new peer arrived; they will initiate the offer — we wait.
        break;

      case 'peer-left':
        this._removePeer(msg.peerId);
        break;

      case 'park-changed':
        this.parkId = msg.parkId;
        this.onParkChange?.(msg.parkId);
        break;

      case 'session-list':
        this.onSessionList?.(msg.sessions);
        break;

      case 'signal':
        this._handleWebRTCSignal(msg);
        break;

      case 'error':
        console.warn('Signaling error:', msg.error);
        break;
    }
  }

  // --- WebRTC connection management ----------------------------------------
  _getOrCreateConnection(peerId, initiator) {
    if (this.connections.has(peerId)) return this.connections.get(peerId);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.connections.set(peerId, pc);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.send({ type: 'signal', to: peerId, candidate: e.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this._removePeer(peerId);
      }
    };

    if (initiator) {
      const ch = pc.createDataChannel('skate', { ordered: false, maxRetransmits: 0 });
      this._setupChannel(ch, peerId);
    } else {
      pc.ondatachannel = (e) => {
        this._setupChannel(e.channel, peerId);
      };
    }

    return pc;
  }

  _setupChannel(ch, peerId) {
    ch.binaryType = 'arraybuffer';
    this.channels.set(peerId, ch);

    ch.onopen = () => {
      // Send our identity.
      ch.send(JSON.stringify({ type: 'identity', name: this.playerName, look: this.playerLook }));
      this._notifyPeers();
    };

    ch.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        // Binary state update.
        const p = this.peers.get(peerId);
        if (p) {
          p.state = decodeState(new Float32Array(e.data));
          p.ts = performance.now();
        }
      } else {
        // JSON control message.
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === 'identity') {
          const p = this.peers.get(peerId) || { state: null, ts: 0, name: msg.name, look: msg.look };
          p.name = msg.name;
          p.look = msg.look;
          p.ts = performance.now();
          this.peers.set(peerId, p);
          this._notifyPeers();
        } else if (msg.type === 'chat') {
          this.onPeerChat?.(peerId, msg.text);
        }
      }
    };

    ch.onclose = () => {
      this._removePeer(peerId);
    };
  }

  async _createOffer(peerId) {
    const pc = this._getOrCreateConnection(peerId, true);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.send({ type: 'signal', to: peerId, sdp: pc.localDescription });
    } catch (e) {
      console.warn('Failed to create offer:', e);
    }
  }

  async _handleWebRTCSignal(msg) {
    const peerId = msg.from;
    if (msg.candidate) {
      const pc = this.connections.get(peerId);
      if (pc) {
        try { await pc.addIceCandidate(msg.candidate); } catch {}
      }
      return;
    }
    if (msg.sdp) {
      const pc = this._getOrCreateConnection(peerId, false);
      try {
        await pc.setRemoteDescription(msg.sdp);
        if (msg.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.send({ type: 'signal', to: peerId, sdp: pc.localDescription });
        }
      } catch (e) {
        console.warn('Failed to handle signaling:', e);
      }
    }
  }

  _removePeer(peerId) {
    const ch = this.channels.get(peerId);
    if (ch) ch.close();
    this.channels.delete(peerId);
    const pc = this.connections.get(peerId);
    if (pc) pc.close();
    this.connections.delete(peerId);
    this.peers.delete(peerId);
    this._notifyPeers();
  }

  // --- state sync ----------------------------------------------------------
  send(buf) {
    if (this.ws && this.ws.readyState === 1) {
      if (buf instanceof ArrayBuffer || buf instanceof Float32Array) {
        this.ws.send(buf);
      } else {
        this.ws.send(JSON.stringify(buf));
      }
    }
  }

  /**
   * Send local state to all peers. Call once per frame from the game loop;
   // the method rate-limits internally to SYNC_RATE Hz.
   * @param {Float32Array} state encoded ride state
   * @param {number} dt frame delta in seconds
   */
  sync(state, dt) {
    this._syncTimer += dt;
    if (this._syncTimer < SYNC_INTERVAL / 1000) return;
    this._syncTimer = 0;

    this._cachedState = state.buffer;
    for (const [, ch] of this.channels) {
      if (ch.readyState === 'open') {
        ch.send(this._cachedState);
      }
    }
  }

  /**
   * Prune peers that have been silent too long.
   * @param {number} dt frame delta in seconds
   */
  pruneStale(dt) {
    const now = performance.now();
    let changed = false;
    for (const [id, p] of this.peers) {
      if (p.ts && now - p.ts > STALE_TIMEOUT) {
        this._removePeer(id);
        changed = true;
      }
    }
    if (changed) this._notifyPeers();
  }

  /** Number of active peer connections. */
  get peerCount() {
    return this.peers.size;
  }

  /** Whether we are in a session. */
  get inSession() {
    return this.status === 'in-session';
  }
}

// Singleton instance shared across the game.
export const multiplayer = new Multiplayer();
