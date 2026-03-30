import React, { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { getPieceById, getGamesByPieceId, deletePiece } from "../../actions/pieces";
import PieceBoardPreview from "../piecewizard/PieceBoardPreview";
import InfoTooltip from "../piecewizard/InfoTooltip";
import Pagination from "../pagination/Pagination";
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
  const [gamesUsingPiece, setGamesUsingPiece] = useState([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [gamesPage, setGamesPage] = useState(1);
  const GAMES_PER_PAGE = 10;

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

  // Load games that use this piece
  useEffect(() => {
    const loadGames = async () => {
      try {
        setGamesLoading(true);
        const games = await getGamesByPieceId(pieceId);
        setGamesUsingPiece(games);
        setGamesLoading(false);
      } catch (err) {
        console.error("Error loading games for piece:", err);
        setGamesLoading(false);
      }
    };

    if (pieceId) {
      loadGames();
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
    if (!currentUser || !piece) return false;
    const role = (currentUser.role || "").toLowerCase();
    return Number(piece.creator_id) === Number(currentUser.id) || role === "admin" || role === "owner";
  };

  const handleDeletePiece = async () => {
    if (!window.confirm(`Are you sure you want to delete "${piece.piece_name}"? This action cannot be undone.`)) {
      return;
    }
    try {
      await deletePiece(pieceId);
      navigate('/create/pieces');
    } catch (error) {
      alert('Failed to delete piece: ' + (error.message || error));
    }
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
      exact_ratio_hop_only: !!piece.exact_ratio_hop_only,
      directional_hop_disabled: !!piece.directional_hop_disabled,
      directional_attack_style: !!piece.directional_attack_style,
      ratio_attack_style: !!piece.ratio_attack_style,
      step_by_step_attack_style: !!piece.step_by_step_attack_style,
      directional_ranged_attack_style: !!piece.directional_ranged_attack_style,
      ratio_ranged_attack_style: !!piece.ratio_ranged_attack_style,
      step_by_step_ranged_attack_style: !!piece.step_by_step_ranged_attack_style,
      repeating_directional_ranged_attack: !!piece.repeating_directional_ranged_attack,
      // First move only flags
      first_move_only: !!piece.first_move_only,
      first_move_only_capture: !!piece.first_move_only_capture,
      // Movement exact flags
      up_left_movement_exact: !!piece.up_left_movement_exact,
      up_movement_exact: !!piece.up_movement_exact,
      up_right_movement_exact: !!piece.up_right_movement_exact,
      right_movement_exact: !!piece.right_movement_exact,
      down_right_movement_exact: !!piece.down_right_movement_exact,
      down_movement_exact: !!piece.down_movement_exact,
      down_left_movement_exact: !!piece.down_left_movement_exact,
      left_movement_exact: !!piece.left_movement_exact,
      // Capture exact flags
      up_left_capture_exact: !!piece.up_left_capture_exact,
      up_capture_exact: !!piece.up_capture_exact,
      up_right_capture_exact: !!piece.up_right_capture_exact,
      right_capture_exact: !!piece.right_capture_exact,
      down_right_capture_exact: !!piece.down_right_capture_exact,
      down_capture_exact: !!piece.down_capture_exact,
      down_left_capture_exact: !!piece.down_left_capture_exact,
      left_capture_exact: !!piece.left_capture_exact,
      // Attack range exact flags
      up_left_attack_range_exact: !!piece.up_left_attack_range_exact,
      up_attack_range_exact: !!piece.up_attack_range_exact,
      up_right_attack_range_exact: !!piece.up_right_attack_range_exact,
      right_attack_range_exact: !!piece.right_attack_range_exact,
      down_right_attack_range_exact: !!piece.down_right_attack_range_exact,
      down_attack_range_exact: !!piece.down_attack_range_exact,
      down_left_attack_range_exact: !!piece.down_left_attack_range_exact,
      left_attack_range_exact: !!piece.left_attack_range_exact,
      piece_image_previews: parsePieceImages(),
      // Use database field names directly for PieceBoardPreview
      special_scenario_moves: piece.special_scenario_moves || "",
      special_scenario_capture: piece.special_scenario_captures || ""
    };
    
    return sanitized;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece]);

  // Helper to get additional movements from special_scenario_moves
  const getAdditionalMovements = useMemo(() => {
    if (!piece?.special_scenario_moves) return {};
    try {
      const parsed = typeof piece.special_scenario_moves === 'string' 
        ? JSON.parse(piece.special_scenario_moves)
        : piece.special_scenario_moves;
      return parsed?.additionalMovements || {};
    } catch {
      return {};
    }
  }, [piece]);

  // Helper to get additional captures from special_scenario_captures
  const getAdditionalCaptures = useMemo(() => {
    if (!piece?.special_scenario_captures) return {};
    try {
      const parsed = typeof piece.special_scenario_captures === 'string' 
        ? JSON.parse(piece.special_scenario_captures)
        : piece.special_scenario_captures;
      return parsed?.additionalCaptures || {};
    } catch {
      return {};
    }
  }, [piece]);

  // Helper to format movement value
  const formatMovementValue = (value) => {
    if (value === null || value === undefined) return 'None';
    if (value === 0) return '0 squares';
    if (value === 99) return 'Infinite (∞)';
    if (value < 0) return `Up to ${Math.abs(value)} squares`;
    return `${value} square${value !== 1 ? 's' : ''}`;
  };

  // Helper to get directional arrow icon
  const getDirectionArrow = (directionName) => {
    const arrows = {
      'Up': '⬆️',
      'Down': '⬇️',
      'Left': '⬅️',
      'Right': '➡️',
      'Up-Left': '↖️',
      'Up-Right': '↗️',
      'Down-Left': '↙️',
      'Down-Right': '↘️'
    };
    return arrows[directionName] || '';
  };

  // Helper to get directional movement details
  const getDirectionalDetails = () => {
    if (!piece) return [];
    const directions = [
      { name: 'Up', value: piece.up_movement, exact: !!piece.up_movement_exact, availableFor: piece.up_movement_available_for },
      { name: 'Down', value: piece.down_movement, exact: !!piece.down_movement_exact, availableFor: piece.down_movement_available_for },
      { name: 'Left', value: piece.left_movement, exact: !!piece.left_movement_exact, availableFor: piece.left_movement_available_for },
      { name: 'Right', value: piece.right_movement, exact: !!piece.right_movement_exact, availableFor: piece.right_movement_available_for },
      { name: 'Up-Left', value: piece.up_left_movement, exact: !!piece.up_left_movement_exact, availableFor: piece.up_left_movement_available_for },
      { name: 'Up-Right', value: piece.up_right_movement, exact: !!piece.up_right_movement_exact, availableFor: piece.up_right_movement_available_for },
      { name: 'Down-Left', value: piece.down_left_movement, exact: !!piece.down_left_movement_exact, availableFor: piece.down_left_movement_available_for },
      { name: 'Down-Right', value: piece.down_right_movement, exact: !!piece.down_right_movement_exact, availableFor: piece.down_right_movement_available_for }
    ];
    return directions.filter(d => d.value != null && d.value !== 0);
  };

  // Helper to get directional capture details
  const getDirectionalCaptureDetails = () => {
    if (!piece) return [];
    const directions = [
      { name: 'Up', value: piece.up_capture, exact: !!piece.up_capture_exact, availableFor: piece.up_capture_available_for },
      { name: 'Down', value: piece.down_capture, exact: !!piece.down_capture_exact, availableFor: piece.down_capture_available_for },
      { name: 'Left', value: piece.left_capture, exact: !!piece.left_capture_exact, availableFor: piece.left_capture_available_for },
      { name: 'Right', value: piece.right_capture, exact: !!piece.right_capture_exact, availableFor: piece.right_capture_available_for },
      { name: 'Up-Left', value: piece.up_left_capture, exact: !!piece.up_left_capture_exact, availableFor: piece.up_left_capture_available_for },
      { name: 'Up-Right', value: piece.up_right_capture, exact: !!piece.up_right_capture_exact, availableFor: piece.up_right_capture_available_for },
      { name: 'Down-Left', value: piece.down_left_capture, exact: !!piece.down_left_capture_exact, availableFor: piece.down_left_capture_available_for },
      { name: 'Down-Right', value: piece.down_right_capture, exact: !!piece.down_right_capture_exact, availableFor: piece.down_right_capture_available_for }
    ];
    return directions.filter(d => d.value != null && d.value !== 0);
  };

  // Helper to get directional attack range details
  const getDirectionalAttackDetails = () => {
    if (!piece) return [];
    const directions = [
      { name: 'Up', value: piece.up_attack_range, exact: !!piece.up_attack_range_exact, availableFor: piece.up_attack_range_available_for },
      { name: 'Down', value: piece.down_attack_range, exact: !!piece.down_attack_range_exact, availableFor: piece.down_attack_range_available_for },
      { name: 'Left', value: piece.left_attack_range, exact: !!piece.left_attack_range_exact, availableFor: piece.left_attack_range_available_for },
      { name: 'Right', value: piece.right_attack_range, exact: !!piece.right_attack_range_exact, availableFor: piece.right_attack_range_available_for },
      { name: 'Up-Left', value: piece.up_left_attack_range, exact: !!piece.up_left_attack_range_exact, availableFor: piece.up_left_attack_range_available_for },
      { name: 'Up-Right', value: piece.up_right_attack_range, exact: !!piece.up_right_attack_range_exact, availableFor: piece.up_right_attack_range_available_for },
      { name: 'Down-Left', value: piece.down_left_attack_range, exact: !!piece.down_left_attack_range_exact, availableFor: piece.down_left_attack_range_available_for },
      { name: 'Down-Right', value: piece.down_right_attack_range, exact: !!piece.down_right_attack_range_exact, availableFor: piece.down_right_attack_range_available_for }
    ];
    return directions.filter(d => d.value != null && d.value !== 0);
  };

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
      exact_ratio_hop_only: !!piece.exact_ratio_hop_only,
      directional_hop_disabled: !!piece.directional_hop_disabled,
      directional_attack_style: !!piece.directional_attack_style,
      ratio_attack_style: !!piece.ratio_attack_style,
      step_by_step_attack_style: !!piece.step_by_step_attack_style,
      directional_ranged_attack_style: !!piece.directional_ranged_attack_style,
      ratio_ranged_attack_style: !!piece.ratio_ranged_attack_style,
      step_by_step_ranged_attack_style: !!piece.step_by_step_ranged_attack_style,
      repeating_directional_ranged_attack: !!piece.repeating_directional_ranged_attack,
      // First move only flags
      first_move_only: !!piece.first_move_only,
      first_move_only_capture: !!piece.first_move_only_capture,
      // Convert special ability fields to booleans
      can_promote: !!piece.can_promote,
      can_castle: !!piece.can_castle,
      can_en_passant: !!piece.can_en_passant,
      has_checkmate_rule: !!piece.has_checkmate_rule,
      has_check_rule: !!piece.has_check_rule,
      has_lose_on_capture_rule: !!piece.has_lose_on_capture_rule,
      capture_on_hop: !!piece.capture_on_hop,
      chain_capture_enabled: !!piece.chain_capture_enabled,
      can_capture_allies: !!piece.can_capture_allies,
      cannot_be_captured: !!piece.cannot_be_captured
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

  // Calculate the board size that PieceBoardPreview would use for this piece
  const calculatePreviewBoardSize = () => {
    if (!piece) return { boardWidth: 9, boardHeight: 9 };
    let maxRange = 0;
    const movements = [
      piece.up_left_movement, piece.up_movement, piece.up_right_movement,
      piece.left_movement, piece.right_movement,
      piece.down_left_movement, piece.down_movement, piece.down_right_movement
    ];
    const captures = [
      piece.up_left_capture, piece.up_capture, piece.up_right_capture,
      piece.left_capture, piece.right_capture,
      piece.down_left_capture, piece.down_capture, piece.down_right_capture
    ];
    const attacks = [
      piece.up_left_attack_range, piece.up_attack_range, piece.up_right_attack_range,
      piece.left_attack_range, piece.right_attack_range,
      piece.down_left_attack_range, piece.down_attack_range, piece.down_right_attack_range
    ];
    const ratioMovement = Math.abs(piece.ratio_one_movement || 0) + Math.abs(piece.ratio_two_movement || 0);
    const ratioCapture = Math.abs(piece.ratio_one_capture || 0) + Math.abs(piece.ratio_two_capture || 0);
    const ratioAttack = Math.abs(piece.ratio_one_attack_range || 0) + Math.abs(piece.ratio_two_attack_range || 0);
    const stepMovement = Math.abs(piece.step_by_step_movement_value || 0);
    const stepCapture = Math.abs(piece.step_by_step_capture || 0);
    const stepAttack = Math.abs(piece.step_by_step_attack_range || 0);
    [...movements, ...captures, ...attacks].forEach(val => {
      if (val !== 99 && val !== null && val !== undefined) {
        const absVal = Math.abs(val);
        if (!isNaN(absVal)) maxRange = Math.max(maxRange, absVal);
      }
    });
    maxRange = Math.max(maxRange, ratioMovement, ratioCapture, ratioAttack, stepMovement, stepCapture, stepAttack);
    const padding = Math.max(4, maxRange);
    const pw = piece.piece_width || 1;
    const ph = piece.piece_height || 1;
    return { boardWidth: pw + padding * 2, boardHeight: ph + padding * 2 };
  };

  const handleTryInSandbox = () => {
    const MAX_SANDBOXES = 4;
    const existingSandboxes = (() => {
      try {
        const saved = localStorage.getItem('chessus-sandboxes');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch (e) { /* ignore */ }
      return [];
    })();

    if (existingSandboxes.length >= MAX_SANDBOXES) {
      const confirmed = window.confirm(
        `You already have ${MAX_SANDBOXES} sandbox boards open. Opening this piece in a new sandbox will close your least recent sandbox ("${existingSandboxes[0]?.name || 'Sandbox 1'}"). Continue?`
      );
      if (!confirmed) return;
    }

    const { boardWidth: bw, boardHeight: bh } = calculatePreviewBoardSize();
    const pw = piece.piece_width || 1;
    const ph = piece.piece_height || 1;
    const centerX = Math.floor((bw - pw) / 2);
    const centerY = Math.floor((bh - ph) / 2);

    const pendingData = {
      pieceId: piece.piece_id,
      pieceName: piece.piece_name,
      boardWidth: bw,
      boardHeight: bh,
      centerX,
      centerY
    };
    localStorage.setItem('chessus-sandbox-pending-piece', JSON.stringify(pendingData));
    navigate('/sandbox');
  };

  return (
    <div className={styles["container"]}>
      <div className={styles["header"]}>
        <button onClick={() => navigate('/create/pieces')} className={styles["back-button"]}>
          ← Back to Pieces
        </button>
        <div className={styles["header-actions"]}>
          <button 
            onClick={handleTryInSandbox} 
            className={styles["sandbox-button"]}
          >
            ⚔️ Try in Sandbox
          </button>
          {canEdit() && (
            <>
              <button 
                onClick={() => navigate(`/create/piece/edit/${pieceId}`)} 
                className={styles["edit-button"]}
              >
                ✏️ Edit Piece
              </button>
              <button 
                onClick={handleDeletePiece} 
                className={styles["delete-button"]}
              >
                🗑️ Delete Piece
              </button>
            </>
          )}
        </div>
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
                Created by {pieceToDisplay.creator_username === 'Anonymous' ? 'Anonymous' : <Link to={`/profile/${pieceToDisplay.creator_username}`}>{pieceToDisplay.creator_username}</Link>}
                {pieceToDisplay.created_at && (
                  <> on {new Date(pieceToDisplay.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</>
                )}
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
                    loading="lazy"
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
          <div className={styles["board-container"]}>
            <PieceBoardPreview pieceData={pieceDataWithImages} showLegend={true} />
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
            <span className={styles["stat-label"]}>
              Capture on Move
              <InfoTooltip text="Can capture enemy pieces while moving (see Attack Details for specific squares)" />
            </span>
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
          <div className={styles["stat-card"]}>
            <span className={styles["stat-label"]}>
              Exact Movement
              <InfoTooltip text="When enabled, pieces must move exactly the specified number of squares, not any distance up to that number." />
            </span>
            <span className={styles["stat-value"]}>
              {(piece.up_movement_exact || piece.down_movement_exact || piece.left_movement_exact || piece.right_movement_exact ||
                piece.up_left_movement_exact || piece.up_right_movement_exact || piece.down_left_movement_exact || piece.down_right_movement_exact) ? 'Yes' : 'No'}
            </span>
          </div>
        </div>

        <div className={styles["section"]}>
          <h2>Movement Details</h2>
          
          {/* Directional Movement */}
          {pieceToDisplay.directional_movement_style && (
            <div className={styles["ability-card"]}>
              <div className={styles["ability-header"]}>
                <span className={styles["ability-icon"]}>🧭</span>
                <h3>Directional Movement</h3>
              </div>
              {pieceToDisplay.first_move_only && (
                <div className={styles["global-modifier"]}>
                  <span className={styles["modifier-icon"]}>⏱️</span>
                  <span>All directional movement is first-move only</span>
                </div>
              )}
              {getDirectionalDetails().length > 0 && (
                <div className={styles["direction-list"]}>
                  {getDirectionalDetails().map(dir => (
                    <div key={dir.name} className={styles["direction-item"]}>
                      <span className={styles["direction-name"]}>
                        <span className={styles["direction-arrow"]}>{getDirectionArrow(dir.name)}</span>
                        {dir.name}
                      </span>
                      <span className={styles["direction-value"]}>
                        {dir.exact ? 'Exactly ' : ''}{formatMovementValue(dir.value)}
                        {dir.availableFor && <span className={styles["first-move-badge"]}> (1st {dir.availableFor} move{dir.availableFor !== 1 ? 's' : ''})</span>}
                      </span>
                      {getAdditionalMovements[dir.name.toLowerCase().replace('-', '_')] && (
                        <div className={styles["additional-moves"]}>
                          {getAdditionalMovements[dir.name.toLowerCase().replace('-', '_')].map((move, idx) => (
                            <span key={idx} className={styles["additional-tag"]}>
                              + {formatMovementValue(move.value)}
                              {move.exact && <span className={styles["mini-badge"] + ' ' + styles["exact-mini"]}>exact</span>}
                              {move.firstMoveOnly && <span className={styles["mini-badge"] + ' ' + styles["first-move-mini"]}>1st move</span>}
                              {move.availableForMoves && <span className={styles["mini-badge"] + ' ' + styles["first-move-mini"]}>{move.availableForMoves === 1 ? '1st move' : `1st ${move.availableForMoves} moves`}</span>}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className={styles["ability-properties"]}>
                {pieceToDisplay.repeating_movement && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>🔄</span>
                    Can Repeat Movement
                    {pieceToDisplay.max_directional_movement_iterations != null && 
                      ` (max ${pieceToDisplay.max_directional_movement_iterations}x)`}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Ratio Movement */}
          {pieceToDisplay.ratio_movement_style && (
            <div className={styles["ability-card"]}>
              <div className={styles["ability-header"]}>
                <span className={styles["ability-icon"]}>🔀</span>
                <h3>Ratio Movement (L-Shape)</h3>
              </div>
              <div className={styles["ratio-display"]}>
                Pattern: <span className={styles["ratio-value"]}>
                  {pieceToDisplay.ratio_one_movement || '?'}:{pieceToDisplay.ratio_two_movement || '?'}
                </span>
              </div>
            </div>
          )}

          {/* Step by Step Movement */}
          {pieceToDisplay.step_by_step_movement_style && (
            <div className={styles["ability-card"]}>
              <div className={styles["ability-header"]}>
                <span className={styles["ability-icon"]}>👣</span>
                <h3>Step-by-Step Movement</h3>
              </div>
              <div className={styles["step-display"]}>
                Can move up to <span className={styles["step-value"]}>{pieceToDisplay.step_by_step_movement_value}</span> squares,
                changing direction within a single move
              </div>
            </div>
          )}

          {/* Movement Modifiers */}
          <div className={styles["modifiers-grid"]}>
            {pieceToDisplay.can_hop_over_allies && (
              <div className={styles["modifier-badge"]}>
                <span className={styles["modifier-icon"]}>🦘</span>
                Hop Over Allies
              </div>
            )}
            {pieceToDisplay.can_hop_over_enemies && (
              <div className={styles["modifier-badge"]}>
                <span className={styles["modifier-icon"]}>🦘</span>
                Hop Over Enemies
              </div>
            )}
            {pieceToDisplay.exact_ratio_hop_only && (
              <div className={styles["modifier-badge"]}>
                <span className={styles["modifier-icon"]}>⤵️</span>
                Require Hopping for Exact/Ratio Movement
              </div>
            )}
            {pieceToDisplay.directional_hop_disabled && (
              <div className={styles["modifier-badge"]}>
                <span className={styles["modifier-icon"]}>🚫</span>
                Hopping Disabled for Directional Movement
              </div>
            )}
            {pieceToDisplay.min_turns_per_move != null && pieceToDisplay.min_turns_per_move > 0 && (
              <div className={styles["modifier-badge"]}>
                <span className={styles["modifier-icon"]}>⏱️</span>
                Min {pieceToDisplay.min_turns_per_move} turn{pieceToDisplay.min_turns_per_move !== 1 ? 's' : ''} per move
              </div>
            )}
            {pieceToDisplay.max_turns_per_move != null && (
              <div className={styles["modifier-badge"]}>
                <span className={styles["modifier-icon"]}>⏱️</span>
                Max {pieceToDisplay.max_turns_per_move} turn{pieceToDisplay.max_turns_per_move !== 1 ? 's' : ''} per move
              </div>
            )}
          </div>
        </div>

        <div className={styles["section"]}>
          <h2>Special Abilities</h2>
          <div className={styles["abilities-grid"]}>
            {pieceToDisplay.can_promote && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>👑</span>
                <span className={styles["special-name"]}>Can Promote</span>
              </div>
            )}
            {pieceToDisplay.can_castle && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>🏰</span>
                <span className={styles["special-name"]}>Can Castle</span>
              </div>
            )}
            {pieceToDisplay.has_checkmate_rule && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>⚔️</span>
                <span className={styles["special-name"]}>Checkmate on Attack</span>
              </div>
            )}
            {pieceToDisplay.has_check_rule && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>⚠️</span>
                <span className={styles["special-name"]}>Check on Attack</span>
              </div>
            )}
            {pieceToDisplay.has_lose_on_capture_rule && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>💀</span>
                <span className={styles["special-name"]}>Lose Game if Captured</span>
              </div>
            )}
            {pieceToDisplay.can_en_passant && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>↗️</span>
                <span className={styles["special-name"]}>Can En Passant <InfoTooltip text="Can capture an enemy piece of the same type that has just used a first-move-only movement to land horizontally adjacent. For example, a Pawn can only en passant capture another Pawn." /></span>
              </div>
            )}
            {pieceToDisplay.capture_on_hop && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>🔄</span>
                <span className={styles["special-name"]}>Capture on Hop <InfoTooltip text="When this piece hops over an enemy piece during movement, it captures the hopped-over piece (like checkers)." /></span>
              </div>
            )}
            {pieceToDisplay.chain_capture_enabled && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>⛓️</span>
                <span className={styles["special-name"]}>Chain Capture <InfoTooltip text="After capturing, this piece can make additional captures in the same turn (multi-jump like checkers)." /></span>
              </div>
            )}
            {pieceToDisplay.can_capture_allies && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>🤝</span>
                <span className={styles["special-name"]}>Can Capture Allies <InfoTooltip text="This piece can capture friendly pieces on the same team." /></span>
              </div>
            )}
            {pieceToDisplay.cannot_be_captured && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>🛡️</span>
                <span className={styles["special-name"]}>Cannot Be Captured <InfoTooltip text="This piece is immune to capture by enemy pieces." /></span>
              </div>
            )}
            {!pieceToDisplay.can_promote && !pieceToDisplay.can_castle && !pieceToDisplay.has_checkmate_rule && 
             !pieceToDisplay.has_check_rule && !pieceToDisplay.has_lose_on_capture_rule && !pieceToDisplay.can_en_passant &&
             !pieceToDisplay.capture_on_hop && !pieceToDisplay.chain_capture_enabled &&
             !pieceToDisplay.can_capture_allies && !pieceToDisplay.cannot_be_captured && (
              <div className={styles["no-abilities"]}>
                <span className={styles["no-abilities-icon"]}>✨</span>
                <span>No special abilities</span>
              </div>
            )}
          </div>
        </div>

        <div className={styles["section"]}>
          <h2>Used In Games ({gamesUsingPiece.length})</h2>
          {gamesLoading ? (
            <div className={styles["loading-games"]}>
              <span>Loading games...</span>
            </div>
          ) : gamesUsingPiece.length > 0 ? (
            <>
              <div className={styles["games-grid"]}>
                {gamesUsingPiece.slice((gamesPage - 1) * GAMES_PER_PAGE, gamesPage * GAMES_PER_PAGE).map((game) => (
                  <Link 
                    key={game.id} 
                    to={`/games/${game.id}`} 
                    className={styles["game-card"]}
                  >
                    <div className={styles["game-name"]}>{game.game_name}</div>
                    <div className={styles["game-creator"]}>
                      by {game.creator_username || 'Unknown'}
                    </div>
                  </Link>
                ))}
              </div>
              {gamesUsingPiece.length > GAMES_PER_PAGE && (
                <Pagination
                  currentPage={gamesPage}
                  totalPages={Math.ceil(gamesUsingPiece.length / GAMES_PER_PAGE)}
                  onPageChange={setGamesPage}
                />
              )}
            </>
          ) : (
            <div className={styles["no-abilities"]}>
              <span className={styles["no-abilities-icon"]}>♟</span>
              <span>Not used in any games yet</span>
            </div>
          )}
        </div>

        <div className={styles["section"]}>
          <h2>Attack Details</h2>
          
          {/* Capture on Move */}
          {pieceToDisplay.can_capture_enemy_on_move && (
            <div className={styles["ability-card"]}>
              <div className={styles["ability-header"]}>
                <span className={styles["ability-icon"]}>⚔️</span>
                <h3>Capture While Moving</h3>
              </div>
              {pieceToDisplay.first_move_only_capture && (
                <div className={styles["global-modifier"]}>
                  <span className={styles["modifier-icon"]}>⏱️</span>
                  <span>All directional capture is first-move only</span>
                </div>
              )}
              {getDirectionalCaptureDetails().length > 0 && (
                <div className={styles["direction-list"]}>
                  {getDirectionalCaptureDetails().map(dir => (
                    <div key={dir.name} className={styles["direction-item"]}>
                      <span className={styles["direction-name"]}>
                        <span className={styles["direction-arrow"]}>{getDirectionArrow(dir.name)}</span>
                        {dir.name}
                      </span>
                      <span className={styles["direction-value"]}>
                        {dir.exact ? 'Exactly ' : ''}{formatMovementValue(dir.value)}
                        {dir.availableFor && <span className={styles["first-move-badge"]}> (1st {dir.availableFor} move{dir.availableFor !== 1 ? 's' : ''})</span>}
                      </span>
                      {getAdditionalCaptures[dir.name.toLowerCase().replace('-', '_')] && (
                        <div className={styles["additional-moves"]}>
                          {getAdditionalCaptures[dir.name.toLowerCase().replace('-', '_')].map((capture, idx) => (
                            <span key={idx} className={styles["additional-tag"]} style={{ background: 'rgba(255, 152, 0, 0.2)' }}>
                              + {formatMovementValue(capture.value)}
                              {capture.exact && <span className={styles["mini-badge"] + ' ' + styles["exact-mini"]}>exact</span>}
                              {capture.firstMoveOnly && <span className={styles["mini-badge"] + ' ' + styles["first-move-mini"]}>1st move</span>}
                              {capture.availableForMoves && <span className={styles["mini-badge"] + ' ' + styles["first-move-mini"]}>{capture.availableForMoves === 1 ? '1st move' : `1st ${capture.availableForMoves} moves`}</span>}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className={styles["ability-properties"]}>
                {(pieceToDisplay.ratio_one_capture || pieceToDisplay.ratio_two_capture) && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>🔀</span>
                    Ratio Capture: {pieceToDisplay.ratio_one_capture || '?'}:{pieceToDisplay.ratio_two_capture || '?'}
                    {piece.repeating_ratio_capture && (
                      <span> (repeating{piece.max_ratio_capture_iterations != null && piece.max_ratio_capture_iterations !== -1 ? `, max ${piece.max_ratio_capture_iterations}x` : ''})</span>
                    )}
                  </div>
                )}
                {pieceToDisplay.step_by_step_capture != null && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>👣</span>
                    Step Capture: {pieceToDisplay.step_by_step_capture} squares
                  </div>
                )}
                {piece.repeating_capture && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>🔄</span>
                    Can Repeat Capture
                    {piece.max_directional_capture_iterations != null && 
                      ` (max ${piece.max_directional_capture_iterations}x)`}
                  </div>
                )}
                {pieceToDisplay.max_piece_captures_per_move != null && (
                  <div className={styles["property-tag"]}>
                    Max {pieceToDisplay.max_piece_captures_per_move} capture{pieceToDisplay.max_piece_captures_per_move !== 1 ? 's' : ''} per move
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Ranged Attack */}
          {pieceToDisplay.can_capture_enemy_via_range && (
            <div className={styles["ability-card"]} style={{ borderLeftColor: '#f44336' }}>
              <div className={styles["ability-header"]}>
                <span className={styles["ability-icon"]}>💥</span>
                <h3>Ranged Attack</h3>
              </div>
              {getDirectionalAttackDetails().length > 0 && (
                <div className={styles["direction-list"]}>
                  {getDirectionalAttackDetails().map(dir => (
                    <div key={dir.name} className={styles["direction-item"]}>
                      <span className={styles["direction-name"]}>
                        <span className={styles["direction-arrow"]}>{getDirectionArrow(dir.name)}</span>
                        {dir.name}
                      </span>
                      <span className={styles["direction-value"]}>
                        {dir.exact ? 'Exactly ' : ''}{formatMovementValue(dir.value)} range
                        {dir.exact && <span className={styles["exact-badge"]}> (exact)</span>}
                        {dir.availableFor && <span className={styles["first-move-badge"]}> (1st {dir.availableFor} move{dir.availableFor !== 1 ? 's' : ''})</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className={styles["ability-properties"]}>
                {(pieceToDisplay.ratio_one_attack_range || pieceToDisplay.ratio_two_attack_range) && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>🔀</span>
                    Ratio Range: {pieceToDisplay.ratio_one_attack_range || '?'}:{pieceToDisplay.ratio_two_attack_range || '?'}
                  </div>
                )}
                {pieceToDisplay.step_by_step_attack_range != null && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>👣</span>
                    Step Range: {Math.abs(pieceToDisplay.step_by_step_attack_range)} squares{pieceToDisplay.step_by_step_attack_range < 0 ? ' (orthogonal only)' : ''}
                  </div>
                )}
                {pieceToDisplay.max_piece_captures_per_ranged_attack != null && (
                  <div className={styles["property-tag"]}>
                    Max {pieceToDisplay.max_piece_captures_per_ranged_attack} capture{pieceToDisplay.max_piece_captures_per_ranged_attack !== 1 ? 's' : ''} per attack
                  </div>
                )}
                {pieceToDisplay.repeating_directional_ranged_attack && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>🔄</span>
                    Can Repeat Attack
                    {pieceToDisplay.max_directional_ranged_attack_iterations != null && 
                      ` (max ${pieceToDisplay.max_directional_ranged_attack_iterations}x)`}
                  </div>
                )}
              </div>
            </div>
          )}

          {!pieceToDisplay.can_capture_enemy_on_move && !pieceToDisplay.can_capture_enemy_via_range && 
           !pieceToDisplay.capture_on_hop && !pieceToDisplay.can_capture_allies && (
            <div className={styles["no-abilities"]}>
              <span className={styles["no-abilities-icon"]}>🛡️</span>
              <span>This piece cannot attack</span>
            </div>
          )}

          {/* Capture on Hop */}
          {pieceToDisplay.capture_on_hop && (
            <div className={styles["ability-card"]} style={{ borderLeftColor: '#ff9800' }}>
              <div className={styles["ability-header"]}>
                <span className={styles["ability-icon"]}>🔄</span>
                <h3>Capture on Hop</h3>
              </div>
              <div className={styles["step-display"]}>
                When this piece hops over an enemy piece during movement, it captures the hopped-over piece (like checkers).
              </div>
              <div className={styles["ability-properties"]}>
                {pieceToDisplay.chain_capture_enabled && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>⛓️</span>
                    Chain Capture — can make additional captures in the same turn (multi-jump)
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Can Capture Allies */}
          {pieceToDisplay.can_capture_allies && (
            <div className={styles["ability-card"]} style={{ borderLeftColor: '#9c27b0' }}>
              <div className={styles["ability-header"]}>
                <span className={styles["ability-icon"]}>🤝</span>
                <h3>Ally Capture</h3>
              </div>
              <div className={styles["step-display"]}>
                This piece can capture friendly pieces on the same team.
              </div>
            </div>
          )}

          {/* Cannot Be Captured */}
          {pieceToDisplay.cannot_be_captured && (
            <div className={styles["ability-card"]} style={{ borderLeftColor: '#607d8b' }}>
              <div className={styles["ability-header"]}>
                <span className={styles["ability-icon"]}>🛡️</span>
                <h3>Immune to Capture</h3>
              </div>
              <div className={styles["step-display"]}>
                This piece cannot be captured by enemy pieces.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PieceView;
