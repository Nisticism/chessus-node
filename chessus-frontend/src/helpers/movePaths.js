/*
 * PATHS: moves made of legs - the griffon, the rose, the crooked bishop, a
 * dabbaba rider beside a rook, anything that goes one way and then another.
 *
 * A piece may have up to MAX_PATHS movement paths (`movement_paths`) and attack
 * paths (`capture_paths`), each a JSON array. A path is a list of LEGS, walked
 * in order:
 *
 *   step   the shapes of one step: [a, b] pairs, a >= b >= 0 - [1,0] one square
 *          orthogonally, [1,1] diagonally, [2,1] a knight's jump, [2,0] a
 *          dabbaba's. A step is a jump: only the square it lands on counts.
 *          Several shapes ([1,0] and [1,1]: a king's step) are allowed.
 *   dirs   for the FIRST stretch of the first leg: which ways it may go, as
 *          [dx, dy] steps from the owner's side (dy < 0 = forward). null = all.
 *   turn   for every other stretch: which ways it may turn from the step before,
 *          as headings - 'f' straight on, 'fl'/'fr' a slight turn, 'l'/'r' a
 *          square turn, 'bl'/'br' a sharp one, 'b' straight back.
 *          null = every heading but 'b' (Betza's default).
 *   dist   [min, max] steps in a straight line per stretch; max null = as far
 *          as the board allows. [1, 1] is one step; [1, null] a slide/rider.
 *   times  [min, max] stretches of this leg, each turning from the last; max
 *          null = no limit. min 0 makes the leg optional (it may be skipped,
 *          or the path may end before it).
 *   over   what may stand on the squares the leg lands on before the path
 *          ends: 'none' (they must be empty), 'allies', 'enemies' or 'any'.
 *
 * And per path, `turning`: how its left/right turns go together - 'any',
 * 'same' (always the same way round: the rose) or 'alternate' (zig-zag: the
 * crooked bishop).
 *
 * A path ends where a stretch ends (after `dist` min steps or more), provided
 * every leg after it is optional. It ends on an empty square (a move) or on a
 * piece (a capture, by the capture rules below); it never passes a square that
 * holds what `over` does not allow. Squares a step jumps over are never looked
 * at. It may cross its own earlier squares; it never ends where it started.
 *
 * Captures: attack paths capture; movement paths only move, unless the piece
 * "attacks like it moves" (attacks_like_movement), when they capture too. A
 * capture takes an enemy, or an ally for a piece that captures allies, never a
 * piece that cannot be captured.
 *
 * Player 2's paths are mirrored top to bottom, as the piece's directions are
 * (the move generator: up and down swap, left and right do not). Turns are
 * read in the owner's own frame, so a mirrored path turns the mirrored way.
 *
 * The search is over states (square, leg, stretch count, last step, last
 * turn's side), each visited once, so an unlimited path costs no more than
 * the board is big.
 *
 * GENERATED from server/move-paths.js by scripts/sync-move-paths.js - edit
 * that file and re-run the script; scripts/e2e/move-paths-test.js checks.
 */

const MAX_PATHS = 8;
const MAX_PATH_LEGS = 8;
const MAX_PATH_COUNT = 8;
const MAX_STEP = 8;
const HEADINGS = ['f', 'fr', 'r', 'br', 'b', 'bl', 'l', 'fl'];
const DEFAULT_TURN = ['f', 'fr', 'r', 'br', 'bl', 'l', 'fl'];
const TURNINGS = ['any', 'same', 'alternate'];
const OVERS = ['none', 'allies', 'enemies', 'any'];

const clampInt = (v, lo, hi) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};

/** Every [dx, dy] of some step shapes. */
function stepVectors(shapes) {
  const out = new Map();
  for (const [a, b] of shapes || []) {
    for (const [x, y] of [[a, b], [b, a]]) {
      for (const sx of [1, -1]) for (const sy of [1, -1]) {
        const v = [x * sx, y * sy];
        if (v[0] === 0 && v[1] === 0) continue;
        out.set(`${v[0]},${v[1]}`, v);
      }
    }
  }
  return [...out.values()];
}

