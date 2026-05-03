import React, { useState, useCallback, useEffect, useRef } from "react";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";

/* -----------------------------------------------------------------------
   Piece abbreviation helper
   ----------------------------------------------------------------------- */
function getPieceAbbrev(name) {
  if (!name) return "??";
  const n = name.trim();
  const lower = n.toLowerCase();
  if (lower === "king")   return "K";
  if (lower === "queen")  return "Q";
  if (lower === "rook")   return "R";
  if (lower === "bishop") return "Bi";
  if (lower === "knight") return "Kn";
  if (lower === "pawn")   return "P";
  // Custom pieces: first two chars uppercased (trim to 3 max)
  return n.slice(0, 3).toUpperCase();
}

/* -----------------------------------------------------------------------
   Board state engine
   Apply a single move to a piece list; returns a new piece list.
   ----------------------------------------------------------------------- */
function applyMove(pieces, move) {
  let board = pieces.slice();

  if (move.isCastling) {
    // Find the castling piece by its exact name as recorded in the log.
    // Do NOT hard-code a search for "king" — custom games may use any name
    // for the royal/castling piece.
    const castlerIdx = board.findIndex(
      (p) => p.player === move.player && p.pieceName === move.pieceName,
    );
    if (castlerIdx === -1) return board;
    const castler = board[castlerIdx];

    // Use the actual king destination from the log if available (new format).
    // Fall back to the +2/-2 heuristic for old O-O / O-O-O notation.
    const kingNewX = (move.toX !== null && move.toX !== undefined)
      ? move.toX
      : (move.castleSide === "kingside" ? castler.x + 2 : castler.x - 2);
    const rookSide = move.castleSide === "kingside" ? 1 : -1;
    // Find nearest same-player piece in the castling direction on the same row
    // (the castling partner, whatever it's named).
    const rookIdx = board.reduce((found, p, i) => {
      if (i === castlerIdx) return found;
      if (p.player !== move.player) return found;
      if (p.y !== castler.y) return found;
      if (rookSide === 1 && p.x <= castler.x) return found;
      if (rookSide === -1 && p.x >= castler.x) return found;
      if (found === -1) return i;
      const curDist = Math.abs(board[found].x - castler.x);
      const newDist = Math.abs(p.x - castler.x);
      return newDist < curDist ? i : found;
    }, -1);
    board = board.map((p, i) => {
      if (i === castlerIdx) return { ...p, x: kingNewX };
      if (rookIdx !== -1 && i === rookIdx) return { ...p, x: kingNewX - rookSide };
      return p;
    });
    return board;
  }

  if (move.fromX === null || move.fromX === undefined) return board;

  // Find the moving piece
  const movingIdx = board.findIndex(
    (p) => p.player === move.player && p.x === move.fromX && p.y === move.fromY,
  );
  if (movingIdx === -1) return board;
  const movingPiece = board[movingIdx];

  // Remove captured piece at destination — but ONLY when the move is an
  // actual capture (separator 'x' in the log, move.isCapture === true).
  // Non-capture moves that land on occupied squares happen with ghostwalk /
  // pass-through pieces; blindly filtering would erase those pieces from the
  // visual board even though the Rust engine leaves them alive.
  if (move.isCapture) {
    // For multi-tile pieces the stored position is the anchor square.
    // A capture is valid if the destination falls anywhere within the
    // piece's bounding box [x, x+pw) × [y, y+ph).
    const overlaps = (p, tx, ty) => {
      const pw = p.pieceWidth  || 1;
      const ph = p.pieceHeight || 1;
      return tx >= p.x && tx < p.x + pw && ty >= p.y && ty < p.y + ph;
    };

    const hadPieceAtDest = board.some(
      (p) => p.instanceId !== movingPiece.instanceId && overlaps(p, move.toX, move.toY),
    );
    board = board.filter(
      (p) =>
        p.instanceId === movingPiece.instanceId ||
        !overlaps(p, move.toX, move.toY),
    );
    // En-passant: the captured pawn is NOT at the destination square —
    // it sits on the same rank as the mover (fromY) and the same file as
    // the destination (toX).  If nothing was at the destination but the log
    // says a piece was captured, check the en-passant square.
    if (!hadPieceAtDest && move.capturedName) {
      board = board.filter(
        (p) =>
          p.instanceId === movingPiece.instanceId ||
          !overlaps(p, move.toX, move.fromY),
      );
    }
  }

  // Recalculate index after filter
  const newIdx = board.findIndex((p) => p.instanceId === movingPiece.instanceId);
  if (newIdx === -1) return board;

  // Move piece (and handle promotion)
  board = board.map((p, i) => {
    if (i !== newIdx) return p;
    return {
      ...p,
      x: move.toX,
      y: move.toY,
      pieceName: move.promotesTo || p.pieceName,
    };
  });
  return board;
}

