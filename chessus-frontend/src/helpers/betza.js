/*
 * Betza notation -> the piece wizard's movement and attack settings.
 *
 * Betza notation describes a piece in a few letters: capital letters are basic
 * moves ("atoms"), lower-case letters in front of one change it. "N" is a
 * knight, "Q" a queen, "mfWcfF" a pawn's step and capture. See
 * https://philchute.com/Chess/Parser for a full reference.
 *
 *   parseBetza(code)          -> { parts, warnings, error }   (also feeds the translation)
 *   betzaToPieceData(code)    -> { updates, warnings, error } (hand updates to updatePieceData)
 *
 * WHAT MAPS WHERE, and why:
 *
 *   W, F (steps) and their riders (R, B, Q, WW, F3 ...)  per-direction distances
 *       (1, N, or 99 for unlimited). These slide, as the site's directions do.
 *   D, A, H, G and (k,0)/(k,k) leaps                      custom squares - a leap
 *       jumps, and a site direction with a distance does not.
 *   ...ridden (DD), or lame (nD - may not jump)            the direction at an
 *       exact distance (repeating, for a rider), which is blocked like a slide.
 *   N, C, Z and other oblique leaps                        the L-shape ratio, when
 *       it is the piece's first and is unrestricted; as custom squares otherwise.
 *   ...ridden (NN, N3)                                     a repeating ratio.
 *   i (first move only) on a step or slide                 the direction's "first
 *       N moves", or an alternative movement when the direction already has one
 *       (a pawn's double step).
 *   e (en passant), O (castling)                           the piece's own flags.
 *   p (cannon) on a slide (pR, pB, pQ)                     "must hop" with at most
 *       one piece to hop: it moves and captures only over exactly one piece.
 *       mRcpR (the xiangqi cannon) moves as a rook and captures over a screen.
 *   g (grasshopper) on a slide (gQ)                        the same, landing at
 *       most one square past the piece it hops: right behind it.
 *
 * HOPPING. A site L-shaped move, or an exact distance, is BLOCKED by pieces in
 * its path unless the piece may hop - so every leap the code names sets the hop
 * flags (a knight jumps), and slides are kept from hopping with them by
 * "directional hop disabled", which leaves exact distances hopping. A rider of
 * leaps (NN, DD) also stops at the first piece ON its line of landings
 * ("stop at occupied"), and hops everything between them. See hopSettings.
 *
 * Directions are from the piece owner's side: f = forward = "up".
 * Anything the site cannot express is reported, never silently dropped.
 */

const ATOMS = {
  W: { leap: [1, 0], name: 'Wazir', says: 'one square orthogonally (up, down, left or right)' },
  F: { leap: [1, 1], name: 'Ferz', says: 'one square diagonally' },
  D: { leap: [2, 0], name: 'Dabbaba', says: 'a jump of exactly two squares orthogonally' },
  N: { leap: [2, 1], name: 'Knight', says: 'a jump two squares one way and one square sideways (an L)' },
  A: { leap: [2, 2], name: 'Alfil', says: 'a jump of exactly two squares diagonally' },
  H: { leap: [3, 0], name: 'Threeleaper', says: 'a jump of exactly three squares orthogonally' },
  C: { leap: [3, 1], name: 'Camel', says: 'a jump three squares one way and one sideways' },
  L: { leap: [3, 1], name: 'Camel', says: 'a jump three squares one way and one sideways (L is another letter for C)' },
  Z: { leap: [3, 2], name: 'Zebra', says: 'a jump three squares one way and two sideways' },
  J: { leap: [3, 2], name: 'Zebra', says: 'a jump three squares one way and two sideways (J is another letter for Z)' },
  G: { leap: [3, 3], name: 'Tripper', says: 'a jump of exactly three squares diagonally' },
};
// Shorthands for common combinations, each as the atoms it stands for.
const COMPOUNDS = {
  K: { atoms: ['W', 'F'], rider: false, name: 'King', says: 'one square in any direction (W + F)' },
  R: { atoms: ['W'], rider: true, name: 'Rook', says: 'any distance orthogonally (a W rider, WW)' },
  B: { atoms: ['F'], rider: true, name: 'Bishop', says: 'any distance diagonally (an F rider, FF)' },
  Q: { atoms: ['W', 'F'], rider: true, name: 'Queen', says: 'any distance in any straight line (R + B)' },
};