/** The heading of step v after step p ('f', 'fl', 'l', ...), read with -y as forward. */
function headingOf(p, v) {
  const dot = p[0] * v[0] + p[1] * v[1];
  const cross = p[0] * v[1] - p[1] * v[0];
  const side = cross < 0 ? 'l' : cross > 0 ? 'r' : '';
  if (dot > 0) return `f${side}`;
  if (dot < 0) return `b${side}`;
  return side;
}

/** [min, max] - max null for "no limit". */
function sanitizeRange(raw, lo, dflt) {
  const r = Array.isArray(raw) ? raw : [];
  const min = clampInt(r[0], lo, MAX_PATH_COUNT) ?? dflt;
  const rawMax = r[1];
  if (rawMax === null || rawMax === 'all') return [min, null];
  const max = clampInt(rawMax, 1, MAX_PATH_COUNT) ?? Math.max(min, 1);
  return [min, Math.max(max, min, 1)];
}

function sanitizeLeg(raw, first) {
  if (!raw || typeof raw !== 'object') return null;
  const shapes = new Map();
  for (const s of Array.isArray(raw.step) ? raw.step : []) {
    if (!Array.isArray(s)) continue;
    const x = clampInt(Math.abs(Number(s[0])), 0, MAX_STEP);
    const y = clampInt(Math.abs(Number(s[1])), 0, MAX_STEP);
    if (x == null || y == null || (x === 0 && y === 0)) continue;
    const shape = [Math.max(x, y), Math.min(x, y)];
    shapes.set(shape.join(','), shape);
  }
  if (!shapes.size) return null;
  const step = [...shapes.values()].slice(0, 4);
  const leg = { step };
  if (first && Array.isArray(raw.dirs)) {
    const ok = new Set(stepVectors(step).map((v) => v.join(',')));
    const dirs = new Map();
    for (const d of raw.dirs) {
      if (Array.isArray(d) && ok.has(`${Number(d[0])},${Number(d[1])}`)) dirs.set(`${Number(d[0])},${Number(d[1])}`, [Number(d[0]), Number(d[1])]);
    }
    leg.dirs = [...dirs.values()];
  } else leg.dirs = null;
  leg.turn = Array.isArray(raw.turn) ? HEADINGS.filter((h) => raw.turn.includes(h)) : null;
  leg.dist = sanitizeRange(raw.dist, 1, 1);
  leg.times = sanitizeRange(raw.times, first ? 1 : 0, 1);
  leg.over = OVERS.includes(raw.over) ? raw.over : 'none';
  return leg;
}

function sanitizePath(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.legs)) return null;
  const legs = [];
  for (const l of raw.legs.slice(0, MAX_PATH_LEGS)) {
    const leg = sanitizeLeg(l, legs.length === 0);
    if (leg) legs.push(leg);
  }
  if (!legs.length) return null;
  return { legs, turning: TURNINGS.includes(raw.turning) ? raw.turning : 'any' };
}

/** A stored list of paths (JSON or array), cleaned; [] when there are none. */
function parsePaths(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try { list = JSON.parse(raw); } catch (e) { return []; }
  }
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_PATHS).map(sanitizePath).filter(Boolean);
}

/** What to store: JSON, or null for none. */
function pathsField(raw) {
  const paths = parsePaths(raw);
  return paths.length ? JSON.stringify(paths) : null;
}

/*
 * Every square a path can end on, from (fromX, fromY):
 * [{ x, y, occ }] with occ null (empty), 'ally' or 'enemy'.
 *   ctx.flip         player 2: mirror top to bottom
 *   ctx.inside(x,y)  on the board (and, for a large piece, fitting)
 *   ctx.occupant(x,y) null | 'ally' | 'enemy' | 'wall' (impassable)
 *   ctx.ghost        passes everything (ghostwalk)
 */
