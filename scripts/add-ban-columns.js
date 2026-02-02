const db = require('../configs/db');

async function addBanColumns() {
  try {
    // Check if banned column exists
    const [columns] = await db.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'gamified_chess' AND TABLE_NAME = 'users' AND COLUMN_NAME = 'banned'"
    );
    
    if (columns.length > 0) {
      console.log('✓ Ban columns already exist');
      process.exit(0);
    }
    
    console.log('Adding ban system columns...');
    
    await db.query(`
      ALTER TABLE users
        ADD COLUMN banned TINYINT(1) DEFAULT 0 COMMENT 'Whether user is banned',
        ADD COLUMN ban_reason TEXT DEFAULT NULL COMMENT 'Reason for ban',
        ADD COLUMN banned_at DATETIME DEFAULT NULL COMMENT 'When user was banned',
        ADD COLUMN banned_by INT DEFAULT NULL COMMENT 'User ID of admin/owner who banned',
        ADD COLUMN ban_expires_at DATETIME DEFAULT NULL COMMENT 'When ban expires (NULL for permanent)',
        ADD INDEX idx_banned (banned),
        ADD INDEX idx_ban_expires (ban_expires_at)
    `);
    
    console.log('✓ Ban system columns added successfully');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

addBanColumns();
