// Service worker for Skate.
//
// Deliberately dumb: an explicit precache list, cache-first, no runtime
// caching. Everything the game needs is known ahead of time, so there is
// nothing to be clever about and plenty to get wrong.
//
// To ship an update: bump VERSION. That is the entire release process.

const VERSION = 'v25';
const CACHE = `skate-${VERSION}`;

// All relative — this worker's scope is the repo's own Pages root.
const ASSETS = [
  'index.html',
  'manifest.webmanifest',
  'css/skate.css',
  // three.module.min.js imports three.core.min.js by relative path. Omitting
  // the core file works fine online and gives a blank screen offline.
  'vendor/three/three.module.min.js',
  'vendor/three/three.core.min.js',
  'js/game/three.js',
  'js/game/geo.js',
  'js/game/pwa.js',
  'js/skate/config.js',
  'js/skate/park.js',
  'js/skate/board.js',
  'js/skate/boards.js',
  'js/skate/outfits.js',
  'js/skate/pants.js',
  'js/skate/accessories.js',
  'js/skate/characters.js',
  'js/skate/character-portrait.js',
  'js/skate/character-preview.js',
  'js/skate/board-design.js',
  'js/skate/board-preview.js',
  'js/skate/custom.js',
  'js/skate/skater.js',
  'js/skate/physics.js',
  'js/skate/tricks.js',
  'js/skate/ragdoll.js',
  'js/skate/walk.js',
  'js/skate/camera.js',
  'js/skate/input.js',
  'js/skate/trail.js',
  'js/skate/hud.js',
  'js/skate/preview.js',
  'js/skate/gesture-diagram.js',
  'js/skate/audio.js',
  'js/skate/save.js',
  'js/skate/ai.js',
  'js/skate/bird.js',
  'js/skate/collectible.js',
  'js/skate/lighting.js',
  'js/skate/radio.js',
  'js/skate/parkObjects.js',
  'js/skate/parkLayouts.js',
  'js/skate/parkFile.js',
  'js/skate/parkStorage.js',
  'js/skate/parkDesigner.js',
  'js/skate/main.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon-180.png',
];

// The one set of real recordings in the app — see audio.js's own comment on
// why this is the deliberate exception to "everything is synthesised." Kept out
// of ASSETS/cache.addAll() on purpose: addAll() is all-or-nothing, and at 5MB
// this is by far the biggest thing here — a flaky connection failing just one
// of these fetches must not take the entire precache, and offline play, down
// with it. They still end up cached, just through their own best-effort adds.
const MUSIC = [
  'audio/theme.mp3',
  'audio/Rnb High Hats, Hip Hop___  (Synth).mp3',
  'audio/Rnb High Hats, Hip Hop___  (Synth) (1).mp3',
];

// Resolved once so the fetch handler can compare pathnames cheaply.
const OWNED = new Set([...ASSETS, ...MUSIC].map((a) => new URL(a, self.registration.scope).pathname));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all([
          // cache:'reload' bypasses the HTTP cache, so a redeploy actually
          // picks up new bytes instead of re-caching whatever the CDN still
          // holds. Everything the game needs to run at all — this must succeed.
          cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))),
          // Best-effort: a game that can be played without music beats an
          // install that fails outright because one music file did not load.
          ...MUSIC.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})),
        ])
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!OWNED.has(url.pathname)) return;

  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req))
  );
});
