// Multiplayer UI: lobby, session management, friend code entry, and the
// in-game player list. Pure DOM, following the same pattern as hud.js.

import { multiplayer, Multiplayer } from './multiplayer.js';

export class MultiplayerUI {
  constructor() {
    this.screenEl = document.getElementById('screen-multiplayer');
    this.peerListEl = document.getElementById('mp-peer-list');
    this.statusEl = document.getElementById('mp-status');
    this.friendCodeEl = document.getElementById('mp-friend-code');
    this.codeInputEl = document.getElementById('mp-code-input');
    this.chatLogEl = document.getElementById('mp-chat-log');
    this.chatInputEl = document.getElementById('mp-chat-input');
    this.sessionListEl = document.getElementById('mp-session-list');
    this.lobbySessionEl = document.getElementById('mp-ingame-panel');
    this.inGameListEl = document.getElementById('mp-ingame-list');
    this.inGameOverlayEl = document.getElementById('mp-ingame-overlay');
    this.connectionDotEl = document.getElementById('mp-ingame-dot');
    this.serverUrlEl = document.getElementById('mp-server-url');

    /** @type {function|null} */
    this.onBack = null;
    /** @type {function|null} */
    this.onCreateSession = null;
    /** @type {function|null} */
    this.onFindMatch = null;
    /** @type {function|null} */
    this.onJoinCode = null;
    /** @type {function|null} */
    this.onLeaveSession = null;
    /** @type {function|null} */
    this.onSendChat = null;
    /** @type {function|null} */
    this.onJoinSession = null;
    /** @type {function|null} */
    this.onStartGame = null;

    this._refreshTimer = null;
    this._bind();
  }

  _bind() {
    const click = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);

    click('btn-mp-back', () => this.onBack?.());
    click('btn-mp-create', () => this.onCreateSession?.());
    click('btn-mp-match', () => this.onFindMatch?.());
    click('btn-mp-join-code', () => {
      const code = this.codeInputEl?.value?.trim().toUpperCase();
      if (code) this.onJoinCode?.(code);
    });
    click('btn-mp-leave', () => this.onLeaveSession?.());
    click('btn-mp-start', () => this.onStartGame?.());
    click('btn-mp-send', () => this._sendChat());

