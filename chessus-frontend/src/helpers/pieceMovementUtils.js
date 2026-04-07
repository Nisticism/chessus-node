/**
 * Utility functions for calculating piece movement, captures, and ranged attacks.
 * Shared across PieceBoardPreview, GameWizard, GameTypeView, and other components.
 */

/**
 * Get all squares occupied by a piece, based on its anchor (top-left) and dimensions.
 * A 1x1 piece returns just its anchor. A 2x3 piece returns 6 squares.
 * @param {Object} piece - Piece with x, y, piece_width, piece_height
 * @returns {Array<{x: number, y: number}>} All occupied squares
 */
export const getOccupiedSquares = (piece) => {
  const w = piece.piece_width || 1;
  const h = piece.piece_height || 1;
  const squares = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      squares.push({ x: piece.x + dx, y: piece.y + dy });
    }
  }
  return squares;
};

/**
 * Check if a piece occupies a specific square.
 * @param {Object} piece - Piece with x, y, piece_width, piece_height
 * @param {number} sx - Square X
 * @param {number} sy - Square Y
 * @returns {boolean}
 */
export const doesPieceOccupySquare = (piece, sx, sy) => {
  const w = piece.piece_width || 1;
  const h = piece.piece_height || 1;
  return sx >= piece.x && sx < piece.x + w && sy >= piece.y && sy < piece.y + h;
};

/**
 * Find the piece (if any) that occupies a given square, accounting for multi-tile pieces.
 * @param {Array} pieces - Array of all pieces
 * @param {number} sx - Square X
 * @param {number} sy - Square Y
 * @returns {Object|undefined} The piece occupying the square, or undefined
 */
export const findPieceAtSquare = (pieces, sx, sy) => {
  return pieces.find(p => doesPieceOccupySquare(p, sx, sy));
};

/**
 * Check if a multi-tile piece would fit on the board at a given anchor position.
 * @param {number} anchorX - Anchor X (top-left)
 * @param {number} anchorY - Anchor Y (top-left)
 * @param {number} pieceWidth - Piece width in squares
 * @param {number} pieceHeight - Piece height in squares
 * @param {number} boardWidth - Board width
 * @param {number} boardHeight - Board height
 * @returns {boolean}
 */
export const doesPieceFitOnBoard = (anchorX, anchorY, pieceWidth, pieceHeight, boardWidth, boardHeight) => {
  return anchorX >= 0 && anchorY >= 0 &&
         anchorX + pieceWidth <= boardWidth &&
         anchorY + pieceHeight <= boardHeight;
};

/**
 * Check if moving a piece to a destination would overlap with any other piece.
 * @param {Object} movingPiece - The piece being moved (with piece_width, piece_height)
 * @param {number} toX - Destination anchor X
 * @param {number} toY - Destination anchor Y
 * @param {Array} allPieces - All pieces on the board
 * @param {string|number} [capturedPieceId] - ID of piece being captured (excluded from collision)
 * @returns {boolean} True if destination is clear (no overlaps)
 */
export const isDestinationClear = (movingPiece, toX, toY, allPieces, capturedPieceId = null) => {
  const w = movingPiece.piece_width || 1;
  const h = movingPiece.piece_height || 1;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const sx = toX + dx;
      const sy = toY + dy;
      const blocking = allPieces.find(p =>
        p.id !== movingPiece.id &&
        p.id !== capturedPieceId &&
        doesPieceOccupySquare(p, sx, sy)
      );
      if (blocking) return false;
    }
  }
  return true;
};

/**
 * Parse special_scenario_moves JSON to get additional movements
 * @param {Object|string} data - The special_scenario_moves data
 * @returns {Object} Parsed special scenario data
 */
export const parseSpecialScenarioMoves = (data) => {
  if (!data) return {};
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    return parsed || {};
  } catch (e) {
    console.error('Error parsing special_scenario_moves:', e);
    return {};
  }
};

/**
 * Parse special_scenario_captures JSON to get additional captures
 * @param {Object|string} data - The special_scenario_captures data
 * @returns {Object} Parsed special scenario data
 */
export const parseSpecialScenarioCaptures = (data) => {
  if (!data) return {};
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    return parsed || {};
  } catch (e) {
    console.error('Error parsing special_scenario_captures:', e);
    return {};
  }
};

/**
 * Check if a value allows movement at a given distance
 * @param {number} value - Movement value (99 = infinite, negative = exact, positive = up to)
 * @param {number} distance - Target distance
 * @param {boolean} isExact - Whether exact movement is required
 * @param {boolean} repeating - Whether the movement repeats at multiples of the exact distance
 * @returns {boolean}
 */
export const checkMovement = (value, distance, isExact = false, repeating = false) => {
  if (value === 99) return true; // Infinite movement
  if (value === 0 || value === null || value === undefined) return false;
  if (isExact) {
    const exact = Math.abs(value);
    if (repeating) return distance > 0 && distance % exact === 0;
    return distance === exact;
  }
  if (value > 0) return distance <= value; // Up to that distance
  if (value < 0) return distance === Math.abs(value); // Legacy exact (negative value)
  return false;
};

