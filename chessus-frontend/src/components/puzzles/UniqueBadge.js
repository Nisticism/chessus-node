import React from "react";
import styles from "./uniquebadge.module.scss";

/*
 * The "verified unique solution" badge: the puzzle has exactly one winning move
 * at every step, the last included, checked against every defence.
 *
 * Rendered only for a verified puzzle. `compact` shows just the mark, for
 * lists with no room for a pill.
 */
export function uniqueBadgeTitle(method) {
  const how = method === 'manual'
    ? 'Verified by GridGrove staff.'
    : method === 'search'
      ? 'Verified by a full search, run by GridGrove staff.'
      : 'Checked automatically against every defense.';
  return `Verified unique solution: exactly one winning move at every step. ${how}`;
}

export default function UniqueBadge({ status, method, compact = false }) {
  if (status !== 'verified') return null;
  const title = uniqueBadgeTitle(method);
  if (compact) {
    return <span className={styles["mark"]} title={title} aria-label={title}>✓</span>;
  }
  return (
    <span className={styles["badge"]} title={title}>
      ✓ One solution
    </span>
  );
}
