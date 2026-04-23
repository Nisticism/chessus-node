// Shared definitions for forum categories used by /forums, /forums/general,
// /forums/new, and the forum detail page. Keep in sync with the
// VALID_CATEGORIES whitelist in server/index.js (POST /api/forums/new) and
// the `category` column on the `articles` table.

export const FORUM_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'gameplay', label: 'Gameplay' },
  { value: 'social', label: 'Social' },
  { value: 'bug-report', label: 'Bug Report' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'announcement', label: 'Announcement' },
  { value: 'misc', label: 'Misc' },
];

// Game forums use the special category 'game' which is never user-selectable.
export const GAME_CATEGORY = { value: 'game', label: 'Game' };

const lookup = Object.fromEntries(
  [...FORUM_CATEGORIES, GAME_CATEGORY].map((c) => [c.value, c.label])
);

export function categoryLabel(value) {
  if (!value) return 'General';
  return lookup[value] || value;
}