/**
 * Get the direction name based on row/col differences
 * @param {number} rowDiff - Row difference (positive = down, negative = up)
 * @param {number} colDiff - Column difference (positive = right, negative = left)
 * @returns {string|null} Direction name or null if not a valid direction
 */
export const getDirectionFromDiff = (rowDiff, colDiff) => {
  if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) return 'up_left';
  if (rowDiff < 0 && colDiff === 0) return 'up';
  if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) return 'up_right';
  if (rowDiff === 0 && colDiff > 0) return 'right';
  if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) return 'down_right';
  if (rowDiff > 0 && colDiff === 0) return 'down';
  if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) return 'down_left';
  if (rowDiff === 0 && colDiff < 0) return 'left';
  return null;
};

/**
 * Get the distance for a given direction from row/col differences
 * @param {number} rowDiff - Row difference
 * @param {number} colDiff - Column difference
 * @param {string} direction - Direction name
 * @returns {number} Distance in squares
 */
export const getDistanceForDirection = (rowDiff, colDiff, direction) => {
  switch (direction) {
    case 'up':
    case 'down':
      return Math.abs(rowDiff);
    case 'left':
    case 'right':
      return Math.abs(colDiff);
    case 'up_left':
    case 'up_right':
    case 'down_left':
    case 'down_right':
      return Math.abs(rowDiff);
    default:
      return 0;
  }
};

/**
 * Check if directional movement is first-move-only
 * @param {Object} pieceData - The piece data
 * @param {string} direction - Direction name (e.g., 'up', 'up_left')
 * @returns {boolean}
 */
export const isDirectionalMovementFirstMoveOnly = (pieceData, direction) => {
  if (pieceData.first_move_only) return true;
  const availableForKey = `${direction}_movement_available_for`;
  if (pieceData[availableForKey]) return true;
  return false;
};

/**
 * Check if directional capture is first-move-only
 * @param {Object} pieceData - The piece data
 * @param {string} direction - Direction name (e.g., 'up', 'up_left')
 * @returns {boolean}
 */
export const isDirectionalCaptureFirstMoveOnly = (pieceData, direction) => {
  if (pieceData.first_move_only_capture) return true;
  const availableForKey = `${direction}_capture_available_for`;
  if (pieceData[availableForKey]) return true;
  return false;
};

/**
 * Check if ratio movement is first-move-only
 * @param {Object} pieceData - The piece data
 * @param {Object} specialMoves - Parsed special scenario moves
 * @returns {boolean}
 */
export const isRatioMovementFirstMoveOnly = (pieceData, specialMoves) => {
  if (pieceData.first_move_only) return true;
  if (specialMoves?.ratio && Array.isArray(specialMoves.ratio)) {
    return specialMoves.ratio.some(move => move.availableForMoves);
  }
  return false;
};

/**
 * Check if ratio capture is first-move-only
 * @param {Object} pieceData - The piece data
 * @returns {boolean}
 */
export const isRatioCaptureFirstMoveOnly = (pieceData) => {
  return !!pieceData.first_move_only_capture;
};

/**
 * Check if step-by-step movement is first-move-only
 * @param {Object} pieceData - The piece data
 * @param {Object} specialMoves - Parsed special scenario moves
 * @returns {boolean}
 */
export const isStepMovementFirstMoveOnly = (pieceData, specialMoves) => {
  if (pieceData.first_move_only) return true;
  if (specialMoves?.step && Array.isArray(specialMoves.step)) {
    return specialMoves.step.some(move => move.availableForMoves);
  }
  return false;
};

/**
 * Check if step-by-step capture is first-move-only
 * @param {Object} pieceData - The piece data
 * @returns {boolean}
 */
export const isStepCaptureFirstMoveOnly = (pieceData) => {
  return !!pieceData.first_move_only_capture;
};

/**
 * Calculate if a piece can move to a target position
 * @param {number} fromRow - Starting row
 * @param {number} fromCol - Starting column
 * @param {number} toRow - Target row
 * @param {number} toCol - Target column
 * @param {Object} pieceData - The piece data
 * @param {number} playerPosition - Player number (1 or 2) for perspective flipping
 * @returns {{ allowed: boolean, isFirstMoveOnly: boolean }}
 */
