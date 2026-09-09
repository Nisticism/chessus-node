import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSocket } from "../../contexts/SocketContext";
import { attachGameToMatch, getTournamentBracket } from "../../services/tournament-service";
import styles from "./bracket.module.scss";

/*
 * The bracket, as the players see it.
 *
 * Elimination brackets are drawn as columns, one per round, reading left to
 * right the way a bracket on paper does. Double elimination is the same thing
 * twice: the winners bracket, then the losers bracket underneath it, then the
 * grand final between the two champions. A round robin has no shape to draw,
 * so it gets the table instead, with the fixtures listed under it.
 *
 * The one interactive part is your own match. When it is your turn to play,
 * the card offers to start the game - which goes through the ordinary game
 * creation, as a challenge to your opponent, and then tells the bracket which
 * game belongs to which match.
 */

const BRACKET_TITLES = {
  winners: "Winners Bracket",
  losers: "Losers Bracket",
  grand_final: "Grand Final",
  grand_final_reset: "Grand Final (Reset)",
  round_robin: "Fixtures"
};

/* The last round of a bracket is the final, the one before it the semi-final. */
const roundLabel = (bracket, round, roundsInBracket) => {
  if (bracket === "grand_final") return "Grand Final";
  if (bracket === "grand_final_reset") return "Bracket Reset";
  if (bracket === "round_robin") return `Round ${round}`;

  const fromEnd = roundsInBracket - round;
  if (bracket === "winners") {
    if (fromEnd === 0) return "Final";
    if (fromEnd === 1) return "Semi-Finals";
    if (fromEnd === 2) return "Quarter-Finals";
  }
  return `Round ${round}`;
};

const seatName = (seat) => {
  if (!seat) return "-";
  if (seat.type === "bye") return "Bye";
  if (seat.type === "pending") return "To be decided";
  return seat.username;
};

const Seat = ({ seat, isWinner, isLoser, isYou }) => {
  const classes = [styles.seat];
  if (seat?.type === "bye") classes.push(styles["seat-bye"]);
  if (seat?.type === "pending") classes.push(styles["seat-pending"]);
  if (isWinner) classes.push(styles["seat-winner"]);
  if (isLoser) classes.push(styles["seat-loser"]);
  if (isYou) classes.push(styles["seat-you"]);

  return (
    <div className={classes.join(" ")}>
      <span className={styles["seat-name"]}>{seatName(seat)}</span>
      {seat?.type === "player" && seat.seed ? (
        <span className={styles["seat-seed"]} title={`Seed ${seat.seed}`}>{seat.seed}</span>
      ) : null}
    </div>
  );
};

