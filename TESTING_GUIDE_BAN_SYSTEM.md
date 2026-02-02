# Owner Role & Ban System Testing Guide

## Testing the Ban System

### Prerequisites
1. Server running on port 3001
2. Frontend running on port 3000
3. Logged in as Nisticism (owner)

### Test 1: Access Admin Dashboard

**Steps:**
1. Navigate to `http://localhost:3000/admin`
2. Verify you can see the admin dashboard
3. Click on "Users" tab (should be default)

**Expected Result:**
- Users table displays with columns: ID, Username, Email, Name, Role, Status, ELO, Actions
- Your account (Nisticism) shows "OWNER" role badge (gold gradient)
- Status shows "ACTIVE" (green badge)
- Actions include: Edit, Ban (disabled for owner)

### Test 2: Ban a User

**Setup:**
Create a test user first (or use existing non-admin user)

**Steps:**
1. In admin dashboard, find a user with "USER" role
2. Click "Ban" button
3. Ban modal appears with:
   - Title showing username
   - Reason textarea (required)
   - "Permanent Ban" checkbox (checked by default)
   - Optional expiration date picker
4. Enter reason: "Testing ban system"
5. Click "Ban User"

**Expected Result:**
- Success message: "User [username] has been banned"
- User row updates:
  - Status changes to "BANNED" (red badge)
  - Ban button changes to "Unban" button
- User is immediately logged out if they were logged in
- User cannot log in (gets 403 error)

**Verify via API:**
```bash
# Try to login as banned user
curl -X POST http://localhost:3001/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"password"}'

# Expected response:
# {
#   "message": "Your account has been banned. Reason: Testing ban system",
#   "banned": true,
#   "ban_reason": "Testing ban system",
#   "banned_at": "2025-02-02T21:10:30.000Z",
#   "ban_expires_at": null
# }
```

### Test 3: Temporary Ban

**Steps:**
1. Ban another user (or unban previous and re-ban)
2. In ban modal, uncheck "Permanent Ban"
3. Set expiration date to tomorrow
4. Enter reason and submit

**Expected Result:**
- User status shows "BANNED" with expiration date
- User cannot log in
- After expiration date passes, user can log in (auto-unban)

### Test 4: Unban a User

**Steps:**
1. Find a banned user in admin dashboard
2. Click "Unban" button (shows ban reason in tooltip)
3. Confirm unban

**Expected Result:**
- Success message: "User [username] has been unbanned"
- Status changes back to "ACTIVE"
- User can now log in successfully

### Test 5: Promote User to Admin

**Steps:**
1. Find a user with "USER" role
2. Click "Promote" button
3. Confirm promotion

**Expected Result:**
- Success message: "User [username] has been promoted to admin"
- Role badge changes to "ADMIN" (cyan)
- Promote button changes to "Demote" button
- User now has admin privileges (can access /admin)

### Test 6: Demote Admin to User

**Steps:**
1. Find a user with "ADMIN" role
2. Click "Demote" button
3. Confirm demotion

**Expected Result:**
- Success message: "Admin [username] has been demoted to user"
- Role badge changes to "USER" (gray)
- Demote button changes to "Promote" button
- User loses admin privileges

### Test 7: Try to Ban Owner (Should Fail)

**Steps:**
1. Find Nisticism (owner) in users list
2. Notice "Ban" button is disabled (grayed out)
3. Try via API:

```bash
curl -X POST http://localhost:3001/api/admin/users/1/ban \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Testing owner protection"}'
```

**Expected Result:**
- Button disabled in UI
- API returns 403: "Cannot ban the owner"

### Test 8: Admin Cannot Ban Another Admin

**Setup:**
1. Login as an admin (not owner)
2. Navigate to /admin

**Steps:**
1. Try to ban another admin user

**Expected Result:**
- API returns 403: "Admins cannot ban other admins"
- Only owner can manage admin accounts

### Test 9: Only Owner Can Promote/Demote

**Setup:**
1. Login as regular admin (not owner)

**Steps:**
1. Go to admin dashboard users tab
2. Verify Promote/Demote buttons are NOT visible

