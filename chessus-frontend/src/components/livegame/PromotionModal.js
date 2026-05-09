import React from "react";
import styles from "./livegame.module.scss";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

/**
 * Modal for selecting a piece to promote to
 * @param {Object} props
 * @param {Array} props.promotionOptions - Array of piece objects that can be promoted to
 * @param {Object} props.promotingPiece - The piece being promoted
 * @param {Function} props.onSelect - Callback when a piece is selected
 * @param {Function} props.onCancel - Callback when promotion is cancelled
 */
const PromotionModal = ({ promotionOptions, promotingPiece, onSelect, onCancel, onMinimize }) => {
  // Helper to get image URL
  const getImageUrl = (piece) => {
    // Check if image is an array (from image_location)
    if (piece.image_location) {
      try {
        const images = JSON.parse(piece.image_location);
        if (Array.isArray(images) && images.length > 0) {
          // Use player position to select correct image (0 = player 1, 1 = player 2),
          // unless a per-placement image_index override is set on the piece.
          const playerIndex = (promotingPiece.player_id || promotingPiece.team || 1) - 1;
          const overrideIdx = (piece.image_index != null && piece.image_index >= 0) ? piece.image_index : null;
          const idx = overrideIdx != null ? Math.min(overrideIdx, images.length - 1) : playerIndex;
          const imagePath = images[idx] || images[0];
          if (imagePath.startsWith('http')) {
            return imagePath;
          }
          return imagePath.startsWith('/') ? `${ASSET_URL}${imagePath}` : `${ASSET_URL}/uploads/pieces/${imagePath}`;
        }
      } catch {
        // Fall through to other options
      }
    }
    
    if (piece.image_url) {
      return piece.image_url.startsWith('http') ? piece.image_url : `${ASSET_URL}${piece.image_url}`;
    }
    
    if (piece.image) {
      return piece.image.startsWith('http') ? piece.image : `${ASSET_URL}${piece.image}`;
    }
    
    return null;
  };

  // Check if there are no valid promotion options
  if (!promotionOptions || promotionOptions.length === 0) {
    return (
      <div className={styles["promotion-modal-overlay"]}>
        <div className={styles["promotion-modal"]} onClick={(e) => e.stopPropagation()}>
          <h3>No Promotion Available</h3>
          <p>Your {promotingPiece?.piece_name || 'piece'} reached a promotion square, but there are no valid pieces to promote to.</p>
          <p className={styles["no-promotion-message"]}>All other piece types either match the promoting piece or have checkmate rules.</p>
          <div className={styles["promotion-modal-actions"]}>
            <button className={styles["cancel-button"]} onClick={onCancel}>
              Cancel Move
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles["promotion-modal-overlay"]}>
      <div className={styles["promotion-modal"]} onClick={(e) => e.stopPropagation()}>
        <h3>Choose Promotion</h3>
        <p>Select a piece to promote your {promotingPiece?.piece_name || 'piece'} to:</p>
        
        <div className={styles["promotion-options"]}>
          {promotionOptions.map((piece, index) => {
            const imageUrl = getImageUrl(piece);
            return (
              <button
                key={piece.id || piece.piece_id || index}
                className={styles["promotion-option"]}
                onClick={() => onSelect(piece)}
                title={piece.piece_name || 'Piece'}
              >
                {imageUrl ? (
                  <img 
                    src={imageUrl} 
                    alt={piece.piece_name || 'Piece'} 
                    draggable={false}
                  />
                ) : (
                  <span className={styles["piece-name"]}>{piece.piece_name || '?'}</span>
                )}
                <span className={styles["piece-label"]}>{piece.piece_name || 'Unknown'}</span>
              </button>
            );
          })}
        </div>
        
        <div className={styles["promotion-modal-actions"]}>
          <button className={styles["cancel-button"]} onClick={onCancel}>
            Cancel Move
          </button>
          {onMinimize && (
            <button className={styles["minimize-button"]} onClick={onMinimize}>
              Hide
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PromotionModal;
