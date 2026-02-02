import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { useSocket } from "../../contexts/SocketContext";
import styles from "./livegame.module.scss";
import soundManager from "../../utils/soundEffects";

// Helper to ensure pieces is always an array
const parsePieces = (pieces) => {
  if (!pieces) return [];
  if (Array.isArray(pieces)) return pieces;
  if (typeof pieces === 'string') {
    try {
      const parsed = JSON.parse(pieces);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const LiveGame = () => {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useSelector((state) => state.authReducer);
  
  const { 
    connected, 
    getGameState,
    joinGame,
    makeMove,
    resign,
    cancelGame,
    setPremove: sendPremove,
    clearPremove: sendClearPremove,
    onGameEvent
  } = useSocket();

  const [gameState, setGameState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [moveError, setMoveError] = useState(null);
  const [selectedPiece, setSelectedPiece] = useState(null);
  const [validMoves, setValidMoves] = useState([]);
  const [showGameOver, setShowGameOver] = useState(false);
  const [gameOverData, setGameOverData] = useState(null);
  const [hoveredPiece, setHoveredPiece] = useState(null);
  const [hoveredMoves, setHoveredMoves] = useState([]);
  const [draggedPiece, setDraggedPiece] = useState(null);
  const [dragValidMoves, setDragValidMoves] = useState([]);
  const [inCheck, setInCheck] = useState(false);
  const [checkedPieces, setCheckedPieces] = useState([]);
  const [showMovableIndicators, setShowMovableIndicators] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const soundEnabledRef = useRef(false);
  const [premove, setPremove] = useState(null); // Store premove {from, to, pieceId}

  // Load game state on mount
  useEffect(() => {
    const loadGame = async () => {
      if (!connected) return;
      
      setLoading(true);
      try {
        const state = await getGameState(parseInt(gameId));
        // Ensure allowPremoves is set (default to true if not specified)
        if (state.allowPremoves === undefined) {
          state.allowPremoves = true;
        }
        // Ensure premove property exists
        if (state.premove === undefined) {
          state.premove = null;
        }
        setGameState(state);
      } catch (err) {
        setError(err.message || "Failed to load game");
      } finally {
        setLoading(false);
      }
    };

    loadGame();
  }, [gameId, connected, getGameState]);

  // Subscribe to game events
  useEffect(() => {
    const unsubscribeMove = onGameEvent("moveMade", ({ gameId: moveGameId, move, gameState: newState }) => {
      if (parseInt(moveGameId) === parseInt(gameId)) {
        console.log('moveMade received:', { 
          moveFrom: move.from, 
          moveTo: move.to, 
          pieceId: move.pieceId,
          piecesCount: newState.pieces?.length 
        });
        
        setGameState(prev => {
          // Ensure allowPremoves is set
          const allowPremoves = newState.allowPremoves !== undefined ? newState.allowPremoves : (prev?.allowPremoves !== undefined ? prev.allowPremoves : true);
          const rated = newState.rated !== undefined ? newState.rated : (prev?.rated !== undefined ? prev.rated : true);
          
          // Clone pieces array to ensure React detects the change
          const updatedState = {
            ...prev,
            ...newState,
            pieces: newState.pieces ? [...newState.pieces] : prev?.pieces,
            allowPremoves,
            rated
          };
          
          console.log('Updated state pieces:', updatedState.pieces?.find(p => p.id === move.pieceId));
          
          return updatedState;
        });
        setSelectedPiece(null);
        setValidMoves([]);
        // Update check status from move response
        setInCheck(newState.inCheck || false);
        setCheckedPieces(newState.checkedPieces || []);
        
        // Play sound based on move type - prioritize check > capture > move
        if (soundEnabledRef.current) {
          if (newState.inCheck) {
            soundManager.playCheck();
          } else if (move.captured) {
            soundManager.playCapture();
          } else {
            soundManager.playMove();
          }
        }
        
        // Check if premove piece still exists, if not clear it
        setPremove(prev => {
          if (prev) {
            const premovePiece = newState.pieces?.find(p => 
              p.x === prev.from.x && p.y === prev.from.y && p.id === prev.pieceId
            );
            if (!premovePiece) {
              return null; // Piece was captured or moved, clear premove
            }
          }
          return prev;
        });
      }
    });

    const unsubscribeCheck = onGameEvent("check", ({ gameId: checkGameId, playerId, playerPosition, checkedPieces: pieces }) => {
      if (parseInt(checkGameId) === parseInt(gameId)) {
        setInCheck(true);
        setCheckedPieces(pieces || []);
        if (soundEnabledRef.current) {
          soundManager.playCheck();
        }
      }
    });

    const unsubscribeGameOver = onGameEvent("gameOver", ({ gameId: overGameId, winner, winnerUsername, reason, finalState }) => {
      if (parseInt(overGameId) === parseInt(gameId)) {
        setGameOverData({ winner, winnerUsername, reason });
        setShowGameOver(true);
        setGameState(prev => ({ 
          ...prev, 
          status: 'completed', 
          winner,
          // Update pieces from finalState if available (includes the final move that caused checkmate)
          pieces: finalState?.pieces || prev.pieces,
          currentTurn: finalState?.currentTurn || prev.currentTurn
        }));
        setInCheck(false);
        setCheckedPieces([]);
        // Play appropriate sound based on game end reason
        if (soundEnabledRef.current) {
          if (reason === 'checkmate') {
            soundManager.playCheckmate();
          } else if (reason === 'stalemate') {
            // For stalemate, play a neutral sound (move sound)
            soundManager.playMove();
          }
        }
      }
    });

    const unsubscribeTimeUpdate = onGameEvent("timeUpdate", ({ gameId: timerGameId, playerTimes, currentTurn }) => {
      if (parseInt(timerGameId) === parseInt(gameId)) {
        setGameState(prev => ({
          ...prev,
          playerTimes: playerTimes || prev.playerTimes,
          currentTurn: currentTurn || prev.currentTurn
        }));
      }
    });

    const unsubscribePlayerJoined = onGameEvent("playerJoined", ({ gameId: joinedGameId, gameState: newState }) => {
      if (parseInt(joinedGameId) === parseInt(gameId)) {
        setGameState(prev => {
          // Play game start sound when both players have joined and game starts
          if (soundEnabledRef.current && newState.status === 'active' && (!prev || prev.status !== 'active')) {
            soundManager.playGameStart();
          }
          
          return {
            ...prev,
            ...newState,
            // Ensure we keep allowPremoves and rated
            allowPremoves: newState.allowPremoves !== undefined ? newState.allowPremoves : (prev.allowPremoves !== undefined ? prev.allowPremoves : true),
            rated: newState.rated !== undefined ? newState.rated : (prev.rated !== undefined ? prev.rated : true)
          };
        });
      }
    });

    const unsubscribeGameState = onGameEvent("gameState", (state) => {
      if (parseInt(state.id) === parseInt(gameId)) {
        setGameState(state);
        setLoading(false);
      }
    });

    // Listen for move errors (e.g., "You must get out of check")
    const unsubscribeError = onGameEvent("error", ({ message }) => {
      setMoveError(message);
      if (soundEnabledRef.current) {
        soundManager.playIllegalMove();
      }
      // Clear error after 3 seconds
      setTimeout(() => setMoveError(null), 3000);
    });

    // Listen for premove events
    const unsubscribePremoveSet = onGameEvent("premoveSet", ({ gameId: premoveGameId }) => {
      if (parseInt(premoveGameId) === parseInt(gameId)) {
        // Premove confirmed - UI already set
        if (soundEnabledRef.current) {
          soundManager.playPremove();
        }
      }
    });

    const unsubscribePremoveCancelled = onGameEvent("premoveCancelled", ({ gameId: cancelGameId, reason }) => {
      if (parseInt(cancelGameId) === parseInt(gameId)) {
        setPremove(null);
        setSelectedPiece(null);
        setValidMoves([]);
        // Don't show error message for premove cancellation - it's not the user's fault
        // The opponent's move made the premove invalid, which is expected behavior
        // setMoveError(reason || "Premove cancelled");
        // if (soundEnabledRef.current) {
        //   soundManager.playIllegalMove();
        // }
        // setTimeout(() => setMoveError(null), 3000);
      }
    });

    const unsubscribePremoveExecuted = onGameEvent("premoveExecuted", ({ gameId: execGameId, move, gameState: newState }) => {
      if (parseInt(execGameId) === parseInt(gameId)) {
        setPremove(null);
        setGameState(prev => ({
          ...prev,
          pieces: newState.pieces,
          currentTurn: newState.currentTurn,
          playerTimes: newState.playerTimes,
          moveHistory: newState.moveHistory
        }));
        // Play sound for premove execution
        if (soundEnabledRef.current) {
          if (move.captured) {
            soundManager.playCapture();
          } else {
            soundManager.playMove();
          }
        }
      }
    });

    const unsubscribePremoveCleared = onGameEvent("premoveCleared", ({ gameId: clearGameId }) => {
      if (parseInt(clearGameId) === parseInt(gameId)) {
        setPremove(null);
      }
    });

    return () => {
      unsubscribeMove();
      unsubscribeCheck();
      unsubscribeGameOver();
      unsubscribeTimeUpdate();
      unsubscribePlayerJoined();
      unsubscribeGameState();
      unsubscribeError();
      unsubscribePremoveSet();
      unsubscribePremoveCancelled();
      unsubscribePremoveExecuted();
      unsubscribePremoveCleared();
    };
  }, [gameId, onGameEvent]);

  // Get current player info
  const currentPlayer = useMemo(() => {
    if (!gameState?.players || !currentUser) return null;
    return gameState.players.find(p => p.id === currentUser.id);
  }, [gameState?.players, currentUser]);

  // Check if it's the current user's turn
  const isMyTurn = useMemo(() => {
    if (!currentPlayer || !gameState) return false;
    return currentPlayer.position === gameState.currentTurn;
  }, [currentPlayer, gameState]);

  // Clear premove when it becomes your turn (premove didn't execute or was cancelled)
  useEffect(() => {
    if (isMyTurn && premove) {
      console.log('Clearing premove because it\'s now your turn');
      setPremove(null);
    }
  }, [isMyTurn, premove]);

  // Format time display
  const formatTime = (seconds) => {
    if (!seconds && seconds !== 0) return "∞";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Helper function to check if a value allows movement at a distance
  const checkMovement = (value, distance) => {
    if (value === 99) return true; // Infinite movement
    if (value === 0 || value === null || value === undefined) return false;
    if (value > 0) return distance <= value; // Up to X squares
    if (value < 0) return distance === Math.abs(value); // Exact X squares
    return false;
  };

  // Check if a move is from a first-move-only additional movement option
  const checkIfFirstMoveOnlyMove = (pieceData, fromX, fromY, toX, toY, playerPosition) => {
    if (!pieceData.special_scenario_moves) return false;
    
    try {
      const parsed = typeof pieceData.special_scenario_moves === 'string'
        ? JSON.parse(pieceData.special_scenario_moves)
        : pieceData.special_scenario_moves;
      const additionalMovements = parsed?.additionalMovements || {};
      
      const rowDiff = playerPosition === 2 ? (fromY - toY) : (toY - fromY);
      const colDiff = playerPosition === 2 ? (fromX - toX) : (toX - fromX);
      const distance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      
      // Determine direction
      let direction = null;
      if (rowDiff < 0 && colDiff === 0) direction = 'up';
      else if (rowDiff > 0 && colDiff === 0) direction = 'down';
      else if (rowDiff === 0 && colDiff < 0) direction = 'left';
      else if (rowDiff === 0 && colDiff > 0) direction = 'right';
      else if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'up_left';
      else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'up_right';
      else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'down_left';
      else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'down_right';
      
      if (!direction || !additionalMovements[direction]) return false;
      
      // Check if any of the additional movements for this direction are first-move-only
      for (const movementOption of additionalMovements[direction]) {
        if (!movementOption.firstMoveOnly) continue;
        
        const value = movementOption.value || 0;
        if (movementOption.infinite && distance > 0) return true;
        if (movementOption.exact && distance === value) return true;
        if (!movementOption.exact && !movementOption.infinite && distance > 0 && distance <= value) return true;
      }
    } catch (e) {
      // Ignore parse errors
    }
    
    return false;
  };

  // Check if a capture is from a first-move-only additional capture option
  const checkIfFirstMoveOnlyCapture = (pieceData, fromX, fromY, toX, toY, playerPosition) => {
    if (!pieceData.special_scenario_captures) return false;
    
    try {
      const parsed = typeof pieceData.special_scenario_captures === 'string'
        ? JSON.parse(pieceData.special_scenario_captures)
        : pieceData.special_scenario_captures;
      const additionalCaptures = parsed?.additionalCaptures || {};
      
      const rowDiff = playerPosition === 2 ? (fromY - toY) : (toY - fromY);
      const colDiff = playerPosition === 2 ? (fromX - toX) : (toX - fromX);
      const distance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      
      // Determine direction
      let direction = null;
      if (rowDiff < 0 && colDiff === 0) direction = 'up';
      else if (rowDiff > 0 && colDiff === 0) direction = 'down';
      else if (rowDiff === 0 && colDiff < 0) direction = 'left';
      else if (rowDiff === 0 && colDiff > 0) direction = 'right';
      else if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'up_left';
      else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'up_right';
      else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'down_left';
      else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) direction = 'down_right';
      
      if (!direction || !additionalCaptures[direction]) return false;
      
      // Check if any of the additional captures for this direction are first-move-only
      for (const captureOption of additionalCaptures[direction]) {
        if (!captureOption.firstMoveOnly) continue;
        
        const value = captureOption.value || 0;
        if (captureOption.infinite && distance > 0) return true;
        if (captureOption.exact && distance === value) return true;
        if (!captureOption.exact && !captureOption.infinite && distance > 0 && distance <= value) return true;
      }
    } catch (e) {
      // Ignore parse errors
    }
    
    return false;
  };

  // Check if piece can move to a square (not capturing)
  const canPieceMoveTo = useCallback((fromX, fromY, toX, toY, pieceData, playerPosition) => {
    if (!pieceData) return false;
    if (fromX === toX && fromY === toY) return false;

    // For player 2, flip the perspective (so "up" is towards player 1 and "left" is towards player 1's left)
    const rowDiff = playerPosition === 2 ? (fromY - toY) : (toY - fromY);
    const colDiff = playerPosition === 2 ? (fromX - toX) : (toX - fromX);

    // Check directional movement - accept if style is set OR if any directional movement values are present
    const directionalStyle = pieceData.directional_movement_style;
    const hasDirectionalValues = pieceData.up_movement || pieceData.down_movement || 
                                  pieceData.left_movement || pieceData.right_movement ||
                                  pieceData.up_left_movement || pieceData.up_right_movement ||
                                  pieceData.down_left_movement || pieceData.down_right_movement;
    
    if (directionalStyle || hasDirectionalValues) {
      let directionalAllowed = false;

      // Check 8 directions
      if (rowDiff < 0 && colDiff === 0) {
        directionalAllowed = checkMovement(pieceData.up_movement, Math.abs(rowDiff));
      } else if (rowDiff > 0 && colDiff === 0) {
        directionalAllowed = checkMovement(pieceData.down_movement, Math.abs(rowDiff));
      } else if (rowDiff === 0 && colDiff < 0) {
        directionalAllowed = checkMovement(pieceData.left_movement, Math.abs(colDiff));
      } else if (rowDiff === 0 && colDiff > 0) {
        directionalAllowed = checkMovement(pieceData.right_movement, Math.abs(colDiff));
      } else if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.up_left_movement, Math.abs(rowDiff));
      } else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.up_right_movement, Math.abs(rowDiff));
      } else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.down_left_movement, Math.abs(rowDiff));
      } else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.down_right_movement, Math.abs(rowDiff));
      }

      if (directionalAllowed) return true;
    }

    // Check ratio movement (L-shape like knight)
    const ratioStyle = pieceData.ratio_movement_style;
    const ratio1 = pieceData.ratio_movement_1 || 0;
    const ratio2 = pieceData.ratio_movement_2 || 0;
    
    if ((ratioStyle || (ratio1 > 0 && ratio2 > 0)) && ratio1 > 0 && ratio2 > 0) {
      if ((Math.abs(rowDiff) === ratio1 && Math.abs(colDiff) === ratio2) ||
          (Math.abs(rowDiff) === ratio2 && Math.abs(colDiff) === ratio1)) {
        return true;
      }
    }

    // Check step-by-step movement
    const stepStyle = pieceData.step_movement_style;
    const stepValue = pieceData.step_movement_value;
    if (stepStyle || stepValue) {
      const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
      const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      
      if (stepStyle === 'manhattan' || stepStyle === 1) {
        return checkMovement(stepValue, manhattanDistance);
      } else if (stepStyle === 'chebyshev' || stepStyle === 2) {
        return checkMovement(stepValue, chebyshevDistance);
      } else {
        // Default to chebyshev if value exists but style not specified
        return checkMovement(stepValue, chebyshevDistance);
      }
    }

    return false;
  }, []);

  // Check if piece can capture on a square
  const canPieceCaptureTo = useCallback((fromX, fromY, toX, toY, pieceData, playerPosition) => {
    if (!pieceData) return false;
    if (fromX === toX && fromY === toY) return false;

    // For player 2, flip the perspective (mirror both row and column)
    const rowDiff = playerPosition === 2 ? (fromY - toY) : (toY - fromY);
    const colDiff = playerPosition === 2 ? (fromX - toX) : (toX - fromX);

    // Check if separate capture fields are defined
    const hasSeparateCaptureFields = pieceData.up_capture || pieceData.down_capture || 
                                     pieceData.left_capture || pieceData.right_capture || 
                                     pieceData.up_left_capture || pieceData.up_right_capture ||
                                     pieceData.down_left_capture || pieceData.down_right_capture ||
                                     pieceData.ratio_capture_1 || pieceData.ratio_capture_2 ||
                                     pieceData.step_capture_value;

    // If piece can capture on move AND no separate capture fields, use movement logic
    if ((pieceData.can_capture_enemy_on_move === 1 || pieceData.can_capture_enemy_on_move === true) && !hasSeparateCaptureFields) {
      return canPieceMoveTo(fromX, fromY, toX, toY, pieceData, playerPosition);
    }

    // Check directional capture - check if any capture fields have values
    const hasDirectionalCapture = pieceData.up_capture || pieceData.down_capture || pieceData.left_capture || 
                                   pieceData.right_capture || pieceData.up_left_capture || pieceData.up_right_capture ||
                                   pieceData.down_left_capture || pieceData.down_right_capture;
    
    if (hasDirectionalCapture) {
      let directionalAllowed = false;

      if (rowDiff < 0 && colDiff === 0) {
        directionalAllowed = checkMovement(pieceData.up_capture, Math.abs(rowDiff));
      } else if (rowDiff > 0 && colDiff === 0) {
        directionalAllowed = checkMovement(pieceData.down_capture, Math.abs(rowDiff));
      } else if (rowDiff === 0 && colDiff < 0) {
        directionalAllowed = checkMovement(pieceData.left_capture, Math.abs(colDiff));
      } else if (rowDiff === 0 && colDiff > 0) {
        directionalAllowed = checkMovement(pieceData.right_capture, Math.abs(colDiff));
      } else if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.up_left_capture, Math.abs(rowDiff));
      } else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.up_right_capture, Math.abs(rowDiff));
      } else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.down_left_capture, Math.abs(rowDiff));
      } else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.down_right_capture, Math.abs(rowDiff));
      }

      if (directionalAllowed) return true;
    }

    // Check ratio capture (L-shape)
    const ratio1 = pieceData.ratio_capture_1 || 0;
    const ratio2 = pieceData.ratio_capture_2 || 0;
    if (ratio1 > 0 && ratio2 > 0) {
      if ((Math.abs(rowDiff) === ratio1 && Math.abs(colDiff) === ratio2) ||
          (Math.abs(rowDiff) === ratio2 && Math.abs(colDiff) === ratio1)) {
        return true;
      }
    }

    // Check step-by-step capture
    if (pieceData.step_capture_value) {
      const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
      const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      // Default to chebyshev if no style specified
      return checkMovement(pieceData.step_capture_value, chebyshevDistance) || 
             checkMovement(pieceData.step_capture_value, manhattanDistance);
    }

    return false;
  }, [canPieceMoveTo]);

  // Check if path is clear for sliding pieces (no pieces in between)
  const isPathClear = useCallback((fromX, fromY, toX, toY, pieces) => {
    const dx = Math.sign(toX - fromX);
    const dy = Math.sign(toY - fromY);
    
    // Check if it's a knight-like move (L-shape)
    const xDiff = Math.abs(toX - fromX);
    const yDiff = Math.abs(toY - fromY);
    if (xDiff !== yDiff && xDiff !== 0 && yDiff !== 0) {
      // L-shape move - need to check hopping abilities
      // This is handled separately in calculateValidMoves for ratio movements
      // For now, return true and let the server validate
      // TODO: Implement proper L-shape path checking with hopping abilities
      return true;
    }

    let x = fromX + dx;
    let y = fromY + dy;

    while (x !== toX || y !== toY) {
      if (pieces.some(p => p.x === x && p.y === y)) {
        return false;
      }
      x += dx;
      y += dy;
    }

    return true;
  }, []);

  // Helper to check both possible L-shaped paths
  const checkBothLPaths = useCallback((fromX, fromY, dx, dy, absDx, absDy, pieces, canHopOver) => {
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const targetX = fromX + dx;
    const targetY = fromY + dy;
    
    // Path 1: Move along X axis first, then Y axis
    let path1Clear = true;
    // Move along X
    for (let i = 1; i <= absDx; i++) {
      const checkX = fromX + (stepX * i);
      const checkY = fromY;
      if (checkX !== targetX || checkY !== targetY) {
        const obstruction = pieces.find(p => p.x === checkX && p.y === checkY);
        if (obstruction && !canHopOver(obstruction)) {
          path1Clear = false;
          break;
        }
      }
    }
    // Then move along Y from the end of X movement
    if (path1Clear) {
      for (let i = 1; i <= absDy; i++) {
        const checkX = fromX + (stepX * absDx);
        const checkY = fromY + (stepY * i);
        if (checkX !== targetX || checkY !== targetY) {
          const obstruction = pieces.find(p => p.x === checkX && p.y === checkY);
          if (obstruction && !canHopOver(obstruction)) {
            path1Clear = false;
            break;
          }
        }
      }
    }
    
    // Path 2: Move along Y axis first, then X axis
    let path2Clear = true;
    // Move along Y
    for (let i = 1; i <= absDy; i++) {
      const checkX = fromX;
      const checkY = fromY + (stepY * i);
      if (checkX !== targetX || checkY !== targetY) {
        const obstruction = pieces.find(p => p.x === checkX && p.y === checkY);
        if (obstruction && !canHopOver(obstruction)) {
          path2Clear = false;
          break;
        }
      }
    }
    // Then move along X from the end of Y movement
    if (path2Clear) {
      for (let i = 1; i <= absDx; i++) {
        const checkX = fromX + (stepX * i);
        const checkY = fromY + (stepY * absDy);
        if (checkX !== targetX || checkY !== targetY) {
          const obstruction = pieces.find(p => p.x === checkX && p.y === checkY);
          if (obstruction && !canHopOver(obstruction)) {
            path2Clear = false;
            break;
          }
        }
      }
    }
    
    return path1Clear || path2Clear;
  }, []);

  // Check if L-shape path is clear considering hopping abilities
  const checkRatioPathClear = useCallback((piece, targetX, targetY, pieces) => {
    const canHopAllies = piece.can_hop_over_allies === 1 || piece.can_hop_over_allies === true;
    const canHopEnemies = piece.can_hop_over_enemies === 1 || piece.can_hop_over_enemies === true;
    
    // If can hop over everything, path is always clear
    if (canHopAllies && canHopEnemies) {
      return true;
    }
    
    const pieceOwner = piece.player_id || piece.team;
    const dx = targetX - piece.x;
    const dy = targetY - piece.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    
    // If no hopping ability, check if both L-shape paths are clear
    if (!canHopAllies && !canHopEnemies) {
      return checkBothLPaths(piece.x, piece.y, dx, dy, absDx, absDy, pieces, () => false);
    }
    
    // Helper to check if piece can hop over an obstruction
    const canHopOver = (obstruction) => {
      const obstructionOwner = obstruction.player_id || obstruction.team;
      const isAlly = obstructionOwner === pieceOwner;
      return (isAlly && canHopAllies) || (!isAlly && canHopEnemies);
    };
    
    return checkBothLPaths(piece.x, piece.y, dx, dy, absDx, absDy, pieces, canHopOver);
  }, [checkBothLPaths]);

  // Check if a specific piece is under attack by any enemy piece
  const isPieceUnderAttack = useCallback((targetPiece, pieces, boardWidth, boardHeight) => {
    const targetTeam = targetPiece.player_id || targetPiece.team;
    
    // Check all enemy pieces
    for (const enemyPiece of pieces) {
      const enemyTeam = enemyPiece.player_id || enemyPiece.team;
      if (enemyTeam === targetTeam) continue; // Skip friendly pieces
      
      // Check if enemy can capture the target piece
      if (canPieceCaptureTo(enemyPiece.x, enemyPiece.y, targetPiece.x, targetPiece.y, enemyPiece, enemyTeam)) {
        // Check if path is clear - handle ratio movement (L-shape) specially
        const isRatioMove = enemyPiece.ratio_capture_1 > 0 && enemyPiece.ratio_capture_2 > 0 &&
                           ((Math.abs(targetPiece.x - enemyPiece.x) === enemyPiece.ratio_capture_1 && Math.abs(targetPiece.y - enemyPiece.y) === enemyPiece.ratio_capture_2) ||
                            (Math.abs(targetPiece.x - enemyPiece.x) === enemyPiece.ratio_capture_2 && Math.abs(targetPiece.y - enemyPiece.y) === enemyPiece.ratio_capture_1));
        
        // If no ratio capture, check if attacks like movement uses ratio movement
        const usesRatioForCapture = !isRatioMove && enemyPiece.attacks_like_movement && 
                                     enemyPiece.ratio_movement_1 > 0 && enemyPiece.ratio_movement_2 > 0 &&
                                     ((Math.abs(targetPiece.x - enemyPiece.x) === enemyPiece.ratio_movement_1 && Math.abs(targetPiece.y - enemyPiece.y) === enemyPiece.ratio_movement_2) ||
                                      (Math.abs(targetPiece.x - enemyPiece.x) === enemyPiece.ratio_movement_2 && Math.abs(targetPiece.y - enemyPiece.y) === enemyPiece.ratio_movement_1));
        
        let pathClear = false;
        if (isRatioMove || usesRatioForCapture) {
          // Use L-shape path checking for ratio movements
          pathClear = checkRatioPathClear(enemyPiece, targetPiece.x, targetPiece.y, pieces);
        } else {
          // Use standard path checking for other movements
          pathClear = isPathClear(enemyPiece.x, enemyPiece.y, targetPiece.x, targetPiece.y, pieces);
        }
        
        if (pathClear) {
          return true;
        }
      }
    }
    return false;
  }, [canPieceCaptureTo, isPathClear, checkRatioPathClear]);

  // Check if a player is in check (any piece with ends_game_on_checkmate is under attack)
  const checkForCheck = useCallback((pieces, playerPosition, boardWidth, boardHeight) => {
    // Find all pieces belonging to this player that have ends_game_on_checkmate
    const checkmatePieces = pieces.filter(p => {
      const pieceOwnerPosition = p.team || p.player_id;
      return pieceOwnerPosition === playerPosition && p.ends_game_on_checkmate;
    });
    
    if (checkmatePieces.length === 0) {
      return { inCheck: false, checkedPieces: [] };
    }
    
    const checkedPieces = [];
    for (const piece of checkmatePieces) {
      if (isPieceUnderAttack(piece, pieces, boardWidth, boardHeight)) {
        checkedPieces.push(piece);
      }
    }
    
    return {
      inCheck: checkedPieces.length > 0,
      checkedPieces
    };
  }, [isPieceUnderAttack]);

  // Check if a move would resolve check (or not leave the player in check)
  const wouldMoveResolveCheck = useCallback((piece, toX, toY, pieces, playerPosition, boardWidth, boardHeight) => {
    // Create a simulated pieces array
    const simulatedPieces = pieces.map(p => ({ ...p }));
    
    // Find and remove any captured piece at the destination
    const capturedIndex = simulatedPieces.findIndex(p => p.x === toX && p.y === toY && p.id !== piece.id);
    if (capturedIndex !== -1) {
      simulatedPieces.splice(capturedIndex, 1);
    }
    
    // Update the moving piece's position
    const movingPieceIndex = simulatedPieces.findIndex(p => p.id === piece.id);
    if (movingPieceIndex !== -1) {
      simulatedPieces[movingPieceIndex] = { ...simulatedPieces[movingPieceIndex], x: toX, y: toY };
    }
    
    // Check if player would still be in check after this move
    const checkResult = checkForCheck(simulatedPieces, playerPosition, boardWidth, boardHeight);
    return !checkResult.inCheck;
  }, [checkForCheck]);

  // Calculate valid moves for a piece using actual piece movement data
  const calculateValidMoves = useCallback((piece, pieces, boardWidth, boardHeight, skipCheckFilter = false) => {
    const moves = [];
    const pieceTeam = piece.player_id || piece.team;

    // Debug: Log piece movement data
    console.log('Calculating moves for piece:', {
      id: piece.id,
      piece_id: piece.piece_id,
      name: piece.piece_name || piece.name,
      x: piece.x,
      y: piece.y,
      team: pieceTeam,
      directional_movement_style: piece.directional_movement_style,
      up_movement: piece.up_movement,
      down_movement: piece.down_movement,
      left_movement: piece.left_movement,
      right_movement: piece.right_movement,
      ratio_movement_style: piece.ratio_movement_style,
      ratio_movement_1: piece.ratio_movement_1,
      ratio_movement_2: piece.ratio_movement_2,
      can_capture_enemy_on_move: piece.can_capture_enemy_on_move
    });

    // Iterate through all squares on the board
    for (let toY = 0; toY < boardHeight; toY++) {
      for (let toX = 0; toX < boardWidth; toX++) {
        // Skip current position
        if (toX === piece.x && toY === piece.y) continue;

        const occupyingPiece = pieces.find(p => p.x === toX && p.y === toY);
        const occupyingTeam = occupyingPiece?.player_id || occupyingPiece?.team;

        // Skip squares with friendly pieces
        if (occupyingPiece && occupyingTeam === pieceTeam) continue;

        const isCapture = !!occupyingPiece;

        // Check if move is valid based on piece movement rules
        let isValidMove = false;
        
        if (isCapture) {
          // Check capture rules
          isValidMove = canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
        } else {
          // Check movement rules
          isValidMove = canPieceMoveTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
        }

        // If move is valid, check if path is clear
        // For ratio movements (L-shape), use special path checking
        const isRatioMove = piece.ratio_movement_1 > 0 && piece.ratio_movement_2 > 0 &&
                           ((Math.abs(toX - piece.x) === piece.ratio_movement_1 && Math.abs(toY - piece.y) === piece.ratio_movement_2) ||
                            (Math.abs(toX - piece.x) === piece.ratio_movement_2 && Math.abs(toY - piece.y) === piece.ratio_movement_1));
        
        let pathClear = false;
        if (isRatioMove) {
          // Check L-shape paths with hopping abilities
          pathClear = checkRatioPathClear(piece, toX, toY, pieces);
        } else {
          pathClear = isPathClear(piece.x, piece.y, toX, toY, pieces);
        }
        
        if (isValidMove && pathClear) {
          // Check if this is a first-move-only option
          const isFirstMoveOnly = isCapture 
            ? checkIfFirstMoveOnlyCapture(piece, piece.x, piece.y, toX, toY, pieceTeam)
            : checkIfFirstMoveOnlyMove(piece, piece.x, piece.y, toX, toY, pieceTeam);
          
          moves.push({
            x: toX,
            y: toY,
            isCapture,
            isFirstMoveOnly
          });
        }
      }
    }

    console.log('Valid moves found:', moves.length, moves);
    
    // Filter out moves that would leave the player in check (if mate_condition is enabled and not skipped)
    if (!skipCheckFilter && gameState?.gameType?.mate_condition && currentPlayer) {
      const legalMoves = moves.filter(move => 
        wouldMoveResolveCheck(piece, move.x, move.y, pieces, currentPlayer.position, boardWidth, boardHeight)
      );
      console.log('Legal moves (after check filter):', legalMoves.length, legalMoves);
      return legalMoves;
    }
    
    return moves;
  }, [canPieceMoveTo, canPieceCaptureTo, isPathClear, checkRatioPathClear, gameState, currentPlayer, wouldMoveResolveCheck]);

  // Handle square click
  const handleSquareClick = useCallback((x, y) => {
    console.log('Square clicked:', { x, y, isMyTurn, status: gameState?.status, selectedPiece: selectedPiece?.piece_name });
    
    // Allow selecting pieces to preview moves when waiting or during gameplay
    const canInteract = gameState && gameState.status !== 'completed';
    if (!canInteract) {
      console.log('Cannot interact: game completed or no game state');
      return;
    }

    const pieces = parsePieces(gameState.pieces);
    const clickedPiece = pieces.find(p => p.x === x && p.y === y);

    // Check if clicking on own piece (or any piece when waiting/previewing)
    const isPreviewMode = gameState.status === 'waiting' || gameState.status === 'ready';
    const isOwnPiece = clickedPiece && (
      clickedPiece.player_id === currentPlayer?.position ||
      clickedPiece.team === currentPlayer?.position
    );
    
    console.log('Click context:', { 
      clickedPiece: clickedPiece?.piece_name, 
      isPreviewMode, 
      isOwnPiece,
      piecePlayerId: clickedPiece?.player_id,
      pieceTeam: clickedPiece?.team,
      currentPlayerPosition: currentPlayer?.position
    });

    // If clicking on opponent's piece, clear selection and return
    if (clickedPiece && !isOwnPiece && !isPreviewMode) {
      console.log('Clicked opponent piece, clearing selection');
      setSelectedPiece(null);
      setValidMoves([]);
      return;
    }

    // In preview mode, allow selecting any piece to see its moves
    // In game mode, only allow selecting own pieces when it's your turn
    // OR allow selecting own pieces when it's opponent's turn for premoves
    const canSelectForPremove = !isMyTurn && (gameState.status === 'active' || gameState.status === 'ready') && gameState.allowPremoves !== false && isOwnPiece;
    console.log('Piece selection check:', { 
      canSelectForPremove, 
      isMyTurn, 
      status: gameState.status, 
      allowPremoves: gameState.allowPremoves, 
      isOwnPiece 
    });
    if (clickedPiece && (isPreviewMode || (isOwnPiece && isMyTurn) || canSelectForPremove)) {
      setSelectedPiece(clickedPiece);
      const moves = calculateValidMoves(
        clickedPiece, 
        pieces, 
        gameState.gameType?.board_width || 8, 
        gameState.gameType?.board_height || 8
      );
      setValidMoves(moves);
      return;
    }

    // If piece is selected and clicking on valid move, make the move (during ready or active game)
    const canMakeMove = selectedPiece && isMyTurn && (gameState.status === 'active' || gameState.status === 'ready');
    const canPremove = selectedPiece && !isMyTurn && (gameState.status === 'active' || gameState.status === 'ready') && gameState.allowPremoves !== false;
    
    console.log('Move conditions:', { canMakeMove, canPremove, selectedPiece: !!selectedPiece, isMyTurn, status: gameState.status, allowPremoves: gameState.allowPremoves });
    
    if (canMakeMove) {
      const move = validMoves.find(m => m.x === x && m.y === y);
      console.log('Attempting move:', { move, validMovesCount: validMoves.length });
      if (move) {
        console.log('Making move!', { from: { x: selectedPiece.x, y: selectedPiece.y }, to: { x, y } });
        makeMove(parseInt(gameId), {
          from: { x: selectedPiece.x, y: selectedPiece.y },
          to: { x, y },
          pieceId: selectedPiece.id
        });
        setSelectedPiece(null);
        setValidMoves([]);
      } else {
        console.log('Not a valid move, deselecting');
        // Clicking elsewhere, deselect
        setSelectedPiece(null);
        setValidMoves([]);
      }
    } else if (canPremove) {
      const move = validMoves.find(m => m.x === x && m.y === y);
      if (move) {
        console.log('Setting premove!', { from: { x: selectedPiece.x, y: selectedPiece.y }, to: { x, y } });
        const premoveData = {
          from: { x: selectedPiece.x, y: selectedPiece.y },
          to: { x, y },
          pieceId: selectedPiece.id
        };
        setPremove(premoveData); // Set local state
        sendPremove(parseInt(gameId), premoveData); // Send to server
        setSelectedPiece(null);
        setValidMoves([]);
      } else {
        // Clicking elsewhere, deselect
        setSelectedPiece(null);
        setValidMoves([]);
      }
    } else {
      console.log('Cannot make move:', { hasSelectedPiece: !!selectedPiece, isMyTurn, status: gameState?.status });
      // Clicking elsewhere, deselect
      setSelectedPiece(null);
      setValidMoves([]);
    }
  }, [isMyTurn, gameState, currentPlayer, selectedPiece, validMoves, calculateValidMoves, makeMove, sendPremove, setPremove, gameId]);

  // Handle piece hover for movement helpers
  const handlePieceHover = useCallback((piece) => {
    if (!gameState?.showPieceHelpers) return;
    if (!piece) {
      setHoveredPiece(null);
      setHoveredMoves([]);
      return;
    }

    const pieces = parsePieces(gameState.pieces);
    const moves = calculateValidMoves(
      piece, 
      pieces, 
      gameState.gameType?.board_width || 8, 
      gameState.gameType?.board_height || 8
    );
    setHoveredPiece(piece);
    setHoveredMoves(moves);
  }, [gameState, calculateValidMoves]);

  // Drag and drop handlers
  const handleDragStart = useCallback((e, piece) => {
    console.log('Drag start:', { piece: piece?.piece_name, isMyTurn, status: gameState?.status });
    
    const pieceTeam = piece.player_id || piece.team;
    const isOwnPiece = currentPlayer && pieceTeam === currentPlayer.position;
    
    // Allow dragging own pieces during your turn OR for premoves during opponent's turn
    const canDragForMove = isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready') && isOwnPiece;
    const canDragForPremove = !isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready') && gameState?.allowPremoves !== false && isOwnPiece;
    
    if (!canDragForMove && !canDragForPremove) {
      console.log('Drag prevented: not valid for move or premove');
      e.preventDefault();
      return;
    }

    setDraggedPiece(piece);
    setSelectedPiece(piece);
    
    // Calculate valid moves for the dragged piece
    const pieces = parsePieces(gameState.pieces);
    const moves = calculateValidMoves(
      piece,
      pieces,
      gameState.gameType?.board_width || 8,
      gameState.gameType?.board_height || 8
    );
    console.log('Drag valid moves:', moves.length);
    setDragValidMoves(moves);
    setValidMoves(moves);
    
    e.dataTransfer.effectAllowed = 'move';
    // Set drag data to make it work properly
    e.dataTransfer.setData('text/plain', piece.id);
    e.currentTarget.style.opacity = '0.5';
  }, [isMyTurn, gameState, currentPlayer, calculateValidMoves]);

  const handleDragEnd = useCallback((e) => {
    console.log('Drag end');
    e.currentTarget.style.opacity = '1';
    setDraggedPiece(null);
    setDragValidMoves([]);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e, targetX, targetY) => {
    e.preventDefault();
    e.stopPropagation();
    
    console.log('Drop:', { targetX, targetY, draggedPiece: draggedPiece?.piece_name, isMyTurn, status: gameState?.status });
    
    if (!draggedPiece) {
      console.log('Drop prevented: no dragged piece');
      return;
    }

    // Check if target is a valid move
    const validMove = dragValidMoves.find(m => m.x === targetX && m.y === targetY);
    console.log('Valid move found:', validMove);
    
    if (!validMove) {
      // User tried to make a move that's not in the valid moves list
      // Check if it's because of check restrictions
      if (draggedPiece && gameState?.gameType?.mate_condition && gameState?.pieces) {
        // Calculate moves WITHOUT check filter to see if this was a valid move mechanically
        const movesWithoutCheckFilter = calculateValidMoves(
          draggedPiece,
          gameState.pieces,
          gameState?.gameType?.board_width || 8,
          gameState?.gameType?.board_height || 8,
          true // Skip check filter
        );
        
        // Check if the attempted move would be valid without check restrictions
        const moveWithoutCheckFilter = movesWithoutCheckFilter.find(m => m.x === targetX && m.y === targetY);
        
        if (moveWithoutCheckFilter) {
          // The move is mechanically valid but was filtered out by check validation
          if (inCheck && currentPlayer?.position === gameState?.currentTurn) {
            setMoveError("You must get out of check");
          } else {
            setMoveError("This move would put you in check");
          }
          setTimeout(() => setMoveError(null), 3000);
          if (soundEnabledRef.current) {
            soundManager.playIllegalMove();
          }
        }
        // If moveWithoutCheckFilter is also undefined, the move is invalid for other reasons
        // (piece can't move that way), so don't show a warning
      }
      return;
    }
    
    if (validMove) {
      // Check if this is a regular move or premove
      const canMakeMove = isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready');
      const canMakePremove = !isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready') && gameState?.allowPremoves !== false;
      
      if (canMakeMove) {
        console.log('Making move:', { from: { x: draggedPiece.x, y: draggedPiece.y }, to: { x: targetX, y: targetY } });
        makeMove(parseInt(gameId), {
          from: { x: draggedPiece.x, y: draggedPiece.y },
          to: { x: targetX, y: targetY },
          pieceId: draggedPiece.id
        });
      } else if (canMakePremove) {
        console.log('Setting premove via drag:', { from: { x: draggedPiece.x, y: draggedPiece.y }, to: { x: targetX, y: targetY } });
        const premoveData = {
          from: { x: draggedPiece.x, y: draggedPiece.y },
          to: { x: targetX, y: targetY },
          pieceId: draggedPiece.id
        };
        setPremove(premoveData);
        sendPremove(parseInt(gameId), premoveData);
      }
    }

    setSelectedPiece(null);
    setValidMoves([]);
    setDraggedPiece(null);
    setDragValidMoves([]);
  }, [draggedPiece, dragValidMoves, isMyTurn, gameState, makeMove, sendPremove, gameId, inCheck, currentPlayer, soundEnabledRef]);

  // Handle right-click to move selected piece or cancel premove
  const handleSquareRightClick = useCallback((e, x, y) => {
    e.preventDefault();
    
    console.log('Right-click:', { x, y, selectedPiece: selectedPiece?.piece_name, isMyTurn, status: gameState?.status, hasPremove: !!premove });
    
    // Right-click cancels premove if one exists
    if (premove) {
      console.log('Cancelling premove via right-click');
      setPremove(null);
      sendClearPremove(parseInt(gameId));
      setSelectedPiece(null);
      setValidMoves([]);
      return;
    }
    
    // If a piece is selected and it's our turn, try to move to the right-clicked square
    const canMove = selectedPiece && isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready');
    if (canMove) {
      const move = validMoves.find(m => m.x === x && m.y === y);
      console.log('Right-click move check:', { move, validMovesCount: validMoves.length });
      if (move) {
        console.log('Right-click move executing:', { from: { x: selectedPiece.x, y: selectedPiece.y }, to: { x, y } });
        makeMove(parseInt(gameId), {
          from: { x: selectedPiece.x, y: selectedPiece.y },
          to: { x, y },
          pieceId: selectedPiece.id
        });
        setSelectedPiece(null);
        setValidMoves([]);
      }
    } else {
      console.log('Right-click: clearing selection');
      setSelectedPiece(null);
      setValidMoves([]);
    }
  }, [selectedPiece, validMoves, isMyTurn, gameState, makeMove, gameId, premove, sendClearPremove]);

  // Handle resign
  const handleResign = () => {
    if (window.confirm("Are you sure you want to resign?")) {
      resign(parseInt(gameId));
    }
  };

  // Handle rematch / new game
  const handlePlayAgain = () => {
    // Save the last played game type to localStorage
    if (gameState?.gameTypeId) {
      localStorage.setItem('lastPlayedGameType', gameState.gameTypeId.toString());
    }
    navigate("/play");
  };

  // Check if user can join this game
  const canJoin = useMemo(() => {
    if (!gameState || !currentUser) return false;
    if (gameState.status !== 'waiting') return false;
    const isAlreadyPlayer = gameState.players?.some(p => p.id === currentUser.id);
    return !isAlreadyPlayer;
  }, [gameState, currentUser]);

  // Handle joining the game
  const handleJoinGame = async () => {
    try {
      await joinGame(parseInt(gameId));
    } catch (err) {
      setError(err.message);
    }
  };

  // Check if board should be flipped (player 2 sees board from their perspective)
  const shouldFlipBoard = useMemo(() => {
    if (!currentPlayer) return false;
    return currentPlayer.position === 2;
  }, [currentPlayer]);

  // Convert display coordinates to game coordinates
  const toGameCoords = useCallback((displayX, displayY, boardWidth, boardHeight) => {
    if (shouldFlipBoard) {
      return {
        x: boardWidth - 1 - displayX,
        y: boardHeight - 1 - displayY
      };
    }
    return { x: displayX, y: displayY };
  }, [shouldFlipBoard]);

  // Render board
  const renderBoard = () => {
    if (!gameState) return null;

    const boardWidth = gameState.gameType?.board_width || 8;
    const boardHeight = gameState.gameType?.board_height || 8;
    const pieces = parsePieces(gameState.pieces);
    const lastMove = gameState.moveHistory?.slice(-1)[0];
    const showHelpers = gameState.showPieceHelpers;
    
    // Calculate which of the current player's pieces can move (only if feature is enabled and it's their turn)
    const movablePieceIds = new Set();
    if (showMovableIndicators && isMyTurn && currentPlayer && (gameState.status === 'active' || gameState.status === 'ready')) {
      // Check if the current player is in check
      const playerInCheck = inCheck && currentPlayer.position === gameState.currentTurn;
      
      pieces.forEach(piece => {
        const pieceTeam = piece.player_id || piece.team;
        if (pieceTeam === currentPlayer.position) {
          const moves = calculateValidMoves(piece, pieces, boardWidth, boardHeight);
          
          if (playerInCheck) {
            // When in check, only count moves that resolve the check
            const hasCheckResolvingMove = moves.some(move => 
              wouldMoveResolveCheck(piece, move.x, move.y, pieces, currentPlayer.position, boardWidth, boardHeight)
            );
            if (hasCheckResolvingMove) {
              movablePieceIds.add(piece.id);
            }
          } else {
            // Not in check - show all pieces with valid moves
            if (moves.length > 0) {
              movablePieceIds.add(piece.id);
            }
          }
        }
      });
    }

    const squares = [];

    for (let displayY = 0; displayY < boardHeight; displayY++) {
      for (let displayX = 0; displayX < boardWidth; displayX++) {
        // Convert display position to actual game coordinates
        const { x: gameX, y: gameY } = toGameCoords(displayX, displayY, boardWidth, boardHeight);
        
        const isLight = (gameX + gameY) % 2 === 0;
        const piece = pieces.find(p => p.x === gameX && p.y === gameY);
        const isSelected = selectedPiece && selectedPiece.x === gameX && selectedPiece.y === gameY;
        const validMove = validMoves.find(m => m.x === gameX && m.y === gameY);
        const isLastMove = lastMove && (
          (lastMove.from?.x === gameX && lastMove.from?.y === gameY) ||
          (lastMove.to?.x === gameX && lastMove.to?.y === gameY)
        );
        
        // Check if this piece can move (only shown when it's your turn)
        const canMove = piece && movablePieceIds.has(piece.id);
        
        // Check if this square shows a hovered piece's possible move
        const hoveredMove = showHelpers && hoveredPiece && !selectedPiece 
          ? hoveredMoves.find(m => m.x === gameX && m.y === gameY) 
          : null;

        // Check if this piece is in check
        const isInCheck = piece && inCheck && checkedPieces.some(cp => cp.id === piece.id);

        // Check if this square is part of a premove
        const isPremoveFrom = premove && premove.from.x === gameX && premove.from.y === gameY;
        const isPremoveTo = premove && premove.to.x === gameX && premove.to.y === gameY;

        squares.push(
          <div
            key={`${displayX}-${displayY}`}
            className={`
              ${styles["board-square"]}
              ${isLight ? styles.light : styles.dark}
              ${isSelected ? styles.selected : ''}
              ${validMove && !validMove.isCapture && !validMove.isFirstMoveOnly ? styles["valid-move"] : ''}
              ${validMove && !validMove.isCapture && validMove.isFirstMoveOnly ? styles["valid-move-first-only"] : ''}
              ${validMove && validMove.isCapture && !validMove.isFirstMoveOnly ? styles["valid-capture"] : ''}
              ${validMove && validMove.isCapture && validMove.isFirstMoveOnly ? styles["valid-capture-first-only"] : ''}
              ${hoveredMove && !hoveredMove.isCapture && !hoveredMove.isFirstMoveOnly ? styles["hover-move"] : ''}
              ${hoveredMove && !hoveredMove.isCapture && hoveredMove.isFirstMoveOnly ? styles["hover-move-first-only"] : ''}
              ${hoveredMove && hoveredMove.isCapture && !hoveredMove.isFirstMoveOnly ? styles["hover-capture"] : ''}
              ${hoveredMove && hoveredMove.isCapture && hoveredMove.isFirstMoveOnly ? styles["hover-capture-first-only"] : ''}
              ${isLastMove ? styles["last-move"] : ''}
              ${canMove ? styles["can-move"] : ''}
              ${isInCheck ? styles["in-check"] : ''}
              ${isPremoveFrom || isPremoveTo ? styles["premove"] : ''}
            `}
            onClick={() => handleSquareClick(gameX, gameY)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, gameX, gameY)}
            onContextMenu={(e) => handleSquareRightClick(e, gameX, gameY)}
            style={{
              backgroundColor: isLight 
                ? (currentUser?.light_square_color || '#cad5e8')
                : (currentUser?.dark_square_color || '#08234d')
            }}
          >
            {piece && (() => {
              const pieceTeam = piece.player_id || piece.team;
              const isOwnPiece = currentPlayer && pieceTeam === currentPlayer.position;
              const canDragForMove = isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready') && isOwnPiece;
              const canDragForPremove = !isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready') && gameState?.allowPremoves !== false && isOwnPiece;
              
              return (
                <div 
                  className={styles.piece}
                  draggable={canDragForMove || canDragForPremove}
                  onDragStart={(e) => handleDragStart(e, piece)}
                  onDragEnd={handleDragEnd}
                  onMouseEnter={() => (showHelpers || showMovableIndicators) && handlePieceHover(piece)}
                  onMouseLeave={() => (showHelpers || showMovableIndicators) && handlePieceHover(null)}
                >
                {(piece.image || piece.image_url) ? (
                  <img 
                    src={piece.image || piece.image_url} 
                    alt={piece.piece_name || piece.name || 'piece'} 
                    draggable={false}
                  />
                ) : (
                  // Fallback to unicode chess pieces
                  <span>{getPieceSymbol(piece)}</span>
                )}
              </div>
            );
            })()}
          </div>
        );
      }
    }

    return (
      <div 
        className={styles["game-board"]}
        style={{
          gridTemplateColumns: `repeat(${boardWidth}, 1fr)`,
          gridTemplateRows: `repeat(${boardHeight}, 1fr)`
        }}
      >
        {squares}
      </div>
    );
  };

  // Get piece symbol (fallback for pieces without images)
  const getPieceSymbol = (piece) => {
    // Use player_id or team to determine piece color
    const team = piece.player_id || piece.team || 1;
    return team === 1 ? '♙' : '♟';
  };

  // Loading state
  if (loading) {
    return (
      <div className={styles["live-game-container"]}>
        <div className={styles["loading-container"]}>
          <div className={styles["loading-spinner"]}></div>
          <p>Loading game...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={styles["live-game-container"]}>
        <div className={styles["error-container"]}>
          <h2>Error</h2>
          <p>{error}</p>
          <Link to="/play" className={`${styles.btn} ${styles["btn-primary"]}`}>
            Back to Lobby
          </Link>
        </div>
      </div>
    );
  }

  // No game found
  if (!gameState) {
    return (
      <div className={styles["live-game-container"]}>
        <div className={styles["error-container"]}>
          <h2>Game Not Found</h2>
          <p>This game doesn't exist or has been cancelled.</p>
          <Link to="/play" className={`${styles.btn} ${styles["btn-primary"]}`}>
            Back to Lobby
          </Link>
        </div>
      </div>
    );
  }

  // Check if user can join this game (for join button in waiting banner)
  const isHost = gameState.hostId === currentUser?.id;
  const gameUrl = `${window.location.origin}/play/${gameId}`;

  // Active, ready, waiting, or completed game - show the board
  const player1 = gameState.players?.find(p => p.position === 1);
  const player2 = gameState.players?.find(p => p.position === 2);

  return (
    <div className={styles["live-game-container"]}>
      <div className={styles["game-header"]}>
        <div className={styles["game-title"]}>
          <h1>{gameState.gameType?.game_name || 'Game'}</h1>
          <div className={`${styles["game-status"]} ${styles[gameState.status]}`}>
            {gameState.status === 'active' ? 'In Progress' : 
             gameState.status === 'completed' ? 'Game Over' : 
             gameState.status === 'ready' ? 'Starting...' : 
             gameState.status === 'waiting' ? 'Waiting for Opponent' : gameState.status}
          </div>
        </div>
        
        {currentPlayer && (gameState.status === 'active' || gameState.status === 'ready') && (
          <div className={styles["header-turn-indicator"]}>
            {isMyTurn ? (
              <>
                <span className={styles["your-turn"]}>Your turn!</span>
                {inCheck && currentPlayer.position === gameState.currentTurn && (
                  <span className={styles["check-warning"]}>⚠️ You are in CHECK!</span>
                )}
                {moveError && (
                  <span className={styles["move-error"]}>❌ {moveError}</span>
                )}
              </>
            ) : (
              <>
                <span className={styles["waiting-turn"]}>Waiting for opponent...</span>
                {inCheck && currentPlayer.position !== gameState.currentTurn && (
                  <span className={styles["check-info"]}>Opponent is in check</span>
                )}
              </>
            )}
          </div>
        )}
        
        <div className={styles["header-actions"]}>
          <Link to="/play" className={`${styles.btn} ${styles["btn-secondary"]} ${styles["btn-small"]}`}>
            Back to Lobby
          </Link>
        </div>
      </div>

      <div className={styles["game-layout"]}>
        {/* Middle Row: Clocks | Board | Move History */}
        <div className={styles["layout-row-middle"]}>
          {/* Clocks Column */}
          <div className={styles["clocks-column"]}>
            {/* Opponent Clock */}
            <div className={`
              ${styles["player-clock"]} 
              ${styles["top-clock"]}
              ${(!currentPlayer || (currentPlayer.position === 2 && gameState.currentTurn === 1) || (currentPlayer.position === 1 && gameState.currentTurn === 2)) && gameState.status === 'active' ? styles["current-turn"] : ''}
              ${gameState.winner === (currentPlayer?.position === 1 ? player2?.id : player1?.id) ? styles.winner : ''}
            `}>
              <div className={styles["player-info"]}>
                <div className={styles["player-header"]}>
                  <span className={styles["player-name"]}>
                    {currentPlayer?.position === 1 ? player2?.username : player1?.username}
                    {(currentPlayer?.position === 1 ? player2?.id : player1?.id) === currentUser?.id && ' (You)'}
                  </span>
                  <span className={`${styles["player-indicator"]} ${((!currentPlayer && gameState.currentTurn === (currentPlayer?.position === 1 ? 2 : 1)) || (currentPlayer?.position === 2 && gameState.currentTurn === 1) || (currentPlayer?.position === 1 && gameState.currentTurn === 2)) && gameState.status === 'active' ? styles.active : ''}`}></span>
                </div>
                {gameState.timeControl && (
                  <div className={styles["player-time"]}>
                    <div className={`${styles["time-value"]} ${gameState.playerTimes?.[currentPlayer?.position === 1 ? player2?.id : player1?.id] < 60 ? styles["low-time"] : ''}`}>
                      {formatTime(gameState.playerTimes?.[currentPlayer?.position === 1 ? player2?.id : player1?.id])}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Your Clock */}
            <div className={`
              ${styles["player-clock"]} 
              ${styles["bottom-clock"]}
              ${(currentPlayer && ((currentPlayer.position === 1 && gameState.currentTurn === 1) || (currentPlayer.position === 2 && gameState.currentTurn === 2))) && gameState.status === 'active' ? styles["current-turn"] : ''}
              ${gameState.winner === currentPlayer?.id ? styles.winner : ''}
            `}>
              <div className={styles["player-info"]}>
                {gameState.timeControl && (
                  <div className={styles["player-time"]}>
                    <div className={`${styles["time-value"]} ${gameState.playerTimes?.[currentPlayer?.id] < 60 ? styles["low-time"] : ''}`}>
                      {formatTime(gameState.playerTimes?.[currentPlayer?.id])}
                    </div>
                  </div>
                )}
                <div className={styles["player-header"]}>
                  <span className={styles["player-name"]}>
                    {currentPlayer?.username}
                    {' (You)'}
                  </span>
                  <span className={`${styles["player-indicator"]} ${currentPlayer && ((currentPlayer.position === 1 && gameState.currentTurn === 1) || (currentPlayer.position === 2 && gameState.currentTurn === 2)) && gameState.status === 'active' ? styles.active : ''}`}></span>
                </div>
              </div>
            </div>
          </div>

          {/* Board Column */}
          <div className={styles["board-column"]}>
            {/* Waiting Banner */}
            {gameState.status === 'waiting' && (
              <div className={styles["waiting-banner"]}>
                <div className={styles["waiting-content"]}>
                  {isHost ? (
                    <>
                      <div className={styles["waiting-spinner-small"]}></div>
                      <span>Waiting for opponent to join...</span>
                      <div className={styles["share-link-inline"]}>
                        <input 
                          type="text" 
                          value={gameUrl} 
                          readOnly 
                          onClick={(e) => e.target.select()}
                        />
                        <button 
                          className={`${styles.btn} ${styles["btn-small"]}`}
                          onClick={() => navigator.clipboard.writeText(gameUrl)}
                        >
                          Copy
                        </button>
                      </div>
                      <button 
                        className={`${styles.btn} ${styles["btn-danger"]} ${styles["btn-small"]}`}
                        onClick={() => {
                          cancelGame(parseInt(gameId));
                          navigate('/play');
                        }}
                      >
                        Cancel Game
                      </button>
                    </>
                  ) : canJoin ? (
                    <>
                      <span><strong>{gameState.hostUsername || 'A player'}</strong> is hosting this game</span>
                      <button 
                        className={`${styles.btn} ${styles["btn-primary"]}`}
                        onClick={handleJoinGame}
                      >
                        Join Game
                      </button>
                    </>
                  ) : (
                    <span>Waiting for another player to join...</span>
                  )}
                </div>
                <p className={styles["preview-hint"]}>Click on pieces to preview their moves</p>
              </div>
            )}
            
            <div className={styles["game-board-wrapper"]}>
              {renderBoard()}
            </div>
          </div>

          {/* Move History Column */}
          <div className={styles["move-history-column"]}>
            <div className={styles["move-history"]}>
              <h3>Move History</h3>
              <div className={styles["moves-list"]}>
                {(gameState.moveHistory || []).map((move, index) => (
                  <div key={index} className={styles["move-row"]}>
                    <span className={styles["move-number"]}>{Math.floor(index / 2) + 1}.</span>
                    <span className={index % 2 === 0 ? styles["move-white"] : styles["move-black"]}>
                      {`${String.fromCharCode(97 + move.from?.x)}${move.from?.y + 1} → ${String.fromCharCode(97 + move.to?.x)}${move.to?.y + 1}`}
                      {move.captured && ' ×'}
                    </span>
                  </div>
                ))}
                {(!gameState.moveHistory || gameState.moveHistory.length === 0) && (
                  <div style={{ color: '#666', textAlign: 'center', padding: '20px' }}>
                    No moves yet
                  </div>
                )}
              </div>
            </div>

            {/* Game Options */}
            <div className={styles["game-options"]}>
              <h3>Options</h3>
            <label className={styles["option-checkbox"]}>
              <input
                type="checkbox"
                checked={showMovableIndicators}
                onChange={(e) => setShowMovableIndicators(e.target.checked)}
              />
              <span>Show movable pieces</span>
            </label>
            <label className={styles["option-checkbox"]}>
              <input
                type="checkbox"
                checked={soundEnabled}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setSoundEnabled(enabled);
                  soundEnabledRef.current = enabled;
                }}
              />
              <span>Enable sound effects</span>
            </label>

            {/* Game Controls */}
            {currentPlayer && (gameState.status === 'active' || gameState.status === 'ready') && (
              <div className={styles["game-controls-inline"]}>
                <h4>Actions</h4>
                <div className={styles["control-buttons"]}>
                  <button 
                    className={`${styles.btn} ${styles["btn-danger"]}`}
                    onClick={handleResign}
                  >
                    Resign
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Row - Move history for medium screens (1000-1200px) */}
      <div className={styles["layout-row-bottom"]}>
        <div className={styles["move-history"]}>
          <h3>Move History</h3>
          <div className={styles["moves-list"]}>
            {(gameState.moveHistory || []).map((move, index) => (
              <div key={index} className={styles["move-row"]}>
                <span className={styles["move-number"]}>{Math.floor(index / 2) + 1}.</span>
                <span className={index % 2 === 0 ? styles["move-white"] : styles["move-black"]}>
                  {`${String.fromCharCode(97 + move.from?.x)}${move.from?.y + 1} → ${String.fromCharCode(97 + move.to?.x)}${move.to?.y + 1}`}
                  {move.captured && ' ×'}
                </span>
              </div>
            ))}
            {(!gameState.moveHistory || gameState.moveHistory.length === 0) && (
              <div style={{ color: '#666', textAlign: 'center', padding: '20px' }}>
                No moves yet
              </div>
            )}
          </div>
        </div>

        <div className={styles["game-options"]}>
          <h3>Options</h3>
          <label className={styles["option-checkbox"]}>
            <input
              type="checkbox"
              checked={showMovableIndicators}
              onChange={(e) => setShowMovableIndicators(e.target.checked)}
            />
            <span>Show movable pieces</span>
          </label>
          <label className={styles["option-checkbox"]}>
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={(e) => {
                const enabled = e.target.checked;
                setSoundEnabled(enabled);
                soundEnabledRef.current = enabled;
              }}
            />
            <span>Enable sound effects</span>
          </label>

          {currentPlayer && (gameState.status === 'active' || gameState.status === 'ready') && (
            <div className={styles["game-controls-inline"]}>
              <h4>Actions</h4>
              <div className={styles["control-buttons"]}>
                <button 
                  className={`${styles.btn} ${styles["btn-danger"]}`}
                  onClick={handleResign}
                >
                  Resign
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Settings Row */}
      <div className={styles["layout-row-settings"]}>
        <div className={styles["game-settings"]}>
          <h3>Game Settings</h3>
          <div className={styles["settings-content"]}>
            <div className={styles["settings-row"]}>
              <span className={styles["setting-label"]}>Mode:</span>
              <span className={styles["setting-value"]}>{gameState.rated !== false ? 'Rated' : 'Casual'}</span>
            </div>
            {gameState.timeControl && (
              <div className={styles["settings-row"]}>
                <span className={styles["setting-label"]}>Time Control:</span>
                <span className={styles["setting-value"]}>{gameState.timeControl} min + {gameState.increment || 0}s</span>
              </div>
            )}
            <div className={styles["settings-row"]}>
              <span className={styles["setting-label"]}>Premoves:</span>
              <span className={styles["setting-value"]}>{gameState.allowPremoves !== false ? 'Enabled' : 'Disabled'}</span>
            </div>
            <div className={styles["settings-row"]}>
              <span className={styles["setting-label"]}>Movement Helpers:</span>
              <span className={styles["setting-value"]}>{gameState.showPieceHelpers ? 'Enabled' : 'Disabled'}</span>
            </div>
            {gameState.allowSpectators !== undefined && (
              <div className={styles["settings-row"]}>
                <span className={styles["setting-label"]}>Spectators:</span>
                <span className={styles["setting-value"]}>{gameState.allowSpectators ? 'Allowed' : 'Not allowed'}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Game Over Modal */}
      {showGameOver && gameOverData && (
        <div className={styles["game-over-overlay"]} onClick={() => setShowGameOver(false)}>
          <div className={styles["game-over-modal"]} onClick={(e) => e.stopPropagation()}>
            <h2>Game Over</h2>
            <div className={`
              ${styles.result}
              ${gameOverData.winner === currentUser?.id ? styles.win : 
                gameOverData.winner ? styles.loss : styles.draw}
            `}>
              {gameOverData.winner === currentUser?.id ? 'You Won!' : 
               gameOverData.winner ? `${gameOverData.winnerUsername || 'Opponent'} Wins!` : 'Draw!'}
            </div>
            <div className={styles.reason}>
              {gameOverData.reason === 'checkmate' ? 'By Checkmate' :
               gameOverData.reason === 'stalemate' ? 'By Stalemate' :
               gameOverData.reason === 'resignation' ? 'By Resignation' :
               gameOverData.reason === 'timeout' ? 'By Timeout' :
               gameOverData.reason}
            </div>
            <div className={styles["game-over-actions"]}>
              <button 
                className={`${styles.btn} ${styles["btn-secondary"]}`}
                onClick={() => navigate('/')}
              >
                View Home
              </button>
              <button 
                className={`${styles.btn} ${styles["btn-primary"]}`}
                onClick={handlePlayAgain}
              >
                Play Again
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default LiveGame;
