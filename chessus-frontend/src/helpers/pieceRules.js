/*
 * Saying how a piece moves, in words.
 *
 * Lifted out of GameTypeView, which is where it grew, because the puzzle rules
 * modal needs exactly the same sentences and a second copy of two hundred lines
 * of movement grammar would start agreeing with the first and end up not.
 *
 * The describer works off a raw piece row - the movement columns as the pieces
 * table stores them - and returns one string, clauses joined with semicolons.
 */

const describeMovementRange = (value) => {
  if (value === 99) return "any number of squares";
  if (value === 0 || value === null || value === undefined) return null;
  /*
   * "1 square", not "up to 1 square". A move of no squares is not a move, so
   * there was never a range to qualify and "up to" only ever added a word.
   */
  if (value === 1) return '1 square';
  if (value > 0) return `up to ${value} squares`;
  if (value < 0) return `exactly ${Math.abs(value)} square${Math.abs(value) > 1 ? 's' : ''}`;
  return null;
};

// Helper to generate piece movement description
const describePieceMovement = (pieceData) => {
  const movements = [];
  
  // Value-only model: movement "type" is inferred from the configured values.
  const hasDirectional = !!(
    pieceData.up_movement || pieceData.down_movement || pieceData.left_movement || pieceData.right_movement ||
    pieceData.up_left_movement || pieceData.up_right_movement || pieceData.down_left_movement || pieceData.down_right_movement);
  const hasRatio = (pieceData.ratio_movement_1 || pieceData.ratio_one_movement || 0) > 0 &&
                   (pieceData.ratio_movement_2 || pieceData.ratio_two_movement || 0) > 0;
  
  // Check for ratio movement values even if directional_movement_style isn't set
  // Handle both naming conventions: ratio_movement_1/2 and ratio_one_movement/ratio_two_movement
  const ratio1 = pieceData.ratio_movement_1 || pieceData.ratio_one_movement || 0;
  const ratio2 = pieceData.ratio_movement_2 || pieceData.ratio_two_movement || 0;
  const hasRatioValues = ratio1 > 0 && ratio2 > 0;
  
  if (hasDirectional) {
    // Collect directional movements
    const directions = [];
    
    // Check vertical
    const up = describeMovementRange(pieceData.up_movement);
    const down = describeMovementRange(pieceData.down_movement);
    if (up && down && up === down) {
      directions.push(`vertically ${up}`);
    } else {
      if (up) directions.push(`upward ${up}`);
      if (down) directions.push(`downward ${down}`);
    }
    
    // Check horizontal
    const left = describeMovementRange(pieceData.left_movement);
    const right = describeMovementRange(pieceData.right_movement);
    if (left && right && left === right) {
      directions.push(`horizontally ${left}`);
    } else {
      if (left) directions.push(`leftward ${left}`);
      if (right) directions.push(`rightward ${right}`);
    }
    
    // Check diagonals
    const upLeft = describeMovementRange(pieceData.up_left_movement);
    const upRight = describeMovementRange(pieceData.up_right_movement);
    const downLeft = describeMovementRange(pieceData.down_left_movement);
    const downRight = describeMovementRange(pieceData.down_right_movement);
    
    const allDiagonals = [upLeft, upRight, downLeft, downRight].filter(Boolean);
    const allSameDiagonal = allDiagonals.length === 4 && allDiagonals.every(d => d === allDiagonals[0]);
    
    if (allSameDiagonal) {
      directions.push(`diagonally ${allDiagonals[0]}`);
    } else {
      if (upLeft) directions.push(`diagonally up-left ${upLeft}`);
      if (upRight) directions.push(`diagonally up-right ${upRight}`);
      if (downLeft) directions.push(`diagonally down-left ${downLeft}`);
      if (downRight) directions.push(`diagonally down-right ${downRight}`);
    }
    
    if (directions.length > 0) {
      let dirText = directions.join(', ');
      if (pieceData.repeating_movement) {
        dirText += ' (exact distances repeat infinitely)';
      }
      movements.push(dirText);
    }
  }
  
  // Check ratio movement (L-shape like knight) - check both flag and values
  if (hasRatio || hasRatioValues) {
    if (hasRatioValues) {
      const sq = (n) => `${n} square${Number(n) === 1 ? '' : 's'}`;
      let ratioText = `in an L-shape (${sq(ratio1)} in one direction and ${sq(ratio2)} perpendicular)`;
      if (pieceData.repeating_ratio) {
        const maxIter = pieceData.max_ratio_iterations;
        if (maxIter === -1) {
          ratioText += ', repeating infinitely';
        } else if (maxIter && maxIter > 1) {
          ratioText += `, repeating up to ${maxIter} times`;
        }
      }
      movements.push(ratioText);
    }
  }
  
  // Check step movement - handle both naming conventions (value-only model)
  const stepValue = pieceData.step_movement_value || pieceData.step_by_step_movement_value;
  
  if (stepValue) {
    // Negative stepValue = manhattan (diagonals excluded); the no_orthogonal flag
    // is the mirror image of that (diagonal steps only); otherwise chebyshev.
    const isManhattan = stepValue < 0;
    const isDiagonalOnly = !!(pieceData.step_movement_no_orthogonal
      ?? pieceData.step_by_step_movement_no_orthogonal);
    const range = describeMovementRange(stepValue);
    if (range) {
      if (isManhattan) {
        movements.push(`${range} counting horizontal and vertical steps`);
      } else if (isDiagonalOnly) {
        movements.push(`${range} counting diagonal steps only`);
      } else {
        movements.push(`${range} in any direction (including diagonals)`);
      }
    }
  }
  
  // Check hopping ability
  const hoppingDetails = [];
  if (pieceData.can_hop_over_allies) {
    hoppingDetails.push('allies');
  }
  if (pieceData.can_hop_over_enemies) {
    hoppingDetails.push('enemies');
  }
  if (hoppingDetails.length > 0) {
    let hopText = `can hop over ${hoppingDetails.join(' and ')}`;
    // If hopping is disabled for directional movement, specify which movement types still allow hopping
    const hasStepMovement = !!stepValue;
    if (pieceData.directional_hop_disabled && hasDirectional) {
      const hopMovementTypes = [];
      if (hasRatio || hasRatioValues) {
        hopMovementTypes.push(hasRatioValues ? 'ratio L-shaped movement' : 'ratio movement');
      }
      if (hasStepMovement) {
        hopMovementTypes.push('step-by-step movement');
      }
      // Exact directional movements still allow hopping
      hopMovementTypes.push('exact directional movement');
      hopText += ` when using its ${hopMovementTypes.join(' or ')}`;
    }
    movements.push(hopText);
  }

  // Direction change (movement)
  if (pieceData.directional_movement_change) {
    const dirNames = [
      { key: 'up_left', label: 'up-left' }, { key: 'up', label: 'up' }, { key: 'up_right', label: 'up-right' },
      { key: 'right', label: 'right' }, { key: 'down_right', label: 'down-right' }, { key: 'down', label: 'down' },
      { key: 'down_left', label: 'down-left' }, { key: 'left', label: 'left' },
    ];
    const dcDirs = dirNames
      .map(({ key, label }) => {
        const dist = pieceData[`${key}_movement_change`];
        if (!dist) return null;
        const exact = pieceData[`${key}_movement_change_exact`];
        const avail = pieceData[`${key}_movement_change_available_for`];
        let s = `${label} ${dist === 99 ? 'any distance' : (exact ? 'exactly ' : 'up to ') + dist}`;
        if (avail) s += ` (first ${avail} moves only)`;
        return s;
      })
      .filter(Boolean);
    if (dcDirs.length > 0) {
      let dcText = `can change direction after initial leg: second leg may go ${dcDirs.join(', ')}`;
      if (pieceData.repeating_movement_change) dcText += ' (exact second-leg distances repeat)';
      if (pieceData.require_direction_change) dcText += '; direction change is mandatory (cannot move straight)';
      dcText += '; same or opposite direction not allowed';
      movements.push(dcText);
    }
  }

  return movements.join('; ');
};