export const canPieceMoveTo = (fromRow, fromCol, toRow, toCol, pieceData, playerPosition = 1) => {
  if (!pieceData) return { allowed: false, isFirstMoveOnly: false };
  if (fromRow === toRow && fromCol === toCol) return { allowed: false, isFirstMoveOnly: false };

  // For player 2, flip the perspective (so "up" is towards player 1)
  const rowDiff = playerPosition === 2 ? (fromRow - toRow) : (toRow - fromRow);
  const colDiff = playerPosition === 2 ? (fromCol - toCol) : (toCol - fromCol);

  const direction = getDirectionFromDiff(rowDiff, colDiff);
  const distance = direction ? getDistanceForDirection(rowDiff, colDiff, direction) : 0;

  // Parse special scenario moves
  const specialMoves = parseSpecialScenarioMoves(
    pieceData.special_scenario_moves || pieceData.special_scenario_movement
  );

  // Check directional movement
  const directionalStyle = pieceData.directional_movement_style;
  const hasDirectionalValues = pieceData.up_movement || pieceData.down_movement || 
                                pieceData.left_movement || pieceData.right_movement ||
                                pieceData.up_left_movement || pieceData.up_right_movement ||
                                pieceData.down_left_movement || pieceData.down_right_movement;

  if ((directionalStyle || hasDirectionalValues) && direction) {
    const movementKey = `${direction}_movement`;
    const exactKey = `${direction}_movement_exact`;
    const movementValue = pieceData[movementKey];
    const isExact = !!pieceData[exactKey];
    const repeating = !!(pieceData.repeating_movement && isExact);

    if (checkMovement(movementValue, distance, isExact, repeating)) {
      const isFirstMoveOnly = isDirectionalMovementFirstMoveOnly(pieceData, direction);
      return { allowed: true, isFirstMoveOnly };
    }
  }

  // Check additional movements from special_scenario_moves
  if (specialMoves.additionalMovements && direction) {
    const additionalMoves = specialMoves.additionalMovements[direction];
    if (Array.isArray(additionalMoves)) {
      for (const move of additionalMoves) {
        let moveValue = move.value;
        const isExact = move.exact;
        if (move.infinite) moveValue = 99;

        if (checkMovement(moveValue, distance, isExact)) {
          const isFirstMoveOnly = !!move.availableForMoves;
          return { allowed: true, isFirstMoveOnly };
        }
      }
    }
  }

  // Check ratio movement (L-shape like knight)
  const ratioStyle = pieceData.ratio_movement_style;
  const ratio1 = pieceData.ratio_one_movement || pieceData.ratio_movement_1 || 0;
  const ratio2 = pieceData.ratio_two_movement || pieceData.ratio_movement_2 || 0;
  
  if ((ratioStyle || (ratio1 > 0 && ratio2 > 0)) && ratio1 > 0 && ratio2 > 0) {
    if ((Math.abs(rowDiff) === ratio1 && Math.abs(colDiff) === ratio2) ||
        (Math.abs(rowDiff) === ratio2 && Math.abs(colDiff) === ratio1)) {
      const isFirstMoveOnly = isRatioMovementFirstMoveOnly(pieceData, specialMoves);
      return { allowed: true, isFirstMoveOnly };
    }
    // Check repeating ratio movement
    if (pieceData.repeating_ratio) {
      const maxK = pieceData.max_ratio_iterations === -1 ? Math.max(Math.abs(rowDiff), Math.abs(colDiff)) : (pieceData.max_ratio_iterations || 1);
      for (let k = 2; k <= maxK; k++) {
        if ((Math.abs(rowDiff) === k * ratio1 && Math.abs(colDiff) === k * ratio2) ||
            (Math.abs(rowDiff) === k * ratio2 && Math.abs(colDiff) === k * ratio1)) {
          const isFirstMoveOnly = isRatioMovementFirstMoveOnly(pieceData, specialMoves);
          return { allowed: true, isFirstMoveOnly };
        }
      }
    }
  }

  // Check step-by-step movement
  const stepStyle = pieceData.step_by_step_movement_style || pieceData.step_movement_style;
  const stepValue = pieceData.step_by_step_movement_value || pieceData.step_movement_value;
  
  if ((stepStyle || stepValue) && stepValue) {
    const maxSteps = Math.abs(stepValue);
    // Negative stepValue = Manhattan (orthogonal only), Positive = Chebyshev (includes diagonal)
    // String style names 'manhattan'/'chebyshev' are also supported
    const useManhattan = stepStyle === 'manhattan' || stepValue < 0;

    if (useManhattan) {
      // Manhattan distance: orthogonal only
      const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
      if (manhattanDistance <= maxSteps) {
        const isFirstMoveOnly = isStepMovementFirstMoveOnly(pieceData, specialMoves);
        return { allowed: true, isFirstMoveOnly };
      }
    } else {
      // Chebyshev distance: includes diagonal
      const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      if (chebyshevDistance <= maxSteps) {
        const isFirstMoveOnly = isStepMovementFirstMoveOnly(pieceData, specialMoves);
        return { allowed: true, isFirstMoveOnly };
      }
    }
  }

  // Check custom movement squares
  if (pieceData.custom_movement_squares) {
    try {
      const customSquares = typeof pieceData.custom_movement_squares === 'string'
        ? JSON.parse(pieceData.custom_movement_squares)
        : pieceData.custom_movement_squares;
      if (Array.isArray(customSquares)) {
        for (const sq of customSquares) {
          if (rowDiff === sq.row && colDiff === sq.col) {
            return { allowed: true, isFirstMoveOnly: false, isCustomOnly: true };
          }
        }
      }
    } catch { /* ignore parse errors */ }
  }

  return { allowed: false, isFirstMoveOnly: false };
};

/**
 * @param {number} toRow - Target row
 * @param {number} toCol - Target column
 * @param {Object} pieceData - The piece data
 * @param {number} playerPosition - Player number (1 or 2) for perspective flipping
 * @returns {{ allowed: boolean, isFirstMoveOnly: boolean }}
 */
