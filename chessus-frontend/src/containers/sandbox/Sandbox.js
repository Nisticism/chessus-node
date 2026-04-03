import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import { getGames, getGameById } from "../../actions/games";
import PiecesService from "../../services/pieces.service";
import PieceSelector from "../../components/gamewizard/PieceSelector";
import { canRangedAttackTo, isRangedPathClear, isDestinationClear, doesPieceOccupySquare, getSquareHighlightStyle, canHopCaptureToUtil } from "../../helpers/pieceMovementUtils";
import styles from "./sandbox.module.scss";
import { isMobileDevice, isTouchDevice } from "../../helpers/mobileUtils";

import { applySvgStretchBackground } from "../../helpers/svgStretchUtils";
import SquareHighlightOverlay from "../../components/common/SquareHighlightOverlay";

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
        setFullPiecesList(response.data || []);
      } catch (err) {
        console.error('Failed to load pieces with movement:', err);
        // Fallback: try loading regular pieces
        try {
          const fallbackResponse = await PiecesService.getPieces();
          const fallbackData = fallbackResponse.data;
          const fallbackPieces = Array.isArray(fallbackData) ? fallbackData : (fallbackData?.pieces || []);
          setFullPiecesList(fallbackPieces);
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
  const sandboxesLoadedRef = useRef(false);
  
  // UI state
  const [selectedPiece, setSelectedPiece] = useState(null);
  const [validMoves, setValidMoves] = useState([]);
  const [hoveredPiece, setHoveredPiece] = useState(null);
  const [hoveredHighlights, setHoveredHighlights] = useState({});
  const [showGameTypes, setShowGameTypes] = useState(true);
  const [showPieceLibrary, setShowPieceLibrary] = useState(true);
  const [searchGameTerm, setSearchGameTerm] = useState("");
  const [searchPieceTerm, setSearchPieceTerm] = useState("");
  const [showHighlights, setShowHighlights] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  
  // Initialize sidebarPlayerView from localStorage
  const getInitialSidebarPlayerView = () => {
    const saved = localStorage.getItem('sandboxSidebarPlayerView');
    return saved ? parseInt(saved) : 1;
  };
  const [sidebarPlayerView, setSidebarPlayerView] = useState(getInitialSidebarPlayerView());
  const boardAnimationsEnabled = localStorage.getItem('boardAnimations') !== 'false';
  const pieceShadowEnabled = localStorage.getItem('pieceShadow') === 'true';
  
  // Save sidebarPlayerView to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('sandboxSidebarPlayerView', sidebarPlayerView.toString());
  }, [sidebarPlayerView]);
  
  // Right-click modal state
  const [showRightClickModal, setShowRightClickModal] = useState(false);
  const [rightClickPosition, setRightClickPosition] = useState(null);
  const [rightClickMode, setRightClickMode] = useState('piece'); // 'piece' or 'special'
  const [isMobile, setIsMobile] = useState(false);
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  const longPressTimeoutRef = useRef(null);
  
  // Ranged attack state
  const [rangedAttackSource, setRangedAttackSource] = useState(null); // piece being right-click-dragged
  const [rangedMousePos, setRangedMousePos] = useState(null); // current mouse position for arrow
  const [, setRangedTargetSquare] = useState(null); // square under cursor
  const boardRef = useRef(null);
  const rightClickDataRef = useRef(null); // tracks right-click start for click-vs-drag detection
  const [isRightClickActive, setIsRightClickActive] = useState(false);

  // Detect if on mobile device
  useEffect(() => {
    setIsMobile(isMobileDevice());
  }, []);

  // Track window width for responsive board sizing
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('chessus-sandboxes');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
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
    sandboxesLoadedRef.current = true;
  }, []);

  // Handle pending piece from PieceView "Try in Sandbox" button
  useEffect(() => {
    if (!sandboxesLoadedRef.current) return;
    const pendingRaw = localStorage.getItem('chessus-sandbox-pending-piece');
    if (!pendingRaw) return;
    localStorage.removeItem('chessus-sandbox-pending-piece');

    const loadPendingPiece = async () => {
      try {
        const pending = JSON.parse(pendingRaw);
        const response = await PiecesService.getPieceById(pending.pieceId);
        const fullPiece = response.data;
        if (!fullPiece) return;

        // Parse piece images
        let images = [];
        if (fullPiece.image_location) {
          try {
            const parsed = JSON.parse(fullPiece.image_location);
            if (Array.isArray(parsed)) {
              images = parsed.map(img => img.startsWith('http') ? img : `${ASSET_URL}${img}`);
            }
          } catch {
            const p = fullPiece.image_location;
            images = [p.startsWith('http') ? p : `${ASSET_URL}${p.startsWith('/uploads/') ? p : `/uploads/pieces/${p}`}`];
          }
        }

        const pieceForSandbox = {
          ...fullPiece,
          ratio_movement_1: fullPiece.ratio_movement_1 || fullPiece.ratio_one_movement,
          ratio_movement_2: fullPiece.ratio_movement_2 || fullPiece.ratio_two_movement,
          step_movement_style: fullPiece.step_by_step_movement_style ?? fullPiece.step_movement_style,
          step_movement_value: fullPiece.step_by_step_movement_value ?? fullPiece.step_movement_value,
          ratio_capture_1: fullPiece.ratio_capture_1 || fullPiece.ratio_one_capture,
          ratio_capture_2: fullPiece.ratio_capture_2 || fullPiece.ratio_two_capture,
          step_capture_value: fullPiece.step_capture_value || fullPiece.step_by_step_capture,
          step_by_step_attack_range: fullPiece.step_by_step_attack_range || fullPiece.step_by_step_attack_value,
          id: `piece-${Date.now()}-0`,
          piece_id: fullPiece.piece_id,
          x: pending.centerX,
          y: pending.centerY,
          team: 1,
          player_id: 1,
          piece_image_urls: images,
          name: fullPiece.piece_name,
        };

        const newSandbox = {
          id: Date.now(),
          name: fullPiece.piece_name || 'Piece Preview',
          gameType: { board_width: pending.boardWidth, board_height: pending.boardHeight, game_name: fullPiece.piece_name || 'Piece Preview' },
          pieces: [pieceForSandbox],
          specialSquares: {},
          currentTurn: 1,
          moveHistory: []
        };

        setSandboxes(prev => {
          let updated = [...prev];
          if (updated.length >= MAX_SANDBOXES) {
            // Remove the first (least recent) sandbox
            updated = updated.slice(1);
            // Re-label any auto-named sandboxes
            updated = updated.map((s, index) => {
              if (s.name.match(/^Sandbox \d+$/)) {
                return { ...s, name: `Sandbox ${index + 1}` };
              }
              return s;
            });
          }
          return [...updated, newSandbox];
        });
        setActiveSandboxId(newSandbox.id);
      } catch (e) {
        console.error('Failed to load pending piece for sandbox:', e);
      }
    };

    loadPendingPiece();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      step_movement_style: dbPiece.step_by_step_movement_style ?? dbPiece.step_movement_style,
      step_movement_value: dbPiece.step_by_step_movement_value ?? dbPiece.step_movement_value,
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
    
    // Fetch fresh game data from the server (includes junction table pieces)
    let freshGameData = gameType;
    try {
      freshGameData = await dispatch(getGameById(gameType.id));
    } catch (err) {
      console.warn('Failed to fetch fresh game data, using cached:', err);
    }
    
    // The field is called pieces_string in the database, not piece_layout
    const pieceLayoutRaw = freshGameData.pieces_string || freshGameData.piece_layout;
    
    let pieces = [];
    if (pieceLayoutRaw) {
      try {
        const parsedLayout = JSON.parse(pieceLayoutRaw);
        
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
        
        // Enrich each piece with full movement data
        pieces = await Promise.all(layout.map(async (p, index) => {
          const pieceId = p.piece_id || p.id;
          
          // Try to find in our cached full pieces first
          let fullPiece = getFullPieceData(pieceId);
          
          // If not found, fetch it individually
          if (!fullPiece && pieceId) {
            try {
              const response = await PiecesService.getPieceById(pieceId);
              fullPiece = response.data;
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
            exact_ratio_hop_only: normalizedPiece?.exact_ratio_hop_only,
            directional_hop_disabled: normalizedPiece?.directional_hop_disabled,
            id: `piece-${Date.now()}-${index}`,
            piece_id: pieceId,
            x: p.x ?? p.col ?? p.xLocation ?? 0,
            y: posY,
            team: playerId,
            player_id: playerId
          };
          
          return resultPiece;
        }));
      } catch (e) {
        console.error('Failed to parse piece layout:', e);
      }
    }
    
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
  }, [sandboxes.length, getFullPieceData, normalizePieceData, dispatch, fullPiecesList.length]);

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

  // Multi-tile aware piece finder: finds a piece whose footprint covers (x, y)
  const findPieceAt = useCallback((pieces, x, y) => {
    return pieces.find(p => {
      const pw = p.piece_width || 1;
      const ph = p.piece_height || 1;
      return x >= p.x && x < p.x + pw && y >= p.y && y < p.y + ph;
    });
  }, []);

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
      step_movement_style: pieceData.step_by_step_movement_style ?? pieceData.step_movement_style,
      step_movement_value: pieceData.step_by_step_movement_value ?? pieceData.step_movement_value,
      can_hop_over_allies: pieceData.can_hop_over_allies,
      can_hop_over_enemies: pieceData.can_hop_over_enemies,
      exact_ratio_hop_only: pieceData.exact_ratio_hop_only,
      directional_hop_disabled: pieceData.directional_hop_disabled,
      can_capture_enemy_on_move: pieceData.can_capture_enemy_on_move,
      attacks_like_movement: pieceData.attacks_like_movement,
      // Movement exact flags
      up_movement_exact: pieceData.up_movement_exact,
      down_movement_exact: pieceData.down_movement_exact,
      left_movement_exact: pieceData.left_movement_exact,
      right_movement_exact: pieceData.right_movement_exact,
      up_left_movement_exact: pieceData.up_left_movement_exact,
      up_right_movement_exact: pieceData.up_right_movement_exact,
      down_left_movement_exact: pieceData.down_left_movement_exact,
      down_right_movement_exact: pieceData.down_right_movement_exact,
      // Capture exact flags
      up_capture_exact: pieceData.up_capture_exact,
      down_capture_exact: pieceData.down_capture_exact,
      left_capture_exact: pieceData.left_capture_exact,
      right_capture_exact: pieceData.right_capture_exact,
      up_left_capture_exact: pieceData.up_left_capture_exact,
      up_right_capture_exact: pieceData.up_right_capture_exact,
      down_left_capture_exact: pieceData.down_left_capture_exact,
      down_right_capture_exact: pieceData.down_right_capture_exact,
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
      step_capture_value: pieceData.step_capture_value || pieceData.step_by_step_capture,
      // Repeating movement/capture
      repeating_movement: pieceData.repeating_movement,
      repeating_capture: pieceData.repeating_capture,
      repeating_ratio: pieceData.repeating_ratio,
      repeating_ratio_capture: pieceData.repeating_ratio_capture,
      max_ratio_iterations: pieceData.max_ratio_iterations,
      max_ratio_capture_iterations: pieceData.max_ratio_capture_iterations,
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
      can_fire_over_allies: pieceData.can_fire_over_allies,
      can_fire_over_enemies: pieceData.can_fire_over_enemies,
      // Multi-tile dimensions
      piece_width: pieceData.piece_width || 1,
      piece_height: pieceData.piece_height || 1,
      // Checkers-style capture
      capture_on_hop: pieceData.capture_on_hop,
      chain_capture_enabled: pieceData.chain_capture_enabled,
      chain_hop_over_allies: pieceData.chain_hop_over_allies,
      // Attack hopping
      can_hop_attack_over_allies: pieceData.can_hop_attack_over_allies,
      can_hop_attack_over_enemies: pieceData.can_hop_attack_over_enemies,
      // Special abilities
      can_en_passant: pieceData.can_en_passant,
      free_move_after_promotion: pieceData.free_move_after_promotion,
      can_capture_allies: pieceData.can_capture_allies,
      cannot_be_captured: pieceData.cannot_be_captured,
    };

    setSandboxes(prev => prev.map(s => {
      if (s.id !== activeSandboxId) return s;
      // Multi-tile bounds check
      const pw = newPiece.piece_width || 1;
      const ph = newPiece.piece_height || 1;
      const bw = s.gameType?.board_width || 8;
      const bh = s.gameType?.board_height || 8;
      if (x + pw > bw || y + ph > bh) return s;
      const existingPiece = findPieceAt(s.pieces, x, y);
      const filtered = existingPiece 
        ? s.pieces.filter(p => p.id !== existingPiece.id) 
        : s.pieces;
      return { ...s, pieces: [...filtered, newPiece] };
    }));
  }, [activeSandbox, activeSandboxId, sidebarPlayerView, findPieceAt]);

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

    const boardWidth = activeSandbox.gameType.board_width || 8;
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

    // Build a set of all squares occupied by source pieces for overlap detection
    const sourceOccupiedSquares = new Set();
    sourcePieces.forEach(p => {
      const pw = p.piece_width || 1;
      const ph = p.piece_height || 1;
      for (let dy = 0; dy < ph; dy++) {
        for (let dx = 0; dx < pw; dx++) {
          sourceOccupiedSquares.add(`${p.x + dx},${p.y + dy}`);
        }
      }
    });

    let skipped = 0;
    sourcePieces.forEach(p => {
      const pw = p.piece_width || 1;
      const ph = p.piece_height || 1;
      // Mirror the piece so the entire footprint is reflected across the board center
      // For a piece occupying rows p.y to p.y+ph-1, the mirrored anchor is boardHeight - p.y - ph
      const mirroredY = boardHeight - p.y - ph;

      // Bounds check: mirrored piece must fit on the board
      if (mirroredY < 0 || mirroredY + ph > boardHeight || p.x + pw > boardWidth) {
        skipped++;
        return;
      }

      // Check if any square of the mirrored piece overlaps with source player's pieces
      let overlaps = false;
      for (let dy = 0; dy < ph && !overlaps; dy++) {
        for (let dx = 0; dx < pw && !overlaps; dx++) {
          if (sourceOccupiedSquares.has(`${p.x + dx},${mirroredY + dy}`)) {
            overlaps = true;
          }
        }
      }
      if (overlaps) {
        skipped++;
        return;
      }

      // Remove any existing pieces at the mirrored location
      newPieces = newPieces.filter(existing => {
        const ew = existing.piece_width || 1;
        const eh = existing.piece_height || 1;
        // Check if any square of the mirrored piece overlaps with existing piece
        for (let dy = 0; dy < ph; dy++) {
          for (let dx = 0; dx < pw; dx++) {
            const mx = p.x + dx;
            const my = mirroredY + dy;
            if (mx >= existing.x && mx < existing.x + ew &&
                my >= existing.y && my < existing.y + eh) {
              return false;
            }
          }
        }
        return true;
      });

      newPieces.push({
        ...p,
        id: `piece-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        y: mirroredY,
        team: targetPlayerId,
        player_id: targetPlayerId,
        image_url: undefined,
      });
    });

    setSandboxes(prev => prev.map(s =>
      s.id === activeSandboxId
        ? { ...s, pieces: newPieces }
        : s
    ));

    if (skipped > 0) {
      alert(`${skipped} piece(s) could not be mirrored because they would overlap with Player ${sourcePlayerId}'s own pieces or exceed the board.`);
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
  // repeating: when true and value is exact (negative), allows multiples of the exact value
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

  // Resolve a directional value + separate exact flag into the signed convention for checkMovement.
  // DB stores values as positive with a separate boolean _exact column.
  const resolveExact = (value, exactFlag) => {
    if (!value || value === 99) return value;
    if (exactFlag === true || exactFlag === 1) return -Math.abs(value);
    return value;
  };

  const getStepMovementConfig = useCallback((pieceData) => {
    const stepValueRaw = pieceData?.step_by_step_movement_value ?? pieceData?.step_movement_value;
    const stepValue = Number(stepValueRaw);

    if (Number.isNaN(stepValue) || stepValue === 0) {
      return null;
    }

    return {
      maxSteps: Math.abs(stepValue),
      noDiagonal: stepValue < 0
    };
  }, []);

  const isStepByStepTarget = useCallback((pieceData, fromX, fromY, toX, toY) => {
    const config = getStepMovementConfig(pieceData);
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

    const hasGhostwalk = piece.ghostwalk === 1 || piece.ghostwalk === true;

    const occupied = hasGhostwalk ? new Set() : new Set(
      pieces
        .filter(p => p.id !== piece.id)
        .map(p => `${p.x},${p.y}`)
    );

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
  // skipExactRatio: when true, skip exact directional and ratio checks (for hop-only validation)
  const canPieceMoveTo = useCallback((fromX, fromY, toX, toY, pieceData, playerPosition, skipExactRatio = false) => {
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
      const rep = pieceData.repeating_movement;

      if (rowDiff < 0 && colDiff === 0) {
        if (!(skipExactRatio && pieceData.up_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.up_movement, pieceData.up_movement_exact), Math.abs(rowDiff), rep && pieceData.up_movement_exact);
      } else if (rowDiff > 0 && colDiff === 0) {
        if (!(skipExactRatio && pieceData.down_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.down_movement, pieceData.down_movement_exact), Math.abs(rowDiff), rep && pieceData.down_movement_exact);
      } else if (rowDiff === 0 && colDiff < 0) {
        if (!(skipExactRatio && pieceData.left_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.left_movement, pieceData.left_movement_exact), Math.abs(colDiff), rep && pieceData.left_movement_exact);
      } else if (rowDiff === 0 && colDiff > 0) {
        if (!(skipExactRatio && pieceData.right_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.right_movement, pieceData.right_movement_exact), Math.abs(colDiff), rep && pieceData.right_movement_exact);
      } else if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.up_left_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.up_left_movement, pieceData.up_left_movement_exact), Math.abs(rowDiff), rep && pieceData.up_left_movement_exact);
      } else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.up_right_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.up_right_movement, pieceData.up_right_movement_exact), Math.abs(rowDiff), rep && pieceData.up_right_movement_exact);
      } else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.down_left_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.down_left_movement, pieceData.down_left_movement_exact), Math.abs(rowDiff), rep && pieceData.down_left_movement_exact);
      } else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.down_right_movement_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.down_right_movement, pieceData.down_right_movement_exact), Math.abs(rowDiff), rep && pieceData.down_right_movement_exact);
      }

      if (directionalAllowed) return true;
    }

    // Check ratio movement (L-shape like knight)
    if (!skipExactRatio) {
    const ratioStyle = pieceData.ratio_movement_style;
    const ratio1 = pieceData.ratio_movement_1 || pieceData.ratio_one_movement || 0;
    const ratio2 = pieceData.ratio_movement_2 || pieceData.ratio_two_movement || 0;
    
    if ((ratioStyle || (ratio1 > 0 && ratio2 > 0)) && ratio1 > 0 && ratio2 > 0) {
      const absRow = Math.abs(rowDiff);
      const absCol = Math.abs(colDiff);
      if (pieceData.repeating_ratio) {
        const maxK = pieceData.max_ratio_iterations === -1 ? Math.max(absRow, absCol) : (pieceData.max_ratio_iterations || 1);
        for (let k = 1; k <= maxK; k++) {
          if ((absRow === k * ratio1 && absCol === k * ratio2) ||
              (absRow === k * ratio2 && absCol === k * ratio1)) {
            return true;
          }
        }
      } else {
        if ((absRow === ratio1 && absCol === ratio2) ||
            (absRow === ratio2 && absCol === ratio1)) {
          return true;
        }
      }
    }
    }

    // Check step-by-step movement - use sign-based diagonal exclusion
    const rawStepValue = pieceData.step_by_step_movement_value ?? pieceData.step_movement_value;
    const stepValue = Number(rawStepValue);
    if (!Number.isNaN(stepValue) && stepValue !== 0) {
      const maxSteps = Math.abs(stepValue);
      const noDiagonal = stepValue < 0;

      if (noDiagonal) {
        // Only cardinal directions (manhattan distance)
        const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
        return manhattanDistance > 0 && manhattanDistance <= maxSteps;
      }

      // Allow diagonals (chebyshev distance)
      const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      return chebyshevDistance > 0 && chebyshevDistance <= maxSteps;
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
            if (skipExactRatio && opt.exact) continue;
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
  // skipExactRatio: when true, skip exact directional and ratio checks (for hop-only validation)
  const canPieceCaptureTo = useCallback((fromX, fromY, toX, toY, pieceData, playerPosition, skipExactRatio = false) => {
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
      return canPieceMoveTo(fromX, fromY, toX, toY, pieceData, playerPosition, skipExactRatio);
    }

    // Check directional capture
    const hasDirectionalCapture = pieceData.up_capture || pieceData.down_capture || pieceData.left_capture || 
                                   pieceData.right_capture || pieceData.up_left_capture || pieceData.up_right_capture ||
                                   pieceData.down_left_capture || pieceData.down_right_capture;
    
    if (hasDirectionalCapture) {
      let directionalAllowed = false;
      const repC = pieceData.repeating_capture;

      if (rowDiff < 0 && colDiff === 0) {
        if (!(skipExactRatio && pieceData.up_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.up_capture, pieceData.up_capture_exact), Math.abs(rowDiff), repC && pieceData.up_capture_exact);
      } else if (rowDiff > 0 && colDiff === 0) {
        if (!(skipExactRatio && pieceData.down_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.down_capture, pieceData.down_capture_exact), Math.abs(rowDiff), repC && pieceData.down_capture_exact);
      } else if (rowDiff === 0 && colDiff < 0) {
        if (!(skipExactRatio && pieceData.left_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.left_capture, pieceData.left_capture_exact), Math.abs(colDiff), repC && pieceData.left_capture_exact);
      } else if (rowDiff === 0 && colDiff > 0) {
        if (!(skipExactRatio && pieceData.right_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.right_capture, pieceData.right_capture_exact), Math.abs(colDiff), repC && pieceData.right_capture_exact);
      } else if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.up_left_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.up_left_capture, pieceData.up_left_capture_exact), Math.abs(rowDiff), repC && pieceData.up_left_capture_exact);
      } else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.up_right_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.up_right_capture, pieceData.up_right_capture_exact), Math.abs(rowDiff), repC && pieceData.up_right_capture_exact);
      } else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.down_left_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.down_left_capture, pieceData.down_left_capture_exact), Math.abs(rowDiff), repC && pieceData.down_left_capture_exact);
      } else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        if (!(skipExactRatio && pieceData.down_right_capture_exact)) directionalAllowed = checkMovement(resolveExact(pieceData.down_right_capture, pieceData.down_right_capture_exact), Math.abs(rowDiff), repC && pieceData.down_right_capture_exact);
      }

      if (directionalAllowed) return true;
    }

    // Check ratio capture
    if (!skipExactRatio) {
    const ratio1 = pieceData.ratio_capture_1 || 0;
    const ratio2 = pieceData.ratio_capture_2 || 0;
    if (ratio1 > 0 && ratio2 > 0) {
      const absRow = Math.abs(rowDiff);
      const absCol = Math.abs(colDiff);
      if (pieceData.repeating_ratio_capture) {
        const maxK = pieceData.max_ratio_capture_iterations === -1 ? Math.max(absRow, absCol) : (pieceData.max_ratio_capture_iterations || 1);
        for (let k = 1; k <= maxK; k++) {
          if ((absRow === k * ratio1 && absCol === k * ratio2) ||
              (absRow === k * ratio2 && absCol === k * ratio1)) {
            return true;
          }
        }
      } else {
        if ((absRow === ratio1 && absCol === ratio2) ||
            (absRow === ratio2 && absCol === ratio1)) {
          return true;
        }
      }
    }
    }

    // Check step capture - use sign-based diagonal exclusion
    const rawStepCaptureValue = pieceData.step_capture_value ?? pieceData.step_by_step_capture;
    const stepCaptureValue = Number(rawStepCaptureValue);
    if (!Number.isNaN(stepCaptureValue) && stepCaptureValue !== 0) {
      const maxSteps = Math.abs(stepCaptureValue);
      const noDiagonal = stepCaptureValue < 0;

      if (noDiagonal) {
        const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
        if (manhattanDistance > 0 && manhattanDistance <= maxSteps) return true;
      } else {
        const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
        if (chebyshevDistance > 0 && chebyshevDistance <= maxSteps) return true;
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
            if (skipExactRatio && opt.exact) continue;
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

    // If piece can capture where it moves, also check movement as fallback
    if (pieceData.can_capture_enemy_on_move === 1 || pieceData.can_capture_enemy_on_move === true) {
      return canPieceMoveTo(fromX, fromY, toX, toY, pieceData, playerPosition, skipExactRatio);
    }

    return false;
  }, [canPieceMoveTo]);

  const isPathClear = useCallback((fromX, fromY, toX, toY, pieces, pieceData, isCapture = false, isExactDirectional = false) => {
    // Ghostwalk: piece can pass through any piece
    const hasGhostwalk = pieceData?.ghostwalk === 1 || pieceData?.ghostwalk === true;
    if (hasGhostwalk) return true;

    const directionalHopDisabled = pieceData?.directional_hop_disabled === 1 || pieceData?.directional_hop_disabled === true;
    const baseCanHopAllies = pieceData?.can_hop_over_allies === 1 || pieceData?.can_hop_over_allies === true;
    const baseCanHopEnemies = pieceData?.can_hop_over_enemies === 1 || pieceData?.can_hop_over_enemies === true;
    const pieceTeam = pieceData?.player_id || pieceData?.team;
    const movingPieceId = pieceData?.id;
    
    const dx = Math.sign(toX - fromX);
    const dy = Math.sign(toY - fromY);
    
    // L-shape or knight-like move
    const xDiff = Math.abs(toX - fromX);
    const yDiff = Math.abs(toY - fromY);
    if (xDiff !== yDiff && xDiff !== 0 && yDiff !== 0) {
      // Ratio/L-shape: directionalHopDisabled does NOT affect these — always use full hop ability
      const canHopAllies = baseCanHopAllies;
      const canHopEnemies = baseCanHopEnemies;

      // If piece can hop over both allies and enemies, no path check needed
      if (canHopAllies && canHopEnemies) return true;

      // Non-hopping ratio piece: check both L-paths, valid if EITHER is clear
      const signX = dx;
      const signY = dy;
      const checkLPath = (squares) => {
        for (const [sx, sy] of squares) {
          const bp = findPieceAt(pieces, sx, sy);
          if (bp && bp.id !== movingPieceId) {
            const bTeam = bp.player_id || bp.team;
            const isAlly = bTeam === pieceTeam;
            if (isAlly && !canHopAllies) return false;
            if (!isAlly && !canHopEnemies) return false;
          }
        }
        return true;
      };
      // Path 1: horizontal first, then vertical
      const path1 = [];
      for (let i = 1; i <= xDiff; i++) path1.push([fromX + signX * i, fromY]);
      for (let j = 1; j < yDiff; j++) path1.push([toX, fromY + signY * j]);
      // Path 2: vertical first, then horizontal
      const path2 = [];
      for (let j = 1; j <= yDiff; j++) path2.push([fromX, fromY + signY * j]);
      for (let i = 1; i < xDiff; i++) path2.push([fromX + signX * i, toY]);

      return checkLPath(path1) || checkLPath(path2);
    }

    // Straight-line (directional) move: apply directionalHopDisabled
    // Hopping allowed if: piece has hop ability AND (flag is off OR move is exact directional)
    const canHopAllies = baseCanHopAllies && (!directionalHopDisabled || isExactDirectional);
    const canHopEnemies = baseCanHopEnemies && (!directionalHopDisabled || isExactDirectional);

    let x = fromX + dx;
    let y = fromY + dy;

    while (x !== toX || y !== toY) {
      const blockingPiece = findPieceAt(pieces, x, y);
      if (blockingPiece && blockingPiece.id !== movingPieceId) {
        const blockingTeam = blockingPiece.player_id || blockingPiece.team;
        const isAlly = blockingTeam === pieceTeam;
        
        if (isAlly && !canHopAllies) return false;
        if (!isAlly && !canHopEnemies) return false;
      }
      x += dx;
      y += dy;
    }

    return true;
  }, [findPieceAt]);

  // Calculate valid moves for a piece (includes ranged attacks)
  const calculateValidMoves = useCallback((piece, pieces, boardWidth, boardHeight) => {
    const moves = [];
    const pieceTeam = piece.player_id || piece.team;
    const pw = piece.piece_width || 1;
    const ph = piece.piece_height || 1;

    // Main loop: check normal moves and captures
    for (let toY = 0; toY < boardHeight; toY++) {
      for (let toX = 0; toX < boardWidth; toX++) {
        if (toX === piece.x && toY === piece.y) continue;

        // Multi-tile bounds check: piece must fit entirely on the board
        if (toX + pw > boardWidth || toY + ph > boardHeight) continue;

        // For multi-tile pieces, find any enemy (or ally if can_capture_allies) in the destination footprint
        let occupyingPiece = null;
        let blockedByInvincible = false;
        if (pw > 1 || ph > 1) {
          for (let dy = 0; dy < ph && !occupyingPiece && !blockedByInvincible; dy++) {
            for (let dx = 0; dx < pw && !occupyingPiece && !blockedByInvincible; dx++) {
              const found = pieces.find(p =>
                p.id !== piece.id && doesPieceOccupySquare(p, toX + dx, toY + dy)
              );
              if (found) {
                const foundTeam = found.player_id || found.team;
                if (found.cannot_be_captured) {
                  blockedByInvincible = true;
                } else if (foundTeam !== pieceTeam || piece.can_capture_allies) {
                  occupyingPiece = found;
                }
              }
            }
          }
          if (blockedByInvincible) continue;
          // Check if any friendly piece (not ourselves) blocks the footprint
          if (!occupyingPiece) {
            const capturedId = null;
            if (!isDestinationClear(piece, toX, toY, pieces.filter(p => {
              const pTeam = p.player_id || p.team;
              return pTeam === pieceTeam && p.id !== piece.id;
            }), capturedId)) continue;
          } else {
            // Even with capture, check destination is clear of friendlies (excluding captured)
            if (!isDestinationClear(piece, toX, toY, pieces.filter(p => {
              const pTeam = p.player_id || p.team;
              return pTeam === pieceTeam && p.id !== piece.id && p.id !== occupyingPiece.id;
            }), null)) continue;
          }
        } else {
          occupyingPiece = findPieceAt(pieces, toX, toY);
          const occupyingTeam = occupyingPiece?.player_id || occupyingPiece?.team;
          // Skip if target piece cannot be captured
          if (occupyingPiece && occupyingPiece.id !== piece.id && occupyingPiece.cannot_be_captured) continue;
          // Skip if a friendly piece (not ourselves) occupies the target (unless can_capture_allies)
          if (occupyingPiece && occupyingPiece.id !== piece.id && occupyingTeam === pieceTeam && !piece.can_capture_allies) continue;
          // Skip moves to squares within the piece's own footprint
          if (occupyingPiece && occupyingPiece.id === piece.id) continue;
        }

        const isCapture = !!(occupyingPiece && occupyingPiece.id !== piece.id);
        const isMultiTile = pw > 1 || ph > 1;
        let isValidMove = false;
        
        // For multi-tile pieces, check movement/capture from all sub-squares
        if (isMultiTile) {
          for (let dy = 0; dy < ph && !isValidMove; dy++) {
            for (let dx = 0; dx < pw && !isValidMove; dx++) {
              if (isCapture) {
                isValidMove = canPieceCaptureTo(piece.x + dx, piece.y + dy, toX + dx, toY + dy, piece, pieceTeam);
              } else {
                isValidMove = canPieceMoveTo(piece.x + dx, piece.y + dy, toX + dx, toY + dy, piece, pieceTeam);
              }
            }
          }
        } else {
          if (isCapture) {
            isValidMove = canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
          } else {
            isValidMove = canPieceMoveTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
          }
        }

        const isStepMove = isMultiTile
          ? (() => {
              for (let dy = 0; dy < ph; dy++) {
                for (let dx = 0; dx < pw; dx++) {
                  if (isStepByStepTarget(piece, piece.x + dx, piece.y + dy, toX + dx, toY + dy)) return true;
                }
              }
              return false;
            })()
          : isStepByStepTarget(piece, piece.x, piece.y, toX, toY);

        // Check if this is a ratio (L-shape) move
        const ratio1 = piece.ratio_movement_1 || piece.ratio_one_movement || 0;
        const ratio2 = piece.ratio_movement_2 || piece.ratio_two_movement || 0;
        const absRowDist = Math.abs(toY - piece.y);
        const absColDist = Math.abs(toX - piece.x);
        let isRatioMove = false;
        if (ratio1 > 0 && ratio2 > 0) {
          if ((absRowDist === ratio1 && absColDist === ratio2) ||
              (absRowDist === ratio2 && absColDist === ratio1)) {
            isRatioMove = true;
          } else if (piece.repeating_ratio) {
            const maxK = piece.max_ratio_iterations === -1 ? Math.max(absRowDist, absColDist) : (piece.max_ratio_iterations || 1);
            for (let k = 2; k <= maxK; k++) {
              if ((absRowDist === k * ratio1 && absColDist === k * ratio2) ||
                  (absRowDist === k * ratio2 && absColDist === k * ratio1)) {
                isRatioMove = true;
                break;
              }
            }
          }
        }
        // Also check ratio capture
        const rc1 = piece.ratio_capture_1 || 0;
        const rc2 = piece.ratio_capture_2 || 0;
        if (!isRatioMove && rc1 > 0 && rc2 > 0 && isCapture) {
          if ((absRowDist === rc1 && absColDist === rc2) ||
              (absRowDist === rc2 && absColDist === rc1)) {
            isRatioMove = true;
          } else if (piece.repeating_ratio_capture) {
            const maxK = piece.max_ratio_capture_iterations === -1 ? Math.max(absRowDist, absColDist) : (piece.max_ratio_capture_iterations || 1);
            for (let k = 2; k <= maxK; k++) {
              if ((absRowDist === k * rc1 && absColDist === k * rc2) ||
                  (absRowDist === k * rc2 && absColDist === k * rc1)) {
                isRatioMove = true;
                break;
              }
            }
          }
        }

        // Determine if this is an exact directional move (for hopping logic)
        const isExactDir = (() => {
          if (isRatioMove || isStepMove) return false;
          const rowDist = toY - piece.y;
          const colDist = toX - piece.x;
          const aR = Math.abs(rowDist);
          const aC = Math.abs(colDist);
          // Determine effective direction (flip for player 2)
          const isP2 = pieceTeam === 2;
          const eR = isP2 ? -rowDist : rowDist;
          const eC = isP2 ? -colDist : colDist;
          if (aC === 0 && aR > 0) {
            return !!(eR < 0 ? piece.up_movement_exact : piece.down_movement_exact);
          }
          if (aR === 0 && aC > 0) {
            return !!(eC < 0 ? piece.left_movement_exact : piece.right_movement_exact);
          }
          if (aR === aC && aR > 0) {
            if (eR < 0 && eC < 0) return !!piece.up_left_movement_exact;
            if (eR < 0 && eC > 0) return !!piece.up_right_movement_exact;
            if (eR > 0 && eC < 0) return !!piece.down_left_movement_exact;
            if (eR > 0 && eC > 0) return !!piece.down_right_movement_exact;
          }
          return false;
        })();

        let pathClear = false;
        if (isStepMove) {
          pathClear = canReachStepByStep(piece, toX, toY, pieces, boardWidth, boardHeight, isCapture);
        } else if (isMultiTile) {
          // For multi-tile, check path from ALL sub-squares to their destination sub-squares
          pathClear = true;
          for (let dy = 0; dy < ph && pathClear; dy++) {
            for (let dx = 0; dx < pw && pathClear; dx++) {
              if (!isPathClear(piece.x + dx, piece.y + dy, toX + dx, toY + dy, pieces, piece, isCapture, isExactDir)) {
                pathClear = false;
              }
            }
          }
        } else {
          pathClear = isPathClear(piece.x, piece.y, toX, toY, pieces, piece, isCapture, isExactDir);
        }

        // For repeating ratio moves, check intermediate landing positions are clear
        if (pathClear && isRatioMove) {
          const rr1 = isCapture ? (rc1 || ratio1) : ratio1;
          const rr2 = isCapture ? (rc2 || ratio2) : ratio2;
          if (rr1 > 0 && rr2 > 0) {
            // Determine which ratio orientation matches: (r1,r2) or (r2,r1)
            let stepRow = 0, stepCol = 0;
            const rowSign = Math.sign(toY - piece.y);
            const colSign = Math.sign(toX - piece.x);
            if (absRowDist > 0 && absColDist > 0) {
              if (absRowDist % rr1 === 0 && absColDist % rr2 === 0 && absRowDist / rr1 === absColDist / rr2) {
                stepRow = rr1 * rowSign; stepCol = rr2 * colSign;
              } else if (absRowDist % rr2 === 0 && absColDist % rr1 === 0 && absRowDist / rr2 === absColDist / rr1) {
                stepRow = rr2 * rowSign; stepCol = rr1 * colSign;
              }
            }
            if (stepRow !== 0 || stepCol !== 0) {
              let cx = piece.x + stepCol;
              let cy = piece.y + stepRow;
              while (cx !== toX || cy !== toY) {
                const blocking = findPieceAt(pieces, cx, cy);
                if (blocking && blocking.id !== piece.id) {
                  pathClear = false;
                  break;
                }
                cx += stepCol;
                cy += stepRow;
              }
            }
          }
        }

        // Hop capture: piece has capture_on_hop, destination is empty, enemies are in the path.
        // capture_on_hop inherently means the piece hops over enemies to capture them (like checkers),
        // so enemies in the path are always hoppable — no separate can_hop_over_enemies flag needed.
        // The destination must be within the piece's normal movement/capture range.
        let isHopCapture = false;
        let hopCapturedPieceIds = [];
        if (!isCapture && piece.capture_on_hop && !isStepMove && !isRatioMove) {
          // Hop capture only works if the destination is within the piece's actual movement/capture range.
          // isValidMove already tells us if normal movement covers this square.
          // If not, check if the capture range covers it (since destination is empty, normal capture
          // wouldn't apply, but hop capture uses the same directional ranges).
          let hopDirValid = isValidMove;
          if (!hopDirValid) {
            // Check if the piece's capture range covers this destination distance
            hopDirValid = canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam);
          }
          if (hopDirValid) {
            // Walk the path: enemies are capture targets (always hoppable for capture_on_hop),
            // allies block unless the piece has ally-hop ability.
            const canHopAllies = piece.can_hop_over_allies === 1 || piece.can_hop_over_allies === true;
            const hopCapturedSet = new Set();
            let hopBlocked = false;
            const subSquareCount = isMultiTile ? pw * ph : 1;
            for (let si = 0; si < subSquareCount && !hopBlocked; si++) {
              const sdx = si % pw;
              const sdy = Math.floor(si / pw);
              const fx = piece.x + sdx;
              const fy = piece.y + sdy;
              const tx = toX + sdx;
              const ty = toY + sdy;
              const dx = Math.sign(tx - fx);
              const dy = Math.sign(ty - fy);
              const xDiff = Math.abs(tx - fx);
              const yDiff = Math.abs(ty - fy);
              if (xDiff === yDiff || xDiff === 0 || yDiff === 0) {
                let cx = fx + dx;
                let cy = fy + dy;
                while ((cx !== tx || cy !== ty) && !hopBlocked) {
                  const hopPiece = findPieceAt(pieces, cx, cy);
                  if (hopPiece && hopPiece.id !== piece.id) {
                    const hopTeam = hopPiece.player_id || hopPiece.team;
                    if (hopTeam !== pieceTeam) {
                      hopCapturedSet.add(hopPiece.id);
                    } else if (!canHopAllies) {
                      hopBlocked = true;
                    }
                  }
                  cx += dx;
                  cy += dy;
                }
              }
            }
            if (!hopBlocked && hopCapturedSet.size > 0) {
              hopCapturedPieceIds = [...hopCapturedSet];
              isHopCapture = true;
              isValidMove = true;
              pathClear = true;
            }
          }
        }

        // Hop-only restriction: if exact_ratio_hop_only is set and no hop occurred,
        // re-validate excluding exact directional and ratio abilities.
        // If the move only works via exact/ratio, reject it (nothing was hopped over).
        if (piece.exact_ratio_hop_only && isValidMove && pathClear && !isHopCapture && !isStepMove && !isRatioMove) {
          const stillValid = isCapture
            ? canPieceCaptureTo(piece.x, piece.y, toX, toY, piece, pieceTeam, true)
            : canPieceMoveTo(piece.x, piece.y, toX, toY, piece, pieceTeam, true);
          if (!stillValid) {
            // Move relies on exact/ratio — only allow if something was hopped in the path
            let hasHop = false;
            const hdx = Math.sign(toX - piece.x);
            const hdy = Math.sign(toY - piece.y);
            const hxDiff = Math.abs(toX - piece.x);
            const hyDiff = Math.abs(toY - piece.y);
            if (hxDiff === hyDiff || hxDiff === 0 || hyDiff === 0) {
              let hx = piece.x + hdx;
              let hy = piece.y + hdy;
              while (hx !== toX || hy !== toY) {
                const hp = findPieceAt(pieces, hx, hy);
                if (hp && hp.id !== piece.id) { hasHop = true; break; }
                hx += hdx;
                hy += hdy;
              }
            }
            if (!hasHop) isValidMove = false;
          }
        }
        // For ratio moves with hop-only: always require a hop
        if (piece.exact_ratio_hop_only && isValidMove && pathClear && !isHopCapture && isRatioMove) {
          isValidMove = false;
        }

        if (isValidMove && pathClear) {
          const isFirstMoveOnly = (isCapture || isHopCapture)
            ? checkIfFirstMoveOnlyCapture(piece, piece.x, piece.y, toX, toY, pieceTeam)
            : checkIfFirstMoveOnlyMove(piece, piece.x, piece.y, toX, toY, pieceTeam);
          
          moves.push({ x: toX, y: toY, isCapture: isCapture || isHopCapture, isHopCapture, hopCapturedPieceIds, isFirstMoveOnly, isRangedAttack: false });
        }
      }
    }

    // Separate loop: check ranged attack targets (matches LiveGame pattern)
    if (piece.can_capture_enemy_via_range) {
      for (let toY = 0; toY < boardHeight; toY++) {
        for (let toX = 0; toX < boardWidth; toX++) {
          if (toX === piece.x && toY === piece.y) continue;
          const targetPiece = findPieceAt(pieces, toX, toY);
          const targetTeam = targetPiece?.player_id || targetPiece?.team;
          // Skip friendly pieces - show all other squares within range
          if (targetPiece && targetTeam === pieceTeam) continue;
          // Skip pieces that cannot be captured
          if (targetPiece && targetPiece.cannot_be_captured) continue;
          // Already in moves as a regular capture? Skip to avoid duplicates
          if (moves.some(m => m.x === toX && m.y === toY)) continue;
          // For multi-tile, check ranged from any sub-square
          let canRanged = false;
          for (let dr = 0; dr < ph && !canRanged; dr++) {
            for (let dc = 0; dc < pw && !canRanged; dc++) {
              canRanged = canRangedAttackTo(piece.y + dr, piece.x + dc, toY, toX, piece, pieceTeam);
            }
          }
          if (canRanged) {
            // Check if ranged path is clear (blocked by pieces unless can fire over)
            if (!isRangedPathClear(piece.x, piece.y, toX, toY, piece, pieces, pieceTeam)) {
              continue;
            }
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
  }, [canPieceMoveTo, canPieceCaptureTo, isPathClear, isStepByStepTarget, canReachStepByStep, findPieceAt, checkIfFirstMoveOnlyMove, checkIfFirstMoveOnlyCapture]);

  // Handle square click - free repositioning (click piece, click destination)
  const handleSquareClick = useCallback((x, y) => {
    if (!activeSandbox) return;

    const pieces = activeSandbox.pieces;
    const clickedPiece = findPieceAt(pieces, x, y);

    if (selectedPiece) {
      // If clicking the anchor square of the same piece, deselect
      if (clickedPiece && clickedPiece.id === selectedPiece.id &&
          x === selectedPiece.x && y === selectedPiece.y) {
        setSelectedPiece(null);
        setValidMoves([]);
        return;
      }

      // If clicking another piece of the same team (not an extension of selected piece), select it instead
      // Unless the selected piece can capture allies and the clicked ally is a valid capture target
      const selectedTeam = selectedPiece.team || selectedPiece.player_id;
      if (clickedPiece && clickedPiece.id !== selectedPiece.id &&
          (clickedPiece.team === selectedTeam || clickedPiece.player_id === selectedTeam)) {
        if (!selectedPiece.can_capture_allies || !validMoves.some(m => m.isCapture && m.x === x && m.y === y)) {
          setSelectedPiece(clickedPiece);
          setValidMoves([]);
          return;
        }
      }

      // Check if the click target is a valid game move (including hop captures)
      const spw = selectedPiece.piece_width || 1;
      const sph = selectedPiece.piece_height || 1;
      const boardWidth = activeSandbox.gameType.board_width || 8;
      const boardHeight = activeSandbox.gameType.board_height || 8;
      let move = validMoves.find(m => m.x === x && m.y === y);
      // Multi-tile: when exact anchor match fails, find the valid move whose footprint covers the clicked square
      if (!move && (spw > 1 || sph > 1)) {
        const candidates = validMoves.filter(m => !m.isRangedAttack &&
          x >= m.x && x < m.x + spw && y >= m.y && y < m.y + sph);
        if (candidates.length === 1) {
          move = candidates[0];
        } else if (candidates.length > 1) {
          move = candidates.reduce((best, m) => {
            const d = Math.abs(m.x - selectedPiece.x) + Math.abs(m.y - selectedPiece.y);
            const bd = Math.abs(best.x - selectedPiece.x) + Math.abs(best.y - selectedPiece.y);
            return d < bd ? m : best;
          });
        }
      }
      if (move) {
        // Execute game move with hop capture support
        // Use the move's anchor position, which may differ from click position for multi-tile pieces
        const targetX = move.x;
        const targetY = move.y;
        let piecesToRemove = new Set();
        if (move.isHopCapture && move.hopCapturedPieceIds) {
          move.hopCapturedPieceIds.forEach(id => piecesToRemove.add(id));
        }
        if (move.isCapture && !move.isRangedAttack && !move.isHopCapture) {
          const pieceTeam = selectedPiece.player_id || selectedPiece.team;
          for (let dy = 0; dy < sph; dy++) {
            for (let dx = 0; dx < spw; dx++) {
              const found = findPieceAt(pieces, targetX + dx, targetY + dy);
              if (found && found.id !== selectedPiece.id) {
                const foundTeam = found.player_id || found.team;
                if (foundTeam !== pieceTeam || selectedPiece.can_capture_allies) {
                  piecesToRemove.add(found.id);
                }
              }
            }
          }
        }
        if (move.isRangedAttack && move.isCapture) {
          const target = findPieceAt(pieces, targetX, targetY);
          if (target) piecesToRemove.add(target.id);
        }

        const updatedPieces = piecesToRemove.size > 0
          ? pieces.filter(p => !piecesToRemove.has(p.id))
          : [...pieces];
        const movedPieces = move.isRangedAttack
          ? updatedPieces
          : updatedPieces.map(p =>
              p.id === selectedPiece.id ? { ...p, x: targetX, y: targetY } : p
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
                  from: { x: selectedPiece.x, y: selectedPiece.y },
                  to: { x: targetX, y: targetY },
                  piece: selectedPiece.piece_name,
                  piece_width: spw,
                  piece_height: sph
                }]
              }
            : s
        ));

        setSelectedPiece(null);
        setValidMoves([]);
        return;
      }

      // Free reposition: move piece to target (fallback when no valid game move)
      // Snap to board edge if piece would extend off-board
      if (x + spw > boardWidth) x = boardWidth - spw;
      if (y + sph > boardHeight) y = boardHeight - sph;
      if (x < 0) x = 0;
      if (y < 0) y = 0;
      // Block reposition if any other piece occupies the destination footprint
      let blocked = false;
      for (let dy = 0; dy < sph; dy++) {
        for (let dx = 0; dx < spw; dx++) {
          const found = findPieceAt(pieces, x + dx, y + dy);
          if (found && found.id !== selectedPiece.id) {
            blocked = true;
            break;
          }
        }
        if (blocked) break;
      }
      if (blocked) {
        setSelectedPiece(null);
        setValidMoves([]);
        return;
      }

      const movedPieces = pieces.map(p =>
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
                piece_width: selectedPiece.piece_width || 1,
                piece_height: selectedPiece.piece_height || 1,
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
        const boardWidth = activeSandbox.gameType.board_width || 8;
        const boardHeight = activeSandbox.gameType.board_height || 8;
        const moves = calculateValidMoves(clickedPiece, pieces, boardWidth, boardHeight);
        setValidMoves(moves);
      }
    }
  }, [activeSandbox, activeSandboxId, selectedPiece, validMoves, findPieceAt, calculateValidMoves]);

  // Handle Delete key to remove selected piece
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedPiece && activeSandbox) {
          e.preventDefault();
          removePieceFromBoard(selectedPiece.id);
          setSelectedPiece(null);
          setValidMoves([]);
        }
      } else if (e.key === 'Escape') {
        setSelectedPiece(null);
        setValidMoves([]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPiece, activeSandbox, removePieceFromBoard]);

  // Handle long press for mobile - only for adding pieces
  const handleLongPress = useCallback((x, y) => {
    if (!activeSandbox) return;

    const piece = findPieceAt(activeSandbox.pieces, x, y);
    if (!piece) {
      // Long press on empty square opens add-piece modal
      setRightClickPosition({ row: y, col: x });
      setRightClickMode('piece');
      setShowRightClickModal(true);
    }
    // If there's a piece, do nothing - use the Delete button instead
  }, [activeSandbox, findPieceAt]);

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

    const piece = findPieceAt(activeSandbox.pieces, x, y);
    rightClickDataRef.current = {
      piece, x, y, time: Date.now(),
      clientX: e.clientX, clientY: e.clientY,
      isDrag: false
    };

    if (piece && piece.can_capture_enemy_via_range) {
      // For ranged pieces, activate global listeners to detect drag vs click
      setIsRightClickActive(true);
    }
  }, [activeSandbox, findPieceAt]);

  // Handle contextmenu on square - only for adding pieces to empty squares
  const handleSquareContextMenu = useCallback((e, x, y) => {
    e.preventDefault();
    if (!activeSandbox) return;

    const data = rightClickDataRef.current;
    // If a ranged right-click is pending (global listeners active), don't do normal action
    if (data && data.piece?.can_capture_enemy_via_range) return;

    // Only open add-piece modal on empty squares (don't delete on right-click)
    const piece = findPieceAt(activeSandbox.pieces, x, y);
    if (!piece) {
      setRightClickPosition({ row: y, col: x });
      setRightClickMode('piece');
      setShowRightClickModal(true);
    }
    // If there's a piece, do nothing - use select + Delete key instead
    rightClickDataRef.current = null;
  }, [activeSandbox, findPieceAt]);

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
          const targetPiece = findPieceAt(pieces, target.x, target.y);
          const sourceTeam = data.piece.player_id || data.piece.team;
          const targetTeam = targetPiece?.player_id || targetPiece?.team;

          if (targetPiece && targetTeam !== sourceTeam &&
              canRangedAttackTo(data.piece.y, data.piece.x, target.y, target.x, data.piece, sourceTeam) &&
              isRangedPathClear(data.piece.x, data.piece.y, target.x, target.y, data.piece, pieces, sourceTeam)) {
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
        // Was a quick click — select the piece for potential deletion instead
        if (data.piece) {
          setSelectedPiece(data.piece);
          setValidMoves([]);
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
  }, [isRightClickActive, activeSandbox, activeSandboxId, removePieceFromBoard, findPieceAt]);

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

  // Handle piece hover - compute independent per-square move/capture/ranged like GameTypeView
  const handlePieceHover = useCallback((piece) => {
    if (!activeSandbox || !piece || !showHighlights) {
      setHoveredPiece(null);
      setHoveredHighlights({});
      return;
    }

    const boardWidth = activeSandbox.gameType.board_width || 8;
    const boardHeight = activeSandbox.gameType.board_height || 8;
    const hpw = piece.piece_width || 1;
    const hph = piece.piece_height || 1;
    const hTeam = piece.player_id || piece.team;
    const highlights = {};

    for (let ty = 0; ty < boardHeight; ty++) {
      for (let tx = 0; tx < boardWidth; tx++) {
        // Skip squares within the piece's own footprint
        if (tx >= piece.x && tx < piece.x + hpw && ty >= piece.y && ty < piece.y + hph) continue;

        let canMove = false, canCapture = false, canRanged = false, canHopCapture = false;
        for (let dr = 0; dr < hph && !canMove; dr++) {
          for (let dc = 0; dc < hpw && !canMove; dc++) {
            if (canPieceMoveTo(piece.x + dc, piece.y + dr, tx, ty, piece, hTeam)) canMove = true;
          }
        }
        for (let dr = 0; dr < hph && !canCapture; dr++) {
          for (let dc = 0; dc < hpw && !canCapture; dc++) {
            if (canPieceCaptureTo(piece.x + dc, piece.y + dr, tx, ty, piece, hTeam)) canCapture = true;
          }
        }
        if (piece.can_capture_enemy_via_range) {
          for (let dr = 0; dr < hph && !canRanged; dr++) {
            for (let dc = 0; dc < hpw && !canRanged; dc++) {
              canRanged = canRangedAttackTo(piece.y + dr, piece.x + dc, ty, tx, piece, hTeam);
            }
          }
        }
        if (piece.capture_on_hop) {
          for (let dr = 0; dr < hph && !canHopCapture; dr++) {
            for (let dc = 0; dc < hpw && !canHopCapture; dc++) {
              canHopCapture = canHopCaptureToUtil(piece.y + dr, piece.x + dc, ty, tx, piece, hTeam);
            }
          }
        }

        if (canMove || canCapture || canRanged || canHopCapture) {
          highlights[`${tx},${ty}`] = { canMove, canCapture, canRanged, canHopCapture };
        }
      }
    }

    setHoveredPiece(piece);
    setHoveredHighlights(highlights);
  }, [activeSandbox, canPieceMoveTo, canPieceCaptureTo, showHighlights]);

  // Handle drag start for pieces on the board (game movement with validation)
  const handleBoardPieceDragStart = useCallback((e, piece) => {
    if (!activeSandbox) return;
    
    // Calculate grab offset within the piece footprint for multi-tile pieces
    const pw = piece.piece_width || 1;
    const ph = piece.piece_height || 1;
    let grabOffsetX = 0;
    let grabOffsetY = 0;
    if (pw > 1 || ph > 1) {
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;
      const cellWidth = rect.width / pw;
      const cellHeight = rect.height / ph;
      grabOffsetX = Math.floor(relX / cellWidth);
      grabOffsetY = Math.floor(relY / cellHeight);
    }
    
    setTimeout(() => {
    
    setIsDragging(true);
    }, 0);
    
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify({
      ...piece,
      fromBoard: true,
      originalX: piece.x,
      originalY: piece.y,
      grabOffsetX,
      grabOffsetY
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
          // Adjust drop coordinates for multi-tile grab offset
          let anchorX = x - (pieceData.grabOffsetX || 0);
          let anchorY = y - (pieceData.grabOffsetY || 0);
          
          // Don't allow dropping on the same square
          if (pieceData.originalX === anchorX && pieceData.originalY === anchorY) {
            setSelectedPiece(null);
            setValidMoves([]);
            return;
          }
          
          // Check if target is a valid move
          const pw = pieceData.piece_width || 1;
          const ph = pieceData.piece_height || 1;
          let move = validMoves.find(m => m.x === anchorX && m.y === anchorY);
          // Multi-tile: when exact anchor match fails, find the valid move whose footprint covers the drop square
          if (!move && (pw > 1 || ph > 1)) {
            const candidates = validMoves.filter(m => !m.isRangedAttack &&
              x >= m.x && x < m.x + pw && y >= m.y && y < m.y + ph);
            if (candidates.length === 1) {
              move = candidates[0];
            } else if (candidates.length > 1) {
              move = candidates.reduce((best, m) => {
                const d = Math.abs(m.x - anchorX) + Math.abs(m.y - anchorY);
                const bd = Math.abs(best.x - anchorX) + Math.abs(best.y - anchorY);
                return d < bd ? m : best;
              });
            }
            if (move) {
              anchorX = move.x;
              anchorY = move.y;
            }
          }
          if (move) {
            // Execute game move with turn switch
            const pieces = activeSandbox.pieces;
            
            // Scan the entire destination footprint for the capture target
            // (for multi-tile pieces the enemy may not be at the anchor)
            let targetPiece = null;
            if (move.isCapture && !move.isRangedAttack) {
              const pieceTeam = pieceData.player_id || pieceData.team;
              for (let dy = 0; dy < ph && !targetPiece; dy++) {
                for (let dx = 0; dx < pw && !targetPiece; dx++) {
                  const found = findPieceAt(pieces, anchorX + dx, anchorY + dy);
                  if (found && found.id !== pieceData.id) {
                    const foundTeam = found.player_id || found.team;
                    if (foundTeam !== pieceTeam || pieceData.can_capture_allies) {
                      targetPiece = found;
                    }
                  }
                }
              }
            }
            
            // For hop captures, remove all hopped-over enemies
            let piecesToRemove = new Set();
            if (move.isHopCapture && move.hopCapturedPieceIds) {
              move.hopCapturedPieceIds.forEach(id => piecesToRemove.add(id));
            }
            if (targetPiece) {
              piecesToRemove.add(targetPiece.id);
            }
            
            const updatedPieces = piecesToRemove.size > 0
              ? pieces.filter(p => !piecesToRemove.has(p.id))
              : [...pieces];
            const movedPieces = updatedPieces.map(p =>
              p.id === pieceData.id ? { ...p, x: anchorX, y: anchorY } : p
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
                      to: { x: anchorX, y: anchorY },
                      piece: pieceData.piece_name,
                      piece_width: pieceData.piece_width || 1,
                      piece_height: pieceData.piece_height || 1
                    }]
                  }
                : s
            ));
          }
          // Clear selection state whether move succeeded or not
          setIsDragging(false);
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
  }, [activeSandbox, activeSandboxId, addPieceToBoard, validMoves, findPieceAt]);

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
    // Calculate square size to fit within max dimensions while keeping squares square
    // Account for layout: stacked (≤900px) vs sidebar (>900px), plus board border/padding
    const maxBoardSize = Math.min(600, windowWidth <= 1200 ? windowWidth - 90 : windowWidth - 650);
    const squareSize = Math.min(60, maxBoardSize / Math.max(boardWidth, boardHeight));
    const pieces = activeSandbox.pieces;
    const specialSquares = activeSandbox.specialSquares || {};

    const squares = [];

    for (let y = 0; y < boardHeight; y++) {
      for (let x = 0; x < boardWidth; x++) {
        const isLight = (x + y) % 2 === 0;
        // Multi-tile aware: find piece whose footprint covers this square
        const piece = pieces.find(p => {
          const pw = p.piece_width || 1;
          const ph = p.piece_height || 1;
          return x >= p.x && x < p.x + pw && y >= p.y && y < p.y + ph;
        });
        const isAnchor = piece && piece.x === x && piece.y === y;
        const isSelected = selectedPiece && (
          x >= selectedPiece.x && x < selectedPiece.x + (selectedPiece.piece_width || 1) &&
          y >= selectedPiece.y && y < selectedPiece.y + (selectedPiece.piece_height || 1)
        );
        // Find regular and ranged moves separately so both styles can overlap
        // Multi-tile aware: highlight all squares the piece would cover at each valid destination
        // But don't highlight squares within the selected piece's current footprint
        const spw = selectedPiece?.piece_width || 1;
        const sph = selectedPiece?.piece_height || 1;
        const inSelectedFootprint = selectedPiece && (
          x >= selectedPiece.x && x < selectedPiece.x + spw &&
          y >= selectedPiece.y && y < selectedPiece.y + sph
        );
        const regularMove = showHighlights && !inSelectedFootprint ? validMoves.find(m => !m.isRangedAttack &&
          x >= m.x && x < m.x + spw && y >= m.y && y < m.y + sph
        ) : null;
        const rangedMove = showHighlights ? validMoves.find(m => m.x === x && m.y === y && m.isRangedAttack) : null;

        // Hover highlight: look up pre-computed per-square move/capture/ranged from hoveredHighlights
        const hovHighlight = (!selectedPiece && hoveredPiece) ? hoveredHighlights[`${x},${y}`] : null;

        const isLastMoveFrom = showHighlights && lastMove && (() => {
          const lmpw = lastMove.piece_width || 1;
          const lmph = lastMove.piece_height || 1;
          return x >= lastMove.from.x && x < lastMove.from.x + lmpw
            && y >= lastMove.from.y && y < lastMove.from.y + lmph;
        })();
        const isLastMoveTo = showHighlights && lastMove && (() => {
          const lmpw = lastMove.piece_width || 1;
          const lmph = lastMove.piece_height || 1;
          return x >= lastMove.to.x && x < lastMove.to.x + lmpw
            && y >= lastMove.to.y && y < lastMove.to.y + lmph;
        })();
        const specialSquareType = specialSquares[`${x},${y}`];

        // Check ranged attack highlights
        const isRangedMove = !!rangedMove;
        // During ranged drag, highlight all valid ranged target squares (including empty)
        const rangedSourceTeam = rangedAttackSource?.player_id || rangedAttackSource?.team;
        const isRangedDragTarget = rangedAttackSource && showHighlights
          && !(piece && ((piece.player_id || piece.team) === rangedSourceTeam))
          && canRangedAttackTo(rangedAttackSource.y, rangedAttackSource.x, y, x, rangedAttackSource, rangedSourceTeam)
          && isRangedPathClear(rangedAttackSource.x, rangedAttackSource.y, x, y, rangedAttackSource, activeSandbox?.pieces || [], rangedSourceTeam);

        // Compute overlay highlight style for selected/dragged piece (validMoves)
        const selCanMove = !!(regularMove && !regularMove.isCapture);
        const selMoveFirstOnly = selCanMove && !!regularMove.isFirstMoveOnly;
        const selCanCapture = !!(regularMove && regularMove.isCapture);
        const selCaptureFirstOnly = selCanCapture && !!regularMove.isFirstMoveOnly;
        const selCanRanged = isRangedMove || isRangedDragTarget;
        const { style: selHighlightStyle, icon: selHighlightIcon } = (selCanMove || selCanCapture || selCanRanged)
          ? getSquareHighlightStyle(selCanMove, selMoveFirstOnly, selCanCapture, selCaptureFirstOnly, selCanRanged, isLight)
          : { style: {}, icon: null };

        // Compute overlay highlight style for hovered piece (independent per-square checks, like GameTypeView)
        const hovCanMove = !!hovHighlight?.canMove;
        const hovCanCapture = !!hovHighlight?.canCapture;
        const hovCanRanged = !!hovHighlight?.canRanged;
        const hovCanHopCapture = !!hovHighlight?.canHopCapture;
        const { style: hovHighlightStyle, icon: hovHighlightIcon } = (hovCanMove || hovCanCapture || hovCanRanged)
          ? getSquareHighlightStyle(hovCanMove, false, hovCanCapture, false, hovCanRanged, isLight)
          : { style: {}, icon: null };

        // Use selected piece highlights if active, otherwise use hovered piece highlights
        // Hop capture green is additive — shown as a separate overlay on top of other highlights
        const showHopCaptureOverlay = !selectedPiece && hovCanHopCapture;
        const activeHighlightStyle = (selHighlightStyle.outline || selHighlightStyle.borderTop) ? selHighlightStyle : hovHighlightStyle;
        const activeHighlightIcon = selHighlightIcon || hovHighlightIcon;

        squares.push(
          <div
            key={`${x}-${y}`}
            className={`
              ${styles["board-square"]}
              ${isLight ? styles.light : styles.dark}
              ${isSelected ? styles.selected : ''}
              ${isLastMoveFrom ? styles["last-move-from"] : ''}
              ${isLastMoveTo ? styles["last-move-to"] : ''}
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
                  : (currentUser?.dark_square_color || '#08234d'),
              ...(isAnchor && piece && ((piece.piece_width || 1) > 1 || (piece.piece_height || 1) > 1) ? { zIndex: 10 } : {})
            }}
          >
            <SquareHighlightOverlay
              highlightStyle={activeHighlightStyle}
              highlightIcon={activeHighlightIcon}
              canHopCapture={showHopCaptureOverlay}
              squareSize={squareSize}
              isLight={isLight}
            />
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
                overflow: 'hidden',
                top: 0,
                left: 0,
                ...(isDragging ? { pointerEvents: 'none' } : {})
              } : {};
              return (
              <div
                className={`${styles.piece} ${styles.draggable}`}
                style={multiTileStyle}
                draggable={true}
                onDragStart={(e) => handleBoardPieceDragStart(e, piece)}
                onDragEnd={() => {
                  setIsDragging(false);
                  setSelectedPiece(null);
                  setValidMoves([]);
                }}
                onMouseEnter={() => handlePieceHover(piece)}
                onMouseLeave={() => handlePieceHover(null)}
              >
                {boardAnimationsEnabled && isMultiTile && (
                  <>
                    <div className={styles["multi-tile-smoke"]} />
                    <div className={styles["multi-tile-electric"]} />
                  </>
                )}
                {isNonSquareMultiTile ? (
                  <div
                    ref={(el) => applySvgStretchBackground(el, getBoardPieceImage(piece))}
                    style={{
                      width: '100%',
                      height: '100%',
                      ...(pieceShadowEnabled ? { filter: 'drop-shadow(3px 3px 4px rgba(0, 0, 0, 0.5))' } : {})
                    }}
                    draggable={false}
                  />
                ) : (
                  <img
                    src={getBoardPieceImage(piece)}
                    alt={piece.piece_name}
                    draggable={false}
                    {...(pieceShadowEnabled ? { style: { filter: 'drop-shadow(3px 3px 4px rgba(0, 0, 0, 0.5))' } } : {})}
                  />
                )}
              </div>
              );
            })()}
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
            gridTemplateColumns: `repeat(${boardWidth}, ${squareSize}px)`,
            gridTemplateRows: `repeat(${boardHeight}, ${squareSize}px)`,
            width: 'fit-content',
            maxWidth: 'none',
            maxHeight: 'none',
            aspectRatio: 'unset'
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
          {selectedPiece && (
            <button
              onClick={() => {
                removePieceFromBoard(selectedPiece.id);
                setSelectedPiece(null);
                setValidMoves([]);
              }}
              className={styles["btn-delete"]}
              title="Delete selected piece (or press Delete key)"
            >
              🗑️ Delete {selectedPiece.piece_name || 'Piece'}
            </button>
          )}
        </div>
        {showHighlights && (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            justifyContent: 'center',
            margin: '10px 0',
            fontSize: '0.85rem',
            color: '#ccc'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '18px', height: '18px', outline: '3px solid rgba(33, 150, 243, 0.55)', outlineOffset: '-3px', background: 'rgba(33, 150, 243, 0.1)', borderRadius: '3px' }}></div>
              <span>Movement</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '18px', height: '18px', outline: '3px solid rgba(156, 39, 176, 0.55)', outlineOffset: '-3px', background: 'rgba(156, 39, 176, 0.1)', borderRadius: '3px' }}></div>
              <span>First Move</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '18px', height: '18px', outline: '3px solid rgba(255, 152, 0, 0.55)', outlineOffset: '-3px', background: 'rgba(255, 152, 0, 0.1)', borderRadius: '3px' }}></div>
              <span>Attack</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '18px', height: '18px', outline: '3px solid rgba(233, 30, 99, 0.55)', outlineOffset: '-3px', background: 'rgba(233, 30, 99, 0.1)', borderRadius: '3px' }}></div>
              <span>First Attack</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '18px', height: '18px', borderTop: '3px solid rgba(33, 150, 243, 0.55)', borderLeft: '3px solid rgba(33, 150, 243, 0.55)', borderBottom: '3px solid rgba(255, 152, 0, 0.55)', borderRight: '3px solid rgba(255, 152, 0, 0.55)', boxSizing: 'border-box', background: 'linear-gradient(135deg, rgba(33, 150, 243, 0.1) 50%, rgba(255, 152, 0, 0.1) 50%)', borderRadius: '3px' }}></div>
              <span>Move + Attack</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '18px', height: '18px', outline: '3px solid rgba(244, 67, 54, 0.55)', outlineOffset: '-3px', background: 'rgba(244, 67, 54, 0.1)', borderRadius: '3px' }}></div>
              <span>Ranged 💥</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '18px', height: '18px', outline: '3px solid rgba(76, 175, 80, 0.7)', outlineOffset: '-3px', background: 'rgba(76, 175, 80, 0.2)', borderRadius: '3px' }}></div>
              <span>Capture on Hop</span>
            </div>
          </div>
        )}
        <div className={styles["board-instructions"]}>
          <div className={styles["instruction-item"]}>
            <span className={styles["instruction-icon"]}>♟</span>
            <strong>Move &amp; Capture:</strong> Drag piece to a valid square
          </div>
          <div className={styles["instruction-item"]}>
            <span className={styles["instruction-icon"]}>✋</span>
            <strong>Reposition:</strong> Click piece, then click any square
          </div>
          <div className={styles["instruction-item"]}>
            <span className={styles["instruction-icon"]}>➕</span>
            <strong>Add:</strong> {isMobile ? 'Long press empty square' : 'Right-click empty square'}
          </div>
          <div className={styles["instruction-item"]}>
            <span className={styles["instruction-icon"]}>❌</span>
            <strong>Remove:</strong> {isMobile ? 'Select piece, tap Delete button' : 'Select piece, press Delete key'}
          </div>
          <div className={styles["instruction-item"]}>
            <span className={styles["instruction-icon"]}>🎯</span>
            <strong>Ranged Attack:</strong> Right-click and drag from ranged piece to target
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
