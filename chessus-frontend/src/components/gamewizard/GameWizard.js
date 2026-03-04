import React, { useState, useEffect } from "react";
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from "react-redux";
import styles from "./gamewizard.module.scss";
import StandardButton from "../standardbutton/StandardButton";
import Divider from "../Divider/Divider";
import { createGame, getGameById, updateGame } from "../../actions/games";
import { trackGameCreation, trackEvent } from "../../analytics/GoogleAnalytics";
import Step1BasicInfo from "./Step1BasicInfo";
import Step2WinConditions from "./Step2WinConditions";
import Step3BoardSpecialSquares from "./Step3BoardSpecialSquares";
import Step4PiecePlacement from "./Step4PiecePlacement";

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
    no_moves_condition: false, // Disabled by default like other win conditions
    optional_condition: null,
    draw_move_limit: null,
    repetition_draw_count: null,
    
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
    control_squares_string: "",
    randomized_starting_positions: "",
    other_game_data: "",
  });

  const totalSteps = 4;
  
  const stepLabels = [
    { num: 1, label: 'Basic Info' },
    { num: 2, label: 'Win Conditions' },
    { num: 3, label: 'Board & Squares' },
    { num: 4, label: 'Pieces' }
  ];

  const goToStep = (step) => {
    setCurrentStep(step);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

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
            mate_condition: Boolean(existingGame.mate_condition),
            mate_piece: existingGame.mate_piece || null,
            capture_condition: Boolean(existingGame.capture_condition),
            capture_piece: existingGame.capture_piece || null,
            value_condition: Boolean(existingGame.value_condition),
            value_piece: existingGame.value_piece || null,
            value_max: existingGame.value_max || null,
            value_title: existingGame.value_title || "",
            squares_condition: Boolean(existingGame.squares_condition),
            squares_count: existingGame.squares_count || null,
            hill_condition: Boolean(existingGame.hill_condition),
            hill_x: existingGame.hill_x || null,
            hill_y: existingGame.hill_y || null,
            hill_turns: existingGame.hill_turns || null,
            no_moves_condition: Boolean(existingGame.no_moves_condition),
            optional_condition: existingGame.optional_condition || null,
            draw_move_limit: existingGame.draw_move_limit != null ? existingGame.draw_move_limit : null,
            repetition_draw_count: existingGame.repetition_draw_count != null ? existingGame.repetition_draw_count : null,
            board_width: existingGame.board_width || 8,
            board_height: existingGame.board_height || 8,
            player_count: existingGame.player_count || 2,
            actions_per_turn: existingGame.actions_per_turn || 1,
            starting_piece_count: existingGame.starting_piece_count || 0,
            pieces_string: existingGame.pieces_string || "[]",
            range_squares_string: existingGame.range_squares_string || "",
            promotion_squares_string: existingGame.promotion_squares_string || "",
            special_squares_string: existingGame.special_squares_string || "",
            control_squares_string: existingGame.control_squares_string || "",
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

  // Scroll to top when step changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentStep]);

  const updateGameData = (updates) => {
    setGameData(prev => ({ ...prev, ...updates }));
  };

  const nextStep = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    
    try {
      // Calculate starting_piece_count from pieces_string
      let pieceCount = 0;
      try {
        const pieces = JSON.parse(gameData.pieces_string || '{}');
        pieceCount = Object.keys(pieces).length;
      } catch (e) {
        pieceCount = 0;
      }

      const finalGameData = {
        ...gameData,
        starting_piece_count: pieceCount
      };

      if (isEditMode) {
        // Update existing game
        await dispatch(updateGame(editGameId, finalGameData));
        trackEvent('Game', 'Update', gameData.game_name);
      } else {
        // Create new game
        const newGameData = {
          ...finalGameData,
          creator_id: currentUser.id,
        };
        await dispatch(createGame(newGameData));
        trackGameCreation(gameData.game_name);
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
        return <Step3BoardSpecialSquares gameData={gameData} updateGameData={updateGameData} />;
      case 4:
        return <Step4PiecePlacement gameData={gameData} updateGameData={updateGameData} />;
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

export default GameWizard;
