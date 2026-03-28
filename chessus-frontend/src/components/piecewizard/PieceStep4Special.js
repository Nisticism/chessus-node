import React, { useEffect, useState } from "react";
import styles from "./piecewizard.module.scss";
import NumberInput from "../common/NumberInput";
import InfoTooltip from "./InfoTooltip";
import PiecesService from "../../services/pieces.service";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

const getImageUrl = (imagePath) => {
  if (!imagePath) return null;
  if (imagePath.startsWith('http')) return imagePath;
  return `${ASSET_URL}${imagePath}`;
};

const PieceStep4Special = ({ pieceData, updatePieceData }) => {
  // State for promotion pieces selector
  const [allPieces, setAllPieces] = useState([]);
  const [loadingPieces, setLoadingPieces] = useState(false);
  const [showPromotionSelector, setShowPromotionSelector] = useState(false);
  const [promotionSearchTerm, setPromotionSearchTerm] = useState("");
  const [selectedPromotionPieces, setSelectedPromotionPieces] = useState([]);

  // Load selected promotion pieces from pieceData on mount
  useEffect(() => {
    if (pieceData.promotion_pieces_ids) {
      try {
        const ids = JSON.parse(pieceData.promotion_pieces_ids);
        if (Array.isArray(ids)) {
          setSelectedPromotionPieces(ids);
        }
      } catch (e) {
        console.error('Error parsing promotion_pieces_ids:', e);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load all pieces when promotion selector is opened
  useEffect(() => {
    if (showPromotionSelector && allPieces.length === 0) {
      loadAllPieces();
    }
  }, [showPromotionSelector, allPieces.length]);

  const loadAllPieces = async () => {
    setLoadingPieces(true);
    try {
      const response = await PiecesService.getPieces();
      const data = response.data;
      setAllPieces(Array.isArray(data) ? data : (data.pieces || []));
    } catch (error) {
      console.error('Error loading pieces:', error);
    } finally {
      setLoadingPieces(false);
    }
  };

  const handlePromotionPieceToggle = (pieceId) => {
    const pieceIdInt = parseInt(pieceId);
    let newSelection;
    if (selectedPromotionPieces.includes(pieceIdInt)) {
      newSelection = selectedPromotionPieces.filter(id => id !== pieceIdInt);
    } else {
      newSelection = [...selectedPromotionPieces, pieceIdInt];
    }
    setSelectedPromotionPieces(newSelection);
    // Save as JSON string
    updatePieceData({ 
      promotion_pieces_ids: newSelection.length > 0 ? JSON.stringify(newSelection) : null 
    });
  };

  const getFilteredPromotionPieces = () => {
    if (!promotionSearchTerm.trim()) return allPieces;
    const term = promotionSearchTerm.toLowerCase();
    return allPieces.filter(piece => 
      (piece.piece_name && piece.piece_name.toLowerCase().includes(term)) ||
      (piece.id && piece.id.toString().includes(term))
    );
  };

  const getFirstImage = (imageLocation) => {
    if (!imageLocation) return null;
    try {
      const images = JSON.parse(imageLocation);
      if (Array.isArray(images) && images.length > 0) {
        return getImageUrl(images[0]);
      }
    } catch (e) {
      // Not JSON, use as-is
    }
    return getImageUrl(imageLocation);
  };

  // Sync selectedPromotionPieces to pieceData
  useEffect(() => {
    if (showPromotionSelector && selectedPromotionPieces.length > 0) {
      // Store as JSON string of IDs
      updatePieceData({ promotion_pieces_ids: JSON.stringify(selectedPromotionPieces) });
    } else if (!showPromotionSelector || selectedPromotionPieces.length === 0) {
      // Clear if not customizing or no pieces selected
      updatePieceData({ promotion_pieces_ids: null });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPromotionPieces, showPromotionSelector]);

  const handleChange = (field, value) => {
    updatePieceData({ [field]: value });
  };

  const handleNumberChange = (field, value) => {
    const numValue = value === "" ? null : parseInt(value);
    updatePieceData({ [field]: numValue });
  };

  // Check if piece has no backward movement
  // This includes directional movement, ratio movements, and step-by-step movements
  const hasNoBackwardDirectionalMovement = 
    (pieceData.down_movement || 0) === 0 &&
    (pieceData.down_left_movement || 0) === 0 &&
    (pieceData.down_right_movement || 0) === 0;

  // Ratio movements (L-shapes like knights) can move backwards
  const hasRatioMovement = 
    pieceData.ratio_movement_style && 
    ((pieceData.ratio_one_movement || 0) > 0 || (pieceData.ratio_two_movement || 0) > 0);

  // Step-by-step movements can move in any direction (including backwards)
  const hasStepByStepMovement = 
    pieceData.step_by_step_movement_style && 
    (pieceData.step_by_step_movement_value || 0) > 0;

  // Piece can only en passant if it has no way to move backwards
  const hasNoBackwardMovement = hasNoBackwardDirectionalMovement && !hasRatioMovement && !hasStepByStepMovement;

  // En passant option should only show if piece has no backward movement
  // (pawn-like pieces that can only move forward)
  const canShowEnPassant = hasNoBackwardMovement;

  // Auto-clear can_en_passant if conditions are no longer met
  useEffect(() => {
    if (!canShowEnPassant && pieceData.can_en_passant) {
      updatePieceData({ can_en_passant: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canShowEnPassant, pieceData.can_en_passant]);

  return (
    <div className={styles["step-container"]}>
      <h2>Special Rules & Review</h2>
      <p className={styles["step-description"]}>
        Configure special movement restrictions and review all settings.
      </p>

      {/* Movement Restrictions */}
      <div className={`${styles["condition-section"]} ${styles["narrow-section"]}`}>
        <h3>Movement Restrictions</h3>
        <div className={styles["sub-field"]}>
          <label>Minimum Turns Before Move</label>
          <NumberInput 
            value={pieceData.min_turns_until_movement || 0}
            onChange={(value) => handleNumberChange("min_turns_until_movement", value)}
            options={{ min: 0, max: 99, placeholder: "0" }}
          />
          <p className={styles["field-hint"]}>
            Number of turns that must pass before this piece can move (useful for special pieces that activate later)
          </p>
        </div>
      </div>

      {/* Special Scenarios */}
      <div className={`${styles["condition-section"]} ${styles["narrow-section"]}`}>
        <h3>Special Abilities</h3>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '12px' }}>
          <label className={styles["checkbox-label"]}>
            <input
              type="checkbox"
              checked={pieceData.can_promote || false}
              onChange={(e) => handleChange("can_promote", e.target.checked)}
            />
            <span>Can Promote <InfoTooltip text="Allows this piece to promote (transform into a different piece) when it reaches specific squares. Promotion squares are defined in the game type settings. By default it can promote to any starting piece, or you can select specific pieces below." /></span>
          </label>
        </div>

        {/* Promotion Pieces Selector - Only show when can_promote is enabled */}
        {pieceData.can_promote && (
          <div className={styles["sub-field"]} style={{ marginLeft: '20px', borderLeft: '3px solid var(--button-border)', paddingLeft: '15px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <label className={styles["checkbox-label"]}>
                <input
                  type="checkbox"
                  checked={showPromotionSelector}
                  onChange={(e) => setShowPromotionSelector(e.target.checked)}
                />
                <span>Customize Promotion Options</span>
              </label>
            </div>
            
            {!showPromotionSelector ? (
              <p className={styles["field-hint"]}>
                By default, this piece can promote to any piece from the starting position (except pieces that end the game when captured/checkmated). Check the box above to select specific pieces.
              </p>
            ) : (
              <div>
                <p className={styles["field-hint"]} style={{ marginBottom: '10px' }}>
                  Select which pieces this piece can promote to:
                </p>
                
                {/* Search */}
                <input
                  type="text"
                  className={styles["form-input"]}
                  placeholder="Search pieces..."
                  value={promotionSearchTerm}
                  onChange={(e) => setPromotionSearchTerm(e.target.value)}
                  style={{ marginBottom: '10px', maxWidth: '300px' }}
                />
                
                {/* Selected count */}
                {selectedPromotionPieces.length > 0 && (
                  <p style={{ color: 'var(--button-border)', marginBottom: '10px' }}>
                    {selectedPromotionPieces.length} piece(s) selected for promotion
                  </p>
                )}
                
                {loadingPieces ? (
                  <p>Loading pieces...</p>
                ) : (
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', 
                    gap: '8px',
                    maxHeight: '300px',
                    overflowY: 'auto',
                    padding: '10px',
                    backgroundColor: 'var(--bg-dark)',
                    borderRadius: '8px'
                  }}>
                    {getFilteredPromotionPieces().map(piece => {
                      const pieceId = piece.id || piece.piece_id;
                      const isSelected = selectedPromotionPieces.includes(pieceId);
                      const imageUrl = getFirstImage(piece.image_location);
                      
                      return (
                        <div
                          key={pieceId}
                          onClick={() => handlePromotionPieceToggle(pieceId)}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            padding: '8px',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            backgroundColor: isSelected ? 'rgba(117, 124, 252, 0.3)' : 'rgba(255,255,255,0.05)',
                            border: isSelected ? '2px solid var(--button-border)' : '2px solid transparent',
                            transition: 'all 0.2s ease'
                          }}
                        >
                          {imageUrl ? (
                            <img 
                              src={imageUrl} 
                              alt={piece.piece_name}
                              style={{ 
                                width: '50px', 
                                height: '50px', 
                                objectFit: 'contain' 
                              }}
                            />
                          ) : (
                            <div style={{ 
                              width: '50px', 
                              height: '50px', 
                              backgroundColor: 'rgba(255,255,255,0.1)',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}>
                              ?
                            </div>
                          )}
                          <span style={{ 
                            fontSize: '11px', 
                            textAlign: 'center',
                            marginTop: '4px',
                            color: isSelected ? 'var(--button-border)' : 'inherit'
                          }}>
                            {piece.piece_name || `Piece #${pieceId}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                
                {selectedPromotionPieces.length === 0 && showPromotionSelector && (
                  <p className={styles["field-hint"]} style={{ color: 'orange', marginTop: '10px' }}>
                    ⚠️ No pieces selected. Select at least one piece or uncheck "Customize Promotion Options" to use default behavior.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Free Move After Promotion - grouped with promotion */}
        {pieceData.can_promote && (
          <div style={{ paddingLeft: '12px', marginTop: '4px' }}>
            <label className={styles["checkbox-label"]}>
              <input
                type="checkbox"
                checked={pieceData.free_move_after_promotion || false}
                onChange={(e) => handleChange("free_move_after_promotion", e.target.checked)}
              />
              <span>Free Move After Promotion <InfoTooltip text="After this piece promotes (transforms into a different piece), the newly promoted piece can immediately take one additional move. Useful for checkers kings, which can continue moving or capturing after being promoted." /></span>
            </label>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '12px', marginTop: '8px' }}>
          <label className={styles["checkbox-label"]}>
            <input
              type="checkbox"
              checked={pieceData.can_castle || false}
              onChange={(e) => handleChange("can_castle", e.target.checked)}
            />
            <span>Can Castle <InfoTooltip text="Allows this piece to castle with a partner piece. The furthest allied piece to the left and right on the same row become castling partners. Move 2 squares left or right, and the partner moves to the opposite side. Both pieces must not have moved, and all squares between must be unoccupied. If this piece has check/checkmate rules, it cannot castle through enemy-controlled squares." /></span>
          </label>

          {canShowEnPassant && (
            <label className={styles["checkbox-label"]}>
              <input
                type="checkbox"
                checked={pieceData.can_en_passant || false}
                onChange={(e) => handleChange("can_en_passant", e.target.checked)}
              />
              <span>Can En Passant <InfoTooltip text="Allows this piece to capture an enemy piece of the same type that has just used a first-move-only movement to land horizontally adjacent. For example, a Pawn can only en passant capture another Pawn. The capture must be made immediately after the enemy's qualifying move. Only available for pieces with no backward movement (pawn-like pieces)." /></span>
            </label>
          )}

          <label className={styles["checkbox-label"]}>
            <input
              type="checkbox"
              checked={pieceData.can_capture_allies || false}
              onChange={(e) => handleChange("can_capture_allies", e.target.checked)}
            />
            <span>Can Capture Allied Pieces <InfoTooltip text="When enabled, this piece can capture friendly pieces using any of its attack methods (directional, ratio, or ranged). Useful for sacrifice-based mechanics." /></span>
          </label>

          <label className={styles["checkbox-label"]}>
            <input
              type="checkbox"
              checked={pieceData.cannot_be_captured || false}
              onChange={(e) => handleChange("cannot_be_captured", e.target.checked)}
            />
            <span>Cannot Be Captured <InfoTooltip text="When enabled, this piece cannot be captured by any means. It acts as an immovable wall that blocks other pieces. Useful for custom games like duck chess." /></span>
          </label>
        </div>
      </div>

      {/* Advanced Special Scenarios - Hidden for now */}
      {false && (
      <div className={styles["condition-section"]}>
        <h3>Advanced: Special Scenarios (JSON)</h3>
        <p className={styles["field-hint"]}>
          These fields accept JSON strings for complex, scenario-based rules. Leave empty if not needed.
        </p>

        <div className={styles["sub-field"]}>
          <label>Special Scenario Movement</label>
          <textarea
            className={styles["form-textarea"]}
            value={pieceData.special_scenario_moves || ""}
            onChange={(e) => handleChange("special_scenario_moves", e.target.value)}
            placeholder='{"condition": "example", "movement": "special"}'
            rows="3"
          />
        </div>

        <div className={styles["sub-field"]}>
          <label>Special Scenario Capture</label>
          <textarea
            className={styles["form-textarea"]}
            value={pieceData.special_scenario_capture || ""}
            onChange={(e) => handleChange("special_scenario_capture", e.target.value)}
            placeholder='{"condition": "example", "capture": "special"}'
            rows="3"
          />
        </div>
      </div>
      )}

      {/* Summary Section */}
      <div className={styles["summary-section"]}>
        <h3>Summary</h3>
        <div className={styles["summary-grid"]}>
          <div className={styles["summary-item"]}>
            <strong>Piece Name:</strong> {pieceData.piece_name || "Not set"}
          </div>
          <div className={styles["summary-item"]}>
            <strong>Type:</strong> {pieceData.piece_type || "Not set"}
          </div>
          <div className={styles["summary-item"]}>
            <strong>Dimensions:</strong> {pieceData.piece_width || "?"}x{pieceData.piece_height || "?"}
          </div>
          <div className={styles["summary-item"]}>
            <span className={styles["summary-tooltip"]}>Per-direction movement with configurable distance, exact/infinite range, and first-move-only options.</span>
            <strong>Directional Movement:</strong>{" "}
            {pieceData.directional_movement_style ? "Enabled" : "Disabled"}
          </div>
          <div className={styles["summary-item"]}>
            <span className={styles["summary-tooltip"]}>L-shaped movement like a knight. Moves one distance in one direction, then a different distance perpendicularly.</span>
            <strong>Ratio Movement:</strong>{" "}
            {pieceData.ratio_movement_style
              ? `${pieceData.ratio_one_movement || 0}-${pieceData.ratio_two_movement || 0}`
              : "Disabled"}
          </div>
          <div className={styles["summary-item"]}>
            <span className={styles["summary-tooltip"]}>A step budget where the piece moves one square at a time in any direction, changing direction each step.</span>
            <strong>Step-by-Step:</strong>{" "}
            {pieceData.step_by_step_movement_style
              ? `${Math.abs(pieceData.step_by_step_movement_value || 0)} steps${
                  pieceData.step_by_step_movement_value < 0 ? " (no diagonal)" : " (with diagonal)"
                }`
              : "Disabled"}
          </div>
          <div className={styles["summary-item"]}>
            <span className={styles["summary-tooltip"]}>The piece moves to the enemy's square to capture it, like most chess pieces.</span>
            <strong>Capture on Move:</strong>{" "}
            {pieceData.can_capture_enemy_on_move ? "Yes" : "No"}
          </div>
          <div className={styles["summary-item"]}>
            <span className={styles["summary-tooltip"]}>The piece attacks without moving — stays in place but can capture distant enemies.</span>
            <strong>Ranged Attack:</strong>{" "}
            {pieceData.can_capture_enemy_via_range ? "Enabled" : "Disabled"}
          </div>
          <div className={styles["summary-item"]}>
            <span className={styles["summary-tooltip"]}>Whether the piece can hop over other pieces during movement. Does not capture hopped-over pieces.</span>
            <strong>Movement Hopping:</strong>{" "}
            {pieceData.can_hop_over_allies && pieceData.can_hop_over_enemies
              ? "Allies & Enemies"
              : pieceData.can_hop_over_allies
              ? "Allies only"
              : pieceData.can_hop_over_enemies
              ? "Enemies only"
              : "No"}
          </div>
          <div className={styles["summary-item"]}>
            <span className={styles["summary-tooltip"]}>Whether the piece can hop over other pieces when attacking to reach its capture target.</span>
            <strong>Attack Hopping:</strong>{" "}
            {pieceData.can_hop_attack_over_allies && pieceData.can_hop_attack_over_enemies
              ? "Allies & Enemies"
              : pieceData.can_hop_attack_over_allies
              ? "Allies only"
              : pieceData.can_hop_attack_over_enemies
              ? "Enemies only"
              : "No"}
          </div>
          <div className={styles["summary-item"]}>
            <span className={styles["summary-tooltip"]}>Capture on Hop captures pieces that are hopped over. Chain Capture allows multiple jumps in one turn.</span>
            <strong>Checkers Capture:</strong>{" "}
            {pieceData.capture_on_hop ? "Capture on Hop" : ""}
            {pieceData.capture_on_hop && pieceData.chain_capture_enabled ? " + " : ""}
            {pieceData.chain_capture_enabled ? "Chain Capture" : ""}
            {!pieceData.capture_on_hop && !pieceData.chain_capture_enabled ? "No" : ""}
          </div>
          <div className={styles["summary-item"]}>
            <span className={styles["summary-tooltip"]}>Castling, promotion, en passant, and other special rules.</span>
            <strong>Special Abilities:</strong>{" "}
            {[
              pieceData.can_castle && "Castle",
              pieceData.can_promote && "Promote",
              pieceData.can_en_passant && "En Passant",
              pieceData.free_move_after_promotion && "Free Move After Promotion"
            ].filter(Boolean).join(", ") || "None"}
          </div>
        </div>

        {pieceData.piece_image_preview && (
          <div className={styles["summary-image"]}>
            <strong>Piece Image:</strong>
            <img src={pieceData.piece_image_preview} alt="Piece preview" />
          </div>
        )}
      </div>
    </div>
  );
};

export default PieceStep4Special;