const MODIFIERS = {
  m: 'move only - it cannot capture this way',
  c: 'capture only - it can only move this way to take a piece',
  i: 'first move only - available until the piece has moved',
  f: 'forward', b: 'backward', l: 'left', r: 'right',
  v: 'vertical - forward and backward', s: 'sideways - left and right',
  n: 'lame - may not jump; the path must be clear',
  e: 'en passant - may capture a piece that just passed it',
  j: 'must jump over a piece', p: 'cannon-style - must hop over exactly one piece',
  g: 'grasshopper - lands just beyond the piece it hops', o: 'wraps around the board edge (cylinder)',
  h: 'half the directions (chiral)', q: 'circular', z: 'zig-zag', x: 'explodes the squares around it',
  a: 'moves again', y: 'turns into a slider after', t: 'then', u: 'unloads (relocates) the captured piece',
  w: 'transfers its power',
};
const SUPPORTED_MODS = new Set(['m', 'c', 'i', 'f', 'b', 'l', 'r', 'v', 's', 'n', 'e', 'p', 'g']);
const DIRECTION_LETTERS = new Set(['f', 'b', 'l', 'r', 'v', 's']);
const PAIRS = new Set(['fl', 'lf', 'fr', 'rf', 'bl', 'lb', 'br', 'rb', 'ff', 'bb', 'll', 'rr', 'fs', 'sf', 'bs', 'sb', 'lv', 'vl', 'rv', 'vr', 'fh', 'bh']);

const DIRS = ['up_left', 'up', 'up_right', 'right', 'down_right', 'down', 'down_left', 'left'];

/* ------------------------------------------------------------------ parse -- */

/**
 * Split a code into parts: { text, mods, atom, leap, rider, range, notes, unsupported }.
 * `rider` is true for any range beyond one (doubled letter, or a number);
 * `range` is the limit, 0 meaning unlimited.
 */
export function parseBetza(raw) {
  const code = String(raw || '').replace(/\s+/g, '');
  const parts = [];
  const warnings = [];
  if (!code) return { parts, warnings, error: null };
  let i = 0;
  while (i < code.length) {
    const start = i;
    let mods = '';
    while (i < code.length && /[a-z]/.test(code[i])) mods += code[i++];
    let atom = null;
    let leap = null;
    if (code[i] === '(' ) {
      const m = /^\((\d+),(\d+)\)/.exec(code.slice(i));
      if (!m) return { parts, warnings, error: `"${code.slice(i, i + 8)}" is not a leap - write it as (x,y), e.g. (1,3).` };
      leap = [Math.max(+m[1], +m[2]), Math.min(+m[1], +m[2])];
      if (leap[0] === 0) return { parts, warnings, error: '(0,0) is not a move.' };
      atom = m[0];
      i += m[0].length;
    } else if (i < code.length && /[A-Z]/.test(code[i])) {
      atom = code[i++];
      if (atom === 'O') {
        // Castling: O with how far the king goes (O2 in standard chess).
        let n = '';
        while (i < code.length && /\d/.test(code[i])) n += code[i++];
        parts.push({ text: code.slice(start, i), mods, atom: 'O', castle: Number(n) || 2, notes: [], unsupported: [] });
        continue;
      }
      if (!ATOMS[atom] && !COMPOUNDS[atom]) {
        return { parts, warnings, error: `"${atom}" is not a Betza letter this importer knows. Known: ${[...Object.keys(ATOMS), ...Object.keys(COMPOUNDS)].join(' ')}, O (castling) and (x,y) leaps.` };
      }
    } else {
      const bad = i < code.length ? `"${code[i]}"` : 'the end of the code';
      return { parts, warnings, error: mods ? `"${mods}" has no piece letter after it.` : `Unexpected ${bad}.` };
    }
    // Range: a doubled letter (rider, unlimited) or a number (0 = unlimited).
    let rider = !!COMPOUNDS[atom]?.rider;
    let range = rider ? 0 : 1;
    if (atom.length === 1 && code[i] === atom) { rider = true; range = 0; i += 1; }
    let n = '';
    while (i < code.length && /\d/.test(code[i])) n += code[i++];
    if (n !== '') { range = Number(n); rider = range !== 1; }
    const unsupported = [...new Set(mods.split('').filter((c) => !SUPPORTED_MODS.has(c)))];
    parts.push({ text: code.slice(start, i), mods, atom, leap: leap || ATOMS[atom]?.leap || null, rider, range, notes: [], unsupported });
  }
  return { parts, warnings, error: null };
}

