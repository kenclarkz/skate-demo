// WebSocket signaling server for Skate multiplayer.
//
// Handles session creation/joining, friend codes, random matchmaking, and
// WebRTC signaling (SDP offers/answers and ICE candidates). The server never
// sees game traffic — once a WebRTC data channel is open, all gameplay state
// flows peer-to-peer.
//
// Usage:
//   node server.js                  # default port 8081
//   PORT=3000 node server.js        # custom port
//
// Requires: node >= 18 (built-in WebSocketServer).
// No npm dependencies.

import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8081;

// --- session state ---------------------------------------------------------
/** @type {Map<string, Session>} */
const sessions = new Map();
/** @type {Map<string, string>} friendCode → sessionId */
const friendCodes = new Map();
/** @type {Set<string>} sessionIds waiting for a random match */
const matchQueue = new Set();

/** Generate a short alphanumeric code for friend invites. */
function makeFriendCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return friendCodes.has(code) ? makeFriendCode() : code;
}

/** Generate a session id. */
function makeSessionId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * @typedef {Object} Session
 * @property {string} id
 * @property {string} friendCode
 * @property {string} hostId
 * @property {Map<string, import('ws').WebSocket>} peers
 * @property {string} parkId
 * @property {number} maxPeers
 */

function createSession(hostWs, hostId, parkId = 'home') {
  const id = makeSessionId();
  const friendCode = makeFriendCode();
  /** @type {Session} */
  const session = {
    id,
    friendCode,
    hostId,
    peers: new Map([[hostId, hostWs]]),
    parkId,
    maxPeers: 8,
  };
  sessions.set(id, session);
  friendCodes.set(friendCode, id);
  return session;
}

function removePeer(session, peerId) {
  session.peers.delete(peerId);
  if (session.peers.size === 0) {
    sessions.delete(session.id);
    friendCodes.delete(session.friendCode);
    matchQueue.delete(session.id);
  }
}

function broadcast(session, msg, excludeId) {
  const data = JSON.stringify(msg);
  for (const [id, ws] of session.peers) {
    if (id !== excludeId && ws.readyState === 1) ws.send(data);
  }
}

// --- WebSocket server ------------------------------------------------------
const wss = new WebSocketServer({ port: PORT });
console.log(`Skate signaling server listening on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  let peerId = null;
  let session = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'create': {
        peerId = msg.peerId || Math.random().toString(36).slice(2, 10);
        session = createSession(ws, peerId, msg.parkId);
        matchQueue.delete(session.id);
        ws.send(JSON.stringify({
          type: 'created',
          sessionId: session.id,
          friendCode: session.friendCode,
          peerId,
          parkId: session.parkId,
        }));
        break;
      }

      case 'join': {
        // Join by session id or friend code.
        let targetId = msg.sessionId;
        if (msg.friendCode) targetId = friendCodes.get(msg.friendCode);
        if (!targetId || !sessions.has(targetId)) {
          ws.send(JSON.stringify({ type: 'error', error: 'Session not found' }));
          return;
        }
        session = sessions.get(targetId);
        if (session.peers.size >= session.maxPeers) {
          ws.send(JSON.stringify({ type: 'error', error: 'Session full' }));
          return;
        }
        peerId = msg.peerId || Math.random().toString(36).slice(2, 10);
        // Tell existing peers about the newcomer.
        broadcast(session, { type: 'peer-joined', peerId, parkId: session.parkId });
        session.peers.set(peerId, ws);
        ws.send(JSON.stringify({
          type: 'joined',
          sessionId: session.id,
          friendCode: session.friendCode,
          peerId,
          parkId: session.parkId,
          peers: [...session.peers.keys()].filter((id) => id !== peerId),
        }));
        break;
      }

      case 'match': {
        // Random matchmaking: join an open session or create one and wait.
        peerId = msg.peerId || Math.random().toString(36).slice(2, 10);
        const parkId = msg.parkId || 'home';
        // Try to find a waiting session on the same park.
        for (const sid of matchQueue) {
          const s = sessions.get(sid);
          if (s && s.parkId === parkId && s.peers.size < s.maxPeers) {
            matchQueue.delete(sid);
            session = s;
            broadcast(session, { type: 'peer-joined', peerId, parkId: session.parkId });
            session.peers.set(peerId, ws);
            ws.send(JSON.stringify({
              type: 'matched',
              sessionId: session.id,
              friendCode: session.friendCode,
              peerId,
              parkId: session.parkId,
              peers: [...session.peers.keys()].filter((id) => id !== peerId),
            }));
            return;
          }
        }
        // No match found — create a new session and queue it.
        session = createSession(ws, peerId, parkId);
        matchQueue.add(session.id);
        ws.send(JSON.stringify({
          type: 'queued',
          sessionId: session.id,
          friendCode: session.friendCode,
          peerId,
          parkId: session.parkId,
        }));
        break;
      }

      case 'signal': {
        // Forward WebRTC signaling to a specific peer.
        if (!session) return;
        const target = session.peers.get(msg.to);
        if (target && target.readyState === 1) {
          target.send(JSON.stringify({ type: 'signal', from: peerId, sdp: msg.sdp, candidate: msg.candidate }));
        }
        break;
      }

      case 'leave': {
        if (session) {
          broadcast(session, { type: 'peer-left', peerId });
          removePeer(session, peerId);
          session = null;
        }
        break;
      }

      case 'set-park': {
        if (session && peerId === session.hostId) {
          session.parkId = msg.parkId;
          broadcast(session, { type: 'park-changed', parkId: msg.parkId });
        }
        break;
      }

      case 'list-sessions': {
        const list = [];
        for (const [, s] of sessions) {
          list.push({
            sessionId: s.id,
            friendCode: s.friendCode,
            parkId: s.parkId,
            peers: s.peers.size,
            maxPeers: s.maxPeers,
          });
        }
        ws.send(JSON.stringify({ type: 'session-list', sessions: list }));
        break;
      }
    }
  });

  ws.on('close', () => {
    if (session && peerId) {
      broadcast(session, { type: 'peer-left', peerId });
      removePeer(session, peerId);
    }
  });

  ws.on('error', () => {
    if (session && peerId) {
      broadcast(session, { type: 'peer-left', peerId });
      removePeer(session, peerId);
    }
  });
});