export const canCaptureOnMoveTo = (fromRow, fromCol, toRow, toCol, pieceData, playerPosition = 1) => {
  if (!pieceData) return { allowed: false, isFirstMoveOnly: false };
  if (fromRow === toRow && fromCol === toCol) return { allowed: false, isFirstMoveOnly: false };
  if (!pieceData.can_capture_enemy_on_move) return { allowed: false, isFirstMoveOnly: false };

  // For player 2, flip the perspective
  const rowDiff = playerPosition === 2 ? (fromRow - toRow) : (toRow - fromRow);
  const colDiff = playerPosition === 2 ? (fromCol - toCol) : (toCol - fromCol);

  const direction = getDirectionFromDiff(rowDiff, colDiff);
  const distance = direction ? getDistanceForDirection(rowDiff, colDiff, direction) : 0;

  // Parse special scenario captures
  const specialCaptures = parseSpecialScenarioCaptures(
    pieceData.special_scenario_captures || pieceData.special_scenario_capture
  );

  // Check if separate capture fields are defined
  const hasSeparateCaptureFields = pieceData.up_capture || pieceData.down_capture || 
                                   pieceData.left_capture || pieceData.right_capture || 
                                   pieceData.up_left_capture || pieceData.up_right_capture ||
                                   pieceData.down_left_capture || pieceData.down_right_capture ||
                                   pieceData.ratio_capture_1 || pieceData.ratio_capture_2 ||
                                   pieceData.ratio_one_capture || pieceData.ratio_two_capture ||
                                   pieceData.step_capture_style || pieceData.step_by_step_capture ||
                                   (specialCaptures.additionalCaptures && Object.keys(specialCaptures.additionalCaptures).length > 0);

  // If no separate capture fields, use movement logic
  if (!hasSeparateCaptureFields) {
    return canPieceMoveTo(fromRow, fromCol, toRow, toCol, pieceData, playerPosition);
  }

  // Check directional capture
  if (direction) {
    // Map direction to capture field
    const captureFieldMap = {
      'up': 'up_capture',
      'down': 'down_capture',
      'left': 'left_capture',
      'right': 'right_capture',
      'up_left': 'up_left_capture',
      'up_right': 'up_right_capture',
      'down_left': 'down_left_capture',
      'down_right': 'down_right_capture'
    };
    
    const captureField = captureFieldMap[direction];
    const exactField = `${direction}_capture_exact`;
    const captureValue = pieceData[captureField];
    const isExact = !!pieceData[exactField];
    const repeating = !!(pieceData.repeating_capture && isExact);

    if (checkMovement(captureValue, distance, isExact, repeating)) {
      const isFirstMoveOnly = isDirectionalCaptureFirstMoveOnly(pieceData, direction);
      return { allowed: true, isFirstMoveOnly };
    }
  }

  // Check additional captures from special_scenario_captures
  if (specialCaptures.additionalCaptures && direction) {
    const additionalCaptures = specialCaptures.additionalCaptures[direction];
    if (Array.isArray(additionalCaptures)) {
      for (const capture of additionalCaptures) {
        let captureValue = capture.value;
        const isExact = capture.exact;
        if (capture.infinite) captureValue = 99;

        if (checkMovement(captureValue, distance, isExact)) {
          const isFirstMoveOnly = !!capture.availableForMoves;
          return { allowed: true, isFirstMoveOnly };
        }
      }
    }
  }

  // Check ratio capture (L-shape)
  const ratio1 = pieceData.ratio_one_capture || pieceData.ratio_capture_1 || 0;
  const ratio2 = pieceData.ratio_two_capture || pieceData.ratio_capture_2 || 0;
  
  if (ratio1 > 0 && ratio2 > 0) {
    if ((Math.abs(rowDiff) === ratio1 && Math.abs(colDiff) === ratio2) ||
        (Math.abs(rowDiff) === ratio2 && Math.abs(colDiff) === ratio1)) {
      const isFirstMoveOnly = isRatioCaptureFirstMoveOnly(pieceData);
      return { allowed: true, isFirstMoveOnly };
    }
    // Check repeating ratio capture
    if (pieceData.repeating_ratio_capture) {
      const maxK = pieceData.max_ratio_capture_iterations === -1 ? Math.max(Math.abs(rowDiff), Math.abs(colDiff)) : (pieceData.max_ratio_capture_iterations || 1);
      for (let k = 2; k <= maxK; k++) {
        if ((Math.abs(rowDiff) === k * ratio1 && Math.abs(colDiff) === k * ratio2) ||
            (Math.abs(rowDiff) === k * ratio2 && Math.abs(colDiff) === k * ratio1)) {
          const isFirstMoveOnly = isRatioCaptureFirstMoveOnly(pieceData);
          return { allowed: true, isFirstMoveOnly };
        }
      }
    }
  }

  // Check step-by-step capture
  const stepCaptureStyle = pieceData.step_capture_style;
  const stepCaptureValue = pieceData.step_by_step_capture || pieceData.step_capture_value;
  
  if ((stepCaptureStyle || stepCaptureValue) && stepCaptureValue) {
    const maxSteps = Math.abs(stepCaptureValue);
    // Negative stepCaptureValue = Manhattan (orthogonal only), Positive = Chebyshev (includes diagonal)
    const useManhattan = stepCaptureStyle === 'manhattan' || stepCaptureValue < 0;

    if (useManhattan) {
      const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
      if (manhattanDistance <= maxSteps) {
        const isFirstMoveOnly = isStepCaptureFirstMoveOnly(pieceData);
        return { allowed: true, isFirstMoveOnly };
      }
    } else {
      const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      if (chebyshevDistance <= maxSteps) {
        const isFirstMoveOnly = isStepCaptureFirstMoveOnly(pieceData);
        return { allowed: true, isFirstMoveOnly };
      }
    }
  }

  // Check custom attack squares
  if (pieceData.custom_attack_squares) {
    try {
      const customSquares = typeof pieceData.custom_attack_squares === 'string'
        ? JSON.parse(pieceData.custom_attack_squares)
        : pieceData.custom_attack_squares;
      if (Array.isArray(customSquares)) {
        for (const sq of customSquares) {
          if (rowDiff === sq.row && colDiff === sq.col) {
            return { allowed: true, isFirstMoveOnly: false, isCustomOnly: true };
          }
        }
      }
    } catch { /* ignore parse errors */ }
  }

  return { allowed: false, isFirstMoveOnly: false };
};

