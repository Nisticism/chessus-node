import React, { useState } from "react";
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from "react-redux";
import styles from "./piecewizard.module.scss";
import StandardButton from "../standardbutton/StardardButton";
import Divider from "../Divider/Divider";
import { createPiece } from "../../actions/pieces";
import PieceStep1BasicInfo from "./PieceStep1BasicInfo";
import PieceStep2Movement from "./PieceStep2Movement";
import PieceStep3Attack from "./PieceStep3Attack";
import PieceStep4Special from "./PieceStep4Special";

const PieceWizard = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
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
    can_capture_enemy_on_move: true,
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
    special_scenario_moves: "",
    special_scenario_captures: "",
    has_checkmate_rule: false,
    has_check_rule: false,
    has_lose_on_capture_rule: false,
    min_turns_per_move: null,
  });

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
      
      // Add all piece images
      const images = pieceData.piece_images.filter(img => img !== null && img !== undefined);
      images.forEach(image => {
        formData.append('piece_images', image);
      });
      
      // Add all other piece data (excluding image-related fields)
      Object.keys(pieceData).forEach(key => {
        if (key !== 'piece_images' && key !== 'piece_image_previews') {
          formData.append(key, pieceData[key]);
        }
      });
      
      formData.append('creator_id', currentUser.id);
      
      // Call the action directly without dispatch (it's not a Redux action)
      await createPiece(formData);
      
      // Navigate to success page or piece list
      navigate("/create");
    } catch (error) {
      console.error("Error creating piece:", error);
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

  return (
    <div className={styles["wizard-container"]}>
      <div className={styles["wizard-header"]}>
        <h1>Create New Piece</h1>
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
              buttonText={isSubmitting ? "Creating..." : "Create Piece"} 
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
