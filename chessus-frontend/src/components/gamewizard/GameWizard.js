import React, { useState, useEffect } from "react";
import { useNavigate, Link } from 'react-router-dom';
import { useSelector, useDispatch } from "react-redux";
import styles from "./gamewizard.module.scss";
import StandardButton from "../standardbutton/StandardButton";
import Divider from "../Divider/Divider";
import { createGame, getGameById, updateGame } from "../../actions/games";
import { trackGameCreation, trackEvent } from "../../analytics/GoogleAnalytics";
import { validateContent } from "../../utils/contentModeration";
import { findMismatchedPlacements } from "../../helpers/imageBrightness";
import Step1BasicInfo from "./Step1BasicInfo";
import Step2WinConditions from "./Step2WinConditions";
import Step3BoardSpecialSquares from "./Step3BoardSpecialSquares";
import Step4PiecePlacement from "./Step4PiecePlacement";
import ValidationWarningModal from "../common/ValidationWarningModal";

const GameWizard = ({ editGameId }) => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isDraftMode, setIsDraftMode] = useState(false);
  const [isPublishedGame, setIsPublishedGame] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [showCheckmateWarning, setShowCheckmateWarning] = useState(false);
  const [imageMismatchWarning, setImageMismatchWarning] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [missingFields, setMissingFields] = useState(null);
  // First-move custom-square conflict warning. Triggered when leaving Step 3 if both
  // restrictFirstMoveToCustom AND disableFirstMoveHere flags exist somewhere in the same board
  // (the disable squares are redundant once first moves are already restricted to a subset of
  // squares). The pendingAction holds the navigation/save callback to run if user dismisses.
  const [firstMoveConflictWarning, setFirstMoveConflictWarning] = useState(null); // { onContinue }
  // Server-side initial-state validation error: triggered when the wizard
  // attempts to save a published (non-draft) game whose starting position is
  // already in a decided state (checkmate, stalemate, capture-condition met,
  // etc.). The modal is non-dismissible — the user must change the game and
  // re-save to clear it. Stored as { reason, type, code, forPlayer }.
  const [initialStateError, setInitialStateError] = useState(null);
  
  // Game data state - all fields from game_types table
  const [gameData, setGameData] = useState({
    // Step 1: Basic Info
    game_name: "",
    descript: "",
    rules: "",
    is_anonymous_creator: !currentUser,
    
    // Step 2: Win Conditions
    mate_condition: false,
    mate_piece: null,
    capture_condition: false,
    capture_piece: null,
    capture_condition_requires_all: false,
    mate_condition_requires_all: false,
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
    no_moves_condition: false,
    piece_count_condition: false,
    promotion_condition: false,
    lose_all_pieces_condition: false,
    stalemate_win_condition: false,
    stalemate_draw_condition: true,
    forced_capture_condition: false,
    optional_condition: null,
    draw_move_limit: null,
    repetition_draw_count: null,
    
    // Step 3: Board & Players
    board_width: 8,
    board_height: 8,
    player_count: 2,
    actions_per_turn: 1,
    simultaneous_turns: false,
    simul_turns_clock_pause: false,
    simul_turns_draw_after_cancellations: 3,
    simul_turns_submit_mode: 'immediate',
    simul_turns_place_conflict: 'cancel',
    simul_turns_free_move_after_capture: 'disable',
    simul_turns_simultaneous_capture_draw: true,
    simul_turns_simultaneous_checkmate_draw: true,
    
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

  // Returns true when the current step-3 special_squares_string contains BOTH
  // restrictFirstMoveToCustom and disableFirstMoveHere flags on different squares.
  // Once first moves are restricted to a specific set of squares, the "disable" flag is
  // redundant (any square not in the allowed set already disables first-move abilities), so
  // we surface this to the user before they leave step 3.
  const hasRedundantFirstMoveFlags = () => {
    try {
      const raw = gameData.special_squares_string;
      if (!raw) return false;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!parsed || typeof parsed !== 'object') return false;
      let hasRestrict = false;
      let hasDisable = false;
      for (const cfg of Object.values(parsed)) {
        if (cfg?.restrictFirstMoveToCustom) hasRestrict = true;
        if (cfg?.disableFirstMoveHere) hasDisable = true;
        if (hasRestrict && hasDisable) return true;
      }
      return false;
    } catch { return false; }
  };

  // Wrap a navigation/save action so that if we're leaving step 3 with the conflict, the user
  // gets a one-time warning. The callback `action` is invoked when the user dismisses the
  // modal (or immediately if no conflict exists).
  const guardLeavingStep3 = (action) => {
    if (currentStep === 3 && hasRedundantFirstMoveFlags()) {
      setFirstMoveConflictWarning({ onContinue: action });
      return;
    }
    action();
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
          const role = (currentUser?.role || "").toLowerCase();
          if (Number(existingGame.creator_id) !== Number(currentUser?.id) && role !== "admin" && role !== "owner") {
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
            capture_condition_requires_all: Boolean(existingGame.capture_condition_requires_all),
            mate_condition_requires_all: Boolean(existingGame.mate_condition_requires_all),
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
            piece_count_condition: Boolean(existingGame.piece_count_condition),
            promotion_condition: Boolean(existingGame.promotion_condition),
            lose_all_pieces_condition: Boolean(existingGame.lose_all_pieces_condition),
            stalemate_win_condition: Boolean(existingGame.stalemate_win_condition),
            stalemate_draw_condition: existingGame.stalemate_draw_condition === undefined || existingGame.stalemate_draw_condition === null ? true : Boolean(existingGame.stalemate_draw_condition),
            forced_capture_condition: Boolean(existingGame.forced_capture_condition),
            optional_condition: existingGame.optional_condition || null,
            draw_move_limit: existingGame.draw_move_limit != null ? existingGame.draw_move_limit : null,
            repetition_draw_count: existingGame.repetition_draw_count != null ? existingGame.repetition_draw_count : null,
            board_width: existingGame.board_width || 8,
            board_height: existingGame.board_height || 8,
            player_count: existingGame.player_count || 2,
            actions_per_turn: existingGame.actions_per_turn || 1,
            simultaneous_turns: Boolean(existingGame.simultaneous_turns),
            simul_turns_clock_pause: Boolean(existingGame.simul_turns_clock_pause),
            simul_turns_draw_after_cancellations: existingGame.simul_turns_draw_after_cancellations != null ? Number(existingGame.simul_turns_draw_after_cancellations) : 3,
            simul_turns_submit_mode: existingGame.simul_turns_submit_mode || 'immediate',
            simul_turns_place_conflict: existingGame.simul_turns_place_conflict || 'cancel',
            simul_turns_free_move_after_capture: existingGame.simul_turns_free_move_after_capture || 'disable',
            simul_turns_simultaneous_capture_draw: existingGame.simul_turns_simultaneous_capture_draw == null ? true : Boolean(Number(existingGame.simul_turns_simultaneous_capture_draw)),
            simul_turns_simultaneous_checkmate_draw: existingGame.simul_turns_simultaneous_checkmate_draw == null ? true : Boolean(Number(existingGame.simul_turns_simultaneous_checkmate_draw)),
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
          setIsDraftMode(Boolean(existingGame.is_draft));
          setIsPublishedGame(!Boolean(existingGame.is_draft));
          if (existingGame.draft_saved_step) {
            setCurrentStep(existingGame.draft_saved_step);
          }
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
    setGameData(prev => {
      const next = { ...prev, ...updates };

      // When a win condition is turned off, clear the matching per-placement
      // flags from pieces_string so leftover icons don't appear in the wizard
      // or game detail page. Same applies to promotion-into-checkmate / capture
      // toggles, which only make sense when the underlying win condition is on.
      const mateGoingOff = updates.mate_condition === false && prev.mate_condition === true;
      const captureGoingOff = updates.capture_condition === false && prev.capture_condition === true;
      if (mateGoingOff || captureGoingOff) {
        try {
          const pieces = JSON.parse(next.pieces_string || '{}');
          let changed = false;
          for (const key of Object.keys(pieces)) {
            const p = pieces[key];
            if (!p || p._occupied) continue;
            if (mateGoingOff) {
              if (p.ends_game_on_checkmate) { p.ends_game_on_checkmate = false; changed = true; }
              if (p.can_promote_to_checkmate) { p.can_promote_to_checkmate = false; changed = true; }
              if (p.limit_promote_checkmate_to_original) { p.limit_promote_checkmate_to_original = false; changed = true; }
            }
            if (captureGoingOff) {
              if (p.ends_game_on_capture) { p.ends_game_on_capture = false; changed = true; }
              if (p.can_promote_to_capture) { p.can_promote_to_capture = false; changed = true; }
              if (p.limit_promote_capture_to_original) { p.limit_promote_capture_to_original = false; changed = true; }
            }
          }
          if (changed) {
            next.pieces_string = JSON.stringify(pieces);
          }
        } catch { /* ignore parse errors */ }
      }

      return next;
    });
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

  const handleSubmit = async (skipWarning = false) => {
    setSaveError(null);
    setInitialStateError(null);

    // Collect all missing required fields
    const missing = [];
    
    if (!gameData.game_name || gameData.game_name.trim().length < 3) {
      missing.push({ field: 'Game Name (at least 3 characters)', step: 1 });
    }
    
    if (missing.length > 0) {
      setMissingFields(missing);
      return;
    }

    // Content moderation validation
    const nameCheck = validateContent(gameData.game_name, { fieldName: 'Game name', maxLength: 100 });
    if (!nameCheck.isValid) {
      setSaveError(nameCheck.errors[0]);
      goToStep(1);
      return;
    }
    if (gameData.descript) {
      const descCheck = validateContent(gameData.descript, { fieldName: 'Description', maxLength: 8000, allowLinks: true });
      if (!descCheck.isValid) {
        setSaveError(descCheck.errors[0]);
        goToStep(1);
        return;
      }
    }
    if (gameData.rules) {
      const rulesCheck = validateContent(gameData.rules, { fieldName: 'Rules', maxLength: 8000, allowLinks: true });
      if (!rulesCheck.isValid) {
        setSaveError(rulesCheck.errors[0]);
        goToStep(1);
        return;
      }
    }

    // Warn if promotion condition is enabled but no promotion squares are set
    if (gameData.promotion_condition) {
      let hasPromotionSquares = false;
      try {
        const promoSquares = JSON.parse(gameData.promotion_squares_string || '{}');
        hasPromotionSquares = Object.keys(promoSquares).length > 0;
      } catch { /* ignore */ }
      if (!hasPromotionSquares) {
        setSaveError('Win on Promotion is enabled but no promotion squares are defined. Add promotion squares in Step 3 (Board & Squares).');
        return;
      }
    }

    // Check for checkmate warning
    if (!skipWarning && gameData.mate_condition) {
      try {
        const pieces = JSON.parse(gameData.pieces_string || '[]');
        const piecesArr = Array.isArray(pieces) ? pieces : (pieces ? Object.values(pieces) : []);
        const hasCheckmateTarget = piecesArr.some(p => p && p.ends_game_on_checkmate && !p._occupied);
        if (!hasCheckmateTarget) {
          setShowCheckmateWarning(true);
          return;
        }
      } catch (e) {
        // If pieces can't be parsed, show warning since we can't verify
        setShowCheckmateWarning(true);
        return;
      }
    }

    // Check for dark-on-player-1 / light-on-player-2 image mismatches.
    // Dismissible: skipWarning bypasses this check on the second submission.
    if (!skipWarning) {
      try {
        const piecesObj = JSON.parse(gameData.pieces_string || '{}');
        const placements = Object.entries(piecesObj)
          .filter(([, p]) => p && p.piece_id && !p._occupied && !p._anchorKey)
          .map(([key, p]) => ({
            key,
            piece_name: p.piece_name,
            player_id: Number(p.player_id ?? p.player_number ?? 1),
            imageUrl: p.image_url || null,
          }));
        const mismatches = await findMismatchedPlacements(placements);
        if (mismatches.length > 0) {
          setImageMismatchWarning(mismatches);
          return;
        }
      } catch (e) {
        // Brightness check is best-effort; don't block save on failure
      }
    }

    setIsSubmitting(true);
    
    try {
      // Calculate starting_piece_count from pieces_string
      let pieceCount = 0;
      let sanitizedPiecesString = gameData.pieces_string;
      try {
        const pieces = JSON.parse(gameData.pieces_string || '{}');
        // Strip win-condition-tied flags when their corresponding win condition is off,
        // so games loaded with stale flags get cleaned up on next save.
        if (!gameData.mate_condition || !gameData.capture_condition) {
          let changed = false;
          for (const key of Object.keys(pieces)) {
            const p = pieces[key];
            if (!p || p._occupied) continue;
            if (!gameData.mate_condition) {
              if (p.ends_game_on_checkmate) { p.ends_game_on_checkmate = false; changed = true; }
              if (p.can_promote_to_checkmate) { p.can_promote_to_checkmate = false; changed = true; }
              if (p.limit_promote_checkmate_to_original) { p.limit_promote_checkmate_to_original = false; changed = true; }
            }
            if (!gameData.capture_condition) {
              if (p.ends_game_on_capture) { p.ends_game_on_capture = false; changed = true; }
              if (p.can_promote_to_capture) { p.can_promote_to_capture = false; changed = true; }
              if (p.limit_promote_capture_to_original) { p.limit_promote_capture_to_original = false; changed = true; }
            }
          }
          if (changed) sanitizedPiecesString = JSON.stringify(pieces);
        }
        // Filter out multi-tile extension squares (only count anchor squares)
        pieceCount = Object.values(pieces).filter(p => !p._occupied).length;
      } catch (e) {
        pieceCount = 0;
      }

      const finalGameData = {
        ...gameData,
        pieces_string: sanitizedPiecesString,
        starting_piece_count: pieceCount,
        is_draft: false,
        draft_saved_step: null,
      };

      if (isEditMode) {
        // Update existing game
        await dispatch(updateGame(editGameId, finalGameData));
        trackEvent('Game', 'Update', gameData.game_name);
      } else {
        // Create new game
        const newGameData = {
          ...finalGameData,
          creator_id: currentUser ? currentUser.id : null,
          is_anonymous_creator: !currentUser || gameData.is_anonymous_creator,
        };
        await dispatch(createGame(newGameData));
        trackGameCreation(gameData.game_name);
      }
      
      // Navigate to success page or game list
      navigate("/create/games");
    } catch (error) {
      // Backend rejected the save because the starting position is already
      // decided. Surface via the ValidationWarningModal so the user understands
      // they must fix the starting position and try saving again.
      const initStateErr = error?.response?.data?.initialStateError;
      if (initStateErr) {
        setInitialStateError(initStateErr);
      } else {
        const msg = error?.response?.data?.message || error?.message || 'An unexpected error occurred while saving.';
        setSaveError(msg);
      }
      console.error("Error saving game:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    setSaveError(null);
    setIsSavingDraft(true);

    try {
      // Calculate starting_piece_count from pieces_string
      let pieceCount = 0;
      try {
        const pieces = JSON.parse(gameData.pieces_string || '{}');
        pieceCount = Object.values(pieces).filter(p => !p._occupied).length;
      } catch (e) {
        pieceCount = 0;
      }

      const draftData = {
        ...gameData,
        starting_piece_count: pieceCount,
        is_draft: true,
        draft_saved_step: currentStep,
      };

      if (isEditMode && isDraftMode && !isPublishedGame) {
        // Editing an existing draft - update it in place
        await dispatch(updateGame(editGameId, draftData));
        trackEvent('Game', 'SaveDraft', gameData.game_name);
      } else {
        // Creating a new draft (either fresh or copying from a published game)
        const newDraftData = {
          ...draftData,
          creator_id: currentUser ? currentUser.id : null,
          is_anonymous_creator: !currentUser || gameData.is_anonymous_creator,
        };
        const result = await dispatch(createGame(newDraftData));
        trackEvent('Game', isPublishedGame ? 'CopyAsDraft' : 'CreateDraft', gameData.game_name);
        // After creating a new draft, switch to edit mode so future saves update instead of creating new
        if (result?.result?.id) {
          setIsEditMode(true);
          setIsDraftMode(true);
          setIsPublishedGame(false);
          // Update the URL without navigation to reflect edit mode
          window.history.replaceState(null, '', `/create/game/edit/${result.result.id}`);
        }
      }
      
      setSaveError(null);
      setIsDraftMode(true);
      // Show brief success feedback
      setSaveError(isPublishedGame ? 'Draft copy created!' : 'Draft saved!');
      setTimeout(() => setSaveError(null), 2000);
    } catch (error) {
      const msg = error?.response?.data?.message || error?.message || 'Failed to save draft.';
      setSaveError(msg);
      console.error("Error saving draft:", error);
    } finally {
      setIsSavingDraft(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <Step1BasicInfo gameData={gameData} updateGameData={updateGameData} currentUser={currentUser} />;
      case 2:
        return <Step2WinConditions gameData={gameData} updateGameData={updateGameData} />;
      case 3:
        return <Step3BoardSpecialSquares gameData={gameData} updateGameData={updateGameData} />;
      case 4:
        return <Step4PiecePlacement gameData={gameData} updateGameData={updateGameData} editGameId={editGameId} />;
      default:
        return null;
    }
  };

  if (!currentUser && !editGameId) {
    return (
      <div className={styles["wizard-container"]}>
        <div className={styles["wizard-header"]}>
          <h1>Create New Game</h1>
        </div>
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <p style={{ fontSize: '1.1rem', marginBottom: '20px', color: 'var(--text-muted)' }}>You need to be logged in to create games.</p>
          <Link to="/login" style={{ color: 'var(--accent-primary)', fontSize: '1.1rem' }}>Log in to get started</Link>
        </div>
      </div>
    );
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className={styles["wizard-container"]}>
        <div className={styles["wizard-header"]}>
          <h1>Loading Game...</h1>
        </div>
        <Divider />
        <div className={styles["wizard-content"]}>
          <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Please wait while we load the game data...</p>
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
          <p style={{ textAlign: 'center', color: '#ef4444' }}>{loadError}</p>
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
        <div className={styles["header-left"]}>
          {currentUser && (
            <StandardButton 
              buttonText={isSavingDraft ? "Saving..." : (isPublishedGame ? "📋 Copy as Draft" : "💾 Save as Draft")} 
              onClick={() => guardLeavingStep3(handleSaveDraft)}
              disabled={isSubmitting || isSavingDraft}
            />
          )}
        </div>
        <div className={styles["header-center"]}>
          <h1>{isEditMode ? (isDraftMode ? 'Edit Draft' : 'Edit Game') : 'Create New Game'}</h1>
          {isDraftMode && (
            <span className={styles["draft-badge"]}>DRAFT</span>
          )}
        </div>
        <div className={styles["header-right"]}>
          {isEditMode && (
            <StandardButton 
              buttonText={isSubmitting ? "Saving..." : "Save and Exit"} 
              onClick={() => guardLeavingStep3(() => handleSubmit())}
              disabled={isSubmitting || isSavingDraft}
            />
          )}
        </div>
      </div>

      <div className={styles["progress-bar"]}>
        {stepLabels.map((step) => (
          <div 
            key={step.num}
            className={`${styles["progress-step"]} ${currentStep === step.num ? styles.active : ''} ${currentStep > step.num ? styles.completed : ''}`}
            onClick={() => guardLeavingStep3(() => goToStep(step.num))}
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
          <div className={styles["nav-left"]}>
            {currentStep > 1 && (
              <StandardButton 
                buttonText="Previous" 
                onClick={prevStep}
                disabled={isSubmitting || isSavingDraft}
              />
            )}
          </div>

          <div className={styles["nav-center"]}>
            {currentUser && (
              <StandardButton 
                buttonText={isSavingDraft ? "Saving..." : (isPublishedGame ? "📋 Copy as Draft" : "💾 Save as Draft")} 
                onClick={() => guardLeavingStep3(handleSaveDraft)}
                disabled={isSubmitting || isSavingDraft}
              />
            )}
            {isEditMode && (
              <StandardButton 
                buttonText={isSubmitting ? "Saving..." : "Save and Exit"} 
                onClick={() => guardLeavingStep3(() => handleSubmit())}
                disabled={isSubmitting || isSavingDraft}
              />
            )}
          </div>

          <div className={styles["nav-right"]}>
            {currentStep < totalSteps && (
              <StandardButton 
                buttonText="Next" 
                onClick={() => guardLeavingStep3(nextStep)}
              />
            )}
            
            {currentStep === totalSteps && (
              <StandardButton 
                buttonText={isSubmitting ? "Saving..." : (isDraftMode ? "Publish Game" : (isEditMode ? "Update Game" : "Create Game"))} 
                onClick={() => handleSubmit()}
                disabled={isSubmitting || isSavingDraft}
              />
            )}
          </div>
        </div>
        {saveError && (
          <p className={saveError === 'Draft saved!' ? styles["draft-saved-message"] : styles["validation-error"]} style={{ marginTop: '12px', textAlign: 'center' }}>
            {saveError}
          </p>
        )}
      </div>

      {showCheckmateWarning && (
        <div className={styles["warning-overlay"]}>
          <div className={styles["warning-modal"]}>
            <h3>⚠️ Checkmate Warning</h3>
            <p>You have <strong>Checkmate</strong> enabled as a win condition, but no piece is marked as "Ends Game on Checkmate." The game will never end by checkmate unless at least one piece has this flag.</p>
            <div className={styles["warning-buttons"]}>
              <StandardButton 
                buttonText="Go Back" 
                onClick={() => setShowCheckmateWarning(false)}
              />
              <StandardButton 
                buttonText="Create Anyway" 
                onClick={() => { setShowCheckmateWarning(false); handleSubmit(true); }}
              />
            </div>
          </div>
        </div>
      )}

      {firstMoveConflictWarning && (
        <div className={styles["warning-overlay"]}>
          <div className={styles["warning-modal"]}>
            <h3>⚠️ Conflicting First-Move Squares</h3>
            <p>
              You have custom squares with both <strong>"Restrict First-Move Abilities to These Squares"</strong> and
              {' '}<strong>"Disable First-Move Abilities On This Square"</strong> set on the board.
            </p>
            <p>
              Once first-move abilities are restricted to a specific set of squares, the "Disable" squares
              will have no effect — first-move abilities are already disabled everywhere except the restricted squares.
            </p>
            <div className={styles["warning-buttons"]}>
              <StandardButton
                buttonText="Go Back"
                onClick={() => setFirstMoveConflictWarning(null)}
              />
              <StandardButton
                buttonText="Continue Anyway"
                onClick={() => {
                  const action = firstMoveConflictWarning?.onContinue;
                  setFirstMoveConflictWarning(null);
                  if (typeof action === 'function') action();
                }}
              />
            </div>
          </div>
        </div>
      )}

      {imageMismatchWarning && (
        <div className={styles["warning-overlay"]}>
          <div className={styles["warning-modal"]}>
            <h3>⚠️ Piece Color May Look Wrong</h3>
            <p>
              Player 1 traditionally uses light pieces and Player 2 uses dark pieces.
              The following placements appear to use the opposite color and may be hard
              to distinguish on the board:
            </p>
            <ul className={styles["missing-fields-list"]}>
              {imageMismatchWarning.slice(0, 12).map((m, i) => (
                <li key={i}>
                  <strong>{m.piece_name || 'Piece'}</strong> at {m.key} —{' '}
                  {m.kind === 'dark-on-p1'
                    ? 'dark image on Player 1'
                    : 'light image on Player 2'}
                </li>
              ))}
              {imageMismatchWarning.length > 12 && (
                <li>…and {imageMismatchWarning.length - 12} more</li>
              )}
            </ul>
            <div className={styles["warning-buttons"]}>
              <StandardButton
                buttonText="Go Back"
                onClick={() => setImageMismatchWarning(null)}
              />
              <StandardButton
                buttonText="Save Anyway"
                onClick={() => { setImageMismatchWarning(null); handleSubmit(true); }}
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

      {initialStateError && (
        <ValidationWarningModal
          warnings={[initialStateError.reason || 'The starting position is already in a decided state.']}
          title="⚠️ Starting Position Already Decided"
          description="This game cannot be saved as published because the starting position would already determine a winner, loser, or draw before any moves are made."
          onClose={() => setInitialStateError(null)}
        />
      )}
    </div>
  );
};

export default GameWizard;
