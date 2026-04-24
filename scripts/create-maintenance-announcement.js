/**
 * One-time script: create a maintenance announcement and fan out to all users.
 * Run on the server: node scripts/create-maintenance-announcement.js
 *
 * This mirrors the logic in POST /api/announcements exactly.
 */

'use strict';

const db_pool = require('../configs/db');

const TITLE   = 'Brief maintenance — upgrading server';
const CONTENT =
  'The site will be offline for a few minutes today while we upgrade from a t3.micro to a t3.small. ' +
  'This comes alongside a set of server efficiency improvements that went out today: forum list pages ' +
  'now load in 2 database queries instead of up to 81, opening a forum post fetches all comment ' +
  'authors in one query instead of one per comment, and the game detail page now loads its forum link ' +
  'and vote count in parallel. Thanks for your patience!';
const ACTION_URL = null; // falls back to /announcements/:id

async function run() {
  try {
    const [insert] = await db_pool.query(
      `INSERT INTO announcements (title, content, action_url, author_id)
       VALUES (?, ?, ?, NULL)`,
      [TITLE, CONTENT, ACTION_URL],
    );
    const announcementId = insert.insertId;
    const linkUrl = `/announcements/${announcementId}`;
    console.log(`Announcement inserted — id=${announcementId}`);

    const [users] = await db_pool.query(
      'SELECT id FROM users WHERE banned = 0 OR banned IS NULL',
    );
    console.log(`Fanning out to ${users.length} users…`);

    const preview = CONTENT.length > 480 ? CONTENT.slice(0, 477) + '...' : CONTENT;
    const CHUNK = 1000;
    let totalInserted = 0;

    for (let i = 0; i < users.length; i += CHUNK) {
      const slice = users.slice(i, i + CHUNK);
      if (slice.length === 0) continue;
      const values = slice.flatMap((u) => [
        u.id, null, 'announcement', TITLE, preview, announcementId, linkUrl,
      ]);
      const placeholders = slice.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(',');
      await db_pool.query(
        `INSERT INTO notifications
           (user_id, sender_id, type, title, content, related_id, action_url)
         VALUES ${placeholders}`,
        values,
      );
      totalInserted += slice.length;
    }

    console.log(`Done — ${totalInserted} notification rows inserted.`);
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

run();
