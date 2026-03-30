import React from 'react';

/**
 * Shared highlight overlay for board squares.
 * Renders the standard 3-layer overlay pattern used across all interactive boards:
 *   1. Movement/capture highlight (z-index 8)
 *   2. Hop-capture green overlay (z-index 9)
 *   3. Ranged attack icon (z-index 10)
 *
 * Place inside any position:relative board square div.
 *
 * Props:
 *   highlightStyle — style object from getSquareHighlightStyle()
 *   highlightIcon  — icon string from getSquareHighlightStyle() (e.g. '💥')
 *   canHopCapture  — boolean, render additive green overlay
 *   squareSize     — number (px), scales the ranged icon
 *   isLight        — boolean, toggles icon background for contrast
 */
const SquareHighlightOverlay = ({ highlightStyle, highlightIcon, canHopCapture, squareSize = 50, isLight = true }) => {
  const hasHighlight = highlightStyle && (highlightStyle.outline || highlightStyle.borderTop);

  return (
    <>
      {hasHighlight && (
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          background: highlightStyle.background,
          outline: highlightStyle.outline || 'none',
          outlineOffset: highlightStyle.outlineOffset || 0,
          borderTop: highlightStyle.borderTop || 'none',
          borderLeft: highlightStyle.borderLeft || 'none',
          borderBottom: highlightStyle.borderBottom || 'none',
          borderRight: highlightStyle.borderRight || 'none',
          boxSizing: 'border-box',
          zIndex: 8,
          pointerEvents: 'none',
          borderRadius: '2px',
        }} />
      )}
      {highlightIcon && (
        <span style={{
          position: 'absolute',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          fontSize: `${squareSize * 0.4}px`,
          pointerEvents: 'none',
          zIndex: 10,
          backgroundColor: isLight ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.3)',
          borderRadius: '4px',
          padding: '2px 4px',
          opacity: 0.7,
        }}>
          {highlightIcon}
        </span>
      )}
      {canHopCapture && (
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          outline: '3px solid rgba(76, 175, 80, 0.7)',
          outlineOffset: '-3px',
          boxShadow: 'inset 0 0 0 100px rgba(76, 175, 80, 0.2)',
          boxSizing: 'border-box',
          zIndex: 9,
          pointerEvents: 'none',
          borderRadius: '2px',
        }} />
      )}
    </>
  );
};

export default SquareHighlightOverlay;
