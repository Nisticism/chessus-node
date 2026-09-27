import { useState, useEffect, useMemo, useCallback } from "react";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import { getPieceById } from "../../actions/pieces";
import { createMoveEngine } from "../../helpers/moveEngine";
import { movesOf } from "./puzzleFootprint";

/*
 * A puzzle board's move engine, in the browser.
 *
 * Every board that draws a puzzle - the puzzle page, the home page card, the
 * Discord activity - needs the same three things to answer "where can this
 * piece go": the pieces' definitions, the board's pieces in the shape the
 * engine reads, and the engine itself. They lived in the puzzle page alone,
 * and the other two asked the server instead, one request per hovered piece,
 * which is what made hovering lag there. Answering from the browser is what
 * the game page and the puzzle page already do.
 *
 * The server still judges every move; this only draws.
 *
 * gameType: the game type row, when the caller already has it (the puzzle page
 * does). Otherwise it is fetched by gameTypeId - it carries the special
 * squares, which change what some pieces can do.
 *
 * apiBase: where to ask, when it is not the site's API - the Discord activity
 * runs inside Discord and has to go through its proxy.
 */

/*
 * The `pieces` table's column names are not the names the move engine reads. A
 * live game renames eight of them when it builds its piece objects; spreading a
 * raw row without doing the same leaves the engine seeing no movement, silently
 * - which is why a knight would show no hover dots at all.
 */
const ENGINE_FIELD_RENAMES = {
  ratio_one_movement: 'ratio_movement_1',
  ratio_two_movement: 'ratio_movement_2',
  ratio_one_capture: 'ratio_capture_1',
  ratio_two_capture: 'ratio_capture_2',
  step_by_step_movement_value: 'step_movement_value',
  step_by_step_movement_style: 'step_movement_style',
  step_by_step_capture: 'step_capture_value',
};

const toEngineFields = (row) => {
  const out = { ...row };
  for (const [from, to] of Object.entries(ENGINE_FIELD_RENAMES)) {
    if (row?.[from] !== undefined) out[to] = row[from];
  }
  return out;
};

export { toEngineFields };