function pathEnds(path, fromX, fromY, ctx) {
  const legs = path.legs;
  const ends = new Map();
  const seen = new Set();
  const queue = [];
  // Can the path end after `rep` stretches of leg i?
  const canEnd = (i, rep) => rep >= legs[i].times[0] && legs.slice(i + 1).every((l) => l.times[0] === 0);
  const passable = (leg, occ) => {
    if (!occ || ctx.ghost) return true;
    if (occ === 'wall') return false;
    return leg.over === 'any' || (leg.over === 'allies' && occ === 'ally') || (leg.over === 'enemies' && occ === 'enemy');
  };
  // One stretch of leg i in direction v (owner's frame), the rep-th of that leg.
  const stretch = (x, y, i, rep, v, side) => {
    const leg = legs[i];
    const [dmin, dmax] = leg.dist;
    const bx = v[0];
    const by = ctx.flip ? -v[1] : v[1];
    let cx = x;
    let cy = y;
    for (let k = 1; dmax == null || k <= dmax; k++) {
      cx += bx;
      cy += by;
      if (!ctx.inside(cx, cy)) return;
      const occ = cx === fromX && cy === fromY ? null : ctx.occupant(cx, cy);
      if (k >= dmin) {
        if (canEnd(i, rep) && occ !== 'wall' && !(cx === fromX && cy === fromY)) {
          const key = `${cx},${cy}`;
          if (!ends.has(key)) ends.set(key, { x: cx, y: cy, occ });
        }
        if (passable(leg, occ)) {
          const t = leg.times;
          const repKey = t[1] == null && rep >= Math.max(t[0], 1) ? 'n' : rep;
          const key = `${cx},${cy},${i},${repKey},${v[0]},${v[1]},${side}`;
          if (!seen.has(key)) { seen.add(key); queue.push([cx, cy, i, rep, v, side]); }
        }
      }
      if (!passable(leg, occ)) return;
    }
  };
  // A turn onto step w from step v, by leg's turn set and the path's turning rule.
  const turnTo = (leg, v, w, side) => {
    const h = headingOf(v, w);
    if (!(leg.turn || DEFAULT_TURN).includes(h)) return null;
    const s = h.endsWith('l') ? 'l' : h.endsWith('r') ? 'r' : '';
    if (path.turning === 'any') return '';
    if (s && side) {
      if (path.turning === 'same' && s !== side) return null;
      if (path.turning === 'alternate' && s === side) return null;
    }
    return s || side;
  };

  for (const w of legs[0].dirs || stepVectors(legs[0].step)) stretch(fromX, fromY, 0, 1, w, '');
  while (queue.length) {
    const [x, y, i, rep, v, side] = queue.shift();
    const leg = legs[i];
    if (leg.times[1] == null || rep < leg.times[1]) {
      for (const w of stepVectors(leg.step)) {
        const s = turnTo(leg, v, w, side);
        if (s !== null) stretch(x, y, i, rep + 1, w, s);
      }
    }
    if (rep < leg.times[0]) continue;
    for (let j = i + 1; j < legs.length; j++) {
      for (const w of stepVectors(legs[j].step)) {
        const s = turnTo(legs[j], v, w, side);
        if (s !== null) stretch(x, y, j, 1, w, s);
      }
      if (legs[j].times[0] > 0) break;
    }
  }
  return [...ends.values()];
}

/** The paths a piece moves and attacks by. */
const pieceMovementPaths = (piece) => parsePaths(piece?.movement_paths);
const pieceCapturePaths = (piece) => parsePaths(piece?.capture_paths);
const hasPaths = (piece) => pieceMovementPaths(piece).length > 0 || pieceCapturePaths(piece).length > 0;
const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';

/*
 * The moves a piece's paths give it on a board:
 * [{ x, y, capture, target, byMove, byAttack }] - byAttack without capture is
 * an empty square an attack path reaches, given only for board.potential.
 *   board.flip, board.inside(x,y), board.ghost - as pathEnds
 *   board.pieceAt(x,y)  the piece there that matters (not the mover), or null
 *   board.isAlly(p)     whether p is on the mover's side
 *   board.blocked(x,y)  impassable
 *   board.potential     also give capture squares that are empty (premove / fog)
 */