    this.chatInputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._sendChat();
      e.stopPropagation(); // prevent game input while typing
    });

    // Prevent game input while typing in the code input.
    this.codeInputEl?.addEventListener('keydown', (e) => e.stopPropagation());

    // Server URL input: save on change.
    if (this.serverUrlEl) {
      this.serverUrlEl.value = Multiplayer.getSignalUrl();
      this.serverUrlEl.addEventListener('change', () => {
        Multiplayer.setSignalUrl(this.serverUrlEl.value.trim());
      });
      this.serverUrlEl.addEventListener('keydown', (e) => e.stopPropagation());
    }
  }

  _sendChat() {
    const text = this.chatInputEl?.value?.trim();
    if (text) {
      this.onSendChat?.(text);
      this.chatInputEl.value = '';
    }
  }

  _updateStatus(status) {
    if (this.statusEl) this.statusEl.textContent = status;
    if (this.connectionDotEl) {
      this.connectionDotEl.className = 'mp-dot ' + (
        status === 'in-session' ? 'mp-dot-green' :
        status === 'connected' ? 'mp-dot-yellow' :
        status === 'connecting' ? 'mp-dot-orange' : 'mp-dot-red'
      );
    }
    // Show/hide session controls in the lobby.
    const inSession = multiplayer.inSession;
    if (this.friendCodeEl) this.friendCodeEl.hidden = !inSession;
    if (this.lobbySessionEl) this.lobbySessionEl.hidden = !inSession;
    // Update the in-game overlay.
    if (this.inGameOverlayEl) this.inGameOverlayEl.hidden = !inSession;
  }

  _updatePeerList(peers) {
    if (!this.peerListEl) return;
    this.peerListEl.innerHTML = '';
    for (const p of peers) {
      const li = document.createElement('li');
      li.className = 'mp-peer';
      li.textContent = p.name || 'Skater';
      this.peerListEl.appendChild(li);
    }
    // Update the in-game overlay list too.
    if (this.inGameListEl) {
      this.inGameListEl.innerHTML = '';
      for (const p of peers) {
        const span = document.createElement('span');
        span.className = 'mp-ingame-name';
        span.textContent = p.name || 'Skater';
        this.inGameListEl.appendChild(span);
      }
    }
    // Update connection dot.
    if (this.connectionDotEl) {
      this.connectionDotEl.className = 'mp-dot ' + (
        peers.length > 0 ? 'mp-dot-green' :
        multiplayer.inSession ? 'mp-dot-yellow' : 'mp-dot-red'
      );
    }
  }

  _addChatLine(peerId, text) {
    if (!this.chatLogEl) return;
    const peer = multiplayer.peers.get(peerId);
    const name = peer?.name || '???';
    const div = document.createElement('div');
    div.className = 'mp-chat-line';
    div.innerHTML = `<b>${this._esc(name)}</b> ${this._esc(text)}`;
    this.chatLogEl.appendChild(div);
    this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
  }

  addSystemLine(text) {
    if (!this.chatLogEl) return;
    const div = document.createElement('div');
    div.className = 'mp-chat-line mp-chat-system';
    div.textContent = text;
    this.chatLogEl.appendChild(div);
    this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
  }

  _renderSessionList(sessions) {
    if (!this.sessionListEl) return;
    this.sessionListEl.innerHTML = '';
    if (!sessions || sessions.length === 0) {
      const p = document.createElement('p');
      p.className = 'mp-empty';
      p.textContent = 'No open sessions. Create one!';
      this.sessionListEl.appendChild(p);
      return;
    }
    for (const s of sessions) {
      const div = document.createElement('div');
      div.className = 'mp-session-card';
      div.innerHTML = `
        <span class="mp-session-park">${this._esc(s.parkId)}</span>
        <span class="mp-session-players">${s.peers}/${s.maxPeers} players</span>
        <button class="mp-session-join" data-sid="${this._esc(s.sessionId)}">Join</button>
      `;
      div.querySelector('.mp-session-join')?.addEventListener('click', () => {
        this.onJoinSession?.(s.sessionId);
      });
      this.sessionListEl.appendChild(div);
    }
  }

  /** Set the friend code display after creating or joining a session. */
  setFriendCode(code) {
    if (this.friendCodeEl) {
      this.friendCodeEl.hidden = false;
      const codeDisplay = this.friendCodeEl.querySelector('.mp-code-display');
      if (codeDisplay) codeDisplay.textContent = code;
    }
  }

  /** Show the lobby screen. */
  show() {
    if (this.screenEl) this.screenEl.hidden = false;
    this._updateStatus(multiplayer.status);
    // Request available sessions.
    if (multiplayer.ws?.readyState === 1) multiplayer.listSessions();
    // Auto-refresh the session list every 5 seconds while the lobby is open.
    this._stopRefresh();
    this._refreshTimer = setInterval(() => {
      if (multiplayer.ws?.readyState === 1) multiplayer.listSessions();
    }, 5000);
  }

  /** Hide the lobby screen. */
  hide() {
    if (this.screenEl) this.screenEl.hidden = true;
    this._stopRefresh();
  }

  _stopRefresh() {
    if (this._refreshTimer != null) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  /** Show/hide the in-game player list overlay. */
  setInGameVisible(visible) {
    if (this.inGameOverlayEl) this.inGameOverlayEl.hidden = !visible || !multiplayer.inSession;
  }

  /** Show an error message in the chat log. */
  showError(text) {
    if (!this.chatLogEl) return;
    const div = document.createElement('div');
    div.className = 'mp-chat-line mp-chat-system mp-chat-error';
    div.textContent = text;
    this.chatLogEl.appendChild(div);
    this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
  }

  _esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
}
