# Supporting Tak

Notes for later. Nothing here is built; this is the scoping pass so the work can
be picked up without re-deriving it.

Written 2026-09-15, against the engine as it stands after the line/connection win
condition landed.

## What Tak is, in the terms this engine uses

A two-player abstract on a square board (3×3 up to 8×8, 5×5 being the common
size). The board starts empty. Each player has a fixed supply — on 5×5, 21 flat
stones and 1 capstone — and the game ends when somebody makes a **road** or when
the supply or the board runs out.

On your turn you do exactly one of two things:

1. **Place** one piece from your supply onto an empty square, in one of three
   states: flat, standing (a "wall"), or the capstone.
2. **Move** a stack you control: pick up to *N* pieces off the top (where *N* is
   the board size), then travel in one straight line, dropping at least one
   piece on each square you pass over.

The pieces that matter for winning are **flats and capstones**. A wall does not
count toward a road — that is what walls are for. A capstone moving **alone**
onto a wall flattens it back to a flat.

Winning:

- **Road win.** A connected chain of your road-eligible pieces joining two
  opposite sides. Orthogonal adjacency only; diagonals do not connect.
- **Flat win.** If the board fills, or either player places their last piece,
  the game ends and whoever has more flats *on top of stacks* wins.

One more wrinkle: on the **first turn each**, you place one of your
**opponent's** flat stones, not your own.

## What the engine already has

| Tak needs | Engine status |
| --- | --- |
| Empty starting board | Yes — `pieces_string` of `{}` |
| Pieces that never move | Yes — a piece with every movement column at 0 |
| Placing pieces as a turn | Yes — `place_pieces_action` + `placeable_pieces` |
| A finite supply per player | Yes — `finite_reserve` + per-piece `reserve_counts` |
| Road / edge-to-edge win | Yes — `line_condition` with `line_win_type = 'edge_to_edge'`, `line_directions = 'orthogonal'` |
| Board sizes 3–8 | Yes |

So the win condition and the supply are no longer the problem. What is left is
the board model.

## What is missing, easiest first

### 1. Road eligibility per piece — small

`server/win-line.js` counts **every piece you own** toward a chain. Tak needs
walls excluded, and any game with a "this piece blocks but does not count" idea
wants the same thing.

A per-piece (or per-placement) flag — `counts_toward_line` — read by
`ownedSquares()` in `win-line.js`. An afternoon, and it makes the connection
condition properly correct for Tak-like games even with none of the rest of this
done.

### 2. Flat win / the board-full tie-break — small to medium

There is now a board-full end for placement games (a draw by default, or a loss
under `no_moves_condition`). Tak wants a third answer: **count pieces and the
higher count wins**, but only counting

- the **top** piece of each stack, and
- only pieces that are road-eligible (flats, not walls).

`piece_count_condition` is close but counts every piece on the board. Once
stacking exists, "top of stack" is the only part that needs adding; without
stacking this one is nearly free.

### 3. Piece orientation — medium

Flat / wall / capstone are **states of a piece**, not three unrelated piece
types, and the state changes during play:

- the player chooses flat or wall **at placement time**;
- a capstone moving alone onto a wall **flattens it** — one piece changing
  another piece's state.

The engine has promotion, which changes a piece's *type*, but nothing lets the
placing player pick a state, and nothing lets a move mutate a different piece's
state. Modelling flat and wall as two placeable piece types gets most of the way
there and leaves flattening unsolved.

### 4. Stacking — the blocker

The engine is **strictly one piece per square**:

```js
// server/game-socket.js, the placement handler
const existingPiece = gameState.pieces.find(p => p.x === placeX && p.y === placeY);
if (existingPiece) {
  return socket.emit("error", { message: "Square is already occupied" });
}
```

Tak is a stacking game at its centre — the stack, who controls it (the owner of
the top piece), and what is buried under it are the whole game. This is not a
setting. It is a change to the shape of `gameState.pieces` and to everything
that assumes a square holds at most one thing: move generation, capture,
rendering, fog, the AI, the puzzle hydrator, `win-line.js`, and the several
places that index the board by `"y,x"`.

Before starting: **audit every `find(p => p.x === ... && p.y === ...)`**. There
are many, and each one is a place that silently means "the piece here".

### 5. Carry-and-drop movement — the other blocker

Moving in Tak is not "a piece goes from A to B". It is:

> take up to *N* pieces off the top of a stack you control, travel in one
> straight line, and drop **at least one** piece on each square you cross.

That is a different move primitive from anything the engine has. It needs its
own message shape (origin, direction, and the drop counts per square), its own
validation, and its own representation in the move history and in any replay.
The carry limit is tied to board size, and a capstone may flatten a wall on the
**final** square of the travel only.

### 6. The opening rule — small, but odd

Each player's first placement puts down the **opponent's** flat. Nothing in the
engine can place a piece for another player; the closest is neutral pieces,
which belong to nobody rather than to the other side. Probably a per-game
`first_turn_places_opponent` flag handled in the placement path.

## A suggested order

1. **Road eligibility (1)** and **flat win (2)** — worth doing on their own
   merits. They improve the connection condition for everyone and are
   independent of the board model.
2. **Orientation (3)** as far as "flat and wall are two placeable types",
   accepting that flattening does not work yet.
3. Then decide whether **stacking (4 + 5)** is worth it. It is the real project.
   Everything above is days; that is weeks, and it touches the hottest code in
   the repo.

An honest warning on 4 and 5: this codebase has a history of paying for
duplicated engine logic — see the note at the top of `server/puzzle-hydrate.js`
about the seven copies of the piece object. A stacking model that is added in
one place and half-assumed in the others would be the most expensive version of
that mistake yet. If it gets built, it should be built as one representation
that every reader goes through, not as a special case bolted onto the current
one.

## Things to check that I did not

- Whether the **AI** (`ai-engine-rs` and the JS move generator it mirrors) can
  express a carry-and-drop move at all, or whether Tak would have to be
  human-only to start with.
- Whether **Fairy-Stockfish** is used for anything on a Tak-shaped game. It does
  not support Tak, so the answer is probably "the same as for every other custom
  game", but worth confirming rather than assuming.
- How **fog of war** and **hidden enemy pieces** would read against a stack.
