import React, { useState } from "react";
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from "react-redux";
import styles from "./gamewizard.module.scss";
import StandardButton from "../standardbutton/StardardButton";
import Divider from "../Divider/Divider";
import { createGame } from "../../actions/games";
import Step1BasicInfo from "./Step1BasicInfo";
import Step2WinConditions from "./Step2WinConditions";
import Step3BoardPlayers from "./Step3BoardPlayers";
import Step4Advanced from "./Step4Advanced";

const GameWizard = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Game data state - all fields from game_types table
  const [gameData, setGameData] = useState({
    // Step 1: Basic Info
    game_name: "",
    descript: "",
    rules: "",
    
    // Step 2: Win Conditions
    mate_condition: false,
    mate_piece: null,
    capture_condition: false,
    capture_piece: null,
    value_condition: false,
    value_piece: null,
    value_max: null,
    value_title: "",
    squares_condition: false,
    squares_count: null,
    hill_condition: false,
    hill_x: null,
    hill_y: null,
    hill_turns: null,
    optional_condition: null,
    
    // Step 3: Board & Players
    board_width: 8,
    board_height: 8,
    player_count: 2,
    actions_per_turn: 1,
    
    // Step 4: Advanced Settings
    starting_piece_count: 0,
    pieces_string: "[]",
    range_squares_string: "",
    promotion_squares_string: "",
    special_squares_string: "",
    randomized_starting_positions: "",
    other_game_data: "",
  });

  const totalSteps = 4;

  const updateGameData = (updates) => {
    setGameData(prev => ({ ...prev, ...updates }));
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
      // Prepare the final game data
      const finalGameData = {
        ...gameData,
        creator_id: currentUser.id,
      };
      
      await dispatch(createGame(finalGameData));
      
      // Navigate to success page or game list
      navigate("/create");
    } catch (error) {
      console.error("Error creating game:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <Step1BasicInfo gameData={gameData} updateGameData={updateGameData} />;
      case 2:
        return <Step2WinConditions gameData={gameData} updateGameData={updateGameData} />;
      case 3:
        return <Step3BoardPlayers gameData={gameData} updateGameData={updateGameData} />;
      case 4:
        return <Step4Advanced gameData={gameData} updateGameData={updateGameData} />;
      default:
        return null;
    }
  };

  return (
    <div className={styles["wizard-container"]}>
      <div className={styles["wizard-header"]}>
        <h1>Create New Game</h1>
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
              buttonText={isSubmitting ? "Creating..." : "Create Game"} 
              onClick={handleSubmit}
              disabled={isSubmitting}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default GameWizard;
