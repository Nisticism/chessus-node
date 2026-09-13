import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useSelector } from "react-redux";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";
import { getGameById } from "../../actions/games";
import { getPieceById } from "../../actions/pieces";
import { useDispatch } from "react-redux";
import InfoTooltip from "../piecewizard/InfoTooltip";
import ListPager, { usePagedList } from "../common/ListPager";
import useBoardViewport from "../common/useBoardViewport";
import BoardZoomControls from "../common/BoardZoomControls";
import boardVp from "../common/boardViewport.module.scss";
import styles from "./puzzlebuilder.module.scss";

/*
 * Puzzle builder.
 *
 * Two modes over one board. ARRANGE sets up the position - drag a piece to an
 * empty square, click it twice to remove it - and SOLUTION records the move the
 * solver is meant to find.
 *
 * Positions are stored in the same compact shape as a game type's
 * pieces_string ({ piece_id, player_id, x, y } plus the per-game-type royal
 * flags) rather than as full piece definitions. The server merges the movement
 * columns back in when it needs to run the engine, so the answer to "what does
 * this piece do" always comes from one place.
 */

/*
 * The goals on offer come from the SERVER, not from a list here, because which
 * goals make sense depends on the game: "stalemate the opponent" is not a puzzle
 * in a game with no stalemate rule, and a game with no royal piece has no
 * checkmate to find. Until they load, this is what a game is assumed to allow -
 * the two the server accepts for every game type.
 */
const FALLBACK_GOALS = [
  { value: 'checkmate_in_1', label: 'Checkmate', mechanical: true, help: 'Find the move that delivers checkmate.' },
  { value: 'win_material', label: 'Win material', mechanical: false, help: 'Say what the solver should win, e.g. "win the rook".' },
  { value: 'specific_move', label: 'Find this exact move', mechanical: false, help: 'The answer is the move you record, whatever the reason.' },
  { value: 'custom', label: 'Something else', mechanical: false, help: 'Describe the goal in your own words.' },
];

// Declared locally, as everywhere else in the app - global.js does not export it.
const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

const keyOf = (x, y) => `${y},${x}`;

const resolveUrl = (p) => (!p ? null : (p.startsWith('http') ? p : `${ASSET_URL}${p}`));

/**
 * Same precedence the rest of the site uses: the placement's own image_url is a
 * deliberate per-square override, so it wins. The piece's image_location is the
 * fallback, indexed by player - which is also the only source that stays correct
 * if a placement was written with an since-moved asset host.
 */
const imageFor = (placement, pieceDataMap) => {
  if (placement?.image_url) return resolveUrl(placement.image_url);
  const loc = placement?.image_location || pieceDataMap[placement?.piece_id]?.image_location;
  if (!loc) return null;
  try {
    const images = typeof loc === 'string' ? JSON.parse(loc) : loc;
    if (Array.isArray(images) && images.length) {
      const idx = Math.min(Number(placement.player_id || 1) - 1, images.length - 1);
      return resolveUrl(images[Math.max(0, idx)]);
    }
  } catch (_) { /* fall through */ }
  return null;
};

// Matches the server's cap. A line is [your move, their reply, ...].
const MAX_MOVES_PER_SIDE = 8;
const MAX_PLIES = MAX_MOVES_PER_SIDE * 2;

