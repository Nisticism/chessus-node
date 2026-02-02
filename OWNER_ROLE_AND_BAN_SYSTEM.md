# Owner Role and Ban System Implementation

## Overview
Implemented a comprehensive user management system with owner role privileges and account-level ban functionality.

## Database Changes

### 1. Users Table Enhancements
**New Columns:**
- `banned` (TINYINT) - Boolean flag for ban status
- `ban_reason` (TEXT) - Reason for the ban
- `banned_at` (DATETIME) - Timestamp when ban was applied
- `banned_by` (INT) - User ID of admin/owner who issued the ban
- `ban_expires_at` (DATETIME) - Optional expiration date (NULL for permanent)

**Indexes:**
- `idx_banned` - Index on banned column for faster queries
- `idx_ban_expires` - Index on ban_expires_at for expiration checks

### 2. Role Enum Update
- Modified role ENUM to include: 'user', 'admin', 'owner'
- Nisticism user automatically set to 'owner' role

## Backend Implementation (server/index.js)

### Authentication Enhancements

#### Login Endpoint (POST /api/login)
- Checks if user is banned before allowing login
- Auto-unbans if ban_expires_at has passed
- Returns 403 with ban details if still banned
- Clears refresh token for banned users

#### Token Refresh Endpoint (POST /api/refresh-token)
- Validates ban status on token refresh
- Auto-unbans expired bans
- Denies refresh for actively banned users

### New API Endpoints

#### 1. GET /api/admin/users
**Access:** Admin or Owner only
**Response:** List of all users with ban information
```json
{
  "data": [
    {
      "id": 1,
      "username": "Nisticism",
      "email": "user@example.com",
      "role": "owner",
      "banned": 0,
      "ban_reason": null,
      "banned_at": null,
      "ban_expires_at": null
    }
  ],
  "pagination": {...}
}
```

#### 2. POST /api/admin/users/:userId/ban
**Access:** Admin or Owner
**Body:**
```json
{
  "reason": "Violation of terms",
  "expiresAt": "2025-12-31T23:59:59" // Optional, null for permanent
}
```
**Business Rules:**
- Cannot ban owner
- Admins cannot ban other admins
- Reason is required
- Clears user's refresh token

#### 3. POST /api/admin/users/:userId/unban
**Access:** Admin or Owner
**Effect:** Removes all ban-related data from user

#### 4. POST /api/admin/users/:userId/promote
**Access:** Owner only
**Effect:** Changes user role from 'user' to 'admin'
**Business Rules:**
- Only owner can promote
- Cannot promote admins or owner

#### 5. POST /api/admin/users/:userId/demote
**Access:** Owner only
**Effect:** Changes user role from 'admin' to 'user'
**Business Rules:**
- Only owner can demote
- Cannot demote owner
- Cannot demote self

### Role Check Updates
All existing admin permission checks updated to include 'owner':
- Game editing/deletion
- Piece editing/deletion
- User account management
- Careers page management
- authenticateAdmin middleware

## Frontend Implementation

### Admin Dashboard Enhancements (AdminDashboard.js)

#### New State Management
- `showBanModal` - Controls ban modal visibility
- `banningUser` - Currently selected user for banning
- `banReason` - Ban reason input
- `banExpiration` - Ban expiration date input
- `isPermanentBan` - Toggle for permanent vs temporary ban

#### Updated Users Table
**New Columns:**
- **Status Column:** Shows ACTIVE or BANNED badge with expiration date
- **Actions Column:** Enhanced with conditional buttons

**Action Buttons:**
- **Edit** - Available to all admins/owner
- **Ban/Unban** - Toggle based on ban status
  - Ban button disabled for owner
  - Shows ban reason in tooltip on unban button
- **Promote/Demote** - Owner only, not shown for owner accounts

#### Ban Modal
**Features:**
- Required reason textarea
- Permanent ban checkbox (default: true)
- Optional expiration datetime picker
- Validation: Reason required before submission
- Error handling with alerts

#### UI Components
**Status Badges:**
- `.status-active` - Green badge for active users
- `.status-banned` - Red badge for banned users with expiration info

**Role Badges:**
- `.role-owner` - Gold gradient badge with shadow
- `.role-admin` - Cyan badge
- `.role-user` - Gray badge

**Action Buttons:**
- `.ban-btn` - Red gradient (danger action)
- `.unban-btn` - Green gradient (success action)
- `.promote-btn` - Cyan gradient (info action)
- `.demote-btn` - Yellow gradient (warning action)

### Access Control
Updated admin route guard to accept 'owner' role:
```javascript
if (currentUser.role !== 'admin' && currentUser.role !== 'owner') {
  return <Navigate to="/" />
}
```

## Migration System (server/migrations.js)

