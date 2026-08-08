// Radio: a station picker with a live Spotify hook-in.
//
// The game ships with one station — the park's own synth speakers — and a
// player who connects their Spotify gets a real radio: their playlists appear
// in the same list, picking one hands playback to Spotify, and the game's own
// music ducks out of the way while a track is actually playing.
//
// The shape of that is worth keeping honest, so the file is split in two:
//
//   1. SpotifyProvider — everything that touches Spotify (the OAuth dance, the
//      Web Playback SDK, the track state). It is written against a small
//      interface so a second service — SoundCloud, a local library, a podcast
//      feed — is a new object that speaks the same five methods, not a rewrite
//      of the panel that hosts them.
//
//   2. Radio — the DOM half. It owns the Settings station picker (login,
//      playlists, song search), the tiny in-game bar with its scrolling track
//      name and skip buttons, the now-playing toast, and the little save +
//      duck-the-theme logic. It only ever calls the provider through that
//      interface, so it never needs to know how the current station streams.
//
// The one thing that is deliberately NOT Spotify-specific anywhere: stations
// are just `{ id, name, detail, uris }`. Spotify playlists happen to be the
// only real stations today, but "a station" is a list of URIs that can come
// from anywhere, and the saved `radioPlaylistId` stores exactly that id.

/** The redirect URIs the Spotify app must list. Production is always the
 *  GitHub Pages URL; development is the loopback IP Spotify now insists on
 *  (localhost aliases are rejected by the current redirect rules).
 *
 *  IMPORTANT: this repo (skate-demo) is served by GitHub Pages at
 *  /skate-demo/ — not /skate/. The redirect must match the live URL exactly,
 *  because Spotify bounces the player back there and any path that is not a
 *  real Pages site answers with "There isn't a GitHub Pages site here." */
const PROD_REDIRECT = 'https://kenclarkz.github.io/skate-demo/';
const DEV_REDIRECT = 'http://127.0.0.1:8080/';

// The station that is always there, whether or not anyone is signed in. When
// it is "playing", the toast says what it actually is: the park's speakers.
export const BUILTIN_STATION = {
  id: 'builtin',
  name: 'Skate FM',
  detail: 'The park’s own speakers',
  builtin: true,
};

// What the toast claims is playing while Skate FM is on. A track datum like any
// other, so the announce() path stays a single one.
const THEME_TRACK = { id: 'theme', name: 'The park’s own speakers', artists: ['Skate FM'] };

// --- Spotify plumbing -----------------------------------------------------
// The app is a static site, so there is nowhere safe to hide a secret; the
// PKCE flow (a verifier/challenge pair instead of a client secret) is what the
// docs prescribe for exactly this situation, and the token it trades for only
// ever lives in sessionStorage. The client id is public by design.
//
// That id must be a real Spotify app, or the authorization server answers the
// login attempt with a dead-end "client_id: Invalid" white page. To make the
// radio work you have to register your own app (Developer Dashboard → Create
// app), put its Client ID here, and list the game's URLs under the app's
// Redirect URIs — see the "Spotify radio" section of the README. The id below
// is not a registered app, so sign-in preflights it and says so in the panel
// instead of stranding the player on Spotify's error page.
const CLIENT_ID = 'c43d6dbf57104622919931948f2536df';

/** What a dead client id looks like to the player, instead of the white page. */
const CLIENT_ID_ERROR =
  'Spotify rejected this app’s client id (client_id: Invalid). The site ' +
  'owner must register a Spotify app and set its client id in js/skate/radio.js — see the README.';
const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_URL = 'https://api.spotify.com/v1';
const SCRIPT_URL = 'https://sdk.scdn.co/spotify-player.js'; // the Web Playback SDK
const DEVICE_MARGIN_MS = 3000;  // a brand-new SDK device takes a beat to wake up
const POLL_MS = 4000;           // SDK events go quiet when the tab idles; nudge it
const HIDE_TOAST_MS = 5000;     // a now-playing toast is a headline, not a sticker
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-modify-playback-state',
  'user-read-playback-state',
  'playlist-read-collaborative',
  'playlist-read-private',
];

/** The exact redirect URL the Spotify app must list. Production always
 *  resolves to the registered GitHub Pages URL; a local http server on 8080
 *  swaps in the loopback IP (localhost aliases are no longer accepted). */
function redirectUri() {
  const dev =
    location.port === '8080' &&
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  return dev ? DEV_REDIRECT : PROD_REDIRECT;
}

/**
 * A "now playing" datum. Spotify and the built-in theme both reduce to this:
 * `{ id, name, artists: [...] }`. `id` is the whole change signal — a track
 * only counts as new when its id differs from the last one reported.
 */
function trackFromSpotify(t) {
  if (!t) return null;
  return { id: t.id, name: t.name, artists: (t.artists || []).map((a) => a.name) };
}

