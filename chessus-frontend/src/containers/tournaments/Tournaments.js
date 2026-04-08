import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import { getGames } from "../../actions/games";
import {
  calculateExpectedLengthMinutes,
  calculateTournamentRounds,
  createTournamentPlaceholder,
  joinTournamentPlaceholder,
  listTournaments
} from "../../services/tournament-service";
import styles from "./tournaments.module.scss";
import { parseServerDate } from "../../helpers/date-formatter";

const FORMATS = [
  {
    id: "single_elimination",
    label: "Single Elimination",
    description: "One loss and you are out. Fast bracket progression."
  },
  {
    id: "double_elimination",
    label: "Double Elimination",
    description: "Two-loss format with winner and lower bracket paths."
  },
  {
    id: "pool_play",
    label: "Pool Play",
    description: "Group stage with standings before finals."
  }
];

const TIME_CONTROL_OPTIONS = [
  { value: "1", label: "1 minute (Bullet)" },
  { value: "3", label: "3 minutes (Blitz)" },
  { value: "5", label: "5 minutes (Blitz)" },
  { value: "10", label: "10 minutes (Rapid)" },
  { value: "15", label: "15 minutes (Rapid)" },
  { value: "30", label: "30 minutes (Classical)" },
  { value: "60", label: "60 minutes (Classical)" }
];

const INCREMENT_OPTIONS = [
  { value: "0", label: "+0 seconds" },
  { value: "1", label: "+1 second" },
  { value: "2", label: "+2 seconds" },
  { value: "3", label: "+3 seconds" },
  { value: "5", label: "+5 seconds" },
  { value: "10", label: "+10 seconds" }
];

