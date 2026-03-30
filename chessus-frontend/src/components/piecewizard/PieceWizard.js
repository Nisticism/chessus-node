import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from 'react-router-dom';
import { useSelector } from "react-redux";
import styles from "./piecewizard.module.scss";
import StandardButton from "../standardbutton/StandardButton";
import Divider from "../Divider/Divider";
import { createPiece, updatePiece, getPieceById } from "../../actions/pieces";
import { trackPieceCreation, trackEvent } from "../../analytics/GoogleAnalytics";
import PieceStep1BasicInfo from "./PieceStep1BasicInfo";
import PieceStep2Movement from "./PieceStep2Movement";
import PieceStep3Attack from "./PieceStep3Attack";
import PieceStep4Special from "./PieceStep4Special";

const PieceWizard = ({ editPieceId = null }) => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const navigate = useNavigate();
  
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(!!editPieceId);
  const [isEditMode, setIsEditMode] = useState(!!editPieceId);
  const [existingImages, setExistingImages] = useState([]);
  
  // Track if user has manually interacted with attacks_like_movement checkbox
  const hasManuallySetAttackStyle = useRef(false);

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
    piece_width: 1,
    piece_height: 1,
    is_anonymous_creator: !currentUser,
    
    // Step 2: Movement Configuration
    directional_movement_style: false,
    repeating_movement: false,
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
    
    step_by_step_movement_style: false,
    step_by_step_movement_value: null,
    
    can_hop_over_allies: false,
    can_hop_over_enemies: false,
    exact_ratio_hop_only: false,
    directional_hop_disabled: false,
    
    // Step 3: Attack/Capture Configuration
    repeating_capture: false,
    repeating_ratio_capture: false,
    max_ratio_capture_iterations: null,
    can_hop_attack_over_allies: false,
    can_hop_attack_over_enemies: false,
    can_capture_enemy_via_range: false,
    can_capture_enemy_on_move: true,
    
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
    
    step_by_step_attack_style: false,
    step_by_step_attack_value: null,
    
    max_piece_captures_per_move: 1,
    max_piece_captures_per_ranged_attack: 1,
    
    // Ranged attack firing over pieces (like hopping for movement)
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
    free_move_after_promotion: false,
    promotion_pieces_ids: null,
    // Can capture allies
    can_capture_allies: false,
    // Cannot be captured
    cannot_be_captured: false,
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
            
            // Attack/Capture fields
            repeating_capture: !!piece.repeating_capture,
            can_hop_attack_over_allies: !!piece.can_hop_attack_over_allies,
            can_hop_attack_over_enemies: !!piece.can_hop_attack_over_enemies,
            can_capture_enemy_via_range: !!piece.can_capture_enemy_via_range,
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
            
            max_piece_captures_per_move: piece.max_piece_captures_per_move || 1,
            max_piece_captures_per_ranged_attack: piece.max_piece_captures_per_ranged_attack || 1,
            
            // Ranged attack firing over pieces
            can_fire_over_allies: !!piece.can_fire_over_allies,
            can_fire_over_enemies: !!piece.can_fire_over_enemies,
            
            // Detect if attacks like movement (compare capture pattern to movement pattern)
            // Check directional patterns match
            attacks_like_movement: piece.can_capture_enemy_on_move && 
              piece.up_left_capture === piece.up_left_movement &&
              piece.up_capture === piece.up_movement &&
              piece.up_right_capture === piece.up_right_movement &&
              piece.left_capture === piece.left_movement &&
              piece.right_capture === piece.right_movement &&
              piece.down_left_capture === piece.down_left_movement &&
              piece.down_capture === piece.down_movement &&
              piece.down_right_capture === piece.down_right_movement &&
              // Also check ratio patterns if they exist
              (piece.ratio_one_movement == null || piece.ratio_one_capture === piece.ratio_one_movement) &&
              (piece.ratio_two_movement == null || piece.ratio_two_capture === piece.ratio_two_movement),
            
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
            free_move_after_promotion: !!piece.free_move_after_promotion,
            promotion_pieces_ids: piece.promotion_pieces_ids || null,
            can_capture_allies: !!piece.can_capture_allies,
            cannot_be_captured: !!piece.cannot_be_captured,
          });
          
          setIsEditMode(true);
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

  // Auto-check "attacks_like_movement" when any movement is configured
  // Skip this logic when in edit mode - the attacks_like_movement state is already set from loaded data
  useEffect(() => {
    // Only auto-set if user hasn't manually changed it and we're not in edit mode
    if (hasManuallySetAttackStyle.current || isEditMode) {
      return;
    }
    
    // Check if any movement has been set
    const hasDirectionalMovement = 
      pieceData.up_left_movement !== 0 ||
      pieceData.up_movement !== 0 ||
      pieceData.up_right_movement !== 0 ||
      pieceData.right_movement !== 0 ||
      pieceData.down_right_movement !== 0 ||
      pieceData.down_movement !== 0 ||
      pieceData.down_left_movement !== 0 ||
      pieceData.left_movement !== 0;
    
    const hasRatioMovement = 
      pieceData.ratio_one_movement != null ||
      pieceData.ratio_two_movement != null;
    
    const hasStepByStepMovement = pieceData.step_by_step_movement_value != null;
    
    const hasAnyMovement = hasDirectionalMovement || hasRatioMovement || hasStepByStepMovement;
    
    // Helper to convert additionalMovements to additionalCaptures format
    const convertMovementsToCaptures = (specialScenarioMoves) => {
      if (!specialScenarioMoves) return null;
      try {
        const parsed = typeof specialScenarioMoves === 'string' 
          ? JSON.parse(specialScenarioMoves)
          : specialScenarioMoves;
        
        if (!parsed.additionalMovements) return null;
        
        return JSON.stringify({
          additionalCaptures: parsed.additionalMovements
        });
      } catch {
        return null;
      }
    };
    
    // Auto-check if movement exists and it's not already set
    if (hasAnyMovement && !pieceData.attacks_like_movement) {
      setPieceData(prev => {
        const convertedCaptures = convertMovementsToCaptures(prev.special_scenario_moves);
        return { 
          ...prev, 
          attacks_like_movement: true,
          can_capture_enemy_on_move: true,
          // Copy directional movement to capture
          up_left_capture: prev.up_left_movement,
          up_capture: prev.up_movement,
          up_right_capture: prev.up_right_movement,
          left_capture: prev.left_movement,
          right_capture: prev.right_movement,
          down_left_capture: prev.down_left_movement,
          down_capture: prev.down_movement,
          down_right_capture: prev.down_right_movement,
          // Copy exact flags for directional captures
          up_left_capture_exact: prev.up_left_movement_exact,
          up_capture_exact: prev.up_movement_exact,
          up_right_capture_exact: prev.up_right_movement_exact,
          left_capture_exact: prev.left_movement_exact,
          right_capture_exact: prev.right_movement_exact,
          down_left_capture_exact: prev.down_left_movement_exact,
          down_capture_exact: prev.down_movement_exact,
          down_right_capture_exact: prev.down_right_movement_exact,
          // Copy available_for flags for directional captures
          up_left_capture_available_for: prev.up_left_movement_available_for,
          up_capture_available_for: prev.up_movement_available_for,
          up_right_capture_available_for: prev.up_right_movement_available_for,
          left_capture_available_for: prev.left_movement_available_for,
          right_capture_available_for: prev.right_movement_available_for,
          down_left_capture_available_for: prev.down_left_movement_available_for,
          down_capture_available_for: prev.down_movement_available_for,
          down_right_capture_available_for: prev.down_right_movement_available_for,
          // Copy ratio movement
          ratio_one_capture: prev.ratio_one_movement,
          ratio_two_capture: prev.ratio_two_movement,
          // Copy step-by-step
          step_by_step_capture: prev.step_by_step_movement_value,
          // Copy repeating movement setting
          repeating_capture: prev.repeating_movement,
          // Copy additional movements to additional captures
          ...(convertedCaptures && { special_scenario_capture: convertedCaptures })
        };
      });
    }
  }, [
    pieceData.up_left_movement,
    pieceData.up_movement,
    pieceData.up_right_movement,
    pieceData.right_movement,
    pieceData.down_right_movement,
    pieceData.down_movement,
    pieceData.down_left_movement,
    pieceData.left_movement,
    pieceData.ratio_one_movement,
    pieceData.ratio_two_movement,
    pieceData.step_by_step_movement_value,
    pieceData.repeating_movement,
    pieceData.attacks_like_movement,
    isEditMode
  ]);

  const totalSteps = 4;
  
  const stepLabels = [
    { num: 1, label: 'Basic Info' },
    { num: 2, label: 'Movement' },
    { num: 3, label: 'Attack' },
    { num: 4, label: 'Special' }
  ];

  const goToStep = (step) => {
    // Validate Step 1 before leaving it
    if (currentStep === 1 && step > 1) {
      if (!pieceData.piece_name || pieceData.piece_name.trim().length < 2) {
        alert('Please enter a piece name (at least 2 characters) before continuing.');
        return;
      }
      // Validate 2 required images
      const hasP1 = pieceData.piece_image_previews?.[0] || (isEditMode && existingImages[0]);
      const hasP2 = pieceData.piece_image_previews?.[1] || (isEditMode && existingImages[1]);
      if (!hasP1 || !hasP2) {
        alert('Please upload images for both Player 1 (light) and Player 2 (dark).');
        return;
      }
    }
    setCurrentStep(step);
  };

  const updatePieceData = (updates) => {
    setPieceData(prev => ({ ...prev, ...updates }));
  };

  const nextStep = () => {
    // Validate Step 1: piece_name is required
    if (currentStep === 1) {
      if (!pieceData.piece_name || pieceData.piece_name.trim().length < 2) {
        alert('Please enter a piece name (at least 2 characters) before continuing.');
        return;
      }
      // Validate 2 required images
      const hasP1 = pieceData.piece_image_previews?.[0] || (isEditMode && existingImages[0]);
      const hasP2 = pieceData.piece_image_previews?.[1] || (isEditMode && existingImages[1]);
      if (!hasP1 || !hasP2) {
        alert('Please upload images for both Player 1 (light) and Player 2 (dark).');
        return;
      }
    }
    
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSubmit = async () => {
    // Validate 2 required images before submitting
    const hasP1 = pieceData.piece_image_previews?.[0] || (isEditMode && existingImages[0]);
    const hasP2 = pieceData.piece_image_previews?.[1] || (isEditMode && existingImages[1]);
    if (!hasP1 || !hasP2) {
      alert('Please upload images for both Player 1 (light) and Player 2 (dark).');
      return;
    }

    setIsSubmitting(true);
    
    try {
      // Prepare the final piece data
      const formData = new FormData();
      
      // Add all piece images (only new ones)
      const images = pieceData.piece_images.filter(img => img !== null && img !== undefined);
      images.forEach(image => {
        formData.append('piece_images', image);
      });
      
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
                          'has_check_rule', 'has_lose_on_capture_rule', 'min_turns_per_move'];
      
      Object.keys(pieceData).forEach(key => {
        if (key !== 'piece_images' && key !== 'piece_image_previews' && key !== 'is_anonymous_creator' && !skipFields.includes(key)) {
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
      
      if (isEditMode && editPieceId) {
        // Update existing piece
        await updatePiece(editPieceId, formData);
        trackEvent('Piece', 'Update', pieceData.piece_name);
        navigate("/create/pieces");
      } else {
        // Create new piece
        await createPiece(formData);
        trackPieceCreation(pieceData.piece_name);
        navigate("/create/pieces");
      }
    } catch (error) {
      console.error(isEditMode ? "Error updating piece:" : "Error creating piece:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <PieceStep1BasicInfo pieceData={pieceData} updatePieceData={updatePieceData} isEditMode={isEditMode} existingImages={existingImages} setExistingImages={setExistingImages} currentUser={currentUser} />;
      case 2:
        return <PieceStep2Movement pieceData={pieceData} updatePieceData={updatePieceData} />;
      case 3:
        return <PieceStep3Attack pieceData={pieceData} updatePieceData={updatePieceData} hasManuallySetAttackStyle={hasManuallySetAttackStyle} />;
      case 4:
        return <PieceStep4Special pieceData={pieceData} updatePieceData={updatePieceData} />;
      default:
        return null;
    }
  };

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
        <h1>{isEditMode ? "Edit Piece" : "Create New Piece"}</h1>
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

          {isEditMode && currentStep < totalSteps && (
            <StandardButton 
              buttonText={isSubmitting ? "Saving..." : "Save and Exit"} 
              onClick={handleSubmit}
              disabled={isSubmitting}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default PieceWizard;
