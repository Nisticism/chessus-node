import React, { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { users } from "../../actions/users";
import styles from "./leaderboard.module.scss";

const Leaderboard = () => {
  const dispatch = useDispatch();
  const [firstRender, setFirstRender] = useState(false);
  const allUsers = useSelector((state) => state.users);

  useEffect(() => {
    if (!firstRender) {
      dispatch(users(1, 10000, { sortBy: 'elo', sortOrder: 'desc' }));
      setFirstRender(true);
    }
  }, [firstRender, dispatch]);

  // Sort users by elo in descending order
  const sortedUsers = allUsers.usersList
    ? [...allUsers.usersList].sort((a, b) => (b.elo || 1000) - (a.elo || 1000))
    : [];

  const getRankClass = (rank) => {
    if (rank === 1) return styles["rank-gold"];
    if (rank === 2) return styles["rank-silver"];
    if (rank === 3) return styles["rank-bronze"];
    return "";
  };

  const getRankIcon = (rank) => {
    if (rank === 1) return "🥇";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return rank;
  };

  return (
    <div className={styles["leaderboard-container"]}>
      <div className={styles["leaderboard-header"]}>
        <h1>Global Leaderboard</h1>
        <p className={styles["subtitle"]}>
          Top players ranked by ELO rating
        </p>
      </div>

      <div className={styles["leaderboard-stats"]}>
        <div className={styles["stat-card"]}>
          <div className={styles["stat-value"]}>{sortedUsers.length}</div>
          <div className={styles["stat-label"]}>Total Players</div>
        </div>
        <div className={styles["stat-card"]}>
          <div className={styles["stat-value"]}>
            {sortedUsers.length > 0 ? sortedUsers[0].elo || 1000 : 0}
          </div>
          <div className={styles["stat-label"]}>Highest ELO</div>
        </div>
        <div className={styles["stat-card"]}>
          <div className={styles["stat-value"]}>1000</div>
          <div className={styles["stat-label"]}>Starting ELO</div>
        </div>
      </div>

      {sortedUsers.length > 0 ? (
        <div className={styles["leaderboard-table"]}>
          <div className={styles["table-header"]}>
            <div className={styles["col-rank"]}>Rank</div>
            <div className={styles["col-player"]}>Player</div>
            <div className={styles["col-elo"]}>ELO Rating</div>
          </div>

          <div className={styles["table-body"]}>
            {sortedUsers.map((user, index) => {
              const rank = index + 1;
              return (
                <div
                  key={user.id}
                  className={`${styles["table-row"]} ${getRankClass(rank)}`}
                >
                  <div className={styles["col-rank"]}>
                    <span className={styles["rank-display"]}>
                      {getRankIcon(rank)}
                    </span>
                  </div>
                  <div className={styles["col-player"]}>
                    <Link to={`/profile/${user.username}`} className={styles["username-link"]}>
                      {user.username}
                    </Link>
                  </div>
                  <div className={styles["col-elo"]}>
                    <span className={styles["elo-value"]}>{user.elo || 1000}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className={styles["empty-message"]}>
          <p>No players found</p>
        </div>
      )}

      <div className={styles["leaderboard-info"]}>
        <h2>About ELO Rating</h2>
        <p>
          The ELO rating system is a method for calculating the relative skill levels of players.
          All players start at 1000 ELO. Your rating increases when you win games and decreases
          when you lose, with the amount depending on the rating difference between you and your opponent.
        </p>
        <p>
          Win games to climb the leaderboard and prove you're the best strategist in GridGrove!
        </p>
      </div>
    </div>
  );
};

export default Leaderboard;
