import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { useSocket } from "../../contexts/SocketContext";
import styles from "./livegame.module.scss";
import soundManager from "../../utils/soundEffects";
import PromotionModal from "./PromotionModal";
import { applySvgStretchBackground } from "../../helpers/svgStretchUtils";
import {
  canPieceMoveTo as canPieceMoveToUtil,
  canCaptureOnMoveTo as canCaptureOnMoveToUtil,
  canRangedAttackTo,
  colToFile,
  rowToRank,
  formatMoveNotation,
  findPieceAtSquare,
  doesPieceOccupySquare,
  doesPieceFitOnBoard,
  isDestinationClear
} from "../../helpers/pieceMovementUtils";

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

// Helper to get image URL for a specific player (player 1 uses index 0, player 2 uses index 1)
const getPlayerImageUrl = (imageLocation, playerNumber) => {
  if (!imageLocation) return null;
  
  // Default to first image index for player 1, second for player 2
  const imageIndex = playerNumber === 2 ? 1 : 0;
  
  try {
    const images = JSON.parse(imageLocation);
    if (Array.isArray(images) && images.length > 0) {
      // Use the appropriate index, or fall back to the last available image
      const actualIndex = Math.min(imageIndex, images.length - 1);
      const imagePath = images[actualIndex];
      if (imagePath.startsWith('http')) {
        return imagePath;
      }
      return imagePath.startsWith('/') ? `${ASSET_URL}${imagePath}` : `${ASSET_URL}/uploads/pieces/${imagePath}`;
    }
  } catch {
    const imagePath = imageLocation;
    if (imagePath.startsWith('http')) {
      return imagePath;
    }
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
  const [showCapturedPieces, setShowCapturedPieces] = useState(true); // Show/hide captured pieces section
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1920);
  const [windowHeight, setWindowHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 1080);

  // Ranged attack state
  const [rangedAttackSource, setRangedAttackSource] = useState(null);
  const [rangedMousePos, setRangedMousePos] = useState(null);
  const [, setRangedTargetSquare] = useState(null);
  const boardRef = useRef(null);
  const rightClickDataRef = useRef(null);
  const [isRightClickActive, setIsRightClickActive] = useState(false);
  const [rangedSelectedPiece, setRangedSelectedPiece] = useState(null); // for right-click-twice mode

  // Track window size for responsive board sizing
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
      setWindowHeight(window.innerHeight);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

    // Game deleted by admin
    const unsubscribeGameDeleted = onGameEvent("gameDeleted", ({ gameId: deletedGameId, message }) => {
      if (parseInt(deletedGameId) === parseInt(gameId)) {
        // Store message to show after redirect
        sessionStorage.setItem('gameDeletedMessage', message || 'This game has been deleted by an administrator.');
        navigate('/play');
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
      unsubscribeGameDeleted();
    };
  }, [gameId, onGameEvent, navigate, currentUser?.id]);

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

    const utilResult = canPieceMoveToUtil(fromY, fromX, toY, toX, pieceData, playerPosition);
    if (utilResult.allowed) {
      return true;
    }

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
    const ratio1 = pieceData.ratio_movement_1 || pieceData.ratio_one_movement || 0;
    const ratio2 = pieceData.ratio_movement_2 || pieceData.ratio_two_movement || 0;
    
    if ((ratioStyle || (ratio1 > 0 && ratio2 > 0)) && ratio1 > 0 && ratio2 > 0) {
      if ((Math.abs(rowDiff) === ratio1 && Math.abs(colDiff) === ratio2) ||
          (Math.abs(rowDiff) === ratio2 && Math.abs(colDiff) === ratio1)) {
        return true;
      }
    }

    // Check step-by-step movement
    const rawStepValue = pieceData.step_by_step_movement_value ?? pieceData.step_movement_value;
    const stepValue = Number(rawStepValue);
    if (!Number.isNaN(stepValue) && stepValue !== 0) {
      const maxSteps = Math.abs(stepValue);
      const noDiagonal = stepValue < 0;

      if (noDiagonal) {
        const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
        return manhattanDistance > 0 && manhattanDistance <= maxSteps;
      }

      const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      return chebyshevDistance > 0 && chebyshevDistance <= maxSteps;
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

    const utilCaptureResult = canCaptureOnMoveToUtil(fromY, fromX, toY, toX, pieceData, playerPosition);
    if (utilCaptureResult.allowed) {
      return true;
    }

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

    // Check step-by-step capture - use sign-based diagonal exclusion
    const rawStepCaptureValue = pieceData.step_capture_value ?? pieceData.step_by_step_capture;
    const stepCaptureValue = Number(rawStepCaptureValue);
    if (!Number.isNaN(stepCaptureValue) && stepCaptureValue !== 0) {
      const maxSteps = Math.abs(stepCaptureValue);
      const noDiagonal = stepCaptureValue < 0;

      if (noDiagonal) {
        const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
        return manhattanDistance > 0 && manhattanDistance <= maxSteps;
      }

      const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      return chebyshevDistance > 0 && chebyshevDistance <= maxSteps;
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
  const isPathClear = useCallback((fromX, fromY, toX, toY, pieces, pieceData, isCapture = false) => {
    // Check if piece can hop - combine movement + attack hop abilities when capturing
    const canHopAllies = pieceData?.can_hop_over_allies === 1 || pieceData?.can_hop_over_allies === true
      || (isCapture && (pieceData?.can_hop_attack_over_allies === 1 || pieceData?.can_hop_attack_over_allies === true));
    const canHopEnemies = pieceData?.can_hop_over_enemies === 1 || pieceData?.can_hop_over_enemies === true
      || (isCapture && (pieceData?.can_hop_attack_over_enemies === 1 || pieceData?.can_hop_attack_over_enemies === true));
    const pieceTeam = pieceData?.player_id || pieceData?.team;

    const dx = Math.sign(toX - fromX);
    const dy = Math.sign(toY - fromY);
    
    // Check if it's a knight-like move (L-shape)
    const xDiff = Math.abs(toX - fromX);
    const yDiff = Math.abs(toY - fromY);
    if (xDiff !== yDiff && xDiff !== 0 && yDiff !== 0) {
      return true;
    }

    let x = fromX + dx;
    let y = fromY + dy;

    while (x !== toX || y !== toY) {
      const blockingPiece = findPieceAtSquare(pieces, x, y);
      if (blockingPiece) {
        const blockingTeam = blockingPiece.player_id || blockingPiece.team;
        const isAlly = blockingTeam === pieceTeam;
        
        if (isAlly && !canHopAllies) return false;
        if (!isAlly && !canHopEnemies) return false;
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
        const obstruction = findPieceAtSquare(pieces, checkX, checkY);
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
          const obstruction = findPieceAtSquare(pieces, checkX, checkY);
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
        const obstruction = findPieceAtSquare(pieces, checkX, checkY);
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
          const obstruction = findPieceAtSquare(pieces, checkX, checkY);
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

  const getStepMovementConfig = useCallback((piece) => {
    const stepValueRaw = piece?.step_by_step_movement_value ?? piece?.step_movement_value;
    const stepValue = Number(stepValueRaw);
    if (Number.isNaN(stepValue) || stepValue === 0) {
      return null;
    }

    return {
      maxSteps: Math.abs(stepValue),
      noDiagonal: stepValue < 0
    };
  }, []);

  const isStepByStepTarget = useCallback((piece, fromX, fromY, toX, toY) => {
    const config = getStepMovementConfig(piece);
    if (!config) {
      return false;
    }

    const dx = Math.abs(toX - fromX);
    const dy = Math.abs(toY - fromY);
    if (dx === 0 && dy === 0) {
      return false;
    }

    if (config.noDiagonal) {
      return dx + dy <= config.maxSteps;
    }

    return Math.max(dx, dy) <= config.maxSteps;
  }, [getStepMovementConfig]);

  const canReachStepByStep = useCallback((piece, targetX, targetY, pieces, boardWidth, boardHeight, allowOccupiedTarget = false) => {
    const config = getStepMovementConfig(piece);
    if (!config) {
      return false;
    }

    const occupied = new Set();
    pieces.filter(p => p.id !== piece.id).forEach(p => {
      const pw = p.piece_width || 1;
      const ph = p.piece_height || 1;
      for (let dy = 0; dy < ph; dy++) {
        for (let dx = 0; dx < pw; dx++) {
          occupied.add(`${p.x + dx},${p.y + dy}`);
        }
      }
    });

    const queue = [{ x: piece.x, y: piece.y, steps: 0 }];
    const visited = new Set([`${piece.x},${piece.y}`]);
    const directions = config.noDiagonal
      ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current.steps >= config.maxSteps) {
        continue;
      }

      for (const [dirX, dirY] of directions) {
        const nextX = current.x + dirX;
        const nextY = current.y + dirY;

        if (nextX < 0 || nextY < 0 || nextX >= boardWidth || nextY >= boardHeight) {
          continue;
        }

        const isTarget = nextX === targetX && nextY === targetY;
        const nextKey = `${nextX},${nextY}`;
        const hasPiece = occupied.has(nextKey);

        if (hasPiece && !(allowOccupiedTarget && isTarget)) {
          continue;
        }

        if (isTarget) {
          return true;
        }

        if (visited.has(nextKey)) {
          continue;
        }

        visited.add(nextKey);
        queue.push({ x: nextX, y: nextY, steps: current.steps + 1 });
      }
    }

    return false;
  }, [getStepMovementConfig]);

  // Check if a specific piece is under attack by any enemy piece
  const isPieceUnderAttack = useCallback((targetPiece, pieces, boardWidth, boardHeight) => {
    const targetTeam = targetPiece.player_id || targetPiece.team;
    const tw = targetPiece.piece_width || 1;
    const th = targetPiece.piece_height || 1;
    
    // Check all enemy pieces against ALL occupied squares of the target
    for (const enemyPiece of pieces) {
      const enemyTeam = enemyPiece.player_id || enemyPiece.team;
      if (enemyTeam === targetTeam) continue; // Skip friendly pieces
      
      const ew = enemyPiece.piece_width || 1;
      const eh = enemyPiece.piece_height || 1;
      
      // For multi-tile target, check each occupied square
      for (let dy = 0; dy < th; dy++) {
        for (let dx = 0; dx < tw; dx++) {
          const sx = targetPiece.x + dx;
          const sy = targetPiece.y + dy;
          
          // For multi-tile attackers, check all anchor destinations that put (sx, sy) in footprint
          for (let edy = 0; edy < eh; edy++) {
            for (let edx = 0; edx < ew; edx++) {
              const adx = sx - edx; // potential anchor destination x
              const ady = sy - edy; // potential anchor destination y
              
              if (canPieceCaptureTo(enemyPiece.x, enemyPiece.y, adx, ady, enemyPiece, enemyTeam)) {
                const isRatioMove = enemyPiece.ratio_capture_1 > 0 && enemyPiece.ratio_capture_2 > 0 &&
                                   ((Math.abs(adx - enemyPiece.x) === enemyPiece.ratio_capture_1 && Math.abs(ady - enemyPiece.y) === enemyPiece.ratio_capture_2) ||
                                    (Math.abs(adx - enemyPiece.x) === enemyPiece.ratio_capture_2 && Math.abs(ady - enemyPiece.y) === enemyPiece.ratio_capture_1));
                
                const usesRatioForCapture = !isRatioMove && enemyPiece.attacks_like_movement && 
                                             enemyPiece.ratio_movement_1 > 0 && enemyPiece.ratio_movement_2 > 0 &&
                                             ((Math.abs(adx - enemyPiece.x) === enemyPiece.ratio_movement_1 && Math.abs(ady - enemyPiece.y) === enemyPiece.ratio_movement_2) ||
                                              (Math.abs(adx - enemyPiece.x) === enemyPiece.ratio_movement_2 && Math.abs(ady - enemyPiece.y) === enemyPiece.ratio_movement_1));
                
                const isStepMove = isStepByStepTarget(enemyPiece, enemyPiece.x, enemyPiece.y, adx, ady);

                let pathClear = false;
                if (isRatioMove || usesRatioForCapture) {
                  pathClear = checkRatioPathClear(enemyPiece, adx, ady, pieces);
                } else if (isStepMove) {
                  pathClear = canReachStepByStep(enemyPiece, adx, ady, pieces, boardWidth, boardHeight, true);
                } else {
                  pathClear = isPathClear(enemyPiece.x, enemyPiece.y, adx, ady, pieces, enemyPiece, true);
                }
                
                if (pathClear) {
                  return true;
                }
              }
            }
          }
        }
      }
    }
    return false;
  }, [canPieceCaptureTo, isPathClear, checkRatioPathClear, isStepByStepTarget, canReachStepByStep]);

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
    
    // Find and remove ALL enemy pieces in the destination footprint (multi-tile captures all)
    const pw = piece.piece_width || 1;
    const ph = piece.piece_height || 1;
    const pieceOwner = piece.player_id || piece.team;
    const capturedIds = new Set();
    if (pw > 1 || ph > 1) {
      for (let fdy = 0; fdy < ph; fdy++) {
        for (let fdx = 0; fdx < pw; fdx++) {
          const found = simulatedPieces.find(p => {
            if (p.id === piece.id || capturedIds.has(p.id)) return false;
            if (!doesPieceOccupySquare(p, toX + fdx, toY + fdy)) return false;
            const pOwner = p.player_id || p.team;
            return pOwner !== pieceOwner;
          });
          if (found) capturedIds.add(found.id);
        }
      }
    } else {
      const found = simulatedPieces.find(p => p.id !== piece.id && doesPieceOccupySquare(p, toX, toY));
      if (found) {
        const fOwner = found.player_id || found.team;
        if (fOwner !== pieceOwner) capturedIds.add(found.id);
      }
    }
    if (capturedIds.size > 0) {
      for (let i = simulatedPieces.length - 1; i >= 0; i--) {
        if (capturedIds.has(simulatedPieces[i].id)) {
          simulatedPieces.splice(i, 1);
        }
      }
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
  // forPremove: when true, includes potential capture squares even when empty (for premove highlighting)
  const calculateValidMoves = useCallback((piece, pieces, boardWidth, boardHeight, skipCheckFilter = false, forPremove = false) => {
    const moves = [];
    const pieceTeam = piece.player_id || piece.team;
    const pw = piece.piece_width || 1;
    const ph = piece.piece_height || 1;

    for (let toY = 0; toY < boardHeight; toY++) {
      for (let toX = 0; toX < boardWidth; toX++) {
        // Skip current position
        if (toX === piece.x && toY === piece.y) continue;

        // For multi-tile pieces, check the piece would fit on the board
        if (!doesPieceFitOnBoard(toX, toY, pw, ph, boardWidth, boardHeight)) continue;

        // For multi-tile pieces, scan entire destination footprint for enemies
        let occupyingPiece = null;
        if (pw > 1 || ph > 1) {
          // Find any enemy in the destination footprint (multi-tile captures all enemies in path)
          for (let dy = 0; dy < ph; dy++) {
            for (let dx = 0; dx < pw; dx++) {
              const found = pieces.find(p =>
                p.id !== piece.id && doesPieceOccupySquare(p, toX + dx, toY + dy)
              );
              if (found) {
                const foundTeam = found.player_id || found.team;
                if (foundTeam !== pieceTeam && !occupyingPiece) {
                  occupyingPiece = found; // Track first enemy for capture flag
                }
              }
            }
          }
          // Only friendly pieces should block the destination (enemies are captured)
          if (!isDestinationClear(piece, toX, toY, pieces.filter(p => {
            const pTeam = p.player_id || p.team;
            return pTeam === pieceTeam && p.id !== piece.id;
          }), null)) continue;
        } else {
          occupyingPiece = findPieceAtSquare(pieces, toX, toY);
          const occupyingTeam = occupyingPiece?.player_id || occupyingPiece?.team;

          // Skip if a friendly piece occupies the target
          if (occupyingPiece && occupyingPiece.id !== piece.id && occupyingTeam === pieceTeam) continue;
          // Skip moves to squares within the piece's own footprint
          if (occupyingPiece && occupyingPiece.id === piece.id) continue;
        }

        const isCapture = !!(occupyingPiece && occupyingPiece.id !== piece.id);

        // Check if move is valid based on piece movement rules
        let isValidMove = false;
        let isPotentialCapture = false; // For premoves: empty square that could be a capture
        
        if (isCapture) {
          // Check capture rules
          isValidMove = canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
        } else {
          // Check movement rules
          isValidMove = canPieceMoveTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
          
          // For premoves: also check if this empty square is a valid capture square
          // (e.g., pawn diagonal attack - piece might move there by opponent's turn)
          if (forPremove && !isValidMove) {
            const canCaptureThere = canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
            if (canCaptureThere) {
              isValidMove = true;
              isPotentialCapture = true;
            }
          }
        }

        // If move is valid, check if path is clear
        // For ratio movements (L-shape), use special path checking
        const isRatioMove = piece.ratio_movement_1 > 0 && piece.ratio_movement_2 > 0 &&
                           ((Math.abs(toX - piece.x) === piece.ratio_movement_1 && Math.abs(toY - piece.y) === piece.ratio_movement_2) ||
                            (Math.abs(toX - piece.x) === piece.ratio_movement_2 && Math.abs(toY - piece.y) === piece.ratio_movement_1));
        
        const isStepMove = isStepByStepTarget(piece, piece.x, piece.y, toX, toY);

        let pathClear = false;
        if (isRatioMove) {
          // Check L-shape paths with hopping abilities
          pathClear = checkRatioPathClear(piece, toX, toY, pieces);
        } else if (isStepMove) {
          pathClear = canReachStepByStep(piece, toX, toY, pieces, boardWidth, boardHeight, isCapture);
        } else {
          pathClear = isPathClear(piece.x, piece.y, toX, toY, pieces, piece, isCapture);
        }

        // Hop capture: piece has capture_on_hop, destination is empty, enemies are in the path
        let isHopCapture = false;
        let hopCapturedPieceIds = [];
        if (!isCapture && piece.capture_on_hop && !isStepMove && !isRatioMove) {
          const canHopAttackEnemies = piece.can_hop_attack_over_enemies === 1 || piece.can_hop_attack_over_enemies === true;
          const canHopEnemies = piece.can_hop_over_enemies === 1 || piece.can_hop_over_enemies === true;
          if (canHopAttackEnemies || canHopEnemies) {
            let hopMoveValid = isValidMove;
            if (!hopMoveValid) {
              hopMoveValid = canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
            }
            if (hopMoveValid) {
              const hopPathClear = isPathClear(piece.x, piece.y, toX, toY, pieces, piece, true);
              if (hopPathClear) {
                const hdx = Math.sign(toX - piece.x);
                const hdy = Math.sign(toY - piece.y);
                const hxDiff = Math.abs(toX - piece.x);
                const hyDiff = Math.abs(toY - piece.y);
                if (hxDiff === hyDiff || hxDiff === 0 || hyDiff === 0) {
                  let cx = piece.x + hdx;
                  let cy = piece.y + hdy;
                  while (cx !== toX || cy !== toY) {
                    const hopPiece = findPieceAtSquare(pieces, cx, cy);
                    if (hopPiece && hopPiece.id !== piece.id) {
                      const hopTeam = hopPiece.player_id || hopPiece.team;
                      if (hopTeam !== pieceTeam) {
                        hopCapturedPieceIds.push(hopPiece.id);
                      }
                    }
                    cx += hdx;
                    cy += hdy;
                  }
                }
                if (hopCapturedPieceIds.length > 0) {
                  isHopCapture = true;
                  isValidMove = true;
                  pathClear = true;
                }
              }
            }
          }
        }
        
        if (isValidMove && pathClear) {
          // Check if this move requires a certain number of first moves
          const firstMovesRequired = (isCapture || isPotentialCapture || isHopCapture)
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
            isCapture: isCapture || isPotentialCapture || isHopCapture,
            isHopCapture,
            hopCapturedPieceIds,
            isFirstMoveOnly: firstMovesRequired > 0,
            isPotentialCapture
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
            const targetOccupiedByOther = pieces.some(p => p.id !== partner.id && doesPieceOccupySquare(p, targetX, targetY));
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
            const targetOccupied = !!findPieceAtSquare(pieces, targetX, targetY);
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
            const targetOccupiedByOther = pieces.some(p => p.id !== partner.id && doesPieceOccupySquare(p, targetX, targetY));
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
            const targetOccupied = !!findPieceAtSquare(pieces, targetX, targetY);
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
    
    // Check for en passant capture
    console.log('[EN PASSANT FE] Checking en passant:', {
      pieceCanEnPassant: piece.can_en_passant,
      hasEnPassantTarget: !!gameState?.enPassantTarget,
      enPassantTarget: gameState?.enPassantTarget
    });
    if (piece.can_en_passant && gameState?.enPassantTarget) {
      const ept = gameState.enPassantTarget;
      // Check if capturing piece is horizontally adjacent to the vulnerable piece
      const vulnerablePiece = pieces.find(p => 
        p.id === ept.pieceId && p.x === ept.piecePosition.x && p.y === ept.piecePosition.y
      );
      console.log('[EN PASSANT FE] Vulnerable piece found:', vulnerablePiece);
      if (vulnerablePiece) {
        const vulnerableTeam = vulnerablePiece.player_id || vulnerablePiece.team;
        console.log('[EN PASSANT FE] Check conditions:', {
          vulnerableTeam,
          pieceTeam,
          piecePieceId: piece.piece_id,
          vulnerablePieceId: vulnerablePiece.piece_id,
          pieceY: piece.y,
          vulnerableY: vulnerablePiece.y,
          xDiff: Math.abs(piece.x - vulnerablePiece.x)
        });
        // Must be enemy piece
        if (vulnerableTeam !== pieceTeam) {
          // Must be same piece type (e.g., pawn can only en passant capture another pawn)
          if (piece.piece_id === vulnerablePiece.piece_id) {
            // Check if current piece is horizontally adjacent to the vulnerable piece
            if (piece.y === vulnerablePiece.y && Math.abs(piece.x - vulnerablePiece.x) === 1) {
              // Check if capture square isn't already in moves
              const captureSquare = ept.captureSquare;
              console.log('[EN PASSANT FE] Adding en passant move to:', captureSquare);
              if (!moves.some(m => m.x === captureSquare.x && m.y === captureSquare.y)) {
                moves.push({
                  x: captureSquare.x,
                  y: captureSquare.y,
                  isCapture: true,
                  isEnPassant: true,
                  enPassantVictimId: vulnerablePiece.id
                });
              }
            }
          }
        }
      }
    }
    
    // Check for ranged attack targets
    if (piece.can_capture_enemy_via_range) {
      for (let toY = 0; toY < boardHeight; toY++) {
        for (let toX = 0; toX < boardWidth; toX++) {
          if (toX === piece.x && toY === piece.y) continue;
          const targetPiece = findPieceAtSquare(pieces, toX, toY);
          const targetTeam = targetPiece?.player_id || targetPiece?.team;
          // Skip friendly pieces - show all other squares within range
          if (targetPiece && targetTeam === pieceTeam) continue;
          // Already in moves as a regular capture? skip
          if (moves.some(m => m.x === toX && m.y === toY)) continue;
          if (canRangedAttackTo(piece.y, piece.x, toY, toX, piece, pieceTeam)) {
            const hasTarget = !!targetPiece;
            // For premoves, include empty ranged squares as potential targets
            if (hasTarget || forPremove) {
              moves.push({
                x: toX,
                y: toY,
                isCapture: hasTarget,
                isFirstMoveOnly: false,
                isRangedAttack: true,
                isPotentialRangedTarget: !hasTarget && forPremove
              });
            }
          }
        }
      }
    }
    
    // Filter out moves that would leave the player in check (if mate_condition is enabled and not skipped)
    if (!skipCheckFilter && gameState?.gameType?.mate_condition && currentPlayer) {
      // Don't filter ranged attacks through check filter (they don't move the piece)
      const regularMoves = moves.filter(m => !m.isRangedAttack);
      const rangedMoves = moves.filter(m => m.isRangedAttack);
      const filteredRegular = regularMoves.filter(move => 
        wouldMoveResolveCheck(piece, move.x, move.y, pieces, currentPlayer.position, boardWidth, boardHeight)
      );
      return [...filteredRegular, ...rangedMoves];
    }
    
    return moves;
  }, [canPieceMoveTo, canPieceCaptureTo, isPathClear, checkRatioPathClear, isStepByStepTarget, canReachStepByStep, gameState, currentPlayer, wouldMoveResolveCheck]);

  // Handle square click
  const handleSquareClick = useCallback((x, y) => {
    // Clear ranged-twice selection on any left click
    if (rangedSelectedPiece) {
      setRangedSelectedPiece(null);
    }

    // Allow selecting pieces to preview moves when waiting or during gameplay
    const canInteract = gameState && gameState.status !== 'completed';
    if (!canInteract) {
      return;
    }

    const pieces = parsePieces(gameState.pieces);
    const clickedPiece = findPieceAtSquare(pieces, x, y);

    // Check if clicking on own piece (or any piece when waiting/previewing)
    const isPreviewMode = gameState.status === 'waiting' || gameState.status === 'ready';
    const isOwnPiece = clickedPiece && (
      clickedPiece.player_id === currentPlayer?.position ||
      clickedPiece.team === currentPlayer?.position
    );
    
    // If clicking on opponent's piece, clear selection and return
    // Unless a valid capture move overlaps with this enemy piece's footprint
    if (clickedPiece && !isOwnPiece && !isPreviewMode) {
      let hasCaptureForEnemy = false;
      if (selectedPiece) {
        const spw = selectedPiece.piece_width || 1;
        const sph = selectedPiece.piece_height || 1;
        hasCaptureForEnemy = validMoves.some(m => {
          if (!m.isCapture) return false;
          // Check if moving piece's footprint at destination overlaps clicked enemy
          for (let dy = 0; dy < sph; dy++) {
            for (let dx = 0; dx < spw; dx++) {
              if (doesPieceOccupySquare(clickedPiece, m.x + dx, m.y + dy)) return true;
            }
          }
          return false;
        });
      }
      if (!hasCaptureForEnemy) {
        setSelectedPiece(null);
        setValidMoves([]);
        return;
      }
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
        gameState.gameType?.board_height || 8,
        false, // skipCheckFilter
        canSelectForPremove // forPremove - include potential capture squares
      );
      setValidMoves(moves);
      return;
    }

    // If piece is selected and clicking on valid move, make the move (during ready or active game)
    const canMakeMove = selectedPiece && isMyTurn && (gameState.status === 'active' || gameState.status === 'ready');
    const canPremove = selectedPiece && !isMyTurn && (gameState.status === 'active' || gameState.status === 'ready') && gameState.allowPremoves !== false;
    
    if (canMakeMove) {
      // Find move: exact match first, then check multi-tile footprint overlap
      let move = validMoves.find(m => m.x === x && m.y === y);
      if (!move && selectedPiece) {
        const spw = selectedPiece.piece_width || 1;
        const sph = selectedPiece.piece_height || 1;
        if (spw > 1 || sph > 1) {
          move = validMoves.find(m => !m.isRangedAttack &&
            x >= m.x && x < m.x + spw && y >= m.y && y < m.y + sph
          );
        }
      }
      // Multi-tile enemy fallback: clicking on a multi-tile enemy piece routes
      // to its anchor square due to DOM structure. Find any capture move whose
      // destination footprint overlaps the clicked enemy piece.
      if (!move && clickedPiece && !isOwnPiece) {
        const spw = selectedPiece.piece_width || 1;
        const sph = selectedPiece.piece_height || 1;
        move = validMoves.find(m => {
          if (!m.isCapture) return false;
          for (let dy = 0; dy < sph; dy++) {
            for (let dx = 0; dx < spw; dx++) {
              if (doesPieceOccupySquare(clickedPiece, m.x + dx, m.y + dy)) return true;
            }
          }
          return false;
        });
      }
      if (move) {
        // Ranged zone squares (no enemy piece) are display-only, not executable
        if (move.isRangedAttack && !move.isCapture) {
          setSelectedPiece(null);
          setValidMoves([]);
          return;
        }
        console.log('[MOVE ATTEMPT]', { 
          piece: selectedPiece.piece_name, 
          from: { x: selectedPiece.x, y: selectedPiece.y }, 
          to: { x: move.x, y: move.y },
          move 
        });
        const moveData = {
          from: { x: selectedPiece.x, y: selectedPiece.y },
          to: { x: move.x, y: move.y },
          pieceId: selectedPiece.id
        };
        // Include castling data if this is a castling move
        if (move.isCastling) {
          moveData.isCastling = true;
          moveData.castlingWith = move.castlingWith;
          moveData.castlingDirection = move.castlingDirection;
        }
        // Include ranged attack flag
        if (move.isRangedAttack) {
          moveData.isRangedAttack = true;
        }
        // Include hop capture data (checkers-style capture)
        if (move.isHopCapture) {
          moveData.isHopCapture = true;
          moveData.hopCapturedPieceIds = move.hopCapturedPieceIds;
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
      let move = validMoves.find(m => m.x === x && m.y === y);
      if (!move && selectedPiece) {
        const spw = selectedPiece.piece_width || 1;
        const sph = selectedPiece.piece_height || 1;
        if (spw > 1 || sph > 1) {
          move = validMoves.find(m => !m.isRangedAttack &&
            x >= m.x && x < m.x + spw && y >= m.y && y < m.y + sph
          );
        }
      }
      // Multi-tile enemy fallback for premoves
      if (!move && clickedPiece && !isOwnPiece) {
        const spw = selectedPiece.piece_width || 1;
        const sph = selectedPiece.piece_height || 1;
        move = validMoves.find(m => {
          if (!m.isCapture) return false;
          for (let dy = 0; dy < sph; dy++) {
            for (let dx = 0; dx < spw; dx++) {
              if (doesPieceOccupySquare(clickedPiece, m.x + dx, m.y + dy)) return true;
            }
          }
          return false;
        });
      }
      if (move) {
        console.log('Setting premove!', { from: { x: selectedPiece.x, y: selectedPiece.y }, to: { x: move.x, y: move.y } });
        const premoveData = {
          from: { x: selectedPiece.x, y: selectedPiece.y },
          to: { x: move.x, y: move.y },
          pieceId: selectedPiece.id,
          pieceWidth: selectedPiece.piece_width || 1,
          pieceHeight: selectedPiece.piece_height || 1
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
  }, [isMyTurn, gameState, currentPlayer, selectedPiece, validMoves, calculateValidMoves, makeMove, sendPremove, setPremove, gameId, rangedSelectedPiece]);

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
      gameState.gameType?.board_height || 8,
      false, // skipCheckFilter
      canDragForPremove // forPremove - include potential capture squares for premoves
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

    // Don't move if dropping within the piece's own current footprint
    const selfW = draggedPiece.piece_width || 1;
    const selfH = draggedPiece.piece_height || 1;
    if (targetX >= draggedPiece.x && targetX < draggedPiece.x + selfW &&
        targetY >= draggedPiece.y && targetY < draggedPiece.y + selfH) {
      setDraggedPiece(null);
      setDragValidMoves([]);
      return;
    }

    // Check if target is a valid move (exact match or multi-tile footprint overlap)
    let validMove = dragValidMoves.find(m => m.x === targetX && m.y === targetY);
    if (!validMove && draggedPiece) {
      const dpw = draggedPiece.piece_width || 1;
      const dph = draggedPiece.piece_height || 1;
      if (dpw > 1 || dph > 1) {
        validMove = dragValidMoves.find(m => !m.isRangedAttack &&
          targetX >= m.x && targetX < m.x + dpw && targetY >= m.y && targetY < m.y + dph
        );
      }
    }
    // Multi-tile enemy fallback: dropping on a multi-tile enemy may route to its
    // anchor square. Find any capture move whose footprint overlaps the target square.
    if (!validMove && draggedPiece) {
      const pieces = parsePieces(gameState?.pieces);
      const targetPiece = findPieceAtSquare(pieces, targetX, targetY);
      if (targetPiece && targetPiece.id !== draggedPiece.id) {
        const dpw = draggedPiece.piece_width || 1;
        const dph = draggedPiece.piece_height || 1;
        validMove = dragValidMoves.find(m => {
          if (!m.isCapture) return false;
          for (let dy = 0; dy < dph; dy++) {
            for (let dx = 0; dx < dpw; dx++) {
              if (doesPieceOccupySquare(targetPiece, m.x + dx, m.y + dy)) return true;
            }
          }
          return false;
        });
      }
    }
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
        console.log('Making move:', { from: { x: draggedPiece.x, y: draggedPiece.y }, to: { x: validMove.x, y: validMove.y } });
        const moveData = {
          from: { x: draggedPiece.x, y: draggedPiece.y },
          to: { x: validMove.x, y: validMove.y },
          pieceId: draggedPiece.id
        };
        // Include castling data if this is a castling move
        if (validMove.isCastling) {
          moveData.isCastling = true;
          moveData.castlingWith = validMove.castlingWith;
          moveData.castlingDirection = validMove.castlingDirection;
        }
        // Include hop capture data (checkers-style capture)
        if (validMove.isHopCapture) {
          moveData.isHopCapture = true;
          moveData.hopCapturedPieceIds = validMove.hopCapturedPieceIds;
        }
        makeMove(parseInt(gameId), moveData);
      } else if (canMakePremove) {
        console.log('Setting premove via drag:', { from: { x: draggedPiece.x, y: draggedPiece.y }, to: { x: validMove.x, y: validMove.y } });
        const premoveData = {
          from: { x: draggedPiece.x, y: draggedPiece.y },
          to: { x: validMove.x, y: validMove.y },
          pieceId: draggedPiece.id,
          pieceWidth: draggedPiece.piece_width || 1,
          pieceHeight: draggedPiece.piece_height || 1
        };
        setPremove(premoveData);
        sendPremove(parseInt(gameId), premoveData);
      }
    }

    setSelectedPiece(null);
    setValidMoves([]);
    setDraggedPiece(null);
    setDragValidMoves([]);
  }, [draggedPiece, dragValidMoves, isMyTurn, gameState, makeMove, sendPremove, gameId, inCheck, currentPlayer, soundEnabledRef, calculateValidMoves]);

  // Handle right-click mousedown for ranged attack drag detection
  const handleSquareMouseDown = useCallback((e, x, y) => {
    if (e.button !== 2) return;
    if (!gameState || gameState.status === 'completed') return;

    const pieces = parsePieces(gameState.pieces || []);
    const clickedPiece = pieces.find(p => p.x === x && p.y === y);
    const isOwnPiece = clickedPiece && currentPlayer &&
      (clickedPiece.player_id === currentPlayer.position || clickedPiece.team === currentPlayer.position);

    rightClickDataRef.current = {
      piece: clickedPiece, x, y, time: Date.now(),
      clientX: e.clientX, clientY: e.clientY,
      isDrag: false, isOwnRangedPiece: !!(isOwnPiece && clickedPiece?.can_capture_enemy_via_range)
    };

    // Activate right-click drag detection for own ranged pieces
    // Works for both regular moves (isMyTurn) and premoves (!isMyTurn with allowPremoves)
    const canPremoveRanged = !isMyTurn && gameState.allowPremoves !== false;
    if (isOwnPiece && clickedPiece?.can_capture_enemy_via_range && (isMyTurn || canPremoveRanged) &&
        (gameState?.status === 'active' || gameState?.status === 'ready')) {
      setIsRightClickActive(true);
    }
  }, [gameState, currentPlayer, isMyTurn]);

  // Handle contextmenu on square
  const handleSquareContextMenu = useCallback((e, x, y) => {
    e.preventDefault();

    const data = rightClickDataRef.current;
    // If a ranged right-click is pending (hold detection active), skip normal handling
    if (data && data.isOwnRangedPiece) return;

    // Right-click cancels premove if one exists
    if (premove) {
      setPremove(null);
      sendClearPremove(parseInt(gameId));
      setSelectedPiece(null);
      setValidMoves([]);
      rightClickDataRef.current = null;
      return;
    }

    // Right-click-twice: if a ranged piece was previously selected, execute ranged attack or premove
    if (rangedSelectedPiece && (gameState?.status === 'active' || gameState?.status === 'ready')) {
      const pieces = parsePieces(gameState?.pieces || []);
      const targetPiece = pieces.find(p => p.x === x && p.y === y);
      const sourceTeam = rangedSelectedPiece.player_id || rangedSelectedPiece.team;
      const targetTeam = targetPiece?.player_id || targetPiece?.team;
      
      // Check if this is a valid ranged attack target (or potential target for premoves)
      const isValidTarget = canRangedAttackTo(rangedSelectedPiece.y, rangedSelectedPiece.x, y, x, rangedSelectedPiece, sourceTeam);
      const isEnemyTarget = targetPiece && targetTeam !== sourceTeam;
      const canPremoveRanged = !isMyTurn && gameState.allowPremoves !== false;

      if (isValidTarget && (isEnemyTarget || canPremoveRanged)) {
        if (isMyTurn) {
          // Execute ranged attack immediately
          if (isEnemyTarget) {
            makeMove(parseInt(gameId), {
              from: { x: rangedSelectedPiece.x, y: rangedSelectedPiece.y },
              to: { x, y },
              pieceId: rangedSelectedPiece.id,
              isRangedAttack: true
            });
          }
        } else if (canPremoveRanged) {
          // Set ranged premove
          const premoveData = {
            from: { x: rangedSelectedPiece.x, y: rangedSelectedPiece.y },
            to: { x, y },
            pieceId: rangedSelectedPiece.id,
            isRangedAttack: true,
            pieceWidth: rangedSelectedPiece.piece_width || 1,
            pieceHeight: rangedSelectedPiece.piece_height || 1
          };
          setPremove(premoveData);
          sendPremove(parseInt(gameId), premoveData);
        }
      }
      setRangedSelectedPiece(null);
      rightClickDataRef.current = null;
      return;
    }

    // If a piece is selected and it's our turn, try to move to the right-clicked square
    const canMoveSelected = selectedPiece && isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready');
    if (canMoveSelected) {
      const move = validMoves.find(m => m.x === x && m.y === y);
      if (move) {
        const moveData = {
          from: { x: selectedPiece.x, y: selectedPiece.y },
          to: { x, y },
          pieceId: selectedPiece.id
        };
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
      setSelectedPiece(null);
      setValidMoves([]);
    }
    rightClickDataRef.current = null;
  }, [selectedPiece, validMoves, isMyTurn, gameState, makeMove, gameId, premove, sendClearPremove, currentPlayer, rangedSelectedPiece, sendPremove]);

  // Global listeners for ranged right-click drag detection
  useEffect(() => {
    if (!isRightClickActive) return;

    const DRAG_DISTANCE_THRESHOLD = 5;
    const DRAG_TIME_THRESHOLD = 200;
    const bw = gameState?.gameType?.board_width || 8;
    const bh = gameState?.gameType?.board_height || 8;
    const isFlipped = currentPlayer?.position === 2;

    const getTargetSquare = (clientX, clientY) => {
      if (!boardRef.current) return null;
      const boardRect = boardRef.current.getBoundingClientRect();
      const squareW = boardRect.width / bw;
      const squareH = boardRect.height / bh;
      const relX = clientX - boardRect.left;
      const relY = clientY - boardRect.top;
      if (relX >= 0 && relX < boardRect.width && relY >= 0 && relY < boardRect.height) {
        const displayCol = Math.floor(relX / squareW);
        const displayRow = Math.floor(relY / squareH);
        const gameX = isFlipped ? (bw - 1 - displayCol) : displayCol;
        const gameY = isFlipped ? (bh - 1 - displayRow) : displayRow;
        return { x: gameX, y: gameY };
      }
      return null;
    };

    const handleMouseMove = (e) => {
      const data = rightClickDataRef.current;
      if (!data || !data.isOwnRangedPiece) return;

      const dx = e.clientX - data.clientX;
      const dy = e.clientY - data.clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const elapsed = Date.now() - data.time;

      if (!data.isDrag && (dist > DRAG_DISTANCE_THRESHOLD || elapsed > DRAG_TIME_THRESHOLD)) {
        data.isDrag = true;
        setRangedAttackSource(data.piece);
      }

      if (data.isDrag) {
        setRangedMousePos({ x: e.clientX, y: e.clientY });
        setRangedTargetSquare(getTargetSquare(e.clientX, e.clientY));
      }
    };

    const handleMouseUp = (e) => {
      if (e.button !== 2) return;
      const data = rightClickDataRef.current;
      if (!data) { cleanup(); return; }

      if (data.isDrag) {
        // Drag mode — execute ranged attack or set ranged premove
        const target = getTargetSquare(e.clientX, e.clientY);
        if (target && gameState?.pieces) {
          const pieces = parsePieces(gameState.pieces);
          const targetPiece = pieces.find(p => p.x === target.x && p.y === target.y);
          const sourceTeam = data.piece.player_id || data.piece.team;
          const targetTeam = targetPiece?.player_id || targetPiece?.team;
          const isValidTarget = canRangedAttackTo(data.piece.y, data.piece.x, target.y, target.x, data.piece, sourceTeam);
          const isEnemyTarget = targetPiece && targetTeam !== sourceTeam;
          const canPremoveRanged = !isMyTurn && gameState.allowPremoves !== false;

          if (isValidTarget && (isEnemyTarget || canPremoveRanged)) {
            if (isMyTurn && isEnemyTarget) {
              // Execute ranged attack immediately
              makeMove(parseInt(gameId), {
                from: { x: data.piece.x, y: data.piece.y },
                to: { x: target.x, y: target.y },
                pieceId: data.piece.id,
                isRangedAttack: true
              });
            } else if (canPremoveRanged) {
              // Set ranged premove
              const premoveData = {
                from: { x: data.piece.x, y: data.piece.y },
                to: { x: target.x, y: target.y },
                pieceId: data.piece.id,
                isRangedAttack: true,
                pieceWidth: data.piece.piece_width || 1,
                pieceHeight: data.piece.piece_height || 1
              };
              setPremove(premoveData);
              sendPremove(parseInt(gameId), premoveData);
            }
          }
        }
      } else {
        // Quick click on own ranged piece — enter right-click-twice mode
        setRangedSelectedPiece(data.piece);
      }
      cleanup();
    };

    const handleContextMenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleResize = () => {
      if (rightClickDataRef.current?.isDrag) {
        setRangedMousePos(prev => prev ? { ...prev } : null);
      }
    };

    const cleanup = () => {
      rightClickDataRef.current = null;
      setIsRightClickActive(false);
      setRangedAttackSource(null);
      setRangedMousePos(null);
      setRangedTargetSquare(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('contextmenu', handleContextMenu, { capture: true });
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('contextmenu', handleContextMenu, { capture: true });
      window.removeEventListener('resize', handleResize);
    };
  }, [isRightClickActive, gameState, currentPlayer, makeMove, gameId, isMyTurn, sendPremove, setPremove]);

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
    if (!currentUser) {
      navigate('/login', { state: { message: "Please log in to join live games." } });
      return;
    }
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

  // Compute captured pieces for each player from move history
  const capturedPieces = useMemo(() => {
    if (!gameState?.moveHistory) return { player1: [], player2: [] };
    
    const result = { player1: [], player2: [] };
    
    gameState.moveHistory.forEach(move => {
      if (move.captured) {
        // Use allCaptured array for multi-captures, otherwise single captured piece
        const captures = move.allCaptured && move.allCaptured.length > 1
          ? move.allCaptured
          : [move.captured];
        // The capturing player is indicated by move.position (1 or 2)
        // The captured pieces belong to the opponent
        if (move.position === 1) {
          result.player1.push(...captures);
        } else {
          result.player2.push(...captures);
        }
      }
    });
    
    return result;
  }, [gameState?.moveHistory]);

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
        // Multi-tile aware: find piece whose footprint covers this square
        const piece = findPieceAtSquare(pieces, gameX, gameY);
        // Is this the anchor square (top-left) of the piece? Only render image here.
        const isAnchor = piece && piece.x === gameX && piece.y === gameY;
        const isSelected = selectedPiece && doesPieceOccupySquare(selectedPiece, gameX, gameY);
        // Find regular and ranged moves separately so both styles can overlap
        // Multi-tile aware: highlight all squares the piece would cover at each valid destination
        // But don't highlight squares within the selected piece's current footprint
        const spw = selectedPiece?.piece_width || 1;
        const sph = selectedPiece?.piece_height || 1;
        const inSelectedFootprint = selectedPiece && doesPieceOccupySquare(selectedPiece, gameX, gameY);
        const regularMove = !inSelectedFootprint ? validMoves.find(m => !m.isRangedAttack &&
          gameX >= m.x && gameX < m.x + spw && gameY >= m.y && gameY < m.y + sph
        ) : null;
        const rangedMove = validMoves.find(m => m.x === gameX && m.y === gameY && m.isRangedAttack);
        const isLastMove = (() => {
          if (!lastMove) return false;
          const lmpw = lastMove.piece_width || 1;
          const lmph = lastMove.piece_height || 1;
          // Check if this square is within the footprint at the from or to location
          const inFrom = lastMove.from && gameX >= lastMove.from.x && gameX < lastMove.from.x + lmpw
            && gameY >= lastMove.from.y && gameY < lastMove.from.y + lmph;
          const inTo = lastMove.to && gameX >= lastMove.to.x && gameX < lastMove.to.x + lmpw
            && gameY >= lastMove.to.y && gameY < lastMove.to.y + lmph;
          return inFrom || inTo;
        })();
        
        // Check if this piece can move (only shown when it's your turn)
        const canMove = piece && movablePieceIds.has(piece.id);
        
        // Check if this square shows a hovered piece's possible move (separate regular/ranged)
        const hpw = hoveredPiece?.piece_width || 1;
        const hph = hoveredPiece?.piece_height || 1;
        const inHoveredFootprint = hoveredPiece && doesPieceOccupySquare(hoveredPiece, gameX, gameY);
        const hoveredRegularMove = showHelpers && hoveredPiece && !selectedPiece && !inHoveredFootprint
          ? hoveredMoves.find(m => !m.isRangedAttack &&
              gameX >= m.x && gameX < m.x + hpw && gameY >= m.y && gameY < m.y + hph)
          : null;
        const hoveredRangedMove = showHelpers && hoveredPiece && !selectedPiece 
          ? hoveredMoves.find(m => m.x === gameX && m.y === gameY && m.isRangedAttack) 
          : null;

        // Check if this piece is in check
        const isInCheck = piece && inCheck && checkedPieces.some(cp => cp.id === piece.id);

        // Check if this square is part of a premove (multi-tile aware)
        const pmPw = premove?.pieceWidth || 1;
        const pmPh = premove?.pieceHeight || 1;
        const isPremoveFrom = premove && gameX >= premove.from.x && gameX < premove.from.x + pmPw
          && gameY >= premove.from.y && gameY < premove.from.y + pmPh;
        const isPremoveTo = premove && gameX >= premove.to.x && gameX < premove.to.x + pmPw
          && gameY >= premove.to.y && gameY < premove.to.y + pmPh;

        // Check for special square type
        const specialSquareType = getSpecialSquareType(gameY, gameX);

        // Ranged attack highlights
        const isRangedMove = !!rangedMove;
        const isRangedHover = !!hoveredRangedMove;
        // During ranged drag, highlight all valid ranged target squares (including empty)
        const isRangedDragTarget = rangedAttackSource
          && !(piece && ((piece.player_id || piece.team) === (rangedAttackSource.player_id || rangedAttackSource.team)))
          && canRangedAttackTo(rangedAttackSource.y, rangedAttackSource.x, gameY, gameX, rangedAttackSource, rangedAttackSource.player_id || rangedAttackSource.team);
        // Right-click-twice mode: highlight all valid ranged squares (including empty)
        const isRangedSelectedTarget = !rangedAttackSource && rangedSelectedPiece
          && !(piece && ((piece.player_id || piece.team) === (rangedSelectedPiece.player_id || rangedSelectedPiece.team)))
          && canRangedAttackTo(rangedSelectedPiece.y, rangedSelectedPiece.x, gameY, gameX, rangedSelectedPiece, rangedSelectedPiece.player_id || rangedSelectedPiece.team);
        const isRangedSelectedSource = rangedSelectedPiece && rangedSelectedPiece.x === gameX && rangedSelectedPiece.y === gameY;

        squares.push(
          <div
            key={`${displayX}-${displayY}`}
            className={`
              ${styles["board-square"]}
              ${isLight ? styles.light : styles.dark}
              ${isSelected ? styles.selected : ''}
              ${regularMove && !regularMove.isCapture && !regularMove.isFirstMoveOnly ? styles["valid-move"] : ''}
              ${regularMove && !regularMove.isCapture && regularMove.isFirstMoveOnly ? styles["valid-move-first-only"] : ''}
              ${regularMove && regularMove.isCapture && !regularMove.isFirstMoveOnly ? styles["valid-capture"] : ''}
              ${regularMove && regularMove.isCapture && regularMove.isFirstMoveOnly ? styles["valid-capture-first-only"] : ''}
              ${isRangedMove ? styles["ranged-attack"] : ''}
              ${hoveredRegularMove && !hoveredRegularMove.isCapture && !hoveredRegularMove.isFirstMoveOnly ? styles["hover-move"] : ''}
              ${hoveredRegularMove && !hoveredRegularMove.isCapture && hoveredRegularMove.isFirstMoveOnly ? styles["hover-move-first-only"] : ''}
              ${hoveredRegularMove && hoveredRegularMove.isCapture && !hoveredRegularMove.isFirstMoveOnly ? styles["hover-capture"] : ''}
              ${hoveredRegularMove && hoveredRegularMove.isCapture && hoveredRegularMove.isFirstMoveOnly ? styles["hover-capture-first-only"] : ''}
              ${isRangedHover ? styles["hover-ranged"] : ''}
              ${isRangedDragTarget || isRangedSelectedTarget ? styles["ranged-drag-target"] : ''}
              ${isRangedSelectedSource ? styles["selected"] : ''}
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
            onMouseDown={(e) => handleSquareMouseDown(e, gameX, gameY)}
            onContextMenu={(e) => handleSquareContextMenu(e, gameX, gameY)}
            style={{
              backgroundColor: isLight 
                ? (currentUser?.light_square_color || '#cad5e8')
                : (currentUser?.dark_square_color || '#08234d'),
              position: 'relative',
              ...(isAnchor && piece && ((piece.piece_width || 1) > 1 || (piece.piece_height || 1) > 1) ? { zIndex: 10 } : {})
            }}
          >
            {((isRangedMove && rangedMove?.isCapture) || (isRangedHover && hoveredRangedMove?.isCapture) || ((isRangedDragTarget || isRangedSelectedTarget) && piece)) && (
              <span className={styles["ranged-icon"]}>💥</span>
            )}
            {/* Special square indicator */}
            {specialSquareType && specialSquareType !== 'control' && (
              <div className={`${styles["special-square-indicator"]} ${styles[specialSquareType]}`}>
                {specialSquareType === 'promotion' && 'P'}
                {specialSquareType === 'range' && 'R'}
                {specialSquareType === 'special' && 'S'}
              </div>
            )}
            {isAnchor && (() => {
              const pieceTeam = piece.player_id || piece.team;
              const isOwnPiece = currentPlayer && pieceTeam === currentPlayer.position;
              const canDragForMove = isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready') && isOwnPiece;
              const canDragForPremove = !isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready') && gameState?.allowPremoves !== false && isOwnPiece;
              
              const pw = piece.piece_width || 1;
              const ph = piece.piece_height || 1;
              
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
              
              // Multi-tile pieces span across grid cells
              const isMultiTile = pw > 1 || ph > 1;
              const isNonSquareMultiTile = isMultiTile && pw !== ph;
              const multiTileStyle = isMultiTile ? {
                width: `${pw * 100}%`,
                height: `${ph * 100}%`,
                zIndex: 5,
                position: 'absolute',
                // When the board is flipped, the anchor (top-left in game coords) is displayed
                // at the bottom-right of the piece's visual area, so we need to grow up-left
                ...(shouldFlipBoard
                  ? { bottom: 0, right: 0 }
                  : { top: 0, left: 0 })
              } : {};
              
              return (
                <div 
                  className={styles.piece}
                  style={multiTileStyle}
                  draggable={canDragForMove || canDragForPremove}
                  onDragStart={(e) => handleDragStart(e, piece)}
                  onDragEnd={handleDragEnd}
                  onMouseEnter={() => (showHelpers || showMovableIndicators) && handlePieceHover(piece)}
                  onMouseLeave={() => (showHelpers || showMovableIndicators) && handlePieceHover(null)}
                >
                {imageUrl ? (
                  isNonSquareMultiTile ? (
                    <div
                      ref={(el) => applySvgStretchBackground(el, imageUrl)}
                      style={{
                        width: '100%',
                        height: '100%',
                      }}
                    />
                  ) : (
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
                  )
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

    // Generate file labels (a, b, c, ... for columns)
    const fileLabels = [];
    for (let i = 0; i < boardWidth; i++) {
      const fileIndex = shouldFlipBoard ? (boardWidth - 1 - i) : i;
      fileLabels.push(
        <div key={`file-${i}`} className={styles["file-label"]}>
          {colToFile(fileIndex)}
        </div>
      );
    }

    // Generate rank labels (1, 2, 3, ... for rows)
    const rankLabels = [];
    for (let i = 0; i < boardHeight; i++) {
      const rankIndex = shouldFlipBoard ? i : (boardHeight - 1 - i);
      rankLabels.push(
        <div key={`rank-${i}`} className={styles["rank-label"]}>
          {rowToRank(rankIndex)}
        </div>
      );
    }

    // Calculate square size dynamically so the board always fits on screen
    let squareSize;
    if (windowWidth > 1200) {
      // 3-column layout: sidebars (~280px each), gaps (24px each), container padding (40px), coord labels (~24px)
      const containerWidth = Math.min(windowWidth, 1800);
      const sidebarWidth = containerWidth <= 1400 ? 240 : 280;
      const availableWidth = containerWidth - sidebarWidth * 2 - 24 * 2 - 40 - 24;
      // Leave room for header (~120px), padding, and some breathing room
      const availableHeight = windowHeight - 180;
      const maxByWidth = Math.floor(availableWidth / boardWidth);
      const maxByHeight = Math.floor(availableHeight / boardHeight);
      squareSize = Math.max(20, Math.min(120, maxByWidth, maxByHeight));
    } else {
      // Single-column layout: board is centered, use most of viewport width
      const availableWidth = windowWidth - 24 - 32 - 24; // viewport minus coord labels, wrapper padding, margin
      const availableHeight = windowHeight - 200;
      const maxByWidth = Math.floor(availableWidth / boardWidth);
      const maxByHeight = Math.floor(availableHeight / boardHeight);
      squareSize = Math.max(16, Math.min(65, maxByWidth, maxByHeight));
    }

    return (
      <div className={styles["board-with-coords"]}>
        {/* Rank labels (numbers on the left) */}
        <div 
          className={styles["rank-labels"]}
          style={{
            gridTemplateRows: `repeat(${boardHeight}, ${squareSize}px)`
          }}
        >
          {rankLabels}
        </div>
        
        {/* Board */}
        <div className={styles["board-and-files"]}>
          <div 
            ref={boardRef}
            className={styles["game-board"]}
            style={{
              gridTemplateColumns: `repeat(${boardWidth}, ${squareSize}px)`,
              gridTemplateRows: `repeat(${boardHeight}, ${squareSize}px)`,
              position: 'relative',
              width: 'fit-content',
              aspectRatio: 'unset'
            }}
          >
            {squares}
            {rangedAttackSource && rangedMousePos && boardRef.current && (() => {
              const boardRect = boardRef.current.getBoundingClientRect();
              const squareWidth = boardRect.width / boardWidth;
              const squareHeight = boardRect.height / boardHeight;
              // Convert game coords to display coords (account for board flip)
              const displayX = shouldFlipBoard ? (boardWidth - 1 - rangedAttackSource.x) : rangedAttackSource.x;
              const displayY = shouldFlipBoard ? (boardHeight - 1 - rangedAttackSource.y) : rangedAttackSource.y;
              const startX = (displayX + 0.5) * squareWidth;
              const startY = (displayY + 0.5) * squareHeight;
              const endX = rangedMousePos.x - boardRect.left;
              const endY = rangedMousePos.y - boardRect.top;
              return (
                <svg
                  className={styles["ranged-arrow-overlay"]}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                    zIndex: 100
                  }}
                >
                  <defs>
                    <marker
                      id="ranged-arrowhead-live"
                      markerWidth="10"
                      markerHeight="7"
                      refX="9"
                      refY="3.5"
                      orient="auto"
                    >
                      <polygon points="0 0, 10 3.5, 0 7" fill="#ff2222" />
                    </marker>
                  </defs>
                  <line
                    x1={startX}
                    y1={startY}
                    x2={endX}
                    y2={endY}
                    stroke="#ff2222"
                    strokeWidth="3"
                    strokeLinecap="round"
                    markerEnd="url(#ranged-arrowhead-live)"
                    opacity="0.9"
                  />
                </svg>
              );
            })()}
          </div>
          
          {/* File labels (letters at the bottom) */}
          <div 
            className={styles["file-labels"]}
            style={{
              gridTemplateColumns: `repeat(${boardWidth}, ${squareSize}px)`
            }}
          >
            {fileLabels}
          </div>
        </div>
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
  const isPlayer = !!gameState.players?.some((player) => player.id === currentUser?.id);
  const canSpectate = gameState.allowSpectators !== false || isPlayer;
  const gameUrl = `${window.location.origin}/play/${gameId}`;

  if (!canSpectate) {
    return (
      <div className={styles["live-game-container"]}>
        <div className={styles["error-container"]}>
          <h2>Spectating Disabled</h2>
          <p>Spectators are not allowed for this game.</p>
          <div className={styles["action-buttons"]}>
            {!currentUser && (
              <button
                className={`${styles.btn} ${styles["btn-primary"]}`}
                onClick={() => navigate('/login', { state: { message: "Please log in to play or spectate games where allowed." } })}
              >
                Login
              </button>
            )}
            <Link to="/play" className={`${styles.btn} ${styles["btn-secondary"]}`}>
              Back to Lobby
            </Link>
          </div>
        </div>
      </div>
    );
  }

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
        {/* Top Clock Row - Only visible on small screens */}
        <div className={styles["layout-row-top-clock"]}>
          <div className={`
            ${styles["player-clock"]} 
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
        </div>

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
                  ) : !currentUser ? (
                    <>
                      <span><strong>{gameState.hostUsername || 'A player'}</strong> is hosting this game</span>
                      <button
                        className={`${styles.btn} ${styles["btn-primary"]}`}
                        onClick={() => navigate('/login', { state: { message: "Please log in to join live games." } })}
                      >
                        Login to Join
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
                      {formatMoveNotation(move)}
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

      {/* Special Squares Legend Row - below board and clocks */}
      {hasSpecialSquares && (
        <div className={styles["layout-row-legend"]}>
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
          
          {/* Control Square Progress Tracking */}
          {Object.keys(specialSquares.control).length > 0 && gameState.controlSquareTracking && (
            <div className={styles["control-square-progress"]}>
              {Object.entries(specialSquares.control).map(([squareKey, config]) => {
                const tracking = gameState.controlSquareTracking[squareKey];
                const turnsRequired = config.turnsRequired || 1;
                const halfTurnsRequired = turnsRequired * 2;
                const [row, col] = squareKey.split(',').map(Number);
                const squareLabel = `${String.fromCharCode(97 + col)}${row + 1}`;
                
                if (!tracking) return null;
                
                const controllingPlayer = gameState.players?.find(p => 
                  p.position === tracking.playerId || p.id === tracking.playerId
                );
                const turnsControlled = Math.floor(tracking.halfTurns / 2);
                const turnsRemaining = turnsRequired - turnsControlled;
                const progressPercent = Math.min(100, (tracking.halfTurns / halfTurnsRequired) * 100);
                
                return (
                  <div key={squareKey} className={styles["control-progress-item"]}>
                    <div className={styles["control-progress-header"]}>
                      <span className={styles["control-square-label"]}>{squareLabel}</span>
                      <span className={styles["control-player-name"]}>
                        {controllingPlayer?.username || `Player ${tracking.playerId}`}
                      </span>
                    </div>
                    <div className={styles["control-progress-bar-container"]}>
                      <div 
                        className={styles["control-progress-bar"]}
                        style={{ width: `${progressPercent}%` }}
                      />
                      <span className={styles["control-progress-text"]}>
                        {turnsRemaining > 0 ? `${turnsRemaining} turn${turnsRemaining !== 1 ? 's' : ''} to win` : 'Victory!'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Bottom Clock Row - Only visible on small screens */}
      <div className={styles["layout-row-bottom-clock"]}>
        <div className={`
          ${styles["player-clock"]} 
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

      {/* Captured Pieces Row */}
      {(capturedPieces.player1.length > 0 || capturedPieces.player2.length > 0) && (
        <div className={styles["layout-row-captured"]}>
          <div className={styles["captured-pieces-section"]}>
            <div 
              className={styles["captured-header"]}
              onClick={() => setShowCapturedPieces(!showCapturedPieces)}
            >
              <span className={styles["captured-title"]}>Captured Pieces</span>
              <span className={`${styles["captured-toggle"]} ${showCapturedPieces ? styles.expanded : ''}`}>
                ▼
              </span>
            </div>
            {showCapturedPieces && (
              <div className={styles["captured-content"]}>
                {/* Player 1's captures (pieces they took from player 2) */}
                <div className={styles["captured-row"]}>
                  <span className={styles["captured-label"]}>
                    {gameState?.players?.find(p => p.position === 1)?.username || 'White'} captured:
                  </span>
                  <div className={styles["captured-pieces"]}>
                    {capturedPieces.player1.length > 0 ? (
                      capturedPieces.player1.map((piece, index) => {
                        let imgSrc = null;
                        if (piece.image || piece.image_url) {
                          const rawPath = piece.image || piece.image_url;
                          imgSrc = rawPath.startsWith('http') ? rawPath : `${ASSET_URL}${rawPath}`;
                        } else if (piece.image_location) {
                          imgSrc = getPlayerImageUrl(piece.image_location, 2);
                        }
                        return (
                          <div key={`p1-${index}`} className={styles["captured-piece"]} title={piece.piece_name}>
                            {imgSrc ? (
                              <img src={imgSrc} alt={piece.piece_name} />
                            ) : (
                              <span className={styles["piece-symbol"]}>♟</span>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <span className={styles["no-captures"]}>None</span>
                    )}
                  </div>
                </div>
                {/* Player 2's captures (pieces they took from player 1) */}
                <div className={styles["captured-row"]}>
                  <span className={styles["captured-label"]}>
                    {gameState?.players?.find(p => p.position === 2)?.username || 'Black'} captured:
                  </span>
                  <div className={styles["captured-pieces"]}>
                    {capturedPieces.player2.length > 0 ? (
                      capturedPieces.player2.map((piece, index) => {
                        let imgSrc = null;
                        if (piece.image || piece.image_url) {
                          const rawPath = piece.image || piece.image_url;
                          imgSrc = rawPath.startsWith('http') ? rawPath : `${ASSET_URL}${rawPath}`;
                        } else if (piece.image_location) {
                          imgSrc = getPlayerImageUrl(piece.image_location, 1);
                        }
                        return (
                          <div key={`p2-${index}`} className={styles["captured-piece"]} title={piece.piece_name}>
                            {imgSrc ? (
                              <img src={imgSrc} alt={piece.piece_name} />
                            ) : (
                              <span className={styles["piece-symbol"]}>♟</span>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <span className={styles["no-captures"]}>None</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom Row - Move history for medium screens (1000-1200px) */}
      <div className={styles["layout-row-bottom"]}>
        <div className={styles["move-history"]}>
          <h3>Move History</h3>
          <div className={styles["moves-list"]}>
            {(gameState.moveHistory || []).map((move, index) => (
              <div key={index} className={styles["move-row"]}>
                <span className={styles["move-number"]}>{Math.floor(index / 2) + 1}.</span>
                <span className={index % 2 === 0 ? styles["move-white"] : styles["move-black"]}>
                  {formatMoveNotation(move)}
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
                   gameState.startingMode === 'backrow' ? 'Back Row Mirrored (960)' :
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