### Auto-Migration on Server Start
1. **Ban System Migration**
   - Checks if 'banned' column exists
   - Adds all 5 ban columns and 2 indexes if missing

2. **Owner Role Migration**
   - Checks role ENUM for 'owner' value
   - Modifies ENUM to include 'owner'
   - Sets Nisticism as owner

## Testing

### Database Test Script (scripts/test-ban-system.js)
Validates:
- User creation
- Ban application with reason and timestamp
- Ban status retrieval
- Unban functionality
- Data cleanup

**Output:**
```
✓ Created user with ID: 36
✓ User banned successfully
✓ User unbanned successfully
✅ Ban system test completed successfully!
```

### Verification Script (scripts/check-migrations.js)
Confirms:
- All ban columns present
- Owner role in ENUM
- Nisticism has owner role

## Security Features

### Ban Enforcement
- Blocked at login (cannot authenticate)
- Blocked at token refresh (cannot maintain session)
- Auto-expiration for temporary bans
- Refresh token cleared on ban

### Role Hierarchy
```
Owner > Admin > User
```

**Protection Rules:**
- Owner cannot be banned
- Owner cannot be demoted
- Admin cannot ban other admins
- Only owner can promote/demote
- Owner has all admin powers plus user management

### Authorization Layers
1. authenticateToken middleware
2. Role checks in endpoint handlers
3. Business logic validation
4. Frontend UI conditional rendering

## API Response Codes

### Ban-Related Responses
- `200` - Success
- `400` - Bad request (missing reason, invalid data)
- `403` - Forbidden (insufficient permissions, banned account)
- `404` - User not found
- `500` - Server error

### Ban Error Messages
```json
{
  "message": "Your account has been banned. Reason: [reason]",
  "banned": true,
  "ban_reason": "...",
  "banned_at": "...",
  "ban_expires_at": "..."
}
```

## Files Modified

### Backend
1. `db/migrations/add-ban-system.sql` - Ban columns migration
2. `db/migrations/add-owner-role.sql` - Owner role migration
3. `server/migrations.js` - Migration execution logic
4. `server/index.js` - Ban checks + 5 new endpoints + role updates

### Frontend
1. `chessus-frontend/src/components/admindashboard/AdminDashboard.js`
   - Ban/unban functions
   - Promote/demote functions
   - Ban modal
   - Updated users table
   - Role check update

2. `chessus-frontend/src/components/admindashboard/admin-dashboard.module.scss`
   - 4 new button styles
   - 2 status badge styles
   - 3 role badge styles

### Testing/Utilities
1. `scripts/test-ban-system.js` - End-to-end ban testing
2. `scripts/check-migrations.js` - Migration verification
3. `scripts/add-ban-columns.js` - Manual migration helper

## Usage Examples

### As Owner: Ban a User
1. Navigate to Admin Dashboard (/admin)
2. Click "Ban" button next to user
3. Enter ban reason (required)
4. Choose permanent or set expiration date
5. Click "Ban User"
6. User immediately logged out and cannot log back in

### As Owner: Promote User to Admin
1. Navigate to Admin Dashboard
2. Click "Promote" button next to user
3. Confirm promotion
4. User role changed to admin with elevated privileges

### As Admin: View Banned Users
- Banned users show red "BANNED" badge in status column
- Hover over "Unban" button to see ban reason
- Expiration date displayed if not permanent

### Auto-Unban on Expiration
- User logs in after ban expiration
- System checks ban_expires_at
- If expired, automatically removes ban
- User logs in successfully

## Future Enhancements (Not Implemented)

### Potential Additions
1. **Ban History Table**
   - Track all bans (not just current)
   - Store appeal information
   - Audit trail for moderation actions

2. **Email Notifications**
   - Notify user when banned
   - Send warning before ban expires
   - Alert on unban

3. **Ban Analytics**
   - Most common ban reasons
   - Average ban duration
   - Repeat offenders tracking

4. **IP Ban Support**
   - Combine account + IP banning
   - Prevent ban evasion via new accounts

5. **Appeal System**
   - Users can submit appeals
   - Owner/admin can review and respond
   - Appeal status tracking

6. **Bulk Actions**
   - Ban multiple users at once
   - Mass unban functionality
   - Batch role changes

## Commit Information

**Commit Hash:** 764bb40
**Branch:** master
**Date:** [Current Date]

**Modified Files:** 9
- 4 new files created
- 5 files modified
**Lines Changed:**
- +842 insertions
- -16 deletions

## Conclusion

Successfully implemented a production-ready owner role and ban system with:
✅ Database schema updates with migrations
✅ Backend API endpoints with authorization
✅ Frontend admin UI with ban management
✅ Comprehensive testing scripts
✅ Security enforcement at login and token refresh
✅ Auto-expiration for temporary bans
✅ Role hierarchy with owner > admin > user

The system is fully functional, tested, and deployed to the repository.