/**
 * Calculate if a piece can perform a ranged attack to a target position
 * @param {number} fromRow - Starting row
 * @param {number} fromCol - Starting column
 * @param {number} toRow - Target row
 * @param {number} toCol - Target column
 * @param {Object} pieceData - The piece data
 * @param {number} playerPosition - Player number (1 or 2) for perspective flipping
 * @returns {boolean}
 */
export const canRangedAttackTo = (fromRow, fromCol, toRow, toCol, pieceData, playerPosition = 1) => {
  if (!pieceData) return false;
  if (fromRow === toRow && fromCol === toCol) return false;
  if (!pieceData.can_capture_enemy_via_range) return false;

  // For player 2, flip the perspective
  const rowDiff = playerPosition === 2 ? (fromRow - toRow) : (toRow - fromRow);
  const colDiff = playerPosition === 2 ? (fromCol - toCol) : (toCol - fromCol);

  const direction = getDirectionFromDiff(rowDiff, colDiff);
  const distance = direction ? getDistanceForDirection(rowDiff, colDiff, direction) : 0;

  // Check directional ranged attack
  if (direction) {
    const attackFieldMap = {
      'up': 'up_attack_range',
      'down': 'down_attack_range',
      'left': 'left_attack_range',
      'right': 'right_attack_range',
      'up_left': 'up_left_attack_range',
      'up_right': 'up_right_attack_range',
      'down_left': 'down_left_attack_range',
      'down_right': 'down_right_attack_range'
    };
    
    const attackField = attackFieldMap[direction];
    const exactField = `${direction}_attack_range_exact`;
    const attackValue = pieceData[attackField];
    const isExact = !!pieceData[exactField];

    if (checkMovement(attackValue, distance, isExact)) {
      return true;
    }
  }

  // Check ratio attack range (L-shape)
  const ratio1 = pieceData.ratio_one_attack_range || pieceData.ratio_attack_range_1 || 0;
  const ratio2 = pieceData.ratio_two_attack_range || pieceData.ratio_attack_range_2 || 0;
  
  if (ratio1 > 0 && ratio2 > 0) {
    if ((Math.abs(rowDiff) === ratio1 && Math.abs(colDiff) === ratio2) ||
        (Math.abs(rowDiff) === ratio2 && Math.abs(colDiff) === ratio1)) {
      return true;
    }
  }

  // Check step-by-step attack
  const stepAttackValue = pieceData.step_by_step_attack_range || pieceData.step_attack_range;
  
  if (stepAttackValue) {
    const maxSteps = Math.abs(stepAttackValue);
    const noDiagonal = stepAttackValue < 0;

    if (noDiagonal) {
      const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
      if (manhattanDistance <= maxSteps) {
        return true;
      }
    } else {
      const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      if (chebyshevDistance <= maxSteps) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Check if a square is a hop-capture zone for a piece.
 * A hop-capture zone is any square between the piece and its max movement/capture range in a direction.
 * Enemies on these squares would be captured when the piece hops over them.
 * @param {number} fromRow - Source row
 * @param {number} fromCol - Source column
 * @param {number} toRow - Target row
 * @param {number} toCol - Target column
 * @param {Object} pieceData - Piece data with movement/capture fields
 * @param {number} playerPosition - Player position (1 or 2, for direction flipping)
 * @returns {boolean}
 */
export const canHopCaptureToUtil = (fromRow, fromCol, toRow, toCol, pieceData, playerPosition) => {
  if (!pieceData?.capture_on_hop) return false;
  if (fromRow === toRow && fromCol === toCol) return false;

  const rowDiff = playerPosition === 2 ? (fromRow - toRow) : (toRow - fromRow);
  const colDiff = playerPosition === 2 ? (fromCol - toCol) : (toCol - fromCol);

  // Parse additional movements/captures from special scenarios
  const specialMoves = parseSpecialScenarioMoves(
    pieceData.special_scenario_moves || pieceData.special_scenario_movement
  );
  const specialCaptures = parseSpecialScenarioCaptures(
    pieceData.special_scenario_captures || pieceData.special_scenario_capture
  );
  const additionalMovements = specialMoves?.additionalMovements || {};
  const additionalCaptures = specialCaptures?.additionalCaptures || {};

  const directions = [
    { dr: -1, dc: -1, move: 'up_left_movement', cap: 'up_left_capture', name: 'up_left' },
    { dr: -1, dc: 0, move: 'up_movement', cap: 'up_capture', name: 'up' },
    { dr: -1, dc: 1, move: 'up_right_movement', cap: 'up_right_capture', name: 'up_right' },
    { dr: 0, dc: 1, move: 'right_movement', cap: 'right_capture', name: 'right' },
    { dr: 1, dc: 1, move: 'down_right_movement', cap: 'down_right_capture', name: 'down_right' },
    { dr: 1, dc: 0, move: 'down_movement', cap: 'down_capture', name: 'down' },
    { dr: 1, dc: -1, move: 'down_left_movement', cap: 'down_left_capture', name: 'down_left' },
    { dr: 0, dc: -1, move: 'left_movement', cap: 'left_capture', name: 'left' },
  ];

  for (const dir of directions) {
    const moveVal = Math.abs(pieceData[dir.move] || 0);
    const capVal = Math.abs(pieceData[dir.cap] || 0);
    let maxVal = Math.max(moveVal, capVal);

    // Also consider additional movements/captures for this direction
    const addMoves = additionalMovements[dir.name];
    if (Array.isArray(addMoves)) {
      for (const m of addMoves) {
        const v = m.infinite ? 99 : (m.value || 0);
        if (v > maxVal) maxVal = v;
      }
    }
    const addCaps = additionalCaptures[dir.name];
    if (Array.isArray(addCaps)) {
      for (const c of addCaps) {
        const v = c.infinite ? 99 : (c.value || 0);
        if (v > maxVal) maxVal = v;
      }
    }

    if (!maxVal) continue;

    let isAlongDirection = false;
    let distance = 0;

    if (dir.dr === 0 && dir.dc !== 0) {
      isAlongDirection = rowDiff === 0 && Math.sign(colDiff) === dir.dc;
      distance = Math.abs(colDiff);
    } else if (dir.dc === 0 && dir.dr !== 0) {
      isAlongDirection = colDiff === 0 && Math.sign(rowDiff) === dir.dr;
      distance = Math.abs(rowDiff);
    } else {
      isAlongDirection = Math.abs(rowDiff) === Math.abs(colDiff) &&
        Math.sign(rowDiff) === dir.dr && Math.sign(colDiff) === dir.dc;
      distance = Math.abs(rowDiff);
    }

    if (!isAlongDirection || distance < 1) continue;

    const effectiveRange = maxVal === 99 ? 99 : maxVal;
    if (distance >= 1 && distance < effectiveRange) return true;
  }

  return false;
};

/**
 * Get square highlight style based on movement/capture/ranged attack capabilities
 * @param {boolean} canMove - Whether the piece can move to this square
 * @param {boolean} isMoveFirstOnly - Whether the move is first-move-only
 * @param {boolean} canCapture - Whether the piece can capture on this square
 * @param {boolean} isCaptureFirstOnly - Whether the capture is first-move-only
 * @param {boolean} canRangedAttack - Whether the piece can ranged attack this square
 * @param {boolean} isLight - Whether this is a light square (for icon styling)
 * @returns {{ style: Object, icon: string|null }}
 */
export const getSquareHighlightStyle = (canMove, isMoveFirstOnly, canCapture, isCaptureFirstOnly, canRangedAttack, isLight = true, isCustomMove = false, isCustomAttack = false) => {
  let style = {};
  let icon = null;

  // Use outline instead of border so piece sizes aren't affected,
  // and very translucent backgrounds so pieces behind remain clearly visible.
  // For combined move+capture, use diagonal split gradient like the piece wizard.

  // Color definitions (translucent)
  const customMoveColor = 'rgba(0, 188, 150, 0.55)';
  const customMoveBg = 'rgba(0, 188, 150, 0.25)';
  const customAttackColor = 'rgba(255, 183, 77, 0.55)';
  const customAttackBg = 'rgba(255, 183, 77, 0.25)';
  const moveColor = isCustomMove ? customMoveColor : (isMoveFirstOnly ? 'rgba(156, 39, 176, 0.55)' : 'rgba(33, 150, 243, 0.55)');
  const moveBg = isCustomMove ? customMoveBg : (isMoveFirstOnly ? 'rgba(156, 39, 176, 0.25)' : 'rgba(33, 150, 243, 0.25)');
  const captureColor = isCustomAttack ? customAttackColor : (isCaptureFirstOnly ? 'rgba(233, 30, 99, 0.55)' : 'rgba(255, 152, 0, 0.55)');
  const captureBg = isCustomAttack ? customAttackBg : (isCaptureFirstOnly ? 'rgba(233, 30, 99, 0.25)' : 'rgba(255, 152, 0, 0.25)');
  const rangedColor = 'rgba(244, 67, 54, 0.55)';
  const rangedBg = 'rgba(244, 67, 54, 0.25)';

  // Priority: Combined states > Single states
  if (canMove && canCapture && canRangedAttack) {
    // All three — split move/capture gradient + ranged icon
    style = {
      borderTop: `3px solid ${moveColor}`,
      borderLeft: `3px solid ${moveColor}`,
      borderBottom: `3px solid ${captureColor}`,
      borderRight: `3px solid ${captureColor}`,
      background: `linear-gradient(135deg, ${moveBg} 0%, ${moveBg} 50%, ${captureBg} 50%, ${captureBg} 100%)`
    };
    icon = '💥';
  } else if (canMove && canCapture) {
    // Move and capture — diagonal split gradient with split border
    style = {
      borderTop: `3px solid ${moveColor}`,
      borderLeft: `3px solid ${moveColor}`,
      borderBottom: `3px solid ${captureColor}`,
      borderRight: `3px solid ${captureColor}`,
      background: `linear-gradient(135deg, ${moveBg} 0%, ${moveBg} 50%, ${captureBg} 50%, ${captureBg} 100%)`
    };
  } else if (canMove && canRangedAttack) {
    // Move and ranged — split gradient + icon
    style = {
      borderTop: `3px solid ${moveColor}`,
      borderLeft: `3px solid ${moveColor}`,
      borderBottom: `3px solid ${rangedColor}`,
      borderRight: `3px solid ${rangedColor}`,
      background: `linear-gradient(135deg, ${moveBg} 0%, ${moveBg} 50%, ${rangedBg} 50%, ${rangedBg} 100%)`
    };
    icon = '💥';
  } else if (canCapture && canRangedAttack) {
    // Capture and ranged — split gradient + icon
    style = {
      borderTop: `3px solid ${captureColor}`,
      borderLeft: `3px solid ${captureColor}`,
      borderBottom: `3px solid ${rangedColor}`,
      borderRight: `3px solid ${rangedColor}`,
      background: `linear-gradient(135deg, ${captureBg} 0%, ${captureBg} 50%, ${rangedBg} 50%, ${rangedBg} 100%)`
    };
    icon = '💥';
  } else if (canMove) {
    // Movement only
    style = {
      outline: `3px solid ${moveColor}`,
      outlineOffset: '-3px',
      background: moveBg
    };
  } else if (canCapture) {
    // Capture only
    style = {
      outline: `3px solid ${captureColor}`,
      outlineOffset: '-3px',
      background: captureBg
    };
  } else if (canRangedAttack) {
    // Ranged attack only
    style = {
      outline: `3px solid ${rangedColor}`,
      outlineOffset: '-3px',
      background: rangedBg
    };
    icon = '💥';
  }

  return { style, icon };
};

/**
 * Check if the ranged attack path is blocked by other pieces
 * @param {number} fromX - Starting X (column)
 * @param {number} fromY - Starting Y (row)
 * @param {number} toX - Target X (column)
 * @param {number} toY - Target Y (row)
 * @param {Object} piece - The attacking piece
 * @param {Array} allPieces - All pieces on the board
 * @param {number} pieceOwnerPosition - Owner position (1 or 2)
 * @returns {boolean} True if path is clear, false if blocked
 */
export const isRangedPathClear = (fromX, fromY, toX, toY, piece, allPieces, pieceOwnerPosition) => {
  const canFireOverAllies = piece.can_fire_over_allies === 1 || piece.can_fire_over_allies === true;
  const canFireOverEnemies = piece.can_fire_over_enemies === 1 || piece.can_fire_over_enemies === true;
  
  // If can fire over both, path is always clear
  if (canFireOverAllies && canFireOverEnemies) return true;
  
  const dx = toX - fromX;
  const dy = toY - fromY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  
  // Only check path for directional attacks (not L-shape or step-by-step)
  // L-shape attacks are like knight moves and don't have a straight path
  if (absDx !== absDy && dx !== 0 && dy !== 0) {
    // L-shaped attack - no path blocking (similar to knight movement)
    return true;
  }
  
  // Calculate step direction
  const stepX = dx === 0 ? 0 : dx / absDx;
  const stepY = dy === 0 ? 0 : dy / absDy;
  
  // Check each square along the path (excluding start and end)
  let checkX = fromX + stepX;
  let checkY = fromY + stepY;
  
  while (checkX !== toX || checkY !== toY) {
    // Check if there's a piece at this position (multi-tile aware)
    const blockingPiece = findPieceAtSquare(allPieces, checkX, checkY);
    if (blockingPiece && blockingPiece.id !== piece.id) {
      const blockingOwner = blockingPiece.team || blockingPiece.player_id || blockingPiece.player;
      const isAlly = blockingOwner === pieceOwnerPosition;
      
      if (isAlly && !canFireOverAllies) {
        return false; // Blocked by ally
      }
      if (!isAlly && !canFireOverEnemies) {
        return false; // Blocked by enemy
      }
    }
    
    checkX += stepX;
    checkY += stepY;
  }
  
  return true;
};

/**
 * Convert a column index (0-based) to chess file notation.
 * For columns 0-25: a-z
 * For columns 26+: aa, ab, ac, ... az, ba, bb, etc.
 * @param {number} col - 0-based column index
 * @returns {string} File notation (a, b, c, ..., z, aa, ab, ...)
 */
export const colToFile = (col) => {
  if (col < 0) return '';
  if (col < 26) {
    return String.fromCharCode(97 + col); // a-z
  }
  // For columns 26+, use multi-letter notation
  const firstLetter = String.fromCharCode(97 + Math.floor(col / 26) - 1);
  const secondLetter = String.fromCharCode(97 + (col % 26));
  return firstLetter + secondLetter;
};

/**
 * Convert a row index (0-based) to chess rank notation.
 * @param {number} row - 0-based row index
 * @returns {string} Rank notation (1, 2, 3, ...)
 */
export const rowToRank = (row) => {
  return String(row + 1);
};

/**
 * Convert coordinates to standard chess notation (e.g., "e4", "h8")
 * @param {number} col - 0-based column index (x)
 * @param {number} row - 0-based row index (y)
 * @returns {string} Chess notation (e.g., "e4")
 */
export const toChessNotation = (col, row) => {
  return colToFile(col) + rowToRank(row);
};

/**
 * Format a move in standard chess notation
 * @param {Object} move - Move object with from, to, captured, pieceName, etc.
 * @param {boolean} includeFrom - Whether to include the source square
 * @param {number} boardHeight - Board height for rank conversion (default 8)
 * @returns {string} Formatted move (e.g., "e2-e4", "Nxf3")
 */
export const formatMoveNotation = (move, includeFrom = true, boardHeight = 8) => {
  if (!move || !move.from || !move.to) return '';
  
  // Castling notation
  if (move.isCastling) {
    const dx = move.to.x - move.from.x;
    return dx < 0 ? 'O-O-O' : 'O-O';
  }
  
  const fromSquare = colToFile(move.from.x) + rowToRank(boardHeight - 1 - move.from.y);
  const toSquare = colToFile(move.to.x) + rowToRank(boardHeight - 1 - move.to.y);
  
  // Ranged attack notation
  if (move.isRangedAttack) {
    if (move.captured) {
      return `${fromSquare}→${toSquare}×`;
    }
    // Ranged attack that dealt damage but didn't kill
    if (move.damagedPieces && move.damagedPieces.length > 0) {
      return `${fromSquare}→${toSquare}⚔`;
    }
    return `${fromSquare}→${toSquare}`;
  }

  const captureSymbol = move.captured ? 'x' : '-';
  
  if (includeFrom) {
    return `${fromSquare}${captureSymbol}${toSquare}`;
  }
  
  return `${move.captured ? 'x' : ''}${toSquare}`;
};

/**
 * Reconstruct board state at a given move index by replaying from initial pieces.
 * @param {Array} initialPieces - The starting pieces array (deep-cloned internally)
 * @param {Array} moveHistory - Full array of move records
 * @param {number} targetIndex - Replay up to and including this move index
 * @returns {Array} Reconstructed pieces array at the given move
 */
export const replayToMove = (initialPieces, moveHistory, targetIndex) => {
  const pieces = JSON.parse(JSON.stringify(initialPieces));

  for (let i = 0; i <= targetIndex && i < moveHistory.length; i++) {
    const move = moveHistory[i];

    // Place-mode moves (Othello-style) — skip, can't fully reconstruct
    if (move.type === 'place') continue;

    // Remove captured pieces
    if (move.allCaptured && move.allCaptured.length > 0) {
      const capturedIds = new Set(move.allCaptured.map(c => c.id));
      for (let j = pieces.length - 1; j >= 0; j--) {
        if (capturedIds.has(pieces[j].id)) pieces.splice(j, 1);
      }
    } else if (move.captured) {
      const idx = pieces.findIndex(p => p.id === move.captured.id);
      if (idx !== -1) pieces.splice(idx, 1);
    }

    // Apply HP damage to surviving pieces
    if (move.damagedPieces) {
      for (const dp of move.damagedPieces) {
        const piece = pieces.find(p => p.id === dp.id);
        if (piece) piece.current_hp = dp.remainingHp;
      }
    }

    // Move the piece (unless move was cancelled or ranged attack)
    const movingPiece = pieces.find(p => p.id === move.pieceId);
    if (movingPiece && !move.moveCancelled && !move.isRangedAttack) {
      movingPiece.x = move.to.x;
      movingPiece.y = move.to.y;
    }

    // Handle castling partner movement
    if (move.isCastling && move.castlingWith && movingPiece) {
      const partner = pieces.find(p => p.id === move.castlingWith);
      if (partner) {
        if (move.castlingDirection === 'left') {
          partner.x = move.to.x + 1;
          partner.y = move.to.y;
        } else {
          partner.x = move.to.x - 1;
          partner.y = move.to.y;
        }
      }
    }
  }

  return pieces;
};
