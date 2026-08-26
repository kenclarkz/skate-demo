// Radio: a station picker with a live Spotify hook-in.
//
// The game ships with one station — the park's own synth speakers — and a
// player who connects their Spotify gets a real radio: their playlists appear
// in the same list, picking one hands playback to Spotify.
//
// The shape of that is worth keeping honest, so the file is split in two:
//
//   1. SpotifyProvider — everything that touches Spotify (the OAuth dance, the
//      Web Playback SDK, the track state). It is written against a small
//      interface so a second service — SoundCloud, a local library, a podcast
//      feed — is a new object that speaks the same methods, not a rewrite of
//      the panel that hosts them.
//
//   2. Radio — the DOM half. It owns the Settings station picker (login,
//      playlists, song search), the tiny in-game bar with its scrolling track
//      name and play/skip buttons, the now-playing toast, and the Spotify
//      debug panel. It only ever calls the provider through that interface, so
//      it never needs to know how the current station streams.
//
// The playback pipeline, end to end (the authoritative chain the SDK prescribes):
//
//   SPOTIFY AUTH
//   ↓
//   Spotify Web Playback SDK   (loaded once, before any Player is created)
//   ↓
//   one Spotify.Player         (this.spotifyPlayer — the single player instance)
//   ↓
//   'ready' event              (saves device_id)
//   ↓
//   transfer playback          (PUT /me/player — makes this page's SDK device active)
//   ↓
//   playlist playback          (PUT /me/player/play with { context_uri })
//   ↓
//   'player_state_changed'     (the SOURCE OF TRUTH for the radio UI)
//   ↓
//   UI controls                (togglePlay / nextTrack / previousTrack on the same instance)
//
// There is exactly one Spotify.Player. It lives on the provider as
// `spotifyPlayer`, it is created only after the SDK script has loaded, and
// every control goes through that same instance — never a second player, never
// the Web API pretending to be one, and never `spotifyPlayer.play()`.
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
// it is "playing", the toast says what it actually is: the park's speakers —
// which now means the whole local playlist in js/skate/audio.js, announced
// track by track as it plays.
export const BUILTIN_STATION = {
  id: 'builtin',
  name: 'Skate FM',
  detail: 'The park\u2019s own speakers',
  builtin: true,
};

// All built-in stations as radio.js station objects. Built from audio.js's
// BUILTIN_STATION_IDS and STATION_NAMES so the two files never duplicate
// station metadata.
import { BUILTIN_STATION_IDS, STATION_NAMES } from './audio.js';

const BUILTIN_DETAILS = {
  'skate-fm': "The park\u2019s own speakers",
  'hip-hop': 'Beats to grind to',
  'pop': 'Feel-good vibes',
  'indie': 'Underground sounds',
};

const BUILTIN_ICONS = {
  'skate-fm': '\u266A',
  'hip-hop': '\uD83C\uDFB5',
  'pop': '\uD83C\uDFB6',
  'indie': '\uD83C\uDFB8',
};

const ALL_BUILTIN_STATIONS = BUILTIN_STATION_IDS.map((id) => ({
  id: `builtin:${id}`,
  name: STATION_NAMES[id] || id,
  detail: BUILTIN_DETAILS[id] || '',
  builtin: true,
  builtinKey: id,
  icon: BUILTIN_ICONS[id] || '\u266A',
}));

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
const PLAYBACK_WAIT_MS = 8000;  // how long to wait for the first real player_state_changed
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
 * `{ id, name, artists, album }`. `id` is the whole change signal — a track
 * only counts as new when its id differs from the last one reported.
 */
function trackFromSpotify(t) {
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    artists: (t.artists || []).map((a) => a.name),
    album: t.album?.name || '',
  };
}

