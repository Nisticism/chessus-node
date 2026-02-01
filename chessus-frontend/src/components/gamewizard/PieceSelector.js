import React, { useState, useEffect } from "react";
import styles from "./gamewizard.module.scss";
import StandardButton from "../standardbutton/StardardButton";
import PiecesService from "../../services/pieces.service";

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
  embedded = false  // New prop: if true, don't render modal wrapper
}) => {
  const [pieces, setPieces] = useState([]);
  const [filteredPieces, setFilteredPieces] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
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
  
  // Save selected player ID to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('lastSelectedPlayerId', selectedPlayerId.toString());
  }, [selectedPlayerId]);

  useEffect(() => {
    loadPieces();
  }, []);

  useEffect(() => {
    // Filter pieces based on search term
    if (searchTerm.trim() === "") {
      // When no search term, limit to first 10 pieces
      setFilteredPieces(pieces.slice(0, 10));
    } else {
      const term = searchTerm.toLowerCase();
      const filtered = pieces.filter(piece => 
        (piece.piece_name && piece.piece_name.toLowerCase().includes(term)) ||
        (piece.id && piece.id.toString().includes(term)) ||
        (piece.piece_id && piece.piece_id.toString().includes(term)) ||
        (piece.piece_description && piece.piece_description.toLowerCase().includes(term))
      );
      // When searching, show all matching results
      setFilteredPieces(filtered);
    }
  }, [searchTerm, pieces]);

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
      setFilteredPieces(piecesData || []);
      setError(null);
    } catch (err) {
      console.error("Error loading pieces:", err);
      setError("Failed to load pieces. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handlePieceClick = (piece) => {
    setSelectedPieceId(piece.id || piece.piece_id);
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
      ends_game_on_capture: endsGameOnCapture
    });
  };

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
          {!loading && !error && pieces.length > 10 && searchTerm.trim() === "" && (
            <p key="hint" className={styles["piece-count-hint"]}>Showing 10 of {pieces.length} pieces. Use search to find more.</p>
          )}
          {!loading && !error && filteredPieces.length === 0 && (
            <p key="no-pieces">No pieces found. Try a different search term.</p>
          )}
          {!loading && !error && filteredPieces.length > 0 && (
            <div key="piece-grid" className={styles["piece-grid"]}>
              {filteredPieces.map(piece => {
                const pieceId = piece.id || piece.piece_id;
                let thumbnail = null;
                try {
                  const images = JSON.parse(piece.image_location || "[]");
                  // Use the image for the selected player, default to first if not available
                  const playerImageIndex = selectedPlayerId - 1;
                  thumbnail = Array.isArray(images) && images.length > 0 
                    ? getImageUrl(images[playerImageIndex] || images[0]) 
                    : null;
                } catch (e) {
                  thumbnail = null;
                }

                return (
                  <div
                    key={pieceId}
                    className={`${styles["piece-item"]} ${selectedPieceId === pieceId ? styles["selected"] : ""}`}
                    onClick={() => handlePieceClick(piece)}
                  >
                    <div className={styles["piece-thumbnail"]}>
                      {thumbnail ? (
                        <img src={thumbnail} alt={piece.piece_name} />
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
        {selectedPieceId && (mateCondition || captureCondition) && (
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
                  <img src={imageUrl} alt={`Option ${index + 1}`} />
                </div>
              ))}
            </div>
          </div>
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

  // If embedded, wrap content in a div (not a fragment) to avoid key warnings
  if (embedded) {
    return <div>{selectorContent}</div>;
  }

  // Otherwise, wrap in modal
  return (
    <div className={styles["modal-overlay"]} onClick={onCancel}>
      <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()}>
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