/* -----------------------------------------------------------------------
   Build a board state at a given move index
   (0 = starting position, N = after N moves)
   ----------------------------------------------------------------------- */
function buildBoardAtIndex(startingPieces, moves, targetIndex) {
  let board = startingPieces.slice();
  for (let i = 0; i < targetIndex && i < moves.length; i++) {
    board = applyMove(board, moves[i]);
  }
  return board;
}

/* -----------------------------------------------------------------------
   Lightweight board renderer
   ----------------------------------------------------------------------- */
const CELL_SIZE = 46; // px

const PLAYER_COLORS = {
  1: { bg: "#5b9bd5", text: "#fff" },
  2: { bg: "#e06c75", text: "#fff" },
  3: { bg: "#98c379", text: "#000" },
  4: { bg: "#e5c07b", text: "#000" },
};

function getPlayerStyle(player) {
  return PLAYER_COLORS[player] || { bg: "#aaa", text: "#000" };
}

/**
 * Convert a 0-based column index to a chess file letter.
 * Columns 0–25 → a–z; 26–51 → aa–az; 52–77 → ba–bz; etc.
 * Mirrors the Rust engine's col_to_file() in selfplay.rs.
 */
function colToFile(col) {
  if (col < 26) return String.fromCharCode(97 + col);
  const first  = String.fromCharCode(97 + Math.floor(col / 26) - 1);
  const second = String.fromCharCode(97 + (col % 26));
  return first + second;
}

/** Convert internal (x, y) coords to chess notation, e.g. (4, 6) on 8×8 → "e2". */
function toChessNotation(x, y, boardHeight) {
  return `${colToFile(x)}${boardHeight - y}`;
}

const RANK_LABEL_W = 20; // px reserved for rank-number labels on the left

