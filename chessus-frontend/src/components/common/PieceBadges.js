import React from 'react';
import styles from './piecebadges.module.scss';

/**
 * Reusable piece stat badges component.
 * Renders HP (bottom-left), AD (bottom-right), Regen (top-right), Burn (top-left)
 * anchored to their respective corners regardless of which badges are present.
 * 
 * @param {Object} piece - The piece data object
 * @param {number} squareSize - The size of the board square in pixels
 * @param {boolean} [showGlobalHpAd] - Whether global show_all_hp_ad is on
 */
const PieceBadges = ({ piece, squareSize, showGlobalHpAd = false, hidden = false }) => {
  if (hidden) return null;
  const showHp = !!(showGlobalHpAd || piece.show_hp_ad || piece.hit_points > 1);
  const hp = piece.current_hp ?? piece.hit_points ?? 1;
  const ad = piece.attack_damage ?? 1;
  const regen = piece.hp_regen ?? 0;
  const showRegenBadge = !!(piece.show_regen && regen > 0);
  const showBurnBadge = !!(piece.show_burn && piece.burn_damage > 0 && piece.burn_duration > 0);

  if (!showHp && !showRegenBadge && !showBurnBadge) return null;

  const pw = piece.piece_width || 1;
  const ph = piece.piece_height || 1;
  const isLargeMultiTile = pw >= 2 && ph >= 2;
  const scale = isLargeMultiTile ? 1.5 : 1;
  const fontSize = `${Math.max(8, squareSize * 0.18) * scale}px`;

  return (
    <>
      {showHp && (
        <span className={styles["hp-badge"]} style={{ fontSize }} title={`Health Points: ${hp}`}>
          <span className={styles["badge-icon"]}>♥</span>{hp}
        </span>
      )}
      {showHp && (
        <span className={styles["ad-badge"]} style={{ fontSize }} title={`Attack Damage: ${ad}`}>
          <span className={styles["badge-icon"]}>⚔</span>{ad}
        </span>
      )}
      {showRegenBadge && (
        <span className={styles["regen-badge"]} style={{ fontSize }} title={`HP Regen: +${regen}/turn`}>
          <span className={styles[isLargeMultiTile ? "regen-icon-multi" : "regen-icon"]}>✚</span>{regen}
        </span>
      )}
      {showBurnBadge && (
        <span className={styles["burn-badge"]} style={{ fontSize }} title={`Burn: ${piece.burn_damage} dmg for ${piece.burn_duration} turns`}>
          <span className={styles[isLargeMultiTile ? "burn-icon-multi" : "burn-icon"]}>🔥</span>{piece.burn_damage}/{piece.burn_duration}
        </span>
      )}
    </>
  );
};

export default PieceBadges;
