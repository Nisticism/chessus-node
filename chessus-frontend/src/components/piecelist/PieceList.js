import React, { useState, useEffect } from "react";
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from "react-redux";
import { getPieces, deletePiece } from "../../actions/pieces";
import Pagination from "../pagination/Pagination";
import styles from "./piecelist.module.scss";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

const PieceList = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const allPieces = useSelector((state) => state.pieces);
  const [currentPage, setCurrentPage] = useState(1);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pieceToDelete, setPieceToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const [, setAlertMessage] = useState("");
  const [, setAlertType] = useState(""); // "success" or "error"
  const [displayColor, setDisplayColor] = useState("p1"); // "p1" (white/light), "p2" (black/dark), "both"
  const dispatch = useDispatch();
  const navigate = useNavigate();

  useEffect(() => {
    dispatch(getPieces(currentPage, 20));
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

  const getFirstImage = (imageLocation) => {
    if (!imageLocation) return null;
    
    try {
      const images = JSON.parse(imageLocation);
      if (Array.isArray(images) && images.length > 0) {
        const index = displayColor === 'p2' && images.length > 1 ? 1 : 0;
        const imagePath = images[index];
        return imagePath.startsWith('http') ? imagePath : `${ASSET_URL}${imagePath}`;
      }
    } catch {
      const imagePath = imageLocation;
      if (imagePath.startsWith('http')) {
        return imagePath;
      } else if (imagePath.startsWith('/uploads/')) {
        return `${ASSET_URL}${imagePath}`;
      } else {
        return `${ASSET_URL}/uploads/pieces/${imagePath}`;
      }
    }
    
    return null;
  };

  // Separate pieces into user's pieces and other pieces
  // Filter out any pieces without valid IDs
  const myPieces = allPieces.piecesList 
    ? allPieces.piecesList.filter(piece => piece.id && currentUser && piece.creator_id === currentUser.id)
    : [];
  
  const otherPieces = allPieces.piecesList 
    ? allPieces.piecesList.filter(piece => piece.id && (!currentUser || piece.creator_id !== currentUser.id))
    : [];

  const pagination = allPieces.pagination;
  const totalCount = pagination?.total || 0;

  const canEditPiece = (piece) => {
    if (!currentUser) return false;
    return piece.creator_id === currentUser.id || currentUser.role === "Admin";
  };

  const handleEditPiece = (pieceId) => {
    navigate(`/create/piece/edit/${pieceId}`);
  };

  const handleDeleteClick = (piece) => {
    setPieceToDelete(piece);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!pieceToDelete) return;
    
    setIsDeleting(true);
    try {
      await deletePiece(pieceToDelete.id);
      setShowDeleteModal(false);
      setPieceToDelete(null);
      setAlertMessage(`Successfully deleted "${pieceToDelete.piece_name}"`);
      setAlertType('success');
      setShowAlert(true);
      // Force a fresh fetch after delete
      setTimeout(() => {
        dispatch(getPieces(currentPage, 20));
      }, 100);
    } catch (error) {
      console.error("Error deleting piece:", error);
      setAlertMessage("Failed to delete piece: " + (error.response?.data?.message || error.message));
      setAlertType('error');
      setShowAlert(true);
    } finally {
      setIsDeleting(false);
    }
  };

  const renderPieceCard = (piece, showEditButton = false) => {
    const firstImage = getFirstImage(piece.image_location);
    return (
      <div className={styles["piece-card"]}>
        <Link to={`/pieces/${piece.id}`} className={styles["piece-link"]}>
          <div className={styles["piece-image-container"]}>
            {firstImage ? (
              <img 
                src={firstImage} 
                alt={piece.piece_name} 
                className={styles["piece-image"]}
                onError={(e) => {
                  const img = e.currentTarget;
                  if (img.dataset.retry !== '1') {
                    img.dataset.retry = '1';
                    const separator = firstImage.includes('?') ? '&' : '?';
                    img.src = `${firstImage}${separator}cb=${Date.now()}`;
                    return;
                  }
                  img.style.display = 'none';
                }}
              />
            ) : (
              <div className={styles["piece-placeholder"]}>
                <span>🎭</span>
              </div>
            )}
          </div>
          
          <div className={styles["piece-content"]}>
            <h3 className={styles["piece-name"]}>{piece.piece_name || 'Unnamed Piece'}</h3>
            
            <p className={styles["piece-description"]}>
              {piece.piece_description || 'No description available'}
            </p>

            <div className={styles["piece-meta"]}>
              <div className={styles["meta-item"]}>
                <span className={styles["meta-label"]}>Size:</span>
                <span>{piece.piece_width || 1}x{piece.piece_height || 1}</span>
              </div>
              {piece.game_type_name && (
                <div className={styles["meta-item"]}>
                  <span className={styles["meta-label"]}>Game:</span>
                  <span>{piece.game_type_name}</span>
                </div>
              )}
            </div>
          </div>
        </Link>
        
        <div className={styles["piece-footer"]}>
          {piece.creator_username && (
            <div className={styles["meta-item"]}>
              <span className={styles["meta-label"]}>Creator:</span>
              <Link 
                to={`/profile/${piece.creator_username}`} 
                className={styles["creator-link"]}
                onClick={(e) => e.stopPropagation()}
              >
                {piece.creator_username}
              </Link>
            </div>
          )}

          {showEditButton && canEditPiece(piece) && (
            <div className={styles["piece-actions"]}>
              <button 
                className={styles["edit-button"]}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleEditPiece(piece.id);
                }}
              >
                ✏️ Edit
              </button>
              <button 
                className={styles["delete-button"]}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDeleteClick(piece);
                }}
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
    <div className={styles["pieces-container"]}>
      <div className={styles["page-header"]}>
        <h1>Piece Library</h1>
        <p className={styles["subtitle"]}>
          Browse and manage custom pieces for your games
        </p>
        
        {currentUser ? (
          <Link to="/create/piece" className={styles["create-button"]}>
            + Create New Piece
          </Link>
        ) : (
          <button
            className={styles["create-button"]}
            onClick={() => navigate('/login', { state: { message: "Please log in to create a piece." } })}
          >
            + Create New Piece
          </button>
        )}

        <div className={styles["color-toggle"]}>
          <span className={styles["toggle-label"]}>Show pieces as</span>
          <div className={styles["toggle-group"]}>
            <button
              className={`${styles["toggle-btn"]} ${displayColor === 'p1' ? styles["active"] : ''}`}
              onClick={() => setDisplayColor('p1')}
            >
              Light
            </button>
            <button
              className={`${styles["toggle-btn"]} ${displayColor === 'p2' ? styles["active"] : ''}`}
              onClick={() => setDisplayColor('p2')}
            >
              Dark
            </button>
          </div>
        </div>
      </div>

      {/* My Pieces Section */}
      {myPieces.length > 0 && (
        <section className={styles["pieces-section"]}>
          <div className={styles["section-header"]}>
            <h2>🎨 My Pieces</h2>
            <span className={styles["piece-count"]}>{myPieces.length} on this page</span>
          </div>
          <div className={styles["pieces-grid"]}>
            {myPieces.map(piece => (
              <React.Fragment key={piece.id}>
                {renderPieceCard(piece, true)}
              </React.Fragment>
            ))}
          </div>
        </section>
      )}

      {/* Community Pieces Section */}
      <section className={styles["pieces-section"]}>
        <div className={styles["section-header"]}>
          <h2>🌍 All Pieces</h2>
          <span className={styles["piece-count"]}>
            {totalCount} total piece{totalCount !== 1 ? 's' : ''}
          </span>
        </div>
        
        {otherPieces.length > 0 ? (
          <div className={styles["pieces-grid"]}>
            {otherPieces.map(piece => (
              <React.Fragment key={piece.id}>
                {renderPieceCard(piece, currentUser?.role === "Admin")}
              </React.Fragment>
            ))}
          </div>
        ) : myPieces.length === 0 ? (
          <div className={styles["empty-section"]}>
            <p>No pieces found.</p>
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

      {/* All Pieces Empty State */}
      {(!allPieces.piecesList || allPieces.piecesList.length === 0) && (
        <div className={styles["empty-state"]}>
          <div className={styles["empty-icon"]}>🧩</div>
          <h3>No Pieces Yet</h3>
          <p>Create your first custom piece to get started!</p>
          {currentUser ? (
            <Link to="/create/piece" className={styles["create-button"]}>
              Create a Piece
            </Link>
          ) : (
            <button
              className={styles["create-button"]}
              onClick={() => navigate('/login', { state: { message: "Please log in to create a piece." } })}
            >
              Create a Piece
            </button>
          )}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className={styles["modal-overlay"]} onClick={() => setShowDeleteModal(false)}>
          <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()}>
            <h3>Delete Piece</h3>
            <p>Are you sure you want to delete "{pieceToDelete?.piece_name}"?</p>
            <p className={styles["warning-text"]}>This action cannot be undone.</p>
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

export default PieceList;
