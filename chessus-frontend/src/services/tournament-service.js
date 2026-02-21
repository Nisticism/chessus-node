import axios from "axios";
import API_URL from "../global/global";
import authHeader from "./auth-header";

const normalizePlayerCount = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(2, Math.floor(parsed));
};

const getMatchLengthMinutes = (timeControl, increment) => {
  const baseMinutes = Number(timeControl) || 10;
  const incrementSeconds = Number(increment) || 0;
  const averageMovesPerPlayer = 40;
  const incrementMinutes = (incrementSeconds * averageMovesPerPlayer) / 60;
  const betweenRoundBufferMinutes = 5;
  return Math.max(1, Math.ceil(baseMinutes + incrementMinutes + betweenRoundBufferMinutes));
};

export const calculateTournamentRounds = ({ format, maxPlayers }) => {
  const bracketSize = Math.max(2, normalizePlayerCount(maxPlayers, 8));
  const eliminationRounds = Math.max(1, Math.ceil(Math.log2(bracketSize)));

  if (format === 'double_elimination') {
    return (eliminationRounds * 2) - 1;
  }

  if (format === 'pool_play') {
    return eliminationRounds + 1;
  }

  return eliminationRounds;
};

export const calculateExpectedLengthMinutes = ({ format, maxPlayers, timeControl, increment }) => {
  const rounds = calculateTournamentRounds({ format, maxPlayers });
  return rounds * getMatchLengthMinutes(timeControl, increment);
};

const normalizeTournament = (tournament) => {
  const normalizedMaxPlayers = normalizePlayerCount(tournament.maxPlayers, 8);
  const normalizedMinPlayers = Math.min(
    normalizePlayerCount(tournament.minPlayers, 2),
    normalizedMaxPlayers
  );
  const normalizedRounds = Number.isFinite(Number(tournament.numberOfRounds))
    ? Number(tournament.numberOfRounds)
    : calculateTournamentRounds({
      format: tournament.format,
      maxPlayers: normalizedMaxPlayers
    });

  const normalizedExpectedLength = Number.isFinite(Number(tournament.expectedLengthMinutes))
    ? Number(tournament.expectedLengthMinutes)
    : calculateExpectedLengthMinutes({
      format: tournament.format,
      maxPlayers: normalizedMaxPlayers,
      timeControl: tournament.timeControl,
      increment: tournament.increment
    });

  return {
    ...tournament,
    minPlayers: normalizedMinPlayers,
    maxPlayers: normalizedMaxPlayers,
    isPrivate: Boolean(tournament.isPrivate),
    startDateTime: tournament.startDateTime || null,
    numberOfRounds: normalizedRounds,
    expectedLengthMinutes: normalizedExpectedLength
  };
};

const normalizeTournamentFromApi = (tournament) => normalizeTournament({
  ...tournament,
  gameTypeId: tournament.gameTypeId,
  gameTypeName: tournament.gameTypeName,
  timeControl: tournament.timeControl,
  increment: tournament.increment,
  minPlayers: tournament.minPlayers,
  maxPlayers: tournament.maxPlayers,
  isPrivate: tournament.isPrivate,
  startDateTime: tournament.startDateTime,
  numberOfRounds: tournament.numberOfRounds,
  expectedLengthMinutes: tournament.expectedLengthMinutes,
  createdById: tournament.createdById,
  createdByUsername: tournament.createdByUsername,
  participants: Array.isArray(tournament.participants) ? tournament.participants : []
});

export const listTournaments = async () => {
  const response = await axios.get(API_URL + "tournaments", {
    headers: authHeader()
  });

  const tournaments = Array.isArray(response?.data?.tournaments) ? response.data.tournaments : [];
  return tournaments
    .map(normalizeTournamentFromApi)
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
};

export const getTournamentByIdPlaceholder = async (tournamentId) => {
  const response = await axios.get(API_URL + `tournaments/${tournamentId}`, {
    headers: authHeader()
  });
  const tournament = response?.data?.tournament;
  return tournament ? normalizeTournamentFromApi(tournament) : null;
};

export const createTournamentPlaceholder = async ({
  format,
  gameTypeId,
  gameTypeName,
  timeControl,
  increment,
  minPlayers,
  maxPlayers,
  isPrivate,
  startDateTime,
  createdBy
}) => {
  const normalizedMaxPlayers = normalizePlayerCount(maxPlayers, 8);
  const normalizedMinPlayers = Math.min(normalizePlayerCount(minPlayers, 2), normalizedMaxPlayers);
  const computedStartDateTime = startDateTime || null;
  const expectedLengthMinutes = calculateExpectedLengthMinutes({
    format,
    maxPlayers: normalizedMaxPlayers,
    timeControl,
    increment
  });

  const response = await axios.post(
    API_URL + "tournaments",
    {
      format,
      gameTypeId,
      gameTypeName,
      timeControl: Number(timeControl),
      increment: Number(increment),
      minPlayers: normalizedMinPlayers,
      maxPlayers: normalizedMaxPlayers,
      isPrivate: Boolean(isPrivate),
      startDateTime: computedStartDateTime,
      expectedLengthMinutes,
      createdBy
    },
    {
      headers: authHeader()
    }
  );

  return normalizeTournamentFromApi(response?.data?.tournament);
};

export const joinTournamentPlaceholder = async ({ tournamentId, user }) => {
  const response = await axios.post(
    API_URL + `tournaments/${tournamentId}/join`,
    { userId: user?.id },
    {
      headers: authHeader()
    }
  );

  return normalizeTournamentFromApi(response?.data?.tournament);
};

export const updateTournamentPlaceholder = async ({ tournamentId, updates }) => {
  const response = await axios.put(API_URL + `tournaments/${tournamentId}`, updates, {
    headers: authHeader()
  });

  return normalizeTournamentFromApi(response?.data?.tournament);
};
