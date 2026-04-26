/**
 * One-time seed: create a news article for the Lichess blog post
 * "A New Platform for Variations and Game Design" by Nisticism.
 *
 * Run from the project root: node scripts/seed-lichess-blog-news.js
 *
 * Prerequisites: the external_blog_url migration must have run (server restart
 * handles this automatically via runMigrations).
 */

'use strict';

const db_pool = require('../configs/db');

const BLOG_URL = 'https://lichess.org/@/nisticism/blog/a-new-platform-for-variations-and-game-design/fndh193x';

const TITLE = 'GridGrove featured on Lichess: A New Platform for Variations and Game Design';

const CONTENT =
  'GridGrove was recently featured on the Lichess community blog! ' +
  'The post introduces GridGrove as a platform for creating, sharing, and playing custom chess variants. ' +
  'It covers the piece wizard, the board editor, how AI training works, and the vision for where the platform is headed.\n\n' +
  'The response from the Lichess community has been fantastic — players are already requesting variants like ' +
  'Frankfurter Chess (pieces transform into the type they capture), Chinese Chess (Xiangqi), and hex-grid games. ' +
  'These are all on the long-term roadmap!\n\n' +
  'Click "Read on Lichess" below to see the full blog post and the community discussion.';

async function run() {
  try {
    // Look up the owner/admin user to use as author
    const [[author]] = await db_pool.query(
      `SELECT id, username FROM users WHERE role IN ('owner', 'Owner', 'admin', 'Admin') ORDER BY id ASC LIMIT 1`
    );

    if (!author) {
      console.error('No admin/owner user found — cannot seed news article.');
      process.exit(1);
    }

    // Avoid duplicate seeds
    const [[existing]] = await db_pool.query(
      `SELECT id FROM articles WHERE external_blog_url = ? AND is_news = 1 LIMIT 1`,
      [BLOG_URL]
    );
    if (existing) {
      console.log(`News article for this blog URL already exists (id=${existing.id}). Skipping.`);
      process.exit(0);
    }

    const [result] = await db_pool.query(
      `INSERT INTO articles (author_id, title, content, created_at, game_type_id, is_news, public, external_blog_url)
       VALUES (?, ?, ?, NOW(), NULL, 1, 1, ?)`,
      [author.id, TITLE, CONTENT, BLOG_URL]
    );

    console.log(`✓ News article created — id=${result.insertId}, author=${author.username}`);
    console.log(`  Title: ${TITLE}`);
    console.log(`  Blog URL: ${BLOG_URL}`);
    process.exit(0);
  } catch (err) {
    console.error('Error seeding news article:', err);
    process.exit(1);
  }
}

run();
