import React from "react";

/*
 * Outlines over the board for multi-tile pieces.
 *
 * - landing: where a dragged (or selected, under the pointer) piece would
 *   go. A drag puts the grabbed square on the drop square when it can, and
 *   otherwise moves the piece so another of its squares lands there - the
 *   faint outline shows which, before the piece is let go.
 * - veto: a vetoed multi-tile move. A veto bans one landing of the piece,
 *   and the X on its anchor square alone does not say which one.
 *
 * Boxes are in game coordinates ({ x, y, w, h, kind }); a flipped board draws
 * the footprint from the opposite corner. Rendered inside the board element,
 * which is position: relative, so percentages place them on the squares.
 */

const KIND_STYLES = {
  landing: {
    border: '2px dashed rgba(255, 255, 255, 0.7)',
    background: 'rgba(255, 255, 255, 0.12)',
  },
  veto: {
    border: '2px dashed rgba(255, 80, 80, 0.85)',
    background: 'rgba(255, 60, 60, 0.10)',
  },
};

const MultiTileOutlines = ({ boxes, boardWidth, boardHeight, flipped }) => {
  if (!boxes || boxes.length === 0) return null;
  return (
    <>
      {boxes.map((b) => {
        const col = flipped ? boardWidth - b.x - b.w : b.x;
        const row = flipped ? boardHeight - b.y - b.h : b.y;
        return (
          <div
            key={`${b.kind}:${b.x},${b.y},${b.w},${b.h}`}
            data-multitile-outline={b.kind}
            style={{
              position: 'absolute',
              left: `${(col * 100) / boardWidth}%`,
              top: `${(row * 100) / boardHeight}%`,
              width: `${(b.w * 100) / boardWidth}%`,
              height: `${(b.h * 100) / boardHeight}%`,
              boxSizing: 'border-box',
              borderRadius: 4,
              pointerEvents: 'none',
              zIndex: 20,
              ...KIND_STYLES[b.kind],
            }}
          />
        );
      })}
    </>
  );
};

export default MultiTileOutlines;
