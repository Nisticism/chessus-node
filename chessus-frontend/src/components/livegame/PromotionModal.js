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
const PromotionModal = ({ promotionOptions, promotingPiece, onSelect, onCancel }) => {
  // Helper to get image URL
  const getImageUrl = (piece) => {
    // Check if image is an array (from image_location)
    if (piece.image_location) {
      try {
        const images = JSON.parse(piece.image_location);
        if (Array.isArray(images) && images.length > 0) {
          // Use player position to select correct image (0 = player 1, 1 = player 2)
          const playerIndex = (promotingPiece.player_id || promotingPiece.team || 1) - 1;
          const imagePath = images[playerIndex] || images[0];
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
      <div className={styles["promotion-modal-overlay"]} onClick={onCancel}>
        <div className={styles["promotion-modal"]} onClick={(e) => e.stopPropagation()}>
          <h3>No Promotion Available</h3>
          <p>Your {promotingPiece?.piece_name || 'piece'} reached a promotion square, but there are no valid pieces to promote to.</p>
          <p className={styles["no-promotion-message"]}>All other piece types either match the promoting piece or have checkmate rules.</p>
          <button className={styles["cancel-button"]} onClick={onCancel}>
            Continue Without Promotion
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles["promotion-modal-overlay"]} onClick={onCancel}>
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
        
        <button className={styles["cancel-button"]} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
};

export default PromotionModal;
