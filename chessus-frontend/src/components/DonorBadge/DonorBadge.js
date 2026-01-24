import React from 'react';
import styles from './DonorBadge.module.scss';

const DonorBadge = ({ totalDonations }) => {
  // Don't show badge if no donations
  if (!totalDonations || totalDonations < 5) {
    return null;
  }

  // Determine badge tier
  const isGold = totalDonations >= 50;
  const badgeClass = isGold ? styles.goldBadge : styles.silverBadge;
  const badgeTitle = isGold 
    ? `Gold Supporter - $${totalDonations.toFixed(2)} donated` 
    : `Silver Supporter - $${totalDonations.toFixed(2)} donated`;
  const badgeIcon = isGold ? '⭐' : '✦';
  const badgeText = isGold ? 'Gold Supporter' : 'Silver Supporter';

  return (
    <div className={`${styles.donorBadge} ${badgeClass}`} title={badgeTitle}>
      <span className={styles.badgeIcon}>{badgeIcon}</span>
      <span className={styles.badgeText}>{badgeText}</span>
    </div>
  );
};

export default DonorBadge;
