const db = require('../configs/db');

async function check() {
  try {
    const [r1] = await db.query('SHOW TABLES LIKE "direct_messages"');
    console.log('direct_messages:', r1.length > 0 ? 'EXISTS' : 'MISSING');
    
    const [r2] = await db.query('SHOW TABLES LIKE "game_chat_messages"');
    console.log('game_chat_messages:', r2.length > 0 ? 'EXISTS' : 'MISSING');

    const [r3] = await db.query('SHOW COLUMNS FROM users LIKE "allow_non_friend_dms"');
    console.log('users.allow_non_friend_dms:', r3.length > 0 ? 'EXISTS' : 'MISSING');

    const [r4] = await db.query('SHOW COLUMNS FROM users LIKE "disable_game_chat"');
    console.log('users.disable_game_chat:', r4.length > 0 ? 'EXISTS' : 'MISSING');
  } catch (e) {
    console.error(e.message);
  }
  process.exit(0);
}
check();
