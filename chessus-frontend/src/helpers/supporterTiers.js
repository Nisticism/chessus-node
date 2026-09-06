// Supporter tiers, in one place so the perks that key off them cannot drift
// apart. Mirrors the server's own checks (SILVER_MIN_DONATION in index.js) -
// these are for showing and hiding UI; the server still enforces each perk.

export const SILVER_MIN_DONATION = 5;
export const GOLD_MIN_DONATION = 50;

/** Admins and owners get every supporter perk without donating. */
export const hasStaffRole = (user) => {
  const role = (user?.role || '').toLowerCase();
  return role === 'admin' || role === 'owner';
};

/** Silver Supporter or better (or staff). */
export const isSilverSupporter = (user) => {
  if (!user) return false;
  if (hasStaffRole(user)) return true;
  // total_donations is a DECIMAL, so it arrives as a string.
  return parseFloat(user.total_donations || 0) >= SILVER_MIN_DONATION;
};

/** Gold Supporter or better (or staff). */
export const isGoldSupporter = (user) => {
  if (!user) return false;
  if (hasStaffRole(user)) return true;
  return parseFloat(user.total_donations || 0) >= GOLD_MIN_DONATION;
};

/**
 * Whether this user may pick their own light/dark square colours. Everyone can
 * still use the built-in Quick Themes.
 */
export const canUseCustomBoardColors = (user) => isSilverSupporter(user);

/**
 * Whether this user may BUILD puzzles. Solving them is open to everyone - the
 * gate is on authorship, not access - so do not use this to hide the solver.
 */
export const canCreatePuzzles = (user) => isSilverSupporter(user);
