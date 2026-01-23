import React, { useState, useEffect } from "react";
import styles from "./gamewizard.module.scss";
import StandardButton from "../standardbutton/StardardButton";
import { getAllPieces } from "../../actions/pieces";

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
  squarePosition 
}) => {
  const [pieces, setPieces] = useState([]);
  const [filteredPieces, setFilteredPieces] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [selectedPieceId, setSelectedPieceId] = useState(currentPlacement?.piece_id || null);
  const [selectedPlayerId, setSelectedPlayerId] = useState(currentPlacement?.player_id || 1);
  const [selectedImageUrl, setSelectedImageUrl] = useState(currentPlacement?.image_url || "");
  const [availableImages, setAvailableImages] = useState([]);

  useEffect(() => {
    loadPieces();
  }, []);

  useEffect(() => {
    // Filter pieces based on search term
    if (searchTerm.trim() === "") {
      setFilteredPieces(pieces);
    } else {
      const term = searchTerm.toLowerCase();
      const filtered = pieces.filter(piece => 
        piece.piece_name.toLowerCase().includes(term) ||
        piece.id.toString().includes(term) ||
        (piece.piece_description && piece.piece_description.toLowerCase().includes(term))
      );
      setFilteredPieces(filtered);
    }
  }, [searchTerm, pieces]);

  useEffect(() => {
    // When a piece is selected, load its available images
    if (selectedPieceId) {
      const piece = pieces.find(p => p.id === selectedPieceId);
      if (piece && piece.piece_images) {
        try {
          const images = JSON.parse(piece.piece_images);
          const imageUrls = Array.isArray(images) ? images.map(img => getImageUrl(img)) : [];
          setAvailableImages(imageUrls);
          // If no image selected yet, use first available
          if (!selectedImageUrl && imageUrls.length > 0) {
            setSelectedImageUrl(imageUrls[0]);
          }
        } catch (e) {
          setAvailableImages([]);
        }
      } else {
        setAvailableImages([]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPieceId, pieces]);

  const loadPieces = async () => {
    try {
      setLoading(true);
      const piecesData = await getAllPieces();
      setPieces(piecesData);
      setFilteredPieces(piecesData);
      setError(null);
    } catch (err) {
      console.error("Error loading pieces:", err);
      setError("Failed to load pieces. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handlePieceClick = (piece) => {
    setSelectedPieceId(piece.id);
  };

  const handleConfirm = () => {
    if (!selectedPieceId) {
      alert("Please select a piece first");
      return;
    }

    const selectedPiece = pieces.find(p => p.id === selectedPieceId);
    if (!selectedPiece) {
      alert("Selected piece not found");
      return;
    }

    onSelect({
      piece_id: selectedPieceId,
      piece_name: selectedPiece.piece_name,
      player_id: selectedPlayerId,
      image_url: selectedImageUrl
    });
  };

  const playerOptions = [];
  for (let i = 1; i <= playerCount; i++) {
    playerOptions.push(
      <option key={i} value={i}>Player {i}</option>
    );
  }

  return (
    <div className={styles["modal-overlay"]} onClick={onCancel}>
      <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()}>
        <div className={styles["modal-header"]}>
          <h2>Select Piece for Square ({squarePosition?.row}, {squarePosition?.col})</h2>
          <button className={styles["close-button"]} onClick={onCancel}>✕</button>
        </div>

        <div className={styles["modal-body"]}>
          {/* Search Bar */}
          <div className={styles["search-section"]}>
            <input
              type="text"
              className={styles["search-input"]}
              placeholder="Search by name or ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              autoFocus
            />
          </div>

          {/* Player Selection */}
          <div className={styles["player-selection"]}>
            <label>Assign to Player:</label>
            <select 
              value={selectedPlayerId} 
              onChange={(e) => setSelectedPlayerId(parseInt(e.target.value))}
              className={styles["player-select"]}
            >
              {playerOptions}
            </select>
          </div>

          {/* Piece List */}
          <div className={styles["piece-list-section"]}>
            {loading && <p>Loading pieces...</p>}
            {error && <p className={styles["error-text"]}>{error}</p>}
            {!loading && !error && filteredPieces.length === 0 && (
              <p>No pieces found. Try a different search term.</p>
            )}
            {!loading && !error && filteredPieces.length > 0 && (
              <div className={styles["piece-grid"]}>
                {filteredPieces.map(piece => {
                  let thumbnail = null;
                  try {
                    const images = JSON.parse(piece.piece_images || "[]");
                    thumbnail = Array.isArray(images) && images.length > 0 ? getImageUrl(images[0]) : null;
                  } catch (e) {
                    thumbnail = null;
                  }

                  return (
                    <div
                      key={piece.id}
                      className={`${styles["piece-item"]} ${selectedPieceId === piece.id ? styles["selected"] : ""}`}
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
                        <div className={styles["piece-id"]}>ID: {piece.id}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

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
      </div>
    </div>
  );
};

export default PieceSelector;
