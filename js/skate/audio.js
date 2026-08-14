// Every sound but the music is synthesised at runtime, for the same reason
// there are no image files: the whole game is precached for offline play, and
// an oscillator is bytes where a sample is megabytes. The exception is the
// background playlist — a handful of real recordings, see the MUSIC list and
// startMusic() below for why those are real files instead.
//
// The one sound that matters most among the synthesised ones is the roll. A
// skateboard on concrete is filtered noise whose brightness tracks speed, and
// because it is continuous it is the only cue that tells you how fast you are
// going without looking at anything. Everything else — the pop, the landing,
// the grind, the slam — hangs off it.
//
// Three ideas do most of the work of making that read as a skateboard rather than
// as a synthesiser.
//
// Nothing is modulated by a plain LFO. A sine on a gain is a tremolo pedal and
// the ear names it instantly; wheels on concrete wander. So every wobble here is
// driven by the noise buffer played back forty times too slowly, which gives a
// control signal that never repeats inside a session.
//
// The roll is pitched, not just filtered. Bearings and urethane have a note in
// them that climbs with speed, and noise through a moving bandpass does not —
// it just gets brighter. A faint sawtooth underneath is what stops the loop
// sounding like wind.
//
// The rhythm comes from the ground, not the wheels. Wheel rotation at any real
// speed is far too fast to hear as a pulse (a 54mm wheel turns thirty times a
// second at walking pace). What you actually hear is slab joints going under the
// trucks, so the ticks here are scheduled by *distance travelled* rather than by
// time — which means they slow down and speed up with the board for free.
//
// One convolution reverb sits across all of it. A skatepark is a big hard room,
// and dry one-shots in a big hard room are the fastest way to sound like a
// prototype.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// The built-in Skate FM playlist. Track objects double as "now playing" data
// (id/name/artists), so radio.js can announce them without knowing a thing
// about the files behind them. The order here is the order they play in, and
// the loop wraps around the list.
const MUSIC = [
  { url: 'audio/theme.mp3', id: 'theme', name: 'First Push', artists: ['Skate FM'] },
  { url: 'audio/kickflip-kids.mp3', id: 'kickflip-kids', name: 'Kickflip Kids', artists: ['Skate FM'] },
  { url: 'audio/nollie-nights.mp3', id: 'nollie-nights', name: 'Nollie Nights', artists: ['Skate FM'] },
  { url: 'audio/curb-ritual.mp3', id: 'curb-ritual', name: 'Curb Ritual', artists: ['Skate FM'] },
  { url: 'audio/powerslide.mp3', id: 'powerslide', name: 'Powerslide', artists: ['Skate FM'] },
  { url: 'audio/manual-over.mp3', id: 'manual-over', name: 'Manual Over', artists: ['Skate FM'] },
  { url: 'audio/dogtown.mp3', id: 'dogtown', name: 'Dogtown', artists: ['Skate FM'] },
  { url: 'audio/wallride.mp3', id: 'wallride', name: 'Wallride', artists: ['Skate FM'] },
  { url: 'audio/dark-slide.mp3', id: 'dark-slide', name: 'Dark Slide', artists: ['Skate FM'] },
  { url: 'audio/bowl-season.mp3', id: 'bowl-season', name: 'Bowl Season', artists: ['Skate FM'] },
];

export class Audio {
  constructor(on = true) {
    this.ctx = null;
    this.on = on;
    this.rollGain = null;
    this.grindGain = null;
    this.slideGain = null;
    this.speed = 0;
    this.surface = 0;
    // Metres rolled since the last slab joint went under the trucks, and when the
    // last one sounded — see follow(). Distance, not time, is what paces them.
    this.rolled = 0;
    this.lastTick = 0;
    this.lastFollow = 0;
    this.wasSliding = false;
    this.wasReverting = false;
    this.musicVolume = 0.5;
    this.ducked = false; // a real (Spotify) station is the radio — see setMusicDucked
    this.musicSource = null;
    this.musicBuffers = null; // decoded playlist, in play order
    this.musicTracks = null;  // the track objects those buffers came from
    this.musicIndex = 0;      // where the playlist is right now
    this.currentTrack = null; // the last track that actually started playing
    this.onTrack = null;      // (track) => void, fired as each playlist track starts
    this.musicStartTime = 0;  // ctx.currentTime when the current track began
    this.musicPaused = false; // local playlist held by the in-game play button
    this.musicPausedAt = 0;   // seconds into the track where it was paused
  }

