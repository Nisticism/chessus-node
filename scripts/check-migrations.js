const db = require('../configs/db');

async function checkMigrations() {
  try {
    // Check ALL columns
    const [allColumns] = await db.query(
      "SHOW COLUMNS FROM users"
    );
    
    console.log('\n✓ All columns in users table:');
    allColumns.forEach(col => console.log(`  - ${col.Field} (${col.Type})`));
    
    // Check ban columns specifically
    const [columns] = await db.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'gamified_chess' AND TABLE_NAME = 'users' AND COLUMN_NAME IN ('banned', 'ban_reason', 'banned_at', 'banned_by', 'ban_expires_at')"
    );
    
    console.log('\n✓ Ban columns found:');
    if (columns.length > 0) {
      columns.forEach(col => console.log(`  - ${col.COLUMN_NAME}`));
    } else {
      console.log('  (using SHOW COLUMNS output above instead)');
    }
    
    // Check role enum
    const [roleCheck] = await db.query(
      "SHOW COLUMNS FROM users WHERE Field = 'role'"
    );
    
    console.log('\n✓ Role enum values:');
    console.log(`  ${roleCheck[0].Type}`);
    
    // Check Nisticism's role
    const [users] = await db.query(
      "SELECT username, role FROM users WHERE username = 'Nisticism'"
    );
    
    console.log('\n✓ Nisticism account:');
    if (users.length > 0) {
      console.log(`  Role: ${users[0].role}`);
    } else {
      console.log('  User not found');
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkMigrations();