function BoardRenderer({ boardWidth, boardHeight, pieces }) {
  const lightSq = "#d9c98a";
  const darkSq  = "#8b6c32";

  // Build a map from "x,y" to piece for fast lookup
  const pieceMap = {};
  for (const p of pieces) {
    pieceMap[`${p.x},${p.y}`] = p;
  }

  const maxW = Math.min(boardWidth,  48);
  const maxH = Math.min(boardHeight, 48);
  const cellSize = boardWidth > 16 || boardHeight > 16 ? 32 : CELL_SIZE;
  const fontSize = cellSize < 38 ? "0.65em" : "0.78em";
  const labelFontSize = cellSize < 38 ? "0.58em" : "0.68em";

  const rows = [];
  for (let row = 0; row < maxH; row++) {
    // Rank 1 is at the bottom (y = boardHeight-1 internally)
    const rank = boardHeight - row;
    const cells = [];
    for (let col = 0; col < maxW; col++) {
      const isLight = (row + col) % 2 === 0;
      const piece = pieceMap[`${col},${row}`];
      const playerStyle = piece ? getPlayerStyle(piece.player) : null;

      cells.push(
        <div
          key={col}
          style={{
            width: cellSize,
            height: cellSize,
            background: isLight ? lightSq : darkSq,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            boxSizing: "border-box",
            flexShrink: 0,
          }}
        >
          {piece && (
            <div
              title={`${piece.pieceName} (P${piece.player}) @ ${toChessNotation(col, row, boardHeight)}`}
              style={{
                background: playerStyle.bg,
                color: playerStyle.text,
                borderRadius: 4,
                padding: "1px 3px",
                fontSize,
                fontWeight: 700,
                lineHeight: 1.2,
                textAlign: "center",
                minWidth: cellSize * 0.7,
                maxWidth: cellSize - 4,
                overflow: "hidden",
                whiteSpace: "nowrap",
                userSelect: "none",
                cursor: "default",
              }}
            >
              {getPieceAbbrev(piece.pieceName)}
            </div>
          )}
        </div>,
      );
    }
    rows.push(
      <div key={row} style={{ display: "flex", alignItems: "stretch" }}>
        {/* Rank label on the left */}
        <div
          style={{
            width: RANK_LABEL_W,
            height: cellSize,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            paddingRight: 3,
            fontSize: labelFontSize,
            color: "#bbb",
            fontFamily: "monospace",
            lineHeight: 1,
            userSelect: "none",
          }}
        >
          {rank}
        </div>
        {cells}
      </div>,
    );
  }

  // File labels row at the bottom
  const fileLabels = [
    // Spacer matching the rank-label column width
    <div key="spacer" style={{ width: RANK_LABEL_W, flexShrink: 0 }} />,
  ];
  for (let col = 0; col < maxW; col++) {
    fileLabels.push(
      <div
        key={col}
        style={{
          width: cellSize,
          height: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: labelFontSize,
          color: "#bbb",
          fontFamily: "monospace",
          lineHeight: 1,
          flexShrink: 0,
          userSelect: "none",
        }}
      >
        {colToFile(col)}
      </div>,
    );
  }

  return (
    <div
      style={{
        display: "inline-block",
        border: "2px solid #555",
        lineHeight: 0,
        maxWidth: "100%",
        overflowX: "auto",
      }}
    >
      {rows}
      <div style={{ display: "flex" }}>{fileLabels}</div>
    </div>
  );
}

/* -----------------------------------------------------------------------
   Main modal component
   ----------------------------------------------------------------------- */
