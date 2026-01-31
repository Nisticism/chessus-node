import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { useSocket } from "../../contexts/SocketContext";
import styles from "./livegame.module.scss";

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

  // Load game state on mount
  useEffect(() => {
    const loadGame = async () => {
      if (!connected) return;
      
      setLoading(true);
      try {
        const state = await getGameState(parseInt(gameId));
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
        setGameState(prev => ({
          ...prev,
          pieces: newState.pieces,
          currentTurn: newState.currentTurn,
          playerTimes: newState.playerTimes,
          moveHistory: newState.moveHistory
        }));
        setSelectedPiece(null);
        setValidMoves([]);
        // Update check status from move response
        setInCheck(newState.inCheck || false);
        setCheckedPieces(newState.checkedPieces || []);
      }
    });

    const unsubscribeCheck = onGameEvent("check", ({ gameId: checkGameId, playerId, playerPosition, checkedPieces: pieces }) => {
      if (parseInt(checkGameId) === parseInt(gameId)) {
        setInCheck(true);
        setCheckedPieces(pieces || []);
      }
    });

    const unsubscribeGameOver = onGameEvent("gameOver", ({ gameId: overGameId, winner, winnerUsername, reason }) => {
      if (parseInt(overGameId) === parseInt(gameId)) {
        setGameOverData({ winner, winnerUsername, reason });
        setShowGameOver(true);
        setGameState(prev => ({ ...prev, status: 'completed', winner }));
        setInCheck(false);
        setCheckedPieces([]);
      }
    });

    const unsubscribeTimeUpdate = onGameEvent("timeUpdate", ({ gameId: timerGameId, playerTimes, currentTurn }) => {
      if (parseInt(timerGameId) === parseInt(gameId)) {
        setGameState(prev => ({
          ...prev,
          playerTimes,
          currentTurn
        }));
      }
    });

    const unsubscribePlayerJoined = onGameEvent("playerJoined", ({ gameId: joinedGameId, gameState: newState }) => {
      if (parseInt(joinedGameId) === parseInt(gameId)) {
        setGameState(newState);
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
      // Clear error after 3 seconds
      setTimeout(() => setMoveError(null), 3000);
    });

    return () => {
      unsubscribeMove();
      unsubscribeCheck();
      unsubscribeGameOver();
      unsubscribeTimeUpdate();
      unsubscribePlayerJoined();
      unsubscribeGameState();
      unsubscribeError();
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
    
    // Check if it's a knight-like move (no path to check)
    const xDiff = Math.abs(toX - fromX);
    const yDiff = Math.abs(toY - fromY);
    if (xDiff !== yDiff && xDiff !== 0 && yDiff !== 0) {
      // L-shape or other knight-like move - no path checking needed
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

  // Calculate valid moves for a piece using actual piece movement data
  const calculateValidMoves = useCallback((piece, pieces, boardWidth, boardHeight) => {
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
        if (isValidMove && isPathClear(piece.x, piece.y, toX, toY, pieces)) {
          moves.push({
            x: toX,
            y: toY,
            isCapture
          });
        }
      }
    }

    console.log('Valid moves found:', moves.length, moves);
    return moves;
  }, [canPieceMoveTo, canPieceCaptureTo, isPathClear]);

  // Check if a specific piece is under attack by any enemy piece
  const isPieceUnderAttack = useCallback((targetPiece, pieces, boardWidth, boardHeight) => {
    const targetTeam = targetPiece.player_id || targetPiece.team;
    
    // Check all enemy pieces
    for (const enemyPiece of pieces) {
      const enemyTeam = enemyPiece.player_id || enemyPiece.team;
      if (enemyTeam === targetTeam) continue; // Skip friendly pieces
      
      // Check if enemy can capture the target piece
      if (canPieceCaptureTo(enemyPiece.x, enemyPiece.y, targetPiece.x, targetPiece.y, enemyPiece, enemyTeam)) {
        if (isPathClear(enemyPiece.x, enemyPiece.y, targetPiece.x, targetPiece.y, pieces)) {
          return true;
        }
      }
    }
    return false;
  }, [canPieceCaptureTo, isPathClear]);

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

    // In preview mode, allow selecting any piece to see its moves
    // In game mode, only allow selecting own pieces when it's your turn
    if (clickedPiece && (isPreviewMode || (isOwnPiece && isMyTurn))) {
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
    } else {
      console.log('Cannot make move:', { hasSelectedPiece: !!selectedPiece, isMyTurn, status: gameState?.status });
      // Clicking elsewhere, deselect
      setSelectedPiece(null);
      setValidMoves([]);
    }
  }, [isMyTurn, gameState, currentPlayer, selectedPiece, validMoves, calculateValidMoves, makeMove, gameId]);

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
    
    // Only allow dragging own pieces during your turn (ready or active status)
    const canDrag = isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready');
    if (!canDrag) {
      console.log('Drag prevented: not your turn or game not ready/active');
      e.preventDefault();
      return;
    }
    
    const pieceTeam = piece.player_id || piece.team;
    console.log('Piece team:', pieceTeam, 'Current player position:', currentPlayer?.position);
    
    if (currentPlayer && pieceTeam !== currentPlayer.position) {
      console.log('Drag prevented: not your piece');
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
    
    const canDrop = draggedPiece && isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready');
    if (!canDrop) {
      console.log('Drop prevented: conditions not met');
      setDraggedPiece(null);
      setDragValidMoves([]);
      return;
    }

    // Check if target is a valid move
    const validMove = dragValidMoves.find(m => m.x === targetX && m.y === targetY);
    console.log('Valid move found:', validMove);
    
    if (validMove) {
      console.log('Making move:', { from: { x: draggedPiece.x, y: draggedPiece.y }, to: { x: targetX, y: targetY } });
      makeMove(parseInt(gameId), {
        from: { x: draggedPiece.x, y: draggedPiece.y },
        to: { x: targetX, y: targetY },
        pieceId: draggedPiece.id
      });
    }

    setSelectedPiece(null);
    setValidMoves([]);
    setDraggedPiece(null);
    setDragValidMoves([]);
  }, [draggedPiece, dragValidMoves, isMyTurn, gameState, makeMove, gameId]);

  // Handle right-click to move selected piece
  const handleSquareRightClick = useCallback((e, x, y) => {
    e.preventDefault();
    
    console.log('Right-click:', { x, y, selectedPiece: selectedPiece?.piece_name, isMyTurn, status: gameState?.status });
    
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
      console.log('Right-click move not allowed:', { hasSelectedPiece: !!selectedPiece, isMyTurn, status: gameState?.status });
    }
  }, [selectedPiece, validMoves, isMyTurn, gameState, makeMove, gameId]);

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

        squares.push(
          <div
            key={`${displayX}-${displayY}`}
            className={`
              ${styles["board-square"]}
              ${isLight ? styles.light : styles.dark}
              ${isSelected ? styles.selected : ''}
              ${validMove && !validMove.isCapture ? styles["valid-move"] : ''}
              ${validMove && validMove.isCapture ? styles["valid-capture"] : ''}
              ${hoveredMove && !hoveredMove.isCapture ? styles["hover-move"] : ''}
              ${hoveredMove && hoveredMove.isCapture ? styles["hover-capture"] : ''}
              ${isLastMove ? styles["last-move"] : ''}
              ${canMove ? styles["can-move"] : ''}
              ${isInCheck ? styles["in-check"] : ''}
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
            {piece && (
              <div 
                className={styles.piece}
                draggable={isMyTurn && (gameState?.status === 'active' || gameState?.status === 'ready') && (piece.player_id || piece.team) === currentPlayer?.position}
                onDragStart={(e) => handleDragStart(e, piece)}
                onDragEnd={handleDragEnd}
                onMouseEnter={() => showHelpers && handlePieceHover(piece)}
                onMouseLeave={() => showHelpers && handlePieceHover(null)}
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
            )}
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
        <div className={styles["header-actions"]}>
          <Link to="/play" className={`${styles.btn} ${styles["btn-secondary"]} ${styles["btn-small"]}`}>
            Back to Lobby
          </Link>
        </div>
      </div>

      <div className={styles["game-layout"]}>
        {/* Players Panel */}
        <div className={styles["players-panel"]}>
          {/* Player 1 */}
          <div className={`
            ${styles["player-card"]} 
            ${gameState.currentTurn === 1 && gameState.status === 'active' ? styles["current-turn"] : ''}
            ${gameState.winner === player1?.id ? styles.winner : ''}
          `}>
            <div className={styles["player-header"]}>
              <span className={styles["player-position"]}>Player 1</span>
              <span className={`${styles["player-indicator"]} ${gameState.currentTurn === 1 && gameState.status === 'active' ? styles.active : ''}`}></span>
            </div>
            <div className={`${styles["player-name"]} ${player1?.id === currentUser?.id ? styles.you : ''}`}>
              {player1?.username || 'Waiting...'}
              {player1?.id === currentUser?.id && ' (You)'}
            </div>
            {gameState.timeControl && (
              <div className={styles["player-time"]}>
                <div className={`${styles["time-value"]} ${gameState.playerTimes?.[player1?.id] < 60 ? styles["low-time"] : ''}`}>
                  {formatTime(gameState.playerTimes?.[player1?.id])}
                </div>
                <div className={styles["time-label"]}>Time</div>
              </div>
            )}
          </div>

          {/* Player 2 */}
          <div className={`
            ${styles["player-card"]} 
            ${gameState.currentTurn === 2 && gameState.status === 'active' ? styles["current-turn"] : ''}
            ${gameState.winner === player2?.id ? styles.winner : ''}
          `}>
            <div className={styles["player-header"]}>
              <span className={styles["player-position"]}>Player 2</span>
              <span className={`${styles["player-indicator"]} ${gameState.currentTurn === 2 && gameState.status === 'active' ? styles.active : ''}`}></span>
            </div>
            <div className={`${styles["player-name"]} ${player2?.id === currentUser?.id ? styles.you : ''}`}>
              {player2?.username || 'Waiting...'}
              {player2?.id === currentUser?.id && ' (You)'}
            </div>
            {gameState.timeControl && (
              <div className={styles["player-time"]}>
                <div className={`${styles["time-value"]} ${gameState.playerTimes?.[player2?.id] < 60 ? styles["low-time"] : ''}`}>
                  {formatTime(gameState.playerTimes?.[player2?.id])}
                </div>
                <div className={styles["time-label"]}>Time</div>
              </div>
            )}
          </div>
        </div>

        {/* Board Panel */}
        <div className={styles["board-panel"]}>
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
          
          {currentPlayer && (gameState.status === 'active' || gameState.status === 'ready') && (
            <div className={styles["turn-indicator"]}>
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
        </div>

        {/* Info Panel */}
        <div className={styles["info-panel"]}>
          {/* Move History */}
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
          </div>

          {/* Game Controls */}
          {currentPlayer && (gameState.status === 'active' || gameState.status === 'ready') && (
            <div className={styles["game-controls"]}>
              <h3>Actions</h3>
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
  );
};

export default LiveGame;
