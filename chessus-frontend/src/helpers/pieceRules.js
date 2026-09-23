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
  if (value > 0) return `up to ${value} square${value > 1 ? 's' : ''}`;
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
      let ratioText = `in an L-shape (${ratio1} squares in one direction and ${ratio2} squares perpendicular)`;
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

export { describeMovementRange, describePieceMovement };