const MatchCard = ({ match, currentUserId, onPlay, isStarting }) => {
  const seats = [match.playerOne, match.playerTwo];
  const youAreIn = seats.some((s) => s?.type === "player" && Number(s.id) === Number(currentUserId));
  const decided = match.status === "completed" || match.status === "bye";

  /*
   * A bracket padded out to a power of two has seats in it that nobody can
   * ever occupy - in the losers bracket especially, where a walkover in the
   * winners bracket means nobody drops down. Those are part of the structure,
   * not matches, and drawing them as "Bye against Bye" reads like a fixture
   * somebody is meant to play.
   */
  const bothEmpty = seats.every((s) => s?.type === "bye");
  const walkover = match.status === "bye" && !bothEmpty;

  const classes = [styles.match];
  if (youAreIn) classes.push(styles["match-yours"]);
  if (decided) classes.push(styles["match-decided"]);
  if (match.status === "bye") classes.push(styles["match-bye"]);

  if (bothEmpty) {
    return (
      <div className={[styles.match, styles["match-empty"]].join(" ")}>
        <span className={styles["match-note"]}>No match</span>
      </div>
    );
  }

  const winnerId = match.winnerId == null ? null : Number(match.winnerId);
  const isSeatWinner = (seat) => decided && !match.isDraw
    && seat?.type === "player" && Number(seat.id) === winnerId;
  const isSeatLoser = (seat) => decided && !match.isDraw && winnerId != null
    && seat?.type === "player" && Number(seat.id) !== winnerId;

  return (
    <div className={classes.join(" ")}>
      {/* The round is named once, on the column; repeating it on every card
          just crowds it out. Only what is particular to this match goes here. */}
      {walkover ? (
        <div className={styles["match-label"]}>
          <span className={styles["match-note"]}>Walkover - no game played</span>
        </div>
      ) : null}

      {seats.filter((seat) => !(walkover && seat?.type === "bye")).map((seat, index) => (
        <Seat
          key={index}
          seat={seat}
          isWinner={isSeatWinner(seat)}
          isLoser={isSeatLoser(seat)}
          isYou={seat?.type === "player" && Number(seat.id) === Number(currentUserId)}
        />
      ))}

      <div className={styles["match-footer"]}>
        {match.gameId ? (
          <Link className={styles["match-link"]} to={`/play/${match.gameId}`}>
            {match.status === "active" ? "Open game" : "View game"}
          </Link>
        ) : null}

        {/* Only the two players see the button, and only while it is playable. */}
        {!match.gameId && match.status === "ready" && youAreIn ? (
          <button
            type="button"
            className={styles["match-play"]}
            onClick={() => onPlay(match)}
            disabled={isStarting}
          >
            {isStarting ? "Starting..." : "Start match"}
          </button>
        ) : null}

        {!match.gameId && match.status === "ready" && !youAreIn ? (
          <span className={styles["match-note"]}>Waiting to be played</span>
        ) : null}
      </div>
    </div>
  );
};