function pathMoves(piece, board) {
  const moving = pieceMovementPaths(piece);
  const capturing = pieceCapturePaths(piece);
  if (!moving.length && !capturing.length) return [];
  const occupant = (x, y) => {
    if (board.blocked && board.blocked(x, y)) return 'wall';
    const p = board.pieceAt(x, y);
    if (!p) return null;
    return board.isAlly(p) ? 'ally' : 'enemy';
  };
  const ctx = { flip: !!board.flip, inside: board.inside, occupant, ghost: !!board.ghost };
  const takes = (end) => {
    if (!end.occ || end.occ === 'wall') return false;
    if (end.occ === 'ally' && !truthy(piece.can_capture_allies)) return false;
    const target = board.pieceAt(end.x, end.y);
    return !!target && !target.cannot_be_captured;
  };
  const out = new Map();
  // byMove / byAttack: which kind of path reached the square (a board draws them apart).
  const add = (end, capture, byMove, byAttack) => {
    const key = `${end.x},${end.y}`;
    const m = out.get(key) || { x: end.x, y: end.y, capture: false, target: null, byMove: false, byAttack: false };
    if (capture) { m.capture = true; m.target = board.pieceAt(end.x, end.y); }
    m.byMove = m.byMove || byMove;
    m.byAttack = m.byAttack || byAttack;
    out.set(key, m);
  };
  const movesCapture = truthy(piece.attacks_like_movement);
  for (const path of moving) {
    for (const end of pathEnds(path, piece.x, piece.y, ctx)) {
      if (!end.occ) add(end, false, true, false);
      else if (movesCapture && takes(end)) add(end, true, true, true);
    }
  }
  for (const path of capturing) {
    for (const end of pathEnds(path, piece.x, piece.y, ctx)) {
      if (takes(end)) add(end, true, false, true);
      else if (!end.occ && board.potential) add(end, false, false, true);
    }
  }
  return [...out.values()];
}

/*
 * Does a piece attack (tx, ty) by a path - would a capture there be legal
 * whatever stands on it? For check and for validating a capture.
 */
function pathAttacks(piece, tx, ty, board) {
  const lists = [pieceCapturePaths(piece)];
  if (truthy(piece.attacks_like_movement)) lists.push(pieceMovementPaths(piece));
  const occupant = (x, y) => {
    if (board.blocked && board.blocked(x, y)) return 'wall';
    const p = board.pieceAt(x, y);
    if (!p) return null;
    return board.isAlly(p) ? 'ally' : 'enemy';
  };
  const ctx = { flip: !!board.flip, inside: board.inside, occupant, ghost: !!board.ghost };
  return lists.some((paths) => paths.some((path) => pathEnds(path, piece.x, piece.y, ctx).some((e) => e.x === tx && e.y === ty)));
}

/** Can a piece move (without capturing) to the empty square (tx, ty) by a path? */
function pathMovesTo(piece, tx, ty, board) {
  return pathMoves(piece, board).some((m) => m.x === tx && m.y === ty && !m.capture && m.byMove);
}

/* ------------------------------------------------------------- in words -- */

