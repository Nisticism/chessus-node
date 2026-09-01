import React, { useState, useEffect } from "react";
import { useNavigate, Link } from 'react-router-dom';
import { useSelector, useDispatch } from "react-redux";
import styles from "./piecewizard.module.scss";
import StandardButton from "../standardbutton/StandardButton";
import Divider from "../Divider/Divider";
import { createPiece, updatePiece, getPieceById, checkPieceDuplicates, invalidatePieceValueCache } from "../../actions/pieces";
import { trackPieceCreation, trackEvent } from "../../analytics/GoogleAnalytics";
import { validateContent } from "../../utils/contentModeration";
import PieceStep1BasicInfo from "./PieceStep1BasicInfo";
import PieceStep2Movement from "./PieceStep2Movement";
import PieceStep3Attack from "./PieceStep3Attack";
import PieceStep4Special from "./PieceStep4Special";

const PieceWizard = ({ editPieceId = null }) => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isDraftMode, setIsDraftMode] = useState(false);
  const [isLoading, setIsLoading] = useState(!!editPieceId);
  const [isEditMode, setIsEditMode] = useState(!!editPieceId);
  const [existingImages, setExistingImages] = useState([]);
  const [missingFields, setMissingFields] = useState(null);
  const [duplicateWarning, setDuplicateWarning] = useState(null); // { matches, nameSame }
  const [ratioZeroWarning, setRatioZeroWarning] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  
  // Scroll to top when step changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentStep]);
  
  // Piece data state - all fields from pieces table
  const [pieceData, setPieceData] = useState({
    // Step 1: Basic Info
    piece_name: "",
    piece_description: "",
    piece_category: "",
    piece_images: [],
    piece_image_previews: [],
    piece_image_sources: [],
    piece_width: 1,
    piece_height: 1,
    is_anonymous_creator: !currentUser,
    
    // Step 2: Movement Configuration
    directional_movement_style: false,
    repeating_movement: false,
    max_directional_movement_iterations: null,
    min_directional_movement_iterations: null,
    first_move_only: false,
    first_move_only_capture: false,
    up_left_movement: 0,
    up_movement: 0,
    up_right_movement: 0,
    right_movement: 0,
    down_right_movement: 0,
    down_movement: 0,
    down_left_movement: 0,
    left_movement: 0,
    
    // Movement exact flags
    up_left_movement_exact: false,
    up_movement_exact: false,
    up_right_movement_exact: false,
    right_movement_exact: false,
    down_right_movement_exact: false,
    down_movement_exact: false,
    down_left_movement_exact: false,
    left_movement_exact: false,
    
    // Movement available_for fields
    up_left_movement_available_for: null,
    up_movement_available_for: null,
    up_right_movement_available_for: null,
    right_movement_available_for: null,
    down_right_movement_available_for: null,
    down_movement_available_for: null,
    down_left_movement_available_for: null,
    left_movement_available_for: null,
    
    ratio_movement_style: false,
    ratio_one_movement: null,
    ratio_two_movement: null,
    repeating_ratio: false,
    max_ratio_iterations: null,
    min_ratio_iterations: null,
    
    step_by_step_movement_style: false,
    step_by_step_movement_value: null,
    
    can_hop_over_allies: false,
    can_hop_over_enemies: false,
    exact_ratio_hop_only: false,
    directional_hop_disabled: false,
    hop_stop_at_occupied: false,
    directional_hop_only: false,
    max_directional_hop_pieces: null,
    
    // Step 3: Attack/Capture Configuration
    repeating_capture: false,
    repeating_ratio_capture: false,
    max_ratio_capture_iterations: null,
    can_hop_attack_over_allies: false,
    can_hop_attack_over_enemies: false,
    exact_ratio_hop_only_attack: false,
    directional_hop_disabled_attack: false,
    hop_stop_at_occupied_attack: false,
    directional_hop_only_attack: false,
    max_directional_hop_pieces_attack: null,
    can_capture_enemy_via_range: false,
    can_capture_enemy_on_move: true,
    can_capture_ally_via_range: false,
    can_capture_ally_on_range: false,
    can_attack_on_iteration: false,
    
    up_left_attack_range: 0,
    up_attack_range: 0,
    up_right_attack_range: 0,
    right_attack_range: 0,
    down_right_attack_range: 0,
    down_attack_range: 0,
    down_left_attack_range: 0,
    left_attack_range: 0,
    
    // Capture exact flags
    up_left_capture_exact: false,
    up_capture_exact: false,
    up_right_capture_exact: false,
    right_capture_exact: false,
    down_right_capture_exact: false,
    down_capture_exact: false,
    down_left_capture_exact: false,
    left_capture_exact: false,
    
    // Capture available_for fields
    up_left_capture_available_for: null,
    up_capture_available_for: null,
    up_right_capture_available_for: null,
    right_capture_available_for: null,
    down_right_capture_available_for: null,
    down_capture_available_for: null,
    down_left_capture_available_for: null,
    left_capture_available_for: null,
    
    // Attack range exact flags
    up_left_attack_range_exact: false,
    up_attack_range_exact: false,
    up_right_attack_range_exact: false,
    right_attack_range_exact: false,
    down_right_attack_range_exact: false,
    down_attack_range_exact: false,
    down_left_attack_range_exact: false,
    left_attack_range_exact: false,
    
    // Attack range available_for fields
    up_left_attack_range_available_for: null,
    up_attack_range_available_for: null,
    up_right_attack_range_available_for: null,
    right_attack_range_available_for: null,
    down_right_attack_range_available_for: null,
    down_attack_range_available_for: null,
    down_left_attack_range_available_for: null,
    left_attack_range_available_for: null,
    
    ratio_one_attack_range: null,
    ratio_two_attack_range: null,
    repeating_directional_ranged_attack: false,
    max_directional_ranged_attack_iterations: null,
    min_directional_ranged_attack_iterations: null,
    repeating_ratio_ranged_attack: false,
    max_ratio_ranged_attack_iterations: null,
    min_ratio_ranged_attack_iterations: null,
    
    step_by_step_attack_style: false,
    step_by_step_attack_value: null,
    step_by_step_attack_range: null,
    
    capture_actions_per_turn: 1,
    ranged_capture_actions_per_turn: 1,
    can_fire_over_allies: false,
    can_fire_over_enemies: false,
    
    // Step 4: Special Rules
    special_scenario_moves: "",
    special_scenario_capture: "",
    checkmate_on_attack: false,
    check_on_attack: false,
    lose_game_on_capture: false,
    min_turns_until_movement: 0,
    can_castle: false,
    can_promote: false,
    can_en_passant: false,
    // Checkers-style options
    capture_on_hop: false,
    chain_capture_enabled: false,
    chain_hop_allies: false,
    max_chain_hops: null,
    free_move_after_promotion: false,
    // promotion_pieces_ids: piece-level default for which pieces this piece type can promote to
    // (JSON array of piece IDs). No UI control exists in the wizard yet — it is always saved as null.
    // Per-placement overrides (set in game wizard Step 4 → Promotion Options) are stored in
    // game_type_pieces.promotion_pieces_override instead, which IS exposed in the UI.
    // The AI engine (export-game-rules.js, moves.rs) and getPromotionOptions() read this field
    // as a fallback when promotion_pieces_override is null.
    promotion_pieces_ids: null,
    // Can capture allies
    can_capture_allies: false,
    // Cannot be captured
    cannot_be_captured: false,
    // Must-move-if-able (e.g., Duck Chess)
    must_move_if_able: false,
    must_move_uses_action: false,
    // Custom movement/attack squares (JSON array of {row, col} offsets)
    custom_movement_squares: null,
    custom_attack_squares: null,
    // Direction change (movement)
    directional_movement_change: false,
    up_left_movement_change: 0, up_movement_change: 0, up_right_movement_change: 0, right_movement_change: 0,
    down_right_movement_change: 0, down_movement_change: 0, down_left_movement_change: 0, left_movement_change: 0,
    up_left_movement_change_exact: false, up_movement_change_exact: false, up_right_movement_change_exact: false, right_movement_change_exact: false,
    down_right_movement_change_exact: false, down_movement_change_exact: false, down_left_movement_change_exact: false, left_movement_change_exact: false,
    up_left_movement_change_available_for: null, up_movement_change_available_for: null, up_right_movement_change_available_for: null, right_movement_change_available_for: null,
    down_right_movement_change_available_for: null, down_movement_change_available_for: null, down_left_movement_change_available_for: null, left_movement_change_available_for: null,
    repeating_movement_change: false,
    require_empty_via_movement: false,
    // Direction change (capture)
    directional_capture_change: false,
    up_left_capture_change: 0, up_capture_change: 0, up_right_capture_change: 0, right_capture_change: 0,
    down_right_capture_change: 0, down_capture_change: 0, down_left_capture_change: 0, left_capture_change: 0,
    up_left_capture_change_exact: false, up_capture_change_exact: false, up_right_capture_change_exact: false, right_capture_change_exact: false,
    down_right_capture_change_exact: false, down_capture_change_exact: false, down_left_capture_change_exact: false, left_capture_change_exact: false,
    up_left_capture_change_available_for: null, up_capture_change_available_for: null, up_right_capture_change_available_for: null, right_capture_change_available_for: null,
    down_right_capture_change_available_for: null, down_capture_change_available_for: null, down_left_capture_change_available_for: null, left_capture_change_available_for: null,
    repeating_capture_change: false,
    require_empty_via_capture: false,
    require_direction_change: false,
    require_direction_change_capture: false,
  });

  // Load existing piece data when in edit mode
  useEffect(() => {
    const loadPieceData = async () => {
      if (editPieceId) {
        try {
          const piece = await getPieceById(editPieceId);
          
          // Check if user has permission to edit
          const role = (currentUser?.role || "").toLowerCase();
          const isPrivileged = role === "admin" || role === "owner";
          if (Number(piece.creator_id) !== Number(currentUser?.id) && !isPrivileged) {
            navigate("/create/pieces");
            return;
          }
          
          // Parse existing images
          let imagePreviews = [];
          try {
            const images = JSON.parse(piece.image_location || "[]");
            imagePreviews = images.map(img => 
              img.startsWith('http') ? img : `${process.env.REACT_APP_ASSET_URL || ""}${img}`
            );
            setExistingImages(images);
          } catch (e) {
            console.log("Error parsing images:", e);
          }
          
          // Map database fields to state
          // Detect "has any ranged attack" by inspecting all directional/ratio
          // attack-range values. The flag may be missing or false on legacy
          // pieces even if they have non-zero ranged-attack data, so we OR
          // it with any actual ranged-attack values to keep the wizard's
          // "Enable ranged attack" toggle in sync with the underlying data.
          const hasAnyRangedAttack = !!piece.can_capture_enemy_via_range
            || (piece.up_attack_range || 0) > 0
            || (piece.down_attack_range || 0) > 0
            || (piece.left_attack_range || 0) > 0
            || (piece.right_attack_range || 0) > 0
            || (piece.up_left_attack_range || 0) > 0
            || (piece.up_right_attack_range || 0) > 0
            || (piece.down_left_attack_range || 0) > 0
            || (piece.down_right_attack_range || 0) > 0
            || (piece.ratio_one_attack_range || 0) > 0
            || (piece.ratio_two_attack_range || 0) > 0;

          setPieceData({
            piece_name: piece.piece_name || "",
            piece_description: piece.piece_description || "",
            piece_category: piece.piece_category || "",
            piece_images: [],
            piece_image_previews: imagePreviews,
            piece_width: piece.piece_width || 1,
            piece_height: piece.piece_height || 1,
            
            // Movement fields
            directional_movement_style: !!piece.directional_movement_style,
            repeating_movement: !!piece.repeating_movement,
            max_directional_movement_iterations: piece.max_directional_movement_iterations,
            min_directional_movement_iterations: piece.min_directional_movement_iterations,
            up_left_movement: piece.up_left_movement || 0,
            up_movement: piece.up_movement || 0,
            up_right_movement: piece.up_right_movement || 0,
            right_movement: piece.right_movement || 0,
            down_right_movement: piece.down_right_movement || 0,
            down_movement: piece.down_movement || 0,
            down_left_movement: piece.down_left_movement || 0,
            left_movement: piece.left_movement || 0,
            
            // Movement exact flags
            up_left_movement_exact: !!piece.up_left_movement_exact,
            up_movement_exact: !!piece.up_movement_exact,
            up_right_movement_exact: !!piece.up_right_movement_exact,
            right_movement_exact: !!piece.right_movement_exact,
            down_right_movement_exact: !!piece.down_right_movement_exact,
            down_movement_exact: !!piece.down_movement_exact,
            down_left_movement_exact: !!piece.down_left_movement_exact,
            left_movement_exact: !!piece.left_movement_exact,
            
            // Movement available_for fields
            up_left_movement_available_for: piece.up_left_movement_available_for,
            up_movement_available_for: piece.up_movement_available_for,
            up_right_movement_available_for: piece.up_right_movement_available_for,
            right_movement_available_for: piece.right_movement_available_for,
            down_right_movement_available_for: piece.down_right_movement_available_for,
            down_movement_available_for: piece.down_movement_available_for,
            down_left_movement_available_for: piece.down_left_movement_available_for,
            left_movement_available_for: piece.left_movement_available_for,
            
            ratio_movement_style: !!piece.ratio_movement_style,
            ratio_one_movement: piece.ratio_one_movement,
            ratio_two_movement: piece.ratio_two_movement,
            repeating_ratio: !!piece.repeating_ratio,
            max_ratio_iterations: piece.max_ratio_iterations,
            min_ratio_iterations: piece.min_ratio_iterations,
            
            step_by_step_movement_style: !!piece.step_by_step_movement_style,
            step_by_step_movement_value: piece.step_by_step_movement_value,
            
            can_hop_over_allies: !!piece.can_hop_over_allies,
            can_hop_over_enemies: !!piece.can_hop_over_enemies,
            exact_ratio_hop_only: !!piece.exact_ratio_hop_only,
            directional_hop_disabled: !!piece.directional_hop_disabled,
            hop_stop_at_occupied: piece.hop_stop_at_occupied !== undefined ? !!piece.hop_stop_at_occupied : true,
            directional_hop_only: !!piece.directional_hop_only,
            max_directional_hop_pieces: piece.max_directional_hop_pieces != null ? parseInt(piece.max_directional_hop_pieces) || null : null,
            
            // Attack/Capture fields
            repeating_capture: !!piece.repeating_capture,
            can_hop_attack_over_allies: !!piece.can_hop_attack_over_allies,
            can_hop_attack_over_enemies: !!piece.can_hop_attack_over_enemies,
            exact_ratio_hop_only_attack: !!piece.exact_ratio_hop_only_attack,
            directional_hop_disabled_attack: !!piece.directional_hop_disabled_attack,
            hop_stop_at_occupied_attack: piece.hop_stop_at_occupied_attack !== undefined ? !!piece.hop_stop_at_occupied_attack : false,
            directional_hop_only_attack: !!piece.directional_hop_only_attack,
            max_directional_hop_pieces_attack: piece.max_directional_hop_pieces_attack != null ? parseInt(piece.max_directional_hop_pieces_attack) || null : null,
            can_capture_enemy_via_range: hasAnyRangedAttack,
            can_capture_ally_via_range: !!piece.can_capture_ally_via_range,
            can_capture_enemy_on_move: !!piece.can_capture_enemy_on_move,
            can_capture_ally_on_range: !!piece.can_capture_ally_on_range,
            can_attack_on_iteration: !!piece.can_attack_on_iteration,
            
            // Capture on move directions
            up_left_capture: piece.up_left_capture || 0,
            up_capture: piece.up_capture || 0,
            up_right_capture: piece.up_right_capture || 0,
            right_capture: piece.right_capture || 0,
            down_right_capture: piece.down_right_capture || 0,
            down_capture: piece.down_capture || 0,
            down_left_capture: piece.down_left_capture || 0,
            left_capture: piece.left_capture || 0,
            
            // Capture exact flags
            up_left_capture_exact: !!piece.up_left_capture_exact,
            up_capture_exact: !!piece.up_capture_exact,
            up_right_capture_exact: !!piece.up_right_capture_exact,
            right_capture_exact: !!piece.right_capture_exact,
            down_right_capture_exact: !!piece.down_right_capture_exact,
            down_capture_exact: !!piece.down_capture_exact,
            down_left_capture_exact: !!piece.down_left_capture_exact,
            left_capture_exact: !!piece.left_capture_exact,
            
            // Capture available_for fields
            up_left_capture_available_for: piece.up_left_capture_available_for,
            up_capture_available_for: piece.up_capture_available_for,
            up_right_capture_available_for: piece.up_right_capture_available_for,
            right_capture_available_for: piece.right_capture_available_for,
            down_right_capture_available_for: piece.down_right_capture_available_for,
            down_capture_available_for: piece.down_capture_available_for,
            down_left_capture_available_for: piece.down_left_capture_available_for,
            left_capture_available_for: piece.left_capture_available_for,
            
            ratio_one_capture: piece.ratio_one_capture,
            ratio_two_capture: piece.ratio_two_capture,
            repeating_ratio_capture: !!piece.repeating_ratio_capture,
            max_ratio_capture_iterations: piece.max_ratio_capture_iterations ?? null,
            step_by_step_capture: piece.step_by_step_capture,
            
            // Ranged attack ranges
            up_left_attack_range: piece.up_left_attack_range || 0,
            up_attack_range: piece.up_attack_range || 0,
            up_right_attack_range: piece.up_right_attack_range || 0,
            right_attack_range: piece.right_attack_range || 0,
            down_right_attack_range: piece.down_right_attack_range || 0,
            down_attack_range: piece.down_attack_range || 0,
            down_left_attack_range: piece.down_left_attack_range || 0,
            left_attack_range: piece.left_attack_range || 0,
            
            // Attack range exact flags
            up_left_attack_range_exact: !!piece.up_left_attack_range_exact,
            up_attack_range_exact: !!piece.up_attack_range_exact,
            up_right_attack_range_exact: !!piece.up_right_attack_range_exact,
            right_attack_range_exact: !!piece.right_attack_range_exact,
            down_right_attack_range_exact: !!piece.down_right_attack_range_exact,
            down_attack_range_exact: !!piece.down_attack_range_exact,
            down_left_attack_range_exact: !!piece.down_left_attack_range_exact,
            left_attack_range_exact: !!piece.left_attack_range_exact,
            
            // Attack range available_for fields
            up_left_attack_range_available_for: piece.up_left_attack_range_available_for,
            up_attack_range_available_for: piece.up_attack_range_available_for,
            up_right_attack_range_available_for: piece.up_right_attack_range_available_for,
            right_attack_range_available_for: piece.right_attack_range_available_for,
            down_right_attack_range_available_for: piece.down_right_attack_range_available_for,
            down_attack_range_available_for: piece.down_attack_range_available_for,
            down_left_attack_range_available_for: piece.down_left_attack_range_available_for,
            left_attack_range_available_for: piece.left_attack_range_available_for,
            
            repeating_directional_ranged_attack: !!piece.repeating_directional_ranged_attack,
            max_directional_ranged_attack_iterations: piece.max_directional_ranged_attack_iterations,
            min_directional_ranged_attack_iterations: piece.min_directional_ranged_attack_iterations,
            
            ratio_one_attack_range: piece.ratio_one_attack_range,
            ratio_two_attack_range: piece.ratio_two_attack_range,
            repeating_ratio_ranged_attack: !!piece.repeating_ratio_ranged_attack,
            max_ratio_ranged_attack_iterations: piece.max_ratio_ranged_attack_iterations,
            min_ratio_ranged_attack_iterations: piece.min_ratio_ranged_attack_iterations,
            
            step_by_step_attack_style: !!piece.step_by_step_attack_style,
            step_by_step_attack_value: piece.step_by_step_attack_value,
            step_by_step_attack_range: (piece.step_by_step_attack_value != null && piece.step_by_step_attack_value !== 0)
              ? (piece.step_by_step_attack_style ? -Math.abs(piece.step_by_step_attack_value) : piece.step_by_step_attack_value)
              : null,
            
            capture_actions_per_turn: piece.capture_actions_per_turn || 1,
            ranged_capture_actions_per_turn: piece.ranged_capture_actions_per_turn || 1,
            
            // Ranged attack firing over pieces
            can_fire_over_allies: !!piece.can_fire_over_allies,
            can_fire_over_enemies: !!piece.can_fire_over_enemies,
            
            attacks_like_movement: false,
            
            // Special rules - map database fields to form fields
            special_scenario_moves: piece.special_scenario_moves || "",
            special_scenario_capture: piece.special_scenario_captures || "",
            checkmate_on_attack: !!piece.has_checkmate_rule,
            check_on_attack: !!piece.has_check_rule,
            lose_game_on_capture: !!piece.has_lose_on_capture_rule,
            min_turns_until_movement: piece.min_turns_per_move || 0,
            can_castle: !!piece.can_castle,
            can_promote: !!piece.can_promote,
            can_en_passant: !!piece.can_en_passant,
            // Checkers-style options
            capture_on_hop: !!piece.capture_on_hop,
            chain_capture_enabled: !!piece.chain_capture_enabled,
            chain_hop_allies: !!piece.chain_hop_allies,
            max_chain_hops: piece.max_chain_hops ?? null,
            free_move_after_promotion: !!piece.free_move_after_promotion,
            // Round-tripped from DB so existing values aren't clobbered on save.
            // No wizard UI for this field — see defaultPieceData comment above.
            promotion_pieces_ids: piece.promotion_pieces_ids || null,
            can_capture_allies: !!piece.can_capture_allies,
            cannot_be_captured: !!piece.cannot_be_captured,
            must_move_if_able: !!piece.must_move_if_able,
            must_move_uses_action: !!piece.must_move_uses_action,
            custom_movement_squares: piece.custom_movement_squares || null,
            custom_attack_squares: piece.custom_attack_squares || null,
            // Direction change (movement)
            directional_movement_change: !!piece.directional_movement_change,
            up_left_movement_change: piece.up_left_movement_change || 0,
            up_movement_change: piece.up_movement_change || 0,
            up_right_movement_change: piece.up_right_movement_change || 0,
            right_movement_change: piece.right_movement_change || 0,
            down_right_movement_change: piece.down_right_movement_change || 0,
            down_movement_change: piece.down_movement_change || 0,
            down_left_movement_change: piece.down_left_movement_change || 0,
            left_movement_change: piece.left_movement_change || 0,
            up_left_movement_change_exact: !!piece.up_left_movement_change_exact,
            up_movement_change_exact: !!piece.up_movement_change_exact,
            up_right_movement_change_exact: !!piece.up_right_movement_change_exact,
            right_movement_change_exact: !!piece.right_movement_change_exact,
            down_right_movement_change_exact: !!piece.down_right_movement_change_exact,
            down_movement_change_exact: !!piece.down_movement_change_exact,
            down_left_movement_change_exact: !!piece.down_left_movement_change_exact,
            left_movement_change_exact: !!piece.left_movement_change_exact,
            up_left_movement_change_available_for: piece.up_left_movement_change_available_for ?? null,
            up_movement_change_available_for: piece.up_movement_change_available_for ?? null,
            up_right_movement_change_available_for: piece.up_right_movement_change_available_for ?? null,
            right_movement_change_available_for: piece.right_movement_change_available_for ?? null,
            down_right_movement_change_available_for: piece.down_right_movement_change_available_for ?? null,
            down_movement_change_available_for: piece.down_movement_change_available_for ?? null,
            down_left_movement_change_available_for: piece.down_left_movement_change_available_for ?? null,
            left_movement_change_available_for: piece.left_movement_change_available_for ?? null,
            repeating_movement_change: !!piece.repeating_movement_change,
            require_empty_via_movement: !!piece.require_empty_via_movement,
            // Direction change (capture)
            directional_capture_change: !!piece.directional_capture_change,
            up_left_capture_change: piece.up_left_capture_change || 0,
            up_capture_change: piece.up_capture_change || 0,
            up_right_capture_change: piece.up_right_capture_change || 0,
            right_capture_change: piece.right_capture_change || 0,
            down_right_capture_change: piece.down_right_capture_change || 0,
            down_capture_change: piece.down_capture_change || 0,
            down_left_capture_change: piece.down_left_capture_change || 0,
            left_capture_change: piece.left_capture_change || 0,
            up_left_capture_change_exact: !!piece.up_left_capture_change_exact,
            up_capture_change_exact: !!piece.up_capture_change_exact,
            up_right_capture_change_exact: !!piece.up_right_capture_change_exact,
            right_capture_change_exact: !!piece.right_capture_change_exact,
            down_right_capture_change_exact: !!piece.down_right_capture_change_exact,
            down_capture_change_exact: !!piece.down_capture_change_exact,
            down_left_capture_change_exact: !!piece.down_left_capture_change_exact,
            left_capture_change_exact: !!piece.left_capture_change_exact,
            up_left_capture_change_available_for: piece.up_left_capture_change_available_for ?? null,
            up_capture_change_available_for: piece.up_capture_change_available_for ?? null,
            up_right_capture_change_available_for: piece.up_right_capture_change_available_for ?? null,
            right_capture_change_available_for: piece.right_capture_change_available_for ?? null,
            down_right_capture_change_available_for: piece.down_right_capture_change_available_for ?? null,
            down_capture_change_available_for: piece.down_capture_change_available_for ?? null,
            down_left_capture_change_available_for: piece.down_left_capture_change_available_for ?? null,
            left_capture_change_available_for: piece.left_capture_change_available_for ?? null,
            repeating_capture_change: !!piece.repeating_capture_change,
            require_empty_via_capture: !!piece.require_empty_via_capture,
            require_direction_change: !!piece.require_direction_change,
            require_direction_change_capture: !!piece.require_direction_change_capture,
          });
          
          setIsEditMode(true);
          setIsDraftMode(!!piece.is_draft);
          if (piece.is_draft && piece.draft_saved_step) {
            setCurrentStep(Math.min(4, Math.max(1, Number(piece.draft_saved_step))));
          }
        } catch (error) {
          console.error("Error loading piece:", error);
          navigate("/create/pieces");
        } finally {
          setIsLoading(false);
        }
      }
    };
    
    loadPieceData();
  }, [editPieceId, currentUser, navigate]);

  const totalSteps = 4;
  
  const stepLabels = [
    { num: 1, label: 'Basic Info' },
    { num: 2, label: 'Movement' },
    { num: 3, label: 'Attack' },
    { num: 4, label: 'Special' }
  ];

  const goToStep = (step) => {
    setCurrentStep(step);
  };

  const updatePieceData = (updates) => {
    setPieceData(prev => ({ ...prev, ...updates }));
  };

  const nextStep = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  // Build an object keyed by DB column names from form state, for duplicate checking.
  const buildDuplicateCheckFields = () => {
    const fieldMapping = {
      special_scenario_capture: 'special_scenario_captures',
      checkmate_on_attack: 'has_checkmate_rule',
      check_on_attack: 'has_check_rule',
      lose_game_on_capture: 'has_lose_on_capture_rule',
      min_turns_until_movement: 'min_turns_per_move',
    };
    const skipKeys = new Set([
      'piece_name', 'piece_description', 'piece_category',
      'piece_images', 'piece_image_previews', 'piece_image_sources',
      'is_anonymous_creator',
    ]);
    const fields = {};
    Object.keys(pieceData).forEach(key => {
      if (skipKeys.has(key)) return;
      const dbKey = fieldMapping[key] || key;
      fields[dbKey] = pieceData[key];
    });
    return fields;
  };

  const handleSubmit = async (bypassDuplicateCheck = false, bypassRatioWarning = false, asDraft = false, opts = {}) => {
    // Collect all missing required fields
    const missing = [];
    
    if (!pieceData.piece_name || pieceData.piece_name.trim().length < 2) {
      missing.push({ field: 'Piece Name (at least 2 characters)', step: 1 });
    }
    
    const hasP1 = pieceData.piece_image_previews?.[0] || (isEditMode && existingImages[0]);
    const hasP2 = pieceData.piece_image_previews?.[1] || (isEditMode && existingImages[1]);
    if (!asDraft) {
      if (!hasP1) {
        missing.push({ field: 'Player 1 (light) image', step: 1 });
      }
      if (!hasP2) {
        missing.push({ field: 'Player 2 (dark) image', step: 1 });
      }
    }
    
    if (missing.length > 0) {
      setMissingFields(missing);
      return;
    }

    // Warn if exactly one ratio value is set — ratio movement needs both to work.
    if (!asDraft && !bypassRatioWarning) {
      const r1 = pieceData.ratio_one_movement || 0;
      const r2 = pieceData.ratio_two_movement || 0;
      if ((r1 > 0) !== (r2 > 0)) {
        setRatioZeroWarning(true);
        return;
      }
    }

    // Duplicate ruleset check — skip if user clicked "Save Anyway" or saving a draft
    if (!asDraft && !bypassDuplicateCheck) {      const normalizedFields = buildDuplicateCheckFields();
      const { matches } = await checkPieceDuplicates(
        normalizedFields,
        isEditMode ? editPieceId : null
      );
      if (matches && matches.length > 0) {
        const nameSame = matches.some(
          m => m.piece_name.trim().toLowerCase() === pieceData.piece_name.trim().toLowerCase()
        );
        setDuplicateWarning({ matches, nameSame });
        return;
      }
    }

    // Content moderation validation
    if (pieceData.piece_name) {
      const nameCheck = validateContent(pieceData.piece_name, { fieldName: 'Piece name', maxLength: 50 });
      if (!nameCheck.isValid) {
        alert(nameCheck.errors[0]);
        return;
      }
    }
    if (pieceData.piece_description) {
      const descCheck = validateContent(pieceData.piece_description, { fieldName: 'Piece description', maxLength: 1000, allowLinks: true });
      if (!descCheck.isValid) {
        alert(descCheck.errors[0]);
        return;
      }
    }

    setIsSubmitting(true);
    if (asDraft) setIsSavingDraft(true);
    
    try {
      // Prepare the final piece data
      const formData = new FormData();
      
      // Add all piece images (only new ones)
      const images = pieceData.piece_images.filter(img => img !== null && img !== undefined);
      images.forEach(image => {
        formData.append('piece_images', image);
      });

      // Send image source tracking (library vs upload) for moderation
      const sources = (pieceData.piece_image_sources || []).filter((_, i) => pieceData.piece_images[i] != null);
      formData.append('image_sources', JSON.stringify(sources));
      
      // If editing, preserve existing images
      if (isEditMode && existingImages.length > 0) {
        formData.append('existing_images', JSON.stringify(existingImages));
      }
      
      // Add all other piece data (excluding image-related fields)
      // Convert booleans to strings explicitly
      // Map form fields to database fields
      const fieldMapping = {
        'special_scenario_capture': 'special_scenario_captures',
        'checkmate_on_attack': 'has_checkmate_rule',
        'check_on_attack': 'has_check_rule',
        'lose_game_on_capture': 'has_lose_on_capture_rule',
        'min_turns_until_movement': 'min_turns_per_move'
      };
      
      // Skip database field names that should be mapped from form fields
      const skipFields = ['special_scenario_captures', 'has_checkmate_rule', 
                          'has_check_rule', 'has_lose_on_capture_rule', 'min_turns_per_move',
                          'step_by_step_attack_range', 'step_by_step_attack_style', 'step_by_step_attack_value'];

      // Compute step-by-step ranged attack DB columns from the combined field
      const sarVal = pieceData.step_by_step_attack_range;
      if (sarVal != null && sarVal !== 0) {
        formData.append('step_by_step_attack_style', sarVal < 0 ? 'true' : 'false');
        formData.append('step_by_step_attack_value', String(Math.abs(sarVal)));
      } else {
        formData.append('step_by_step_attack_style', 'false');
        formData.append('step_by_step_attack_value', '');
      }
      
      Object.keys(pieceData).forEach(key => {
        if (key !== 'piece_images' && key !== 'piece_image_previews' && key !== 'piece_image_sources' && key !== 'is_anonymous_creator' && !skipFields.includes(key)) {
          const value = pieceData[key];
          const dbFieldName = fieldMapping[key] || key;
          
          // Handle booleans explicitly
          if (typeof value === 'boolean') {
            formData.append(dbFieldName, value ? 'true' : 'false');
          } else if (value !== null && value !== undefined) {
            formData.append(dbFieldName, value);
          }
        }
      });
      
      formData.append('creator_id', currentUser ? currentUser.id : '');
      formData.append('user_role', currentUser ? currentUser.role : '');
      formData.append('is_anonymous_creator', !currentUser || pieceData.is_anonymous_creator ? 'true' : 'false');
      formData.append('is_draft', asDraft ? 'true' : 'false');
      if (asDraft) formData.append('draft_saved_step', String(currentStep));
      // Duplicate: append a name suffix so the copy is distinguishable.
      if (opts.nameSuffix) {
        const baseName = (pieceData.piece_name || 'Untitled').trim();
        formData.set('piece_name', `${baseName}${opts.nameSuffix}`.slice(0, 100));
      }
      
      const forceCreate = !!opts.forceCreate;
      if (isEditMode && editPieceId && !forceCreate) {
        // Update existing piece
        await updatePiece(editPieceId, formData);
        dispatch(invalidatePieceValueCache(editPieceId));
        trackEvent('Piece', asDraft ? 'SaveDraft' : 'Update', pieceData.piece_name);
        navigate("/create/pieces");
      } else {
        // Create new piece (fresh, draft save, or duplicate of current state)
        const result = await createPiece(formData);
        trackPieceCreation(pieceData.piece_name);
        if ((asDraft || forceCreate) && result?.result?.id) {
          navigate(`/create/piece/edit/${result.result.id}`);
        } else {
          navigate("/create/pieces");
        }
      }
    } catch (error) {
      console.error(isEditMode ? "Error updating piece:" : "Error creating piece:", error);
      setSubmitError(error || 'Failed to save piece. Please try again.');
    } finally {
      setIsSubmitting(false);
      setIsSavingDraft(false);
    }
  };

  const handleSaveDraft = () => handleSubmit(true, true, true);

  // Duplicate: save the CURRENT editor state as a brand-new draft copy and open it.
  const handleDuplicateAsDraft = () => handleSubmit(true, true, true, { forceCreate: true, nameSuffix: ' (Copy)' });

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <PieceStep1BasicInfo pieceData={pieceData} updatePieceData={updatePieceData} isEditMode={isEditMode} existingImages={existingImages} setExistingImages={setExistingImages} currentUser={currentUser} />;
      case 2:
        return <PieceStep2Movement pieceData={pieceData} updatePieceData={updatePieceData} />;
      case 3:
        return <PieceStep3Attack pieceData={pieceData} updatePieceData={updatePieceData} />;
      case 4:
        return <PieceStep4Special pieceData={pieceData} updatePieceData={updatePieceData} />;
      default:
        return null;
    }
  };

  if (!currentUser && !editPieceId) {
    return (
      <div className={styles["wizard-container"]}>
        <div className={styles["wizard-header"]}>
          <h1>Create New Piece</h1>
        </div>
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <p style={{ fontSize: '1.1rem', marginBottom: '20px', color: 'var(--text-muted)' }}>You need to be logged in to create pieces.</p>
          <Link to="/login" style={{ color: 'var(--accent-primary)', fontSize: '1.1rem' }}>Log in to get started</Link>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={styles["wizard-container"]}>
        <div className={styles["loading-state"]}>
          <p>Loading piece data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles["wizard-container"]}>
      <div className={styles["wizard-header"]}>
        <h1>{isEditMode ? (isDraftMode ? "Edit Draft Piece" : "Edit Piece") : "Create New Piece"}</h1>
        {isDraftMode && (
          <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 4, background: '#8a6d3b', color: '#fff', fontSize: '0.75rem', fontWeight: 700, verticalAlign: 'middle' }}>DRAFT</span>
        )}
      </div>

      <div className={styles["progress-bar"]}>
        {stepLabels.map((step) => (
          <div 
            key={step.num}
            className={`${styles["progress-step"]} ${currentStep === step.num ? styles.active : ''} ${currentStep > step.num ? styles.completed : ''}`}
            onClick={() => goToStep(step.num)}
          >
            <span className={styles["step-circle"]}>{step.num}</span>
            <span className={styles["step-label"]}>{step.label}</span>
          </div>
        ))}
      </div>

      <Divider />

      <div className={styles["wizard-content"]}>
        {renderStep()}
      </div>

      <Divider />

      {submitError && (
        <div style={{ color: 'var(--error-color, #e74c3c)', background: 'var(--error-bg, rgba(231,76,60,0.1))', border: '1px solid var(--error-color, #e74c3c)', borderRadius: '6px', padding: '12px 16px', margin: '0 0 12px 0', textAlign: 'center' }}>
          {typeof submitError === 'string' ? submitError : submitError}
        </div>
      )}

      <div className={styles["wizard-navigation"]}>
        <div className={styles["nav-buttons"]}>
          {currentStep > 1 ? (
            <StandardButton 
              buttonText="Previous" 
              onClick={prevStep}
              disabled={isSubmitting}
            />
          ) : (
            <div />
          )}
          
          {currentStep < totalSteps && (
            <StandardButton 
              buttonText="Next" 
              onClick={nextStep}
            />
          )}
          
          {currentStep === totalSteps && (
            <StandardButton 
              buttonText={isSubmitting ? (isEditMode ? "Saving..." : "Creating...") : (isEditMode ? "Save Changes" : "Create Piece")} 
              onClick={handleSubmit}
              disabled={isSubmitting}
            />
          )}

          {currentUser && (
            <StandardButton 
              buttonText={isSavingDraft ? "Saving..." : "\uD83D\uDCBE Save as Draft"} 
              onClick={handleSaveDraft}
              disabled={isSubmitting || isSavingDraft}
            />
          )}

          {isEditMode && currentUser && (
            <StandardButton 
              buttonText="⧉ Duplicate as Draft" 
              onClick={handleDuplicateAsDraft}
              disabled={isSubmitting || isSavingDraft}
            />
          )}

          {isEditMode && currentStep < totalSteps && (
            <StandardButton 
              buttonText={isSubmitting ? "Saving..." : "Save and Exit"} 
              onClick={handleSubmit}
              disabled={isSubmitting}
            />
          )}
        </div>
      </div>

      {ratioZeroWarning && (
        <div className={styles["warning-overlay"]}>
          <div className={styles["warning-modal"]}>
            <h3>⚠️ Incomplete Ratio Movement</h3>
            <p>
              Only one of <strong>Ratio One</strong> and <strong>Ratio Two</strong> is set.
              Ratio (L-shape) movement needs <strong>both</strong> values to work, so the piece cannot make any ratio moves.
            </p>
            <p>Go back to Step 2 and set both ratio values, or clear both to disable ratio movement.</p>
            <div className={styles["warning-buttons"]}>
              <StandardButton
                buttonText="Fix It"
                onClick={() => setRatioZeroWarning(false)}
              />
              <StandardButton
                buttonText="Save Anyway"
                onClick={() => { setRatioZeroWarning(false); handleSubmit(false, true); }}
              />
            </div>
          </div>
        </div>
      )}

      {missingFields && (
        <div className={styles["warning-overlay"]}>
          <div className={styles["warning-modal"]}>
            <h3>⚠️ Required Fields Missing</h3>
            <p>Please fill in the following required fields before submitting:</p>
            <ul className={styles["missing-fields-list"]}>
              {missingFields.map((item, i) => (
                <li key={i}>
                  <strong>{item.field}</strong> <span className={styles["step-ref"]}>(Step {item.step}: {stepLabels[item.step - 1].label})</span>
                </li>
              ))}
            </ul>
            <div className={styles["warning-buttons"]}>
              <StandardButton 
                buttonText="OK" 
                onClick={() => setMissingFields(null)}
              />
            </div>
          </div>
        </div>
      )}

      {duplicateWarning && (
        <div className={styles["warning-overlay"]}>
          <div className={styles["warning-modal"]}>
            <h3>⚠️ Duplicate Ruleset Detected</h3>
            <p>
              The following piece{duplicateWarning.matches.length > 1 ? 's' : ''} already
              {duplicateWarning.matches.length > 1 ? ' have' : ' has'} the exact same
              movement, capture, and special rules as this piece (name, images, description,
              and category are not compared):
            </p>
            <ul className={styles["missing-fields-list"]}>
              {duplicateWarning.matches.map(m => (
                <li key={m.id}>
                  <Link
                    to={`/pieces/${m.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent-primary)' }}
                  >
                    {m.piece_name}
                  </Link>
                  {' '}by {m.is_anonymous_creator ? 'Anonymous' : m.creator_username}
                </li>
              ))}
            </ul>
            {duplicateWarning.nameSame && (
              <p style={{ color: '#f59e0b', fontWeight: 600 }}>
                One or more of the matching pieces also shares the same name as this piece.
                Pieces that are redundant duplicates of existing pieces risk being removed.
              </p>
            )}
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9em' }}>
              You can still save this piece if it is intentional.
            </p>
            <div className={styles["warning-buttons"]}>
              <StandardButton
                buttonText="Go Back"
                onClick={() => setDuplicateWarning(null)}
              />
              <StandardButton
                buttonText="Save Anyway"
                onClick={() => { setDuplicateWarning(null); handleSubmit(true); }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PieceWizard;