const usePuzzleEngine = ({ placements, gameType = null, gameTypeId = null, enPassantTarget = null, boardWidth = null, boardHeight = null, apiBase = null }) => {
  const [pieceDataMap, setPieceDataMap] = useState({});
  const [fetchedGameType, setFetchedGameType] = useState(null);
  const board = gameType || fetchedGameType;

  useEffect(() => {
    if (gameType || !gameTypeId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${apiBase || API_URL}games/${gameTypeId}`);
        if (!cancelled) setFetchedGameType(data);
      } catch (_) { /* special squares are then simply absent */ }
    })();
    return () => { cancelled = true; };
  }, [gameType, gameTypeId, apiBase]);

  useEffect(() => {
    const ids = [...new Set(Object.values(placements).map((p) => p.piece_id).filter(Boolean))];
    const missing = ids.filter((id) => !pieceDataMap[id]);
    if (!missing.length) return;
    let cancelled = false;
    (async () => {
      const loaded = {};
      await Promise.all(missing.map(async (id) => {
        try {
          loaded[id] = apiBase
            ? (await axios.get(`${apiBase}pieces/${id}`)).data
            : await getPieceById(id);
        } catch (_) { /* image falls back */ }
      }));
      if (!cancelled && Object.keys(loaded).length) setPieceDataMap((prev) => ({ ...prev, ...loaded }));
    })();
    return () => { cancelled = true; };
  }, [placements, pieceDataMap, apiBase]);

  /*
   * The board stores compact placements; the move engine needs full pieces. This
   * is the same merge the server does before it validates - piece definition,
   * plus board position, plus the per-game-type flags that make a piece royal.
   */
  const enginePieces = useMemo(() => {
    return Object.entries(placements).map(([k, pl]) => {
      const [y, x] = k.split(',').map(Number);
      const def = toEngineFields(pieceDataMap[pl.piece_id] || {});
      const player = Number(pl.player_id ?? pl.team ?? 1);
      return {
        ...def,
        id: pl.id || `${pl.piece_id}_${y}_${x}`,
        piece_id: pl.piece_id,
        x, y,
        player_id: player,
        team: player,
        ends_game_on_checkmate: pl.ends_game_on_checkmate ?? def.ends_game_on_checkmate ?? false,
        ends_game_on_capture: pl.ends_game_on_capture ?? def.ends_game_on_capture ?? false,
        /*
         * Castling and first-move state, all of it decided by the server and
         * carried on the placement. The shared client engine reads exactly these
         * names: without hasMoved it would offer a double step to a pawn halfway
         * up the board, and without the resolved partner ids it would never draw
         * a castling dot at all, because partner KEYS are not partner ids.
         */
        hasMoved: !!pl.hasMoved,
        moveCount: Number(pl.moveCount) || 0,
        can_castle: pl.can_castle ?? def.can_castle ?? false,
        castling_distance: pl.castling_distance ?? def.castling_distance ?? null,
        castling_partner_left_id: pl.castling_partner_left_id ?? null,
        castling_partner_right_id: pl.castling_partner_right_id ?? null,
      };
    });
  }, [placements, pieceDataMap]);

  const specialSquares = useMemo(() => {
    const squares = { range: {}, promotion: {}, control: {}, special: {} };
    if (!board) return squares;
    const fields = {
      range: 'range_squares_string',
      promotion: 'promotion_squares_string',
      control: 'control_squares_string',
      special: 'special_squares_string',
    };
    for (const [key, field] of Object.entries(fields)) {
      try { if (board[field]) squares[key] = JSON.parse(board[field]); } catch (_) { /* ignore */ }
    }
    return squares;
  }, [board]);

  // currentPlayerPosition null, same as the replay board: hovering shows a
  // piece's raw reachability rather than filtering by whose turn it is.
  //
  // The en passant target comes from the server, derived from the move that set
  // this position up. Without it a pawn that CAN take en passant shows no dot on
  // the square where the capture happens, and the answer looks illegal.
  const moveEngine = useMemo(() => createMoveEngine({
    specialSquares,
    gameType: board,
    enPassantTarget: enPassantTarget || null,
    currentPlayerPosition: null,
  }), [specialSquares, board, enPassantTarget]);

  const width = Number(boardWidth || board?.board_width) || 8;
  const height = Number(boardHeight || board?.board_height) || 8;

  /*
   * Every piece on the board has its definition, so the engine can answer for
   * any of them. Until then the caller falls back to asking the server.
   */
  const ready = useMemo(
    () => Object.values(placements || {}).every((pl) => !pl?.piece_id || !!pieceDataMap[pl.piece_id]),
    [placements, pieceDataMap]
  );

  /*
   * A piece's dots, the way a live game's hover draws them: raw reachability
   * (skipCheckFilter off, as the puzzle page has it), as a hover display, with
   * the squares it only attacks included. Tagged with the piece (movesOf) so
   * a multi-tile piece's dots cover every square a landing would.
   */
  const hoverMovesFor = useCallback((piece) => {
    if (!piece) return movesOf(null, []);
    return movesOf(piece, moveEngine.calculateValidMoves(
      piece, enginePieces, width, height,
      false,  // skipCheckFilter
      false,  // forPremove
      true,   // forHoverDisplay
      true    // forFog
    ) || []);
  }, [moveEngine, enginePieces, width, height]);

  // One object per change, not per render, so callers can depend on it.
  return useMemo(
    () => ({ pieceDataMap, setPieceDataMap, enginePieces, moveEngine, specialSquares, ready, hoverMovesFor }),
    [pieceDataMap, enginePieces, moveEngine, specialSquares, ready, hoverMovesFor]
  );
};

export default usePuzzleEngine;