// The Web Playback SDK is the only way to control a playback device from a
// page, but it only ships after auth and we do not want to fetch it for the
// many players who never connect Spotify. Loaded once, cached forever. The
// SDK calls `onSpotifyWebPlaybackSDKReady` synchronously as it finishes, so
// the handler has to be installed before the script tag goes in.
let sdkLoaded = null;
function loadSdk() {
  // Already here (a previous load, or the SDK finished arriving late).
  if (window.Spotify?.Player) return Promise.resolve();
  if (!sdkLoaded) {
    sdkLoaded = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_URL;
      s.async = true;
      window.onSpotifyWebPlaybackSDKReady = () => {
        console.log('[Spotify] Web Playback SDK script loaded.');
        resolve();
      };
      s.onerror = () => {
        window.onSpotifyWebPlaybackSDKReady = null;
        sdkLoaded = null;
        reject(new Error('Could not load the Spotify player SDK.'));
      };
      document.head.appendChild(s);
      // A loaded-but-silent SDK script (blocked by an extension, an offline
      // page, a broken CDN response) must fail loudly instead of hanging the
      // playlist click forever.
      setTimeout(() => {
        if (!window.Spotify) {
          window.onSpotifyWebPlaybackSDKReady = null;
          sdkLoaded = null;
          reject(new Error('The Spotify player SDK script loaded but never became ready.'));
        }
      }, 10_000);
    });
  }
  return sdkLoaded;
}

// sessionStorage keys are per-origin and survive reload but not a new tab —
// exactly the life we want for an access token, which should expire with the
// session, and for the PKCE verifier that has to survive one redirect hop.
const TOKEN_KEY = 'skate.spotify.token';
const VERIFIER_KEY = 'skate.spotify.verifier';
const STATE_KEY = 'skate.spotify.state';

