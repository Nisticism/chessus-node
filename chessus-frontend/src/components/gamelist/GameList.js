import React, { useState, useEffect } from "react";
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from "react-redux";
import { getGames, deleteGame } from "../../actions/games";
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
  const dispatch = useDispatch();
  const navigate = useNavigate();

  useEffect(() => {
    dispatch(getGames(currentPage, 20));
  }, [currentPage, dispatch]);

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

  // Separate games into user's games and other games
  // Filter out any games without valid IDs
  const myGames = allGames.gamesList 
    ? allGames.gamesList.filter(game => game.id && currentUser && game.creator_id === currentUser.id)
    : [];
  
  const otherGames = allGames.gamesList 
    ? allGames.gamesList.filter(game => game.id && (!currentUser || game.creator_id !== currentUser.id))
    : [];

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
        dispatch(getGames(currentPage, 20));
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
    return conditions.length > 0 ? conditions.join(", ") : "None";
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
        if (p1 > 0 || p2 > 0) {
          return p1 === p2 ? `${p1} each` : `${p1} / ${p2}`;
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
    return (
      <div key={game.id} className={styles["game-card"]}>
        <Link to={`/games/${game.id}`} className={styles["game-link"]}>
          <div className={styles["game-header"]}>
            <div className={styles["game-icon"]}>♟️</div>
            <div className={styles["game-title-area"]}>
              <h3 className={styles["game-name"]}>{game.game_name || 'Unnamed Game'}</h3>
              <span className={styles["game-board-info"]}>
                {formatBoardSize(game.board_width, game.board_height)} board
              </span>
            </div>
          </div>
          
          <div className={styles["game-content"]}>
            <p className={styles["game-description"]}>
              {game.descript && game.descript.trim() ? game.descript : 'No description available'}
            </p>

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
                <span className={styles["meta-label"]}>Win:</span>
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
        <h1>Game Library</h1>
        <p className={styles["subtitle"]}>
          Browse and manage custom game types
        </p>
        <Link to="/create/game" className={styles["create-button"]}>
          + Create New Game
        </Link>
      </div>

      {/* My Games Section */}
      {myGames.length > 0 && (
        <section className={styles["games-section"]}>
          <div className={styles["section-header"]}>
            <h2>♟️ My Games</h2>
            <span className={styles["game-count"]}>{myGames.length} on this page</span>
          </div>
          <div className={styles["games-grid"]}>
            {myGames.map(game => renderGameCard(game, true))}
          </div>
        </section>
      )}

      {/* Community Games Section */}
      <section className={styles["games-section"]}>
        <div className={styles["section-header"]}>
          <h2>🌍 All Games</h2>
          <span className={styles["game-count"]}>
            {totalCount} total game{totalCount !== 1 ? 's' : ''}
          </span>
        </div>
        
        {otherGames.length > 0 ? (
          <div className={styles["games-grid"]}>
            {otherGames.map(game => renderGameCard(game, isAdmin))}
          </div>
        ) : myGames.length === 0 ? (
          <div className={styles["empty-section"]}>
            <p>No games found.</p>
          </div>
        ) : null}
      </section>

      {pagination && (
        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.totalPages}
          onPageChange={handlePageChange}
        />
      )}

      {/* All Games Empty State */}
      {(!allGames.gamesList || allGames.gamesList.length === 0) && (
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
