import React, { useState, useMemo, useRef, useCallback, useEffect } from "react";
import styles from "./piecewizard.module.scss";
import { applySvgStretchBackground } from "../../helpers/svgStretchUtils";
import { getSquareHighlightStyle } from "../../helpers/pieceMovementUtils";
import BoardLegend from "../common/BoardLegend";
import SquareHighlightOverlay from "../common/SquareHighlightOverlay";

const PieceBoardPreview = ({ pieceData, showAttack = true, showLegend = true }) => {
  const [isHovering, setIsHovering] = useState(false);
  // Animation state: null = idle, 'moving' = piece sliding, 'paused' = landed, 'recentering' = board shifting back
  const [animState, setAnimState] = useState(null);
  // The target square the piece is moving to (grid row/col)
  const [moveTarget, setMoveTarget] = useState(null);
  // Offset applied to the grid during the re-center phase
  const [gridOffset, setGridOffset] = useState(null);
  const gridRef = useRef(null);
  // Track mouse position to re-enable hover after animation ends
  const mouseInsideRef = useRef(false);
  // Store measured pixel positions for animation
  const animDataRef = useRef(null);
  // Drag state: track whether user is dragging from the piece
  const [isDragging, setIsDragging] = useState(false);
  const [dragPos, setDragPos] = useState(null);
  const dragStartRef = useRef(null);
  
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

    // Extend board for repeating movements so the user can see at least the 2nd iteration.
    // Use the smallest repeating distance in any direction × 2.
    let repeatingExtension = 0;

    if (pieceData.repeating_movement) {
      // Collect exact directional distances that would repeat
      const exactMoveDirs = [
        pieceData.up_left_movement_exact ? pieceData.up_left_movement : null,
        pieceData.up_movement_exact ? pieceData.up_movement : null,
        pieceData.up_right_movement_exact ? pieceData.up_right_movement : null,
        pieceData.left_movement_exact ? pieceData.left_movement : null,
        pieceData.right_movement_exact ? pieceData.right_movement : null,
        pieceData.down_left_movement_exact ? pieceData.down_left_movement : null,
        pieceData.down_movement_exact ? pieceData.down_movement : null,
        pieceData.down_right_movement_exact ? pieceData.down_right_movement : null,
      ].filter(v => v && v !== 0 && v !== 99).map(v => Math.abs(v));

      if (exactMoveDirs.length > 0) {
        const smallest = Math.min(...exactMoveDirs);
        repeatingExtension = Math.max(repeatingExtension, smallest * 2);
      }
    }

    if (pieceData.repeating_ratio) {
      const r1 = Math.abs(pieceData.ratio_one_movement || 0);
      const r2 = Math.abs(pieceData.ratio_two_movement || 0);
      if (r1 > 0 && r2 > 0) {
        // For ratio, the max reach per axis for 2nd iteration is 2 * max(r1, r2)
        repeatingExtension = Math.max(repeatingExtension, 2 * Math.max(r1, r2));
      }
    }

    if (pieceData.repeating_capture) {
      const exactCapDirs = [
        pieceData.up_left_capture_exact ? pieceData.up_left_capture : null,
        pieceData.up_capture_exact ? pieceData.up_capture : null,
        pieceData.up_right_capture_exact ? pieceData.up_right_capture : null,
        pieceData.left_capture_exact ? pieceData.left_capture : null,
        pieceData.right_capture_exact ? pieceData.right_capture : null,
        pieceData.down_left_capture_exact ? pieceData.down_left_capture : null,
        pieceData.down_capture_exact ? pieceData.down_capture : null,
        pieceData.down_right_capture_exact ? pieceData.down_right_capture : null,
      ].filter(v => v && v !== 0 && v !== 99).map(v => Math.abs(v));

      if (exactCapDirs.length > 0) {
        const smallest = Math.min(...exactCapDirs);
        repeatingExtension = Math.max(repeatingExtension, smallest * 2);
      }
    }

    if (pieceData.repeating_ratio_capture) {
      const rc1 = Math.abs(pieceData.ratio_one_capture || 0);
      const rc2 = Math.abs(pieceData.ratio_two_capture || 0);
      if (rc1 > 0 && rc2 > 0) {
        repeatingExtension = Math.max(repeatingExtension, 2 * Math.max(rc1, rc2));
      }
    }

    maxRange = Math.max(maxRange, repeatingExtension);

    // Check custom squares for board size
    const checkCustomSquares = (json) => {
      if (!json) return;
      try {
        const arr = typeof json === 'string' ? JSON.parse(json) : json;
        if (Array.isArray(arr)) {
          arr.forEach(sq => {
            maxRange = Math.max(maxRange, Math.abs(sq.row), Math.abs(sq.col));
          });
        }
      } catch { /* ignore */ }
    };
    checkCustomSquares(pieceData.custom_movement_squares);
    checkCustomSquares(pieceData.custom_attack_squares);
    
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
  // Uses signed convention: positive = up-to, negative = exact, 99 = infinite
  // When repeating=true and value is exact (negative), allows multiples of the exact distance
  const checkMovement = (value, distance, repeating = false) => {
    if (value === 99) return true;
    if (value === 0 || value === null || value === undefined) return false;
    if (value > 0) return distance <= value;
    if (value < 0) {
      const exact = Math.abs(value);
      if (repeating) return distance > 0 && distance % exact === 0;
      return distance === exact;
    }
    return false;
  };

  // Convert a directional value + separate exact flag into signed convention
  const resolveExact = (value, exactFlag) => {
    if (!value || value === 99) return value;
    if (exactFlag === true || exactFlag === 1) return -Math.abs(value);
    return value;
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
      const rep = pieceData.repeating_movement;
      // Up-left diagonal
      if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(resolveExact(pieceData.up_left_movement, pieceData.up_left_movement_exact), Math.abs(rowDiff), rep && pieceData.up_left_movement_exact);
        directionalDirection = 'up_left';
      }
      // Up
      else if (rowDiff < 0 && colDiff === 0) {
        directionalAllowed = checkMovement(resolveExact(pieceData.up_movement, pieceData.up_movement_exact), Math.abs(rowDiff), rep && pieceData.up_movement_exact);
        directionalDirection = 'up';
      }
      // Up-right diagonal
      else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(resolveExact(pieceData.up_right_movement, pieceData.up_right_movement_exact), Math.abs(rowDiff), rep && pieceData.up_right_movement_exact);
        directionalDirection = 'up_right';
      }
      // Right
      else if (rowDiff === 0 && colDiff > 0) {
        directionalAllowed = checkMovement(resolveExact(pieceData.right_movement, pieceData.right_movement_exact), Math.abs(colDiff), rep && pieceData.right_movement_exact);
        directionalDirection = 'right';
      }
      // Down-right diagonal
      else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(resolveExact(pieceData.down_right_movement, pieceData.down_right_movement_exact), Math.abs(rowDiff), rep && pieceData.down_right_movement_exact);
        directionalDirection = 'down_right';
      }
      // Down
      else if (rowDiff > 0 && colDiff === 0) {
        directionalAllowed = checkMovement(resolveExact(pieceData.down_movement, pieceData.down_movement_exact), Math.abs(rowDiff), rep && pieceData.down_movement_exact);
        directionalDirection = 'down';
      }
      // Down-left diagonal
      else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(resolveExact(pieceData.down_left_movement, pieceData.down_left_movement_exact), Math.abs(rowDiff), rep && pieceData.down_left_movement_exact);
        directionalDirection = 'down_left';
      }
      // Left
      else if (rowDiff === 0 && colDiff < 0) {
        directionalAllowed = checkMovement(resolveExact(pieceData.left_movement, pieceData.left_movement_exact), Math.abs(colDiff), rep && pieceData.left_movement_exact);
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
            
            if (move.infinite) {
              moveValue = 99;
            }
            
            // Check if this additional movement allows reaching the target square
            if (checkMovement(resolveExact(moveValue, move.exact), distance)) {
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
      const absRow = Math.abs(rowDiff);
      const absCol = Math.abs(colDiff);
      
      if (pieceData.repeating_ratio) {
        const maxK = pieceData.max_ratio_iterations === -1 ? Math.max(absRow, absCol) : (pieceData.max_ratio_iterations || 1);
        for (let k = 1; k <= maxK; k++) {
          if ((absRow === k * ratio1 && absCol === k * ratio2) ||
              (absRow === k * ratio2 && absCol === k * ratio1)) {
            const isFirstMoveOnly = isRatioMovementFirstMoveOnly();
            return { allowed: true, isFirstMoveOnly };
          }
        }
      } else {
        if ((absRow === ratio1 && absCol === ratio2) ||
            (absRow === ratio2 && absCol === ratio1)) {
          const isFirstMoveOnly = isRatioMovementFirstMoveOnly();
          return { allowed: true, isFirstMoveOnly };
        }
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

    // Check custom movement squares
    if (pieceData.custom_movement_squares) {
      try {
        const customSquares = typeof pieceData.custom_movement_squares === 'string'
          ? JSON.parse(pieceData.custom_movement_squares)
          : pieceData.custom_movement_squares;
        if (Array.isArray(customSquares)) {
          for (const sq of customSquares) {
            if (row === anchorRow + sq.row && col === anchorCol + sq.col) {
              return { allowed: true, isFirstMoveOnly: false, isCustomOnly: true };
            }
          }
        }
      } catch { /* ignore parse errors */ }
    }

    return { allowed: false, isFirstMoveOnly: false, isCustomOnly: false };
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
    const repC = pieceData.repeating_capture;
    
    // Up-left diagonal
    if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalCaptureAllowed = checkMovement(resolveExact(pieceData.up_left_capture, pieceData.up_left_capture_exact), Math.abs(rowDiff), repC && pieceData.up_left_capture_exact);
      directionalDirection = 'up_left';
    }
    // Up
    else if (rowDiff < 0 && colDiff === 0) {
      directionalCaptureAllowed = checkMovement(resolveExact(pieceData.up_capture, pieceData.up_capture_exact), Math.abs(rowDiff), repC && pieceData.up_capture_exact);
      directionalDirection = 'up';
    }
    // Up-right diagonal
    else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalCaptureAllowed = checkMovement(resolveExact(pieceData.up_right_capture, pieceData.up_right_capture_exact), Math.abs(rowDiff), repC && pieceData.up_right_capture_exact);
      directionalDirection = 'up_right';
    }
    // Right
    else if (rowDiff === 0 && colDiff > 0) {
      directionalCaptureAllowed = checkMovement(resolveExact(pieceData.right_capture, pieceData.right_capture_exact), Math.abs(colDiff), repC && pieceData.right_capture_exact);
      directionalDirection = 'right';
    }
    // Down-right diagonal
    else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalCaptureAllowed = checkMovement(resolveExact(pieceData.down_right_capture, pieceData.down_right_capture_exact), Math.abs(rowDiff), repC && pieceData.down_right_capture_exact);
      directionalDirection = 'down_right';
    }
    // Down
    else if (rowDiff > 0 && colDiff === 0) {
      directionalCaptureAllowed = checkMovement(resolveExact(pieceData.down_capture, pieceData.down_capture_exact), Math.abs(rowDiff), repC && pieceData.down_capture_exact);
      directionalDirection = 'down';
    }
    // Down-left diagonal
    else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalCaptureAllowed = checkMovement(resolveExact(pieceData.down_left_capture, pieceData.down_left_capture_exact), Math.abs(rowDiff), repC && pieceData.down_left_capture_exact);
      directionalDirection = 'down_left';
    }
    // Left
    else if (rowDiff === 0 && colDiff < 0) {
      directionalCaptureAllowed = checkMovement(resolveExact(pieceData.left_capture, pieceData.left_capture_exact), Math.abs(colDiff), repC && pieceData.left_capture_exact);
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
            
            if (capture.infinite) {
              captureValue = 99;
            }
            
            // Check if this additional capture allows reaching the target square
            if (checkMovement(resolveExact(captureValue, capture.exact), distance)) {
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
      const absRow = Math.abs(rowDiff);
      const absCol = Math.abs(colDiff);
      
      if (pieceData.repeating_ratio_capture) {
        const maxK = pieceData.max_ratio_capture_iterations === -1 ? Math.max(absRow, absCol) : (pieceData.max_ratio_capture_iterations || 1);
        for (let k = 1; k <= maxK; k++) {
          if ((absRow === k * ratio1 && absCol === k * ratio2) ||
              (absRow === k * ratio2 && absCol === k * ratio1)) {
            const isFirstMoveOnly = isRatioCaptureFirstMoveOnly();
            return { allowed: true, isFirstMoveOnly };
          }
        }
      } else {
        if ((absRow === ratio1 && absCol === ratio2) ||
            (absRow === ratio2 && absCol === ratio1)) {
          const isFirstMoveOnly = isRatioCaptureFirstMoveOnly();
          return { allowed: true, isFirstMoveOnly };
        }
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

    // Check custom attack squares
    if (pieceData.custom_attack_squares) {
      try {
        const customSquares = typeof pieceData.custom_attack_squares === 'string'
          ? JSON.parse(pieceData.custom_attack_squares)
          : pieceData.custom_attack_squares;
        if (Array.isArray(customSquares)) {
          for (const sq of customSquares) {
            if (row === anchorRow + sq.row && col === anchorCol + sq.col) {
              return { allowed: true, isFirstMoveOnly: false, isCustomOnly: true };
            }
          }
        }
      } catch { /* ignore parse errors */ }
    }

    return { allowed: false, isFirstMoveOnly: false, isCustomOnly: false };
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
      directionalRangedAllowed = checkMovement(resolveExact(pieceData.up_left_attack_range, pieceData.up_left_attack_range_exact), Math.abs(rowDiff));
    }
    // Up
    else if (rowDiff < 0 && colDiff === 0) {
      directionalRangedAllowed = checkMovement(resolveExact(pieceData.up_attack_range, pieceData.up_attack_range_exact), Math.abs(rowDiff));
    }
    // Up-right diagonal
    else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalRangedAllowed = checkMovement(resolveExact(pieceData.up_right_attack_range, pieceData.up_right_attack_range_exact), Math.abs(rowDiff));
    }
    // Right
    else if (rowDiff === 0 && colDiff > 0) {
      directionalRangedAllowed = checkMovement(resolveExact(pieceData.right_attack_range, pieceData.right_attack_range_exact), Math.abs(colDiff));
    }
    // Down-right diagonal
    else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalRangedAllowed = checkMovement(resolveExact(pieceData.down_right_attack_range, pieceData.down_right_attack_range_exact), Math.abs(rowDiff));
    }
    // Down
    else if (rowDiff > 0 && colDiff === 0) {
      directionalRangedAllowed = checkMovement(resolveExact(pieceData.down_attack_range, pieceData.down_attack_range_exact), Math.abs(rowDiff));
    }
    // Down-left diagonal
    else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalRangedAllowed = checkMovement(resolveExact(pieceData.down_left_attack_range, pieceData.down_left_attack_range_exact), Math.abs(rowDiff));
    }
    // Left
    else if (rowDiff === 0 && colDiff < 0) {
      directionalRangedAllowed = checkMovement(resolveExact(pieceData.left_attack_range, pieceData.left_attack_range_exact), Math.abs(colDiff));
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

  // Check if a square is along a movement path where capture-on-hop applies
  // These are intermediate squares between the piece and movement destinations
  const canHopCaptureTo = (row, col) => {
    if (!pieceData.capture_on_hop) return false;
    if (isPieceSquare(row, col)) return false;

    // Parse additional movements/captures from special scenarios
    const additionalMovements = parseSpecialScenarioMoves?.additionalMovements || {};
    const additionalCaptures = parseSpecialScenarioCaptures?.additionalCaptures || {};

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

    for (let srcRow = anchorRow; srcRow < anchorRow + ph; srcRow++) {
      for (let srcCol = anchorCol; srcCol < anchorCol + pw; srcCol++) {
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

          const rowDiff = row - srcRow;
          const colDiff = col - srcCol;

          // Check this square is along this direction
          let isAlongDirection = false;
          let distance = 0;

          if (dir.dr === 0 && dir.dc !== 0) {
            // Horizontal
            isAlongDirection = rowDiff === 0 && Math.sign(colDiff) === dir.dc;
            distance = Math.abs(colDiff);
          } else if (dir.dc === 0 && dir.dr !== 0) {
            // Vertical
            isAlongDirection = colDiff === 0 && Math.sign(rowDiff) === dir.dr;
            distance = Math.abs(rowDiff);
          } else {
            // Diagonal
            isAlongDirection = Math.abs(rowDiff) === Math.abs(colDiff) &&
              Math.sign(rowDiff) === dir.dr && Math.sign(colDiff) === dir.dc;
            distance = Math.abs(rowDiff);
          }

          if (!isAlongDirection || distance < 1) continue;

          // Hop capture zone: squares between the piece and its max range
          const effectiveRange = maxVal === 99 ? boardPadding : maxVal;
          if (distance >= 1 && distance < effectiveRange) return true;
        }
      }
    }
    return false;
  };

  // Handle clicking a highlighted square to animate piece moving there
  const handleSquareClick = useCallback((row, col) => {
    if (animState) return; // Already animating
    if (isPieceSquare(row, col)) return;
    // Check if this square is a valid move or capture target
    const moveInfo = canMoveTo(row, col);
    const captureInfo = showAttack ? canCaptureOnMoveTo(row, col) : { allowed: false };
    if (!moveInfo.allowed && !captureInfo.allowed) return;

    // Measure actual square pixel sizes from the DOM for pixel-perfect positioning
    if (gridRef.current) {
      const squares = gridRef.current.querySelectorAll(`.${styles["board-square"]}`);
      if (squares.length > 0) {
        const gridRect = gridRef.current.getBoundingClientRect();
        const anchorIdx = anchorRow * boardWidth + anchorCol;
        const targetIdx = row * boardWidth + col;
        const anchorRect = squares[anchorIdx].getBoundingClientRect();
        const targetRect = squares[targetIdx].getBoundingClientRect();
        animDataRef.current = {
          targetLeft: targetRect.left - gridRect.left,
          targetTop: targetRect.top - gridRect.top,
          squareWidth: anchorRect.width,
          squareHeight: anchorRect.height,
          shiftX: targetRect.left - anchorRect.left,
          shiftY: targetRect.top - anchorRect.top,
        };
      }
    }

    setIsHovering(false);
    setIsDragging(false);
    setDragPos(null);
    dragStartRef.current = null;
    setMoveTarget({ row, col });
    // Skip slide animation — piece appears at target immediately (drag provides the visual)
    setAnimState('paused');

    const deltaRow = row - anchorRow;
    const deltaCol = col - anchorCol;
    // 0.75 second pause so the piece visually "lands" before the board shifts
    setTimeout(() => {
      // First: apply the grid shift instantly (no animation) — removes overlay, shows piece at anchor
      // The grid transform makes the anchor appear at the target's position
      setGridOffset({ row: deltaRow, col: deltaCol });
      setAnimState('shifted');
      setMoveTarget(null);
    }, 750);
  }, [animState, showAttack, anchorRow, anchorCol, boardWidth]);

  // Transition from 'shifted' → 'recentering' after the shifted frame is painted
  useEffect(() => {
    if (animState !== 'shifted') return;
    // Double rAF: first rAF queues after layout, second ensures the shifted
    // transform has actually been painted before we start the CSS animation
    const rafId = requestAnimationFrame(() => {
      const rafId2 = requestAnimationFrame(() => {
        setAnimState('recentering');
      });
      innerRafRef.current = rafId2;
    });
    const innerRafRef = { current: null };
    return () => {
      cancelAnimationFrame(rafId);
      if (innerRafRef.current) cancelAnimationFrame(innerRafRef.current);
    };
  }, [animState]);

  // Called when the re-center animation finishes
  const handleRecenterEnd = useCallback(() => {
    setAnimState(null);
    setGridOffset(null);
    animDataRef.current = null;
    // Re-enable hover if mouse is still inside the board
    if (mouseInsideRef.current) {
      setIsHovering(true);
    }
  }, []);

  // --- Drag-to-move handlers ---
  const handlePieceMouseDown = useCallback((e) => {
    if (animState) return;
    e.preventDefault();
    const gridRect = gridRef.current?.getBoundingClientRect();
    if (!gridRect) return;
    // Measure anchor square for centering the drag image
    const squares = gridRef.current.querySelectorAll(`.${styles["board-square"]}`);
    const anchorIdx = anchorRow * boardWidth + anchorCol;
    const anchorRect = squares[anchorIdx]?.getBoundingClientRect();
    if (!anchorRect) return;
    dragStartRef.current = {
      gridRect,
      anchorRect,
      squareWidth: anchorRect.width,
      squareHeight: anchorRect.height,
    };
    setDragPos({ x: e.clientX - gridRect.left, y: e.clientY - gridRect.top });
    setIsDragging(true);
    setIsHovering(true);
  }, [animState, anchorRow, anchorCol, boardWidth]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e) => {
      const gridRect = gridRef.current?.getBoundingClientRect();
      if (!gridRect) return;
      setDragPos({ x: e.clientX - gridRect.left, y: e.clientY - gridRect.top });
    };
    const handleMouseUp = () => {
      setIsDragging(false);
      setDragPos(null);
      dragStartRef.current = null;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Render the board
  // Extra rows/columns rendered outside the real board during animation.
  // Hidden by the wrapper's overflow:hidden at rest; slide into view when the grid translates.
  const phantomPad = (animState === 'shifted' || animState === 'recentering') && gridOffset
    ? Math.max(Math.abs(gridOffset.row), Math.abs(gridOffset.col))
    : 0;

  const renderBoard = () => {
    const squares = [];
    const isAnimating = !!animState;
    // During paused animation or dragging, hide piece from anchor; show on overlay instead
    const hidePieceOnAnchor = animState === 'paused' || isDragging;
    
    for (let row = -phantomPad; row < boardHeight + phantomPad; row++) {
      for (let col = -phantomPad; col < boardWidth + phantomPad; col++) {
        const isPhantom = row < 0 || row >= boardHeight || col < 0 || col >= boardWidth;
        
        // Phantom squares are just colored divs continuing the checkerboard
        if (isPhantom) {
          const isLight = ((row % 2) + 2) % 2 === ((col % 2) + 2) % 2; // handles negatives
          squares.push(
            <div
              key={`${row}-${col}`}
              className={`${styles["board-square"]} ${isLight ? styles["light"] : styles["dark"]}`}
              style={{ backgroundColor: isLight ? lightSquareColor : darkSquareColor }}
            />
          );
          continue;
        }
        
        const isAnchor = row === anchorRow && col === anchorCol;
        const isExtension = !isAnchor && isPieceSquare(row, col);
        const isCenter = isAnchor || isExtension;
        const isLight = (row + col) % 2 === 0;
        
        // Get movement and capture info with first-move-only status
        const moveInfo = isHovering && !isCenter ? canMoveTo(row, col) : { allowed: false, isFirstMoveOnly: false };
        const captureInfo = showAttack && isHovering && !isCenter ? canCaptureOnMoveTo(row, col) : { allowed: false, isFirstMoveOnly: false };
        const canRangedAttack = showAttack && isHovering && !isCenter && canRangedAttackTo(row, col);
        const isHopCapture = showAttack && isHovering && !isCenter && canHopCaptureTo(row, col);
        
        // Destructure for clearer code
        const canMove = moveInfo.allowed;
        const isMoveFirstOnly = moveInfo.isFirstMoveOnly;
        const isCustomMove = moveInfo.isCustomOnly || false;
        const canCaptureOnMove = captureInfo.allowed;
        const isCaptureFirstOnly = captureInfo.isFirstMoveOnly;
        const isCustomAttack = captureInfo.isCustomOnly || false;
        
        const isClickable = !isAnimating && !isCenter && (canMove || canCaptureOnMove);
        
        let squareClass = `${styles["board-square"]} ${isLight ? styles["light"] : styles["dark"]}`;
        
        if (isCenter) {
          squareClass += ` ${styles["center-piece"]}`;
        }
        if (isClickable) {
          squareClass += ` ${styles["clickable-square"]}`;
        }
        
        // Use shared highlight style utility
        const { style: highlightStyle, icon: highlightIcon } = (!isCenter)
          ? getSquareHighlightStyle(canMove, isMoveFirstOnly, canCaptureOnMove, isCaptureFirstOnly, canRangedAttack, isLight, isCustomMove, isCustomAttack)
          : { style: {}, icon: null };
        
        // Inline styles for user color preferences
        const squareStyle = {
          backgroundColor: isLight ? lightSquareColor : darkSquareColor
        };
        // Anchor square needs higher z-index so multi-tile image paints above extension squares
        if (isAnchor && (pw > 1 || ph > 1)) {
          squareStyle.zIndex = 10;
        }
        
        const isMultiTile = pw > 1 || ph > 1;
        const isNonSquareMultiTile = isMultiTile && pw !== ph;
        const imgSrc = pieceData.piece_image_previews?.[0];
        const showPiece = isAnchor && !hidePieceOnAnchor;
        
        squares.push(
          <div
            key={`${row}-${col}`}
            className={squareClass}
            style={squareStyle}
            onClick={isClickable ? () => handleSquareClick(row, col) : undefined}
            onMouseUp={isClickable ? () => handleSquareClick(row, col) : undefined}
          >
            <SquareHighlightOverlay
              highlightStyle={highlightStyle}
              highlightIcon={highlightIcon}
              canHopCapture={isHopCapture}
              squareSize={40}
              isLight={isLight}
            />
            {showPiece && imgSrc && (
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
                <img src={imgSrc} alt="Piece" draggable="false" onDragStart={(e) => e.preventDefault()} onMouseDown={handlePieceMouseDown} style={{ cursor: 'grab' }} />
              )
            )}
            {showPiece && !imgSrc && "?"}
          </div>
        );
      }
    }
    
    return squares;
  };

  // Render piece at target square during the paused state
  const renderPieceAnimOverlay = () => {
    if (animState !== 'paused' || !moveTarget) return null;
    const imgSrc = pieceData.piece_image_previews?.[0];
    if (!imgSrc) return null;
    const anim = animDataRef.current;
    if (!anim) return null;

    // Size the piece image to 80% of the square, centered
    const pieceW = anim.squareWidth * (pw > 1 ? pw : 0.8);
    const pieceH = anim.squareHeight * (ph > 1 ? ph : 0.8);
    const offsetX = (anim.squareWidth - pieceW) / 2;
    const offsetY = (anim.squareHeight - pieceH) / 2;

    return (
      <div
        className={styles["piece-anim-overlay-landed"]}
        style={{
          left: anim.targetLeft + offsetX,
          top: anim.targetTop + offsetY,
          width: pieceW,
          height: pieceH,
          zIndex: 20,
        }}
      >
        <img src={imgSrc} alt="Piece" draggable="false" style={{ width: '100%', height: '100%', objectFit: 'fill' }} />
      </div>
    );
  };

  // Compute grid inline styles — during recenter phase, offset then animate back
  const getGridStyle = () => {
    const totalW = boardWidth + 2 * phantomPad;
    const totalH = boardHeight + 2 * phantomPad;
    const base = {
      gridTemplateColumns: `repeat(${totalW}, 1fr)`,
      gridTemplateRows: `repeat(${totalH}, 1fr)`,
    };
    // Expand the grid and offset so the real board stays aligned with the wrapper
    if (phantomPad > 0) {
      base.width = `${(totalW / boardWidth) * 100}%`;
      base.marginLeft = `${(-phantomPad / boardWidth) * 100}%`;
      const sh = animDataRef.current?.squareHeight || 0;
      base.marginTop = `${-phantomPad * sh}px`;
      base.marginBottom = `${-phantomPad * sh}px`;
    }
    if ((animState === 'shifted' || animState === 'recentering') && gridOffset) {
      const anim = animDataRef.current;
      if (anim) {
        base['--shift-x'] = `${anim.shiftX ?? (gridOffset.col * anim.squareWidth)}px`;
        base['--shift-y'] = `${anim.shiftY ?? (gridOffset.row * anim.squareHeight)}px`;
      }
    }
    // During 'shifted', apply the transform directly (no animation) to pre-position the grid
    if (animState === 'shifted') {
      base.transform = `translate(var(--shift-x, 0), var(--shift-y, 0))`;
    }
    return base;
  };

  // Render drag ghost — piece image following the mouse cursor
  const renderDragGhost = () => {
    if (!isDragging || !dragPos) return null;
    const imgSrc = pieceData.piece_image_previews?.[0];
    if (!imgSrc) return null;
    const ds = dragStartRef.current;
    if (!ds) return null;
    const size = ds.squareWidth * 0.8;
    return (
      <div
        className={styles["piece-drag-ghost"]}
        style={{
          left: dragPos.x - size / 2,
          top: dragPos.y - size / 2,
          width: size,
          height: size,
        }}
      >
        <img src={imgSrc} alt="Piece" draggable="false" style={{ width: '100%', height: '100%', objectFit: 'fill' }} />
      </div>
    );
  };

  const gridClasses = [
    styles["board-grid"],
    animState === 'recentering' ? styles["board-grid-recentering"] : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={styles["board-preview"]}>
      {exceedsBoard && (
        <div className={styles["board-warning"]}>
          ⚠️ This piece can move beyond this {boardWidth}x{boardHeight} board when playing on larger boards
        </div>
      )}
      <div className={styles["board-grid-wrapper"]}>
        <div 
          ref={gridRef}
          className={gridClasses}
          style={getGridStyle()}
          onMouseEnter={() => { mouseInsideRef.current = true; if (!animState) setIsHovering(true); }}
          onMouseLeave={() => { mouseInsideRef.current = false; setIsHovering(false); }}
          onAnimationEnd={animState === 'recentering' ? handleRecenterEnd : undefined}
        >
          {renderBoard()}
          {renderPieceAnimOverlay()}
          {renderDragGhost()}
        </div>
      </div>
      {!animState && (
        <p className={styles["board-click-hint"]}>Click a highlighted square to see the piece move</p>
      )}
      {showLegend && (
        <BoardLegend
          showAttack={showAttack}
          showFirstAttack={showAttack}
          showRanged={showAttack && !!pieceData.can_capture_enemy_via_range}
          showHopCapture={showAttack && !!pieceData.capture_on_hop}
          showCustomMove={!!pieceData.custom_movement_squares}
          showCustomAttack={showAttack && !!pieceData.custom_attack_squares}
          labelStyle="descriptive"
          title="Legend (hover over piece to see):"
        />
      )}
      <div className={styles["board-info"]}>
        Board size: {boardWidth}x{boardHeight} | Piece position: ({anchorCol}, {anchorRow})
      </div>
    </div>
  );
};

export default PieceBoardPreview;
