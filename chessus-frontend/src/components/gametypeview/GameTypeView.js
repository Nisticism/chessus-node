import React, { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate, Link, useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";
import { getGameById, deleteGame, toggleUpvote, getUpvoteStatus, runUniquenessCheck } from "../../actions/games";
import { getPieceById } from "../../actions/pieces";
import styles from "./gametypeview.module.scss";
import {
  canPieceMoveTo as canPieceMoveToUtil,
  canCaptureOnMoveTo as canCaptureOnMoveToUtil,
  canRangedAttackTo as canRangedAttackToUtil,
  canHopCaptureToUtil,
  getSquareHighlightStyle
} from "../../helpers/pieceMovementUtils";

import { applySvgStretchBackground } from "../../helpers/svgStretchUtils";
import { parseServerDate } from "../../helpers/date-formatter";
import BoardLegend from "../common/BoardLegend";
import { renderContent } from "../../helpers/render-content";
import PieceBadges from "../common/PieceBadges";
import SquareHighlightOverlay from "../common/SquareHighlightOverlay";
import InfoTooltip from "../piecewizard/InfoTooltip";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

const getImageUrl = (imagePath) => {
  if (!imagePath) return null;
  if (imagePath.startsWith('http')) return imagePath;
  return `${ASSET_URL}${imagePath}`;
};

// Helper function to describe movement range
const describeMovementRange = (value) => {
  if (value === 99) return "any number of squares";
  if (value === 0 || value === null || value === undefined) return null;
  if (value > 0) return `up to ${value} square${value > 1 ? 's' : ''}`;
  if (value < 0) return `exactly ${Math.abs(value)} square${Math.abs(value) > 1 ? 's' : ''}`;
  return null;
};

// Helper to generate piece movement description
const describePieceMovement = (pieceData) => {
  const movements = [];
  
  const directionalStyle = pieceData.directional_movement_style;
  const hasDirectional = directionalStyle === 'directional' || directionalStyle === 'both' || 
                         directionalStyle === 1 || directionalStyle === 3;
  const hasRatio = directionalStyle === 'ratio' || directionalStyle === 'both' || 
                   directionalStyle === 2 || directionalStyle === 3;
  
  // Check for ratio movement values even if directional_movement_style isn't set
  // Handle both naming conventions: ratio_movement_1/2 and ratio_one_movement/ratio_two_movement
  const ratio1 = pieceData.ratio_movement_1 || pieceData.ratio_one_movement || 0;
  const ratio2 = pieceData.ratio_movement_2 || pieceData.ratio_two_movement || 0;
  const hasRatioValues = ratio1 > 0 && ratio2 > 0;
  
  if (hasDirectional) {
    // Collect directional movements
    const directions = [];
    
    // Check vertical
    const up = describeMovementRange(pieceData.up_movement);
    const down = describeMovementRange(pieceData.down_movement);
    if (up && down && up === down) {
      directions.push(`vertically ${up}`);
    } else {
      if (up) directions.push(`upward ${up}`);
      if (down) directions.push(`downward ${down}`);
    }
    
    // Check horizontal
    const left = describeMovementRange(pieceData.left_movement);
    const right = describeMovementRange(pieceData.right_movement);
    if (left && right && left === right) {
      directions.push(`horizontally ${left}`);
    } else {
      if (left) directions.push(`leftward ${left}`);
      if (right) directions.push(`rightward ${right}`);
    }
    
    // Check diagonals
    const upLeft = describeMovementRange(pieceData.up_left_movement);
    const upRight = describeMovementRange(pieceData.up_right_movement);
    const downLeft = describeMovementRange(pieceData.down_left_movement);
    const downRight = describeMovementRange(pieceData.down_right_movement);
    
    const allDiagonals = [upLeft, upRight, downLeft, downRight].filter(Boolean);
    const allSameDiagonal = allDiagonals.length === 4 && allDiagonals.every(d => d === allDiagonals[0]);
    
    if (allSameDiagonal) {
      directions.push(`diagonally ${allDiagonals[0]}`);
    } else {
      if (upLeft) directions.push(`diagonally up-left ${upLeft}`);
      if (upRight) directions.push(`diagonally up-right ${upRight}`);
      if (downLeft) directions.push(`diagonally down-left ${downLeft}`);
      if (downRight) directions.push(`diagonally down-right ${downRight}`);
    }
    
    if (directions.length > 0) {
      let dirText = directions.join(', ');
      if (pieceData.repeating_movement) {
        dirText += ' (exact distances repeat infinitely)';
      }
      movements.push(dirText);
    }
  }
  
  // Check ratio movement (L-shape like knight) - check both flag and values
  if (hasRatio || hasRatioValues) {
    if (hasRatioValues) {
      let ratioText = `in an L-shape (${ratio1} squares in one direction and ${ratio2} squares perpendicular)`;
      if (pieceData.repeating_ratio) {
        const maxIter = pieceData.max_ratio_iterations;
        if (maxIter === -1) {
          ratioText += ', repeating infinitely';
        } else if (maxIter && maxIter > 1) {
          ratioText += `, repeating up to ${maxIter} times`;
        }
      }
      movements.push(ratioText);
    }
  }
  
  // Check step movement - handle both naming conventions
  const stepStyle = pieceData.step_movement_style || pieceData.step_by_step_movement_style;
  const stepValue = pieceData.step_movement_value || pieceData.step_by_step_movement_value;
  
  if (stepStyle && stepValue) {
    // Negative stepValue = manhattan (diagonals excluded), positive = chebyshev (includes diagonals)
    const isManhattan = stepStyle === 'manhattan' || stepValue < 0;
    const range = describeMovementRange(stepValue);
    if (range) {
      if (isManhattan) {
        movements.push(`${range} counting horizontal and vertical steps`);
      } else {
        movements.push(`${range} in any direction (including diagonals)`);
      }
    }
  }
  
  // Check hopping ability
  const hoppingDetails = [];
  if (pieceData.can_hop_over_allies) {
    hoppingDetails.push('allies');
  }
  if (pieceData.can_hop_over_enemies) {
    hoppingDetails.push('enemies');
  }
  if (hoppingDetails.length > 0) {
    let hopText = `can hop over ${hoppingDetails.join(' and ')}`;
    // If hopping is disabled for directional movement, specify which movement types still allow hopping
    const hasStepMovement = stepStyle && stepValue;
    if (pieceData.directional_hop_disabled && hasDirectional) {
      const hopMovementTypes = [];
      if (hasRatio || hasRatioValues) {
        hopMovementTypes.push(hasRatioValues ? 'ratio L-shaped movement' : 'ratio movement');
      }
      if (hasStepMovement) {
        hopMovementTypes.push('step-by-step movement');
      }
      // Exact directional movements still allow hopping
      hopMovementTypes.push('exact directional movement');
      hopText += ` when using its ${hopMovementTypes.join(' or ')}`;
    }
    movements.push(hopText);
  }
  
  return movements.join('; ');
};

// Helper to generate piece ranged attack description
const describePieceRangedAttack = (pieceData) => {
  if (!pieceData.can_capture_enemy_via_range) return '';

  const parts = [];

  // Directional ranged attacks
  const directions = [];
  const up = describeMovementRange(pieceData.up_attack_range);
  const down = describeMovementRange(pieceData.down_attack_range);
  if (up && down && up === down) {
    directions.push(`vertically ${up}`);
  } else {
    if (up) directions.push(`upward ${up}`);
    if (down) directions.push(`downward ${down}`);
  }
  const left = describeMovementRange(pieceData.left_attack_range);
  const right = describeMovementRange(pieceData.right_attack_range);
  if (left && right && left === right) {
    directions.push(`horizontally ${left}`);
  } else {
    if (left) directions.push(`leftward ${left}`);
    if (right) directions.push(`rightward ${right}`);
  }
  const upLeft = describeMovementRange(pieceData.up_left_attack_range);
  const upRight = describeMovementRange(pieceData.up_right_attack_range);
  const downLeft = describeMovementRange(pieceData.down_left_attack_range);
  const downRight = describeMovementRange(pieceData.down_right_attack_range);
  const allDiagonals = [upLeft, upRight, downLeft, downRight].filter(Boolean);
  const allSameDiagonal = allDiagonals.length === 4 && allDiagonals.every(d => d === allDiagonals[0]);
  if (allSameDiagonal) {
    directions.push(`diagonally ${allDiagonals[0]}`);
  } else {
    if (upLeft) directions.push(`diagonally up-left ${upLeft}`);
    if (upRight) directions.push(`diagonally up-right ${upRight}`);
    if (downLeft) directions.push(`diagonally down-left ${downLeft}`);
    if (downRight) directions.push(`diagonally down-right ${downRight}`);
  }
  if (directions.length > 0) {
    let dirText = directions.join(', ');
    if (pieceData.repeating_directional_ranged_attack) {
      const maxIter = pieceData.max_directional_ranged_attack_iterations;
      if (maxIter && maxIter > 1) {
        dirText += ` (repeating up to ${maxIter} times)`;
      } else {
        dirText += ' (repeating)';
      }
    }
    parts.push(dirText);
  }

  // Ratio (L-shape) ranged attack
  const r1 = pieceData.ratio_one_attack_range || pieceData.ratio_attack_1 || 0;
  const r2 = pieceData.ratio_two_attack_range || pieceData.ratio_attack_2 || 0;
  if (r1 > 0 && r2 > 0) {
    parts.push(`in an L-shape (${r1} squares by ${r2} squares)`);
  }

  // Step-based ranged attack
  const stepRange = pieceData.step_by_step_attack_range;
  if (stepRange != null && stepRange !== 0) {
    const isManhattan = stepRange < 0;
    const range = describeMovementRange(stepRange);
    if (range) {
      parts.push(isManhattan
        ? `within ${range} (counting horizontal and vertical steps)`
        : `within ${range} in any direction`);
    }
  }

  let text = parts.length > 0
    ? `can fire ${parts.join('; ')}`
    : 'has a ranged attack';

  // Suffixes
  const suffixes = [];
  if (pieceData.max_piece_captures_per_ranged_attack != null && pieceData.max_piece_captures_per_ranged_attack > 0) {
    const n = pieceData.max_piece_captures_per_ranged_attack;
    suffixes.push(`max ${n} capture${n !== 1 ? 's' : ''} per attack`);
  }
  suffixes.push(pieceData.can_fire_over_enemies ? 'can fire over enemies' : 'blocked by enemies');
  suffixes.push(pieceData.can_fire_over_allies ? 'can fire over allies' : 'blocked by allies');

  if (suffixes.length > 0) {
    text += ` (${suffixes.join(', ')})`;
  }

  return text;
};

// Helper to generate piece capture description
const describePieceCapture = (pieceData) => {
  const captures = [];
  
  // Check for any separate capture data defined - handle both naming conventions
  const hasSeparateCapture = pieceData.up_capture || pieceData.down_capture || 
                              pieceData.left_capture || pieceData.right_capture ||
                              pieceData.up_left_capture || pieceData.up_right_capture ||
                              pieceData.down_left_capture || pieceData.down_right_capture ||
                              pieceData.ratio_capture_1 || pieceData.ratio_capture_2 ||
                              pieceData.ratio_one_capture || pieceData.ratio_two_capture ||
                              pieceData.step_capture_style || pieceData.step_capture_value ||
                              pieceData.step_by_step_capture ||
                              pieceData.directional_capture_style;
  
  // If attacks like movement and no separate capture data, return early
  if ((pieceData.attacks_like_movement || pieceData.can_capture_enemy_on_move) && !hasSeparateCapture) {
    return "captures the same way it moves";
  }
  
  // Check directional captures
  const directionalStyle = pieceData.directional_capture_style;
  const hasDirectionalCapture = directionalStyle === 'directional' || directionalStyle === 'both' || 
                         directionalStyle === 1 || directionalStyle === 3 ||
                         pieceData.up_capture || pieceData.down_capture ||
                         pieceData.left_capture || pieceData.right_capture ||
                         pieceData.up_left_capture || pieceData.up_right_capture ||
                         pieceData.down_left_capture || pieceData.down_right_capture;
  
  if (hasDirectionalCapture) {
    const directions = [];
    
    // Check vertical captures
    const up = describeMovementRange(pieceData.up_capture);
    const down = describeMovementRange(pieceData.down_capture);
    if (up && down && up === down) {
      directions.push(`vertically ${up}`);
    } else {
      if (up) directions.push(`upward ${up}`);
      if (down) directions.push(`downward ${down}`);
    }
    
    // Check horizontal captures
    const left = describeMovementRange(pieceData.left_capture);
    const right = describeMovementRange(pieceData.right_capture);
    if (left && right && left === right) {
      directions.push(`horizontally ${left}`);
    } else {
      if (left) directions.push(`leftward ${left}`);
      if (right) directions.push(`rightward ${right}`);
    }
    
    // Check diagonal captures
    const upLeft = describeMovementRange(pieceData.up_left_capture);
    const upRight = describeMovementRange(pieceData.up_right_capture);
    const downLeft = describeMovementRange(pieceData.down_left_capture);
    const downRight = describeMovementRange(pieceData.down_right_capture);
    
    const allDiagonals = [upLeft, upRight, downLeft, downRight].filter(Boolean);
    const allSameDiagonal = allDiagonals.length === 4 && allDiagonals.every(d => d === allDiagonals[0]);
    
    if (allSameDiagonal) {
      directions.push(`diagonally ${allDiagonals[0]}`);
    } else {
      if (upLeft) directions.push(`diagonally up-left ${upLeft}`);
      if (upRight) directions.push(`diagonally up-right ${upRight}`);
      if (downLeft) directions.push(`diagonally down-left ${downLeft}`);
      if (downRight) directions.push(`diagonally down-right ${downRight}`);
    }
    
    if (directions.length > 0) {
      let dirText = directions.join(', ');
      if (pieceData.repeating_capture) {
        dirText += ' (exact distances repeat infinitely)';
      }
      captures.push(dirText);
    }
  }
  
  // Ratio capture (L-shape like knight) - handle both naming conventions
  const hasRatioCapture = directionalStyle === 'ratio' || directionalStyle === 'both' || 
                          directionalStyle === 2 || directionalStyle === 3;
  const ratio1 = pieceData.ratio_capture_1 || pieceData.ratio_one_capture || 0;
  const ratio2 = pieceData.ratio_capture_2 || pieceData.ratio_two_capture || 0;
  if (hasRatioCapture || (ratio1 > 0 && ratio2 > 0)) {
    if (ratio1 > 0 && ratio2 > 0) {
      let ratioText = `in an L-shape (${ratio1} squares by ${ratio2} squares)`;
      if (pieceData.repeating_ratio_capture) {
        const maxIter = pieceData.max_ratio_capture_iterations;
        if (maxIter === -1) {
          ratioText += ', repeating infinitely';
        } else if (maxIter && maxIter > 1) {
          ratioText += `, repeating up to ${maxIter} times`;
        }
      }
      captures.push(ratioText);
    }
  }
  
  // Step-based capture - handle both naming conventions
  const stepStyle = pieceData.step_capture_style || pieceData.step_by_step_capture;
  const stepValue = pieceData.step_capture_value || pieceData.step_by_step_capture_value || pieceData.step_by_step_capture;
  
  if (stepStyle && stepValue) {
    // Negative stepValue = manhattan (diagonals excluded), positive = chebyshev (includes diagonals)
    const isManhattan = stepStyle === 'manhattan' || stepValue < 0;
    const range = describeMovementRange(stepValue);
    if (range) {
      if (isManhattan) {
        captures.push(`within ${range} (counting horizontal and vertical steps)`);
      } else {
        captures.push(`within ${range} in any direction`);
      }
    }
  }
  
  // If no specific capture patterns found but attacks_like_movement is set
  if (captures.length === 0 && (pieceData.attacks_like_movement || pieceData.can_capture_enemy_on_move)) {
    return "captures the same way it moves";
  }
  
  return captures.join('; ');
};

// Helper to format a custom_movement_squares / custom_attack_squares JSON column as a
// compact one-line array of relative [row, col] offsets.
const formatCustomSquaresLine = (rawValue) => {
  if (!rawValue) return '';
  let parsed = rawValue;
  if (typeof rawValue === 'string') {
    try { parsed = JSON.parse(rawValue); } catch { return ''; }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return '';
  const coords = parsed
    .filter((sq) => Number.isInteger(sq?.row) && Number.isInteger(sq?.col))
    .map((sq) => `[${sq.row}, ${sq.col}]`);
  if (coords.length === 0) return '';
  return coords.join(', ');
};

const GameTypeView = () => {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [piecePlacements, setPiecePlacements] = useState({});
  const [pieceDataMap, setPieceDataMap] = useState({});
  const [hoveredPiecePosition, setHoveredPiecePosition] = useState(null);
  const [specialSquares, setSpecialSquares] = useState({
    range: {},
    promotion: {},
    control: {},
    special: {}
  });
  const [uniquenessCheckLoading, setUniquenessCheckLoading] = useState(false);
  const [uniquenessResult, setUniquenessResult] = useState(null);
  const [uniquenessError, setUniquenessError] = useState(null);
  const [boardContainerWidth, setBoardContainerWidth] = useState(0);
  const boardContainerRef = useRef(null);
  const [upvoteCount, setUpvoteCount] = useState(0);
  const [hasUpvoted, setHasUpvoted] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  // AI training analysis link (only shown when caller is allowed to view it).
  const [aiAnalysisAvailable, setAiAnalysisAvailable] = useState(false);
  // "Request AI Analysis" button state
  const [requestingAnalysis, setRequestingAnalysis] = useState(false);
  const [analysisRequestSent, setAnalysisRequestSent] = useState(false);

  // Get user's preferred board colors from localStorage
  const lightSquareColor = localStorage.getItem('boardLightColor') || '#cad5e8';
  const darkSquareColor = localStorage.getItem('boardDarkColor') || '#08234d';
  const boardAnimationsEnabled = localStorage.getItem('boardAnimations') !== 'false';

  // Track board container width for responsive sizing
  // Re-run when loading finishes so the ref is available in the DOM
  useEffect(() => {
    const el = boardContainerRef.current;
    if (!el) return;
    // Measure immediately so the board renders at the right size
    setBoardContainerWidth(el.clientWidth - 40);
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setBoardContainerWidth(entry.contentRect.width - 40); // subtract padding
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading]);

  useEffect(() => {
    const loadGame = async () => {
      try {
        setLoading(true);
        const gameData = await dispatch(getGameById(gameId));
        setGame(gameData);

        // Parse piece placements
        if (gameData.pieces_string) {
          try {
            const parsed = JSON.parse(gameData.pieces_string);
            
            // Get unique piece IDs from placements
            const pieceIds = new Set();
            Object.values(parsed).forEach(placement => {
              if (placement.piece_id) {
                pieceIds.add(placement.piece_id);
              }
              // Also include any promotion override target piece IDs so their
              // names can be displayed (and linked) in the Special Rules section
              if (placement.promotion_pieces_override) {
                try {
                  const v = typeof placement.promotion_pieces_override === 'string'
                    ? JSON.parse(placement.promotion_pieces_override)
                    : placement.promotion_pieces_override;
                  if (Array.isArray(v)) v.forEach(id => { if (id != null) pieceIds.add(Number(id)); });
                } catch { /* ignore */ }
              }
            });
            
            // Fetch piece data for all unique piece IDs with full movement data
            if (pieceIds.size > 0) {
              const pieceMap = {};
              
              // Load full details for each piece ID directly
              await Promise.all(Array.from(pieceIds).map(async (pieceId) => {
                try {
                  const fullPieceData = await getPieceById(pieceId);
                  // Store by the requested ID, not the returned ID
                  pieceMap[pieceId] = fullPieceData;
                } catch (err) {
                  console.error(`Error loading piece ${pieceId}:`, err);
                }
              }));
              
              setPieceDataMap(pieceMap);
            }
            setPiecePlacements(parsed);
          } catch (e) {
            console.error("Error parsing pieces_string:", e);
          }
        }

        // Parse special squares
        if (gameData.range_squares_string) {
          try {
            const parsed = JSON.parse(gameData.range_squares_string);
            setSpecialSquares(prev => ({ ...prev, range: parsed }));
          } catch (e) {
            console.error("Error parsing range_squares_string:", e);
          }
        }

        if (gameData.promotion_squares_string) {
          try {
            const parsed = JSON.parse(gameData.promotion_squares_string);
            setSpecialSquares(prev => ({ ...prev, promotion: parsed }));
          } catch (e) {
            console.error("Error parsing promotion_squares_string:", e);
          }
        }

        if (gameData.special_squares_string) {
          try {
            const parsed = JSON.parse(gameData.special_squares_string);
            setSpecialSquares(prev => ({ ...prev, special: parsed }));
          } catch (e) {
            console.error("Error parsing special_squares_string:", e);
          }
        }

        if (gameData.control_squares_string) {
          try {
            const parsed = JSON.parse(gameData.control_squares_string);
            setSpecialSquares(prev => ({ ...prev, control: parsed }));
          } catch (e) {
            console.error("Error parsing control_squares_string:", e);
          }
        }

        setLoading(false);

        // Load upvote status
        try {
          const upvoteData = await getUpvoteStatus(gameId);
          setUpvoteCount(upvoteData.upvote_count);
          setHasUpvoted(upvoteData.upvoted);
        } catch (e) {
          // Upvote status non-critical
        }
      } catch (err) {
        console.error("Error loading game:", err);
        setError("Failed to load game");
        setLoading(false);
      }
    };

    if (gameId) {
      loadGame();
    }
  }, [gameId, dispatch, location.key]);

  // Probe whether an AI training analysis exists AND is visible to the
  // current viewer. Uses the lightweight /exists endpoint so we don't
  // pull the full summary_json LONGTEXT on every game detail page load
  // (which used to make games with public AI data noticeably laggy).
  useEffect(() => {
    let cancelled = false;
    setAiAnalysisAvailable(false);
    if (!gameId) return undefined;
    axios
      .get(`${API_URL}ai-training/analysis/${gameId}/exists`, {
        headers: authHeader(),
        validateStatus: () => true, // treat 404 as a non-error so browsers don't log a network error
      })
      .then((res) => { if (!cancelled) setAiAnalysisAvailable(res.status === 200 && !!res.data?.exists); })
      .catch(() => { if (!cancelled) setAiAnalysisAvailable(false); });
    return () => { cancelled = true; };
  }, [gameId, currentUser]);

  const handleUpvote = async () => {
    if (!currentUser) return;
    try {
      const result = await toggleUpvote(gameId);
      setUpvoteCount(result.upvote_count);
      setHasUpvoted(result.upvoted);
    } catch (err) {
      console.error("Error toggling upvote:", err);
    }
  };

  const handleRequestAnalysis = async () => {
    if (!currentUser || requestingAnalysis) return;
    setRequestingAnalysis(true);
    try {
      await axios.post(
        `${API_URL}game-types/${gameId}/request-analysis`,
        {},
        { headers: authHeader() }
      );
      setAnalysisRequestSent(true);
    } catch (err) {
      alert(err?.response?.data?.message || err.message || 'Failed to send analysis request');
    } finally {
      setRequestingAnalysis(false);
    }
  };

  const getPlayerColor = (playerId) => {
    // Use chess-standard colors: Player 1 = White, Player 2 = Black
    // Additional players get distinct colors
    const colors = ['#ffffff', '#222222', '#ff6b6b', '#4ecdc4', '#f7dc6f', '#bb8fce', '#52be80', '#5dade2'];
    return colors[(playerId - 1) % colors.length] || '#999';
  };

  const getSquareType = (key) => {
    if (specialSquares.range[key]) return 'range';
    if (specialSquares.promotion[key]) return 'promotion';
    if (specialSquares.control[key]) return 'control';
    if (specialSquares.special[key]) return 'special';
    return null;
  };

  const getSquareColor = (type) => {
    switch (type) {
      case 'range': return '#ff8c00';
      case 'promotion': return '#9b59b6';
      case 'control': return '#32CD32';
      case 'special': return '#ffd700';
      default: return null;
    }
  };

  const getPlacementImageUrl = (placement) => {
    // Support player_id, player_number, and player interchangeably
    const playerId = placement.player_id || placement.player_number || placement.player || 1;
    
    // First try to use the saved image_url from placement (player-specific)
    if (placement.image_url) {
      return getImageUrl(placement.image_url);
    }
    
    // Try to use image_location from placement if available
    if (placement.image_location) {
      try {
        const images = JSON.parse(placement.image_location);
        if (Array.isArray(images) && images.length > 0) {
          const imageIndex = Math.min(playerId - 1, images.length - 1);
          const imagePath = images[imageIndex];
          return imagePath.startsWith('http') ? imagePath : `${ASSET_URL}${imagePath}`;
        }
      } catch (e) {
        console.error("Error parsing placement image_location:", e);
      }
    }
    
    // Fall back to fetching from piece data using player_id to select correct image
    if (placement.piece_id && pieceDataMap[placement.piece_id]) {
      const piece = pieceDataMap[placement.piece_id];
      if (piece.image_location) {
        try {
          const images = JSON.parse(piece.image_location);
          if (Array.isArray(images) && images.length > 0) {
            const imageIndex = Math.min(playerId - 1, images.length - 1);
            const imagePath = images[imageIndex];
            return imagePath.startsWith('http') ? imagePath : `${ASSET_URL}${imagePath}`;
          }
        } catch (e) {
          console.error("Error parsing image_location for piece", placement.piece_id, e);
        }
      }
    }
    return null;
  };

  // Check if piece can perform ranged attack to target square
  const canRangedAttackTo = (fromRow, fromCol, toRow, toCol, pieceData, playerPosition) => {
    if (!pieceData) return false;
    return canRangedAttackToUtil(fromRow, fromCol, toRow, toCol, pieceData, playerPosition);
  };

  // Get full movement info including first-move-only status
  const getMoveInfo = (fromRow, fromCol, toRow, toCol, pieceData, playerPosition) => {
    if (!pieceData) return { allowed: false, isFirstMoveOnly: false };
    return canPieceMoveToUtil(fromRow, fromCol, toRow, toCol, pieceData, playerPosition);
  };

  // Get full capture info including first-move-only status
  const getCaptureInfo = (fromRow, fromCol, toRow, toCol, pieceData, playerPosition) => {
    if (!pieceData) return { allowed: false, isFirstMoveOnly: false };
    return canCaptureOnMoveToUtil(fromRow, fromCol, toRow, toCol, pieceData, playerPosition);
  };

  // Generate auto-generated rules based on game configuration
  const generateRules = useMemo(() => {
    if (!game) return null;

    const rules = [];
    
    // Basic game info
    rules.push({
      title: "Overview",
      content: `This is a ${game.player_count}-player strategy game played on a ${game.board_width}×${game.board_height} board. Players take turns moving their pieces, with each player able to make ${game.actions_per_turn || 1} action${(game.actions_per_turn || 1) > 1 ? 's' : ''} per turn.${(game.actions_per_turn || 1) > 1 ? `\n\n⚠️ **Multi-Action Turns**: Each player must use all ${game.actions_per_turn} actions per turn.${game.mate_condition ? ' Checkmate is only evaluated at the end of a turn (after all actions are used). You cannot capture a checkmate piece directly — it must be checkmated.' : ''}` : ''}`
    });

    // Analyze pieces by player
    const piecesByPlayer = {};
    const uniquePieces = {};
    const checkmatePieces = [];
    const capturePieces = [];

    Object.values(piecePlacements).forEach(placement => {
      // Skip extension squares for multi-tile pieces (only count anchor squares)
      if (placement._occupied) return;

      const playerId = placement.player_id;
      if (!piecesByPlayer[playerId]) {
        piecesByPlayer[playerId] = [];
      }
      piecesByPlayer[playerId].push(placement);

      // Track unique pieces
      const pieceId = placement.piece_id;
      if (pieceId && !uniquePieces[pieceId]) {
        uniquePieces[pieceId] = pieceDataMap[pieceId] || { piece_name: placement.piece_name };
      }

      // Track pieces that end game
      if (placement.ends_game_on_checkmate) {
        checkmatePieces.push({
          ...placement,
          pieceData: pieceDataMap[pieceId]
        });
      }
      if (placement.ends_game_on_capture) {
        capturePieces.push({
          ...placement,
          pieceData: pieceDataMap[pieceId]
        });
      }
    });

    // Starting pieces
    const startingPiecesContent = [];
    const uniquePieceLinks = new Map(); // Track unique pieces with their IDs
    
    Object.entries(piecesByPlayer).forEach(([playerId, placements]) => {
      const pieceCounts = {};
      placements.forEach(p => {
        const name = p.piece_name || 'Unknown';
        const pieceId = p.piece_id || p.id;
        pieceCounts[name] = (pieceCounts[name] || 0) + 1;
        
        // Store unique piece with ID for links
        if (pieceId && name !== 'Unknown') {
          uniquePieceLinks.set(name, pieceId);
        }
      });
      
      const pieceList = Object.entries(pieceCounts)
        .map(([name, count]) => count > 1 ? `${count} ${name}s` : `1 ${name}`)
        .join(', ');
      
      startingPiecesContent.push(`Player ${playerId}: ${pieceList} (${placements.length} pieces total)`);
    });

    if (startingPiecesContent.length > 0) {
      // Build the content with piece links
      const pieceLinksArray = Array.from(uniquePieceLinks.entries()).map(([name, id]) => ({
        name,
        id
      }));
      
      rules.push({
        title: "Starting Pieces",
        content: startingPiecesContent.join('\n'),
        pieceLinks: pieceLinksArray
      });
    }

    // Piece movements
    const pieceDescriptions = [];
    const moveAttackPieceLinks = [];

    // Gather HP/AD info from placements per piece type
    const hpAdByPiece = {};
    Object.values(piecePlacements).forEach(placement => {
      if (placement._occupied) return;
      const pid = placement.piece_id;
      if (!pid) return;
      if (!hpAdByPiece[pid]) hpAdByPiece[pid] = [];
      hpAdByPiece[pid].push({
        hit_points: placement.hit_points ?? 1,
        attack_damage: placement.attack_damage ?? 1,
        hp_regen: placement.hp_regen ?? 0,
        burn_damage: placement.burn_damage ?? 0,
        burn_duration: placement.burn_duration ?? 0,
        cannot_be_captured: placement.cannot_be_captured || false,
        show_hp_ad: placement.show_hp_ad || false,
      });
    });

    Object.entries(uniquePieces).forEach(([uniqueKey, piece]) => {
      const pieceData = pieceDataMap[piece.id] || pieceDataMap[uniqueKey] || piece;
      const pieceName = pieceData.piece_name || piece.piece_name || 'Unknown Piece';
      const pieceId = uniqueKey;
      
      if (pieceId && pieceName !== 'Unknown Piece') {
        moveAttackPieceLinks.push({ name: pieceName, id: pieceId });
      }
      
      const movementDesc = describePieceMovement(pieceData);
      const captureDesc = describePieceCapture(pieceData);
      const rangedDesc = describePieceRangedAttack(pieceData);
      
      let description = `**${pieceName}**:\n`;
      
      // Movement description
      if (movementDesc) {
        description += `• **Movement**: ${movementDesc}.\n`;
      } else {
        description += `• **Movement**: Not defined.\n`;
      }
      
      // Attack/Capture description (without AD suffix - AD goes in stats line)
      const placements = hpAdByPiece[pieceId] || hpAdByPiece[piece.id] || [];
      
      if (captureDesc === "captures the same way it moves") {
        description += `• **Attack**: Attacks the same way it moves.\n`;
      } else if (captureDesc) {
        description += `• **Attack**: ${captureDesc.charAt(0).toUpperCase() + captureDesc.slice(1)}.\n`;
      } else {
        description += `• **Attack**: Not defined.\n`;
      }

      // Ranged attack description (separate from regular attack)
      if (rangedDesc) {
        description += `• **Ranged Attack**: ${rangedDesc.charAt(0).toUpperCase() + rangedDesc.slice(1)}.\n`;
      }

      // Custom movement squares (one line, compact array of relative offsets)
      const customMoveLine = formatCustomSquaresLine(pieceData.custom_movement_squares);
      if (customMoveLine) {
        description += `• **Custom Movement**: relative [row, col] offsets: ${customMoveLine}.\n`;
      }

      // Custom attack squares (one line, compact array of relative offsets)
      const customAttackLine = formatCustomSquaresLine(pieceData.custom_attack_squares);
      if (customAttackLine) {
        description += `• **Custom Attack**: relative [row, col] offsets: ${customAttackLine}.\n`;
      }

      // Capture on hop
      if (pieceData.capture_on_hop) {
        let hopText = 'Captures enemy pieces by hopping over them (like checkers)';
        if (pieceData.chain_capture_enabled) {
          hopText += '; can chain multiple captures in one turn';
        }
        description += `• **Hop Capture**: ${hopText}.\n`;
      }

      // Ally capture
      if (pieceData.can_capture_allies) {
        description += `• **Ally Capture**: Can capture friendly pieces.\n`;
      }

      // Piece Stats line - show if any stat is non-default or show flags are enabled
      let showGlobalStats = false;
      try { showGlobalStats = JSON.parse(game.other_game_data || '{}').show_all_hp_ad || false; } catch {}
      const showFlags = showGlobalStats || placements.some(p => p.show_hp_ad);
      const hps = [...new Set(placements.map(p => p.hit_points))];
      const ads = [...new Set(placements.map(p => p.attack_damage))];
      const regens = [...new Set(placements.map(p => p.hp_regen))];
      const hasNonDefaultHp = showFlags || hps.some(hp => hp > 1);
      const hasNonDefaultAd = showFlags || ads.some(ad => ad > 1);
      const hasRegen = regens.some(r => r > 0);
      const burnDamages = [...new Set(placements.map(p => p.burn_damage))];
      const burnDurations = [...new Set(placements.map(p => p.burn_duration))];
      const hasBurn = burnDamages.some(d => d > 0) && burnDurations.some(d => d > 0);
      const isInvincible = placements.some(p => p.cannot_be_captured);

      if (hasNonDefaultHp || hasNonDefaultAd || hasRegen || hasBurn || isInvincible) {
        const parts = [];
        if (hasNonDefaultHp) {
          parts.push(hps.length === 1 ? `${hps[0]} HP` : `${hps.join(', ')} HP (varies)`);
        }
        if (hasNonDefaultAd) {
          parts.push(ads.length === 1 ? `${ads[0]} AD` : `${ads.join(', ')} AD (varies)`);
        }
        if (hasRegen) {
          const nonZeroRegens = regens.filter(r => r > 0);
          if (nonZeroRegens.length === 1) {
            parts.push(`+${nonZeroRegens[0]} Regen/turn`);
          } else {
            parts.push(`+${nonZeroRegens.join(', +')} Regen/turn (varies)`);
          }
        }
        if (hasBurn) {
          const nonZeroBurnDmg = burnDamages.filter(d => d > 0);
          const nonZeroBurnDur = burnDurations.filter(d => d > 0);
          const dmgText = nonZeroBurnDmg.length === 1 ? `${nonZeroBurnDmg[0]}` : `${nonZeroBurnDmg.join(', ')}`;
          const durText = nonZeroBurnDur.length === 1 ? `${nonZeroBurnDur[0]}` : `${nonZeroBurnDur.join(', ')}`;
          const variesText = (nonZeroBurnDmg.length > 1 || nonZeroBurnDur.length > 1) ? ' (varies)' : '';
          parts.push(`🔥 ${dmgText} dmg for ${durText} turn${nonZeroBurnDur.some(d => d > 1) ? 's' : ''} on attack${variesText}`);
        }
        if (isInvincible) {
          parts.push('Immune to capture');
        }
        description += `• **Piece Stats**: ${parts.join(' · ')}.\n`;
      }
      
      pieceDescriptions.push(description);
    });

    if (pieceDescriptions.length > 0) {
      rules.push({
        title: "Piece Settings",
        content: pieceDescriptions.join('\n\n'),
        pieceLinks: moveAttackPieceLinks
      });
    }

    // ---- Special Rules Section (combines multi-tile, castling, en passant, capture on hop) ----
    const specialRulesContent = [];
    // Aggregated piece-name → id map for piece links rendered inside the Special Rules section.
    // Sub-sections (e.g. promotion target overrides) push entries here so names render as links
    // to the piece detail page instead of plain bold text or raw IDs.
    const specialRulesPieceLinkMap = new Map();

    // Multi-tile piece explanations
    const multiTilePieces = Object.values(uniquePieces).filter(piece => {
      const pieceData = pieceDataMap[piece.id] || piece;
      return (pieceData.piece_width || 1) > 1 || (pieceData.piece_height || 1) > 1;
    });

    if (multiTilePieces.length > 0) {
      const multiTileDescs = multiTilePieces.map(piece => {
        const pieceData = pieceDataMap[piece.id] || piece;
        const pieceName = pieceData.piece_name || piece.piece_name || 'Unknown Piece';
        const pw = pieceData.piece_width || 1;
        const ph = pieceData.piece_height || 1;
        return `• **${pieceName}** (${pw}×${ph}): Occupies ${pw * ph} squares on the board. Movement and attack ranges are calculated from every square the piece occupies.`;
      }).join('\n');

      specialRulesContent.push(`**Multi-Tile Pieces**\nSome pieces in this game are larger than a single square. Multi-tile pieces have special properties:\n\n${multiTileDescs}\n\n**Multi-tile piece rules:**\n• A multi-tile piece can move or attack from **any square it occupies** — the entire piece acts as one unit.\n• When attacking, a multi-tile piece can **capture multiple enemies at once** if they are all within its strike zone.\n• A multi-tile piece is captured if **any** of its occupied squares is targeted.\n• Multi-tile pieces cannot hop over other pieces.`);
    }

    // Castling information with partner identification
    const castlingPieces = Object.values(uniquePieces).filter(piece => {
      const pieceData = pieceDataMap[piece.id] || piece;
      return pieceData.can_castle;
    });

    if (castlingPieces.length > 0) {
      // Determine castling partners from initial board positions
      // Group placements by player and row to find castling partners
      const placementsByPlayerAndRow = {};
      Object.entries(piecePlacements).forEach(([key, placement]) => {
        if (placement._occupied) return;
        const [row, col] = key.split(',').map(Number);
        const playerId = placement.player_id;
        const rowKey = `${playerId}-${row}`;
        if (!placementsByPlayerAndRow[rowKey]) {
          placementsByPlayerAndRow[rowKey] = [];
        }
        placementsByPlayerAndRow[rowKey].push({ ...placement, row, col });
      });

      // For each castling piece, find partner pieces on the same row
      // Castling partners are typically the pieces at the ends of the row relative to the castling piece
      const castlingPartnerMap = {}; // pieceId -> Set of partner piece names
      
      Object.values(placementsByPlayerAndRow).forEach(rowPlacements => {
        // Sort by column
        rowPlacements.sort((a, b) => a.col - b.col);
        
        // Find castling pieces in this row
        const castlingInRow = rowPlacements.filter(p => {
          const pd = pieceDataMap[p.piece_id];
          return pd && pd.can_castle;
        });
        
        if (castlingInRow.length === 0) return;
        
        // Non-castling pieces in this row are potential partners
        // In chess-like games, the edge pieces (like rooks) are castling partners with the central castling piece (like king)
        // We identify partners as pieces that are NOT the same piece type as the castling piece and share the row
        castlingInRow.forEach(castlingPiece => {
          const partnersOnRow = rowPlacements.filter(p => {
            return p.piece_id !== castlingPiece.piece_id && p.player_id === castlingPiece.player_id;
          });
          
          if (partnersOnRow.length > 0) {
            // Find the nearest pieces to the left and right of the castling piece
            const leftPartners = partnersOnRow.filter(p => p.col < castlingPiece.col).sort((a, b) => b.col - a.col);
            const rightPartners = partnersOnRow.filter(p => p.col > castlingPiece.col).sort((a, b) => a.col - b.col);
            
            // The outermost pieces on each side are the most likely castling partners (like rooks for a king)
            const leftOutermost = leftPartners.length > 0 ? leftPartners[leftPartners.length - 1] : null;
            const rightOutermost = rightPartners.length > 0 ? rightPartners[rightPartners.length - 1] : null;
            
            if (!castlingPartnerMap[castlingPiece.piece_id]) {
              castlingPartnerMap[castlingPiece.piece_id] = new Set();
            }
            if (leftOutermost) castlingPartnerMap[castlingPiece.piece_id].add(leftOutermost.piece_name || 'Unknown');
            if (rightOutermost) castlingPartnerMap[castlingPiece.piece_id].add(rightOutermost.piece_name || 'Unknown');
          }
        });
      });

      const castlingDesc = castlingPieces.map(piece => {
        const pieceData = pieceDataMap[piece.piece_id] || piece;
        const pieceName = pieceData.piece_name || piece.piece_name || 'Unknown Piece';
        const partners = castlingPartnerMap[piece.piece_id];
        // Find castling distance from placements for this piece
        const placementsForPiece = Object.values(piecePlacements).filter(p => p.piece_id === piece.piece_id && !p._occupied);
        const dist = placementsForPiece.length > 0 ? (placementsForPiece[0].castling_distance ?? 2) : 2;
        const distStr = dist !== 2 ? ` (moves ${dist} square${dist !== 1 ? 's' : ''})` : '';
        if (partners && partners.size > 0) {
          return `• **${pieceName}**${distStr} can castle with: ${[...partners].map(p => `**${p}**`).join(', ')}`;
        }
        return `• **${pieceName}**${distStr} can castle with partner pieces`;
      }).join('\n');

      // Determine the castling distance description
      const allDistances = castlingPieces.map(piece => {
        const placementsForPiece = Object.values(piecePlacements).filter(p => p.piece_id === piece.piece_id && !p._occupied);
        return placementsForPiece.length > 0 ? (placementsForPiece[0].castling_distance ?? 2) : 2;
      });
      const uniqueDistances = [...new Set(allDistances)];
      const distanceText = uniqueDistances.length === 1
        ? `${uniqueDistances[0]} square${uniqueDistances[0] !== 1 ? 's' : ''}`
        : 'a configured number of squares';

      specialRulesContent.push(`**Castling**\nCastling is a special move where a piece moves toward a partner piece, and the partner moves to the other side.\n\n${castlingDesc}\n\n**Castling Rules:**\n• Neither piece may have moved yet\n• The path must be clear (except for close-range castling)\n• The castling piece moves ${distanceText} toward its partner\n• The partner piece moves to the other side of the castling piece\n\n*Tip: Enable "Show castling info" during a game to see which pieces can castle with each other.*`);
    }

    // En passant information
    const enPassantPieces = Object.values(uniquePieces).filter(piece => {
      const pieceData = pieceDataMap[piece.id] || piece;
      return pieceData.can_en_passant;
    });

    if (enPassantPieces.length > 0) {
      const enPassantDesc = enPassantPieces.map(piece => {
        const pieceData = pieceDataMap[piece.id] || piece;
        const pieceName = pieceData.piece_name || piece.piece_name || 'Unknown Piece';
        return `• **${pieceName}** can capture via en passant`;
      }).join('\n');

      specialRulesContent.push(`**En Passant**\nEn passant is a special capture where a piece captures an enemy piece of the same type that has just moved using a first-move-only ability.\n\n${enPassantDesc}\n\n**En Passant Rules:**\n• Enemy must have just used a first-move-only movement in the previous turn\n• The enemy must be the same piece type as the capturing piece (e.g., Pawn can only en passant another Pawn)\n• The capturing piece must be horizontally adjacent to the enemy\n• The capturing piece moves to the square the enemy "passed through"\n• The enemy piece is removed even though it's not on the destination square\n• En passant must be done immediately - it's not available on subsequent turns`);
    }

    // Capture on Hop rules (checkers-style)
    const hopCapturePieces = Object.values(uniquePieces).filter(piece => {
      const pieceData = pieceDataMap[piece.id] || piece;
      return pieceData.capture_on_hop;
    });

    if (hopCapturePieces.length > 0) {
      const hopDesc = hopCapturePieces.map(piece => {
        const pieceData = pieceDataMap[piece.id] || piece;
        const pieceName = pieceData.piece_name || piece.piece_name || 'Unknown Piece';
        const hasChain = pieceData.chain_capture_enabled;
        return `• **${pieceName}** captures by hopping over enemies${hasChain ? ' (can chain multiple jumps)' : ''}`;
      }).join('\n');

      specialRulesContent.push(`**Capture on Hop**\nSome pieces capture by hopping over enemy pieces, like in checkers. When a piece jumps over an enemy, the enemy is captured and removed from the board.\n\n${hopDesc}\n\n**Capture on Hop Rules:**\n• The piece must jump over an adjacent enemy to an empty square beyond\n• The hopped-over enemy piece is captured and removed\n${hopCapturePieces.some(p => (pieceDataMap[p.id] || p).chain_capture_enabled) ? '• **Chain Capture**: After capturing, the piece can continue jumping to capture more enemies in the same turn\n• Chain captures are optional — you can stop after any jump\n' : ''}`);
    }

    // Trample ability
    const tramplePieces = Object.values(uniquePieces).filter(piece => {
      const pieceData = pieceDataMap[piece.id] || piece;
      return pieceData.trample;
    });

    if (tramplePieces.length > 0) {
      const trampleDesc = tramplePieces.map(piece => {
        const pieceData = pieceDataMap[piece.id] || piece;
        const pieceName = pieceData.piece_name || piece.piece_name || 'Unknown Piece';
        const radius = pieceData.trample_radius || 0;
        const hasGhostwalk = pieceData.ghostwalk;
        return `• **${pieceName}** tramples pieces in its path${radius > 0 ? ` (radius ${radius})` : ''}${hasGhostwalk ? ' + Ghostwalk' : ''}`;
      }).join('\n');

      specialRulesContent.push(`**Trample**\nSome pieces damage every piece in their straight-line path as they move.\n\n${trampleDesc}\n\n**Trample Rules:**\n• The piece damages all pieces along its movement path\n• Works with directional and exact movement (not L-shaped/ratio movement)\n• Trample can cause check — a piece with trample and hop abilities threatens squares along its path\n• The piece must still make a valid move — it can be blocked unless it has Ghostwalk or hop abilities\n${tramplePieces.some(p => (pieceDataMap[p.id] || p).trample_radius > 0) ? '• **Trample Radius**: Pieces with a radius also damage pieces on surrounding squares at each step along the path\n• Checkmateable pieces (e.g. kings) are immune to trample radius splash damage — they can only be harmed by direct path trample\n• Each piece can only be damaged once per trample, even if caught in multiple steps\n' : ''}`);
    }

    // Ghostwalk ability
    const ghostwalkPieces = Object.values(uniquePieces).filter(piece => {
      const pieceData = pieceDataMap[piece.id] || piece;
      return pieceData.ghostwalk;
    });

    if (ghostwalkPieces.length > 0) {
      const ghostDesc = ghostwalkPieces.map(piece => {
        const pieceData = pieceDataMap[piece.id] || piece;
        const pieceName = pieceData.piece_name || piece.piece_name || 'Unknown Piece';
        const hasTrample = pieceData.trample;
        return `• **${pieceName}** can pass through any piece${hasTrample ? ' (with Trample — damages pieces along the way)' : ''}`;
      }).join('\n');

      specialRulesContent.push(`**Ghostwalk**\nSome pieces can pass through any other piece during movement.\n\n${ghostDesc}\n\n**Ghostwalk Rules:**\n• The piece ignores all pieces in its path — nothing can block it\n• The piece can still capture normally at its destination\n• Combined with Trample, the piece damages every piece it passes through`);
    }

    // Die on Capture ability
    const dieOnCapturePieces = Object.values(uniquePieces).filter(piece => {
      const pieceData = pieceDataMap[piece.id] || piece;
      return pieceData.die_on_capture;
    });

    if (dieOnCapturePieces.length > 0) {
      const dieDesc = dieOnCapturePieces.map(piece => {
        const pieceData = pieceDataMap[piece.id] || piece;
        const pieceName = pieceData.piece_name || piece.piece_name || 'Unknown Piece';
        return `• **${pieceName}**`;
      }).join('\n');

      specialRulesContent.push(`**Die on Capture**\nSome pieces are destroyed when they capture another piece.\n\n${dieDesc}\n\n**Die on Capture Rules:**\n• When this piece captures an enemy, it is also removed from the board\n• Both the captured piece and the capturing piece are eliminated`);
    }

    // Attack Radius ability
    const attackRadiusPieces = Object.values(uniquePieces).filter(piece => {
      const pieceData = pieceDataMap[piece.id] || piece;
      return (pieceData.attack_radius || 0) > 0;
    });

    if (attackRadiusPieces.length > 0) {
      const atkDesc = attackRadiusPieces.map(piece => {
        const pieceData = pieceDataMap[piece.id] || piece;
        const pieceName = pieceData.piece_name || piece.piece_name || 'Unknown Piece';
        const radius = pieceData.attack_radius || 0;
        return `• **${pieceName}** — radius ${radius}`;
      }).join('\n');

      specialRulesContent.push(`**Attack Radius**\nSome pieces deal area-of-effect damage around their landing square when they capture.\n\n${atkDesc}\n\n**Attack Radius Rules:**\n• When capturing, the piece also damages all enemy pieces within the radius of the landing square\n• Only triggers on capture — regular movement does not cause splash damage\n• Checkmate-immune pieces (e.g. kings) are immune to attack radius splash damage\n• Each piece can only be damaged once per attack\n• Unlike Trample Radius, does not require Trample and does not damage pieces along the movement path`);
    }

    // Promotion squares information
    if (Object.keys(specialSquares.promotion).length > 0) {
      // Find pieces that can promote
      const promotablePieces = Object.values(uniquePieces).filter(piece => {
        const pieceData = pieceDataMap[piece.id] || piece;
        return pieceData.can_promote;
      });

      // List promotion square locations
      const promoSquareDescs = Object.keys(specialSquares.promotion).map(key => {
        const [row, col] = key.split(',').map(Number);
        return `${String.fromCharCode(97 + col)}${row + 1}`;
      });

      let promoContent = `**Promotion**\nCertain squares on the board are promotion squares. When a promotable piece lands on a promotion square, it can transform into a different, more powerful piece.\n\n**Promotion Squares:** ${promoSquareDescs.join(', ')}`;

      // Track promotion-target piece names so they can be linked in the Special Rules section
      const promotionTargetLinks = new Map(); // name -> id

      if (promotablePieces.length > 0) {
        // Build per-placement rule descriptions (placements of the same piece type may
        // have different per-placement promotion overrides). Dedupe identical rule sets.
        const seen = new Set();
        const ruleLines = [];
        Object.values(piecePlacements).forEach(placement => {
          if (placement._occupied) return;
          const pid = placement.piece_id;
          if (!pid) return;
          const pd = pieceDataMap[pid] || placement;
          if (!pd.can_promote) return;
          const pieceName = pd.piece_name || placement.piece_name || 'Unknown Piece';

          // Parse override
          let overrideIds = null;
          if (placement.promotion_pieces_override) {
            try {
              const parsed = typeof placement.promotion_pieces_override === 'string'
                ? JSON.parse(placement.promotion_pieces_override)
                : placement.promotion_pieces_override;
              if (Array.isArray(parsed) && parsed.length > 0) overrideIds = parsed.map(Number);
            } catch (e) { /* ignore */ }
          }

          let promotesTo;
          if (overrideIds) {
            promotesTo = overrideIds.map(pid2 => {
              const pd2 = pieceDataMap[pid2];
              const name = pd2?.piece_name || `Piece #${pid2}`;
              if (pd2?.piece_name) promotionTargetLinks.set(pd2.piece_name, pid2);
              return `**${name}**`;
            }).join(', ');
          } else {
            promotesTo = 'any starting piece on this player\'s side, except other promotable pieces, checkmate pieces, and lose-on-capture pieces';
          }

          const extras = [];
          if (placement.can_promote_to_checkmate) {
            const limitNote = placement.limit_promote_checkmate_to_original
              ? ' (only while the player owns fewer checkmate pieces than they started with — once they reach the original count, the option is hidden)'
              : '';
            extras.push(`also allowed to promote into checkmate (game-ending) pieces${limitNote}`);
          }
          if (placement.can_promote_to_capture) {
            const limitNote = placement.limit_promote_capture_to_original
              ? ' (only while the player owns fewer lose-on-capture pieces than they started with — once they reach the original count, the option is hidden)'
              : '';
            extras.push(`also allowed to promote into lose-on-capture pieces${limitNote}`);
          }
          const extraStr = extras.length > 0 ? `\n   _${extras.join('; ')}._` : '';

          const line = `• **${pieceName}** can promote to: ${promotesTo}${extraStr}`;
          if (!seen.has(line)) {
            seen.add(line);
            ruleLines.push(line);
          }
        });
        if (ruleLines.length > 0) {
          promoContent += `\n\n${ruleLines.join('\n')}`;
        }
      }

      promoContent += `\n\n**Promotion Rules:**\n• Move a promotable piece onto a promotion square\n• Choose which piece to transform into\n• The promoted piece keeps the same position and player ownership\n• When a "limit to original count" rule applies, the relevant piece is hidden from the promotion modal once the player already owns the original starting count`;

      // Register promotion-target piece names so they render as links in Special Rules.
      promotionTargetLinks.forEach((id, name) => specialRulesPieceLinkMap.set(name, id));
      // Also register the promotable source pieces themselves
      promotablePieces.forEach(piece => {
        const pd = pieceDataMap[piece.id] || piece;
        const name = pd?.piece_name;
        const id = pd?.piece_id || piece.id;
        if (name && id) specialRulesPieceLinkMap.set(name, id);
      });

      specialRulesContent.push(promoContent);
    }

    // Range squares description (plain ranged squares with their per-square bonus)
    if (Object.keys(specialSquares.range).length > 0) {
      const entries = Object.entries(specialSquares.range);
      const lines = entries.map(([key, cfg]) => {
        const [row, col] = key.split(',').map(Number);
        const bonus = Math.min(8, Math.max(1, Number(cfg?.rangeBonus) || 1));
        return `• ${String.fromCharCode(97 + col)}${row + 1} — Range Bonus +${bonus}`;
      });
      specialRulesContent.push(
        `**Range Squares**\nA piece standing on a Range Square has its movement, capture, and attack range increased by the listed bonus while it is on that square.\n\n${lines.join('\n')}`
      );
    }

    // Control squares description (per-square turns / piece / player config)
    if (Object.keys(specialSquares.control).length > 0) {
      const entries = Object.entries(specialSquares.control);
      const playerLabel = (p) => p === 'p1' ? 'Player 1 only' : p === 'p2' ? 'Player 2 only' : 'either player';
      const lines = entries.map(([key, cfg]) => {
        const [row, col] = key.split(',').map(Number);
        const turns = cfg?.turnsRequired || 1;
        const consec = cfg?.consecutiveTurns ? 'consecutive ' : '';
        const piece = cfg?.requireSpecificPiece
          ? 'only pieces marked **Can Control Squares**'
          : 'any piece';
        return `• ${String.fromCharCode(97 + col)}${row + 1} — must be held for ${turns} ${consec}turn${turns > 1 ? 's' : ''} by ${piece} (${playerLabel(cfg?.appliesToPlayer)})`;
      });
      specialRulesContent.push(
        `**Control Squares**\nWhen the Control Squares win condition is enabled, players must hold these squares according to their per-square rules.\n\n${lines.join('\n')}`
      );
    }

    // Custom squares description — they can act as combinations of the other special square types
    if (Object.keys(specialSquares.special).length > 0) {
      const customEntries = Object.entries(specialSquares.special);
      const labelFor = (cfg) => {
        const parts = [];
        if (cfg?.asRange) parts.push(`Range Boost (+${cfg.rangeBonus || 1})`);
        if (cfg?.asPromotion) parts.push('Promotion');
        if (cfg?.asControl) parts.push('Control');
        if (cfg?.restrictFirstMoveToCustom) parts.push('First-move abilities allowed only on these squares');
        if (cfg?.disableFirstMoveHere) parts.push('First-move abilities disabled while standing here');
        return parts.length > 0 ? parts.join(' + ') : 'no combined behavior yet (visual placeholder)';
      };
      const coordFor = (key) => {
        const [row, col] = key.split(',').map(Number);
        return `${String.fromCharCode(97 + col)}${row + 1}`;
      };
      // Group squares with identical configurations together so we render one line per config
      // (instead of repeating the same description for every square individually).
      const groups = new Map();
      for (const [key, cfg] of customEntries) {
        // Normalize cfg into a stable signature key — only include fields that affect behavior.
        const sig = JSON.stringify({
          asRange: !!cfg?.asRange,
          rangeBonus: cfg?.asRange ? (cfg?.rangeBonus || 1) : 0,
          asPromotion: !!cfg?.asPromotion,
          asControl: !!cfg?.asControl,
          restrictFirstMoveToCustom: !!cfg?.restrictFirstMoveToCustom,
          disableFirstMoveHere: !!cfg?.disableFirstMoveHere,
        });
        if (!groups.has(sig)) groups.set(sig, { cfg, coords: [] });
        groups.get(sig).coords.push(coordFor(key));
      }
      const lines = Array.from(groups.values()).map(({ cfg, coords }) => {
        // Sort coords by file (letter) then rank for stable, readable output
        coords.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const coordList = coords.length === 1 ? coords[0] : `[${coords.join(', ')}]`;
        return `• ${coordList} — ${labelFor(cfg)}`;
      });
      specialRulesContent.push(
        `**Custom Squares**\nCustom squares can combine any of the other special-square behaviors (Range Boost, Promotion, Control) on a single square, and can also gate piece **first-move abilities** — either restricting "first move only" / "available for first N moves" abilities so they only work while standing on these squares, or disabling them while a piece is standing here. Squares with the same configuration are grouped together below.\n\n${lines.join('\n')}\n\nSquares listed with no combined behavior are visual placeholders only.`
      );
    }

    // ---- Win Conditions Section ----
    const winConditions = [];

    if (game.mate_condition) {
      // Determine checkmate target piece name: prefer game-level mate_piece, then fall back to pieces marked ends_game_on_checkmate
      let matePieceName = 'the designated piece';
      const matePieceData = game.mate_piece ? pieceDataMap[game.mate_piece] : null;
      if (matePieceData) {
        matePieceName = `**${matePieceData.piece_name}**`;
      } else if (checkmatePieces.length > 0) {
        const uniqueNames = [...new Set(checkmatePieces.map(p => p.pieceData?.piece_name || p.piece_name).filter(Boolean))];
        matePieceName = uniqueNames.map(n => `**${n}**`).join(' or ');
      }
      winConditions.push(`• **Checkmate**: A player wins by checkmating their opponent's ${matePieceName}. When ${matePieceName} is in check and cannot escape, the game is over.${(game.actions_per_turn || 1) > 1 ? ` In multi-action games, checkmate is evaluated at the end of a turn after all ${game.actions_per_turn} actions are completed. You cannot capture ${matePieceName} directly — it must be checkmated${game.capture_condition ? ' (unless the capture win condition is also enabled)' : ''}.` : ''}${game.mate_condition_requires_all ? `\n   ◦ **Requires ALL**: Every checkmate-flagged piece on a player's side must be simultaneously under lethal attack with no legal escape, AND capturing one such piece does not end the game until none remain. (Promoting to a checkmate-flagged piece adds another piece that must also be checkmated.)` : ''}`);
    }

    if (game.capture_condition) {
      const capPieceData = game.capture_piece ? pieceDataMap[game.capture_piece] : null;
      // Check per-placement capture pieces if no game-level capture_piece
      const placementCapturePieces = capturePieces.length > 0
        ? [...new Set(capturePieces.map(p => p.pieceData?.piece_name || p.piece_name).filter(Boolean))]
        : [];
      if (capPieceData) {
        winConditions.push(`• **Capture**: A player wins by capturing their opponent's **${capPieceData.piece_name}**.${game.capture_condition_requires_all ? `\n   ◦ **Requires ALL**: Every capture-flagged piece on a player's side must be captured before they lose. (Promoting to a capture-flagged piece adds another piece that must also be captured.)` : ''}`);
      } else if (placementCapturePieces.length > 0) {
        const capNames = placementCapturePieces.map(n => `**${n}**`).join(' or ');
        winConditions.push(`• **Capture**: A player wins by capturing their opponent's ${capNames}.${game.capture_condition_requires_all ? `\n   ◦ **Requires ALL**: Every capture-flagged piece on a player's side must be captured before they lose. (Promoting to a capture-flagged piece adds another piece that must also be captured.)` : ''}`);
      } else {
        winConditions.push(`• **Capture**: A player wins by capturing all of their opponent's pieces.`);
      }
    }

    if (game.value_condition) {
      const valPieceData = game.value_piece ? pieceDataMap[game.value_piece] : null;
      const valPieceName = valPieceData ? `**${valPieceData.piece_name}**` : 'the scoring piece';
      const valTitle = game.value_title || 'points';
      winConditions.push(`• **${valTitle}**: Capture ${game.value_max || '?'} ${valPieceName} pieces to win.`);
    }

    if (game.squares_condition) {
      if (game.squares_count) {
        winConditions.push(`• **Territory (Count)**: Control more special squares than your opponent to win.`);
      } else {
        winConditions.push(`• **Territory**: Control all designated special squares to win.`);
      }
    }

    if (game.hill_condition) {
      const hillTurns = game.hill_turns || 1;
      winConditions.push(`• **King of the Hill**: Move a piece to the hill square and hold it for ${hillTurns} turn${hillTurns > 1 ? 's' : ''} to win.`);
    }

    if (game.no_moves_condition) {
      winConditions.push(`• **No Legal Moves**: A player with no legal moves on their turn loses the game (checkers-style).`);
    }

    if (game.piece_count_condition) {
      winConditions.push(`• **Piece Count**: When no more valid moves remain or the board is full, the player with the most pieces wins (Othello-style).`);
    }

    if (game.promotion_condition) {
      winConditions.push(`• **Win on Promotion**: A player instantly wins by moving a promotable piece onto a promotion square.`);
    }

    if (game.lose_all_pieces_condition) {
      winConditions.push(`• **Lose All Pieces (Anti-Chess)**: A player WINS as soon as they have lost all of their pieces. Combine with Forced Capture for classic anti-chess.`);
    }

    if (game.stalemate_win_condition) {
      winConditions.push(`• **Stalemate Win**: A stalemated player (no legal moves and not in check) WINS instead of the game being a draw.`);
    }

    if (game.forced_capture_condition) {
      winConditions.push(`• **Forced Capture**: If any of your pieces can make a capturing move, you MUST make a capture this turn (any capture). Non-capturing moves will be rejected when captures are available.`);
    }

    if (winConditions.length > 0) {
      // Build piece links for win condition pieces
      const winPieceLinks = [];
      if (game.mate_piece && pieceDataMap[game.mate_piece]) {
        winPieceLinks.push({ name: pieceDataMap[game.mate_piece].piece_name, id: game.mate_piece });
      } else if (game.mate_condition && checkmatePieces.length > 0) {
        const seen = new Set();
        checkmatePieces.forEach(p => {
          const pieceId = p.piece_id;
          const name = p.pieceData?.piece_name || p.piece_name;
          if (pieceId && name && !seen.has(pieceId)) {
            seen.add(pieceId);
            winPieceLinks.push({ name, id: pieceId });
          }
        });
      }
      if (game.capture_piece && pieceDataMap[game.capture_piece]) {
        winPieceLinks.push({ name: pieceDataMap[game.capture_piece].piece_name, id: game.capture_piece });
      }
      if (game.value_piece && pieceDataMap[game.value_piece]) {
        winPieceLinks.push({ name: pieceDataMap[game.value_piece].piece_name, id: game.value_piece });
      }
      rules.push({
        title: "Win Conditions",
        content: winConditions.join('\n'),
        pieceLinks: winPieceLinks.length > 0 ? winPieceLinks : undefined
      });
    } else {
      rules.push({
        title: "Win Conditions",
        content: "• **Capture (default)**: Capture all of your opponent's pieces to win."
      });
    }

    // ---- Draw Conditions Section ----
    const drawConditions = [];

    if (game.draw_move_limit) {
      drawConditions.push(`• **Move Limit Draw**: If ${game.draw_move_limit} moves are made without any captures, the game is declared a draw.`);
    }

    if (game.repetition_draw_count) {
      drawConditions.push(`• **Repetition Draw**: If the same board position occurs ${game.repetition_draw_count} times, the game is declared a draw.`);
    }

    // Parse other_game_data for extra draw conditions
    let otherData = {};
    try { otherData = JSON.parse(game.other_game_data || '{}') || {}; } catch {}

    if (otherData.equal_piece_count_draw) {
      drawConditions.push(`• **Equal Piece Count Draw**: If both players have the same number of pieces when the game ends by piece count, it is a draw.`);
    }

    if (game.mate_condition) {
      drawConditions.push(`• **Stalemate**: If a player is not in check but has no legal moves on their turn, the game is declared a draw.`);
    }

    // Insufficient material draw: only when both sides have at least one checkmatable piece
    const checkmatePlayerIds = new Set(checkmatePieces.map(p => p.player_id));
    if (checkmatePlayerIds.size >= 2) {
      drawConditions.push(`• **Insufficient Material**: If only the two checkmatable pieces remain on the board (one per player) with no other pieces, the game is immediately declared a draw.`);
    }

    if (drawConditions.length > 0) {
      rules.push({
        title: "Draw Conditions",
        content: drawConditions.join('\n')
      });
    }

    // ---- Gameplay Mechanics Section (Flanking, Piece Placement) ----
    const mechanicsContent = [];

    if (otherData.place_pieces_action) {
      let placeDesc = `**Piece Placement**\nPlayers can place new pieces onto the board during their turn instead of moving an existing piece.`;
      if (otherData.placeable_pieces && otherData.placeable_pieces.length > 0) {
        const pieceNames = otherData.placeable_pieces.map(p => `**${p.piece_name || p.name || 'Unknown'}**`).join(', ');
        placeDesc += `\n\n**Placeable piece types:** ${pieceNames}`;
      }
      mechanicsContent.push(placeDesc);
    }

    if (otherData.flanking_captures) {
      let flankDesc = `**Flanking Captures**\nWhen a piece is placed, any opponent pieces that are flanked (enclosed in a straight line between two of the placing player's pieces) are captured and converted to the placing player's side.`;
      if (otherData.must_flank) {
        flankDesc += `\n• **Must Flank**: Pieces can only be placed in positions where they will flank at least one opponent piece.`;
      }
      if (otherData.skip_turn_no_flank) {
        flankDesc += `\n• **Skip Turn**: If a player has no valid flanking placement, their turn is skipped. If both players cannot place, the game ends.`;
      }
      mechanicsContent.push(flankDesc);
    }

    if (mechanicsContent.length > 0) {
      // Build piece links for placeable pieces
      const mechPieceLinks = [];
      if (otherData.placeable_pieces) {
        otherData.placeable_pieces.forEach(p => {
          const pName = p.piece_name || p.name;
          if (p.piece_id && pName) {
            mechPieceLinks.push({ name: pName, id: p.piece_id });
          }
        });
      }
      rules.push({
        title: "Gameplay Mechanics",
        content: mechanicsContent.join('\n\n---\n\n'),
        pieceLinks: mechPieceLinks.length > 0 ? mechPieceLinks : undefined
      });
    }

    // General gameplay rules
    rules.push({
      title: "General Rules",
      content: `• Players take turns in order, starting with Player 1.
• On your turn, you must make ${game.actions_per_turn || 1} move${(game.actions_per_turn || 1) > 1 ? 's' : ''}.
• You can only move your own pieces.
• Pieces capture enemy pieces by moving to their square (unless the piece has different capture rules).
• A piece cannot move through other pieces unless it has jumping ability.
• The game continues until a win condition is met or players agree to a draw.${(game.actions_per_turn || 1) > 1 && game.mate_condition ? `\n• **Important**: In this multi-action game, checkmate is evaluated after all ${game.actions_per_turn} actions are completed. You cannot capture a checkmate piece — it must be checkmated.` : ''}`
    });

    // Add the combined Special Rules section if any content exists
    if (specialRulesContent.length > 0) {
      const specialRulesPieceLinks = Array.from(specialRulesPieceLinkMap.entries()).map(([name, id]) => ({ name, id }));
      rules.push({
        title: "Special Rules",
        content: specialRulesContent.join('\n\n---\n\n'),
        pieceLinks: specialRulesPieceLinks.length > 0 ? specialRulesPieceLinks : undefined
      });
    }

    return rules;
  }, [game, piecePlacements, pieceDataMap, specialSquares]);

  // Compute square size responsively based on container width, capped so board stays within 850px
  const squareSize = useMemo(() => {
    if (!game || boardContainerWidth === 0) return 0;
    const availableWidth = Math.min(Math.max(boardContainerWidth, 100), 850);
    return Math.floor(availableWidth / game.board_width);
  }, [game, boardContainerWidth]);

  const renderBoard = () => {
    if (!game || squareSize === 0) return null;

    const board = [];

    // Pre-compute attack radius splash squares for the hovered piece
    const attackRadiusSplashSquares = new Set();
    if (hoveredPiecePosition) {
      const pieceData = pieceDataMap[hoveredPiecePosition.pieceId];
      if (pieceData && (pieceData.attack_radius || 0) > 0) {
        const radius = pieceData.attack_radius;
        const hpw = pieceData.piece_width || 1;
        const hph = pieceData.piece_height || 1;
        // Find all capture target squares
        for (let r = 0; r < game.board_height; r++) {
          for (let c = 0; c < game.board_width; c++) {
            const isWithinFootprint = r >= hoveredPiecePosition.row && r < hoveredPiecePosition.row + hph &&
              c >= hoveredPiecePosition.col && c < hoveredPiecePosition.col + hpw;
            if (isWithinFootprint) continue;
            let canCapture = false;
            for (let dr = 0; dr < hph && !canCapture; dr++) {
              for (let dc = 0; dc < hpw && !canCapture; dc++) {
                const info = getCaptureInfo(hoveredPiecePosition.row + dr, hoveredPiecePosition.col + dc, r, c, pieceData, hoveredPiecePosition.playerId);
                if (info.allowed) canCapture = true;
              }
            }
            if (!canCapture) {
              for (let dr = 0; dr < hph && !canCapture; dr++) {
                for (let dc = 0; dc < hpw && !canCapture; dc++) {
                  canCapture = canRangedAttackTo(hoveredPiecePosition.row + dr, hoveredPiecePosition.col + dc, r, c, pieceData, hoveredPiecePosition.playerId);
                }
              }
            }
            if (canCapture) {
              // Add all squares within attack radius of this capture target
              for (let sr = r - radius; sr <= r + radius; sr++) {
                for (let sc = c - radius; sc <= c + radius; sc++) {
                  if (sr >= 0 && sr < game.board_height && sc >= 0 && sc < game.board_width) {
                    if (sr !== r || sc !== c) {
                      attackRadiusSplashSquares.add(`${sr},${sc}`);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    for (let row = 0; row < game.board_height; row++) {
      for (let col = 0; col < game.board_width; col++) {
        const isLight = (row + col) % 2 === 0;
        const key = `${row},${col}`;
        const placement = piecePlacements[key];
        const squareType = getSquareType(key);
        const borderColor = getSquareColor(squareType);

        // Check if this square is valid for the hovered piece
        let moveInfo = { allowed: false, isFirstMoveOnly: false };
        let captureInfo = { allowed: false, isFirstMoveOnly: false };
        let canRanged = false;
        let canHopCapture = false;
        
        if (hoveredPiecePosition) {
          const pieceData = pieceDataMap[hoveredPiecePosition.pieceId];
          if (pieceData) {
            const hpw = pieceData.piece_width || 1;
            const hph = pieceData.piece_height || 1;

            // Skip highlighting for squares within the hovered piece's own footprint
            const isWithinPieceFootprint = row >= hoveredPiecePosition.row && row < hoveredPiecePosition.row + hph &&
              col >= hoveredPiecePosition.col && col < hoveredPiecePosition.col + hpw;

            if (!isWithinPieceFootprint) {
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
        }

        let squareStyle = {
          background: isLight ? lightSquareColor : darkSquareColor,
          width: `${squareSize}px`,
          height: `${squareSize}px`,
          position: 'relative',
          border: squareType && showDetails ? `4px solid ${borderColor}` : 'none',
          boxSizing: 'border-box'
        };

        // Get highlight style — hop capture green is additive (separate overlay)
        const { style: highlightStyle, icon: highlightIcon } = getSquareHighlightStyle(
          moveInfo.allowed,
          moveInfo.isFirstMoveOnly,
          captureInfo.allowed,
          captureInfo.isFirstMoveOnly,
          canRanged,
          isLight,
          moveInfo.isCustomOnly || false,
          captureInfo.isCustomOnly || false
        );
        
        board.push(
          <div
            key={key}
            className={styles["board-square"]}
            style={{...squareStyle, ...(placement && !placement._occupied && ((placement.piece_width || 1) > 1 || (placement.piece_height || 1) > 1) ? { zIndex: 10 } : {})}}
            onMouseEnter={() => {
              if (placement && placement._occupied && placement._anchorKey) {
                const [anchorRow, anchorCol] = placement._anchorKey.split(',').map(Number);
                const anchorPlacement = piecePlacements[placement._anchorKey];
                if (anchorPlacement) {
                  setHoveredPiecePosition({ row: anchorRow, col: anchorCol, pieceId: anchorPlacement.piece_id, playerId: anchorPlacement.player_id });
                }
              }
            }}
            onMouseLeave={() => {
              if (placement && placement._occupied) {
                setHoveredPiecePosition(null);
              }
            }}
          >
            {showDetails && <SquareHighlightOverlay
              highlightStyle={highlightStyle}
              highlightIcon={highlightIcon}
              canHopCapture={canHopCapture}
              isAttackRadiusSplash={attackRadiusSplashSquares.has(key)}
              squareSize={squareSize}
              isLight={isLight}
            />}
            {showDetails && squareType && !placement && (
              <div 
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: `${squareSize * 0.4}px`,
                  fontWeight: 'bold',
                  color: borderColor,
                  textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                  pointerEvents: 'none'
                }}
              >
                {squareType === 'range' && 'R'}
                {squareType === 'promotion' && 'P'}
                {squareType === 'control' && 'C'}
                {squareType === 'special' && (() => {
                  const cfg = specialSquares.special[`${row},${col}`] || {};
                  const parts = [];
                  if (cfg.asRange) parts.push('R');
                  if (cfg.asPromotion) parts.push('P');
                  if (cfg.asControl) parts.push('C');
                  return parts.length > 0 ? parts.join('') : 'X';
                })()}
              </div>
            )}
            {placement && !placement._occupied && (
              <div
                onMouseEnter={() => {
                  setHoveredPiecePosition({ row, col, pieceId: placement.piece_id, playerId: placement.player_id });
                }}
                onMouseLeave={() => {
                  setHoveredPiecePosition(null);
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: `${(placement.piece_width || 1) * 100}%`,
                  height: `${(placement.piece_height || 1) * 100}%`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'default',
                  overflow: 'hidden',
                  zIndex: (placement.piece_width || 1) > 1 || (placement.piece_height || 1) > 1 ? 5 : 'auto'
                }}
              >
                {/* Smoky aura for multi-tile pieces */}
                {showDetails && boardAnimationsEnabled && ((placement.piece_width || 1) > 1 || (placement.piece_height || 1) > 1) && (
                  <>
                    <div className={styles["multi-tile-smoke"]} />
                    <div className={styles["multi-tile-electric"]} />
                  </>
                )}
                {(() => {
                  const imageUrl = getPlacementImageUrl(placement);
                  const gtPw = placement.piece_width || 1;
                  const gtPh = placement.piece_height || 1;
                  const isNonSquare = (gtPw > 1 || gtPh > 1) && gtPw !== gtPh;
                  return imageUrl ? (
                    isNonSquare ? (
                      <div
                        ref={(el) => applySvgStretchBackground(el, imageUrl)}
                        style={{
                          width: '100%',
                          height: '100%',
                          pointerEvents: 'none'
                        }}
                      />
                    ) : (
                      <img
                        src={imageUrl}
                        alt={placement.piece_name}
                        loading="lazy"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'fill',
                          pointerEvents: 'none'
                        }}
                        onError={(e) => {
                          console.error("Failed to load image:", imageUrl);
                          e.target.style.display = 'none';
                        }}
                      />
                    )
                  ) : (
                    <span style={{ fontSize: `${squareSize * 0.3}px`, color: '#fff', pointerEvents: 'none' }}>
                      {placement.piece_name?.charAt(0) || '?'}
                    </span>
                  );
                })()}
                {showDetails && <div className={styles["player-indicator"]} style={{
                  position: 'absolute',
                  bottom: '2px',
                  right: '2px',
                  background: getPlayerColor(placement.player_id),
                  width: `${squareSize * 0.2}px`,
                  height: `${squareSize * 0.2}px`,
                  borderRadius: '50%',
                  border: '1px solid #fff',
                  pointerEvents: 'none',
                  zIndex: 2
                }} />}
                {/* Checkmate piece indicator - upper right, styled for player */}
                {showDetails && placement.ends_game_on_checkmate && (
                  <div style={{
                    position: 'absolute',
                    top: '1px',
                    right: '2px',
                    fontSize: `${squareSize * 0.25}px`,
                    lineHeight: 1,
                    pointerEvents: 'none',
                    zIndex: 3,
                    color: Number(placement.player_id) === 1 ? 'white' : 'black'
                  }} title="Game ends if checkmated">
                    ♔
                  </div>
                )}
                {/* Capture piece indicator - upper left */}
                {showDetails && placement.ends_game_on_capture && (
                  <div style={{
                    position: 'absolute',
                    top: '2px',
                    left: '2px',
                    fontSize: `${squareSize * 0.25}px`,
                    pointerEvents: 'none',
                    zIndex: 3
                  }} title="Game ends if captured">
                    ⚔️
                  </div>
                )}
                {/* Stat badges - anchored to corners via PieceBadges component */}
                {showDetails && (() => {
                  let showGlobal = false;
                  try { showGlobal = JSON.parse(game.other_game_data || '{}').show_all_hp_ad || false; } catch {}
                  return <PieceBadges piece={placement} squareSize={squareSize} showGlobalHpAd={showGlobal} />;
                })()}
              </div>
            )}
          </div>
        );
      }
    }

    return board;
  };

  const canEdit = () => {
    if (!currentUser || !game) return false;
    const role = (currentUser.role || "").toLowerCase();
    return Number(game.creator_id) === Number(currentUser.id) || role === "admin" || role === "owner";
  };

  const handleDeleteGame = async () => {
    if (!window.confirm(`Are you sure you want to delete "${game.game_name}"? This will also delete associated forums. This action cannot be undone.`)) {
      return;
    }
    try {
      await dispatch(deleteGame(gameId));
      navigate('/create/games');
    } catch (error) {
      alert('Failed to delete game: ' + (error.response?.data?.message || error.message || error));
    }
  };

  const handleUniquenessCheck = async () => {
    setUniquenessCheckLoading(true);
    setUniquenessError(null);
    try {
      const result = await runUniquenessCheck(gameId);
      setUniquenessResult(result);
      // Update game state with new uniqueness data
      setGame(prev => ({
        ...prev,
        is_unique: result.is_unique ? 1 : 0,
        unique_badge_date: result.badge_date,
        uniqueness_score: result.uniqueness_score,
        similar_games: JSON.stringify(result.similar_games)
      }));
    } catch (error) {
      const msg = error?.response?.data?.message || error?.message || 'Failed to run uniqueness check';
      setUniquenessError(msg);
    } finally {
      setUniquenessCheckLoading(false);
    }
  };

  if (loading) {
    return (
      <div className={styles["container"]}>
        <div className={styles["loading"]}>Loading game...</div>
      </div>
    );
  }

  if (error || !game) {
    return (
      <div className={styles["container"]}>
        <div className={styles["error"]}>{error || "Game not found"}</div>
        <button onClick={() => navigate('/create/games')} className={styles["back-button"]}>
          Back to Games
        </button>
      </div>
    );
  }

  return (
    <div className={styles["container"]}>
      <div className={styles["header"]}>
        <button onClick={() => navigate('/create/games')} className={styles["back-button"]}>
          ← Back to Games
        </button>
        <div className={styles["header-actions"]}>
          <button
            className={`${styles["upvote-btn"]} ${hasUpvoted ? styles["upvoted"] : ''}`}
            onClick={handleUpvote}
            title={currentUser ? (hasUpvoted ? "Remove upvote" : "Upvote this game") : "Log in to upvote"}
          >
            {hasUpvoted ? '▲' : '△'} {upvoteCount}
          </button>
          <button 
            onClick={() => navigate(`/play?gameTypeId=${gameId}`)} 
            className={styles["play-button"]}
          >
            ♟ Play this Game
          </button>
          {aiAnalysisAvailable && (
            <button
              type="button"
              onClick={() => navigate(`/games/${gameId}/analysis`)}
              className={styles["play-button"]}
              title="View AI training analysis (win rates, balance report)"
            >
              📊 AI Analysis
            </button>
          )}
          {canEdit() && !aiAnalysisAvailable && (
            <button
              type="button"
              onClick={analysisRequestSent ? undefined : handleRequestAnalysis}
              className={styles["play-button"]}
              disabled={requestingAnalysis || analysisRequestSent}
              title={analysisRequestSent
                ? 'Analysis request sent — the site owner has been notified'
                : 'Request AI analysis training for this game. Sends a notification to the site owner.'}
              style={analysisRequestSent ? { opacity: 0.7, cursor: 'default' } : undefined}
            >
              {analysisRequestSent ? '✓ Analysis Requested' : requestingAnalysis ? 'Sending…' : '📊 Request AI Analysis'}
            </button>
          )}
          {canEdit() && (
            <>
              <button 
                onClick={() => navigate(`/create/game/edit/${gameId}`)} 
                className={styles["edit-button"]}
              >
                ✏️ Edit Game
              </button>
              <button 
                onClick={handleDeleteGame} 
                className={styles["delete-button"]}
              >
                🗑️ Delete Game
              </button>
            </>
          )}
        </div>
      </div>

      <div className={styles["game-info"]}>
        <h1>{game.game_name}</h1>
        {game.creator_username && (
          <p className={styles["creator"]}>
            Created by {game.creator_username === 'Anonymous' ? 'Anonymous' : <Link to={`/profile/${game.creator_username}`}>{game.creator_username}</Link>}
            {game.created_at && ` on ${parseServerDate(game.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`}
          </p>
        )}

        {game.initial_state_warning && (
          <div
            style={{
              background: 'rgba(255, 80, 80, 0.12)',
              border: '1px solid rgba(255, 120, 120, 0.5)',
              borderRadius: '8px',
              padding: '12px 16px',
              margin: '12px 0',
              color: '#ffd2d2',
              fontSize: '0.9rem',
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: '#ff8484' }}>⚠️ Starting Position Issue:</strong>{' '}
            {game.initial_state_warning} The game's creator should edit this game so the starting position is not already decided.
          </div>
        )}
        
        {game.article_id ? (
          <div className={styles["forum-link"]}>
            <Link to={`/forums/${game.article_id}`}>
              💬 Discuss in Game Forum
            </Link>
          </div>
        ) : (
          <div className={styles["forum-link"]}>
            <Link to={`/forums/new?game_type_id=${gameId}`}>
              ➕ Create Forum for this Game
            </Link>
          </div>
        )}

        {/* Uniqueness Badge & Section - hidden for now, will be enabled later */}
        {false && (() => {
          const isUniqueChecked = game.is_unique !== null && game.is_unique !== undefined;
          const isUnique = game.is_unique === 1 || game.is_unique === true;
          let similarGames = [];
          try { similarGames = JSON.parse(game.similar_games || '[]'); } catch {}
          const badgeDate = game.unique_badge_date ? parseServerDate(game.unique_badge_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : null;

          return (
            <div className={styles["uniqueness-section"]}>
              {isUnique && badgeDate && (
                <div className={styles["unique-badge"]}>
                  <span className={styles["badge-icon"]}>✦</span>
                  <span className={styles["badge-text"]}>Certified Unique</span>
                  <span className={styles["badge-date"]}>Since {badgeDate}</span>
                </div>
              )}
              
              {isUniqueChecked && game.uniqueness_score != null && (
                <div className={styles["uniqueness-score"]}>
                  <span className={styles["score-label"]}>Uniqueness Score:</span>
                  <span className={styles["score-value"]} style={{
                    color: game.uniqueness_score >= 80 ? '#10b981' : game.uniqueness_score >= 50 ? '#f59e0b' : '#ef4444'
                  }}>
                    {game.uniqueness_score}%
                  </span>
                </div>
              )}

              {isUniqueChecked && similarGames.length > 0 && (
                <div className={styles["similar-games"]}>
                  <h3>Most Similar Games</h3>
                  <div className={styles["similar-games-list"]}>
                    {similarGames.map((sg, idx) => (
                      <Link key={idx} to={`/games/${sg.id}`} className={styles["similar-game-item"]}>
                        <span className={styles["similar-game-name"]}>{sg.name}</span>
                        <span className={styles["similar-game-score"]}>{sg.similarity}% similar</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {canEdit() && (
                <div className={styles["uniqueness-check-actions"]}>
                  <button
                    className={styles["uniqueness-check-btn"]}
                    onClick={handleUniquenessCheck}
                    disabled={uniquenessCheckLoading}
                  >
                    {uniquenessCheckLoading ? '⏳ Checking...' : (isUniqueChecked ? '🔄 Re-run Uniqueness Check' : '🔍 Check Uniqueness')}
                  </button>
                  {uniquenessError && (
                    <p className={styles["uniqueness-error"]}>{uniquenessError}</p>
                  )}
                  {uniquenessResult && !uniquenessError && (
                    <p className={styles["uniqueness-success"]}>
                      {uniquenessResult.is_unique 
                        ? `✅ Certified Unique! Compared against ${uniquenessResult.games_compared} game${uniquenessResult.games_compared !== 1 ? 's' : ''}.`
                        : `Compared against ${uniquenessResult.games_compared} game${uniquenessResult.games_compared !== 1 ? 's' : ''}. A similar game was found.`
                      }
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        <div className={styles["section"]}>
          <div className={styles["board-setup-header"]}>
            <div
              className={`${styles["details-toggle"]} ${showDetails ? styles.active : ''}`}
              onClick={() => setShowDetails(prev => !prev)}
            >
              <div className={`${styles["details-switch"]} ${showDetails ? styles.on : ''}`} />
              <span className={styles["details-label"]}>{showDetails ? 'Hide Details' : 'Show Details'}</span>
            </div>
            <h2>Board Setup</h2>
          </div>
          {showDetails && <BoardLegend
            showMoveAttack
            showCheckmate={Object.values(piecePlacements).some(p => p.ends_game_on_checkmate)}
            showCaptureLoss={Object.values(piecePlacements).some(p => p.ends_game_on_capture)}
            specialSquares={{
              promotion: Object.keys(specialSquares.promotion).length > 0,
              range: Object.keys(specialSquares.range).length > 0,
              control: Object.keys(specialSquares.control).length > 0,
              special: Object.keys(specialSquares.special).length > 0,
            }}
          />}
          {showDetails && <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-dim)', marginBottom: '10px' }}>
            Hover over a piece to see where it can move and attack
          </p>}
          <div className={styles["board-container"]} ref={boardContainerRef}>
            <div
              className={styles["board"]}
              style={{
                display: 'grid',
                gridTemplateRows: `repeat(${game.board_height}, ${squareSize}px)`,
                gridTemplateColumns: `repeat(${game.board_width}, ${squareSize}px)`,
                border: '2px solid var(--border-subtle)',
                width: 'fit-content',
                margin: '0 auto',
                aspectRatio: 'unset'
              }}
            >
              {renderBoard()}
            </div>
          </div>
        </div>

        <div className={styles["stats-grid"]}>
          <div className={styles["stat-card"]}>
            <div className={styles["stat-header"]}>
              <span className={styles["stat-label"]}>Board Size</span>
              <InfoTooltip text="The dimensions of the game board (width × height)" />
            </div>
            <span className={styles["stat-value"]}>{game.board_width} × {game.board_height}</span>
          </div>
          <div className={styles["stat-card"]}>
            <div className={styles["stat-header"]}>
              <span className={styles["stat-label"]}>Players</span>
              <InfoTooltip text="Number of players in this game type" />
            </div>
            <span className={styles["stat-value"]}>{game.player_count}</span>
          </div>
          <div className={styles["stat-card"]}>
            <div className={styles["stat-header"]}>
              <span className={styles["stat-label"]}>Actions per Turn</span>
              <InfoTooltip text={`How many actions each player can take on their turn (moves, captures, or ranged attacks)${(game.actions_per_turn || 1) > 1 ? `. In multi-action games, checkmate is only evaluated after all ${game.actions_per_turn} actions are completed. Checkmate pieces cannot be captured directly — they must be checkmated.` : ''}`} />
            </div>
            <span className={styles["stat-value"]}>{game.actions_per_turn || 1}</span>
          </div>
          <div className={styles["stat-card"]}>
            <div className={styles["stat-header"]}>
              <span className={styles["stat-label"]}>Pieces</span>
              <InfoTooltip text="Total number of unique pieces placed on the starting board" />
            </div>
            <span className={styles["stat-value"]}>{Object.values(piecePlacements).filter(p => !p._occupied).length}</span>
          </div>
        </div>

        <div className={styles["section"]}>
          <h2>Description</h2>
          {game.descript ? renderContent(game.descript) : <p>No description provided.</p>}
        </div>

        {/* Placeable Pieces Visual Section */}
        {(() => {
          let od = {};
          try { od = JSON.parse(game.other_game_data || '{}') || {}; } catch {}
          if (!od.place_pieces_action || !od.placeable_pieces || od.placeable_pieces.length === 0) return null;
          return (
            <div className={styles["section"]}>
              <h2>♟ Placeable Pieces</h2>
              <p style={{ color: 'var(--text-muted)', marginBottom: '12px' }}>These pieces can be placed onto the board during gameplay.</p>
              <div className={styles["placeable-pieces-grid"]}>
                {od.placeable_pieces.map((pp, idx) => {
                  const imgUrl = pp.image_url ? getImageUrl(pp.image_url) : null;
                  return (
                    <Link key={idx} to={pp.piece_id ? `/pieces/${pp.piece_id}` : '#'} className={styles["placeable-piece-card"]}>
                      {imgUrl ? (
                        <img src={imgUrl} alt={pp.piece_name || pp.name || 'Piece'} className={styles["placeable-piece-img"]} />
                      ) : (
                        <span className={styles["placeable-piece-placeholder"]}>?</span>
                      )}
                      <span className={styles["placeable-piece-label"]}>{pp.piece_name || pp.name || 'Unknown'}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Auto-generated Rules Section */}
        <div className={styles["section"]}>
          <h2>📜 Game Rules</h2>
          {generateRules ? (
            <div className={styles["rules-container"]}>
              {(() => {
                // Build global piece name → id map from all sections' pieceLinks
                const pieceNameToId = {};
                generateRules.forEach(section => {
                  if (section.pieceLinks) {
                    section.pieceLinks.forEach(p => {
                      pieceNameToId[p.name] = p.id;
                    });
                  }
                });
                return generateRules.map((section, index) => (
                  <div key={index} className={styles["rule-section"]}>
                    <h3 className={styles["rule-title"]}>{section.title}</h3>
                    <div className={styles["rule-content"]}>
                      {section.content.split('\n').map((line, lineIndex) => {
                        // Handle horizontal rule separator
                        if (line.trim() === '---') {
                          return <hr key={lineIndex} className={styles["rule-divider"]} />;
                        }
                        // Handle bold text markers - convert piece names to links
                        const parts = line.split(/(\*\*[^*]+\*\*)/);
                        return (
                          <p key={lineIndex} className={styles["rule-line"]}>
                            {parts.map((part, partIndex) => {
                              if (part.startsWith('**') && part.endsWith('**')) {
                                const text = part.slice(2, -2);
                                const pieceId = pieceNameToId[text];
                                if (pieceId) {
                                  return <Link key={partIndex} to={`/pieces/${pieceId}`} className={styles["piece-link-inline"]}><strong>{text}</strong></Link>;
                                }
                                return <strong key={partIndex}>{text}</strong>;
                              }
                              return part;
                            })}
                          </p>
                        );
                      })}
                      {section.pieceLinks && section.pieceLinks.length > 0 && (
                        <div className={styles["piece-links"]}>
                          <strong>Pieces used:</strong>
                          <ul className={styles["piece-link-list"]}>
                            {section.pieceLinks.map((piece) => (
                              <li key={piece.id}>
                                <Link to={`/pieces/${piece.id}`} className={styles["piece-link"]}>
                                  {piece.name}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                ));
              })()}
            </div>
          ) : (
            <p className={styles["loading-rules"]}>⚠️ This game has no rules configured and may be incomplete.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default GameTypeView;
