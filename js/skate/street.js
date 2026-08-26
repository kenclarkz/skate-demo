// Street skating mechanics: obstacle definitions, line tracking, and the
// combo multiplier engine.
//
// This module is data-driven — every obstacle type, every allowed transition,
// and every multiplier rule is a plain object so adding new obstacles or
// tweaking combo flow never touches the physics itself. The ride model calls
// into these helpers; this module never touches the height field or the
// renderer.

import * as C from './config.js';
import { landedWeight } from './tricks.js';

// --- obstacle types ------------------------------------------------------
// Each type carries the metadata the physics and HUD need to handle it.
// `kind` matches the surface feature's own kind string so the physics can
// switch on it without another lookup.

export const OBSTACLE = {
  rail:     { kind: 'rail',     label: 'Rail',      grindable: true  },
  ledge:    { kind: 'ledge',    label: 'Ledge',     grindable: true  },
  coping:   { kind: 'coping',   label: 'Coping',    grindable: true  },
  wall:     { kind: 'wall',     label: 'Wall',      wallride: true   },
  pole:     { kind: 'pole',     label: 'Pole',      polejam: true    },
  curb:     { kind: 'curb',     label: 'Curb',      grindable: true  },
  stairs:   { kind: 'stairs',   label: 'Stairs',    launchable: true },
  gap:      { kind: 'gap',      label: 'Gap',       launchable: true },
};

// --- allowed combo transitions -------------------------------------------
// Keys are the current state, values are states that can follow. Anything
// not listed is a disallowed transition that ends the combo (but not
// necessarily the run). A missing entry for a state means "can transition
// to anything" — the open states like AIR and GROUND.
//
// The transitions encode the real skating rules:
//   Manual → Grind is a natural approach
//   Grind → Manual is a natural roll-out
//   Grind → Flip (pop off rail into a flip trick)
//   Grind → Transfer (pop to nearby rail)
//   Manual → Flip (pop out of a manual into a trick)
//   Air trick → Revert (landing backwards, caught by the revert)
//   Grind → Revert (sliding off the end backwards)

export const TRANSITIONS = {
  manual:  ['grind', 'flip', 'ground'],
  grind:   ['manual', 'flip', 'air', 'ground', 'grind'],
  flip:    ['grind', 'manual', 'air', 'ground'],
  air:     ['grind', 'manual', 'ground'],
  ground:  ['air', 'manual', 'grind'],
};

// --- combo line tracker --------------------------------------------------
// Tracks the sequence of trick categories in the current combo so the HUD
// can show the line and the multiplier engine can reward variety.

export class LineTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.categories = [];    // ['flip', 'grind', 'manual', ...]
    this.trickNames = [];    // ['Kickflip', '50-50 Grind', ...]
    this.points = 0;
    this.tiers = 0;          // cumulative technical weight
    this.consecutive = 0;    // tricks in the current consecutive chain
    this.lastCategory = null;
    this.live = false;
  }

  /**
   * Record a trick landing. `category` is one of 'flip', 'shuv', 'grab',
   * 'grind', 'manual', 'wallride', 'wallie', 'polejam', 'revert'.
   * `def` is the trick definition or grind label object.
   * `points` is the base points awarded.
   * `spin` is the body rotation in radians.
   * `fakie` is whether the trick was done fakie.
   */
  addTrick(category, def, points, spin = 0, fakie = false) {
    this.live = true;
    this.categories.push(category);
    this.trickNames.push(def?.name || def || category);
    this.points += points;
    // Technical weight from the trick's own points.
    if (def && typeof def.points === 'number') {
      this.tiers += landedWeight(def, { spin, fakie });
    } else {
      // Grinds and manuals contribute weight from their distance-based points.
      this.tiers += Math.max(1, Math.floor(points / C.COMBO_TECH_WEIGHT));
    }
    // Consecutive tracking: same-category tricks in a row earn extra.
    if (category === this.lastCategory) {
      this.consecutive++;
    } else {
      this.consecutive = 1;
    }
    this.lastCategory = category;
  }

  /**
   * Compute the current multiplier from the accumulated state.
   *
   * The multiplier grows from:
   *   1. Base: COMBO_BASE_MULT
   *   2. Technical tiers: COMBO_MULT_PER_TIER per tier
   *   3. Consecutive same-category tricks: COMBO_CHAIN_BONUS per extra
   *   4. Variety bonus: +0.1 per distinct category in the combo
   */
  multiplier() {
    if (!this.live) return C.COMBO_BASE_MULT;
    let m = C.COMBO_BASE_MULT;
    // Technical weight: harder tricks push the multiplier higher.
    m += this.tiers * C.COMBO_MULT_PER_TIER;
    // Consecutive same-category: rewards doing multiple grinds in a line.
    m += Math.max(0, this.consecutive - 1) * C.COMBO_CHAIN_BONUS;
    // Variety bonus: more distinct categories = higher multiplier.
    const distinct = new Set(this.categories).size;
    m += (distinct - 1) * 0.05;
    return Math.round(m * 100) / 100;
  }

  /**
   * What the combo is worth right now, with the multiplier applied.
   */
  totalScore() {
    return Math.round(this.points * this.multiplier());
  }

  /**
   * The label string for the HUD: "Kickflip + 50-50 + Manual".
   */
  labelString() {
    return this.trickNames.join('  +  ');
  }
}

// --- landing quality display text ----------------------------------------
export const LANDING_TEXT = {
  perfect: 'Perfect landing!',
  clean: 'Clean landing',
  sketchy: 'Sketchy...',
};

// --- bail reasons for the HUD -------------------------------------------
export const STREET_BAIL_TEXT = {
  hit:      'Rolled straight into it',
  primo:    'Landed on the side of the board',
  'slide-out': 'Landed sideways',
  nose:     'Nosedived',
  flat:     'Too far to flat',
  balance:  'Lost it on the rail',
  manual:   'Lost the manual',
  wallride: 'Slid off the wall',
  polejam:  'Lost the jam',
};
