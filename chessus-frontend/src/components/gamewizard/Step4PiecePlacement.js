import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import styles from "./gamewizard.module.scss";
import PieceSelector from "./PieceSelector";
import PiecesService from "../../services/pieces.service";
import { isMobileDevice, isTouchDevice } from "../../helpers/mobileUtils";
import { 
  canPieceMoveTo as canPieceMoveToUtil,
  canCaptureOnMoveTo as canCaptureOnMoveToUtil,
  canRangedAttackTo as canRangedAttackToUtil,
  canHopCaptureToUtil,
  getSquareHighlightStyle
} from "../../helpers/pieceMovementUtils";

import { applySvgStretchBackground } from "../../helpers/svgStretchUtils";
import InfoTooltip from "../piecewizard/InfoTooltip";
import NumberInput from "../common/NumberInput";
import BoardLegend from "../common/BoardLegend";
import PieceBadges from "../common/PieceBadges";
import SquareHighlightOverlay from "../common/SquareHighlightOverlay";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

const getImageUrl = (imagePath) => {
  if (!imagePath) return null;
  if (imagePath.startsWith('http')) return imagePath;
  return `${ASSET_URL}${imagePath}`;
};

const Step5PiecePlacement = ({ gameData, updateGameData }) => {
  const [piecePlacements, setPiecePlacements] = useState({});
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [showPieceSelector, setShowPieceSelector] = useState(false);
  const [draggedPiece, setDraggedPiece] = useState(null);
  const [allowedStartingModes, setAllowedStartingModes] = useState(['none', 'backrow', 'mirrored', 'independent', 'shared', 'full']); // All enabled by default
  const [pieceDataMap, setPieceDataMap] = useState({});
  const [, setHoveredSquare] = useState(null);
  const [hoveredPiecePosition, setHoveredPiecePosition] = useState(null);
  const [draggedPiecePosition, setDraggedPiecePosition] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  const [randomizationOpen, setRandomizationOpen] = useState(false);
  const [hpAdSectionOpen, setHpAdSectionOpen] = useState(false);
  const longPressTimeoutRef = useRef(null);
  
  // Check if the board setup is symmetric (for mirrored randomization)
  const isBoardSymmetric = useMemo(() => {
    const boardHeight = gameData.board_height || 8;
    const playerCount = gameData.player_count || 2;
    
    if (playerCount !== 2) {
      console.log('isBoardSymmetric: false - not 2 players');
      return false; // Mirrored only works for 2 players
    }
    
    // Helper to get the player ID from a piece (handles different property names and type coercion)
    const getPiecePlayerId = (piece) => {
      const id = piece.player_id ?? piece.player_number ?? piece.player;
      return id !== undefined && id !== null ? Number(id) : undefined;
    };
    
    // Group pieces by player, including their positions from the key
    const piecesByPlayer = {};
    Object.entries(piecePlacements).forEach(([key, piece]) => {
      const [row, col] = key.split(',').map(Number);
      const pieceWithPos = { ...piece, y: row, x: col };
      const playerId = getPiecePlayerId(piece);
      
      if (!piecesByPlayer[playerId]) {
        piecesByPlayer[playerId] = [];
      }
      piecesByPlayer[playerId].push(pieceWithPos);
    });
    
    const playerIds = Object.keys(piecesByPlayer).map(Number).sort((a, b) => a - b);
    
    // Empty board is considered symmetric - allow mirrored mode
    if (playerIds.length === 0) {
      console.log('isBoardSymmetric: true - empty board');
      return true;
    }
    
    // If only one player has pieces, not symmetric
    if (playerIds.length === 1) {
      console.log('isBoardSymmetric: false - only one player has pieces');
      return false;
    }
    
    if (playerIds.length !== 2) {
      console.log('isBoardSymmetric: false - not exactly 2 players with pieces:', playerIds.length);
      return false;
    }
    
    const player1Pieces = piecesByPlayer[playerIds[0]];
    const player2Pieces = piecesByPlayer[playerIds[1]];
    
    // Must have same number of pieces
    if (player1Pieces.length !== player2Pieces.length) {
      console.log('isBoardSymmetric: false - different piece counts:', player1Pieces.length, 'vs', player2Pieces.length);
      return false;
    }
    
    console.log('Checking symmetry for', player1Pieces.length, 'pieces per player');
    
    // Check if pieces are at mirrored positions with same piece types
    // We need to verify both directions to ensure perfect symmetry
    for (let i = 0; i < player1Pieces.length; i++) {
      const p1 = player1Pieces[i];
      const ph = p1.piece_height || 1;
      // For multi-tile: mirror the full footprint, not just the anchor
      const mirroredY = boardHeight - p1.y - ph;
      
      // Find if there's a player 2 piece at the mirrored position with same piece type
      const p2 = player2Pieces.find(p => p.x === p1.x && p.y === mirroredY);
      
      if (!p2) {
        console.log(`isBoardSymmetric: false - no piece at mirrored position for (${p1.x},${p1.y}), expected at (${p1.x},${mirroredY})`);
        return false;
      }
      
      if (p2.piece_id !== p1.piece_id) {
        console.log(`isBoardSymmetric: false - different piece types at (${p1.x},${p1.y}) and (${p2.x},${p2.y}): ${p1.piece_id} vs ${p2.piece_id}`);
        return false;
      }
    }
    
    console.log('isBoardSymmetric: true!');
    return true;
  }, [piecePlacements, gameData.board_height, gameData.player_count]);
  
  // Check if any control square requires specific pieces
  const requireSpecificPieceControl = useMemo(() => {
    try {
      if (!gameData.control_squares_string) return false;
      const controlSquares = JSON.parse(gameData.control_squares_string);
      return Object.values(controlSquares).some(config => config.requireSpecificPiece === true);
    } catch (error) {
      console.error("Error parsing control_squares_string:", error);
      return false;
    }
  }, [gameData.control_squares_string]);

  // Parse special squares from Step 3 for display
  const specialSquaresData = useMemo(() => {
    const result = { range: {}, promotion: {}, control: {}, custom: {} };
    const parseSquares = (str, key) => {
      if (!str || str === '{}') return;
      try {
        const parsed = JSON.parse(str);
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
          result[key] = parsed;
        }
      } catch (e) {
        console.error(`Error parsing ${key}_squares_string:`, e);
      }
    };
    parseSquares(gameData.range_squares_string, 'range');
    parseSquares(gameData.promotion_squares_string, 'promotion');
    parseSquares(gameData.control_squares_string, 'control');
    parseSquares(gameData.special_squares_string, 'custom');
    return result;
  }, [gameData.range_squares_string, gameData.promotion_squares_string, gameData.control_squares_string, gameData.special_squares_string]);

  // Helper to get special square type and color
  const getSpecialSquareInfo = useCallback((key) => {
    if (specialSquaresData.range[key]) return { type: 'range', color: '#ff8c00' }; // Orange
    if (specialSquaresData.promotion[key]) return { type: 'promotion', color: '#4b0082' }; // Purple
    if (specialSquaresData.control[key]) return { type: 'control', color: '#32CD32' }; // Green
    if (specialSquaresData.custom[key]) return { type: 'custom', color: '#ffd700' }; // Gold
    return null;
  }, [specialSquaresData]);

  // Check if any special squares exist
  const hasSpecialSquares = useMemo(() => {
    return Object.keys(specialSquaresData.range).length > 0 ||
           Object.keys(specialSquaresData.promotion).length > 0 ||
           Object.keys(specialSquaresData.control).length > 0 ||
           Object.keys(specialSquaresData.custom).length > 0;
  }, [specialSquaresData]);
  
  // Get user's preferred board colors from localStorage
  const lightSquareColor = localStorage.getItem('boardLightColor') || '#cad5e8';
  const darkSquareColor = localStorage.getItem('boardDarkColor') || '#08234d';

  // Detect mobile
  useEffect(() => {
    setIsMobile(isMobileDevice());
  }, []);

  // Track window width for responsive board sizing
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Load all pieces for image fallback and movement data
  useEffect(() => {
    const loadPieces = async () => {
      try {
        // Use /api/pieces/full to get ALL pieces with movement data in one call
        const response = await PiecesService.getPiecesWithMovement();
        const allPieces = response.data || [];
        
        const pieceMap = {};
        allPieces.forEach(piece => {
          // piece_id is returned from the full query, use it as the key
          const id = piece.piece_id || piece.id;
          pieceMap[id] = piece;
        });
        
        setPieceDataMap(pieceMap);
      } catch (error) {
        console.error("Error loading pieces:", error);
      }
    };
    loadPieces();
  }, []);

  // Track which data sources have been initialized
  const initializedPiecesRef = useRef(false);
  const initializedRandomRef = useRef(false);

  // Parse existing piece placements when data becomes available
  useEffect(() => {
    if (initializedPiecesRef.current) return;
    if (!gameData.pieces_string || gameData.pieces_string === '{}') return;
    
    initializedPiecesRef.current = true;
    try {
      const parsed = JSON.parse(gameData.pieces_string);
      if (typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
        setPiecePlacements(parsed);
      }
    } catch (error) {
      console.error("Error parsing pieces_string:", error);
    }
  }, [gameData.pieces_string]);

  // Parse randomized_starting_positions when data becomes available
  useEffect(() => {
    if (initializedRandomRef.current) return;
    if (!gameData.randomized_starting_positions) return;
    
    initializedRandomRef.current = true;
    try {
      const parsed = JSON.parse(gameData.randomized_starting_positions);
      if (parsed && parsed.allowedModes && Array.isArray(parsed.allowedModes)) {
        setAllowedStartingModes(parsed.allowedModes);
      } else if (parsed && parsed.mode) {
        // Legacy support: single mode means only that mode is allowed
        setAllowedStartingModes([parsed.mode]);
      } else if (parsed && parsed.enabled === true) {
        // Legacy support: enabled: true means 'independent'
        setAllowedStartingModes(['independent']);
      }
    } catch (error) {
      // If it's not JSON, keep all modes enabled (default)
    }
  }, [gameData.randomized_starting_positions]);

  // Update gameData whenever piecePlacements changes
  useEffect(() => {
    const newValue = JSON.stringify(piecePlacements);
    if (newValue !== gameData.pieces_string) {
      updateGameData({ pieces_string: newValue });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piecePlacements]);

  const handleSquareRightClick = useCallback((e, row, col) => {
    e.preventDefault();
    const key = `${row},${col}`;
    setSelectedSquare({ row, col, key });
    setShowPieceSelector(true);
  }, []);

  // Long press handlers for mobile
  const handleLongPress = useCallback((row, col) => {
    const key = `${row},${col}`;
    setSelectedSquare({ row, col, key });
    setShowPieceSelector(true);
  }, []);

  const handleTouchStart = useCallback((e, row, col) => {
    if (!isTouchDevice()) return;
    
    longPressTimeoutRef.current = setTimeout(() => {
      handleLongPress(row, col);
    }, 500);
  }, [handleLongPress]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  }, []);

  const handlePieceSelected = useCallback((pieceData) => {
    if (selectedSquare) {
      // Handle placeable piece selection (for piece placement action)
      if (selectedSquare.isPlaceable) {
        try {
          const data = JSON.parse(gameData.other_game_data || '{}');
          const placeablePieces = data.placeable_pieces || [];
          placeablePieces.push({
            piece_id: pieceData.piece_id,
            name: pieceData.piece_name,
            image_url: pieceData.image_url,
            image_location: pieceData.image_location || null
          });
          data.placeable_pieces = placeablePieces;
          updateGameData({ other_game_data: JSON.stringify(data, null, 2) });
        } catch {
          updateGameData({ other_game_data: JSON.stringify({ placeable_pieces: [{ piece_id: pieceData.piece_id, name: pieceData.piece_name, image_url: pieceData.image_url, image_location: pieceData.image_location || null }] }, null, 2) });
        }
        setShowPieceSelector(false);
        setSelectedSquare(null);
        return;
      }

      // Check if fill row is enabled
      const { fillRow, fillRowData } = pieceData;
      
      if (fillRow && fillRowData) {
        // Fill the entire row with this piece
        const { row, boardWidth: filledBoardWidth } = fillRowData;
        const effectiveBoardWidth = filledBoardWidth || gameData.board_width;
        
        setPiecePlacements(prev => {
          const newPlacements = { ...prev };
          for (let col = 0; col < effectiveBoardWidth; col++) {
            const key = `${row},${col}`;
            newPlacements[key] = {
              piece_id: pieceData.piece_id,
              player_id: pieceData.player_id,
              image_url: pieceData.image_url,
              piece_name: pieceData.piece_name,
              ends_game_on_checkmate: pieceData.ends_game_on_checkmate || false,
              ends_game_on_capture: pieceData.ends_game_on_capture || false,
              can_control_squares: pieceData.can_control_squares || false,
              // HP/AD system
              hit_points: pieceData.hit_points ?? 1,
              attack_damage: pieceData.attack_damage ?? 1,
              show_hp_ad: pieceData.show_hp_ad || false,
              show_regen: pieceData.show_regen ?? false,
              hp_regen: pieceData.hp_regen ?? 0,
              cannot_be_captured: pieceData.cannot_be_captured || false,
              burn_damage: pieceData.burn_damage ?? 0,
              burn_duration: pieceData.burn_duration ?? 0,
              show_burn: pieceData.show_burn ?? false,
              // Trample & Ghostwalk
              trample: pieceData.trample || false,
              trample_radius: pieceData.trample_radius ?? 0,
              ghostwalk: pieceData.ghostwalk || false,
              // Castling override data
              manual_castling_partners: pieceData.manual_castling_partners || false,
              castling_partner_left_key: pieceData.castling_partner_left_key || null,
              castling_partner_right_key: pieceData.castling_partner_right_key || null,
              castling_distance: pieceData.castling_distance ?? 2
            };
          }
          return newPlacements;
        });
      } else {
        // Single or multi-tile placement
        const pw = pieceData.piece_width || 1;
        const ph = pieceData.piece_height || 1;
        const boardW = gameData.board_width || 8;
        const boardH = gameData.board_height || 8;
        const anchorRow = selectedSquare.row;
        const anchorCol = selectedSquare.col;

        // Check if piece fits on board
        if (anchorCol + pw > boardW || anchorRow + ph > boardH) {
          alert(`This ${pw}×${ph} piece doesn't fit at this position. It would extend beyond the board.`);
          setShowPieceSelector(false);
          setSelectedSquare(null);
          return;
        }

        setPiecePlacements(prev => {
          const newPlacements = { ...prev };

          // Remove any existing pieces that overlap the footprint
          for (let dy = 0; dy < ph; dy++) {
            for (let dx = 0; dx < pw; dx++) {
              const occKey = `${anchorRow + dy},${anchorCol + dx}`;
              if (dx === 0 && dy === 0) continue; // anchor handled separately
              // Remove occupied-square markers from previous pieces
              delete newPlacements[occKey];
            }
          }

          // Place anchor with dimension info
          newPlacements[selectedSquare.key] = {
            piece_id: pieceData.piece_id,
            player_id: pieceData.player_id,
            image_url: pieceData.image_url,
            piece_name: pieceData.piece_name,
            piece_width: pw,
            piece_height: ph,
            ends_game_on_checkmate: pieceData.ends_game_on_checkmate || false,
            ends_game_on_capture: pieceData.ends_game_on_capture || false,
            can_control_squares: pieceData.can_control_squares || false,
            // HP/AD system
            hit_points: pieceData.hit_points ?? 1,
            attack_damage: pieceData.attack_damage ?? 1,
            show_hp_ad: pieceData.show_hp_ad || false,
            show_regen: pieceData.show_regen ?? false,
            hp_regen: pieceData.hp_regen ?? 0,
            cannot_be_captured: pieceData.cannot_be_captured || false,
            burn_damage: pieceData.burn_damage ?? 0,
            burn_duration: pieceData.burn_duration ?? 0,
            show_burn: pieceData.show_burn ?? false,
            // Trample & Ghostwalk
            trample: pieceData.trample || false,
            trample_radius: pieceData.trample_radius ?? 0,
            ghostwalk: pieceData.ghostwalk || false,
            manual_castling_partners: pieceData.manual_castling_partners || false,
            castling_partner_left_key: pieceData.castling_partner_left_key || null,
            castling_partner_right_key: pieceData.castling_partner_right_key || null,
            castling_distance: pieceData.castling_distance ?? 2
          };

          // For multi-tile pieces, mark the other occupied squares with a reference to the anchor
          if (pw > 1 || ph > 1) {
            for (let dy = 0; dy < ph; dy++) {
              for (let dx = 0; dx < pw; dx++) {
                if (dx === 0 && dy === 0) continue;
                const occKey = `${anchorRow + dy},${anchorCol + dx}`;
                newPlacements[occKey] = {
                  _anchorKey: selectedSquare.key,
                  piece_id: pieceData.piece_id,
                  player_id: pieceData.player_id,
                  piece_name: pieceData.piece_name,
                  _occupied: true // marker for occupied extension squares
                };
              }
            }
          }

          return newPlacements;
        });
      }
    }
    setShowPieceSelector(false);
    setSelectedSquare(null);
  }, [selectedSquare, gameData.board_width, gameData.board_height]);

  const handleRemovePiece = useCallback(() => {
    if (selectedSquare) {
      setPiecePlacements(prev => {
        const newPlacements = { ...prev };
        const placement = newPlacements[selectedSquare.key];
        
        if (placement) {
          if (placement._anchorKey) {
            // This is an extension square — find and remove the anchor and all its extensions
            const anchorPlacement = newPlacements[placement._anchorKey];
            if (anchorPlacement) {
              const pw = anchorPlacement.piece_width || 1;
              const ph = anchorPlacement.piece_height || 1;
              const [aRow, aCol] = placement._anchorKey.split(',').map(Number);
              for (let dy = 0; dy < ph; dy++) {
                for (let dx = 0; dx < pw; dx++) {
                  delete newPlacements[`${aRow + dy},${aCol + dx}`];
                }
              }
            }
          } else {
            // This is an anchor square — remove it and all extension squares
            const pw = placement.piece_width || 1;
            const ph = placement.piece_height || 1;
            const [aRow, aCol] = selectedSquare.key.split(',').map(Number);
            for (let dy = 0; dy < ph; dy++) {
              for (let dx = 0; dx < pw; dx++) {
                delete newPlacements[`${aRow + dy},${aCol + dx}`];
              }
            }
          }
        }
        
        return newPlacements;
      });
    }
    setShowPieceSelector(false);
    setSelectedSquare(null);
  }, [selectedSquare]);

  const handleCancelSelector = useCallback(() => {
    setShowPieceSelector(false);
    setSelectedSquare(null);
  }, []);

  // Check if piece can perform ranged attack to target square
  const canRangedAttackTo = useCallback((fromRow, fromCol, toRow, toCol, pieceData, playerPosition) => {
    if (!pieceData) return false;
    return canRangedAttackToUtil(fromRow, fromCol, toRow, toCol, pieceData, playerPosition);
  }, []);

  // Get full movement info including first-move-only status
  const getMoveInfo = useCallback((fromRow, fromCol, toRow, toCol, pieceData, playerPosition) => {
    if (!pieceData) return { allowed: false, isFirstMoveOnly: false };
    return canPieceMoveToUtil(fromRow, fromCol, toRow, toCol, pieceData, playerPosition);
  }, []);

  // Get full capture info including first-move-only status
  const getCaptureInfo = useCallback((fromRow, fromCol, toRow, toCol, pieceData, playerPosition) => {
    if (!pieceData) return { allowed: false, isFirstMoveOnly: false };
    return canCaptureOnMoveToUtil(fromRow, fromCol, toRow, toCol, pieceData, playerPosition);
  }, []);

  // Drag and drop handlers
  const handleDragStart = useCallback((e, key) => {
    const [row, col] = key.split(',').map(Number);
    setDraggedPiece({ key, data: piecePlacements[key] });
    setDraggedPiecePosition({ row, col });
    setHoveredPiecePosition(null); // Clear hover when dragging starts
    e.dataTransfer.effectAllowed = 'move';
    // Make the dragged element semi-transparent
    e.currentTarget.style.opacity = '0.5';
  }, [piecePlacements]);

  const handleDragOver = useCallback((e, row, col) => {
    e.preventDefault();
    e.stopPropagation();
    setHoveredSquare({ row, col });
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e, targetRow, targetCol) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedPiece) return;

    const targetKey = `${targetRow},${targetCol}`;
    const sourceKey = draggedPiece.key;

    if (sourceKey === targetKey) {
      setDraggedPiece(null);
      setDraggedPiecePosition(null);
      setHoveredSquare(null);
      return;
    }

    const pw = draggedPiece.data.piece_width || 1;
    const ph = draggedPiece.data.piece_height || 1;
    const boardW = gameData.board_width || 8;
    const boardH = gameData.board_height || 8;

    // Check if multi-tile piece fits at target
    if (targetRow + ph > boardH || targetCol + pw > boardW) {
      alert('Piece does not fit on the board at this position.');
      setDraggedPiece(null);
      setDraggedPiecePosition(null);
      setHoveredSquare(null);
      return;
    }

    setPiecePlacements(prev => {
      const newPlacements = { ...prev };
      // Remove source anchor + all its extensions
      const [srcRow, srcCol] = sourceKey.split(',').map(Number);
      for (let dr = 0; dr < ph; dr++) {
        for (let dc = 0; dc < pw; dc++) {
          delete newPlacements[`${srcRow + dr},${srcCol + dc}`];
        }
      }
      // Check if any existing piece occupies target footprint and remove it
      for (let dr = 0; dr < ph; dr++) {
        for (let dc = 0; dc < pw; dc++) {
          const checkKey = `${targetRow + dr},${targetCol + dc}`;
          const existing = newPlacements[checkKey];
          if (existing) {
            // If it's an extension, find and remove its anchor + all extensions
            if (existing._occupied && existing._anchorKey) {
              const anchorData = newPlacements[existing._anchorKey];
              if (anchorData) {
                const aw = anchorData.piece_width || 1;
                const ah = anchorData.piece_height || 1;
                const [ar, ac] = existing._anchorKey.split(',').map(Number);
                for (let r2 = 0; r2 < ah; r2++) {
                  for (let c2 = 0; c2 < aw; c2++) {
                    delete newPlacements[`${ar + r2},${ac + c2}`];
                  }
                }
              }
            } else {
              // It's an anchor — remove it and its extensions
              const ew = existing.piece_width || 1;
              const eh = existing.piece_height || 1;
              const [er, ec] = checkKey.split(',').map(Number);
              for (let r2 = 0; r2 < eh; r2++) {
                for (let c2 = 0; c2 < ew; c2++) {
                  delete newPlacements[`${er + r2},${ec + c2}`];
                }
              }
            }
          }
        }
      }
      // Place anchor at target
      newPlacements[targetKey] = { ...draggedPiece.data };
      // Place extensions
      for (let dr = 0; dr < ph; dr++) {
        for (let dc = 0; dc < pw; dc++) {
          if (dr === 0 && dc === 0) continue;
          newPlacements[`${targetRow + dr},${targetCol + dc}`] = {
            _anchorKey: targetKey,
            piece_id: draggedPiece.data.piece_id,
            player_id: draggedPiece.data.player_id,
            piece_name: draggedPiece.data.piece_name,
            _occupied: true
          };
        }
      }
      return newPlacements;
    });

    setDraggedPiece(null);
    setDraggedPiecePosition(null);
    setHoveredSquare(null);
  }, [draggedPiece, gameData.board_width, gameData.board_height]);

  const handleDragEnd = useCallback((e) => {
    // Reset opacity
    e.currentTarget.style.opacity = '1';
    setDraggedPiece(null);
    setDraggedPiecePosition(null);
    setHoveredSquare(null);
    setHoveredPiecePosition(null);
  }, []);

  const handleStartingModeToggle = (mode) => {
    setAllowedStartingModes(prev => {
      let newModes;
      if (prev.includes(mode)) {
        // Don't allow removing the last mode
        if (prev.length === 1) return prev;
        newModes = prev.filter(m => m !== mode);
      } else {
        newModes = [...prev, mode];
      }
      
      // Store the allowed starting modes
      const randomizedData = {
        allowedModes: newModes
      };
      updateGameData({ randomized_starting_positions: JSON.stringify(randomizedData) });
      
      return newModes;
    });
  };

  // Helper function to get placement image URL with fallback
  const getPlacementImageUrl = useCallback((placement) => {
    // Use the selected image_url from placement (set by PieceSelector or loaded from server)
    if (placement.image_url) {
      // Handle both full URLs and paths
      return getImageUrl(placement.image_url);
    }
    
    // Fallback: try to get image from image_location based on player_number/player_id
    if (placement.image_location) {
      try {
        const images = JSON.parse(placement.image_location);
        if (Array.isArray(images) && images.length > 0) {
          // player_number/player_id 1 -> index 0, player_number/player_id 2 -> index 1, etc.
          const playerId = Number(placement.player_id ?? placement.player_number ?? placement.player ?? 1);
          const imageIndex = Math.min(playerId - 1, images.length - 1);
          return getImageUrl(images[imageIndex]);
        }
      } catch (e) {
        console.error("Error parsing placement image_location:", e);
      }
    }
    
    // Last fallback: try to get first image from piece data if no image_url is set
    if (placement.piece_id && pieceDataMap[placement.piece_id]) {
      const piece = pieceDataMap[placement.piece_id];
      if (piece.image_location) {
        try {
          const images = JSON.parse(piece.image_location);
          if (Array.isArray(images) && images.length > 0) {
            // Use player_id/player_number to select correct image
            const playerId = Number(placement.player_id ?? placement.player_number ?? placement.player ?? 1);
            const imageIndex = Math.min(playerId - 1, images.length - 1);
            return getImageUrl(images[imageIndex]);
          }
        } catch (e) {
          console.error("Error parsing piece image_location:", e);
        }
      }
    }
    
    return null;
  }, [pieceDataMap]);

  // Helper function to get player color (must be defined before renderBoard)
  const getPlayerColor = useCallback((playerId) => {
    const colors = ['#FFFFFF', '#000000', '#FF6B6B', '#4ECDC4', '#F7DC6F', '#BB8FCE', '#52BE80', '#5DADE2'];
    return colors[(playerId - 1) % colors.length] || '#999';
  }, []);

  // Calculate board dimensions for legend width
  const boardDimensions = useMemo(() => {
    const boardPadding = 10 * 2; // 10px each side
    const boardBorder = 1 * 2;   // 1px each side
    const maxBoardPx = Math.min(850, windowWidth - 60 - boardPadding - boardBorder);
    const squareSize = Math.min(100, maxBoardPx / Math.max(gameData.board_width, gameData.board_height));
    const boardWidth = squareSize * gameData.board_width;
    return { squareSize, boardWidth };
  }, [gameData.board_width, gameData.board_height, windowWidth]);

  const renderBoard = useMemo(() => {
    const board = [];
    const squareSize = boardDimensions.squareSize;
    
    for (let row = 0; row < gameData.board_height; row++) {
      for (let col = 0; col < gameData.board_width; col++) {
        const isLight = (row + col) % 2 === 0;
        const key = `${row},${col}`;
        const placement = piecePlacements[key];
        
        // Check if this square is within the footprint of the hovered/dragged piece itself
        let isWithinActivePieceFootprint = false;
        if (draggedPiece && draggedPiecePosition) {
          const dpw = draggedPiece.data.piece_width || 1;
          const dph = draggedPiece.data.piece_height || 1;
          if (row >= draggedPiecePosition.row && row < draggedPiecePosition.row + dph &&
              col >= draggedPiecePosition.col && col < draggedPiecePosition.col + dpw) {
            isWithinActivePieceFootprint = true;
          }
        } else if (hoveredPiecePosition && !draggedPiece) {
          const pieceData = pieceDataMap[hoveredPiecePosition.pieceId];
          if (pieceData) {
            const hpw = pieceData.piece_width || 1;
            const hph = pieceData.piece_height || 1;
            if (row >= hoveredPiecePosition.row && row < hoveredPiecePosition.row + hph &&
                col >= hoveredPiecePosition.col && col < hoveredPiecePosition.col + hpw) {
              isWithinActivePieceFootprint = true;
            }
          }
        }

        // Check if this square is valid for the hovered or dragged piece
        let moveInfo = { allowed: false, isFirstMoveOnly: false };
        let captureInfo = { allowed: false, isFirstMoveOnly: false };
        let canRanged = false;
        let canHopCapture = false;
        
        // Check for dragged piece
        if (draggedPiece && draggedPiecePosition) {
          const pieceData = pieceDataMap[draggedPiece.data.piece_id];
          if (pieceData) {
            const dpw = draggedPiece.data.piece_width || 1;
            const dph = draggedPiece.data.piece_height || 1;
            for (let dr = 0; dr < dph && !moveInfo.allowed; dr++) {
              for (let dc = 0; dc < dpw && !moveInfo.allowed; dc++) {
                const info = getMoveInfo(draggedPiecePosition.row + dr, draggedPiecePosition.col + dc, row, col, pieceData, draggedPiece.data.player_id);
                if (info.allowed) moveInfo = info;
              }
            }
            for (let dr = 0; dr < dph && !captureInfo.allowed; dr++) {
              for (let dc = 0; dc < dpw && !captureInfo.allowed; dc++) {
                const info = getCaptureInfo(draggedPiecePosition.row + dr, draggedPiecePosition.col + dc, row, col, pieceData, draggedPiece.data.player_id);
                if (info.allowed) captureInfo = info;
              }
            }
            for (let dr = 0; dr < dph && !canRanged; dr++) {
              for (let dc = 0; dc < dpw && !canRanged; dc++) {
                canRanged = canRangedAttackTo(draggedPiecePosition.row + dr, draggedPiecePosition.col + dc, row, col, pieceData, draggedPiece.data.player_id);
              }
            }
            if (pieceData.capture_on_hop) {
              for (let dr = 0; dr < dph && !canHopCapture; dr++) {
                for (let dc = 0; dc < dpw && !canHopCapture; dc++) {
                  canHopCapture = canHopCaptureToUtil(draggedPiecePosition.row + dr, draggedPiecePosition.col + dc, row, col, pieceData, draggedPiece.data.player_id);
                }
              }
            }
          }
        }
        // Check for hovered piece (not dragging)
        else if (hoveredPiecePosition && !draggedPiece) {
          const pieceData = pieceDataMap[hoveredPiecePosition.pieceId];
          if (pieceData) {
            const hpw = pieceData.piece_width || 1;
            const hph = pieceData.piece_height || 1;
            for (let dr = 0; dr < hph && !moveInfo.allowed; dr++) {
              for (let dc = 0; dc < hpw && !moveInfo.allowed; dc++) {
                const info = getMoveInfo(hoveredPiecePosition.row + dr, hoveredPiecePosition.col + dc, row, col, pieceData, hoveredPiecePosition.playerId);
                if (info.allowed) moveInfo = info;
              }
            }
            for (let dr = 0; dr < hph && !captureInfo.allowed; dr++) {
              for (let dc = 0; dc < hpw && !captureInfo.allowed; dc++) {
                const info = getCaptureInfo(hoveredPiecePosition.row + dr, hoveredPiecePosition.col + dc, row, col, pieceData, hoveredPiecePosition.playerId);
                if (info.allowed) captureInfo = info;
              }
            }
            for (let dr = 0; dr < hph && !canRanged; dr++) {
              for (let dc = 0; dc < hpw && !canRanged; dc++) {
                canRanged = canRangedAttackTo(hoveredPiecePosition.row + dr, hoveredPiecePosition.col + dc, row, col, pieceData, hoveredPiecePosition.playerId);
              }
            }
            if (pieceData.capture_on_hop) {
              for (let dr = 0; dr < hph && !canHopCapture; dr++) {
                for (let dc = 0; dc < hpw && !canHopCapture; dc++) {
                  canHopCapture = canHopCaptureToUtil(hoveredPiecePosition.row + dr, hoveredPiecePosition.col + dc, row, col, pieceData, hoveredPiecePosition.playerId);
                }
              }
            }
          }
        }
        
        let squareStyle = {
          background: isLight ? lightSquareColor : darkSquareColor,
          position: 'relative',
          cursor: placement ? 'grab' : 'context-menu',
          boxSizing: 'border-box'
        };
        
        // Get highlight style using the utility function
        const { style: highlightStyle, icon: highlightIcon } = getSquareHighlightStyle(
          moveInfo.allowed,
          moveInfo.isFirstMoveOnly,
          captureInfo.allowed,
          captureInfo.isFirstMoveOnly,
          canRanged,
          isLight
        );
        
        // Highlight is rendered as a separate overlay via SquareHighlightOverlay
        // (not merged into squareStyle, which would add borders that resize multi-tile pieces)

        // Anchor square needs higher z-index so multi-tile image paints above extension squares
        if (placement && !placement._occupied) {
          const spw = placement.piece_width || 1;
          const sph = placement.piece_height || 1;
          if (spw > 1 || sph > 1) {
            squareStyle.zIndex = 10;
          }
        }

        // Add special square border/indicator from Step 3
        const specialInfo = getSpecialSquareInfo(key);
        if (specialInfo) {
          squareStyle.boxShadow = `inset 0 0 0 3px ${specialInfo.color}`;
        }
        
        const isExtensionSquare = placement && placement._occupied;
        
        board.push(
          <div
            key={key}
            className={`${styles["board-square"]}${isExtensionSquare ? ` ${styles["extension-square"]}` : ''}`}
            style={squareStyle}
            onContextMenu={(e) => handleSquareRightClick(e, row, col)}
            onTouchStart={(e) => handleTouchStart(e, row, col)}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchEnd}
            onDragOver={(e) => handleDragOver(e, row, col)}
            onDrop={(e) => handleDrop(e, row, col)}
            onMouseEnter={() => {
              if (placement && placement._occupied && placement._anchorKey) {
                // Extension square: trigger hover for the anchor piece
                const [anchorRow, anchorCol] = placement._anchorKey.split(',').map(Number);
                const anchorPlacement = piecePlacements[placement._anchorKey];
                if (anchorPlacement) {
                  const playerId = Number(anchorPlacement.player_id ?? anchorPlacement.player_number ?? anchorPlacement.player ?? 1);
                  setHoveredPiecePosition({ row: anchorRow, col: anchorCol, pieceId: anchorPlacement.piece_id, playerId });
                }
              } else if (!placement) {
                setHoveredSquare({ row, col });
              }
            }}
            onMouseLeave={() => {
              if (placement && placement._occupied) {
                if (!draggedPiece) setHoveredPiecePosition(null);
              }
            }}
          >
            {!isWithinActivePieceFootprint && (
              <SquareHighlightOverlay
                highlightStyle={highlightStyle}
                highlightIcon={highlightIcon}
                canHopCapture={canHopCapture}
                squareSize={squareSize}
                isLight={isLight}
              />
            )}
            {placement && !placement._occupied && (() => {
              const placePw = placement.piece_width || 1;
              const placePh = placement.piece_height || 1;
              const isMultiTile = placePw > 1 || placePh > 1;
              return (
              <div 
                className={isMultiTile ? styles["piece-on-square-multitile"] : styles["piece-on-square"]}
                draggable
                onDragStart={(e) => handleDragStart(e, key)}
                onDragEnd={handleDragEnd}
                onMouseEnter={() => {
                  const playerId = Number(placement.player_id ?? placement.player_number ?? placement.player ?? 1);
                  setHoveredPiecePosition({ row, col, pieceId: placement.piece_id, playerId });
                }}
                onMouseLeave={() => {
                  if (!draggedPiece) setHoveredPiecePosition(null);
                }}
                style={{ 
                  cursor: 'grab',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: `${placePw * 100}%`,
                  height: `${placePh * 100}%`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 5
                }}
              >
                {getPlacementImageUrl(placement) ? (
                  (() => {
                    const isPlaceNonSquare = isMultiTile && placePw !== placePh;
                    return isPlaceNonSquare ? (
                      <div
                        ref={(el) => applySvgStretchBackground(el, getPlacementImageUrl(placement))}
                        style={{
                          width: '100%',
                          height: '100%',
                          pointerEvents: 'none'
                        }}
                      />
                    ) : (
                      <img 
                        src={getPlacementImageUrl(placement)} 
                        alt={placement.piece_name}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'fill',
                          pointerEvents: 'none'
                        }}
                        draggable={false}
                      />
                    );
                  })()
                ) : (
                  <span style={{ fontSize: `${squareSize * 0.3}px`, color: '#fff', pointerEvents: 'none' }}>
                    {placement.piece_name?.charAt(0) || '?'}
                  </span>
                )}
                {(() => {
                  const pId = Number(placement.player_id ?? placement.player_number ?? placement.player ?? 1);
                  return (
                    <div className={styles["player-indicator"]} style={{
                      position: 'absolute',
                      bottom: '2px',
                      right: '2px',
                      background: getPlayerColor(pId),
                      width: `${squareSize * 0.2}px`,
                      height: `${squareSize * 0.2}px`,
                      borderRadius: '50%',
                      border: pId === 1 ? '1px solid #666' : '1px solid #fff',
                      pointerEvents: 'none'
                    }} />
                  );
                })()}
                {placement.ends_game_on_checkmate && (
                  <div className={styles["checkmate-indicator"]} style={{
                    position: 'absolute',
                    top: '2px',
                    left: '2px',
                    fontSize: `${squareSize * 0.25}px`,
                    pointerEvents: 'none',
                    color: Number(placement.player_id ?? placement.player_number ?? placement.player ?? 1) === 1 ? 'white' : 'black'
                  }} title="Game ends if checkmated">
                    ♔
                  </div>
                )}
                {placement.ends_game_on_capture && (
                  <div className={styles["capture-indicator"]} style={{
                    position: 'absolute',
                    top: '2px',
                    right: '2px',
                    fontSize: `${squareSize * 0.25}px`,
                    pointerEvents: 'none'
                  }} title="Game ends if captured">
                    ⚔️
                  </div>
                )}
                {/* Stat badges - anchored to corners via PieceBadges component */}
                {(() => {
                  let showGlobal = false;
                  try { showGlobal = JSON.parse(gameData.other_game_data || '{}').show_all_hp_ad || false; } catch {}
                  return <PieceBadges piece={placement} squareSize={squareSize} showGlobalHpAd={showGlobal} />;
                })()}
              </div>
            );
            })()}
          </div>
        );
      }
    }
    
    return board;
  }, [piecePlacements, gameData.board_width, gameData.board_height, gameData.other_game_data, lightSquareColor, darkSquareColor, handleSquareRightClick, handleDragOver, handleDrop, handleDragStart, handleDragEnd, getPlayerColor, getPlacementImageUrl, draggedPiece, draggedPiecePosition, hoveredPiecePosition, pieceDataMap, getMoveInfo, getCaptureInfo, canRangedAttackTo, boardDimensions, handleTouchStart, handleTouchEnd, getSpecialSquareInfo]);

  const handleMirrorPieces = useCallback((sourcePlayerId, targetPlayerId) => {
    const boardHeight = gameData.board_height || 8;

    // Helper to get the player ID from a piece (handles different property names and type coercion)
    const getPiecePlayerId = (piece) => {
      const id = piece.player_id ?? piece.player_number ?? piece.player;
      return id !== undefined && id !== null ? Number(id) : undefined;
    };

    // Get source player's anchor pieces only (skip extensions)
    const sourcePieces = Object.entries(piecePlacements).filter(
      ([, piece]) => getPiecePlayerId(piece) === Number(sourcePlayerId) && !piece._occupied
    );

    if (sourcePieces.length === 0) {
      alert(`Player ${sourcePlayerId} has no pieces to mirror.`);
      return;
    }

    // Check if target player already has pieces
    const targetPieceCount = Object.values(piecePlacements).filter(
      piece => getPiecePlayerId(piece) === Number(targetPlayerId)
    ).length;

    if (targetPieceCount > 0) {
      if (!window.confirm(
        `Player ${targetPlayerId} already has ${targetPieceCount} piece(s). These will be replaced with mirrored pieces from Player ${sourcePlayerId}. Continue?`
      )) {
        return;
      }
    }

    // Build new placements: start by removing all target player's pieces
    const newPlacements = {};
    Object.entries(piecePlacements).forEach(([key, piece]) => {
      if (getPiecePlayerId(piece) !== Number(targetPlayerId)) {
        newPlacements[key] = piece;
      }
    });

    // Mirror source player's pieces to target side
    let skipped = 0;
    sourcePieces.forEach(([key, sourcePiece]) => {
      const [row, col] = key.split(',').map(Number);
      const pw = sourcePiece.piece_width || 1;
      const ph = sourcePiece.piece_height || 1;
      // Mirror: the bottom edge of the source piece maps to the top edge on the target side
      const mirroredRow = boardHeight - row - ph;
      const mirroredKey = `${mirroredRow},${col}`;

      // Check if mirrored piece fits on board
      if (mirroredRow < 0 || mirroredRow + ph > boardHeight || col + pw > (gameData.board_width || 8)) {
        skipped++;
        return;
      }

      // Check if any cell of the mirrored footprint overlaps source player's own pieces
      let overlaps = false;
      for (let dr = 0; dr < ph && !overlaps; dr++) {
        for (let dc = 0; dc < pw && !overlaps; dc++) {
          const checkKey = `${mirroredRow + dr},${col + dc}`;
          if (newPlacements[checkKey] && getPiecePlayerId(newPlacements[checkKey]) === Number(sourcePlayerId)) {
            overlaps = true;
          }
        }
      }
      if (overlaps) {
        skipped++;
        return;
      }

      // Mirror castling partner keys to target side
      let mirroredLeftKey = null;
      let mirroredRightKey = null;
      if (sourcePiece.castling_partner_left_key) {
        const [pRow, pCol] = sourcePiece.castling_partner_left_key.split(',').map(Number);
        mirroredLeftKey = `${boardHeight - pRow - 1},${pCol}`;
      }
      if (sourcePiece.castling_partner_right_key) {
        const [pRow, pCol] = sourcePiece.castling_partner_right_key.split(',').map(Number);
        mirroredRightKey = `${boardHeight - pRow - 1},${pCol}`;
      }

      // Copy the piece as anchor
      newPlacements[mirroredKey] = {
        piece_id: sourcePiece.piece_id,
        piece_name: sourcePiece.piece_name,
        image_location: sourcePiece.image_location,
        ends_game_on_checkmate: sourcePiece.ends_game_on_checkmate || false,
        ends_game_on_capture: sourcePiece.ends_game_on_capture || false,
        can_control_squares: sourcePiece.can_control_squares || false,
        // HP/AD system
        hit_points: sourcePiece.hit_points ?? 1,
        attack_damage: sourcePiece.attack_damage ?? 1,
        show_hp_ad: sourcePiece.show_hp_ad || false,
        show_regen: sourcePiece.show_regen ?? false,
        hp_regen: sourcePiece.hp_regen ?? 0,
        cannot_be_captured: sourcePiece.cannot_be_captured || false,
        burn_damage: sourcePiece.burn_damage ?? 0,
        burn_duration: sourcePiece.burn_duration ?? 0,
        show_burn: sourcePiece.show_burn ?? false,
        manual_castling_partners: sourcePiece.manual_castling_partners || false,
        castling_partner_left_key: mirroredLeftKey,
        castling_partner_right_key: mirroredRightKey,
        castling_distance: sourcePiece.castling_distance ?? 2,
        trample: sourcePiece.trample ?? false,
        trample_radius: sourcePiece.trample_radius ?? 0,
        ghostwalk: sourcePiece.ghostwalk ?? false,
        piece_width: pw,
        piece_height: ph,
        player_id: targetPlayerId,
      };
      // Place extension squares
      for (let dr = 0; dr < ph; dr++) {
        for (let dc = 0; dc < pw; dc++) {
          if (dr === 0 && dc === 0) continue;
          newPlacements[`${mirroredRow + dr},${col + dc}`] = {
            _anchorKey: mirroredKey,
            piece_id: sourcePiece.piece_id,
            player_id: targetPlayerId,
            piece_name: sourcePiece.piece_name,
            _occupied: true
          };
        }
      }
    });

    setPiecePlacements(newPlacements);

    if (skipped > 0) {
      alert(`${skipped} piece(s) could not be mirrored because they would overlap with Player ${sourcePlayerId}'s own pieces.`);
    }
  }, [gameData.board_height, gameData.board_width, piecePlacements]);

  const getPieceCounts = () => {
    const counts = {};
    Object.values(piecePlacements).forEach(placement => {
      if (placement._occupied) return; // Skip extension squares
      const playerId = Number(placement.player_id ?? placement.player_number ?? placement.player ?? 1);
      const key = `Player ${playerId}`;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  };

  const pieceCounts = getPieceCounts();
  const totalPieces = Object.values(piecePlacements).filter(p => !p._occupied).length;

  return (
    <div className={styles["step-container"]}>
      <h2>Piece Placement</h2>
      <p className={styles["step-description"]}>
        Right-click on any square to add or remove pieces. Drag pieces to move them. Assign pieces to players and choose their images.
      </p>
      <p className={styles["step-description"]} style={{ marginTop: '10px', fontSize: '14px', fontStyle: 'italic', color: '#aaa' }}>
        {isMobile ? '💡 Long press on any square to add/remove pieces on mobile' : '💡 Right-click or drag and drop to manage pieces'}
      </p>

      <div className={styles["piece-stats"]}>
        <div className={styles["stat-item"]}>
          <strong>Total Pieces:</strong> {totalPieces}
        </div>
        {Object.entries(pieceCounts).map(([player, count]) => (
          <div key={player} className={styles["stat-item"]}>
            <strong>{player}:</strong> {count}
          </div>
        ))}
        <button 
          className={styles["clear-all-button"]}
          onClick={() => {
            if (window.confirm('Are you sure you want to remove all pieces from the board?')) {
              setPiecePlacements({});
            }
          }}
        >
          Clear All Pieces
        </button>
        <button
          className={styles["mirror-button"]}
          onClick={() => handleMirrorPieces(1, 2)}
          title="Copy Player 1's pieces to Player 2's side (mirrored vertically)"
        >
          Mirror P1 → P2
        </button>
        <button
          className={styles["mirror-button"]}
          onClick={() => handleMirrorPieces(2, 1)}
          title="Copy Player 2's pieces to Player 1's side (mirrored vertically)"
        >
          Mirror P2 → P1
        </button>
      </div>

      <div className={styles["board-placement-preview"]}>
        <BoardLegend
          labelStyle="short"
          showCheckmate
          showCaptureLoss
          players={Array.from({ length: gameData.player_count || 2 }, (_, i) => ({
            id: i + 1,
            color: getPlayerColor(i + 1),
            border: (i + 1) === 1 ? '#666' : '#fff',
          }))}
          specialSquares={hasSpecialSquares ? {
            range: Object.keys(specialSquaresData.range).length > 0,
            promotion: Object.keys(specialSquaresData.promotion).length > 0,
            control: Object.keys(specialSquaresData.control).length > 0,
            custom: Object.keys(specialSquaresData.custom).length > 0,
          } : null}
          maxWidth={boardDimensions.boardWidth + 30}
        />
        <div 
          className={styles["placement-board"]}
          style={{
            display: 'grid',
            gridTemplateRows: `repeat(${gameData.board_height}, ${boardDimensions.squareSize}px)`,
            gridTemplateColumns: `repeat(${gameData.board_width}, ${boardDimensions.squareSize}px)`,
            border: '1px solid var(--board-border, #333)',
            borderRadius: '5px',
            padding: '10px',
            gap: 0,
            overflow: 'hidden',
            width: 'fit-content',
            aspectRatio: 'unset'
          }}
        >
          {renderBoard}
        </div>
      </div>

      <div className={styles["placement-instructions"]}>
        <h3>Instructions:</h3>
        <ul>
          <li>{isMobile ? 'Long press' : 'Right-click'} any square to add a piece</li>
          <li>Hover over a piece to see where it can move and attack</li>
          <li>Click and drag pieces to move them anywhere on the board</li>
          <li>Blue highlights show valid movement squares, orange shows capture squares</li>
          <li>Search for pieces by name or ID</li>
          <li>Assign each piece to a player (1-{gameData.player_count})</li>
          <li>Choose an image for the piece from available uploads</li>
          <li>{isMobile ? 'Long press' : 'Right-click'} an occupied square to remove or change the piece</li>
        </ul>
      </div>

      {/* Placeable Pieces Section - shown when place_pieces_action is enabled */}
      {(() => {
        const otherData = (() => { try { return JSON.parse(gameData.other_game_data || '{}'); } catch { return {}; } })();
        if (!otherData.place_pieces_action) return null;

        const placeablePieces = otherData.placeable_pieces || [];

        return (
          <div className={styles["global-hp-ad-section"]} style={{ marginTop: '20px' }}>
            <h3>Placeable Pieces <InfoTooltip text="Select which pieces can be placed onto empty squares during gameplay. Players will spend an action to place one of these pieces on their turn." /></h3>
            <p className={styles["field-hint"]} style={{ marginBottom: '12px' }}>
              Choose piece types that players can place during gameplay. These are separate from starting board positions.
            </p>

            {placeablePieces.length > 0 && (
              <div className={styles["placeable-pieces-list"]}>
                {placeablePieces.map((pp, idx) => (
                  <div key={idx} className={styles["placeable-piece-item"]}>
                    {pp.image_url && (
                      <img
                        src={getImageUrl(pp.image_url)}
                        alt={pp.name}
                        className={styles["placeable-piece-image"]}
                      />
                    )}
                    <span className={styles["placeable-piece-name"]}>{pp.name || `Piece #${pp.piece_id}`}</span>
                    <button
                      className={styles["placeable-piece-remove"]}
                      onClick={() => {
                        const updated = placeablePieces.filter((_, i) => i !== idx);
                        const data = { ...otherData, placeable_pieces: updated };
                        updateGameData({ other_game_data: JSON.stringify(data, null, 2) });
                      }}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              className={styles["add-placeable-piece-btn"]}
              onClick={() => {
                setSelectedSquare({ key: '__placeable__', isPlaceable: true });
                setShowPieceSelector(true);
              }}
            >
              + Add Placeable Piece
            </button>
          </div>
        );
      })()}

      {/* Allowed Starting Position Modes — collapsible */}
      <div className={styles["global-hp-ad-section"]} style={{ marginTop: '20px' }}>
        <h3
          className={styles["collapsible-header"]}
          onClick={() => setRandomizationOpen(prev => !prev)}
        >
          <span className={styles["collapse-chevron"]} style={{ transform: randomizationOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          Allowed Starting Position Modes
          <span style={{ marginLeft: '10px', fontSize: '12px', color: '#888', fontWeight: 400 }}>
            (Board symmetric: {isBoardSymmetric ? 'Yes ✓' : 'No ✗'})
          </span>
        </h3>
        {randomizationOpen && (
        <>
        <p className={styles["field-hint"]} style={{ marginBottom: '15px' }}>
          Select which starting position modes players can choose from when creating a match with this game type.
        </p>
        <div className={styles["checkbox-group-vertical"]}>
          <label className={styles["checkbox-label"]}>
            <input
              type="checkbox"
              checked={allowedStartingModes.includes('none')}
              onChange={() => handleStartingModeToggle('none')}
              disabled={allowedStartingModes.length === 1 && allowedStartingModes.includes('none')}
            />
            <span>Fixed Starting Positions</span>
            <p className={styles["checkbox-hint"]}>Pieces always start in the positions configured above</p>
          </label>
          <label className={styles["checkbox-label"]} style={{ opacity: isBoardSymmetric ? 1 : 0.5 }}>
            <input
              type="checkbox"
              checked={allowedStartingModes.includes('backrow')}
              onChange={() => handleStartingModeToggle('backrow')}
              disabled={!isBoardSymmetric || (allowedStartingModes.length === 1 && allowedStartingModes.includes('backrow'))}
            />
            <span>Back Row Only Mirrored Randomization</span>
            <p className={styles["checkbox-hint"]}>
              {isBoardSymmetric 
                ? "Only the back row is randomized in a mirrored fashion. Other pieces (like pawns) stay in place. Like Chess960!"
                : "⚠️ Not available: Board must have 2 players with identical mirrored piece setups"}
            </p>
          </label>
          <label className={styles["checkbox-label"]} style={{ opacity: isBoardSymmetric ? 1 : 0.5 }}>
            <input
              type="checkbox"
              checked={allowedStartingModes.includes('mirrored')}
              onChange={() => handleStartingModeToggle('mirrored')}
              disabled={!isBoardSymmetric || (allowedStartingModes.length === 1 && allowedStartingModes.includes('mirrored'))}
            />
            <span>Full Mirrored Randomization</span>
            <p className={styles["checkbox-hint"]}>
              {isBoardSymmetric 
                ? "Both players get the same random configuration for all pieces, maintaining mirror symmetry."
                : "⚠️ Not available: Board must have 2 players with identical mirrored piece setups"}
            </p>
          </label>
          <label className={styles["checkbox-label"]}>
            <input
              type="checkbox"
              checked={allowedStartingModes.includes('independent')}
              onChange={() => handleStartingModeToggle('independent')}
              disabled={allowedStartingModes.length === 1 && allowedStartingModes.includes('independent')}
            />
            <span>Independent Randomization</span>
            <p className={styles["checkbox-hint"]}>Each player's pieces randomized independently within their starting squares</p>
          </label>
          <label className={styles["checkbox-label"]}>
            <input
              type="checkbox"
              checked={allowedStartingModes.includes('shared')}
              onChange={() => handleStartingModeToggle('shared')}
              disabled={allowedStartingModes.length === 1 && allowedStartingModes.includes('shared')}
            />
            <span>Shared Starting Squares</span>
            <p className={styles["checkbox-hint"]}>All pieces from both players redistributed randomly across all starting squares</p>
          </label>
          <label className={styles["checkbox-label"]}>
            <input
              type="checkbox"
              checked={allowedStartingModes.includes('full')}
              onChange={() => handleStartingModeToggle('full')}
              disabled={allowedStartingModes.length === 1 && allowedStartingModes.includes('full')}
            />
            <span>Full Board Randomization</span>
            <p className={styles["checkbox-hint"]}>Pieces placed randomly anywhere on the board. Maximum chaos!</p>
          </label>
        </div>
        </>
        )}
      </div>

      {/* Global Combat Settings — collapsible */}
      <div className={styles["global-hp-ad-section"]}>
        <h3
          className={styles["collapsible-header"]}
          onClick={() => setHpAdSectionOpen(prev => !prev)}
        >
          <span className={styles["collapse-chevron"]} style={{ transform: hpAdSectionOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          Global Combat Settings
          <InfoTooltip text="These settings apply to all pieces in the game. Individual piece combat settings are configured per-placement in the piece selector." />
        </h3>
        {hpAdSectionOpen && (
        <>
        <div className={styles["global-hp-ad-row"]}>
          <label className={styles["toggle-label"]}>
            <span>Show all badges on all pieces <InfoTooltip text="Force-show HP/AD, Regen, and Burn badges on every piece during gameplay. Overrides all individual per-piece badge settings." /></span>
            <div className={styles["toggle-switch"]}>
              <input
                type="checkbox"
                checked={(() => {
                  try { return JSON.parse(gameData.other_game_data || '{}').show_all_badges || false; } catch { return false; }
                })()}
                onChange={(e) => {
                  const checked = e.target.checked;
                  try {
                    const data = JSON.parse(gameData.other_game_data || '{}');
                    data.show_all_badges = checked;
                    updateGameData({ other_game_data: JSON.stringify(data, null, 2) });
                  } catch {
                    updateGameData({ other_game_data: JSON.stringify({ show_all_badges: checked }, null, 2) });
                  }
                }}
              />
              <span className={styles["toggle-slider"]}></span>
            </div>
          </label>
        </div>
        <div className={styles["global-hp-ad-row"]}>
          <label className={styles["toggle-label"]}>
            <span>Show HP/AD on all pieces <InfoTooltip text="Toggle HP bars and AD badges on every piece. Also sets each piece's individual show setting." /></span>
            <div className={styles["toggle-switch"]}>
              <input
                type="checkbox"
                checked={(() => {
                  try { return JSON.parse(gameData.other_game_data || '{}').show_all_hp_ad || false; } catch { return false; }
                })()}
                onChange={(e) => {
                  const checked = e.target.checked;
                  try {
                    const data = JSON.parse(gameData.other_game_data || '{}');
                    data.show_all_hp_ad = checked;
                    updateGameData({ other_game_data: JSON.stringify(data, null, 2) });
                  } catch {
                    updateGameData({ other_game_data: JSON.stringify({ show_all_hp_ad: checked }, null, 2) });
                  }
                  // Also update show_hp_ad on all existing placements
                  setPiecePlacements(prev => {
                    const updated = { ...prev };
                    Object.keys(updated).forEach(key => {
                      if (!updated[key]._occupied) {
                        updated[key] = { ...updated[key], show_hp_ad: checked };
                      }
                    });
                    return updated;
                  });
                }}
              />
              <span className={styles["toggle-slider"]}></span>
            </div>
          </label>
        </div>
        <div className={styles["global-hp-ad-row"]}>
          <label>
            Global HP Regen (per turn) <InfoTooltip text="HP regenerated each turn for pieces that don't have their own regen set. Only applies to pieces with 0 individual regen." />
          </label>
          <NumberInput
            value={(() => {
              try { return JSON.parse(gameData.other_game_data || '{}').global_hp_regen || 0; } catch { return 0; }
            })()}
            onChange={(val) => {
              try {
                const data = JSON.parse(gameData.other_game_data || '{}');
                data.global_hp_regen = val;
                updateGameData({ other_game_data: JSON.stringify(data, null, 2) });
              } catch {
                updateGameData({ other_game_data: JSON.stringify({ global_hp_regen: val }, null, 2) });
              }
            }}
            options={{ min: 0, max: 100 }}
          />
        </div>
        <p style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
          HP/AD system inspired by ideas from Vasilije — thanks! Check out his project at{' '}
          <a href="https://www.nichess.org/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--link-color, #58a6ff)' }}>nichess.org</a>
        </p>
        </>
        )}
      </div>

      {/* Additional Game Data - hidden, managed internally via global settings above */}

      {showPieceSelector && (
        <PieceSelector
          onSelect={handlePieceSelected}
          onRemove={handleRemovePiece}
          onCancel={handleCancelSelector}
          playerCount={gameData.player_count}
          currentPlacement={piecePlacements[selectedSquare?.key]}
          squarePosition={selectedSquare}
          mateCondition={gameData.mate_condition}
          captureCondition={gameData.capture_condition}
          squaresCondition={gameData.squares_condition}
          requireSpecificPieceControl={requireSpecificPieceControl}
          piecePlacements={piecePlacements}
          boardWidth={gameData.board_width}
        />
      )}
    </div>
  );
};

export default Step5PiecePlacement;