const SHAPE_WORDS = { '1,0': ['square orthogonally', 'squares orthogonally'], '1,1': ['square diagonally', 'squares diagonally'] };
function stepWords(step, n) {
  const one = (s) => {
    const k = s.join(',');
    if (k === '1,0,1,1' || k === '1,1,1,0') return null;
    if (SHAPE_WORDS[k]) return SHAPE_WORDS[k][n === 1 ? 0 : 1];
    if (k === '2,1') return n === 1 ? 'knight jump' : 'knight jumps';
    if (s[1] === 0) return `${s[0]}-square orthogonal ${n === 1 ? 'jump' : 'jumps'}`;
    if (s[0] === s[1]) return `${s[0]}-square diagonal ${n === 1 ? 'jump' : 'jumps'}`;
    return `(${s[0]},${s[1]}) ${n === 1 ? 'jump' : 'jumps'}`;
  };
  const keys = step.map((s) => s.join(',')).sort().join('|');
  if (keys === '1,0|1,1') return n === 1 ? 'square in any direction' : 'squares in any direction';
  return step.map(one).join(' or ');
}
function countWords(dist, step) {
  const [min, max] = dist;
  const noun = (n) => stepWords(step, n);
  if (max == null) return min > 1 ? `${min} or more ${noun(2)} in a line` : `any number of ${noun(2)} in a line`;
  if (min === max) return `${min === 1 ? 'one' : min} ${noun(min)}${min > 1 ? ' in a line' : ''}`;
  return `${min} to ${max} ${noun(2)} in a line`;
}
const TURN_WORDS = { f: 'going straight on', s1: 'turning slightly', s2: 'turning at a right angle', s3: 'turning sharply', b: 'turning back' };
function turnWords(turn) {
  const t = turn || DEFAULT_TURN;
  const parts = [];
  const pair = (l, r, word) => {
    if (t.includes(l) && t.includes(r)) parts.push(`${word} either way`);
    else if (t.includes(l)) parts.push(`${word} left`);
    else if (t.includes(r)) parts.push(`${word} right`);
  };
  if (t.includes('f')) parts.push(TURN_WORDS.f);
  pair('fl', 'fr', TURN_WORDS.s1);
  pair('l', 'r', TURN_WORDS.s2);
  pair('bl', 'br', TURN_WORDS.s3);
  if (t.includes('b')) parts.push(TURN_WORDS.b);
  return parts.length ? parts.join(', ') : 'nowhere';
}
function dirWords(dirs, step) {
  if (!dirs) return '';
  const all = stepVectors(step).length;
  if (dirs.length >= all) return '';
  if (!dirs.length) return ' (in no direction)';
  const fwd = dirs.every(([, dy]) => dy < 0);
  const back = dirs.every(([, dy]) => dy > 0);
  const side = dirs.every(([, dy]) => dy === 0);
  if (fwd) return ' forward';
  if (back) return ' backward';
  if (side) return ' sideways';
  return ` (${dirs.length} of its ${all} directions)`;
}

/** A path as a sentence: "One square diagonally, then any number of squares orthogonally in a line (turning slightly either way) (optional)." */
function pathWords(path) {
  const p = sanitizePath(path);
  if (!p) return '';
  const bits = p.legs.map((leg, i) => {
    let s = countWords(leg.dist, leg.step);
    if (i === 0) s += dirWords(leg.dirs, leg.step);
    else s += ` (${turnWords(leg.turn)})`;
    const [tmin, tmax] = leg.times;
    if (tmax == null || tmax > 1) {
      const most = tmax == null ? 'any number of times' : `up to ${tmax} times`;
      s += `, ${most}, each time ${turnWords(leg.turn)}`;
    }
    if (tmin === 0) s += ' (optional)';
    if (leg.over !== 'none') s += `, passing over ${leg.over === 'any' ? 'any piece' : leg.over}`;
    return s;
  });
  let out = bits.join(', then ');
  if (p.turning === 'same') out += '; it always turns the same way round';
  if (p.turning === 'alternate') out += '; it turns left and right in turn (zig-zag)';
  return out.charAt(0).toUpperCase() + out.slice(1) + '.';
}

export {
  pathWords,
  MAX_PATHS,
  MAX_PATH_LEGS,
  MAX_PATH_COUNT,
  MAX_STEP,
  HEADINGS,
  DEFAULT_TURN,
  TURNINGS,
  OVERS,
  stepVectors,
  headingOf,
  sanitizePath,
  parsePaths,
  pathsField,
  pathEnds,
  pieceMovementPaths,
  pieceCapturePaths,
  hasPaths,
  pathMoves,
  pathAttacks,
  pathMovesTo,
};
