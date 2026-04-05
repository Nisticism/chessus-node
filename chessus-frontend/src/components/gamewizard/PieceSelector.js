import React, { useState, useEffect, useMemo } from "react";
import styles from "./gamewizard.module.scss";
import StandardButton from "../standardbutton/StandardButton";
import PiecesService from "../../services/pieces.service";
import InfoTooltip from "../piecewizard/InfoTooltip";
import NumberInput from "../common/NumberInput";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

const getImageUrl = (imagePath) => {
  if (!imagePath) return null;
  if (imagePath.startsWith('http')) return imagePath;
  return `${ASSET_URL}${imagePath}`;
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
  embedded = false  // New prop: if true, don't render modal wrapper
}) => {
  const [pieces, setPieces] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const PIECES_PER_PAGE = 25;
  
  // Initialize selectedPlayerId with last used value from localStorage, or currentPlacement, or default to 1
  const getInitialPlayerId = () => {
    if (currentPlacement?.player_id) {
      return currentPlacement.player_id;
    }
    const lastUsedPlayer = localStorage.getItem('lastSelectedPlayerId');
    return lastUsedPlayer ? parseInt(lastUsedPlayer) : 1;
  };
  
  const [selectedPieceId, setSelectedPieceId] = useState(currentPlacement?.piece_id || null);
  const [selectedPlayerId, setSelectedPlayerId] = useState(getInitialPlayerId());
  const [selectedImageUrl, setSelectedImageUrl] = useState(currentPlacement?.image_url || "");
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
  
  // Burn/DOT system state
  const [burnDamage, setBurnDamage] = useState(currentPlacement?.burn_damage ?? 0);
  const [burnDuration, setBurnDuration] = useState(currentPlacement?.burn_duration ?? 0);
  const [showBurn, setShowBurn] = useState(currentPlacement?.show_burn ?? false);
  
  // Castling partner override state
  const [manualCastlingPartners, setManualCastlingPartners] = useState(currentPlacement?.manual_castling_partners || false);
  const [leftCastlingPartnerKey, setLeftCastlingPartnerKey] = useState(currentPlacement?.castling_partner_left_key || null);
  const [rightCastlingPartnerKey, setRightCastlingPartnerKey] = useState(currentPlacement?.castling_partner_right_key || null);
  const [castlingDistance, setCastlingDistance] = useState(currentPlacement?.castling_distance ?? 2);
  
  // Fill row state
  const [fillRow, setFillRow] = useState(false);
  
  // Collapsible section state
  const [combatSectionOpen, setCombatSectionOpen] = useState(
    (currentPlacement?.hit_points ?? 1) > 1 || (currentPlacement?.attack_damage ?? 1) > 1 || (currentPlacement?.hp_regen ?? 0) > 0 || (currentPlacement?.burn_damage ?? 0) > 0
  );
  const [additionalSettingsOpen, setAdditionalSettingsOpen] = useState(
    currentPlacement?.cannot_be_captured || currentPlacement?.trample || currentPlacement?.ghostwalk || false
  );
  
  // Update selectedPlayerId when currentPlacement changes (e.g., when opening modal for different piece)
  useEffect(() => {
    if (currentPlacement?.player_id) {
      setSelectedPlayerId(currentPlacement.player_id);
    }
  }, [currentPlacement?.player_id]);
  
  // Save selected player ID to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('lastSelectedPlayerId', selectedPlayerId.toString());
  }, [selectedPlayerId]);

  useEffect(() => {
    loadPieces();
  }, []);

  // Memoize filtered pieces (before pagination) to avoid re-filtering on every render
  const allFilteredPieces = useMemo(() => {
    if (searchTerm.trim() === "") return pieces;
    const term = searchTerm.toLowerCase();
    return pieces.filter(piece => 
      (piece.piece_name && piece.piece_name.toLowerCase().includes(term)) ||
      (piece.id && piece.id.toString().includes(term)) ||
      (piece.piece_id && piece.piece_id.toString().includes(term)) ||
      (piece.piece_description && piece.piece_description.toLowerCase().includes(term))
    );
  }, [searchTerm, pieces]);

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
      console.log("Selected piece:", piece);
      if (piece && piece.image_location) {
        try {
          const images = JSON.parse(piece.image_location);
          const imageUrls = Array.isArray(images) ? images.map(img => getImageUrl(img)) : [];
          console.log("Parsed images for piece", piece.id, ":", imageUrls);
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
        console.log("No image_location for piece:", piece);
        setAvailableImages([]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPieceId, pieces]);

  // Auto-select image based on player number
  useEffect(() => {
    if (availableImages.length > 0 && selectedPlayerId) {
      // Player IDs are 1-indexed, array is 0-indexed
      const imageIndex = selectedPlayerId - 1;
      // Use the player's image if available, otherwise fall back to first image
      const targetImageIndex = imageIndex < availableImages.length ? imageIndex : 0;
      setSelectedImageUrl(availableImages[targetImageIndex]);
    }
  }, [selectedPlayerId, availableImages]);

  const loadPieces = async () => {
    try {
      setLoading(true);
      // Try to load pieces with full movement data first
      let piecesData;
      try {
        const response = await PiecesService.getPiecesWithMovement();
        piecesData = response.data;
        console.log("Loaded pieces with movement:", piecesData?.length, "pieces");
      } catch (err) {
        // Fallback to regular pieces if the full endpoint fails
        console.log("Falling back to regular pieces endpoint");
        const response = await PiecesService.getPieces();
        piecesData = response.data;
        console.log("Loaded regular pieces:", piecesData?.length, "pieces");
      }
      if (piecesData?.length > 0) {
        console.log("Sample piece data:", piecesData[0]);
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

  const handlePieceClick = (piece) => {
    const pieceId = piece.id || piece.piece_id;
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

    // Pass the full piece data along with placement-specific properties
    onSelect({
      ...selectedPiece,  // Include ALL piece data (movement, capture, etc.)
      piece_id: selectedPieceId,
      piece_name: selectedPiece.piece_name,
      player_id: selectedPlayerId,
      image_url: selectedImageUrl,
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
      ghostwalk: ghostwalk
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
                  checked={selectedPlayerId === playerId}
                  onChange={(e) => setSelectedPlayerId(parseInt(e.target.value))}
                />
                <span>Player {playerId}</span>
              </label>
            ))}
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
                    className={`${styles["piece-item"]} ${selectedPieceId === pieceId ? styles["selected"] : ""}`}
                    onClick={() => handlePieceClick(piece)}
                  >
                    <div className={styles["piece-thumbnail"]}>
                      {thumbnail ? (
                        <img src={thumbnail} alt={piece.piece_name} loading="lazy" />
                      ) : (
                        <div className={styles["no-image"]}>
                          {piece.piece_name.charAt(0).toUpperCase()}
                        </div>
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

        {/* Win Condition Checkboxes */}
        {selectedPieceId && (mateCondition || captureCondition || (squaresCondition && requireSpecificPieceControl)) && (
          <div className={styles["win-condition-section"]}>
            <h3>End Game Conditions:</h3>
            <p className={styles["win-condition-note"]}>
              Check the boxes below to make this piece critical. The game will end if this piece meets the checked condition(s).
            </p>
            <div className={styles["checkbox-group"]}>
              {mateCondition && (
                <label key="checkmate" className={styles["checkbox-label"]}>
                  <input
                    type="checkbox"
                    checked={endsGameOnCheckmate}
                    onChange={(e) => setEndsGameOnCheckmate(e.target.checked)}
                  />
                  <span>End game if this piece is checkmated</span>
                </label>
              )}
              {captureCondition && (
                <label key="capture" className={styles["checkbox-label"]}>
                  <input
                    type="checkbox"
                    checked={endsGameOnCapture}
                    onChange={(e) => setEndsGameOnCapture(e.target.checked)}
                  />
                  <span>End game if this piece is captured</span>
                </label>
              )}
              {squaresCondition && requireSpecificPieceControl && (
                <label key="control" className={styles["checkbox-label"]}>
                  <input
                    type="checkbox"
                    checked={canControlSquares}
                    onChange={(e) => setCanControlSquares(e.target.checked)}
                  />
                  <span>Can control restricted control squares (only for squares marked "require specific piece")</span>
                </label>
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
                  onClick={() => setSelectedImageUrl(imageUrl)}
                >
                  <img src={imageUrl} alt={`Option ${index + 1}`} loading="lazy" />
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
              <label className={styles["checkbox-label"]}>
                <input
                  type="checkbox"
                  checked={showHpAd}
                  onChange={(e) => setShowHpAd(e.target.checked)}
                />
                <span>Show HP/AD badge <InfoTooltip text="Display an HP bar and AD badge on this piece during gameplay. Can also be toggled globally in game settings." /></span>
              </label>
              <label className={styles["checkbox-label"]}>
                <input
                  type="checkbox"
                  checked={showRegen}
                  onChange={(e) => setShowRegen(e.target.checked)}
                />
                <span>Show Regen badge <InfoTooltip text="Display the HP regeneration badge on this piece. Regen still functions even if hidden." /></span>
              </label>
              <label className={styles["checkbox-label"]}>
                <input
                  type="checkbox"
                  checked={showBurn}
                  onChange={(e) => setShowBurn(e.target.checked)}
                />
                <span>Show Burn badge <InfoTooltip text="Display the burn damage badge on this piece. The badge shows damage/duration — e.g. 🔥2/3 means this piece deals 2 burn damage per turn for 3 turns when it attacks. Burn still functions even if hidden." /></span>
              </label>
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
            <div className={styles["checkbox-group"]}>
              <label className={styles["checkbox-label"]}>
                <input
                  type="checkbox"
                  checked={cannotBeCaptured}
                  onChange={(e) => setCannotBeCaptured(e.target.checked)}
                />
                <span>Cannot be captured or damaged <InfoTooltip text="This piece is completely immune to all damage and capture. Attacks against it are blocked. Useful for obstacle or terrain pieces." /></span>
              </label>
              <label className={styles["checkbox-label"]}>
                <input
                  type="checkbox"
                  checked={trample}
                  onChange={(e) => setTrample(e.target.checked)}
                />
                <span>Trample <InfoTooltip text="This piece damages all pieces in its straight-line path during movement. Trample can cause check if the piece has hop abilities. Trample radius controls how wide the area of effect is." /></span>
              </label>
              {trample && (
                <div style={{ marginLeft: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Trample Radius:</label>
                  <NumberInput
                    value={trampleRadius}
                    onChange={(val) => setTrampleRadius(val)}
                    options={{ min: 0, max: 4 }}
                  />
                  <InfoTooltip text="0 = only pieces directly in path. 1+ = also affects surrounding squares at each step along the path. Checkmateable pieces (e.g. kings) are immune to trample radius splash damage." />
                </div>
              )}
              <label className={styles["checkbox-label"]}>
                <input
                  type="checkbox"
                  checked={ghostwalk}
                  onChange={(e) => setGhostwalk(e.target.checked)}
                />
                <span>Ghostwalk <InfoTooltip text="This piece can pass through any piece (ally or enemy) during movement." /></span>
              </label>
            </div>
              </>
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
            <label className={styles["checkbox-label"]}>
              <input
                type="checkbox"
                checked={manualCastlingPartners}
                onChange={(e) => {
                  setManualCastlingPartners(e.target.checked);
                  if (!e.target.checked) {
                    setLeftCastlingPartnerKey(null);
                    setRightCastlingPartnerKey(null);
                  }
                }}
              />
              <span>Manually set castling partners</span>
            </label>

            <div className={styles["castling-distance-section"]}>
              <label>Castling Distance (squares):</label>
              <input
                type="number"
                min="1"
                max={maxCastlingDistance}
                value={castlingDistance}
                onChange={(e) => setCastlingDistance(Math.max(1, Math.min(maxCastlingDistance, parseInt(e.target.value) || 2)))}
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
              Place this piece on all squares in row {squarePosition?.row}
            </span>
          </div>
        </div>
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
    return <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}>{selectorContent}</div>;
  }

  // Otherwise, wrap in modal
  return (
    <div className={styles["modal-overlay"]} onClick={onCancel}>
      <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter' && selectedPieceId) handleConfirm(); }}>
        <div className={styles["modal-header"]}>
          <h2>Select Piece for Square ({squarePosition?.row}, {squarePosition?.col})</h2>
          <button className={styles["close-button"]} onClick={onCancel}>✕</button>
        </div>
        {selectorContent}
      </div>
    </div>
  );
};

export default PieceSelector;
