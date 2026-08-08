# Skate

A physics-driven skateboarding game. No animation data anywhere — the
skater's pose is a function of the physics state each frame: how deep the
crouch is, how far the board is leaned, where in a flip's rotation it is
right now. Turning is a balance problem (lean by θ, commit to `g·tanθ` of
lateral acceleration); ollies are ballistic (`v = √(2gh)`); landings keep
whatever part of the velocity lies in the surface plane and hand the rest to
the legs to absorb.

Play it at **[kenclarkz.github.io/skate-demo](https://kenclarkz.github.io/skate-demo/)**.

## What's in it

- **Fourteen parks**, built from the same height-field primitives, so the
  physics is identical everywhere the geometry differs. Every one of them
  but Open World — deliberately built with no fence, to be roamed past its
  own pad — keeps every wheel, yours and the AI's, on the concrete itself.
  Open World is the biggest of them by far: two deep four-wall bowls, two
  mega-ramp drop-ins tall enough to need their own approach climb, and a
  gap jump with a ring hanging over it to fly through, on top of the
  original street spot, hill, and manual pad.
- **Flick-It input** — pull back to charge, flick the direction your front
  foot would go. Works the same from a touchscreen drag, a mouse, a real
  gamepad stick, or the keyboard.
- **Sixteen tricks** — flips, shove-its, and their 360/curled variants, plus
  five air-only grabs (indy, mute, nose, tail, method), each held down
  rather than flicked.
- **Grinds, manuals, and powerslides**, each riding the same balance model:
  an inverted pendulum with a random bias, so holding one always takes
  active correction.
- **Automatic reverts** — land with the board off the direction of travel
  and the wheels pivot it back under you in a smooth fraction of a second:
  a little speed and a wheel chirp instead of the sketchy wobble (and past
  the limit it still slides out).
- **A ragdoll bail system** — a Verlet-integrated body picks up the board's
  velocity and spin at the moment of the slam and carries it into the fall.
  A slam doesn't stop the run: the rider gets back up where they came down
  and carries on.
- **Walking mode** — step off the board to explore a park on foot, board
  carried in hand, and hop back on wherever you are.
- **Eight skaters**, each with their own headwear and palette, picked from a
  skater rack in the shop — from the everyday four up to the legendaries
  (a tiger, the not-quite-Birdman, a bunny, and a garden gnome); a shop full
  of purchasable board skins, shirts, and headwear accessories (hats and
  shades), paid for with coins earned from tricks and combos.
- **Thirteen ambient AI skaters per park** — five tour the patrol loop the
  whole time, popping tricks with the exact same ride model the player
  rides; the rest spend most of their time on foot near a hangout spot,
  wandering and pausing to face each other, until a shared timer calls the
  whole crowd in for a group ride together — before they dismount and go
  back to hanging out. Plus circling birds and six collectible logos per
  park.
- **A real background music track**, with its own volume slider, alongside
  synthesized sound effects — every roll, pop, grind, land, and slam is
  built from oscillators and filtered noise at runtime rather than a sample.
- **A Settings screen** — top speed, camera distance, music volume, sound
  on/off, and a hold-to-push toggle (hold the push key/thumb to repeat
  automatically, or turn it off for one push per press) all live together.
- **A mobile pause button** — shown while skating or walking, with a Home
  Screen option to leave the run entirely.
- **A step-through tutorial** covering every move, for keyboard, touch, and
  gamepad at once.

## Running it locally

No build step — the whole game is bare ES modules loaded straight in the
browser. Serve the repo root over HTTP (module imports don't work from
`file://`) and open `index.html`:

```sh
npx http-server . -p 8080
```

## Testing

`tools/skate-smoke.mjs` is a headless Playwright suite that checks the
physics against real arithmetic rather than recorded values — a ballistic
apex really is `v²/2g`, a carve radius really is `v²/(g·tanθ)` — so the
"the movement is realistic" claim stays honest as the code changes.

```sh
npx http-server /workspace -p 8080 -c-1 &
node tools/skate-smoke.mjs
```

`tools/skate-shot.mjs` poses the rig at the moments most likely to break
(mid-ollie, mid-kickflip, a grind, a slam) and saves a screenshot of each,
for fast visual iteration.

## The Spotify radio

The radio in Settings can stream a connected player's Spotify playlists and
search results. Because this is a static site with nowhere to hide a secret,
it uses the PKCE flow plus the Web Playback SDK, and the app's **Client ID**
lives in one constant — `CLIENT_ID` at the top of `js/skate/radio.js`. That id
must belong to a registered Spotify app: an id Spotify doesn't recognise makes
the login attempt land on a dead-end `client_id: Invalid` white page (the game
now checks for that and explains it in the Settings panel instead). To wire up
your own app:

1. Create an app at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) ("Create app").
2. Under *Edit settings → Redirect URIs*, add the exact URLs the game runs at
   (trailing slashes matter — each must match the address bar exactly):
   - `https://kenclarkz.github.io/skate/` for the GitHub Pages build
   - `http://127.0.0.1:8080/` for local development (the loopback IP — Spotify
     no longer accepts `localhost` aliases)
3. Enable **Web Playback SDK** on the app, and while it is in Development Mode
   add the Spotify account(s) that should use it under *Users and access*.
4. Copy the app's **Client ID** into `CLIENT_ID` in `js/skate/radio.js` and
   deploy — the radio then lets connected players sign in and pick a playlist.