function randomChars(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Base64Url(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let binary = '';
  for (const b of new Uint8Array(digest)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The provider interface, spelled out so Radio never imports Spotify internals.
 * A second streaming service is a new class with these methods and callbacks:
 *
 *   async ensureConnected()  — session + player ready to play, or throw
 *   async getStations()      — the account's stations as { id, name, detail, uris }
 *   async playStation(st)    — start `st` playing (and keep reporting state)
 *   async togglePause()      — pause or resume, return the new paused flag
 *   async next()/previous()  — skip around inside the station
 *   async signIn()/signOut() — begin / tear down the OAuth session
 *   async restoreSession()   — pick a login back up from storage/redirect
 *   onTrack(t) onPlay(b)     — Radio subscribes to these for its UI
 */
class SpotifyProvider {
  constructor() {
    this.token = null;           // { access, refresh, expiresAt } or null
    this.player = null;          // SDK player instance, or null until connected
    this.deviceId = null;
    this.playlists = null;
    this.playlistsLoaded = null; // promise, so two listeners never fetch twice
    this.onTrack = null;         // (track) => void — a NEW song started
    this.onPlay = null;          // (playing: boolean) => void
    this.onSignOut = null;       // () => void — auth died mid-session
    this._poll = null;
    this._tokenTimer = null;
    this._lastLogKey = null;     // last onState() signature we logged — de-dupe the console
  }

  get connected() {
    return !!this.token && !!this.player && !!this.deviceId;
  }

  /**
   * Make sure we can start playback on this device. Safe to call repeatedly:
   * after the first success it is a no-op, and every failure is fixable by
   * just calling it again (a token refresh or a fresh SDK player).
   */
  async ensureConnected() {
    await this.ensureToken();
    await loadSdk();
    const player = await this.ensurePlayer();
    if (!this.deviceId) {
      // getCurrentState() on a fresh player often returns null before Spotify
      // has finished wiring the device in; the first play attempt retries for
      // DEVICE_MARGIN_MS, which covers it in practice.
      this.deviceId = await new Promise((resolve) => {
        const t0 = performance.now();
        const tick = async () => {
          // The 'ready' listener above may have fired while we waited.
          if (this.deviceId) return resolve(this.deviceId);
          const st = await player.getCurrentState().catch(() => null);
          if (st?.device?.id) return resolve(st.device.id);
          if (performance.now() - t0 > DEVICE_MARGIN_MS) {
            console.warn(
              '[Spotify] No device id within', DEVICE_MARGIN_MS, 'ms — the SDK player never reported ready.'
            );
            return resolve(null);
          }
          setTimeout(tick, 250);
        };
        tick();
      });
    }
    if (!this.deviceId) return false;
    // Make this page's SDK device the device Spotify plays through. A play
    // request aimed at a device Spotify has never activated is accepted with a
    // 204 but never reaches the browser — that silent miss is exactly what the
    // explicit transfer exists to prevent (issue step 5).
    await this.ensureActiveDevice();
    return this.connected;
  }

  // --- auth ---------------------------------------------------------------
  /**
   * Resume the previous session from sessionStorage, or swallow the one-time
   * redirect a successful login just bounced back in on (exchange `code` for a
   * token, then scrub the URL so a reload does not re-exchange it).
   */
  async restoreSession() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (code) {
      const verifier = sessionStorage.getItem(VERIFIER_KEY);
      const expected = sessionStorage.getItem(STATE_KEY);
      sessionStorage.removeItem(VERIFIER_KEY);
      sessionStorage.removeItem(STATE_KEY);
      if (verifier && state && state === expected) {
        try {
          await this.exchangeCode(code, verifier);
        } catch (e) {
          // A stale or replayed code (e.g. a back button after signing out)
          // is not worth a wall of red; the player just has to sign in again.
          console.warn('radio:', e);
        }
      }
      params.delete('code');
      params.delete('state');
      const q = params.toString();
      history.replaceState(null, '', q ? `?${q}` : location.pathname);
    }
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (raw) {
      try {
        const tok = JSON.parse(raw);
        if (tok.access && tok.refresh && tok.expiresAt > Date.now()) {
          this.token = tok;
          this.scheduleRefresh(tok.expiresAt - Date.now());
        }
      } catch {
        sessionStorage.removeItem(TOKEN_KEY);
      }
    }
    return !!this.token;
  }

  /**
   * Cheap preflight that tells a real client id from a dead one. Spotify only
   * answers "invalid_client" when the id itself is unknown, so handing the
   * token endpoint a deliberately fake code separates the two cases: a real id
   * comes back "invalid_grant" (the code is fake), a dead one comes back
   * "invalid_client". If the request fails outright, let the real redirect
   * happen and let Spotify decide.
   */
  async checkClientId() {
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: 'skate-preflight',
          redirect_uri: redirectUri(),
          client_id: CLIENT_ID,
          code_verifier: 'skate-preflight',
        }),
      });
      const j = await res.json().catch(() => ({}));
      return j.error !== 'invalid_client';
    } catch {
      return true;
    }
  }

  /** Kick off the PKCE dance by sending the player off to Spotify. */
  async signIn() {
    // An unregistered client id would strand the player on Spotify's own
    // "client_id: Invalid" white page; catch it before the redirect and show
    // the message in the panel instead.
    if (!(await this.checkClientId())) throw new Error(CLIENT_ID_ERROR);
    const verifier = randomChars(64);
    const challenge = await sha256Base64Url(verifier);
    const state = randomChars(16);
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);
    const u = new URL(AUTHORIZE_URL);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', CLIENT_ID);
    u.searchParams.set('scope', SCOPES.join(' '));
    u.searchParams.set('redirect_uri', redirectUri());
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set('code_challenge', challenge);
    console.log('[Spotify] redirect_uri:', redirectUri());
    location.href = u.href;
  }

  /** Drop the token and the player. The theme is the one real radio again. */
  async signOut() {
    this.stopPolling();
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
    this.token = null;
    this.playlists = null;
    this.playlistsLoaded = null;
    try {
      await this.player?.disconnect();
    } catch {
      /* the SDK can be mid-teardown; there is nothing to salvage */
    }
    this.player = null;
    this.deviceId = null;
  }

  async ensureToken() {
    if (this.token && this.token.expiresAt > Date.now()) return;
    if (!this.token?.refresh) throw new Error('Not signed in to Spotify.');
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.token.refresh,
        client_id: CLIENT_ID,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      if (j.error === 'invalid_client') throw new Error(CLIENT_ID_ERROR);
      throw new Error(`Spotify sign-in expired (${res.status}).`);
    }
    const j = await res.json();
    this.token = {
      access: j.access_token,
      refresh: j.refresh_token || this.token.refresh,
      expiresAt: Date.now() + (j.expires_in || 3600) * 1000,
    };
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(this.token));
    this.scheduleRefresh((j.expires_in || 3600) * 1000 - 30_000);
  }

  async exchangeCode(code, verifier) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(),
        client_id: CLIENT_ID,
        code_verifier: verifier,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      if (j.error === 'invalid_client') throw new Error(CLIENT_ID_ERROR);
      throw new Error(`Spotify sign-in failed (${res.status}).`);
    }
    const j = await res.json();
    this.token = {
      access: j.access_token,
      refresh: j.refresh_token,
      expiresAt: Date.now() + (j.expires_in || 3600) * 1000,
    };
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(this.token));
    this.scheduleRefresh((j.expires_in || 3600) * 1000 - 30_000);
  }

  /** Refresh slightly before the token actually dies, not after. */
  scheduleRefresh(ms) {
    clearTimeout(this._tokenTimer);
    if (ms > 0) this._tokenTimer = setTimeout(() => this.ensureToken().catch(() => {}), ms);
  }

  /**
   * One authenticated round-trip against the Spotify Web API. Playback control
   * (play/pause/skip/transfer) lives here, not on the SDK player — the Web
   * Playback SDK only provides the device and its state events. Every request
   * logs its status and response body, so the exact point a playback pipeline
   * dies is visible in the console instead of swallowed (issue step 10).
   */
  async api(method, path, body) {
    await this.ensureToken();
    const payload = body === undefined ? undefined : JSON.stringify(body);
    console.log(`[Spotify] ${method} ${path}${payload ? ` body=${payload}` : ''}`);
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token.access}`,
        'Content-Type': 'application/json',
      },
      body: payload,
    });
    const text = await res.text().catch(() => '');
    let detail = text;
    try {
      detail = JSON.parse(text)?.error?.message || text;
    } catch {
      /* not JSON — keep the raw response text */
    }
    console.log(`[Spotify] ${method} ${path} -> ${res.status}${detail ? ` ${detail}` : ''}`);
    if (res.ok) return res;
    console.error(`[Spotify] ${method} ${path} failed:`, res.status, detail);
    if (res.status === 401) this.onAuthError();
    const err = new Error(`Spotify playback failed (${res.status}${detail ? ` — ${detail}` : ''}).`);
    err.status = res.status;
    throw err;
  }

  // --- the SDK player -----------------------------------------------------
  async ensurePlayer() {
    if (this.player) return this.player;
    const P = window.Spotify?.Player;
    if (!P) throw new Error('The Spotify player SDK is unavailable.');
    console.log('[Spotify] Creating the Web Playback SDK player…');
    const player = new P({
      name: 'Skate radio',
      getOAuthToken: (cb) => cb(this.token?.access),
      volume: 1.0,
    });
    player.addListener('ready', ({ device_id }) => {
      // The device id the SDK hands over is what the Web API needs to aim
      // playback at this page. Logged explicitly (issue step 4).
      console.log('[Spotify] player ready — device id:', device_id);
      this.deviceId = device_id;
      // The constructor's volume applies at connect time, but re-asserting it
      // from the ready event keeps the SDK device from ever sitting at zero
      // after a reconnect (issue step 12).
      player.setVolume(1.0).then(
        () => console.log('[Spotify] SDK player volume confirmed at 1.0'),
        (e) => console.warn('[Spotify] setVolume(1.0) failed:', e)
      );
    });
    player.addListener('player_state_changed', (st) => this.onState(st));
    player.addListener('not_ready', ({ device_id }) => {
      // Spotify dropped the device (usually after a long pause). The next play
      // attempt just builds the player again; the radio stays put.
      console.warn('[Spotify] player not_ready — device dropped:', device_id);
      this.player = null;
      this.deviceId = null;
    });
    // Every failure the SDK can report gets a listener (issue step 3), so a
    // dead token or a blocked device shows up in the console instead of as a
    // mysteriously quiet radio.
    player.addListener('initialization_error', ({ message }) => {
      console.error('[Spotify] initialization_error:', message);
      // The SDK could not spin up its device. The session itself may be fine,
      // so keep the token but tear the player down — the next play attempt
      // builds a fresh one and will log whatever happens again.
      this.player = null;
      this.deviceId = null;
    });
    player.addListener('authentication_error', ({ message }) => {
      console.error('[Spotify] authentication_error:', message);
      this.onAuthError();
    });
    player.addListener('account_error', ({ message }) => {
      console.error('[Spotify] account_error:', message);
      this.onAuthError();
    });
    player.addListener('playback_error', ({ message }) => {
      console.error('[Spotify] playback_error:', message);
    });
    const ok = await player.connect();
    console.log('[Spotify] player.connect() ->', ok);
    if (!ok) {
      throw new Error('Spotify refused to start a player (is the account on Premium?).');
    }
    this.player = player;
    return player;
  }

  onAuthError() {
    this.token = null;
    sessionStorage.removeItem(TOKEN_KEY);
    this.player = null;
    this.deviceId = null;
    this.onSignOut?.();
  }

  /** Whatever the SDK reports, whatever the device is doing, this is the one funnel. */
  onState(st) {
    if (!st) return;
    this.onPlay?.(!st.paused);
    const t = trackFromSpotify(st.track_window?.current_track);
    if (t) this.onTrack?.(t);
    // Log state only when something meaningful actually changed — the polling
    // loop calls this every few seconds, and a wall of identical lines would
    // bury the one that matters.
    const key = `${!!st.paused}|${t?.id || ''}|${st.device?.is_active}|${st.device?.volume_percent ?? -1}`;
    if (key !== this._lastLogKey) {
      this._lastLogKey = key;
      console.log('[Spotify] state:', {
        playing: !st.paused,
        track: t ? `${t.name} — ${t.artists.join(', ')}` : '(none)',
        device_id: st.device?.id,
        is_active: st.device?.is_active,
        volume_percent: st.device?.volume_percent,
      });
    }
  }

  /** Keep the state warm while a station is active: SDK events go quiet when
   *  the tab is backgrounded or the device idles, and a poll fixes both. */
  startPolling() {
    this.stopPolling();
    this._poll = setInterval(async () => {
      try {
        const st = await this.player?.getCurrentState();
        if (st) this.onState(st);
      } catch {
        /* the device may have just dropped; the next play attempt rebuilds it */
      }
    }, POLL_MS);
  }

  stopPolling() {
    clearInterval(this._poll);
    this._poll = null;
  }

  // --- the provider interface ---------------------------------------------
  /**
   * The stations this account can play, newest first. Called lazily — the
   * panel asks for it exactly when the player opens the station list — so
   * connecting Spotify costs one extra network call at most.
   */
  async getStations() {
    if (this.playlists) return this.playlists;
    if (!this.playlistsLoaded) {
      this.playlistsLoaded = this.fetchPlaylists();
    }
    try {
      return (this.playlists = await this.playlistsLoaded);
    } catch (e) {
      this.playlistsLoaded = null;
      throw e;
    }
  }

  async fetchPlaylists() {
    await this.ensureToken();
    const headers = { Authorization: `Bearer ${this.token.access}` };
    const out = [];
    let url = `${API_URL}/me/playlists?limit=50`;
    while (url) {
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`Spotify playlists failed (${res.status}).`);
      const j = await res.json();
      for (const p of j.items || []) {
        if (p.owner?.id === 'spotify' || p.type !== 'playlist') continue;
        out.push({
          id: `spotify:${p.id}`,
          name: p.name,
          detail: p.owner?.display_name || p.owner?.id || 'Spotify',
          uris: [`spotify:playlist:${p.id}`],
          image: p.images?.[0]?.url,
        });
      }
      url = j.next;
    }
    return out;
  }

  /**
   * A quick track search — the "pick a song" half of the radio settings.
   * A result is a station like any other: a single-URI station whose one song
   * it is. Searching costs one round-trip per query, so the caller debounces.
   */
  async searchTracks(query) {
    await this.ensureToken();
    const headers = { Authorization: `Bearer ${this.token.access}` };
    const url = `${API_URL}/search?type=track&limit=10&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Spotify search failed (${res.status}).`);
    const j = await res.json();
    return (j.tracks?.items || []).map((t) => ({
      id: `spotify:search:${t.id}`,
      name: t.name,
      detail: (t.artists || []).map((a) => a.name).join(', ') || 'Spotify',
      uris: [`spotify:track:${t.id}`],
      image: t.album?.images?.[0]?.url,
    }));
  }

  /**
   * Issue step 5: PUT /v1/me/player with `{ device_ids, play: false }` hands
   * playback to the SDK device *without* starting anything — the play request
   * that follows is what actually starts a station. Without this, a play
   * request aimed at a device Spotify has never activated is accepted (204)
   * but never reaches the browser.
   */
  async transferPlayback() {
    if (!this.deviceId) return false;
    console.log('[Spotify] Transferring playback to SDK device', this.deviceId);
    await this.api('PUT', '/me/player', { device_ids: [this.deviceId], play: false });
    console.log('[Spotify] Transfer accepted — SDK device', this.deviceId, 'is the playback target.');
    return true;
  }

  /** Only transfer when the SDK device is not already Spotify's active one —
   *  a repeat transfer on every next/previous/pause is a gratuitous pause. */
  async ensureActiveDevice() {
    const st = this.player ? await this.player.getCurrentState().catch(() => null) : null;
    if (st?.device?.is_active || st?.device?.id === this.deviceId) {
      console.log('[Spotify] SDK device is already the active playback device.');
      return true;
    }
    return this.transferPlayback();
  }

  /** GET /v1/me/player. 204 (empty body) means no active device and nothing
   *  playing, which is the normal state before any playback starts. */
  async readPlayback() {
    await this.ensureToken();
    const res = await fetch(`${API_URL}/me/player`, {
      headers: { Authorization: `Bearer ${this.token.access}` },
    });
    if (res.status === 204) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[Spotify] GET /me/player ->', res.status, text);
      return null;
    }
    return res.json();
  }

  /** Issue step 11: log the device Spotify would play on — id, name, type,
   *  is_active, volume_percent, currently playing track — before playback. */
  async logPlaybackState(label) {
    const j = await this.readPlayback().catch(() => null);
    if (!j) {
      console.log(`[Spotify] ${label}: no active playback device / nothing playing (204).`);
      return null;
    }
    const item = j.item || {};
    console.log(`[Spotify] ${label}:`, {
      device_id: j.device?.id,
      device_name: j.device?.name,
      device_type: j.device?.type,
      is_active: j.device?.is_active,
      volume_percent: j.device?.volume_percent,
      is_playing: j.is_playing,
      currently_playing: item.name
        ? `${item.name} — ${(item.artists || []).map((a) => a.name).join(', ')}`
        : '(none)',
    });
    return j;
  }

  async playStation(station) {
    if (!station.uris || !station.uris.length) throw new Error('That station has nothing in it.');
    console.log('[Spotify] playStation:', station.id, JSON.stringify(station.uris));
    const ready = await this.ensureConnected();
    if (!ready || !this.deviceId) {
      throw new Error('Spotify couldn’t start a player on this device — is the account on Premium?');
    }
    // Issue step 11: what is the device Spotify would play on, before we touch it?
    await this.logPlaybackState('before play');
    // The Web Playback SDK player has no play() method: starting playback is the
    // Web API's job. A playlist is a context, not a track, so it starts via
    // context_uri (issue step 7), while search results (single tracks) go
    // through the uris path (issue step 8). Passing a spotify:playlist: URI in
    // uris simply refuses to play.
    const isContext = station.uris[0].startsWith('spotify:playlist:');
    const body = isContext
      ? { context_uri: station.uris[0] }
      : { uris: station.uris, offset: { position: 0 } };
    console.log('[Spotify] Starting playback:', JSON.stringify(body));
    try {
      await this.api('PUT', `/me/player/play?device_id=${encodeURIComponent(this.deviceId)}`, body);
    } catch (e) {
      // 404 = "device not found", 502 = "command failed" — both mean Spotify
      // had not finished registering the fresh SDK device. Re-transferring it
      // wakes it up; try once more before giving up.
      if (![404, 502].includes(e?.status)) throw e;
      console.warn(
        '[Spotify] Play rejected with', e.status, '— re-transferring the device and retrying.'
      );
      await this.transferPlayback();
      await new Promise((r) => setTimeout(r, DEVICE_MARGIN_MS / 2));
      await this.api('PUT', `/me/player/play?device_id=${encodeURIComponent(this.deviceId)}`, body);
    }
    this.startPolling();
    // Issue step 15: confirm the SDK device actually became the active one and
    // audio should be flowing, rather than assuming a 204 meant success.
    await this.logPlaybackState('after play');
    // A freshly-started station often has no event yet; prime the bar from the
    // device instead of waiting for the next player_state_changed.
    const st = this.player ? await this.player.getCurrentState().catch(() => null) : null;
    if (st) this.onState(st);
  }

  async togglePause() {
    await this.ensureConnected();
    const st = await this.player.getCurrentState();
    if (!st) return null;
    const resuming = !!st.paused;
    await this.api(
      'PUT',
      `/me/player/${resuming ? 'play' : 'pause'}?device_id=${encodeURIComponent(this.deviceId)}`,
      resuming ? {} : undefined
    );
    this.onPlay?.(resuming);
    return resuming;
  }

  async next() {
    await this.ensureConnected();
    await this.api('POST', `/me/player/next?device_id=${encodeURIComponent(this.deviceId)}`);
  }

  async previous() {
    await this.ensureConnected();
    await this.api('POST', `/me/player/previous?device_id=${encodeURIComponent(this.deviceId)}`);
  }

  dispose() {
    this.stopPolling();
    clearTimeout(this._tokenTimer);
    this.player?.disconnect();
  }
}

// --- the radio itself -----------------------------------------------------
/**
 * The DOM side of the radio. Talks to a provider through the interface above
 * and to nothing else: no fetch, no sessionStorage, no Spotify imports.
 * There are two halves, both built from markup in index.html:
 *
 *   • Settings — the station picker. Sign in to Spotify, pick a playlist or
 *     search a song, and the run's music becomes it.
 *
 *   • The in-game bar — a tiny card in the corner of the run showing the
 *     track name, a ticker that scrolls it when it is too long to fit, and
 *     skip buttons underneath. It is hidden while a menu is up, and can be
 *     switched off entirely from Settings ("Radio in game").
 */
export class Radio {
  constructor(ctx) {
    this.ctx = ctx;
    this.provider = new SpotifyProvider();
    this.stations = null;
    this.station = null;
    this.playing = false;
    this.connected = false;
    this.now = null;             // last track we announced
    this.visible = true;         // whether the in-game bar shows at all
    this.inGame = false;         // whether a run (not a menu) is on screen
    this.screen = null;          // current menu name, or null while playing
    this.toastTimer = null;
    this.toastOutTimer = null;
    this._searchTimer = null;

    this.el = {
      bar: ctx.root.querySelector('#radio'),
      track: ctx.root.querySelector('#radio-track'),
      scroll: ctx.root.querySelector('.radio-scroll'),
      prevBtn: ctx.root.querySelector('#radio-prev'),
      nextBtn: ctx.root.querySelector('#radio-next'),
      toast: ctx.root.querySelector('#radio-now'),
      toastTrack: ctx.root.querySelector('#radio-now-track'),
      toastStation: ctx.root.querySelector('#radio-now-station'),
      login: document.getElementById('radio-settings-login'),
      logout: document.getElementById('radio-settings-logout'),
      status: document.getElementById('radio-settings-status'),
      list: document.getElementById('radio-settings-stations'),
      search: document.getElementById('radio-search'),
      results: document.getElementById('radio-search-results'),
      visibleBtn: document.getElementById('opt-radio-visible'),
    };
    this.bind();
  }

  bind() {
    const el = this.el;
    el.prevBtn.addEventListener('click', () => this.previous());
    el.nextBtn.addEventListener('click', () => this.next());
    el.login.addEventListener('click', () => this.signIn());
    el.logout.addEventListener('click', () => this.signOut());
    el.visibleBtn.addEventListener('click', () => {
      this.visible = !this.visible;
      this.ctx.save?.setRadioVisible?.(this.visible);
      this.renderVisibleBtn();
      this.renderPlayback();
    });
    el.search.addEventListener('input', () => this.onSearchInput());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.search.value) {
        el.search.value = '';
        this.onSearchInput();
      }
    });
  }

  /** One shot at startup: restore the session, then settle into whatever
   *  station (if any) the player last picked — without touching Spotify at
   *  all if there is no session to restore. */
  async init() {
    const saved = this.ctx.save?.radioPlaylistId;
    this.visible = this.ctx.save?.radioVisible !== false;
    this.renderVisibleBtn();
    this.provider.onSignOut = () => {
      this.connected = false;
      this.station = null;
      this.playing = false;
      this.now = null;
      this.renderPlayback();
      this.syncPanel();
    };
    try {
      this.connected = await this.provider.restoreSession();
    } catch {
      this.connected = false;
    }
    this.stations = [BUILTIN_STATION];
    if (this.connected && saved && saved !== BUILTIN_STATION.id) {
      // Best effort: name the saved station from the playlists if we can,
      // otherwise the park's speakers are the honest stand-in.
      try {
        const list = await this.provider.getStations();
        this.stations = [BUILTIN_STATION, ...list];
        this.station = list.find((s) => s.id === saved) || BUILTIN_STATION;
      } catch {
        this.station = BUILTIN_STATION;
      }
    } else {
      this.station = BUILTIN_STATION;
    }
    this.renderPlayback();
    this.syncPanel();
    // A login redirect lands back on the start screen; open the settings
    // again so the freshly-loaded playlists are right where they left off.
    if (sessionStorage.getItem('skate.radio.returnToSettings')) {
      sessionStorage.removeItem('skate.radio.returnToSettings');
      document.dispatchEvent(new CustomEvent('radio:open-settings'));
    }
  }

  // --- the in-game bar ----------------------------------------------------
  /** main.js hands over every menu transition: a menu name while one is up,
   *  null the moment a run starts. The bar only exists mid-run. */
  onScreen(name) {
    this.screen = name;
    this.inGame = name === null;
    this.renderPlayback();
    if (name === 'settings') this.syncPanel();
  }

  /** Reflect the run/menu + the player's on/off choice on the bar itself. */
  syncBar() {
    if (!this.el.bar) return;
    this.el.bar.hidden = !(this.inGame && this.visible);
  }

  /** One place to redraw the bar: the label, the ticker, the skip buttons. */
  renderPlayback() {
    this.syncBar();
    if (!this.el.track) return;
    const label = this.now ? this.now.name : this.station?.name || '';
    this.el.track.textContent = label;
    // The ticker is opt-in per label: a short name sits still, a long one
    // scrolls. Restarting it means dropping the class for a frame.
    this.el.track.classList.remove('scroll');
    void this.el.track.offsetWidth;
    if (this.el.scroll && this.el.track.scrollWidth > this.el.scroll.clientWidth) {
      this.el.track.classList.add('scroll');
    }
    const skippable = this.connected && this.station && !this.station.builtin;
    this.el.prevBtn.disabled = !skippable;
    this.el.nextBtn.disabled = !skippable;
  }

  async next() {
    if (!this.connected || !this.station || this.station.builtin || !this.playing) return;
    try {
      await this.provider.next();
    } catch (e) {
      console.warn('radio:', e);
    }
  }

  async previous() {
    if (!this.connected || !this.station || this.station.builtin || !this.playing) return;
    try {
      await this.provider.previous();
    } catch (e) {
      console.warn('radio:', e);
    }
  }

  // --- the settings half --------------------------------------------------
  /** The signed-in signed-out split, plus (lazily) the station list. */
  async syncPanel() {
    if (!this.el.list) return;
    const signedIn = this.connected;
    this.el.login.hidden = signedIn;
    this.el.logout.hidden = !signedIn;
    if (!signedIn) {
      this.el.status.textContent =
        'Connect Spotify and your playlists appear here — pick one and it plays over the park.';
      this.renderStations([BUILTIN_STATION]);
      return;
    }
    this.el.status.textContent = this.stations?.length > 1 ? '' : 'Loading your playlists…';
    try {
      const list = await this.provider.getStations();
      this.stations = [BUILTIN_STATION, ...list];
      this.renderStations(this.stations);
      if (this.screen === 'settings' && list.length) this.el.status.textContent = '';
    } catch (e) {
      this.el.status.textContent =
        'Couldn’t load your playlists — check the connection and try again.';
    }
  }

  renderStations(list, target = this.el.list) {
    const f = document.createDocumentFragment();
    for (const s of list) f.appendChild(this.stationCard(s));
    target.replaceChildren(f);
  }

  stationCard(station) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'radio-station';
    btn.dataset.station = station.id;

    const art = document.createElement('span');
    art.className = 'radio-art';
    if (station.image) {
      art.style.backgroundImage = `url('${station.image}')`;
      art.classList.add('photo');
    } else if (station.builtin) {
      art.textContent = '♪';
    } else {
      art.textContent = station.name.slice(0, 1).toUpperCase();
    }

    const text = document.createElement('span');
    text.className = 'radio-station-text';
    const name = document.createElement('b');
    name.textContent = station.name;
    const detail = document.createElement('i');
    detail.textContent = station.detail || '';
    text.append(name, detail);

    const live = document.createElement('span');
    live.className = 'radio-live';
    live.textContent = 'Playing';

    btn.append(art, text, live);
    if (station.id === this.station?.id) btn.classList.add('active');
    btn.addEventListener('click', () => this.play(station));
    return btn;
  }

  async signIn() {
    try {
      // The OAuth hop lands back on the app's own URL; the flag makes init()
      // reopen the settings screen so the playlists appear right there.
      sessionStorage.setItem('skate.radio.returnToSettings', '1');
      this.el.status.textContent = 'Opening Spotify…';
      await this.provider.signIn();
    } catch (e) {
      this.el.status.textContent = e?.message || 'Couldn’t reach Spotify.';
    }
  }

  async signOut() {
    this.station = null;
    this.playing = false;
    this.connected = false;
    this.now = null;
    this.el.search.value = '';
    this.onSearchInput();
    this.provider.signOut().catch(() => {});
    this.renderPlayback();
    this.syncPanel();
    this.emit();
  }

  // --- song search --------------------------------------------------------
  onSearchInput() {
    clearTimeout(this._searchTimer);
    const q = this.el.search.value.trim();
    if (!q) {
      this.el.results.hidden = true;
      this.el.results.replaceChildren();
      this.el.list.hidden = false;
      this.renderStations(this.stations || [BUILTIN_STATION]);
      return;
    }
    this.el.list.hidden = true;
    this.el.status.textContent = 'Searching…';
    this._searchTimer = setTimeout(() => this.search(q), 350);
  }

  async search(q) {
    if (!this.connected) {
      this.el.status.textContent = 'Connect Spotify to search songs.';
      return;
    }
    try {
      const songs = await this.provider.searchTracks(q);
      this.el.results.hidden = false;
      this.renderStations(songs, this.el.results);
      this.el.status.textContent = songs.length ? '' : 'No songs found.';
    } catch (e) {
      this.el.status.textContent = e?.message || 'Search failed — check the connection.';
    }
  }

  // --- now playing --------------------------------------------------------
  /** The animation every track change deserves: a toast that slides in from
   *  the right with the artist and the track, gone again before it can
   *  wallpaper the screen. */
  announce(track) {
    if (!track || track.id === this.now?.id) return;
    this.now = track;
    this.el.toastTrack.textContent = track.name;
    this.el.toastStation.textContent =
      track.artists?.length ? track.artists.join(', ') : this.station?.name || '';
    // Restart the CSS animation by dropping the toast into a fresh node —
    // then re-point at the clone's own labels, or the next announce would
    // edit nodes that are no longer in the document.
    const n = this.el.toast.cloneNode(true);
    this.el.toast.replaceWith(n);
    this.el.toast = n;
    this.el.toastTrack = n.querySelector('#radio-now-track');
    this.el.toastStation = n.querySelector('#radio-now-station');
    n.hidden = false;
    clearTimeout(this.toastTimer);
    clearTimeout(this.toastOutTimer);
    this.toastTimer = setTimeout(() => n.classList.add('out'), HIDE_TOAST_MS);
    this.toastOutTimer = setTimeout(() => {
      n.classList.remove('out');
      n.hidden = true;
    }, HIDE_TOAST_MS + 400);
    this.renderPlayback();
  }

  // --- playback -----------------------------------------------------------
  async play(station) {
    this.station = station;
    if (station.builtin) {
      this.playing = true;
      this.provider.stopPolling();
      this.ctx.audio?.setMusicDucked(false);
      this.emit();
      this.renderPlayback();
      this.announce(THEME_TRACK);
      this.syncPanel();
      return;
    }
    if (!this.connected) {
      this.signIn();
      return;
    }
    this.el.status.textContent = 'Starting…';
    try {
      // Wire the UI callbacks before playback begins, not after: the SDK can
      // emit its first player_state_changed the moment the play request lands,
      // and the toast/duck logic must be listening by then.
      this.provider.onTrack = (t) => this.announce(t);
      this.provider.onPlay = (p) => {
        this.playing = p;
        this.renderPlayback();
        this.emit(); // duck the theme while Spotify plays, bring it back on pause
      };
      await this.provider.playStation(station);
      this.playing = true;
      this.emit();
      this.renderPlayback();
      this.el.status.textContent = '';
      this.syncPanel();
    } catch (e) {
      this.el.status.textContent = e?.message || 'That station wouldn’t start.';
    }
  }

  /** The save + duck-theme side of a station change, in one place. */
  emit() {
    if (this.station) this.ctx.save?.setRadioPlaylistId?.(this.station.id);
    const duck = this.playing && this.station && !this.station.builtin;
    this.ctx.audio?.setMusicDucked(duck);
  }

  // --- the "Radio in game" toggle ------------------------------------------
  renderVisibleBtn() {
    if (this.el.visibleBtn) {
      this.el.visibleBtn.textContent = `Radio in game: ${this.visible ? 'On' : 'Off'}`;
    }
  }

  /** A stats reset backs the radio's own choices out to their defaults too. */
  resetSettings() {
    this.visible = true;
    this.renderVisibleBtn();
    this.station = BUILTIN_STATION;
    this.playing = false;
    this.now = null;
    this.provider.stopPolling();
    this.ctx.audio?.setMusicDucked(false);
    this.renderPlayback();
    this.syncPanel();
  }
}

/**
 * The one entry point main.js calls. `save` and `audio` come from the app so
 * this module never needs to know how main.js built them; the markup it binds
 * lives in index.html. Returns the Radio so main.js can hand it the debug
 * hook and the menu-transition feed.
 */
export function boot(save, audio) {
  const root = document.getElementById('hud');
  if (!root || !root.querySelector('#radio-track')) return null;
  const radio = new Radio({ root, save, audio });
  radio.init().catch((e) => {
    // A broken radio must never break the game: log and carry on with the
    // built-in station.
    console.error('radio:', e);
    radio.station = BUILTIN_STATION;
    radio.renderPlayback();
    radio.syncPanel();
  });
  return radio;
}
