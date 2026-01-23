import React, { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { getPieceById } from "../../actions/pieces";
import PieceBoardPreview from "../piecewizard/PieceBoardPreview";
import styles from "./pieceview.module.scss";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

const PieceView = () => {
  const { pieceId } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const [piece, setPiece] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [imageBgColor, setImageBgColor] = useState('#6b6b6b'); // Default neutral gray

  useEffect(() => {
    const loadPiece = async () => {
      try {
        setLoading(true);
        const pieceData = await getPieceById(pieceId);
        setPiece(pieceData);
        setLoading(false);
      } catch (err) {
        console.error("Error loading piece:", err);
        setError("Failed to load piece");
        setLoading(false);
      }
    };

    if (pieceId) {
      loadPiece();
    }
  }, [pieceId]);

  // Analyze image brightness to determine background color
  useEffect(() => {
    if (!piece?.image_location) return;

    const firstImageUrl = getFirstImage(piece.image_location);
    if (!firstImageUrl) return;

    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = firstImageUrl;
    
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        let totalBrightness = 0;
        let pixelCount = 0;
        
        // Sample pixels to calculate average brightness
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          
          // Only count non-transparent pixels
          if (a > 128) {
            // Calculate relative luminance
            const brightness = (0.299 * r + 0.587 * g + 0.114 * b);
            totalBrightness += brightness;
            pixelCount++;
          }
        }
        
        const avgBrightness = totalBrightness / pixelCount;
        
        // If piece is dark (brightness < 128), use light background
        // If piece is light (brightness >= 128), use dark background
        setImageBgColor(avgBrightness < 128 ? '#e8e8e8' : '#2a2a2a');
      } catch (error) {
        console.log('Could not analyze image brightness, using default');
        // Keep default neutral gray on error
      }
    };
    
    img.onerror = () => {
      console.log('Image load error, using default background');
    };
  }, [piece]);

  const getFirstImage = (imageLocation) => {
    if (!imageLocation) return null;
    
    try {
      const images = JSON.parse(imageLocation);
      if (Array.isArray(images) && images.length > 0) {
        const imagePath = images[0];
        return imagePath.startsWith('http') ? imagePath : `${ASSET_URL}${imagePath}`;
      }
    } catch {
      const imagePath = imageLocation;
      if (imagePath.startsWith('http')) {
        return imagePath;
      } else if (imagePath.startsWith('/uploads/')) {
        return `${ASSET_URL}${imagePath}`;
      } else {
        return `${ASSET_URL}/uploads/pieces/${imagePath}`;
      }
    }
    
    return null;
  };

  const canEdit = () => {
    return currentUser && piece && (piece.creator_id === currentUser.id || currentUser.role === "Admin");
  };

  const hasMovementData = () => {
    if (!piece) return false;
    return piece.directional_movement_style || 
           piece.ratio_movement_style || 
           piece.step_by_step_movement_style ||
           piece.min_turns_per_move != null || 
           piece.max_turns_per_move != null ||
           piece.max_directional_movement_iterations != null;
  };

  const hasAttackData = () => {
    if (!piece) return false;
    return piece.can_capture_enemy_on_move || 
           piece.can_capture_enemy_via_range ||
           piece.max_piece_captures_per_ranged_attack != null ||
           piece.repeating_directional_ranged_attack;
  };

  // Parse piece images for the board preview - must be before early returns
  const parsePieceImages = () => {
    if (!piece?.image_location) return [];
    try {
      const images = JSON.parse(piece.image_location);
      if (Array.isArray(images)) {
        return images.map(img => img.startsWith('http') ? img : `${ASSET_URL}${img}`);
      }
    } catch {
      const imagePath = piece.image_location;
      if (imagePath.startsWith('http')) {
        return [imagePath];
      } else if (imagePath.startsWith('/uploads/')) {
        return [`${ASSET_URL}${imagePath}`];
      } else {
        return `${ASSET_URL}/uploads/pieces/${imagePath}`;
      }
    }
    return [];
  };

  // Create piece data with parsed images - useMemo must be before early returns
  const pieceDataWithImages = useMemo(() => {
    if (!piece) return null;
    
    // Sanitize piece data to ensure no raw 0 or 1 values leak through
    const sanitized = {
      ...piece,
      // Convert TINYINT boolean fields to actual booleans
      directional_movement_style: !!piece.directional_movement_style,
      ratio_movement_style: !!piece.ratio_movement_style,
      step_by_step_movement_style: !!piece.step_by_step_movement_style,
      repeating_movement: !!piece.repeating_movement,
      can_capture_enemy_on_move: !!piece.can_capture_enemy_on_move,
      can_capture_enemy_via_range: !!piece.can_capture_enemy_via_range,
      can_hop_over_allies: !!piece.can_hop_over_allies,
      can_hop_over_enemies: !!piece.can_hop_over_enemies,
      directional_attack_style: !!piece.directional_attack_style,
      ratio_attack_style: !!piece.ratio_attack_style,
      step_by_step_attack_style: !!piece.step_by_step_attack_style,
      directional_ranged_attack_style: !!piece.directional_ranged_attack_style,
      ratio_ranged_attack_style: !!piece.ratio_ranged_attack_style,
      step_by_step_ranged_attack_style: !!piece.step_by_step_ranged_attack_style,
      repeating_directional_ranged_attack: !!piece.repeating_directional_ranged_attack,
      piece_image_previews: parsePieceImages()
    };
    
    return sanitized;
  }, [piece]);

  const firstImageUrl = piece ? getFirstImage(piece.image_location) : null;

  // Sanitize piece for display to prevent 0/1 from showing as text
  const displayPiece = useMemo(() => {
    if (!piece) return null;
    return {
      ...piece,
      // Convert TINYINT boolean fields to actual booleans
      directional_movement_style: !!piece.directional_movement_style,
      ratio_movement_style: !!piece.ratio_movement_style,
      step_by_step_movement_style: !!piece.step_by_step_movement_style,
      repeating_movement: !!piece.repeating_movement,
      can_capture_enemy_on_move: !!piece.can_capture_enemy_on_move,
      can_capture_enemy_via_range: !!piece.can_capture_enemy_via_range,
      can_hop_over_allies: !!piece.can_hop_over_allies,
      can_hop_over_enemies: !!piece.can_hop_over_enemies,
      directional_attack_style: !!piece.directional_attack_style,
      ratio_attack_style: !!piece.ratio_attack_style,
      step_by_step_attack_style: !!piece.step_by_step_attack_style,
      directional_ranged_attack_style: !!piece.directional_ranged_attack_style,
      ratio_ranged_attack_style: !!piece.ratio_ranged_attack_style,
      step_by_step_ranged_attack_style: !!piece.step_by_step_ranged_attack_style,
      repeating_directional_ranged_attack: !!piece.repeating_directional_ranged_attack
    };
  }, [piece]);

  if (loading) {
    return (
      <div className={styles["container"]}>
        <div className={styles["loading"]}>Loading piece...</div>
      </div>
    );
  }

  if (error || !piece) {
    return (
      <div className={styles["container"]}>
        <div className={styles["error"]}>{error || "Piece not found"}</div>
        <button onClick={() => navigate('/create/pieces')} className={styles["back-button"]}>
          Back to Pieces
        </button>
      </div>
    );
  }

  // Use displayPiece for rendering to prevent 0/1 from showing
  const pieceToDisplay = displayPiece || piece;

  return (
    <div className={styles["container"]}>
      <div className={styles["header"]}>
        <button onClick={() => navigate('/create/pieces')} className={styles["back-button"]}>
          ← Back to Pieces
        </button>
        {canEdit() && (
          <button 
            onClick={() => navigate(`/create/piece/edit/${pieceId}`)} 
            className={styles["edit-button"]}
          >
            ✏️ Edit Piece
          </button>
        )}
      </div>

      <div className={styles["piece-info"]}>
        <div className={styles["title-section"]}>
          {firstImageUrl && (
            <img 
              src={firstImageUrl} 
              alt={pieceToDisplay.piece_name} 
              className={styles["piece-image"]}
              style={{ backgroundColor: imageBgColor }}
            />
          )}
          <div>
            <h1>{pieceToDisplay.piece_name}</h1>
            {pieceToDisplay.creator_username && (
              <p className={styles["creator"]}>
                Created by <Link to={`/profile/${pieceToDisplay.creator_username}`}>{pieceToDisplay.creator_username}</Link>
              </p>
            )}
          </div>
        </div>

        {pieceToDisplay.piece_description && (
          <div className={styles["section"]}>
            <h2>Description</h2>
            <p>{pieceToDisplay.piece_description}</p>
          </div>
        )}

        {parsePieceImages().length > 0 && (
          <div className={styles["section"]}>
            <h2>Piece Images</h2>
            <div className={styles["images-gallery"]}>
              {parsePieceImages().map((imageUrl, index) => (
                <div key={index} className={styles["image-item"]}>
                  <img 
                    src={imageUrl} 
                    alt={`${pieceToDisplay.piece_name} ${index + 1}`}
                    className={styles["gallery-image"]}
                  />
                  {index === 0 && <span className={styles["default-badge"]}>Default</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className={styles["section"]}>
          <h2>Movement & Attack Pattern</h2>
          <p className={styles["hint"]}>Hover over the board to see where this piece can move, capture, and ranged attack</p>
          <p className={styles["preview-legend"]}>
            <span className={styles["legend-movement"]}>Blue = Movement</span>
            <span className={styles["legend-capture"]}>Orange = Capture on Move</span>
            <span className={styles["legend-ranged"]}>Red = Ranged Attack 💥</span>
          </p>
          <div className={styles["board-container"]}>
            <PieceBoardPreview pieceData={pieceDataWithImages} />
          </div>
        </div>

        <div className={styles["stats-grid"]}>
          <div className={styles["stat-card"]}>
            <span className={styles["stat-label"]}>Size</span>
            <span className={styles["stat-value"]}>{pieceToDisplay.piece_width} × {pieceToDisplay.piece_height}</span>
          </div>
          <div className={styles["stat-card"]}>
            <span className={styles["stat-label"]}>Directional Movement</span>
            <span className={styles["stat-value"]}>{pieceToDisplay.directional_movement_style ? 'Yes' : 'No'}</span>
          </div>
          <div className={styles["stat-card"]}>
            <span className={styles["stat-label"]}>Ratio Movement</span>
            <span className={styles["stat-value"]}>
              {pieceToDisplay.ratio_movement_style ? 'Yes' : 'No'}
              {pieceToDisplay.ratio_movement_style && pieceToDisplay.ratio_one_movement && pieceToDisplay.ratio_two_movement && (
                <span> ({pieceToDisplay.ratio_one_movement}:{pieceToDisplay.ratio_two_movement})</span>
              )}
            </span>
          </div>
          <div className={styles["stat-card"]}>
            <span className={styles["stat-label"]}>Step-by-Step Movement</span>
            <span className={styles["stat-value"]}>
              {pieceToDisplay.step_by_step_movement_style ? 'Yes' : 'No'}
              {pieceToDisplay.step_by_step_movement_style && pieceToDisplay.step_by_step_movement_value != null && (
                <span> ({pieceToDisplay.step_by_step_movement_value} steps)</span>
              )}
            </span>
          </div>
          <div className={styles["stat-card"]}>
            <span className={styles["stat-label"]}>Capture on Move</span>
            <span className={styles["stat-value"]}>{pieceToDisplay.can_capture_enemy_on_move ? 'Yes' : 'No'}</span>
          </div>
          <div className={styles["stat-card"]}>
            <span className={styles["stat-label"]}>Ranged Attack</span>
            <span className={styles["stat-value"]}>{pieceToDisplay.can_capture_enemy_via_range ? 'Yes' : 'No'}</span>
          </div>
          <div className={styles["stat-card"]}>
            <span className={styles["stat-label"]}>Hop Over Allies</span>
            <span className={styles["stat-value"]}>{pieceToDisplay.can_hop_over_allies ? 'Yes' : 'No'}</span>
          </div>
          <div className={styles["stat-card"]}>
            <span className={styles["stat-label"]}>Hop Over Enemies</span>
            <span className={styles["stat-value"]}>{pieceToDisplay.can_hop_over_enemies ? 'Yes' : 'No'}</span>
          </div>
        </div>

        <div className={styles["section"]}>
          <h2>Movement Details</h2>
          <div className={styles["details-grid"]}>
            <div className={styles["detail-item"]}>
              <span className={styles["detail-label"]}>Directional Movement</span>
              <span className={styles["detail-value"]}>{pieceToDisplay.directional_movement_style ? 'Yes' : 'No'}</span>
            </div>
            {pieceToDisplay.directional_movement_style && (
              <>
                <div className={styles["detail-item"]}>
                  <span className={styles["detail-label"]}>Can Repeat Movement</span>
                  <span className={styles["detail-value"]}>{pieceToDisplay.repeating_movement ? 'Yes' : 'No'}</span>
                </div>
                {pieceToDisplay.repeating_movement && pieceToDisplay.max_directional_movement_iterations != null && (
                  <div className={styles["detail-item"]}>
                    <span className={styles["detail-label"]}>Max Movement Iterations</span>
                    <span className={styles["detail-value"]}>{pieceToDisplay.max_directional_movement_iterations}</span>
                  </div>
                )}
              </>
            )}
            <div className={styles["detail-item"]}>
              <span className={styles["detail-label"]}>Ratio Movement</span>
              <span className={styles["detail-value"]}>{pieceToDisplay.ratio_movement_style ? 'Yes' : 'No'}</span>
            </div>
            {pieceToDisplay.ratio_movement_style && (
              <div className={styles["detail-item"]}>
                <span className={styles["detail-label"]}>Ratio Pattern</span>
                <span className={styles["detail-value"]}>
                  {pieceToDisplay.ratio_one_movement && pieceToDisplay.ratio_two_movement 
                    ? `${pieceToDisplay.ratio_one_movement}:${pieceToDisplay.ratio_two_movement}` 
                    : 'None'}
                </span>
              </div>
            )}
            <div className={styles["detail-item"]}>
              <span className={styles["detail-label"]}>Step-by-Step Movement</span>
              <span className={styles["detail-value"]}>{pieceToDisplay.step_by_step_movement_style ? 'Yes' : 'No'}</span>
            </div>
            {pieceToDisplay.step_by_step_movement_style && pieceToDisplay.step_by_step_movement_value != null && (
              <div className={styles["detail-item"]}>
                <span className={styles["detail-label"]}>Step Value</span>
                <span className={styles["detail-value"]}>{pieceToDisplay.step_by_step_movement_value}</span>
              </div>
            )}
            <div className={styles["detail-item"]}>
              <span className={styles["detail-label"]}>Can Jump Over Allies</span>
              <span className={styles["detail-value"]}>{pieceToDisplay.can_hop_over_allies ? 'Yes' : 'No'}</span>
            </div>
            <div className={styles["detail-item"]}>
              <span className={styles["detail-label"]}>Can Jump Over Enemies</span>
              <span className={styles["detail-value"]}>{pieceToDisplay.can_hop_over_enemies ? 'Yes' : 'No'}</span>
            </div>
            {pieceToDisplay.min_turns_per_move != null && (
              <div className={styles["detail-item"]}>
                <span className={styles["detail-label"]}>Minimum Turns Per Move</span>
                <span className={styles["detail-value"]}>{pieceToDisplay.min_turns_per_move}</span>
              </div>
            )}
            {pieceToDisplay.max_turns_per_move != null && (
              <div className={styles["detail-item"]}>
                <span className={styles["detail-label"]}>Maximum Turns Per Move</span>
                <span className={styles["detail-value"]}>{pieceToDisplay.max_turns_per_move}</span>
              </div>
            )}
          </div>
        </div>

        <div className={styles["section"]}>
          <h2>Attack Details</h2>
          <div className={styles["details-grid"]}>
            <div className={styles["detail-item"]}>
              <span className={styles["detail-label"]}>Can Capture While Moving</span>
              <span className={styles["detail-value"]}>{pieceToDisplay.can_capture_enemy_on_move ? 'Yes' : 'No'}</span>
            </div>
            {pieceToDisplay.can_capture_enemy_on_move && (
              <>
                <div className={styles["detail-item"]}>
                  <span className={styles["detail-label"]}>Directional Attack</span>
                  <span className={styles["detail-value"]}>{pieceToDisplay.directional_attack_style ? 'Yes' : 'No'}</span>
                </div>
                <div className={styles["detail-item"]}>
                  <span className={styles["detail-label"]}>Ratio Attack</span>
                  <span className={styles["detail-value"]}>{pieceToDisplay.ratio_attack_style ? 'Yes' : 'No'}</span>
                </div>
                {pieceToDisplay.ratio_attack_style && (
                  <div className={styles["detail-item"]}>
                    <span className={styles["detail-label"]}>Ratio Attack Pattern</span>
                    <span className={styles["detail-value"]}>
                      {pieceToDisplay.ratio_one_attack && pieceToDisplay.ratio_two_attack 
                        ? `${pieceToDisplay.ratio_one_attack}:${pieceToDisplay.ratio_two_attack}` 
                        : 'None'}
                    </span>
                  </div>
                )}
                <div className={styles["detail-item"]}>
                  <span className={styles["detail-label"]}>Step-by-Step Attack</span>
                  <span className={styles["detail-value"]}>{pieceToDisplay.step_by_step_attack_style ? 'Yes' : 'No'}</span>
                </div>
                {pieceToDisplay.step_by_step_attack_style && pieceToDisplay.step_by_step_attack_value != null && (
                  <div className={styles["detail-item"]}>
                    <span className={styles["detail-label"]}>Step Attack Value</span>
                    <span className={styles["detail-value"]}>{pieceToDisplay.step_by_step_attack_value}</span>
                  </div>
                )}
              </>
            )}
            <div className={styles["detail-item"]}>
              <span className={styles["detail-label"]}>Has Ranged Attack</span>
              <span className={styles["detail-value"]}>{pieceToDisplay.can_capture_enemy_via_range ? 'Yes' : 'No'}</span>
            </div>
            {pieceToDisplay.can_capture_enemy_via_range && (
              <>
                <div className={styles["detail-item"]}>
                  <span className={styles["detail-label"]}>Directional Ranged Attack</span>
                  <span className={styles["detail-value"]}>{pieceToDisplay.directional_ranged_attack_style ? 'Yes' : 'No'}</span>
                </div>
                <div className={styles["detail-item"]}>
                  <span className={styles["detail-label"]}>Ratio Ranged Attack</span>
                  <span className={styles["detail-value"]}>{pieceToDisplay.ratio_ranged_attack_style ? 'Yes' : 'No'}</span>
                </div>
                {pieceToDisplay.ratio_ranged_attack_style && (
                  <div className={styles["detail-item"]}>
                    <span className={styles["detail-label"]}>Ratio Ranged Pattern</span>
                    <span className={styles["detail-value"]}>
                      {pieceToDisplay.ratio_one_ranged_attack && pieceToDisplay.ratio_two_ranged_attack 
                        ? `${pieceToDisplay.ratio_one_ranged_attack}:${pieceToDisplay.ratio_two_ranged_attack}` 
                        : 'None'}
                    </span>
                  </div>
                )}
                <div className={styles["detail-item"]}>
                  <span className={styles["detail-label"]}>Step-by-Step Ranged Attack</span>
                  <span className={styles["detail-value"]}>{pieceToDisplay.step_by_step_ranged_attack_style ? 'Yes' : 'No'}</span>
                </div>
                {pieceToDisplay.step_by_step_ranged_attack_style && pieceToDisplay.step_by_step_ranged_attack_value != null && (
                  <div className={styles["detail-item"]}>
                    <span className={styles["detail-label"]}>Step Ranged Value</span>
                    <span className={styles["detail-value"]}>{pieceToDisplay.step_by_step_ranged_attack_value}</span>
                  </div>
                )}
                {pieceToDisplay.max_piece_captures_per_ranged_attack != null && (
                  <div className={styles["detail-item"]}>
                    <span className={styles["detail-label"]}>Max Captures Per Ranged Attack</span>
                    <span className={styles["detail-value"]}>{pieceToDisplay.max_piece_captures_per_ranged_attack}</span>
                  </div>
                )}
                <div className={styles["detail-item"]}>
                  <span className={styles["detail-label"]}>Can Repeat Ranged Attack</span>
                  <span className={styles["detail-value"]}>{pieceToDisplay.repeating_directional_ranged_attack ? 'Yes' : 'No'}</span>
                </div>
                {pieceToDisplay.repeating_directional_ranged_attack && pieceToDisplay.max_directional_ranged_attack_iterations != null && (
                  <div className={styles["detail-item"]}>
                    <span className={styles["detail-label"]}>Max Ranged Attack Iterations</span>
                    <span className={styles["detail-value"]}>{pieceToDisplay.max_directional_ranged_attack_iterations}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PieceView;
