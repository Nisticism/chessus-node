import React, { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { getGameById } from "../../actions/games";
import { getAllPieces, getPieceById } from "../../actions/pieces";
import styles from "./gametypeview.module.scss";

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
      movements.push(directions.join(', '));
    }
  }
  
  // Check ratio movement (L-shape like knight) - check both flag and values
  if (hasRatio || hasRatioValues) {
    if (hasRatioValues) {
      movements.push(`in an L-shape (${ratio1} squares in one direction and ${ratio2} squares perpendicular)`);
    }
  }
  
  // Check step movement - handle both naming conventions
  const stepStyle = pieceData.step_movement_style || pieceData.step_by_step_movement_style;
  const stepValue = pieceData.step_movement_value || pieceData.step_by_step_movement_value;
  
  if (stepStyle === 'manhattan' || stepStyle === 1) {
    const range = describeMovementRange(stepValue);
    if (range) {
      movements.push(`${range} counting horizontal and vertical steps`);
    }
  } else if (stepStyle === 'chebyshev' || stepStyle === 2) {
    const range = describeMovementRange(stepValue);
    if (range) {
      movements.push(`${range} in any direction (including diagonals)`);
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
    movements.push(`can hop over ${hoppingDetails.join(' and ')}`);
  }
  
  return movements.join('; ');
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
      captures.push(directions.join(', '));
    }
  }
  
  // Ratio capture (L-shape like knight) - handle both naming conventions
  const hasRatioCapture = directionalStyle === 'ratio' || directionalStyle === 'both' || 
                          directionalStyle === 2 || directionalStyle === 3;
  const ratio1 = pieceData.ratio_capture_1 || pieceData.ratio_one_capture || 0;
  const ratio2 = pieceData.ratio_capture_2 || pieceData.ratio_two_capture || 0;
  if (hasRatioCapture || (ratio1 > 0 && ratio2 > 0)) {
    if (ratio1 > 0 && ratio2 > 0) {
      captures.push(`in an L-shape (${ratio1} squares by ${ratio2} squares)`);
    }
  }
  
  // Step-based capture - handle both naming conventions
  const stepStyle = pieceData.step_capture_style || pieceData.step_by_step_capture;
  const stepValue = pieceData.step_capture_value || pieceData.step_by_step_capture;
  
  if (stepStyle === 'manhattan' || stepStyle === 1) {
    const range = describeMovementRange(stepValue);
    if (range) {
      captures.push(`within ${range} (counting horizontal and vertical steps)`);
    }
  } else if (stepStyle === 'chebyshev' || stepStyle === 2) {
    const range = describeMovementRange(stepValue);
    if (range) {
      captures.push(`within ${range} in any direction`);
    }
  }
  
  // If no specific capture patterns found but attacks_like_movement is set
  if (captures.length === 0 && (pieceData.attacks_like_movement || pieceData.can_capture_enemy_on_move)) {
    return "captures the same way it moves";
  }
  
  return captures.join('; ');
};

