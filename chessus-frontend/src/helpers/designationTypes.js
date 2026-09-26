/*
 * "Opponent Chooses the Piece Type": how many types it names per choice, and
 * whether that can restrict anyone. Mirrors countWarning in
 * server/designated-piece.js.
 *
 * A side's piece types are its starting pieces, what it may place, and neutral
 * pieces (either side may move those). When the chooser names at least that
 * many, every type is named every time and the rule restricts nothing for that
 * side - worth a warning, not an error.
 */

const parse = (v) => {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (_) { return {}; }
};

/** The setting, 1 to 8. */
export const designationCount = (otherData) => {
  const n = Math.floor(Number(otherData?.designate_piece_count));
  return Number.isFinite(n) ? Math.max(1, Math.min(8, n)) : 1;
};

/** { 1: n, 2: n } - the piece types each side has to be chosen from. */
export const designationTypesPerSide = (gameData, otherData) => {
  const sides = { 1: new Set(), 2: new Set() };
  for (const p of Object.values(parse(gameData?.pieces_string))) {
    if (!p || p._occupied || p.piece_id == null) continue;
    const owner = Number(p.player_id || p.team || 0);
    if (p.is_neutral || owner === 0) { sides[1].add(Number(p.piece_id)); sides[2].add(Number(p.piece_id)); }
    else if (sides[owner]) sides[owner].add(Number(p.piece_id));
  }
  for (const t of (otherData?.placeable_pieces || [])) {
    if (t?.piece_id == null) continue;
    const who = t.player == null ? 'all' : String(t.player).replace(/^p/, '');
    for (const side of [1, 2]) {
      if (t.is_neutral || who === 'all' || who === String(side)) sides[side].add(Number(t.piece_id));
    }
  }
  return { 1: sides[1].size, 2: sides[2].size };
};

/** The warning, or null when the count restricts both sides. */
export const designationCountWarning = (gameData, otherData) => {
  if (otherData?.designate_piece_type !== true) return null;
  const n = designationCount(otherData);
  const types = designationTypesPerSide(gameData, otherData);
  const loose = [1, 2].filter((side) => types[side] > 0 && types[side] <= n);
  if (!loose.length) return null;
  const plural = (k) => `${k} piece type${k === 1 ? '' : 's'}`;
  const who = loose.length === 2
    ? (types[1] === types[2]
      ? `both players have ${plural(types[1])}`
      : `Player 1 has ${plural(types[1])} and Player 2 has ${plural(types[2])}`)
    : `Player ${loose[0]} has ${plural(types[loose[0]])}`;
  return `The opponent names ${n} piece type${n === 1 ? '' : 's'} per choice, but ${who}. `
    + 'Every type is named every time, so this setting has no effect on '
    + (loose.length === 2 ? 'either player.' : `Player ${loose[0]}.`);
};

/** The rule's opening sentence for the game page, with the count in it. */
export const designationRuleSentence = (otherData) => {
  const n = designationCount(otherData);
  return n === 1
    ? 'Before each of your moves, your opponent picks a piece type from a list, and you must move a piece of that type if one of them can move.'
    : `Before each of your moves, your opponent picks ${n} piece types from a list, and you must move a piece of one of those types if one of them can move.`;
};