/* ---------------------------------------------------------------- vectors -- */

/** Every (dx, dy) of a leap, dy negative = forward. */
function leapVectors([a, b]) {
  const out = new Map();
  for (const [x, y] of [[a, b], [b, a]]) {
    for (const sx of [1, -1]) for (const sy of [1, -1]) {
      const v = [x * sx, y * sy];
      out.set(`${v[0]},${v[1]}`, v);
    }
  }
  return [...out.values()];
}

/*
 * The direction letters of a part, as filters over its vectors. A pair of
 * letters that names one direction ("fl", "ff", "fs") narrows; separate
 * letters add up ("fb" = forward and backward). On an oblique leap the doubled
 * letter means the steep moves (ff = the two straight-ahead knight moves) and
 * "fs" the wide ones.
 */
function directionFilter(mods) {
  const letters = mods.split('').filter((c) => DIRECTION_LETTERS.has(c) || c === 'h');
  if (!letters.length) return null;
  const units = [];
  for (let k = 0; k < letters.length; k++) {
    const pair = letters[k] + (letters[k + 1] || '');
    if (PAIRS.has(pair)) { units.push(pair); k++; } else units.push(letters[k]);
  }
  const one = (u, dx, dy) => {
    const steep = Math.abs(dy) > Math.abs(dx);
    const wide = Math.abs(dx) > Math.abs(dy);
    switch (u) {
      case 'f': return dy < 0;
      case 'b': return dy > 0;
      case 'l': return dx < 0;
      case 'r': return dx > 0;
      case 'v': return dx === 0 || (dy !== 0 && steep) || (Math.abs(dx) === Math.abs(dy));
      case 's': return dy === 0 || (dx !== 0 && wide) || (Math.abs(dx) === Math.abs(dy));
      default: return false;
    }
  };
  const pairFn = (u, dx, dy) => {
    const [p, q] = u.split('');
    if (p === q) { // ff, bb, ll, rr: steep / wide in that direction
      if (p === 'f' || p === 'b') return one(p, dx, dy) && (Math.abs(dy) > Math.abs(dx) || dx === 0);
      return one(p, dx, dy) && (Math.abs(dx) > Math.abs(dy) || dy === 0);
    }
    if (u.includes('s') && (u.includes('f') || u.includes('b'))) {
      return one(u.replace('s', ''), dx, dy) && (Math.abs(dx) > Math.abs(dy) || dy === 0);
    }
    if (u.includes('v') && (u.includes('l') || u.includes('r'))) {
      return one(u.replace('v', ''), dx, dy) && (Math.abs(dy) > Math.abs(dx) || dx === 0);
    }
    if (u.includes('h')) return one(u.replace('h', ''), dx, dy);
    return one(p, dx, dy) && one(q, dx, dy);
  };
  return (dx, dy) => units.some((u) => (u.length === 2 ? pairFn(u, dx, dy) : one(u, dx, dy)));
}

const dirName = (dx, dy) => {
  const v = dy < 0 ? 'up' : dy > 0 ? 'down' : '';
  const h = dx < 0 ? 'left' : dx > 0 ? 'right' : '';
  return [v, h].filter(Boolean).join('_');
};

/* --------------------------------------------------------------- explain -- */

