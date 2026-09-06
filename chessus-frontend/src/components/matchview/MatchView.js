import React, { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { useSelector } from "react-redux";
import axios from "axios";
import styles from "./matchview.module.scss";
import API_URL from "../../global/global";
import { colToFile, rowToRank, formatMoveNotation, replayToMove, doesPieceOccupySquare } from "../../helpers/pieceMovementUtils";
import { canCreatePuzzles } from "../../helpers/supporterTiers";
import {
  createMoveEngine,
  getMoveDotType,
  MOVE_DOT_BACKGROUNDS,
  describeBoardIndicators,
} from "../../helpers/moveEngine";
import BoardLegend from "../common/BoardLegend";
import authHeader from "../../services/auth-header";
import { applySvgStretchBackground } from "../../helpers/svgStretchUtils";
import { parseServerDate } from "../../helpers/date-formatter";
import { handlePieceImageError } from "../../utils/pieceFallback";
import { totalMaterialValue } from "../../utils/pieceValueEstimator";
import useBoardViewport from "../common/useBoardViewport";
import BoardZoomControls from "../common/BoardZoomControls";
import boardVp from "../common/boardViewport.module.scss";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "";

const MatchView = () => {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user: currentUser } = useSelector((state) => state.authReducer);

  // Optional viewer hint: when navigated from a player profile, show that player on the bottom.
  const viewerUserId = useMemo(() => {
    try {
      const v = new URLSearchParams(location.search).get('viewerUserId');
      return v ? parseInt(v, 10) : null;
    } catch {
      return null;
    }
  }, [location.search]);
  
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatIsPrivate, setChatIsPrivate] = useState(false);
  const [reviewMoveIndex, setReviewMoveIndex] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Movement helpers: the game type row carries the rules (special squares,
  // mate condition) the move engine needs to reproduce the live board's
  // highlights. It is fetched separately because /api/match returns only
  // presentational game-type fields.
  const [gameType, setGameType] = useState(null);
  const [hoveredPiece, setHoveredPiece] = useState(null);
  const [hoveredMoves, setHoveredMoves] = useState([]);
  const [legendOpen, setLegendOpen] = useState(false);
  const [hideIllegalMoves, setHideIllegalMoves] = useState(false);

  // Fit-to-container sizing + zoom for the replay board.
  const boardVpHook = useBoardViewport({
    boardWidth: match?.boardWidth,
    boardHeight: match?.boardHeight,
    insetW: 28,
    insetH: 24,
  });

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    fetchMatch();
    fetchChatHistory();
  }, [gameId]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Keyboard navigation for review mode
  // Index semantics:
  //   null = final position (after last move)
  //   -1   = starting position (before any moves), no row highlighted
  //   0..N = position after move at that index, that row highlighted
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (reviewMoveIndex === null || !match?.moveHistory) return;
      const totalMoves = match.moveHistory.length;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setReviewMoveIndex(prev => prev > -1 ? prev - 1 : prev);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setReviewMoveIndex(prev => prev < totalMoves - 1 ? prev + 1 : null);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setReviewMoveIndex(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [reviewMoveIndex, match?.moveHistory]);

  // Load the full game type once the match tells us which one it is.
  useEffect(() => {
    if (!match?.gameTypeId) return;
    let cancelled = false;
    axios.get(`${API_URL}games/${match.gameTypeId}`)
      .then(res => { if (!cancelled) setGameType(res.data); })
      .catch(() => { /* movement helpers are optional — board still renders */ });
    return () => { cancelled = true; };
  }, [match?.gameTypeId]);

  // Special squares drive range boosts, restriction zones and custom-square
  // rules. Parsed the same way LiveGame parses them off the game state.
  const specialSquares = useMemo(() => {
    const squares = { range: {}, promotion: {}, control: {}, special: {} };
    if (!gameType) return squares;
    const fields = {
      range: 'range_squares_string',
      promotion: 'promotion_squares_string',
      control: 'control_squares_string',
      special: 'special_squares_string',
    };
    for (const [key, field] of Object.entries(fields)) {
      try {
        if (gameType[field]) squares[key] = JSON.parse(gameType[field]);
      } catch (e) {
        console.error(`Error parsing ${field}:`, e);
      }
    }
    return squares;
  }, [gameType]);

  // currentPlayerPosition is null so the engine skips its own
  // leave-yourself-in-check filter — hovering any piece shows raw reachability,
  // exactly what a spectator sees in a live game. The "legal moves only" toggle
  // applies that filter afterwards, per hovered piece.
  const moveEngine = useMemo(() => createMoveEngine({
    specialSquares,
    gameType,
    enPassantTarget: null,
    currentPlayerPosition: null,
  }), [specialSquares, gameType]);

  const fetchChatHistory = async () => {
    try {
      const response = await axios.get(`${API_URL}games/${gameId}/chat`, { headers: authHeader() });
      setChatHistory(response.data.messages || []);
      setChatIsPrivate(!!response.data.chatIsPrivate);
    } catch (err) {
      // Chat history is optional, don't show error
    }
  };

  const fetchMatch = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`${API_URL}match/${gameId}`);
      setMatch(response.data);
    } catch (err) {
      console.error("Error fetching match:", err);
      setError(err.response?.data?.message || "Failed to load match");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    const date = parseServerDate(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDuration = (startTime, endTime) => {
    if (!startTime || !endTime) return "N/A";
    const start = parseServerDate(startTime);
    const end = parseServerDate(endTime);
    const diffMs = end - start;
    const diffMins = Math.floor(diffMs / 60000);
    const diffSecs = Math.floor((diffMs % 60000) / 1000);
    return `${diffMins}m ${diffSecs}s`;
  };

  const formatTimeControl = (seconds, increment) => {
    if (!seconds) return "Unlimited";
    const minutes = Math.floor(seconds / 60);
    if (increment) {
      return `${minutes}+${increment}`;
    }
    return `${minutes} minutes`;
  };

  const getReasonText = (reason) => {
    switch (reason) {
      case 'capture': return 'All pieces captured';
      case 'checkmate': return 'Checkmate';
      case 'resignation': return 'Resignation';
      case 'timeout': return 'Time ran out';
      case 'disconnect': return 'Opponent disconnected';
      case 'stalemate': return 'Stalemate';
      case 'promotion': return 'Promotion';
      case 'piece_count': return 'Piece count';
      case 'draw_move_limit': return 'Move limit';
      case 'repetition': return 'Repetition';
      case 'agreement': return 'Agreement';
      case 'equal_piece_count': return 'Equal piece count';
      case 'no_moves': return 'No legal moves';
      case 'no_legal_moves': return 'No legal moves';
      case 'control': return 'Square control';
      case 'elimination': return 'Elimination';
      case 'insufficient_material': return 'Insufficient material';
      case 'lose_all_pieces': return 'Anti-chess (lost all pieces)';
      case 'stalemate_win': return 'Stalemate win';
      case 'initial_position': return 'Initial position (no rating change)';
      case 'cancellation_draw': return 'Cancellation threshold (draw)';
      case 'simultaneous_capture_draw': return 'Simultaneous capture (draw)';
      case 'simultaneous_checkmate_draw': return 'Simultaneous checkmate (draw)';
      case 'points_win': return 'Points';
      case 'score': return 'Highest score';
      case 'score_draw': return 'Equal score (draw)';
      case 'passes_draw': return 'Both players passed (draw)';
      case 'draw_points_tie': return 'Points tie (draw)';
      case 'draw_equal_points_at_turn': return 'Equal points at turn limit (draw)';
      case 'draw_equal_points_consecutive': return 'Equal points — consecutive turns (draw)';
      case 'illegal_move_limit': return 'Illegal-move limit reached';
      default: return 'Game completed';
    }
  };

  const getResultForPlayer = (playerId) => {
    if (!match) return 'unknown';
    if (!match.winnerId) return 'draw';
    return match.winnerId === playerId ? 'win' : 'loss';
  };

  // Derive captured pieces from move history (same logic as LiveGame)
  const capturedPieces = useMemo(() => {
    if (!match?.moveHistory) return { player1: [], player2: [] };
    const result = { player1: [], player2: [] };
    match.moveHistory.forEach(move => {
      if (!move.captured && !move.allCaptured) return;
      const captures = move.allCaptured && move.allCaptured.length > 1
        ? move.allCaptured
        : [move.captured];
      const validCaptures = captures.filter(Boolean);
      const taggedCaptures = validCaptures.map(p => {
        // Ally capture: the captured piece belongs to the same player who moved
        const isAlly = p && (p.player_id === move.position || p.team === move.position);
        return isAlly ? { ...p, _isAllyCapture: true } : p;
      });
      if (move.position === 1) result.player1.push(...taggedCaptures);
      else if (move.position === 2) result.player2.push(...taggedCaptures);
    });
    return result;
  }, [match?.moveHistory]);

  const capturedValues = useMemo(() => {
    if (!match) return { player1: 0, player2: 0 };
    const bw = match.boardWidth  || 8;
    const bh = match.boardHeight || 8;
    const p1Normal       = capturedPieces.player1.filter(p => !p._isAllyCapture);
    const p2Normal       = capturedPieces.player2.filter(p => !p._isAllyCapture);
    const p1SelfCaptures = capturedPieces.player1.filter(p =>  p._isAllyCapture);
    const p2SelfCaptures = capturedPieces.player2.filter(p =>  p._isAllyCapture);
    const p1Val = totalMaterialValue(p1Normal,       bw, bh, null)
                + totalMaterialValue(p2SelfCaptures, bw, bh, null);
    const p2Val = totalMaterialValue(p2Normal,       bw, bh, null)
                + totalMaterialValue(p1SelfCaptures, bw, bh, null);
    return {
      player1: Math.round(p1Val * 10) / 10,
      player2: Math.round(p2Val * 10) / 10,
    };
  }, [capturedPieces, match?.boardWidth, match?.boardHeight]);

  // Pieces currently on the board: the replayed position while reviewing,
  // otherwise the final position. Memoised so the hover handler and the board
  // renderer always agree on the same piece objects.
  // reviewMoveIndex === -1 means starting position (no moves applied).
  const displayedPieces = useMemo(() => {
    if (!match) return [];
    const isReviewing = reviewMoveIndex !== null && match.initialPieces;
    if (!isReviewing) return Array.isArray(match.pieces) ? match.pieces : [];
    if (reviewMoveIndex < 0) {
      return Array.isArray(match.initialPieces) ? JSON.parse(JSON.stringify(match.initialPieces)) : [];
    }
    return replayToMove(match.initialPieces, match.moveHistory, reviewMoveIndex);
  }, [match, reviewMoveIndex]);

  // Which indicator rows the legend needs. Derived from every piece the match
  // ever had, not just the position on screen, so an item doesn't vanish from
  // the legend the moment the only ranged piece gets captured.
  const boardIndicators = useMemo(() => describeBoardIndicators([
    ...(Array.isArray(match?.initialPieces) ? match.initialPieces : []),
    ...(Array.isArray(match?.pieces) ? match.pieces : []),
  ]), [match?.initialPieces, match?.pieces]);

  // The filter is only offered when this board actually has rules that can make
  // a reachable square illegal — a piece whose loss ends the game, a piece that
  // can't be captured or must be checkmated, or impassable / restriction-zone
  // squares. A plain points or elimination game has nothing for it to hide.
  const canHideIllegalMoves = useMemo(
    () => moveEngine.hasIllegalMoveRules(displayedPieces),
    [moveEngine, displayedPieces]
  );

  // Hovering a piece highlights everywhere it can move and attack, using the
  // same engine the live board uses.
  //   forHoverDisplay — splits each square into move / attack / both, and
  //                     includes every reachable ranged square, not just
  //                     occupied targets
  //   forFog          — also surfaces squares the capture pattern covers while
  //                     empty (a pawn's diagonals), which is what makes this a
  //                     threat map rather than just a move list. Paths are still
  //                     checked, unlike premove display.
  //   permissive      — on by default: dots describe the hovered piece itself,
  //                     so a square stays lit even when something else makes it
  //                     illegal (an uncapturable target, the enemy checkmate
  //                     piece, a restriction zone). "Hide illegal moves" turns
  //                     this off and applies the board's rules instead.
  const handlePieceHover = (piece) => {
    if (!piece) {
      setHoveredPiece(null);
      setHoveredMoves([]);
      return;
    }
    const boardWidth = match?.boardWidth || 8;
    const boardHeight = match?.boardHeight || 8;
    let moves = moveEngine.calculateValidMoves(
      piece,
      displayedPieces,
      boardWidth,
      boardHeight,
      true,               // skipCheckFilter — the filter below handles legality
      false,              // forPremove
      true,               // forHoverDisplay
      true,               // forFog
      !hideIllegalMoves   // permissive
    );
    if (hideIllegalMoves) {
      const team = piece.player_id || piece.team;
      moves = moves.filter(m => {
        // Ranged attacks and attack-coverage squares (ones the capture pattern
        // reaches but the movement pattern doesn't) never relocate the piece, so
        // neither board-square rules nor self-loss can make them illegal.
        if (m.isRangedAttack || !m.reachedByMove) return true;
        if (!moveEngine.isSquareLegalDestination(piece, m.x, m.y)) return false;
        return !moveEngine.wouldMoveLoseTheGame(
          piece, m.x, m.y, displayedPieces, team, boardWidth, boardHeight
        );
      });
    }
    setHoveredPiece(piece);
    setHoveredMoves(moves);
  };

  // Stepping through the replay invalidates the hovered piece's position.
  useEffect(() => {
    setHoveredPiece(null);
    setHoveredMoves([]);
  }, [reviewMoveIndex]);

  const renderBoard = () => {
    if (!match || !match.pieces) return null;

    const boardWidth = match.boardWidth || 8;
    const boardHeight = match.boardHeight || 8;
    const squareSize = boardVpHook.squareSize;
    if (!squareSize) return null;
    const squares = [];

    // Flip the board so the current user's (or profile owner's) side is at the bottom
    const userPlayer = currentUser && match.players?.find(p => p.id === currentUser.id);
    const viewerPlayer = viewerUserId ? match.players?.find(p => p.id === viewerUserId) : null;
    const orientPlayer = userPlayer || viewerPlayer;
    const shouldFlip = orientPlayer?.position === 2;

    const isReviewing = reviewMoveIndex !== null && match.initialPieces;
    const pieces = displayedPieces;
    const lastMove = isReviewing && reviewMoveIndex >= 0 ? match.moveHistory[reviewMoveIndex] : null;

    const hpw = hoveredPiece?.piece_width || 1;
    const hph = hoveredPiece?.piece_height || 1;

    // Splash zone around every square the hovered piece can capture on.
    const attackRadiusSplashSquares = new Set();
    if (hoveredPiece && (hoveredPiece.attack_radius || 0) > 0 && hoveredMoves.length > 0) {
      const radius = hoveredPiece.attack_radius;
      for (const target of hoveredMoves.filter(m => m.isCapture || m.isRangedAttack)) {
        for (let sr = target.y - radius; sr <= target.y + radius; sr++) {
          for (let sc = target.x - radius; sc <= target.x + radius; sc++) {
            if (sr < 0 || sr >= boardHeight || sc < 0 || sc >= boardWidth) continue;
            if (sr === target.y && sc === target.x) continue;
            attackRadiusSplashSquares.add(`${sc},${sr}`);
          }
        }
      }
    }

    for (let displayY = 0; displayY < boardHeight; displayY++) {
      for (let displayX = 0; displayX < boardWidth; displayX++) {
        // Convert display coordinates to game coordinates (matches LiveGame toGameCoords)
        const x = shouldFlip ? (boardWidth - 1 - displayX) : displayX;
        const y = shouldFlip ? (boardHeight - 1 - displayY) : displayY;
        // Multi-tile aware: find piece whose footprint covers this square
        const piece = pieces.find(p => {
          if (!p || p.captured) return false;
          const pw = p.piece_width || 1;
          const ph = p.piece_height || 1;
          return x >= p.x && x < p.x + pw && y >= p.y && y < p.y + ph;
        });
        const isAnchor = piece && piece.x === x && piece.y === y;
        const isLight = (x + y) % 2 === 0;
        const isLastMoveFrom = lastMove && lastMove.from && lastMove.from.x === x && lastMove.from.y === y;
        const isLastMoveTo = lastMove && lastMove.to && lastMove.to.x === x && lastMove.to.y === y;

        // Directional arrow on last-move "from" square (skip for ranged attacks and same-square moves)
        const arrowAngleDeg = (isLastMoveFrom && lastMove && !lastMove.isRangedAttack && lastMove.type !== 'ranged' && !(lastMove.from.x === lastMove.to?.x && lastMove.from.y === lastMove.to?.y)) ? (() => {
          const dx = shouldFlip ? (lastMove.from.x - lastMove.to.x) : (lastMove.to.x - lastMove.from.x);
          const dy = shouldFlip ? (lastMove.from.y - lastMove.to.y) : (lastMove.to.y - lastMove.from.y);
          return Math.atan2(dy, dx) * 180 / Math.PI;
        })() : null;

        // ── Hover movement helpers ───────────────────────────────────────
        // A multi-tile piece covers hpw × hph squares from its destination
        // anchor, so a destination lights up every square its footprint lands on.
        const inHoveredFootprint = hoveredPiece && doesPieceOccupySquare(hoveredPiece, x, y);
        const hoveredRegularMove = hoveredPiece && !inHoveredFootprint
          ? hoveredMoves.find(m => !m.isRangedAttack &&
              x >= m.x && x < m.x + hpw && y >= m.y && y < m.y + hph)
          : null;
        const hoveredRangedMove = hoveredPiece
          ? hoveredMoves.find(m => m.x === x && m.y === y && m.isRangedAttack)
          : null;
        const isHoverViaForDcMove = !!hoveredPiece && hoveredMoves.some(
          m => m.isDirectionChange && m.via && m.via.x === x && m.via.y === y && !m.isCapture
        );
        const isHoverViaForDcCapture = !!hoveredPiece && hoveredMoves.some(
          m => m.isDirectionChange && m.via && m.via.x === x && m.via.y === y && !!m.isCapture
        );
        const dotType = getMoveDotType(hoveredRegularMove);
        const isHoverSource = !!inHoveredFootprint;

        squares.push(
          <div
            key={`${x}-${y}`}
            className={`${styles["board-square"]} ${isLight ? styles["light"] : styles["dark"]}${isLastMoveFrom ? ` ${isLight ? styles["last-move-from-light"] : styles["last-move-from-dark"]}` : ''}${isLastMoveTo ? ` ${styles["last-move-to"]}` : ''}${dotType ? ` ${styles["has-move-dot"]}` : ''}${hoveredRangedMove ? ` ${styles["has-ranged-dot"]}` : ''}${attackRadiusSplashSquares.has(`${x},${y}`) ? ` ${styles["hover-attack-radius"]}` : ''}${isHoverViaForDcMove ? ` ${styles["hover-dc-via-move"]}` : ''}${isHoverViaForDcCapture ? ` ${styles["hover-dc-via-capture"]}` : ''}${isHoverSource ? ` ${styles["hover-source"]}` : ''}`}
            style={{
              position: 'relative',
              ...(dotType ? { '--move-dot-bg': MOVE_DOT_BACKGROUNDS[dotType] } : {}),
              ...(isAnchor && ((piece?.piece_width || 1) > 1 || (piece?.piece_height || 1) > 1) ? { zIndex: 10 } : undefined),
            }}
          >
            {hoveredRangedMove && <span className={styles["ranged-icon"]}>{'💥'}</span>}
            {arrowAngleDeg !== null && (
              <svg
                className={styles["last-move-arrow"]}
                style={{ transform: `rotate(${arrowAngleDeg}deg)` }}
                viewBox="0 0 30 12"
                xmlns="http://www.w3.org/2000/svg"
              >
                <line x1="2" y1="6" x2="22" y2="6" stroke={isLight ? 'rgba(120,100,60,0.75)' : 'rgba(200,180,120,0.7)'} strokeWidth="3.5" strokeLinecap="round" />
                <polygon points="22,1.5 30,6 22,10.5" fill={isLight ? 'rgba(120,100,60,0.75)' : 'rgba(200,180,120,0.7)'} />
              </svg>
            )}
            {isAnchor && (() => {
              const pw = piece.piece_width || 1;
              const ph = piece.piece_height || 1;
              const isMultiTile = pw > 1 || ph > 1;
              const isNonSquareMultiTile = isMultiTile && pw !== ph;
              const multiTileStyle = isMultiTile ? {
                width: `${pw * 100}%`,
                height: `${ph * 100}%`,
                zIndex: 5,
                position: 'absolute',
                top: 0,
                left: 0
              } : {};
              const pieceImageUrl = (piece.image || piece.image_url) ? 
                ((piece.image || piece.image_url).startsWith('http') ? (piece.image || piece.image_url) : `${ASSET_URL}${piece.image || piece.image_url}`) : null;
              return (
              <div
                className={`${styles["piece"]} ${piece.player_id === 1 || piece.team === 1 ? styles["player1"] : styles["player2"]}${gameType ? ` ${styles["hoverable"]}` : ''}`}
                style={multiTileStyle}
                onMouseEnter={() => gameType && handlePieceHover(piece)}
                onMouseLeave={() => gameType && handlePieceHover(null)}
              >
                {pieceImageUrl ? (
                  isNonSquareMultiTile ? (
                    <div
                      ref={(el) => applySvgStretchBackground(el, pieceImageUrl)}
                      style={{
                        width: '100%',
                        height: '100%',
                      }}
                    />
                  ) : (
                    <img 
                      src={pieceImageUrl}
                      alt={piece.piece_name || piece.name || "Piece"}
                      className={styles["piece-image"]}
                      draggable={false}
                      onError={(e) => handlePieceImageError(e, piece.piece_name || piece.name, piece.player_id || piece.team)}
                    />
                  )
                ) : (
                  <span className={styles["piece-symbol"]}>
                    {(piece.player_id === 1 || piece.team === 1) ? '♙' : '♟'}
                  </span>
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
      const fileIndex = shouldFlip ? (boardWidth - 1 - i) : i;
      fileLabels.push(
        <div key={`file-${i}`} className={styles["file-label"]}>
          {colToFile(fileIndex)}
        </div>
      );
    }

    // Generate rank labels (1, 2, 3, ... for rows)
    const rankLabels = [];
    for (let i = 0; i < boardHeight; i++) {
      const rankIndex = shouldFlip ? i : (boardHeight - 1 - i);
      rankLabels.push(
        <div key={`rank-${i}`} className={styles["rank-label"]}>
          {rowToRank(rankIndex)}
        </div>
      );
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
        
        {/* Board and file labels */}
        <div className={styles["board-and-files"]}>
          <div 
            className={styles["game-board"]}
            style={{
              gridTemplateColumns: `repeat(${boardWidth}, ${squareSize}px)`,
              gridTemplateRows: `repeat(${boardHeight}, ${squareSize}px)`,
              width: 'fit-content',
              maxWidth: 'none',
              aspectRatio: 'unset',
              // Set once here and inherited by every square, so indicators that
              // can't use percentages (emoji, offsets) still scale with the board.
              '--square-size': `${squareSize}px`
            }}
          >
            {squares}
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

  if (loading) {
    return (
      <div className={styles["match-view-container"]}>
        <div className={styles["loading"]}>Loading match...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles["match-view-container"]}>
        <div className={styles["error-container"]}>
          <h2>Error</h2>
          <p>{error}</p>
          <Link to="/play/games" className={styles["back-link"]}>Back to Lobby</Link>
        </div>
      </div>
    );
  }

  if (!match) {
    return (
      <div className={styles["match-view-container"]}>
        <div className={styles["error-container"]}>
          <h2>Match Not Found</h2>
          <p>This match doesn't exist.</p>
          <Link to="/play/games" className={styles["back-link"]}>Back to Lobby</Link>
        </div>
      </div>
    );
  }

  const player1 = match.players?.find(p => p.position === 1);
  const player2 = match.players?.find(p => p.position === 2);
  const winner = match.players?.find(p => p.id === match.winnerId);
  const isUserInGame = currentUser && match.players?.some(p => p.id === currentUser.id);
  const userResult = isUserInGame ? getResultForPlayer(currentUser.id) : null;

  // Player 1 is always shown on the left (first card); player 2 on the right.
  // Board orientation is separate and still uses the viewer hint.

  const renderPlayerCard = (player, position) => {
    const isWinner = match.winnerId === player?.id;
    const colorIcon = position === 1 ? '♔' : '♚';
    const colorClass = position === 1 ? styles["white-piece"] : styles["black-piece"];
    return (
      <div className={`${styles["player-card"]} ${isWinner ? styles["winner"] : ""}`}>
        {isWinner && (
          <div className={styles["winner-badge"]}>👑</div>
        )}
        <div className={styles["player-avatar"]}>
          {player?.id === 'bot' ? (
            <span>🤖</span>
          ) : player?.profilePicture ? (
            <img src={`${ASSET_URL}${player.profilePicture}`} alt={player.username} />
          ) : (
            <span>{player?.username?.charAt(0).toUpperCase() || "?"}</span>
          )}
        </div>
        <div className={styles["player-info"]}>
          {player?.id === 'bot' ? (
            <span className={styles["player-name"]}>{player?.username || "Computer"}</span>
          ) : player?.id == null ? (
            <span className={styles["player-name"]}>{player?.username || "Guest"}</span>
          ) : (
            <Link to={`/profile/${player?.username}`} className={styles["player-name"]}>
              {player?.username || "Guest"}
            </Link>
          )}
          {player?.id !== 'bot' && player?.elo && (
            <span className={styles["player-elo"]}>ELO: {player.elo}</span>
          )}
          {player?.id !== 'bot' && match.eloChanges && player && (
            <span className={`${styles["elo-change"]} ${isWinner ? styles["positive"] : styles["negative"]}`}>
              {isWinner
                ? `+${match.eloChanges.winner?.change || 0}`
                : `${match.eloChanges.loser?.change || 0}`}
            </span>
          )}
        </div>
        <span className={`${styles["player-color-badge"]} ${colorClass}`} title={`Player ${position}`}>
          {colorIcon}
        </span>
      </div>
    );
  };

  return (
    <div className={styles["match-view-container"]}>
      {/* Result Banner */}
      <div className={`${styles["result-banner"]} ${styles[userResult || 'neutral']}`}>
        {userResult === 'win' && (
          <>
            <h1>🎉 Victory!</h1>
            <p>You won by {getReasonText(match.reason).toLowerCase()}</p>
          </>
        )}
        {userResult === 'loss' && (
          <>
            <h1>Defeat</h1>
            <p>{winner?.username || 'Opponent'} won by {getReasonText(match.reason).toLowerCase()}</p>
          </>
        )}
        {userResult === 'draw' && (
          <>
            <h1>Draw</h1>
            <p>
              {match.reason && match.reason !== 'unknown'
                ? `The game ended in a draw — ${getReasonText(match.reason).toLowerCase()}`
                : 'The game ended in a draw'}
            </p>
          </>
        )}
        {!isUserInGame && (
          <>
            <h1>Game Complete</h1>
            <p>{winner ? `${winner.username} won by ${getReasonText(match.reason).toLowerCase()}` : 'The game ended in a draw'}</p>
          </>
        )}
        {match.finalScores && (match.finalScores[1] != null || match.finalScores[2] != null) && (
          <p className={styles["result-score"]}>
            Final score — {player1?.username || 'Player 1'}: {match.finalScores[1] ?? 0} · {player2?.username || 'Player 2'}: {match.finalScores[2] ?? 0}
          </p>
        )}
        {match.gameTypeId && (
          <Link
            to={`/games/${match.gameTypeId}`}
            className={styles["banner-game-type-link"]}
          >
            {match.gameTypeName || 'View Game Type'}
          </Link>
        )}
        {/* Finished games are where the good puzzles are, and the position is
            already on screen - so hand it straight to the builder instead of
            making someone rebuild it square by square. Only offered to accounts
            that can actually build one. */}
        {match.gameTypeId && canCreatePuzzles(currentUser) && (
          <button
            type="button"
            className={styles["banner-game-type-link"]}
            onClick={() => navigate(`/games/${match.gameTypeId}/puzzles/new`, {
              state: {
                fromMatch: {
                  matchId: match.id ?? gameId,
                  pieces: displayedPieces,
                  // The move that produced this position, replayed in the
                  // solver as the opening animation.
                  setupMove: (reviewMoveIndex !== null && reviewMoveIndex >= 0)
                    ? match.moveHistory?.[reviewMoveIndex]
                    : (match.moveHistory?.length ? match.moveHistory[match.moveHistory.length - 1] : null),
                },
              },
            })}
          >
            🧩 Create puzzle from this position
          </button>
        )}
      </div>

      <div className={styles["match-content"]}>
        {/* Players Panel — player 1 always on the left */}
        <div className={styles["players-panel"]}>
          {renderPlayerCard(player1, 1)}
          <div className={styles["vs-divider"]}>VS</div>
          {renderPlayerCard(player2, 2)}
        </div>

        {/* Board */}
        <div className={styles["board-container"]}>
          <h3 className={styles["board-title"]}>
            {reviewMoveIndex === null
              ? 'Final Position'
              : reviewMoveIndex < 0
                ? 'Starting Position'
                : `Move ${reviewMoveIndex + 1} of ${match.moveHistory?.length || 0}`}
          </h3>
          {match.moveHistory && match.moveHistory.length > 0 && (
            <div className={styles["review-controls"]}>
              <button onClick={() => setReviewMoveIndex(-1)} disabled={reviewMoveIndex === -1}>⏮</button>
              <button
                onClick={() => setReviewMoveIndex(prev => prev === null ? Math.max(-1, match.moveHistory.length - 2) : Math.max(-1, prev - 1))}
                disabled={reviewMoveIndex === -1}
              >◀</button>
              <button
                onClick={() => setReviewMoveIndex(prev => {
                  const total = match.moveHistory.length;
                  if (prev === null) return null;
                  return prev < total - 1 ? prev + 1 : null;
                })}
                disabled={reviewMoveIndex === null}
              >▶</button>
              <button onClick={() => setReviewMoveIndex(null)} disabled={reviewMoveIndex === null}>⏭ Final</button>
            </div>
          )}
          <div style={boardVpHook.frameStyle}>
            <div
              className={`${boardVp.viewport} ${boardVpHook.hideScrollbars ? boardVp.noScrollbars : ''}`}
              ref={boardVpHook.viewportRef}
              style={boardVpHook.viewportStyle}
            >
              <div style={boardVpHook.contentStyle}>
                {renderBoard()}
              </div>
            </div>
            <BoardZoomControls {...boardVpHook.controlProps} />
          </div>

          {/* Movement helpers legend — only useful once the game type (and so
              the movement rules) has loaded. */}
          {gameType && (
            <div className={styles["legend-section"]}>
              <p className={styles["legend-hint"]}>
                Hover over a piece to see where it can move and attack
              </p>
              <h3 className={styles["collapsible-header"]} onClick={() => setLegendOpen(prev => !prev)}>
                <span className={`${styles["collapse-arrow"]} ${legendOpen ? styles["open"] : ''}`}>▼</span>
                Legend
              </h3>
              {legendOpen && (
                <div className={styles["legend-body"]}>
                  <BoardLegend
                    showMove={false}
                    showFirstMove={false}
                    showAttack={false}
                    showFirstAttack={false}
                    showRanged={false}
                    showHopCapture={false}
                    showDots
                    showDotCastle={boardIndicators.castle}
                    showDotRanged={boardIndicators.ranged}
                    showDotAttackRadius={boardIndicators.attackRadius}
                    showDotDCVia={boardIndicators.dcVia}
                    specialSquares={{
                      promotion: Object.keys(specialSquares.promotion).length > 0,
                      range: Object.keys(specialSquares.range).length > 0,
                      control: Object.keys(specialSquares.control).length > 0,
                      special: Object.keys(specialSquares.special).length > 0,
                    }}
                  />
                  {canHideIllegalMoves && (
                    <>
                      <div className={styles["legend-toggle-row"]}>
                        <label className={styles["legend-toggle"]}>
                          <input
                            type="checkbox"
                            checked={hideIllegalMoves}
                            onChange={(e) => {
                              setHideIllegalMoves(e.target.checked);
                              handlePieceHover(null);
                            }}
                          />
                          Hide illegal moves
                        </label>
                      </div>
                      <p className={styles["legend-toggle-note"]}>
                        Off (default): what the hovered piece itself can reach, so a square
                        stays lit even if something else makes it illegal. On: applies the
                        board&apos;s rules too — targets that can&apos;t be captured, pieces that
                        must be checkmated rather than taken, impassable and restriction-zone
                        squares, and moves that would leave that side&apos;s game-losing piece
                        capturable.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Captured Pieces */}
        {(capturedPieces.player1.length > 0 || capturedPieces.player2.length > 0) && (
          <div className={styles["captured-section"]}>
            <h3 className={styles["captured-section-title"]}>Captured Pieces</h3>
            {[
              { key: 'p1', label: (match.players?.find(p => p.position === 1)?.username || 'White') + ' captured', pieces: capturedPieces.player1, myVal: capturedValues.player1, oppVal: capturedValues.player2 },
              { key: 'p2', label: (match.players?.find(p => p.position === 2)?.username || 'Black') + ' captured', pieces: capturedPieces.player2, myVal: capturedValues.player2, oppVal: capturedValues.player1 },
            ].map(({ key, label, pieces: rowPieces, myVal, oppVal }) => (
              <div key={key} className={styles["captured-row"]}>
                <span className={styles["captured-label"]}>
                  {label}:
                  {rowPieces.length > 0 && (
                    <span className={styles["captured-value"]}>
                      {' '}≈{myVal}
                      {myVal > oppVal && (
                        <span className={styles["material-advantage"]}> (+{Math.round((myVal - oppVal) * 10) / 10})</span>
                      )}
                    </span>
                  )}
                </span>
                <div className={styles["captured-pieces"]}>
                  {rowPieces.length > 0 ? rowPieces.map((piece, idx) => {
                    const imgSrc = (piece?.image || piece?.image_url)
                      ? ((piece.image || piece.image_url).startsWith('http') ? (piece.image || piece.image_url) : `${ASSET_URL}${piece.image || piece.image_url}`)
                      : null;
                    return (
                      <div key={idx} className={`${styles["captured-piece"]}${piece._isAllyCapture ? ` ${styles["ally-capture"]}` : ''}`} title={piece?.piece_name}>
                        {imgSrc ? (
                          <img src={imgSrc} alt={piece?.piece_name} onError={(e) => handlePieceImageError(e, piece?.piece_name, piece?.player_id)} />
                        ) : (
                          <span className={styles["piece-symbol"]}>{(piece?.player_id === 1 || piece?.team === 1) ? '♙' : '♟'}</span>
                        )}
                      </div>
                    );
                  }) : <span className={styles["no-captures"]}>None</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Game Details */}
        <div className={styles["game-details"]}>
          <h3 className={styles["collapsible-header"]} onClick={() => setDetailsOpen(prev => !prev)}>
            <span className={`${styles["collapse-arrow"]} ${detailsOpen ? styles["open"] : ''}`}>▼</span>
            Game Details
          </h3>
          {detailsOpen && <div className={styles["details-grid"]}>
            <div className={styles["detail-item"]}>
              <span className={styles["detail-label"]}>Game Type</span>
              <span className={styles["detail-value"]}>{match.gameTypeName || "Custom Game"}</span>
            </div>
            <div className={styles["detail-item"]}>
              <span className={styles["detail-label"]}>Time Control</span>
              <span className={styles["detail-value"]}>
                {match.settings?.isCorrespondence
                  ? `${match.settings.correspondenceDays || 1} day${(match.settings.correspondenceDays || 1) !== 1 ? 's' : ''}/move`
                  : formatTimeControl(match.timeControl, match.increment)}
              </span>
            </div>
            <div className={styles["detail-item"]}>
              <span className={styles["detail-label"]}>Result</span>
              <span className={styles["detail-value"]}>{getReasonText(match.reason)}</span>
            </div>
            <div className={styles["detail-item"]}>
              <span className={styles["detail-label"]}>Moves Played</span>
              <span className={styles["detail-value"]}>{match.moveHistory?.length || 0}</span>
            </div>
            <div className={styles["detail-item"]}>
              <span className={styles["detail-label"]}>Date</span>
              <span className={styles["detail-value"]}>{formatDate(match.endTime)}</span>
            </div>
            <div className={styles["detail-item"]}>
              <span className={styles["detail-label"]}>Duration</span>
              <span className={styles["detail-value"]}>{formatDuration(match.startTime, match.endTime)}</span>
            </div>
          </div>}
        </div>

        {/* Game Settings */}
        {match.settings && (
          <div className={styles["game-details"]}>
            <h3 className={styles["collapsible-header"]} onClick={() => setSettingsOpen(prev => !prev)}>
              <span className={`${styles["collapse-arrow"]} ${settingsOpen ? styles["open"] : ''}`}>▼</span>
              Game Settings
            </h3>
            {settingsOpen && <div className={styles["settings-grid"]}>
              <div className={styles["setting-item"]}>
                <span className={styles["setting-label"]}>Rated</span>
                <span className={`${styles["setting-value"]} ${match.settings.rated ? styles["setting-on"] : styles["setting-off"]}`}>
                  {match.settings.rated ? "Yes" : "No"}
                </span>
              </div>
              <div className={styles["setting-item"]}>
                <span className={styles["setting-label"]}>Premoves</span>
                <span className={`${styles["setting-value"]} ${match.settings.allowPremoves ? styles["setting-on"] : styles["setting-off"]}`}>
                  {match.settings.allowPremoves ? "Allowed" : "Disabled"}
                </span>
              </div>
              {match.settings.allowPremoves && match.settings.premoveTimeCost > 0 && (
                <div className={styles["setting-item"]}>
                  <span className={styles["setting-label"]}>Premove Clock Cost</span>
                  <span className={styles["setting-value"]}>{match.settings.premoveTimeCost}s per premove</span>
                </div>
              )}
              <div className={styles["setting-item"]}>
                <span className={styles["setting-label"]}>Spectators</span>
                <span className={`${styles["setting-value"]} ${match.settings.allowSpectators ? styles["setting-on"] : styles["setting-off"]}`}>
                  {match.settings.allowSpectators ? "Allowed" : "Disabled"}
                </span>
              </div>
              <div className={styles["setting-item"]}>
                <span className={styles["setting-label"]}>Movement Helpers</span>
                <span className={`${styles["setting-value"]} ${match.settings.showPieceHelpers ? styles["setting-on"] : styles["setting-off"]}`}>
                  {match.settings.showPieceHelpers ? "On" : "Off"}
                </span>
              </div>
              <div className={styles["setting-item"]}>
                <span className={styles["setting-label"]}>Starting Positions</span>
                <span className={styles["setting-value"]}>
                  {{
                    'none': 'Fixed',
                    'backrow': 'Back Row Random',
                    'mirrored': 'Mirrored Random',
                    'independent': 'Independent Random',
                    'shared': 'Shared Random'
                  }[match.settings.startingMode] || 'Fixed'}
                </span>
              </div>
              {match.settings.materialClockPenalty && (
                <div className={styles["setting-item"]}>
                  <span className={styles["setting-label"]}>Material Clock Penalty</span>
                  <span className={`${styles["setting-value"]} ${styles["setting-on"]}`}>On</span>
                </div>
              )}
              {match.settings.materialClockHandicap && (
                <div className={styles["setting-item"]}>
                  <span className={styles["setting-label"]}>Material Clock Handicap</span>
                  <span className={`${styles["setting-value"]} ${styles["setting-on"]}`}>On</span>
                </div>
              )}
              {match.settings.isBotGame && (
                <div className={styles["setting-item"]}>
                  <span className={styles["setting-label"]}>Opponent</span>
                  <span className={styles["setting-value"]}>
                    {match.settings.botDifficulty === 'stockfish'
                      ? (() => {
                          const lvl = match.settings.botStockfishLevel;
                          const lvlLabels = { 1: 'Beginner', 2: 'Casual', 3: 'Skilled', 4: 'Expert', 5: 'Maximum' };
                          return lvl != null ? `Fairy Stockfish (${lvlLabels[lvl] || 'Level ' + lvl})` : 'Fairy Stockfish';
                        })()
                      : `Computer (${match.settings.botDifficulty ? match.settings.botDifficulty.charAt(0).toUpperCase() + match.settings.botDifficulty.slice(1) : 'Medium'})`
                    }
                  </span>
                </div>
              )}
              {match.settings.isCorrespondence && (
                <div className={styles["setting-item"]}>
                  <span className={styles["setting-label"]}>Correspondence</span>
                  <span className={styles["setting-value"]}>{match.settings.correspondenceDays || 1} day{match.settings.correspondenceDays !== 1 ? 's' : ''} per move</span>
                </div>
              )}
            </div>}
          </div>
        )}

        {/* Move History (optional, can be expanded later) */}
        {match.moveHistory && match.moveHistory.length > 0 && (
          <div className={styles["move-history"]}>
            <h3>Move History</h3>
            {match.initialPieces && (
              <div className={styles["review-controls"]}>
                <button onClick={() => setReviewMoveIndex(-1)} disabled={reviewMoveIndex === -1} title="Starting position">⏮</button>
                <button onClick={() => setReviewMoveIndex(prev => prev === null ? match.moveHistory.length - 1 : Math.max(-1, prev - 1))} disabled={reviewMoveIndex === -1} title="Previous move">◀</button>
                <button onClick={() => setReviewMoveIndex(prev => prev !== null && prev < match.moveHistory.length - 1 ? prev + 1 : null)} disabled={reviewMoveIndex === null} title="Next move">▶</button>
                <button onClick={() => setReviewMoveIndex(null)} disabled={reviewMoveIndex === null} title="Final position">⏭</button>
              </div>
            )}
            <div className={styles["moves-list"]}>
              {(() => {
                const moves = match.moveHistory;
                const bh = match.boardHeight || 8;
                const canReview = !!match.initialPieces;
                // Group consecutive same-position moves into half-turns so that
                // multi-action turns, chain captures, and must-move pieces all
                // appear in the correct player column.
                const halfTurns = [];
                let htIdx = 0;
                while (htIdx < moves.length) {
                  const pos = moves[htIdx]?.position;
                  const group = [];
                  while (htIdx < moves.length && moves[htIdx]?.position === pos) {
                    group.push({ move: moves[htIdx], origIndex: htIdx });
                    htIdx++;
                  }
                  halfTurns.push({ position: pos, moves: group });
                }
                const rows = [];
                for (let r = 0; r < halfTurns.length; r += 2) {
                  const htA = halfTurns[r];
                  const htB = halfTurns[r + 1] || null;
                  const p1HT = htA?.position === 1 ? htA : htB;
                  const p2HT = htA?.position === 2 ? htA : htB;
                  const rowNum = Math.floor(r / 2) + 1;
                  const renderHT = (ht, colStyle) => {
                    if (!ht) return <span key="empty" className={`${styles["move-item"]} ${styles[colStyle]}`} />;
                    return (
                      <span key={ht.moves[0].origIndex} className={`${styles["move-item"]} ${styles[colStyle]}`}>
                        {ht.moves.map((m, mi) => (
                          <React.Fragment key={m.origIndex}>
                            {mi > 0 && <span style={{ color: '#666', margin: '0 2px' }}>/</span>}
                            <span
                              className={reviewMoveIndex === m.origIndex ? styles["active-move"] : undefined}
                              onClick={() => canReview && setReviewMoveIndex(reviewMoveIndex === m.origIndex ? null : m.origIndex)}
                              style={{ cursor: canReview ? 'pointer' : 'default' }}
                            >{formatMoveNotation(m.move, true, bh)}</span>
                          </React.Fragment>
                        ))}
                      </span>
                    );
                  };
                  rows.push(
                    <div key={r} className={styles["move-row"]}>
                      <span className={styles["move-number"]}>{rowNum}.</span>
                      {renderHT(p1HT, "move-white")}
                      {renderHT(p2HT, "move-black")}
                    </div>
                  );
                }
                return rows;
              })()}
            </div>
          </div>
        )}

        {/* Chat History */}
        {chatHistory.length > 0 ? (
          <div className={styles["chat-history"]}>
            <h3>Game Chat</h3>
            <div className={styles["chat-history-list"]}>
              {chatHistory.map((msg, idx) => (
                <div key={msg.id || idx} className={styles["chat-history-msg"]}>
                  <span className={styles["chat-history-sender"]}>{msg.sender_username}:</span>
                  <span className={styles["chat-history-text"]}>{msg.content}</span>
                  <span className={styles["chat-history-time"]}>
                    {parseServerDate(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : chatIsPrivate && isUserInGame && !currentUser ? (
          <div className={styles["chat-history"]}>
            <h3>Game Chat</h3>
            <p className={styles["chat-private-note"]}>Log in to view this private game chat.</p>
          </div>
        ) : null}

        {/* Actions */}
        <div className={styles["actions"]}>
          <button 
            className={styles["action-btn"]}
            onClick={() => navigate(-1)}
          >
            ← Back
          </button>
          <Link to="/play/games" className={styles["action-btn-primary"]}>
            Play Again
          </Link>
        </div>
      </div>
    </div>
  );
};

export default MatchView;
