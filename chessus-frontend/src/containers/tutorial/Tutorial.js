import React, { useState } from "react";
import { Link } from "react-router-dom";
import styles from "./tutorial.module.scss";

const tutorialSteps = [
  {
    title: "Step 1: Create the Pieces",
    content: `Before building your chess game, you need to create all six piece types. Go to **Create > New Piece** to open the Piece Wizard for each one.`,
    pieces: [
      {
        name: "Pawn",
        movement: "1 square forward (2 on first move), captures 1 square diagonally forward",
        settings: [
          "Set **Up Movement** to 1",
          "Enable **First Move Only** with Up Movement of 2",
          "Set **Directional Movement Style** to forward-only relative to player",
          "For capture: set **Up-Left Attack** and **Up-Right Attack** to 1",
          "Enable **Can Promote** (pawns promote when reaching the far end)",
          "Enable **Can En Passant** for the en passant special capture"
        ]
      },
      {
        name: "Rook",
        movement: "Any number of squares horizontally or vertically",
        settings: [
          "Set **Up Movement**, **Down Movement**, **Left Movement**, **Right Movement** each to **Infinite** (or a high number like 8 for an 8×8 board — both work the same)",
          "Leave diagonal movements at 0",
          "Movement and attack patterns are the same (default)"
        ]
      },
      {
        name: "Knight",
        movement: "L-shape: 2 squares in one direction, 1 square perpendicular (jumps over pieces)",
        settings: [
          "Set **Ratio One Movement** to 2 and **Ratio Two Movement** to 1",
          "This creates the L-shaped movement pattern automatically",
          "Enable **Hopping** so the knight can jump over other pieces (this must be set manually)"
        ]
      },
      {
        name: "Bishop",
        movement: "Any number of squares diagonally",
        settings: [
          "Set **Up-Left**, **Up-Right**, **Down-Left**, **Down-Right** movements each to **Infinite** (or 8 for an 8×8 board)",
          "Leave horizontal and vertical movements at 0",
          "Movement and attack patterns are the same (default)"
        ]
      },
      {
        name: "Queen",
        movement: "Any number of squares in any direction (horizontal, vertical, or diagonal)",
        settings: [
          "Set all 8 directional movements (Up, Down, Left, Right, Up-Left, Up-Right, Down-Left, Down-Right) to **Infinite** (or 8 for an 8×8 board)",
          "This gives the queen full range in every direction"
        ]
      },
      {
        name: "King",
        movement: "1 square in any direction",
        settings: [
          "Set all 8 directional movements to 1",
          "Enable **Can Castle** — the king can castle with rooks"
        ]
      }
    ]
  },
  {
    title: "Step 2: Create the Game",
    content: `Now go to **Create > New Game** to set up your chess board and rules.`,
    substeps: [
      {
        heading: "Basic Info",
        details: [
          "In **Step 1** of the Game Wizard, set the **Game Name** (e.g. \"Classic Chess\") and optionally a **Description**",
          "Set **Actions Per Turn** to 1 — each player moves one piece per turn in standard chess"
        ]
      },
      {
        heading: "Win Conditions",
        details: [
          "In the **Win Conditions** section (Step 2 of the Game Wizard), enable **Checkmate** as the win condition",
          "This means the game ends when a player's King is in check and has no legal move to escape"
        ]
      },
      {
        heading: "Draw Conditions",
        details: [
          "In the same step, configure the draw rules that standard chess uses:",
          "Enable **Stalemate** — the game is a draw if the current player has no legal moves but is not in check",
          "Enable **50 Move Rule** and set the move limit to 50 — the game is drawn if 50 consecutive moves are made by both sides without a capture or pawn move",
          "Enable **Threefold Repetition** — the game is drawn if the same board position occurs three times (with the same player to move)"
        ]
      },
      {
        heading: "Board Setup",
        details: [
          "Set **Board Width** to 8 and **Board Height** to 8",
          "Open the **Special Squares** modal and mark the top row (row 8) and bottom row (row 1) as **Promotion Squares** — when a pawn reaches one of these squares, the player chooses a piece to promote to",
          "Tip: use the **Fill Row** option in the Special Squares modal to mark an entire row at once instead of clicking each square individually"
        ]
      }
    ]
  },
  {
    title: "Step 3: Place the Pieces",
    content: `In the game designer's board view, place pieces in the standard chess starting positions. Select a piece from the piece palette, then click squares on the board to place them. Row 1 is the bottom row of the board — this is where the white pieces go.`,
    layout: [
      { row: "Row 1 — bottom (White)", pieces: "Rook, Knight, Bishop, Queen, King, Bishop, Knight, Rook" },
      { row: "Row 2 (White)", pieces: "8 Pawns" },
      { row: "Rows 3–6", pieces: "Empty" },
      { row: "Row 7 (Black)", pieces: "8 Pawns" },
      { row: "Row 8 — top (Black)", pieces: "Rook, Knight, Bishop, Queen, King, Bishop, Knight, Rook" }
    ],
    tips: [
      "Make sure to assign Player 1 to white pieces and Player 2 to black pieces",
      "Mark both Kings with **Ends Game on Checkmate** when placing them",
      "Tip: use the **Fill Row** option when placing pawns to fill an entire row at once instead of clicking each square"
    ]
  },
  {
    title: "Step 4: Save and Play!",
    content: `Give your game a name like "Classic Chess" and save it. You can now:`,
    substeps: [
      {
        heading: "Test It",
        details: [
          "Open the game page and review the auto-generated rules to make sure everything looks right",
          "Use the **Sandbox** to test piece movements and interactions"
        ]
      },
      {
        heading: "Play Online",
        details: [
          "Go to **Play > Browse Open Games** and create a new match with your chess variant",
          "Share the link with a friend or wait for an opponent to join"
        ]
      }
    ]
  }
];