/** One part, letter by letter, for the translation panel. */
export function explainPart(part) {
  const rows = [];
  for (const c of part.mods) {
    rows.push({ symbol: c, meaning: MODIFIERS[c] || 'unknown modifier', supported: SUPPORTED_MODS.has(c) });
  }
  if (part.atom === 'O') {
    rows.push({ symbol: `O${part.castle}`, meaning: `castling - the king moves ${part.castle} squares toward a rook`, supported: true });
    return rows;
  }
  const a = ATOMS[part.atom] || COMPOUNDS[part.atom];
  const leapText = part.leap ? `a leap of ${part.leap[0]},${part.leap[1]}` : '';
  rows.push({ symbol: part.atom, meaning: a ? `${a.name}: ${a.says}` : leapText, supported: true });
  if (part.text.length > part.mods.length + part.atom.length) {
    const tail = part.text.slice(part.mods.length + part.atom.length);
    rows.push({
      symbol: tail,
      meaning: part.range === 0 ? 'repeated in a line, any distance (a rider)' : `repeated up to ${part.range} times in a line`,
      supported: true,
    });
  }
  return rows;
}

/** The whole move of one part in a sentence. */
export function describePart(part) {
  if (part.atom === 'O') return `Castles (the king moves ${part.castle}).`;
  const kinds = part.mods.includes('m') ? 'Moves (no capture)' : part.mods.includes('c') ? 'Captures only' : 'Moves and captures';
  const DIR_WORDS = { f: 'forward', b: 'backward', l: 'left', r: 'right', v: 'forward and backward', s: 'sideways' };
  const dir = part.mods.split('').filter((c) => DIRECTION_LETTERS.has(c)).map((c) => DIR_WORDS[c]).join(', ');
  const a = ATOMS[part.atom] || COMPOUNDS[part.atom];
  const what = a ? a.name : `${part.leap[0]},${part.leap[1]}-leaper`;
  const range = part.rider ? (part.range ? `, up to ${part.range} in a line` : ', any distance in a line') : '';
  return `${kinds}: ${what}${dir ? ` (${dir})` : ''}${range}${part.mods.includes('i') ? ', on its first move only' : ''}.`;
}

/* ------------------------------------------------------------ piece data -- */

/** The movement/attack fields a Betza fill replaces, cleared. */
function blankMovementAndAttack() {
  const out = {
    directional_movement_style: false, repeating_movement: false,
    ratio_movement_style: false, ratio_one_movement: null, ratio_two_movement: null,
    repeating_ratio: false, max_ratio_iterations: null, min_ratio_iterations: null,
    step_by_step_movement_style: false, step_by_step_movement_value: null, step_by_step_movement_no_orthogonal: false,
    can_hop_over_allies: false, can_hop_over_enemies: false,
    custom_movement_squares: null, special_scenario_moves: '',
    directional_movement_change: false,
    can_capture_enemy_on_move: false, attacks_like_movement: false,
    repeating_capture: false,
    ratio_one_capture: null, ratio_two_capture: null, repeating_ratio_capture: false, max_ratio_capture_iterations: null,
    step_by_step_capture: null, step_by_step_capture_no_orthogonal: false,
    can_hop_attack_over_allies: false, can_hop_attack_over_enemies: false,
    custom_attack_squares: null, special_scenario_capture: '',
    directional_capture_change: false,
    first_move_only: false, first_move_only_capture: false,
    ratio_path_order: null, ratio_path_order_attack: null,
    ratio_path_blocking: null, ratio_path_blocking_attack: null,
    ratio_path_corner_blocks: null, ratio_path_corner_blocks_attack: null,
    max_repeating_movement: null, max_repeating_capture: null,
  };
  for (const d of DIRS) {
    for (const kind of ['movement', 'capture']) {
      out[`${d}_${kind}`] = 0;
      out[`${d}_${kind}_exact`] = false;
      out[`${d}_${kind}_available_for`] = null;
    }
  }
  return out;
}

