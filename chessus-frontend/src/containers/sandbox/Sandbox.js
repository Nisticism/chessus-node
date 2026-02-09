import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import { getGames, getGameById } from "../../actions/games";
import PiecesService from "../../services/pieces.service";
import PieceSelector from "../../components/gamewizard/PieceSelector";
import { canRangedAttackTo } from "../../helpers/pieceMovementUtils";
import styles from "./sandbox.module.scss";
import { isMobileDevice, isTouchDevice } from "../../helpers/mobileUtils";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";
const MAX_SANDBOXES = 4;

// Special square type definitions
const SPECIAL_SQUARE_TYPES = {
  range: { name: 'Range Square', color: '#ff8c00' },
  promotion: { name: 'Promotion Square', color: '#4b0082' },
  control: { name: 'Control Square', color: '#32CD32' },
  custom: { name: 'Custom Square', color: '#ffd700' }
};

const Sandbox = () => {
  const dispatch = useDispatch();
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const { gamesList } = useSelector((state) => state.games);
  
  // Full pieces with movement data (loaded directly from API)
  const [fullPiecesList, setFullPiecesList] = useState([]);
  const [piecesLoading, setPiecesLoading] = useState(true);
  
  // Load game types on mount
  useEffect(() => {
    dispatch(getGames());
  }, [dispatch]);

  // Load full pieces with movement data
  useEffect(() => {
    const loadPieces = async () => {
      setPiecesLoading(true);
      try {
        const response = await PiecesService.getPiecesWithMovement();
        console.log('Loaded pieces with movement:', response.data?.length, 'pieces');
        if (response.data?.length > 0) {
          console.log('Sample piece data:', response.data[0]);
        }
        setFullPiecesList(response.data || []);
      } catch (err) {
        console.error('Failed to load pieces with movement:', err);
        // Fallback: try loading regular pieces
        try {
          const fallbackResponse = await PiecesService.getPieces();
          console.log('Fallback: Loaded regular pieces:', fallbackResponse.data?.length);
          setFullPiecesList(fallbackResponse.data || []);
        } catch (fallbackErr) {
          console.error('Fallback also failed:', fallbackErr);
          setFullPiecesList([]);
        }
      } finally {
        setPiecesLoading(false);
      }
    };
    loadPieces();
  }, []);

  // State for multiple sandboxes
  const [sandboxes, setSandboxes] = useState([]);
  const [activeSandboxId, setActiveSandboxId] = useState(null);
  
  // UI state
  const [selectedPiece, setSelectedPiece] = useState(null);
  const [validMoves, setValidMoves] = useState([]);
  const [hoveredPiece, setHoveredPiece] = useState(null);
  const [hoveredMoves, setHoveredMoves] = useState([]);
  const [showGameTypes, setShowGameTypes] = useState(true);
  const [showPieceLibrary, setShowPieceLibrary] = useState(true);
  const [searchGameTerm, setSearchGameTerm] = useState("");
  const [searchPieceTerm, setSearchPieceTerm] = useState("");
  const [showHighlights, setShowHighlights] = useState(true);
  
  // Initialize sidebarPlayerView from localStorage
  const getInitialSidebarPlayerView = () => {
    const saved = localStorage.getItem('sandboxSidebarPlayerView');
    return saved ? parseInt(saved) : 1;
  };
  const [sidebarPlayerView, setSidebarPlayerView] = useState(getInitialSidebarPlayerView());
  
  // Save sidebarPlayerView to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('sandboxSidebarPlayerView', sidebarPlayerView.toString());
  }, [sidebarPlayerView]);
  
  // Right-click modal state
  const [showRightClickModal, setShowRightClickModal] = useState(false);
  const [rightClickPosition, setRightClickPosition] = useState(null);
  const [rightClickMode, setRightClickMode] = useState('piece'); // 'piece' or 'special'
  const [isMobile, setIsMobile] = useState(false);
  const longPressTimeoutRef = useRef(null);
  
  // Ranged attack state
  const [rangedAttackSource, setRangedAttackSource] = useState(null); // piece being right-click-dragged
  const [rangedMousePos, setRangedMousePos] = useState(null); // current mouse position for arrow
  const [rangedTargetSquare, setRangedTargetSquare] = useState(null); // square under cursor
  const boardRef = useRef(null);
  const rightClickDataRef = useRef(null); // tracks right-click start for click-vs-drag detection
  const [isRightClickActive, setIsRightClickActive] = useState(false);

  // Detect if on mobile device
  useEffect(() => {
    setIsMobile(isMobileDevice());
  }, []);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('chessus-sandboxes');
    console.log('Loading sandboxes from localStorage:', saved);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        console.log('Parsed sandboxes:', parsed, 'Length:', parsed?.length);
        if (Array.isArray(parsed)) {
          setSandboxes(parsed.slice(0, MAX_SANDBOXES));
          if (parsed.length > 0) {
            setActiveSandboxId(parsed[0].id);
          }
        } else {
          console.warn('Saved sandboxes is not an array, resetting');
          localStorage.removeItem('chessus-sandboxes');
        }
      } catch (e) {
        console.error('Failed to load sandboxes:', e);
        localStorage.removeItem('chessus-sandboxes');
      }
    }
  }, []);

  // Save to localStorage whenever sandboxes change
  useEffect(() => {
    if (sandboxes.length > 0) {
      localStorage.setItem('chessus-sandboxes', JSON.stringify(sandboxes.slice(0, MAX_SANDBOXES)));
    } else {
      localStorage.removeItem('chessus-sandboxes');
    }
  }, [sandboxes]);

  // Get active sandbox
  const activeSandbox = useMemo(() => {
    return sandboxes.find(s => s.id === activeSandboxId);
  }, [sandboxes, activeSandboxId]);

  // Get the last move for highlighting
  const lastMove = useMemo(() => {
    if (!activeSandbox?.moveHistory?.length) return null;
    return activeSandbox.moveHistory[activeSandbox.moveHistory.length - 1];
  }, [activeSandbox]);

  // Generate unique sandbox name
  const getNextSandboxName = useCallback(() => {
    const existingNumbers = sandboxes
      .map(s => {
        const match = s.name.match(/^Sandbox (\d+)$/);
        return match ? parseInt(match[1]) : 0;
      })
      .filter(n => n > 0);
    
    let nextNumber = 1;
    while (existingNumbers.includes(nextNumber)) {
      nextNumber++;
    }
    return `Sandbox ${nextNumber}`;
  }, [sandboxes]);

  // Create a new blank sandbox
  const createBlankSandbox = useCallback(() => {
    if (sandboxes.length >= MAX_SANDBOXES) {
      alert(`Maximum of ${MAX_SANDBOXES} sandboxes allowed. Please close one to create a new one.`);
      return;
    }
    
    const newSandbox = {
      id: Date.now(),
      name: getNextSandboxName(),
      gameType: { board_width: 8, board_height: 8, game_name: "Blank Board" },
      pieces: [],
      specialSquares: {},
      currentTurn: 1,
      moveHistory: []
    };
    setSandboxes(prev => [...prev, newSandbox]);
    setActiveSandboxId(newSandbox.id);
  }, [sandboxes.length, getNextSandboxName]);

  // Helper to get full piece data by ID
  const getFullPieceData = useCallback((pieceId) => {
    // Try multiple ID formats
    const numId = parseInt(pieceId);
    return fullPiecesList.find(p => 
      p.id === pieceId || 
      p.piece_id === pieceId ||
      p.id === numId ||
      p.piece_id === numId
    );
  }, [fullPiecesList]);

  // Helper to normalize piece data from database to frontend-expected format
  const normalizePieceData = useCallback((dbPiece) => {
    if (!dbPiece) return null;
    return {
      ...dbPiece,
      // Movement properties - map DB column names to what movement logic expects
      ratio_movement_1: dbPiece.ratio_movement_1 || dbPiece.ratio_one_movement,
      ratio_movement_2: dbPiece.ratio_movement_2 || dbPiece.ratio_two_movement,
      step_movement_style: dbPiece.step_movement_style || dbPiece.step_by_step_movement_style,
      step_movement_value: dbPiece.step_movement_value || dbPiece.step_by_step_movement_value,
      // Capture properties - map DB column names
      ratio_capture_1: dbPiece.ratio_capture_1 || dbPiece.ratio_one_capture,
      ratio_capture_2: dbPiece.ratio_capture_2 || dbPiece.ratio_two_capture,
      step_capture_value: dbPiece.step_capture_value || dbPiece.step_by_step_capture,
      // Ranged attack properties - normalize field names
      step_by_step_attack_range: dbPiece.step_by_step_attack_range || dbPiece.step_by_step_attack_value,
    };
  }, []);

  // Load a game type into a new sandbox - fetch full piece data
  const loadGameType = useCallback(async (gameType) => {
    if (sandboxes.length >= MAX_SANDBOXES) {
      alert(`Maximum of ${MAX_SANDBOXES} sandboxes allowed. Please close one to create a new one.`);
      return;
    }
    
    console.log('Loading game type:', gameType.game_name);
    
    // Fetch fresh game data from the server (includes junction table pieces)
    let freshGameData = gameType;
    try {
      freshGameData = await dispatch(getGameById(gameType.id));
      console.log('Fetched fresh game data:', freshGameData);
    } catch (err) {
      console.warn('Failed to fetch fresh game data, using cached:', err);
    }
    
    // The field is called pieces_string in the database, not piece_layout
    const pieceLayoutRaw = freshGameData.pieces_string || freshGameData.piece_layout;
    console.log('Piece layout raw:', pieceLayoutRaw);
    console.log('Available pieces in library:', fullPiecesList.length);
    
    const boardHeight = freshGameData.board_height || gameType.board_height || 8;
    
    let pieces = [];
    if (pieceLayoutRaw) {
      try {
        const parsedLayout = JSON.parse(pieceLayoutRaw);
        console.log('Parsed layout:', parsedLayout);
        
        // Convert to array format - handle both object {"row,col": {...}} and array [{...}] formats
        let layout;
        if (Array.isArray(parsedLayout)) {
          layout = parsedLayout;
        } else if (typeof parsedLayout === 'object') {
          // Convert object format to array, extracting coordinates from keys
          layout = Object.entries(parsedLayout).map(([key, pieceData]) => {
            const [row, col] = key.split(',').map(Number);
            return {
              ...pieceData,
              x: col,
              y: row
            };
          });
        } else {
          layout = [];
        }
        
        console.log('Converted layout to array:', layout);
        
        // Enrich each piece with full movement data
        pieces = await Promise.all(layout.map(async (p, index) => {
          const pieceId = p.piece_id || p.id;
          console.log(`Processing piece ${index}:`, { pieceId, raw: p });
          
          // Try to find in our cached full pieces first
          let fullPiece = getFullPieceData(pieceId);
          console.log(`Found in cache for piece ${pieceId}:`, fullPiece ? 'yes' : 'no');
          
          // If not found, fetch it individually
          if (!fullPiece && pieceId) {
            try {
              const response = await PiecesService.getPieceById(pieceId);
              fullPiece = response.data;
              console.log(`Fetched piece ${pieceId} from API:`, fullPiece);
            } catch (err) {
              console.error('Failed to fetch piece:', pieceId, err);
            }
          }
          
          // Normalize piece data to ensure movement/capture properties are accessible
          const normalizedPiece = normalizePieceData(fullPiece);
          
          // Get position and player ID (support both player_id and player_number)
          const posY = p.y ?? p.row ?? p.yLocation ?? 0;
          const playerId = p.player_id || p.player_number || p.player || p.team || 1;
          
          // Don't flip Y - render pieces in same orientation as GameTypeView
          // pieces_string stores positions exactly as placed in game wizard
          
          const resultPiece = {
            ...normalizedPiece,
            ...p,
            // Re-apply normalized movement after spreading p (p may override with stale/empty values)
            ratio_movement_1: normalizedPiece?.ratio_movement_1,
            ratio_movement_2: normalizedPiece?.ratio_movement_2,
            step_movement_style: normalizedPiece?.step_movement_style,
            step_movement_value: normalizedPiece?.step_movement_value,
            ratio_capture_1: normalizedPiece?.ratio_capture_1,
            ratio_capture_2: normalizedPiece?.ratio_capture_2,
            step_capture_value: normalizedPiece?.step_capture_value,
            // Re-apply ranged attack data after spreading p
            can_capture_enemy_via_range: normalizedPiece?.can_capture_enemy_via_range,
            up_attack_range: normalizedPiece?.up_attack_range,
            down_attack_range: normalizedPiece?.down_attack_range,
            left_attack_range: normalizedPiece?.left_attack_range,
            right_attack_range: normalizedPiece?.right_attack_range,
            up_left_attack_range: normalizedPiece?.up_left_attack_range,
            up_right_attack_range: normalizedPiece?.up_right_attack_range,
            down_left_attack_range: normalizedPiece?.down_left_attack_range,
            down_right_attack_range: normalizedPiece?.down_right_attack_range,
            up_attack_range_exact: normalizedPiece?.up_attack_range_exact,
            down_attack_range_exact: normalizedPiece?.down_attack_range_exact,
            left_attack_range_exact: normalizedPiece?.left_attack_range_exact,
            right_attack_range_exact: normalizedPiece?.right_attack_range_exact,
            up_left_attack_range_exact: normalizedPiece?.up_left_attack_range_exact,
            up_right_attack_range_exact: normalizedPiece?.up_right_attack_range_exact,
            down_left_attack_range_exact: normalizedPiece?.down_left_attack_range_exact,
            down_right_attack_range_exact: normalizedPiece?.down_right_attack_range_exact,
            ratio_one_attack_range: normalizedPiece?.ratio_one_attack_range,
            ratio_two_attack_range: normalizedPiece?.ratio_two_attack_range,
            step_by_step_attack_range: normalizedPiece?.step_by_step_attack_range || normalizedPiece?.step_by_step_attack_value,
            max_piece_captures_per_ranged_attack: normalizedPiece?.max_piece_captures_per_ranged_attack,
            id: `piece-${Date.now()}-${index}`,
            piece_id: pieceId,
            x: p.x ?? p.col ?? p.xLocation ?? 0,
            y: posY,
            team: playerId,
            player_id: playerId
          };
          
          console.log(`Result piece ${index}:`, resultPiece);
          return resultPiece;
        }));
      } catch (e) {
        console.error('Failed to parse piece layout:', e);
      }
    }
    
    console.log('Final pieces array:', pieces);
    
    const newSandbox = {
      id: Date.now(),
      name: freshGameData.game_name || gameType.game_name,
      gameType: freshGameData,
      pieces: pieces,
      specialSquares: {},
      currentTurn: 1,
      moveHistory: []
    };
    setSandboxes(prev => [...prev, newSandbox]);
    setActiveSandboxId(newSandbox.id);
  }, [sandboxes.length, getFullPieceData, normalizePieceData, dispatch]);

  // Delete a sandbox and relabel remaining ones
  const deleteSandbox = useCallback((sandboxId) => {
    setSandboxes(prev => {
      const filtered = prev.filter(s => s.id !== sandboxId);
      const relabeled = filtered.map((s, index) => {
        if (s.name.match(/^Sandbox \d+$/)) {
          return { ...s, name: `Sandbox ${index + 1}` };
        }
        return s;
      });
      
      if (activeSandboxId === sandboxId) {
        if (relabeled.length > 0) {
          setTimeout(() => setActiveSandboxId(relabeled[0].id), 0);
        } else {
          setTimeout(() => setActiveSandboxId(null), 0);
        }
      }
      
      return relabeled;
    });
  }, [activeSandboxId]);

  // Add a piece from library to the board
  const addPieceToBoard = useCallback((pieceData, x, y, playerId = null) => {
    if (!activeSandbox) return;
    
    const targetPlayer = playerId || sidebarPlayerView;
    
    const newPiece = {
      id: `piece-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      piece_id: pieceData.piece_id || pieceData.id,
      piece_name: pieceData.piece_name,
      image_location: pieceData.image_location,
      image_url: pieceData.image_url,
      x: x,
      y: y,
      team: targetPlayer,
      player_id: targetPlayer,
      // Copy ALL movement/capture properties
      directional_movement_style: pieceData.directional_movement_style,
      up_movement: pieceData.up_movement,
      down_movement: pieceData.down_movement,
      left_movement: pieceData.left_movement,
      right_movement: pieceData.right_movement,
      up_left_movement: pieceData.up_left_movement,
      up_right_movement: pieceData.up_right_movement,
      down_left_movement: pieceData.down_left_movement,
      down_right_movement: pieceData.down_right_movement,
      ratio_movement_style: pieceData.ratio_movement_style,
      ratio_movement_1: pieceData.ratio_movement_1 || pieceData.ratio_one_movement,
      ratio_movement_2: pieceData.ratio_movement_2 || pieceData.ratio_two_movement,
      step_movement_style: pieceData.step_movement_style || pieceData.step_by_step_movement_style,
      step_movement_value: pieceData.step_movement_value || pieceData.step_by_step_movement_value,
      can_hop_over_allies: pieceData.can_hop_over_allies,
      can_hop_over_enemies: pieceData.can_hop_over_enemies,
      can_capture_enemy_on_move: pieceData.can_capture_enemy_on_move,
      up_capture: pieceData.up_capture,
      down_capture: pieceData.down_capture,
      left_capture: pieceData.left_capture,
      right_capture: pieceData.right_capture,
      up_left_capture: pieceData.up_left_capture,
      up_right_capture: pieceData.up_right_capture,
      down_left_capture: pieceData.down_left_capture,
      down_right_capture: pieceData.down_right_capture,
      ratio_capture_1: pieceData.ratio_capture_1,
      ratio_capture_2: pieceData.ratio_capture_2,
      step_capture_value: pieceData.step_capture_value,
      // Copy special scenario data (additional/first-move movements and captures)
      special_scenario_moves: pieceData.special_scenario_moves,
      special_scenario_captures: pieceData.special_scenario_captures,
      // Copy castling/promotion data
      can_castle: pieceData.can_castle,
      can_promote: pieceData.can_promote,
      promotion_options: pieceData.promotion_options,
      // Copy ranged attack data
      can_capture_enemy_via_range: pieceData.can_capture_enemy_via_range,
      up_attack_range: pieceData.up_attack_range,
      down_attack_range: pieceData.down_attack_range,
      left_attack_range: pieceData.left_attack_range,
      right_attack_range: pieceData.right_attack_range,
      up_left_attack_range: pieceData.up_left_attack_range,
      up_right_attack_range: pieceData.up_right_attack_range,
      down_left_attack_range: pieceData.down_left_attack_range,
      down_right_attack_range: pieceData.down_right_attack_range,
      up_attack_range_exact: pieceData.up_attack_range_exact,
      down_attack_range_exact: pieceData.down_attack_range_exact,
      left_attack_range_exact: pieceData.left_attack_range_exact,
      right_attack_range_exact: pieceData.right_attack_range_exact,
      up_left_attack_range_exact: pieceData.up_left_attack_range_exact,
      up_right_attack_range_exact: pieceData.up_right_attack_range_exact,
      down_left_attack_range_exact: pieceData.down_left_attack_range_exact,
      down_right_attack_range_exact: pieceData.down_right_attack_range_exact,
      ratio_one_attack_range: pieceData.ratio_one_attack_range,
      ratio_two_attack_range: pieceData.ratio_two_attack_range,
      step_by_step_attack_range: pieceData.step_by_step_attack_range || pieceData.step_by_step_attack_value,
      max_piece_captures_per_ranged_attack: pieceData.max_piece_captures_per_ranged_attack,
    };

    setSandboxes(prev => prev.map(s => 
      s.id === activeSandboxId 
        ? { ...s, pieces: [...s.pieces.filter(p => !(p.x === x && p.y === y)), newPiece] }
        : s
    ));
  }, [activeSandbox, activeSandboxId, sidebarPlayerView]);

  // Remove a piece from the board
  const removePieceFromBoard = useCallback((pieceId) => {
    if (!activeSandbox) return;
    
    setSandboxes(prev => prev.map(s =>
      s.id === activeSandboxId
        ? { ...s, pieces: s.pieces.filter(p => p.id !== pieceId) }
        : s
    ));
    setSelectedPiece(null);
    setValidMoves([]);
  }, [activeSandbox, activeSandboxId]);

  // Mirror pieces from one player to the other
  const handleMirrorPieces = useCallback((sourcePlayerId, targetPlayerId) => {
    if (!activeSandbox) return;

    const boardHeight = activeSandbox.gameType.board_height || 8;
    const pieces = activeSandbox.pieces || [];

    const sourcePieces = pieces.filter(p => p.player_id === sourcePlayerId || p.team === sourcePlayerId);

    if (sourcePieces.length === 0) {
      alert(`Player ${sourcePlayerId} has no pieces to mirror.`);
      return;
    }

    const targetPieceCount = pieces.filter(p => p.player_id === targetPlayerId || p.team === targetPlayerId).length;

    if (targetPieceCount > 0) {
      if (!window.confirm(
        `Player ${targetPlayerId} already has ${targetPieceCount} piece(s). These will be replaced with mirrored pieces from Player ${sourcePlayerId}. Continue?`
      )) {
        return;
      }
    }

    // Remove all target player pieces
    let newPieces = pieces.filter(p => p.player_id !== targetPlayerId && p.team !== targetPlayerId);

    // Build a set of source piece positions for conflict detection
    const sourcePositions = new Set(sourcePieces.map(p => `${p.x},${p.y}`));

    let skipped = 0;
    sourcePieces.forEach(p => {
      const mirroredY = boardHeight - 1 - p.y;
      const mirroredPosKey = `${p.x},${mirroredY}`;

      // Don't overwrite source player's own pieces at the mirrored position
      if (sourcePositions.has(mirroredPosKey)) {
        skipped++;
        return;
      }

      newPieces = newPieces.filter(existing => !(existing.x === p.x && existing.y === mirroredY));

      newPieces.push({
        ...p,
        id: `piece-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        y: mirroredY,
        team: targetPlayerId,
        player_id: targetPlayerId,
      });
    });

    setSandboxes(prev => prev.map(s =>
      s.id === activeSandboxId
        ? { ...s, pieces: newPieces }
        : s
    ));

    if (skipped > 0) {
      alert(`${skipped} piece(s) could not be mirrored because they would overlap with Player ${sourcePlayerId}'s own pieces.`);
    }
  }, [activeSandbox, activeSandboxId]);

  // Add/remove special square
  const setSpecialSquare = useCallback((x, y, type) => {
    if (!activeSandbox) return;
    
    const key = `${x},${y}`;
    setSandboxes(prev => prev.map(s => {
      if (s.id !== activeSandboxId) return s;
      
      const newSpecialSquares = { ...s.specialSquares };
      if (type) {
        newSpecialSquares[key] = type;
      } else {
        delete newSpecialSquares[key];
      }
      return { ...s, specialSquares: newSpecialSquares };
    }));
  }, [activeSandbox, activeSandboxId]);

  // Check if a value allows movement at a distance
  const checkMovement = (value, distance) => {
    if (value === 99) return true;
    if (value === 0 || value === null || value === undefined) return false;
    if (value > 0) return distance <= value;
    if (value < 0) return distance === Math.abs(value);
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

  // Check if piece can move to a square
  const canPieceMoveTo = useCallback((fromX, fromY, toX, toY, pieceData, playerPosition) => {
    if (!pieceData) return false;
    if (fromX === toX && fromY === toY) return false;

    const rowDiff = playerPosition === 2 ? (fromY - toY) : (toY - fromY);
    const colDiff = playerPosition === 2 ? (fromX - toX) : (toX - fromX);

    // Check directional movement
    const directionalStyle = pieceData.directional_movement_style;
    const hasDirectionalValues = pieceData.up_movement || pieceData.down_movement || 
                                  pieceData.left_movement || pieceData.right_movement ||
                                  pieceData.up_left_movement || pieceData.up_right_movement ||
                                  pieceData.down_left_movement || pieceData.down_right_movement;
    
    if (directionalStyle || hasDirectionalValues) {
      let directionalAllowed = false;

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
    const stepStyle = pieceData.step_movement_style || pieceData.step_by_step_movement_style;
    const stepValue = pieceData.step_movement_value || pieceData.step_by_step_movement_value;
    if (stepStyle || stepValue) {
      const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
      const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      
      if (stepStyle === 'manhattan' || stepStyle === 1) {
        return checkMovement(stepValue, manhattanDistance);
      } else if (stepStyle === 'chebyshev' || stepStyle === 2) {
        return checkMovement(stepValue, chebyshevDistance);
      } else {
        return checkMovement(stepValue, chebyshevDistance);
      }
    }

    // Check additional movements from special scenarios (e.g. pawn double-step)
    if (pieceData.special_scenario_moves) {
      try {
        const parsed = typeof pieceData.special_scenario_moves === 'string'
          ? JSON.parse(pieceData.special_scenario_moves)
          : pieceData.special_scenario_moves;
        const additionalMovements = parsed?.additionalMovements || {};
        
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
          const dist = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
          for (const opt of additionalMovements[direction]) {
            const value = opt.value || 0;
            if (opt.infinite && dist > 0) return true;
            if (opt.exact && dist === value) return true;
            if (!opt.exact && !opt.infinite && dist > 0 && dist <= value) return true;
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    }

    return false;
  }, []);

  // Check if piece can capture on a square
  const canPieceCaptureTo = useCallback((fromX, fromY, toX, toY, pieceData, playerPosition) => {
    if (!pieceData) return false;
    if (fromX === toX && fromY === toY) return false;

    const rowDiff = playerPosition === 2 ? (fromY - toY) : (toY - fromY);
    const colDiff = playerPosition === 2 ? (fromX - toX) : (toX - fromX);

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

    // Check directional capture
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

    // Check ratio capture
    const ratio1 = pieceData.ratio_capture_1 || 0;
    const ratio2 = pieceData.ratio_capture_2 || 0;
    if (ratio1 > 0 && ratio2 > 0) {
      if ((Math.abs(rowDiff) === ratio1 && Math.abs(colDiff) === ratio2) ||
          (Math.abs(rowDiff) === ratio2 && Math.abs(colDiff) === ratio1)) {
        return true;
      }
    }

    // Check step capture
    if (pieceData.step_capture_value) {
      const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
      const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      if (checkMovement(pieceData.step_capture_value, chebyshevDistance) || 
             checkMovement(pieceData.step_capture_value, manhattanDistance)) {
        return true;
      }
    }

    // Check additional captures from special scenarios
    if (pieceData.special_scenario_captures) {
      try {
        const parsed = typeof pieceData.special_scenario_captures === 'string'
          ? JSON.parse(pieceData.special_scenario_captures)
          : pieceData.special_scenario_captures;
        const additionalCaptures = parsed?.additionalCaptures || {};
        
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
          const dist = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
          for (const opt of additionalCaptures[direction]) {
            const value = opt.value || 0;
            if (opt.infinite && dist > 0) return true;
            if (opt.exact && dist === value) return true;
            if (!opt.exact && !opt.infinite && dist > 0 && dist <= value) return true;
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    }

    return false;
  }, [canPieceMoveTo]);

  // Check if path is clear
  const isPathClear = useCallback((fromX, fromY, toX, toY, pieces, pieceData) => {
    // Check if piece can hop
    const canHopAllies = pieceData?.can_hop_over_allies === 1 || pieceData?.can_hop_over_allies === true;
    const canHopEnemies = pieceData?.can_hop_over_enemies === 1 || pieceData?.can_hop_over_enemies === true;
    const pieceTeam = pieceData?.player_id || pieceData?.team;
    
    const dx = Math.sign(toX - fromX);
    const dy = Math.sign(toY - fromY);
    
    // L-shape or knight-like move - no path checking needed
    const xDiff = Math.abs(toX - fromX);
    const yDiff = Math.abs(toY - fromY);
    if (xDiff !== yDiff && xDiff !== 0 && yDiff !== 0) {
      return true;
    }

    let x = fromX + dx;
    let y = fromY + dy;

    while (x !== toX || y !== toY) {
      const blockingPiece = pieces.find(p => p.x === x && p.y === y);
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

  // Calculate valid moves for a piece (includes ranged attacks)
  const calculateValidMoves = useCallback((piece, pieces, boardWidth, boardHeight) => {
    const moves = [];
    const pieceTeam = piece.player_id || piece.team;

    // Main loop: check normal moves and captures
    for (let toY = 0; toY < boardHeight; toY++) {
      for (let toX = 0; toX < boardWidth; toX++) {
        if (toX === piece.x && toY === piece.y) continue;

        const occupyingPiece = pieces.find(p => p.x === toX && p.y === toY);
        const occupyingTeam = occupyingPiece?.player_id || occupyingPiece?.team;

        if (occupyingPiece && occupyingTeam === pieceTeam) continue;

        const isCapture = !!occupyingPiece;
        let isValidMove = false;
        
        if (isCapture) {
          isValidMove = canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
        } else {
          isValidMove = canPieceMoveTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
        }

        if (isValidMove && isPathClear(piece.x, piece.y, toX, toY, pieces, piece)) {
          const isFirstMoveOnly = isCapture 
            ? checkIfFirstMoveOnlyCapture(piece, piece.x, piece.y, toX, toY, pieceTeam)
            : checkIfFirstMoveOnlyMove(piece, piece.x, piece.y, toX, toY, pieceTeam);
          
          moves.push({ x: toX, y: toY, isCapture, isFirstMoveOnly, isRangedAttack: false });
        }
      }
    }

    // Separate loop: check ranged attack targets (matches LiveGame pattern)
    if (piece.can_capture_enemy_via_range) {
      for (let toY = 0; toY < boardHeight; toY++) {
        for (let toX = 0; toX < boardWidth; toX++) {
          if (toX === piece.x && toY === piece.y) continue;
          const targetPiece = pieces.find(p => p.x === toX && p.y === toY);
          const targetTeam = targetPiece?.player_id || targetPiece?.team;
          // Skip friendly pieces - show all other squares within range
          if (targetPiece && targetTeam === pieceTeam) continue;
          // Already in moves as a regular capture? Skip to avoid duplicates
          if (moves.some(m => m.x === toX && m.y === toY)) continue;
          if (canRangedAttackTo(piece.y, piece.x, toY, toX, piece, pieceTeam)) {
            moves.push({
              x: toX,
              y: toY,
              isCapture: !!targetPiece,
              isFirstMoveOnly: false,
              isRangedAttack: true
            });
          }
        }
      }
    }

    return moves;
  }, [canPieceMoveTo, canPieceCaptureTo, isPathClear]);

  // Handle square click - free repositioning (click piece, click destination)
  const handleSquareClick = useCallback((x, y) => {
    if (!activeSandbox) return;

    const pieces = activeSandbox.pieces;
    const clickedPiece = pieces.find(p => p.x === x && p.y === y);

    if (selectedPiece) {
      // If clicking the same piece, deselect
      if (clickedPiece && clickedPiece.id === selectedPiece.id) {
        setSelectedPiece(null);
        setValidMoves([]);
        return;
      }

      // If clicking another piece of the same team, select it instead
      const selectedTeam = selectedPiece.team || selectedPiece.player_id;
      if (clickedPiece && (clickedPiece.team === selectedTeam || clickedPiece.player_id === selectedTeam)) {
        setSelectedPiece(clickedPiece);
        setValidMoves([]);
        return;
      }

      // Free reposition: move piece to target (remove enemy if present)
      const updatedPieces = pieces.filter(p => !(p.x === x && p.y === y));
      const movedPieces = updatedPieces.map(p =>
        p.id === selectedPiece.id ? { ...p, x, y } : p
      );

      setSandboxes(prev => prev.map(s =>
        s.id === activeSandboxId
          ? {
              ...s,
              pieces: movedPieces,
              moveHistory: [...s.moveHistory, {
                from: { x: selectedPiece.x, y: selectedPiece.y },
                to: { x, y },
                piece: selectedPiece.piece_name,
                repositioned: true
              }]
            }
          : s
      ));

      setSelectedPiece(null);
      setValidMoves([]);
    } else {
      // No piece selected - select any piece for repositioning
      if (clickedPiece) {
        setSelectedPiece(clickedPiece);
        setValidMoves([]); // No valid moves for free reposition
      }
    }
  }, [activeSandbox, activeSandboxId, selectedPiece]);

  // Handle long press for mobile
  const handleLongPress = useCallback((x, y) => {
    if (!activeSandbox) return;

    const piece = activeSandbox.pieces.find(p => p.x === x && p.y === y);
    if (piece) {
      removePieceFromBoard(piece.id);
    } else {
      setRightClickPosition({ row: y, col: x });
      setRightClickMode('piece');
      setShowRightClickModal(true);
    }
  }, [activeSandbox, removePieceFromBoard]);

  // Handle touch start for long press detection
  const handleTouchStart = useCallback((e, x, y) => {
    if (!isTouchDevice()) return;
    
    longPressTimeoutRef.current = setTimeout(() => {
      handleLongPress(x, y);
    }, 500);
  }, [handleLongPress]);

  // Handle touch end/move to cancel long press
  const handleTouchEnd = useCallback(() => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  }, []);

  // Handle right-click mousedown on square (for ranged click-vs-drag detection)
  const handleSquareMouseDown = useCallback((e, x, y) => {
    if (e.button !== 2) return; // Only right-click
    if (!activeSandbox) return;

    const piece = activeSandbox.pieces.find(p => p.x === x && p.y === y);
    rightClickDataRef.current = {
      piece, x, y, time: Date.now(),
      clientX: e.clientX, clientY: e.clientY,
      isDrag: false
    };

    if (piece && piece.can_capture_enemy_via_range) {
      // For ranged pieces, activate global listeners to detect drag vs click
      setIsRightClickActive(true);
    }
  }, [activeSandbox]);

  // Handle contextmenu on square
  const handleSquareContextMenu = useCallback((e, x, y) => {
    e.preventDefault();
    if (!activeSandbox) return;

    const data = rightClickDataRef.current;
    // If a ranged right-click is pending (global listeners active), don't do normal action
    if (data && data.piece?.can_capture_enemy_via_range) return;

    // Normal right-click: remove piece or open add-piece modal
    const piece = activeSandbox.pieces.find(p => p.x === x && p.y === y);
    if (piece) {
      removePieceFromBoard(piece.id);
    } else {
      setRightClickPosition({ row: y, col: x });
      setRightClickMode('piece');
      setShowRightClickModal(true);
    }
    rightClickDataRef.current = null;
  }, [activeSandbox, removePieceFromBoard]);

  // Global listeners for ranged right-click drag detection
  useEffect(() => {
    if (!isRightClickActive) return;

    const DRAG_DISTANCE_THRESHOLD = 5;
    const DRAG_TIME_THRESHOLD = 200; // ms

    const getTargetSquare = (clientX, clientY) => {
      if (!boardRef.current) return null;
      const boardRect = boardRef.current.getBoundingClientRect();
      const bw = activeSandbox?.gameType?.board_width || 8;
      const bh = activeSandbox?.gameType?.board_height || 8;
      const squareW = boardRect.width / bw;
      const squareH = boardRect.height / bh;
      const relX = clientX - boardRect.left;
      const relY = clientY - boardRect.top;
      if (relX >= 0 && relX < boardRect.width && relY >= 0 && relY < boardRect.height) {
        return { x: Math.floor(relX / squareW), y: Math.floor(relY / squareH) };
      }
      return null;
    };

    const handleMouseMove = (e) => {
      const data = rightClickDataRef.current;
      if (!data || !data.piece?.can_capture_enemy_via_range) return;

      const dx = e.clientX - data.clientX;
      const dy = e.clientY - data.clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const elapsed = Date.now() - data.time;

      // Transition to drag mode if mouse moved enough or held long enough
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
        // Was a drag — execute ranged attack if valid
        const target = getTargetSquare(e.clientX, e.clientY);
        if (target && activeSandbox) {
          const pieces = activeSandbox.pieces;
          const targetPiece = pieces.find(p => p.x === target.x && p.y === target.y);
          const sourceTeam = data.piece.player_id || data.piece.team;
          const targetTeam = targetPiece?.player_id || targetPiece?.team;

          if (targetPiece && targetTeam !== sourceTeam &&
              canRangedAttackTo(data.piece.y, data.piece.x, target.y, target.x, data.piece, sourceTeam)) {
            const updatedPieces = pieces.filter(p => p.id !== targetPiece.id);
            const nextTurn = activeSandbox.currentTurn === 1 ? 2 : 1;
            setSandboxes(prev => prev.map(s =>
              s.id === activeSandboxId
                ? {
                    ...s,
                    pieces: updatedPieces,
                    currentTurn: nextTurn,
                    moveHistory: [...s.moveHistory, {
                      from: { x: data.piece.x, y: data.piece.y },
                      to: { x: target.x, y: target.y },
                      piece: data.piece.piece_name,
                      rangedAttack: true
                    }]
                  }
                : s
            ));
          }
        }
      } else {
        // Was a quick click — remove the ranged piece (same as normal right-click)
        if (data.piece) {
          removePieceFromBoard(data.piece.id);
        }
      }
      cleanup();
    };

    const handleContextMenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    // Re-render on resize so arrow repositions
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
  }, [isRightClickActive, activeSandbox, activeSandboxId, removePieceFromBoard]);

  // Handle piece selection from modal
  const handlePieceSelect = useCallback((pieceData) => {
    if (!rightClickPosition) return;
    
    addPieceToBoard(pieceData, rightClickPosition.col, rightClickPosition.row, pieceData.player_id);
    setShowRightClickModal(false);
    setRightClickPosition(null);
  }, [rightClickPosition, addPieceToBoard]);

  // Handle special square selection
  const handleSpecialSquareSelect = useCallback((typeId) => {
    if (!rightClickPosition) return;
    
    setSpecialSquare(rightClickPosition.col, rightClickPosition.row, typeId);
    setShowRightClickModal(false);
    setRightClickPosition(null);
  }, [rightClickPosition, setSpecialSquare]);

  // Handle piece hover
  const handlePieceHover = useCallback((piece) => {
    if (!activeSandbox || !piece || !showHighlights) {
      setHoveredPiece(null);
      setHoveredMoves([]);
      return;
    }

    const moves = calculateValidMoves(
      piece,
      activeSandbox.pieces,
      activeSandbox.gameType.board_width,
      activeSandbox.gameType.board_height
    );
    setHoveredPiece(piece);
    setHoveredMoves(moves);
  }, [activeSandbox, calculateValidMoves, showHighlights]);

  // Handle drag start for pieces on the board (game movement with validation)
  const handleBoardPieceDragStart = useCallback((e, piece) => {
    if (!activeSandbox) return;
    
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify({
      ...piece,
      fromBoard: true,
      originalX: piece.x,
      originalY: piece.y
    }));
    
    // Calculate valid moves so highlights show during drag
    const moves = calculateValidMoves(
      piece,
      activeSandbox.pieces,
      activeSandbox.gameType.board_width,
      activeSandbox.gameType.board_height
    );
    setSelectedPiece(piece);
    setValidMoves(moves);
  }, [activeSandbox, calculateValidMoves]);

  // Handle drag from piece library
  const handleLibraryDragStart = useCallback((e, pieceData) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/json', JSON.stringify({
      ...pieceData,
      player_id: sidebarPlayerView,
      fromLibrary: true
    }));
  }, [sidebarPlayerView]);

  // Handle drop on board - game movement with validation
  const handleBoardDrop = useCallback((e, x, y) => {
    e.preventDefault();
    e.stopPropagation();

    if (!activeSandbox) return;

    try {
      const data = e.dataTransfer.getData('application/json');
      if (data) {
        const pieceData = JSON.parse(data);
        
        if (pieceData.fromBoard) {
          // Don't allow dropping on the same square
          if (pieceData.originalX === x && pieceData.originalY === y) {
            setSelectedPiece(null);
            setValidMoves([]);
            return;
          }
          
          // Check if target is a valid move
          const move = validMoves.find(m => m.x === x && m.y === y);
          if (move) {
            // Execute game move with turn switch
            const pieces = activeSandbox.pieces;
            const updatedPieces = pieces.filter(p => !(p.x === x && p.y === y));
            const movedPieces = updatedPieces.map(p =>
              p.id === pieceData.id ? { ...p, x, y } : p
            );

            const currentTurn = activeSandbox.currentTurn;
            const nextTurn = currentTurn === 1 ? 2 : 1;

            setSandboxes(prev => prev.map(s =>
              s.id === activeSandboxId
                ? {
                    ...s,
                    pieces: movedPieces,
                    currentTurn: nextTurn,
                    moveHistory: [...s.moveHistory, {
                      from: { x: pieceData.originalX, y: pieceData.originalY },
                      to: { x, y },
                      piece: pieceData.piece_name
                    }]
                  }
                : s
            ));
          }
          // If not a valid move, do nothing (cancel the drag)
          
          setSelectedPiece(null);
          setValidMoves([]);
        } else {
          // Dropping from library - add new piece
          addPieceToBoard(pieceData, x, y, pieceData.player_id);
        }
      }
    } catch (err) {
      console.error('Failed to handle drop:', err);
    }
  }, [activeSandbox, activeSandboxId, addPieceToBoard, validMoves]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    // Allow both copy and move - browser will use what's allowed
    e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy';
  }, []);

  // Get piece image with player index support
  const getPieceImage = useCallback((imageLocation, playerIndex = 0) => {
    if (!imageLocation) return null;
    
    try {
      const images = JSON.parse(imageLocation);
      if (Array.isArray(images) && images.length > 0) {
        const index = Math.min(playerIndex, images.length - 1);
        const imagePath = images[index];
        return imagePath.startsWith('http') ? imagePath : `${ASSET_URL}${imagePath}`;
      }
    } catch {
      if (imageLocation.startsWith('http')) {
        return imageLocation;
      } else if (imageLocation.startsWith('/uploads/')) {
        return `${ASSET_URL}${imageLocation}`;
      } else {
        return `${ASSET_URL}/uploads/pieces/${imageLocation}`;
      }
    }
    
    return null;
  }, []);

  // Get piece image for board display
  const getBoardPieceImage = useCallback((piece) => {
    if (piece.image_url) {
      return piece.image_url.startsWith('http') ? piece.image_url : `${ASSET_URL}${piece.image_url}`;
    }
    const playerIndex = (piece.player_id || piece.team || 1) - 1;
    return getPieceImage(piece.image_location, playerIndex);
  }, [getPieceImage]);

  // Filter game types
  const filteredGameTypes = gamesList.filter(game =>
    game.game_name?.toLowerCase().includes(searchGameTerm.toLowerCase())
  );

  // Filter pieces
  const filteredPieces = fullPiecesList.filter(piece =>
    piece.piece_name?.toLowerCase().includes(searchPieceTerm.toLowerCase())
  );

  // Render the board
  const renderBoard = () => {
    if (!activeSandbox) {
      return (
        <div className={styles["empty-state"]}>
          <h2>No Board Loaded</h2>
          <p>Create a blank board or load a game type to get started</p>
          <button onClick={createBlankSandbox} className={styles["btn-primary"]}>
            Create Blank Board
          </button>
        </div>
      );
    }

    const boardWidth = activeSandbox.gameType.board_width || 8;
    const boardHeight = activeSandbox.gameType.board_height || 8;
    const pieces = activeSandbox.pieces;
    const specialSquares = activeSandbox.specialSquares || {};

    const squares = [];

    for (let y = 0; y < boardHeight; y++) {
      for (let x = 0; x < boardWidth; x++) {
        const isLight = (x + y) % 2 === 0;
        const piece = pieces.find(p => p.x === x && p.y === y);
        const isSelected = selectedPiece && selectedPiece.x === x && selectedPiece.y === y;
        // Find regular and ranged moves separately so both styles can overlap
        const regularMove = showHighlights ? validMoves.find(m => m.x === x && m.y === y && !m.isRangedAttack) : null;
        const rangedMove = showHighlights ? validMoves.find(m => m.x === x && m.y === y && m.isRangedAttack) : null;
        const hoveredRegularMove = showHighlights && hoveredPiece && !selectedPiece
          ? hoveredMoves.find(m => m.x === x && m.y === y && !m.isRangedAttack)
          : null;
        const hoveredRangedMove = showHighlights && hoveredPiece && !selectedPiece
          ? hoveredMoves.find(m => m.x === x && m.y === y && m.isRangedAttack)
          : null;
        const isLastMoveFrom = showHighlights && lastMove && lastMove.from.x === x && lastMove.from.y === y;
        const isLastMoveTo = showHighlights && lastMove && lastMove.to.x === x && lastMove.to.y === y;
        const specialSquareType = specialSquares[`${x},${y}`];

        // Check ranged attack highlights
        const isRangedMove = !!rangedMove;
        const isRangedHover = !!hoveredRangedMove;
        // During ranged drag, highlight all valid ranged target squares (including empty)
        const isRangedDragTarget = rangedAttackSource && showHighlights
          && !(piece && ((piece.player_id || piece.team) === (rangedAttackSource.player_id || rangedAttackSource.team)))
          && canRangedAttackTo(rangedAttackSource.y, rangedAttackSource.x, y, x, rangedAttackSource, rangedAttackSource.player_id || rangedAttackSource.team);

        squares.push(
          <div
            key={`${x}-${y}`}
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
              ${isRangedDragTarget ? styles["ranged-drag-target"] : ''}
              ${isLastMoveFrom || isLastMoveTo ? styles["last-move"] : ''}
            `}
            onClick={() => handleSquareClick(x, y)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleBoardDrop(e, x, y)}
            onMouseDown={(e) => handleSquareMouseDown(e, x, y)}
            onContextMenu={(e) => handleSquareContextMenu(e, x, y)}
            onTouchStart={(e) => handleTouchStart(e, x, y)}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchEnd}
            style={{
              backgroundColor: specialSquareType 
                ? SPECIAL_SQUARE_TYPES[specialSquareType]?.color
                : isLight 
                  ? (currentUser?.light_square_color || '#cad5e8')
                  : (currentUser?.dark_square_color || '#08234d')
            }}
          >
            {((isRangedMove && rangedMove?.isCapture) || (isRangedHover && hoveredRangedMove?.isCapture) || (isRangedDragTarget && piece)) && (
              <span className={styles["ranged-icon"]}>💥</span>
            )}
            {piece && (
              <div
                className={`${styles.piece} ${styles.draggable}`}
                draggable={true}
                onDragStart={(e) => handleBoardPieceDragStart(e, piece)}
                onDragEnd={() => {
                  setSelectedPiece(null);
                  setValidMoves([]);
                }}
                onMouseEnter={() => handlePieceHover(piece)}
                onMouseLeave={() => handlePieceHover(null)}
              >
                <img
                  src={getBoardPieceImage(piece)}
                  alt={piece.piece_name}
                  draggable={false}
                />
              </div>
            )}
            {specialSquareType && !piece && (
              <div className={styles["special-square-indicator"]}>
                {SPECIAL_SQUARE_TYPES[specialSquareType]?.name?.charAt(0)}
              </div>
            )}
          </div>
        );
      }
    }

    return (
      <div className={styles["board-wrapper"]}>
        <div className={styles["board-header"]}>
          <h2>{activeSandbox.name}</h2>
          <div className={styles["header-controls"]}>
            <label className={styles["highlight-toggle"]}>
              <input
                type="checkbox"
                checked={showHighlights}
                onChange={(e) => setShowHighlights(e.target.checked)}
              />
              <span>Show move highlights</span>
            </label>
            <div className={styles["turn-indicator"]}>
              Turn: Player {activeSandbox.currentTurn}
            </div>
          </div>
        </div>
        <div
          ref={boardRef}
          className={styles.board}
          style={{
            gridTemplateColumns: `repeat(${boardWidth}, 1fr)`,
            gridTemplateRows: `repeat(${boardHeight}, 1fr)`
          }}
        >
          {squares}
          {rangedAttackSource && rangedMousePos && boardRef.current && (() => {
            const boardRect = boardRef.current.getBoundingClientRect();
            const squareWidth = boardRect.width / boardWidth;
            const squareHeight = boardRect.height / boardHeight;
            const startX = (rangedAttackSource.x + 0.5) * squareWidth;
            const startY = (rangedAttackSource.y + 0.5) * squareHeight;
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
                    id="ranged-arrowhead"
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
                  markerEnd="url(#ranged-arrowhead)"
                  opacity="0.9"
                />
              </svg>
            );
          })()}
        </div>
        <div className={styles["board-controls"]}>
          <button
            onClick={() => {
              setSandboxes(prev => prev.map(s =>
                s.id === activeSandboxId
                  ? { ...s, currentTurn: s.currentTurn === 1 ? 2 : 1 }
                  : s
              ));
            }}
            className={styles["btn-secondary"]}
          >
            Switch Turn
          </button>
          <button
            onClick={() => {
              if (window.confirm('Clear all pieces from the board?')) {
                setSandboxes(prev => prev.map(s =>
                  s.id === activeSandboxId
                    ? { ...s, pieces: [], moveHistory: [] }
                    : s
                ));
              }
            }}
            className={styles["btn-secondary"]}
          >
            Clear Board
          </button>
          <button
            onClick={() => {
              if (window.confirm('Clear all special squares?')) {
                setSandboxes(prev => prev.map(s =>
                  s.id === activeSandboxId
                    ? { ...s, specialSquares: {} }
                    : s
                ));
              }
            }}
            className={styles["btn-secondary"]}
          >
            Clear Special Squares
          </button>
          <button
            onClick={() => handleMirrorPieces(1, 2)}
            className={styles["btn-mirror"]}
            title="Copy Player 1's pieces to Player 2's side (mirrored vertically)"
          >
            Mirror P1 → P2
          </button>
          <button
            onClick={() => handleMirrorPieces(2, 1)}
            className={styles["btn-mirror"]}
            title="Copy Player 2's pieces to Player 1's side (mirrored vertically)"
          >
            Mirror P2 → P1
          </button>
        </div>
        <div className={styles["board-instructions"]}>
          <div className={styles["instructions-row"]}>
            <span className={styles["instruction-item"]}>
              <span className={styles["instruction-icon"]}>♟</span>
              <strong>Move &amp; Capture:</strong> Drag piece to a valid square
            </span>
            <span className={styles["instruction-item"]}>
              <span className={styles["instruction-icon"]}>✋</span>
              <strong>Reposition:</strong> Click piece, then click any square
            </span>
          </div>
          <div className={styles["instructions-row"]}>
            <span className={styles["instruction-item"]}>
              <span className={styles["instruction-icon"]}>➕</span>
              <strong>Add:</strong> {isMobile ? 'Long press empty square' : 'Right-click empty square'}
            </span>
            <span className={styles["instruction-item"]}>
              <span className={styles["instruction-icon"]}>❌</span>
              <strong>Remove:</strong> {isMobile ? 'Long press on piece' : 'Right-click on piece'}
            </span>
          </div>
        </div>
      </div>
    );
  };

  // Combined modal for piece/special square selection
  const renderRightClickModal = () => {
    if (!showRightClickModal || !rightClickPosition) return null;

    return (
      <div className={styles["modal-overlay"]} onClick={() => setShowRightClickModal(false)}>
        <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()}>
          <div className={styles["modal-header"]}>
            <h2>Square ({rightClickPosition.row}, {rightClickPosition.col})</h2>
            <button className={styles["close-button"]} onClick={() => setShowRightClickModal(false)}>✕</button>
          </div>
          
          <div className={styles["modal-tabs"]}>
            <button
              className={`${styles["modal-tab"]} ${rightClickMode === 'piece' ? styles.active : ''}`}
              onClick={() => setRightClickMode('piece')}
            >
              Add Piece
            </button>
            <button
              className={`${styles["modal-tab"]} ${rightClickMode === 'special' ? styles.active : ''}`}
              onClick={() => setRightClickMode('special')}
            >
              Special Square
            </button>
          </div>

          {rightClickMode === 'piece' ? (
            <PieceSelector
              onSelect={handlePieceSelect}
              onRemove={() => setShowRightClickModal(false)}
              onCancel={() => setShowRightClickModal(false)}
              playerCount={2}
              currentPlacement={null}
              squarePosition={rightClickPosition}
              mateCondition={false}
              captureCondition={false}
              embedded={true}
            />
          ) : (
            <div className={styles["special-squares-grid"]}>
              {Object.entries(SPECIAL_SQUARE_TYPES).map(([id, type]) => (
                <button
                  key={id}
                  className={styles["special-square-btn"]}
                  style={{ borderColor: type.color }}
                  onClick={() => handleSpecialSquareSelect(id)}
                >
                  <div 
                    className={styles["special-square-color"]}
                    style={{ backgroundColor: type.color }}
                  >
                    {type.name.charAt(0)}
                  </div>
                  <span>{type.name}</span>
                </button>
              ))}
              <button
                className={`${styles["special-square-btn"]} ${styles["remove-btn"]}`}
                onClick={() => handleSpecialSquareSelect(null)}
              >
                <div className={styles["special-square-color"]}>✕</div>
                <span>Remove Special</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={styles["sandbox-container"]}>
      {/* Left Sidebar - Game Types */}
      <div className={`${styles.sidebar} ${styles.left}`}>
        <div className={styles["sidebar-header"]}>
          <h3>Game Types</h3>
          <button
            onClick={() => setShowGameTypes(!showGameTypes)}
            className={styles["toggle-btn"]}
            title={showGameTypes ? "Collapse" : "Expand"}
          >
            {showGameTypes ? '▼' : '▶'}
          </button>
        </div>

        {showGameTypes && (
          <>
            <div className={styles["search-box"]}>
              <input
                type="text"
                placeholder="Search games..."
                value={searchGameTerm}
                onChange={(e) => setSearchGameTerm(e.target.value)}
              />
            </div>

            <div className={styles["item-list"]}>
              <button
                onClick={createBlankSandbox}
                className={`${styles["list-item"]} ${styles["blank-board-btn"]}`}
                disabled={sandboxes.length >= MAX_SANDBOXES}
              >
                <strong>✦ Blank Board</strong>
                <span>8×8 empty board</span>
              </button>

              {filteredGameTypes.map((game) => (
                <button
                  key={game.id}
                  onClick={() => loadGameType(game)}
                  className={styles["list-item"]}
                  disabled={sandboxes.length >= MAX_SANDBOXES}
                >
                  <strong>{game.game_name}</strong>
                  <span>{game.board_width}×{game.board_height}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Center - Board */}
      <div className={styles["main-area"]}>
        {/* Sandbox Tabs */}
        <div className={styles["sandbox-tabs"]}>
          {sandboxes.map((sandbox) => (
            <div
              key={sandbox.id}
              className={`${styles.tab} ${sandbox.id === activeSandboxId ? styles.active : ''}`}
              onClick={() => setActiveSandboxId(sandbox.id)}
            >
              <span>{sandbox.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteSandbox(sandbox.id);
                }}
                className={styles["close-tab"]}
              >
                ×
              </button>
            </div>
          ))}
          {sandboxes.length < MAX_SANDBOXES && (
            <button
              onClick={createBlankSandbox}
              className={styles["add-tab"]}
              title="Create new sandbox"
            >
              +
            </button>
          )}
          {sandboxes.length >= MAX_SANDBOXES && (
            <span className={styles["max-reached"]}>Max {MAX_SANDBOXES} sandboxes</span>
          )}
        </div>

        {renderBoard()}
      </div>

      {/* Right Sidebar - Piece Library */}
      <div className={`${styles.sidebar} ${styles.right}`}>
        <div className={styles["sidebar-header"]}>
          <h3>Piece Library</h3>
          <button
            onClick={() => setShowPieceLibrary(!showPieceLibrary)}
            className={styles["toggle-btn"]}
            title={showPieceLibrary ? "Collapse" : "Expand"}
          >
            {showPieceLibrary ? '▼' : '▶'}
          </button>
        </div>

        {showPieceLibrary && (
          <>
            <div className={styles["search-box"]}>
              <input
                type="text"
                placeholder="Search pieces..."
                value={searchPieceTerm}
                onChange={(e) => setSearchPieceTerm(e.target.value)}
              />
            </div>

            <div className={styles["player-toggle"]}>
              <span className={styles["toggle-label"]}>Add pieces as:</span>
              <div className={styles["toggle-buttons"]}>
                <button
                  className={`${styles["player-btn"]} ${sidebarPlayerView === 1 ? styles.active : ''}`}
                  onClick={() => setSidebarPlayerView(1)}
                >
                  Player 1
                </button>
                <button
                  className={`${styles["player-btn"]} ${sidebarPlayerView === 2 ? styles.active : ''}`}
                  onClick={() => setSidebarPlayerView(2)}
                >
                  Player 2
                </button>
              </div>
            </div>

            <div className={styles["instructions"]}>
              <p>Drag pieces onto the board to add them.</p>
            </div>

            {piecesLoading ? (
              <div className={styles["loading"]}>Loading pieces...</div>
            ) : (
              <div className={styles["piece-grid"]}>
                {filteredPieces.map((piece) => {
                  const imageUrl = getPieceImage(piece.image_location, sidebarPlayerView - 1);
                  if (!imageUrl) {
                    console.warn('Missing image for piece:', piece.piece_name, piece);
                  }
                  return (
                  <div
                    key={piece.id || piece.piece_id}
                    className={styles["piece-item"]}
                    draggable
                    onDragStart={(e) => handleLibraryDragStart(e, piece)}
                  >
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={piece.piece_name}
                        onError={(e) => {
                          console.error('Failed to load image:', imageUrl, 'for piece:', piece.piece_name);
                          e.target.style.display = 'none';
                        }}
                      />
                    ) : (
                      <div style={{ width: '56px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a2b3d', borderRadius: '4px', color: '#666', fontSize: '0.7rem' }}>
                        No Image
                      </div>
                    )}
                    <span>{piece.piece_name}</span>
                  </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Right-click Modal */}
      {renderRightClickModal()}
    </div>
  );
};

export default Sandbox;
