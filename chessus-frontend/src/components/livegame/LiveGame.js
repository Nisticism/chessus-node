import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { useSocket } from "../../contexts/SocketContext";
import styles from "./livegame.module.scss";
import soundManager from "../../utils/soundEffects";
import PromotionModal from "./PromotionModal";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

// Helper to parse image_location and get the first image URL
const getFirstImageUrl = (imageLocation) => {
  if (!imageLocation) return null;
  
  try {
    const images = JSON.parse(imageLocation);
    if (Array.isArray(images) && images.length > 0) {
      const imagePath = images[0];
      if (imagePath.startsWith('http')) {
        return imagePath;
      }
      // Add ASSET_URL prefix if path starts with /
      return imagePath.startsWith('/') ? `${ASSET_URL}${imagePath}` : `${ASSET_URL}/uploads/pieces/${imagePath}`;
    }
  } catch {
    const imagePath = imageLocation;
    if (imagePath.startsWith('http')) {
      return imagePath;
    }
    // Add ASSET_URL prefix for all relative paths
    return imagePath.startsWith('/') ? `${ASSET_URL}${imagePath}` : `${ASSET_URL}/uploads/pieces/${imagePath}`;
  }
  
  return null;
};

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
    offerDraw,
    acceptDraw,
    declineDraw,
    cancelGame,
    setPremove: sendPremove,
    clearPremove: sendClearPremove,
    promotePiece,
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
  const [showPromotionSquares, setShowPromotionSquares] = useState(false);
  const [showCastlingInfo, setShowCastlingInfo] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const soundEnabledRef = useRef(false);
  const [premove, setPremove] = useState(null); // Store premove {from, to, pieceId}
  const [showPromotionModal, setShowPromotionModal] = useState(false);
  const [promotionData, setPromotionData] = useState(null); // {pieceId, options, promotingPiece}
  const [specialSquares, setSpecialSquares] = useState({ range: {}, promotion: {}, control: {}, special: {} });
  const [pendingDrawOffer, setPendingDrawOffer] = useState(null); // {from, fromUsername} when opponent offers draw
  const [drawOfferSent, setDrawOfferSent] = useState(false); // Track if current user sent a draw offer

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
        
        // Parse special squares from game type
        if (state.gameType) {
          const squares = { range: {}, promotion: {}, control: {}, special: {} };
          try {
            if (state.gameType.range_squares_string) {
              squares.range = JSON.parse(state.gameType.range_squares_string);
            }
          } catch (e) { console.error('Error parsing range_squares_string:', e); }
          try {
            if (state.gameType.promotion_squares_string) {
              squares.promotion = JSON.parse(state.gameType.promotion_squares_string);
            }
          } catch (e) { console.error('Error parsing promotion_squares_string:', e); }
          try {
            if (state.gameType.control_squares_string) {
              squares.control = JSON.parse(state.gameType.control_squares_string);
            }
          } catch (e) { console.error('Error parsing control_squares_string:', e); }
          try {
            if (state.gameType.special_squares_string) {
              squares.special = JSON.parse(state.gameType.special_squares_string);
            }
          } catch (e) { console.error('Error parsing special_squares_string:', e); }
          setSpecialSquares(squares);
        }
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

    const unsubscribeGameOver = onGameEvent("gameOver", ({ gameId: overGameId, winner, winnerUsername, reason, finalState, eloChanges }) => {
      if (parseInt(overGameId) === parseInt(gameId)) {
        setGameOverData({ winner, winnerUsername, reason, eloChanges });
        setShowGameOver(true);
        setPendingDrawOffer(null); // Clear any pending draw offer
        setDrawOfferSent(false); // Clear any sent draw offer
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

    // Promotion events
    const unsubscribePromotionRequired = onGameEvent("promotionRequired", ({ gameId: promoGameId, pieceId, pieceName, options, move, gameState: newState }) => {
      if (parseInt(promoGameId) === parseInt(gameId)) {
        // Update game state with the move
        setGameState(prev => ({
          ...prev,
          pieces: newState.pieces,
          playerTimes: newState.playerTimes,
          moveHistory: newState.moveHistory
        }));
        
        // Find the promoting piece
        const promotingPiece = newState.pieces.find(p => p.id === pieceId);
        
        // Show promotion modal
        setPromotionData({
          pieceId,
          pieceName,
          options,
          promotingPiece
        });
        setShowPromotionModal(true);
        
        // Play promotion sound
        if (soundEnabledRef.current) {
          soundManager.playMove();
        }
      }
    });

    const unsubscribePiecePromoted = onGameEvent("piecePromoted", ({ gameId: promoGameId, pieceId, newPieceId, newPieceName, promotedPiece, gameState: newState }) => {
      if (parseInt(promoGameId) === parseInt(gameId)) {
        // Hide promotion modal
        setShowPromotionModal(false);
        setPromotionData(null);
        
        // Update game state
        setGameState(prev => ({
          ...prev,
          pieces: newState.pieces,
          currentTurn: newState.currentTurn
        }));
        
        // Play a sound for promotion
        if (soundEnabledRef.current) {
          soundManager.playMove();
        }
        
        console.log(`Piece ${pieceId} promoted to ${newPieceName}`);
      }
    });

    // Draw events
    const unsubscribeDrawOffered = onGameEvent("drawOffered", ({ gameId: drawGameId, from, fromUsername }) => {
      if (parseInt(drawGameId) === parseInt(gameId)) {
        if (from === currentUser?.id) {
          // Current user sent the offer
          setDrawOfferSent(true);
        } else {
          // Opponent sent the offer
          setPendingDrawOffer({ from, fromUsername });
        }
      }
    });

    const unsubscribeDrawDeclined = onGameEvent("drawDeclined", ({ gameId: drawGameId, by, byUsername }) => {
      if (parseInt(drawGameId) === parseInt(gameId)) {
        setPendingDrawOffer(null);
        setDrawOfferSent(false); // Clear the sent state when declined
        console.log(`Draw declined by ${byUsername}`);
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
      unsubscribePromotionRequired();
      unsubscribePiecePromoted();
      unsubscribeDrawOffered();
      unsubscribeDrawDeclined();
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
    if (!pieceData.special_scenario_moves) return 0;
    
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
      
      if (!direction || !additionalMovements[direction]) return 0;
      
      // Check if any of the additional movements for this direction have firstMoves/availableForMoves value
      for (const movementOption of additionalMovements[direction]) {
        // Support both firstMoves and availableForMoves fields
        const firstMoves = movementOption.firstMoves || movementOption.availableForMoves || 0;
        // Also check firstMoveOnly boolean for backwards compatibility
        const isFirstMoveOnly = movementOption.firstMoveOnly || false;
        
        if (firstMoves === 0 && !isFirstMoveOnly) continue;
        
        const value = movementOption.value || 0;
        const matchesMove = (movementOption.infinite && distance > 0) ||
                           (movementOption.exact && distance === value) ||
                           (!movementOption.exact && !movementOption.infinite && distance > 0 && distance <= value);
        
        // CRITICAL: Only return firstMoves if this specific move matches AND the distance doesn't match the regular movement
        // For example, pawn's 1-square move should NOT be affected by the 2-square special scenario
        if (matchesMove && distance === value) {
          // Return the number of first moves allowed (or 1 if just firstMoveOnly flag is set)
          return firstMoves || (isFirstMoveOnly ? 1 : 0);
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
    
    return 0;
  };

  // Check if a capture is from a first-move-only additional capture option
  const checkIfFirstMoveOnlyCapture = (pieceData, fromX, fromY, toX, toY, playerPosition) => {
    if (!pieceData.special_scenario_captures) return 0;
    
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
      
      if (!direction || !additionalCaptures[direction]) return 0;
      
      // Check if any of the additional captures for this direction have firstMoves/availableForMoves value
      for (const captureOption of additionalCaptures[direction]) {
        // Support both firstMoves and availableForMoves fields
        const firstMoves = captureOption.firstMoves || captureOption.availableForMoves || 0;
        // Also check firstMoveOnly boolean for backwards compatibility
        const isFirstMoveOnly = captureOption.firstMoveOnly || false;
        
        if (firstMoves === 0 && !isFirstMoveOnly) continue;
        
        const value = captureOption.value || 0;
        const matchesCapture = (captureOption.infinite && distance > 0) ||
                              (captureOption.exact && distance === value) ||
                              (!captureOption.exact && !captureOption.infinite && distance > 0 && distance <= value);
        
        // Only return firstMoves if this exact distance matches the special scenario value
        if (matchesCapture && distance === value) {
          // Return the number of first moves allowed (or 1 if just firstMoveOnly flag is set)
          return firstMoves || (isFirstMoveOnly ? 1 : 0);
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
    
    return 0;
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

    // Check additional movements from special_scenario_moves
    if (pieceData.special_scenario_moves) {
      try {
        const parsed = typeof pieceData.special_scenario_moves === 'string'
          ? JSON.parse(pieceData.special_scenario_moves)
          : pieceData.special_scenario_moves;
        const additionalMovements = parsed?.additionalMovements || {};
        
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
        
        if (direction && additionalMovements[direction]) {
          for (const movementOption of additionalMovements[direction]) {
            const value = movementOption.value || 0;
            const matches = (movementOption.infinite && distance > 0) ||
                           (movementOption.exact && distance === value) ||
                           (!movementOption.exact && !movementOption.infinite && distance > 0 && distance <= value);
            if (matches) {
              return true;
            }
          }
        }
      } catch (e) {
        console.error('Error parsing special_scenario_moves:', e);
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

    // Check additional captures from special_scenario_captures
    if (pieceData.special_scenario_captures) {
      try {
        const parsed = typeof pieceData.special_scenario_captures === 'string'
          ? JSON.parse(pieceData.special_scenario_captures)
          : pieceData.special_scenario_captures;
        const additionalCaptures = parsed?.additionalCaptures || {};
        
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
        
        if (direction && additionalCaptures[direction]) {
          for (const captureOption of additionalCaptures[direction]) {
            const value = captureOption.value || 0;
            if (captureOption.infinite && distance > 0) return true;
            if (captureOption.exact && distance === value) return true;
            if (!captureOption.exact && !captureOption.infinite && distance > 0 && distance <= value) return true;
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
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
          // Check if this move requires a certain number of first moves
          const firstMovesRequired = isCapture 
            ? checkIfFirstMoveOnlyCapture(piece, piece.x, piece.y, toX, toY, pieceTeam)
            : checkIfFirstMoveOnlyMove(piece, piece.x, piece.y, toX, toY, pieceTeam);
          
          // If this move requires first moves, check if the piece has moved too many times
          if (firstMovesRequired > 0) {
            const pieceMovesCount = gameState?.moveHistory?.filter(move => move.pieceId === piece.id).length || 0;
            if (pieceMovesCount >= firstMovesRequired) {
              continue;
            }
          }
          
          moves.push({
            x: toX,
            y: toY,
            isCapture,
            isFirstMoveOnly: firstMovesRequired > 0
          });
        }
      }
    }
    
    // Check for castling moves
    if (piece.can_castle && !piece.hasMoved) {
      // Check left castling (2 squares left)
      if (piece.castling_partner_left_id) {
        const partner = pieces.find(p => p.id === piece.castling_partner_left_id);
        if (partner && !partner.hasMoved) {
          const targetX = piece.x - 2;
          const targetY = piece.y;
          const distanceToPartner = piece.x - partner.x;
          
          // Check if this is close-range castling (partner within 2 squares)
          const isCloseRange = distanceToPartner > 0 && distanceToPartner <= 2;
          
          if (isCloseRange) {
            // Close-range castling: king hops over pieces, partner can be at target or adjacent
            // Target is valid if: empty, OR occupied by the partner itself (who will move)
            const targetOccupiedByOther = pieces.some(p => p.x === targetX && p.y === targetY && p.id !== partner.id);
            if (!targetOccupiedByOther) {
              moves.push({
                x: targetX,
                y: targetY,
                isCapture: false,
                isCastling: true,
                castlingWith: piece.castling_partner_left_id,
                castlingDirection: 'left'
              });
            }
          } else {
            // Standard long-range castling: path must be clear
            const targetOccupied = pieces.some(p => p.x === targetX && p.y === targetY);
            const pathClear = isPathClear(piece.x, piece.y, targetX, targetY, pieces);
            if (!targetOccupied && pathClear) {
              moves.push({
                x: targetX,
                y: targetY,
                isCapture: false,
                isCastling: true,
                castlingWith: piece.castling_partner_left_id,
                castlingDirection: 'left'
              });
            }
          }
        }
      }
      
      // Check right castling (2 squares right)
      if (piece.castling_partner_right_id) {
        const partner = pieces.find(p => p.id === piece.castling_partner_right_id);
        if (partner && !partner.hasMoved) {
          const targetX = piece.x + 2;
          const targetY = piece.y;
          const distanceToPartner = partner.x - piece.x;
          
          // Check if this is close-range castling (partner within 2 squares)
          const isCloseRange = distanceToPartner > 0 && distanceToPartner <= 2;
          
          if (isCloseRange) {
            // Close-range castling: king hops over pieces, partner can be at target or adjacent
            // Target is valid if: empty, OR occupied by the partner itself (who will move)
            const targetOccupiedByOther = pieces.some(p => p.x === targetX && p.y === targetY && p.id !== partner.id);
            if (!targetOccupiedByOther) {
              moves.push({
                x: targetX,
                y: targetY,
                isCapture: false,
                isCastling: true,
                castlingWith: piece.castling_partner_right_id,
                castlingDirection: 'right'
              });
            }
          } else {
            // Standard long-range castling: path must be clear
            const targetOccupied = pieces.some(p => p.x === targetX && p.y === targetY);
            const pathClear = isPathClear(piece.x, piece.y, targetX, targetY, pieces);
            if (!targetOccupied && pathClear) {
              moves.push({
                x: targetX,
                y: targetY,
                isCapture: false,
                isCastling: true,
                castlingWith: piece.castling_partner_right_id,
                castlingDirection: 'right'
              });
            }
          }
        }
      }
    }
    
    // Filter out moves that would leave the player in check (if mate_condition is enabled and not skipped)
    if (!skipCheckFilter && gameState?.gameType?.mate_condition && currentPlayer) {
      return moves.filter(move => 
        wouldMoveResolveCheck(piece, move.x, move.y, pieces, currentPlayer.position, boardWidth, boardHeight)
      );
    }
    
    return moves;
  }, [canPieceMoveTo, canPieceCaptureTo, isPathClear, checkRatioPathClear, gameState, currentPlayer, wouldMoveResolveCheck]);

  // Handle square click
  const handleSquareClick = useCallback((x, y) => {
    // Allow selecting pieces to preview moves when waiting or during gameplay
    const canInteract = gameState && gameState.status !== 'completed';
    if (!canInteract) {
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
    
    // If clicking on opponent's piece, clear selection and return
    if (clickedPiece && !isOwnPiece && !isPreviewMode) {
      setSelectedPiece(null);
      setValidMoves([]);
      return;
    }

    // In preview mode, allow selecting any piece to see its moves
    // In game mode, only allow selecting own pieces when it's your turn
    // OR allow selecting own pieces when it's opponent's turn for premoves
    const canSelectForPremove = !isMyTurn && (gameState.status === 'active' || gameState.status === 'ready') && gameState.allowPremoves !== false && isOwnPiece;
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
    
    if (canMakeMove) {
      const move = validMoves.find(m => m.x === x && m.y === y);
      if (move) {
        console.log('[MOVE ATTEMPT]', { 
          piece: selectedPiece.piece_name, 
          from: { x: selectedPiece.x, y: selectedPiece.y }, 
          to: { x, y },
          move 
        });
        const moveData = {
          from: { x: selectedPiece.x, y: selectedPiece.y },
          to: { x, y },
          pieceId: selectedPiece.id
        };
        // Include castling data if this is a castling move
        if (move.isCastling) {
          moveData.isCastling = true;
          moveData.castlingWith = move.castlingWith;
          moveData.castlingDirection = move.castlingDirection;
        }
        makeMove(parseInt(gameId), moveData);
        setSelectedPiece(null);
        setValidMoves([]);
      } else {
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
        const moveData = {
          from: { x: draggedPiece.x, y: draggedPiece.y },
          to: { x: targetX, y: targetY },
          pieceId: draggedPiece.id
        };
        // Include castling data if this is a castling move
        if (validMove.isCastling) {
          moveData.isCastling = true;
          moveData.castlingWith = validMove.castlingWith;
          moveData.castlingDirection = validMove.castlingDirection;
        }
        makeMove(parseInt(gameId), moveData);
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
        const moveData = {
          from: { x: selectedPiece.x, y: selectedPiece.y },
          to: { x, y },
          pieceId: selectedPiece.id
        };
        // Include castling data if this is a castling move
        if (move.isCastling) {
          moveData.isCastling = true;
          moveData.castlingWith = move.castlingWith;
          moveData.castlingDirection = move.castlingDirection;
        }
        makeMove(parseInt(gameId), moveData);
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

  // Handle draw offer
  const handleOfferDraw = () => {
    offerDraw(parseInt(gameId));
  };

  // Handle accepting draw offer
  const handleAcceptDraw = () => {
    acceptDraw(parseInt(gameId));
    setPendingDrawOffer(null);
  };

  // Handle declining draw offer
  const handleDeclineDraw = () => {
    declineDraw(parseInt(gameId));
    setPendingDrawOffer(null);
  };

  // Handle promotion selection
  const handlePromotionSelect = useCallback((selectedPiece) => {
    if (!promotionData) return;
    
    promotePiece(parseInt(gameId), promotionData.pieceId, selectedPiece.piece_id);
    
    // Don't close modal yet - wait for piecePromoted event
  }, [gameId, promotePiece, promotionData]);

  // Handle promotion cancel (should not normally happen, but handle gracefully)
  const handlePromotionCancel = useCallback(() => {
    // Can't really cancel - just ignore
    // The modal will stay until a selection is made
  }, []);

  // Helper to get special square type at a position
  const getSpecialSquareType = useCallback((row, col) => {
    const key = `${row},${col}`;
    if (showPromotionSquares && specialSquares.promotion[key]) return 'promotion';
    if (specialSquares.range[key]) return 'range';
    if (specialSquares.control[key]) return 'control';
    if (specialSquares.special[key]) return 'special';
    return null;
  }, [specialSquares, showPromotionSquares]);

  // Check if there are any special squares defined (excluding promotion which has its own toggle)
  const hasSpecialSquares = useMemo(() => {
    return Object.keys(specialSquares.range).length > 0 ||
           Object.keys(specialSquares.control).length > 0 ||
           Object.keys(specialSquares.special).length > 0;
  }, [specialSquares]);

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

  // Get castling info for display
  const castlingInfo = useMemo(() => {
    if (!gameState?.pieces) return [];
    const pieces = parsePieces(gameState.pieces);
    
    return pieces
      .filter(piece => piece.can_castle)
      .map(piece => {
        const leftPartner = piece.castling_partner_left_id 
          ? pieces.find(p => p.id === piece.castling_partner_left_id)
          : null;
        const rightPartner = piece.castling_partner_right_id 
          ? pieces.find(p => p.id === piece.castling_partner_right_id)
          : null;
        
        return {
          piece,
          leftPartner,
          rightPartner
        };
      });
  }, [gameState?.pieces]);

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

        // Check for special square type
        const specialSquareType = getSpecialSquareType(gameY, gameX);

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
              ${specialSquareType === 'promotion' ? styles["promotion-square"] : ''}
              ${specialSquareType === 'range' ? styles["range-square"] : ''}
              ${specialSquareType === 'control' ? styles["control-square"] : ''}
              ${specialSquareType === 'special' ? styles["special-square"] : ''}
            `}
            onClick={() => handleSquareClick(gameX, gameY)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, gameX, gameY)}
            onContextMenu={(e) => handleSquareRightClick(e, gameX, gameY)}
            style={{
              backgroundColor: isLight 
                ? (currentUser?.light_square_color || '#cad5e8')
                : (currentUser?.dark_square_color || '#08234d'),
              position: 'relative'
            }}
          >
            {/* Special square indicator */}
            {specialSquareType && (
              <div className={`${styles["special-square-indicator"]} ${styles[specialSquareType]}`}>
                {specialSquareType === 'promotion' && 'P'}
                {specialSquareType === 'range' && 'R'}
                {specialSquareType === 'control' && 'C'}
                {specialSquareType === 'special' && 'S'}
              </div>
            )}
            {piece && (() => {
              const pieceTeam = piece.player_id || piece.team;
              const isOwnPiece = currentPlayer && pieceTeam === currentPlayer.position;
              const canDragForMove = isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready') && isOwnPiece;
              const canDragForPremove = !isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready') && gameState?.allowPremoves !== false && isOwnPiece;
              
              // Get the image URL - always process through helper to ensure ASSET_URL prefix
              let imageUrl = null;
              if (piece.image || piece.image_url) {
                const rawPath = piece.image || piece.image_url;
                // If it's already a full URL, use it; otherwise add ASSET_URL prefix
                imageUrl = rawPath.startsWith('http') ? rawPath : `${ASSET_URL}${rawPath}`;
              } else if (piece.image_location) {
                imageUrl = getFirstImageUrl(piece.image_location);
              }
              
              // Debug logging
              if (!imageUrl) {
                console.log('No image URL for piece:', {
                  piece_id: piece.piece_id,
                  piece_name: piece.piece_name,
                  image: piece.image,
                  image_url: piece.image_url,
                  image_location: piece.image_location
                });
              }
              
              return (
                <div 
                  className={styles.piece}
                  draggable={canDragForMove || canDragForPremove}
                  onDragStart={(e) => handleDragStart(e, piece)}
                  onDragEnd={handleDragEnd}
                  onMouseEnter={() => (showHelpers || showMovableIndicators) && handlePieceHover(piece)}
                  onMouseLeave={() => (showHelpers || showMovableIndicators) && handlePieceHover(null)}
                >
                {imageUrl ? (
                  <img 
                    src={imageUrl} 
                    alt={piece.piece_name || piece.name || 'piece'} 
                    draggable={false}
                    onError={(e) => {
                      console.error('Failed to load piece image:', {
                        src: imageUrl,
                        piece_id: piece.piece_id,
                        piece_name: piece.piece_name
                      });
                    }}
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

            {/* Draw Offer Notification */}
            {pendingDrawOffer && (
              <div className={styles["draw-offer-notification"]}>
                <span>{pendingDrawOffer.fromUsername} offers a draw</span>
                <div className={styles["draw-offer-buttons"]}>
                  <button 
                    className={`${styles.btn} ${styles["btn-success"]}`}
                    onClick={handleAcceptDraw}
                  >
                    Accept
                  </button>
                  <button 
                    className={`${styles.btn} ${styles["btn-danger"]}`}
                    onClick={handleDeclineDraw}
                  >
                    Decline
                  </button>
                </div>
              </div>
            )}
            
            <div className={styles["game-board-wrapper"]}>
              {renderBoard()}
              
              {/* Special Squares Legend */}
              {hasSpecialSquares && (
                <div className={styles["special-squares-legend"]}>
                  {Object.keys(specialSquares.range).length > 0 && (
                    <div className={styles["legend-item"]}>
                      <div className={`${styles["legend-color"]} ${styles.range}`}></div>
                      <span>Range</span>
                    </div>
                  )}
                  {Object.keys(specialSquares.control).length > 0 && (
                    <div className={styles["legend-item"]}>
                      <div className={`${styles["legend-color"]} ${styles.control}`}></div>
                      <span>Control</span>
                    </div>
                  )}
                  {Object.keys(specialSquares.special).length > 0 && (
                    <div className={styles["legend-item"]}>
                      <div className={`${styles["legend-color"]} ${styles.special}`}></div>
                      <span>Special</span>
                    </div>
                  )}
                </div>
              )}
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
            {Object.keys(specialSquares.promotion).length > 0 && (
              <label className={styles["option-checkbox"]}>
                <input
                  type="checkbox"
                  checked={showPromotionSquares}
                  onChange={(e) => setShowPromotionSquares(e.target.checked)}
                />
                <span>Show promotion squares</span>
              </label>
            )}
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
            {castlingInfo.length > 0 && (
              <label className={styles["option-checkbox"]}>
                <input
                  type="checkbox"
                  checked={showCastlingInfo}
                  onChange={(e) => setShowCastlingInfo(e.target.checked)}
                />
                <span>Show castling info</span>
              </label>
            )}
            
            {showCastlingInfo && castlingInfo.length > 0 && (
              <div className={styles["castling-info"]}>
                <h4>Castling Pieces</h4>
                {castlingInfo.map((info, index) => (
                  <div key={index} className={styles["castling-piece-info"]}>
                    <span className={styles["piece-name"]}>{info.piece.name}</span>
                    <div className={styles["castling-partners"]}>
                      {info.leftPartner && (
                        <span className={styles["partner"]}>← {info.leftPartner.name}</span>
                      )}
                      {info.rightPartner && (
                        <span className={styles["partner"]}>{info.rightPartner.name} →</span>
                      )}
                      {!info.leftPartner && !info.rightPartner && (
                        <span className={styles["no-partner"]}>No partners assigned</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Game Controls */}
            {currentPlayer && (gameState.status === 'active' || gameState.status === 'ready') && (
              <div className={styles["game-controls-inline"]}>
                <h4>Actions</h4>
                <div className={styles["control-buttons"]}>
                  <button 
                    className={`${styles.btn} ${styles["btn-secondary"]}`}
                    onClick={handleOfferDraw}
                    disabled={drawOfferSent || pendingDrawOffer}
                    title={drawOfferSent ? "Waiting for opponent's response" : "Offer a draw to your opponent"}
                  >
                    {drawOfferSent ? "Draw Offered..." : "Offer Draw"}
                  </button>
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
          {Object.keys(specialSquares.promotion).length > 0 && (
            <label className={styles["option-checkbox"]}>
              <input
                type="checkbox"
                checked={showPromotionSquares}
                onChange={(e) => setShowPromotionSquares(e.target.checked)}
              />
              <span>Show promotion squares</span>
            </label>
          )}
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
          {castlingInfo.length > 0 && (
            <label className={styles["option-checkbox"]}>
              <input
                type="checkbox"
                checked={showCastlingInfo}
                onChange={(e) => setShowCastlingInfo(e.target.checked)}
              />
              <span>Show castling info</span>
            </label>
          )}
          
          {showCastlingInfo && castlingInfo.length > 0 && (
            <div className={styles["castling-info"]}>
              <h4>Castling Pieces</h4>
              {castlingInfo.map((info, index) => (
                <div key={index} className={styles["castling-piece-info"]}>
                  <span className={styles["piece-name"]}>{info.piece.name}</span>
                  <div className={styles["castling-partners"]}>
                    {info.leftPartner && (
                      <span className={styles["partner"]}>← {info.leftPartner.name}</span>
                    )}
                    {info.rightPartner && (
                      <span className={styles["partner"]}>{info.rightPartner.name} →</span>
                    )}
                    {!info.leftPartner && !info.rightPartner && (
                      <span className={styles["no-partner"]}>No partners assigned</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {currentPlayer && (gameState.status === 'active' || gameState.status === 'ready') && (
            <div className={styles["game-controls-inline"]}>
              <h4>Actions</h4>
              <div className={styles["control-buttons"]}>
                <button 
                  className={`${styles.btn} ${styles["btn-secondary"]}`}
                  onClick={handleOfferDraw}
                  disabled={drawOfferSent || pendingDrawOffer}
                  title={drawOfferSent ? "Waiting for opponent's response" : "Offer a draw to your opponent"}
                >
                  {drawOfferSent ? "Draw Offered..." : "Offer Draw"}
                </button>
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
            {gameState.startingMode && gameState.startingMode !== 'none' && (
              <div className={styles["settings-row"]}>
                <span className={styles["setting-label"]}>Starting Positions:</span>
                <span className={styles["setting-value"]}>
                  {gameState.startingMode === 'mirrored' ? 'Mirrored' :
                   gameState.startingMode === 'backrow' ? 'Back Row (960)' :
                   gameState.startingMode === 'independent' ? 'Independent' :
                   gameState.startingMode === 'shared' ? 'Shared' :
                   gameState.startingMode === 'full' ? 'Full Random' :
                   gameState.startingMode}
                </span>
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
               gameOverData.reason === 'draw_move_limit' ? 'By Move Limit (No Captures)' :
               gameOverData.reason === 'repetition' ? 'By Repetition' :
               gameOverData.reason === 'agreement' ? 'By Agreement' :
               gameOverData.reason === 'resignation' ? 'By Resignation' :
               gameOverData.reason === 'timeout' ? 'By Timeout' :
               gameOverData.reason}
            </div>
            {gameOverData.eloChanges && (
              <div className={styles.eloChanges}>
                <div className={styles.eloChange}>
                  <span className={styles.eloLabel}>Your ELO:</span>
                  <span className={`${styles.eloValue} ${
                    gameOverData.eloChanges.winner?.id === currentUser?.id 
                      ? (gameOverData.eloChanges.winner.change >= 0 ? styles.eloUp : styles.eloDown)
                      : (gameOverData.eloChanges.loser?.change >= 0 ? styles.eloUp : styles.eloDown)
                  }`}>
                    {gameOverData.eloChanges.winner?.id === currentUser?.id 
                      ? `${gameOverData.eloChanges.winner.oldElo} → ${gameOverData.eloChanges.winner.newElo} (${gameOverData.eloChanges.winner.change >= 0 ? '+' : ''}${gameOverData.eloChanges.winner.change})`
                      : `${gameOverData.eloChanges.loser?.oldElo} → ${gameOverData.eloChanges.loser?.newElo} (${gameOverData.eloChanges.loser?.change >= 0 ? '+' : ''}${gameOverData.eloChanges.loser?.change})`
                    }
                  </span>
                </div>
              </div>
            )}
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

      {/* Promotion Modal */}
      {showPromotionModal && promotionData && (
        <PromotionModal
          promotionOptions={promotionData.options}
          promotingPiece={promotionData.promotingPiece}
          onSelect={handlePromotionSelect}
          onCancel={handlePromotionCancel}
        />
      )}
      </div>
    </div>
  );
};

export default LiveGame;
