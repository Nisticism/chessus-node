const db = require('../configs/db');

async function testBanSystem() {
  try {
    // Create a test user
    const testUsername = 'testuser_' + Date.now();
    const testEmail = testUsername + '@test.com';
    
    console.log(`\n1. Creating test user: ${testUsername}`);
    const [userResult] = await db.query(
      "INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)",
      [testUsername, testEmail, 'testpass123', 'user']
    );
    const testUserId = userResult.insertId;
    console.log(`   ✓ Created user with ID: ${testUserId}`);
    
    // Get Nisticism's ID (the owner)
    const [owner] = await db.query("SELECT id FROM users WHERE username = 'Nisticism'");
    const ownerId = owner[0].id;
    
    // Ban the test user
    console.log(`\n2. Banning user ${testUserId}...`);
    await db.query(
      "UPDATE users SET banned = 1, ban_reason = ?, banned_at = NOW(), banned_by = ? WHERE id = ?",
      ['Test ban for demonstration', ownerId, testUserId]
    );
    console.log('   ✓ User banned successfully');
    
    // Check banned status
    const [bannedUser] = await db.query(
      "SELECT id, username, banned, ban_reason, banned_at, banned_by, ban_expires_at FROM users WHERE id = ?",
      [testUserId]
    );
    console.log('\n3. Banned user details:');
    console.log(`   Username: ${bannedUser[0].username}`);
    console.log(`   Banned: ${bannedUser[0].banned === 1 ? 'Yes' : 'No'}`);
    console.log(`   Reason: ${bannedUser[0].ban_reason}`);
    console.log(`   Banned at: ${bannedUser[0].banned_at}`);
    console.log(`   Banned by: ${bannedUser[0].banned_by} (Owner ID: ${ownerId})`);
    console.log(`   Expires: ${bannedUser[0].ban_expires_at || 'Never (permanent)'}`);
    
    // Unban the user
    console.log(`\n4. Unbanning user ${testUserId}...`);
    await db.query(
      "UPDATE users SET banned = 0, ban_reason = NULL, banned_at = NULL, banned_by = NULL, ban_expires_at = NULL WHERE id = ?",
      [testUserId]
    );
    console.log('   ✓ User unbanned successfully');
    
    // Clean up - delete test user
    console.log(`\n5. Cleaning up test user...`);
    await db.query("DELETE FROM users WHERE id = ?", [testUserId]);
    console.log('   ✓ Test user deleted');
    
    console.log('\n✅ Ban system test completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Error:', err);
    process.exit(1);
  }
}

testBanSystem();
