import React, { useState, useMemo } from "react";
import styles from "./piecewizard.module.scss";
import { applySvgStretchBackground } from "../../helpers/svgStretchUtils";

const PieceBoardPreview = ({ pieceData, showAttack = true, showLegend = true }) => {
  const [isHovering, setIsHovering] = useState(false);
  
  // Get user's preferred board colors from localStorage
  const lightSquareColor = localStorage.getItem('boardLightColor') || '#cad5e8';
  const darkSquareColor = localStorage.getItem('boardDarkColor') || '#08234d';

  // Parse special_scenario_moves JSON to get additional movements
  // Check both special_scenario_moves (database/new) and special_scenario_movement (legacy frontend state)
  const parseSpecialScenarioMoves = useMemo(() => {
    const data = pieceData.special_scenario_moves || pieceData.special_scenario_movement;
    if (!data) return {};
    try {
      const parsed = typeof data === 'string'
        ? JSON.parse(data)
        : data;
      return parsed || {};
    } catch (e) {
      console.error('Error parsing special_scenario_moves:', e);
      return {};
    }
  }, [pieceData.special_scenario_moves, pieceData.special_scenario_movement]);

  // Parse special_scenario_capture JSON to get additional captures
  const parseSpecialScenarioCaptures = useMemo(() => {
    if (!pieceData.special_scenario_capture) return {};
    try {
      const parsed = typeof pieceData.special_scenario_capture === 'string'
        ? JSON.parse(pieceData.special_scenario_capture)
        : pieceData.special_scenario_capture;
      return parsed || {};
    } catch (e) {
      console.error('Error parsing special_scenario_capture:', e);
      return {};
    }
  }, [pieceData.special_scenario_capture]);

  // Helper function to check if a directional movement is first-move-only
  const isDirectionalMovementFirstMoveOnly = (direction) => {
    // Check global first_move_only flag
    if (pieceData.first_move_only) return true;
    
    // Check specific direction's availableForMoves field
    const availableForKey = `${direction}_movement_available_for`;
    if (pieceData[availableForKey]) return true;
    
    return false;
  };

  // Helper function to check if a directional capture is first-move-only
  const isDirectionalCaptureFirstMoveOnly = (direction) => {
    // Check global first_move_only_capture flag
    if (pieceData.first_move_only_capture) return true;
    
    // Check specific direction's availableForMoves field
    const availableForKey = `${direction}_capture_available_for`;
    if (pieceData[availableForKey]) return true;
    
    return false;
  };

  // Helper function to check if ratio movement is first-move-only
  const isRatioMovementFirstMoveOnly = () => {
    // Check global first_move_only flag
    if (pieceData.first_move_only) return true;
    
    // Check if ratio movement has availableForMoves in special_scenario_moves
    const specialMoves = parseSpecialScenarioMoves;
    if (specialMoves.ratio && Array.isArray(specialMoves.ratio)) {
      // Check if any ratio movement has availableForMoves property
      return specialMoves.ratio.some(move => move.availableForMoves);
    }
    
    return false;
  };

  // Helper function to check if ratio capture is first-move-only
  const isRatioCaptureFirstMoveOnly = () => {
    // Check global first_move_only_capture flag
    if (pieceData.first_move_only_capture) return true;
    
    // Check special scenario captures (not implemented yet, but keeping consistent)
    return false;
  };

  // Helper function to check if step-by-step movement is first-move-only
  const isStepMovementFirstMoveOnly = () => {
    // Check global first_move_only flag
    if (pieceData.first_move_only) return true;
    
    // Check if step movement has availableForMoves in special_scenario_moves
    const specialMoves = parseSpecialScenarioMoves;
    if (specialMoves.step && Array.isArray(specialMoves.step)) {
      return specialMoves.step.some(move => move.availableForMoves);
    }
    
    return false;
  };

  // Helper function to check if step-by-step capture is first-move-only
  const isStepCaptureFirstMoveOnly = () => {
    // Check global first_move_only_capture flag
    if (pieceData.first_move_only_capture) return true;
    
    return false;
  };
  
  // Calculate required board size based on movement/attack ranges
  const calculateBoardSize = () => {
    let maxRange = 0;
    
    // Check all directional movements (treat -1 as 12 for display)
    const movements = [
      pieceData.up_left_movement, pieceData.up_movement, pieceData.up_right_movement,
      pieceData.left_movement, pieceData.right_movement,
      pieceData.down_left_movement, pieceData.down_movement, pieceData.down_right_movement
    ];
    
    // Check all directional captures
    const captures = [
      pieceData.up_left_capture, pieceData.up_capture, pieceData.up_right_capture,
      pieceData.left_capture, pieceData.right_capture,
      pieceData.down_left_capture, pieceData.down_capture, pieceData.down_right_capture
    ];
    
    // Check all directional ranged attacks
    const attacks = [
      pieceData.up_left_attack_range, pieceData.up_attack_range, pieceData.up_right_attack_range,
      pieceData.left_attack_range, pieceData.right_attack_range,
      pieceData.down_left_attack_range, pieceData.down_attack_range, pieceData.down_right_attack_range
    ];
    
    // Check ratio movements
    const ratioMovement = Math.abs(pieceData.ratio_one_movement || 0) + Math.abs(pieceData.ratio_two_movement || 0);
    const ratioCapture = Math.abs(pieceData.ratio_one_capture || 0) + Math.abs(pieceData.ratio_two_capture || 0);
    const ratioAttack = Math.abs(pieceData.ratio_one_attack_range || 0) + Math.abs(pieceData.ratio_two_attack_range || 0);
    
    // Check step-by-step
    const stepMovement = Math.abs(pieceData.step_by_step_movement_value || 0);
    const stepCapture = Math.abs(pieceData.step_by_step_capture || 0);
    const stepAttack = Math.abs(pieceData.step_by_step_attack_range || 0);
    
    // Find max range (ignore 99 for infinite movement in board sizing)
    [...movements, ...captures, ...attacks].forEach(val => {
      if (val !== 99 && val !== null && val !== undefined) {
        const absVal = Math.abs(val);
        if (!isNaN(absVal)) {
          maxRange = Math.max(maxRange, absVal);
        }
      }
    });
    
    maxRange = Math.max(maxRange, ratioMovement, ratioCapture, ratioAttack, stepMovement, stepCapture, stepAttack);
    
    // Padding: at least 4 squares on every side of the piece, or enough for max range
    const padding = Math.max(4, maxRange);
    return padding;
  };
  
  // Multi-tile piece dimensions
  const pw = pieceData.piece_width || 1;
  const ph = pieceData.piece_height || 1;
  
  const boardPadding = calculateBoardSize();
  // Board dimensions: padding on each side + piece size
  const boardWidth = pw + (boardPadding * 2);
  const boardHeight = ph + (boardPadding * 2);
  // Anchor position: top-left of the piece footprint
  const anchorRow = boardPadding;
  const anchorCol = boardPadding;
  
  // Check if a square is occupied by the multi-tile piece
  const isPieceSquare = (row, col) => {
    return row >= anchorRow && row < anchorRow + ph && col >= anchorCol && col < anchorCol + pw;
  };
  
  // Check if any movement exceeds the board (ignore 99 infinite movement)
  const exceedsBoard = useMemo(() => {
    const movements = [
      pieceData.up_left_movement, pieceData.up_movement, pieceData.up_right_movement,
      pieceData.left_movement, pieceData.right_movement,
      pieceData.down_left_movement, pieceData.down_movement, pieceData.down_right_movement,
      pieceData.up_left_capture, pieceData.up_capture, pieceData.up_right_capture,
      pieceData.left_capture, pieceData.right_capture,
      pieceData.down_left_capture, pieceData.down_capture, pieceData.down_right_capture,
      pieceData.up_left_attack_range, pieceData.up_attack_range, pieceData.up_right_attack_range,
      pieceData.left_attack_range, pieceData.right_attack_range,
      pieceData.down_left_attack_range, pieceData.down_attack_range, pieceData.down_right_attack_range
    ];
    
    return movements.some(val => val !== 99 && val !== null && Math.abs(val) > boardPadding);
  }, [pieceData, boardPadding]);

  // Helper to check if a value allows movement at distance
  const checkMovement = (value, distance, isExact = false) => {
    if (value === 99) return true; // Infinite movement
    if (value === 0 || value === null) return false;
    if (isExact) {
      return distance === value; // Exact distance
    }
    return distance <= value; // Up to that distance
  };

  // Calculate which squares the piece can move to
  // Returns { allowed: boolean, isFirstMoveOnly: boolean }
  const canMoveTo = (row, col) => {
    if (isPieceSquare(row, col)) return { allowed: false, isFirstMoveOnly: false };
    
    // Check movement from every occupied square of the multi-tile piece
    const _checkMoveFrom = (srcRow, srcCol) => {
    const rowDiff = row - srcRow;
    const colDiff = col - srcCol;

    
    let directionalAllowed = false;
    let directionalDirection = null;
    
    // Directional movement
    if (pieceData.directional_movement_style) {
      // Up-left diagonal
      if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.up_left_movement, Math.abs(rowDiff), pieceData.up_left_movement_exact);
        directionalDirection = 'up_left';
      }
      // Up
      else if (rowDiff < 0 && colDiff === 0) {
        directionalAllowed = checkMovement(pieceData.up_movement, Math.abs(rowDiff), pieceData.up_movement_exact);
        directionalDirection = 'up';
      }
      // Up-right diagonal
      else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.up_right_movement, Math.abs(rowDiff), pieceData.up_right_movement_exact);
        directionalDirection = 'up_right';
      }
      // Right
      else if (rowDiff === 0 && colDiff > 0) {
        directionalAllowed = checkMovement(pieceData.right_movement, Math.abs(colDiff), pieceData.right_movement_exact);
        directionalDirection = 'right';
      }
      // Down-right diagonal
      else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.down_right_movement, Math.abs(rowDiff), pieceData.down_right_movement_exact);
        directionalDirection = 'down_right';
      }
      // Down
      else if (rowDiff > 0 && colDiff === 0) {
        directionalAllowed = checkMovement(pieceData.down_movement, Math.abs(rowDiff), pieceData.down_movement_exact);
        directionalDirection = 'down';
      }
      // Down-left diagonal
      else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.down_left_movement, Math.abs(rowDiff), pieceData.down_left_movement_exact);
        directionalDirection = 'down_left';
      }
      // Left
      else if (rowDiff === 0 && colDiff < 0) {
        directionalAllowed = checkMovement(pieceData.left_movement, Math.abs(colDiff), pieceData.left_movement_exact);
        directionalDirection = 'left';
      }
      
      // If directional movement allows it, check if it's first-move-only
      if (directionalAllowed && directionalDirection) {
        const isFirstMoveOnly = isDirectionalMovementFirstMoveOnly(directionalDirection);
        return { allowed: true, isFirstMoveOnly };
      }
    }

    // Check additional movements from special_scenario_moves
    const specialMoves = parseSpecialScenarioMoves;
    if (specialMoves.additionalMovements) {
      let directionToCheck = null;
      let distance = 0;
      
      // Determine direction and distance based on rowDiff/colDiff
      // Up-left diagonal
      if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionToCheck = 'up_left';
        distance = Math.abs(rowDiff);
      }
      // Up
      else if (rowDiff < 0 && colDiff === 0) {
        directionToCheck = 'up';
        distance = Math.abs(rowDiff);
      }
      // Up-right diagonal
      else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionToCheck = 'up_right';
        distance = Math.abs(rowDiff);
      }
      // Right
      else if (rowDiff === 0 && colDiff > 0) {
        directionToCheck = 'right';
        distance = Math.abs(colDiff);
      }
      // Down-right diagonal
      else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionToCheck = 'down_right';
        distance = Math.abs(rowDiff);
      }
      // Down
      else if (rowDiff > 0 && colDiff === 0) {
        directionToCheck = 'down';
        distance = Math.abs(rowDiff);
      }
      // Down-left diagonal
      else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionToCheck = 'down_left';
        distance = Math.abs(rowDiff);
      }
      // Left
      else if (rowDiff === 0 && colDiff < 0) {
        directionToCheck = 'left';
        distance = Math.abs(colDiff);
      }
      
      // Check if there are additional movements in this direction
      if (directionToCheck && specialMoves.additionalMovements[directionToCheck]) {
        const additionalMoves = specialMoves.additionalMovements[directionToCheck];
        
        if (Array.isArray(additionalMoves)) {
          for (const move of additionalMoves) {
            // Get the value and exact flag
            let moveValue = move.value;
            const isExact = move.exact;
            
            if (move.infinite) {
              moveValue = 99;
            }
            
            // Check if this additional movement allows reaching the target square
            if (checkMovement(moveValue, distance, isExact)) {
              // Check if it's first-move-only
              const isFirstMoveOnly = move.availableForMoves ? true : false;
              return { allowed: true, isFirstMoveOnly };
            }
          }
        }
      }
    }

    // Ratio movement (L-shape like knight)
    if (pieceData.ratio_movement_style && pieceData.ratio_one_movement && pieceData.ratio_two_movement) {
      const ratio1 = Math.abs(pieceData.ratio_one_movement);
      const ratio2 = Math.abs(pieceData.ratio_two_movement);
      
      if ((Math.abs(rowDiff) === ratio1 && Math.abs(colDiff) === ratio2) ||
          (Math.abs(rowDiff) === ratio2 && Math.abs(colDiff) === ratio1)) {
        const isFirstMoveOnly = isRatioMovementFirstMoveOnly();
        return { allowed: true, isFirstMoveOnly };
      }
    }

    // Step-by-step movement (takes precedence when directional is 0 or disabled)
    if (pieceData.step_by_step_movement_style && pieceData.step_by_step_movement_value) {
      const maxSteps = Math.abs(pieceData.step_by_step_movement_value);
      const noDiagonal = pieceData.step_by_step_movement_value < 0;
      
      if (noDiagonal) {
        // Only orthogonal movement (no diagonal) - can turn corners
        // Manhattan distance: can move N steps in cardinal directions
        const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
        if (manhattanDistance <= maxSteps) {
          const isFirstMoveOnly = isStepMovementFirstMoveOnly();
          return { allowed: true, isFirstMoveOnly };
        }
      } else {
        // Includes diagonal movement - can move like a king for N steps
        // Chebyshev distance: max of row/col differences
        const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
        if (chebyshevDistance <= maxSteps) {
          const isFirstMoveOnly = isStepMovementFirstMoveOnly();
          return { allowed: true, isFirstMoveOnly };
        }
      }
    }

    return { allowed: false, isFirstMoveOnly: false };
    };

    for (let srcRow = anchorRow; srcRow < anchorRow + ph; srcRow++) {
      for (let srcCol = anchorCol; srcCol < anchorCol + pw; srcCol++) {
        const result = _checkMoveFrom(srcRow, srcCol);
        if (result.allowed) return result;
      }
    }
    return { allowed: false, isFirstMoveOnly: false };
  };

  // Calculate which squares the piece can capture on move (by moving to them)
  // Returns { allowed: boolean, isFirstMoveOnly: boolean }
  const canCaptureOnMoveTo = (row, col) => {
    if (isPieceSquare(row, col)) return { allowed: false, isFirstMoveOnly: false };
    if (!pieceData.can_capture_enemy_on_move) return { allowed: false, isFirstMoveOnly: false };
    
    // Check capture from every occupied square of the multi-tile piece
    const _checkCaptureFrom = (srcRow, srcCol) => {
    const rowDiff = row - srcRow;
    const colDiff = col - srcCol;

    
    let directionalCaptureAllowed = false;
    let directionalDirection = null;
    
    // Up-left diagonal
    if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalCaptureAllowed = checkMovement(pieceData.up_left_capture, Math.abs(rowDiff), pieceData.up_left_capture_exact);
      directionalDirection = 'up_left';
    }
    // Up
    else if (rowDiff < 0 && colDiff === 0) {
      directionalCaptureAllowed = checkMovement(pieceData.up_capture, Math.abs(rowDiff), pieceData.up_capture_exact);
      directionalDirection = 'up';
    }
    // Up-right diagonal
    else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalCaptureAllowed = checkMovement(pieceData.up_right_capture, Math.abs(rowDiff), pieceData.up_right_capture_exact);
      directionalDirection = 'up_right';
    }
    // Right
    else if (rowDiff === 0 && colDiff > 0) {
      directionalCaptureAllowed = checkMovement(pieceData.right_capture, Math.abs(colDiff), pieceData.right_capture_exact);
      directionalDirection = 'right';
    }
    // Down-right diagonal
    else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalCaptureAllowed = checkMovement(pieceData.down_right_capture, Math.abs(rowDiff), pieceData.down_right_capture_exact);
      directionalDirection = 'down_right';
    }
    // Down
    else if (rowDiff > 0 && colDiff === 0) {
      directionalCaptureAllowed = checkMovement(pieceData.down_capture, Math.abs(rowDiff), pieceData.down_capture_exact);
      directionalDirection = 'down';
    }
    // Down-left diagonal
    else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalCaptureAllowed = checkMovement(pieceData.down_left_capture, Math.abs(rowDiff), pieceData.down_left_capture_exact);
      directionalDirection = 'down_left';
    }
    // Left
    else if (rowDiff === 0 && colDiff < 0) {
      directionalCaptureAllowed = checkMovement(pieceData.left_capture, Math.abs(colDiff), pieceData.left_capture_exact);
      directionalDirection = 'left';
    }
    
    if (directionalCaptureAllowed && directionalDirection) {
      const isFirstMoveOnly = isDirectionalCaptureFirstMoveOnly(directionalDirection);
      return { allowed: true, isFirstMoveOnly };
    }
    
    // Check additional captures from special_scenario_captures
    const specialCaptures = parseSpecialScenarioCaptures;
    if (specialCaptures.additionalCaptures) {
      let directionToCheck = null;
      let distance = 0;
      
      // Determine direction and distance based on rowDiff/colDiff
      // Up-left diagonal
      if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionToCheck = 'up_left';
        distance = Math.abs(rowDiff);
      }
      // Up
      else if (rowDiff < 0 && colDiff === 0) {
        directionToCheck = 'up';
        distance = Math.abs(rowDiff);
      }
      // Up-right diagonal
      else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionToCheck = 'up_right';
        distance = Math.abs(rowDiff);
      }
      // Right
      else if (rowDiff === 0 && colDiff > 0) {
        directionToCheck = 'right';
        distance = Math.abs(colDiff);
      }
      // Down-right diagonal
      else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionToCheck = 'down_right';
        distance = Math.abs(rowDiff);
      }
      // Down
      else if (rowDiff > 0 && colDiff === 0) {
        directionToCheck = 'down';
        distance = Math.abs(rowDiff);
      }
      // Down-left diagonal
      else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionToCheck = 'down_left';
        distance = Math.abs(rowDiff);
      }
      // Left
      else if (rowDiff === 0 && colDiff < 0) {
        directionToCheck = 'left';
        distance = Math.abs(colDiff);
      }
      
      // Check if there are additional captures in this direction
      if (directionToCheck && specialCaptures.additionalCaptures[directionToCheck]) {
        const additionalCaptures = specialCaptures.additionalCaptures[directionToCheck];
        
        if (Array.isArray(additionalCaptures)) {
          for (const capture of additionalCaptures) {
            // Get the value and exact flag
            let captureValue = capture.value;
            const isExact = capture.exact;
            
            if (capture.infinite) {
              captureValue = 99;
            }
            
            // Check if this additional capture allows reaching the target square
            if (checkMovement(captureValue, distance, isExact)) {
              // Check if it's first-move-only
              const isFirstMoveOnly = capture.availableForMoves ? true : false;
              return { allowed: true, isFirstMoveOnly };
            }
          }
        }
      }
    }
    
    // Ratio capture (L-shape)
    if (pieceData.ratio_one_capture && pieceData.ratio_two_capture) {
      const ratio1 = Math.abs(pieceData.ratio_one_capture);
      const ratio2 = Math.abs(pieceData.ratio_two_capture);
      
      if ((Math.abs(rowDiff) === ratio1 && Math.abs(colDiff) === ratio2) ||
          (Math.abs(rowDiff) === ratio2 && Math.abs(colDiff) === ratio1)) {
        const isFirstMoveOnly = isRatioCaptureFirstMoveOnly();
        return { allowed: true, isFirstMoveOnly };
      }
    }
    
    // Step-by-step capture
    if (pieceData.step_by_step_capture) {
      const maxSteps = Math.abs(pieceData.step_by_step_capture);
      const noDiagonal = pieceData.step_by_step_capture < 0;
      
      if (noDiagonal) {
        // Manhattan distance: orthogonal only
        const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
        if (manhattanDistance <= maxSteps) {
          const isFirstMoveOnly = isStepCaptureFirstMoveOnly();
          return { allowed: true, isFirstMoveOnly };
        }
      } else {
        // Chebyshev distance: includes diagonal
        const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
        if (chebyshevDistance <= maxSteps) {
          const isFirstMoveOnly = isStepCaptureFirstMoveOnly();
          return { allowed: true, isFirstMoveOnly };
        }
      }
    }
    
    return { allowed: false, isFirstMoveOnly: false };
    };

    for (let srcRow = anchorRow; srcRow < anchorRow + ph; srcRow++) {
      for (let srcCol = anchorCol; srcCol < anchorCol + pw; srcCol++) {
        const result = _checkCaptureFrom(srcRow, srcCol);
        if (result.allowed) return result;
      }
    }
    return { allowed: false, isFirstMoveOnly: false };
  };

  // Calculate which squares the piece can attack via range (without moving)
  const canRangedAttackTo = (row, col) => {
    if (isPieceSquare(row, col)) return false;
    if (!pieceData.can_capture_enemy_via_range) return false;
    
    // Check ranged attack from every occupied square of the multi-tile piece
    const _checkRangedFrom = (srcRow, srcCol) => {
    const rowDiff = row - srcRow;
    const colDiff = col - srcCol;

    
    let directionalRangedAllowed = false;
    
    // Up-left diagonal
    if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalRangedAllowed = checkMovement(pieceData.up_left_attack_range, Math.abs(rowDiff), pieceData.up_left_attack_range_exact);
    }
    // Up
    else if (rowDiff < 0 && colDiff === 0) {
      directionalRangedAllowed = checkMovement(pieceData.up_attack_range, Math.abs(rowDiff), pieceData.up_attack_range_exact);
    }
    // Up-right diagonal
    else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalRangedAllowed = checkMovement(pieceData.up_right_attack_range, Math.abs(rowDiff), pieceData.up_right_attack_range_exact);
    }
    // Right
    else if (rowDiff === 0 && colDiff > 0) {
      directionalRangedAllowed = checkMovement(pieceData.right_attack_range, Math.abs(colDiff), pieceData.right_attack_range_exact);
    }
    // Down-right diagonal
    else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalRangedAllowed = checkMovement(pieceData.down_right_attack_range, Math.abs(rowDiff), pieceData.down_right_attack_range_exact);
    }
    // Down
    else if (rowDiff > 0 && colDiff === 0) {
      directionalRangedAllowed = checkMovement(pieceData.down_attack_range, Math.abs(rowDiff), pieceData.down_attack_range_exact);
    }
    // Down-left diagonal
    else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalRangedAllowed = checkMovement(pieceData.down_left_attack_range, Math.abs(rowDiff), pieceData.down_left_attack_range_exact);
    }
    // Left
    else if (rowDiff === 0 && colDiff < 0) {
      directionalRangedAllowed = checkMovement(pieceData.left_attack_range, Math.abs(colDiff), pieceData.left_attack_range_exact);
    }
    
    if (directionalRangedAllowed) {
      return true;
    }

    // Ratio attack range (L-shape)
    if (pieceData.ratio_one_attack_range && pieceData.ratio_two_attack_range) {
      const ratio1 = Math.abs(pieceData.ratio_one_attack_range);
      const ratio2 = Math.abs(pieceData.ratio_two_attack_range);
      
      if ((Math.abs(rowDiff) === ratio1 && Math.abs(colDiff) === ratio2) ||
          (Math.abs(rowDiff) === ratio2 && Math.abs(colDiff) === ratio1)) {
        return true;
      }
    }

    // Step-by-step attack
    if (pieceData.step_by_step_attack_range) {
      const maxSteps = Math.abs(pieceData.step_by_step_attack_range);
      const noDiagonal = pieceData.step_by_step_attack_range < 0;
      
      if (noDiagonal) {
        // Manhattan distance: orthogonal only
        const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
        if (manhattanDistance <= maxSteps) {
          return true;
        }
      } else {
        // Chebyshev distance: includes diagonal
        const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
        if (chebyshevDistance <= maxSteps) {
          return true;
        }
      }
    }

    return false;
    };

    for (let srcRow = anchorRow; srcRow < anchorRow + ph; srcRow++) {
      for (let srcCol = anchorCol; srcCol < anchorCol + pw; srcCol++) {
        if (_checkRangedFrom(srcRow, srcCol)) return true;
      }
    }
    return false;
  };

  // Render the board
  const renderBoard = () => {
    const squares = [];
    
    for (let row = 0; row < boardHeight; row++) {
      for (let col = 0; col < boardWidth; col++) {
        const isAnchor = row === anchorRow && col === anchorCol;
        const isExtension = !isAnchor && isPieceSquare(row, col);
        const isCenter = isAnchor || isExtension;
        const isLight = (row + col) % 2 === 0;
        
        // Get movement and capture info with first-move-only status
        const moveInfo = isHovering && !isCenter ? canMoveTo(row, col) : { allowed: false, isFirstMoveOnly: false };
        const captureInfo = showAttack && isHovering && !isCenter ? canCaptureOnMoveTo(row, col) : { allowed: false, isFirstMoveOnly: false };
        const canRangedAttack = showAttack && isHovering && !isCenter && canRangedAttackTo(row, col);
        
        // Destructure for clearer code
        const canMove = moveInfo.allowed;
        const isMoveFirstOnly = moveInfo.isFirstMoveOnly;
        const canCaptureOnMove = captureInfo.allowed;
        const isCaptureFirstOnly = captureInfo.isFirstMoveOnly;
        
        let squareClass = `${styles["board-square"]} ${isLight ? styles["light"] : styles["dark"]}`;
        
        if (isCenter) {
          squareClass += ` ${styles["center-piece"]}`;
        } else if (canMove && canCaptureOnMove && canRangedAttack) {
          // Can move, capture on move, AND ranged attack
          // Use first-move-only styling if either move or capture is first-move-only
          if (isMoveFirstOnly || isCaptureFirstOnly) {
            squareClass += ` ${styles["can-all-three-first-only"]}`;
          } else {
            squareClass += ` ${styles["can-all-three"]}`;
          }
        } else if (canMove && canCaptureOnMove) {
          // Can move and capture on move
          if (isMoveFirstOnly && isCaptureFirstOnly) {
            squareClass += ` ${styles["can-move-and-capture-first-only"]}`;
          } else if (isMoveFirstOnly) {
            squareClass += ` ${styles["can-move-first-capture-normal"]}`;
          } else if (isCaptureFirstOnly) {
            squareClass += ` ${styles["can-move-normal-capture-first"]}`;
          } else {
            squareClass += ` ${styles["can-move-and-capture"]}`;
          }
        } else if (canMove && canRangedAttack) {
          // Can move and ranged attack
          if (isMoveFirstOnly) {
            squareClass += ` ${styles["can-move-and-ranged-first-only"]}`;
          } else {
            squareClass += ` ${styles["can-move-and-ranged"]}`;
          }
        } else if (canCaptureOnMove && canRangedAttack) {
          // Can capture on move and ranged attack
          if (isCaptureFirstOnly) {
            squareClass += ` ${styles["can-capture-and-ranged-first-only"]}`;
          } else {
            squareClass += ` ${styles["can-capture-and-ranged"]}`;
          }
        } else if (canMove) {
          // Movement only
          if (isMoveFirstOnly) {
            squareClass += ` ${styles["can-move-first-only"]}`;
          } else {
            squareClass += ` ${styles["can-move"]}`;
          }
        } else if (canCaptureOnMove) {
          // Capture on move only
          if (isCaptureFirstOnly) {
            squareClass += ` ${styles["can-capture-first-only"]}`;
          } else {
            squareClass += ` ${styles["can-capture-move"]}`;
          }
        } else if (canRangedAttack) {
          // Ranged attack only
          squareClass += ` ${styles["can-ranged-attack"]}`;
        }
        
        // Inline styles for user color preferences
        const squareStyle = {
          backgroundColor: isLight ? lightSquareColor : darkSquareColor
        };
        // Anchor square needs higher z-index so multi-tile image paints above extension squares
        if (isAnchor && (pw > 1 || ph > 1)) {
          squareStyle.zIndex = 10;
        }
        
        // Add icon for ranged attack
        let icon = null;
        if (!isCenter && isHovering && canRangedAttack) {
          icon = <span className={styles["ranged-icon"]} style={{ 
            backgroundColor: isLight ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.6)',
            borderRadius: '4px',
            padding: '2px 4px'
          }}>💥</span>;
        }
        
        const isMultiTile = pw > 1 || ph > 1;
        const isNonSquareMultiTile = isMultiTile && pw !== ph;
        const imgSrc = pieceData.piece_image_previews?.[0];
        
        squares.push(
          <div key={`${row}-${col}`} className={squareClass} style={squareStyle}>
            {isAnchor && imgSrc && (
              isNonSquareMultiTile ? (
                <div
                  ref={(el) => applySvgStretchBackground(el, imgSrc)}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: `${pw * 100}%`,
                    height: `${ph * 100}%`,
                    zIndex: 5,
                  }}
                />
              ) : isMultiTile ? (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: `${pw * 100}%`,
                    height: `${ph * 100}%`,
                    zIndex: 5,
                    backgroundImage: `url(${imgSrc})`,
                    backgroundSize: '100% 100%',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                  }}
                />
              ) : (
                <img src={imgSrc} alt="Piece" />
              )
            )}
            {isAnchor && !imgSrc && "?"}
            {icon}
          </div>
        );
      }
    }
    
    return squares;
  };

  return (
    <div className={styles["board-preview"]}>
      {exceedsBoard && (
        <div className={styles["board-warning"]}>
          ⚠️ This piece can move beyond this {boardWidth}x{boardHeight} board when playing on larger boards
        </div>
      )}
      <div 
        className={styles["board-grid"]} 
        style={{
          gridTemplateColumns: `repeat(${boardWidth}, 1fr)`,
          gridTemplateRows: `repeat(${boardHeight}, 1fr)`
        }}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {renderBoard()}
      </div>
      {showLegend && (
        <div className={styles["board-legend"]}>
          <div className={styles["legend-title"]}>Legend (hover over piece to see):</div>
          <div className={styles["legend-items"]}>
            <div className={styles["legend-item"]}>
              <div className={`${styles["legend-square"]} ${styles["legend-move"]}`}></div>
              <span>Regular Movement</span>
            </div>
            <div className={styles["legend-item"]}>
              <div className={`${styles["legend-square"]} ${styles["legend-move-first"]}`}></div>
              <span>First Moves Movement</span>
            </div>
            {showAttack && (
              <>
                <div className={styles["legend-item"]}>
                  <div className={`${styles["legend-square"]} ${styles["legend-capture"]}`}></div>
                  <span>Capture on Move</span>
                </div>
                <div className={styles["legend-item"]}>
                  <div className={`${styles["legend-square"]} ${styles["legend-capture-first"]}`}></div>
                  <span>First Moves Capture</span>
                </div>
              </>
            )}
            {showAttack && (
              <div className={styles["legend-item"]}>
                <div className={`${styles["legend-square"]} ${styles["legend-ranged"]}`}></div>
                <span>Ranged Attack 💥</span>
              </div>
            )}
          </div>
        </div>
      )}
      <div className={styles["board-info"]}>
        Board size: {boardWidth}x{boardHeight} | Piece position: ({anchorCol}, {anchorRow})
      </div>
    </div>
  );
};

export default PieceBoardPreview;
