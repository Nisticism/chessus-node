import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import styles from "./home.module.scss";
import { getGames } from "../../actions/games";
import { getPieces } from "../../actions/pieces";
import { users } from "../../actions/users";

// Import piece images for the interactive board
import { 
  WhitePawn, BlackPawn, 
  WhiteKnight, BlackKnight,
  WhiteBishup, BlackBishup,
  WhiteRook, BlackRook,
  WhiteQueen, BlackQueen,
  WhiteKing, BlackKing 
} from '../../assets/piece-images.js';

const Home = () => {
  const dispatch = useDispatch();
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const allGames = useSelector((state) => state.games);
  const allPieces = useSelector((state) => state.pieces);
  const allUsers = useSelector((state) => state.users);

  const [boardSize, setBoardSize] = useState(8);
  const [selectedLayout, setSelectedLayout] = useState('chess');

  useEffect(() => {
    dispatch(getGames());
    dispatch(getPieces());
    dispatch(users());
  }, [dispatch]);

  // Different piece layouts for the interactive board
  const pieceLayouts = {
    chess: [
      // White pieces (bottom)
      { row: 7, col: 0, image: WhiteRook, name: 'Rook' },
      { row: 7, col: 1, image: WhiteKnight, name: 'Knight' },
      { row: 7, col: 2, image: WhiteBishup, name: 'Bishop' },
      { row: 7, col: 3, image: WhiteQueen, name: 'Queen' },
      { row: 7, col: 4, image: WhiteKing, name: 'King' },
      { row: 7, col: 5, image: WhiteBishup, name: 'Bishop' },
      { row: 7, col: 6, image: WhiteKnight, name: 'Knight' },
      { row: 7, col: 7, image: WhiteRook, name: 'Rook' },
      // White pawns
      { row: 6, col: 0, image: WhitePawn, name: 'Pawn' },
      { row: 6, col: 1, image: WhitePawn, name: 'Pawn' },
      { row: 6, col: 2, image: WhitePawn, name: 'Pawn' },
      { row: 6, col: 3, image: WhitePawn, name: 'Pawn' },
      { row: 6, col: 4, image: WhitePawn, name: 'Pawn' },
      { row: 6, col: 5, image: WhitePawn, name: 'Pawn' },
      { row: 6, col: 6, image: WhitePawn, name: 'Pawn' },
      { row: 6, col: 7, image: WhitePawn, name: 'Pawn' },
      // Black pieces (top)
      { row: 0, col: 0, image: BlackRook, name: 'Rook' },
      { row: 0, col: 1, image: BlackKnight, name: 'Knight' },
      { row: 0, col: 2, image: BlackBishup, name: 'Bishop' },
      { row: 0, col: 3, image: BlackQueen, name: 'Queen' },
      { row: 0, col: 4, image: BlackKing, name: 'King' },
      { row: 0, col: 5, image: BlackBishup, name: 'Bishop' },
      { row: 0, col: 6, image: BlackKnight, name: 'Knight' },
      { row: 0, col: 7, image: BlackRook, name: 'Rook' },
      // Black pawns
      { row: 1, col: 0, image: BlackPawn, name: 'Pawn' },
      { row: 1, col: 1, image: BlackPawn, name: 'Pawn' },
      { row: 1, col: 2, image: BlackPawn, name: 'Pawn' },
      { row: 1, col: 3, image: BlackPawn, name: 'Pawn' },
      { row: 1, col: 4, image: BlackPawn, name: 'Pawn' },
      { row: 1, col: 5, image: BlackPawn, name: 'Pawn' },
      { row: 1, col: 6, image: BlackPawn, name: 'Pawn' },
      { row: 1, col: 7, image: BlackPawn, name: 'Pawn' },
    ],
    knights: [
      // All knights battle
      { row: 7, col: 1, image: WhiteKnight, name: 'Knight' },
      { row: 7, col: 3, image: WhiteKnight, name: 'Knight' },
      { row: 7, col: 5, image: WhiteKnight, name: 'Knight' },
      { row: 7, col: 7, image: WhiteKnight, name: 'Knight' },
      { row: 6, col: 0, image: WhiteKnight, name: 'Knight' },
      { row: 6, col: 2, image: WhiteKnight, name: 'Knight' },
      { row: 6, col: 4, image: WhiteKnight, name: 'Knight' },
      { row: 6, col: 6, image: WhiteKnight, name: 'Knight' },
      { row: 0, col: 0, image: BlackKnight, name: 'Knight' },
      { row: 0, col: 2, image: BlackKnight, name: 'Knight' },
      { row: 0, col: 4, image: BlackKnight, name: 'Knight' },
      { row: 0, col: 6, image: BlackKnight, name: 'Knight' },
      { row: 1, col: 1, image: BlackKnight, name: 'Knight' },
      { row: 1, col: 3, image: BlackKnight, name: 'Knight' },
      { row: 1, col: 5, image: BlackKnight, name: 'Knight' },
      { row: 1, col: 7, image: BlackKnight, name: 'Knight' },
    ],
    queens: [
      // Queen's gambit style
      { row: 7, col: 3, image: WhiteQueen, name: 'Queen' },
      { row: 7, col: 4, image: WhiteKing, name: 'King' },
      { row: 6, col: 2, image: WhitePawn, name: 'Pawn' },
      { row: 6, col: 3, image: WhitePawn, name: 'Pawn' },
      { row: 6, col: 4, image: WhitePawn, name: 'Pawn' },
      { row: 6, col: 5, image: WhitePawn, name: 'Pawn' },
      { row: 4, col: 3, image: WhitePawn, name: 'Pawn' },
      { row: 0, col: 3, image: BlackQueen, name: 'Queen' },
      { row: 0, col: 4, image: BlackKing, name: 'King' },
      { row: 1, col: 2, image: BlackPawn, name: 'Pawn' },
      { row: 1, col: 4, image: BlackPawn, name: 'Pawn' },
      { row: 1, col: 5, image: BlackPawn, name: 'Pawn' },
      { row: 3, col: 3, image: BlackPawn, name: 'Pawn' },
    ],
  };

  // Get piece at a specific position
  const getPieceAt = (row, col) => {
    const layout = pieceLayouts[selectedLayout] || pieceLayouts.chess;
    return layout.find(p => p.row === row && p.col === col);
  };

  // Generate the interactive board
  const renderBoard = () => {
    const squares = [];
    for (let row = 0; row < boardSize; row++) {
      for (let col = 0; col < boardSize; col++) {
        const isLight = (row + col) % 2 === 0;
        const piece = getPieceAt(row, col);
        
        squares.push(
          <div 
            key={`${row}-${col}`}
            className={`${styles.square} ${isLight ? styles.light : styles.dark}`}
          >
            {piece && (
              <img 
                src={piece.image} 
                alt={piece.name}
                className={styles["piece-image"]}
                title={piece.name}
              />
            )}
          </div>
        );
      }
    }
    return squares;
  };

  // Calculate stats
  const gamesCount = allGames.gamesList?.length || 0;
  const piecesCount = allPieces.piecesList?.length || 0;
  const usersCount = allUsers.usersList?.length || 0;

  return (
    <div className={styles["home-container"]}>
      {/* Hero Section */}
      <section className={styles["hero-section"]}>
        <h1 className={styles["hero-title"]}>
          Welcome to <span className={styles.highlight}>Squarestrat</span>
        </h1>
        <p className={styles["hero-tagline"]}>
          Where Strategy Meets Creativity
        </p>
        <p className={styles["hero-description"]}>
          Squarestrat is a community-driven platform for creating, sharing, and playing 
          custom strategy board games. Design your own pieces with unique movement patterns, 
          craft game rules with custom win conditions, and challenge players worldwide. 
          Chess was just the beginning — discover what comes next.
        </p>
        <div className={styles["hero-buttons"]}>
          {currentUser ? (
            <>
              <Link to="/create/game" className={styles["primary-button"]}>
                ♟️ Create a Game
              </Link>
              <Link to="/play" className={styles["secondary-button"]}>
                ⚔️ Play Now
              </Link>
            </>
          ) : (
            <>
              <Link to="/register" className={styles["primary-button"]}>
                🚀 Get Started
              </Link>
              <Link to="/login" className={styles["secondary-button"]}>
                🔑 Sign In
              </Link>
            </>
          )}
        </div>
      </section>

      {/* Interactive Board Section */}
      <section className={styles["board-section"]}>
        <div className={styles["section-header"]}>
          <h2>Experience the Board</h2>
          <p>Explore different piece configurations and game setups</p>
        </div>

        <div className={styles["board-showcase"]}>
          <div className={styles["interactive-board-container"]}>
            <div className={styles["board-wrapper"]}>
              <div 
                className={styles["board-grid"]}
                style={{
                  gridTemplateColumns: `repeat(${boardSize}, 1fr)`,
                  gridTemplateRows: `repeat(${boardSize}, 1fr)`
                }}
              >
                {renderBoard()}
              </div>
              <div className={styles["board-controls"]}>
                <button 
                  className={`${styles["control-button"]} ${selectedLayout === 'chess' ? styles.active : ''}`}
                  onClick={() => setSelectedLayout('chess')}
                >
                  Classic Chess
                </button>
                <button 
                  className={`${styles["control-button"]} ${selectedLayout === 'knights' ? styles.active : ''}`}
                  onClick={() => setSelectedLayout('knights')}
                >
                  Knight Battle
                </button>
                <button 
                  className={`${styles["control-button"]} ${selectedLayout === 'queens' ? styles.active : ''}`}
                  onClick={() => setSelectedLayout('queens')}
                >
                  Queen's Gambit
                </button>
              </div>
            </div>
          </div>

          <div className={styles["board-info"]}>
            <div className={styles["info-card"]}>
              <h3>Create Your Own Rules</h3>
              <ul className={styles["info-list"]}>
                <li>
                  <span className={styles["info-icon"]}>⭐</span>
                  <span>Define custom win conditions: checkmate, capture targets, control zones, and more</span>
                </li>
                <li>
                  <span className={styles["info-icon"]}>♟️</span>
                  <span>Design unique pieces with custom movement patterns and special abilities</span>
                </li>
                <li>
                  <span className={styles["info-icon"]}>📐</span>
                  <span>Create boards of any size from tiny 4×4 arenas to massive 96×96 battlefields</span>
                </li>
                <li>
                  <span className={styles["info-icon"]}>👥</span>
                  <span>Support 2+ players with customizable turn actions and team configurations</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className={styles["features-section"]}>
        <div className={styles["section-header"]}>
          <h2>Explore Squarestrat</h2>
          <p>Everything you need to create, share, and play</p>
        </div>

        <div className={styles["features-grid"]}>
          <Link to="/create/games" className={styles["feature-card"]}>
            <div className={styles["feature-icon"]}>🎲</div>
            <h3>Game Library</h3>
            <p>
              Browse community-created games with unique rules, win conditions, and strategies. 
              From chess variants to entirely new concepts.
            </p>
            <span className={styles["feature-link"]}>
              Explore Games <span className={styles.arrow}>→</span>
            </span>
          </Link>

          <Link to="/create/pieces" className={styles["feature-card"]}>
            <div className={styles["feature-icon"]}>♛</div>
            <h3>Piece Workshop</h3>
            <p>
              Design custom pieces with unique movement patterns, capture rules, and special abilities. 
              Upload your own artwork.
            </p>
            <span className={styles["feature-link"]}>
              View Pieces <span className={styles.arrow}>→</span>
            </span>
          </Link>

          <Link to="/community/players" className={styles["feature-card"]}>
            <div className={styles["feature-icon"]}>👥</div>
            <h3>Community</h3>
            <p>
              Connect with other strategists, view player profiles, check the leaderboard, 
              and find opponents for your favorite games.
            </p>
            <span className={styles["feature-link"]}>
              Meet Players <span className={styles.arrow}>→</span>
            </span>
          </Link>

          <Link to="/media/forums" className={styles["feature-card"]}>
            <div className={styles["feature-icon"]}>💬</div>
            <h3>Forums & Discussion</h3>
            <p>
              Discuss strategies, share tips, propose rule changes, and engage in 
              conversations about your favorite games.
            </p>
            <span className={styles["feature-link"]}>
              Join Discussion <span className={styles.arrow}>→</span>
            </span>
          </Link>
        </div>
      </section>

      {/* Stats Section */}
      <section className={styles["stats-section"]}>
        <div className={styles["stats-grid"]}>
          <div className={styles["stat-item"]}>
            <div className={styles["stat-value"]}>{gamesCount}</div>
            <div className={styles["stat-label"]}>Custom Games</div>
          </div>
          <div className={styles["stat-item"]}>
            <div className={styles["stat-value"]}>{piecesCount}</div>
            <div className={styles["stat-label"]}>Unique Pieces</div>
          </div>
          <div className={styles["stat-item"]}>
            <div className={styles["stat-value"]}>{usersCount}</div>
            <div className={styles["stat-label"]}>Players</div>
          </div>
          <div className={styles["stat-item"]}>
            <div className={styles["stat-value"]}>∞</div>
            <div className={styles["stat-label"]}>Possibilities</div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className={styles["cta-section"]}>
        <h2>Ready to Reinvent Strategy Gaming?</h2>
        <p>
          Join a community of creative strategists who believe the best board game 
          hasn't been invented yet. Will you be the one to create it?
        </p>
        {currentUser ? (
          <Link to="/create" className={styles["primary-button"]}>
            🛠️ Start Creating
          </Link>
        ) : (
          <Link to="/register" className={styles["primary-button"]}>
            ♟️ Join Squarestrat
          </Link>
        )}
      </section>
    </div>
  );
};

export default Home;