const formatExpectedLength = (minutes) => {
  const parsedMinutes = Number(minutes);
  if (!Number.isFinite(parsedMinutes) || parsedMinutes <= 0) {
    return "-";
  }

  const hours = Math.floor(parsedMinutes / 60);
  const remainingMinutes = parsedMinutes % 60;

  if (hours === 0) {
    return `${remainingMinutes}m`;
  }

  if (remainingMinutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainingMinutes}m`;
};

const formatDateTime = (value) => {
  if (!value) {
    return "Not scheduled";
  }

  const parsed = parseServerDate(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Not scheduled";
  }

  return parsed.toLocaleString();
};

const Tournaments = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const { gamesList } = useSelector((state) => state.games);

  const [wizardStep, setWizardStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingTournaments, setIsLoadingTournaments] = useState(true);
  const [joiningTournamentId, setJoiningTournamentId] = useState(null);
  const [tournaments, setTournaments] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [wizardData, setWizardData] = useState({
    format: "single_elimination",
    gameTypeId: "",
    timeControl: "10",
    increment: "0",
    minPlayers: "2",
    maxPlayers: "8",
    isPrivate: false,
    startDateTime: ""
  });

  useEffect(() => {
    dispatch(getGames());
  }, [dispatch]);

  const loadTournaments = async () => {
    setIsLoadingTournaments(true);
    const tournamentList = await listTournaments();
    setTournaments(tournamentList);
    setIsLoadingTournaments(false);
  };

  useEffect(() => {
    loadTournaments();
  }, []);

  const selectedFormat = useMemo(
    () => FORMATS.find((format) => format.id === wizardData.format),
    [wizardData.format]
  );

  const selectedGameType = useMemo(
    () => gamesList.find((gameType) => String(gameType.id) === String(wizardData.gameTypeId)),
    [gamesList, wizardData.gameTypeId]
  );

  const selectedTimeControl = useMemo(
    () => TIME_CONTROL_OPTIONS.find((option) => option.value === wizardData.timeControl),
    [wizardData.timeControl]
  );

  const selectedIncrement = useMemo(
    () => INCREMENT_OPTIONS.find((option) => option.value === wizardData.increment),
    [wizardData.increment]
  );

  const calculatedRounds = useMemo(
    () => calculateTournamentRounds({ format: wizardData.format, maxPlayers: wizardData.maxPlayers }),
    [wizardData.format, wizardData.maxPlayers]
  );

  const calculatedExpectedLengthMinutes = useMemo(
    () => calculateExpectedLengthMinutes({
      format: wizardData.format,
      maxPlayers: wizardData.maxPlayers,
      timeControl: wizardData.timeControl,
      increment: wizardData.increment
    }),
    [wizardData.format, wizardData.maxPlayers, wizardData.timeControl, wizardData.increment]
  );

  const resetMessages = () => {
    setErrorMessage("");
    setSuccessMessage("");
  };

  const updateWizardData = (updates) => {
    resetMessages();
    setWizardData((previousData) => ({ ...previousData, ...updates }));
  };

  const validateStepTwo = () => {
    if (!wizardData.gameTypeId) {
      setErrorMessage("Please choose a game type before continuing.");
      return false;
    }

    const minPlayers = Number(wizardData.minPlayers);
    const maxPlayers = Number(wizardData.maxPlayers);

    if (!wizardData.startDateTime) {
      setErrorMessage("Please choose a start date and time.");
      return false;
    }

    if (!Number.isFinite(minPlayers) || !Number.isFinite(maxPlayers) || minPlayers < 2 || maxPlayers < 2) {
      setErrorMessage("Minimum and maximum players must be at least 2.");
      return false;
    }

    if (minPlayers > maxPlayers) {
      setErrorMessage("Minimum players cannot be greater than maximum players.");
      return false;
    }

    return true;
  };

  const handleNext = () => {
    resetMessages();

    if (wizardStep === 2 && !validateStepTwo()) {
      return;
    }

    setWizardStep((currentStep) => Math.min(3, currentStep + 1));
  };

  const handleBack = () => {
    resetMessages();
    setWizardStep((currentStep) => Math.max(1, currentStep - 1));
  };

  const handleCreateTournament = async () => {
    if (!currentUser) {
      navigate("/login", {
        state: { message: "Please log in to create and host tournaments." }
      });
      return;
    }

    if (!validateStepTwo()) {
      return;
    }

    if (!selectedGameType) {
      setErrorMessage("Please select a game type first.");
      return;
    }

    setIsSubmitting(true);
    resetMessages();

    try {
      await createTournamentPlaceholder({
        format: wizardData.format,
        gameTypeId: selectedGameType.id,
        gameTypeName: selectedGameType.game_name,
        timeControl: Number(wizardData.timeControl),
        increment: Number(wizardData.increment),
        minPlayers: Number(wizardData.minPlayers),
        maxPlayers: Number(wizardData.maxPlayers),
        isPrivate: wizardData.isPrivate,
        startDateTime: wizardData.startDateTime,
        createdBy: currentUser
      });

      setSuccessMessage("Tournament created. Players can now join from this page.");
      setWizardStep(1);
      setWizardData({
        format: wizardData.format,
        gameTypeId: "",
        timeControl: "10",
        increment: "0",
        minPlayers: "2",
        maxPlayers: "8",
        isPrivate: false,
        startDateTime: ""
      });
      await loadTournaments();
    } catch (error) {
      setErrorMessage(error.message || "Failed to create tournament.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJoinTournament = async (tournamentId) => {
    if (!currentUser) {
      navigate("/login", {
        state: { message: "Please log in to join tournaments." }
      });
      return;
    }

    setJoiningTournamentId(tournamentId);
    resetMessages();

    try {
      await joinTournamentPlaceholder({
        tournamentId,
        user: currentUser
      });
      setSuccessMessage("You have joined the tournament.");
      await loadTournaments();
    } catch (error) {
      setErrorMessage(error.message || "Unable to join this tournament.");
    } finally {
      setJoiningTournamentId(null);
    }
  };

  return (
    <div className={styles["tournaments-page"]}>
      <div className={styles["header"]}>
        <h1>Tournaments</h1>
        <p>
          Tournament hosting is in MVP mode. Use the wizard to configure a tournament object that others can join.
        </p>
        {!currentUser && (
          <div className={styles["guest-note"]}>
            Guest mode: browse tournaments freely. Login is required to create or join.
          </div>
        )}
      </div>

      {errorMessage && <div className={styles["error"]}>{errorMessage}</div>}
      {successMessage && <div className={styles["success"]}>{successMessage}</div>}

      <div className={styles["layout"]}>
        <section className={styles["wizard"]}>
          <div className={styles["wizard-header"]}>
            <h2>Create Tournament</h2>
            <span className={styles["step-pill"]}>Step {wizardStep} / 3</span>
          </div>

          {wizardStep === 1 && (
            <div className={styles["wizard-section"]}>
              <h3>Choose format</h3>
              <div className={styles["format-grid"]}>
                {FORMATS.map((format) => (
                  <button
                    key={format.id}
                    type="button"
                    className={`${styles["format-card"]} ${wizardData.format === format.id ? styles["selected"] : ""}`}
                    onClick={() => updateWizardData({ format: format.id })}
                  >
                    <strong>{format.label}</strong>
                    <span>{format.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {wizardStep === 2 && (
            <div className={styles["wizard-section"]}>
              <h3>Game and tournament settings</h3>

              <label className={styles["field-label"]}>Game Type</label>
              <select
                value={wizardData.gameTypeId}
                onChange={(event) => updateWizardData({ gameTypeId: event.target.value })}
              >
                <option value="">Select a game type</option>
                {gamesList.map((gameType) => (
                  <option key={gameType.id} value={gameType.id}>
                    {gameType.game_name}
                  </option>
                ))}
              </select>

              <div className={styles["field-row"]}>
                <div>
                  <label className={styles["field-label"]}>Time Control</label>
                  <select
                    value={wizardData.timeControl}
                    onChange={(event) => updateWizardData({ timeControl: event.target.value })}
                  >
                    {TIME_CONTROL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={styles["field-label"]}>Increment</label>
                  <select
                    value={wizardData.increment}
                    onChange={(event) => updateWizardData({ increment: event.target.value })}
                  >
                    {INCREMENT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={styles["field-row"]}>
                <div>
                  <label className={styles["field-label"]}>Minimum Players</label>
                  <input
                    type="number"
                    min="2"
                    value={wizardData.minPlayers}
                    onChange={(event) => updateWizardData({ minPlayers: event.target.value })}
                  />
                </div>
                <div>
                  <label className={styles["field-label"]}>Maximum Players</label>
                  <input
                    type="number"
                    min="2"
                    value={wizardData.maxPlayers}
                    onChange={(event) => updateWizardData({ maxPlayers: event.target.value })}
                  />
                </div>
              </div>

              <label className={styles["field-label"]}>Visibility</label>
              <select
                value={wizardData.isPrivate ? "private" : "public"}
                onChange={(event) => updateWizardData({ isPrivate: event.target.value === "private" })}
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>

              <label className={styles["field-label"]}>Start Date and Time</label>
              <input
                type="datetime-local"
                value={wizardData.startDateTime}
                onChange={(event) => updateWizardData({ startDateTime: event.target.value })}
              />
            </div>
          )}

          {wizardStep === 3 && (
            <div className={styles["wizard-section"]}>
              <h3>Review and host</h3>
              <div className={styles["summary-row"]}>
                <span>Format</span>
                <strong>{selectedFormat?.label || "-"}</strong>
              </div>
              <div className={styles["summary-row"]}>
                <span>Game Type</span>
                <strong>{selectedGameType?.game_name || "Not selected"}</strong>
              </div>
              <div className={styles["summary-row"]}>
                <span>Clock</span>
                <strong>
                  {selectedTimeControl?.label || "-"}
                  {selectedIncrement ? `, ${selectedIncrement.label}` : ""}
                </strong>
              </div>
              <div className={styles["summary-row"]}>
                <span>Players</span>
                <strong>{wizardData.minPlayers} to {wizardData.maxPlayers}</strong>
              </div>
              <div className={styles["summary-row"]}>
                <span>Visibility</span>
                <strong>{wizardData.isPrivate ? "Private" : "Public"}</strong>
              </div>
              <div className={styles["summary-row"]}>
                <span>Start</span>
                <strong>{formatDateTime(wizardData.startDateTime)}</strong>
              </div>
              <div className={styles["summary-row"]}>
                <span>Rounds</span>
                <strong>{calculatedRounds}</strong>
              </div>
              <div className={styles["summary-row"]}>
                <span>Expected Length</span>
                <strong>{formatExpectedLength(calculatedExpectedLengthMinutes)}</strong>
              </div>
              <div className={styles["summary-row"]}>
                <span>Host</span>
                <strong>{currentUser?.username || "Login required"}</strong>
              </div>
            </div>
          )}

          <div className={styles["wizard-actions"]}>
            <button
              type="button"
              className={styles["secondary-button"]}
              onClick={handleBack}
              disabled={wizardStep === 1 || isSubmitting}
            >
              Back
            </button>

            {wizardStep < 3 ? (
              <button type="button" className={styles["primary-button"]} onClick={handleNext}>
                Continue
              </button>
            ) : (
              <button
                type="button"
                className={styles["primary-button"]}
                onClick={handleCreateTournament}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Creating..." : "Host Tournament"}
              </button>
            )}
          </div>
        </section>

        <section className={styles["listing"]}>
          <div className={styles["listing-header"]}>
            <h2>Open Tournaments</h2>
            <button type="button" className={styles["refresh-button"]} onClick={loadTournaments}>
              Refresh
            </button>
          </div>

          {isLoadingTournaments ? (
            <div className={styles["empty"]}>Loading tournaments...</div>
          ) : tournaments.length === 0 ? (
            <div className={styles["empty"]}>No tournaments yet. Create the first one using the wizard.</div>
          ) : (
            <div className={styles["tournament-list"]}>
              {tournaments.map((tournament) => {
                const hasJoined = tournament.participants.some(
                  (participant) => Number(participant.id) === Number(currentUser?.id)
                );

                return (
                  <div key={tournament.id} className={styles["tournament-card"]}>
                    <div className={styles["card-top"]}>
                      <div>
                        <strong>{tournament.gameTypeName}</strong>
                        <p>{FORMATS.find((format) => format.id === tournament.format)?.label || tournament.format}</p>
                      </div>
                      <span className={styles["status"]}>{tournament.status}</span>
                    </div>
                    <div className={styles["card-meta"]}>
                      <span>Host: {tournament.createdByUsername}</span>
                      <span>Clock: {tournament.timeControl} min + {tournament.increment}s</span>
                      <span>
                        Players: {tournament.participants.length}/{tournament.maxPlayers} (min {tournament.minPlayers})
                      </span>
                      <span>Visibility: {tournament.isPrivate ? "Private" : "Public"}</span>
                      <span>Start: {formatDateTime(tournament.startDateTime)}</span>
                    </div>
                    <div className={styles["card-actions"]}>
                      <Link to={`/play/tournaments/${tournament.id}`} className={styles["details-link"]}>
                        Details
                      </Link>
                      <button
                        type="button"
                        className={styles["join-button"]}
                        disabled={joiningTournamentId === tournament.id || hasJoined}
                        onClick={() => handleJoinTournament(tournament.id)}
                      >
                        {hasJoined
                          ? "Joined"
                          : joiningTournamentId === tournament.id
                            ? "Joining..."
                            : "Join Tournament"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div className={styles["footnote"]}>
        <span>
          Backend integration placeholder: currently stores tournament objects locally. Next step can switch to API endpoints
          without changing this wizard UX.
        </span>
        <Link to="/play">Back to Play Lobby</Link>
      </div>
    </div>
  );
};

export default Tournaments;
