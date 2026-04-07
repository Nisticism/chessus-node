import React from 'react';
import styles from './boardlegend.module.scss';

/**
 * Unified board legend component used across all board views.
 * Renders color-coded swatches matching getSquareHighlightStyle() output.
 *
 * Props:
 *   showMove, showFirstMove, showAttack, showFirstAttack, showMoveAttack,
 *   showRanged, showHopCapture — toggle movement highlight items
 *   showCheckmate, showCaptureLoss — toggle game-condition items
 *   players — array of { id, color, border? } for player color dots
 *   specialSquares — { promotion, range, control, special, custom } booleans
 *   title — optional header text
 *   maxWidth — optional max-width (number px or string)
 *   labelStyle — "standard" | "short" | "descriptive"
 *   className — additional CSS class on the wrapper
 */

const LABELS = {
  standard: {
    move: 'Movement',
    firstMove: 'First Move',
    attack: 'Attack',
    firstAttack: 'First Attack',
    moveAttack: 'Move + Attack',
    ranged: 'Ranged 💥',
    hopCapture: 'Capture on Hop',
    customMove: 'Custom Move',
    customAttack: 'Custom Attack',
    checkmate: 'Checkmate Piece',
    captureLoss: 'Capture-Loss Piece',
    promotion: 'Promotion',
    range: 'Range Boost',
    control: 'Control',
    special: 'Special',
    custom: 'Custom',
  },
  short: {
    move: 'Move',
    firstMove: '1st Move',
    attack: 'Attack',
    firstAttack: '1st Attack',
    moveAttack: 'Move + Attack',
    ranged: 'Range',
    hopCapture: 'Hop Capture',
    customMove: 'Custom Mv',
    customAttack: 'Custom Atk',
    checkmate: 'Mate',
    captureLoss: 'Capture',
    promotion: 'Promo Sq',
    range: 'Range Sq',
    control: 'Control Sq',
    special: 'Special Sq',
    custom: 'Custom Sq',
  },
  descriptive: {
    move: 'Regular Movement',
    firstMove: 'First Moves Movement',
    attack: 'Capture on Move',
    firstAttack: 'First Moves Capture',
    moveAttack: 'Move + Attack',
    ranged: 'Ranged Attack 💥',
    hopCapture: 'Capture on Hop',
    customMove: 'Custom Movement',
    customAttack: 'Custom Attack',
    checkmate: 'Checkmate Piece',
    captureLoss: 'Capture-Loss Piece',
    promotion: 'Promotion',
    range: 'Range Boost',
    control: 'Control',
    special: 'Special',
    custom: 'Custom',
  },
};

