import React, { useState, useMemo } from "react";
import styles from "./piecewizard.module.scss";

const PieceBoardPreview = ({ pieceData }) => {
  const [isHovering, setIsHovering] = useState(false);
  
  // Get user's preferred board colors from localStorage
  const lightSquareColor = localStorage.getItem('boardLightColor') || '#cad5e8';
  const darkSquareColor = localStorage.getItem('boardDarkColor') || '#08234d';
  
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
    
    // Board size should be at least 2*maxRange + 1 (to fit piece in center)
    // Minimum 9x9, maximum 15x15
    const calculatedSize = Math.max(9, Math.min(15, (maxRange * 2) + 1));
    return calculatedSize;
  };
  
  const boardSize = calculateBoardSize();
  const centerPos = Math.floor(boardSize / 2);
  
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
    
    return movements.some(val => val !== 99 && val !== null && Math.abs(val) > 7);
  }, [pieceData]);

  // Helper to check if a value allows movement at distance
  const checkMovement = (value, distance) => {
    if (value === 99) return true; // Infinite movement
    if (value === 0 || value === null) return false;
    if (value > 0) return distance <= value; // Up to that distance
    if (value < 0) return distance === Math.abs(value); // Exact distance
    return false;
  };

  // Calculate which squares the piece can move to
  const canMoveTo = (row, col) => {
    if (row === centerPos && col === centerPos) return false;
    
    const rowDiff = row - centerPos;
    const colDiff = col - centerPos;
    
    let directionalAllowed = false;
    
    // Directional movement
    if (pieceData.directional_movement_style) {
      // Up-left diagonal
      if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.up_left_movement, Math.abs(rowDiff));
      }
      // Up
      else if (rowDiff < 0 && colDiff === 0) {
        directionalAllowed = checkMovement(pieceData.up_movement, Math.abs(rowDiff));
      }
      // Up-right diagonal
      else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.up_right_movement, Math.abs(rowDiff));
      }
      // Right
      else if (rowDiff === 0 && colDiff > 0) {
        directionalAllowed = checkMovement(pieceData.right_movement, Math.abs(colDiff));
      }
      // Down-right diagonal
      else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.down_right_movement, Math.abs(rowDiff));
      }
      // Down
      else if (rowDiff > 0 && colDiff === 0) {
        directionalAllowed = checkMovement(pieceData.down_movement, Math.abs(rowDiff));
      }
      // Down-left diagonal
      else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.down_left_movement, Math.abs(rowDiff));
      }
      // Left
      else if (rowDiff === 0 && colDiff < 0) {
        directionalAllowed = checkMovement(pieceData.left_movement, Math.abs(colDiff));
      }
      
      // If directional movement allows it, return true
      if (directionalAllowed) {
        return true;
      }
    }

    // Ratio movement (L-shape like knight)
    if (pieceData.ratio_movement_style && pieceData.ratio_one_movement && pieceData.ratio_two_movement) {
      const ratio1 = Math.abs(pieceData.ratio_one_movement);
      const ratio2 = Math.abs(pieceData.ratio_two_movement);
      
      if ((Math.abs(rowDiff) === ratio1 && Math.abs(colDiff) === ratio2) ||
          (Math.abs(rowDiff) === ratio2 && Math.abs(colDiff) === ratio1)) {
        return true;
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
          return true;
        }
      } else {
        // Includes diagonal movement - can move like a king for N steps
        // Chebyshev distance: max of row/col differences
        const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
        if (chebyshevDistance <= maxSteps) {
          return true;
        }
      }
    }

    return false;
  };

  // Calculate which squares the piece can capture on move (by moving to them)
  const canCaptureOnMoveTo = (row, col) => {
    if (row === centerPos && col === centerPos) return false;
    if (!pieceData.can_capture_enemy_on_move) return false;
    
    const rowDiff = row - centerPos;
    const colDiff = col - centerPos;
    
    let directionalCaptureAllowed = false;
    
    // Up-left diagonal
    if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalCaptureAllowed = checkMovement(pieceData.up_left_capture, Math.abs(rowDiff));
    }
    // Up
    else if (rowDiff < 0 && colDiff === 0) {
      directionalCaptureAllowed = checkMovement(pieceData.up_capture, Math.abs(rowDiff));
    }
    // Up-right diagonal
    else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalCaptureAllowed = checkMovement(pieceData.up_right_capture, Math.abs(rowDiff));
    }
    // Right
    else if (rowDiff === 0 && colDiff > 0) {
      directionalCaptureAllowed = checkMovement(pieceData.right_capture, Math.abs(colDiff));
    }
    // Down-right diagonal
    else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalCaptureAllowed = checkMovement(pieceData.down_right_capture, Math.abs(rowDiff));
    }
    // Down
    else if (rowDiff > 0 && colDiff === 0) {
      directionalCaptureAllowed = checkMovement(pieceData.down_capture, Math.abs(rowDiff));
    }
    // Down-left diagonal
    else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalCaptureAllowed = checkMovement(pieceData.down_left_capture, Math.abs(rowDiff));
    }
    // Left
    else if (rowDiff === 0 && colDiff < 0) {
      directionalCaptureAllowed = checkMovement(pieceData.left_capture, Math.abs(colDiff));
    }
    
    if (directionalCaptureAllowed) {
      return true;
    }
    
    // Ratio capture (L-shape)
    if (pieceData.ratio_one_capture && pieceData.ratio_two_capture) {
      const ratio1 = Math.abs(pieceData.ratio_one_capture);
      const ratio2 = Math.abs(pieceData.ratio_two_capture);
      
      if ((Math.abs(rowDiff) === ratio1 && Math.abs(colDiff) === ratio2) ||
          (Math.abs(rowDiff) === ratio2 && Math.abs(colDiff) === ratio1)) {
        return true;
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

  // Calculate which squares the piece can attack via range (without moving)
  const canRangedAttackTo = (row, col) => {
    if (row === centerPos && col === centerPos) return false;
    if (!pieceData.can_capture_enemy_via_range) return false;
    
    const rowDiff = row - centerPos;
    const colDiff = col - centerPos;
    
    let directionalRangedAllowed = false;
    
    // Up-left diagonal
    if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalRangedAllowed = checkMovement(pieceData.up_left_attack_range, Math.abs(rowDiff));
    }
    // Up
    else if (rowDiff < 0 && colDiff === 0) {
      directionalRangedAllowed = checkMovement(pieceData.up_attack_range, Math.abs(rowDiff));
    }
    // Up-right diagonal
    else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalRangedAllowed = checkMovement(pieceData.up_right_attack_range, Math.abs(rowDiff));
    }
    // Right
    else if (rowDiff === 0 && colDiff > 0) {
      directionalRangedAllowed = checkMovement(pieceData.right_attack_range, Math.abs(colDiff));
    }
    // Down-right diagonal
    else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalRangedAllowed = checkMovement(pieceData.down_right_attack_range, Math.abs(rowDiff));
    }
    // Down
    else if (rowDiff > 0 && colDiff === 0) {
      directionalRangedAllowed = checkMovement(pieceData.down_attack_range, Math.abs(rowDiff));
    }
    // Down-left diagonal
    else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
      directionalRangedAllowed = checkMovement(pieceData.down_left_attack_range, Math.abs(rowDiff));
    }
    // Left
    else if (rowDiff === 0 && colDiff < 0) {
      directionalRangedAllowed = checkMovement(pieceData.left_attack_range, Math.abs(colDiff));
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

  // Render the board
  const renderBoard = () => {
    const squares = [];
    
    for (let row = 0; row < boardSize; row++) {
      for (let col = 0; col < boardSize; col++) {
        const isCenter = row === centerPos && col === centerPos;
        const isLight = (row + col) % 2 === 0;
        const canMove = isHovering && canMoveTo(row, col);
        const canCaptureOnMove = isHovering && canCaptureOnMoveTo(row, col);
        const canRangedAttack = isHovering && canRangedAttackTo(row, col);
        
        let squareClass = `${styles["board-square"]} ${isLight ? styles["light"] : styles["dark"]}`;
        
        if (isCenter) {
          squareClass += ` ${styles["center-piece"]}`;
        } else if (canMove && canCaptureOnMove && canRangedAttack) {
          // Can move, capture on move, AND ranged attack
          squareClass += ` ${styles["can-all-three"]}`;
        } else if (canMove && canCaptureOnMove) {
          // Can move and capture on move
          squareClass += ` ${styles["can-move-and-capture"]}`;
        } else if (canMove && canRangedAttack) {
          // Can move and ranged attack
          squareClass += ` ${styles["can-move-and-ranged"]}`;
        } else if (canCaptureOnMove && canRangedAttack) {
          // Can capture on move and ranged attack
          squareClass += ` ${styles["can-capture-and-ranged"]}`;
        } else if (canMove) {
          // Movement only
          squareClass += ` ${styles["can-move"]}`;
        } else if (canCaptureOnMove) {
          // Capture on move only
          squareClass += ` ${styles["can-capture-move"]}`;
        } else if (canRangedAttack) {
          // Ranged attack only
          squareClass += ` ${styles["can-ranged-attack"]}`;
        }
        
        // Inline styles for user color preferences
        const squareStyle = {
          backgroundColor: isLight ? lightSquareColor : darkSquareColor
        };
        
        // Add icon for ranged attack
        let icon = null;
        if (!isCenter && isHovering && canRangedAttack) {
          icon = <span className={styles["ranged-icon"]}>🎯</span>;
        }
        
        squares.push(
          <div key={`${row}-${col}`} className={squareClass} style={squareStyle}>
            {isCenter && pieceData.piece_image_previews?.[0] && (
              <img src={pieceData.piece_image_previews[0]} alt="Piece" />
            )}
            {isCenter && !pieceData.piece_image_previews?.[0] && "?"}
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
          ⚠️ This piece can move beyond this {boardSize}x{boardSize} board when playing on larger boards
        </div>
      )}
      <div 
        className={styles["board-grid"]} 
        style={{
          gridTemplateColumns: `repeat(${boardSize}, 1fr)`,
          gridTemplateRows: `repeat(${boardSize}, 1fr)`
        }}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {renderBoard()}
      </div>
      <div className={styles["board-info"]}>
        Board size: {boardSize}x{boardSize} | Piece position: ({centerPos}, {centerPos})
      </div>
    </div>
  );
};

export default PieceBoardPreview;
