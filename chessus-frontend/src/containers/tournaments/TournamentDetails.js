import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { getGames } from "../../actions/games";
import {
  getTournamentByIdPlaceholder,
  joinTournamentPlaceholder,
  updateTournamentPlaceholder
} from "../../services/tournament-service";
import styles from "./tournaments.module.scss";

const FORMATS = [
  { value: "single_elimination", label: "Single Elimination" },
  { value: "double_elimination", label: "Double Elimination" },
  { value: "pool_play", label: "Pool Play" }
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

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Not scheduled";
  }

  return parsed.toLocaleString();
};

const toDateTimeLocalValue = (value) => {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const pad = (number) => String(number).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
};

const getErrorMessage = (error, fallbackMessage) => (
  error?.response?.data?.message || error?.message || fallbackMessage
);

const TournamentDetails = () => {
  const { tournamentId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const { user: currentUser } = useSelector((state) => state.authReducer);
  const { gamesList } = useSelector((state) => state.games);

  const [tournament, setTournament] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [editData, setEditData] = useState({
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

  const loadTournament = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const foundTournament = await getTournamentByIdPlaceholder(tournamentId);
      setTournament(foundTournament);
      if (foundTournament) {
        setEditData({
          format: foundTournament.format,
          gameTypeId: String(foundTournament.gameTypeId),
          timeControl: String(foundTournament.timeControl),
          increment: String(foundTournament.increment),
          minPlayers: String(foundTournament.minPlayers),
          maxPlayers: String(foundTournament.maxPlayers),
          isPrivate: Boolean(foundTournament.isPrivate),
          startDateTime: toDateTimeLocalValue(foundTournament.startDateTime)
        });
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Unable to load this tournament."));
      setTournament(null);
    } finally {
      setIsLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    loadTournament();
  }, [loadTournament]);

  const hasJoined = useMemo(() => {
    if (!tournament || !currentUser) {
      return false;
    }

    return tournament.participants.some((participant) => Number(participant.id) === Number(currentUser.id));
  }, [tournament, currentUser]);

  const canEdit = useMemo(() => {
    if (!currentUser || !tournament) {
      return false;
    }

    const role = (currentUser.role || "").toLowerCase();
    return Number(currentUser.id) === Number(tournament.createdById) || role === "admin" || role === "owner";
  }, [currentUser, tournament]);

  const handleJoinTournament = async () => {
    if (!currentUser) {
      navigate("/login", {
        state: { message: "Please log in to join tournaments." }
      });
      return;
    }

    if (!tournament) {
      return;
    }

    setIsJoining(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const updatedTournament = await joinTournamentPlaceholder({
        tournamentId: tournament.id,
        user: currentUser
      });
      setTournament(updatedTournament);
      setSuccessMessage("You have joined the tournament.");
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Unable to join this tournament."));
    } finally {
      setIsJoining(false);
    }
  };

  const handleEditField = (updates) => {
    setErrorMessage("");
    setSuccessMessage("");
    setEditData((previous) => ({ ...previous, ...updates }));
  };

  const handleSaveTournament = async () => {
    if (!tournament || !canEdit) {
      return;
    }

    const minPlayers = Number(editData.minPlayers);
    const maxPlayers = Number(editData.maxPlayers);

    if (!editData.gameTypeId) {
      setErrorMessage("Please choose a game type.");
      return;
    }

    if (!editData.startDateTime) {
      setErrorMessage("Please choose a start date and time.");
      return;
    }

    if (!Number.isFinite(minPlayers) || !Number.isFinite(maxPlayers) || minPlayers < 2 || maxPlayers < 2) {
      setErrorMessage("Minimum and maximum players must be at least 2.");
      return;
    }

    if (minPlayers > maxPlayers) {
      setErrorMessage("Minimum players cannot be greater than maximum players.");
      return;
    }

    setIsSaving(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const updatedTournament = await updateTournamentPlaceholder({
        tournamentId: tournament.id,
        updates: {
          format: editData.format,
          gameTypeId: Number(editData.gameTypeId),
          timeControl: Number(editData.timeControl),
          increment: Number(editData.increment),
          minPlayers,
          maxPlayers,
          isPrivate: editData.isPrivate,
          startDateTime: editData.startDateTime
        }
      });

      setTournament(updatedTournament);
      setIsEditing(false);
      setSuccessMessage("Tournament updated successfully.");
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Unable to update this tournament."));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className={styles["details-page"]}>
        <div className={styles["empty"]}>Loading tournament details...</div>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className={styles["details-page"]}>
        <div className={styles["empty"]}>Tournament not found.</div>
        <div className={styles["footnote"]}>
          <Link to="/play/tournaments">Back to Tournaments</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles["details-page"]}>
      <div className={styles["header"]}>
        <h1>{tournament.gameTypeName} Tournament</h1>
        <p>{FORMATS.find((item) => item.value === tournament.format)?.label || tournament.format}</p>
      </div>

      {errorMessage && <div className={styles["error"]}>{errorMessage}</div>}
      {successMessage && <div className={styles["success"]}>{successMessage}</div>}

      <section className={styles["details-card"]}>
        {isEditing ? (
          <div className={styles["wizard-section"]}>
            <h3>Edit Tournament</h3>

            <label className={styles["field-label"]}>Format</label>
            <select
              value={editData.format}
              onChange={(event) => handleEditField({ format: event.target.value })}
            >
              {FORMATS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>

            <label className={styles["field-label"]}>Game Type</label>
            <select
              value={editData.gameTypeId}
              onChange={(event) => handleEditField({ gameTypeId: event.target.value })}
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
                  value={editData.timeControl}
                  onChange={(event) => handleEditField({ timeControl: event.target.value })}
                >
                  {TIME_CONTROL_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={styles["field-label"]}>Increment</label>
                <select
                  value={editData.increment}
                  onChange={(event) => handleEditField({ increment: event.target.value })}
                >
                  {INCREMENT_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
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
                  value={editData.minPlayers}
                  onChange={(event) => handleEditField({ minPlayers: event.target.value })}
                />
              </div>
              <div>
                <label className={styles["field-label"]}>Maximum Players</label>
                <input
                  type="number"
                  min="2"
                  value={editData.maxPlayers}
                  onChange={(event) => handleEditField({ maxPlayers: event.target.value })}
                />
              </div>
            </div>

            <label className={styles["field-label"]}>Visibility</label>
            <select
              value={editData.isPrivate ? "private" : "public"}
              onChange={(event) => handleEditField({ isPrivate: event.target.value === "private" })}
            >
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>

            <label className={styles["field-label"]}>Start Date and Time</label>
            <input
              type="datetime-local"
              value={editData.startDateTime}
              onChange={(event) => handleEditField({ startDateTime: event.target.value })}
            />

            <div className={styles["summary-row"]}>
              <span>Expected Length</span>
              <strong>{formatExpectedLength(tournament.expectedLengthMinutes)}</strong>
            </div>
          </div>
        ) : (
          <>
            <div className={styles["summary-row"]}>
              <span>Status</span>
              <strong>{tournament.status}</strong>
            </div>
            <div className={styles["summary-row"]}>
              <span>Host</span>
              <strong>{tournament.createdByUsername}</strong>
            </div>
            <div className={styles["summary-row"]}>
              <span>Visibility</span>
              <strong>{tournament.isPrivate ? "Private" : "Public"}</strong>
            </div>
            <div className={styles["summary-row"]}>
              <span>Start</span>
              <strong>{formatDateTime(tournament.startDateTime)}</strong>
            </div>
            <div className={styles["summary-row"]}>
              <span>Clock</span>
              <strong>{tournament.timeControl} min + {tournament.increment}s</strong>
            </div>
            <div className={styles["summary-row"]}>
              <span>Players</span>
              <strong>
                {tournament.participants.length}/{tournament.maxPlayers} (minimum {tournament.minPlayers})
              </strong>
            </div>
            <div className={styles["summary-row"]}>
              <span>Rounds</span>
              <strong>{tournament.numberOfRounds}</strong>
            </div>
            <div className={styles["summary-row"]}>
              <span>Expected Length</span>
              <strong>{formatExpectedLength(tournament.expectedLengthMinutes)}</strong>
            </div>
          </>
        )}
      </section>

      <section className={styles["participants-card"]}>
        <h2>Participants</h2>
        {tournament.participants.length === 0 ? (
          <div className={styles["empty"]}>No participants yet.</div>
        ) : (
          <ol className={styles["participants-list"]}>
            {tournament.participants.map((participant) => (
              <li key={participant.id}>{participant.username}</li>
            ))}
          </ol>
        )}
      </section>

      <div className={styles["wizard-actions"]}>
        <Link to="/play/tournaments" className={styles["secondary-button"]}>Back</Link>
        {canEdit && (
          <button
            type="button"
            className={styles["secondary-button"]}
            onClick={() => setIsEditing((current) => !current)}
            disabled={isSaving}
          >
            {isEditing ? "Cancel Edit" : "Edit Tournament"}
          </button>
        )}
        {isEditing && canEdit ? (
          <button
            type="button"
            className={styles["join-button"]}
            onClick={handleSaveTournament}
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
        ) : (
          <button
            type="button"
            className={styles["join-button"]}
            disabled={isJoining || hasJoined || tournament.participants.length >= tournament.maxPlayers}
            onClick={handleJoinTournament}
          >
            {hasJoined
              ? "Joined"
              : isJoining
                ? "Joining..."
                : tournament.participants.length >= tournament.maxPlayers
                  ? "Tournament Full"
                  : "Join Tournament"}
          </button>
        )}
      </div>
    </div>
  );
};

export default TournamentDetails;