const StandingsTable = ({ standings, currentUserId }) => (
  <div className={styles["standings-wrap"]}>
    <table className={styles.standings}>
      <thead>
        <tr>
          <th className={styles["standings-rank"]}>#</th>
          <th>Player</th>
          <th>P</th>
          <th>W</th>
          <th>D</th>
          <th>L</th>
          <th>Pts</th>
        </tr>
      </thead>
      <tbody>
        {standings.map((row, index) => (
          <tr
            key={row.playerId}
            className={Number(row.playerId) === Number(currentUserId) ? styles["standings-you"] : undefined}
          >
            <td className={styles["standings-rank"]}>{index + 1}</td>
            <td>{row.username}</td>
            <td>{row.played}</td>
            <td>{row.wins}</td>
            <td>{row.draws}</td>
            <td>{row.losses}</td>
            <td><strong>{row.points}</strong></td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const TournamentBracket = ({ tournament, currentUser, onTournamentChanged }) => {
  const navigate = useNavigate();
  const { createGame } = useSocket();

  const [bracket, setBracket] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [startingKey, setStartingKey] = useState(null);

  const tournamentId = tournament?.id;
  const currentUserId = currentUser?.id ?? null;

  const load = useCallback(async () => {
    if (!tournamentId) return;
    try {
      const data = await getTournamentBracket(tournamentId);
      setBracket(data);
    } catch (error) {
      setErrorMessage(error?.response?.data?.message || "Unable to load the bracket.");
    } finally {
      setIsLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => { load(); }, [load]);

  /*
   * Results reach the bracket by way of the games behind it, so a page left
   * open would otherwise show a round that finished ten minutes ago. Polling
   * while the tournament is in progress keeps it current without a socket of
   * its own; it stops as soon as the tournament is over.
   */
  useEffect(() => {
    if (!bracket?.started || bracket.status !== "started") return undefined;
    const timer = setInterval(load, 20000);
    return () => clearInterval(timer);
  }, [bracket?.started, bracket?.status, load]);

  const handlePlay = useCallback(async (match) => {
    const opponent = [match.playerOne, match.playerTwo]
      .find((seat) => seat?.type === "player" && Number(seat.id) !== Number(currentUserId));
    if (!opponent) return;

    setStartingKey(match.key);
    setErrorMessage("");
    try {
      /*
       * An ordinary game, created the ordinary way - a challenge to the
       * opponent, on the tournament's game type and clock. The bracket is then
       * told which game decides this match, and picks up the result from it.
       */
      const { gameId } = await createGame({
        gameTypeId: tournament.gameTypeId,
        timeControl: Number(tournament.timeControl),
        increment: Number(tournament.increment) || 0,
        challengedUserId: Number(opponent.id),
        rated: true,
        allowSpectators: true
      });

      const updated = await attachGameToMatch({
        tournamentId,
        matchKey: match.key,
        gameId
      });
      setBracket(updated);
      if (onTournamentChanged) onTournamentChanged();
      navigate(`/play/${gameId}`);
    } catch (error) {
      setErrorMessage(
        error?.response?.data?.message || error?.message || "Unable to start this match."
      );
      // The game may exist even though the link failed, so refresh rather than
      // leave the bracket showing a match that is really under way.
      load();
    } finally {
      setStartingKey(null);
    }
  }, [createGame, currentUserId, load, navigate, onTournamentChanged, tournament, tournamentId]);

  const grouped = useMemo(() => {
    if (!bracket?.rounds?.length) return [];
    const order = ["winners", "losers", "grand_final", "grand_final_reset", "round_robin"];
    const sections = [];
    for (const name of order) {
      const rounds = bracket.rounds.filter((r) => r.bracket === name);
      if (rounds.length) sections.push({ bracket: name, rounds });
    }
    return sections;
  }, [bracket]);

  const isRoundRobin = bracket?.format === "pool_play" || bracket?.format === "round_robin";

  const yourNextMatch = useMemo(() => {
    if (!bracket?.rounds || !currentUserId) return null;
    for (const round of bracket.rounds) {
      for (const match of round.matches) {
        if (match.status !== "ready" && match.status !== "active") continue;
        const yours = [match.playerOne, match.playerTwo]
          .some((s) => s?.type === "player" && Number(s.id) === Number(currentUserId));
        if (yours) return match;
      }
    }
    return null;
  }, [bracket, currentUserId]);

  if (isLoading) {
    return <section className={styles["bracket-card"]}><div className={styles.empty}>Loading bracket...</div></section>;
  }

  if (!bracket?.started) {
    return (
      <section className={styles["bracket-card"]}>
        <h2>Bracket</h2>
        <div className={styles.empty}>
          The bracket is drawn when the tournament starts.
        </div>
      </section>
    );
  }

  return (
    <section className={styles["bracket-card"]}>
      <div className={styles["bracket-header"]}>
        <h2>Bracket</h2>
        {bracket.championUsername ? (
          <div className={styles.champion}>
            <span className={styles["champion-label"]}>Winner</span>
            <strong>{bracket.championUsername}</strong>
          </div>
        ) : null}
      </div>

      {errorMessage ? <div className={styles.error}>{errorMessage}</div> : null}

      {yourNextMatch ? (
        <div className={styles["your-turn"]}>
          {yourNextMatch.gameId
            ? <>Your match is under way. <Link to={`/play/${yourNextMatch.gameId}`}>Open the game</Link>.</>
            : "You have a match ready to play - find it below and start it."}
        </div>
      ) : null}

      {isRoundRobin && bracket.standings?.length ? (
        <>
          <h3 className={styles["section-title"]}>Standings</h3>
          <StandingsTable standings={bracket.standings} currentUserId={currentUserId} />
        </>
      ) : null}

      {grouped.map((section) => {
        const roundsInBracket = Math.max(...section.rounds.map((r) => r.round));
        return (
          <div key={section.bracket} className={styles["bracket-section"]}>
            <h3 className={styles["section-title"]}>{BRACKET_TITLES[section.bracket]}</h3>
            <div className={isRoundRobin ? styles["rounds-stacked"] : styles["rounds-scroller"]}>
              {section.rounds.map((round) => (
                <div key={`${round.bracket}-${round.round}`} className={styles.round}>
                  <div className={styles["round-title"]}>
                    {roundLabel(round.bracket, round.round, roundsInBracket)}
                  </div>
                  <div className={styles["round-matches"]}>
                    {round.matches.map((match) => (
                      <MatchCard
                        key={match.key}
                        match={match}
                        currentUserId={currentUserId}
                        onPlay={handlePlay}
                        isStarting={startingKey === match.key}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
};

export default TournamentBracket;
