/**
 * Utility functions for calculating piece movement, captures, and ranged attacks.
 * Shared across PieceBoardPreview, GameWizard, GameTypeView, and other components.
 */

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
 * @returns {boolean}
 */
export const checkMovement = (value, distance, isExact = false) => {
  if (value === 99) return true; // Infinite movement
  if (value === 0 || value === null || value === undefined) return false;
  if (isExact) {
    return distance === Math.abs(value); // Exact distance
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

    if (checkMovement(movementValue, distance, isExact)) {
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
  }

  // Check step-by-step movement
  const stepStyle = pieceData.step_by_step_movement_style || pieceData.step_movement_style;
  const stepValue = pieceData.step_by_step_movement_value || pieceData.step_movement_value;
  
  if ((stepStyle || stepValue) && stepValue) {
    const maxSteps = Math.abs(stepValue);
    const noDiagonal = stepValue < 0;

    if (noDiagonal) {
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

  return { allowed: false, isFirstMoveOnly: false };
};

/**
 * Calculate if a piece can capture by moving to a target position
 * @param {number} fromRow - Starting row
 * @param {number} fromCol - Starting column
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
                                   pieceData.step_capture_style || pieceData.step_by_step_capture;

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

    if (checkMovement(captureValue, distance, isExact)) {
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
  }

  // Check step-by-step capture
  const stepCaptureStyle = pieceData.step_capture_style;
  const stepCaptureValue = pieceData.step_by_step_capture || pieceData.step_capture_value;
  
  if ((stepCaptureStyle || stepCaptureValue) && stepCaptureValue) {
    const maxSteps = Math.abs(stepCaptureValue);
    const noDiagonal = stepCaptureValue < 0;

    if (noDiagonal) {
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
 * Get square highlight style based on movement/capture/ranged attack capabilities
 * @param {boolean} canMove - Whether the piece can move to this square
 * @param {boolean} isMoveFirstOnly - Whether the move is first-move-only
 * @param {boolean} canCapture - Whether the piece can capture on this square
 * @param {boolean} isCaptureFirstOnly - Whether the capture is first-move-only
 * @param {boolean} canRangedAttack - Whether the piece can ranged attack this square
 * @param {boolean} isLight - Whether this is a light square (for icon styling)
 * @returns {{ style: Object, icon: string|null }}
 */
export const getSquareHighlightStyle = (canMove, isMoveFirstOnly, canCapture, isCaptureFirstOnly, canRangedAttack, isLight = true) => {
  let style = {};
  let icon = null;

  // Priority: Combined states > Single states
  if (canMove && canCapture && canRangedAttack) {
    // All three
    if (isMoveFirstOnly || isCaptureFirstOnly) {
      style = {
        border: '4px solid #9C27B0', // Purple for first-move-only combined
        boxShadow: 'inset 0 0 0 3px #FF9800, inset 0 0 10px rgba(255, 152, 0, 0.3)',
        zIndex: 10
      };
    } else {
      style = {
        border: '4px solid #2196F3',
        boxShadow: 'inset 0 0 0 3px #FF9800, inset 0 0 10px rgba(255, 152, 0, 0.3)',
        zIndex: 10
      };
    }
    icon = '💥';
  } else if (canMove && canCapture) {
    // Move and capture
    if (isMoveFirstOnly && isCaptureFirstOnly) {
      style = {
        border: '4px solid #9C27B0',
        boxShadow: 'inset 0 0 0 3px #E91E63, inset 0 0 10px rgba(233, 30, 99, 0.3)',
        zIndex: 10
      };
    } else if (isMoveFirstOnly) {
      style = {
        border: '4px solid #9C27B0',
        boxShadow: 'inset 0 0 0 3px #FF9800, inset 0 0 10px rgba(255, 152, 0, 0.3)',
        zIndex: 10
      };
    } else if (isCaptureFirstOnly) {
      style = {
        border: '4px solid #2196F3',
        boxShadow: 'inset 0 0 0 3px #E91E63, inset 0 0 10px rgba(233, 30, 99, 0.3)',
        zIndex: 10
      };
    } else {
      style = {
        border: '4px solid #2196F3',
        boxShadow: 'inset 0 0 0 3px #FF9800, inset 0 0 10px rgba(255, 152, 0, 0.3)',
        zIndex: 10
      };
    }
  } else if (canMove && canRangedAttack) {
    // Move and ranged
    if (isMoveFirstOnly) {
      style = {
        border: '4px solid #9C27B0',
        boxShadow: 'inset 0 0 0 3px #f44336, inset 0 0 10px rgba(244, 67, 54, 0.3)',
        zIndex: 10
      };
    } else {
      style = {
        border: '4px solid #2196F3',
        boxShadow: 'inset 0 0 0 3px #f44336, inset 0 0 10px rgba(244, 67, 54, 0.3)',
        zIndex: 10
      };
    }
    icon = '💥';
  } else if (canCapture && canRangedAttack) {
    // Capture and ranged
    if (isCaptureFirstOnly) {
      style = {
        border: '4px solid #E91E63',
        boxShadow: 'inset 0 0 0 3px #f44336, inset 0 0 10px rgba(244, 67, 54, 0.3)',
        zIndex: 10
      };
    } else {
      style = {
        border: '4px solid #FF9800',
        boxShadow: 'inset 0 0 0 3px #f44336, inset 0 0 10px rgba(244, 67, 54, 0.3)',
        zIndex: 10
      };
    }
    icon = '💥';
  } else if (canMove) {
    // Movement only
    if (isMoveFirstOnly) {
      style = {
        border: '5px solid #9C27B0',
        boxShadow: 'inset 0 0 10px rgba(156, 39, 176, 0.3)',
        zIndex: 10
      };
    } else {
      style = {
        border: '5px solid #2196F3',
        boxShadow: 'inset 0 0 10px rgba(33, 150, 243, 0.3)',
        zIndex: 10
      };
    }
  } else if (canCapture) {
    // Capture only
    if (isCaptureFirstOnly) {
      style = {
        border: '3px solid #E91E63',
        boxShadow: 'inset 0 0 10px rgba(233, 30, 99, 0.3)',
        zIndex: 10
      };
    } else {
      style = {
        border: '3px solid #FF9800',
        boxShadow: 'inset 0 0 10px rgba(255, 152, 0, 0.3)',
        zIndex: 10
      };
    }
  } else if (canRangedAttack) {
    // Ranged attack only
    style = {
      border: '3px solid #f44336',
      boxShadow: 'inset 0 0 10px rgba(244, 67, 54, 0.3)',
      zIndex: 10
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
    // Check if there's a piece at this position
    const blockingPiece = allPieces.find(p => p.x === checkX && p.y === checkY);
    if (blockingPiece) {
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
 * @returns {string} Formatted move (e.g., "e2-e4", "Nxf3")
 */
export const formatMoveNotation = (move, includeFrom = true) => {
  if (!move || !move.from || !move.to) return '';
  
  const fromSquare = toChessNotation(move.from.x, move.from.y);
  const toSquare = toChessNotation(move.to.x, move.to.y);
  const captureSymbol = move.captured ? 'x' : '-';
  const rangedSymbol = move.isRangedAttack ? '→' : '';
  
  if (move.isRangedAttack) {
    return `${fromSquare}→${toSquare}${move.captured ? '×' : ''}`;
  }
  
  if (includeFrom) {
    return `${fromSquare}${captureSymbol}${toSquare}`;
  }
  
  return `${move.captured ? 'x' : ''}${toSquare}`;
};
