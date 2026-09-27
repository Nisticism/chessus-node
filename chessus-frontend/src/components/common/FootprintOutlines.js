import React from "react";

/*
 * Outlines snapped onto board squares - the one preview every board shares.
 *
 * - preview: where a piece would go. Drawn around the very squares it would
 *   cover, not as a floating picture, so it reads as "these squares" at a
 *   glance. Used for every such preview: dragging or pointing with a
 *   multi-tile piece (a drag lands the grabbed square on the drop square when
 *   it can, and otherwise another of its squares - the outline shows which),
 *   where a piece will come to rest on a board that drops pieces, and where a
 *   piece being set out in the puzzle builder will sit.
 * - veto: a vetoed multi-tile move. A veto bans one landing of the piece,
 *   and the X on its anchor square alone does not say which one.
 *
 * Boxes are in game coordinates ({ x, y, w, h, kind }). A flipped board draws
 * the footprint from the opposite corner. Render inside the board's grid
 * element, positioned relative, so percentages land on the squares.
 */

const KIND_STYLES = {
  preview: {
    border: '2px dashed rgba(255, 255, 255, 0.75)',
    background: 'rgba(255, 255, 255, 0.14)',
  },
  veto: {
    border: '2px dashed rgba(255, 80, 80, 0.85)',
    background: 'rgba(255, 60, 60, 0.10)',
  },
};

const FootprintOutlines = ({ boxes, boardWidth, boardHeight, flipped }) => {
  if (!boxes || boxes.length === 0) return null;
  return (
    <>
      {boxes.map((b) => {
        const col = flipped ? boardWidth - b.x - b.w : b.x;
        const row = flipped ? boardHeight - b.y - b.h : b.y;
        return (
          <div
            key={`${b.kind}:${b.x},${b.y},${b.w},${b.h}`}
            data-footprint-outline={b.kind}
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
              ...(KIND_STYLES[b.kind] || KIND_STYLES.preview),
            }}
          />
        );
      })}
    </>
  );
};

export default FootprintOutlines;
