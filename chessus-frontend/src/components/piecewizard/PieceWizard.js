import React, { useState, useEffect } from "react";
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from "react-redux";
import styles from "./piecewizard.module.scss";
import StandardButton from "../standardbutton/StardardButton";
import Divider from "../Divider/Divider";
import { createPiece, updatePiece, getPieceById } from "../../actions/pieces";
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
  const [isLoading, setIsLoading] = useState(!!editPieceId);
  const [isEditMode, setIsEditMode] = useState(!!editPieceId);
  const [existingImages, setExistingImages] = useState([]);

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
    
    // Step 2: Movement Configuration
    directional_movement_style: false,
    repeating_movement: false,
    max_directional_movement_iterations: null,
    min_directional_movement_iterations: null,
    up_left_movement: 0,
    up_movement: 0,
    up_right_movement: 0,
    right_movement: 0,
    down_right_movement: 0,
    down_movement: 0,
    down_left_movement: 0,
    left_movement: 0,
    
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
    
    // Step 3: Attack/Capture Configuration
    can_capture_enemy_via_range: false,
    can_capture_ally_via_range: false,
    can_capture_enemy_on_move: true, // Default to true - most pieces attack how they move
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
    
    repeating_directional_ranged_attack: false,
    max_directional_ranged_attack_iterations: null,
    min_directional_ranged_attack_iterations: null,
    
    ratio_one_attack_range: null,
    ratio_two_attack_range: null,
    repeating_ratio_ranged_attack: false,
    max_ratio_ranged_attack_iterations: null,
    min_ratio_ranged_attack_iterations: null,
    
    step_by_step_attack_style: false,
    step_by_step_attack_value: null,
    
    max_piece_captures_per_move: 1,
    max_piece_captures_per_ranged_attack: 1,
    
    // Step 4: Special Rules
    special_scenario_movement: "",
    special_scenario_capture: "",
    checkmate_on_attack: false,
    check_on_attack: false,
    lose_game_on_capture: false,
    min_turns_until_movement: 0,
  });

  // Load existing piece data when in edit mode
  useEffect(() => {
    const loadPieceData = async () => {
      if (editPieceId) {
        try {
          const piece = await getPieceById(editPieceId);
          
          // Check if user has permission to edit
          if (piece.creator_id !== currentUser?.id && currentUser?.role !== "Admin") {
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
            
            // Attack/Capture fields
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
            
            // Detect if attacks like movement (compare capture pattern to movement pattern)
            attacks_like_movement: piece.can_capture_enemy_on_move && (
              (piece.up_left_capture === piece.up_left_movement &&
               piece.up_capture === piece.up_movement &&
               piece.up_right_capture === piece.up_right_movement &&
               piece.left_capture === piece.left_movement &&
               piece.right_capture === piece.right_movement &&
               piece.down_left_capture === piece.down_left_movement &&
               piece.down_capture === piece.down_movement &&
               piece.down_right_capture === piece.down_right_movement) ||
              (piece.ratio_one_attack === piece.ratio_one_movement &&
               piece.ratio_two_attack === piece.ratio_two_movement)
            ),
            
            // Special rules - map database fields to form fields
            special_scenario_movement: piece.special_scenario_moves || "",
            special_scenario_capture: piece.special_scenario_captures || "",
            checkmate_on_attack: !!piece.has_checkmate_rule,
            check_on_attack: !!piece.has_check_rule,
            lose_game_on_capture: !!piece.has_lose_on_capture_rule,
            min_turns_until_movement: piece.min_turns_per_move || 0,
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

  const totalSteps = 4;

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

  const handleSubmit = async () => {
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
        'special_scenario_movement': 'special_scenario_moves',
        'special_scenario_capture': 'special_scenario_captures',
        'checkmate_on_attack': 'has_checkmate_rule',
        'check_on_attack': 'has_check_rule',
        'lose_game_on_capture': 'has_lose_on_capture_rule',
        'min_turns_until_movement': 'min_turns_per_move'
      };
      
      Object.keys(pieceData).forEach(key => {
        if (key !== 'piece_images' && key !== 'piece_image_previews') {
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
      
      formData.append('creator_id', currentUser.id);
      formData.append('user_role', currentUser.role);
      
      if (isEditMode && editPieceId) {
        // Update existing piece
        await updatePiece(editPieceId, formData);
        navigate("/create/pieces");
      } else {
        // Create new piece
        await createPiece(formData);
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
        return <PieceStep1BasicInfo pieceData={pieceData} updatePieceData={updatePieceData} />;
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
        <div className={styles["step-indicator"]}>
          Step {currentStep} of {totalSteps}
        </div>
      </div>

      <div className={styles["progress-bar"]}>
        <div 
          className={styles["progress-fill"]} 
          style={{ width: `${(currentStep / totalSteps) * 100}%` }}
        />
      </div>

      <Divider />

      <div className={styles["wizard-content"]}>
        {renderStep()}
      </div>

      <Divider />

      <div className={styles["wizard-navigation"]}>
        <div className={styles["nav-buttons"]}>
          {currentStep > 1 && (
            <StandardButton 
              buttonText="Previous" 
              onClick={prevStep}
              disabled={isSubmitting}
            />
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
        </div>
      </div>
    </div>
  );
};

export default PieceWizard;
