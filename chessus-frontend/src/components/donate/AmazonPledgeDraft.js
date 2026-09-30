import React from "react";
import styles from "./donate.module.scss";

/*
 * DRAFT - not public. The pledge to give 10% of supporter money to a charity
 * protecting the Amazon rainforest, written ahead of the details.
 *
 * Donate.js shows it only to admins and owners, with the banner below, until
 * PUBLISHED is set to true. Everything in [square brackets] is a placeholder
 * waiting for the real detail (the charity, the start date, how the 10% is
 * counted and how the donations are shown).
 *
 * Note: it ships in the page's JavaScript like any other component, so it is
 * hidden rather than secret - fine for a draft announcement, not for anything
 * confidential.
 */
export const AMAZON_PLEDGE_PUBLISHED = false;

const Placeholder = ({ children }) => (
  <span style={{ background: 'rgba(255, 210, 120, 0.18)', borderRadius: 4, padding: '0 4px', color: '#ffd28a' }}>
    {children}
  </span>
);

const AmazonPledgeDraft = () => (
  <div className={styles.donorBadgesInfo}>
    {!AMAZON_PLEDGE_PUBLISHED && (
      <p style={{
        border: '1px dashed rgba(255, 210, 120, 0.7)', borderRadius: 6, padding: '8px 12px',
        color: '#ffd28a', fontSize: '0.85rem', margin: '0 0 12px',
      }}>
        Draft - only admins and owners can see this section. Fill in the placeholders, then set
        AMAZON_PLEDGE_PUBLISHED in AmazonPledgeDraft.js to publish it.
      </p>
    )}
    <h2 className={styles.sectionTitle}>🌳 10% for the Amazon</h2>
    <p className={styles.badgeDescription}>
      GridGrove is named for a grove, so it seems only right that the people who help it grow
      help a real forest grow too. Starting <Placeholder>[start date]</Placeholder>, 10% of all
      supporter contributions goes to <Placeholder>[charity name]</Placeholder>, which works to
      protect the Amazon rainforest.
    </p>
    <ul className={styles.perkList}>
      <li>
        <strong>How it works.</strong> Every <Placeholder>[month / quarter]</Placeholder> we add
        up what supporters have given and send 10% of it to <Placeholder>[charity name]</Placeholder>.
        It comes out of GridGrove&apos;s share - your contribution is not increased, and every
        supporter perk stays exactly the same.
      </li>
      <li>
        <strong>What it does.</strong> <Placeholder>[charity name]</Placeholder>{' '}
        <Placeholder>[one line on their work - e.g. protecting rainforest land, supporting
        Indigenous land rights, replanting cleared forest]</Placeholder>.
      </li>
      <li>
        <strong>Seeing it happen.</strong> We will post each donation, with its receipt,{' '}
        <Placeholder>[here / in the changelog / in the news]</Placeholder>, so you can see where
        the money went.
      </li>
    </ul>
    <p className={styles.badgeNote}>
      Every Sapling Supporter and Grove Guardian is part of this - thank you for helping both
      groves grow. <Placeholder>[link to the charity]</Placeholder>
    </p>
  </div>
);

export default AmazonPledgeDraft;
