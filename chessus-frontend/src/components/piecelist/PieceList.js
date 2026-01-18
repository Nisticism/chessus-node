import React, { useState, useEffect } from "react";
import { Navigate, Link } from 'react-router-dom';
import { useDispatch, useSelector } from "react-redux";
import { getPieces } from "../../actions/pieces";
import styles from "./piecelist.module.scss";

const PieceList = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const allPieces = useSelector((state) => state.pieces);
  const [firstRender, setFirstRender] = useState(false);
  const dispatch = useDispatch();

  useEffect(() => {
    if (!firstRender) {
      dispatch(getPieces());
      setFirstRender(true);
    }
  }, [firstRender, dispatch]);

  if (!currentUser) {
    return <Navigate to="/login" state={{ message: "Please log in to view this page" }} />;
  }

  const getFirstImage = (imageLocation) => {
    if (!imageLocation) return null;
    
    try {
      // Try to parse as JSON array first
      const images = JSON.parse(imageLocation);
      if (Array.isArray(images) && images.length > 0) {
        // If it's a JSON array, get the first image and ensure it has the full URL
        const imagePath = images[0];
        return imagePath.startsWith('http') ? imagePath : `http://localhost:3001${imagePath}`;
      }
    } catch {
      // If JSON parsing fails, treat as a plain string
      const imagePath = imageLocation;
      // Check if it's already a full URL or needs the base URL
      if (imagePath.startsWith('http')) {
        return imagePath;
      } else if (imagePath.startsWith('/uploads/')) {
        return `http://localhost:3001${imagePath}`;
      } else {
        // Legacy format - assume it's in uploads/pieces/
        return `http://localhost:3001/uploads/pieces/${imagePath}`;
      }
    }
    
    return null;
  };

  return (
    <div className={styles["piece-list-container"]}>
      <h1 className={styles["pieces-found"]}>
        {allPieces.piecesList ? allPieces.piecesList.length : 0} pieces found
      </h1>
      <div className={styles["pieces-table"]}>
        {allPieces.piecesList ? (
          <table>
            <tbody>
              <tr>
                <th>Image</th>
                <th>Piece Name</th>
                <th>Description</th>
                <th>Creator</th>
                <th>Game Types</th>
              </tr>
              {allPieces.piecesList.map(function(piece) {
                const firstImage = getFirstImage(piece.image_location);
                console.log(`Piece: ${piece.piece_name}, image_location: ${piece.image_location}, firstImage: ${firstImage}`);
                return (
                  <tr key={piece.id}>
                    <td>
                      {firstImage ? (
                        <img 
                          src={firstImage} 
                          alt={piece.piece_name} 
                          className={styles["piece-image"]}
                          onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'inline';
                          }}
                        />
                      ) : null}
                      <span style={{display: firstImage ? 'none' : 'inline'}}>
                        {firstImage ? 'Image failed to load' : 'No image'}
                      </span>
                    </td>
                    <td>{piece.piece_name || 'N/A'}</td>
                    <td>{piece.piece_description || ''}</td>
                    <td>
                      {piece.creator_username ? (
                        <Link to={"/profile/" + piece.creator_username}>
                          {piece.creator_username}
                        </Link>
                      ) : (
                        ''
                      )}
                    </td>
                    <td>{piece.game_type_name || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p>Loading pieces...</p>
        )}
      </div>
    </div>
  );
};

export default PieceList;
