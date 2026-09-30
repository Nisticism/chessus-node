import React from 'react';
import styles from './DonorBadge.module.scss';

const DonorBadge = ({ totalDonations, hidden }) => {
  const amount = parseFloat(totalDonations);
  // Don't show badge if no donations or hidden by user
  if (!amount || amount < 5 || hidden === 1 || hidden === true) {
    return null;
  }

  // Determine badge tier
  const isGold = amount >= 50;
  const badgeClass = isGold ? styles.goldBadge : styles.silverBadge;
  const badgeTitle = isGold 
    ? `Grove Guardian - $${amount.toFixed(2)} donated` 
    : `Sapling Supporter - $${amount.toFixed(2)} donated`;
  const badgeIcon = isGold ? '🌳' : '🌱';
  const badgeText = isGold ? 'Grove Guardian' : 'Sapling Supporter';

  return (
    <div className={`${styles.donorBadge} ${badgeClass}`} title={badgeTitle}>
      <span className={styles.badgeIcon}>{badgeIcon}</span>
      <span className={styles.badgeText}>{badgeText}</span>
    </div>
  );
};

export default DonorBadge;