/*
 * SAYING IT SHORTER.
 *
 * The describer is thorough and writes every clause out in full, which is what
 * a game's own page wants. A card read in the middle of a puzzle wants the
 * same facts in half the words, so this tightens the output rather than
 * teaching the grammar a second dialect.
 *
 * One rule, about saying less: directions that share a range become one
 * direction. A king described as "vertically 1 square, horizontally 1 square,
 * diagonally 1 square" is a king that moves "1 square in any direction", and
 * the second reads the way anyone would say it out loud.
 *
 * Single-square ranges are NOT tidied here. They used to be, by a pair of
 * replaces that could never fire - the source held a literal backspace byte
 * where a word-boundary escape was meant, so the regex asked for a literal
 * backspace and matched nothing; the phrase survived every pass. The wording
 * is settled where it is written now, in describeMovementRange, which is the
 * honest place for it.
 */
const condenseMovement = (text) => {
  if (!text) return text;
  let out = String(text);

  // vertical + horizontal + diagonal, all the same range -> any direction.
  out = out.replace(
    /vertically ([^,;]+), horizontally ([^,;]+), diagonally ([^,;]+)/g,
    (whole, v, h, d) => (v === h && h === d ? `${v} in any direction` : whole)
  );
  // vertical + horizontal only -> orthogonally.
  out = out.replace(
    /vertically ([^,;]+), horizontally ([^,;]+)(?!, diagonally)/g,
    (whole, v, h) => (v === h ? `${v} orthogonally` : whole)
  );
  // "any number of squares in any direction" is a mouthful for what it is.
  out = out.replace(/any number of squares in any direction/g, 'any distance in any direction');
  out = out.replace(/any number of squares/g, 'any distance');

  return out;
};