export default function AiGameReplayModal({ jobId, onClose }) {
  const [gameNumInput, setGameNumInput] = useState("1");
  const [gameData, setGameData]         = useState(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  const [moveIndex, setMoveIndex]       = useState(0);

  // Current board state derived from gameData + moveIndex
  const [boardPieces, setBoardPieces] = useState([]);

  // Keep track of fetched gameNum so input doesn't reset on re-render
  const lastFetchedGame = useRef(null);
  // Debounce timer for game-number input changes
  const debounceRef = useRef(null);

  const fetchGame = useCallback(
    async (gameNum) => {
      if (!jobId || !gameNum) return;
      const num = parseInt(gameNum, 10);
      if (!Number.isFinite(num) || num < 1) return;
      setLoading(true);
      setError(null);
      try {
        const res = await axios.get(
          `${API_URL}admin/ai-training/jobs/${jobId}/game-replay?game=${num}`,
          { headers: authHeader() },
        );
        setGameData(res.data);
        setMoveIndex(0);
        lastFetchedGame.current = num;
        setBoardPieces(res.data.startingPieces || []);
      } catch (err) {
        setError(
          err?.response?.data?.message || err.message || "Failed to load game",
        );
        setGameData(null);
      } finally {
        setLoading(false);
      }
    },
    [jobId],
  );

  // Load game 1 on mount
  useEffect(() => {
    fetchGame(1);
  }, [fetchGame]);

  // Update board pieces when moveIndex changes
  useEffect(() => {
    if (!gameData) return;
    setBoardPieces(
      buildBoardAtIndex(gameData.startingPieces, gameData.moves, moveIndex),
    );
  }, [gameData, moveIndex]);

  const handleGameNumKeyDown = (e) => {
    if (e.key === "Enter") {
      // Enter triggers immediately — clear any pending debounce
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const num = parseInt(gameNumInput, 10);
      if (Number.isFinite(num) && num >= 1) {
        fetchGame(num);
      }
    }
  };

  const handleGameNumBlur = () => {
    // Blur triggers immediately — clear any pending debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const num = parseInt(gameNumInput, 10);
    if (
      Number.isFinite(num) &&
      num >= 1 &&
      num !== lastFetchedGame.current
    ) {
      fetchGame(num);
    }
  };

  // Debounce: automatically load game 1 second after the user stops typing/clicking
  useEffect(() => {
    const num = parseInt(gameNumInput, 10);
    if (!Number.isFinite(num) || num < 1) return;
    if (num === lastFetchedGame.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchGame(num);
    }, 1000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [gameNumInput, fetchGame]);

  const stepTo = (idx) => {
    if (!gameData) return;
    setMoveIndex(Math.max(0, Math.min(idx, gameData.moves.length)));
  };

  // Arrow-key navigation while the modal is open
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!gameData) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setMoveIndex(prev => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setMoveIndex(prev => Math.min(prev + 1, gameData.moves.length));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameData]);

  const currentMove =
    gameData && moveIndex > 0 ? gameData.moves[moveIndex - 1] : null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.72)",
        zIndex: 9000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "#1e1e1e",
          border: "1px solid #444",
          borderRadius: 8,
          padding: 20,
          width: "min(98vw, 700px)",
          maxHeight: "95vh",
          overflowY: "auto",
          color: "#f0f0f0",
          boxSizing: "border-box",
          wordBreak: "break-word",
          overflowWrap: "break-word",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <h3 style={{ margin: 0 }}>
            Board Replay — Job #{jobId}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#ccc",
              fontSize: "1.4em",
              cursor: "pointer",
              lineHeight: 1,
              padding: "0 4px",
            }}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Game selector */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
            flexWrap: "wrap",
          }}
        >
          <label
            style={{ fontSize: "0.88em", color: "#ccc", display: "flex", alignItems: "center", gap: 6 }}
          >
            Game #
            <input
              type="number"
              min={1}
              max={gameData?.totalGames || undefined}
              value={gameNumInput}
              onChange={(e) => setGameNumInput(e.target.value)}
              onKeyDown={handleGameNumKeyDown}
              onBlur={handleGameNumBlur}
              style={{
                width: 64,
                padding: "4px 6px",
                background: "#111",
                color: "#fff",
                border: "1px solid #555",
                borderRadius: 4,
                fontSize: "0.95em",
              }}
            />
          </label>
          {gameData && (
            <span style={{ fontSize: "0.82em", color: "#999" }}>
              of {gameData.totalGames}
            </span>
          )}
          {loading && (
            <span style={{ fontSize: "0.82em", color: "#aaa" }}>Loading…</span>
          )}
          {error && (
            <span style={{ fontSize: "0.82em", color: "#e06c75" }}>{error}</span>
          )}
        </div>

        {/* Game outcome line */}
        {gameData && (
          <div
            style={{
              fontSize: "0.85em",
              color: "#ccc",
              marginBottom: 10,
              background: "#2a2a2a",
              padding: "6px 10px",
              borderRadius: 4,
            }}
          >
            <strong>Outcome:</strong> {gameData.outcome} &nbsp;|&nbsp;
            <strong>{gameData.totalMoves}</strong> move
            {gameData.totalMoves !== 1 ? "s" : ""} &nbsp;|&nbsp;
            Board {gameData.boardWidth}×{gameData.boardHeight}
          </div>
        )}

        {/* Randomized-positions warning */}
        {gameData?.hasRandomizedPositions && (
          <div
            style={{
              background: "rgba(255, 193, 7, 0.12)",
              color: "#ffd96b",
              border: "1px solid #b8860b",
              borderRadius: 4,
              padding: "7px 10px",
              fontSize: "0.82em",
              marginBottom: 10,
            }}
          >
            <strong>Note:</strong> This game type uses randomized starting positions. Each
            game begins from a different layout, but the board shown here always uses the
            default DB layout. Piece movements may appear incorrect as a result.
          </div>
        )}

        {/* Board */}
        {gameData && (
          <div style={{ overflowX: "auto", marginBottom: 12 }}>
            <BoardRenderer
              boardWidth={gameData.boardWidth}
              boardHeight={gameData.boardHeight}
              pieces={boardPieces}
            />
          </div>
        )}

        {/* Current move label */}
        {gameData && (
          <div
            style={{
              minHeight: 22,
              fontSize: "0.83em",
              color: "#aaa",
              marginBottom: 8,
              fontFamily: "monospace",
              whiteSpace: "normal",
              wordBreak: "break-word",
            }}
          >
            {moveIndex === 0
              ? "Starting position"
              : currentMove
              ? `Move ${moveIndex}/${gameData.totalMoves} — [P${currentMove.player}] ${currentMove.pieceName} ${
                  currentMove.isCastling
                    ? currentMove.castleSide === "kingside"
                      ? "O-O"
                      : "O-O-O"
                    : currentMove.fromX !== null
                    ? `${toChessNotation(currentMove.fromX, currentMove.fromY, gameData.boardHeight)}-${toChessNotation(currentMove.toX, currentMove.toY, gameData.boardHeight)}`
                    : ""
                }${currentMove.capturedName ? ` captures ${currentMove.capturedName}` : ""}${currentMove.promotesTo ? ` =${currentMove.promotesTo}` : ""}`
              : ""}
          </div>
        )}

        {/* Step controls */}
        {gameData && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button
              onClick={() => stepTo(0)}
              disabled={moveIndex === 0}
              style={btnStyle(moveIndex === 0)}
              title="Go to start"
            >
              ⏮ Start
            </button>
            <button
              onClick={() => stepTo(moveIndex - 1)}
              disabled={moveIndex === 0}
              style={btnStyle(moveIndex === 0)}
              title="Previous move"
            >
              ◀ Prev
            </button>
            <span style={{ fontSize: "0.82em", color: "#aaa", minWidth: 70, textAlign: "center" }}>
              {moveIndex} / {gameData.totalMoves}
            </span>
            <button
              onClick={() => stepTo(moveIndex + 1)}
              disabled={moveIndex >= gameData.totalMoves}
              style={btnStyle(moveIndex >= gameData.totalMoves)}
              title="Next move"
            >
              Next ▶
            </button>
            <button
              onClick={() => stepTo(gameData.totalMoves)}
              disabled={moveIndex >= gameData.totalMoves}
              style={btnStyle(moveIndex >= gameData.totalMoves)}
              title="Go to end"
            >
              End ⏭
            </button>
          </div>
        )}

        {/* Player color key */}
        {gameData && (
          <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
            {Array.from(
              new Set(gameData.startingPieces.map((p) => p.player)),
            )
              .sort()
              .map((pl) => {
                const s = getPlayerStyle(pl);
                return (
                  <div
                    key={pl}
                    style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.8em" }}
                  >
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 3,
                        background: s.bg,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: "#ccc" }}>Player {pl}</span>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}

function btnStyle(disabled) {
  return {
    padding: "6px 12px",
    background: disabled ? "#2a2a2a" : "#3a3a3a",
    color: disabled ? "#555" : "#ddd",
    border: "1px solid " + (disabled ? "#333" : "#555"),
    borderRadius: 4,
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: "0.85em",
  };
}