const Tutorial = () => {
  const [expandedSteps, setExpandedSteps] = useState({ 0: true });

  const toggleStep = (index) => {
    setExpandedSteps(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const expandAll = () => {
    const all = {};
    tutorialSteps.forEach((_, i) => { all[i] = true; });
    setExpandedSteps(all);
  };

  const collapseAll = () => {
    setExpandedSteps({});
  };

  return (
    <div className={styles["tutorial-container"]}>
      <div className={styles["tutorial-header"]}>
        <h1>How to Create Chess on GridGrove</h1>
        <p className={styles["subtitle"]}>
          A step-by-step guide to recreating standard chess using the Piece Wizard and Game Designer
        </p>
        <div className={styles["expand-controls"]}>
          <button onClick={expandAll} className={styles["expand-button"]}>Expand All</button>
          <button onClick={collapseAll} className={styles["expand-button"]}>Collapse All</button>
        </div>
      </div>

      <div className={styles["tutorial-steps"]}>
        {tutorialSteps.map((step, index) => {
          const isOpen = expandedSteps[index];
          return (
            <div key={index} className={`${styles["step"]} ${isOpen ? styles["open"] : ""}`}>
              <button className={styles["step-header"]} onClick={() => toggleStep(index)}>
                <span className={styles["step-title"]}>{step.title}</span>
                <span className={styles["toggle-icon"]}>{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen && (
                <div className={styles["step-content"]}>
                  <p className={styles["step-description"]}>
                    {step.content.split(/(\*\*[^*]+\*\*)/).map((part, i) => {
                      if (part.startsWith('**') && part.endsWith('**')) {
                        return <strong key={i}>{part.slice(2, -2)}</strong>;
                      }
                      return part;
                    })}
                  </p>

                  {step.pieces && (
                    <div className={styles["pieces-grid"]}>
                      {step.pieces.map((piece, pi) => (
                        <div key={pi} className={styles["piece-card"]}>
                          <h4 className={styles["piece-name"]}>{piece.name}</h4>
                          <p className={styles["piece-movement"]}>{piece.movement}</p>
                          <ul className={styles["piece-settings"]}>
                            {piece.settings.map((setting, si) => (
                              <li key={si}>
                                {setting.split(/(\*\*[^*]+\*\*)/).map((part, j) => {
                                  if (part.startsWith('**') && part.endsWith('**')) {
                                    return <strong key={j}>{part.slice(2, -2)}</strong>;
                                  }
                                  return part;
                                })}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}

                  {step.substeps && (
                    <div className={styles["substeps"]}>
                      {step.substeps.map((sub, si) => (
                        <div key={si} className={styles["substep"]}>
                          <h4>{sub.heading}</h4>
                          <ul>
                            {sub.details.map((detail, di) => (
                              <li key={di}>
                                {detail.split(/(\*\*[^*]+\*\*)/).map((part, j) => {
                                  if (part.startsWith('**') && part.endsWith('**')) {
                                    return <strong key={j}>{part.slice(2, -2)}</strong>;
                                  }
                                  return part;
                                })}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}

                  {step.layout && (
                    <div className={styles["board-layout"]}>
                      <table className={styles["layout-table"]}>
                        <thead>
                          <tr>
                            <th>Row</th>
                            <th>Pieces</th>
                          </tr>
                        </thead>
                        <tbody>
                          {step.layout.map((row, ri) => (
                            <tr key={ri}>
                              <td>{row.row}</td>
                              <td>{row.pieces}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {step.tips && (
                        <div className={styles["tips"]}>
                          <strong>Tips:</strong>
                          <ul>
                            {step.tips.map((tip, ti) => (
                              <li key={ti}>
                                {tip.split(/(\*\*[^*]+\*\*)/).map((part, j) => {
                                  if (part.startsWith('**') && part.endsWith('**')) {
                                    return <strong key={j}>{part.slice(2, -2)}</strong>;
                                  }
                                  return part;
                                })}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles["tutorial-footer"]}>
        <p>
          Once you've mastered standard chess, try experimenting! Add custom pieces, change the board size, 
          or create entirely new win conditions. The possibilities are endless.
        </p>
        <div className={styles["footer-links"]}>
          <Link to="/create/piece" className={styles["footer-link"]}>New Piece</Link>
          <Link to="/create/game" className={styles["footer-link"]}>New Game</Link>
          <Link to="/faq" className={styles["footer-link"]}>Back to FAQ</Link>
        </div>
      </div>
    </div>
  );
};

export default Tutorial;