/*
 * How a piece TAKES, which is not always how it moves.
 *
 * The capture columns mirror the movement columns one for one, so rather than
 * a second grammar this copies the capture values over the movement ones and
 * asks the same describer. One set of sentences, two questions.
 */
const CAPTURE_FIELDS = {
  up_capture: 'up_movement',
  down_capture: 'down_movement',
  left_capture: 'left_movement',
  right_capture: 'right_movement',
  up_left_capture: 'up_left_movement',
  up_right_capture: 'up_right_movement',
  down_left_capture: 'down_left_movement',
  down_right_capture: 'down_right_movement',
  ratio_one_capture: 'ratio_one_movement',
  ratio_two_capture: 'ratio_two_movement',
  step_by_step_capture: 'step_by_step_movement',
  repeating_capture: 'repeating_movement',
  step_by_step_capture_no_orthogonal: 'step_by_step_movement_no_orthogonal',
};

const describePieceAttack = (pieceData) => {
  if (!pieceData) return '';
  const asMovement = { ...pieceData };
  // Clear the movement side first, so a field with no capture counterpart does
  // not leak the way the piece MOVES into the way it takes.
  for (const target of Object.values(CAPTURE_FIELDS)) asMovement[target] = 0;
  asMovement.ratio_movement_1 = 0;
  asMovement.ratio_movement_2 = 0;
  for (const [from, to] of Object.entries(CAPTURE_FIELDS)) {
    if (pieceData[from] !== undefined && pieceData[from] !== null) asMovement[to] = pieceData[from];
  }
  asMovement.ratio_movement_1 = pieceData.ratio_one_capture || 0;
  asMovement.ratio_movement_2 = pieceData.ratio_two_capture || 0;
  return describePieceMovement(asMovement);
};

/**
 * Movement and, when it differs, how the piece takes - both already shortened.
 *
 * @returns {{ moves: string, captures: string|null }}
 */
const describePieceBriefly = (pieceData) => {
  const moves = condenseMovement(describePieceMovement(pieceData)) || '';
  const captures = condenseMovement(describePieceAttack(pieceData)) || '';
  return {
    moves,
    // Only when it is actually news. A piece that takes the way it moves is
    // the assumption, and repeating it for every piece buries the ones where
    // it is not true.
    captures: captures && captures !== moves ? captures : null,
  };
};

export { describeMovementRange, describePieceMovement, condenseMovement, describePieceAttack, describePieceBriefly };