/*
 * The hop settings a piece's parts need, per kind (movement / capture).
 *
 *   leap    an L-shaped move: it jumps, so the piece may hop allies and enemies.
 *           The site's L-move uses the MOVEMENT hop flags for its path even
 *           when it captures, so a capturing leap sets both sets of flags.
 *   ride    a rider of leaps (NN, DD): hops between landings, stops at the
 *           first piece standing on one (hop_stop_at_occupied).
 *   slide   W / F slides: must not hop. With any hopping on, "directional hop
 *           disabled" keeps them blocked; exact distances still hop.
 *   lameExact  nD: an exact distance that may NOT jump - which hopping, once
 *           on for anything else, would let it do. Reported.
 *   cannon  p on a slide: may only move by hopping, over exactly one piece.
 *   grasshopper  g on a slide: the same, landing right behind the piece hopped.
 */
function hopSettings(needs, warnings) {
  const out = {
    can_hop_over_allies: false, can_hop_over_enemies: false,
    can_hop_attack_over_allies: false, can_hop_attack_over_enemies: false,
    directional_hop_disabled: false, directional_hop_disabled_attack: false,
    hop_stop_at_occupied: false, hop_stop_at_occupied_attack: false,
    directional_hop_only: false, directional_hop_only_attack: false,
    max_directional_hop_pieces: null, max_directional_hop_pieces_attack: null,
    min_directional_hop_pieces: null, min_directional_hop_pieces_attack: null,
    hop_landing_distance: null, hop_landing_distance_attack: null,
  };
  const m = needs.movement;
  const c = needs.capture;
  const hopsM = m.leap || m.ride || m.cannon || m.grasshopper || c.leap;
  const hopsC = c.leap || c.ride || c.cannon || c.grasshopper;
  if (hopsM) { out.can_hop_over_allies = true; out.can_hop_over_enemies = true; }
  if (hopsC) { out.can_hop_attack_over_allies = true; out.can_hop_attack_over_enemies = true; }
  if (hopsM && m.slide) out.directional_hop_disabled = true;
  if (hopsC && c.slide) out.directional_hop_disabled_attack = true;
  // The server's straight-line walk reads the MOVEMENT flag for captures too.
  if (m.ride || c.ride) out.hop_stop_at_occupied = true;
  if (c.ride) out.hop_stop_at_occupied_attack = true;
  if (m.cannon || m.grasshopper) { out.directional_hop_only = true; out.max_directional_hop_pieces = 1; }
  if (c.cannon || c.grasshopper) { out.directional_hop_only_attack = true; out.max_directional_hop_pieces_attack = 1; }
  if (m.grasshopper) out.hop_landing_distance = 1;
  if (c.grasshopper) out.hop_landing_distance_attack = 1;
  const hopper = (k) => k.cannon || k.grasshopper;
  if ((hopper(m) && m.slide) || (hopper(c) && c.slide) || (m.cannon && m.grasshopper) || (c.cannon && c.grasshopper)) {
    warnings.push('A hopping slide (p or g) and a different slide on one piece cannot be set together for the same kind of move: here they share one hop rule. Moving one way and capturing the other (mRcpR) is fine.');
  }
  if ((m.lameExact && hopsM) || (c.lameExact && hopsC)) {
    warnings.push('A lame (n) leap on a piece that also jumps cannot be kept from jumping: here it jumps too.');
  }
  // An L-move's path rule is read only when the piece does not hop everything.
  if ((m.lameLeap || c.lameLeap) && hopsM) {
    warnings.push('A lame (n) L-move on a piece that also jumps over allies and enemies cannot be kept from jumping: here it jumps too.');
  }
  return out;
}

/**
 * Settings for the wizard, from a Betza code. `updates` replaces the piece's
 * movement and capture-on-move settings (ranged attacks and special rules are
 * left alone, apart from castling and en passant when the code names them).
 */