const GameTypeView = () => {
  const { gameId } = useParams();
  const navigate = useNavigate();
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
    special: {}
  });

  // Get user's preferred board colors from localStorage
  const lightSquareColor = localStorage.getItem('boardLightColor') || '#cad5e8';
  const darkSquareColor = localStorage.getItem('boardDarkColor') || '#08234d';

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
            console.log("Parsed piece placements:", parsed);
            
            // Get unique piece IDs from placements
            const pieceIds = new Set();
            Object.values(parsed).forEach(placement => {
              if (placement.piece_id) {
                pieceIds.add(placement.piece_id);
              }
            });
            
            // Fetch piece data for all unique piece IDs with full movement data
            if (pieceIds.size > 0) {
              const pieceMap = {};
              
              // Load full details for each piece ID directly
              await Promise.all(Array.from(pieceIds).map(async (pieceId) => {
                try {
                  const fullPieceData = await getPieceById(pieceId);
                  console.log(`getPieceById(${pieceId}) returned:`, fullPieceData);
                  // Store by the requested ID, not the returned ID
                  pieceMap[pieceId] = fullPieceData;
                } catch (err) {
                  console.error(`Error loading piece ${pieceId}:`, err);
                }
              }));
              
              console.log('Loaded piece data map with movement data:', pieceMap);
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

        setLoading(false);
      } catch (err) {
        console.error("Error loading game:", err);
        setError("Failed to load game");
        setLoading(false);
      }
    };

    if (gameId) {
      loadGame();
    }
  }, [gameId, dispatch]);

  const getPlayerColor = (playerId) => {
    // Use chess-standard colors: Player 1 = White, Player 2 = Black
    // Additional players get distinct colors
    const colors = ['#ffffff', '#222222', '#ff6b6b', '#4ecdc4', '#f7dc6f', '#bb8fce', '#52be80', '#5dade2'];
    return colors[(playerId - 1) % colors.length] || '#999';
  };

  const getSquareType = (key) => {
    if (specialSquares.range[key]) return 'range';
    if (specialSquares.promotion[key]) return 'promotion';
    if (specialSquares.special[key]) return 'special';
    return null;
  };

  const getSquareColor = (type) => {
    switch (type) {
      case 'range': return '#ff8c00';
      case 'promotion': return '#4b0082';
      case 'special': return '#ffd700';
      default: return null;
    }
  };

  const getPlacementImageUrl = (placement) => {
    // First try to use the saved image_url from placement (player-specific)
    if (placement.image_url) {
      return getImageUrl(placement.image_url);
    }
    
    // Fall back to fetching from piece data using player_id to select correct image
    if (placement.piece_id && pieceDataMap[placement.piece_id]) {
      const piece = pieceDataMap[placement.piece_id];
      if (piece.image_location) {
        try {
          const images = JSON.parse(piece.image_location);
          if (Array.isArray(images) && images.length > 0) {
            // Use player_id to select the correct image (1-indexed to 0-indexed)
            const imageIndex = (placement.player_id || 1) - 1;
            const targetIndex = imageIndex < images.length ? imageIndex : 0;
            const imagePath = images[targetIndex];
            return imagePath.startsWith('http') ? imagePath : `${ASSET_URL}${imagePath}`;
          }
        } catch (e) {
          console.error("Error parsing image_location for piece", placement.piece_id, e);
        }
      }
    }
    return null;
  };

  // Helper function to check if a value allows movement at a distance
  const checkMovement = (value, distance) => {
    if (value === 99) return true; // Infinite movement
    if (value === 0 || value === null) return false;
    if (value > 0) return distance <= value; // Up to X squares
    if (value < 0) return distance === Math.abs(value); // Exact X squares
    return false;
  };

  // Check if piece can move to a square
  const canPieceMoveTo = (fromRow, fromCol, toRow, toCol, pieceData, playerPosition) => {
    if (!pieceData) return false;
    if (fromRow === toRow && fromCol === toCol) return false;

    // For player 2, flip the perspective (so "up" is towards player 1)
    const rowDiff = playerPosition === 2 ? (fromRow - toRow) : (toRow - fromRow);
    const colDiff = playerPosition === 2 ? (fromCol - toCol) : (toCol - fromCol);

    // Check directional movement - accept if style is set OR if any directional movement values are present
    const directionalStyle = pieceData.directional_movement_style;
    const hasDirectionalValues = pieceData.up_movement || pieceData.down_movement || 
                                  pieceData.left_movement || pieceData.right_movement ||
                                  pieceData.up_left_movement || pieceData.up_right_movement ||
                                  pieceData.down_left_movement || pieceData.down_right_movement;
    
    if (directionalStyle || hasDirectionalValues) {
      let directionalAllowed = false;

      // Check 8 directions
      if (rowDiff < 0 && colDiff === 0) {
        directionalAllowed = checkMovement(pieceData.up_movement, Math.abs(rowDiff));
      } else if (rowDiff > 0 && colDiff === 0) {
        directionalAllowed = checkMovement(pieceData.down_movement, Math.abs(rowDiff));
      } else if (rowDiff === 0 && colDiff < 0) {
        directionalAllowed = checkMovement(pieceData.left_movement, Math.abs(colDiff));
      } else if (rowDiff === 0 && colDiff > 0) {
        directionalAllowed = checkMovement(pieceData.right_movement, Math.abs(colDiff));
      } else if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.up_left_movement, Math.abs(rowDiff));
      } else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.up_right_movement, Math.abs(rowDiff));
      } else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.down_left_movement, Math.abs(rowDiff));
      } else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.down_right_movement, Math.abs(rowDiff));
      }

      if (directionalAllowed) return true;
    }

    // Check ratio movement (L-shape like knight)
    const ratioStyle = pieceData.ratio_movement_style;
    const ratio1 = pieceData.ratio_movement_1 || pieceData.ratio_one_movement || 0;
    const ratio2 = pieceData.ratio_movement_2 || pieceData.ratio_two_movement || 0;
    
    if ((ratioStyle || (ratio1 > 0 && ratio2 > 0)) && ratio1 > 0 && ratio2 > 0) {
      if ((Math.abs(rowDiff) === ratio1 && Math.abs(colDiff) === ratio2) ||
          (Math.abs(rowDiff) === ratio2 && Math.abs(colDiff) === ratio1)) {
        return true;
      }
    }

    // Check step-by-step movement
    const stepStyle = pieceData.step_movement_style;
    const stepValue = pieceData.step_movement_value;
    if (stepStyle || stepValue) {
      const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
      const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      
      if (stepStyle === 'manhattan' || stepStyle === 1) {
        return checkMovement(stepValue, manhattanDistance);
      } else if (stepStyle === 'chebyshev' || stepStyle === 2) {
        return checkMovement(stepValue, chebyshevDistance);
      } else {
        // Default to chebyshev if value exists but style not specified
        return checkMovement(stepValue, chebyshevDistance);
      }
    }

    return false;
  };

  // Check if piece can capture on a square
  const canCaptureOnMoveTo = (fromRow, fromCol, toRow, toCol, pieceData, playerPosition) => {
    if (!pieceData) return false;
    if (fromRow === toRow && fromCol === toCol) return false;

    // For player 2, flip the perspective (so "up" is towards player 1)
    const rowDiff = playerPosition === 2 ? (fromRow - toRow) : (toRow - fromRow);
    const colDiff = playerPosition === 2 ? (fromCol - toCol) : (toCol - fromCol);

    // Check if separate capture fields are defined
    const hasSeparateCaptureFields = pieceData.up_capture || pieceData.down_capture || 
                                     pieceData.left_capture || pieceData.right_capture || 
                                     pieceData.up_left_capture || pieceData.up_right_capture ||
                                     pieceData.down_left_capture || pieceData.down_right_capture ||
                                     pieceData.ratio_capture_1 || pieceData.ratio_capture_2 ||
                                     pieceData.step_capture_style;

    // If piece can capture on move AND no separate capture fields, use movement logic
    if (pieceData.can_capture_enemy_on_move && !hasSeparateCaptureFields) {
      return canPieceMoveTo(fromRow, fromCol, toRow, toCol, pieceData, playerPosition);
    }

    // Check directional capture (handle both string and numeric values, or if individual capture fields are set)
    const directionalCaptureStyle = pieceData.directional_capture_style;
    const hasDirectionalCapture = directionalCaptureStyle === 'directional' || directionalCaptureStyle === 'both' || 
                                   directionalCaptureStyle === 1 || directionalCaptureStyle === 3 ||
                                   // Also check if any directional capture fields are set
                                   pieceData.up_capture || pieceData.down_capture || pieceData.left_capture || 
                                   pieceData.right_capture || pieceData.up_left_capture || pieceData.up_right_capture ||
                                   pieceData.down_left_capture || pieceData.down_right_capture;
    
    if (hasDirectionalCapture) {
      let directionalAllowed = false;

      if (rowDiff < 0 && colDiff === 0) {
        directionalAllowed = checkMovement(pieceData.up_capture, Math.abs(rowDiff));
      } else if (rowDiff > 0 && colDiff === 0) {
        directionalAllowed = checkMovement(pieceData.down_capture, Math.abs(rowDiff));
      } else if (rowDiff === 0 && colDiff < 0) {
        directionalAllowed = checkMovement(pieceData.left_capture, Math.abs(colDiff));
      } else if (rowDiff === 0 && colDiff > 0) {
        directionalAllowed = checkMovement(pieceData.right_capture, Math.abs(colDiff));
      } else if (rowDiff < 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.up_left_capture, Math.abs(rowDiff));
      } else if (rowDiff < 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.up_right_capture, Math.abs(rowDiff));
      } else if (rowDiff > 0 && colDiff < 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.down_left_capture, Math.abs(rowDiff));
      } else if (rowDiff > 0 && colDiff > 0 && Math.abs(rowDiff) === Math.abs(colDiff)) {
        directionalAllowed = checkMovement(pieceData.down_right_capture, Math.abs(rowDiff));
      }

      if (directionalAllowed) return true;
    }

    // Check ratio capture (L-shape)
    const ratio1 = pieceData.ratio_capture_1 || pieceData.ratio_one_capture || 0;
    const ratio2 = pieceData.ratio_capture_2 || pieceData.ratio_two_capture || 0;
    if (ratio1 > 0 && ratio2 > 0) {
      if ((Math.abs(rowDiff) === ratio1 && Math.abs(colDiff) === ratio2) ||
          (Math.abs(rowDiff) === ratio2 && Math.abs(colDiff) === ratio1)) {
        return true;
      }
    }

    // Check step-by-step capture
    const stepCaptureStyle = pieceData.step_capture_style;
    const stepCaptureValue = pieceData.step_capture_value;
    if (stepCaptureStyle || stepCaptureValue) {
      const manhattanDistance = Math.abs(rowDiff) + Math.abs(colDiff);
      const chebyshevDistance = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      
      if (stepCaptureStyle === 'manhattan' || stepCaptureStyle === 1) {
        return checkMovement(stepCaptureValue, manhattanDistance);
      } else if (stepCaptureStyle === 'chebyshev' || stepCaptureStyle === 2) {
        return checkMovement(stepCaptureValue, chebyshevDistance);
      } else {
        return checkMovement(stepCaptureValue, chebyshevDistance);
      }
    }

    return false;
  };

  // Generate auto-generated rules based on game configuration
  const generateRules = useMemo(() => {
    if (!game || Object.keys(pieceDataMap).length === 0) return null;

    const rules = [];
    
    // Basic game info
    rules.push({
      title: "Overview",
      content: `This is a ${game.player_count}-player strategy game played on a ${game.board_width}×${game.board_height} board. Players take turns moving their pieces, with each player able to make ${game.actions_per_turn || 1} action${(game.actions_per_turn || 1) > 1 ? 's' : ''} per turn.`
    });

    // Analyze pieces by player
    const piecesByPlayer = {};
    const uniquePieces = {};
    const checkmatePieces = [];
    const capturePieces = [];

    Object.values(piecePlacements).forEach(placement => {
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
    Object.entries(piecesByPlayer).forEach(([playerId, placements]) => {
      const pieceCounts = {};
      placements.forEach(p => {
        const name = p.piece_name || 'Unknown';
        pieceCounts[name] = (pieceCounts[name] || 0) + 1;
      });
      
      const pieceList = Object.entries(pieceCounts)
        .map(([name, count]) => count > 1 ? `${count} ${name}s` : `1 ${name}`)
        .join(', ');
      
      startingPiecesContent.push(`Player ${playerId}: ${pieceList} (${placements.length} pieces total)`);
    });

    if (startingPiecesContent.length > 0) {
      rules.push({
        title: "Starting Pieces",
        content: startingPiecesContent.join('\n')
      });
    }

    // Piece movements
    const pieceDescriptions = [];
    Object.values(uniquePieces).forEach(piece => {
      const pieceData = pieceDataMap[piece.id] || piece;
      const pieceName = pieceData.piece_name || piece.piece_name || 'Unknown Piece';
      
      const movementDesc = describePieceMovement(pieceData);
      const captureDesc = describePieceCapture(pieceData);
      
      let description = `**${pieceName}**:\n`;
      
      // Movement description
      if (movementDesc) {
        description += `• **Movement**: ${movementDesc}.\n`;
      } else {
        description += `• **Movement**: Not defined.\n`;
      }
      
      // Attack/Capture description
      if (captureDesc === "captures the same way it moves") {
        description += `• **Attack**: Attacks the same way it moves.`;
      } else if (captureDesc) {
        description += `• **Attack**: ${captureDesc.charAt(0).toUpperCase() + captureDesc.slice(1)}.`;
      } else {
        description += `• **Attack**: Not defined.`;
      }
      
      pieceDescriptions.push(description);
    });

    if (pieceDescriptions.length > 0) {
      rules.push({
        title: "How Pieces Move and Attack",
        content: pieceDescriptions.join('\n\n')
      });
    }

    // Win conditions
    const winConditions = [];

    // Checkmate condition
    if (game.mate_condition) {
      const checkmatePieceNames = [...new Set(checkmatePieces.map(p => p.piece_name || 'designated piece'))];
      
      let checkmateDesc = "**Checkmate**: A player wins by checkmating their opponent's ";
      if (checkmatePieceNames.length > 0) {
        checkmateDesc += checkmatePieceNames.join(' or ') + '.';
      } else {
        checkmateDesc += "key piece.";
      }
      
      checkmateDesc += "\n\n";
      checkmateDesc += "• **Check**: When a piece can capture your " + (checkmatePieceNames[0] || "key piece") + " on the next move, you are \"in check.\"\n";
      checkmateDesc += "• **Getting out of check**: You must immediately do one of the following: move your " + (checkmatePieceNames[0] || "key piece") + " to a safe square, block the attacking piece with another piece, or capture the attacking piece.\n";
      checkmateDesc += "• **Checkmate**: If you cannot escape check by any legal move, you are checkmated and lose the game.\n";
      checkmateDesc += "\n⚠️ **Important**: Protect your " + (checkmatePieceNames[0] || "key piece") + " from checkmate at all costs!";
      
      winConditions.push(checkmateDesc);
    }

    // Capture condition
    if (game.capture_condition) {
      const capturePieceNames = [...new Set(capturePieces.map(p => p.piece_name || 'designated piece'))];
      
      let captureDesc = "**Capture to Win**: A player wins by capturing their opponent's ";
      if (capturePieceNames.length > 0) {
        captureDesc += capturePieceNames.join(' or ') + '.';
      } else {
        captureDesc += "key piece.";
      }
      captureDesc += "\n\n⚠️ **Important**: Protect your " + (capturePieceNames[0] || "key piece") + " from being captured!";
      
      winConditions.push(captureDesc);
    }

    // Value/points condition
    if (game.value_condition) {
      const valueTitle = game.value_title || 'points';
      const valueMax = game.value_max || 'the target amount';
      winConditions.push(`**${valueTitle} Victory**: First player to accumulate ${valueMax} ${valueTitle.toLowerCase()} wins the game.`);
    }

    // Squares condition
    if (game.squares_condition) {
      winConditions.push(`**Territory Control**: Control ${game.squares_count || 'the required number of'} designated squares to win.`);
    }

    // Hill condition
    if (game.hill_condition) {
      winConditions.push(`**King of the Hill**: Occupy the center hill square at (${game.hill_x || 'center'}, ${game.hill_y || 'center'}) for ${game.hill_turns || 3} consecutive turns to win.`);
    }

    if (winConditions.length > 0) {
      rules.push({
        title: "How to Win",
        content: winConditions.join('\n\n')
      });
    } else {
      rules.push({
        title: "How to Win",
        content: "No specific win conditions have been configured for this game type."
      });
    }

    // Special squares
    const specialSquaresDesc = [];
    
    if (Object.keys(specialSquares.range).length > 0) {
      specialSquaresDesc.push(`**Range Squares** (marked with R): ${Object.keys(specialSquares.range).length} squares that can modify piece attack or movement range when occupied.`);
    }
    
    if (Object.keys(specialSquares.promotion).length > 0) {
      specialSquaresDesc.push(`**Promotion Squares** (marked with P): ${Object.keys(specialSquares.promotion).length} squares where pieces can be promoted to more powerful pieces.`);
    }
    
    if (Object.keys(specialSquares.special).length > 0) {
      specialSquaresDesc.push(`**Special Squares** (marked with S): ${Object.keys(specialSquares.special).length} squares with custom effects.`);
    }

    if (specialSquaresDesc.length > 0) {
      rules.push({
        title: "Special Squares",
        content: specialSquaresDesc.join('\n\n')
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
• The game continues until a win condition is met or players agree to a draw.`
    });

    return rules;
  }, [game, piecePlacements, pieceDataMap, specialSquares]);

  const renderBoard = () => {
    if (!game) return null;

    const board = [];
    const squareSize = Math.min(60, 720 / Math.max(game.board_width, game.board_height));

    for (let row = 0; row < game.board_height; row++) {
      for (let col = 0; col < game.board_width; col++) {
        const isLight = (row + col) % 2 === 0;
        const key = `${row},${col}`;
        const placement = piecePlacements[key];
        const squareType = getSquareType(key);
        const borderColor = getSquareColor(squareType);

        // Check if this square is valid for the hovered piece
        let canMove = false;
        let canCapture = false;
        
        if (hoveredPiecePosition) {
          const pieceData = pieceDataMap[hoveredPiecePosition.pieceId];
          if (row === 0 && col === 0) {
            console.log('Hovered piece position:', hoveredPiecePosition);
            console.log('Piece data:', pieceData);
            console.log('Movement fields:', {
              directional_movement_style: pieceData?.directional_movement_style,
              up_movement: pieceData?.up_movement,
              down_movement: pieceData?.down_movement,
              left_movement: pieceData?.left_movement,
              right_movement: pieceData?.right_movement,
              can_capture_enemy_on_move: pieceData?.can_capture_enemy_on_move
            });
            console.log('Capture fields:', {
              directional_capture_style: pieceData?.directional_capture_style,
              up_capture: pieceData?.up_capture,
              down_capture: pieceData?.down_capture,
              up_left_capture: pieceData?.up_left_capture,
              up_right_capture: pieceData?.up_right_capture,
              can_capture_enemy_on_move: pieceData?.can_capture_enemy_on_move,
              'typeof can_capture_enemy_on_move': typeof pieceData?.can_capture_enemy_on_move,
              'truthy check': !!pieceData?.can_capture_enemy_on_move
            });
          }
          if (pieceData) {
            canMove = canPieceMoveTo(hoveredPiecePosition.row, hoveredPiecePosition.col, row, col, pieceData, hoveredPiecePosition.playerId);
            canCapture = canCaptureOnMoveTo(hoveredPiecePosition.row, hoveredPiecePosition.col, row, col, pieceData, hoveredPiecePosition.playerId);
            if ((canMove || canCapture) && row === 0 && col === 0) {
              console.log('Square 0,0: canMove=', canMove, 'canCapture=', canCapture);
            }
          }
        }

        let squareStyle = {
          background: isLight ? lightSquareColor : darkSquareColor,
          width: `${squareSize}px`,
          height: `${squareSize}px`,
          position: 'relative',
          border: squareType ? `4px solid ${borderColor}` : 'none',
          boxSizing: 'border-box'
        };

        // Add hover highlighting (override special square borders if applicable)
        if (canMove && canCapture) {
          // Outer border for movement (blue), inner border for attack (orange)
          squareStyle.border = '4px solid #2196F3';
          squareStyle.boxShadow = 'inset 0 0 0 3px #FF9800, inset 0 0 10px rgba(255, 152, 0, 0.3)';
          squareStyle.zIndex = 10;
        } else if (canMove) {
          squareStyle.border = '5px solid #2196F3';
          squareStyle.boxShadow = 'inset 0 0 10px rgba(33, 150, 243, 0.3)';
          squareStyle.zIndex = 10;
        } else if (canCapture) {
          squareStyle.border = '3px solid #FF9800';
          squareStyle.boxShadow = 'inset 0 0 10px rgba(255, 152, 0, 0.3)';
          squareStyle.zIndex = 10;
        }

        board.push(
          <div
            key={key}
            className={styles["board-square"]}
            style={squareStyle}
          >
            {squareType && !placement && (
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
                {squareType === 'special' && 'S'}
              </div>
            )}
            {placement && (
              <div
                onMouseEnter={() => {
                  console.log('Hovering over piece at', row, col, 'pieceId:', placement.piece_id, 'playerId:', placement.player_id);
                  setHoveredPiecePosition({ row, col, pieceId: placement.piece_id, playerId: placement.player_id });
                }}
                onMouseLeave={() => {
                  console.log('Left piece');
                  setHoveredPiecePosition(null);
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'default'
                }}
              >
                {(() => {
                  const imageUrl = getPlacementImageUrl(placement);
                  return imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={placement.piece_name}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        pointerEvents: 'none'
                      }}
                      onError={(e) => {
                        console.error("Failed to load image:", imageUrl);
                        e.target.style.display = 'none';
                      }}
                    />
                  ) : (
                    <span style={{ fontSize: `${squareSize * 0.3}px`, color: '#fff', pointerEvents: 'none' }}>
                      {placement.piece_name?.charAt(0) || '?'}
                    </span>
                  );
                })()}
                <div className={styles["player-indicator"]} style={{
                  position: 'absolute',
                  bottom: '2px',
                  right: '2px',
                  background: getPlayerColor(placement.player_id),
                  width: `${squareSize * 0.2}px`,
                  height: `${squareSize * 0.2}px`,
                  borderRadius: '50%',
                  border: '1px solid #fff',
                  pointerEvents: 'none'
                }} />
              </div>
            )}
          </div>
        );
      }
    }

    return board;
  };

  const canEdit = () => {
    return currentUser && game && (game.creator_id === currentUser.id || currentUser.role === "Admin");
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
        {canEdit() && (
          <button 
            onClick={() => navigate(`/create/game/edit/${gameId}`)} 
            className={styles["edit-button"]}
          >
            ✏️ Edit Game
          </button>
        )}
      </div>

      <div className={styles["game-info"]}>
        <h1>{game.game_name}</h1>
        {game.creator_username && (
          <p className={styles["creator"]}>
            Created by <Link to={`/profile/${game.creator_username}`}>{game.creator_username}</Link>
          </p>
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

        <div className={styles["section"]}>
          <h2>Description</h2>
          <p>{game.descript || "No description provided."}</p>
        </div>

        <div className={styles["stats-grid"]}>
          <div className={styles["stat-card"]}>
            <span className={styles["stat-label"]}>Board Size</span>
            <span className={styles["stat-value"]}>{game.board_width} × {game.board_height}</span>
          </div>
          <div className={styles["stat-card"]}>
            <span className={styles["stat-label"]}>Players</span>
            <span className={styles["stat-value"]}>{game.player_count}</span>
          </div>
          <div className={styles["stat-card"]}>
            <span className={styles["stat-label"]}>Actions per Turn</span>
            <span className={styles["stat-value"]}>{game.actions_per_turn || 1}</span>
          </div>
          <div className={styles["stat-card"]}>
            <span className={styles["stat-label"]}>Pieces</span>
            <span className={styles["stat-value"]}>{Object.keys(piecePlacements).length}</span>
          </div>
        </div>

        <div className={styles["section"]}>
          <h2>Board Setup</h2>
          <div className={styles["board-container"]}>
            <div
              className={styles["board"]}
              style={{
                display: 'grid',
                gridTemplateRows: `repeat(${game.board_height}, 1fr)`,
                gridTemplateColumns: `repeat(${game.board_width}, 1fr)`,
                border: '2px solid #ccc',
                width: 'fit-content',
                margin: '0 auto'
              }}
            >
              {renderBoard()}
            </div>
          </div>
        </div>

        {/* Auto-generated Rules Section */}
        <div className={styles["section"]}>
          <h2>📜 Game Rules</h2>
          {generateRules ? (
            <div className={styles["rules-container"]}>
              {generateRules.map((section, index) => (
                <div key={index} className={styles["rule-section"]}>
                  <h3 className={styles["rule-title"]}>{section.title}</h3>
                  <div className={styles["rule-content"]}>
                    {section.content.split('\n').map((line, lineIndex) => {
                      // Handle bold text markers
                      const parts = line.split(/(\*\*[^*]+\*\*)/);
                      return (
                        <p key={lineIndex} className={styles["rule-line"]}>
                          {parts.map((part, partIndex) => {
                            if (part.startsWith('**') && part.endsWith('**')) {
                              return <strong key={partIndex}>{part.slice(2, -2)}</strong>;
                            }
                            return part;
                          })}
                        </p>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles["loading-rules"]}>Loading rules...</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default GameTypeView;
