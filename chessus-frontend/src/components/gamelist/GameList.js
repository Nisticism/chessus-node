import React, { useState, useEffect } from "react";
import { Navigate, Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from "react-redux";
import { getGames, deleteGame } from "../../actions/games";
import styles from "./gamelist.module.scss";

const GameList = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const allGames = useSelector((state) => state.games);
  const [firstRender, setFirstRender] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [gameToDelete, setGameToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  useEffect(() => {
    if (!firstRender) {
      dispatch(getGames());
      setFirstRender(true);
    }
  }, [firstRender, dispatch]);

  if (!currentUser) {
    return <Navigate to="/login" state={{ message: "Please log in to view this page" }} />;
  }

  // Separate games into user's games and other games
  const myGames = allGames.gamesList 
    ? allGames.gamesList.filter(game => game.creator_id === currentUser.id)
    : [];
  
  const otherGames = allGames.gamesList 
    ? allGames.gamesList.filter(game => game.creator_id !== currentUser.id)
    : [];

  const canEditGame = (game) => {
    return game.creator_id === currentUser.id || currentUser.role === "Admin";
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
      dispatch(getGames()); // Refresh the list
      setShowDeleteModal(false);
      setGameToDelete(null);
    } catch (error) {
      console.error("Error deleting game:", error);
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

  const renderGameCard = (game, showEditButton = false) => {
    return (
      <div key={game.id} className={styles["game-card"]}>
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
            {game.descript || 'No description available'}
          </p>

          <div className={styles["game-meta"]}>
            {game.creator_username && (
              <div className={styles["meta-item"]}>
                <span className={styles["meta-label"]}>Creator:</span>
                <Link to={`/profile/${game.creator_username}`} className={styles["creator-link"]}>
                  {game.creator_username}
                </Link>
              </div>
            )}
          </div>

          <div className={styles["game-stats"]}>
            <div className={styles["stat-item"]}>
              <span className={styles["stat-icon"]}>👥</span>
              <span>{formatPlayerCount(game.player_count)}</span>
            </div>
            <div className={styles["stat-item"]}>
              <span className={styles["stat-icon"]}>⚡</span>
              <span>{game.actions_per_turn || 1} action{(game.actions_per_turn || 1) !== 1 ? 's' : ''}/turn</span>
            </div>
          </div>

          {showEditButton && canEditGame(game) && (
            <div className={styles["game-actions"]}>
              <button 
                className={styles["edit-button"]}
                onClick={() => handleEditGame(game.id)}
              >
                ✏️ Edit
              </button>
              <button 
                className={styles["delete-button"]}
                onClick={() => handleDeleteClick(game)}
              >
                🗑️ Delete
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={styles["games-container"]}>
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
            <span className={styles["game-count"]}>{myGames.length} game{myGames.length !== 1 ? 's' : ''}</span>
          </div>
          <div className={styles["games-grid"]}>
            {myGames.map(game => renderGameCard(game, true))}
          </div>
        </section>
      )}

      {/* Community Games Section */}
      <section className={styles["games-section"]}>
        <div className={styles["section-header"]}>
          <h2>🌍 Community Games</h2>
          <span className={styles["game-count"]}>
            {otherGames.length} game{otherGames.length !== 1 ? 's' : ''}
          </span>
        </div>
        
        {otherGames.length > 0 ? (
          <div className={styles["games-grid"]}>
            {otherGames.map(game => renderGameCard(game, currentUser.role === "Admin"))}
          </div>
        ) : (
          <div className={styles["empty-section"]}>
            <p>No community games yet. Be the first to share!</p>
          </div>
        )}
      </section>

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
          <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()}>
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