**Expected Result:**
- Only Edit and Ban/Unban buttons visible
- Promote/Demote are owner-only features

### Test 10: Ban Persistence Across Sessions

**Steps:**
1. Ban a user
2. Restart the server
3. Try to login as banned user

**Expected Result:**
- Ban persists (stored in database)
- User still cannot log in
- Ban info displayed correctly

### Test 11: Auto-Unban on Token Refresh

**Steps:**
1. Set a temporary ban expiring in 2 minutes
2. User has active session (logged in)
3. Wait for ban to expire
4. User activity triggers token refresh

**Expected Result:**
- Token refresh endpoint checks ban expiration
- Auto-unbans user if expired
- User session continues without interruption

### Test 12: Refresh Token Clearing on Ban

**Steps:**
1. User is logged in with active session
2. Owner bans the user
3. User tries to refresh their access token

**Expected Result:**
- Refresh token cleared from database on ban
- Token refresh fails
- User forced to logout

## API Endpoint Testing

### GET /api/admin/users
```bash
curl http://localhost:3001/api/admin/users \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Expected:** List of all users with ban info

### POST /api/admin/users/:userId/ban
```bash
curl -X POST http://localhost:3001/api/admin/users/5/ban \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Spam posting",
    "expiresAt": "2025-12-31T23:59:59"
  }'
```

**Expected:** User banned, refresh token cleared

### POST /api/admin/users/:userId/unban
```bash
curl -X POST http://localhost:3001/api/admin/users/5/unban \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Expected:** Ban removed, user can login

### POST /api/admin/users/:userId/promote
```bash
curl -X POST http://localhost:3001/api/admin/users/5/promote \
  -H "Authorization: Bearer YOUR_OWNER_ACCESS_TOKEN"
```

**Expected:** User role changed to admin (owner only)

### POST /api/admin/users/:userId/demote
```bash
curl -X POST http://localhost:3001/api/admin/users/5/demote \
  -H "Authorization: Bearer YOUR_OWNER_ACCESS_TOKEN"
```

**Expected:** Admin role changed to user (owner only)

## Database Verification

### Check Ban Columns
```sql
SHOW COLUMNS FROM users LIKE 'ban%';
```

**Expected Output:**
- banned
- ban_reason
- banned_at
- banned_by
- ban_expires_at

### Check Owner Role
```sql
SELECT username, role FROM users WHERE role = 'owner';
```

**Expected Output:**
- Nisticism | owner

### View Banned Users
```sql
SELECT id, username, banned, ban_reason, banned_at, ban_expires_at 
FROM users 
WHERE banned = 1;
```

## Troubleshooting

### Issue: Ban button not showing
**Solution:** Check user role - must be admin or owner

### Issue: Promote/Demote buttons not showing
**Solution:** These are owner-only features, must be logged in as owner

### Issue: Cannot ban user
**Solution:** 
- Check you're not trying to ban owner
- Admin cannot ban another admin
- Ensure ban reason is provided

### Issue: User still can login after ban
**Solution:**
- Check database - banned column should be 1
- Verify ban logic in login endpoint (line ~791 in server/index.js)
- Check if ban expired (ban_expires_at)

### Issue: Migration not running
**Solution:**
- Check console on server start for migration messages
- Run `node scripts/check-migrations.js` to verify
- Check migrations.js file for errors

## Success Criteria

✅ Owner role assigned to Nisticism  
✅ Ban columns added to users table  
✅ Can ban/unban users via UI  
✅ Banned users cannot login  
✅ Temporary bans auto-expire  
✅ Refresh tokens cleared on ban  
✅ Owner can promote/demote admins  
✅ Protection: Cannot ban owner  
✅ Protection: Admin cannot ban admin  
✅ UI shows ban status and role badges  
✅ All API endpoints return correct responses  
✅ Migrations run automatically on server start  

## Notes

- Owner account (Nisticism) is protected and cannot be banned or demoted
- Ban system is account-level (not IP-based)
- Ban expiration is checked at login and token refresh
- All ban actions are logged with timestamp and admin ID
- Frontend automatically updates UI after ban/unban actions
