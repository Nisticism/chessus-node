import React, { useState, useEffect } from "react";
import { Navigate, Link } from 'react-router-dom';
import { useDispatch, useSelector } from "react-redux";
import axios from "axios";
import { getAllPieces } from "../../actions/pieces";
import styles from "./pieces.module.scss";
import { pieces as pieceImages } from '../../assets/pieces.js';

const Pieces = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const allUsers = useSelector((state) => state.users);
  const [loading, setLoading] = useState(false);
  const { message } = useSelector(state => state.message);
  const [ messageDisplay, setMessageDisplay ] = useState(false);
  const [firstRender, setFirstRender] = useState(false);
  const [pieces, setPieces] = useState(null);
  // const [pieceImages, setPieceImages] = pieceImagesImport;
  const dispatch = useDispatch();

  useEffect(() => {
    if (!firstRender) {
      getPieces();
      setFirstRender(true);
    }
  }, [firstRender]);

  async function getPieces() {
    let result = await getAllPieces();
    setPieces(result);
    console.log(result[0]);
    console.log(pieceImages);
  }

  if (!currentUser) {
    return <Navigate to="/login" />;
  }
  return (
    <div className={styles["pieces-list-container"]}>
      <p>
        <strong>Your Id:</strong> {currentUser.id}
      </p>
      <h1 className={styles["pieces-found"]}>{pieces ? pieces.length : 0} pieces found</h1>
      <div className={styles["pieces-table"]}>
        { pieces ?

          <table>
            <tbody>
            <tr>
              <th>
                Pieces ID
              </th>
              <th>
                Image
              </th>
              <th>
                Pieces Name
              </th>
              <th>
                Piece Description
              </th>
              <th>
                Creator
              </th>
              <th>
                Games found in
              </th>
              <th>
                Category
              </th>
          </tr>
            {
              pieces.map(function(piece) {
                return (
                  <tr key={piece.id}>
                    <td>
                      {piece.id}
                    </td>
                    <td>
                      {/* <img src={piece.image_location} width="50px" height="50px" alt="piece name" /> */}
                      <img src={pieceImages[0].src} alt="piece image" width="100" height="100"></img>
                      {/* {piece.image_location} */}
                    </td>
                    <td>
                    <Link to={"/piece/" + piece.piece_name}>
                      {piece.piece_name}
                    </Link>
                    </td>
                    <td>
                      {/* {piece.piece_description}
                      {piece.image_location} */}
                      {true.toString()}
                      {((piece.image_location) === '../../assets/pieces/White-pawn.png').toString()}
                      
                      <img src={require(`../../assets/pieces/${piece.image_location}`)} alt="piece image" width="100" height="100"></img>

                    </td>
                    <td>
                      {piece.creator_id}
                    </td>
                    <td>
                      {piece.game_type_id}
                    </td>
                    <td>
                      {piece.piece_category}
                    </td>
                  </tr>
                )
              })
            }
            </tbody>
          </table>
        
 : <p>blank</p>
        }
      </div>
    </div>
  );
};

export default Pieces;