import React, { useState, useEffect, useMemo } from "react";
import styles from "./gamewizard.module.scss";
import StandardButton from "../standardbutton/StandardButton";
import PiecesService from "../../services/pieces.service";
import InfoTooltip from "../piecewizard/InfoTooltip";
import NumberInput from "../common/NumberInput";
import ToggleSwitch from "../common/ToggleSwitch";
import { normalizePromotionOverride, serializePromotionOverride } from "../../helpers/promotionOverride";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

const getImageUrl = (imagePath) => {
  if (!imagePath) return null;
  if (imagePath.startsWith('http')) return imagePath;
  return `${ASSET_URL}${imagePath}`;
};

// Default castling distance scales with board width:
//   - boards 6 wide and smaller: 1 square
//   - boards 7 or 8 wide:        2 squares
//   - boards 9 or 10 wide:       3 squares
//   - +1 for every additional 2 columns beyond 10
// Matches the natural king-rook spacing on standard and Capablanca-style boards.
export const defaultCastlingDistanceForBoard = (boardWidth) => {
  const w = parseInt(boardWidth, 10);
  if (!Number.isFinite(w) || w <= 6) return 1;
  if (w <= 8) return 2;
  return 3 + Math.floor((w - 10) / 2);
};

const PieceSelector = ({ 
  onSelect, 
  onRemove, 
  onCancel, 
  playerCount, 
  currentPlacement,
  squarePosition,
  mateCondition,
  captureCondition,
  squaresCondition,  // Whether control squares win condition is enabled
  requireSpecificPieceControl,  // Whether any control square requires specific pieces
  piecePlacements = {},  // All piece placements on the board
  boardWidth = 8,        // Board width for finding pieces on same row
  boardHeight = 8,       // Board height for algebraic rank calculation
  embedded = false,  // New prop: if true, don't render modal wrapper
  preloadedPieces = null,  // Optional: pre-loaded piece list to skip the fetch
  hasRestrictionZones = false,  // Whether any custom square has asRestrictionZone enabled
  pointsCondition = false,  // Whether the Points Win Condition is active
  onRemoveRow,  // (row: number) => void — clears all pieces in this row
  excludePieceIds = null,  // Optional: piece_ids to hide from the list (e.g. already-added placeable pieces)
  allowAllPlayers = false,  // Optional: show an "All Players" ownership choice (used for placeable pieces)
  unlockedPieceIds = null,  // Set/array of password-protected piece ids already unlocked this session
  onPieceUnlocked,          // (pieceId, password) => void — remember an unlock for the save payload
}) => {
  // Algebraic notation helpers
  const toFile = (col) => String.fromCharCode(97 + (col ?? 0));
  const toRank = (row) => (boardHeight ?? 8) - (row ?? 0);
  const [pieces, setPieces] = useState(preloadedPieces || []);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(!preloadedPieces);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const PIECES_PER_PAGE = 50;
  
  // Initialize selectedPlayerId with last used value from localStorage, or currentPlacement, or default to 1
  const getInitialPlayerId = () => {
    if (currentPlacement?.player_id != null) {
      return currentPlacement.player_id;
    }
    const lastUsedPlayer = localStorage.getItem('lastSelectedPlayerId');
    return lastUsedPlayer ? parseInt(lastUsedPlayer) : 1;
  };
  
  const [selectedPieceId, setSelectedPieceId] = useState(currentPlacement?.piece_id || null);
  const [selectedPlayerId, setSelectedPlayerId] = useState(getInitialPlayerId());
  const [selectedImageUrl, setSelectedImageUrl] = useState(currentPlacement?.image_url || "");
  // True when the user has explicitly clicked an image in the "Choose Image" grid,
  // overriding the player-default. Reset whenever player or piece changes.
  const [imageManuallyOverridden, setImageManuallyOverridden] = useState(
    currentPlacement?.image_index != null && currentPlacement?.image_index >= 0
  );
  const [availableImages, setAvailableImages] = useState([]);
  const [endsGameOnCheckmate, setEndsGameOnCheckmate] = useState(currentPlacement?.ends_game_on_checkmate || false);
  const [endsGameOnCapture, setEndsGameOnCapture] = useState(currentPlacement?.ends_game_on_capture || false);
  const [canControlSquares, setCanControlSquares] = useState(currentPlacement?.can_control_squares || false);
  
  // HP/AD system state
  const [hitPoints, setHitPoints] = useState(currentPlacement?.hit_points ?? 1);
  const [attackDamage, setAttackDamage] = useState(currentPlacement?.attack_damage ?? 1);
  const [showHpAd, setShowHpAd] = useState(currentPlacement?.show_hp_ad || false);
  const [showRegen, setShowRegen] = useState(currentPlacement?.show_regen ?? false);
  const [hpRegen, setHpRegen] = useState(currentPlacement?.hp_regen ?? 0);
  const [cannotBeCaptured, setCannotBeCaptured] = useState(currentPlacement?.cannot_be_captured || false);
  
  // Trample & Ghostwalk state (per-placement overrides, initialized from placement or piece defaults)
  const [trample, setTrample] = useState(currentPlacement?.trample || false);
  const [trampleRadius, setTrampleRadius] = useState(currentPlacement?.trample_radius ?? 0);
  const [ghostwalk, setGhostwalk] = useState(currentPlacement?.ghostwalk || false);
  const [dieOnCapture, setDieOnCapture] = useState(currentPlacement?.die_on_capture || false);
  const [dieOnCaptureGrantsWin, setDieOnCaptureGrantsWin] = useState(currentPlacement?.die_on_capture_grants_win || false);
  const [attackRadius, setAttackRadius] = useState(currentPlacement?.attack_radius ?? 0);
  const [cannotMoveOutsideZone, setCannotMoveOutsideZone] = useState(currentPlacement?.cannot_move_outside_zone || false);
  const [isNeutral, setIsNeutral] = useState(currentPlacement?.is_neutral || false);
  const [neutralImageIndex, setNeutralImageIndex] = useState(currentPlacement?.neutral_image_index ?? 0);
  // "All players" ownership choice for placeable pieces (either player may deploy it as their own).
  const [isAllPlayers, setIsAllPlayers] = useState(currentPlacement?.player === 'all');
  
  // Burn/DOT system state
  const [burnDamage, setBurnDamage] = useState(currentPlacement?.burn_damage ?? 0);
  const [burnDuration, setBurnDuration] = useState(currentPlacement?.burn_duration ?? 0);
  const [showBurn, setShowBurn] = useState(currentPlacement?.show_burn ?? false);
  
  // Castling partner override state
  const [manualCastlingPartners, setManualCastlingPartners] = useState(currentPlacement?.manual_castling_partners || false);
  const [leftCastlingPartnerKey, setLeftCastlingPartnerKey] = useState(currentPlacement?.castling_partner_left_key || null);
  const [rightCastlingPartnerKey, setRightCastlingPartnerKey] = useState(currentPlacement?.castling_partner_right_key || null);
  const [castlingDistance, setCastlingDistance] = useState(currentPlacement?.castling_distance ?? defaultCastlingDistanceForBoard(boardWidth));
  
  // Fill row state
  const [fillRow, setFillRow] = useState(false);
  
  // Collapsible section state
  const [combatSectionOpen, setCombatSectionOpen] = useState(
    (currentPlacement?.hit_points ?? 1) > 1 || (currentPlacement?.attack_damage ?? 1) > 1 || (currentPlacement?.hp_regen ?? 0) > 0 || (currentPlacement?.burn_damage ?? 0) > 0
  );
  const [additionalSettingsOpen, setAdditionalSettingsOpen] = useState(
    currentPlacement?.cannot_be_captured || currentPlacement?.trample || currentPlacement?.ghostwalk || currentPlacement?.die_on_capture || (currentPlacement?.attack_radius > 0) || currentPlacement?.cannot_move_outside_zone || currentPlacement?.is_neutral || false
  );

  // Promotion options state (per-placement override)
  // Entries are { id:<pieceId>, player:<playerNumber|0 neutral> }. Legacy
  // plain-number data (own-side promotion) is resolved to the promoting
  // piece's player on load so the UI is fully explicit from here on.
  const initialPromotionPlayer = (() => {
    if (currentPlacement?.is_neutral) return 0;
    if (currentPlacement?.player_id != null) return Number(currentPlacement.player_id);
    return getInitialPlayerId();
  })();
  const initialPromotionOverrideEntries = (() => {
    const entries = normalizePromotionOverride(currentPlacement?.promotion_pieces_override);
    return entries.map(e => ({ id: e.id, player: e.player == null ? initialPromotionPlayer : e.player }));
  })();
  const [promotionSectionOpen, setPromotionSectionOpen] = useState(
    initialPromotionOverrideEntries.length > 0 ||
    !!currentPlacement?.can_promote_to_checkmate ||
    !!currentPlacement?.can_promote_to_capture ||
    !!currentPlacement?.disable_promotion
  );
  const [disablePromotion, setDisablePromotion] = useState(!!currentPlacement?.disable_promotion);
  const [customizePromotion, setCustomizePromotion] = useState(initialPromotionOverrideEntries.length > 0);
  const [promotionPieceEntries, setPromotionPieceEntries] = useState(initialPromotionOverrideEntries);
  // Which player a newly-added promotion target is assigned to. Defaults to the
  // player whose piece is currently being edited (own side).
  const [promotionTargetPlayer, setPromotionTargetPlayer] = useState(initialPromotionPlayer);
  const [canPromoteToCheckmate, setCanPromoteToCheckmate] = useState(!!currentPlacement?.can_promote_to_checkmate);
  const [limitCheckmateOriginal, setLimitCheckmateOriginal] = useState(!!currentPlacement?.limit_promote_checkmate_to_original);
  const [canPromoteToCapture, setCanPromoteToCapture] = useState(!!currentPlacement?.can_promote_to_capture);
  const [limitCaptureOriginal, setLimitCaptureOriginal] = useState(!!currentPlacement?.limit_promote_capture_to_original);
  const [capturePointsGain, setCapturePointsGain] = useState(Math.max(0, parseFloat(currentPlacement?.capture_points_gain) || 0));
  const [capturePointsLoss, setCapturePointsLoss] = useState(Math.max(0, parseFloat(currentPlacement?.capture_points_loss) || 0));
  const [pointsSectionOpen, setPointsSectionOpen] = useState(
    (currentPlacement?.capture_points_gain || 0) > 0 || (currentPlacement?.capture_points_loss || 0) > 0
  );
  const [promotionSearchTerm, setPromotionSearchTerm] = useState("");
  const [promotionPiecePage, setPromotionPiecePage] = useState(1);
  const PROMOTION_PIECES_PER_PAGE = 12;
  
  // Update selectedPlayerId when currentPlacement changes (e.g., when opening modal for different piece)
  useEffect(() => {
    if (currentPlacement?.player_id != null) {
      setSelectedPlayerId(currentPlacement.player_id);
    }
  }, [currentPlacement?.player_id]);

  // Reset manual-image-override flag when the player toggle changes — clicking Player 1/2
  // should always restore the player default image (per UX requirement).
  useEffect(() => {
    setImageManuallyOverridden(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlayerId]);
  
  // Save selected player ID to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('lastSelectedPlayerId', selectedPlayerId.toString());
  }, [selectedPlayerId]);

  useEffect(() => {
    if (preloadedPieces && preloadedPieces.length > 0) {
      setPieces(preloadedPieces);
      setLoading(false);
      return;
    }
    loadPieces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Memoize filtered pieces (before pagination) to avoid re-filtering on every render
  const allFilteredPieces = useMemo(() => {
    const excludeSet = Array.isArray(excludePieceIds) && excludePieceIds.length > 0
      ? new Set(excludePieceIds.map(id => Number(id)))
      : null;
    const base = excludeSet
      ? pieces.filter(p => !excludeSet.has(Number(p.id ?? p.piece_id)))
      : pieces;
    if (searchTerm.trim() === "") return base;
    const term = searchTerm.toLowerCase();
    return base.filter(piece => 
      (piece.piece_name && piece.piece_name.toLowerCase().includes(term)) ||
      (piece.id && piece.id.toString().includes(term)) ||
      (piece.piece_id && piece.piece_id.toString().includes(term)) ||
      (piece.piece_description && piece.piece_description.toLowerCase().includes(term))
    );
  }, [searchTerm, pieces, excludePieceIds]);

  const totalFilteredCount = allFilteredPieces.length;
  const totalPages = Math.ceil(totalFilteredCount / PIECES_PER_PAGE);

  // Memoize paginated pieces
  const paginatedPieces = useMemo(() => {
    const startIndex = (currentPage - 1) * PIECES_PER_PAGE;
    return allFilteredPieces.slice(startIndex, startIndex + PIECES_PER_PAGE);
  }, [allFilteredPieces, currentPage]);

  // Pre-compute thumbnail URLs for the current page to avoid JSON.parse in render
  const thumbnailMap = useMemo(() => {
    const map = {};
    paginatedPieces.forEach(piece => {
      const pieceId = piece.id || piece.piece_id;
      try {
        const images = JSON.parse(piece.image_location || "[]");
        const playerImageIndex = selectedPlayerId - 1;
        map[pieceId] = Array.isArray(images) && images.length > 0 
          ? getImageUrl(images[playerImageIndex] || images[0]) 
          : null;
      } catch (e) {
        map[pieceId] = null;
      }
    });
    return map;
  }, [paginatedPieces, selectedPlayerId]);

  // Reset to page 1 when search term changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  useEffect(() => {
    // When a piece is selected, load its available images
    if (selectedPieceId) {
      const piece = pieces.find(p => (p.id || p.piece_id) === selectedPieceId);
      if (piece && piece.image_location) {
        try {
          const images = JSON.parse(piece.image_location);
          const imageUrls = Array.isArray(images) ? images.map(img => getImageUrl(img)) : [];
          setAvailableImages(imageUrls);
          // If no image selected yet, use first available
          if (!selectedImageUrl && imageUrls.length > 0) {
            setSelectedImageUrl(imageUrls[0]);
          }
        } catch (e) {
          console.error("Error parsing image_location:", e);
          setAvailableImages([]);
        }
      } else {
        setAvailableImages([]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPieceId, pieces]);

  // Auto-select image based on player number (only when not manually overridden)
  useEffect(() => {
    if (imageManuallyOverridden) return;
    if (availableImages.length > 0 && selectedPlayerId) {
      // Player IDs are 1-indexed, array is 0-indexed
      const imageIndex = selectedPlayerId - 1;
      // Use the player's image if available, otherwise fall back to first image
      const targetImageIndex = imageIndex < availableImages.length ? imageIndex : 0;
      setSelectedImageUrl(availableImages[targetImageIndex]);
    }
  }, [selectedPlayerId, availableImages, imageManuallyOverridden]);

  const loadPieces = async () => {
    try {
      setLoading(true);
      // Try to load pieces with full movement data first
      let piecesData;
      try {
        const response = await PiecesService.getPiecesWithMovement();
        piecesData = response.data;
      } catch (err) {
        // Fallback to regular pieces if the full endpoint fails
        const response = await PiecesService.getPieces();
        piecesData = response.data;
      }
      setPieces(piecesData || []);
      setError(null);
    } catch (err) {
      console.error("Error loading pieces:", err);
      setError("Failed to load pieces. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Password-protected pieces ────────────────────────────────────────────
  // A creator can lock a piece so it can't be placed in someone else's game
  // without the password. Locked pieces still appear in the list (with a lock
  // badge) so people can see they exist; selecting one opens a prompt.
  const unlockedSet = useMemo(
    () => new Set([...(unlockedPieceIds || [])].map(Number)),
    [unlockedPieceIds]
  );
  const isLocked = (piece) => {
    const id = Number(piece.id ?? piece.piece_id);
    return !!piece.has_password && !unlockedSet.has(id);
  };

  const [unlockPrompt, setUnlockPrompt] = useState(null); // { piece }
  const [unlockInput, setUnlockInput] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);

  const submitUnlock = async () => {
    if (!unlockPrompt || !unlockInput) return;
    setUnlockBusy(true);
    setUnlockError("");
    const pieceId = Number(unlockPrompt.piece.id ?? unlockPrompt.piece.piece_id);
    try {
      const res = await PiecesService.verifyPiecePassword(pieceId, unlockInput);
      if (res.data?.unlocked) {
        onPieceUnlocked?.(pieceId, unlockInput);
        setSelectedPieceId(pieceId);
        setUnlockPrompt(null);
        setUnlockInput("");
      } else {
        setUnlockError("That password doesn't match. Check with the piece's creator.");
      }
    } catch {
      setUnlockError("Couldn't check the password. Please try again.");
    } finally {
      setUnlockBusy(false);
    }
  };

  const handlePieceClick = (piece) => {
    const pieceId = piece.id || piece.piece_id;
    if (isLocked(piece)) {
      setUnlockInput("");
      setUnlockError("");
      setUnlockPrompt({ piece });
      return;
    }
    setSelectedPieceId(pieceId);
  };

  const handleConfirm = () => {
    if (!selectedPieceId) {
      alert("Please select a piece first");
      return;
    }

    const selectedPiece = pieces.find(p => (p.id || p.piece_id) === selectedPieceId);
    if (!selectedPiece) {
      alert("Selected piece not found");
      return;
    }

    // Compute image_index from the selected URL within the available list.
    // Only persist as an override when it differs from the player default.
    let imageIndex = null;
    if (imageManuallyOverridden && availableImages.length > 0) {
      const idx = availableImages.indexOf(selectedImageUrl);
      if (idx >= 0) imageIndex = idx;
    }

    // Pass the full piece data along with placement-specific properties
    onSelect({
      ...selectedPiece,  // Include ALL piece data (movement, capture, etc.)
      piece_id: selectedPieceId,
      piece_name: selectedPiece.piece_name,
      player_id: isNeutral ? 0 : selectedPlayerId,
      image_url: selectedImageUrl,
      image_index: imageIndex,
      ends_game_on_checkmate: endsGameOnCheckmate,
      ends_game_on_capture: endsGameOnCapture,
      can_control_squares: canControlSquares,
      // HP/AD system
      hit_points: hitPoints,
      attack_damage: attackDamage,
      show_hp_ad: showHpAd,
      show_regen: showRegen,
      hp_regen: hpRegen,
      cannot_be_captured: cannotBeCaptured,
      // Burn/DOT system
      burn_damage: burnDamage,
      burn_duration: burnDuration,
      show_burn: showBurn,
      // Castling override data - if manual is enabled, default partners are disabled
      manual_castling_partners: manualCastlingPartners,
      castling_partner_left_key: manualCastlingPartners ? leftCastlingPartnerKey : null,
      castling_partner_right_key: manualCastlingPartners ? rightCastlingPartnerKey : null,
      castling_distance: castlingDistance,
      // Fill row option
      fillRow: fillRow,
      fillRowData: fillRow ? { row: squarePosition?.row, boardWidth } : null,
      // Trample & Ghostwalk
      trample: trample,
      trample_radius: trampleRadius,
      ghostwalk: ghostwalk,
      // Die on capture & Attack radius
      die_on_capture: dieOnCapture,
      die_on_capture_grants_win: dieOnCaptureGrantsWin,
      attack_radius: attackRadius,
      // Restriction zone
      cannot_move_outside_zone: cannotMoveOutsideZone,
      // Neutral piece
      is_neutral: isNeutral,
      neutral_image_index: isNeutral ? neutralImageIndex : null,
      // Placeable-piece ownership: 'all' when either player may deploy it.
      placement_all: isAllPlayers,
      // Promotion options (per-placement override)
      promotion_pieces_override: customizePromotion && promotionPieceEntries.length > 0 ? serializePromotionOverride(promotionPieceEntries) : null,
      can_promote_to_checkmate: !!canPromoteToCheckmate,
      limit_promote_checkmate_to_original: !!(canPromoteToCheckmate && limitCheckmateOriginal),
      can_promote_to_capture: !!canPromoteToCapture,
      limit_promote_capture_to_original: !!(canPromoteToCapture && limitCaptureOriginal),
      disable_promotion: !!disablePromotion,
      capture_points_gain: Math.max(0, parseFloat(capturePointsGain) || 0),
      capture_points_loss: Math.max(0, parseFloat(capturePointsLoss) || 0),
    });
  };

  // Get pieces on the same row for castling partner selection
  const piecesOnSameRow = React.useMemo(() => {
    if (!squarePosition) return [];
    const currentRow = squarePosition.row;
    const currentCol = squarePosition.col;
    
    const rowPieces = [];
    Object.entries(piecePlacements).forEach(([key, placement]) => {
      const [row, col] = key.split(',').map(Number);
      if (row === currentRow && col !== currentCol) {
        rowPieces.push({
          key,
          col,
          ...placement,
          displayName: `${placement.piece_name} (col ${col})`
        });
      }
    });
    
    // Sort by column
    return rowPieces.sort((a, b) => a.col - b.col);
  }, [piecePlacements, squarePosition]);
  
  // Get pieces to the left and right of the current square
  const { leftPieces, rightPieces } = React.useMemo(() => {
    if (!squarePosition) return { leftPieces: [], rightPieces: [] };
    const currentCol = squarePosition.col;
    
    return {
      leftPieces: piecesOnSameRow.filter(p => p.col < currentCol),
      rightPieces: piecesOnSameRow.filter(p => p.col > currentCol)
    };
  }, [piecesOnSameRow, squarePosition]);
  
  // Check if selected piece can castle
  const selectedPieceCanCastle = React.useMemo(() => {
    if (!selectedPieceId) return false;
    const piece = pieces.find(p => (p.id || p.piece_id) === selectedPieceId);
    return piece?.can_castle === 1 || piece?.can_castle === true;
  }, [selectedPieceId, pieces]);

  // Check if selected piece can promote (gates the Promotion Options section)
  const selectedPieceCanPromote = React.useMemo(() => {
    if (!selectedPieceId) return false;
    const piece = pieces.find(p => (p.id || p.piece_id) === selectedPieceId);
    return piece?.can_promote === 1 || piece?.can_promote === true;
  }, [selectedPieceId, pieces]);

  // Unique piece types currently placed on the board (by piece_id)
  const uniquePlacedPieceIds = React.useMemo(() => {
    const ids = new Set();
    Object.values(piecePlacements || {}).forEach(p => {
      if (p && p.piece_id && !p._occupied) ids.add(Number(p.piece_id));
    });
    // Always include the currently-selected piece even if not yet placed
    if (selectedPieceId) ids.add(Number(selectedPieceId));
    return ids;
  }, [piecePlacements, selectedPieceId]);

  // Cap the customizable promotion-target list. Each piece type may be added
  // once per player (player 1..N plus neutral), so scale the base cap by the
  // number of selectable owners.
  const promotionOwnerCount = Math.max(1, Number(playerCount) || 1) + 1; // +1 for neutral
  const promotionTargetCap = (uniquePlacedPieceIds.size + 8) * promotionOwnerCount;

  // List of selectable owners for a promotion target: each player plus neutral.
  const promotionPlayerOptions = React.useMemo(() => {
    const opts = [];
    const n = Math.max(1, Number(playerCount) || 1);
    for (let i = 1; i <= n; i++) opts.push({ value: i, label: `Player ${i}` });
    opts.push({ value: 0, label: 'Neutral' });
    return opts;
  }, [playerCount]);

  // Resolve the correct image thumbnail for a piece given a target player
  // (player 1 -> image[0], player 2 -> image[1], neutral -> image[0]).
  const getPromotionThumb = React.useCallback((p, player) => {
    if (!p) return null;
    try {
      const arr = JSON.parse(p.image_location || '[]');
      if (Array.isArray(arr) && arr.length > 0) {
        const idx = player === 0 ? 0 : Math.min(Math.max(0, (player || 1) - 1), arr.length - 1);
        return getImageUrl(arr[idx] || arr[0]);
      }
    } catch { /* ignore */ }
    return null;
  }, []);

  // Pieces eligible to appear in the customize-promotion picker: cap to N pieces total.
  // Prefer pieces already on the board first, then fill with other pieces (alphabetical).
  const promotionPickerPool = React.useMemo(() => {
    if (!Array.isArray(pieces) || pieces.length === 0) return [];
    const placed = [];
    const others = [];
    pieces.forEach(p => {
      const pid = p.id || p.piece_id;
      if (uniquePlacedPieceIds.has(Number(pid))) placed.push(p);
      else others.push(p);
    });
    placed.sort((a, b) => (a.piece_name || '').localeCompare(b.piece_name || ''));
    others.sort((a, b) => (a.piece_name || '').localeCompare(b.piece_name || ''));
    // Show ALL pieces — search and pagination handle navigating large lists.
    return [...placed, ...others];
  }, [pieces, uniquePlacedPieceIds]);

  const filteredPromotionPicker = React.useMemo(() => {
    if (!promotionSearchTerm.trim()) return promotionPickerPool;
    const term = promotionSearchTerm.toLowerCase();
    return promotionPickerPool.filter(p =>
      (p.piece_name && p.piece_name.toLowerCase().includes(term)) ||
      String(p.id || p.piece_id).includes(term)
    );
  }, [promotionPickerPool, promotionSearchTerm]);

  const promotionPickerTotalPages = Math.max(1, Math.ceil(filteredPromotionPicker.length / PROMOTION_PIECES_PER_PAGE));
  const paginatedPromotionPicker = React.useMemo(() => {
    const start = (promotionPiecePage - 1) * PROMOTION_PIECES_PER_PAGE;
    return filteredPromotionPicker.slice(start, start + PROMOTION_PIECES_PER_PAGE);
  }, [filteredPromotionPicker, promotionPiecePage]);

  React.useEffect(() => { setPromotionPiecePage(1); }, [promotionSearchTerm]);

  // Toggle a promotion target for the currently-selected target player. The
  // same piece type can be added once per player (id+player is the identity).
  const togglePromotionPieceEntry = (pid, player) => {
    const id = Number(pid);
    const pl = Number(player);
    setPromotionPieceEntries(prev => {
      const exists = prev.some(e => e.id === id && e.player === pl);
      if (exists) return prev.filter(e => !(e.id === id && e.player === pl));
      if (prev.length >= promotionTargetCap) return prev;
      return [...prev, { id, player: pl }];
    });
  };

  const removePromotionPieceEntry = (pid, player) => {
    const id = Number(pid);
    const pl = Number(player);
    setPromotionPieceEntries(prev => prev.filter(e => !(e.id === id && e.player === pl)));
  };

  // Calculate max castling distance based on closest castling partner piece
  const maxCastlingDistance = React.useMemo(() => {
    if (!squarePosition) return 20;
    const currentCol = squarePosition.col;
    const partnerDistances = [];

    if (manualCastlingPartners) {
      // Use manually selected partners
      if (leftCastlingPartnerKey) {
        const [, col] = leftCastlingPartnerKey.split(',').map(Number);
        partnerDistances.push(Math.abs(currentCol - col));
      }
      if (rightCastlingPartnerKey) {
        const [, col] = rightCastlingPartnerKey.split(',').map(Number);
        partnerDistances.push(Math.abs(currentCol - col));
      }
    } else {
      // Default: furthest piece on each side (matching game engine behavior)
      if (leftPieces.length > 0) {
        partnerDistances.push(Math.abs(currentCol - leftPieces[0].col));
      }
      if (rightPieces.length > 0) {
        partnerDistances.push(Math.abs(currentCol - rightPieces[rightPieces.length - 1].col));
      }
    }

    if (partnerDistances.length === 0) return 20;
    return Math.min(...partnerDistances);
  }, [squarePosition, manualCastlingPartners, leftCastlingPartnerKey, rightCastlingPartnerKey, leftPieces, rightPieces]);

  // Clamp castling distance when max changes (e.g., partner pieces moved)
  useEffect(() => {
    if (castlingDistance > maxCastlingDistance) {
      setCastlingDistance(maxCastlingDistance);
    }
  }, [maxCastlingDistance]); // eslint-disable-line react-hooks/exhaustive-deps

  // Content to render (shared between embedded and modal modes)
  const selectorContent = (
    <>
      <div className={styles["modal-body"]}>
        {/* Search Bar */}
        <div className={styles["search-section"]}>
          <input
            type="text"
            className={styles["search-input"]}
            placeholder="Search by name or ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoFocus={!embedded}
          />
        </div>

        {/* Player Selection */}
        <div className={styles["player-selection"]}>
          <label>Assign to Player:</label>
          <div className={styles["player-radio-group"]}>
            {Array.from({ length: playerCount }, (_, i) => i + 1).map(playerId => (
              <label key={playerId} className={styles["player-radio-label"]}>
                <input
                  type="radio"
                  name="player"
                  value={playerId}
                  checked={!isNeutral && !isAllPlayers && selectedPlayerId === playerId}
                  onChange={(e) => { setSelectedPlayerId(parseInt(e.target.value)); setIsNeutral(false); setIsAllPlayers(false); }}
                />
                <span>Player {playerId}</span>
              </label>
            ))}
            {allowAllPlayers && (
              <label className={styles["player-radio-label"]}>
                <input
                  type="radio"
                  name="player"
                  value="all"
                  checked={isAllPlayers}
                  onChange={() => { setIsAllPlayers(true); setIsNeutral(false); }}
                />
                <span>All Players <InfoTooltip text="Either player may deploy this piece, and it is placed as that player's own piece (in their colour). Choose this instead of adding the same piece type once per player." /></span>
              </label>
            )}
            <label className={styles["player-radio-label"]}>
              <input
                type="radio"
                name="player"
                value="neutral"
                checked={isNeutral}
                onChange={() => { setIsNeutral(true); setIsAllPlayers(false); }}
              />
              <span>Neutral <InfoTooltip text="A neutral piece belongs to no player. Either player can move it on their turn and use it to capture any other piece. It can also be captured by any player unless 'Uncapturable' is enabled. Use neutral pieces to create Duck Chess variants (where a duck block must be moved each turn) and other games where board objects can be manipulated by both sides." /></span>
            </label>
          </div>
        </div>

        {/* Piece List */}
        <div className={styles["piece-list-section"]}>
          {loading && <p key="loading">Loading pieces...</p>}
          {error && <p key="error" className={styles["error-text"]}>{error}</p>}
          {!loading && !error && totalFilteredCount > PIECES_PER_PAGE && (
            <p key="hint" className={styles["piece-count-hint"]}>
              Showing {paginatedPieces.length} of {totalFilteredCount} pieces (Page {currentPage} of {totalPages})
            </p>
          )}
          {!loading && !error && paginatedPieces.length === 0 && (
            <p key="no-pieces">No pieces found. Try a different search term.</p>
          )}
          
          {/* Pagination Controls */}
          {!loading && !error && totalPages > 1 && (
            <div key="pagination" className={styles["pagination-controls"]}>
              <button 
                className={styles["pagination-btn"]}
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
              >
                ««
              </button>
              <button 
                className={styles["pagination-btn"]}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                «
              </button>
              <span className={styles["pagination-info"]}>
                Page {currentPage} of {totalPages}
              </span>
              <button 
                className={styles["pagination-btn"]}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                »
              </button>
              <button 
                className={styles["pagination-btn"]}
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
              >
                »»
              </button>
            </div>
          )}
          {!loading && !error && paginatedPieces.length > 0 && (
            <div key="piece-grid" className={styles["piece-grid"]}>
              {paginatedPieces.map(piece => {
                const pieceId = piece.id || piece.piece_id;
                const thumbnail = thumbnailMap[pieceId];

                return (
                  <div
                    key={pieceId}
                    className={`${styles["piece-item"]} ${selectedPieceId === pieceId ? styles["selected"] : ""} ${isLocked(piece) ? styles["locked"] : ""}`}
                    onClick={() => handlePieceClick(piece)}
                    title={piece.has_password
                      ? (isLocked(piece)
                        ? `${piece.piece_name} is password-protected — click to enter its password`
                        : `${piece.piece_name} is password-protected (unlocked)`)
                      : undefined}
                  >
                    <div className={styles["piece-thumbnail"]}>
                      {thumbnail ? (
                        <img src={thumbnail} alt={piece.piece_name} loading="lazy" />
                      ) : (
                        <div className={styles["no-image"]}>
                          {piece.piece_name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      {/* !! matters: has_password comes back as 0/1, and a bare
                          `0 && ...` renders the number 0 next to the thumbnail. */}
                      {!!piece.has_password && (
                        <span
                          className={`${styles["piece-lock-badge"]} ${isLocked(piece) ? "" : styles["unlocked"]}`}
                          aria-label={isLocked(piece) ? "Password protected" : "Password protected, unlocked"}
                        >
                          {isLocked(piece) ? "🔒" : "🔓"}
                        </span>
                      )}
                    </div>
                    <div className={styles["piece-info"]}>
                      <div className={styles["piece-name"]}>{piece.piece_name}</div>
                      <div className={styles["piece-id"]}>ID: {pieceId}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Password prompt for a locked piece */}
        {unlockPrompt && (
          <div className={styles["piece-unlock-panel"]}>
            <h3>🔒 &ldquo;{unlockPrompt.piece.piece_name}&rdquo; is password-protected</h3>
            <p className={styles["piece-unlock-note"]}>
              Its creator set a password to control where this piece can be used.
              Enter it to place the piece in your game.
            </p>
            <div className={styles["piece-unlock-row"]}>
              <input
                type="password"
                autoFocus
                autoComplete="off"
                value={unlockInput}
                onChange={(e) => { setUnlockInput(e.target.value); setUnlockError(""); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); submitUnlock(); }
                  if (e.key === 'Escape') { e.preventDefault(); setUnlockPrompt(null); }
                }}
                placeholder="Piece password"
              />
              <StandardButton
                buttonText={unlockBusy ? "Checking..." : "Unlock"}
                onClick={submitUnlock}
                disabled={unlockBusy || !unlockInput}
              />
              <StandardButton
                buttonText="Cancel"
                onClick={() => { setUnlockPrompt(null); setUnlockInput(""); setUnlockError(""); }}
              />
            </div>
            {unlockError && <p className={styles["piece-unlock-error"]}>{unlockError}</p>}
          </div>
        )}

        {/* Win Condition Checkboxes */}
        {selectedPieceId && (mateCondition || captureCondition || (squaresCondition && requireSpecificPieceControl)) && (
          <div className={styles["win-condition-section"]}>
            <h3>End Game Conditions:</h3>
            <p className={styles["win-condition-note"]}>
              Check the boxes below to make this piece critical. The game will end if this piece meets the checked condition(s).
            </p>
            <div className={styles["checkbox-group"]}>
              {mateCondition && (
                <ToggleSwitch
                  checked={endsGameOnCheckmate}
                  onChange={(v) => setEndsGameOnCheckmate(v)}
                  label="Ends game on checkmate (this piece must be checkmated to win)"
                />
              )}
              {captureCondition && (
                <ToggleSwitch
                  checked={endsGameOnCapture}
                  onChange={(v) => setEndsGameOnCapture(v)}
                  label="End game if this piece is captured"
                />
              )}
              {squaresCondition && requireSpecificPieceControl && (
                <ToggleSwitch
                  checked={canControlSquares}
                  onChange={(v) => setCanControlSquares(v)}
                  label="Can control restricted control squares (only for squares marked &quot;require specific piece&quot;)"
                />
              )}
            </div>
          </div>
        )}

        {/* Image Selection (shown when piece is selected) */}
        {selectedPieceId && availableImages.length > 0 && (
          <div className={styles["image-selection-section"]}>
            <h3>Choose Image:</h3>
            <div className={styles["image-grid"]}>
              {availableImages.map((imageUrl, index) => (
                <div
                  key={index}
                  className={`${styles["image-option"]} ${selectedImageUrl === imageUrl ? styles["selected"] : ""}`}
                  onClick={() => {
                    setSelectedImageUrl(imageUrl);
                    setImageManuallyOverridden(true);
                  }}
                >
                  <img src={imageUrl} alt={`Option ${index + 1}`} loading="lazy" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Neutral Image Selection (shown when neutral is checked and piece has multiple images) */}
        {isNeutral && selectedPieceId && availableImages.length > 1 && (
          <div className={styles["image-selection-section"]}>
            <h3>Neutral Piece Image:</h3>
            <div className={styles["image-grid"]}>
              {availableImages.map((imageUrl, index) => (
                <div
                  key={index}
                  className={`${styles["image-option"]} ${neutralImageIndex === index ? styles["selected"] : ""}`}
                  onClick={() => setNeutralImageIndex(index)}
                >
                  <img src={imageUrl} alt={`Variant ${index + 1}`} loading="lazy" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* HP/AD System (shown when piece is selected) */}
        {selectedPieceId && (
          <div className={styles["hp-ad-section"]}>
            <h3 
              onClick={() => setCombatSectionOpen(!combatSectionOpen)} 
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: combatSectionOpen ? 'rotate(90deg)' : 'rotate(0deg)', marginRight: '4px' }}>▶</span>
              Combat Stats (HP, AD, Heal, Burn) <InfoTooltip text="Configure piece durability, damage, healing, and burn. By default, all pieces have 1 HP and 1 AD (standard chess behavior — one hit = one capture)." />
            </h3>
            {combatSectionOpen && (
              <>
            <div className={styles["hp-ad-row"]}>
              <div className={styles["hp-ad-field"]}>
                <label>
                  Health Points <InfoTooltip text="How much damage this piece can take before being captured. At 1 HP (default), any attack captures it instantly." />
                </label>
                <NumberInput
                  value={hitPoints}
                  onChange={(val) => setHitPoints(val)}
                  options={{ min: 1, max: 100 }}
                />
              </div>
              <div className={styles["hp-ad-field"]}>
                <label>
                  Attack Damage <InfoTooltip text="How much HP this piece removes from a target when attacking. At 1 AD (default), it deals 1 damage per attack." />
                </label>
                <NumberInput
                  value={attackDamage}
                  onChange={(val) => setAttackDamage(val)}
                  options={{ min: 1, max: 100 }}
                />
              </div>
            </div>
            <div className={styles["hp-ad-row"]}>
              <div className={styles["hp-ad-field"]}>
                <label>
                  HP Regen (per turn) <InfoTooltip text="HP regenerated at the start of this piece's owner's turn. Set to 0 for no regen. Cannot exceed the piece's max HP." />
                </label>
                <NumberInput
                  value={hpRegen}
                  onChange={(val) => setHpRegen(val)}
                  options={{ min: 0, max: 100 }}
                />
              </div>
            </div>
            <div className={styles["hp-ad-row"]}>
              <div className={styles["hp-ad-field"]}>
                <label>
                  Burn Damage (per turn) <InfoTooltip text="When this piece attacks and the target survives, the target takes this much damage at the start of each of their turns. Both burn damage and duration must be at least 1 if either is set." />
                </label>
                <NumberInput
                  value={burnDamage}
                  onChange={(val) => {
                    setBurnDamage(val);
                    if (val > 0 && burnDuration < 1) setBurnDuration(1);
                    if (val === 0) setBurnDuration(0);
                  }}
                  options={{ min: 0, max: 10 }}
                />
              </div>
              <div className={styles["hp-ad-field"]}>
                <label>
                  Burn Duration (turns) <InfoTooltip text="Number of turns the burn damage lasts on the target. Both burn damage and duration must be at least 1 if either is set." />
                </label>
                <NumberInput
                  value={burnDuration}
                  onChange={(val) => {
                    setBurnDuration(val);
                    if (val > 0 && burnDamage < 1) setBurnDamage(1);
                    if (val === 0) setBurnDamage(0);
                  }}
                  options={{ min: 0, max: 100 }}
                />
              </div>
            </div>
            <div className={styles["checkbox-group"]}>
              <ToggleSwitch
                checked={showHpAd}
                onChange={(v) => setShowHpAd(v)}
                label="Show HP/AD badge"
                tooltip={<InfoTooltip text="Display an HP bar and AD badge on this piece during gameplay. Can also be toggled globally in game settings." />}
              />
              <ToggleSwitch
                checked={showRegen}
                onChange={(v) => setShowRegen(v)}
                label="Show Regen badge"
                tooltip={<InfoTooltip text="Display the HP regeneration badge on this piece. Regen still functions even if hidden." />}
              />
              <ToggleSwitch
                checked={showBurn}
                onChange={(v) => setShowBurn(v)}
                label="Show Burn badge"
                tooltip={<InfoTooltip text="Display the burn damage badge on this piece. The badge shows damage/duration — e.g. 🔥2/3 means this piece deals 2 burn damage per turn for 3 turns when it attacks. Burn still functions even if hidden." />}
              />
            </div>
            <p style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
              HP/AD system inspired by ideas from Vasilije. Check out his project at{' '}
              <a href="https://www.nichess.org/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--link-color, #58a6ff)' }}>nichess.org</a>
            </p>
              </>
            )}
          </div>
        )}

        {/* Additional Piece Settings */}
        {selectedPieceId && (
          <div className={styles["hp-ad-section"]}>
            <h3
              onClick={() => setAdditionalSettingsOpen(!additionalSettingsOpen)}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: additionalSettingsOpen ? 'rotate(90deg)' : 'rotate(0deg)', marginRight: '4px' }}>▶</span>
              Additional Piece Settings <InfoTooltip text="Configure special abilities like damage immunity, trample, and ghostwalk for this placement." />
            </h3>
            {additionalSettingsOpen && (
              <>
            <div className={styles["control-config-row"]}>
              <ToggleSwitch
                checked={cannotBeCaptured}
                onChange={(v) => setCannotBeCaptured(v)}
                label="Cannot be captured or damaged"
                tooltip={<InfoTooltip text="This piece is completely immune to all damage and capture. Attacks against it are blocked. Useful for obstacle or terrain pieces." />}
              />
            </div>
            <div className={styles["control-config-row"]}>
              <ToggleSwitch
                checked={trample}
                onChange={(v) => setTrample(v)}
                label="Trample"
                tooltip={<InfoTooltip text="This piece damages all pieces in its straight-line path during movement. Trample can cause check if the piece has hop abilities. Trample radius controls how wide the area of effect is." />}
              />
              {trample && (
                <div style={{ marginTop: '6px', marginLeft: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Trample Radius:</label>
                  <NumberInput
                    value={trampleRadius}
                    onChange={(val) => { setTrampleRadius(val); if (val > 0) { setAttackRadius(0); } }}
                    options={{ min: 0, max: 4 }}
                  />
                  <InfoTooltip text="0 = only pieces directly in path. 1+ = also affects surrounding squares at each step along the path. Checkmateable pieces (e.g. kings) are immune to trample radius splash damage. Cannot be combined with attack radius." />
                </div>
              )}
            </div>
            <div className={styles["control-config-row"]}>
              <ToggleSwitch
                checked={ghostwalk}
                onChange={(v) => setGhostwalk(v)}
                label="Ghostwalk"
                tooltip={<InfoTooltip text="This piece can pass through any piece (ally or enemy) during movement." />}
              />
            </div>
            <div className={styles["control-config-row"]}>
              <ToggleSwitch
                checked={dieOnCapture}
                onChange={(v) => { setDieOnCapture(v); if (!v) setDieOnCaptureGrantsWin(false); }}
                label="Dies on Capture"
                tooltip={<InfoTooltip text="This piece is also removed from the board when it captures another piece. Useful for explosive or kamikaze-style pieces." />}
              />
            </div>
            {dieOnCapture && (
              <div className={styles["control-config-row"]} style={{ paddingLeft: '24px' }}>
                <ToggleSwitch
                  checked={dieOnCaptureGrantsWin}
                  onChange={(v) => setDieOnCaptureGrantsWin(v)}
                  label="Attacker Wins on Final Capture"
                  tooltip={<InfoTooltip text="If this piece kills the opponent's last required-to-win piece while dying in the process (normally a draw), the attacking player wins instead." />}
                />
              </div>
            )}
            <div style={{ marginTop: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                Attack Radius:
                <NumberInput
                  value={attackRadius}
                  onChange={(val) => { setAttackRadius(val); if (val > 0) { setTrampleRadius(0); } }}
                  options={{ min: 0, max: 4 }}
                />
                <InfoTooltip text="When this piece captures, it also damages all enemy pieces within this radius of the landing square. Unlike trample radius, attack radius does not require trample and only fires at the destination. Checkmateable pieces (e.g. kings) are immune to splash damage. Cannot be combined with trample radius." />
              </label>
            </div>
            {hasRestrictionZones && (
              <div className={styles["control-config-row"]} style={{ marginTop: '8px' }}>
                <ToggleSwitch
                  checked={cannotMoveOutsideZone}
                  onChange={(v) => setCannotMoveOutsideZone(v)}
                  label="Cannot Move Outside Restricted Zone"
                  tooltip={<InfoTooltip text="This piece is bound to the Restriction Zone — any move or attack that would place it on a square not marked as a Restriction Zone is illegal and will not execute. Restriction Zone squares are custom squares with the 'Acts as Restriction Zone' ability enabled (configured in Step 3)." />}
                />
              </div>
            )}
              </>
            )}
          </div>
        )}

        {/* Promotion Options (shown when selected piece can promote) */}
        {selectedPieceCanPromote && (
          <div className={styles["hp-ad-section"]}>
            <h3
              onClick={() => setPromotionSectionOpen(!promotionSectionOpen)}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: promotionSectionOpen ? 'rotate(90deg)' : 'rotate(0deg)', marginRight: '4px' }}>▶</span>
              Promotion Options <InfoTooltip text="Choose what this piece can promote into when it lands on a promotion square. By default, it can promote to any starting piece (excluding promotable, checkmate, and capture-loss pieces)." />
            </h3>
            {promotionSectionOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Customize promotion targets */}
                <div>
                <ToggleSwitch
                  checked={customizePromotion}
                  onChange={(v) => {
                    setCustomizePromotion(v);
                    if (!v) setPromotionPieceEntries([]);
                  }}
                  label="Customize promotion options"
                  tooltip={<InfoTooltip text={`Override which pieces this piece can promote into. Each piece type can be added once per player (including neutral). Use the owner selector below to choose whether a target becomes your own, the opponent's, or a neutral piece when promoted. If left unchecked, default behavior applies.`} />}
                />

                  {customizePromotion && (
                    <div style={{ marginLeft: '20px', borderLeft: '3px solid var(--button-border)', paddingLeft: '12px', marginTop: '8px' }}>
                      {/* Target owner selector — controls which player a newly
                          added promotion target becomes when chosen in-game. */}
                      <div style={{ marginBottom: '10px' }}>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                          Add promotion targets as: <InfoTooltip text="Choose the owner for pieces you add below. 'Player N' makes the promoted piece belong to that player; 'Neutral' makes it a neutral piece controlled by all players. Defaults to this placement's own player." />
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                          {promotionPlayerOptions.map(opt => (
                            <label key={`ptp-${opt.value}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name="promotionTargetPlayer"
                                checked={promotionTargetPlayer === opt.value}
                                onChange={() => setPromotionTargetPlayer(opt.value)}
                              />
                              {opt.label}
                            </label>
                          ))}
                        </div>
                      </div>
                      {/* Selected pieces summary (always visible regardless of search/page) */}
                      {promotionPieceEntries.length > 0 && (
                        <div style={{ marginBottom: '10px' }}>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Selected pieces:</div>
                          <div style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '6px',
                            padding: '6px',
                            backgroundColor: 'rgba(117,124,252,0.08)',
                            borderRadius: '6px',
                            border: '1px solid rgba(117,124,252,0.3)'
                          }}>
                            {promotionPieceEntries.map(entry => {
                              const p = pieces.find(pp => Number(pp.id || pp.piece_id) === Number(entry.id));
                              const name = p?.piece_name || `#${entry.id}`;
                              const ownerLabel = entry.player === 0 ? 'Neutral' : `P${entry.player}`;
                              const thumb = getPromotionThumb(p, entry.player);
                              return (
                                <div
                                  key={`sel-${entry.id}-${entry.player}`}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    padding: '3px 6px 3px 3px',
                                    borderRadius: 4,
                                    backgroundColor: 'rgba(117,124,252,0.25)',
                                    fontSize: 12
                                  }}
                                >
                                  {thumb ? (
                                    <img src={thumb} alt={name} style={{ width: 20, height: 20, objectFit: 'contain' }} />
                                  ) : (
                                    <div style={{ width: 20, height: 20, background: 'rgba(255,255,255,0.1)', borderRadius: 2 }} />
                                  )}
                                  <span>{name}</span>
                                  <span style={{
                                    fontSize: 10,
                                    fontWeight: 600,
                                    padding: '1px 4px',
                                    borderRadius: 3,
                                    backgroundColor: entry.player === 0 ? 'rgba(160,160,160,0.35)' : 'rgba(117,124,252,0.45)'
                                  }}>{ownerLabel}</span>
                                  <button
                                    type="button"
                                    onClick={() => removePromotionPieceEntry(entry.id, entry.player)}
                                    title="Remove"
                                    style={{
                                      background: 'transparent',
                                      border: 'none',
                                      color: 'inherit',
                                      cursor: 'pointer',
                                      padding: '0 2px',
                                      fontSize: 14,
                                      lineHeight: 1
                                    }}
                                  >×</button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      <input
                        type="text"
                        className={styles["form-input"]}
                        placeholder="Search pieces..."
                        value={promotionSearchTerm}
                        onChange={(e) => setPromotionSearchTerm(e.target.value)}
                        style={{ marginBottom: '8px', maxWidth: '260px' }}
                      />
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                        {promotionPieceEntries.length} / {promotionTargetCap} selected
                      </div>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
                        gap: '8px',
                        padding: '8px',
                        backgroundColor: 'var(--bg-dark, rgba(0,0,0,0.2))',
                        borderRadius: '6px',
                        maxHeight: '260px',
                        overflowY: 'auto'
                      }}>
                        {paginatedPromotionPicker.map(p => {
                          const pid = Number(p.id || p.piece_id);
                          const isSel = promotionPieceEntries.some(e => e.id === pid && e.player === promotionTargetPlayer);
                          const thumb = getPromotionThumb(p, promotionTargetPlayer);
                          return (
                            <div
                              key={pid}
                              onClick={() => togglePromotionPieceEntry(pid, promotionTargetPlayer)}
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                padding: '6px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                backgroundColor: isSel ? 'rgba(117,124,252,0.3)' : 'rgba(255,255,255,0.04)',
                                border: isSel ? '2px solid var(--button-border)' : '2px solid transparent'
                              }}
                            >
                              {thumb ? (
                                <img src={thumb} alt={p.piece_name} style={{ width: 44, height: 44, objectFit: 'contain' }} />
                              ) : (
                                <div style={{ width: 44, height: 44, background: 'rgba(255,255,255,0.1)', borderRadius: 4 }} />
                              )}
                              <span style={{ fontSize: 11, marginTop: 4, textAlign: 'center', color: isSel ? 'var(--button-border)' : 'inherit' }}>
                                {p.piece_name || `#${pid}`}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {promotionPickerTotalPages > 1 && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8 }}>
                          <button type="button" onClick={() => setPromotionPiecePage(Math.max(1, promotionPiecePage - 1))} disabled={promotionPiecePage === 1}>Prev</button>
                          <span style={{ fontSize: 12 }}>Page {promotionPiecePage} / {promotionPickerTotalPages}</span>
                          <button type="button" onClick={() => setPromotionPiecePage(Math.min(promotionPickerTotalPages, promotionPiecePage + 1))} disabled={promotionPiecePage === promotionPickerTotalPages}>Next</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Can promote to checkmate pieces (only when checkmate win condition is active) */}
                {mateCondition && (
                  <div>
                    <ToggleSwitch
                      checked={canPromoteToCheckmate}
                      onChange={(v) => {
                        setCanPromoteToCheckmate(v);
                        if (!v) setLimitCheckmateOriginal(false);
                      }}
                      label="Can promote to checkmate pieces"
                      tooltip={<InfoTooltip text="Allow this piece to promote into pieces that end the game when checkmated (e.g. kings)." />}
                    />
                    {canPromoteToCheckmate && (
                      <div style={{ marginLeft: 24, marginTop: 4 }}>
                        <ToggleSwitch
                          checked={limitCheckmateOriginal}
                          onChange={(v) => setLimitCheckmateOriginal(v)}
                          label="Cannot exceed the original number of checkmateable pieces this player started with"
                          tooltip={<InfoTooltip text="When active, the checkmate piece will be hidden from the promotion modal once you already control as many checkmate pieces as you started the game with." />}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Can promote to win-on-capture pieces */}
                <div>
                  <ToggleSwitch
                    checked={canPromoteToCapture}
                    onChange={(v) => {
                      setCanPromoteToCapture(v);
                      if (!v) setLimitCaptureOriginal(false);
                    }}
                    label="Can promote to win-on-capture pieces"
                    tooltip={<InfoTooltip text="Allow this piece to promote into pieces that end the game when captured." />}
                  />
                  {canPromoteToCapture && (
                    <div style={{ marginLeft: 24, marginTop: 4 }}>
                      <ToggleSwitch
                        checked={limitCaptureOriginal}
                        onChange={(v) => setLimitCaptureOriginal(v)}
                        label="Cannot exceed the original number of win-on-capture pieces this player started with"
                        tooltip={<InfoTooltip text="When active, the win-on-capture piece will be hidden from the promotion modal once you already control as many such pieces as you started the game with." />}
                      />
                    </div>
                  )}
                  <div style={{ marginTop: 8 }}>
                    <ToggleSwitch
                      checked={disablePromotion}
                      onChange={(v) => setDisablePromotion(v)}
                      label="Disable promotion for this placement only"
                      tooltip={<InfoTooltip text="Prevent this specific piece from promoting, even though the piece template has promotion enabled. Useful when you want some copies of a piece to be unable to promote." />}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Castling Partner Override (shown when piece can castle) */}
        {selectedPieceCanCastle && (
          <div className={styles["castling-section"]}>
            <h3>Castling Partners:</h3>
            <p className={styles["castling-note"]}>
              By default, this piece will castle with the furthest allied piece on each side.
              Check below to manually specify castling partners.
            </p>
            <ToggleSwitch
              checked={manualCastlingPartners}
              onChange={(v) => {
                setManualCastlingPartners(v);
                if (!v) {
                  setLeftCastlingPartnerKey(null);
                  setRightCastlingPartnerKey(null);
                }
              }}
              label="Manually set castling partners"
            />

            <div className={styles["castling-distance-section"]}>
              <label>Castling Distance (squares):</label>
              <input
                type="number"
                min="1"
                max={maxCastlingDistance}
                value={castlingDistance}
                onChange={(e) => setCastlingDistance(Math.max(1, Math.min(maxCastlingDistance, parseInt(e.target.value) || defaultCastlingDistanceForBoard(boardWidth))))}
                className={styles["castling-distance-input"]}
              />
              <span className={styles["castling-distance-hint"]}>
                How many squares this piece moves toward its partner when castling (default: 2 for chess).
                {maxCastlingDistance < 20 && (
                  <> Max {maxCastlingDistance} — limited by the closest castling partner on the same row ({maxCastlingDistance} square{maxCastlingDistance !== 1 ? 's' : ''} away, excluding the partner's square).</>
                )}
              </span>
              <div className={styles["castling-distance-tooltip"]}>
                <span className={styles["tooltip-trigger"]}>ℹ️ Why is there a max?</span>
                <div className={styles["tooltip-content"]}>
                  The maximum castling distance is determined by the closest castling partner on the same row. The piece cannot move onto or past its partner. For standard chess, the king is 3 squares from the nearest rook, so the max is 3.
                </div>
              </div>
            </div>
            
            {manualCastlingPartners && (
              <div className={styles["castling-partner-selectors"]}>
                {/* Left Partner */}
                <div className={styles["partner-selector"]}>
                  <label>Left Partner:</label>
                  <select
                    value={leftCastlingPartnerKey || ""}
                    onChange={(e) => setLeftCastlingPartnerKey(e.target.value || null)}
                  >
                    <option value="">None</option>
                    {leftPieces.map(p => (
                      <option key={p.key} value={p.key}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>
                  {leftPieces.length === 0 && (
                    <span className={styles["no-partners-hint"]}>No pieces to the left</span>
                  )}
                </div>
                
                {/* Right Partner */}
                <div className={styles["partner-selector"]}>
                  <label>Right Partner:</label>
                  <select
                    value={rightCastlingPartnerKey || ""}
                    onChange={(e) => setRightCastlingPartnerKey(e.target.value || null)}
                  >
                    <option value="">None</option>
                    {rightPieces.map(p => (
                      <option key={p.key} value={p.key}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>
                  {rightPieces.length === 0 && (
                    <span className={styles["no-partners-hint"]}>No pieces to the right</span>
                  )}
                </div>
                
                <p className={styles["castling-warning"]}>
                  ⚠️ When manually set, only selected partners will be used (default partners are disabled).
                </p>
              </div>
            )}
          </div>
        )}

        {/* Points Win Condition — per-piece capture points */}
        {pointsCondition && (
        <div className={styles["hp-ad-section"]}>
          <h3
            onClick={() => setPointsSectionOpen(!pointsSectionOpen)}
            style={{ cursor: 'pointer', userSelect: 'none' }}
          >
            <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: pointsSectionOpen ? 'rotate(90deg)' : 'rotate(0deg)', marginRight: '4px' }}>▶</span>
            Points <InfoTooltip text="Configure how this piece affects scores when captured. Requires the Points Win Condition to be enabled in Step 2. 'Gain' is awarded to the player who captures this piece; 'Loss' is deducted from the owner when this piece is captured." />
          </h3>
          {pointsSectionOpen && (
            <>
              <div className={styles["hp-ad-row"]}>
                <div className={styles["hp-ad-field"]}>
                  <label>
                    Capture Points Gain
                    <InfoTooltip text="Points awarded to the player who captures this piece." />
                  </label>
                  <NumberInput
                    value={capturePointsGain}
                    onChange={(val) => setCapturePointsGain(Math.max(0, Math.min(9999, val || 0)))}
                    options={{ min: 0, max: 9999, step: 0.5, allowDecimals: true, placeholder: "0" }}
                  />
                </div>
                <div className={styles["hp-ad-field"]}>
                  <label>
                    Capture Points Loss
                    <InfoTooltip text="Points deducted from the piece owner when this piece is captured. Score cannot go below 0." />
                  </label>
                  <NumberInput
                    value={capturePointsLoss}
                    onChange={(val) => setCapturePointsLoss(Math.max(0, Math.min(9999, val || 0)))}
                    options={{ min: 0, max: 9999, step: 0.5, allowDecimals: true, placeholder: "0" }}
                  />
                </div>
              </div>
            </>
          )}
        </div>
        )}

        {/* Fill Row Toggle */}
        <div 
          className={`${styles["fill-row-toggle"]} ${fillRow ? styles.active : ''}`}
          onClick={() => setFillRow(!fillRow)}
        >
          <div className={`${styles["fill-row-switch"]} ${fillRow ? styles.on : ''}`} />
          <div className={styles["fill-row-content"]}>
            <span className={styles["fill-row-label"]}>
              <span className={styles["fill-row-icon"]}>↔</span>
              Fill Entire Row
            </span>
            <span className={styles["fill-row-hint"]}>
              Place this piece on all squares in rank {toRank(squarePosition?.row)}
            </span>
          </div>
        </div>

        {/* Remove Row button */}
        {onRemoveRow && (
          <button
            type="button"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 16px',
              margin: '8px 0',
              background: 'rgba(190, 140, 0, 0.15)',
              border: '2px solid rgba(190, 140, 0, 0.5)',
              borderRadius: '6px',
              color: '#ffc94d',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '600',
              width: '100%',
              textAlign: 'left',
              transition: 'background 0.2s, border-color 0.2s',
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(190,140,0,0.28)'; e.currentTarget.style.borderColor = 'rgba(190,140,0,0.8)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(190,140,0,0.15)'; e.currentTarget.style.borderColor = 'rgba(190,140,0,0.5)'; }}
            onClick={() => { if (window.confirm(`Remove all pieces from rank ${toRank(squarePosition?.row)}?`)) onRemoveRow(squarePosition?.row); }}
          >
            <span style={{ fontSize: '16px' }}>✕</span>
            Remove Entire Row
          </button>
        )}
      </div>

      <div className={styles["modal-footer"]}>
        {currentPlacement && (
          <StandardButton 
            buttonText="Remove Piece" 
            onClick={onRemove}
          />
        )}
        <div style={{ flex: 1 }} />
        <StandardButton 
          buttonText="Cancel" 
          onClick={onCancel}
        />
        <StandardButton 
          buttonText="Confirm" 
          onClick={handleConfirm}
          disabled={!selectedPieceId}
        />
      </div>
    </>
  );

  // If embedded, wrap content in a flex div so modal-body can scroll within parent
  if (embedded) {
    return (
      <div
        style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}
        onKeyDown={(e) => { if (e.key === 'Enter' && selectedPieceId) { e.preventDefault(); handleConfirm(); } }}
      >
        {selectorContent}
      </div>
    );
  }

  // Otherwise, wrap in modal
  return (
    <div className={styles["modal-overlay"]} onClick={onCancel}>
      <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter' && selectedPieceId) handleConfirm(); }}>
        <div className={styles["modal-header"]}>
          <h2>Select Piece for {toFile(squarePosition?.col)}{toRank(squarePosition?.row)}</h2>
          <button className={styles["close-button"]} onClick={onCancel}>✕</button>
        </div>
        {selectorContent}
      </div>
    </div>
  );
};

export default PieceSelector;
