import React, { useState, useEffect } from "react";
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from "react-redux";
import styles from "./gamewizard.module.scss";
import StandardButton from "../standardbutton/StardardButton";
import Divider from "../Divider/Divider";
import { createGame, getGameById, updateGame } from "../../actions/games";
import Step1BasicInfo from "./Step1BasicInfo";
import Step2WinConditions from "./Step2WinConditions";
import Step3BoardPlayers from "./Step3BoardPlayers";
import Step4Advanced from "./Step4Advanced";

const GameWizard = ({ editGameId }) => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [loadError, setLoadError] = useState(null);
  
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

  // Load existing game data when in edit mode
  useEffect(() => {
    const loadGameData = async () => {
      if (editGameId) {
        setIsLoading(true);
        setLoadError(null);
        try {
          const existingGame = await dispatch(getGameById(editGameId));
          
          // Check if user has permission to edit
          if (existingGame.creator_id !== currentUser?.id && currentUser?.role !== "Admin") {
            setLoadError("You don't have permission to edit this game.");
            return;
          }
          
          setGameData({
            game_name: existingGame.game_name || "",
            descript: existingGame.descript || "",
            rules: existingGame.rules || "",
            mate_condition: existingGame.mate_condition || false,
            mate_piece: existingGame.mate_piece || null,
            capture_condition: existingGame.capture_condition || false,
            capture_piece: existingGame.capture_piece || null,
            value_condition: existingGame.value_condition || false,
            value_piece: existingGame.value_piece || null,
            value_max: existingGame.value_max || null,
            value_title: existingGame.value_title || "",
            squares_condition: existingGame.squares_condition || false,
            squares_count: existingGame.squares_count || null,
            hill_condition: existingGame.hill_condition || false,
            hill_x: existingGame.hill_x || null,
            hill_y: existingGame.hill_y || null,
            hill_turns: existingGame.hill_turns || null,
            optional_condition: existingGame.optional_condition || null,
            board_width: existingGame.board_width || 8,
            board_height: existingGame.board_height || 8,
            player_count: existingGame.player_count || 2,
            actions_per_turn: existingGame.actions_per_turn || 1,
            starting_piece_count: existingGame.starting_piece_count || 0,
            pieces_string: existingGame.pieces_string || "[]",
            range_squares_string: existingGame.range_squares_string || "",
            promotion_squares_string: existingGame.promotion_squares_string || "",
            special_squares_string: existingGame.special_squares_string || "",
            randomized_starting_positions: existingGame.randomized_starting_positions || "",
            other_game_data: existingGame.other_game_data || "",
          });
          setIsEditMode(true);
        } catch (error) {
          console.error("Error loading game:", error);
          setLoadError("Failed to load game data. Please try again.");
        } finally {
          setIsLoading(false);
        }
      }
    };

    loadGameData();
  }, [editGameId, dispatch, currentUser]);

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
      if (isEditMode) {
        // Update existing game
        await dispatch(updateGame(editGameId, gameData));
      } else {
        // Create new game
        const finalGameData = {
          ...gameData,
          creator_id: currentUser.id,
        };
        await dispatch(createGame(finalGameData));
      }
      
      // Navigate to success page or game list
      navigate("/create/games");
    } catch (error) {
      console.error("Error saving game:", error);
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

  // Show loading state
  if (isLoading) {
    return (
      <div className={styles["wizard-container"]}>
        <div className={styles["wizard-header"]}>
          <h1>Loading Game...</h1>
        </div>
        <Divider />
        <div className={styles["wizard-content"]}>
          <p style={{ textAlign: 'center', color: '#a0b8d0' }}>Please wait while we load the game data...</p>
        </div>
      </div>
    );
  }

  // Show error state
  if (loadError) {
    return (
      <div className={styles["wizard-container"]}>
        <div className={styles["wizard-header"]}>
          <h1>Error</h1>
        </div>
        <Divider />
        <div className={styles["wizard-content"]}>
          <p style={{ textAlign: 'center', color: '#ff6b6b' }}>{loadError}</p>
          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <StandardButton 
              buttonText="Back to Games" 
              onClick={() => navigate('/create/games')}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles["wizard-container"]}>
      <div className={styles["wizard-header"]}>
        <h1>{isEditMode ? 'Edit Game' : 'Create New Game'}</h1>
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
              buttonText={isSubmitting ? "Saving..." : (isEditMode ? "Update Game" : "Create Game")} 
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
