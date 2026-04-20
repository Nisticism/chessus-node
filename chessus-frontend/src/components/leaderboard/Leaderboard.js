import React, { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { users } from "../../actions/users";
import styles from "./leaderboard.module.scss";

const PAGE_SIZE = 25;

const Leaderboard = () => {
  const dispatch = useDispatch();
  const [page, setPage] = useState(1);
  const allUsers = useSelector((state) => state.users);
  const sortedUsers = allUsers?.usersList || [];
  const pagination = allUsers?.pagination || null;
  const total = pagination?.total ?? sortedUsers.length;
  const totalPages = pagination?.totalPages ?? Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    dispatch(users(page, PAGE_SIZE, { sortBy: 'elo', sortOrder: 'desc' }));
  }, [page, dispatch]);

  const baseRank = (page - 1) * PAGE_SIZE;

  const goTo = (p) => {
    if (p < 1 || p > totalPages || p === page) return;
    setPage(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Build a small page-number list around the current page
  const windowSize = 2;
  const startPage = Math.max(1, page - windowSize);
  const endPage = Math.min(totalPages, page + windowSize);
  const pageButtons = [];
  if (startPage > 1) pageButtons.push(1);
  if (startPage > 2) pageButtons.push('…-l');
  for (let i = startPage; i <= endPage; i++) pageButtons.push(i);
  if (endPage < totalPages - 1) pageButtons.push('…-r');
  if (endPage < totalPages) pageButtons.push(totalPages);

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
          <div className={styles["stat-value"]}>{total}</div>
          <div className={styles["stat-label"]}>Total Players</div>
        </div>
        <div className={styles["stat-card"]}>
          <div className={styles["stat-value"]}>
            {page === 1 && sortedUsers.length > 0 ? (sortedUsers[0].elo || 1000) : '—'}
          </div>
          <div className={styles["stat-label"]}>Highest ELO</div>
        </div>
        <div className={styles["stat-card"]}>
          <div className={styles["stat-value"]}>1000</div>
          <div className={styles["stat-label"]}>Starting ELO</div>
        </div>
      </div>

      {sortedUsers.length > 0 ? (
        <>
          <div className={styles["leaderboard-table"]}>
            <div className={styles["table-header"]}>
              <div className={styles["col-rank"]}>Rank</div>
              <div className={styles["col-player"]}>Player</div>
              <div className={styles["col-elo"]}>ELO Rating</div>
            </div>

            <div className={styles["table-body"]}>
              {sortedUsers.map((user, index) => {
                const rank = baseRank + index + 1;
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

          {totalPages > 1 && (
            <div className={styles["pagination"]}>
              <button
                className={styles["page-btn"]}
                onClick={() => goTo(page - 1)}
                disabled={page <= 1}
                aria-label="Previous page"
              >
                ‹ Prev
              </button>
              {pageButtons.map((p, i) =>
                typeof p === 'number' ? (
                  <button
                    key={`p-${p}`}
                    className={`${styles["page-btn"]} ${p === page ? styles["page-btn-active"] : ''}`}
                    onClick={() => goTo(p)}
                    disabled={p === page}
                  >
                    {p}
                  </button>
                ) : (
                  <span key={`e-${i}`} className={styles["page-ellipsis"]}>…</span>
                )
              )}
              <button
                className={styles["page-btn"]}
                onClick={() => goTo(page + 1)}
                disabled={page >= totalPages}
                aria-label="Next page"
              >
                Next ›
              </button>
              <span className={styles["page-summary"]}>
                Page {page} of {totalPages}
              </span>
            </div>
          )}
        </>
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