  /**
   * Build or resume the context. Must be called from inside a user gesture, and is
   * safe to call on every one — mobile Safari will not start a context otherwise,
   * and the OS can suspend it again at any point.
   */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = this.on ? 0.85 : 0;

      // A safety limiter across the whole mix. Grinding into a rail while the
      // music plays and three one-shots overlap is a combination no amount of
      // hand-balancing every pair of sounds reliably keeps under full scale, and
      // going over does not sound loud, it sounds broken. Set to catch peaks
      // only: a high threshold and a soft knee, so ordinary rolling never
      // touches it and it is inaudible until something would have clipped.
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -3;
      this.limiter.knee.value = 6;
      this.limiter.ratio.value = 12;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.18;
      this.master.connect(this.limiter).connect(ctx.destination);

      // One two-second noise buffer, looped and reused by everything textural.
      const len = Math.floor(ctx.sampleRate * 2);
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      this.buildSpace();
      this.buildRoll();
      this.buildGrind();
      this.buildSlide();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    // Only ever kicked off once — every pointerdown/keydown on the page calls
    // unlock(), and a second fetch-and-decode racing the first would risk two
    // copies of the track playing out of phase with each other. Fire-and-
    // forget is deliberate: unlock() itself stays synchronous, and startMusic()
    // finishing is not something anything else here needs to wait on.
    if (!this.musicStarted) {
      this.musicStarted = true;
      this.startMusic();
    }
  }

  // --- the room -----------------------------------------------------------
  /**
   * A send-and-return reverb that every skate sound goes through, built from a
   * generated impulse rather than a file.
   *
   * A skatepark is a large room with nothing soft in it, and the difference
   * between a dry click and the same click with three-quarters of a second of
   * concrete behind it is most of the difference between a placeholder and
   * something worth listening to. The tail is deliberately short and bright:
   * a long smooth one reads as a cathedral, and the early part is left denser
   * than the exponential alone would make it, because close hard surfaces are
   * what the ear uses to judge the size of a space.
   *
   * The music stays out of it and connects straight to master — a bassline in a
   * park reverb just turns to mud.
   */
  buildSpace() {
    const ctx = this.ctx;
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 1;
    this.sfx.connect(this.master);

    const secs = 0.9;
    const len = Math.floor(ctx.sampleRate * secs);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Two stacked decays: a fast one for the close concrete, a slower one
        // for the rest of the park behind it.
        const env = 0.65 * Math.pow(1 - t, 8) + 0.35 * Math.pow(1 - t, 2.2);
        d[i] = (Math.random() * 2 - 1) * env;
      }
      // A couple of discrete early reflections — flat ground, then the nearest
      // wall. Sparse and offset per channel, which is what gives it any width.
      for (const [ms, amp] of [[11 + ch * 3, 0.5], [27 + ch * 5, 0.32]]) {
        const i = Math.floor((ms / 1000) * ctx.sampleRate);
        if (i < len) d[i] += (Math.random() < 0.5 ? -1 : 1) * amp;
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.26;
    this.sfx.connect(conv).connect(wet).connect(this.master);
    this.reverb = conv;
    this.wet = wet;
  }

  /**
   * A slow random control signal, for modulating a param with something that is
   * not a repeating shape.
   *
   * The same noise buffer as everything else, played back at a fortieth of its
   * rate and then lowpassed hard, which turns two seconds of hiss into eighty
   * seconds of unrepeating wander. Returns the output gain node — connect it to
   * an AudioParam, and set that node's own gain to pick the depth.
   */
  drift(cutoff, depth) {
    const ctx = this.ctx;
    const src = this.source();
    src.playbackRate.value = 0.025;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    lp.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.value = depth;
    src.connect(lp).connect(g);
    src.start();
    return g;
  }

  // --- background music ---------------------------------------------------
  /**
   * The one set of real recordings in the whole game: everything else here is
   * synthesised, for the same reason there are no image files — the game is
   * precached whole for offline play, and an oscillator is bytes where a
   * sample is megabytes. Music is the deliberate exception, because a
   * generated bassline is a passable stand-in for a footstep or a pop but not
   * for a piece of music somebody actually wrote.
   *
   * The built-in Skate FM station is a playlist, not a song: each track is
   * fetched and decoded once, then the three play back to back in a loop —
   * see playMusicTrack(). Every new track announces itself through this.onTrack
   * (radio.js feeds that into the "now playing" bar and toast), and the state
   * never forks because musicStarted is latched before the first fetch and
   * every subsequent unlock() returns early. If any fetch or decode fails —
   * offline before the first load, a browser that chokes on a file — that
   * track is skipped and the rest of the playlist still plays; if none survive
   * it fails quiet rather than fails loud: no music, not a thrown error
   * breaking the rest of unlock().
   */
  async startMusic() {
    const ctx = this.ctx;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.ducked ? 0 : this.musicVolume;
    this.musicGain.connect(this.master);
    const buffers = [];
    const tracks = [];
    for (const track of MUSIC) {
      try {
        const res = await fetch(track.url);
        const buf = await res.arrayBuffer();
        // A second unlock() (every pointerdown calls it) must not race this one
        // and end up decoding — and playing — the tracks twice.
        if (this.musicSource) return;
        buffers.push(await ctx.decodeAudioData(buf));
        tracks.push(track);
      } catch {
        // One bad track skips; the rest of the playlist still plays.
      }
    }
    if (buffers.length === 0 || this.musicSource) return;
    this.musicBuffers = buffers;
    this.musicTracks = tracks;
    this.musicIndex = 0;
    this.playMusicTrack(0);
  }

  /**
   * Start playlist track `i` and chain the next one onto its end.
   *
   * The seam is the Web Audio API's own: each track is a buffer source played
   * through the shared musicGain with loop=false, and when it runs out,
   * onended starts the next one — wrapping around to the top at the end of the
   * list. No scheduling here to get a seam wrong; a track that is still going
   * when the state is torn down has its handler cleared first so nothing fires
   * twice. `at` is a resume offset: pauseMusic() remembers where it stopped,
   * and resumeMusic() hands that back so the pause is seamless rather than a
   * restart.
   */
  playMusicTrack(i, at = 0) {
    const ctx = this.ctx;
    const n = this.musicBuffers.length;
    i = ((i % n) + n) % n;
    // Swapping to a new track — a skip, a resume, or the natural end of the
    // previous one. Detach the old source and stop it so a still-playing track
    // cannot overlap the next and an already-ended one cannot fire twice.
    const prev = this.musicSource;
    if (prev) {
      prev.onended = null;
      try { prev.stop(); } catch {}
    }
    const src = ctx.createBufferSource();
    src.buffer = this.musicBuffers[i];
    src.loop = false;
    src.connect(this.musicGain);
    src.onended = () => {
      if (this.musicSource !== src) return;
      this.musicIndex = (i + 1) % n;
      this.playMusicTrack(this.musicIndex);
    };
    if (at > 0) src.start(0, at);
    else src.start();
    this.musicSource = src;
    this.musicStartTime = ctx.currentTime - at;
    this.musicPaused = false;
    this.currentTrack = this.musicTracks[i];
    this.onTrack?.(this.currentTrack);
  }

  /**
   * The in-game transport for the built-in Skate FM station: skip, back, and
   * play/pause. Spotify's own provider methods answer the same three calls
   * when a connected station is the radio, so radio.js can dispatch either way
   * without caring which one it is talking to.
   */

  /** Skip forward in the local playlist, wrapping around the end. */
  nextTrack() {
    if (!this.musicBuffers?.length) return;
    const n = this.musicBuffers.length;
    this.musicIndex = (this.musicIndex + 1) % n;
    this.musicPausedAt = 0;
    this.playMusicTrack(this.musicIndex);
  }

  /**
   * Skip backward the way a music transport actually behaves: restart a track
   * that has been playing for a few seconds, jump to the previous one if we
   * are still near its start.
   */
  previousTrack() {
    if (!this.musicBuffers?.length) return;
    const n = this.musicBuffers.length;
    if (this.musicSource && this.ctx.currentTime - this.musicStartTime > 3) {
      this.playMusicTrack(this.musicIndex);
    } else {
      this.musicIndex = ((this.musicIndex - 1) % n + n) % n;
      this.musicPausedAt = 0;
      this.playMusicTrack(this.musicIndex);
    }
  }

  /** Pause the local playlist, remembering where it stopped. */
  pauseMusic() {
    if (!this.ready || !this.musicSource || this.musicPaused) return;
    const src = this.musicSource;
    src.onended = null;
    this.musicPausedAt = Math.max(0, this.ctx.currentTime - this.musicStartTime);
    this.musicPaused = true;
    this.musicSource = null;
    try { src.stop(); } catch {}
  }

  /** Resume the local playlist from where pauseMusic() stopped it. */
  resumeMusic() {
    if (!this.ready || !this.musicBuffers?.length || !this.musicPaused) return;
    const at = this.musicPausedAt;
    this.musicPaused = false;
    this.musicPausedAt = 0;
    this.playMusicTrack(this.musicIndex, at);
  }

  /** Play/pause toggle for the in-game transport button on Skate FM. */
  togglePlay() {
    if (!this.ready || !this.musicBuffers?.length) return;
    if (this.musicPaused) this.resumeMusic();
    else this.pauseMusic();
  }

  /**
   * 0..1. Persisted by the caller (main.js, into save.js) — this just applies
   * it to the live node, the same division of labour setCamZoom() etc. use
   * elsewhere. Independent of the master on/off toggle: that one silences
   * everything at once, this is the music's own balance against it.
   */
  setMusicVolume(v) {
    this.musicVolume = clamp(v, 0, 1);
    if (this.musicGain) this.musicGain.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 0.05);
  }

  /**
   * While a real (Spotify) station is the radio, the park's own speakers duck
   * out of the way so the two never stack. The saved music volume still
   * applies to the theme the moment it is actually audible again.
   */
  setMusicDucked(duck) {
    this.ducked = !!duck;
    if (this.musicGain) {
      this.musicGain.gain.setTargetAtTime(this.ducked ? 0 : this.musicVolume, this.ctx.currentTime, 0.05);
    }
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setEnabled(on) {
    this.on = on;
    if (this.master) this.master.gain.value = on ? 0.85 : 0;
  }

  source(loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  /**
   * The rolling loop, in three layers that share one output envelope.
   *
   * The noise bed is what was always here: broadband, through a bandpass that
   * opens up with speed, over a low resonant peak for urethane rumble. On its
   * own it is convincingly *textured* and completely unconvincing as a
   * skateboard, because it has no pitch and no unevenness.
   *
   * So a sawtooth goes underneath it, filtered down to a hum, tracking speed —
   * that is the bearings, and it is what makes accelerating sound like
   * accelerating rather than like a fader moving. And the whole bed passes
   * through a gain that a drift() signal is wobbling, so the texture breathes
   * the way a board crossing uneven ground does.
   */
  buildRoll() {
    const ctx = this.ctx;
    const src = this.source();
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 400;
    band.Q.value = 0.7;
    const low = ctx.createBiquadFilter();
    low.type = 'peaking';
    low.frequency.value = 120;
    low.gain.value = 8;
    low.Q.value = 1.2;

    // The output envelope for every layer: follow() opens and closes this one.
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.sfx);

    // The wander. Centred at 1 so the drift rides either side of unity rather
    // than only ever ducking the signal.
    const grain = ctx.createGain();
    grain.gain.value = 1;
    this.drift(9, 0.34).connect(grain.gain);
    src.connect(band).connect(low).connect(grain).connect(gain);
    src.start();

    // The bearings. A sawtooth is far too buzzy raw, so it goes through a
    // lowpass that keeps only the bottom of it — a hum with a note in it.
    const bear = ctx.createOscillator();
    bear.type = 'sawtooth';
    bear.frequency.value = 50;
    const bearLp = ctx.createBiquadFilter();
    bearLp.type = 'lowpass';
    bearLp.frequency.value = 420;
    bearLp.Q.value = 3;
    const bearGain = ctx.createGain();
    bearGain.gain.value = 0.0;
    bear.connect(bearLp).connect(bearGain).connect(gain);
    bear.start();

    this.rollGain = gain;
    this.rollBand = band;
    this.rollBear = bear;
    this.rollBearGain = bearGain;

    // Wind, for the air. Not part of the roll — it wants its own envelope, since
    // it is loudest exactly when the roll is silent.
    const air = this.source();
    const airLp = ctx.createBiquadFilter();
    airLp.type = 'lowpass';
    airLp.frequency.value = 700;
    airLp.Q.value = 0.6;
    const airGain = ctx.createGain();
    airGain.gain.value = 0;
    air.connect(airLp).connect(airGain).connect(this.sfx);
    air.start();
    this.airGain = airGain;
  }

  /**
   * Grinding: the same noise, far brighter, plus two metallic partials.
   *
   * The important part is that the gain is being chewed by a fast drift signal.
   * A steady bright hiss is a hiss; metal dragging over metal catches and
   * releases dozens of times a second, and that irregularity is the whole
   * character of the sound. Two peaks rather than one because a rail rings at
   * more than one frequency, and a single peak reads as a filter sweep.
   */
  buildGrind() {
    const ctx = this.ctx;
    const src = this.source();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    // Down from 900: cutting everything below that left the grind all top end and
    // no body, measuring nearly twice as bright as any other sound in the game.
    // A truck on a rail has the deck resonating behind it.
    hp.frequency.value = 700;
    // Resonant, but not as resonant as it looks like it should be: two peaking
    // filters stack, so +14 and +9 was +23dB of boost on a broadband source and
    // the grind arrived twice as loud as everything else in the game. These ring
    // clearly and still sit under the roll.
    const ring = ctx.createBiquadFilter();
    ring.type = 'peaking';
    ring.frequency.value = 2600;
    ring.gain.value = 9;
    ring.Q.value = 4;
    const ring2 = ctx.createBiquadFilter();
    ring2.type = 'peaking';
    ring2.frequency.value = 4900;
    ring2.gain.value = 6;
    ring2.Q.value = 7;
    const grain = ctx.createGain();
    grain.gain.value = 1;
    this.drift(40, 0.5).connect(grain.gain);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(hp).connect(ring).connect(ring2).connect(grain).connect(gain).connect(this.sfx);
    src.start();
    this.grindGain = gain;
    this.grindRing = ring;
    this.grindRing2 = ring2;
  }

  /**
   * Powersliding: urethane letting go, which is a scrub with a squeal on top.
   *
   * Brighter and far less regular than the roll, with a high resonant peak for
   * the squeal and a drift on the gain so it bites and slips rather than
   * droning. This layer had no sound at all before — slide() existed but nothing
   * ever called it.
   */
  buildSlide() {
    const ctx = this.ctx;
    const src = this.source();
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1500;
    band.Q.value = 0.8;
    const squeal = ctx.createBiquadFilter();
    squeal.type = 'peaking';
    squeal.frequency.value = 3100;
    squeal.gain.value = 7;
    squeal.Q.value = 6;
    const grain = ctx.createGain();
    grain.gain.value = 1;
    this.drift(22, 0.42).connect(grain.gain);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(band).connect(squeal).connect(grain).connect(gain).connect(this.sfx);
    src.start();
    this.slideGain = gain;
    this.slideBand = band;
    this.slideSqueal = squeal;
  }

  /**
   * Follow the ride. Called every frame with how fast the board is going, whether
   * it is on the ground, and whether it is on a rail.
   */
  follow(speed, grounded, grinding, rough, sliding = false, revert = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const v = clamp(speed / 9, 0, 1.2);
    const rolling = grounded && !grinding;
    const rollTarget = rolling ? 0.02 + v * 0.2 : 0;
    this.rollGain.gain.setTargetAtTime(rollTarget, t, 0.05);
    // Brightness with speed is what makes the loop read as motion rather than as
    // a hiss; the rough surface just gets louder and coarser.
    this.rollBand.frequency.setTargetAtTime(320 + v * 1500 + (rough ? 400 : 0), t, 0.08);
    this.rollBand.Q.setTargetAtTime(rough ? 0.4 : 0.9, t, 0.1);
    // The bearings climb faster than the noise brightens, and fade back in below
    // a walking pace so a near-stationary board hums rather than whines.
    this.rollBear.frequency.setTargetAtTime(46 + v * 150, t, 0.09);
    this.rollBearGain.gain.setTargetAtTime(rolling ? clamp(speed / 3, 0, 1) * 0.05 : 0, t, 0.07);

    // Wind: only in the air, and only fast enough to have any. Quiet on purpose
    // — it is there to make a big air feel like height, not to be noticed.
    const airborne = !grounded && !grinding;
    this.airGain.gain.setTargetAtTime(airborne ? clamp((speed - 3) / 12, 0, 1) * 0.05 : 0, t, 0.12);

    this.grindGain.gain.setTargetAtTime(grinding ? 0.035 + v * 0.105 : 0, t, 0.03);
    if (grinding) {
      this.grindRing.frequency.setTargetAtTime(1800 + v * 2200, t, 0.1);
      this.grindRing2.frequency.setTargetAtTime(4200 + v * 1800, t, 0.1);
    }

    // Powerslide. The bite on the way in is a one-shot on the rising edge, so
    // starting a slide has an attack instead of just fading up.
    const revertNow = revert > 0.02 && rolling && speed > 0.8;
    const slideNow = sliding && rolling && speed > 1.5 && !revertNow;
    this.slideGain.gain.setTargetAtTime(
      slideNow ? 0.045 + v * 0.14 : revertNow ? 0.05 + v * 0.13 : 0,
      t,
      0.04
    );
    if (slideNow) {
      this.slideBand.frequency.setTargetAtTime(1100 + v * 1400, t, 0.1);
      this.slideSqueal.frequency.setTargetAtTime(2600 + v * 1500, t, 0.12);
      if (!this.wasSliding) this.slide();
    }
    this.wasSliding = slideNow;

    // A landing pivot scrubs the wheels sideways across their own axis — the
    // same physics as a powerslide, so it drives the same squeal layer, for
    // the couple of tenths of a second the pivot lasts instead of for as long
    // as the stick is held over. Volume and pitch follow the speed the board
    // is carrying into it, and the layer drops away the moment it finishes.
    if (revertNow) {
      this.slideBand.frequency.setTargetAtTime(1150 + v * 1200, t, 0.1);
      this.slideSqueal.frequency.setTargetAtTime(2700 + v * 1300, t, 0.12);
      if (!this.wasReverting) this.slide();
    }
    this.wasReverting = revertNow;

    // --- slab joints ------------------------------------------------------
    // Paced by ground covered rather than by time, which is what makes them
    // stretch out as the board slows without any rate to tune. Capped, or a
    // rough surface at full speed turns into a drum roll.
    const dt = this.lastFollow ? clamp(t - this.lastFollow, 0, 0.1) : 0;
    this.lastFollow = t;
    if (rolling && speed > 1.2) {
      this.rolled += speed * dt;
      const spacing = rough ? 0.62 : 1.55;
      while (this.rolled > spacing) {
        this.rolled -= spacing;
        if (t - this.lastTick > 0.07) {
          this.lastTick = t;
          this.tick(v, rough);
        }
      }
    } else {
      this.rolled = 0;
    }
  }

  /** One slab joint passing under the trucks: a short, dull, quiet knock. */
  tick(v, rough) {
    this.burst({
      gain: (rough ? 0.05 : 0.035) + v * 0.05,
      freq: rough ? 1500 : 950,
      q: 1.1,
      attack: 0.001,
      decay: rough ? 0.045 : 0.03,
      sweep: 0.5,
    });
  }

  /** A short filtered noise burst: the workhorse behind most of the one-shots. */
  burst({ gain = 0.4, attack = 0.002, decay = 0.14, type = 'bandpass', freq = 800, q = 1, sweep = 0, at = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const src = this.source(false);
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), t + decay);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t);
    src.stop(t + attack + decay + 0.05);
  }

  /**
   * A struck wooden body, by modal synthesis: a two-millisecond noise impulse
   * through a bank of high-Q bandpasses, each ringing on at its own frequency
   * and dying at its own rate.
   *
   * This is what a deck actually is, acoustically — a plate with several modes
   * that all sound at once when you slam its tail into concrete. One oscillator
   * cannot do it: a single decaying tone is a beep, and it was the reason the
   * old pop sounded like a game and not like a board. The strike itself is
   * shorter than the ear can resolve, so everything audible here is the filters
   * ringing, which is exactly the mechanism being modelled.
   */
  knock({ freqs, gain = 0.3, decay = 0.13, q = 14, at = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const src = this.source(false);
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    // The strike: a hard 2ms window on the noise, which is the impulse the
    // modes get excited by.
    const hit = ctx.createGain();
    hit.gain.setValueAtTime(1, t);
    hit.gain.setValueAtTime(0, t + 0.002);
    src.connect(hit);

    freqs.forEach((freq, i) => {
      // Upper modes are quieter and die sooner, which is true of every struck
      // solid and is what keeps the stack from sounding like a chord.
      const fall = 1 / (1 + i * 0.9);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain * fall, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay * fall);
      hit.connect(f).connect(g).connect(this.sfx);
    });
    src.start(t);
    src.stop(t + decay + 0.05);
  }

  /** A short pitched thump, for the tail hitting concrete. */
  thump(freq, gain, decay) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, t + decay);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g).connect(this.sfx);
    osc.start(t);
    osc.stop(t + decay + 0.02);
  }

  // --- one-shots ---------------------------------------------------------
  /**
   * The tail snapping down: a hard wooden crack.
   *
   * Three things at once, which is what the real sound is. The deck's own modes
   * ringing (knock), a low thump for the weight going through it, and a scrape
   * of griptape as the front foot drags up the board. Popping higher means
   * hitting the tail harder, so the crack gets louder and the modes drop a
   * little — a harder strike excites more of the low end of a plate.
   */
  pop(height = 0.5) {
    const hard = clamp(height / 1.2, 0.2, 1);
    const bend = 1 - hard * 0.08;
    this.knock({
      freqs: [196 * bend, 470 * bend, 1080 * bend, 2350 * bend],
      gain: 0.34 + hard * 0.18,
      decay: 0.1,
      q: 13,
    });
    this.thump(180 - hard * 45, 0.26, 0.085);
    // The front foot going up the grip, a hair after the tail lands.
    this.burst({ gain: 0.11 + hard * 0.07, freq: 3400, q: 0.7, decay: 0.075, sweep: 0.45, at: 0.012 });
  }

  /**
   * Wheels coming back down.
   *
   * Two knocks, not one: the trucks never touch down together, and the dozen
   * milliseconds between them is the difference between landing a board and
   * dropping a box. Harder landings put the gap wider and the pitch lower, and
   * add a chirp of urethane scrubbing off the speed it cannot keep.
   */
  land(impact = 3) {
    const hard = clamp(impact / 8, 0.2, 1);
    const gap = 0.011 + hard * 0.016;
    this.knock({ freqs: [150 - hard * 30, 380, 900], gain: 0.24 + hard * 0.2, decay: 0.1 + hard * 0.05, q: 10 });
    this.knock({ freqs: [168 - hard * 30, 430, 1020], gain: 0.2 + hard * 0.18, decay: 0.1, q: 10, at: gap });
    this.thump(150 - hard * 50, 0.24 + hard * 0.3, 0.12 + hard * 0.1);
    // Wheels scrubbing. Grows with the landing, because that is the speed the
    // urethane is having to absorb sideways.
    this.burst({ gain: 0.1 + hard * 0.22, freq: 1100, q: 0.6, decay: 0.09 + hard * 0.1, sweep: 0.3, at: gap });
  }

  /**
   * Locking onto a rail: metal meeting metal, and the deck taking the hit.
   *
   * Louder than the numbers suggest it needs to be, because a Q-3 bandpass on
   * broadband noise throws most of the energy away — measured at the output this
   * was a fifth the level of a landing, for what should be just as definite a
   * moment.
   */
  lock() {
    this.burst({ gain: 0.55, freq: 3200, q: 2, decay: 0.12, sweep: 0.5 });
    // High, tight modes — this is aluminium on steel, not wood on concrete.
    this.knock({ freqs: [620, 1450, 3300], gain: 0.3, decay: 0.16, q: 20 });
  }

  /**
   * A hand finding the board: a soft, quiet catch, not a hit. This marks the
   * moment a grab starts — there is no sound for it ending, since letting go
   * is silent and the points already speak for themselves through the
   * ordinary trick chime.
   */
  grab() {
    this.burst({ gain: 0.14, freq: 1700, q: 2, decay: 0.05, sweep: 0.75 });
  }

  /** A shoe pushing off concrete: a scuff, then the foot back on the deck. */
  push() {
    this.burst({ gain: 0.32, freq: 700, q: 0.5, decay: 0.22, sweep: 0.5 });
    this.knock({ freqs: [240, 560], gain: 0.09, decay: 0.05, q: 8, at: 0.14 });
  }

  /** Urethane giving up — the bite as a powerslide breaks traction. */
  slide() {
    this.burst({ gain: 0.26, freq: 1400, q: 0.7, decay: 0.3, sweep: 0.4 });
    this.burst({ gain: 0.14, freq: 2900, q: 2.5, decay: 0.22, sweep: 0.7, at: 0.02 });
  }

  /**
   * The slam: a body and a board arriving separately.
   *
   * The board's clatter is scheduled on the audio clock rather than by setTimeout
   * now, and it bounces twice — a loose deck never lands once. A timer would put
   * it wherever the main thread happened to get round to it, which for something
   * meant to read as a specific moment after the body is exactly the wrong place.
   */
  bail() {
    this.thump(90, 0.5, 0.3);
    this.burst({ gain: 0.4, freq: 500, q: 0.4, decay: 0.4, sweep: 0.2 });
    if (!this.ready) return;
    this.knock({ freqs: [175, 420, 990], gain: 0.26, decay: 0.16, q: 11, at: 0.12 });
    this.burst({ gain: 0.22, freq: 1800, q: 1.4, decay: 0.3, sweep: 0.3, at: 0.13 });
    // and again, quieter, as it settles
    this.knock({ freqs: [165, 400, 950], gain: 0.15, decay: 0.13, q: 11, at: 0.29 });
    this.knock({ freqs: [160, 390], gain: 0.08, decay: 0.1, q: 11, at: 0.44 });
  }

  /** Banking a combo. Two notes, so it reads as a reward and not as an alert. */
  chime(big) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const notes = big ? [523.25, 659.25, 783.99] : [523.25, 659.25];
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0;
      const at = t + i * 0.07;
      g.gain.linearRampToValueAtTime(0.16, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
      osc.connect(g).connect(this.sfx);
      osc.start(at);
      osc.stop(at + 0.45);
    });
  }

  /** A logo picked up: a bright, single ping, distinct from a combo's chime. */
  collect() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.exponentialRampToValueAtTime(1500, t + 0.09);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.24, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(g).connect(this.sfx);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  /** Everything quiet, for a pause or a menu. */
  hush() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (const g of [this.rollGain, this.grindGain, this.slideGain, this.airGain, this.rollBearGain]) {
      g.gain.setTargetAtTime(0, t, 0.05);
    }
    this.wasSliding = false;
    this.rolled = 0;
  }
}
