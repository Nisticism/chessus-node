import React, { useState, useEffect } from "react";
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from "react-redux";
import { getGames, deleteGame, toggleUpvote } from "../../actions/games";
import Pagination from "../pagination/Pagination";
import styles from "./gamelist.module.scss";

const GameList = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const allGames = useSelector((state) => state.games);
  const [currentPage, setCurrentPage] = useState(1);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [gameToDelete, setGameToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");
  const [alertType, setAlertType] = useState(""); // "success" or "error"
  const [sortBy, setSortBy] = useState("newest");
  const [winConditionFilter, setWinConditionFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [upvotedGames, setUpvotedGames] = useState({});
  const dispatch = useDispatch();
  const navigate = useNavigate();

  useEffect(() => {
    const creatorId = sortBy === 'my_games' && currentUser ? currentUser.id : '';
    const actualSort = sortBy === 'my_games' ? 'newest' : sortBy;
    const includeDrafts = sortBy === 'my_games' && currentUser ? 'true' : '';
    dispatch(getGames(currentPage, 20, actualSort, winConditionFilter, searchQuery, creatorId, includeDrafts));
  }, [currentPage, sortBy, winConditionFilter, searchQuery, currentUser, dispatch]);

  const handleSortChange = (e) => {
    setSortBy(e.target.value);
    setCurrentPage(1);
  };

  const handleFilterChange = (e) => {
    setWinConditionFilter(e.target.value);
    setCurrentPage(1);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setSearchQuery(searchInput);
    setCurrentPage(1);
  };

  // Auto-filter: debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let timer;
    if (showAlert) {
      timer = setTimeout(() => {
        setShowAlert(false);
        setAlertMessage('');
        setAlertType("");
      }, 2000);
    }
    return () => clearTimeout(timer);
  }, [showAlert]);

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Filter out any games without valid IDs
  const games = allGames.gamesList 
    ? allGames.gamesList.filter(game => game.id)
    : [];

  // Sync upvote state from server data whenever the games list refreshes.
  // This ensures the upvote highlight persists across page loads/refreshes.
  useEffect(() => {
    if (!currentUser || games.length === 0) return;
    const serverState = {};
    games.forEach(g => { serverState[g.id] = Boolean(g.upvoted_by_user); });
    setUpvotedGames(serverState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games.map(g => g.id).join(','), currentUser?.id]);

  const pagination = allGames.pagination;
  const totalCount = pagination?.total || 0;

  const isAdmin = currentUser && (currentUser.role?.toLowerCase() === 'admin' || currentUser.role?.toLowerCase() === 'owner');

  const canEditGame = (game) => {
    if (!currentUser) return false;
    return game.creator_id === currentUser.id || isAdmin;
  };

  const handleEditGame = (gameId) => {
    navigate(`/create/game/edit/${gameId}`);
  };

  const handleDeleteClick = (game) => {
    setGameToDelete(game);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!gameToDelete) return;
    
    setIsDeleting(true);
    try {
      await dispatch(deleteGame(gameToDelete.id));
      setShowDeleteModal(false);
      setGameToDelete(null);
      setAlertMessage(`Successfully deleted "${gameToDelete.game_name}"`);
      setAlertType('success');
      setShowAlert(true);
      // Force a fresh fetch after delete
      setTimeout(() => {
        const creatorId = sortBy === 'my_games' && currentUser ? currentUser.id : '';
        const actualSort = sortBy === 'my_games' ? 'newest' : sortBy;
        const includeDrafts = sortBy === 'my_games' && currentUser ? 'true' : '';
        dispatch(getGames(currentPage, 20, actualSort, winConditionFilter, searchQuery, creatorId, includeDrafts));
      }, 100);
    } catch (error) {
      console.error("Error deleting game:", error);
      setAlertMessage("Failed to delete game: " + (error.response?.data?.message || error.message));
      setAlertType('error');
      setShowAlert(true);
    } finally {
      setIsDeleting(false);
    }
  };

  const formatPlayerCount = (count) => {
    if (!count || count === 2) return "2 players";
    return `${count} players`;
  };

  const handleUpvote = async (e, gameId) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentUser) return;
    try {
      const result = await toggleUpvote(gameId);
      setUpvotedGames(prev => ({ ...prev, [gameId]: result.upvoted }));
      // Update the count in the redux store games list
      const creatorId = sortBy === 'my_games' && currentUser ? currentUser.id : '';
      const actualSort = sortBy === 'my_games' ? 'newest' : sortBy;
      const includeDrafts = sortBy === 'my_games' && currentUser ? 'true' : '';
      dispatch(getGames(currentPage, 20, actualSort, winConditionFilter, searchQuery, creatorId, includeDrafts));
    } catch (err) {
      console.error("Error toggling upvote:", err);
    }
  };

  const formatBoardSize = (width, height) => {
    if (!width || !height) return "Standard";
    return `${width}×${height}`;
  };

  const getWinCondition = (game) => {
    const conditions = [];
    if (game.mate_condition) conditions.push("Checkmate");
    if (game.capture_condition) conditions.push("Capture");
    if (game.value_condition) conditions.push(game.value_title || "Points");
    if (game.squares_condition) conditions.push("Territory");
    if (game.hill_condition) conditions.push("King of the Hill");
    if (game.piece_count_condition) conditions.push("Piece Count");
    if (game.no_moves_condition) conditions.push("No Legal Moves");
    if (game.promotion_condition) conditions.push("Win on Promotion");
    if (game.lose_all_pieces_condition) conditions.push("Lose All Pieces");
    if (game.stalemate_win_condition) conditions.push("Stalemate Win");
    if (game.points_to_win != null) conditions.push("Points");
    // forced_capture_condition is a movement mechanic, not a win condition —
    // it is shown in the game detail page under Special Rules, not here.
    return conditions.length > 0 ? conditions.join(", ") : "Capture (default)";
  };

  const getPieceCount = (game) => {
    if (game.pieces_string) {
      try {
        const pieces = JSON.parse(game.pieces_string);
        const pieceArray = Array.isArray(pieces)
          ? pieces.filter(p => !p._occupied)
          : Object.values(pieces).filter(p => !p._occupied);
        const p1 = pieceArray.filter(p => (p.player_number || p.player_id || p.player) === 1).length;
        const p2 = pieceArray.filter(p => (p.player_number || p.player_id || p.player) === 2).length;
        const neutral = pieceArray.filter(p => (p.is_neutral) || (p.player_number || p.player_id || p.player) === 0).length;
        if (p1 > 0 || p2 > 0 || neutral > 0) {
          const base = p1 === p2 ? `${p1} each` : `${p1} / ${p2}`;
          return neutral > 0 ? `${base}, ${neutral} neutral` : base;
        }
      } catch { /* fall through */ }
    }
    if (game.starting_piece_count) {
      const per = Math.floor(game.starting_piece_count / 2);
      return `${per} each`;
    }
    return "None";
  };

  const renderGameCard = (game, showEditButton = false) => {
    const isDraft = Boolean(game.is_draft);
    return (
      <div key={game.id} className={`${styles["game-card"]} ${isDraft ? styles["draft-card"] : ''}`}>
        {isDraft && <div className={styles["draft-ribbon"]}>DRAFT</div>}
        <Link to={isDraft ? `/create/game/edit/${game.id}` : `/games/${game.id}`} className={styles["game-link"]}>
          <div className={styles["game-header"]}>
            {!isDraft && <div
              className={styles["game-icon"]}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                navigate(`/play?gameTypeId=${game.id}`);
              }}
              title="Play this game"
            >▶</div>}
            <div className={styles["game-title-area"]}>
              <h3 className={styles["game-name"]}>{game.game_name || 'Unnamed Game'}</h3>
              <span className={styles["game-board-info"]}>
                {formatBoardSize(game.board_width, game.board_height)} board
              </span>
            </div>
            <div
              className={`${styles["upvote-btn"]} ${upvotedGames[game.id] ? styles["upvoted"] : ''}`}
              onClick={(e) => handleUpvote(e, game.id)}
              title={currentUser ? "Upvote this game" : "Log in to upvote"}
            >
              <span className={styles["upvote-icon"]}>{upvotedGames[game.id] ? '▲' : '△'}</span>
              <span>{game.upvote_count || 0}</span>
            </div>
          </div>
          
          <div className={styles["game-content"]}>
            <p className={styles["game-description"]}>
              {game.descript && game.descript.trim() ? game.descript : 'No description available'}
            </p>

            {game.creator_username && (
              <div className={styles["game-creator-byline"]}>
                Created by{' '}
                {game.creator_username === 'Anonymous' ? (
                  <span>Anonymous</span>
                ) : (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      navigate(`/profile/${game.creator_username}`);
                    }}
                    style={{ cursor: 'pointer', textDecoration: 'none' }}
                    className={styles["creator-byline-link"]}
                  >
                    {game.creator_username}
                  </span>
                )}
              </div>
            )}

            <div className={styles["game-stats"]}>
              <div className={styles["stat-item"]}>
                <span className={styles["stat-icon"]}>⚔</span>
                <span>{formatPlayerCount(game.player_count)}</span>
              </div>
              <div className={styles["stat-item"]}>
                <span className={styles["stat-icon"]}>⚡</span>
                <span>{game.actions_per_turn || 1} action{(game.actions_per_turn || 1) !== 1 ? 's' : ''}/turn</span>
              </div>
              <div className={styles["stat-item"]}>
                <span className={styles["stat-icon"]}>♟</span>
                <span>Pieces: {getPieceCount(game)}</span>
              </div>
            </div>

            <div className={styles["game-meta"]}>
              {game.creator_username && (
                <div className={styles["meta-item"]}>
                  <span className={styles["meta-label"]}>Creator:</span>
                  {game.creator_username === 'Anonymous' ? (
                    <span className={styles["creator-link"]}>Anonymous</span>
                  ) : (
                    <span 
                      className={styles["creator-link"]}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        navigate(`/profile/${game.creator_username}`);
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      {game.creator_username}
                    </span>
                  )}
                </div>
              )}
              <div className={styles["meta-item"]}>
                <span className={styles["meta-label"]}>Win Conditions:</span>
                <span>{getWinCondition(game)}</span>
              </div>
            </div>
          </div>
        </Link>

        {showEditButton && canEditGame(game) && (
          <div className={styles["game-actions"]}>
            <button 
              className={styles["edit-button"]}
              onClick={(e) => {
                e.preventDefault();
                handleEditGame(game.id);
              }}
            >
              ✏️ Edit
            </button>
            <button 
              className={styles["delete-button"]}
              onClick={(e) => {
                e.preventDefault();
                handleDeleteClick(game);
              }}
            >
              🗑️ Delete
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={styles["games-container"]}>
      {showAlert && (
        <div id="alert-container" className={styles["alert-container"]}>
          <div className={`${styles["alert-style"]} ${styles[`alert-${alertType}`]}`}>
            {alertMessage}
          </div>
        </div>
      )}
      
      <div className={styles["page-header"]}>
        <div className={styles["header-row"]}>
          <h1>Game Library</h1>
          <Link to="/create/game" className={styles["create-button"]}>
            + Create New Game
          </Link>
        </div>
        <p className={styles["subtitle"]}>
          Browse and manage custom game types
        </p>

        <div className={styles["filter-controls"]}>
          <form className={styles["search-form"]} onSubmit={handleSearch}>
            <input
              type="text"
              className={styles["search-input"]}
              placeholder="Search games..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <button type="submit" className={styles["search-button"]}>Search</button>
          </form>
          <div className={styles["filter-row"]}>
            <div className={styles["filter-group"]}>
              <label className={styles["filter-label"]}>Sort by</label>
              <select className={styles["filter-select"]} value={sortBy} onChange={handleSortChange}>
                <option value="newest">Newest</option>
                <option value="popular">Most Popular</option>
                <option value="most_upvoted">Most Upvoted</option>
                <option value="last_played">Recently Played</option>
                <option value="alphabetical">Alphabetical</option>
                {currentUser && <option value="my_games">My Games</option>}
              </select>
            </div>
            <div className={styles["filter-group"]}>
              <label className={styles["filter-label"]}>Win Condition</label>
              <select className={styles["filter-select"]} value={winConditionFilter} onChange={handleFilterChange}>
                <option value="">All</option>
                <option value="checkmate">Checkmate</option>
                <option value="capture">Capture</option>
                <option value="points">Points</option>
                <option value="territory">Territory</option>
                <option value="piece_count">Piece Count</option>
                <option value="no_moves">No Legal Moves</option>
                <option value="promotion">Win on Promotion</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Games Section */}
      <section className={styles["games-section"]}>
        <div className={styles["section-header"]}>
          <h2>{sortBy === 'my_games' ? '♟️ My Games' : '🌍 All Games'}</h2>
          <span className={styles["game-count"]}>
            {totalCount} total game{totalCount !== 1 ? 's' : ''}
          </span>
        </div>
        
        {games.length > 0 ? (
          <div className={styles["games-grid"]}>
            {games.map(game => renderGameCard(game, true))}
          </div>
        ) : (
          <div className={styles["empty-section"]}>
            <p>{sortBy === 'my_games' ? 'You haven\'t created any games yet.' : 'No games found.'}</p>
          </div>
        )}
      </section>

      {pagination && (
        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.totalPages}
          onPageChange={handlePageChange}
        />
      )}

      {/* All Games Empty State */}
      {(!allGames.gamesList || allGames.gamesList.length === 0) && sortBy !== 'my_games' && (
        <div className={styles["empty-state"]}>
          <div className={styles["empty-icon"]}>🎲</div>
          <h3>No Games Yet</h3>
          <p>Create your first custom game type to get started!</p>
          <Link to="/create/game" className={styles["create-button"]}>
            Create a Game
          </Link>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className={styles["modal-overlay"]} onClick={() => setShowDeleteModal(false)}>
          <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter' && !isDeleting) handleConfirmDelete(); }}>
            <h3>Delete Game</h3>
            <p>Are you sure you want to delete "{gameToDelete?.game_name}"?</p>
            <p className={styles["warning-text"]}>This will also delete the associated forum. This action cannot be undone.</p>
            <div className={styles["modal-actions"]}>
              <button 
                className={styles["cancel-button"]}
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button 
                className={styles["confirm-delete-button"]}
                onClick={handleConfirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GameList;