// The Web Playback SDK is the only way to control a playback device from a
// page, but it only ships after auth and we do not want to fetch it for the
// many players who never connect Spotify. Loaded once, cached forever. The
// SDK calls `onSpotifyWebPlaybackSDKReady` synchronously as it finishes, so
// the handler has to be installed before the script tag goes in. Nothing may
// construct a Spotify.Player before this has resolved — requirement: load the
// SDK first, then create the player.
let sdkLoaded = null;
function loadSdk() {
  // Already here (a previous load, or the SDK finished arriving late).
  if (window.Spotify?.Player) {
    console.log('[Spotify] SDK loaded');
    return Promise.resolve();
  }
  if (!sdkLoaded) {
    sdkLoaded = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_URL;
      s.async = true;
      window.onSpotifyWebPlaybackSDKReady = () => {
        console.log('[Spotify] SDK loaded');
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
 *   togglePlay()             — the SDK's togglePlay(), inside a user gesture
 *   nextTrack()/previousTrack() — the SDK's own skip methods, same instance
 *   activate()               — iOS: SDK activateElement(), synchronously in-gesture
 *   async signIn()/signOut() — begin / tear down the OAuth session
 *   async restoreSession()   — pick a login back up from storage/redirect
 *   onTrack(t) onPlay(b) onUi(state) — Radio subscribes to these for its UI
 *
 * The single authoritative player lives at `this.spotifyPlayer`. There is no
 * second player object anywhere, and the controls are the SDK player's own
 * methods — togglePlay()/nextTrack()/previousTrack()/setVolume() — never
 * `spotifyPlayer.play()` and never a Web API clone of them.
 */
class SpotifyProvider {
  constructor() {
    this.token = null;           // { access, refresh, expiresAt } or null
    this.spotifyPlayer = null;   // THE one authoritative Spotify.Player instance
    this.deviceId = null;        // the SDK device id, saved from the 'ready' event
    this.sdkReady = false;       // debug: whether the SDK script finished loading
    this.playerConnected = false;// debug: whether the SDK reported 'ready'
    this.lastApiStatus = null;   // debug: e.g. 'PUT /me/player/play -> 204'
    this.lastSdkEvent = null;    // debug: the most recent SDK event name
    this.lastUiState = null;     // the last player_state_changed, shaped for the UI
    this._lastState = null;      // the raw SDK state, for the playback-confirm wait
    this._volume = 1.0;          // 0..1, applied to the SDK player on ready/set
    this.playlists = null;
    this.playlistsLoaded = null; // promise, so two listeners never fetch twice
    this.onTrack = null;         // (track) => void — a NEW song started
    this.onPlay = null;          // (playing: boolean) => void
    this.onUi = null;            // (state) => void — full source-of-truth state
    this.onSignOut = null;       // () => void — auth died mid-session
    this.onAutoplayBlocked = null; // () => void — show the "Tap PLAY" button
    this._poll = null;
    this._tokenTimer = null;
    this._lastLogKey = null;     // last onState() signature we logged — de-dupe the console
  }

  get connected() {
    return !!this.token && !!this.spotifyPlayer && !!this.deviceId;
  }

  /**
   * Make sure we can start playback on this device. Safe to call repeatedly:
   * after the first success it is a no-op, and every failure is fixable by
   * just calling it again (a token refresh or a fresh SDK player).
   */
  async ensureConnected() {
    await this.ensurePlayerOnly();
    if (!this.deviceId) return false;
    // Make this page's SDK device the device Spotify plays through. A play
    // request aimed at a device Spotify has never activated is accepted with a
    // 204 but never reaches the browser — that silent miss is exactly what the
    // explicit transfer exists to prevent.
    await this.ensureActiveDevice();
    return this.connected;
  }

  /** Session + SDK + player + device id, but no transfer. Used to warm the
   *  player up at startup so iOS can activateElement() inside the first real
   *  tap, without hijacking whatever device the user's Spotify is on. */
  async ensurePlayerOnly() {
    await this.ensureToken();
    await loadSdk();
    this.sdkReady = !!window.Spotify;
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
    return this.deviceId;
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
      await this.spotifyPlayer?.disconnect();
    } catch {
      /* the SDK can be mid-teardown; there is nothing to salvage */
    }
    this.spotifyPlayer = null;
    this.playerConnected = false;
    this.deviceId = null;
    this.lastUiState = null;
    this.lastSdkEvent = 'signout';
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
   * One authenticated round-trip against the Spotify Web API. Transfer and the
   * play/context request live here (the Web API owns *starting* a context), but
   * the transport-level controls — togglePlay, next/previous, volume — live on
   * the SDK player, not here. Every request logs its status and response body,
   * so the exact point a playback pipeline dies is visible in the console
   * instead of swallowed.
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
    this.lastApiStatus = `${method} ${path} -> ${res.status}`;
    console.log(`[Spotify] ${method} ${path} -> ${res.status}${detail ? ` ${detail}` : ''}`);
    if (res.ok) return res;
    console.error(`[Spotify] ${method} ${path} failed:`, res.status, detail);
    if (res.status === 401) this.onAuthError();
    const err = new Error(`Spotify playback failed (${res.status}${detail ? ` — ${detail}` : ''}).`);
    err.status = res.status;
    throw err;
  }

  // --- the SDK player -----------------------------------------------------
  /**
   * Build the ONE authoritative Spotify.Player. The SDK script must already be
   * loaded (ensurePlayerOnly awaits loadSdk before calling this), because
   * `window.Spotify.Player` is only real once the script is done. The player is
   * cached on `this.spotifyPlayer` and every control routes through it; a
   * second player object is never constructed.
   */
  async ensurePlayer() {
    if (this.spotifyPlayer) return this.spotifyPlayer;
    const P = window.Spotify?.Player;
    if (!P) throw new Error('The Spotify player SDK is unavailable.');
    console.log('[Spotify] Player created');
    const player = new P({
      name: 'Skate radio',
      getOAuthToken: (cb) => cb(this.token?.access),
      volume: this._volume,
    });
    player.addListener('ready', ({ device_id }) => {
      // The device id the SDK hands over is what the Web API needs to aim
      // playback at this page.
      this.lastSdkEvent = 'ready';
      this.playerConnected = true;
      this.deviceId = device_id;
      console.log('[Spotify] Player connected');
      console.log(`[Spotify] Device ready: ${device_id}`);
      // The constructor's volume applies at connect time, but re-asserting it
      // from the ready event keeps the SDK device from ever sitting at zero
      // after a reconnect.
      player.setVolume(this._volume).then(
        () => console.log('[Spotify] SDK player volume set to', this._volume),
        (e) => console.warn('[Spotify] setVolume(', this._volume, ') failed:', e)
      );
      this.emitUi();
    });
    player.addListener('not_ready', ({ device_id }) => {
      // Spotify dropped the device (usually after a long pause). The next play
      // attempt just builds the player again; the radio stays put.
      this.lastSdkEvent = 'not_ready';
      this.playerConnected = false;
      console.warn('[Spotify] Player not_ready — device dropped:', device_id);
      this.spotifyPlayer = null;
      this.deviceId = null;
      this.emitUi();
    });
    // player_state_changed is the single source of truth for the radio UI:
    // track, artists, album, paused, position, duration all come from here.
    player.addListener('player_state_changed', (st) => this.onState(st));
    // Every failure the SDK can report gets a listener, so a dead token, a
    // blocked device or a blocked autoplay shows up instead of as a
    // mysteriously quiet radio.
    player.addListener('initialization_error', ({ message }) => {
      this.lastSdkEvent = 'initialization_error';
      console.error('[Spotify] initialization_error:', message);
      // The SDK could not spin up its device. The session itself may be fine,
      // so keep the token but tear the player down — the next play attempt
      // builds a fresh one and will log whatever happens again.
      this.spotifyPlayer = null;
      this.playerConnected = false;
      this.deviceId = null;
      this.emitUi();
    });
    player.addListener('authentication_error', ({ message }) => {
      this.lastSdkEvent = 'authentication_error';
      console.error('[Spotify] authentication_error:', message);
      this.onAuthError();
    });
    player.addListener('account_error', ({ message }) => {
      this.lastSdkEvent = 'account_error';
      console.error('[Spotify] account_error:', message);
      this.onAuthError();
    });
    player.addListener('playback_error', ({ message }) => {
      this.lastSdkEvent = 'playback_error';
      console.error('[Spotify] playback_error:', message);
      this.emitUi();
    });
    player.addListener('autoplay_failed', () => {
      this.lastSdkEvent = 'autoplay_failed';
      console.error('[Spotify] autoplay_failed — the browser blocked playback outside a user gesture.');
      this.onAutoplayBlocked?.();
      this.emitUi();
    });
    const ok = await player.connect();
    console.log('[Spotify] player.connect() ->', ok);
    if (!ok) {
      throw new Error('Spotify refused to start a player (is the account on Premium?).');
    }
    this.spotifyPlayer = player;
    this.emitUi();
    return player;
  }

  onAuthError() {
    this.token = null;
    sessionStorage.removeItem(TOKEN_KEY);
    this.spotifyPlayer = null;
    this.playerConnected = false;
    this.deviceId = null;
    this.lastSdkEvent = 'authentication_error';
    this.onSignOut?.();
    this.emitUi();
  }

  /**
   * Whatever the SDK reports, whatever the device is doing, this is the one
   * funnel. player_state_changed is the source of truth for the radio UI —
   * the UI never assumes the selected playlist is playing, it shows exactly
   * what this event says is current.
   */
  onState(st) {
    this.lastSdkEvent = 'player_state_changed';
    this._lastState = st;
    if (!st) return;
    const t = trackFromSpotify(st.track_window?.current_track);
    const playing = !st.paused;
    this.onPlay?.(playing);
    if (t) this.onTrack?.(t);
    const uiState = {
      track: t,
      paused: !!st.paused,
      position: st.position || 0,
      duration: st.duration || 0,
      isActive: !!st.device?.is_active,
      deviceId: st.device?.id || this.deviceId,
      volume: st.device?.volume_percent != null ? st.device.volume_percent / 100 : this._volume,
    };
    this.lastUiState = uiState;
    this.onUi?.(uiState);
    // Log state only when something meaningful actually changed — the polling
    // loop calls this every few seconds, and a wall of identical lines would
    // bury the one that matters.
    const key = `${playing}|${t?.id || ''}|${st.device?.is_active}|${st.device?.volume_percent ?? -1}`;
    if (key !== this._lastLogKey) {
      this._lastLogKey = key;
      console.log('[Spotify] state:', {
        playing,
        track: t ? `${t.name} — ${t.artists.join(', ')}` : '(none)',
        device_id: st.device?.id,
        is_active: st.device?.is_active,
        volume_percent: st.device?.volume_percent,
      });
    }
  }

  /** Push the current known state out to the UI without waiting for an event. */
  emitUi() {
    if (!this.lastUiState) return;
    this.onUi?.(this.lastUiState);
  }

  /** Keep the state warm while a station is active: SDK events go quiet when
   *  the tab is backgrounded or the device idles, and a poll fixes both. */
  startPolling() {
    this.stopPolling();
    this._poll = setInterval(async () => {
      try {
        const st = await this.spotifyPlayer?.getCurrentState();
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

  // --- playback controls (all through the one authoritative player) --------
  /**
   * iOS Safari: the SDK must be activated inside the user's gesture. Calling
   * this synchronously at the top of the playlist-tap handler — before any
   * `await` — is what makes audio possible on iPhone; a deferred call is
   * silently ignored. It returns a promise, but the call itself is the point.
   */
  activate() {
    if (this.spotifyPlayer) {
      try {
        console.log('[Spotify] activateElement()');
        this.spotifyPlayer.activateElement();
      } catch (e) {
        console.warn('[Spotify] activateElement failed:', e);
      }
    }
  }

  /** Play/pause, straight through the SDK player — never spotifyPlayer.play(). */
  togglePlay() {
    if (!this.spotifyPlayer) throw new Error('The Spotify player is not connected.');
    console.log('[Spotify] togglePlay()');
    return this.spotifyPlayer.togglePlay();
  }

  nextTrack() {
    if (!this.spotifyPlayer) throw new Error('The Spotify player is not connected.');
    console.log('[Spotify] nextTrack()');
    return this.spotifyPlayer.nextTrack();
  }

  previousTrack() {
    if (!this.spotifyPlayer) throw new Error('The Spotify player is not connected.');
    console.log('[Spotify] previousTrack()');
    return this.spotifyPlayer.previousTrack();
  }

  /** 0..1, straight through the SDK player. */
  setVolume(value) {
    this._volume = value;
    if (this.spotifyPlayer) {
      this.spotifyPlayer.setVolume(value).catch((e) => console.warn('[Spotify] setVolume failed:', e));
    }
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

  // --- transfer + playback (the Web API's two real jobs) ---------------------
  /**
   * PUT /v1/me/player with `{ device_ids, play: false }` hands playback to the
   * SDK device *without* starting anything — the play request that follows is
   * what actually starts a station. Without this, a play request aimed at a
   * device Spotify has never activated is accepted (204) but never reaches the
   * browser.
   */
  async transferToSpotifyDevice() {
    if (!this.deviceId) return false;
    console.log('[Spotify] transferToSpotifyDevice:', this.deviceId);
    await this.api('PUT', '/me/player', { device_ids: [this.deviceId], play: false });
    console.log('[Spotify] Transfer accepted — SDK device', this.deviceId, 'is the playback target.');
    return true;
  }

  /** Only transfer when the SDK device is not already Spotify's active one —
   *  a repeat transfer on every next/previous/pause is a gratuitous pause. */
  async ensureActiveDevice() {
    const st = this.spotifyPlayer
      ? await this.spotifyPlayer.getCurrentState().catch(() => null)
      : null;
    if (st?.device?.is_active || st?.device?.id === this.deviceId) {
      console.log('[Spotify] SDK device is already the active playback device.');
      return true;
    }
    return this.transferToSpotifyDevice();
  }

  /**
   * PUT /v1/me/player/play with `{ context_uri }`. A playlist is a context,
   * not a track — Spotify refuses a spotify:playlist: URI in `uris`, but a
   * single-track search result still goes through the uris path.
   */
  async playSpotifyContext(contextUri, retried) {
    if (!this.deviceId) throw new Error('No Spotify device yet.');
    console.log('[Spotify] playSpotifyContext:', contextUri);
    const body = contextUri.startsWith('spotify:playlist:')
      ? { context_uri: contextUri }
      : { uris: [contextUri], offset: { position: 0 } };
    try {
      await this.api('PUT', `/me/player/play?device_id=${encodeURIComponent(this.deviceId)}`, body);
    } catch (e) {
      // 404 = "device not found", 502 = "command failed" — both mean Spotify
      // had not finished registering the fresh SDK device. Re-transferring it
      // wakes it up; try once more before giving up.
      if (retried || ![404, 502].includes(e?.status)) throw e;
      console.warn(
        '[Spotify] Play rejected with', e.status, '— re-transferring the device and retrying.'
      );
      await this.transferToSpotifyDevice();
      await new Promise((r) => setTimeout(r, DEVICE_MARGIN_MS / 2));
      await this.playSpotifyContext(contextUri, true);
    }
  }

  /** GET /v1/me/player. 204 (empty body) means no active device and nothing
   *  playing, which is the normal state before any playback starts. */
  async readPlayback() {
    await this.ensureToken();
    const res = await fetch(`${API_URL}/me/player`, {
      headers: { Authorization: `Bearer ${this.token.access}` },
    });
    this.lastApiStatus = `GET /me/player -> ${res.status}`;
    if (res.status === 204) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[Spotify] GET /me/player ->', res.status, text);
      return null;
    }
    return res.json();
  }

  /** Log the device Spotify would play on — id, name, type, is_active,
   *  volume_percent, currently playing track, is_playing — plus a debug-panel
   *  snapshot of the same facts. */
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
    if (item.id) {
      this.lastUiState = {
        track: {
          id: item.id,
          name: item.name || '',
          artists: (item.artists || []).map((a) => a.name),
          album: item.album?.name || '',
        },
        paused: !j.is_playing,
        position: j.progress_ms || 0,
        duration: item.duration_ms || 0,
        isActive: !!j.device?.is_active,
        deviceId: j.device?.id || this.deviceId,
        volume: j.device?.volume_percent != null ? j.device.volume_percent / 100 : this._volume,
      };
      this.onUi?.(this.lastUiState);
    }
    return j;
  }

  /**
   * Do NOT consider playback successful just because /v1/me/player/play
   * returned 204. Playback is only real when player_state_changed reports a
   * current track and paused === false. This waits for exactly that — and if
   * the state arrives with a real track but paused:true, it resumes from this
   * user-gesture path (iOS requires it to come from a gesture).
   */
  async waitForPlaybackStart(timeoutMs = PLAYBACK_WAIT_MS) {
    const player = this.spotifyPlayer;
    if (!player) return false;
    const t0 = performance.now();
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        player.removeListener('player_state_changed', onEvent);
        resolve(ok);
      };
      const onEvent = (st) => {
        if (done) return;
        const t = trackFromSpotify(st?.track_window?.current_track);
        if (t && !st.paused) return finish(true);
        if (t && st.paused) {
          // A real track but paused — resume from this user-gesture path.
          console.log('[Spotify] state reports a real track but paused — resuming.');
          try {
            this.togglePlay();
          } catch (e) {
            console.warn('[Spotify] resume togglePlay failed:', e);
          }
        }
      };
      const poll = async () => {
        if (done) return;
        const st = this._lastState;
        if (st) onEvent(st);
        if (done) return;
        if (performance.now() - t0 > timeoutMs) return finish(false);
        setTimeout(poll, 250);
      };
      player.addListener('player_state_changed', onEvent);
      poll();
    });
  }

  /**
   * The full playlist-start pipeline. Radio calls this from the user's tap;
   * the SDK activation that iPhone insists on happens synchronously before any
   * of the awaits (see Radio.play), so what runs here is the transfer →
   * context → confirm chain:
   *
   *   spotifyPlayer.activateElement()   (already done, in-gesture)
   *   → verify the player is connected
   *   → transfer playback to the SDK device
   *   → PUT /me/player/play with the playlist context URI
   *   → wait for player_state_changed
   *   → verify paused === false
   *   → the radio UI is driven by that state (onUi / onTrack / onPlay)
   */
  async playStation(station) {
    if (!station.uris || !station.uris.length) throw new Error('That station has nothing in it.');
    console.log('[Spotify] playStation:', station.id, JSON.stringify(station.uris));
    // Forget the previous station's state: the confirm wait below must see a
    // player_state_changed that belongs to THIS context, not a stale one from
    // whatever was playing before.
    this._lastState = null;
    // Re-assert SDK activation now the player certainly exists (the in-gesture
    // call at the top of Radio.play may have found no player yet on first use).
    this.activate();
    const ready = await this.ensureConnected();
    if (!ready || !this.deviceId) {
      throw new Error('Spotify couldn’t start a player on this device — is the account on Premium?');
    }
    this.activate();
    // What is the device Spotify would play on, before we touch it?
    await this.logPlaybackState('before play');
    await this.playSpotifyContext(station.uris[0]);
    this.startPolling();
    // Confirm the SDK device actually became the active one and audio should
    // be flowing, rather than assuming a 204 meant success.
    await this.logPlaybackState('after play');
    const started = await this.waitForPlaybackStart();
    if (!started) {
      throw new Error('Spotify started the request but never reported a playing track — tap PLAY to activate audio.');
    }
    console.log('[Spotify] Playback confirmed: player_state_changed reported a real, playing track.');
  }

  /** Warm the player up at startup so the first tap can activateElement()
   *  in-gesture. Never transfers — that would steal a device the user may be
   *  listening on elsewhere. */
  async warmUp() {
    try {
      await this.ensurePlayerOnly();
      console.log('[Spotify] Player warmed up — device id:', this.deviceId);
    } catch (e) {
      console.warn('[Spotify] Warm-up failed (will retry on first play):', e?.message || e);
    }
  }

  dispose() {
    this.stopPolling();
    clearTimeout(this._tokenTimer);
    this.spotifyPlayer?.disconnect();
  }
}

// --- the radio itself -----------------------------------------------------
/**
 * The DOM side of the radio. Talks to a provider through the interface above
 * and to nothing else: no fetch, no sessionStorage, no Spotify imports.
 * There are two halves, both built from markup in index.html:
 *
 *   • Settings — the station picker. Sign in to Spotify, pick a playlist or
 *     search a song, and the run's music becomes it. Also the Spotify debug
 *     panel and the "Tap PLAY to activate Spotify audio" fallback that appears
 *     when the browser blocks autoplay.
 *
 *   • The in-game bar — a tiny card in the corner of the run showing the
 *     ACTUAL current track (from player_state_changed, never assumed), a
 *     ticker that scrolls it when it is too long to fit, and play + skip
 *     buttons underneath. It is hidden while a menu is up, and can be switched
 *     off entirely from Settings ("Radio in game").
 */
export class Radio {
  constructor(ctx) {
    this.ctx = ctx;
    this.provider = new SpotifyProvider();
    this.stations = null;
    this.station = null;
    this.playing = false;
    this.connected = false;
    this.now = null;             // last track the SDK actually reported
    this.enabled = true;         // master switch — OFF stops Spotify + stands controls down
    this.visible = true;         // whether the in-game bar shows at all
    this.inGame = false;         // whether a run (not a menu) is on screen
    this.screen = null;          // current menu name, or null while playing
    this.toastTimer = null;
    this.toastOutTimer = null;
    this._searchTimer = null;

    this.el = {
      bar: ctx.root.querySelector('#radio'),
      stationBtn: ctx.root.querySelector('#radio-station-cycle'),
      track: ctx.root.querySelector('#radio-track'),
      scroll: ctx.root.querySelector('.radio-scroll'),
      prevBtn: ctx.root.querySelector('#radio-prev'),
      playBtn: ctx.root.querySelector('#radio-play'),
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
      enabledBtn: document.getElementById('opt-radio-enabled'),
      visibleBtn: document.getElementById('opt-radio-visible'),
      activate: document.getElementById('radio-activate'),
      debug: document.getElementById('spotify-debug'),
    };
    this.debugIds = {
      sdk: 'dbg-sdk',
      player: 'dbg-player',
      device: 'dbg-device',
      token: 'dbg-token',
      track: 'dbg-track',
      artist: 'dbg-artist',
      album: 'dbg-album',
      paused: 'dbg-paused',
      position: 'dbg-position',
      duration: 'dbg-duration',
      volume: 'dbg-volume',
      api: 'dbg-api',
      event: 'dbg-event',
    };
    // The built-in station is a real playlist now (see audio.js's MUSIC list).
    // As the park's speakers advance to the next local track, this keeps the
    // "now playing" bar and toast honest — but only while Skate FM is the
    // station; while a Spotify station is the radio, the local playlist is
    // ducked to silence and must not talk over it.
    if (this.ctx.audio) {
      this.ctx.audio.onTrack = (track) => {
        if (this.station?.builtin) this.announce(track);
      };
    }
    this.bind();
  }

  bind() {
    const el = this.el;
    // Every one of these buttons drives the SAME authoritative provider/player
    // instance — there is no second radio implementation that could intercept
    // them.
    if (el.stationBtn) el.stationBtn.addEventListener('click', () => this.cycleStation());
    el.prevBtn.addEventListener('click', () => this.previous());
    el.nextBtn.addEventListener('click', () => this.next());
    if (el.playBtn) el.playBtn.addEventListener('click', () => this.playPause());
    if (el.activate) el.activate.addEventListener('click', () => this.onActivate());
    el.login.addEventListener('click', () => this.signIn());
    el.logout.addEventListener('click', () => this.signOut());
    el.visibleBtn.addEventListener('click', () => {
      this.visible = !this.visible;
      this.ctx.save?.setRadioVisible?.(this.visible);
      this.renderVisibleBtn();
      this.renderPlayback();
    });
    // The master switch: OFF stops Spotify and stands every radio control
    // down; ON re-enables it all without starting anything itself.
    el.enabledBtn.addEventListener('click', () => {
      this.setEnabled(!this.enabled);
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
    this.enabled = this.ctx.save?.radioEnabled !== false;
    this.renderEnabledBtn();
    // Apply the saved Spotify volume. The provider re-asserts `_volume` the
    // moment the SDK player connects (and to any player already connected),
    // so this is safe whether or not the session has been restored yet.
    const rv = Number(this.ctx.save?.radioVolume);
    this.provider._volume = Number.isFinite(rv) ? Math.min(1, Math.max(0, rv)) : 1;
    if (this.provider.spotifyPlayer) this.provider.setVolume(this.provider._volume);
    this.provider.onSignOut = () => {
      this.connected = false;
      this.station = null;
      this.playing = false;
      this.now = null;
      this.renderPlayback();
      this.syncPanel();
      this.renderDebug();
      this.ctx.audio?.setMusicDucked(false);
    };
    // player_state_changed is the source of truth for the whole radio UI: it
    // reports the actual current track/artist/album/paused/position/duration,
    // and updateUi renders exactly that.
    this.provider.onUi = (state) => this.updateUi(state);
    this.provider.onAutoplayBlocked = () => this.showActivate();
    try {
      this.connected = await this.provider.restoreSession();
    } catch {
      this.connected = false;
    }
    this.stations = [...ALL_BUILTIN_STATIONS];
    if (this.connected && saved && !saved.startsWith('builtin:')) {
      // Best effort: name the saved station from the playlists if we can,
      // otherwise the park's speakers are the honest stand-in.
      try {
        const list = await this.provider.getStations();
        this.stations = [...ALL_BUILTIN_STATIONS, ...list];
        this.station = list.find((s) => s.id === saved) || ALL_BUILTIN_STATIONS[0];
      } catch {
        this.station = ALL_BUILTIN_STATIONS[0];
      }
    } else {
      this.station = ALL_BUILTIN_STATIONS.find((s) => s.id === saved) || ALL_BUILTIN_STATIONS[0];
    }
    // Tell the audio engine which station to start with on the first unlock().
    // The station's builtinKey maps to audio.js's BUILTIN_STATIONS table.
    if (this.ctx.audio && this.station?.builtinKey) {
      this.ctx.audio.initialStationId = this.station.builtinKey;
    }
    this.renderPlayback();
    this.syncPanel();
    this.renderDebug();
    // Build the SDK player early so the first playlist tap can call
    // activateElement() synchronously inside the gesture (iPhone requirement).
    // This never transfers playback, so it cannot hijack another device.
    if (this.connected) this.provider.warmUp();
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

  /** Reflect the run/menu + the player's on/off choices on the bar itself. */
  syncBar() {
    if (!this.el.bar) return;
    this.el.bar.hidden = !(this.inGame && this.visible && this.enabled);
  }

  /** One place to redraw the bar: the ACTUAL current track (this.now is fed by
   *  player_state_changed, never assumed), the ticker, the play + skip buttons.
   */
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
    // The transport buttons work for both halves of the radio: a connected
    // Spotify station drives the SDK, the built-in Skate FM station drives the
    // local playlist in audio.js (see next()/previous()/playPause()).
    const builtin = this.station?.builtin;
    const controllable = this.enabled && this.station && (builtin || this.connected);
    this.el.prevBtn.disabled = !controllable;
    this.el.nextBtn.disabled = !controllable;
    if (this.el.playBtn) {
      this.el.playBtn.disabled = !controllable;
      const playing = builtin ? !this.ctx.audio?.musicPaused : this.playing;
      this.el.playBtn.textContent = playing ? '⏸' : '▶';
      this.el.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    }
  }

  // All three controls go straight to whichever player is the radio right now:
  // the built-in Skate FM station is answered by audio.js's local playlist, a
  // Spotify station by the same spotifyPlayer instance. They are deliberately
  // NOT async: on iPhone Safari the SDK commands must run inside the user's
  // gesture, so nothing may await between the tap and the SDK method call.
  next() {
    if (!this.enabled || !this.station) return;
    if (this.station.builtin) {
      this.ctx.audio?.nextTrack();
      return;
    }
    if (!this.connected) return;
    try {
      this.provider.nextTrack();
    } catch (e) {
      console.warn('radio:', e);
    }
  }

  previous() {
    if (!this.enabled || !this.station) return;
    if (this.station.builtin) {
      this.ctx.audio?.previousTrack();
      return;
    }
    if (!this.connected) return;
    try {
      this.provider.previousTrack();
    } catch (e) {
      console.warn('radio:', e);
    }
  }

  playPause() {
    if (!this.enabled || !this.station) return;
    if (this.station.builtin) {
      this.ctx.audio?.togglePlay();
      this.renderPlayback();
      return;
    }
    if (!this.connected) return;
    try {
      this.provider.togglePlay();
    } catch (e) {
      console.warn('radio:', e);
    }
  }

  /** Cycle to the next station from the in-game radio bar. The full station
   *  list (built-in + Spotify playlists) is cycled in order, wrapping around
   *  at the end. */
  cycleStation() {
    if (!this.enabled) return;
    const list = this.stations || ALL_BUILTIN_STATIONS;
    if (list.length < 2) return;
    const idx = list.findIndex((s) => s.id === this.station?.id);
    const next = list[(idx + 1) % list.length];
    this.play(next);
  }

  // --- the settings half --------------------------------------------------
  /** The signed-in signed-out split, plus (lazily) the station list. */
  async syncPanel() {
    if (!this.el.list) return;
    this.applyEnabledState();
    const signedIn = this.connected;
    this.el.login.hidden = signedIn;
    this.el.logout.hidden = !signedIn;
    this.renderDebug();
    if (!signedIn) {
      this.el.status.textContent =
        'Connect Spotify and your playlists appear here \u2014 pick one and it plays over the park.';
      this.renderStations(ALL_BUILTIN_STATIONS);
      return;
    }
    this.el.status.textContent = this.stations?.length > ALL_BUILTIN_STATIONS.length ? '' : 'Loading your playlists\u2026';
    try {
      const list = await this.provider.getStations();
      this.stations = [...ALL_BUILTIN_STATIONS, ...list];
      this.renderStations(this.stations);
      if (this.screen === 'settings' && list.length) this.el.status.textContent = '';
    } catch (e) {
      this.el.status.textContent =
        'Couldn\u2019t load your playlists \u2014 check the connection and try again.';
      this.renderStations(ALL_BUILTIN_STATIONS);
    }
  }

  /** When the radio is switched off, every radio control in Settings stands
   *  down too: the login/logout split, the search box, and the station cards
   *  (stationCard() disables those itself). */
  applyEnabledState() {
    const on = this.enabled;
    for (const id of ['radio-settings-login', 'radio-settings-logout', 'radio-search', 'radio-activate']) {
      const n = document.getElementById(id);
      if (n) n.disabled = !on;
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
    } else if (station.icon) {
      art.textContent = station.icon;
    } else if (station.builtin) {
      art.textContent = '\u266A';
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
    btn.disabled = !this.enabled;
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
    this.renderDebug();
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
      this.renderStations(this.stations || ALL_BUILTIN_STATIONS);
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
   *  wallpaper the screen. `this.now` is always kept current (it is what the
   *  bar label shows), the toast only fires when the track actually changed.
   */
  announce(track) {
    if (!track) return;
    const changed = track.id !== this.now?.id;
    this.now = track;
    if (changed && this.el.toastTrack) {
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
    }
    this.renderPlayback();
  }

  // --- playback -----------------------------------------------------------
  /**
   * A playlist card was tapped. On iPhone the Web Playback SDK must be
   * activated inside this gesture — synchronously, before any await — or iOS
   * silently ignores the audio. That call is made right here, at the very top
   * of the handler. The rest of the pipeline runs in startSpotifyPlaylist.
   */
  play(station) {
    if (!this.enabled) return;
    this.station = station;
    if (station.builtin) {
      this.playing = true;
      this.provider.stopPolling();
      // Switch the audio engine to this station's playlist. audio.js owns
      // the actual track list; radio.js just tells it which one.
      const key = station.builtinKey || 'skate-fm';
      this.ctx.audio?.switchStation(key);
      this.emit();
      this.renderPlayback();
      // Announce the current track if the station has one playing, otherwise
      // show the station name as the now-playing placeholder.
      const track = this.ctx.audio?.currentTrack;
      if (track) {
        this.announce(track);
      } else {
        this.announce({ id: key, name: station.name, artists: [station.name] });
      }
      this.syncPanel();
      return;
    }
    if (!this.connected) {
      this.signIn();
      return;
    }
    // The SDK activation must begin inside this click/touch event. Do NOT
    // wait for any promise first — a deferred activateElement() is dead on iOS.
    this.provider.activate();
    this.startSpotifyPlaylist(station).catch((e) => {
      // startSpotifyPlaylist surfaces its own status message; keep the log.
      console.warn('radio:', e);
    });
  }

  /**
   * The one entry point for ALL Spotify playlist playback (requirement: every
   * station change goes through this). Stops nothing explicitly — starting a
   * new context on the active SDK device replaces whatever context is playing,
   * so switching playlists stops the old one and starts the new one in one
   * request.
   */
  async startSpotifyPlaylist(station) {
    this.station = station;
    this.el.status.textContent = 'Starting…';
    // Wire the UI callbacks before playback begins, not after: the SDK can
    // emit its first player_state_changed the moment the play request lands,
    // and the UI must be listening by then.
    this.provider.onTrack = (t) => this.announce(t);
    this.provider.onPlay = (p) => {
      this.playing = p;
      this.renderPlayback();
      this.emit();
    };
    this.provider.onUi = (state) => this.updateUi(state);
    this.provider.onAutoplayBlocked = () => this.showActivate();
    this.hideActivate();
    try {
      await this.provider.playStation(station);
      this.playing = true;
      this.emit();
      this.renderPlayback();
      this.el.status.textContent = '';
      this.syncPanel();
      this.hideActivate();
    } catch (e) {
      this.el.status.textContent = e?.message || 'That station wouldn’t start.';
      throw e;
    }
  }

  /**
   * player_state_changed is the source of truth: whatever Spotify reports —
   * current track, artist, album, paused, position, duration — the radio UI
   * is updated from that state, never from an assumption about the selected
   * playlist.
   */
  updateUi(state) {
    if (!state) return;
    this.renderDebug(state);
    if (state.track) {
      if (state.track.id !== this.now?.id) {
        this.announce(state.track);
      } else {
        this.renderPlayback();
      }
    }
    // Paused is shown in the UI (the play button swaps to ▶) even when a real
    // track is current.
    this.playing = !state.paused;
    this.renderPlayback();
    this.renderStationActive();
  }

  /** Reflect "this playlist is the one whose context is active" on the cards. */
  renderStationActive() {
    if (!this.el.list) return;
    for (const btn of this.el.list.querySelectorAll('.radio-station')) {
      btn.classList.toggle('active', btn.dataset.station === this.station?.id);
    }
  }

  /** The save + duck-theme side of a station change, in one place. */
  emit() {
    if (this.station) this.ctx.save?.setRadioPlaylistId?.(this.station.id);
    // While a real Spotify station is actually playing, the park's own theme
    // stops so the two never stack; the moment Spotify pauses or stops — or
    // the built-in station is the one playing — the theme comes back at the
    // volume the player saved. `this.playing` is fed by onPlay, which the SDK
    // drives from player_state_changed — the source of truth.
    const spotifyPlaying = this.enabled && this.playing && this.station && !this.station.builtin;
    this.ctx.audio?.setMusicDucked(spotifyPlaying);
  }

  // --- the Skate Radio ON/OFF switch --------------------------------------
  /** Master switch. OFF stops Spotify and stands every radio control down;
   *  ON re-enables it all without starting anything itself. */
  setEnabled(on) {
    this.enabled = on !== false;
    if (!this.enabled) this.stopSpotify();
    this.ctx.save?.setRadioEnabled?.(this.enabled);
    this.renderEnabledBtn();
    this.renderPlayback();
    this.syncPanel();
  }

  /** 0..1, the Spotify player's own volume. Persisted and applied live to the
   *  SDK player — the pause menu's slider drives this. */
  setVolume(v) {
    const n = Number(v);
    const vol = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
    this.ctx.save?.setRadioVolume?.(vol);
    this.provider.setVolume(vol);
  }

  /** Turn the radio off: pause whatever Spotify is playing and let the theme
   *  come back at its saved volume. The SDK's own togglePlay is the control,
   *  guarded by the state it reported, so an already-paused player is never
   *  accidentally resumed. */
  stopSpotify() {
    if (this.playing && this.provider.spotifyPlayer) {
      try {
        this.provider.togglePlay();
      } catch (e) {
        console.warn('radio:', e);
      }
    }
    this.playing = false;
    this.ctx.audio?.setMusicDucked(false);
  }

  renderEnabledBtn() {
    if (this.el.enabledBtn) {
      this.el.enabledBtn.textContent = `Skate Radio: ${this.enabled ? 'On' : 'Off'}`;
    }
  }

  // --- autoplay + the debug panel -----------------------------------------
  /** The browser refused autoplay (autoplay_failed). Show the visible
   *  "Tap PLAY" button that re-enters the SDK from a fresh user gesture. */
  showActivate() {
    if (this.el.activate) this.el.activate.hidden = false;
  }

  hideActivate() {
    if (this.el.activate) this.el.activate.hidden = true;
  }

  /** The PLAY button: invoked directly from the user's touch event, so it
   *  re-activates the SDK in-gesture and then re-runs the playback pipeline. */
  async onActivate() {
    if (!this.enabled) return;
    this.provider.activate();
    this.hideActivate();
    if (this.station && !this.station.builtin) {
      this.el.status.textContent = 'Activating…';
      try {
        await this.startSpotifyPlaylist(this.station);
        this.el.status.textContent = '';
      } catch (e) {
        this.el.status.textContent = e?.message || 'Still blocked — try again.';
      }
    } else if (this.provider.spotifyPlayer) {
      try {
        this.provider.togglePlay();
      } catch (e) {
        console.warn('radio:', e);
      }
    }
  }

  /** Temporary Spotify debug panel — every row below is fed by the provider's
   *  live state plus the last SDK event and last API status. */
  renderDebug(state) {
    if (!this.el.debug) return;
    const p = this.provider;
    const s = state || p.lastUiState;
    const set = (key, text) => {
      const node = document.getElementById(this.debugIds[key]);
      if (node) node.textContent = text;
    };
    set('sdk', p.sdkReady || window.Spotify?.Player ? 'LOADED' : 'ERROR / NOT LOADED');
    set('player', p.playerConnected && p.spotifyPlayer ? 'CONNECTED' : 'DISCONNECTED');
    set('device', p.deviceId || '—');
    set('token', p.token ? 'AVAILABLE' : 'MISSING');
    set('track', s?.track?.name || '—');
    set('artist', s?.track?.artists?.join(', ') || '—');
    set('album', s?.track?.album || '—');
    set('paused', s?.paused ? 'TRUE' : 'FALSE');
    set('position', fmtMs(s?.position));
    set('duration', fmtMs(s?.duration));
    set('volume', s?.volume != null ? Math.round(s.volume * 100) + '%' : '—');
    set('api', p.lastApiStatus || '—');
    set('event', p.lastSdkEvent || '—');
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
    this.enabled = true;
    this.renderEnabledBtn();
    this.setVolume(1);
    this.station = ALL_BUILTIN_STATIONS[0];
    this.playing = false;
    this.now = null;
    this.provider.stopPolling();
    this.ctx.audio?.setMusicDucked(false);
    this.renderPlayback();
    this.syncPanel();
    this.renderDebug();
  }
}

/** m:ss, the way a music UI actually shows a progress readout. */
function fmtMs(ms) {
  if (!ms && ms !== 0) return '—';
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
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
    radio.station = ALL_BUILTIN_STATIONS[0];
    radio.renderPlayback();
    radio.syncPanel();
  });
  return radio;
}