export function betzaToPieceData(code) {
  const parsed = parseBetza(code);
  if (parsed.error) return { updates: null, warnings: [], error: parsed.error, parts: parsed.parts };
  const warnings = [...parsed.warnings];
  const u = blankMovementAndAttack();
  const custom = { movement: new Map(), capture: new Map() };
  const extra = { movement: {}, capture: {} };   // additionalMovements / additionalCaptures
  const ratioTaken = { movement: false, capture: false };
  // What the piece needs from the hop settings, per kind (see hopSettings).
  const needs = {
    movement: { leap: false, ride: false, slide: false, lameExact: false, lameLeap: false, cannon: false, grasshopper: false },
    capture: { leap: false, ride: false, slide: false, lameExact: false, lameLeap: false, cannon: false, grasshopper: false },
  };

  const addCustom = (kind, dx, dy) => custom[kind].set(`${dy},${dx}`, { row: dy, col: dx });

  // A direction at a distance, possibly exact, possibly first-move-only.
  const setDirection = (kind, d, dist, { exact = false, initial = false, repeat = false }) => {
    const key = `${d}_${kind}`;
    const current = Number(u[key]) || 0;
    const sameShape = !!u[`${key}_exact`] === exact;
    if (!current && !initial) {
      u[key] = dist; u[`${key}_exact`] = exact;
      if (repeat) u[kind === 'movement' ? 'repeating_movement' : 'repeating_capture'] = true;
      return;
    }
    if (!current && initial) {
      u[key] = dist; u[`${key}_exact`] = exact; u[`${key}_available_for`] = 1;
      return;
    }
    if (!initial && sameShape && !exact) { u[key] = Math.max(current, dist); return; }
    // A second distance in a direction that already has one: an alternative.
    const list = extra[kind][d] || (extra[kind][d] = []);
    if (list.length >= 2) {
      warnings.push(`Only two alternative distances fit in one direction; dropped one for ${d.replace('_', '-')}.`);
      return;
    }
    // An alternative distance is walked like a slide: it cannot jump, nor repeat.
    if (repeat) {
      warnings.push('A ridden leap (DD, AA) in a direction that already has a move is stored as a second distance there, which is blocked by pieces in between and does not repeat.');
    }
    // Next to a one-square step, "up to N" is the same move as "exactly N" and matches how the site stores a pawn.
    const coveredBelow = !u[`${key}_exact`] && current >= dist - 1;
    list.push({
      value: dist === 99 ? 1 : dist, exact: exact && !coveredBelow, infinite: dist === 99,
      firstMoveOnly: false, ...(initial ? { availableForMoves: 1 } : {}),
    });
  };

  for (const part of parsed.parts) {
    if (part.unsupported.length) {
      warnings.push(`${part.text}: ${part.unsupported.map((c) => `"${c}" (${MODIFIERS[c] || 'unknown'})`).join(', ')} cannot be set up from notation - ignored.`);
    }
    if (part.atom === 'O') { u.can_castle = true; continue; }
    if (part.mods.includes('e')) u.can_en_passant = true;
    const kinds = part.mods.includes('m') ? ['movement'] : part.mods.includes('c') ? ['capture'] : ['movement', 'capture'];
    const initial = part.mods.includes('i');
    const lame = part.mods.includes('n');
    const cannon = part.mods.includes('p');
    const grasshopper = part.mods.includes('g');
    const filter = directionFilter(part.mods);
    const atoms = COMPOUNDS[part.atom] ? COMPOUNDS[part.atom].atoms.map((a) => ATOMS[a].leap) : [part.leap];

    for (const [a, b] of atoms) {
      const all = leapVectors([a, b]);
      const vectors = filter ? all.filter(([dx, dy]) => filter(dx, dy)) : all;
      if (!vectors.length) { warnings.push(`${part.text}: those directions leave no moves.`); continue; }
      const straight = b === 0 || a === b;   // along a line: orthogonal or diagonal
      const step = straight ? a : null;      // squares per step along it

      if ((cannon || grasshopper) && !(straight && step === 1)) {
        warnings.push(`${part.text}: a ${cannon ? 'cannon-style (p)' : 'grasshopper (g)'} ${straight ? 'leap' : 'L-shaped move'} cannot be set up - ignored.`);
        continue;
      }

      for (const kind of kinds) {
        if (straight && step === 1) {
          // W / F and their riders: the site's own sliding directions.
          const dist = part.rider ? (part.range || 99) : 1;
          for (const [dx, dy] of vectors) setDirection(kind, dirName(dx, dy), dist, { initial });
          needs[kind][grasshopper ? 'grasshopper' : cannon ? 'cannon' : 'slide'] = true;
        } else if (straight && (part.rider || lame)) {
          // DD, nD, A3 ...: exact distance along the line - hopping between
          // landings for a rider (DD jumps), blocked like a slide when lame.
          // DD3: at most three jumps (repeatCap). The site allows 1-8.
          if (part.rider && part.range > 1) {
            u[kind === 'movement' ? 'max_repeating_movement' : 'max_repeating_capture'] = Math.min(8, part.range);
            if (part.range > 8) warnings.push(`${part.text}: at most 8 repeats can be set; it repeats up to 8 times.`);
          }
          for (const [dx, dy] of vectors) setDirection(kind, dirName(dx, dy), step, { exact: true, initial, repeat: part.rider });
          needs[kind][part.rider && !lame ? 'ride' : 'lameExact'] = true;
        } else if (straight) {
          // D, A, H, G: a true leap - custom squares, which jump.
          if (initial) warnings.push(`${part.text}: "first move only" cannot be set on a leap (custom squares); it is always available.`);
          for (const [dx, dy] of vectors) addCustom(kind, dx, dy);
        } else if (!filter && vectors.length === all.length && !ratioTaken[kind]) {
          // The first unrestricted oblique leap: the L-shape ratio.
          ratioTaken[kind] = true;
          // Lame (n): blocked on its path rather than jumping - see below.
          needs[kind][lame ? 'lameLeap' : 'leap'] = true;
          if (part.rider) needs[kind].ride = true;
          if (kind === 'movement') {
            u.ratio_movement_style = true; u.ratio_one_movement = a; u.ratio_two_movement = b;
            if (part.rider) { u.repeating_ratio = true; u.max_ratio_iterations = part.range || -1; }
          } else {
            u.ratio_one_capture = a; u.ratio_two_capture = b;
            if (part.rider) { u.repeating_ratio_capture = true; u.max_ratio_capture_iterations = part.range || -1; }
          }
          if (initial) warnings.push(`${part.text}: "first move only" cannot be set on an L-shaped move; it is always available.`);
          if (lame) {
            // Lame (Betza n): the xiangqi horse's path rule (lPathRule) -
            // leg one first, blocked on it, the corner not counted.
            const sfx = kind === 'movement' ? '' : '_attack';
            u[`ratio_path_order${sfx}`] = 'long_first';
            u[`ratio_path_blocking${sfx}`] = 'long';
            u[`ratio_path_corner_blocks${sfx}`] = 0;
            if (b > 1) warnings.push(`${part.text}: a lame leap whose shorter leg is more than one square is set up as blocked on its longer leg.`);
          }
        } else if (!part.rider) {
          // A second oblique leap, or one limited to some directions: custom squares.
          if (initial) warnings.push(`${part.text}: "first move only" cannot be set on custom squares; it is always available.`);
          if (lame) warnings.push(`${part.text}: a lame (n) leap limited to some directions is a custom-square jump here, and jumps.`);
          for (const [dx, dy] of vectors) addCustom(kind, dx, dy);
        } else {
          warnings.push(`${part.text}: ${ratioTaken[kind] ? 'a second' : 'a direction-limited'} L-shaped rider cannot be set up - ignored.`);
        }
      }
    }
  }

  Object.assign(u, hopSettings(needs, warnings));

  if (custom.movement.size) u.custom_movement_squares = JSON.stringify([...custom.movement.values()]);
  if (custom.capture.size) u.custom_attack_squares = JSON.stringify([...custom.capture.values()]);
  if (Object.keys(extra.movement).length) u.special_scenario_moves = JSON.stringify({ additionalMovements: extra.movement });
  if (Object.keys(extra.capture).length) u.special_scenario_capture = JSON.stringify({ additionalCaptures: extra.capture });

  const anyDir = (kind) => DIRS.some((d) => Number(u[`${d}_${kind}`]) !== 0);
  u.directional_movement_style = anyDir('movement');
  u.can_capture_enemy_on_move = anyDir('capture') || !!u.ratio_one_capture || custom.capture.size > 0
    || Object.keys(extra.capture).length > 0;
  // Once each: a rule broken in several directions is still one rule.
  return { updates: u, warnings: [...new Set(warnings)], error: null, parts: parsed.parts };
}