const BoardLegend = ({
  showMove = true,
  showFirstMove = true,
  showAttack = true,
  showFirstAttack = true,
  showMoveAttack = false,
  showRanged = true,
  showHopCapture = true,
  showCustomMove = false,
  showCustomAttack = false,
  showCheckmate = false,
  showCaptureLoss = false,
  players = null,
  specialSquares = null,
  title = null,
  maxWidth = null,
  labelStyle = 'standard',
  className = null,
}) => {
  const labels = LABELS[labelStyle] || LABELS.standard;
  const items = [];

  // Movement highlight items
  if (showMove) items.push({ key: 'move', type: 'move', label: labels.move });
  if (showFirstMove) items.push({ key: 'firstMove', type: 'firstMove', label: labels.firstMove });
  if (showAttack) items.push({ key: 'attack', type: 'attack', label: labels.attack });
  if (showFirstAttack) items.push({ key: 'firstAttack', type: 'firstAttack', label: labels.firstAttack });
  if (showMoveAttack) items.push({ key: 'moveAttack', type: 'moveAttack', label: labels.moveAttack });
  if (showRanged) items.push({ key: 'ranged', type: 'ranged', label: labels.ranged });
  if (showHopCapture) items.push({ key: 'hopCapture', type: 'hopCapture', label: labels.hopCapture });
  if (showCustomMove) items.push({ key: 'customMove', type: 'customMove', label: labels.customMove });
  if (showCustomAttack) items.push({ key: 'customAttack', type: 'customAttack', label: labels.customAttack });

  // Game condition items
  if (showCheckmate) items.push({ key: 'checkmate', type: 'checkmate', label: labels.checkmate });
  if (showCaptureLoss) items.push({ key: 'captureLoss', type: 'captureLoss', label: labels.captureLoss });

  // Player color dots
  if (players && players.length > 0) {
    players.forEach(p => {
      items.push({ key: `player-${p.id}`, type: 'player', color: p.color, border: p.border, label: `P${p.id}` });
    });
  }

  // Special square items
  if (specialSquares) {
    if (specialSquares.promotion) items.push({ key: 'promotion', type: 'specialSq', color: '#4b0082', bg: 'rgba(75, 0, 130, 0.3)', label: labels.promotion });
    if (specialSquares.range) items.push({ key: 'range', type: 'specialSq', color: '#ff8c00', bg: 'rgba(255, 140, 0, 0.3)', label: labels.range });
    if (specialSquares.control) items.push({ key: 'control', type: 'specialSq', color: '#32CD32', bg: 'rgba(50, 205, 50, 0.3)', label: labels.control });
    if (specialSquares.special) items.push({ key: 'special', type: 'specialSq', color: '#ffd700', bg: 'rgba(255, 215, 0, 0.3)', label: labels.special });
    if (specialSquares.custom) items.push({ key: 'custom', type: 'specialSq', color: '#ffd700', bg: 'rgba(255, 215, 0, 0.3)', label: labels.custom });
  }

  if (items.length === 0) return null;

  // Split into balanced rows
  const total = items.length;
  const numRows = total > 14 ? 3 : total > 4 ? 2 : 1;
  const perRow = Math.ceil(total / numRows);
  const rows = [];
  for (let i = 0; i < total; i += perRow) {
    rows.push(items.slice(i, i + perRow));
  }

  const renderSwatch = (item) => {
    switch (item.type) {
      case 'move':
        return <div className={`${styles.swatch} ${styles.move}`} />;
      case 'firstMove':
        return <div className={`${styles.swatch} ${styles.firstMove}`} />;
      case 'attack':
        return <div className={`${styles.swatch} ${styles.attack}`} />;
      case 'firstAttack':
        return <div className={`${styles.swatch} ${styles.firstAttack}`} />;
      case 'moveAttack':
        return <div className={`${styles.swatch} ${styles.moveAttack}`} />;
      case 'ranged':
        return <div className={`${styles.swatch} ${styles.ranged}`} />;
      case 'hopCapture':
        return <div className={`${styles.swatch} ${styles.hopCapture}`} />;
      case 'customMove':
        return <div className={styles.swatch} style={{ outline: '3px solid rgba(0, 188, 150, 0.55)', outlineOffset: '-3px', background: 'rgba(0, 188, 150, 0.25)' }} />;
      case 'customAttack':
        return <div className={styles.swatch} style={{ outline: '3px solid rgba(255, 183, 77, 0.55)', outlineOffset: '-3px', background: 'rgba(255, 183, 77, 0.25)' }} />;
      case 'checkmate':
        return (
          <span className={styles.iconSwatch}>
            <span>♔</span>
            <span style={{ color: 'white', WebkitTextStroke: '1px black' }}>♔</span>
          </span>
        );
      case 'captureLoss':
        return <span className={styles.iconSwatch}>⚔️</span>;
      case 'player':
        return (
          <div
            className={styles.playerDot}
            style={{
              background: item.color,
              borderColor: item.border || (item.color === '#fff' || item.color === 'white' ? '#666' : '#fff'),
            }}
          />
        );
      case 'specialSq':
        return <div className={styles.swatch} style={{ border: `2px solid ${item.color}`, background: item.bg }} />;
      default:
        return null;
    }
  };

  const wrapperStyle = maxWidth
    ? { maxWidth: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth }
    : undefined;

  return (
    <div className={`${styles.legend}${className ? ` ${className}` : ''}`} style={wrapperStyle}>
      {title && <div className={styles.title}>{title}</div>}
      {rows.map((rowItems, rowIndex) => (
        <div key={rowIndex} className={styles.row}>
          {rowItems.map(item => (
            <div key={item.key} className={styles.item}>
              {renderSwatch(item)}
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default BoardLegend;