const PuzzleBuilder = () => {
  const { gameId, puzzleId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const fromMatch = location.state?.fromMatch || null;
  const dispatch = useDispatch();
  const { user: currentUser } = useSelector((state) => state.authReducer);

  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Board contents, keyed "y,x" to match pieces_string.
  const [placements, setPlacements] = useState({});
  const [startingPlacements, setStartingPlacements] = useState({});

  const [mode, setMode] = useState('arrange');   // 'arrange' | 'setup' | 'solution'
  const [selected, setSelected] = useState(null); // "y,x" of the held piece
  /*
   * The solution is a flat list of plies that ALTERNATES, starting with the side
   * to move: [your move 1, their reply 1, your move 2, ...]. A one-move puzzle
   * is a list of one, which is exactly the shape puzzles had before longer lines
   * existed, so nothing needs converting.
   *
   * The replies are the creator's script rather than an engine's best defence -
   * there is no engine for user-defined pieces. That is the whole reason a long
   * line cannot be verified the way a mate in 1 can.
   */
  const [solutionLine, setSolutionLine] = useState([]);
  const [setupMove, setSetupMove] = useState(null); // the move that led into the position

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sideToMove, setSideToMove] = useState(1);
  const [goal, setGoal] = useState('checkmate_in_1');
  const [goalDescription, setGoalDescription] = useState('');
  const [hideRating, setHideRating] = useState(false);
  /*
   * Whether this puzzle may be picked as a daily one. On by default: being
   * chosen is a compliment rather than an imposition, and most creators want it.
   * Declining is one click and needs nobody's permission.
   */
  const [allowDaily, setAllowDaily] = useState(true);
  const [dailyInfo, setDailyInfo] = useState(null);      // requirements, lazily fetched
  const [dailyModalOpen, setDailyModalOpen] = useState(false);

  const [pieceDataMap, setPieceDataMap] = useState({});

  /*
   * Which goals this game can offer, and its rules, both from the server. The
   * rules travel with the puzzle so a solver who has never played the game can
   * read them without leaving the page; they are shown here too so the creator
   * sees exactly what the solver will see.
   */
  const [goalOptions, setGoalOptions] = useState(FALLBACK_GOALS);
  const [gameRules, setGameRules] = useState(null);

  /*
   * A promotion that is waiting on the creator to say what the piece becomes.
   * Shape: { ply, options } - the ply is held OUT of the line until they choose,
   * because a ply recorded without the choice would be validated against a board
   * where the promotion never happened.
   */
  const [pendingPromotion, setPendingPromotion] = useState(null);

  const [checkResult, setCheckResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState(puzzleId ? Number(puzzleId) : null);

  /*
   * Everything for this game the signed-in account may edit: their own puzzles
   * including drafts, or all of them for an admin or owner. Listed at the foot
   * of the builder so editing an existing puzzle does not mean going back to
   * the game page to find it.
   */
  const [myPuzzles, setMyPuzzles] = useState([]);
  const [puzzleListStaff, setPuzzleListStaff] = useState(false);

  /*
   * Everyone signed in may build; how MANY depends on the account. The server is
   * what enforces it - this only decides what the page says, and it asks rather
   * than guessing, because the free allowance is per game and counted from rows.
   */
  const allowed = !!currentUser;
  const [allowance, setAllowance] = useState(null);

  const boardWidth = game?.board_width || 8;
  const boardHeight = game?.board_height || 8;

  // The shared fit/zoom hook, so a 3x48 or a 25x10 board behaves here exactly
  // as it does in a live game: sized to fit by default, zoomable past that,
  // scrolling inside its own frame rather than stretching the page.
  // How wide the board can possibly be at its default zoom, worked out from the
  // window and the board's own rows - never from the space available. That
  // independence is the point: the board column is capped to this, and the cap
  // feeds the hook's width budget, so deriving it from the available width
  // would be a loop that shrinks the board a square per pass.
  //
  // Without the cap a 3x48 board renders as a thin strip centred in a full-width
  // column, leaving a gulf between it and the settings panel.
  // A board much taller than it is wide leaves the board+settings pair hugging
  // the left of a 1140px panel with a lot of dead space to the right, and the
  // toolbar strung out across the top of nothing. Both centre instead, and the
  // four toolbar buttons stack into a 2x2 block.
  const isSkinnyBoard = boardHeight >= boardWidth * 2;

  // The builder's own list of this game's puzzles, 20 at a time.
  const pagedPuzzles = usePagedList(myPuzzles);

  const vp = useBoardViewport({
    boardWidth,
    boardHeight,
    fitMaxSquare: 72,
    maxSquare: 160,
    maxHeight: () => Math.max(320, (typeof window !== 'undefined' ? window.innerHeight : 900) - 320),
    insetW: 8,
    insetH: 8,
  });

  const boardColumnMax = useMemo(() => {
    const heightBudget = Math.max(320, (typeof window !== 'undefined' ? window.innerHeight : 900) - 320);
    const byHeight = Math.floor((heightBudget - 8) / Math.max(1, boardHeight));
    const fitSquare = Math.max(6, Math.min(72, byHeight));

    // The FLOOR is what keeps this from feeding back on itself. useBoardViewport
    // measures this column to decide how wide the board may be, so a width taken
    // purely from the board is a loop; at the floor the width test always clears
    // the height-limited size, which pins fitSquare to the height whatever the
    // column does. 120px minimum only so a one-file board is still clickable.
    const floorPx = Math.max(120, fitSquare * boardWidth + 24);

    // Above the floor the column follows the board's CURRENT size, so zooming in
    // expands sideways into space that is going spare instead of clipping
    // against a frame stuck at the unzoomed width. A tall board then scrolls
    // vertically only - which is the axis that genuinely cannot fit - and
    // max-width: 100% stops it from pushing past the panel.
    const zoomedPx = (vp.squareSize || 0) * boardWidth + 24;

    // Tall boards get the zoom widget mounted beside the board rather than
    // under it, so it takes a bite out of the same column. Without allowing for
    // it the board is squeezed by exactly the widget's width and scrolls
    // sideways when it did not need to.
    const widgetPx = vp.placement === 'side' ? 64 : 0;
    return Math.max(floorPx, zoomedPx) + widgetPx;
  }, [boardWidth, boardHeight, vp.squareSize, vp.placement]);
  const lightColor = currentUser?.light_square_color || localStorage.getItem('boardLightColor') || '#e3d4bf';
  const darkColor = currentUser?.dark_square_color || localStorage.getItem('boardDarkColor') || '#64472b';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await dispatch(getGameById(gameId));
        if (cancelled) return;
        setGame(data);
        let parsed = {};
        try { parsed = data.pieces_string ? JSON.parse(data.pieces_string) : {}; } catch (_) { parsed = {}; }
        setStartingPlacements(parsed);

        // Arriving from a match replay: seed the board with that position
        // instead of the game's opening setup. Engine pieces carry the flags
        // that make a piece royal, so they are copied across rather than
        // rebuilt - a position without them can never be checkmate.
        if (fromMatch?.pieces?.length) {
          const seeded = {};
          for (const pc of fromMatch.pieces) {
            const pieceId = pc.piece_id ?? parseInt(String(pc.id).split('_')[0], 10);
            if (!Number.isFinite(pieceId)) continue;
            seeded[keyOf(pc.x, pc.y)] = {
              piece_id: pieceId,
              player_id: Number(pc.player_id ?? pc.team ?? 1),
              piece_name: pc.piece_name,
              image_url: pc.image_url,
              image_location: pc.image_location,
              ends_game_on_checkmate: pc.ends_game_on_checkmate,
              ends_game_on_capture: pc.ends_game_on_capture,
            };
          }
          setPlacements(seeded);
          if (fromMatch.setupMove?.from && fromMatch.setupMove?.to) {
            setSetupMove({ from: fromMatch.setupMove.from, to: fromMatch.setupMove.to });
          }
          setCheckResult({
            tone: 'info',
            text: 'Loaded from the match. Rearrange anything you like, then set the solution.',
          });
        } else {
          setPlacements(parsed);
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not load this game');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [gameId, dispatch]);

  // Load an existing draft for editing.
  useEffect(() => {
    if (!puzzleId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${API_URL}puzzles/${puzzleId}`, { headers: authHeader() });
        if (cancelled) return;
        const p = data.puzzle;
        const map = {};
        (p.position || []).forEach((pl) => { map[keyOf(pl.x, pl.y)] = pl; });
        setPlacements(map);
        setTitle(p.title || '');
        setDescription(p.description || '');
        setSideToMove(p.side_to_move || 1);
        setGoal(p.goal || 'checkmate_in_1');
        setGoalDescription(p.goal_description || '');
        setHideRating(!!p.hide_rating);
        setAllowDaily(p.allow_daily === undefined ? true : !!p.allow_daily);
        if (p.setup_move) setSetupMove(p.setup_move);
        if (Array.isArray(p.solution_line)) setSolutionLine(p.solution_line.filter(Boolean));
      } catch (err) {
        if (!cancelled) setError('Could not load that puzzle');
      }
    })();
    return () => { cancelled = true; };
  }, [puzzleId]);

  // How many puzzles this account may still build for this game.
  useEffect(() => {
    if (!gameId || !currentUser) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(
          `${API_URL}game-types/${gameId}/puzzle-allowance`, { headers: authHeader() }
        );
        if (!cancelled) setAllowance(data);
      } catch (_) { /* the server still enforces it on save */ }
    })();
    return () => { cancelled = true; };
  }, [gameId, currentUser]);

  // Which goals this game can offer, and the rules the solver will be shown.
  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${API_URL}game-types/${gameId}/puzzle-goals`);
        if (cancelled) return;
        if (Array.isArray(data?.goals) && data.goals.length) setGoalOptions(data.goals);
        if (data?.rules) setGameRules(data.rules);
      } catch (_) {
        /* the fallback list still lets a puzzle be built */
      }
    })();
    return () => { cancelled = true; };
  }, [gameId]);

  /*
   * A goal loaded from an existing draft may not be in this game's list (the
   * game's win conditions can change under a saved puzzle). Falling back to the
   * first offered goal beats rendering a select with no matching option, which
   * silently shows the wrong one.
   */
  useEffect(() => {
    if (!goalOptions.length) return;
    if (goalOptions.some((g) => g.value === goal)) return;
    setGoal(goalOptions[0].value);
  }, [goalOptions, goal]);

  // Piece definitions for anything on the board, so images survive a placement
  // written against an old asset host.
  useEffect(() => {
    const ids = [...new Set(Object.values(placements).map((p) => p.piece_id).filter(Boolean))];
    const missing = ids.filter((id) => !pieceDataMap[id]);
    if (!missing.length) return;
    let cancelled = false;
    (async () => {
      const loaded = {};
      await Promise.all(missing.map(async (id) => {
        try { loaded[id] = await getPieceById(id); } catch (_) { /* image falls back */ }
      }));
      if (!cancelled && Object.keys(loaded).length) {
        setPieceDataMap((prev) => ({ ...prev, ...loaded }));
      }
    })();
    return () => { cancelled = true; };
  }, [placements, pieceDataMap]);

  /*
   * The board as it stands after the moves recorded so far. Solution mode plays
   * forward from the starting position, so every move after the first is chosen
   * from the position the previous one left behind - which is the only way to
   * record a line by hand without keeping the whole thing in your head.
   */
  const solutionBoard = useMemo(() => {
    const next = { ...placements };
    for (const ply of solutionLine) {
      if (!ply?.from || !ply?.to) continue;
      const fromKey = keyOf(ply.from.x, ply.from.y);
      const mover = next[fromKey];
      if (!mover) continue;
      delete next[fromKey];
      next[keyOf(ply.to.x, ply.to.y)] = {
        ...mover,
        /*
         * Stamp the board id the first time a piece moves, from the square it
         * started on. A piece keeps that id for the whole line - the engine
         * never renames it - so a second move by the same piece has to quote it
         * rather than build a new one from where the piece now stands.
         */
        id: mover.id || `${mover.piece_id}_${ply.from.y}_${ply.from.x}`,
        x: ply.to.x,
        y: ply.to.y,
      };

      /*
       * Castling moves two pieces. The partner jumps to the far side of the
       * square the king landed on, which is what the engine does when it applies
       * the move - so the preview has to do it too, or every ply after a castle
       * is recorded against a board with a rook still sitting in the corner.
       */
      if (ply.isCastling && ply.castlingWith) {
        // Board keys are "y,x", and a placement that has not moved yet has no
        // explicit id - it is identified by the one the server derives from
        // where it stands, which is `${piece_id}_${y}_${x}`.
        const partnerKey = Object.keys(next).find((key) => {
          const pc = next[key];
          if (!pc) return false;
          if (pc.id) return pc.id === ply.castlingWith;
          const [ky, kx] = key.split(',');
          return `${pc.piece_id}_${ky}_${kx}` === ply.castlingWith;
        });
        if (partnerKey) {
          const partner = next[partnerKey];
          const px = ply.castlingDirection === 'left' ? ply.to.x + 1 : ply.to.x - 1;
          delete next[partnerKey];
          next[keyOf(px, ply.to.y)] = { ...partner, x: px, y: ply.to.y };
        }
      }
    }
    return next;
  }, [placements, solutionLine]);

  // Which side plays the next ply, and whose move number it is.
  const nextPlyIndex = solutionLine.length;
  const nextIsSolver = nextPlyIndex % 2 === 0;
  const nextSide = nextIsSolver
    ? Number(sideToMove)
    : (Number(sideToMove) === 1 ? 2 : 1);
  const nextMoveNumber = Math.floor(nextPlyIndex / 2) + 1;
  const lineFull = solutionLine.length >= MAX_PLIES;

  const refreshPuzzleList = useCallback(async () => {
    if (!gameId || !allowed) return;
    try {
      const { data } = await axios.get(
        `${API_URL}game-types/${gameId}/puzzles/editable`, { headers: authHeader() }
      );
      setMyPuzzles(data?.puzzles || []);
      setPuzzleListStaff(!!data?.staff);
    } catch (_) { /* the builder still works without the list */ }
  }, [gameId, allowed]);

  useEffect(() => { refreshPuzzleList(); }, [refreshPuzzleList]);

  const positionArray = useMemo(
    () => Object.entries(placements).map(([k, v]) => {
      const [y, x] = k.split(',').map(Number);
      return { ...v, x, y };
    }),
    [placements]
  );

  /*
   * Record a ply, asking the server first what the move actually is.
   *
   * Neither question can be answered here. Promotion options depend on the
   * game's per-placement overrides, on the pieces the game started with, and on
   * cross-player targets. Castling depends on whether the partner is present and
   * unmoved with a clear, unattacked path - which is a thing the move engine
   * knows and a pair of board clicks does not. A king sliding two squares is not
   * automatically a castle, and the engine is the only honest judge of that.
   *
   * A promoting ply is held back until the piece is chosen, rather than recorded
   * and patched afterwards: a ply with no choice on it would be validated
   * against a board where the promotion never happened.
   */
  const recordPly = useCallback(async (ply) => {
    setCheckResult(null);
    let move = ply;
    try {
      const { data } = await axios.post(
        `${API_URL}game-types/${gameId}/puzzle-move-info`,
        { position: positionArray, side_to_move: sideToMove, setup_move: setupMove, move: ply },
        { headers: authHeader() }
      );
      if (data?.castling) {
        move = {
          ...move,
          isCastling: true,
          castlingWith: data.castling.castlingWith,
          castlingDirection: data.castling.castlingDirection,
          castlingPartnerName: data.castling.partnerName || null,
        };
      }
      if (data?.promotes && Array.isArray(data.options) && data.options.length) {
        setPendingPromotion({ ply: move, options: data.options });
        return;
      }
    } catch (_) {
      /*
       * The lookup is an improvement, not a gate. If it fails the ply is still
       * recorded; validation will catch a missing promotion choice and say so.
       */
    }
    setSolutionLine((prev) => [...prev, move]);
  }, [gameId, positionArray, sideToMove, setupMove]);

  /*
   * The requirements come from the server rather than being written out here,
   * because they are generated from the same module the scheduler uses. A list
   * that has drifted from the rule being applied is worse than no list.
   */
  const loadDailyRequirements = useCallback(async () => {
    if (dailyInfo) return;
    try {
      const { data } = await axios.get(`${API_URL}puzzles/daily/requirements`);
      setDailyInfo(data);
    } catch (_) {
      setDailyInfo({ error: true });
    }
  }, [dailyInfo]);

  const choosePromotion = useCallback((option) => {
    setPendingPromotion((pending) => {
      if (!pending) return null;
      setSolutionLine((prev) => [...prev, {
        ...pending.ply,
        promotionPieceId: option.id,
        // Cross-player and neutral promotion: the piece may not stay yours.
        ...(option.player != null ? { promotionPlayer: option.player } : {}),
      }]);
      return null;
    });
  }, []);

  const handleSquareClick = useCallback((x, y) => {
    const k = keyOf(x, y);
    // Arranging edits the starting position; recording plays forward from it.
    const here = (mode === 'solution' ? solutionBoard : placements)[k];

    /*
     * Setup mode records the move that LED INTO the position - the opponent's
     * last move. It is what gives the puzzle its en passant rights: a pawn can
     * only be taken en passant on the move right after its double step, so
     * without knowing what just happened the engine has to answer "no piece can
     * capture en passant here", every time.
     *
     * The piece is already standing on its destination, so the two clicks are
     * the piece first and the square it came from second - which is how anyone
     * would point at it, and avoids asking for a move whose start square is
     * occupied by the piece that is about to leave it.
     */
    if (mode === 'setup') {
      if (!selected) {
        if (!here) {
          setCheckResult({ tone: 'warn', text: 'Click the piece your opponent just moved.' });
          return;
        }
        if (Number(here.player_id) === Number(sideToMove)) {
          setCheckResult({
            tone: 'warn',
            text: `That is your own piece. Click the piece Player ${sideToMove === 1 ? 2 : 1} just moved.`,
          });
          return;
        }
        setSelected(k);
        return;
      }
      if (selected === k) { setSelected(null); return; }
      if (placements[k]) {
        setCheckResult({ tone: 'warn', text: 'A piece cannot have come from an occupied square.' });
        return;
      }
      const [ty, tx] = selected.split(',').map(Number);
      setSetupMove({ from: { x, y }, to: { x: tx, y: ty } });
      setSelected(null);
      setCheckResult({ tone: 'ok', text: 'Last move recorded. En passant will be judged from it.' });
      return;
    }

    if (mode === 'arrange') {
      if (selected === k) {
        // Second click on the held piece removes it - the board is the palette.
        setPlacements((prev) => { const next = { ...prev }; delete next[k]; return next; });
        setSelected(null);
        return;
      }
      if (selected) {
        setPlacements((prev) => {
          const next = { ...prev };
          const moving = next[selected];
          delete next[selected];
          if (moving) next[k] = moving;
          return next;
        });
        setSelected(null);
        return;
      }
      if (here) setSelected(k);
      return;
    }

    // Solution mode: pick the piece, then where it goes. Sides alternate, so
    // the same two clicks record your move and then their reply.
    if (lineFull) {
      setCheckResult({ tone: 'warn', text: `A solution can be at most ${MAX_MOVES_PER_SIDE} moves per side.` });
      return;
    }
    if (!selected) {
      if (!here) return;
      if (Number(here.player_id) !== nextSide) {
        setCheckResult({
          tone: 'warn',
          text: `That piece belongs to Player ${here.player_id}, but it is Player ${nextSide}'s turn in the line.`,
        });
        return;
      }
      setSelected(k);
      return;
    }
    if (selected === k) { setSelected(null); return; }
    const [fy, fx] = selected.split(',').map(Number);
    const mover = solutionBoard[selected];
    recordPly({
      from: { x: fx, y: fy },
      to: { x, y },
      pieceId: mover?.id || `${mover?.piece_id}_${fy}_${fx}`,
    });
    setSelected(null);
    setCheckResult(null);
  }, [mode, selected, placements, solutionBoard, nextSide, lineFull, sideToMove, recordPly]);

  const body = () => ({
    title: title.trim() || null,
    description: description.trim() || null,
    position: positionArray,
    side_to_move: sideToMove,
    goal,
    goal_description: goalDescription.trim() || null,
    setup_move: setupMove,
    hide_rating: hideRating,
    allow_daily: allowDaily,
    solution_line: solutionLine,
  });

  const save = async ({ publish = false } = {}) => {
    if (!solutionLine.length) {
      setCheckResult({ tone: 'warn', text: 'Record the solution first: switch to "Set the solution" and play the move.' });
      return null;
    }
    setBusy(true);
    setCheckResult(null);
    try {
      let id = savedId;
      if (id) {
        await axios.put(`${API_URL}puzzles/${id}`, body(), { headers: authHeader() });
      } else {
        const { data } = await axios.post(`${API_URL}game-types/${gameId}/puzzles`, body(), { headers: authHeader() });
        id = data.puzzle.id;
        setSavedId(id);
      }
      if (publish) {
        await axios.post(`${API_URL}puzzles/${id}/publish`, { publish: true }, { headers: authHeader() });
      }
      refreshPuzzleList();
      setCheckResult({ tone: 'ok', text: publish ? 'Published.' : 'Saved as a draft.' });
      return id;
    } catch (err) {
      setCheckResult({ tone: 'error', text: err?.response?.data?.message || 'Could not save this puzzle' });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    const id = await save();
    if (!id) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API_URL}puzzles/${id}/validate`, {}, { headers: authHeader() });
      if (data.status === 'valid') {
        setCheckResult({ tone: 'ok', text: 'Checked: exactly one move mates, and it is yours.' });
      } else if (data.status === 'ambiguous') {
        setCheckResult({
          tone: 'warn',
          text: `${data.solutionCount} different moves mate here. That is allowed — solvers may just find a different one. ${data.detail || ''}`,
        });
      } else if (data.status === 'unsolvable') {
        setCheckResult({ tone: 'error', text: data.detail || 'Your recorded move does not achieve the goal.' });
      } else {
        setCheckResult({ tone: 'info', text: data.detail || 'Only mate in 1 can be checked automatically. Solvers will let you know how this one plays.' });
      }
    } catch (err) {
      setCheckResult({ tone: 'error', text: err?.response?.data?.message || 'Could not check this puzzle' });
    } finally {
      setBusy(false);
    }
  };

  if (!allowed) {
    return (
      <div className={styles["builder-page"]}>
        <div className={styles["locked"]}>
          <h1>Puzzle Builder</h1>
          <p>Sign in to build puzzles. Solving them is free for everyone, account or not.</p>
          <button className={styles["btn"]} onClick={() => navigate('/login')}>Sign in</button>
        </div>
      </div>
    );
  }

  /*
   * Out of allowance, and not already editing something. Editing an existing
   * puzzle is never blocked by a creation limit - the row already exists, and
   * locking someone out of their own draft would be a strange way to sell a
   * subscription.
   */
  if (allowance && !allowance.allowed && !savedId) {
    return (
      <div className={styles["builder-page"]}>
        <div className={styles["locked"]}>
          <h1>Puzzle Builder</h1>
          <p>{allowance.reason}</p>
          {allowance.requiresSupporter && (
            <button className={styles["btn"]} onClick={() => navigate('/donate')}>Support the site</button>
          )}
          <button className={styles["btn-secondary"]} onClick={() => navigate(`/games/${gameId}`)}>
            Back to the game
          </button>
        </div>
      </div>
    );
  }
  if (loading) return <div className={styles["builder-page"]}><p>Loading…</p></div>;
  if (error) return <div className={styles["builder-page"]}><p>{error}</p></div>;

  const boardCells = mode === 'solution' ? solutionBoard : placements;
  const lastPly = mode === 'solution' ? solutionLine[solutionLine.length - 1] : null;

  const squares = [];
  for (let y = 0; y < boardHeight; y++) {
    for (let x = 0; x < boardWidth; x++) {
      const k = keyOf(x, y);
      const p = boardCells[k];
      const isLight = (x + y) % 2 === 0;
      const isSelected = selected === k;
      // Highlight the move just recorded, so the line reads as you build it.
      // In setup mode that is the opponent's last move instead.
      const shown = mode === 'setup' ? setupMove : lastPly;
      const isFrom = !!shown && shown.from.x === x && shown.from.y === y;
      const isTo = !!shown && shown.to.x === x && shown.to.y === y;
      squares.push(
        <div
          key={k}
          className={[
            styles["square"],
            isSelected ? styles["selected"] : '',
            isFrom ? styles["sol-from"] : '',
            isTo ? styles["sol-to"] : '',
          ].filter(Boolean).join(' ')}
          style={{
            background: isLight ? lightColor : darkColor,
            width: vp.squareSize,
            height: vp.squareSize,
          }}
          onClick={() => handleSquareClick(x, y)}
          title={p ? `${p.piece_name} (Player ${p.player_id})` : ''}
        >
          {(() => {
            const src = imageFor(p, pieceDataMap);
            return src ? <img src={src} alt={p.piece_name} draggable={false} /> : (
              p ? <span className={styles["piece-fallback"]}>{(p.piece_name || '?').charAt(0)}</span> : null
            );
          })()}
        </div>
      );
    }
  }

  return (
    <div className={`${styles["builder-page"]}${isSkinnyBoard ? ` ${styles["skinny"]}` : ''}`}>
      <h1>{savedId ? 'Edit Puzzle' : 'New Puzzle'}{game ? ` — ${game.game_name}` : ''}</h1>

      {/* Page-level controls, deliberately not inside the board column: they need
          a readable width, and keeping them there forced a floor on that column
          that stranded empty space beside skinny boards. */}
      <div className={styles["toolbar"]}>
        <div className={styles["mode-tabs"]}>
          <button
            className={mode === 'arrange' ? styles["tab-active"] : styles["tab"]}
            onClick={() => { setMode('arrange'); setSelected(null); }}
          >
            1. Arrange the position
          </button>
          <button
            className={mode === 'setup' ? styles["tab-active"] : styles["tab"]}
            onClick={() => { setMode('setup'); setSelected(null); }}
          >
            2. Their last move
            {setupMove && <span className={styles["tab-tick"]}> ✓</span>}
          </button>
          <button
            className={mode === 'solution' ? styles["tab-active"] : styles["tab"]}
            onClick={() => { setMode('solution'); setSelected(null); }}
          >
            3. Set the solution
          </button>
        </div>
        <div className={styles["board-actions"]}>
          <button className={styles["btn-secondary"]} onClick={() => { setPlacements(startingPlacements); setSolutionLine([]); setSelected(null); }}>
            Reset to starting position
          </button>
          <button className={styles["btn-secondary"]} onClick={() => { setPlacements({}); setSolutionLine([]); setSelected(null); }}>
            Clear the board
          </button>
        </div>
      </div>
      <p className={styles["mode-hint"]}>
        {mode === 'arrange'
          ? 'Click a piece then an empty square to move it. Click a piece twice to take it off the board.'
          : mode === 'setup'
          ? (setupMove
            ? `Their last move: (${setupMove.from.x}, ${setupMove.from.y}) → (${setupMove.to.x}, ${setupMove.to.y}). Record a different one, or clear it.`
            : `Click the piece Player ${sideToMove === 1 ? 2 : 1} just moved, then the square it came from. This is optional — but without it no piece can capture en passant, because nothing has just double-stepped.`)
          : (lineFull
            ? `That is ${MAX_MOVES_PER_SIDE} moves each — as long as a solution can be.`
            : (nextIsSolver
              ? `Play your move ${nextMoveNumber}: click the Player ${nextSide} piece, then where it goes.`
              : `Now play the reply you expect from Player ${nextSide} — the board carries on from there. Leave it here if your move ${Math.ceil(nextPlyIndex / 2)} is the whole answer.`))}
      </p>

      <div className={styles["layout"]}>
        {/* A DEFINITE width, not max-width. useBoardViewport measures this column
            to size the board, so an `auto` grid track sized by its content is a
            loop: the board shrinks, the column shrinks with it, and it settles
            at the 6px minimum square. */}
        <div className={styles["board-side"]} style={{ width: boardColumnMax, maxWidth: '100%' }}>
          {/* width is what the board WANTS; max-width is what the page allows.
              Both are page- or window-derived, never content-derived, so the
              hook's measurement stays stable either way. */}
          <div style={{ ...vp.frameStyle, justifyContent: 'flex-start' }}>
            <div
              className={`${boardVp.viewport} ${vp.hideScrollbars ? boardVp.noScrollbars : ''}`}
              ref={vp.viewportRef}
              style={vp.viewportStyle}
            >
              <div style={vp.contentStyle}>
                <div
                  className={styles["board"]}
                  style={{ gridTemplateColumns: `repeat(${boardWidth}, ${vp.squareSize}px)` }}
                >
                  {squares}
                </div>
              </div>
            </div>
            <BoardZoomControls {...vp.controlProps} />
          </div>

        </div>

        <div className={styles["form-side"]}>
          <label className={styles["field"]}>
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Back rank trap" />
          </label>

          <label className={styles["field"]}>
            <span>Description <em>(optional)</em></span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} />
          </label>

          <label className={styles["field"]}>
            <span>Who moves?</span>
            <select value={sideToMove} onChange={(e) => { setSideToMove(Number(e.target.value)); setSolutionLine([]); setSelected(null); }}>
              <option value={1}>Player 1</option>
              <option value={2}>Player 2</option>
            </select>
          </label>

          <label className={styles["field"]}>
            <span>
              Goal
              <InfoTooltip text={goalOptions.find((g) => g.value === goal)?.help || ''} />
            </span>
            <select value={goal} onChange={(e) => setGoal(e.target.value)}>
              {goalOptions.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}{g.mechanical ? '' : ' (you judge it)'}
                </option>
              ))}
            </select>
          </label>
          {/* The sentence the solver will read. A mechanical goal writes its
              own, so the creator can see there is nothing left to explain. */}
          {!!goalOptions.find((g) => g.value === goal)?.help && (
            <p className={styles["goal-preview"]}>
              Solvers will be told: <em>{goalOptions.find((g) => g.value === goal).help}</em>
            </p>
          )}

          {!goalOptions.find((g) => g.value === goal)?.mechanical && (
            <label className={styles["field"]}>
              <span>What should the solver do?</span>
              <input
                value={goalDescription}
                onChange={(e) => setGoalDescription(e.target.value)}
                maxLength={255}
                placeholder="Win the rook"
              />
            </label>
          )}

          <label className={styles["checkbox-field"]}>
            <input type="checkbox" checked={hideRating} onChange={(e) => setHideRating(e.target.checked)} />
            <span>
              Hide this puzzle's rating
              <InfoTooltip text="A puzzle's rating is the average rating of the people who have solved it. It is hidden from everyone until at least 10 people have solved it; tick this to keep it hidden after that too." />
            </span>
          </label>

          {/*
            * The daily rotation. Opted in by default, with the way out sitting
            * right next to the invitation rather than buried somewhere else -
            * an opt-out that is hard to find is not really an opt-out.
            */}
          <label className={styles["checkbox-field"]}>
            <input
              type="checkbox"
              checked={allowDaily}
              onChange={(e) => setAllowDaily(e.target.checked)}
            />
            <span>Let this puzzle be picked as a Puzzle of the Day</span>
          </label>
          {allowDaily && (
            <p className={styles["daily-cta"]}>
              Want this featured as the Puzzle of the Day?{' '}
              <button
                type="button"
                className={styles["link-btn"]}
                onClick={() => { setDailyModalOpen(true); loadDailyRequirements(); }}
              >
                See what it takes
              </button>
            </p>
          )}

          {/* What led into the position. Shown outside setup mode too, because
              it silently decides whether en passant is on the table. */}
          {!!allowance && allowance.perGameLimit != null && (
            <p className={styles["allowance-note"]}>
              {Math.max(0, allowance.perGameLimit - allowance.perGameUsed)} of your{' '}
              {allowance.perGameLimit} free puzzles left for this game.{' '}
              <button className={styles["link-btn"]} onClick={() => navigate('/donate')}>
                Supporters build as many as they like
              </button>
            </p>
          )}

          <div className={styles["setup-readout"]}>
            <strong>Their last move:</strong>{' '}
            {setupMove ? (
              <>
                ({setupMove.from.x}, {setupMove.from.y}) → ({setupMove.to.x}, {setupMove.to.y})
                <button className={styles["link-btn"]} onClick={() => setSetupMove(null)}>clear</button>
              </>
            ) : (
              <em>not set — en passant will not be possible</em>
            )}
          </div>

          <div className={styles["solution-readout"]}>
            <strong>Solution:</strong>{' '}
            {!solutionLine.length && <em>not set yet</em>}
            {!!solutionLine.length && (
              <>
                <ol className={styles["ply-list"]}>
                  {solutionLine.map((ply, i) => (
                    <li
                      key={i}
                      className={i % 2 === 0 ? styles["ply-yours"] : styles["ply-theirs"]}
                    >
                      <span className={styles["ply-label"]}>
                        {i % 2 === 0
                          ? `Your move ${Math.floor(i / 2) + 1}`
                          : `Their reply ${Math.floor(i / 2) + 1}`}
                      </span>
                      ({ply.from.x}, {ply.from.y}) → ({ply.to.x}, {ply.to.y})
                      {!!ply.isCastling && (
                        <span className={styles["ply-castle"]}>
                          {' '}castles {ply.castlingDirection}
                          {ply.castlingPartnerName ? ` with the ${ply.castlingPartnerName}` : ''}
                        </span>
                      )}
                      {!!ply.promotionPieceId && (
                        <span className={styles["ply-promo"]}>
                          {' '}= {pieceDataMap[ply.promotionPieceId]?.piece_name || `piece #${ply.promotionPieceId}`}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
                <button
                  className={styles["link-btn"]}
                  onClick={() => { setSolutionLine((prev) => prev.slice(0, -1)); setSelected(null); }}
                >
                  undo last move
                </button>
                <button
                  className={styles["link-btn"]}
                  onClick={() => { setSolutionLine([]); setSelected(null); }}
                >
                  clear
                </button>
              </>
            )}
          </div>

          {checkResult && (
            <div className={`${styles["notice"]} ${styles[`notice-${checkResult.tone}`]}`}>
              {checkResult.text}
            </div>
          )}

          <div className={styles["form-actions"]}>
            <button className={styles["btn-secondary"]} onClick={check} disabled={busy}>
              {busy ? 'Working…' : 'Check puzzle'}
            </button>
            <button className={styles["btn-secondary"]} onClick={() => save()} disabled={busy}>
              Save draft
            </button>
            <button className={styles["btn"]} onClick={() => save({ publish: true })} disabled={busy}>
              Publish
            </button>
          </div>
          <p className={styles["fine-print"]}>
            Checking is advice, not a gate — you can publish either way. Only “checkmate in 1”
            can be checked automatically; everything else is judged by the people solving it.
            On a longer line the check confirms every move can actually be played, but the
            replies are the ones you wrote, so whether the opponent could defend better is
            your call.
          </p>

          {/* The same rules panel the solver gets, so the creator can see what
              a stranger to this game will be told about it. */}
          {!!gameRules?.groups?.length && (
            <details className={styles["rules-panel"]}>
              <summary>What solvers will see about this game’s rules</summary>
              {gameRules.groups.map((g) => (
                <div key={g.title} className={styles["rules-group"]}>
                  <h4>{g.title}</h4>
                  <ul>
                    {g.items.map((it) => (
                      <li key={it.label}><strong>{it.label}.</strong> {it.detail}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </details>
          )}

          <button className={styles["link-btn"]} onClick={() => navigate(`/games/${gameId}`)}>
            ← Back to {game?.game_name || 'the game'}
          </button>
        </div>
      </div>

      {/* What it takes to be the Puzzle of the Day. */}
      {dailyModalOpen && (
        <div
          className={styles["promo-backdrop"]}
          role="dialog"
          aria-modal="true"
          aria-label="Puzzle of the Day requirements"
          onClick={(e) => { if (e.target === e.currentTarget) setDailyModalOpen(false); }}
        >
          <div className={`${styles["promo-dialog"]} ${styles["daily-dialog"]}`}>
            <h3>Puzzle of the Day</h3>
            <p>
              One puzzle is featured on the home page each day. Any published puzzle can
              be picked — there is nothing to enter and nothing to apply for. This is what
              makes a puzzle a candidate:
            </p>

            {!dailyInfo && <p className={styles["daily-loading"]}>Loading the requirements…</p>}
            {dailyInfo?.error && (
              <p className={styles["daily-loading"]}>
                Could not load the requirements just now. They are also on the puzzle page.
              </p>
            )}

            {!!dailyInfo?.requirements && (
              <ul className={styles["daily-reqs"]}>
                {dailyInfo.requirements.map((r) => (
                  <li key={r.key}>
                    <strong>{r.label}</strong>
                    <span>{r.detail}</span>
                  </li>
                ))}
              </ul>
            )}

            {!!dailyInfo?.discretion && (
              <p className={styles["daily-discretion"]}>{dailyInfo.discretion}</p>
            )}

            <p className={styles["daily-optout"]}>
              You can opt any puzzle out at any time with the checkbox above — it stays
              solvable either way, it just will not be featured.
            </p>

            <button className={styles["btn"]} onClick={() => setDailyModalOpen(false)}>
              Got it
            </button>
          </div>
        </div>
      )}

      {/*
        * Promotion. The move is not in the line yet - it goes in only once the
        * creator says what the piece becomes, so a half-recorded promotion can
        * never be saved. Cancelling drops the move rather than recording it
        * without a choice.
        */}
      {!!pendingPromotion && (
        <div
          className={styles["promo-backdrop"]}
          role="dialog"
          aria-modal="true"
          aria-label="Choose what this piece promotes to"
        >
          <div className={styles["promo-dialog"]}>
            <h3>What does it become?</h3>
            <p>
              That move reaches a promotion square. Pick the piece — the solver will
              have to pick the same one.
            </p>
            <div className={styles["promo-options"]}>
              {pendingPromotion.options.map((o) => {
                const src = imageFor(
                  { piece_id: o.id, image_location: o.image_location, player_id: o.player ?? nextSide },
                  pieceDataMap
                );
                return (
                  <button
                    key={`${o.id}:${o.player ?? 'own'}`}
                    className={styles["promo-option"]}
                    onClick={() => choosePromotion(o)}
                  >
                    {src
                      ? <img src={src} alt="" draggable={false} />
                      : <span className={styles["piece-fallback"]}>{(o.piece_name || '?').charAt(0)}</span>}
                    <span>{o.piece_name}</span>
                    {o.player === 0 && <em>neutral</em>}
                    {o.player != null && o.player !== 0 && <em>Player {o.player}</em>}
                  </button>
                );
              })}
            </div>
            <button className={styles["btn-secondary"]} onClick={() => setPendingPromotion(null)}>
              Cancel this move
            </button>
          </div>
        </div>
      )}

      {myPuzzles.length > 0 && (
        <div className={styles["puzzle-list"]}>
          <h2>
            {puzzleListStaff ? 'All puzzles for this game' : 'Your puzzles for this game'}
            <span className={styles["puzzle-list-count"]}>{myPuzzles.length}</span>
          </h2>
          <p className={styles["puzzle-list-hint"]}>
            Click one to open it here and edit it. Drafts are listed first and are not
            visible to anyone else.
          </p>
          <div className={styles["puzzle-list-rows"]}>
            {pagedPuzzles.pageItems.map((pz) => (
              <button
                type="button"
                key={pz.id}
                className={`${styles["puzzle-row"]}${Number(pz.id) === Number(savedId) ? ` ${styles["puzzle-row-current"]}` : ''}`}
                onClick={() => navigate(`/games/${gameId}/puzzles/${pz.id}/edit`)}
              >
                <span className={styles["puzzle-row-title"]}>
                  {!!pz.is_draft && <span className={styles["draft-tag"]}>DRAFT</span>}
                  {pz.title || 'Untitled puzzle'}
                </span>
                <span className={styles["puzzle-row-meta"]}>
                  {pz.goal === 'checkmate_in_1'
                    ? 'Checkmate in 1'
                    : (pz.goal_description || (pz.goal === 'win_material' ? 'Win material' : 'Find the move'))}
                  {pz.solution_depth > 1 && <> · {pz.solution_depth} moves</>}
                  {puzzleListStaff && pz.creator_username && <> · by {pz.creator_username}</>}
                  {pz.attempt_count > 0 && <> · {pz.solve_count}/{pz.attempt_count} solved</>}
                </span>
              </button>
            ))}
          </div>
          <ListPager {...pagedPuzzles} label="puzzles" />
        </div>
      )}
    </div>
  );
};

export default PuzzleBuilder;
